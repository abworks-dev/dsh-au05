import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../native/windows-voice.ps1', import.meta.url));
const NATIVE_ERRORS = new Set(['windows_voice_expired', 'windows_voice_cancelled', 'windows_voice_invalid_request',
  'windows_voice_unsupported_platform', 'windows_voice_unsupported_client', 'windows_voice_foreground_mismatch',
  'windows_voice_focus_not_editable', 'windows_voice_modifiers_down', 'windows_voice_input_failed', 'windows_voice_native_failed']);
const result = error => ({ activated: false, error });

/** Host-owned, single-use Win+H bridge. Never pass client-provided paths or commands to this constructor. */
export class WindowsVoiceBridge {
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

  async open({ isCurrent, expiresAt } = {}) {
    if (this.disposed) return result('windows_voice_disposed');
    if (this.platform !== 'win32') return result('windows_voice_unsupported_platform');
    if (this.operation) return result('windows_voice_busy');
    if (typeof isCurrent !== 'function' || !Number.isSafeInteger(expiresAt)) return result('windows_voice_invalid_request');
    if (!this.expectedExe || !win32.isAbsolute(this.expectedExe) || !/^[a-z]:\\/i.test(this.expectedExe)) return result('windows_voice_unsupported_client');
    const current = () => { try { return isCurrent() === true; } catch { return false; } };
    if (!current() || this.disposed) return result('windows_voice_cancelled');
    const deadline = Math.min(expiresAt, this.now() + this.timeoutMs);
    if (deadline <= this.now()) return result('windows_voice_expired');

    return new Promise(resolve => {
      let child, timer, buffer = '', lines = 0, ready = false, committed = false, settled = false;
      const operation = { stop: null };
      const finish = value => {
        if (settled) return;
        settled = true;
        this.cancelTimer(timer);
        buffer = ''; // Raw native output is never retained or logged.
        if (this.operation === operation) this.operation = null;
        try { child?.stdin?.destroy(); } catch { /* best effort */ }
        try { child?.kill(); } catch { /* only this owned child */ }
        resolve(value);
      };
      operation.stop = () => finish(result('windows_voice_cancelled'));
      this.operation = operation;
      try {
        child = this.spawnChild('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', SCRIPT,
          '-Mode', 'Invoke', '-ExpiresAt', String(deadline), '-ExpectedExe', this.expectedExe],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: this.env });
      } catch { finish(result('windows_voice_start_failed')); return; }
      // Native may block in UI Automation: the host deadline still terminates the owned process.
      timer = this.schedule(() => finish(result('windows_voice_timeout')), Math.max(1, deadline - this.now()));
      const fail = code => finish(result(code));
      child.once('error', () => fail('windows_voice_start_failed'));
      child.once('close', () => fail('windows_voice_native_failed'));
      child.stdin.on('error', () => fail('windows_voice_native_failed'));
      child.stdout.on('error', () => fail('windows_voice_native_failed'));
      child.stdout.on('data', chunk => {
        if (settled) return;
        buffer += Buffer.from(chunk).toString('utf8');
        if (buffer.length > 1024) return fail('windows_voice_protocol_error');
        let end;
        while (!settled && (end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).replace(/\r$/, '');
          buffer = buffer.slice(end + 1);
          if (++lines > 2 || line.length > 256 || !line) return fail('windows_voice_protocol_error');
          let item;
          try { item = JSON.parse(line); } catch { return fail('windows_voice_protocol_error'); }
          if (!item || typeof item !== 'object' || Array.isArray(item)) return fail('windows_voice_protocol_error');
          const keys = Object.keys(item);
          if (keys.length === 1 && item.type === 'ready' && !ready) {
            ready = true;
            if (!current()) return fail('windows_voice_cancelled');
            if (this.now() >= deadline) return fail('windows_voice_expired');
            if (settled || this.operation !== operation || this.disposed) return fail('windows_voice_cancelled');
            // Commit exactly once. Never add a payload/keypress API to this pipe.
            committed = true;
            try { child.stdin.write('go\n'); } catch { return fail('windows_voice_native_failed'); }
          } else if (keys.length === 2 && keys.includes('activated') && keys.includes('error') && typeof item.activated === 'boolean') {
            if (item.activated === true && item.error === null && ready && committed) {
              if (!current()) return fail('windows_voice_cancelled');
              finish({ activated: true, error: null });
            } else if (item.activated === false && NATIVE_ERRORS.has(item.error)) finish(result(item.error));
            else return fail('windows_voice_protocol_error');
          } else return fail('windows_voice_protocol_error');
        }
      });
    });
  }

  cancel() { this.operation?.stop(); }
  dispose() { if (this.disposed) return; this.disposed = true; this.cancel(); }
}
