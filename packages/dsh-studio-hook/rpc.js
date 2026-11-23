import { createStudioVerifier } from './verifier.js';
import { createStudioRuntime } from './runtime.js';
import { createModeLease } from './mode-lease.js';
import { featureDescriptors, createInputService, parseProjection } from './feature-rpc.js';
const PACKAGE = '@abworks/dsh-studio-hook';
const states = ['idle', 'running', 'stopped', 'expired', 'binding_lost', 'error'];
const events = ['', 'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest'];
function text(value, kind) {
  if (typeof value !== 'string' || (kind === 'owner' ? !/^[A-Za-z0-9_-]{16,128}$/.test(value) : !value || value.length > 256)) throw new TypeError('invalid_verification_request');
  return value;
}
export function parseSnapshot(value) {
  const keys = ['state', 'accepted', 'completed', 'dropped', 'lastEvent', 'lastCode', 'remaining'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key)) || !states.includes(value.state) || !events.includes(value.lastEvent)
    || typeof value.lastCode !== 'string' || !/^[a-z_]{0,64}$/.test(value.lastCode)
    || ['accepted', 'completed', 'dropped', 'remaining'].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)
    || value.remaining > 120) throw new TypeError('invalid_verification_result');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
const codec = (name, parse) => ({ mode: 'strict', typeSymbol: `${PACKAGE}#${name}`, create: () => ({ parse }) });
const owner = codec('Owner', value => text(value, 'owner')), session = codec('Session', value => text(value, 'session'));
const result = codec('Snapshot', parseSnapshot);
const arg = (name, type) => ({ name, wire: name, source: 'json', codec: type });
export const descriptors = [
  ['start', [arg('sessionId', session), arg('owner', owner)]], ['poll', [arg('owner', owner)]], ['stop', [arg('owner', owner)]],
].map(([method, parameters]) => ({ id: `${PACKAGE}#studioHook/${method}`, service: 'studioHook', namespace: 'studioHook', method,
  invocation: { kind: 'direct' }, parameters, result }));
const runtimeStates = new Set(['idle', 'running', 'stopped', 'binding_lost', 'error']);
export function parseRuntimeSnapshot(value) {
  const snapshot = parseSnapshot(value);
  if (!runtimeStates.has(snapshot.state) || snapshot.remaining !== 0) throw new TypeError('invalid_runtime_result');
  return snapshot;
}
const runtimeResult = codec('RuntimeSnapshot', parseRuntimeSnapshot);
export const runtimeDescriptors = [
  ['start', [arg('sessionId', session), arg('owner', owner)]], ['poll', [arg('owner', owner)]],
  ['stop', [arg('owner', owner)]], ['status', []],
].map(([method, parameters]) => ({ id: `${PACKAGE}#studioRuntime/${method}`, service: 'studioRuntime', namespace: 'studioRuntime', method,
  invocation: { kind: 'direct' }, parameters, result: runtimeResult }));
