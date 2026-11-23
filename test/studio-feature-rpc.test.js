import test from 'node:test';
import assert from 'node:assert/strict';
import { featureDescriptors, parseProjection, parsePairing, createInputService } from '../packages/dsh-studio-hook/feature-rpc.js';
import { StudioInputRuntime } from '../packages/dsh-studio-hook/input-runtime.js';
const OWNER = 'runtime_owner_123456789', INPUT = 'input_owner_123456789', OTHER = 'other_owner_123456789';
const CONTEXT = 'context_token_123456789';
const projection = { sessionId: 'selected-session', key: 'approval:1', observedAt: 1000, revision: 1, answerable: true };
const pairing = { version: 1, endpoint: 'http://127.0.0.1:12345', origin: 'dsh-studio-input://com.abworks.ulanzistudio.dshinput',
  pluginUuid: 'com.abworks.ulanzistudio.dshinput', expiresInMs: 8000, leaseToken: 'a'.repeat(64), eventToken: 'b'.repeat(64), bindingToken: 'c'.repeat(64) };

test('approval wire projection is closed metadata and cannot contain a callback or body', () => {
  assert.deepEqual(parseProjection(projection), projection);
  for (const value of [{ ...projection, answer: () => {} }, { ...projection, content: 'secret' }, { ...projection, answerable: false },
    { ...projection, revision: 0 }, { ...projection, observedAt: -1 }, { ...projection, key: '' }, { ...projection, sessionId: '' }]) {
    assert.throws(() => parseProjection(value), /invalid_approval_projection/);
  }
});
test('pairing result is only explicit loopback configuration with strong capabilities', () => {
  assert.deepEqual(parsePairing(pairing), pairing);
  for (const value of [{ ...pairing, endpoint: 'https://example.com' }, { ...pairing, endpoint: 'http://127.0.0.1:65536' },
    { ...pairing, endpoint: 'http://127.0.0.1:12345/?token=secret' }, { ...pairing, leaseToken: 'short' },
    { ...pairing, expiresInMs: 8001 }, { ...pairing, origin: 'null' }, { ...pairing, extra: true }]) {
    assert.throws(() => parsePairing(value), /invalid_input_pairing/);
  }
});
test('new descriptor set separates approval, input, pairing and single-use external voice requests', () => {
  const result = { mode: 'strict', create: () => ({ parse: value => value }) };
  const descriptors = featureDescriptors(result);
  assert.deepEqual(descriptors.map(value => value.method), ['approval', 'inputConnect', 'inputPoll', 'inputDisconnect', 'inputPairing', 'inputCandidates', 'inputConfigure', 'inputWindowsVoice', 'inputShortcutVoice']);
  for (const descriptor of descriptors) {
    assert.equal(descriptor.namespace, 'studioRuntime'); assert.equal(descriptor.result.mode, 'strict');
    assert.equal(descriptor.parameters[0].codec.create().parse(OWNER), OWNER);
    assert.throws(() => descriptor.parameters[0].codec.create().parse('short'));
  }
});
function fixture() {
  let time = 1000, active = true, constructed = 0, emitted, bridge;
  const calls = [], windows = { cancel() { calls.push('windows.cancel'); }, dispose() {}, async open(value) { calls.push('windows.open'); return { activated: value.isCurrent(), error: null }; } };
  const shortcut = { cancel() { calls.push('shortcut.cancel'); }, dispose() {}, async open(value) { calls.push(value.shortcut); return { activated: value.isCurrent(), error: null }; } };
  const runtime = new StudioInputRuntime({ isCurrent: owner => active && owner === OWNER, now: () => time,
    windowsVoiceBridge: windows, shortcutVoiceBridge: shortcut,
    Bridge(options) {
      constructed++; let config, context = null, sequence = 0, events = [];
      bridge = {
        async start(value) { config = value; },
        poll(owner, value) { assert.equal(owner, INPUT); context = value.context; const queued = events; events = []; return { generation: config.generation, sequence, events: queued, overflow: false }; },
        pairing(owner) { assert.equal(owner, INPUT); return pairing; },
        async stop(owner) { assert.equal(owner, INPUT); calls.push('bridge.stop'); },
      };
      emitted = event => { const value = { event, sequence: ++sequence, generation: config.generation, context, at: time }; events.push(value); options.onEvent(value); return value; };
      return bridge;
    },
  });
  const poll = (options = {}) => runtime.poll(OWNER, INPUT, { context: CONTEXT, windowsVoice: false, shortcutVoice: false, ...options });
  return { runtime, calls, poll, emit: event => emitted(event), setTime: value => { time = value; }, deactivate: () => { active = false; }, constructed: () => constructed };
}
test('input runtime construction is passive and only an active owning runtime may connect', async () => {
  const f = fixture(); assert.equal(f.constructed(), 0);
  await assert.rejects(f.runtime.connect(OTHER, INPUT), /studio_runtime_required/);
  await f.runtime.connect(OWNER, INPUT); assert.equal(f.constructed(), 1);
  assert.equal(f.runtime.snapshot().connected, true);
  assert.throws(() => f.runtime.poll(OTHER, INPUT, {}), /owner_mismatch/);
  assert.throws(() => f.runtime.pairing(OWNER, OTHER), /owner_mismatch/);
  await f.runtime.dispose(); assert.equal(f.runtime.snapshot().connected, false);
});
test('queued input keeps accept-time context; context can only authorize later events', async () => {
  const f = fixture(); await f.runtime.connect(OWNER, INPUT);
  f.emit('k2.down'); const first = f.poll(); assert.equal(first.events[0].context, null);
  f.emit('k2.up'); const second = f.poll(); assert.equal(second.events[0].context, CONTEXT);
  f.deactivate(); assert.throws(() => f.poll(), /owner_mismatch/); await f.runtime.dispose();
});
test('only a fresh K1 gesture creates a single-use enabled Windows voice ticket', async () => {
  const f = fixture(); await f.runtime.connect(OWNER, INPUT); f.poll({ windowsVoice: true });
  const event = f.emit('k1.down'), gesture = { generation: event.generation, sequence: event.sequence, context: CONTEXT };
  const invalid = await f.runtime.trigger('windows', OWNER, INPUT, { ...gesture, sequence: 9 }); assert.equal(invalid.activated, false);
  assert.equal((await f.runtime.trigger('windows', OWNER, INPUT, gesture)).activated, true);
  assert.equal((await f.runtime.trigger('windows', OWNER, INPUT, gesture)).activated, false);
  assert.equal(f.calls.filter(value => value === 'windows.open').length, 1);
  await f.runtime.dispose();
});
test('voice tickets expire, reject wrong context and cancel when the live target changes', async () => {
  const f = fixture(); await f.runtime.connect(OWNER, INPUT); f.poll({ windowsVoice: true });
  const event = f.emit('k1.down'), gesture = { generation: event.generation, sequence: event.sequence, context: CONTEXT };
  f.setTime(2000); assert.equal((await f.runtime.trigger('windows', OWNER, INPUT, gesture)).activated, false);
  f.emit('k1.up'); f.setTime(2001); const next = f.emit('k1.down');
  f.poll({ windowsVoice: true, context: 'another_context_123456789' });
  assert.equal((await f.runtime.trigger('windows', OWNER, INPUT, { ...gesture, sequence: next.sequence })).activated, false);
  assert.ok(!f.calls.includes('windows.open')); await f.runtime.dispose();
});
test('input service refuses connecting without a live runtime and disposes a previous input atomically', async () => {
  let current = false, created = 0, disposed = 0;
  class Input {
    constructor({ isCurrent }) { assert.equal(isCurrent(OWNER), true); created++; }
    async connect() { return { state: 'ready', generation: 1, sequence: 0, connected: true, stopping: false, lightsEnabled: false, lightState: 'idle', lightResult: 'not_requested', error: null }; }
    async dispose() { disposed++; }
  }
  const service = createInputService({ owns: owner => current && owner === OWNER }, { InputRuntime: Input });
  await assert.rejects(service.connect(OWNER, INPUT, { lights: false }), /owner_mismatch/); assert.equal(created, 0);
  current = true; assert.equal((await service.connect(OWNER, INPUT, { lights: false })).connected, true);
  service.dispose(); service.dispose(); assert.equal(disposed, 1);
});
