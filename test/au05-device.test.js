import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DeviceController } from '../packages/dsh-plugin/host/device-controller.js';
import { createModeLease } from '../packages/dsh-plugin/host/mode-lease.js';
const owner = 'owner_0000000000000001', other = 'owner_0000000000000002', context = 'context_000000000001';
function fixture({ windowsVoiceBridge, shortcutVoiceBridge, schedule, cancel } = {}) {
  const commands = []; let spawns = 0, last, at = 100;
  const device = new DeviceController({ platform: 'win32', now: () => at, windowsVoiceBridge, shortcutVoiceBridge, schedule, cancel,
    modeLease: createModeLease('direct', new Map()),
    spawnChild(command, args, options) {
      assert.equal(command, 'pwsh'); assert.equal(options.shell, false); assert.ok(args.includes('-EnableLights'));
      assert.ok(args.includes('Connect')); assert.ok(args.includes('-NonInteractive'));
      assert.equal(options.stdio[2], 'ignore');
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
      child.stdin.on('data', chunk => commands.push(JSON.parse(chunk.toString())));
      child.kill = () => { child.emit('close', null); return true; }; spawns++; last = child; return child;
    } });
  return { device, commands, get spawns() { return spawns; }, advance(ms) { at += ms; }, emit(value) { last.stdout.write(JSON.stringify(value) + '\n'); }, close() { last.emit('close', 0); } };
}

test('light traces bind requested brightness to result and copy comparison', () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    f.device.poll(owner, { context, brightness: 123 });
    const request = f.device.snapshot().lightTrace.at(-1);
    assert.equal(request.brightness, 123);
    const readback = { stage: 'post_write', attempts: 1, readsWhilePending: 1, shortReads: 0, outerRejected: 0,
      nonMatchingHeader: 0, modeRejected: 0, matched: 1, timedOut: 0, getWritesCompleted: 1,
      comparison: { expected: { mode: 2, lights: Array(20).fill(2) }, observed: { mode: 2, lights: Array(20).fill(2) } } };
    f.emit({ type: 'lights', state: request.state, requestId: request.requestId, result: 'mismatch', readback });
    const result = f.device.snapshot().lightTrace.at(-1);
    assert.equal(result.brightness, 123);
    assert.deepEqual(result.readback, readback);
    result.readback.comparison.observed.lights[1] = 255;
    assert.equal(f.device.snapshot().lightTrace.at(-1).readback.comparison.observed.lights[1], 2);
  } finally { f.device.dispose(); }
});

test('product device connects only explicitly, binds events, ignores late stop input and refuses early reconnect', () => {
  const f = fixture(); assert.equal(f.spawns, 0);
  assert.equal(f.device.connect(owner).state, 'connecting'); assert.equal(f.spawns, 1);
  assert.throws(() => f.device.connect(other), /device_busy/);
  f.emit({ type: 'status', state: 'ready' });
  f.device.poll(owner, { context });
  f.emit({ type: 'input', event: 'k2.down', sequence: 1 });
  const result = f.device.poll(owner, { context });
  assert.equal(result.events.length, 1); assert.equal(result.events[0].context, context); assert.equal(result.events[0].at, 100);
  const stopping = f.device.stop(owner); assert.equal(stopping.stopping, true); assert.equal(stopping.connected, false);
  f.emit({ type: 'input', event: 'k2.up', sequence: 2 });
  assert.equal(f.device.events.length, 0); assert.throws(() => f.device.connect(owner), /device_stopping/);
  assert.equal(f.commands.filter(value => value.type === 'stop').length, 1); f.device.stop(owner);
  assert.equal(f.commands.filter(value => value.type === 'stop').length, 1);
  f.close(); assert.equal(f.device.snapshot().stopping, false); f.device.dispose();
});

