import test from 'node:test';
import assert from 'node:assert/strict';
import { connectOptions, pollOptions, owner, descriptors, mountAu05Host, voiceGesture, windowsVoiceResult, shortcutOptions, shortcutVoiceResult, nativeScrollResult } from '../packages/dsh-plugin/host/rpc.js';

const OWNER = 'fixture_owner_0000001';
const initial = () => ({ state: 'disconnected', generation: 0, sequence: 0, lightsEnabled: false,
  lightState: 'idle', lightResult: 'not_requested', error: null, connected: false, stopping: false });
function fixture() {
  const calls = [];
  const effects = new Set();
  const ctx = {
    invocation: { peer: { principal: { kind: 'owner' } } },
    effect(setup) {
      const cleanup = setup();
      let active = true;
      const dispose = () => { if (active) { active = false; effects.delete(dispose); return cleanup(); } };
      effects.add(dispose);
      return dispose;
    },
    typert: { register(contribution) {
      calls.push(['register', contribution]);
      return ctx.effect(() => () => calls.push(['withdraw']));
    } },
  };
  class Service { constructor(context, name) { this.ctx = context; context[name] = this; } }
  class Controller {
    constructor() { calls.push(['construct']); }
    connect(...args) { calls.push(['connect', ...args]); return initial(); }
    poll(...args) { calls.push(['poll', ...args]); return { ...initial(), events: [], overflow: false }; }
    stop(...args) { calls.push(['stop', ...args]); return initial(); }
    snapshot() { return initial(); }
    nativeScroll(...args) { calls.push(['nativeScroll', ...args]); return { scrolled: true, error: null }; }
    windowsVoice(...args) { calls.push(['windowsVoice', ...args]); return { activated: true, error: null }; }
    shortcutVoice(...args) { calls.push(['shortcutVoice', ...args]); return { activated: true, error: null }; }
    dispose() { calls.push(['dispose']); }
  }
  const dispose = mountAu05Host(ctx, { TypertRemoteService: Service, Controller });
  return { ctx, calls, effects, dispose };
}

test('shortcut notSent result is optional true-only, never accepted for success or Windows voice', () => {
  const value = { activated: false, error: 'shortcut_voice_cancelled', notSent: true };
  assert.deepEqual(shortcutVoiceResult(value), value);
  for (const notSent of [false, null, 1, 'true', undefined]) assert.throws(() => shortcutVoiceResult({ ...value, notSent }));
  assert.throws(() => shortcutVoiceResult({ activated: true, error: null, notSent: true }));
  assert.throws(() => windowsVoiceResult({ activated: false, error: 'windows_voice_cancelled', notSent: true }));
});

test('Host activation registers bounded methods without connecting hardware or opening Windows voice', async () => {
  const f = fixture();
  assert.deepEqual(f.calls.map(call => call[0]), ['construct', 'register']);
  assert.deepEqual(descriptors.map(item => item.method), ['connect', 'poll', 'disconnect', 'status', 'nativeScroll', 'windowsVoice', 'shortcutVoice']);
  assert.equal(f.calls[1][1].face, 'host');
  assert.ok(descriptors.every(item => item.namespace === 'au05' && item.service === 'au05'));
  await f.dispose(); await f.dispose();
  assert.equal(f.calls.filter(call => call[0] === 'dispose').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'withdraw').length, 1);
});

test('only explicit owner Client requests reach the controller and fiber unload releases it', () => {
  const f = fixture();
  assert.deepEqual(f.ctx.au05.connect(OWNER, {}), initial());
  assert.deepEqual(f.calls.at(-1), ['connect', OWNER, { lights: true }]);
  f.ctx.au05.poll(OWNER, { after: 2, context: OWNER, light: 'approval', channels: [0, 1, 2, 0] });
  assert.deepEqual(f.calls.at(-1), ['poll', OWNER, { after: 2, context: OWNER, nativeScroll: false, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null, light: 'approval', channels: [0, 1, 2, 0] }]);
  f.ctx.au05.poll(OWNER, { lights: false });
  assert.deepEqual(f.calls.at(-1), ['poll', OWNER, { after: 0, context: null, nativeScroll: false, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null, light: 'idle', lights: false }]);
  f.ctx.au05.disconnect(OWNER);
  assert.deepEqual(f.calls.at(-1), ['stop', OWNER]);
  f.ctx.invocation.peer.principal.kind = 'guest';
  for (const invoke of [() => f.ctx.au05.connect(OWNER, {}), () => f.ctx.au05.poll(OWNER, {}),
    () => f.ctx.au05.disconnect(OWNER), () => f.ctx.au05.status()]) assert.throws(invoke, /owner_client_required/);
  f.ctx.invocation = undefined;
  assert.throws(() => f.ctx.au05.status(), /owner_client_required/);
  for (const dispose of [...f.effects]) dispose();
  assert.equal(f.calls.filter(call => call[0] === 'dispose').length, 1);
});

