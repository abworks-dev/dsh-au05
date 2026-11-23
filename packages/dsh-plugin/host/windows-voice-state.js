import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../native/windows-voice-state.ps1', import.meta.url));
const ERRORS = new Set(['unsupported_platform', 'observer_start_failed', 'capture_unknown']);

/** Read-only observer. No microphone stream, key injection or automatic restart. */
export class WindowsVoiceStateObserver {
  #value = { state: 'unknown', error: null, level: 0 };
  #op = null;
  #disposed = false;
  constructor({ spawnChild = spawn, platform = process.platform, now = Date.now,
    schedule = setTimeout, cancelTimer = clearTimeout, onChange = () => {} } = {}) {
    Object.assign(this, { spawnChild, platform, now, schedule, cancelTimer, onChange });
  }
  #publish(state, error = null, level = 0) {
    const next = { state, error, level };
    if (JSON.stringify(next) === JSON.stringify(this.#value)) return;
    this.#value = next;
    try { this.onChange({ ...next }); } catch { /* Consumer isolation. */ }
  }
  snapshot() {
    if (this.#op && this.now() >= this.#op.deadline) this.#fail(this.#op, 'observer_timeout');
    return { ...this.#value };
  }
  start() {
    if (this.#disposed || this.#op || this.#value.state === 'error') return this.snapshot();
    if (this.platform !== 'win32') { this.#publish('error', 'unsupported_platform'); return this.snapshot(); }
    const op = { live: true, child: null, buffer: '', timer: null, killTimer: null, closed: false,
      deadline: this.now() + 10000 };
    this.#op = op;
    try {
      const child = this.spawnChild('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', SCRIPT,
        '-Mode', 'Observe'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      op.child = child;
      child.on('error', () => this.#fail(op, 'observer_start_failed'));
      child.on('close', () => {
        op.closed = true;
        if (op.killTimer !== null) this.cancelTimer(op.killTimer);
        this.#fail(op, op.buffer ? 'observer_protocol_error' : 'observer_exit');
      });
      child.stdin.on('error', () => this.#fail(op, 'observer_exit'));
      child.stdout.on('error', () => this.#fail(op, 'observer_protocol_error'));
      child.stdout.on('data', data => this.#data(op, data));
      this.#arm(op);
    } catch { this.#fail(op, 'observer_start_failed'); }
    return this.snapshot();
  }
  #arm(op) {
    if (op.timer !== null) this.cancelTimer(op.timer);
    op.timer = this.schedule(() => {
      op.timer = null;
      if (!op.live) return;
      if (this.now() >= op.deadline) this.#fail(op, 'observer_timeout');
      else this.#arm(op);
    }, Math.max(1, op.deadline - this.now()));
    op.timer?.unref?.();
  }
  #data(op, data) {
    if (!op.live || this.#op !== op) return;
    if (this.now() >= op.deadline) return this.#fail(op, 'observer_timeout');
    try { op.buffer += Buffer.from(data).toString('utf8'); }
    catch { return this.#fail(op, 'observer_protocol_error'); }
    if (op.buffer.length > 4096) return this.#fail(op, 'observer_protocol_error');
    let end;
    while (op.live && (end = op.buffer.indexOf('\n')) !== -1) {
      const line = op.buffer.slice(0, end).replace(/\r$/, '');
      op.buffer = op.buffer.slice(end + 1);
      if (!line || line.length > 256) return this.#fail(op, 'observer_protocol_error');
      let row;
      try { row = JSON.parse(line); } catch { return this.#fail(op, 'observer_protocol_error'); }
      if (!row || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'error,level,state' ||
          !['idle', 'recording', 'unknown', 'error'].includes(row.state) ||
          typeof row.level !== 'number' || !Number.isFinite(row.level) || row.level < 0 || row.level > 1 ||
          (row.state !== 'recording' && row.level !== 0) ||
          !(row.error === null || ERRORS.has(row.error)) ||
          (row.state === 'error' ? row.error === null :
            row.state === 'unknown' ? row.error !== null && row.error !== 'capture_unknown' : row.error !== null)) {
        return this.#fail(op, 'observer_protocol_error');
      }
      if (row.state === 'error') return this.#fail(op, row.error);
      op.deadline = this.now() + 2000;
      this.#arm(op);
      this.#publish(row.state, row.error, row.level);
    }
    if (op.live && op.buffer.length > 256) this.#fail(op, 'observer_protocol_error');
  }
  #retire(op) {
    op.live = false;
    if (op.timer !== null) this.cancelTimer(op.timer);
    op.buffer = '';
    if (!op.child || op.closed) return;
    try { op.child.stdin.end(); } catch { /* bounded shutdown */ }
    if (op.closed) return;
    op.killTimer = this.schedule(() => {
      op.killTimer = null;
      if (!op.closed) { try { op.child.kill(); } catch { /* Owned child only. */ } }
    }, 750);
    op.killTimer?.unref?.();
  }
  #fail(op, error) {
    if (!op.live || this.#op !== op) return;
    this.#op = null;
    this.#retire(op);
    this.#publish('error', error);
  }
  stop() {
    const op = this.#op;
    this.#op = null;
    if (op) this.#retire(op);
    this.#publish('unknown');
    return this.snapshot();
  }
  dispose() { if (!this.#disposed) { this.#disposed = true; this.stop(); } }
}
