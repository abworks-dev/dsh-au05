import { randomUUID } from 'node:crypto';
import { WindowsVoiceBridge } from '@abworks/dsh-plugin-au05/windows-voice';
import { ShortcutVoiceBridge, normalizeShortcut } from '@abworks/dsh-plugin-au05/shortcut-voice';
import { createStudioInputBridge } from './input.js';

const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
// Studio action INSTANCE IDs are discovered from this plugin's own callbacks.
// Manifest action UUIDs must never be substituted for those IDs.

/** Leased input transport and single-use voice tickets. Never opens HID or answers DSH approvals. */
export class StudioInputRuntime {
  constructor({ isCurrent, Bridge = createStudioInputBridge, now = Date.now,
    windowsVoiceBridge, shortcutVoiceBridge } = {}) {
    if (typeof isCurrent !== 'function') throw new Error('invalid_input_runtime');
    Object.assign(this, { isCurrent, Bridge, now });
    this.windows = windowsVoiceBridge ?? new WindowsVoiceBridge({ now });
    this.shortcut = shortcutVoiceBridge ?? new ShortcutVoiceBridge({ now });
    this.generation = 0; this.sequence = 0; this.owner = null; this.runOwner = null; this.bridge = null;
    this.context = null; this.ticket = null; this.held = false; this.windowsEnabled = false; this.shortcutEnabled = false;
    this.disposed = false; this.state = 'disconnected';
  }
  current() {
    try { return !this.disposed && this.bridge !== null && this.isCurrent(this.runOwner) === true; } catch { return false; }
  }
  require(runOwner, owner) {
    if (owner !== this.owner || runOwner !== this.runOwner || !this.current()) throw new Error('studio_input_owner_mismatch');
  }
  cancelVoice() { this.ticket = null; this.windows.cancel(); this.shortcut.cancel(); }
  onEvent(event) {
    if (!this.current() || event.generation !== this.generation) return;
    this.sequence = Math.max(this.sequence, event.sequence);
    if (event.event === 'k1.up') { this.held = false; return; }
    if (event.event !== 'k1.down' || this.held) return;
    this.held = true; this.cancelVoice();
    const kind = this.windowsEnabled ? 'windows' : this.shortcutEnabled ? 'shortcut' : null;
    if (kind && this.context !== null && event.context === this.context) this.ticket = { ...event, kind, consumed: false };
  }
  snapshot() {
    return { state: this.state, connected: this.state === 'ready' && this.current(), stopping: false,
      generation: this.generation, sequence: this.sequence, lightsEnabled: false, lightState: 'idle',
      lightResult: 'not_requested', error: null };
  }
  async connect(runOwner, owner) {
    if (this.disposed || !identity(runOwner) || !identity(owner) || !this.isCurrent(runOwner)) throw new Error('studio_runtime_required');
    if (this.bridge) { this.require(runOwner, owner); return this.snapshot(); }
    this.runOwner = runOwner; this.owner = owner; this.generation++; this.sequence = 0;
    this.state = 'connecting'; this.context = null; this.held = false; this.cancelVoice();
    const bridge = this.Bridge({ now: this.now, canRun: () => this.current(), onEvent: event => this.onEvent(event) });
    this.bridge = bridge;
    try {
      await bridge.start({ owner, sessionNonce: randomUUID(), generation: this.generation, epoch: this.generation,
        bindings: [], leaseMs: 8000 });
      if (this.bridge !== bridge || !this.current()) { await bridge.stop(owner); throw new Error('studio_input_cancelled'); }
      this.state = 'ready'; return this.snapshot();
    } catch (error) {
      if (this.bridge === bridge) { this.bridge = null; this.state = 'disconnected'; }
      try { await bridge.stop(owner); } catch {}
      throw error;
    }
  }
  poll(runOwner, owner, options) {
    this.require(runOwner, owner);
    if (this.context !== options.context || this.windowsEnabled !== options.windowsVoice || this.shortcutEnabled !== options.shortcutVoice) this.cancelVoice();
    this.context = options.context; this.windowsEnabled = options.windowsVoice === true; this.shortcutEnabled = options.shortcutVoice === true;
    const value = this.bridge.poll(owner, { context: this.context });
    this.sequence = Math.max(this.sequence, value.sequence);
    return { ...this.snapshot(), overflow: value.overflow, events: value.events.map(event => ({
      event: event.event, generation: event.generation, sequence: event.sequence, context: event.context, at: event.at,
    })) };
  }
  pairing(runOwner, owner) { this.require(runOwner, owner); return this.bridge.pairing(owner); }
  bindings(runOwner, owner) { this.require(runOwner, owner); return this.bridge.bindings(owner); }
  configure(runOwner, owner, bindings) {
    this.require(runOwner, owner); this.bridge.configure(owner, bindings);
    this.cancelVoice(); this.context = null; this.held = false;
    return this.snapshot();
  }
  async trigger(kind, runOwner, owner, gesture, { signal, shortcut } = {}) {
    const fail = code => ({ activated: false, error: `${kind}_voice_${code}` });
    try { this.require(runOwner, owner); } catch { return fail('not_enabled'); }
    const enabled = () => kind === 'windows' ? this.windowsEnabled : this.shortcutEnabled;
    if (!enabled()) return fail('not_enabled');
    if (kind === 'shortcut') { try { shortcut = normalizeShortcut(shortcut); } catch { return fail('invalid_shortcut'); } }
    const ticket = this.ticket;
    if (!ticket || ticket.consumed || ticket.kind !== kind || gesture.generation !== this.generation
      || gesture.sequence !== ticket.sequence || gesture.context !== ticket.context || ticket.context !== this.context) return fail('invalid_gesture');
    if (this.now() < ticket.at || this.now() - ticket.at >= 1000) return fail('expired');
    if (signal?.aborted) return fail('cancelled');
    ticket.consumed = true;
    const expiresAt = ticket.at + 5000;
    const isCurrent = () => this.current() && !signal?.aborted && this.ticket === ticket && enabled()
      && this.context === ticket.context && this.now() >= ticket.at && this.now() < expiresAt;
    const abort = () => { if (this.ticket === ticket) this.cancelVoice(); };
    signal?.addEventListener('abort', abort, { once: true });
    try { return kind === 'windows' ? await this.windows.open({ isCurrent, expiresAt }) : await this.shortcut.open({ shortcut, isCurrent, expiresAt }); }
    catch { return fail('native_failed'); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  async disconnect(runOwner, owner) {
    if (runOwner !== this.runOwner || owner !== this.owner) throw new Error('studio_input_owner_mismatch');
    this.cancelVoice(); this.context = null; this.windowsEnabled = false; this.shortcutEnabled = false; this.held = false;
    const bridge = this.bridge; this.bridge = null; this.state = 'disconnected';
    if (bridge) await bridge.stop(owner);
    return this.snapshot();
  }
  dispose() {
    this.disposed = true;
    const task = this.bridge ? this.disconnect(this.runOwner, this.owner) : Promise.resolve();
    this.windows.dispose(); this.shortcut.dispose();
    return task;
  }
}