test('closed request schemas reject extra fields, malformed identity and unsafe controls', () => {
  assert.equal(owner(OWNER), OWNER);
  for (const value of ['', 'short', '../dangerous/identity', 'a'.repeat(129), null]) assert.throws(() => owner(value));
  assert.deepEqual(connectOptions({ lights: false }), { lights: false });
  for (const value of [undefined, [], { lights: 'yes' }, { lights: true, command: 'run' }, { token: 'no' }]) assert.throws(() => connectOptions(value));
  assert.deepEqual(pollOptions({}), { after: 0, context: null, nativeScroll: false, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null, light: 'idle' });
  assert.deepEqual(pollOptions({ lights: true }), { after: 0, context: null, nativeScroll: false, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null, light: 'idle', lights: true });
  assert.deepEqual(pollOptions({ lights: false }), { after: 0, context: null, nativeScroll: false, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null, light: 'idle', lights: false });
  for (const value of [{ lights: 'false' }, { lights: 0 }, { lights: null }, { lights: undefined },
    { lights: false, unknown: true }, { after: -1 }, { after: 0.2 }, { after: Infinity }, { context: 'session-id' },
    { light: 'arbitrary' }, { channels: [0, 1, 2] }, { channels: [0, 1, 2, 3] },
    { channels: [0, 1, 2, 1.5] }, { channels: [0, 1, 2, '0'] }, { channels: Array(4) },
    { rawReport: [1, 2] }, { command: 'shell' }, { release: true }, { release: false }]) assert.throws(() => pollOptions(value));
  const sparseDecorated = [, , 1, 2]; sparseDecorated.extra = 1; sparseDecorated.other = 2;
  assert.throws(() => pollOptions({ channels: sparseDecorated }));
  const polluted = Object.create({ after: 2 });
  assert.throws(() => pollOptions(polluted));
});

test('key feedback poll option is bool-only, defaults off per call and adds no action RPC', () => {
  const parse = descriptors.find(item => item.method === 'poll').parameters[1].codec.create().parse;
  assert.equal(parse({}).keyFeedback, false);
  for (const keyFeedback of [true, false]) {
    assert.equal(parse({ keyFeedback }).keyFeedback, keyFeedback);
    assert.equal(pollOptions({ keyFeedback }).keyFeedback, keyFeedback);
  }
  for (const keyFeedback of ['true', 'false', 0, 1, null, undefined, [], {}, NaN]) {
    assert.throws(() => parse({ keyFeedback }), /invalid_request/);
  }
  for (const value of [{ keyFeedback: true, key: 'k2' }, { keyFeedback: true, flash: true },
    { keyFeedback: true, payload: [] }, { keyFeedback: true, rawReport: [] }]) {
    assert.throws(() => parse(value), /invalid_request/);
  }
  assert.throws(() => connectOptions({ keyFeedback: true }), /invalid_request/);
  assert.equal(descriptors.some(item => /flash|keyFeedback/i.test(item.method)), false);

  const f = fixture();
  try {
    f.ctx.au05.poll(OWNER, { keyFeedback: true });
    assert.equal(f.calls.at(-1)[2].keyFeedback, true);
    f.ctx.au05.poll(OWNER, {});
    assert.equal(f.calls.at(-1)[2].keyFeedback, false);
    const before = f.calls.length;
    assert.throws(() => f.ctx.au05.poll(OWNER, { keyFeedback: 'true' }), /invalid_request/);
    assert.equal(f.calls.length, before);
    f.ctx.invocation.peer.principal.kind = 'guest';
    assert.throws(() => f.ctx.au05.poll(OWNER, { keyFeedback: true }), /owner_client_required/);
    assert.equal(f.calls.length, before);
  } finally { f.dispose(); }
});

