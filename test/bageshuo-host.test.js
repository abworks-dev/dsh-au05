import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeviceController } from '../packages/dsh-plugin/host/device-controller.js';
import { bageshuoSnapshot, pollOptions, parseDeviceSnapshot } from '../packages/dsh-plugin/host/rpc.js';
const OWNER = 'bageshuo_test_owner_0001', OTHER = 'bageshuo_other_owner_01';
function fixture() {
  const child = new EventEmitter(), writes = [];
  child.stdout = new EventEmitter(); child.stdin = new EventEmitter();
  Object.assign(child.stdin, { writable: true, destroyed: false, write(text) { writes.push(JSON.parse(text)); return true; }, end() { child.emit('close', 0); } });
  child.kill = () => { child.emit('close', 0); };
  const observer = { value: { state: 'stopped', error: null }, starts: 0, stops: 0, disposals: 0,
    start() { this.starts++; this.value = { state: 'idle', error: null }; return this.snapshot(); },
    snapshot() { return { ...this.value }; },
    stop() { this.stops++; this.value = { state: 'stopped', error: null }; return this.snapshot(); },
    dispose() { this.disposals++; this.stop(); } };
  const bridge = { cancel() {}, dispose() {}, async open() { return { activated: true, error: null }; } };
  const controller = new DeviceController({ platform: 'win32', spawnChild: () => child,
    windowsVoiceBridge: bridge, shortcutVoiceBridge: bridge, bageshuoStateObserver: observer,
    modeLease: { acquire: () => true, release() {} } });
  const ready = () => { controller.connect(OWNER); child.stdout.emit('data', Buffer.from('{"type":"status","state":"ready"}\n')); };
  return { controller, observer, child, writes, ready };
}
const armed = { context: OWNER, shortcutVoice: true, bageshuoState: true, lights: true, light: 'recording', channels: [2, 2, 2, 1] };

test('proven not-sent acknowledgement survives context cancellation but not owner or connection changes', async () => {
  const f = fixture();
  let finish;
  f.controller.shortcutVoiceBridge = { cancel() {}, dispose() {}, open: () => new Promise(resolve => { finish = resolve; }) };
  try {
    f.ready(); f.controller.poll(OWNER, armed);
    const generation = f.controller.generation;
    const gesture = { generation, sequence: 1, context: OWNER };
    f.controller.sequence = 1;
    f.controller.voiceTicket = { ...gesture, kind: 'shortcut', at: f.controller.now(), consumed: false };
    const operation = f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' });
    f.controller.poll(OWNER, { ...armed, context: OTHER });
    finish({ activated: false, error: 'shortcut_voice_cancelled', notSent: true });
    await operation;
    const outcome = { generation, sequence: 1, notSent: true };
    const polled = f.controller.poll(OWNER, { ...armed, context: OTHER });
    assert.equal(polled.shortcutRecovery, true);
    assert.equal(parseDeviceSnapshot(polled, true).shortcutRecovery, true);
    assert.equal(f.controller.snapshot().shortcutRecovery, undefined);
    for (const shortcutRecovery of [false, undefined, null, 1])
      assert.throws(() => parseDeviceSnapshot({ ...polled, shortcutRecovery }, true));
    assert.deepEqual(polled.shortcutOutcome, outcome);
    assert.deepEqual(parseDeviceSnapshot(polled, true).shortcutOutcome, outcome);
    assert.equal(f.controller.snapshot().shortcutOutcome, undefined);
    assert.throws(() => f.controller.poll(OTHER, armed), /not_owner/);
    f.controller.generation++;
    assert.equal(f.controller.poll(OWNER, armed).shortcutOutcome, undefined);
    f.controller.generation = generation;
    f.controller.stop(OWNER);
    assert.equal(f.controller.shortcutOutcome, null);
  } finally { f.controller.dispose(); }
});