test('lamp feedback writes independent channels, explicitly turns off and does not spam unchanged state', () => {
  const f = fixture(); f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
  f.device.poll(owner, { context, light: 'recording', channels: [2, 2, 2, 1] });
  assert.deepEqual(f.commands.at(-1), { type: 'lights', state: 'recording', channels: [2, 2, 2, 1], requestId: 2 });
  const count = f.commands.length; f.device.poll(owner, { context, light: 'recording', channels: [2, 2, 2, 1] }); assert.equal(f.commands.length, count);
  f.device.poll(owner, { lights: false, light: 'running', channels: [0, 0, 2, 1] }); assert.deepEqual(f.commands.at(-1).channels, [0, 0, 0, 0]);
  f.emit({ type: 'lights', state: 'running', result: 'failed', requestId: f.commands.at(-1).requestId }); assert.equal(f.device.snapshot().connected, true); assert.equal(f.device.snapshot().lightResult, 'failed');
  assert.throws(() => f.device.poll(owner, { channels: [0, 3, 0, 0] }), /invalid_request/);
  f.device.dispose(); f.close();
});

test('enabled idle stays owned and all-off; only lamp opt-out releases the original configuration', () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    const on = f.commands.at(-1);
    assert.deepEqual(on, { type: 'lights', state: 'idle', channels: [0, 0, 0, 0], requestId: 1 });
    const count = f.commands.length;
    f.device.poll(owner, { lights: true });
    assert.equal(f.commands.length, count, 'unchanged enabled idle is still deduplicated');
    f.device.poll(owner, { lights: false });
    const off = f.commands.at(-1);
    assert.deepEqual(off, { ...on, requestId: on.requestId + 1, release: true });
    f.device.poll(owner, { lights: true });
    const reenabled = f.commands.at(-1);
    assert.deepEqual(reenabled, { ...on, requestId: off.requestId + 1 });
    f.emit({ type: 'lights', state: 'idle', result: 'restored', requestId: off.requestId });
    assert.equal(f.device.snapshot().lightResult, 'not_requested', 'old release cannot confirm new all-off intent');
    f.emit({ type: 'lights', state: 'idle', result: 'verified', requestId: reenabled.requestId });
    assert.equal(f.device.snapshot().lightResult, 'verified');
    const beforeUnknown = f.commands.length;
    f.device.poll(owner, { release: true });
    assert.equal(f.commands.length, beforeUnknown, 'controller cannot forward a caller-provided release field');
    f.device.stop(owner);
    assert.deepEqual(f.commands.at(-1), { type: 'stop' }, 'disconnect still uses exact native cleanup');
  } finally { f.device.dispose(); f.close(); }
});

test('key feedback option changes get fresh light requests without changing state, channels or brightness', () => {
  const f = fixture();
  const options = { context, light: 'approval', channels: [2, 2, 2, 1], brightness: 73 };
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    assert.equal(Object.hasOwn(f.commands.at(-1), 'keyFeedback'), false);
    f.device.poll(owner, { ...options, keyFeedback: true });
    const enabled = f.commands.at(-1);
    assert.deepEqual(enabled, { type: 'lights', state: 'approval', channels: [2, 2, 2, 1], requestId: 2, brightness: 73, keyFeedback: true });
    assert.equal(f.device.keyFeedback, true);
    const count = f.commands.length;
    f.device.poll(owner, { ...options, keyFeedback: true });
    assert.equal(f.commands.length, count);
    f.device.poll(owner, { ...options, keyFeedback: false });
    const disabled = f.commands.at(-1);
    assert.deepEqual(disabled, { type: 'lights', state: 'approval', channels: [2, 2, 2, 1], requestId: enabled.requestId + 1, brightness: 73 });
    f.emit({ type: 'lights', state: 'approval', result: 'verified', requestId: enabled.requestId });
    assert.equal(f.device.snapshot().lightResult, 'not_requested');
    f.emit({ type: 'lights', state: 'approval', result: 'written', requestId: disabled.requestId });
    assert.equal(f.device.snapshot().lightResult, 'written');
    f.device.poll(owner, { ...options, keyFeedback: true });
    const reenabled = f.commands.at(-1);
    f.device.poll(owner, options);
    assert.equal(f.device.keyFeedback, false);
    assert.deepEqual(f.commands.at(-1), { ...disabled, requestId: reenabled.requestId + 1 });
    const offCount = f.commands.length;
    f.device.poll(owner, options);
    assert.equal(f.commands.length, offCount);
  } finally { f.device.dispose(); f.close(); }
});

