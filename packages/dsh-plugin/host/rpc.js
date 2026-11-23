import { DeviceController, parseLightReadback, parseSnapshotDiagnostics, NATIVE_WHEEL_ERRORS } from './device-controller.js';
import { normalizeShortcut } from './shortcut-voice.js';
import { k1LampCapability } from './k1-lamp.js';

const PACKAGE = '@abworks/dsh-plugin-au05';
const LIGHTS = ['idle', 'running', 'approval', 'attention', 'recording'];
const EVENTS = ['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up', 'knob.down', 'knob.up', 'right.pulse', 'left.pulse'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function object(value, keys, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))
    || required.some(key => !own(value, key))) throw new TypeError('invalid_request');
  return value;
}
function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('invalid_request');
  return value;
}
function boolean(value) {
  if (typeof value !== 'boolean') throw new TypeError('invalid_request');
  return value;
}
function choice(value, choices) {
  if (!choices.includes(value)) throw new TypeError('invalid_request');
  return value;
}
export function owner(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new TypeError('invalid_request');
  return value;
}
export function connectOptions(value) {
  object(value, ['lights']);
  return { lights: own(value, 'lights') ? boolean(value.lights) : true };
}
export function pollOptions(value) {
  object(value, ['after', 'context', 'light', 'channels', 'lights', 'windowsVoice', 'shortcutVoice', 'bageshuoState', 'brightness', 'windowsVoiceState', 'experimentalK1Lamp', 'nativeScroll', 'keyFeedback', 'bageshuoCrossAppEnabled', 'bageshuoCrossAppContext']);
  const result = {
    after: own(value, 'after') ? integer(value.after) : 0,
    context: own(value, 'context') && value.context !== null ? owner(value.context) : null,
    light: own(value, 'light') ? choice(value.light, LIGHTS) : 'idle',
  };
  if (own(value, 'brightness')) {
    if (!Number.isInteger(value.brightness) || value.brightness < 0 || value.brightness > 255) throw new TypeError('invalid_request');
    result.brightness = value.brightness;
  }
  // Optional UI feedback switch: false asks the controller to write all lamps off.
  if (own(value, 'lights')) result.lights = boolean(value.lights);
  result.nativeScroll = own(value, 'nativeScroll') ? boolean(value.nativeScroll) : false;
  result.bageshuoCrossAppEnabled = own(value, 'bageshuoCrossAppEnabled') ? boolean(value.bageshuoCrossAppEnabled) : false;
  result.bageshuoCrossAppContext = own(value, 'bageshuoCrossAppContext') && value.bageshuoCrossAppContext !== null ? owner(value.bageshuoCrossAppContext) : null;
  // Re-evaluate each poll so an older Client cannot leave native key feedback armed.
  result.keyFeedback = own(value, 'keyFeedback') ? boolean(value.keyFeedback) : false;
  if (own(value, 'windowsVoice')) result.windowsVoice = boolean(value.windowsVoice);
  if (own(value, 'shortcutVoice')) result.shortcutVoice = boolean(value.shortcutVoice);
  if (own(value, 'windowsVoiceState')) result.windowsVoiceState = boolean(value.windowsVoiceState);
  if (own(value, 'experimentalK1Lamp')) result.experimentalK1Lamp = boolean(value.experimentalK1Lamp);
  if (own(value, 'bageshuoState')) result.bageshuoState = boolean(value.bageshuoState);
  if (result.windowsVoice && result.shortcutVoice) throw new TypeError('invalid_request');
  if (own(value, 'channels')) {
    if (!Array.isArray(value.channels) || value.channels.length !== 4
      || Reflect.ownKeys(value.channels).length !== 5
      || ![0, 1, 2, 3].every(index => own(value.channels, index)
        && Number.isInteger(value.channels[index]) && value.channels[index] >= 0 && value.channels[index] <= 2)) throw new TypeError('invalid_request');
    result.channels = [...value.channels];
  }
  return result;
}
function code(value) {
  if (typeof value !== 'string' || !/^[a-z_]{1,40}$/.test(value)) throw new TypeError('invalid_result');
  return value;
}
export function bageshuoSnapshot(value) {
  object(value, ['state', 'error'], ['state', 'error']);
  const state = choice(value.state, ['stopped', 'starting', 'idle', 'recording', 'unknown', 'error']);
  const error = value.error === null ? null : choice(value.error, ['unsupported_platform', 'app_not_running', 'app_ambiguous', 'identity_changed', 'target_exited', 'observer_start_failed', 'observer_protocol_error', 'observer_exit', 'observer_timeout', 'observer_start_timeout', 'observer_recovering', 'capture_unknown']);
  if (['stopped', 'starting', 'idle', 'recording'].includes(state) && error !== null || ['unknown', 'error'].includes(state) && error === null
    || error === 'observer_recovering' && state !== 'unknown') throw new TypeError('invalid_result');
  return { state, error };
}
export function windowsVoiceStateSnapshot(value) {
  object(value, ['state', 'error', 'level'], ['state', 'error', 'level']);
  const state = choice(value.state, ['stopped', 'starting', 'idle', 'recording', 'unknown', 'error']);
  const error = value.error === null ? null : code(value.error);
  if (typeof value.level !== 'number' || !Number.isFinite(value.level) || value.level < 0 || value.level > 1
    || (state !== 'recording' && value.level !== 0) || (['stopped', 'starting', 'idle', 'recording'].includes(state) && error !== null)) throw new TypeError('invalid_result');
  return { state, error, level: value.level };
}
function snapshot(value, withEvents = false) {
  const keys = ['state', 'generation', 'sequence', 'lightsEnabled', 'lightState', 'lightResult', 'error', 'connected', 'stopping'];
  const allowed = [...keys, 'lightError', 'k1Lamp', 'lightTrace', 'snapshotDiagnostics', 'bageshuo', 'windowsVoiceState'];
  object(value, withEvents ? [...allowed, 'overflow', 'events', 'shortcutOutcome', 'shortcutRecovery'] : allowed, withEvents ? [...keys, 'overflow', 'events'] : keys);
  const result = {
    state: code(value.state), generation: integer(value.generation), sequence: integer(value.sequence),
    lightsEnabled: boolean(value.lightsEnabled), lightState: choice(value.lightState, LIGHTS),
    lightResult: choice(value.lightResult, ['not_requested', 'written', 'failed', 'readback_unsupported', 'verified', 'mismatch', 'preserved', 'restored', 'restore_written', 'restore_mismatch']),
    error: value.error === null ? null : code(value.error), connected: boolean(value.connected), stopping: boolean(value.stopping),
  };
  if (own(value, 'windowsVoiceState')) result.windowsVoiceState = windowsVoiceStateSnapshot(value.windowsVoiceState);
  if (own(value, 'bageshuo')) result.bageshuo = bageshuoSnapshot(value.bageshuo);
  if (own(value, 'snapshotDiagnostics')) result.snapshotDiagnostics = parseSnapshotDiagnostics(value.snapshotDiagnostics);
  if (own(value, 'lightError')) result.lightError = value.lightError === null ? null : choice(value.lightError, ['snapshot_unavailable']);
  if (own(value, 'k1Lamp')) {
    const expected = k1LampCapability();
    object(value.k1Lamp, Object.keys(expected), Object.keys(expected));
    if (Object.entries(expected).some(([key, field]) => value.k1Lamp[key] !== field)) throw new TypeError('invalid_result');
    result.k1Lamp = expected;
  }
  if (own(value, 'lightTrace')) {
    const trace = value.lightTrace;
    if (!Array.isArray(trace) || trace.length > 32 || Reflect.ownKeys(trace).length !== trace.length + 1
      || !Array.from({ length: trace.length }, (_, index) => own(trace, index)).every(Boolean)) throw new TypeError('invalid_result');
    result.lightTrace = trace.map(item => {
      const required = ['at', 'type', 'requestId', 'state', 'channels', 'result'];
      object(item, [...required, 'reason', 'readback', 'brightness'], required);
      const type = choice(item.type, ['request', 'result']);
      const requestId = integer(item.requestId);
      if (requestId === 0) throw new TypeError('invalid_result');
      const channels = pollOptions({ channels: item.channels }).channels;
      const entry = { at: integer(item.at), type, requestId, state: choice(item.state, LIGHTS), channels,
        result: choice(item.result, type === 'request' ? ['pending'] : ['verified', 'written', 'mismatch', 'failed', 'preserved', 'restored', 'restore_written', 'restore_mismatch']) };
      if (own(item, 'brightness')) {
        if (!Number.isInteger(item.brightness) || item.brightness < 0 || item.brightness > 255) throw new TypeError('invalid_result');
        entry.brightness = item.brightness;
      }
      if (own(item, 'reason')) {
        if (type !== 'result' || item.result !== 'failed') throw new TypeError('invalid_result');
        entry.reason = choice(item.reason, ['snapshot_unavailable']);
      }
      if (own(item, 'readback')) {
        if (type !== 'result') throw new TypeError('invalid_result');
        // Shared closed codec also deep-copies optional fixed header-kind counters.
        entry.readback = parseLightReadback(item.readback);
      }
      return entry;
    });
  }
  if (withEvents) {
    if (own(value, 'shortcutRecovery')) {
      if (value.shortcutRecovery !== true) throw new TypeError('invalid_result');
      result.shortcutRecovery = true;
    }
    if (own(value, 'shortcutOutcome')) {
      const outcome = value.shortcutOutcome;
      object(outcome, ['generation', 'sequence', 'notSent'], ['generation', 'sequence', 'notSent']);
      const generation = integer(outcome.generation), sequence = integer(outcome.sequence);
      if (outcome.notSent !== true || generation !== result.generation || sequence === 0 || sequence > result.sequence) throw new TypeError('invalid_result');
      result.shortcutOutcome = { generation, sequence, notSent: true };
    }
    boolean(value.overflow);
    if (!Array.isArray(value.events) || value.events.length > 256) throw new TypeError('invalid_result');
    result.overflow = value.overflow;
    result.events = value.events.map(event => {
      object(event, ['sequence', 'generation', 'event', 'context', 'at'], ['sequence', 'generation', 'event', 'context', 'at']);
      return { sequence: integer(event.sequence), generation: integer(event.generation), event: choice(event.event, EVENTS),
        context: event.context === null ? null : owner(event.context), at: integer(event.at) };
    });
  }
  return result;
}
export { snapshot as parseDeviceSnapshot };
// The installed Gateway's strict codec contract is create().parse(value).
// These closed parsers avoid shipping or reaching into an unofficial SDK.
function codec(name, parse) {
  return { mode: 'strict', typeSymbol: `${PACKAGE}#${name}`, create: () => ({ parse }) };
}
const OWNER = codec('Owner', owner);
const CONNECT = codec('ConnectOptions', connectOptions);
const POLL = codec('PollOptions', pollOptions);
const SNAPSHOT = codec('Snapshot', value => snapshot(value));
const POLLED = codec('PollSnapshot', value => snapshot(value, true));
const WINDOWS_ERRORS = ['unsupported_platform', 'unsupported_client', 'invalid_request', 'expired', 'cancelled', 'busy', 'disposed', 'start_failed', 'timeout', 'protocol_error', 'native_failed', 'foreground_mismatch', 'focus_not_editable', 'modifiers_down', 'input_failed', 'invalid_gesture', 'not_enabled'].map(item => `windows_voice_${item}`);
export function voiceGesture(value) {
  object(value, ['generation', 'sequence', 'context'], ['generation', 'sequence', 'context']);
  return { generation: integer(value.generation), sequence: integer(value.sequence), context: owner(value.context) };
}
export function windowsVoiceResult(value) {
  object(value, ['activated', 'error'], ['activated', 'error']);
  const activated = boolean(value.activated);
  if (activated ? value.error !== null : !WINDOWS_ERRORS.includes(value.error)) throw new TypeError('invalid_result');
  return { activated, error: value.error };
}
const SHORTCUT_ERRORS = [...WINDOWS_ERRORS.map(value => value.replace('windows_voice_', 'shortcut_voice_')), 'shortcut_voice_invalid_shortcut'];
export function shortcutOptions(value) {
  object(value, ['shortcut'], ['shortcut']);
  return { shortcut: normalizeShortcut(value.shortcut) };
}
export function shortcutVoiceResult(value) {
  object(value, ['activated', 'error', 'notSent'], ['activated', 'error']);
  const activated = boolean(value.activated);
  if (activated ? value.error !== null : !SHORTCUT_ERRORS.includes(value.error)) throw new TypeError('invalid_result');
  if (own(value, 'notSent') && (activated || value.notSent !== true)) throw new TypeError('invalid_result');
  return { activated, error: value.error, ...(own(value, 'notSent') ? { notSent: true } : {}) };
}
export function nativeScrollResult(value) {
  object(value, ['scrolled', 'error'], ['scrolled', 'error']);
  const scrolled = boolean(value.scrolled);
  if (scrolled ? value.error !== null : !NATIVE_WHEEL_ERRORS.includes(value.error)) throw new TypeError('invalid_result');
  return { scrolled, error: value.error };
}
const NATIVE_SCROLL_RESULT = codec('NativeScrollResult', nativeScrollResult);
const SHORTCUT_OPTIONS = codec('ShortcutOptions', shortcutOptions);
const SHORTCUT_RESULT = codec('ShortcutVoiceResult', shortcutVoiceResult);
const GESTURE = codec('VoiceGesture', voiceGesture);
const WINDOWS_RESULT = codec('WindowsVoiceResult', windowsVoiceResult);
function parameter(name, value) { return { name, wire: name, source: 'json', codec: value }; }
function method(name, parameters, result) {
  return { id: `${PACKAGE}#au05/${name}`, service: 'au05', namespace: 'au05', method: name,
    invocation: { kind: 'direct' }, parameters, result };
}
export const descriptors = [
  method('connect', [parameter('owner', OWNER), parameter('options', CONNECT)], SNAPSHOT),
  method('poll', [parameter('owner', OWNER), parameter('options', POLL)], POLLED),
  method('disconnect', [parameter('owner', OWNER)], SNAPSHOT),
  method('status', [], SNAPSHOT),
  method('nativeScroll', [parameter('owner', OWNER), parameter('gesture', GESTURE)], NATIVE_SCROLL_RESULT),
  method('windowsVoice', [parameter('owner', OWNER), parameter('gesture', GESTURE)], WINDOWS_RESULT),
  method('shortcutVoice', [parameter('owner', OWNER), parameter('gesture', GESTURE), parameter('options', SHORTCUT_OPTIONS)], SHORTCUT_RESULT),
];