const mountedRuntimes = new WeakSet();
export function mountStudioRuntime(ctx, { TypertRemoteService, Runtime = createStudioRuntime, canRun = () => true,
  modeLease = createModeLease('studio') }) {
  if (typeof TypertRemoteService !== 'function') throw new Error('invalid_runtime_service');
  if (mountedRuntimes.has(ctx)) throw new Error('runtime_already_mounted');
  mountedRuntimes.add(ctx);
  let runtime, inputService, cleanup, release, closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    try { inputService?.dispose(); runtime?.dispose(); } finally { modeLease.release(); mountedRuntimes.delete(ctx); }
  };
  class StudioRuntimeService extends TypertRemoteService {
    constructor() { super(ctx, 'studioRuntime'); }
    requireOwner() { if (this.ctx.invocation?.peer?.principal?.kind !== 'owner') throw new Error('owner_client_required'); }
    start(sessionId, token) {
      this.requireOwner(); text(sessionId, 'session'); text(token, 'owner');
      if (runtime.status().state === 'running') throw new Error('runtime_busy');
      if (!modeLease.acquire()) throw new Error('runtime_mode_conflict');
      try { return parseRuntimeSnapshot(runtime.start(sessionId, token)); }
      catch (error) {
        // A rejected start must not leave a newly created run behind.
        try { runtime.stop(token); } catch {}
        modeLease.release(); throw error;
      }
    }
    poll(token) { this.requireOwner(); return parseRuntimeSnapshot(runtime.poll(text(token, 'owner'))); }
    stop(token) { this.requireOwner(); return parseRuntimeSnapshot(runtime.stop(text(token, 'owner'))); }
    status() { this.requireOwner(); return parseRuntimeSnapshot(runtime.status()); }
    approval(token, projection) { this.requireOwner(); return parseRuntimeSnapshot(runtime.projectApproval(text(token, 'owner'), parseProjection(projection))); }
    inputConnect(owner, inputOwner, options) { this.requireOwner(); return inputService.connect(owner, inputOwner, options); }
    inputPoll(owner, inputOwner, options) { this.requireOwner(); return inputService.poll(owner, inputOwner, options); }
    inputDisconnect(owner, inputOwner) { this.requireOwner(); return inputService.disconnect(owner, inputOwner); }
    inputPairing(owner, inputOwner) { this.requireOwner(); return inputService.pairing(owner, inputOwner); }
    inputCandidates(owner, inputOwner) { this.requireOwner(); return inputService.candidates(owner, inputOwner); }
    inputConfigure(owner, inputOwner, bindings) { this.requireOwner(); return inputService.configure(owner, inputOwner, bindings); }
    inputWindowsVoice(owner, inputOwner, gesture) { this.requireOwner(); return inputService.windowsVoice(owner, inputOwner, gesture, this.ctx.invocation?.signal); }
    inputShortcutVoice(owner, inputOwner, gesture, options) { this.requireOwner(); return inputService.shortcutVoice(owner, inputOwner, gesture, options, this.ctx.invocation?.signal); }
  }
  try {
    runtime = Runtime({ ctx, canRun: () => !modeLease.conflict() && canRun(), onClose: () => { inputService?.dispose(); modeLease.release(); } });
    inputService = createInputService(runtime);
    cleanup = ctx.effect(() => dispose);
    new StudioRuntimeService();
    release = ctx.typert.register({ package: PACKAGE, face: 'host', model: {}, schemas: [], invocations: [...runtimeDescriptors, ...featureDescriptors(runtimeResult)] });
  } catch (error) { try { cleanup?.(); } finally { dispose(); } throw error; }
  return async () => { try { await release(); } finally { try { await cleanup?.(); } finally { dispose(); } } };
}
export function mountStudioVerifier(ctx, { TypertRemoteService, Verifier = createStudioVerifier, seconds = 120 }) {
  const verifier = Verifier({ ctx, seconds });
  class StudioHookService extends TypertRemoteService {
    constructor() { super(ctx, 'studioHook'); }
    requireOwner() { if (this.ctx.invocation?.peer.principal.kind !== 'owner') throw new Error('owner_client_required'); }
    start(sessionId, token) { this.requireOwner(); return parseSnapshot(verifier.start(text(sessionId, 'session'), text(token, 'owner'))); }
    poll(token) { this.requireOwner(); return parseSnapshot(verifier.poll(text(token, 'owner'))); }
    stop(token) { this.requireOwner(); return parseSnapshot(verifier.stop(text(token, 'owner'))); }
  }
  const cleanup = ctx.effect(() => () => verifier.dispose());
  let release;
  try { new StudioHookService(); release = ctx.typert.register({ package: PACKAGE, face: 'host', model: {}, schemas: [], invocations: descriptors }); }
  catch (error) { cleanup(); throw error; }
  return async () => { try { await release(); } finally { await cleanup(); } };
}
