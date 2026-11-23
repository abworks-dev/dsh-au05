import { StudioInputRuntime } from './input-runtime.js';
import { parseStudioInputBindings } from './input.js';
import { parseDeviceSnapshot, connectOptions, pollOptions, voiceGesture, shortcutOptions,
  windowsVoiceResult, shortcutVoiceResult } from '@abworks/dsh-plugin-au05/protocol';
const PACKAGE = '@abworks/dsh-studio-hook';
const codec = (name, parse) => ({ mode: 'strict', typeSymbol: `${PACKAGE}#${name}`, create: () => ({ parse }) });
const arg = (name, type) => ({ name, wire: name, source: 'json', codec: type });
const token = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new TypeError('invalid_feature_owner');
  return value;
};
export function parseProjection(value) {
  const keys = ['sessionId', 'key', 'observedAt', 'revision', 'answerable'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key)) || value.answerable !== true
    || ['sessionId', 'key'].some(key => typeof value[key] !== 'string' || !value[key] || value[key].length > 256)
    || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0
    || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new TypeError('invalid_approval_projection');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
export function parseCandidates(value) {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError('invalid_input_candidates');
  return value.map(binding => parseStudioInputBindings([binding])[0]);
}
export function parsePairing(value) {
  const keys = ['version', 'endpoint', 'origin', 'pluginUuid', 'expiresInMs', 'leaseToken', 'eventToken', 'bindingToken'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key)) || value.version !== 1
    || typeof value.endpoint !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value.endpoint)
    || Number(value.endpoint.split(':').at(-1)) > 65535
    || value.origin !== 'dsh-studio-input://com.abworks.ulanzistudio.dshinput'
    || value.pluginUuid !== 'com.abworks.ulanzistudio.dshinput'
    || !Number.isSafeInteger(value.expiresInMs) || value.expiresInMs < 0 || value.expiresInMs > 8000
    || new Set([value.leaseToken, value.eventToken, value.bindingToken]).size !== 3
    || ['leaseToken', 'eventToken', 'bindingToken'].some(key => typeof value[key] !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value[key]))) throw new TypeError('invalid_input_pairing');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
const OWNER = codec('FeatureOwner', token), OPTIONS = codec('InputOptions', connectOptions), POLL = codec('InputPoll', pollOptions);
const SNAPSHOT = codec('InputSnapshot', value => parseDeviceSnapshot(value)), POLLED = codec('InputPolled', value => parseDeviceSnapshot(value, true));
const GESTURE = codec('InputGesture', voiceGesture), SHORTCUT = codec('InputShortcut', shortcutOptions);
export function featureDescriptors(runtimeResult) {
  return [
    ['approval', [arg('owner', OWNER), arg('projection', codec('ApprovalProjection', parseProjection))], runtimeResult],
    ['inputConnect', [arg('owner', OWNER), arg('inputOwner', OWNER), arg('options', OPTIONS)], SNAPSHOT],
    ['inputPoll', [arg('owner', OWNER), arg('inputOwner', OWNER), arg('options', POLL)], POLLED],
    ['inputDisconnect', [arg('owner', OWNER), arg('inputOwner', OWNER)], SNAPSHOT],
    ['inputPairing', [arg('owner', OWNER), arg('inputOwner', OWNER)], codec('InputPairing', parsePairing)],
    ['inputCandidates', [arg('owner', OWNER), arg('inputOwner', OWNER)], codec('InputCandidates', parseCandidates)],
    ['inputConfigure', [arg('owner', OWNER), arg('inputOwner', OWNER), arg('bindings', codec('InputBindings', parseStudioInputBindings))], SNAPSHOT],
    ['inputWindowsVoice', [arg('owner', OWNER), arg('inputOwner', OWNER), arg('gesture', GESTURE)], codec('InputWindowsVoice', windowsVoiceResult)],
    ['inputShortcutVoice', [arg('owner', OWNER), arg('inputOwner', OWNER), arg('gesture', GESTURE), arg('options', SHORTCUT)], codec('InputShortcutVoice', shortcutVoiceResult)],
  ].map(([method, parameters, result]) => ({ id: `${PACKAGE}#studioRuntime/${method}`, service: 'studioRuntime', namespace: 'studioRuntime', method,
    invocation: { kind: 'direct' }, parameters, result }));
}
export function createInputService(runtime, { InputRuntime = StudioInputRuntime } = {}) {
  let input = null;
  const requireInput = () => { if (!input) throw new Error('studio_input_not_started'); return input; };
  return {
    async connect(owner, inputOwner, options) {
      token(owner); token(inputOwner); connectOptions(options);
      if (!runtime.owns(owner)) throw new Error('runtime_owner_mismatch');
      if (!input) input = new InputRuntime({ isCurrent: candidate => runtime.owns(candidate) });
      return parseDeviceSnapshot(await input.connect(owner, inputOwner));
    },
    poll(owner, inputOwner, options) { return parseDeviceSnapshot(requireInput().poll(token(owner), token(inputOwner), pollOptions(options)), true); },
    async disconnect(owner, inputOwner) { return parseDeviceSnapshot(await requireInput().disconnect(token(owner), token(inputOwner))); },
    pairing(owner, inputOwner) { return parsePairing(requireInput().pairing(token(owner), token(inputOwner))); },
    candidates(owner, inputOwner) { return parseCandidates(requireInput().bindings(token(owner), token(inputOwner))); },
    configure(owner, inputOwner, bindings) { return parseDeviceSnapshot(requireInput().configure(token(owner), token(inputOwner), parseStudioInputBindings(bindings))); },
    async windowsVoice(owner, inputOwner, gesture, signal) {
      return windowsVoiceResult(await requireInput().trigger('windows', token(owner), token(inputOwner), voiceGesture(gesture), { signal }));
    },
    async shortcutVoice(owner, inputOwner, gesture, options, signal) {
      return shortcutVoiceResult(await requireInput().trigger('shortcut', token(owner), token(inputOwner), voiceGesture(gesture), { ...shortcutOptions(options), signal }));
    },
    dispose() { const old = input; input = null; if (old) void old.dispose().catch(() => {}); },
  };
}