test('key feedback saves intent but the master lamp switch always gates native permission', () => {
  const f = fixture();
  try {
    f.device.connect(owner, { lights: false }); f.emit({ type: 'status', state: 'ready' });
    f.device.poll(owner, { keyFeedback: true, lights: false });
    assert.equal(f.device.keyFeedback, true);
    assert.equal(Object.hasOwn(f.commands.at(-1), 'keyFeedback'), false);
    assert.deepEqual(f.commands.at(-1).channels, [0, 0, 0, 0]);
    for (const lights of [true, false, true]) {
      const before = f.commands.at(-1).requestId;
      f.device.poll(owner, { keyFeedback: true, lights });
      assert.equal(f.commands.at(-1).requestId, before + 1);
      assert.equal(f.commands.at(-1).keyFeedback, lights ? true : undefined);
      assert.equal(f.commands.at(-1).release, lights ? undefined : true);
      assert.deepEqual(f.commands.at(-1).channels, [0, 0, 0, 0]);
      assert.equal(f.device.keyFeedback, true);
    }
    f.device.poll(owner, {});
    assert.equal(Object.hasOwn(f.commands.at(-1), 'keyFeedback'), false);
    assert.equal(f.device.keyFeedback, false);
    for (const keyFeedback of ['true', 'false', 0, 1, null, [], {}]) {
      const count = f.commands.length;
      assert.throws(() => f.device.poll(owner, { keyFeedback }), /invalid_request/);
      assert.equal(f.commands.length, count);
      assert.equal(f.device.keyFeedback, false);
    }
    assert.throws(() => f.device.poll(other, { keyFeedback: true }), /not_owner/);
    assert.equal(f.device.keyFeedback, false);
  } finally { f.device.dispose(); f.close(); }
});

test('native K2/K3 input stays event-only with no Host flash timer, write or voice action', () => {
  let scheduled = 0, voiceCalls = 0;
  const bridge = { open() { voiceCalls++; }, cancel() {}, dispose() {} };
  const f = fixture({ windowsVoiceBridge: bridge, shortcutVoiceBridge: bridge,
    schedule() { scheduled++; return { unref() {} }; }, cancel() {} });
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    f.device.poll(owner, { context, keyFeedback: true, light: 'approval', channels: [2, 2, 2, 1] });
    const count = f.commands.length, timers = scheduled;
    const events = ['k2.down', 'k2.up', 'k3.down', 'k3.up'];
    for (const [index, event] of events.entries()) f.emit({ type: 'input', event, sequence: index + 1 });
    assert.equal(f.commands.length, count);
    assert.equal(scheduled, timers);
    assert.equal(voiceCalls, 0);
    const result = f.device.poll(owner, { context, keyFeedback: true, light: 'approval', channels: [2, 2, 2, 1] });
    assert.deepEqual(result.events.map(item => item.event), events);
    assert.equal(f.commands.length, count);
    assert.equal(scheduled, timers + 1); // Existing owner heartbeat only.
    assert.equal(result.lightResult, 'not_requested');
    assert.equal(result.lightState, 'approval');
    assert.deepEqual(f.device.lightChannels, [2, 2, 2, 1]);
    assert.equal(f.device.voiceTicket, null);
  } finally { f.device.dispose(); f.close(); }
});

test('key feedback resets on stop, old-generation close and reconnect and cannot rearm while stopping', () => {
  const f = fixture();
  try {
    f.device.connect(owner);
    f.device.poll(owner, { keyFeedback: true });
    assert.equal(f.commands.length, 0);
    f.emit({ type: 'status', state: 'ready' });
    assert.equal(f.commands.at(-1).keyFeedback, true);
    const generation = f.device.generation;
    f.device.stop(owner);
    assert.equal(f.device.keyFeedback, false);
    assert.deepEqual(f.commands.at(-1), { type: 'stop' });
    const count = f.commands.length;
    f.device.poll(owner, { keyFeedback: true });
    f.emit({ type: 'input', event: 'k2.down', sequence: 1 });
    assert.equal(f.device.keyFeedback, false);
    assert.equal(f.commands.length, count);
    assert.deepEqual(f.device.events, []);
    f.close();
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    assert.equal(f.device.generation, generation + 1);
    assert.equal(f.device.keyFeedback, false);
    assert.equal(Object.hasOwn(f.commands.at(-1), 'keyFeedback'), false);
    f.device.poll(owner, { keyFeedback: true });
    f.close();
    assert.equal(f.device.keyFeedback, false);
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    assert.equal(Object.hasOwn(f.commands.at(-1), 'keyFeedback'), false);
  } finally { f.device.dispose(); f.close(); }
});