test('duplicate shortcut gesture cannot acknowledge uncertain after-go cancellation even after ticket loss', async () => {
  const f = fixture(); let finish;
  f.controller.shortcutVoiceBridge = { cancel() {}, dispose() {}, open: () => new Promise(resolve => { finish = resolve; }) };
  try {
    f.ready(); f.controller.poll(OWNER, armed);
    const gesture = { generation: f.controller.generation, sequence: 1, context: OWNER };
    f.controller.sequence = 1;
    f.controller.voiceTicket = { ...gesture, kind: 'shortcut', at: f.controller.now(), consumed: false };
    const first = f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' });
    const duplicate = await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' });
    assert.equal(duplicate.notSent, undefined);
    f.controller.poll(OWNER, { context: OTHER });
    finish({ activated: false, error: 'shortcut_voice_cancelled' });
    assert.equal((await first).notSent, undefined);
    for (const shortcut of ['RightAlt', 'invalid']) {
      assert.equal((await f.controller.shortcutVoice(OWNER, gesture, { shortcut })).notSent, undefined);
      assert.equal(f.controller.poll(OWNER, { context: OTHER }).shortcutOutcome, undefined);
    }
    f.controller.stop(OWNER);
    f.controller.connect(OWNER);
    assert.equal(f.controller.shortcutDispatchedSequence, 0);
  } finally { f.controller.dispose(); }
});

test('lost predispatch ticket rejection is recoverable only for the pinned owner and existing event generation', async () => {
  const f = fixture();
  try {
    f.ready(); f.controller.poll(OWNER, armed);
    const generation = f.controller.generation;
    f.controller.sequence = 1;
    const gesture = { generation, sequence: 1, context: OWNER };
    f.controller.poll(OWNER, { ...armed, context: OTHER });
    for (const [owner, request] of [[OTHER, gesture], [OWNER, { ...gesture, generation: generation + 1 }],
      [OWNER, { ...gesture, sequence: 2 }]]) {
      await f.controller.shortcutVoice(owner, request, { shortcut: 'RightAlt' });
      assert.equal(f.controller.poll(OWNER, { ...armed, context: OTHER }).shortcutOutcome, undefined);
    }
    const result = await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' });
    assert.deepEqual(result, { activated: false, error: 'shortcut_voice_invalid_gesture', notSent: true });
    assert.deepEqual(f.controller.poll(OWNER, { ...armed, context: OTHER }).shortcutOutcome,
      { generation, sequence: 1, notSent: true });
    f.controller.shortcutOutcome = null;
    f.controller.poll(OWNER, { context: OTHER });
    await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' });
    assert.deepEqual(f.controller.poll(OWNER, { context: OTHER }).shortcutOutcome,
      { generation, sequence: 1, notSent: true });
  } finally { f.controller.dispose(); }
});

test('late not-sent completion cannot repopulate outcome after connection generation changes', async () => {
  const f = fixture(); let finish;
  f.controller.shortcutVoiceBridge = { cancel() {}, dispose() {}, open: () => new Promise(resolve => { finish = resolve; }) };
  try {
    f.ready(); f.controller.poll(OWNER, armed);
    const gesture = { generation: f.controller.generation, sequence: 1, context: OWNER };
    f.controller.sequence = 1;
    f.controller.voiceTicket = { ...gesture, kind: 'shortcut', at: f.controller.now(), consumed: false };
    const operation = f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' });
    f.controller.generation++;
    finish({ activated: false, error: 'shortcut_voice_cancelled', notSent: true }); await operation;
    assert.equal(f.controller.poll(OWNER, armed).shortcutOutcome, undefined);
  } finally { f.controller.dispose(); }
});

test('Bageshuo codec is closed and copies only status, never identity or audio', () => {
  for (const state of ['stopped', 'starting', 'idle', 'recording']) assert.deepEqual(bageshuoSnapshot({ state, error: null }), { state, error: null });
  for (const state of ['unknown', 'error']) assert.deepEqual(bageshuoSnapshot({ state, error: 'capture_unknown' }), { state, error: 'capture_unknown' });
  assert.deepEqual(bageshuoSnapshot({ state: 'unknown', error: 'observer_recovering' }), { state: 'unknown', error: 'observer_recovering' });
  assert.deepEqual(bageshuoSnapshot({ state: 'error', error: 'observer_start_timeout' }), { state: 'error', error: 'observer_start_timeout' });
  assert.throws(() => bageshuoSnapshot({ state: 'error', error: 'observer_recovering' }));
  for (const value of [null, [], {}, { state: 'recording', error: null, pid: 123 }, { state: 'recording', error: 'capture_unknown' },
    { state: 'unknown', error: null }, { state: 'recording', error: null, audio: [] }, { state: 'error', error: 'arbitrary' },
    Object.assign(Object.create({ secret: true }), { state: 'idle', error: null })]) assert.throws(() => bageshuoSnapshot(value));
  assert.equal(pollOptions({ bageshuoState: true }).bageshuoState, true);
  for (const value of ['true', null, 1]) assert.throws(() => pollOptions({ bageshuoState: value }));
});