test('strict codec factories validate both wire arguments and closed controller results', () => {
  const connect = descriptors.find(item => item.method === 'connect');
  assert.equal(connect.parameters[0].codec.create().parse(OWNER), OWNER);
  assert.throws(() => connect.parameters[1].codec.create().parse({ arbitrary: true }));
  assert.deepEqual(connect.result.create().parse(initial()), initial());
  assert.throws(() => connect.result.create().parse({ ...initial(), secret: 'never' }));
  assert.throws(() => connect.result.create().parse({ ...initial(), lightState: 'arbitrary' }));
  for (const lightResult of ['not_requested', 'written', 'failed', 'readback_unsupported', 'verified', 'mismatch'])
    assert.equal(connect.result.create().parse({ ...initial(), lightResult }).lightResult, lightResult);
  assert.throws(() => connect.result.create().parse({ ...initial(), lightResult: 'physically_lit' }));
  const poll = descriptors.find(item => item.method === 'poll');
  const event = { sequence: 1, generation: 1, event: 'k1.down', context: OWNER, at: 100 };
  assert.deepEqual(poll.result.create().parse({ ...initial(), events: [event], overflow: false }).events, [event]);
  assert.throws(() => poll.result.create().parse({ ...initial(), events: [{ ...event, event: 'inject' }], overflow: false }));
});

test('result readback codec is closed, bounded, stage-aware and deeply copied', () => {
  const parse = descriptors.find(item => item.method === 'connect').result.create().parse;
  const readback = { stage: 'initial', attempts: 3, readsWhilePending: 0, shortReads: 0, outerRejected: 0,
    nonMatchingHeader: 0, modeRejected: 0, matched: 0, timedOut: 3, getWritesCompleted: 3 };
  const entry = { at: 100, type: 'result', requestId: 1, state: 'idle', channels: [0, 0, 0, 0], result: 'failed', readback };
  const parsed = parse({ ...initial(), lightTrace: [entry] });
  assert.deepEqual(parsed.lightTrace[0].readback, readback);
  assert.notEqual(parsed.lightTrace[0].readback, readback);
  const headerKinds = { lightingNoRelay: 1, lightingGroupFlags: 1, lightingOtherOperation: 2, dongle: 3, notice: 4, otherDevice: 0, other: 65535 };
  const withKinds = kinds => parse({ ...initial(), lightTrace: [{ ...entry, readback: { ...readback, headerKinds: kinds } }] });
  const classified = withKinds(headerKinds);
  assert.deepEqual(classified.lightTrace[0].readback.headerKinds, headerKinds);
  classified.lightTrace[0].readback.headerKinds.notice = 999;
  assert.equal(headerKinds.notice, 4);
  for (const invalid of [null, [], {}, { ...headerKinds, raw: [] }, { ...headerKinds, notice: -1 },
    { ...headerKinds, lightingNoRelay: 65536 }, { ...headerKinds, lightingGroupFlags: 0.1 },
    { ...headerKinds, lightingOtherOperation: NaN }, { ...headerKinds, dongle: '0' },
    { ...headerKinds, other: Infinity }, Object.assign(Object.create({ inherited: true }), headerKinds),
    { ...headerKinds, [Symbol('raw')]: 1 }]) assert.throws(() => withKinds(invalid));
  for (const key of Object.keys(headerKinds)) {
    const incomplete = { ...headerKinds }; delete incomplete[key];
    assert.throws(() => withKinds(incomplete));
  }
  for (const patch of [{ secret: 'no' }, { stage: 'x' }, { stage: 'post_write' }, { attempts: 0 }, { attempts: 4 },
    { readsWhilePending: NaN }, { readsWhilePending: 65536 }, { shortReads: -1 }, { outerRejected: 0.5 },
    { nonMatchingHeader: '0' }, { modeRejected: Infinity }, { matched: 4 }, { timedOut: 4 }, { getWritesCompleted: 4 }]) {
    assert.throws(() => parse({ ...initial(), lightTrace: [{ ...entry, readback: { ...readback, ...patch } }] }));
  }
  for (const key of Object.keys(readback)) {
    const incomplete = { ...readback }; delete incomplete[key];
    assert.throws(() => parse({ ...initial(), lightTrace: [{ ...entry, readback: incomplete }] }));
  }
  assert.throws(() => parse({ ...initial(), lightTrace: [{ ...entry, type: 'request', result: 'pending' }] }));
  const post = { ...readback, stage: 'post_write', attempts: 1, timedOut: 0, matched: 1, getWritesCompleted: 1 };
  assert.deepEqual(parse({ ...initial(), lightTrace: [{ ...entry, readback: post }] }).lightTrace[0].readback, post);
  assert.throws(() => parse({ ...initial(), lightTrace: [{ ...entry, readback: { ...post, matched: 2 } }] }));
  const counts = { ...readback, readsWhilePending: 65535, shortReads: 65535, outerRejected: 65535, nonMatchingHeader: 65535, modeRejected: 65535 };
  assert.deepEqual(parse({ ...initial(), lightTrace: [{ ...entry, readback: counts }] }).lightTrace[0].readback, counts);
});

