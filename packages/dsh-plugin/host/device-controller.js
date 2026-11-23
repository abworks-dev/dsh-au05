import { EventEmitter } from 'node:events';
import { k1LampCapability } from './k1-lamp.js';
import { createModeLease } from './mode-lease.js';
import { spawn } from 'node:child_process';
import { normalizeShortcut } from './shortcut-voice.js';
import { createPlatformAdapters } from './adapters/platform.js';
import { au05DeviceAdapter } from './adapters/au05.js';

export const NATIVE_WHEEL_ERRORS = ['pointer_mismatch', 'unsupported_client', 'start_timeout', 'not_ready', 'queue_full', 'unsupported_platform', 'invalid_request', 'expired', 'cancelled', 'busy', 'disposed', 'start_failed', 'timeout', 'protocol_error', 'native_failed', 'foreground_mismatch', 'modifiers_down', 'input_failed', 'invalid_gesture', 'not_enabled'].map(code => `native_wheel_${code}`);

const FAILURES = new Set(['no_device', 'ambiguous_device', 'access_denied', 'disconnected', 'io_error', 'protocol_error', 'unsupported_caps', 'device_unverified', 'write_failed', 'stopped', 'physical_receiver_unverified', 'metadata_failed', 'open_failed', 'caps_changed', 'input_failed', 'stdin_failed', 'command_invalid', 'command_limit', 'command_rate_limited', 'lights_disabled', 'auto_restore_failed', 'compile_or_runtime_failed']);
const identity = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
const READBACK_COUNTS = ['readsWhilePending', 'shortReads', 'outerRejected', 'nonMatchingHeader', 'modeRejected'];
const READBACK_SMALL = ['matched', 'timedOut', 'getWritesCompleted'];
const HEADER_KINDS = ['lightingNoRelay', 'lightingGroupFlags', 'lightingOtherOperation', 'dongle', 'notice', 'otherDevice', 'other'];
export function parseLightReadback(value) {
  const keys = ['stage', 'attempts', ...READBACK_COUNTS, ...READBACK_SMALL];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length + (Object.hasOwn(value, 'headerKinds') ? 1 : 0) + (Object.hasOwn(value, 'comparison') ? 1 : 0)
    || !keys.every(key => Object.hasOwn(value, key))
    || !['initial', 'post_write'].includes(value.stage)
    || !Number.isInteger(value.attempts) || value.attempts < 1 || value.attempts > 3
    || !READBACK_COUNTS.every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 65535)
    || (value.stage === 'post_write' && value.attempts !== 1)
    || !READBACK_SMALL.every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= value.attempts)) throw new TypeError('invalid_result');
  const result = Object.fromEntries(keys.map(key => [key, value[key]]));
  if (Object.hasOwn(value, 'headerKinds')) {
    const kinds = value.headerKinds;
    if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(kinds))
      || Reflect.ownKeys(kinds).length !== HEADER_KINDS.length
      || !HEADER_KINDS.every(key => Object.hasOwn(kinds, key) && Number.isInteger(kinds[key]) && kinds[key] >= 0 && kinds[key] <= 65535)) throw new TypeError('invalid_result');
    result.headerKinds = Object.fromEntries(HEADER_KINDS.map(key => [key, kinds[key]]));
  }
  if (Object.hasOwn(value, 'comparison')) {
    const closed = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
      && [Object.prototype, null].includes(Object.getPrototypeOf(object))
      && Reflect.ownKeys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
    const comparison = value.comparison;
    if (value.stage !== 'post_write' || value.matched !== 1 || !closed(comparison, ['expected', 'observed'])) throw new TypeError('invalid_result');
    result.comparison = {};
    for (const key of ['expected', 'observed']) {
      const record = comparison[key], lights = record?.lights;
      if (!closed(record, ['mode', 'lights']) || !Number.isInteger(record.mode) || record.mode < 0 || record.mode > 2
        || (key === 'expected' && record.mode !== 2)
        || !Array.isArray(lights) || lights.length !== 20 || Reflect.ownKeys(lights).length !== 21
        || !Array.from({ length: 20 }, (_, index) => Object.hasOwn(lights, index) && Number.isInteger(lights[index])
          && lights[index] >= 0 && lights[index] <= (index % 5 === 0 ? 2 : 255)).every(Boolean)) throw new TypeError('invalid_result');
      result.comparison[key] = { mode: record.mode, lights: [...lights] };
    }
  }
  return result;
}

