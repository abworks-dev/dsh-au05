import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createDshStudioEnvelope, STUDIO_EVENT_STATES } from './mapping.js';

const CLI_SHA256 = '7364b7d15b0a7de22faaae950876f5f6bf6372947c3bd9c34f9dc16d67d0797c';
const ENV_KEYS = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE',
  'USERNAME', 'USERDOMAIN', 'USERDOMAIN_ROAMINGPROFILE', 'SESSIONNAME', 'HOMEDRIVE', 'HOMEPATH',
  'COMPUTERNAME', 'PROGRAMDATA'];

/** Inert until enqueue. Each enqueue is the caller's explicit authorization for one canonical event.
 * sessionId is an opaque wire alias, never the DSH registry identifier. Exit zero is NOT LED acknowledgement.
 * FS, environment, process and timer seams exist for offline tests, not configurable CLI discovery.
 */
export function createStudioSender({ sessionId, isCurrent, onRecord, spawnImpl = spawn,
  platform = process.platform, fsImpl = fs, env = process.env,
  sha256Impl = bytes => createHash('sha256').update(bytes).digest('hex'),
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  createDshStudioEnvelope('SessionStart', sessionId); // Validate without publishing or doing I/O.
  if (typeof isCurrent !== 'function') throw new Error('studio_current_guard_required');
  let stopped = false, checking = false, scheduled = false, active = null;
  let accepted = 0, completed = 0, dropped = 0, lastCode = null;
  const queue = [];
  function record(code, event) {
    lastCode = code;
    try { onRecord?.(Object.freeze(event ? { code, event } : { code })); } catch { /* No raw callback errors. */ }
  }
  function current() {
    if (stopped || checking) return false;
    checking = true;
    let valid = false;
    try { valid = isCurrent() === true; } catch { /* Fail closed. */ }
    finally { checking = false; }
    return valid && !stopped;
  }
  function kill(child) { try { child?.kill(); } catch { /* No raw process errors. */ } }
  function cancel(code) {
    if (stopped) return;
    stopped = true;
    dropped += queue.length;
    queue.length = 0;
    const task = active;
    if (task) {
      task.finish(code);
      kill(task.child);
    } else record(code);
  }
  function schedule() {
    if (scheduled || stopped || active || !queue.length) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pump(); });
  }
  function pump() {
    if (stopped || active || !queue.length) return;
    if (!current()) { cancel('stale_session'); return; }
    const event = queue.shift();
    if (platform !== 'win32') { dropped++; record('windows_only', event); schedule(); return; }
    let cli, childEnv;
    try {
      if (typeof env.APPDATA !== 'string' || !path.win32.isAbsolute(env.APPDATA) ||
          typeof env.SystemRoot !== 'string' || !path.win32.isAbsolute(env.SystemRoot)) throw new Error();
      cli = path.win32.join(env.APPDATA, 'Ulanzi/UlanziDeck/ustudio-cli/bin/1.0.24/ustudio-cli.exe');
      const stat = fsImpl.lstatSync(cli);
      if (stat.isSymbolicLink() || !stat.isFile() ||
          sha256Impl(fsImpl.readFileSync(cli)) !== CLI_SHA256) throw new Error();
      childEnv = Object.fromEntries(ENV_KEYS.filter(key => typeof env[key] === 'string' && env[key])
        .map(key => [key, env[key]]));
      childEnv.PATH = `C:/Program Files (x86)/Ulanzi Studio;${env.SystemRoot}/System32`;
      childEnv.USTUDIO_CLI_WRAPPER_ACTIVE = '1';
    } catch { dropped++; record('reviewed_cli_required', event); schedule(); return; }
    if (!current()) { dropped++; cancel('stale_session'); return; }
    let done = false, timer = null, bytes = 0;
    const task = { child: null, finish(code) {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeoutImpl(timer);
      if (active === task) active = null;
      if (code === 'cli_returned_not_lamp_ack') completed++;
      else dropped++;
      record(code, event);
      schedule();
    } };
    active = task; // Reserve ownership before injectable spawn can reenter stop().
    try {
      const child = spawnImpl(cli, ['--stdin'], {
        env: childEnv, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      task.child = child;
      // Always consume errors, including after cancellation, without retaining their content.
      child.on('error', () => { if (!done) cancel('spawn_error'); });
      child.stdin.on('error', () => { if (!done) cancel('stdin_error'); });
      child.once('close', code => task.finish(code === 0 ? 'cli_returned_not_lamp_ack' : 'cli_failed'));
      const consume = chunk => {
        if (done) return;
        bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        if (bytes > 32768) cancel('output_limit');
      };
      child.stdout.on('data', consume);
      child.stderr.on('data', consume);
      if (stopped || done) { kill(child); return; }
      timer = setTimeoutImpl(() => cancel('child_timeout'), 3000);
      if (!current()) { cancel('stale_session'); return; }
      if (stopped || done) return;
      child.stdin.end(JSON.stringify(createDshStudioEnvelope(event, sessionId)) + '\n');
    } catch {
      if (!done) cancel('spawn_error');
    }
  }
  return Object.freeze({
    enqueue(event) {
      if (stopped || checking) return false;
      if (typeof event !== 'string' || !Object.hasOwn(STUDIO_EVENT_STATES, event)) {
        record('unsupported_event'); return false;
      }
      if (!current()) { cancel('stale_session'); return false; }
      if (queue.length >= 32) { dropped++; record('queue_full', event); return false; }
      queue.push(event); accepted++; schedule(); return true;
    },
    stop() { cancel('stopped'); },
    snapshot() {
      return Object.freeze({ stopped, queued: queue.length, active: active !== null,
        accepted, completed, dropped, lastCode });
    },
  });
}