test('official task lamp defaults use solid progress, breathing prompts and no synthetic recording progress', () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    for (const [light, channels] of [
      ['running', [0, 0, 0, 1]], ['recording', [2, 0, 0, 0]],
      ['approval', [0, 2, 0, 0]], ['attention', [0, 0, 2, 0]], ['idle', [0, 0, 0, 0]],
    ]) {
      f.device.poll(owner, { context, light });
      assert.deepEqual(f.commands.at(-1).channels, channels);
    }
    f.device.poll(owner, { context, light: 'recording' });
    f.device.poll(owner, { context, light: 'recording', lights: false });
    assert.deepEqual(f.commands.at(-1).channels, [0, 0, 0, 0]);
  } finally { f.device.dispose(); f.close(); }
});

test('lamp replies cannot confirm another request, vector, or old process generation', () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    const idle = f.commands.at(-1);
    f.device.poll(owner, { context, light: 'running' });
    const first = f.commands.at(-1); assert.deepEqual(first.channels, [0, 0, 0, 1]);
    f.emit({ type: 'lights', state: 'idle', result: 'verified', requestId: idle.requestId });
    assert.equal(f.device.snapshot().lightResult, 'not_requested');
    f.device.poll(owner, { context, light: 'running', channels: [1, 0, 1, 1] });
    const latest = f.commands.at(-1); assert.ok(latest.requestId > first.requestId);
    f.emit({ type: 'lights', state: 'running', result: 'verified', requestId: first.requestId });
    assert.equal(f.device.snapshot().lightResult, 'not_requested');
    f.emit({ type: 'lights', state: 'running', result: 'mismatch', requestId: latest.requestId });
    assert.equal(f.device.snapshot().lightResult, 'mismatch'); assert.equal(f.device.snapshot().connected, true);
    f.device.stop(owner); f.close(); f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    assert.ok(f.commands.at(-1).requestId > latest.requestId);
    f.emit({ type: 'lights', state: 'running', result: 'verified', requestId: latest.requestId });
    assert.equal(f.device.snapshot().lightResult, 'not_requested');
    const id = f.commands.at(-1).requestId;
    f.emit({ type: 'lights', state: 'idle', result: 'verified', requestId: id });
    assert.equal(f.device.snapshot().lightResult, 'verified');
  } finally { f.device.dispose(); f.close(); }
});

const headerKinds = () => ({ lightingNoRelay: 1, lightingGroupFlags: 2, lightingOtherOperation: 3, dongle: 4, notice: 5, otherDevice: 6, other: 65535 });

test('native optional headerKinds survives transport and snapshots without aliasing', () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    f.emit({ type: 'lights', state: 'idle', result: 'failed', requestId: 1,
      reason: 'snapshot_unavailable', readback: { ...readback(), headerKinds: headerKinds() } });
    const snapshot = f.device.snapshot();
    assert.deepEqual(snapshot.lightTrace.at(-1).readback.headerKinds, headerKinds());
    snapshot.lightTrace.at(-1).readback.headerKinds.notice = 999;
    assert.equal(f.device.snapshot().lightTrace.at(-1).readback.headerKinds.notice, 5);
  } finally { f.device.dispose(); f.close(); }
});

const readback = () => ({ stage: 'initial', attempts: 3, readsWhilePending: 5, shortReads: 1,
  outerRejected: 1, nonMatchingHeader: 2, modeRejected: 1, matched: 0, timedOut: 3, getWritesCompleted: 3 });