export function parseSnapshotDiagnostics(value) {
  const keys = ['attempt', 'outcome', 'auth', 'link', 'timedOut', 'rejected'];
  const statuses = ['not_sent', 'matched', 'cancelled', 'reply_timeout', 'write_timeout', 'write_failed', 'linked_false'];
  if (!Array.isArray(value) || value.length > 3 || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('invalid_result');
  return Array.from(value, (item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))
      || Reflect.ownKeys(item).length !== keys.length || !keys.every(key => Object.hasOwn(item, key))
      || item.attempt !== index + 1 || !['auth_unconfirmed', 'link_not_ready', 'timeout', 'reply_rejected', 'matched'].includes(item.outcome)
      || !statuses.includes(item.auth) || !statuses.includes(item.link)
      || !Number.isInteger(item.timedOut) || item.timedOut < 0 || item.timedOut > 1
      || !Number.isInteger(item.rejected) || item.rejected < 0 || item.rejected > 327675) throw new TypeError('invalid_result');
    return Object.fromEntries(keys.map(key => [key, item[key]]));
  });
}

/** One plugin-owned device process. A Client connect request opens HID; no HTTP or Host background reconnect. */
export class DeviceController extends EventEmitter {
  constructor({ spawnChild = spawn, platform = process.platform, now = Date.now, leaseMs = 30000, schedule = setTimeout, cancel = clearTimeout, windowsVoiceBridge = null, shortcutVoiceBridge = null, nativeWheelBridge = null, bageshuoStateObserver = null, windowsVoiceStateObserver = null, modeLease = createModeLease('direct'), platformServices = null, deviceAdapter = au05DeviceAdapter } = {}) {
    super();
    Object.assign(this, { spawnChild, platform, now, leaseMs, schedule, cancel, modeLease, deviceAdapter });
    const adapters = platformServices ?? createPlatformAdapters({ platform, now, schedule, cancel });
    this.nativeWheelBridge = nativeWheelBridge ?? adapters.createNativeWheelBridge();
    this.nativeScrollEnabled = false; this.nativeWheelTickets = new Map();
    this.windowsVoiceBridge = windowsVoiceBridge ?? adapters.createWindowsVoiceBridge();
    this.shortcutVoiceBridge = shortcutVoiceBridge ?? adapters.createShortcutVoiceBridge();
    this.bageshuoCrossAppEnabled = false; this.bageshuoCrossAppContext = null; this.bageshuoTransition = null;
    this.bageshuoStateEnabled = false;
    this.bageshuoObserver = bageshuoStateObserver ?? adapters.createBageshuoStateObserver(() => {
        // Cross-app feedback follows verified capture, never shortcut delivery.
        if (this.bageshuoCrossAppEnabled) this.applyBageshuoState();
        // Scoped mode only revokes; the focused Client controls its opt-in.
        if (this.bageshuoStateEnabled && this.bageshuoObserver.snapshot().state !== 'recording' && this.lightChannels[0] === 2) {
          this.lightChannels[0] = 0; this.lightResult = 'not_requested';
          if (this.state === 'ready' && !this.stopping) this.requestLights();
        }
        this.changed();
      });
    this.windowsVoiceStateEnabled = false;
    this.windowsVoiceObserver = windowsVoiceStateObserver ?? adapters.createWindowsVoiceStateObserver(() => {
        if (this.windowsVoiceStateEnabled) this.applyWindowsVoiceState();
        this.changed();
      });
    this.windowsVoiceEnabled = false; this.shortcutVoiceEnabled = false; this.voiceTicket = null; this.k1Held = false;
    this.shortcutOutcome = null; this.shortcutDispatchedSequence = 0;
    this.owner = null; this.child = null; this.events = []; this.generation = 0; this.disposed = false; this.stopping = false;
    this.state = 'disconnected'; this.lightState = 'idle'; this.lightChannels = [0, 0, 0, 0]; this.lightBrightness = undefined; this.lightResult = 'not_requested'; this.lightError = null; this.context = null;
    this.sequence = 0; this.error = null; this.lightsEnabled = false; this.keyFeedback = false; this.lightRequestId = 0; this.lightTrace = []; this.snapshotDiagnostics = []; this.lastLightRequest = null;
  }
  snapshot() {
    return { state: this.state, generation: this.generation, sequence: this.sequence,
      lightsEnabled: this.lightsEnabled, lightState: this.lightState, lightResult: this.lightResult,
      snapshotDiagnostics: parseSnapshotDiagnostics(this.snapshotDiagnostics), lightError: this.lightError, k1Lamp: k1LampCapability('direct'),
      ...(this.windowsVoiceStateEnabled ? { windowsVoiceState: this.windowsVoiceObserver.snapshot() } : {}),
      ...(this.bageshuoStateEnabled ? { bageshuo: this.bageshuoObserver.snapshot() } : {}),
      lightTrace: this.lightTrace.map(item => ({ ...item, channels: [...item.channels], ...(item.readback ? { readback: parseLightReadback(item.readback) } : {}) })),
      error: this.error, connected: this.state === 'ready' && !this.stopping, stopping: this.stopping === true };
  }
  changed() { this.emit('change', this.snapshot()); }
  owns(owner) { return !this.disposed && identity(owner) && this.owner === owner; }
  heartbeat(owner) {
    if (!this.owns(owner)) return false;
    if (this.stopping) return true;
    this.cancel(this.leaseTimer);
    const generation = this.generation;
    this.leaseTimer = this.schedule(() => { if (generation === this.generation) this.stop(owner, 'client_gone'); }, this.leaseMs);
    this.leaseTimer?.unref?.();
    return true;
  }
  connect(owner, { lights = true } = {}) {
    if (this.disposed || !identity(owner) || typeof lights !== 'boolean') throw new Error('invalid_request');
    if (this.owner && this.owner !== owner) throw new Error('device_busy');
    if (this.child) { if (this.stopping) throw new Error('device_stopping'); this.heartbeat(owner); return this.snapshot(); }
    if (this.platform !== 'win32') { this.state = 'unsupported_platform'; this.error = this.state; this.changed(); return this.snapshot(); }
    if (!this.modeLease.acquire()) { this.state = 'mode_conflict'; this.error = 'mode_conflict'; this.changed(); return this.snapshot(); }
    this.cancelNativeScroll(); this.cancelExternalVoice(); this.k1Held = false;
    this.lightTrace = []; this.snapshotDiagnostics = []; this.lastLightRequest = null; this.keyFeedback = false;
    this.shortcutOutcome = null; this.shortcutDispatchedSequence = 0;
    this.owner = owner; this.generation++; this.sequence = 0; this.events = []; this.context = null; this.stopping = false;
    this.state = 'connecting'; this.error = null; this.lightState = 'idle'; this.lightChannels = [0, 0, 0, 0]; this.lightBrightness = undefined; this.lightResult = 'not_requested'; this.lightError = null; this.lightsEnabled = lights;
    const generation = this.generation;
    let child;
    try {
      const launch = this.deviceAdapter.createLaunchSpec();
      // Active input needs online/heartbeat to suppress native shortcut duplication. The lamp toggle controls feedback, not USB permission.
      child = this.spawnChild(launch.command, launch.args, launch.options);
    } catch { this.modeLease.release(); this.owner = null; this.state = 'start_failed'; this.error = this.state; this.changed(); return this.snapshot(); }
    this.child = child;
    let buffer = '', lineCount = 0, ready = false, lastSequence = 0;
    const current = () => !this.disposed && !this.stopping && this.child === child && this.generation === generation;
    const fail = code => {
      if (!current()) return;
      this.state = code; this.error = code; this.stop(owner, code);
    };
    child.stdout.on('data', chunk => {
      if (!current()) return;
      buffer += Buffer.from(chunk).toString('utf8');
      if (buffer.length > 65536) return fail('protocol_error');
      let newline;
      while (current() && (newline = buffer.indexOf('\n')) >= 0) {
        const text = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        if (!text || Buffer.byteLength(text, 'utf8') > 2048) return fail('protocol_error');
        let item;
        try { item = JSON.parse(text); } catch { return fail('protocol_error'); }
        if (!item || typeof item !== 'object' || Array.isArray(item)) return fail('protocol_error');
        if (++lineCount > 2000) return fail('protocol_error');
        if (item.type === 'status' && Object.keys(item).every(key => ['type', 'state'].includes(key))) {
          if (item.state === 'ready' && !ready) {
            ready = true; this.cancel(this.startTimer); this.state = 'ready'; this.error = null; this.changed();
            this.requestLights();
          } else if (FAILURES.has(item.state)) return fail(item.state);
          else return fail('protocol_error');
        } else if (item.type === 'input' && ready && this.deviceAdapter.profile.acceptsInput(item.event)
          && Object.keys(item).every(key => ['type', 'event', 'sequence'].includes(key))
          && Number.isSafeInteger(item.sequence) && item.sequence > lastSequence) {
          lastSequence = item.sequence; this.sequence++;
          const event = { sequence: this.sequence, generation, event: item.event, context: this.bageshuoCrossAppEnabled && ['k1.down', 'k1.up'].includes(item.event) ? this.bageshuoCrossAppContext : this.context, at: this.now() };
          // Only an actual fresh native K1 press creates a single-use voice ticket.
          // Release does not invalidate a click before the next browser poll arrives.
          if (item.event === 'k1.down') {
            if (!this.k1Held) {
              this.cancelExternalVoice(false);
              const kind = this.windowsVoiceEnabled ? 'windows' : this.shortcutVoiceEnabled ? 'shortcut' : null;
              if (kind && event.context !== null) this.voiceTicket = { ...event, kind, crossApp: this.bageshuoCrossAppEnabled, consumed: false };
            }
            this.k1Held = true;
          } else if (item.event === 'k1.up') this.k1Held = false;
          if (this.nativeScrollEnabled && this.context !== null && ['right.pulse', 'left.pulse'].includes(item.event)) {
            for (const [key, ticket] of this.nativeWheelTickets) if (event.at - ticket.at >= 500) this.nativeWheelTickets.delete(key);
            this.nativeWheelTickets.set(event.sequence, { ...event, direction: item.event === 'right.pulse' ? 'down' : 'up', consumed: false });
            if (this.nativeWheelTickets.size > 256) this.nativeWheelTickets.delete(this.nativeWheelTickets.keys().next().value);
          }
          this.events.push(event); if (this.events.length > 256) this.events.shift();
          this.emit('input', event);
        } else if (item.type === 'lights' && ready && this.deviceAdapter.profile.acceptsFeedback(item.state)
          && ['verified', 'written', 'mismatch', 'failed', 'preserved', 'restored', 'restore_written', 'restore_mismatch'].includes(item.result)
          && Number.isSafeInteger(item.requestId) && item.requestId > 0 && item.requestId <= this.lightRequestId
          && (!Object.hasOwn(item, 'reason') || (item.result === 'failed' && item.reason === 'snapshot_unavailable'))
          && Object.keys(item).every(key => ['type', 'state', 'result', 'requestId', 'reason', 'readback', 'snapshotDiagnostics'].includes(key))) {
          let readback;
          if (Object.hasOwn(item, 'readback')) {
            try { readback = parseLightReadback(item.readback); } catch { return fail('protocol_error'); }
          }
          if (Object.hasOwn(item, 'snapshotDiagnostics')) {
            try { this.snapshotDiagnostics = parseSnapshotDiagnostics(item.snapshotDiagnostics); } catch { return fail('protocol_error'); }
          }
          // Old state/channel acknowledgements must not confirm a newer requested vector.
          if (item.requestId !== this.lightRequestId) continue;
          if (item.state !== this.lightState) return fail('protocol_error');
          this.traceLight({ at: this.now(), type: 'result', requestId: item.requestId, state: item.state,
            channels: [...this.lastLightRequest.channels], ...(this.lastLightRequest.brightness === undefined ? {} : { brightness: this.lastLightRequest.brightness }), result: item.result, ...(item.reason ? { reason: item.reason } : {}),
            ...(readback ? { readback } : {}) });
          this.lightResult = item.result; this.lightError = item.reason ?? null; this.changed();
        } else return fail('protocol_error');
      }
    });
    this.rateTimer = setInterval(() => { lineCount = 0; }, 1000); this.rateTimer.unref();
    child.stdout.on('error', () => fail('io_error'));
    child.stdin.on('error', () => fail('io_error'));
    child.once('error', () => fail('start_failed'));
    child.once('close', () => {
      this.cancel(this.forceTimer); this.cancel(this.startTimer); clearInterval(this.rateTimer);
      if (this.child !== child) return;
      this.cancelNativeScroll(); this.cancelExternalVoice(); this.k1Held = false;
      this.shortcutOutcome = null; this.shortcutDispatchedSequence = 0;
      this.child = null; this.owner = null; this.context = null; this.stopping = false; this.keyFeedback = false; this.cancel(this.leaseTimer);
      this.modeLease.release();
      if (this.state === 'ready' || this.state === 'connecting') { this.state = 'disconnected'; this.error = 'disconnected'; }
      this.changed();
    });
    this.startTimer = this.schedule(() => fail('start_timeout'), 15000); this.startTimer?.unref?.();
    this.heartbeat(owner); this.changed();
    return this.snapshot();
  }
  send(command) {
    if (!this.child || this.child.stdin.destroyed || !this.child.stdin.writable) return false;
    try { return this.child.stdin.write(JSON.stringify(command) + '\n'); } catch { return false; }
  }
  traceLight(item) {
    this.lightTrace.push(item);
    if (this.lightTrace.length > 32) this.lightTrace.shift();
  }
  requestLights() {
    if (this.lightRequestId >= Number.MAX_SAFE_INTEGER) { this.stop(this.owner, 'protocol_error'); return; }
    const requestId = ++this.lightRequestId;
    const channels = this.lightsEnabled ? [...this.lightChannels] : [0, 0, 0, 0];
    const brightness = this.lightBrightness === undefined ? {} : { brightness: this.lightBrightness };
    this.lastLightRequest = { requestId, channels: [...channels], ...brightness };
    this.traceLight({ at: this.now(), type: 'request', requestId, state: this.lightState, channels: [...channels], ...brightness, result: 'pending' });
    // Native observes physical K2/K3 downs; this only grants optional feedback, never an action or success signal.
    // A zero vector means all-off while enabled. Only an explicit opt-out releases ownership.
    if (!this.send({ type: 'lights', state: this.lightState, channels, requestId, ...brightness,
      ...(!this.lightsEnabled ? { release: true } : {}),
      ...(this.lightsEnabled && this.keyFeedback && !this.stopping ? { keyFeedback: true } : {}) })) this.lightResult = 'failed';
  }
  windowsVoiceChannel() {
    const value = this.windowsVoiceObserver.snapshot();
    if (!this.windowsVoiceStateEnabled || value.state !== 'recording' || value.error !== null) return 0;
    // Capture state alone drives the lamp; peak changes never modulate hardware.
    return 2;
  }
  applyWindowsVoiceState() {
    const channel = this.windowsVoiceChannel();
    if (this.lightChannels[0] !== channel) {
      this.lightChannels[0] = channel; this.lightResult = 'not_requested';
      if (this.state === 'ready' && !this.stopping) this.requestLights();
    }
  }
  bageshuoKnown() {
    const value = this.bageshuoObserver.snapshot();
    return this.bageshuoStateEnabled && value.error === null && ['idle', 'recording'].includes(value.state);
  }
  applyBageshuoState() {
    const value = this.bageshuoObserver.snapshot();
    if (this.bageshuoTransition !== null && value.error === null && ['idle', 'recording'].includes(value.state) && value.state !== this.bageshuoTransition) this.bageshuoTransition = null;
    const channel = this.bageshuoStateEnabled && value.state === 'recording' && value.error === null ? 2 : 0;
    if (this.lightChannels[0] !== channel) {
      this.lightChannels[0] = channel; this.lightResult = 'not_requested';
      if (this.state === 'ready' && !this.stopping) this.requestLights();
    }
  }
  poll(owner, { after = 0, context = null, light = 'idle', channels = this.deviceAdapter.profile.defaultChannels(light), brightness, lights = this.lightsEnabled, keyFeedback = false, windowsVoice = false, shortcutVoice = false, nativeScroll = false, bageshuoState = false, windowsVoiceState = false, experimentalK1Lamp = false, bageshuoCrossAppEnabled = false, bageshuoCrossAppContext = null } = {}) {
    if (!Number.isSafeInteger(after) || after < 0 || !(context === null || identity(context)) || !this.deviceAdapter.profile.acceptsFeedback(light)
      || (brightness !== undefined && (!Number.isInteger(brightness) || brightness < 0 || brightness > 255))
      || !this.deviceAdapter.profile.validatesChannels(channels) || typeof lights !== 'boolean' || typeof keyFeedback !== 'boolean' || typeof windowsVoice !== 'boolean'
      || typeof nativeScroll !== 'boolean' || typeof windowsVoiceState !== 'boolean' || typeof experimentalK1Lamp !== 'boolean'
      || typeof bageshuoCrossAppEnabled !== 'boolean' || !(bageshuoCrossAppContext === null || identity(bageshuoCrossAppContext))
      || typeof shortcutVoice !== 'boolean' || typeof bageshuoState !== 'boolean' || (windowsVoice && shortcutVoice)) throw new Error('invalid_request');
    if (!this.heartbeat(owner)) throw new Error('not_owner');
    const events = this.events.filter(item => item.sequence > after).map(item => ({ ...item }));
    const overflow = after < this.sequence - this.events.length;
    const enableNative = !this.stopping && this.state === 'ready' && context !== null && nativeScroll;
    if (this.context !== context || this.nativeScrollEnabled !== enableNative) {
      this.cancelNativeScroll();
      this.nativeScrollEnabled = enableNative;
      if (enableNative) { try { Promise.resolve(this.nativeWheelBridge.start()).catch(() => {}); } catch {} }
    }
    const crossApp = !this.stopping && this.state === 'ready' && bageshuoCrossAppEnabled && bageshuoCrossAppContext !== null && shortcutVoice && bageshuoState;
    if (!this.stopping) {
      if (this.bageshuoCrossAppEnabled !== crossApp || this.bageshuoCrossAppContext !== (crossApp ? bageshuoCrossAppContext : null)) {
        this.cancelExternalVoice(false); this.bageshuoTransition = null;
      } else if ((!crossApp && this.context !== context) || this.windowsVoiceEnabled !== windowsVoice || this.shortcutVoiceEnabled !== shortcutVoice) this.cancelExternalVoice(false);
      this.bageshuoCrossAppEnabled = crossApp; this.bageshuoCrossAppContext = crossApp ? bageshuoCrossAppContext : null;
      this.context = context; this.windowsVoiceEnabled = windowsVoice; this.shortcutVoiceEnabled = shortcutVoice;
    }
    const observeBageshuo = !this.stopping && this.state === 'ready' && bageshuoState && shortcutVoice;
    if (observeBageshuo !== this.bageshuoStateEnabled) {
      this.bageshuoStateEnabled = observeBageshuo;
      if (observeBageshuo) this.bageshuoObserver.start(); else this.bageshuoObserver.stop();
    }
    const observeWindows = !this.stopping && this.state === 'ready' && windowsVoice && windowsVoiceState && lights && experimentalK1Lamp && context !== null;
    const previouslyObservedWindows = this.windowsVoiceStateEnabled;
    if (observeWindows !== this.windowsVoiceStateEnabled) {
      this.windowsVoiceStateEnabled = observeWindows;
      if (observeWindows) this.windowsVoiceObserver.start(); else this.windowsVoiceObserver.stop();
    }
    channels = [...channels];
    if (windowsVoice || observeWindows || previouslyObservedWindows) channels[0] = observeWindows ? this.windowsVoiceChannel() : 0;
    if (observeBageshuo && this.bageshuoObserver.snapshot().state !== 'recording') channels[0] = 0;
    if (crossApp) {
      const value = this.bageshuoObserver.snapshot();
      if (this.bageshuoTransition !== null && value.error === null && ['idle', 'recording'].includes(value.state) && value.state !== this.bageshuoTransition) this.bageshuoTransition = null;
      channels[0] = value.state === 'recording' && value.error === null ? 2 : 0;
    }
    keyFeedback = !this.stopping && keyFeedback;
    const changed = brightness !== this.lightBrightness || light !== this.lightState || channels.some((value, index) => value !== this.lightChannels[index])
      || lights !== this.lightsEnabled || keyFeedback !== this.keyFeedback;
    this.lightBrightness = brightness; this.lightState = light; this.lightChannels = [...channels]; this.lightsEnabled = lights; this.keyFeedback = keyFeedback;
    if (changed) {
      this.lightResult = 'not_requested'; this.lightError = null;
      if (this.state === 'ready' && !this.stopping) this.requestLights();
    }
    // Owner-only poll acknowledgement survives context cancellation, never connection changes.
    const outcome = this.shortcutOutcome;
    return { ...this.snapshot(), overflow, events, shortcutRecovery: true,
      ...(outcome && outcome.owner === owner && outcome.generation === this.generation && !this.stopping
        ? { shortcutOutcome: { generation: outcome.generation, sequence: outcome.sequence, notSent: true } } : {}) };
  }
  cancelNativeScroll() {
    this.nativeScrollEnabled = false;
    this.nativeWheelTickets.clear();
    this.nativeWheelBridge.cancel();
  }
  async nativeScroll(owner, gesture, { signal } = {}) {
    const rejected = error => ({ scrolled: false, error: `native_wheel_${error}` });
    if (!this.owns(owner) || this.state !== 'ready' || this.stopping || !this.child || !this.nativeScrollEnabled) return rejected('not_enabled');
    const plain = gesture && typeof gesture === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(gesture));
    const ticket = plain && this.nativeWheelTickets.get(gesture.sequence);
    if (!plain || Reflect.ownKeys(gesture).length !== 3 || !['generation', 'sequence', 'context'].every(key => Object.hasOwn(gesture, key))
      || !ticket || ticket.consumed || gesture.generation !== ticket.generation || gesture.generation !== this.generation
      || gesture.context !== ticket.context || ticket.context !== this.context || this.context === null) return rejected('invalid_gesture');
    const expiresAt = ticket.at + 500;
    if (this.now() < ticket.at || this.now() >= expiresAt) return rejected('expired');
    if (signal?.aborted) return rejected('cancelled');
    ticket.consumed = true;
    const child = this.child;
    const isCurrent = () => !signal?.aborted && this.owns(owner) && !this.stopping && this.state === 'ready'
      && this.nativeScrollEnabled && this.child === child && this.nativeWheelTickets.get(ticket.sequence) === ticket
      && ticket.generation === this.generation && ticket.context === this.context && this.now() >= ticket.at && this.now() < expiresAt;
    const abort = () => { this.nativeWheelTickets.delete(ticket.sequence); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      // A previous uncertain send may have closed the helper. A NEW physical
      // ticket can warm a fresh helper, but is itself dropped, never replayed.
      // Polling alone must not re-arm input after a failure.
      if (this.nativeWheelBridge.state === 'stopped') {
        Promise.resolve(this.nativeWheelBridge.start()).catch(() => {});
        return rejected('not_ready');
      }
      const result = await this.nativeWheelBridge.dispatch({ direction: ticket.direction, expiresAt, isCurrent });
      if (result?.scrolled === true && result.error === null) return isCurrent() ? { scrolled: true, error: null } : rejected('cancelled');
      return { scrolled: false, error: NATIVE_WHEEL_ERRORS.includes(result?.error) ? result.error : 'native_wheel_native_failed' };
    } catch { return rejected('native_failed'); }
    finally { signal?.removeEventListener('abort', abort); this.nativeWheelTickets.delete(ticket.sequence); }
  }
  cancelExternalVoice(disable = true) {
    this.voiceTicket = null;
    if (disable) {
      this.bageshuoCrossAppEnabled = false; this.bageshuoCrossAppContext = null; this.bageshuoTransition = null;
      this.windowsVoiceEnabled = false; this.shortcutVoiceEnabled = false;
      this.bageshuoStateEnabled = false; this.bageshuoObserver.stop();
      this.windowsVoiceStateEnabled = false; this.windowsVoiceObserver.stop();
    }
    this.windowsVoiceBridge.cancel(); this.shortcutVoiceBridge.cancel();
  }
  windowsVoice(owner, gesture, { signal } = {}) {
    return this.triggerVoice('windows', owner, gesture, { signal });
  }
  shortcutVoice(owner, gesture, { shortcut } = {}, { signal } = {}) {
    try { shortcut = normalizeShortcut(shortcut); }
    catch { return this.triggerVoice('shortcut', owner, gesture, { signal, invalidShortcut: true }); }
    return this.triggerVoice('shortcut', owner, gesture, { signal, shortcut });
  }
  async triggerVoice(kind, owner, gesture, { signal, shortcut, invalidShortcut = false } = {}) {
    const generation = this.generation, child = this.child, sequence = gesture?.sequence;
    const unsentGesture = this.owns(owner) && !this.stopping && child && gesture?.generation === generation
      && Number.isSafeInteger(sequence) && sequence > this.shortcutDispatchedSequence && sequence <= this.sequence;
    const rejected = (error, notSent = unsentGesture) => ({ activated: false, error: `${kind}_voice_${error}`,
      ...(kind === 'shortcut' && notSent ? { notSent: true } : {}) });
    const enabled = () => kind === 'windows' ? this.windowsVoiceEnabled : this.shortcutVoiceEnabled;
    const completed = value => {
      if (kind === 'shortcut' && value?.activated === false && value.notSent === true
        && this.owns(owner) && !this.stopping && child && this.child === child && this.generation === generation
        && gesture?.generation === generation && Number.isSafeInteger(sequence) && sequence > 0 && sequence <= this.sequence
        && (!this.shortcutOutcome || this.shortcutOutcome.sequence <= sequence)) {
        this.shortcutOutcome = { owner, generation, sequence, notSent: true };
      }
      return value;
    };
    if (invalidShortcut) return completed(rejected('invalid_shortcut'));
    if (!this.owns(owner) || this.state !== 'ready' || this.stopping || !enabled()) return completed(rejected('not_enabled'));
    const ticket = this.voiceTicket;
    if (!gesture || Object.keys(gesture).length !== 3 || !ticket || ticket.consumed || ticket.kind !== kind
      || (kind === 'shortcut' && !unsentGesture)
      || gesture.generation !== this.generation || gesture.generation !== ticket.generation
      || gesture.sequence !== ticket.sequence || gesture.context !== ticket.context
      || ticket.context !== (ticket.crossApp ? this.bageshuoCrossAppContext : this.context)
      || !!ticket.crossApp !== this.bageshuoCrossAppEnabled)
      return completed(rejected('invalid_gesture'));
    if (this.now() < ticket.at || this.now() - ticket.at > 1000) return completed(rejected('expired'));
    if (ticket.crossApp && (shortcut !== 'RightAlt' || !this.bageshuoKnown() || this.bageshuoTransition !== null)) return completed(rejected('not_enabled'));
    if (signal?.aborted) return completed(rejected('cancelled'));
    ticket.consumed = true;
    if (kind === 'shortcut') this.shortcutDispatchedSequence = sequence;
    if (ticket.crossApp) {
      this.bageshuoTransition = this.bageshuoObserver.snapshot().state;
      this.bageshuoTransitionTicket = ticket;
    }
    const expiresAt = ticket.at + 5000;
    const isCurrent = () => !signal?.aborted && this.owns(owner) && !this.stopping && this.state === 'ready'
      && enabled() && this.voiceTicket === ticket && ticket.generation === this.generation
      && ticket.context === (ticket.crossApp ? this.bageshuoCrossAppContext : this.context)
      && (!ticket.crossApp || this.bageshuoCrossAppEnabled && this.bageshuoKnown()) && this.now() >= ticket.at && this.now() <= expiresAt;
    const abort = () => { if (this.voiceTicket === ticket) this.cancelExternalVoice(false); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      // Fixed Host-owned helper rechecks focus/executable at commit; shortcut mode accepts only validated tap chords.
      const value = completed(kind === 'windows' ? await this.windowsVoiceBridge.open({ isCurrent, expiresAt })
        : await this.shortcutVoiceBridge.open({ shortcut, isCurrent, expiresAt, bageshuoCrossAppEnabled: ticket.crossApp === true }));
      if (ticket.crossApp && value?.notSent === true && this.bageshuoTransitionTicket === ticket) this.bageshuoTransition = null;
      return value;
    } catch { return rejected('native_failed', false); }
    finally { signal?.removeEventListener('abort', abort); }
  }
  stop(owner, reason = 'disconnected') {
    if (!this.owns(owner) || this.stopping) return this.snapshot();
    this.cancelNativeScroll(); this.cancelExternalVoice(); this.k1Held = false; this.shortcutOutcome = null; this.keyFeedback = false;
    this.stopping = true; this.cancel(this.leaseTimer); this.cancel(this.startTimer); clearInterval(this.rateTimer); this.context = null;
    this.state = reason; this.events = []; this.changed();
    const child = this.child;
    if (!child) { this.modeLease.release(); this.owner = null; this.stopping = false; return this.snapshot(); }
    this.send({ type: 'stop' }); child.stdin.end();
    this.forceTimer = this.schedule(() => { if (this.child === child) child.kill(); }, 6000); this.forceTimer?.unref?.();
    return this.snapshot();
  }
  dispose() {
    if (this.disposed) return;
    if (this.owner) this.stop(this.owner, 'stopped');
    this.cancelNativeScroll(); this.nativeWheelBridge.dispose(); this.cancelExternalVoice(); this.windowsVoiceBridge.dispose(); this.shortcutVoiceBridge.dispose(); this.bageshuoObserver.dispose(); this.windowsVoiceObserver.dispose();
    this.disposed = true; this.removeAllListeners();
  }
}