test('lightTrace codec is optional, bounded, closed, dense and deeply copied', () => {
  const parse = descriptors.find(item => item.method === 'connect').result.create().parse;
  const entry = { at: 100, type: 'request', requestId: 1, state: 'running', channels: [0, 0, 0, 1], result: 'pending' };
  const result = { ...entry, type: 'result', result: 'failed', reason: 'snapshot_unavailable' };
  assert.deepEqual(parse(initial()), initial());
  const input = { ...initial(), lightTrace: [entry, result] };
  const output = parse(input);
  assert.deepEqual(output.lightTrace, input.lightTrace);
  assert.notEqual(output.lightTrace, input.lightTrace);
  assert.notEqual(output.lightTrace[0], entry);
  assert.notEqual(output.lightTrace[0].channels, entry.channels);
  for (const status of ['verified', 'written', 'mismatch', 'failed', 'preserved', 'restored', 'restore_written', 'restore_mismatch']) {
    assert.equal(parse({ ...initial(), lightResult: status }).lightResult, status);
    assert.equal(parse({ ...initial(), lightTrace: [{ ...entry, type: 'result', result: status }] }).lightTrace[0].result, status);
  }
  for (const patch of [{ owner: OWNER }, { session: 'secret' }, { context: OWNER }, { audio: [] }, { raw: [] }, { path: 'x' },
    { ignored: true }, { at: NaN }, { at: Infinity }, { at: -1 }, { requestId: 0 }, { requestId: 1.5 },
    { state: 'unknown' }, { type: 'unknown' }, { result: 'verified' }, { reason: 'snapshot_unavailable' },
    { channels: [0, 0, 0] }, { channels: [0, 0, 0, 3] }, { channels: [0, NaN, 0, 0] }, { channels: Array(4) }]) {
    assert.throws(() => parse({ ...initial(), lightTrace: [{ ...entry, ...patch }] }));
  }
  assert.throws(() => parse({ ...initial(), lightTrace: [{ ...result, reason: 'secret' }] }));
  assert.throws(() => parse({ ...initial(), lightTrace: [{ ...result, result: 'verified' }] }));
  const decorated = [entry]; decorated.owner = OWNER;
  for (const lightTrace of [null, {}, Array(1), decorated, Array(33).fill(entry)]) {
    assert.throws(() => parse({ ...initial(), lightTrace }));
  }
  assert.equal(parse({ ...initial(), lightTrace: Array(32).fill(entry) }).lightTrace.length, 32);
});

test('native scroll RPC carries only owner, closed gesture and carrier abort signal', async () => {
  const f = fixture(), abort = new AbortController(); f.ctx.invocation.signal = abort.signal;
  const gesture = { generation: 1, sequence: 2, context: OWNER };
  try {
    assert.deepEqual(await f.ctx.au05.nativeScroll(OWNER, gesture), { scrolled: true, error: null });
    assert.deepEqual(f.calls.at(-1), ['nativeScroll', OWNER, gesture, { signal: abort.signal }]);
    const codec = descriptors.find(item => item.method === 'nativeScroll');
    assert.deepEqual(codec.parameters.map(value => value.name), ['owner', 'gesture']);
    assert.deepEqual(codec.parameters[1].codec.create().parse(gesture), gesture);
    assert.throws(() => codec.parameters[1].codec.create().parse({ ...gesture, direction: 'up' }));
    assert.deepEqual(codec.result.create().parse({ scrolled: true, error: null }), { scrolled: true, error: null });
    assert.deepEqual(pollOptions({ nativeScroll: true }), { after: 0, context: null, light: 'idle', nativeScroll: true, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null });
    for (const nativeScroll of ['true', 1, null, undefined]) assert.throws(() => pollOptions({ nativeScroll }));
    for (const value of [{ scrolled: false, error: null }, { scrolled: true, error: 'native_wheel_expired' },
      { scrolled: false, error: 'native_wheel_private_detail' }, { scrolled: true, error: null, direction: 'down' }]) assert.throws(() => nativeScrollResult(value));
    const before = f.calls.length;
    f.ctx.invocation.peer.principal.kind = 'guest';
    await assert.rejects(f.ctx.au05.nativeScroll(OWNER, gesture), /owner_client_required/);
    assert.equal(f.calls.length, before);
  } finally { await f.dispose(); }
});