test('native readback metadata is validated, attributed and deeply isolated', () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    f.emit({ type: 'lights', state: 'idle', result: 'failed', requestId: 1,
      reason: 'snapshot_unavailable', readback: readback() });
    const snapshot = f.device.snapshot();
    assert.deepEqual(snapshot.lightTrace.at(-1).readback, readback());
    snapshot.lightTrace.at(-1).readback.modeRejected = 999;
    assert.equal(f.device.snapshot().lightTrace.at(-1).readback.modeRejected, 1);
    f.device.poll(owner, { light: 'running' });
    f.emit({ type: 'lights', state: 'idle', result: 'failed', requestId: 1, readback: readback() });
    assert.equal(f.device.snapshot().lightTrace.at(-1).type, 'request');
    f.emit({ type: 'lights', state: 'running', result: 'verified', requestId: 2,
      readback: { ...readback(), stage: 'post_write', attempts: 1, timedOut: 0, matched: 1, getWritesCompleted: 1 } });
    assert.equal(f.device.snapshot().lightTrace.at(-1).readback.stage, 'post_write');
  } finally { f.device.dispose(); f.close(); }
});

for (const patch of [{ owner: owner }, { raw: [] }, { stage: 'unknown' }, { attempts: 0 }, { attempts: 4 },
  { readsWhilePending: 65536 }, { shortReads: -1 }, { outerRejected: NaN }, { nonMatchingHeader: 0.1 },
  { modeRejected: '0' }, { matched: 4 }, { timedOut: 4 }, { getWritesCompleted: 4 }, { stage: 'post_write' },
  ...[null, [], {}, { ...headerKinds(), raw: [] }, { ...headerKinds(), notice: -1 },
    { ...headerKinds(), dongle: 65536 }, { ...headerKinds(), other: 0.1 }, { ...headerKinds(), otherDevice: '0' }].map(headerKinds => ({ headerKinds }))]) {
  test(`native readback rejects invalid closed metadata ${JSON.stringify(patch)}`, () => {
    const f = fixture();
    try {
      f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
      f.emit({ type: 'lights', state: 'idle', result: 'failed', requestId: 1, readback: { ...readback(), ...patch } });
      assert.equal(f.device.snapshot().state, 'protocol_error');
    } finally { f.device.dispose(); f.close(); }
  });
}

for (const reply of [
  { type: 'lights', state: 'idle', result: 'verified' },
  { type: 'lights', state: 'idle', result: 'verified', requestId: 0 },
  { type: 'lights', state: 'idle', result: 'verified', requestId: 2 },
  { type: 'lights', state: 'running', result: 'verified', requestId: 1 },
  { type: 'lights', state: 'idle', result: 'verified', requestId: 1, bytes: [] },
]) test(`lamp result fails closed on malformed or unmatched acknowledgement ${JSON.stringify(reply)}`, () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' }); f.emit(reply);
    assert.equal(f.device.snapshot().state, 'protocol_error'); assert.equal(f.device.snapshot().stopping, true);
  } finally { f.device.dispose(); f.close(); }
});

test('light trace is bounded metadata, copies dispatch vectors, ignores stale ACKs and resets on connect', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.device.snapshot().lightTrace, []);
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    const first = f.commands.at(-1);
    const channels = [2, 2, 0, 1];
    f.advance(5); f.device.poll(owner, { context, light: 'recording', channels, lights: false });
    channels[0] = 0;
    const id = f.commands.at(-1).requestId;
    assert.deepEqual(f.device.snapshot().lightTrace.at(-1), { at: 105, type: 'request', requestId: id,
      state: 'recording', channels: [0, 0, 0, 0], result: 'pending' });
    const count = f.device.snapshot().lightTrace.length;
    f.device.poll(owner, { context, light: 'recording', channels: [2, 2, 0, 1], lights: false });
    f.emit({ type: 'lights', state: 'idle', result: 'verified', requestId: first.requestId });
    assert.equal(f.device.snapshot().lightTrace.length, count);
    for (const result of ['verified', 'written', 'mismatch', 'failed']) {
      f.emit({ type: 'lights', state: 'recording', requestId: id, result,
        ...(result === 'failed' ? { reason: 'snapshot_unavailable' } : {}) });
      const snapshot = f.device.snapshot();
      assert.equal(snapshot.lightTrace.at(-1).result, result);
      assert.deepEqual(snapshot.lightTrace.at(-1).channels, [0, 0, 0, 0]);
      snapshot.lightTrace.at(-1).channels[0] = 2; snapshot.lightTrace[0].state = 'changed';
      assert.equal(f.device.snapshot().lightTrace.at(-1).channels[0], 0);
      assert.equal(f.device.snapshot().lightTrace[0].state, 'idle');
    }
    for (let index = 0; index < 40; index++) {
      f.device.poll(owner, { context, light: index % 2 ? 'running' : 'idle' });
    }
    assert.equal(f.device.snapshot().lightTrace.length, 32);
    assert.ok(f.device.snapshot().lightTrace.every(item => Object.keys(item).every(key =>
      ['at', 'type', 'requestId', 'state', 'channels', 'result', 'reason'].includes(key))));
    f.device.stop(owner); f.close(); f.device.connect(owner);
    assert.deepEqual(f.device.snapshot().lightTrace, []);
  } finally { f.device.dispose(); f.close(); }
});

