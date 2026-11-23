import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../native/native-wheel.ps1', import.meta.url));
const errors = new Set(['expired', 'foreground_mismatch', 'pointer_mismatch', 'modifiers_down', 'input_failed', 'native_failed']);
const result = error => ({ scrolled: false, error: error === null ? null : `native_wheel_${error}` });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');

/** Host-owned dependencies only. start explicitly; dispatch is the sole authorization boundary.
 * No restart/retry after failure/cancel. Results after a pipe failure can be uncertain: never retry them.
 */
export class NativeWheelBridge {
  constructor({ spawnChild = spawn, platform = process.platform, now = Date.now, env = process.env,
    schedule = setTimeout, cancelTimer = clearTimeout,
    expectedExe = env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe') : null } = {}) {
    Object.assign(this, { spawnChild, platform, now, schedule, cancelTimer, expectedExe });
    this.env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE', 'LOCALAPPDATA'].filter(k => typeof env[k] === 'string').map(k => [k, env[k]]));
    this.state = 'new'; this.queue = []; this.active = null; this.id = 0; this.buffer = '';
  }
  start() {
    if (this.state === 'disposed') return Promise.resolve(result('disposed'));
    // Only an explicit start can open a new owned process after cancellation/failure.
    if (this.state === 'stopped') { this.state = 'new'; this.startPromise = null; }
    if (this.startPromise) return this.startPromise;
    if (this.state !== 'new') return Promise.resolve(result('cancelled'));
    if (this.platform !== 'win32') return Promise.resolve(result('unsupported_platform'));
    if (typeof this.expectedExe !== 'string' || !/^[a-z]:\\/i.test(this.expectedExe) || !win32.isAbsolute(this.expectedExe) || /[\r\n\0]/.test(this.expectedExe)) return Promise.resolve(result('unsupported_client'));
    this.state = 'starting';
    this.startPromise = new Promise(resolve => { this.startResolve = resolve; });
    try {
      const child = this.spawnChild('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT, '-Mode', 'Listen', '-ExpectedExe', this.expectedExe], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: this.env });
      this.child = child;
      const failed = () => { if (this.child === child) this.stop('native_failed'); };
      child.once('error', failed);
      child.once('close', failed);
      child.stdin.on('error', failed);
      child.stdout.on('error', failed);
      child.stdout.on('data', data => { if (this.child === child) this.read(data); });
      this.startTimer = this.schedule(() => this.stop('start_timeout'), 10000);
    } catch { this.stop('start_failed'); }
    return this.startPromise;
  }
  dispatch({ direction, expiresAt, isCurrent } = {}) {
    if (!['up', 'down'].includes(direction) || !Number.isSafeInteger(expiresAt) || typeof isCurrent !== 'function') return Promise.resolve(result('invalid_request'));
    if (!this.current(isCurrent)) return Promise.resolve(result('cancelled'));
    if (!['starting', 'ready'].includes(this.state)) return Promise.resolve(result(this.state === 'disposed' ? 'disposed' : 'not_ready'));
    const deadline = Math.min(expiresAt, this.now() + 500);
    if (deadline <= this.now()) return Promise.resolve(result('expired'));
    if (this.queue.length + (this.active ? 1 : 0) >= 32) return Promise.resolve(result('queue_full'));
    return new Promise(resolve => {
      this.queue.push({ direction, deadline, isCurrent, resolve, id: ++this.id });
      this.pump(); this.watch();
    });
  }
  current(fn) { try { return fn() === true; } catch { return false; } }
  watch() {
    if (this.watchTimer != null || (!this.active && !this.queue.length)) return;
    this.watchTimer = this.schedule(() => {
      this.watchTimer = null;
      // Only a sent command can have uncertain effects: revoke it by killing the pipe.
      if (this.active && !this.current(this.active.isCurrent)) return this.stop('cancelled');
      if (this.active && this.now() >= this.active.deadline) return this.stop('expired');
      this.queue = this.queue.filter(x => {
        if (!this.current(x.isCurrent)) { x.resolve(result('cancelled')); return false; }
        if (this.now() >= x.deadline) { x.resolve(result('expired')); return false; }
        return true;
      });
      this.pump(); this.watch();
    }, 10);
  }
  pump() {
    if (this.state !== 'ready' || this.active) return;
    while (this.queue.length) {
      const item = this.queue.shift();
      if (!this.current(item.isCurrent)) { item.resolve(result('cancelled')); continue; }
      if (this.now() >= item.deadline) { item.resolve(result('expired')); continue; }
      this.active = item;
      try { this.child.stdin.write(JSON.stringify({ type: 'wheel', id: item.id, direction: item.direction, deadline: item.deadline }) + '\n'); }
      catch { this.stop('native_failed'); }
      return;
    }
  }
  read(data) {
    if (!['starting', 'ready'].includes(this.state)) return;
    this.buffer += Buffer.from(data).toString('utf8');
    if (this.buffer.length > 4096) return this.stop('protocol_error');
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, ''); this.buffer = this.buffer.slice(end + 1);
      let value; try { if (line.length > 256) throw Error(); value = JSON.parse(line); } catch { return this.stop('protocol_error'); }
      if (this.state === 'starting' && exact(value, ['type']) && value.type === 'ready') {
        this.state = 'ready'; this.cancelTimer(this.startTimer); this.startResolve(result(null)); this.startResolve = null; this.pump();
      } else if (this.state === 'ready' && this.active && exact(value, ['type', 'id', 'scrolled', 'error']) && value.type === 'result' && value.id === this.active.id && ((value.scrolled === true && value.error === null) || (value.scrolled === false && errors.has(value.error)))) {
        if (!this.current(this.active.isCurrent)) return this.stop('cancelled');
        if (this.now() >= this.active.deadline) return this.stop('expired');
        const item = this.active; this.active = null; item.resolve(value.scrolled ? { scrolled: true, error: null } : result(value.error)); this.pump();
      } else return this.stop('protocol_error');
    }
  }
  stop(error) {
    if (['stopped', 'disposed'].includes(this.state)) return;
    this.state = 'stopped'; this.cancelTimer(this.startTimer); this.cancelTimer(this.watchTimer); this.watchTimer = null;
    this.startResolve?.(result(error)); this.startResolve = null;
    for (const item of [this.active, ...this.queue]) item?.resolve(result(error));
    this.active = null; this.queue = []; this.buffer = '';
    const child = this.child; this.child = null;
    try { child?.stdin?.destroy(); } catch { /* owned pipe */ }
    try { child?.kill(); } catch { /* owned child */ }
  }
  cancel() { this.stop('cancelled'); }
  dispose() { this.stop('disposed'); this.state = 'disposed'; }
}