test('Windows voice RPC carries only owner, closed gesture and carrier abort signal', async () => {
  const f = fixture(); const abort = new AbortController(); f.ctx.invocation.signal = abort.signal;
  const gesture = { generation: 1, sequence: 2, context: OWNER };
  try {
    assert.deepEqual(await f.ctx.au05.windowsVoice(OWNER, gesture), { activated: true, error: null });
    assert.deepEqual(f.calls.at(-1), ['windowsVoice', OWNER, gesture, { signal: abort.signal }]);
    f.ctx.invocation.peer.principal.kind = 'guest';
    await assert.rejects(f.ctx.au05.windowsVoice(OWNER, gesture), /owner_client_required/);
    assert.deepEqual(pollOptions({ windowsVoice: true }), { after: 0, context: null, nativeScroll: false, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null, light: 'idle', windowsVoice: true });
    assert.throws(() => pollOptions({ windowsVoice: 'true' }));
    for (const value of [{ ...gesture, command: 'Win+H' }, { ...gesture, executable: 'arbitrary.exe' },
      { ...gesture, sequence: -1 }, { ...gesture, context: null }]) assert.throws(() => voiceGesture(value));
    assert.deepEqual(windowsVoiceResult({ activated: false, error: 'windows_voice_expired' }), { activated: false, error: 'windows_voice_expired' });
    for (const value of [{ activated: true, error: 'windows_voice_expired' }, { activated: false, error: null },
      { activated: true, error: null, transcript: 'no' }, { activated: false, error: 'arbitrary' }]) assert.throws(() => windowsVoiceResult(value));
  } finally { await f.dispose(); }
});

test('shortcut voice RPC carries only a validated tap chord, owner gesture and abort signal', async () => {
  const f = fixture(); const abort = new AbortController(); f.ctx.invocation.signal = abort.signal;
  const gesture = { generation: 1, sequence: 2, context: OWNER };
  try {
    assert.deepEqual(await f.ctx.au05.shortcutVoice(OWNER, gesture, { shortcut: 'shift+ctrl+Space' }), { activated: true, error: null });
    assert.deepEqual(f.calls.at(-1), ['shortcutVoice', OWNER, gesture, { shortcut: 'Ctrl+Shift+Space' }, { signal: abort.signal }]);
    const codec = descriptors.find(item => item.method === 'shortcutVoice');
    assert.deepEqual(codec.parameters[2].codec.create().parse({ shortcut: 'rightalt' }), { shortcut: 'RightAlt' });
    assert.deepEqual(pollOptions({ shortcutVoice: true }), { after: 0, context: null, nativeScroll: false, keyFeedback: false, bageshuoCrossAppEnabled: false, bageshuoCrossAppContext: null, light: 'idle', shortcutVoice: true });
    for (const value of [{ shortcutVoice: 'true' }, { shortcutVoice: true, windowsVoice: true }]) assert.throws(() => pollOptions(value));
    for (const value of [{ shortcut: 'Alt+F4' }, { shortcut: 'a' }, { shortcut: 'RightAlt', executable: 'fake.exe' },
      { shortcut: 'RightAlt', command: 'anything' }, { keys: [165] }]) assert.throws(() => shortcutOptions(value));
    assert.deepEqual(shortcutVoiceResult({ activated: false, error: 'shortcut_voice_invalid_shortcut' }), { activated: false, error: 'shortcut_voice_invalid_shortcut' });
    for (const value of [{ activated: true, error: 'shortcut_voice_expired' }, { activated: false, error: null },
      { activated: false, error: 'windows_voice_expired' }, { activated: true, error: null, transcript: 'never' }]) assert.throws(() => shortcutVoiceResult(value));
    f.ctx.invocation.peer.principal.kind = 'guest';
    await assert.rejects(f.ctx.au05.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' }), /owner_client_required/);
  } finally { await f.dispose(); }
});

test('failed registry registration disposes its controller without touching hardware', () => {
  let disposed = 0;
  const ctx = { effect: setup => setup(), typert: { register() { throw new Error('duplicate'); } } };
  class Service { constructor() {} }
  class Controller { dispose() { disposed++; } }
  assert.throws(() => mountAu05Host(ctx, { TypertRemoteService: Service, Controller }), /duplicate/);
  assert.equal(disposed, 1);
});

 test('poll brightness is optional raw integer 0..255 with no coercion', () => {
  assert.equal(Object.hasOwn(pollOptions({}), 'brightness'), false);
  for (const brightness of [0, 1, 127, 255]) assert.equal(pollOptions({ brightness }).brightness, brightness);
  for (const brightness of [-1, 256, 0.5, NaN, Infinity, null, undefined, true, '2', [], {}]) {
    assert.throws(() => pollOptions({ brightness }), /invalid_request/);
  }
});