function voiceFixture({ pending = false } = {}) {
  let calls = 0, cancels = 0, latest, resolve;
  const bridge = { open(options) { calls++; latest = options; return pending ? new Promise(done => { resolve = done; }) : Promise.resolve({ activated: true, error: null }); },
    cancel() { cancels++; resolve?.({ activated: false, error: 'windows_voice_cancelled' }); }, dispose() {} };
  const f = fixture({ windowsVoiceBridge: bridge });
  f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
  let sequence = 0;
  return { ...f, get calls() { return calls; }, get cancels() { return cancels; }, get latest() { return latest; },
    press() { f.emit({ type: 'input', event: 'k1.down', sequence: ++sequence }); },
    release() { f.emit({ type: 'input', event: 'k1.up', sequence: ++sequence }); },
    gesture() { const e = f.device.events.findLast(item => item.event === 'k1.down'); return { generation: e.generation, sequence: e.sequence, context: e.context }; },
    cleanup() { f.device.dispose(); f.close(); } };
}

test('Windows voice needs explicit opt-in and a fresh actual single-use K1 down ticket', async () => {
  const f = voiceFixture();
  try {
    f.device.poll(owner, { context }); f.press();
    assert.equal((await f.device.windowsVoice(owner, f.gesture())).error, 'windows_voice_not_enabled');
    f.release(); f.device.poll(owner, { context, windowsVoice: true });
    assert.equal((await f.device.windowsVoice(owner, f.gesture())).error, 'windows_voice_invalid_gesture');
    f.press(); const gesture = f.gesture(); f.release();
    assert.equal((await f.device.windowsVoice(other, gesture)).error, 'windows_voice_not_enabled');
    assert.equal((await f.device.windowsVoice(owner, { ...gesture, sequence: 999 })).error, 'windows_voice_invalid_gesture');
    assert.deepEqual(await f.device.windowsVoice(owner, gesture), { activated: true, error: null });
    assert.equal(f.calls, 1); assert.equal(f.latest.isCurrent(), true);
    assert.equal((await f.device.windowsVoice(owner, gesture)).error, 'windows_voice_invalid_gesture');
    f.press(); f.advance(1001);
    assert.equal((await f.device.windowsVoice(owner, f.gesture())).error, 'windows_voice_expired');
    assert.equal(f.calls, 1);
  } finally { f.cleanup(); }
});

test('held K1 cannot manufacture new Windows voice tickets until release', async () => {
  const f = voiceFixture();
  try {
    f.device.poll(owner, { context, windowsVoice: true }); f.press(); const first = f.gesture();
    await f.device.windowsVoice(owner, first); f.press();
    assert.equal((await f.device.windowsVoice(owner, f.gesture())).error, 'windows_voice_invalid_gesture');
    assert.equal(f.calls, 1); f.release(); f.press();
    assert.equal((await f.device.windowsVoice(owner, f.gesture())).activated, true); assert.equal(f.calls, 2);
  } finally { f.cleanup(); }
});

for (const cause of ['context', 'opt-out', 'stop', 'abort', 'dispose', 'new-press']) {
  test(`pending Windows voice is invalidated by ${cause}, before fixed-key commit`, async () => {
    const f = voiceFixture({ pending: true });
    try {
      f.device.poll(owner, { context, windowsVoice: true }); f.press();
      const abort = new AbortController();
      const request = f.device.windowsVoice(owner, f.gesture(), { signal: abort.signal });
      assert.equal(f.calls, 1); assert.equal(f.latest.isCurrent(), true);
      if (cause === 'context') f.device.poll(owner, { context: other, windowsVoice: true });
      if (cause === 'opt-out') f.device.poll(owner, { context });
      if (cause === 'stop') f.device.stop(owner);
      if (cause === 'abort') abort.abort();
      if (cause === 'dispose') f.device.dispose();
      if (cause === 'new-press') { f.release(); f.press(); }
      assert.equal(f.latest.isCurrent(), false);
      assert.equal((await request).error, 'windows_voice_cancelled');
    } finally { f.cleanup(); }
  });
}

