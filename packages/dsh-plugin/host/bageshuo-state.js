import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const SCRIPT = fileURLToPath(new URL('../native/bageshuo-state.ps1', import.meta.url));
const NATIVE_ERRORS = new Set(['unsupported_platform', 'app_not_running', 'app_ambiguous',
  'identity_changed', 'target_exited', 'observer_start_failed']);
const STARTUP_MS = 10_000;
const FRESH_MS = 2000;
const RECOVERY_MS = 10_000;
const WATCH_MS = 250;
const SHUTDOWN_MS = 750;
const PHASES = new Set(['identity', 'process_tree', 'audio', 'verify']);
const diagnostic = row => console.warn('[au05:bageshuo-observer]', JSON.stringify(row));

/** Read-only, opt-in observer. Recovery requests a NEW sample in the SAME pinned child.
 * No key injection, app launch, respawn or identity rebind. Public snapshots remain state/error.
 * Startup, identity/protocol failures and bounded recovery failure require explicit stop/start.
 */
export class BageshuoStateObserver {
  #value = { state: 'stopped', error: null };
  #operation = null;
  #disposed = false;
  #retiring = new Set();

  constructor({ spawnChild = spawn, platform = process.platform, now = () => performance.now(), wallNow = Date.now,
    schedule = setTimeout, cancelTimer = clearTimeout, onChange = () => {}, onDiagnostic = diagnostic } = {}) {
    Object.assign(this, { spawnChild, platform, now, wallNow, schedule, cancelTimer, onChange, onDiagnostic });
  }