test('observer requires explicit current owner, ready device, shortcut and observation opt-in', () => {
  const f = fixture();
  try {
    assert.equal(f.observer.starts, 0);
    f.ready();
    assert.throws(() => f.controller.poll(OTHER, armed), /not_owner/);
    assert.equal(f.observer.starts, 0);
    f.controller.poll(OWNER, { ...armed, shortcutVoice: false });
    f.controller.poll(OWNER, { ...armed, bageshuoState: false });
    assert.equal(f.observer.starts, 0);
    const result = f.controller.poll(OWNER, armed);
    assert.equal(f.observer.starts, 1);
    assert.deepEqual(result.bageshuo, { state: 'idle', error: null });
    assert.deepEqual(parseDeviceSnapshot(f.controller.snapshot()).bageshuo, result.bageshuo);
    assert.deepEqual(f.writes.at(-1).channels, [0, 2, 2, 1], 'requested K1 cannot impersonate actual capture');
  } finally { f.controller.dispose(); }
});

test('only trusted actual recording permits K1; errors latch without retry and keep task lamps', () => {
  const f = fixture();
  try {
    f.ready(); f.controller.poll(OWNER, armed);
    f.observer.value = { state: 'recording', error: null };
    f.controller.poll(OWNER, armed);
    assert.deepEqual(f.writes.at(-1).channels, [2, 2, 2, 1]);
    f.observer.value = { state: 'error', error: 'target_exited' };
    f.controller.poll(OWNER, armed); f.controller.poll(OWNER, armed);
    assert.deepEqual(f.writes.at(-1).channels, [0, 2, 2, 1]);
    assert.equal(f.observer.starts, 1, 'polling must not rediscover a restarted app');
    f.controller.poll(OWNER, { ...armed, bageshuoState: false, channels: [0, 2, 2, 1] });
    assert.equal(f.controller.snapshot().bageshuo, undefined);
    f.controller.poll(OWNER, armed);
    assert.equal(f.observer.starts, 2, 'a new explicit opt-in is a new observation generation');
  } finally { f.controller.dispose(); }
});

test('recovery revokes K1 only, then follows real capture without observer restart or shortcut', () => {
  const f = fixture();
  try {
    f.ready(); f.controller.poll(OWNER, armed);
    f.observer.value = { state: 'recording', error: null };
    f.controller.poll(OWNER, armed);
    f.observer.value = { state: 'unknown', error: 'observer_recovering' };
    const recovering = f.controller.poll(OWNER, armed);
    assert.deepEqual(parseDeviceSnapshot(recovering, true).bageshuo, f.observer.value);
    assert.deepEqual(f.writes.at(-1).channels, [0, 2, 2, 1]);
    assert.equal(f.controller.bageshuoKnown(), false);
    f.observer.value = { state: 'recording', error: null };
    f.controller.poll(OWNER, armed);
    assert.deepEqual(f.writes.at(-1).channels, [2, 2, 2, 1]);
    assert.equal(f.controller.bageshuoKnown(), true);
    assert.equal(f.observer.starts, 1);
    assert.equal(f.writes.some(command => command.type === 'shortcut'), false);
  } finally { f.controller.dispose(); }
});

test('disconnect and disposal revoke observation without opening or toggling external recording', () => {
  const f = fixture();
  f.ready(); f.controller.poll(OWNER, armed);
  const stops = f.observer.stops;
  f.controller.stop(OWNER);
  assert.ok(f.observer.stops > stops);
  assert.equal(f.controller.snapshot().bageshuo, undefined);
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.observer.disposals, 1);
  assert.equal(f.writes.some(command => command.type === 'shortcut'), false);
});