function shortcutFixture({ pending = false } = {}) {
  let calls = 0, latest, resolve;
  const bridge = { open(options) { calls++; latest = options; return pending ? new Promise(done => { resolve = done; }) : Promise.resolve({ activated: true, error: null }); },
    cancel() { resolve?.({ activated: false, error: 'shortcut_voice_cancelled' }); }, dispose() {} };
  const f = fixture({ shortcutVoiceBridge: bridge });
  f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
  let sequence = 0;
  return { ...f, get calls() { return calls; }, get latest() { return latest; },
    press() { f.emit({ type: 'input', event: 'k1.down', sequence: ++sequence }); },
    release() { f.emit({ type: 'input', event: 'k1.up', sequence: ++sequence }); },
    gesture() { const event = f.device.events.findLast(item => item.event === 'k1.down'); return { generation: event.generation, sequence: event.sequence, context: event.context }; },
    cleanup() { f.device.dispose(); f.close(); } };
}

test('shortcut voice requires explicit mutually exclusive opt-in, fresh real K1 ticket and a bounded chord', async () => {
  const f = shortcutFixture();
  try {
    assert.throws(() => f.device.poll(owner, { context, windowsVoice: true, shortcutVoice: true }), /invalid_request/);
    assert.throws(() => f.device.poll(owner, { context, shortcutVoice: 'true' }), /invalid_request/);
    f.device.poll(owner, { context }); f.press();
    assert.equal((await f.device.shortcutVoice(owner, f.gesture(), { shortcut: 'RightAlt' })).error, 'shortcut_voice_not_enabled');
    f.release(); f.device.poll(owner, { context, shortcutVoice: true });
    assert.equal((await f.device.shortcutVoice(owner, f.gesture(), { shortcut: 'RightAlt' })).error, 'shortcut_voice_invalid_gesture');
    f.press(); const gesture = f.gesture(); f.release();
    assert.equal((await f.device.windowsVoice(owner, gesture)).error, 'windows_voice_not_enabled');
    assert.equal((await f.device.shortcutVoice(other, gesture, { shortcut: 'RightAlt' })).error, 'shortcut_voice_not_enabled');
    assert.equal((await f.device.shortcutVoice(owner, gesture, { shortcut: 'Alt+F4' })).error, 'shortcut_voice_invalid_shortcut');
    assert.equal(f.calls, 0);
    assert.deepEqual(await f.device.shortcutVoice(owner, gesture, { shortcut: 'shift+ctrl+Space' }), { activated: true, error: null });
    assert.equal(f.latest.shortcut, 'Ctrl+Shift+Space'); assert.equal(f.latest.isCurrent(), true);
    assert.equal((await f.device.shortcutVoice(owner, gesture, { shortcut: 'RightAlt' })).error, 'shortcut_voice_invalid_gesture');
    assert.equal(f.calls, 1);
    f.press(); f.advance(1001);
    assert.equal((await f.device.shortcutVoice(owner, f.gesture(), { shortcut: 'RightAlt' })).error, 'shortcut_voice_expired');
    assert.equal(f.calls, 1);
  } finally { f.cleanup(); }
});

test('held K1 does not generate repeated shortcut tickets or fire on release', async () => {
  const f = shortcutFixture();
  try {
    f.device.poll(owner, { context, shortcutVoice: true }); f.press();
    assert.equal((await f.device.shortcutVoice(owner, f.gesture(), { shortcut: 'RightAlt' })).activated, true);
    f.press(); assert.equal((await f.device.shortcutVoice(owner, f.gesture(), { shortcut: 'RightAlt' })).error, 'shortcut_voice_invalid_gesture');
    f.release(); assert.equal(f.calls, 1); f.press();
    assert.equal((await f.device.shortcutVoice(owner, f.gesture(), { shortcut: 'RightAlt' })).activated, true); assert.equal(f.calls, 2);
  } finally { f.cleanup(); }
});

