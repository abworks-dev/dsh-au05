import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../native/shortcut-voice.ps1', import.meta.url));
const NATIVE_ERRORS = new Set(['shortcut_voice_expired', 'shortcut_voice_cancelled', 'shortcut_voice_invalid_request',
  'shortcut_voice_invalid_shortcut', 'shortcut_voice_unsupported_platform', 'shortcut_voice_foreground_mismatch',
  'shortcut_voice_focus_not_editable', 'shortcut_voice_modifiers_down', 'shortcut_voice_input_failed', 'shortcut_voice_native_failed']);
const BLOCKED_CTRL = new Set('W Q R L T N O P S C V X A Z Y'.split(' '));
const result = (error, notSent = true) => ({ activated: false, error, ...(notSent ? { notSent: true } : {}) });

/** Conservative tap grammar, mirrored in native C#: no aliases, Win/Fn, editing keys or command syntax.
 * Ctrl browser/edit/file shortcuts are rejected even with Alt/Shift; Alt+F4 and Ctrl+F4 are always rejected.
 * This is a tap only, not a hold or a start/stop macro. Third-party software owns dictation state.
 */
export function normalizeShortcut(value) {
  const invalid = () => { throw new TypeError('invalid_shortcut'); };
  if (typeof value !== 'string' || value.length > 64) return invalid();
  const parts = value.trim().split('+').map(part => part.trim().toUpperCase());
  if (parts.length === 1 && parts[0] === 'RIGHTALT') return 'RightAlt';
  if (parts.length < 1 || parts.length > 4) return invalid();
  const key = parts.pop();
  const modifiers = new Set();
  for (const part of parts) {
    if (!['CTRL', 'ALT', 'SHIFT'].includes(part) || modifiers.has(part)) return invalid();
    modifiers.add(part);
  }
  const functionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key);
  if (!functionKey && !/^(?:[A-Z0-9]|SPACE)$/.test(key)) return invalid();
  if (!functionKey && modifiers.size === 0) return invalid();
  if (key === 'F4' && (modifiers.has('CTRL') || modifiers.has('ALT'))) return invalid();
  if (modifiers.has('CTRL') && BLOCKED_CTRL.has(key)) return invalid();
  return [...['CTRL', 'ALT', 'SHIFT'].filter(part => modifiers.has(part)).map(part => ({ CTRL: 'Ctrl', ALT: 'Alt', SHIFT: 'Shift' })[part]),
    key === 'SPACE' ? 'Space' : key].join('+');
}