/** Register the real Host service, without starting any device until connect(). */
export function mountAu05Host(ctx, { TypertRemoteService, Controller = DeviceController }) {
  const controller = new Controller();
  class Au05Service extends TypertRemoteService {
    constructor() { super(ctx, 'au05'); }
    requireOwner() {
      if (this.ctx.invocation?.peer.principal.kind !== 'owner') throw new Error('owner_client_required');
    }
    connect(clientOwner, options) {
      this.requireOwner();
      return snapshot(controller.connect(owner(clientOwner), connectOptions(options)));
    }
    poll(clientOwner, options) {
      this.requireOwner();
      return snapshot(controller.poll(owner(clientOwner), pollOptions(options)), true);
    }
    disconnect(clientOwner) {
      this.requireOwner();
      return snapshot(controller.stop(owner(clientOwner)));
    }
    status() { this.requireOwner(); return snapshot(controller.snapshot()); }
    async nativeScroll(clientOwner, gesture) {
      this.requireOwner();
      return nativeScrollResult(await controller.nativeScroll(owner(clientOwner), voiceGesture(gesture), { signal: this.ctx.invocation?.signal }));
    }
    async windowsVoice(clientOwner, gesture) {
      this.requireOwner();
      return windowsVoiceResult(await controller.windowsVoice(owner(clientOwner), voiceGesture(gesture), { signal: this.ctx.invocation?.signal }));
    }
    async shortcutVoice(clientOwner, gesture, options) {
      this.requireOwner();
      return shortcutVoiceResult(await controller.shortcutVoice(owner(clientOwner), voiceGesture(gesture), shortcutOptions(options), { signal: this.ctx.invocation?.signal }));
    }
  }
  let release;
  const disposeController = ctx.effect(() => () => controller.dispose());
  try {
    new Au05Service();
    release = ctx.typert.register({ package: PACKAGE, face: 'host', model: {}, schemas: [], invocations: descriptors });
  } catch (error) {
    disposeController();
    throw error;
  }
  return async () => {
    await release();
    await disposeController();
  };
}