  #diagnose(op, event, extra = {}) {
    // Closed, metadata-only record: never include raw errors, stdout, identity, paths or audio.
    try { this.onDiagnostic({ event, phase: op.phase, sampleAgeMs: Math.max(0, Math.round(this.now() - op.sampleAt)),
      hostDelayMs: Math.max(0, Math.round(this.now() - op.watchAt)), ...extra }); } catch { /* Logging is non-fatal. */ }
  }

  #check(op) {
    if (!op.live || this.#operation !== op) return;
    let now = this.now();
    const wall = this.wallNow();
    const drift = Math.round((wall - op.wallAt) - (now - op.clockAt));
    op.clockAt = now; op.wallAt = wall;
    if (Math.abs(drift) >= 1000) {
      this.#diagnose(op, 'clock_changed', { wallDriftMs: drift });
      now = this.now(); // A diagnostic consumer may itself block or re-enter.
    }
    if (!op.live) return;
    if (now < op.deadline) {
      // Startup/recovery replies can themselves queue during another Host pause.
      // Renew their token every 2s WITHOUT extending the original 10s budget.
      if (op.child && (!op.sampled || op.recovering) && now - op.requestAt >= FRESH_MS)
        this.#probe(op, 'probe_renewed');
      return;
    }
    if (!op.sampled || op.recovering) {
      this.#diagnose(op, op.sampled ? 'recovery_timeout' : 'startup_timeout');
      return this.#fail(op, op.sampled ? 'observer_timeout' : 'observer_start_timeout');
    }
    // Do not accept queued heartbeats after Host suspension. Only a sample whose full
    // identity/tree/audio checks START after this request can restore confidence.
    const hostDelayMs = Math.max(0, Math.round(now - op.watchAt));
    op.recovering = true;
    op.deadline = now + RECOVERY_MS;
    this.#probe(op, 'sample_timeout', { hostDelayMs });
  }

  #probe(op, event, extra = {}) {
    if (op.request >= 2147483647) return this.#fail(op, 'observer_protocol_error');
    const request = ++op.request;
    op.requestAt = this.now();
    this.#arm(op);
    if (op.recovering) this.#publish('unknown', 'observer_recovering');
    this.#diagnose(op, event, extra);
    // A reentrant consumer may stop/start or renew this request while publishing/logging.
    if (!op.live || this.#operation !== op || op.request !== request) return;
    try { op.child.stdin.write(`probe:${request}\n`); }
    catch { this.#fail(op, 'observer_exit'); }
  }

  #publish(state, error = null) {
    if (this.#value.state === state && this.#value.error === error) return;
    this.#value = { state, error };
    try { this.onChange(this.snapshot()); } catch { /* Consumer cannot break cleanup. */ }
  }

  snapshot() {
    const op = this.#operation;
    // Freshness is enforced even when a suspended event loop delays the watchdog.
    if (op) this.#check(op);
    return { ...this.#value };
  }

  start() {
    if (this.#disposed || this.#operation || this.#value.state !== 'stopped') return this.snapshot();
    if (this.platform !== 'win32') {
      this.#publish('error', 'unsupported_platform');
      return this.snapshot();
    }
    const now = this.now();
    const op = { child: null, timer: null, killTimer: null, deadline: now + STARTUP_MS,
      sampleAt: now, clockAt: now, wallAt: this.wallNow(), watchAt: now + WATCH_MS,
      sampled: false, recovering: false, request: 0, requestAt: now, phase: 'starting',
      buffer: '', live: true, closed: false, listeners: [] };
    this.#operation = op;
    this.#publish('starting');
    if (!op.live) return this.snapshot(); // onChange may synchronously stop/dispose.
    try {
      op.child = this.spawnChild('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT,
        '-Mode', 'Observe'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
        env: Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE',
          'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'APPDATA', 'PSModulePath']
          .filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]])) });
    } catch {
      this.#fail(op, 'observer_start_failed');
      return this.snapshot();
    }
    const child = op.child;
    const listen = (emitter, event, handler) => {
      emitter.on(event, handler);
      op.listeners.push([emitter, event, handler]);
    };
    try {
      listen(child, 'error', () => this.#fail(op, 'observer_start_failed'));
      listen(child, 'close', () => {
        op.closed = true;
        if (op.live) this.#fail(op, op.buffer ? 'observer_protocol_error' : 'observer_exit');
        this.#release(op);
      });
      listen(child.stdin, 'error', () => this.#fail(op, 'observer_exit'));
      listen(child.stdout, 'error', () => this.#fail(op, 'observer_protocol_error'));
      listen(child.stdout, 'data', chunk => this.#data(op, chunk));
    } catch {
      this.#fail(op, 'observer_start_failed');
      return this.snapshot();
    }
    if (op.live) this.#arm(op);
    else this.#retire(op);
    return this.snapshot();
  }

  #arm(op) {
    if (op.timer !== null) this.cancelTimer(op.timer);
    const delay = Math.max(1, Math.min(WATCH_MS, op.deadline - this.now()));
    op.watchAt = this.now() + delay;
    op.timer = this.schedule(() => {
      op.timer = null;
      this.#check(op);
      if (op.live && op.timer === null) this.#arm(op);
    }, delay);
    op.timer?.unref?.();
  }

  #data(op, chunk) {
    if (!op.live || this.#operation !== op) return;
    this.#check(op);
    if (!op.live) return;
    try { op.buffer += Buffer.from(chunk).toString('utf8'); }
    catch { return this.#fail(op, 'observer_protocol_error'); }
    // Bound each line, not the whole chunk: a suspended Host may drain many valid old frames.
    let end;
    while (op.live && (end = op.buffer.indexOf('\n')) >= 0) {
      const line = op.buffer.slice(0, end).replace(/\r$/, '');
      op.buffer = op.buffer.slice(end + 1);
      if (!line || line.length > 256) return this.#fail(op, 'observer_protocol_error');
      let row;
      try { row = JSON.parse(line); } catch { return this.#fail(op, 'observer_protocol_error'); }
      if (!row || Array.isArray(row) || typeof row !== 'object' || !Number.isInteger(row.request) ||
          row.request < 0 || row.request > op.request) return this.#fail(op, 'observer_protocol_error');
      if (Object.keys(row).length === 2 && Object.hasOwn(row, 'phase') && PHASES.has(row.phase)) {
        if (row.request === op.request) op.phase = row.phase;
        continue; // Progress is diagnostic only. It NEVER renews sample confidence or recovery time.
      }
      if (Object.keys(row).length !== 3 || !Object.hasOwn(row, 'state') || !Object.hasOwn(row, 'error'))
        return this.#fail(op, 'observer_protocol_error');
      // Terminal identity errors must not be hidden by the stale-frame filter.
      if (row.state === 'error' && NATIVE_ERRORS.has(row.error)) return this.#fail(op, row.error);
      if (!((['idle', 'recording'].includes(row.state) && row.error === null) ||
          (row.state === 'unknown' && row.error === 'capture_unknown'))) return this.#fail(op, 'observer_protocol_error');
      this.#check(op);
      if (!op.live) return;
      if (row.request !== op.request) continue;
      const recovered = op.recovering;
      op.sampled = true; op.recovering = false; op.sampleAt = this.now();
      op.deadline = op.sampleAt + FRESH_MS;
      this.#arm(op);
      this.#publish(row.state, row.error);
      // Logging runs AFTER committing the sample. A blocking/reentrant logger must
      // never turn a now-obsolete request into a newly trusted sample.
      if (recovered && op.live && !op.recovering) this.#diagnose(op, 'recovered');
    }
    if (op.live && op.buffer.length > 256) this.#fail(op, 'observer_protocol_error');
  }

  #fail(op, error) {
    if (!op.live || this.#operation !== op) return;
    op.live = false;
    this.#operation = null;
    this.#retire(op);
    this.#publish('error', error);
  }

  #retire(op) {
    if (op.timer !== null) { this.cancelTimer(op.timer); op.timer = null; }
    op.buffer = '';
    if (!op.child || op.closed) { this.#release(op); return; }
    if (this.#retiring.has(op)) return;
    this.#retiring.add(op);
    // EOF is the sole graceful stop command; never block on a native polling Peek.
    try { op.child.stdin?.end(); } catch { /* Bounded fallback below. */ }
    if (op.closed) return;
    op.killTimer = this.schedule(() => {
      op.killTimer = null;
      if (!op.closed) {
        try { op.child.kill(); } catch { /* This owned observer only, never bageshuo.exe. */ }
      }
      this.#release(op);
    }, SHUTDOWN_MS);
    op.killTimer?.unref?.();
  }

  #release(op) {
    if (op.timer !== null) this.cancelTimer(op.timer);
    if (op.killTimer !== null) this.cancelTimer(op.killTimer);
    op.timer = op.killTimer = null;
    op.buffer = '';
    // Keep ownership until close is actually observed; kill() is only a request.
    if (op.closed || !op.child) this.#retiring.delete(op);
    // Keep error sinks on an unclosed killed child until close to avoid unhandled pipe errors.
    for (const [emitter, event, handler] of op.listeners) {
      if (op.closed || (event !== 'error' && event !== 'close')) emitter.removeListener(event, handler);
    }
    if (op.closed) op.listeners = [];
  }

  stop() {
    const op = this.#operation;
    if (op) { op.live = false; this.#operation = null; this.#retire(op); }
    this.#publish('stopped');
    return this.snapshot();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.stop();
  }
}