/** Host-owned expectedExe only. Never construct with client-controlled paths, environment or commands. */
export class ShortcutVoiceBridge {
  constructor({ spawnChild = spawn, platform = process.platform, now = Date.now, env = process.env,
    expectedExe = env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe') : null,
    schedule = setTimeout, cancelTimer = clearTimeout, timeoutMs = 5000 } = {}) {
    Object.assign(this, { spawnChild, platform, now, expectedExe, schedule, cancelTimer });
    this.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(5000, timeoutMs)) : 5000;
    const names = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'APPDATA', 'PSModulePath'];
    this.env = Object.fromEntries(names.filter(name => typeof env[name] === 'string').map(name => [name, env[name]]));
    this.operation = null;
    this.disposed = false;
  }

  async open({ shortcut, isCurrent, expiresAt, bageshuoCrossAppEnabled = false } = {}) {
    if (this.disposed) return result('shortcut_voice_disposed');
    if (this.platform !== 'win32') return result('shortcut_voice_unsupported_platform');
    if (this.operation) return result('shortcut_voice_busy');
    if (typeof isCurrent !== 'function' || !Number.isSafeInteger(expiresAt)) return result('shortcut_voice_invalid_request');
    let canonical;
    try { canonical = normalizeShortcut(shortcut); } catch { return result('shortcut_voice_invalid_shortcut'); }
    if (typeof bageshuoCrossAppEnabled !== 'boolean' || bageshuoCrossAppEnabled && canonical !== 'RightAlt') return result('shortcut_voice_invalid_request');
    if (!this.expectedExe || !win32.isAbsolute(this.expectedExe) || !/^[a-z]:\\/i.test(this.expectedExe)) return result('shortcut_voice_unsupported_client');
    const current = () => { try { return isCurrent() === true; } catch { return false; } };
    if (!current() || this.disposed) return result('shortcut_voice_cancelled');
    const deadline = Math.min(expiresAt, this.now() + this.timeoutMs);
    if (deadline <= this.now()) return result('shortcut_voice_expired');

    return new Promise(resolve => {
      let child, timer, buffer = '', lines = 0, ready = false, committed = false, settled = false;
      const operation = { stop: null };
      const cleanup = () => {
        try { child?.stdin?.destroy(); } catch { /* owned pipe only */ }
        try { child?.kill(); } catch { /* owned process only */ }
      };
      const finish = value => {
        if (settled) return;
        settled = true;
        this.cancelTimer(timer);
        buffer = ''; // Do not retain or log raw native output.
        if (this.operation === operation) this.operation = null;
        cleanup();
        resolve(value);
      };
      // Once go may have reached native, every failure is deliberately uncertain.
      const fail = code => finish(result(code, !committed));
      operation.stop = () => fail('shortcut_voice_cancelled');
      this.operation = operation;
      try {
        child = this.spawnChild('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', SCRIPT,
          '-Mode', 'Invoke', '-ExpiresAt', String(deadline), '-ExpectedExe', this.expectedExe, '-Shortcut', canonical, ...(bageshuoCrossAppEnabled ? ['-BageshuoCrossAppEnabled'] : [])],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: this.env });
      } catch { fail('shortcut_voice_start_failed'); return; }
      if (settled) { cleanup(); return; }
      // Poll context while compilation/UIA runs, without waiting for native ready or the full deadline.
      const watch = () => {
        if (settled) return;
        if (!current() || this.disposed || this.operation !== operation) return fail('shortcut_voice_cancelled');
        if (settled) return;
        if (this.now() >= deadline) return fail('shortcut_voice_timeout');
        timer = this.schedule(watch, Math.max(1, Math.min(50, deadline - this.now())));
      };
      timer = this.schedule(watch, Math.max(1, Math.min(50, deadline - this.now())));
      child.once('error', () => fail('shortcut_voice_start_failed'));
      child.once('close', () => fail('shortcut_voice_native_failed'));
      child.stdin.on('error', () => fail('shortcut_voice_native_failed'));
      child.stdout.on('error', () => fail('shortcut_voice_native_failed'));
      child.stdout.on('data', chunk => {
        if (settled) return;
        buffer += Buffer.from(chunk).toString('utf8');
        if (buffer.length > 1024) return fail('shortcut_voice_protocol_error');
        let end;
        while (!settled && (end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).replace(/\r$/, '');
          buffer = buffer.slice(end + 1);
          if (++lines > 2 || line.length > 256 || !line) return fail('shortcut_voice_protocol_error');
          let item;
          try { item = JSON.parse(line); } catch { return fail('shortcut_voice_protocol_error'); }
          if (!item || typeof item !== 'object' || Array.isArray(item)) return fail('shortcut_voice_protocol_error');
          const keys = Object.keys(item);
          if (keys.length === 1 && item.type === 'ready' && !ready) {
            ready = true;
            if (!current()) return fail('shortcut_voice_cancelled');
            if (this.now() >= deadline) return fail('shortcut_voice_expired');
            if (settled || this.operation !== operation || this.disposed) return fail('shortcut_voice_cancelled');
            committed = true;
            // Fixed authorization only: never accept arbitrary bytes/keys over this pipe.
            try { child.stdin.write('go\n'); } catch { return fail('shortcut_voice_native_failed'); }
          } else if (keys.length === 2 && keys.includes('activated') && keys.includes('error') && typeof item.activated === 'boolean') {
            if (item.activated === true && item.error === null && ready && committed) {
              if (!current() || this.disposed || this.operation !== operation) return fail('shortcut_voice_cancelled');
              if (settled) return;
              finish({ activated: true, error: null });
            } else if (item.activated === false && NATIVE_ERRORS.has(item.error)) finish(result(item.error, !committed));
            else return fail('shortcut_voice_protocol_error');
          } else return fail('shortcut_voice_protocol_error');
        }
      });
    });
  }

  cancel() { this.operation?.stop(); }
  dispose() { if (this.disposed) return; this.disposed = true; this.cancel(); }
}
