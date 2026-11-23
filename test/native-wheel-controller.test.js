import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeviceController, NATIVE_WHEEL_ERRORS } from '../packages/dsh-plugin/host/device-controller.js';
import { pollOptions, nativeScrollResult, voiceGesture, descriptors } from '../packages/dsh-plugin/host/rpc.js';

const owner = 'owner_123456789012', context = 'context_1234567890';
class FakeChild extends EventEmitter {
  constructor() { super(); this.stdout = new EventEmitter(); this.stdin = new EventEmitter(); Object.assign(this.stdin, { writable: true, write() { return true; }, end() {} }); }
  input(value) { this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
  kill() { this.emit('close'); }
}
function fixture(t, enabled = true) {
  let now = 1000, sequence = 0;
  const child = new FakeChild(), calls = [];
  const bridge = { starts: 0, cancels: 0, disposed: false, start() { this.starts++; }, cancel() { this.cancels++; }, dispose() { this.disposed = true; }, async dispatch(request) { calls.push(request); return { scrolled: request.isCurrent(), error: request.isCurrent() ? null : 'native_wheel_cancelled' }; } };
  const controller = new DeviceController({ platform: 'win32', now: () => now, spawnChild: () => child, nativeWheelBridge: bridge, modeLease: { acquire: () => true, release() {} }, schedule: () => ({ unref() {} }), cancel() {} });
  t.after(() => { controller.dispose(); child.emit('close'); });
  controller.connect(owner); child.input({ type: 'status', state: 'ready' });
  const poll = (options = {}) => controller.poll(owner, { context, nativeScroll: enabled, ...options });
  poll();
  const pulse = (event = 'right.pulse') => { child.input({ type: 'input', event, sequence: ++sequence }); return { generation: controller.generation, sequence: controller.sequence, context: controller.context }; };
  return { controller, child, bridge, calls, poll, pulse, time(value) { now = value; } };
}
test('native tickets require actual pulses, are single-use and preserve fixed direction across fast turns', async t => {
  const f = fixture(t);
  assert.equal(f.bridge.starts, 1); assert.equal(f.calls.length, 0);
  assert.equal((await f.controller.nativeScroll(owner, { generation: 1, sequence: 1, context })).error, 'native_wheel_invalid_gesture');
  const gestures = Array.from({ length: 20 }, (_, i) => f.pulse(i % 2 ? 'left.pulse' : 'right.pulse'));
  for (const gesture of gestures) assert.equal((await f.controller.nativeScroll(owner, gesture)).scrolled, true);
  assert.deepEqual(f.calls.map(x => x.direction), Array.from({ length: 20 }, (_, i) => i % 2 ? 'up' : 'down'));
  assert.equal(f.calls[0].expiresAt, 1500);
  assert.equal((await f.controller.nativeScroll(owner, gestures[0])).scrolled, false);
  const nonWheel = f.pulse('knob.down'); assert.equal((await f.controller.nativeScroll(owner, nonWheel)).scrolled, false);
});
test('rejects forged shape, stale generation/context, clock reversal and exact expiration', async t => {
  const f = fixture(t), g = f.pulse();
  for (const bad of [{ ...g, direction: 'up' }, { ...g, generation: 2 }, { ...g, context: 'another_1234567890' }]) assert.equal((await f.controller.nativeScroll(owner, bad)).scrolled, false);
  f.time(999); assert.equal((await f.controller.nativeScroll(owner, g)).error, 'native_wheel_expired');
  f.time(1500); assert.equal((await f.controller.nativeScroll(owner, g)).error, 'native_wheel_expired');
  assert.equal(f.calls.length, 0);
});
test('map bounded at 256 and disabled cannot mint authorization', async t => {
  const f = fixture(t, false); const disabled = f.pulse();
  assert.equal((await f.controller.nativeScroll(owner, disabled)).error, 'native_wheel_not_enabled');
  f.poll({ nativeScroll: true });
  const first = f.pulse(); for (let i = 0; i < 256; i++) f.pulse();
  assert.equal(f.controller.nativeWheelTickets.size, 256);
  assert.equal((await f.controller.nativeScroll(owner, first)).scrolled, false);
});
test('pending commit guard revokes on context, disable, owner, stop, dispose and abort without touching voice', async t => {
  for (const change of ['context', 'disable', 'owner', 'stop', 'dispose', 'abort']) {
    const f = fixture(t), g = f.pulse(), abort = new AbortController(); let request, finish;
    f.bridge.dispatch = value => { request = value; return new Promise(resolve => { finish = resolve; }); };
    f.controller.voiceTicket = { marker: true };
    const pending = f.controller.nativeScroll(owner, g, { signal: abort.signal });
    assert.equal(request.isCurrent(), true);
    if (change === 'context') f.poll({ context: 'another_1234567890' });
    if (change === 'disable') f.poll({ nativeScroll: false });
    if (change === 'owner') f.controller.owner = 'another_1234567890';
    if (change === 'stop') f.controller.stop(owner);
    if (change === 'dispose') f.controller.dispose();
    if (change === 'abort') { abort.abort(); assert.deepEqual(f.controller.voiceTicket, { marker: true }); }
    assert.equal(request.isCurrent(), false);
    finish({ scrolled: false, error: 'native_wheel_cancelled' }); assert.equal((await pending).scrolled, false);
  }
});
test('wrong owner/preaborted never dispatch; helper failure does not disconnect HID', async t => {
  const f = fixture(t), g = f.pulse();
  assert.equal((await f.controller.nativeScroll('another_1234567890', g)).scrolled, false);
  const abort = new AbortController(); abort.abort();
  assert.equal((await f.controller.nativeScroll(owner, g, { signal: abort.signal })).error, 'native_wheel_cancelled');
  f.bridge.dispatch = async () => { throw Error('private helper detail'); };
  assert.equal((await f.controller.nativeScroll(owner, g)).error, 'native_wheel_native_failed');
  assert.equal(f.controller.state, 'ready');
});
test('generation replacement and context changes clear old tickets; reenable warms only once', async t => {
  const f = fixture(t), g = f.pulse();
  f.poll(); assert.equal(f.bridge.starts, 1);
  f.poll({ context: 'another_1234567890' }); assert.equal(f.bridge.starts, 2);
  assert.equal(f.controller.nativeWheelTickets.size, 0);
  assert.equal((await f.controller.nativeScroll(owner, g)).scrolled, false);
  f.poll({ nativeScroll: false }); f.poll(); assert.equal(f.bridge.starts, 3);
  const next = f.pulse(); f.controller.generation++;
  assert.equal((await f.controller.nativeScroll(owner, next)).scrolled, false);
  assert.equal(f.calls.length, 0);
});
test('late helper success cannot survive abort or generation replacement', async t => {
  const f = fixture(t), abort = new AbortController(); let finish;
  f.bridge.dispatch = () => new Promise(resolve => { finish = resolve; });
  const pending = f.controller.nativeScroll(owner, f.pulse(), { signal: abort.signal });
  abort.abort(); finish({ scrolled: true, error: null });
  assert.deepEqual(await pending, { scrolled: false, error: 'native_wheel_cancelled' });
});
test('only a fresh physical ticket rearms a stopped helper; no old or rearm ticket is replayed', async t => {
  const f = fixture(t), old = f.pulse();
  f.bridge.dispatch = async request => { f.calls.push(request); f.bridge.state = 'stopped'; return { scrolled: false, error: 'native_wheel_expired' }; };
  assert.equal((await f.controller.nativeScroll(owner, old)).error, 'native_wheel_expired');
  f.poll(); assert.equal(f.bridge.starts, 1);
  assert.equal((await f.controller.nativeScroll(owner, old)).error, 'native_wheel_invalid_gesture');
  f.bridge.start = function () { this.starts++; this.state = 'ready'; };
  const rearm = f.pulse();
  assert.equal((await f.controller.nativeScroll(owner, rearm)).error, 'native_wheel_not_ready');
  assert.equal(f.bridge.starts, 2); assert.equal(f.calls.length, 1);
  assert.equal((await f.controller.nativeScroll(owner, rearm)).error, 'native_wheel_invalid_gesture');
  f.bridge.dispatch = async request => { f.calls.push(request); return { scrolled: request.isCurrent(), error: null }; };
  assert.equal((await f.controller.nativeScroll(owner, f.pulse())).scrolled, true);
  assert.equal(f.calls.length, 2);
});

test('RPC closed options/gesture/result codecs and nativeScroll descriptor', () => {
  assert.equal(pollOptions({}).nativeScroll, false); assert.equal(pollOptions({ nativeScroll: true }).nativeScroll, true);
  assert.throws(() => pollOptions({ nativeScroll: 1 }));
  assert.throws(() => voiceGesture({ generation: 1, sequence: 1, context, direction: 'down' }));
  for (const error of NATIVE_WHEEL_ERRORS) assert.deepEqual(nativeScrollResult({ scrolled: false, error }), { scrolled: false, error });
  for (const value of [{ scrolled: true, error: 'native_wheel_cancelled' }, { scrolled: false, error: null }, { scrolled: false, error: 'native_wheel_secret' }, { scrolled: true, error: null, extra: true }]) assert.throws(() => nativeScrollResult(value));
  assert.deepEqual(nativeScrollResult({ scrolled: true, error: null }), { scrolled: true, error: null });
  assert.ok(descriptors.some(x => x.method === 'nativeScroll'));
});