for (const cause of ['context', 'opt-out', 'switch-windows', 'stop', 'abort', 'dispose', 'new-press']) {
  test(`pending shortcut voice is cancelled by ${cause} without sending a speculative stop chord`, async () => {
    const f = shortcutFixture({ pending: true });
    try {
      f.device.poll(owner, { context, shortcutVoice: true }); f.press();
      const abort = new AbortController();
      const request = f.device.shortcutVoice(owner, f.gesture(), { shortcut: 'RightAlt' }, { signal: abort.signal });
      assert.equal(f.calls, 1); assert.equal(f.latest.isCurrent(), true);
      if (cause === 'context') f.device.poll(owner, { context: other, shortcutVoice: true });
      if (cause === 'opt-out') f.device.poll(owner, { context });
      if (cause === 'switch-windows') f.device.poll(owner, { context, windowsVoice: true });
      if (cause === 'stop') f.device.stop(owner);
      if (cause === 'abort') abort.abort();
      if (cause === 'dispose') f.device.dispose();
      if (cause === 'new-press') { f.release(); f.press(); }
      assert.equal(f.latest.isCurrent(), false);
      assert.equal((await request).error, 'shortcut_voice_cancelled'); assert.equal(f.calls, 1);
    } finally { f.cleanup(); }
  });
}

test('switching external voice kind cannot replay the previous kind ticket', async () => {
  const f = shortcutFixture();
  try {
    f.device.poll(owner, { context, shortcutVoice: true }); f.press(); const gesture = f.gesture();
    f.device.poll(owner, { context, windowsVoice: true });
    assert.equal((await f.device.windowsVoice(owner, gesture)).error, 'windows_voice_invalid_gesture');
    assert.equal((await f.device.shortcutVoice(owner, gesture, { shortcut: 'RightAlt' })).error, 'shortcut_voice_not_enabled');
    assert.equal(f.calls, 0);
  } finally { f.cleanup(); }
});

test('native malformed or non-monotonic input fails closed without emitting an action', () => {
  const f = fixture(); f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
  f.emit({ type: 'input', event: 'k3.down', sequence: 1 });
  f.emit({ type: 'input', event: 'k3.down', sequence: 1 });
  assert.equal(f.device.snapshot().state, 'protocol_error'); assert.equal(f.device.snapshot().stopping, true); assert.equal(f.device.events.length, 0);
  f.close(); f.device.dispose();
});

test('brightness flows to native, deduplicates, resets on omission and never accepts a stale ack', () => {
  const f = fixture();
  try {
    f.device.connect(owner); f.emit({ type: 'status', state: 'ready' });
    assert.equal(Object.hasOwn(f.commands.at(-1), 'brightness'), false);
    f.device.poll(owner, { light: 'running', brightness: 0 });
    assert.equal(f.commands.at(-1).brightness, 0);
    const old = f.commands.at(-1).requestId, count = f.commands.length;
    f.device.poll(owner, { light: 'running', brightness: 0 }); assert.equal(f.commands.length, count);
    f.device.poll(owner, { light: 'running', brightness: 255 });
    assert.equal(f.commands.at(-1).brightness, 255); assert.equal(f.commands.at(-1).requestId, old + 1);
    f.emit({ type: 'lights', state: 'running', requestId: old, result: 'verified' });
    assert.equal(f.device.snapshot().lightResult, 'not_requested');
    f.emit({ type: 'lights', state: 'running', requestId: old + 1, result: 'verified' });
    assert.equal(f.device.snapshot().lightResult, 'verified');
    f.device.poll(owner, { light: 'running', brightness: 255, lights: false });
    assert.deepEqual(f.commands.at(-1).channels, [0, 0, 0, 0]); assert.equal(f.commands.at(-1).brightness, 255);
    f.device.poll(owner, { light: 'running' }); assert.equal(Object.hasOwn(f.commands.at(-1), 'brightness'), false);
    for (const brightness of [-1, 256, 1.5, NaN, Infinity, null, true, '2']) assert.throws(() => f.device.poll(owner, { brightness }), /invalid_request/);
  } finally { f.device.dispose(); f.close(); }
});
