// New product-client tests. All actions, Host RPC, time, focus and microphone APIs are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createVoiceAdapter } from '../packages/dsh-plugin/src/voice.js';

const source = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
const flush = async () => { for (let index = 0; index < 48; index++) await Promise.resolve(); };
const find = (tree, predicate) => {
  if (!Array.isArray(tree)) return undefined;
  if (predicate(tree)) return tree;
  for (const child of tree.slice(2)) { const found = find(child, predicate); if (found) return found; }
};
const node = (tree, marker) => find(tree, item => item[1]?.[marker] === '');
function store(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of listeners) fn(); }, listeners };
}
test('identical region polls retain subscribed snapshot and notify only semantic changes', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('regions'); await ui.connect(); await ui.poll();
  let notifications = 0;
  const stop = ui.controller.subscribe(() => notifications++); t.after(stop);
  const original = ui.controller.getSnapshot(), at = original.lightObservation.at;
  for (let index = 0; index < 100; index++) {
    ui.advance(16); await ui.tick(); await ui.poll();
    assert.equal(ui.controller.getSnapshot(), original, 'no unnotified snapshot replacement');
  }
  assert.equal(notifications, 0);
  assert.equal(ui.controller.getSnapshot().lightObservation.at, at, 'sample time means last semantic publication, not latest poll');
  await ui.tick(); await ui.poll([], { lightResult: 'mismatch' });
  assert.equal(notifications, 1); assert.equal(ui.controller.getSnapshot().lightResult, 'mismatch');
  const trace = [{ at: 1, type: 'request', requestId: 1, state: 'idle', channels: [0, 0, 0, 0], result: 'pending' }];
  await ui.tick(); await ui.poll([], { lightResult: 'mismatch', lightTrace: trace });
  assert.equal(notifications, 2);
  await ui.tick(); await ui.poll([], { lightResult: 'mismatch', lightTrace: trace.map(row => ({ ...row, channels: [...row.channels] })) });
  assert.equal(notifications, 2, 'equal bounded trace copies do not publish');
  await ui.tick(); await ui.poll([], { lightResult: 'mismatch', lightTrace: [{ ...trace[0], requestId: 2 }] });
  assert.equal(notifications, 3, 'new trace identity fields publish immediately');
  await ui.tick(); await ui.poll([], { lightResult: 'failed', lightError: 'snapshot_unavailable' });
  assert.equal(notifications, 4); assert.equal(ui.controller.getSnapshot().lightError, 'snapshot_unavailable');
  const unknown = [{ ...trace[0], futureField: true }];
  for (let index = 0; index < 2; index++) { await ui.tick(); await ui.poll([], { lightTrace: unknown }); }
  assert.equal(notifications, 6, 'unknown protocol fields fail open to publication, even with equal identity');
  const oversized = Array.from({ length: 33 }, () => ({ ...trace[0] }));
  for (let index = 0; index < 2; index++) { await ui.tick(); await ui.poll([], { lightTrace: oversized }); }
  assert.equal(notifications, 8, 'oversized trace never incurs an unbounded deep comparison');
  let reads = 0;
  const accessor = { ...trace[0], get requestId() { reads++; return 1; } };
  for (let index = 0; index < 2; index++) { await ui.tick(); await ui.poll([], { lightTrace: [accessor] }); }
  assert.equal(notifications, 10); assert.equal(reads, 0, 'comparison never invokes nested accessors');
});

test('device vector shows four radial knob marks at top right bottom and left', t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const grip = node(ui.render(), 'data-au05-knob-grip');
  assert.ok(grip);
  assert.deepEqual(grip.slice(2).map(mark => mark[1].d),
    ['M512 420v22', 'M620 550h22', 'M512 658v22', 'M382 550h22']);
});

test('warm lamp rings follow latest device readback rather than requested channels without hardware side effects', t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const snapshot = ui.snapshot(), channels = [2, 0, 1, 1];
  const request = { type: 'request', requestId: 7, channels, result: 'pending' };
  const observed = { mode: 2, lights: channels.flatMap(value => [value, 255, 2, 21, 21]) };
  const result = { type: 'result', requestId: 7, channels, result: 'verified',
    readback: { stage: 'post_write', matched: 1, comparison: { observed } } };
  const ready = () => Object.assign(snapshot, { state: 'ready', connected: true, lightsEnabled: true,
    lightResult: 'verified', lightError: null, lightBrightness: null, lightTrace: [request, result],
    lightObservation: { lightsEnabled: true, channels: [...channels] } });
  const modes = () => ['k1', 'k2', 'k3', 'knob'].map(control => find(ui.render(), item => item[1]?.['data-au05-lamp'] === control)[1]['data-lamp-mode']);
  const before = ui.calls.length;
  ready(); assert.deepEqual(modes(), channels);
  assert.equal(node(ui.render(), 'data-au05-lamp-echo-note'), undefined);
  for (const patch of [{ connected: false }, { state: 'connecting' },
    { lightResult: 'pending' }, { lightResult: 'written' }, { lightResult: 'failed' },
    { lightError: 'snapshot_unavailable' }, { transport: 'studio' },
    { lightTrace: [request, result, { ...request, requestId: 8 }] },
    { lightTrace: [request, { ...result, readback: undefined }] },
    { lightTrace: [request, { ...result, readback: { ...result.readback, stage: 'initial' } }] }]) {
    ready(); delete snapshot.transport; Object.assign(snapshot, patch);
    assert.deepEqual(modes(), [0, 0, 0, 0]);
    assert.equal(node(ui.render(), 'data-au05-lamp-echo-note'), undefined);
  }
  ready(); delete snapshot.transport;
  snapshot.lightObservation.channels = [0, 0, 0, 0];
  assert.deepEqual(modes(), channels, 'Host-observed Windows K1 overrides browser desired channels');
  snapshot.lightsEnabled = false; snapshot.lightBrightness = 0;
  assert.deepEqual(modes(), channels, 'requested off must not replace the actual returned state');
  snapshot.lightResult = 'mismatch';
  snapshot.lightTrace = [request, { ...result, result: 'mismatch',
    readback: { ...result.readback, comparison: { observed: { mode: 2, lights: [1, 2, 0, 2].flatMap(value => [value, 255, 2, 0, 0]) } } } }];
  assert.deepEqual(modes(), [1, 2, 0, 2], 'mismatch displays observed, not expected, including raw brightness zero');
  for (const [mode, expected] of [[0, [0, 0, 0, 0]], [1, [1, 1, 1, 1]]]) {
    snapshot.lightTrace = [request, { ...result, readback: { ...result.readback, comparison: { observed: { ...observed, mode } } } }];
    assert.deepEqual(modes(), expected);
    assert.equal(node(ui.render(), 'data-au05-lamp-echo-note'), undefined);
  }
  ready();
  for (const control of ['knob', 'k1', 'k2', 'k3']) {
    assert.equal(find(ui.render(), item => item[1]?.['data-au05-control'] === control), undefined);
    assert.equal(find(ui.render(), item => item[1]?.['data-au05-selection-ring'] === control), undefined);
    const lamp = find(ui.render(), item => item[1]?.['data-au05-lamp'] === control);
    assert.equal(lamp[0], control === 'knob' ? 'circle' : 'rect');
    if (control === 'knob') assert.equal(lamp[1].r, 148);
    else { assert.equal(lamp[1].width, 214); assert.equal(lamp[1].height, 213); assert.equal(lamp[1].rx, 8); }
    const vector = node(ui.render(), 'data-au05-device-vector');
    for (const y of [747, 970, 1191]) {
      const key = find(vector, item => item[0] === 'rect' && item[1]?.y === y && item[1]?.fill === '#e7e9e8');
      assert.equal(key[1].stroke, '#a6aeb0'); assert.equal(key[1].strokeWidth, 3);
    }
    assert.ok(find(vector, item => item[0] === 'circle' && item[1]?.r === 154 && item[1]?.stroke === '#899396' && item[1]?.strokeWidth === 5));
  }
  assert.equal(ui.calls.length, before, 'rendering never sends a poll or hardware command');
  assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
  assert.match(source, /\.au05-lamp-echo \[data-au05-lamp\] \{ fill:none; stroke:#f5bd70/);
  assert.doesNotMatch(source, /data-au05-selection-ring|data-au05-control':/);
  assert.match(source, /prefers-reduced-motion:reduce/);
  assert.match(source, /@keyframes au05-lamp-breathe/);
  assert.match(source, /\[data-lamp-mode="2"\] \{ animation:au05-lamp-breathe 1\.5s ease-in-out infinite; \}/);
  assert.doesNotMatch(source, /\[data-lamp-mode="[01]"\] \{ animation:/);
  assert.match(source, /animation:none !important/);
});

test('key lamp status distinguishes unknown configuration, returned modes and explicit restoration without actions', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const text = (marker, control = 'k3') => find(ui.render(), item => item[1]?.[marker] === control)?.[2];
  assert.equal(text('data-au05-key-light'), '配置回读：未知');
  assert.equal(text('data-au05-key-request'), undefined);
  await ui.connect(); await ui.poll([], { lightResult: 'preserved' });
  assert.equal(node(ui.render(), 'data-au05-session')[2], '会话：待命');
  assert.equal(node(ui.render(), 'data-au05-task-lamp-state')[2], '灯光：保留设备原灯光，未写灯');
  assert.equal(text('data-au05-key-light'), '配置回读：未知', 'preserved does not contain per-key readback');
  assert.equal(text('data-au05-key-request'), undefined, 'a preservation acknowledgement is not a per-key readback');
  const snapshot = ui.snapshot(), channels = [0, 2, 2, 0];
  snapshot.lightTrace = [{ type: 'request', requestId: 1, channels }, { type: 'result', requestId: 1, result: 'verified',
    readback: { stage: 'post_write', matched: 1, comparison: { observed: { mode: 2, lights: channels.flatMap(mode => [mode, 255, 2, 21, 21]) } } } }];
  snapshot.lightResult = 'verified';
  const before = ui.calls.length;
  assert.equal(text('data-au05-key-light'), '配置回读：呼吸');
  assert.equal(text('data-au05-key-light', 'knob'), '配置回读：关闭');
  for (const result of ['pending', 'written', 'preserved', 'restored', 'failed']) {
    snapshot.lightResult = result;
    assert.equal(text('data-au05-key-light'), '配置回读：未知', result);
  }
  snapshot.lightResult = 'verified'; snapshot.connected = false;
  assert.equal(text('data-au05-key-light'), '配置回读：未知');
  assert.equal(ui.calls.length, before, 'reading status never sends hardware requests');
  assert.deepEqual(ui.actions, []); assert.equal(ui.tracks.length, 0);
});

test('enabled idle shows all-off only after current per-key readback, and opt-out never reuses that echo', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect(); await ui.poll();
  const snapshot = ui.snapshot(), channels = [0, 0, 0, 0];
  snapshot.lightResult = 'verified';
  snapshot.lightTrace = [{ type: 'request', requestId: 1, channels }, { type: 'result', requestId: 1, result: 'verified',
    readback: { stage: 'post_write', matched: 1, comparison: { observed: { mode: 2, lights: channels.flatMap(mode => [mode, 255, 2, 2, 2]) } } } }];
  const light = control => find(ui.render(), item => item[1]?.['data-au05-key-light'] === control)?.[2];
  for (const control of ['knob', 'k1', 'k2', 'k3']) {
    assert.equal(light(control), '配置回读：关闭');
    assert.equal(find(ui.render(), item => item[1]?.['data-au05-key-request'] === control), undefined);
  }
  node(ui.render(), 'data-au05-lights')[1].onChange({ target: { checked: false } });
  for (const control of ['knob', 'k1', 'k2', 'k3']) assert.equal(light(control), '配置回读：未知');
  assert.equal(node(ui.render(), 'data-au05-task-lamp-state')[2], '已请求恢复原灯光');
  assert.deepEqual(ui.actions, []); assert.equal(ui.tracks.length, 0);
});

test('per-key request reasons explain idle prompts, interruptible runs and background feedback without claiming light readback', async t => {
  const approval = { kind: 'approval', key: 'a', answerable: true, sessionId: 'first', answer() {} };
  const question = { kind: 'question', key: 'q', sessionId: 'first', getSnapshot: () => ({ state: 'open', closed: false, channel: 'rpc' }) };
  for (const [status, focused, expected] of [
    [{ pendingInteraction: approval }, true, '等待审批'],
    [{ pendingInteraction: question }, true, '等待回答'],
    [{ pendingInteraction: { ...question, kind: 'plan-review' } }, true, '等待审阅计划'],
    [{ running: true }, true, '可停止运行'],
    [{ running: true }, false, '可停止运行'],
  ]) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.status('first', status); ui.focus(focused);
    await ui.connect(); await ui.poll();
    const requestText = () => find(ui.render(), item => item[1]?.['data-au05-key-request'] === 'k3')?.[2];
    assert.equal(requestText(), `上次请求：呼吸 · ${expected}`);
    assert.equal(find(ui.render(), item => item[1]?.['data-au05-key-light'] === 'k3')[2], '配置回读：未知');
    assert.equal(ui.snapshot().lightObservationSessionId, 'first');
    await ui.tick();
    assert.equal('reasons' in ui.pollArgs().options, false, 'diagnostics never extend the Host command protocol');
    ui.select('second'); assert.equal(requestText(), undefined, 'old session reasons are hidden after selection changes');
    await ui.poll(); assert.equal(requestText(), undefined, 'late old-session poll replies cannot reintroduce the reason');
    assert.equal(ui.cancelled.first + ui.submitted.first + ui.cancelled.second + ui.submitted.second, 0);
    assert.equal(ui.tracks.length, 0);
  }
  const studio = harness({ studio: true }); t.after(() => studio.dispose()); studio.open();
  studio.status('first', { running: true }); await studio.connect(); await studio.poll();
  assert.equal(node(studio.render(), 'data-au05-task-lamp-state')[2], 'Studio 不提供灯光配置回读');
  assert.equal(find(studio.render(), item => item[1]?.['data-au05-key-light'] === 'k3'), undefined);
  assert.equal(find(studio.render(), item => item[1]?.['data-au05-key-request'] === 'k3'), undefined, 'Studio never advertises Direct task lamp requests');
});

test('knob rotation follows signed pulses in both transports without actions', async t => {
  for (const studio of [false, true]) {
    const ui = harness({ studio }); t.after(() => ui.dispose()); ui.open(); ui.knob('disabled');
    ui.focus(false); await ui.connect();
    const rotation = () => node(ui.render(), 'data-au05-knob-rotation');
    assert.equal(rotation()[1].transform, 'rotate(0 512 550)');
    assert.ok(node(rotation(), 'data-au05-knob-grip'));
    assert.ok(find(rotation(), item => item[0] === 'circle' && item[1]?.r === 154));
    await ui.poll(['right.pulse', 'right.pulse']);
    assert.equal(rotation()[1].transform, 'rotate(30 512 550)');
    await ui.tick();
    await ui.poll(['left.pulse']);
    assert.equal(rotation()[1].transform, 'rotate(15 512 550)');
    expireInputEcho(ui, 450);
    assert.equal(rotation()[1].transform, 'rotate(15 512 550)');
    await ui.tick();
    await ui.poll(['left.pulse', 'left.pulse']);
    assert.equal(rotation()[1].transform, 'rotate(-15 512 550)');
    assert.deepEqual(ui.actions, []); assert.equal(ui.tracks.length, 0);
  }
});

function expireInputEcho(ui, delay) {
  const entries = [...ui.timers].filter(([, timer]) => timer.delay === delay);
  assert.ok(entries.length, `expected a ${delay}ms input echo timeout`);
  for (const [id, timer] of entries) { ui.timers.delete(id); timer.fn(); }
}
const inputShape = (ui, control) => find(ui.render(), item => item[1]?.['data-au05-input-control'] === control);
const inputState = (ui, control) => find(ui.render(), item => item[1]?.['data-au05-input-state'] === control)?.[2];

test('physical input echoes both transports without a focused action target, consent or hardware writes', async t => {
  for (const studio of [false, true]) {
    const ui = harness({ studio }); t.after(() => ui.controller.dispose()); ui.open(); ui.knob('disabled');
    ui.focus(false); await ui.connect();
    const before = ui.calls.length, initialFeedback = ui.snapshot().inputFeedback;
    assert.equal(inputShape(ui, 'k1'), undefined); assert.equal(inputState(ui, 'knob'), undefined);
    await ui.poll(['k1.down', 'k2.down', 'k3.down', 'knob.down', 'right.pulse']);
    assert.deepEqual({ ...initialFeedback }, {}, 'snapshots are not mutated by later observations');
    assert.deepEqual({ ...ui.snapshot().inputFeedback }, { k1: 'down', k2: 'down', k3: 'down', knob: 'down', rotation: 'right' });
    for (const key of ['k1', 'k2', 'k3', 'knob']) {
      const shape = inputShape(ui, key);
      assert.equal(shape[0], key === 'knob' ? 'circle' : 'rect');
      assert.equal(shape[1]['data-input-state'], 'down');
      assert.equal(shape[1].onClick, undefined); assert.equal(shape[1]['aria-pressed'], undefined);
      assert.equal(find(ui.render(), item => item[1]?.['data-au05-lamp'] === key)[1]['data-lamp-mode'], 0, 'input is not lamp readback');
    }
    assert.equal(inputState(ui, 'k1'), '按下'); assert.equal(inputState(ui, 'knob'), '按下 · 右转');
    assert.equal(node(ui.render(), 'data-au05-device-vector')[1]['aria-hidden'], true);
    assert.equal(node(ui.render(), 'data-au05-device-vector')[1].focusable, false);
    assert.equal(ui.calls.length, before, 'feedback never starts extra RPC');
    await ui.tick(); const releaseCalls = ui.calls.length;
    await ui.poll(['k1.up', 'k2.up', 'k3.up', 'knob.up']);
    assert.equal(inputState(ui, 'k1'), '松开'); assert.equal(inputState(ui, 'knob'), '松开 · 右转');
    expireInputEcho(ui, 450);
    assert.deepEqual({ ...ui.snapshot().inputFeedback }, {});
    assert.equal(inputShape(ui, 'k1'), undefined); assert.equal(inputState(ui, 'knob'), undefined);
    assert.equal(ui.calls.length, releaseCalls);
    assert.deepEqual(ui.actions, []); assert.equal(ui.tracks.length, 0); assert.equal(ui.constraints.length, 0);
    assert.deepEqual(ui.submitted, { first: 0, second: 0 }); assert.deepEqual(ui.cancelled, { first: 0, second: 0 });
    if (studio) assert.equal(ui.nativeCalls.length, 0, 'Studio never falls back to native transport');
  }
});

test('same-poll taps remain visible and rotary pulses extend, reverse and expire independently of a held knob', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('disabled'); await ui.connect();
  await ui.poll(['k1.down', 'k1.up', 'knob.down', 'left.pulse']);
  assert.equal(inputState(ui, 'k1'), '松开', 'a batched tap must survive long enough to paint');
  assert.equal(inputState(ui, 'knob'), '按下 · 左转');
  const keyEchoTimer = [...ui.timers].find(([, timer]) => timer.delay === 450);
  await ui.tick(); await ui.poll(['right.pulse']);
  assert.equal(inputState(ui, 'knob'), '按下 · 右转');
  const previousPulseTimers = [...ui.timers].filter(([, timer]) => timer.delay === 450).map(([id]) => id);
  const replacedTimer = [...ui.timers].find(([id, timer]) => timer.delay === 450 && id !== keyEchoTimer[0])[1];
  await ui.tick(); await ui.poll(['right.pulse']);
  assert.ok(previousPulseTimers.some(id => !ui.timers.has(id)), 'a repeat extends its own echo deadline');
  replacedTimer.fn(); assert.equal(inputState(ui, 'knob'), '按下 · 右转', 'cancelled callbacks cannot erase newer echoes');
  assert.ok(ui.timers.has(keyEchoTimer[0]), 'rotation does not shorten a different key echo');
  expireInputEcho(ui, 450);
  assert.equal(inputState(ui, 'k1'), undefined); assert.equal(inputState(ui, 'knob'), '按下');
  assert.deepEqual({ ...ui.snapshot().inputFeedback }, { knob: 'down' });
  await ui.tick(); await ui.poll(['knob.up']);
  assert.equal(inputState(ui, 'knob'), '松开'); expireInputEcho(ui, 450);
  assert.equal(inputShape(ui, 'knob'), undefined);
});

test('input echo watchdog never releases action-held knowledge or replays a press', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); await ui.connect();
  await ui.poll(['k2.down']); assert.equal(ui.submitted.first, 1); assert.equal(inputState(ui, 'k2'), '按下');
  const before = ui.calls.length; expireInputEcho(ui, 2000);
  assert.equal(inputShape(ui, 'k2'), undefined); assert.equal(ui.calls.length, before);
  await ui.tick(); await ui.poll(['k2.down']);
  assert.equal(inputState(ui, 'k2'), '按下'); assert.equal(ui.submitted.first, 1, 'expiry is cosmetic only');
  await ui.tick(); await ui.poll(['k2.up', 'k2.down']);
  assert.equal(ui.submitted.first, 2, 'only a real release allows another action');
});

test('input echoes reject stale, future, malformed, replayed and wrong-generation events but observe blocked context', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); await ui.connect();
  await ui.poll([
    { event: 'k2.down', at: 99000 }, { event: 'k2.down', at: 100001 }, { event: 'k2.down', at: null },
    { event: 'k2.down', at: 100000.5 }, { event: 'k2.down', generation: 2 },
    { event: 'k2.down', sequence: 0 }, { event: 'unknown.down' },
  ]);
  assert.deepEqual({ ...ui.snapshot().inputFeedback }, {}); assert.equal(ui.submitted.first, 0);
  assert.equal([...ui.timers.values()].some(timer => timer.delay === 450 || timer.delay === 2000), false);
  await ui.tick(); await ui.poll([{ event: 'k2.down', context: 'no-longer-current' }]);
  assert.equal(inputState(ui, 'k2'), '按下'); assert.equal(ui.submitted.first, 0);
  await ui.tick(); await ui.poll([{ event: 'k2.up', at: 99000 }]);
  assert.equal(inputState(ui, 'k2'), undefined, 'a stale release clears stuck feedback without flashing');
});

test('input echoes survive action-context invalidation but clear on overflow, failure, disconnect, reconnect and disposal', async t => {
  for (const change of ['overflow', 'failure', 'terminal', 'disconnect', 'dispose']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('disabled'); await ui.connect();
    await ui.poll(['k1.down', 'left.pulse']); ui.select('second');
    const cancelledCallbacks = [...ui.timers.values()].filter(timer => timer.delay === 450 || timer.delay === 2000);
    assert.equal(inputState(ui, 'k1'), '按下', 'session changes do not invent hardware releases');
    if (change === 'overflow' || change === 'failure' || change === 'terminal') {
      await ui.tick();
      if (change === 'failure') await ui.failPoll();
      else await ui.poll(['k2.down'], change === 'overflow' ? { overflow: true } : { state: 'error', connected: false });
    } else if (change === 'disconnect') await node(ui.render(), 'data-au05-disconnect')[1].onClick();
    else await ui.controller.dispose();
    assert.deepEqual({ ...ui.controller.getSnapshot().inputFeedback }, {}, change);
    assert.equal([...ui.timers.values()].some(timer => timer.delay === 450 || timer.delay === 2000), false, `${change}: cosmetic timers cleared`);
    if (change === 'disconnect') {
      await ui.connect(); assert.deepEqual({ ...ui.snapshot().inputFeedback }, {});
      await ui.poll(['k1.down']); assert.equal(inputState(ui, 'k1'), '按下');
    }
    const afterCleanup = ui.controller.getSnapshot();
    for (const timer of cancelledCallbacks) timer.fn();
    assert.equal(ui.controller.getSnapshot(), afterCleanup, `${change}: cancelled callbacks cannot update or resurrect feedback`);
  }
});

test('K2/K3 key feedback is opt-in, saved without connecting, and never changes K1 or task channels', async t => {
  const storage = memoryStorage(), ui = harness({ storage }); t.after(() => ui.dispose()); ui.open();
  const toggle = () => node(ui.render(), 'data-au05-key-feedback')[1];
  assert.equal(toggle().type, 'checkbox'); assert.equal(toggle().checked, false); assert.equal(toggle().disabled, false);
  assert.ok(node(node(ui.render(), 'data-au05-device-settings'), 'data-au05-key-feedback'));
  assert.equal(ui.controller.setKeyFeedback('true'), false);
  assert.equal(toggle().onChange({ target: { checked: true } }), true);
  assert.equal(ui.snapshot().keyFeedback, true); assert.equal(ui.snapshot().experimentalK1Lamp, true);
  assert.equal(storage.getItem('abworks.au05.key-feedback.v1'), 'true');
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
  const restored = harness({ storage }); t.after(() => restored.dispose()); restored.open();
  assert.equal(node(restored.render(), 'data-au05-key-feedback')[1].checked, true);
  await ui.connect(); assert.equal(ui.pollArgs().options.keyFeedback, true);
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0]);
  assert.equal(ui.pollArgs().options.experimentalK1Lamp, true);
  assert.equal(Object.hasOwn(ui.pollArgs().options, 'brightness'), false);
  await ui.poll(); ui.status('first', { running: true }); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1]);
  assert.equal(ui.pollArgs().options.keyFeedback, true);
});

test('key feedback master-off disables effective feedback but retains the user preference', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  ui.controller.setKeyFeedback(true); await ui.connect();
  node(ui.render(), 'data-au05-lights')[1].onChange({ target: { checked: false } });
  assert.equal(node(ui.render(), 'data-au05-key-feedback')[1].disabled, true);
  assert.equal(node(ui.render(), 'data-au05-key-feedback')[1].checked, true);
  await ui.poll(); await ui.tick(); assert.equal(ui.pollArgs().options.keyFeedback, false);
  await ui.poll(); node(ui.render(), 'data-au05-lights')[1].onChange({ target: { checked: true } });
  await ui.tick(); assert.equal(ui.pollArgs().options.keyFeedback, true);
  await ui.poll(); await node(ui.render(), 'data-au05-disconnect')[1].onClick();
  await ui.connect(); assert.equal(ui.pollArgs().options.keyFeedback, true);
});

test('key feedback revokes in-flight opt-in once before a rapid off-on rearm', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.controller.setKeyFeedback(true); await ui.connect();
  ui.controller.setKeyFeedback(false); ui.controller.setKeyFeedback(true);
  await ui.poll([], { lightResult: 'verified' });
  assert.equal(ui.snapshot().lightResult, 'pending', 'stale opt-in acknowledgement does not confirm changed settings');
  await ui.tick(); assert.equal(ui.pollArgs().options.keyFeedback, false);
  assert.equal(ui.pendingPollCount(), 1);
  await ui.poll(); await ui.tick(); assert.equal(ui.pollArgs().options.keyFeedback, true);
  const polls = ui.calls.filter(call => call.method === 'au05/poll');
  assert.deepEqual(polls.map(call => call.args.options.keyFeedback), [true, false, true]);
  ui.controller.setLights(false); ui.controller.setLights(true);
  await ui.poll(); await ui.tick(); assert.equal(ui.pollArgs().options.keyFeedback, false);
  await ui.poll(); await ui.tick(); assert.equal(ui.pollArgs().options.keyFeedback, true);
});

test('key feedback ignores malformed storage and stays memory-only with an actionable save error', async t => {
  for (const value of [null, 'false', '1', 'TRUE', '{}']) {
    const storage = memoryStorage(); if (value !== null) storage.setItem('abworks.au05.key-feedback.v1', value);
    const ui = harness({ storage }); t.after(() => ui.dispose()); ui.open(); assert.equal(ui.snapshot().keyFeedback, false);
  }
  const storage = memoryStorage(), setItem = storage.setItem;
  storage.setItem = (key, value) => { if (key === 'abworks.au05.key-feedback.v1') throw new Error('denied'); setItem(key, value); };
  const ui = harness({ storage }); t.after(() => ui.dispose()); ui.open(); ui.controller.setKeyFeedback(true);
  assert.equal(ui.snapshot().keyFeedback, true); assert.equal(ui.snapshot().keyFeedbackSaved, false);
  assert.match(node(ui.render(), 'data-au05-key-feedback-status')[2], /未保存.*重试/);
  assert.equal(node(ui.render(), 'data-au05-key-feedback-status')[1].role, 'alert');
  assert.equal(node(node(ui.render(), 'data-au05-device-settings'), 'data-au05-key-feedback-status'), undefined, 'save failure stays visible outside collapsed settings');
  assert.equal(node(ui.render(), 'data-au05-pill')[1]['data-attention'], true);
  storage.setItem = setItem; ui.controller.setKeyFeedback(true);
  assert.equal(ui.snapshot().keyFeedbackSaved, true); assert.equal(node(ui.render(), 'data-au05-key-feedback-status'), undefined);
  await ui.connect(); assert.equal(ui.pollArgs().options.keyFeedback, true);
});

test('Studio never offers, persists or sends Direct key feedback even with a saved preference', async t => {
  const storage = memoryStorage(); storage.setItem('abworks.au05.key-feedback.v1', 'true');
  const ui = harness({ studio: true, storage }); t.after(() => ui.controller.dispose()); ui.open();
  const writes = storage.writes.length;
  assert.equal(ui.snapshot().keyFeedback, false); assert.equal(node(ui.render(), 'data-au05-key-feedback'), undefined);
  assert.equal(ui.controller.setKeyFeedback(true), false); assert.equal(storage.writes.length, writes);
  await ui.connect(); assert.equal(Object.hasOwn(ui.pollArgs().options, 'keyFeedback'), false);
  assert.equal(ui.nativeCalls.length, 0);
});

test('brightness slider preserves original brightness until changed, persists and sends zero', async () => {
  const storage = memoryStorage();
  const f = harness({ storage });
  f.open();
  assert.equal(f.snapshot().lightBrightness, null);
  await f.connect();
  assert.equal(Object.hasOwn(f.calls.find(call => call.method === 'au05/poll').args.options, 'brightness'), false);
  node(f.render(), 'data-au05-light-brightness')[1].onChange({ target: { value: '0' } });
  assert.equal(f.snapshot().lightBrightness, null, 'dragging stages without flooding native writes');
  node(f.render(), 'data-au05-apply-brightness')[1].onClick();
  assert.equal(f.snapshot().lightBrightness, 0);
  assert.equal(storage.getItem('abworks.au05.light-brightness.v1'), '0');
  await f.poll(); await f.tick();
  assert.equal(f.calls.filter(call => call.method === 'au05/poll').at(-1).args.options.brightness, 0);
  const restored = harness({ storage });
  assert.equal(restored.snapshot().lightBrightness, 0);
  const studio = harness({ studio: true, storage }); studio.open();
  assert.equal(node(studio.render(), 'data-au05-light-brightness'), undefined);
});

test('brightness follows official 0..20 integer range without applying an unset default', () => {
  const f = harness(); f.open();
  const slider = node(f.render(), 'data-au05-light-brightness')[1];
  assert.equal(slider.min, 0); assert.equal(slider.max, 20); assert.equal(slider.value, 2);
  assert.equal(slider.step, 1);
  assert.equal(slider.type, 'range'); assert.equal(slider['aria-label'], '灯光亮度');
  assert.equal(find(f.render(), item => item[0] === 'label' && item[1]?.htmlFor === slider.id).at(-1), '灯光亮度（0–20）');
  assert.equal(f.snapshot().lightBrightness, null);
  assert.equal(f.calls.length, 0, 'rendering the range must not connect or write a default');
  for (const value of [21, 22, 255, -1, 1.5, 20.5, NaN, Infinity, -Infinity]) {
    assert.equal(slider.onChange({ target: { value } }), false);
    assert.equal(f.snapshot().lightBrightnessDraft, undefined);
    // Simulate a stale or programmatic draft bypassing the range input.
    f.snapshot().lightBrightnessDraft = value;
    assert.equal(node(f.render(), 'data-au05-apply-brightness')[1].onClick(), false);
    assert.equal(f.snapshot().lightBrightness, null);
    delete f.snapshot().lightBrightnessDraft;
  }
  for (const value of Array.from({ length: 21 }, (_, index) => index)) {
    assert.equal(slider.onChange({ target: { value } }), true);
    assert.equal(node(f.render(), 'data-au05-apply-brightness')[1].onClick(), true);
    assert.equal(f.snapshot().lightBrightness, value);
  }
});

test('legacy brightness above 20 migrates before the first poll and preserves every official value', async () => {
  for (const legacy of [21, 22, 127, 255]) {
    const storage = memoryStorage(); storage.setItem('abworks.au05.light-brightness.v1', String(legacy));
    const f = harness({ storage }); f.open();
    assert.equal(f.snapshot().lightBrightness, 20);
    assert.equal(f.snapshot().lightBrightnessSaved, true);
    assert.equal(storage.getItem('abworks.au05.light-brightness.v1'), '20');
    await f.connect();
    assert.equal(f.calls.find(call => call.method === 'au05/poll').args.options.brightness, 20);
  }
  for (const value of Array.from({ length: 21 }, (_, index) => index)) {
    const storage = memoryStorage(); storage.setItem('abworks.au05.light-brightness.v1', String(value));
    const writes = storage.writes.length;
    const f = harness({ storage }); f.open();
    assert.equal(f.snapshot().lightBrightness, value);
    assert.equal(node(f.render(), 'data-au05-light-brightness')[1].value, value);
    assert.equal(storage.writes.length, writes, 'already-valid brightness is not rewritten');
    await f.connect();
    assert.equal(f.calls.find(call => call.method === 'au05/poll').args.options.brightness, value);
  }
});

test('legacy brightness migration keeps range-limited memory value and warns when storage write fails', async () => {
  const storage = memoryStorage(); storage.setItem('abworks.au05.light-brightness.v1', '255');
  storage.setItem = () => { throw new Error('storage unavailable'); };
  const f = harness({ storage }); f.open();
  assert.equal(f.snapshot().lightBrightness, 20);
  assert.equal(f.snapshot().lightBrightnessSaved, false);
  assert.equal(storage.getItem('abworks.au05.light-brightness.v1'), '255');
  assert.match(JSON.stringify(f.render()), /亮度设置未保存/);
  await f.connect();
  assert.equal(f.calls.find(call => call.method === 'au05/poll').args.options.brightness, 20);
});

test('malformed saved brightness remains unset instead of silently applying a replacement', async () => {
  for (const saved of ['', '-1', '1.5', '256', '999', 'NaN', '20px', ' 20', 'null']) {
    const storage = memoryStorage(); storage.setItem('abworks.au05.light-brightness.v1', saved);
    const writes = storage.writes.length;
    const f = harness({ storage }); f.open();
    assert.equal(f.snapshot().lightBrightness, null, saved);
    assert.equal(node(f.render(), 'data-au05-light-brightness')[1].value, 2);
    assert.equal(storage.writes.length, writes);
    await f.connect();
    assert.equal(Object.hasOwn(f.calls.find(call => call.method === 'au05/poll').args.options, 'brightness'), false, saved);
  }
});

test('brightness reset removes saved request and disconnects without another brightness write', async () => {
  const storage = memoryStorage();
  storage.setItem('abworks.au05.light-brightness.v1', '255');
  const f = harness({ storage }); f.open(); await f.connect();
  await f.poll([], { lightResult: 'mismatch' }); await f.tick();
  assert.match(JSON.stringify(node(f.render(), 'data-au05-light-brightness-status')), /配置回读不一致/);
  const polls = f.calls.filter(call => call.method === 'au05/poll').length;
  await node(f.render(), 'data-au05-clear-brightness')[1].onClick();
  assert.equal(f.snapshot().connected, false);
  assert.equal(f.snapshot().lightBrightness, null);
  assert.equal(storage.getItem('abworks.au05.light-brightness.v1'), null);
  assert.equal(f.calls.at(-1).method, 'au05/disconnect');
  assert.equal(f.calls.filter(call => call.method === 'au05/poll').length, polls);
  assert.equal(harness({ storage }).snapshot().lightBrightness, null);
});

// Product regions share the legacy native transport; DOM engine tests live in the standalone region suite.
const nativeRegionCalls = ui => ui.calls.filter(call => call.method === 'au05/nativeScroll');

function assertNoRegionDomWrites(ui, port, initial = 500) {
  assert.equal(port.scrollTop, initial);
  assert.deepEqual(ui.wheelEvents, []);
  assert.equal(ui.animationFrames.size, 0);
  assert.ok(!ui.actions.some(action => /scroll/.test(action[0])));
}

test('region native wheel arms before selection and requires desktop and matching non-editor hover', async t => {
  for (const kind of ['desktop', 'browser', 'studio', 'mismatch', 'editor']) {
    await t.test(kind, async t => {
      const ui = harness({ studio: kind === 'studio', protocol: kind === 'browser' ? 'https:' : 'dsh-app:', animationFrames: true });
      t.after(() => ui.dispose()); ui.open(); ui.mountRegionSurface(); const { port } = ui.mountScroll();
      await ui.connect(); assert.equal(ui.pollArgs().options.nativeScroll, kind === 'studio' ? undefined : kind !== 'browser');
      await ui.poll(['right.pulse']); assert.equal(nativeRegionCalls(ui).length, 0);
      await ui.tick(); await ui.poll(['knob.down', 'knob.up']);
      if (kind === 'mismatch') port.hovered = false;
      if (kind === 'editor') port.blockedHover = true;
      await ui.tick(); await ui.poll(['right.pulse', 'left.pulse']);
      assert.equal(nativeRegionCalls(ui).length, kind === 'desktop' ? 2 : 0);
      assertNoRegionDomWrites(ui, port);
    });
  }
});

test('region selected sessions native wheel rejects conversation-only hover and replacement', async t => {
  const ui = harness({ deferNativeScroll: true, animationFrames: true }); t.after(() => ui.dispose()); ui.open();
  const element = ui.mountRegionSurface(), { port } = ui.mountScroll();
  const sidebar = element.scrollable(element(), { hovered: false }), tree = element({ role: 'tree' });
  const row = element({ 'data-row-key': 'session:first' }); row.parentElement = tree; tree.parentElement = sidebar;
  tree.querySelectorAll = selector => selector === '[data-row-key]' ? [row] : [];
  ui.document.querySelectorAll = selector => selector === '[role="tree"]' ? [tree] : selector === '[data-row-key]' ? [row] : [];
  await ui.connect(); await ui.poll(['knob.down', 'knob.up']);
  assert.equal(ui.document.body.children[0].getAttribute('data-au05-region'), 'sessions');
  await ui.tick(); await ui.poll(['right.pulse']); assert.equal(nativeRegionCalls(ui).length, 0);
  sidebar.hovered = true; await ui.tick(); await ui.poll(['right.pulse']);
  const call = nativeRegionCalls(ui)[0]; assert.ok(call); assert.equal(call.signal.aborted, false);
  tree.parentElement = element.scrollable(element()); ui.pointerMove('scroll');
  assert.equal(call.signal.aborted, true);
  await ui.resolveNativeScroll({ scrolled: false, error: 'native_wheel_foreground_mismatch' });
  assertNoRegionDomWrites(ui, port); assertNoRegionDomWrites(ui, sidebar, 100);
});

test('region native requests abort fresh lease, owner, focus, node, mode and hover revocations', async t => {
  for (const change of ['cycle', 'owner', 'focus', 'detach', 'mode', 'hover', 'editor', 'session', 'unmount']) {
    await t.test(change, async t => {
      const ui = harness({ deferNativeScroll: true, animationFrames: true }); t.after(() => ui.dispose()); ui.open();
      const element = ui.mountRegionSurface(), { port } = ui.mountScroll(), composer = ui.mountComposer();
      element.scrollable(composer.input, { tagName: 'TEXTAREA' });
      await ui.connect(); await ui.poll(['knob.down', 'knob.up']); await ui.tick(); await ui.poll(['right.pulse']);
      const call = nativeRegionCalls(ui)[0]; assert.ok(call);
      if (change === 'cycle') { await ui.tick(); await ui.poll(['knob.down', 'knob.up', 'knob.down', 'knob.up']); }
      if (change === 'owner') ui.replaceOwner();
      if (change === 'focus') ui.focus(false);
      if (change === 'detach') port.isConnected = false;
      if (change === 'mode') ui.knob('scroll');
      if (change === 'hover') port.hovered = false;
      if (change === 'editor') port.blockedHover = true;
      if (change === 'session') ui.select('second');
      if (change === 'unmount') ui.unmount('conversation.input.dock');
      ui.pointerMove('scroll'); assert.equal(call.signal.aborted, true);
      const message = ui.snapshot().message;
      await ui.resolveNativeScroll({ scrolled: false, error: 'native_wheel_foreground_mismatch' });
      assert.equal(ui.snapshot().message, message); assert.equal(nativeRegionCalls(ui).length, 1);
      assertNoRegionDomWrites(ui, port);
    });
  }
});

test('region native errors, timeout and queue limit never retry or fall back to DOM writes', async t => {
  for (const kind of ['error', 'reject', 'timeout', 'limit']) {
    await t.test(kind, async t => {
      const ui = harness({ deferNativeScroll: true, animationFrames: true }); t.after(() => ui.dispose()); ui.open();
      ui.mountRegionSurface(); const { port } = ui.mountScroll();
      await ui.connect(); await ui.poll(['knob.down', 'knob.up']); await ui.tick();
      await ui.poll(Array(kind === 'limit' ? 33 : 1).fill('right.pulse'));
      assert.equal(nativeRegionCalls(ui).length, kind === 'limit' ? 32 : 1);
      if (kind === 'error') await ui.resolveNativeScroll({ scrolled: false, error: 'native_wheel_foreground_mismatch' });
      if (kind === 'reject') await ui.rejectNativeScroll();
      if (kind === 'timeout') {
        const [id, timer] = [...ui.timers].find(([, timer]) => timer.delay === 500); ui.timers.delete(id); timer.fn(); await flush();
        assert.equal(nativeRegionCalls(ui)[0].signal.aborted, true);
        await ui.resolveNativeScroll();
      }
      assert.match(ui.snapshot().message, /未重试/);
      assertNoRegionDomWrites(ui, port);
    });
  }
});
function observeRegionScroll(element) {
  const calls = [], scrollBy = element.scrollBy;
  element.scrollBy = function(options) {
    calls.push({ ...options }); scrollBy.call(this, options); this.scrollTop += options.top;
  };
  return calls;
}

function assertRegionScrollIsLocal(ui, studio = false) {
  assert.equal(ui.calls.filter(call => call.method === 'au05/nativeScroll').length, 0);
  const polls = ui.calls.filter(call => call.method === 'au05/poll');
  assert.ok(polls.length > 0);
  assert.ok(polls.every(call => call.args.options.nativeScroll === (studio ? undefined : true)),
    'regions arm native tickets before selection; Studio keeps its existing omitted option');
}

test('region options rotate focus only, never scroll or submit, and K2 commits explicitly in both transports', async t => {
  for (const studio of [false, true]) {
    const ui = harness({ studio, animationFrames: true }); t.after(() => ui.dispose()); ui.open();
    const question = ui.mountRegionQuestion();
    const unexpectedScroll = () => { throw new Error('option rotation must not scroll a DOM port'); };
    Object.assign(question.group, { scrollTop: 100, scrollHeight: 1000, clientHeight: 200, scrollBy: unexpectedScroll });
    question.field.scrollBy = unexpectedScroll;
    await ui.connect(); assert.equal(ui.snapshot().knobMode, 'regions');
    await ui.poll(['knob.down', 'knob.up']);
    assert.equal(ui.document.body.children[0].getAttribute('data-au05-region'), 'input');
    assert.equal(ui.document.activeElement, question.field);
    await ui.tick(); await ui.poll(['knob.down', 'knob.up']);
    assert.equal(ui.document.body.children[0].getAttribute('data-au05-region'), 'options');
    await ui.tick(); await ui.poll(['right.pulse']);
    assert.equal(ui.document.activeElement, question.options[1]);
    assert.equal(question.clicks(), 0); assert.equal(question.options[1].clicks, undefined);
    assert.equal(question.group.scrollTop, 100); assert.equal(ui.actions.length, 0);
    assert.equal(ui.submitted.first, 0); assert.deepEqual(ui.wheelEvents, []);
    await ui.tick(); await ui.poll(['left.pulse']);
    assert.equal(ui.document.activeElement, question.options[0]);
    await ui.tick(); await ui.poll(['right.pulse']);
    assert.equal(ui.document.activeElement, question.options[1]);
    assert.ok(question.options.every(option => option.clicks === undefined)); assert.equal(question.clicks(), 0);
    await ui.tick(); await ui.poll(['k2.down', 'k2.down', 'k2.up']);
    assert.equal(question.options[1].clicks, 1); assert.equal(question.clicks(), 1);
    await ui.tick(); await ui.poll(['knob.down', 'knob.up']);
    assert.equal(ui.document.body.children[0].getAttribute('data-au05-region'), 'input');
    assert.equal(ui.document.activeElement, question.field);
    await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.equal(question.clicks(), 1);
    question.field.value = '自定义回答';
    await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.equal(question.clicks(), 2);
    assert.equal(ui.submitted.first, 0); assert.equal(ui.actions.length, 0);
    assertRegionScrollIsLocal(ui, studio); assert.deepEqual(ui.wheelEvents, []);
    assert.equal(ui.animationFrames.size, 0, 'option rotation does not queue the scroll animator');
    ui.focus(false); assert.equal(ui.document.body.children.length, 0);
  }
});

test('region selection clears on node replacement, focus, session, pending, mode, owner, unmount or disposal', async t => {
  for (const change of ['detach', 'replace', 'focus', 'visibility', 'mode', 'session', 'pending', 'owner', 'unmount', 'dispose']) {
    await t.test(change, async t => {
      const ui = harness(); t.after(() => ui.dispose()); ui.open();
      const element = ui.mountRegionSurface(), scroll = ui.mountScroll(), composer = ui.mountComposer();
      element.scrollable(composer.input, { tagName: 'TEXTAREA' });
      const scrolls = observeRegionScroll(scroll.port);
      await ui.connect(); await ui.poll(['knob.down', 'knob.up']); await ui.tick();
      if (change === 'detach') { scroll.port.isConnected = false; ui.pointerMove('scroll'); }
      if (change === 'replace') { scroll.bridge[1].ref.current = null; ui.mountScroll(); ui.pointerMove('scroll'); }
      if (change === 'focus') ui.focus(false);
      if (change === 'visibility') ui.visibility('hidden');
      if (change === 'mode') ui.knob('disabled');
      if (change === 'session') ui.select('second');
      if (change === 'pending') ui.status('first', { pendingInteraction: { kind: 'approval', key: 'new', sessionId: 'first' } });
      if (change === 'owner') ui.replaceOwner();
      if (change === 'unmount') ui.unmount('conversation.input.dock');
      if (change === 'dispose') ui.dispose();
      await ui.poll(['right.pulse']);
      assert.equal(ui.document.body.children.length, 0, 'a stale queued event cannot revive a cleared selection');
      assert.deepEqual(scrolls, []); assert.equal(scroll.port.scrollTop, 500);
      assert.deepEqual(ui.actions, []); assert.deepEqual(ui.wheelEvents, []); assert.equal(ui.submitted.first, 0);
      assertRegionScrollIsLocal(ui);
    });
  }
});

test('region stale, duplicate, wrong-context and invalid generation events cannot scroll the selected port', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mountRegionSurface(); const { port } = ui.mountScroll();
  const scrolls = observeRegionScroll(port);
  await ui.connect(); await ui.poll(['knob.down', 'knob.up']); await ui.tick();
  await ui.poll([
    { event: 'right.pulse', generation: 0 }, { event: 'right.pulse', generation: 2 },
    { event: 'right.pulse', context: 'obsolete-region-context' },
    { event: 'right.pulse', at: 98999 }, { event: 'right.pulse', at: 100001 },
    { event: 'right.pulse', sequence: 0 }, { event: 'right.pulse', sequence: NaN },
    { event: 'right.pulse', sequence: 1.5 }, { event: 'right.pulse', sequence: Number.MAX_SAFE_INTEGER + 1 },
  ]);
  assert.deepEqual(scrolls, []); assert.deepEqual(ui.wheelEvents, []); assert.equal(port.scrollTop, 500);
  await ui.tick(); const sequence = ui.eventSequence() + 1;
  await ui.poll([{ event: 'right.pulse', sequence }, { event: 'right.pulse', sequence }]);
  assert.deepEqual(scrolls, []); assert.equal(port.scrollTop, 500);
  assert.equal(ui.wheelEvents.length, 0); assert.equal(nativeRegionCalls(ui).length, 1);
});

test('region lease cycling leaves an existing held K1 capture active', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const element = ui.mountRegionSurface(); ui.mountScroll(); const composer = ui.mountComposer();
  element.scrollable(composer.input, { tagName: 'TEXTAREA' });
  await ui.enableVoice(); await ui.connect(); await ui.poll(['knob.down', 'knob.up']);
  await ui.tick(); await ui.poll(['k1.down']);
  assert.equal(ui.snapshot().voice.phase, 'recording'); assert.equal(ui.tracks.length, 2);
  assert.equal(ui.tracks[0].stopped, true, 'the permission-only probe is already closed');
  const recording = ui.tracks.at(-1), context = ui.calls.filter(call => call.method === 'au05/poll').at(-1).args.options.context;
  assert.equal(recording.stopped, false);
  await ui.tick(); await ui.poll(['knob.down', 'knob.up', 'knob.down', 'knob.up']);
  assert.equal(ui.snapshot().voice.phase, 'recording'); assert.equal(recording.stopped, false);
  await ui.tick(); assert.equal(ui.pollArgs().options.context, context);
  assert.equal(ui.pollArgs().options.nativeScroll, true); assertRegionScrollIsLocal(ui);
  assert.equal(ui.submitted.first, 0); assert.ok(!ui.actions.some(action => action[0] === 'transcribe'));
});

test('region detents without a selected valid port do nothing instead of falling back to native or global scrolling', async t => {
  for (const invalid of ['unselected', 'nonfinite', 'no-overflow']) {
    await t.test(invalid, async t => {
      const ui = harness({ deferNativeScroll: true }); t.after(() => ui.dispose()); ui.open(); ui.mountRegionSurface(); const { port } = ui.mountScroll();
      const scrolls = observeRegionScroll(port);
      await ui.connect();
      if (invalid !== 'unselected') {
        await ui.poll(['knob.down', 'knob.up']); await ui.tick();
        if (invalid === 'nonfinite') port.scrollTop = NaN;
        if (invalid === 'no-overflow') port.scrollHeight = port.clientHeight;
      }
      await ui.poll(['right.pulse', 'left.pulse']);
      assert.deepEqual(scrolls, []); assert.deepEqual(ui.actions, []); assert.deepEqual(ui.wheelEvents, []);
      assertRegionScrollIsLocal(ui);
    });
  }
});

test('available region RAF does not change legacy native rotary or page smooth-scroll paths', async t => {
  const ui = harness({ animationFrames: true }); t.after(() => ui.dispose()); ui.open(); const { port } = ui.mountScroll();
  ui.knob('scroll'); await ui.connect(); await ui.poll(['right.pulse', 'left.pulse']);
  assert.equal(ui.calls.filter(call => call.method === 'au05/nativeScroll').length, 2);
  assert.deepEqual(ui.actions, []); assert.equal(ui.animationFrames.size, 0); assert.equal(port.scrollTop, 500);
  ui.knob('scroll-page'); await ui.tick(); await ui.poll(['right.pulse', 'left.pulse']);
  assert.deepEqual(ui.actions, [['scroll', 'first', 400, 'smooth'], ['scroll', 'first', -400, 'smooth']]);
  assert.equal(ui.animationFrames.size, 0); assert.equal(port.scrollTop, 500);
});

test('question K2 submits host defaults once per press and legacy knob targets custom answer without draft fallback', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('sessions');
  const question = ui.mountQuestion(); await ui.connect();
  await ui.poll(['k2.down', 'k2.down', 'k2.up']);
  assert.equal(question.clicks(), 1, 'held/repeated down must not duplicate submission');
  await ui.tick(); await ui.poll(['knob.down', 'knob.up']);
  assert.equal(question.focusCalls(), 1);
  await ui.tick(); await ui.poll(['k2.down', 'k2.up']);
  assert.equal(question.clicks(), 1, 'focused empty answer must not send recommendation');
  question.field.value = '我的回答';
  await ui.tick(); await ui.poll(['k2.down', 'k2.up']);
  assert.equal(question.clicks(), 2);
  question.buttons[3].disabled = true;
  await ui.tick(); await ui.poll(['k2.down', 'k2.up']);
  assert.equal(question.clicks(), 2, 'busy/disabled host control must not submit again');
  assert.equal(ui.submitted.first, 0, 'never sends ordinary composer draft behind the question');
  assert.equal(ui.actions.length, 0); assert.equal(ui.tracks.length, 0);
});

test('device schematic shows all static mappings without controller or media effects', async () => {
  const ui = harness(); ui.open(); await flush();
  const effects = () => JSON.stringify({ calls: ui.calls, actions: ui.actions, tracks: ui.tracks,
    constraints: ui.constraints, submitted: ui.submitted, cancelled: ui.cancelled, writes: ui.storage.writes });
  const baseline = effects();
  assert.equal(find(ui.render(), item => Object.hasOwn(item[1] ?? {}, 'data-au05-control')), undefined);
  assert.equal(node(ui.render(), 'data-au05-control-detail')[1]['aria-live'], undefined);
  const vector = node(ui.render(), 'data-au05-device-vector');
  assert.equal(vector[0], 'svg'); assert.equal(vector[1].viewBox, '332 144 364 1334');
  assert.equal(vector[1]['aria-hidden'], true);
  assert.ok(find(vector, item => item[0] === 'rect' && item[1]?.width === 359 && item[1]?.height === 1317), 'slim rectangular chassis retains reference proportions');
  assert.ok(find(vector, item => item[0] === 'circle' && item[1]?.cx === 512 && item[1]?.cy === 550 && item[1]?.r === 154), 'large rotary dial retains reference location');
  for (const y of [747, 970, 1191]) assert.ok(find(vector, item => item[0] === 'rect' && item[1]?.y === y && item[1]?.width === 214), 'three square key wells remain distinct');
  const wrapper = node(ui.render(), 'data-au05-control-detail');
  const mappingOrder = wrapper.slice(2).map(item => item[1]['data-au05-mapping']);
  assert.deepEqual(mappingOrder, ['knob', 'k1', 'k2', 'k3'], 'descriptions read from the top dial down through the three keys');
  const physicalOrder = mappingOrder.map(control => {
    const shape = find(vector, item => item[1]?.['data-au05-lamp'] === control);
    return { control, center: shape[0] === 'circle' ? shape[1].cy : shape[1].y + shape[1].height / 2 };
  }).sort((a, b) => a.center - b.center).map(item => item.control);
  assert.deepEqual(mappingOrder, physicalOrder, 'description order matches actual SVG control positions, not lamp channel indices');
  for (const control of ['knob', 'k1', 'k2', 'k3']) {
    const tree = ui.render();
    const wrapper = node(tree, 'data-au05-control-detail');
    const mapping = find(wrapper, item => item[1]?.['data-au05-mapping'] === control);
    assert.ok(mapping, `${control} mapping is always present`);
    assert.equal(mapping[1].onClick, undefined);
    assert.equal(mapping[1]['aria-pressed'], undefined);
    assert.ok(visibleText(mapping), `${control} mapping is visible without selection`);
    assert.match(JSON.stringify(mapping), ({ knob: /高亮区域.*切换区域/, k1: /按住说话.*不自动发送/, k2: /灰色建议.*补齐.*发送草稿.*审批.*批准/, k3: /停止运行.*审批.*拒绝/ })[control]);
    assert.equal(effects(), baseline);
  }
  node(ui.render(), 'data-au05-close')[1].onClick();
  assert.equal(node(ui.render(), 'data-au05-inspector'), undefined);
  assert.equal(effects(), baseline);
});

test('visible device mappings follow current knob and voice settings', () => {
  const ui = harness(); ui.open();
  const detail = (control = 'knob') => JSON.stringify(find(ui.render(), item => item[1]?.['data-au05-mapping'] === control));
  for (const [mode, text] of [['scroll', /上下滚动/], ['scroll-page', /整屏滚动/], ['disabled', /旋转无动作/]]) {
    ui.knob(mode); assert.match(detail(), text);
  }
  assert.match(detail('k1'), /按住说话.*不自动发送/);
  assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, false);
  ui.mode('windows'); assert.match(detail('k1'), /Windows 语音.*系统面板结束/);
  ui.preset('typeless'); assert.match(detail('k1'), /Typeless.*RightAlt/);
  ui.preset('bugu'); assert.match(detail('k1'), /叭哥说.*RightAlt/);
  ui.mode('custom'); ui.shortcut('Ctrl+Shift+Space'); assert.match(detail('k1'), /自定义.*Ctrl\+Shift\+Space/);
  ui.mode('dsh'); assert.match(detail('k1'), /按住说话.*松开转写/);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
});

const voicePreferencesKey = 'abworks.au05.voice-preferences.v1';
function memoryStorage(value = null) {
  const values = new Map(value === null ? [] : [[voicePreferencesKey, typeof value === 'string' ? value : JSON.stringify(value)]]), writes = [];
  return { values, writes, getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); values.set(key, value); }, removeItem(key) { values.delete(key); } };
}
function harness({ deferConnect = false, insertionConflict = false, optionalNavigation = false, optionalSpeech = true, connectSnapshot = {}, statusSnapshot = null, deferStatus = false,
  deferNativeScroll = false, nativeScrollResult = { scrolled: true, error: null },
  deferWindows = false, windowsResult = { activated: true, error: null }, deferShortcut = false, shortcutResult = { activated: true, error: null },
  protocol = 'dsh-app:', serviceAvailable = true, storage = memoryStorage(), devices = null, cancellable = true,
  studio = false, studioRpc = undefined, animationFrames = false, reducedMotion = false } = {}) {
  let loaded, dispose, clock = 100000, frameClock = 0, frameId = 0, random = 1, timerId = 0, seq = 0, generation = 1, focused = true, connectResolver;
  const rafCallbacks = new Map(), motionQueries = new Set();
  const timers = new Map(), calls = [], pendingPolls = [], pendingStatuses = [], pendingWindows = [], pendingShortcuts = [], pendingNativeScrolls = [], registrations = new Map(), effects = new Map(), hookStates = new Map();
  const events = new Map(), actions = [], wheelEvents = [], tracks = [], submitted = { first: 0, second: 0 }, cancelled = { first: 0, second: 0 };
  let activeHooks, hookIndex;
  const on = (target, name, fn) => { const key = `${target}:${name}`; if (!events.has(key)) events.set(key, new Set()); events.get(key).add(fn); };
  const off = (target, name, fn) => events.get(`${target}:${name}`)?.delete(fn);
  const document = { visibilityState: 'visible', activeElement: {}, hasFocus: () => focused,
    addEventListener: (name, fn) => on('document', name, fn), removeEventListener: (name, fn) => off('document', name, fn) };
  const window = { __ModuleLoader__: { load(value) { loaded = value; } },
    addEventListener: (name, fn) => on('window', name, fn), removeEventListener: (name, fn) => off('window', name, fn),
    dispatchEvent(event) { for (const fn of events.get(`window:${event.type}`) ?? []) fn(event); return !event.defaultPrevented; } };
  const React = { createElement: (...args) => args,
    useState(initial) { const index = hookIndex++, states = hookStates.get(activeHooks);
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = hookIndex++, states = hookStates.get(activeHooks); return states[index] ??= { current: initial }; },
    useEffect(callback, deps) { const index = hookIndex++, key = `${activeHooks}:${index}`, previous = effects.get(key);
      if (previous && deps?.length === previous.deps?.length && deps.every((value, i) => value === previous.deps[i])) return;
      previous?.cleanup?.(); effects.set(key, { deps, cleanup: callback() }); } };
  const rows = { first: { id: 'first', retainedBy: { mainView: 1 }, origin: 'human' },
    second: { id: 'second', retainedBy: { mainView: 0 }, origin: 'human' },
    archived: { id: 'archived', retainedBy: {}, origin: 'human' }, child: { id: 'child', retainedBy: {}, origin: 'subagent' } };
  const owners = Object.fromEntries(['first', 'second'].map(id => [id, { session: cancellable ? { cancel() { cancelled[id]++; } } : {} }]));
  const bindings = Object.fromEntries(['first', 'second'].map(id => [id, { key: id, hooks: {}, props: { inputActions: {
    submit() { submitted[id]++; }, captureInsertion: () => ({ draftRev: 1 }), insertText: text => { actions.push(['insert', id, text]); return !insertionConflict; },
  } } }]));
  const current = store(bindings.first), sessionStatus = store(new Map([['first', { running: false }], ['second', { running: false }]]));
  const list = store({ byId: rows });
  const workspaces = { list: store({ items: [{ sessionIds: ['first', 'archived', 'child', 'second'] }], archivedSessionIds: ['archived'] }) };
  const nativeSnapshot = extra => ({ state: 'ready', connected: true, generation, sequence: seq, stopping: false,
    lightsEnabled: true, lightState: 'idle', lightResult: 'written', error: null, ...extra });
  const ctx = { slots: { inject(name, fn) { fn(); }, register(options, component) { registrations.set(options.name, component); } },
    effect(fn) { dispose = fn(); }, uiSession: { adapter: { current }, sessionStatus },
    sessions: { list, binding: id => owners[id] }, workspaces,
    uiWorkspace: { openSession(id) { actions.push(['open', id]); api.select(id); } },
    connection: { rpc: { async call(path, method, envelope, signal) {
      assert.equal(path, '/api'); calls.push({ method, args: envelope.args, signal });
      if (method === 'au05/nativeScroll') return deferNativeScroll ? new Promise((resolve, reject) => pendingNativeScrolls.push({ resolve, reject, signal })) : { ok: true, value: nativeScrollResult };
      if (method === 'au05/shortcutVoice') return deferShortcut ? new Promise((resolve, reject) => pendingShortcuts.push({ resolve, reject, signal })) : { ok: true, value: shortcutResult };
      if (method === 'au05/windowsVoice') return deferWindows ? new Promise((resolve, reject) => pendingWindows.push({ resolve, reject, signal })) : { ok: true, value: windowsResult };
      if (method === 'au05/connect') return deferConnect ? new Promise(resolve => { connectResolver = () => resolve({ ok: true, value: nativeSnapshot(connectSnapshot) }); }) : { ok: true, value: nativeSnapshot(connectSnapshot) };
      if (method === 'au05/disconnect') return { ok: true, value: nativeSnapshot({ state: 'disconnected', connected: false }) };
      if (method === 'au05/status') {
        assert.deepEqual(Object.keys(envelope.args), []);
        if (deferStatus) return new Promise(resolve => { pendingStatuses.push({ resolve, signal }); });
        return statusSnapshot ? { ok: true, value: nativeSnapshot(statusSnapshot) } : { ok: false };
      }
      if (method === 'au05/poll') return new Promise((resolve, reject) => {
        pendingPolls.push({ args: envelope.args, resolve, reject });
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      throw new Error('unexpected RPC');
    } } }, remote: { speech: {
      async catalog() { actions.push(['catalog']); return { ok: true, value: { maxAudioBytes: 1000000, maxDurationSeconds: 10,
        providers: [{ id: 'test', name: '测试语音', location: 'host-local', preparation: { phase: 'ready' } }], selection: { providerId: 'test', language: 'zh' } } }; },
      async transcribe() { actions.push(['transcribe']); return { ok: true, value: { text: '测试' } }; },
    } } };
  const constraints = [];
  const media = { async getUserMedia(options) { constraints.push(options); const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track], getAudioTracks: () => [track] }; },
    addEventListener: (name, fn) => on('media', name, fn), removeEventListener: (name, fn) => off('media', name, fn) };
  if (devices !== null) media.enumerateDevices = async () => devices;
  class Recorder { constructor() { this.state = 'inactive'; } start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['offline-synthetic-audio']) }); this.onstop?.(); } }
  class Audio { async decodeAudioData() { return { duration: 0.01, sampleRate: 16000, length: 160, numberOfChannels: 1,
    getChannelData: () => new Float32Array(160) }; } async close() {} }
  ctx.inject = (names, callback) => {
    if (names.includes('remote.speech') && optionalSpeech) callback({ remote: ctx.remote,
      effect(callback) { effects.set('speech:0', { cleanup: callback() }); } });
    if (names.includes('pluginNavigation') && optionalNavigation) callback({ pluginNavigation: { openBundle(id) { actions.push(['configure', id]); } },
      effect(callback) { effects.set('navigation:0', { cleanup: callback() }); } });
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; this.cancelable = options.cancelable === true; this.defaultPrevented = false; }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  }
  class WheelEvent extends CustomEvent {
    constructor(type, options = {}) { super(type, options); Object.assign(this, options); }
  }
  const sandbox = { window, document, CustomEvent, WheelEvent, localStorage: storage, crypto: { getRandomValues(value) { value.fill(random++); return value; } }, React,
    createVoiceAdapter: options => createVoiceAdapter({ ...options, media, Recorder, Audio }),
    navigator: { mediaDevices: media }, location: { protocol }, MediaRecorder: Recorder, AudioContext: Audio, Uint8Array, AbortController,
    getComputedStyle: port => ({ overflowY: port.overflowY, flexDirection: port.flexDirection }), innerWidth: 1200, innerHeight: 800,
    Blob, ArrayBuffer, DataView, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
  };
  sandbox.matchMedia = window.matchMedia = query => {
    const listeners = new Set();
    const result = { media: query, get matches() { return reducedMotion && /prefers-reduced-motion:\s*reduce/.test(query); },
      addEventListener(name, fn) { if (name === 'change') listeners.add(fn); },
      removeEventListener(name, fn) { if (name === 'change') listeners.delete(fn); } };
    motionQueries.add({ result, listeners }); return result;
  };
  if (animationFrames) {
    sandbox.performance = window.performance = { now: () => frameClock };
    sandbox.requestAnimationFrame = window.requestAnimationFrame = fn => { const id = ++frameId; rafCallbacks.set(id, fn); return id; };
    sandbox.cancelAnimationFrame = window.cancelAnimationFrame = id => { rafCallbacks.delete(id); };
  }
  const serviceCall = ctx.connection.rpc.call, nativeCalls = [], bridgeCalls = [], registrationOptions = [];
  const nativeCall = (...args) => { nativeCalls.push(args); return serviceCall(...args); };
  ctx.connection.rpc.call = serviceAvailable ? nativeCall : null;
  const register = ctx.slots.register;
  ctx.slots.register = (options, component) => { registrationOptions.push(options); register(options, component); };
  let directController;
  sandbox.captureTestController = controller => { directController = controller; return controller; };
  vm.runInNewContext(source.replace('const controller = createController(ctx), Device = productView(controller);',
    'const controller = captureTestController(createController(ctx)), Device = productView(controller);'), sandbox);
  const plugin = loaded.factory(name => { assert.equal(name, 'react'); return React; });
  const bridgeRpc = async (method, args, signal) => {
    bridgeCalls.push({ method, args, signal });
    const result = await serviceCall('/api', `au05/${method}`, { args }, signal);
    if (result?.ok !== true) throw new Error('synthetic_studio_failure');
    return result.value;
  };
  const studioActions = studio ? plugin.createStudioActions(ctx, { rpc: studioRpc === undefined ? bridgeRpc : studioRpc }) : null;
  if (!studio) plugin.apply(ctx);
  const render = (name = 'shell.overlay', props = {}, instance = name) => {
    activeHooks = instance; hookIndex = 0; if (!hookStates.has(instance)) hookStates.set(instance, []);
    const component = studio && name === 'shell.overlay' ? studioActions.View : registrations.get(name);
    return component(props);
  };
  const api = { calls, nativeCalls, bridgeCalls, registrationOptions, registrations, plugin, controller: studioActions?.controller ?? directController,
    submitted, cancelled, actions, wheelEvents, timers, tracks, constraints, storage, ctx, document, media, render,
    animationFrames: rafCallbacks, now: () => frameClock,
    reducedMotion(value) {
      reducedMotion = value;
      for (const { result, listeners } of motionQueries) for (const fn of listeners) fn({ matches: result.matches, media: result.media });
    },
    advance(milliseconds) { assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0); clock += milliseconds; frameClock += milliseconds; },
    async frame(milliseconds = 16) {
      api.advance(milliseconds);
      const callbacks = [...rafCallbacks];
      for (const [id, callback] of callbacks) if (rafCallbacks.delete(id)) callback(frameClock);
      await flush();
    },
    onSuggestionAccept(fn) { window.addEventListener('dsh:suggest-prompt:accept', fn); return () => window.removeEventListener('dsh:suggest-prompt:accept', fn); },
    setDevices(value) { devices = value; for (const fn of events.get('media:devicechange') ?? []) fn(); },
    selectMicrophone(value) { return node(render(), 'data-au05-microphone')[1].onChange({ target: { value } }); },
    snapshot() { render(); return hookStates.get('shell.overlay')[0]; },
    open() { node(render(), 'data-au05-pill')[1].onClick(); return render(); },
    async connect() { await node(render(), 'data-au05-connect')[1].onClick(); await flush(); },
    async poll(eventsToSend = [], extra = {}) {
      const pending = pendingPolls.shift(); assert.ok(pending, 'expected one pending Host poll');
      const events = eventsToSend.map(item => ({ generation, context: pending.args.options.context, at: clock, sequence: ++seq,
        ...(typeof item === 'string' ? { event: item } : item) }));
      pending.resolve({ ok: true, value: nativeSnapshot({ events, overflow: false, ...extra }) }); await flush();
    },
    async failPoll() { const pending = pendingPolls.shift(); assert.ok(pending, 'expected one pending Host poll'); pending.reject(new Error('not_owner')); await flush(); },
    async resolveStatus(extra) { const pending = pendingStatuses.shift(); assert.ok(pending, 'expected one pending status read'); pending.resolve({ ok: true, value: nativeSnapshot(extra) }); await flush(); },
    async expireStatus() { const entry = [...timers].find(([, value]) => value.delay === 1500); assert.ok(entry, 'expected one status timeout'); timers.delete(entry[0]); entry[1].fn(); await flush(); },
    async tick() { const entry = [...timers].find(([, value]) => value.delay === 0) ?? [...timers].find(([, value]) => value.delay === 200 || value.delay === 100 || value.delay === 50 || value.delay === 16); assert.ok(entry, 'expected one scheduled poll');
      timers.delete(entry[0]); entry[1].fn(); await flush(); },
    async tickK1() { const entry = [...timers].find(([, value]) => value.delay === 0); assert.ok(entry, 'expected an immediate K1 state refresh');
      timers.delete(entry[0]); entry[1].fn(); await flush(); },
    pendingPollCount: () => pendingPolls.length,
    async resolveWindows(value = windowsResult) { const pending = pendingWindows.shift(); assert.ok(pending, 'expected Windows request'); pending.resolve({ ok: true, value }); await flush(); },
    async rejectWindows() { const pending = pendingWindows.shift(); assert.ok(pending, 'expected Windows request'); pending.reject(new Error('private native failure')); await flush(); },
    async resolveNativeScroll(value = nativeScrollResult) { const pending = pendingNativeScrolls.shift(); assert.ok(pending, 'expected native scroll request'); pending.resolve({ ok: true, value }); await flush(); },
    async rejectNativeScroll() { const pending = pendingNativeScrolls.shift(); assert.ok(pending, 'expected native scroll request'); pending.reject(new Error('private native failure')); await flush(); },
    pointerMove(type = 'pointermove', properties = {}) { for (const fn of events.get(`document:${type}`) ?? []) fn({ type, ...properties }); },
    keyEvent(type, properties = {}) {
      for (const target of ['document', 'window']) for (const fn of events.get(`${target}:${type}`) ?? []) fn({ type, ...properties });
    },
    mode(value) { return node(render(), 'data-au05-voice-mode')[1].onChange({ target: {
      value: value === 'shortcut' ? `shortcut:${api.snapshot().shortcutPreset}` : value } }); },
    preset(value) { return api.mode(`shortcut:${value}`); },
    shortcut(value) { node(render(), 'data-au05-shortcut')[1].onChange({ target: { value } }); return node(render(), 'data-au05-shortcut-apply')[1].onClick(); },
    knob(value) { return node(render(), 'data-au05-knob-mode')[1].onChange({ target: { value } }); },
    autoConnect(value) { node(render(), 'data-au05-auto-connect')[1].onChange({ target: { checked: value } }); },
    service(value) { ctx.connection.rpc.call = value ? nativeCall : null; },
    async resolveShortcut(value = shortcutResult) { const pending = pendingShortcuts.shift(); assert.ok(pending, 'expected shortcut request'); pending.resolve({ ok: true, value }); await flush(); },
    async rejectShortcut() { const pending = pendingShortcuts.shift(); assert.ok(pending, 'expected shortcut request'); pending.reject(new Error('private native chord failure')); await flush(); },
    async enableVoice() { await node(render(), 'data-au05-voice')[1].onChange({ target: { checked: true } }); await flush(); },
    mountRegionSurface() {
      const element = (attrs = {}) => ({ isConnected: true, tagName: 'DIV', style: {}, children: [], parentElement: null,
        hovered: true, blockedHover: false, hoveredChildren: [],
        getAttribute: key => attrs[key] ?? null, setAttribute(key, value) { attrs[key] = value; }, closest: () => null,
        getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 20, top: 20, right: 420, bottom: 220, width: 400, height: 200 }),
        appendChild(child) { child.parentElement = this; this.children.push(child); },
        remove() { this.parentElement.children = this.parentElement.children.filter(item => item !== this); },
        matches(selector) { return selector === ':hover' && this.hovered; },
        querySelector() { return this.blockedHover ? {} : null; },
        querySelectorAll(selector) { return selector === ':hover' ? this.hoveredChildren : []; },
        dispatchEvent(event) { wheelEvents.push({ target: this, event }); return !event.defaultPrevented; },
        focus() { document.activeElement = this; }, scrollIntoView() {} });
      element.scrollable = (target, values = {}) => {
        const geometry = element(), focus = target.focus, closest = target.closest;
        return Object.assign(target, geometry, { focus, closest, clientHeight: 200, scrollHeight: 1000, scrollTop: 100,
          overflowY: 'auto', scrollBy(options) { actions.push(['region-scroll', options.top, options.behavior]); } }, values);
      };
      document.body = element(); document.createElement = () => element(); document.querySelectorAll = () => [];
      return element;
    },
    mountQuestion(key = 'question-device') {
      let clicks = 0, focusCalls = 0;
      const visible = { isConnected: true, closest: () => null, getClientRects: () => [{}], getAttribute: () => null };
      const field = { ...visible, value: '', focus() { focusCalls++; document.activeElement = field;
        for (const fn of events.get('document:focusin') ?? []) fn(); } };
      const buttons = Array.from({ length: 4 }, () => ({ ...visible, disabled: false, click() { clicks++; } }));
      const card = { ...visible, getAttribute: () => key,
        querySelectorAll: selector => selector === '[data-question-scroll] textarea' ? [field] : buttons };
      document.querySelectorAll = () => [card];
      api.status('first', { pendingInteraction: { kind: 'question', key, sessionId: 'first',
        getSnapshot: () => ({ state: 'open', channel: 'waterfall', closed: false }) } });
      return { field, buttons, clicks: () => clicks, focusCalls: () => focusCalls };
    },
    mountRegionQuestion() {
      const element = api.mountRegionSurface(), question = api.mountQuestion();
      Object.assign(question.field, element()); question.field.value = '';
      const card = element({ 'data-question-key': 'question-device' }), group = element();
      const options = [true, false].map(checked => {
        const option = element({ role: 'radio', 'aria-checked': String(checked) });
        const row = element({ 'data-option-row': '' }); row.parentElement = group;
        option.parentElement = row; option.click = () => { option.clicks = (option.clicks ?? 0) + 1; };
        return option;
      });
      group.querySelectorAll = () => options;
      question.buttons[1].disabled = true;
      card.querySelectorAll = selector => selector.includes('radiogroup') ? [group]
        : selector === '[data-question-scroll] textarea' ? [question.field]
        : selector === 'section > footer button' ? question.buttons
        : selector.includes('first-child') ? [{ textContent: '1 / 1' }] : [];
      document.querySelectorAll = selector => selector === '[data-question-key]' ? [card] : [];
      return { ...question, options, card, group };
    },
    mountComposer(sessionId = 'first') {
      const bridge = render('conversation.input.left', { sessionId }); let focusCalls = 0;
      const card = { isConnected: true, querySelectorAll: () => [input] };
      const input = { isConnected: true, closest: selector => selector === '[data-composer-card]' ? card : null,
        getClientRects: () => [{}], focus() { focusCalls++; document.activeElement = input; } };
      const marker = { isConnected: true, closest: () => card }; bridge[1].ref.current = marker;
      const focusInput = value => { document.activeElement = value ? input : {}; for (const fn of events.get('document:focusin') ?? []) fn(); };
      focusInput(true);
      return { card, input, marker, focus: focusInput, focusCalls: () => focusCalls };
    },
    mountScroll(sessionId = 'first', instance = 'conversation.input.dock') {
      const bridge = render('conversation.input.dock', { sessionId }, instance);
      const root = { isConnected: true, dataset: { conversationSession: sessionId }, closest: () => null,
        getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 10, top: 10, right: 610, bottom: 610, width: 600, height: 600 }),
        contains(value) { for (let node = value; node; node = node.parentElement) if (node === root) return true; return false; } };
      const port = { isConnected: true, parentElement: root, tagName: 'DIV', clientWidth: 600, clientHeight: 500, scrollTop: 500, scrollHeight: 2000, overflowY: 'auto',
        closest: () => null, getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 10, top: 10, right: 610, bottom: 510, width: 600, height: 500 }),
        hovered: true, blockedHover: false, hoveredChildren: [], matches(selector) { return selector === ':hover' && this.hovered; },
        querySelector() { return this.blockedHover ? {} : null; },
        querySelectorAll(selector) { return selector === ':hover' ? this.hoveredChildren : []; },
        getAttribute: name => name === 'data-conversation-scroll' ? '' : null,
        hasAttribute: name => name === 'data-conversation-scroll',
        dispatchEvent(event) { wheelEvents.push({ target: this, event }); return !event.defaultPrevented; },
        scrollBy(options) { actions.push(['scroll', sessionId, options.top, options.behavior]); } };
      const marker = { isConnected: true, parentElement: port, closest: selector => selector === '[data-conversation-content]' ? root : null };
      bridge[1].ref.current = marker;
      return { bridge, root, port, marker };
    },
    computedStyle(value) { sandbox.getComputedStyle = value ? port => ({ overflowY: port.overflowY, flexDirection: port.flexDirection }) : undefined; },
    pollArgs: () => pendingPolls[0]?.args,
    select(id) { for (const row of Object.values(rows)) row.retainedBy.mainView = row.id === id ? 1 : 0;
      current.set(bindings[id]); list.set({ byId: rows }); },
    status(id, value) { const next = new Map(sessionStatus.getSnapshot()); next.set(id, value); sessionStatus.set(next); },
    focus(value, { notify = true } = {}) { focused = value; if (notify) for (const fn of events.get(`window:${value ? 'focus' : 'blur'}`) ?? []) fn(); },
    visibility(value) { document.visibilityState = value; for (const fn of events.get('document:visibilitychange') ?? []) fn(); },
    ambiguous() { rows.second.retainedBy.mainView = 1; list.set({ byId: rows }); },
    replaceOwner() { owners.first = { session: { cancel() { actions.push(['replacement-cancel']); } } }; list.set({ byId: rows }); },
    withdrawSpeech() { effects.get('speech:0')?.cleanup?.(); effects.delete('speech:0'); },
    async dispose() { for (const [key, effect] of effects) if (key.startsWith('navigation:') || key.startsWith('speech:')) effect.cleanup?.(); await dispose(); await flush(); },
    unmount(name = 'shell.overlay') { for (const [key, effect] of effects) if (key.startsWith(`${name}:`)) { effect.cleanup?.(); effects.delete(key); } hookStates.delete(name); },
    eventSequence: () => seq, resolveConnect: () => connectResolver(),
  };
  return api;
}

test('Studio factory requires RPC, exports shared bridges and mounts no direct overlay or native fallback', async t => {
  assert.throws(() => harness({ studio: true, studioRpc: null }), /explicit rpc function/);
  const ui = harness({ studio: true, serviceAvailable: false }); t.after(() => ui.dispose());
  assert.equal(typeof ui.plugin.createStudioActions, 'function');
  assert.equal(typeof ui.plugin.mountActionBridges, 'function');
  assert.equal(ui.registrations.has('shell.overlay'), false);
  assert.deepEqual(ui.registrationOptions.map(item => item.id), ['au05-studio-input-bridge', 'au05-studio-scroll-bridge']);
  await flush(); assert.equal(ui.bridgeCalls.length, 0); assert.equal(ui.nativeCalls.length, 0);
  assert.equal(ui.controller.getSnapshot().transport, 'studio');
  ui.open(); assert.equal(node(ui.render(), 'data-au05-connect')[2], '显式连接 Studio 按键桥');
  assert.equal(node(ui.render(), 'data-au05-auto-connect'), undefined);
  assert.equal(node(ui.render(), 'data-au05-lights'), undefined);
  assert.equal(node(ui.render(), 'data-au05-experimental-k1-lamp'), undefined);
  assert.equal(node(ui.render(), 'data-au05-k1-lamp-note')[2], '灯光由 Studio 管理。');
  assert.equal(ui.controller.setExperimentalK1Lamp(true), false);
  await ui.connect(); assert.deepEqual(ui.bridgeCalls.map(item => item.method), ['connect', 'poll']);
  assert.equal(node(ui.render(), 'data-au05-connection')[2], '桥监听中');
  assert.match(node(ui.render(), 'data-au05-device-status')[2], /按键桥监听中/);
  assert.equal(ui.nativeCalls.length, 0);
});

test('Studio ignores saved auto-connect and voice consent but retains microphone/mode preferences', async t => {
  for (const mode of ['dsh', 'windows', 'shortcut', 'custom']) {
    const storage = memoryStorage(preferencesV3({ mode, autoConnect: true, microphoneId: 'saved-mic',
      enabledByMode: { dsh: true, windows: true, shortcut: true, custom: true } }));
    const ui = harness({ studio: true, storage }); t.after(() => ui.dispose());
    await flush(); ui.open(); assert.equal(ui.snapshot().voiceMode, mode);
    assert.equal(ui.snapshot().voice.microphoneId, 'saved-mic'); assert.equal(ui.snapshot().autoConnect, false);
    assert.equal(ui.snapshot().voice.enabled, false); assert.equal(ui.snapshot().voicePreferenceEnabled, false);
    assert.equal(ui.controller.setAutoConnect(true), false);
    assert.equal(JSON.parse(storage.getItem(voicePreferencesKey)).autoConnect, true, 'Studio does not rewrite direct auto-connect preference');
    await ui.connect(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.tracks.length, 0); assert.deepEqual(ui.actions, []);
    assert.equal(ui.bridgeCalls.some(item => ['windowsVoice', 'shortcutVoice'].includes(item.method)), false);
    ui.mode(mode === 'dsh' ? 'windows' : 'dsh'); assert.equal(ui.snapshot().voice.enabled, false);
    assert.equal(ui.nativeCalls.length, 0);
  }
});

test('K2 requests session-scoped suggestion acceptance before submit in direct and Studio modes', async t => {
  for (const [studio, feedback] of [[false, false], [false, true], [true, false]]) {
    const ui = harness({ studio }); t.after(() => ui.dispose()); ui.open();
    if (feedback) ui.controller.setKeyFeedback(true);
    await ui.connect();
    let ghost = true, accepted = 0;
    const sessions = [];
    const remove = ui.onSuggestionAccept(event => {
      sessions.push(event.detail.sessionId);
      assert.equal(event.cancelable, true);
      if (!ghost) return;
      event.preventDefault(); ghost = false; accepted++;
    });
    await ui.poll(['k2.down', 'k2.down', 'k2.up']);
    assert.equal(accepted, 1); assert.equal(ui.submitted.first, 0);
    await ui.tick(); await ui.poll(['k2.down', 'k2.up']);
    assert.equal(ui.submitted.first, 1, 'next press sends the completed draft');
    assert.deepEqual(sessions, ['first', 'first']);
    ghost = true;
    ui.status('first', { pendingInteraction: { kind: 'approval', key: 'approve-before-ghost', sessionId: 'first', answerable: true, answer() {} } });
    await ui.tick(); await ui.poll(['k2.down', 'k2.up']);
    assert.equal(sessions.length, 2, 'pending interactions take priority over suggestion');
    ui.status('first', {}); ui.select('second'); await ui.tick();
    await ui.poll(['k2.down', 'k2.up']);
    assert.equal(sessions.at(-1), 'second'); assert.equal(ui.submitted.second, 0);
    remove(); await ui.tick(); await ui.poll(['k2.down', 'k2.up']);
    assert.equal(ui.submitted.second, 1, 'absent plugin preserves normal submit');
  }
});

test('K2/K3 short-light opt-in does not change idle, running, approval or focus action guards', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.controller.setKeyFeedback(true); await ui.connect();
  await ui.poll(['k3.down', 'k3.down', 'k3.up']); assert.equal(ui.cancelled.first, 0, 'idle K3 never invents work to cancel');
  ui.status('first', { running: true }); await ui.tick(); await ui.poll(['k3.down', 'k3.down', 'k3.up']);
  assert.equal(ui.cancelled.first, 1);
  const answers = [];
  ui.status('first', { pendingInteraction: { kind: 'approval', key: 'feedback-reject', sessionId: 'first', answerable: true, answer: value => answers.push(value) } });
  await ui.tick(); await ui.poll(['k3.down', 'k3.down', 'k3.up', 'k3.down', 'k3.up']);
  assert.deepEqual(answers, ['rejected']);
  ui.status('first', { running: true }); ui.focus(false); await ui.tick();
  await ui.poll(['k2.down', 'k2.up', 'k3.down', 'k3.up']);
  assert.equal(ui.submitted.first, 0); assert.equal(ui.cancelled.first, 1);
  assert.equal(ui.snapshot().keyFeedback, true); assert.equal(ui.constraints.length, 0);
});

test('Studio injected events reuse K2 submit and exactly-once scoped K2/K3 approval rejection', async t => {
  const ui = harness({ studio: true }); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll(['k2.down', 'k2.down', 'k2.up']); assert.equal(ui.submitted.first, 1);
  const answers = [];
  const approval = key => ({ kind: 'approval', key, sessionId: 'first', answerable: true, answer: answer => answers.push(answer) });
  ui.status('first', { pendingInteraction: approval('reject-once') }); await ui.tick();
  await ui.poll(['k3.down', 'k3.down', 'k3.up', 'k3.down', 'k3.up', 'k2.down', 'k2.up']);
  assert.deepEqual(answers, ['rejected']); assert.equal(ui.submitted.first, 1);
  ui.status('first', { pendingInteraction: approval('allow-once') }); await ui.tick();
  await ui.poll(['k2.down', 'k2.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up']);
  assert.deepEqual(answers, ['rejected', 'allowed-once']);
  ui.status('first', { pendingInteraction: { ...approval('foreign'), sessionId: 'second' } }); await ui.tick();
  await ui.poll(['k2.down', 'k2.up', 'k3.down', 'k3.up']);
  assert.deepEqual(answers, ['rejected', 'allowed-once']); assert.equal(ui.submitted.first, 1);
  assert.equal(ui.nativeCalls.length, 0);
});

test('Studio K1 explicitly enables the existing voice path and never submits its transcription', async t => {
  const ui = harness({ studio: true }); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll(['k1.down', 'k1.up']); assert.equal(ui.constraints.length, 0);
  await ui.enableVoice(); assert.equal(ui.constraints.length, 1); assert.equal(ui.tracks[0].stopped, true);
  await ui.tick(); await ui.poll(['k1.down']); assert.equal(ui.snapshot().voice.phase, 'recording');
  assert.equal(ui.controller.setExperimentalK1Lamp(true), false, 'Studio cannot opt in even after connect');
  await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 0); await ui.poll(['k1.up']);
  assert.deepEqual(ui.actions.filter(item => item[0] === 'insert'), [['insert', 'first', '测试']]);
  assert.equal(ui.submitted.first, 0); assert.ok(ui.tracks.every(track => track.stopped));
  assert.equal(ui.nativeCalls.length, 0);
});

test('Studio Windows and shortcut requests use only injected RPC and retain composer and abort guards', async t => {
  for (const mode of ['windows', 'shortcut', 'custom']) {
    const ui = harness({ studio: true, deferWindows: true, deferShortcut: true }); t.after(() => ui.dispose());
    ui.open(); ui.mode(mode); await ui.enableVoice(); await ui.connect();
    await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.bridgeCalls.some(item => ['windowsVoice', 'shortcutVoice'].includes(item.method)), false, 'missing composer cannot authorize external voice');
    ui.mountComposer(); await ui.tick(); const context = ui.pollArgs().options.context;
    await ui.poll(['k1.down', 'k1.down', 'k1.up']);
    const method = mode === 'windows' ? 'windowsVoice' : 'shortcutVoice';
    const requests = ui.bridgeCalls.filter(item => item.method === method); assert.equal(requests.length, 1);
    assert.equal(requests[0].args.gesture.context, context); assert.equal(requests[0].args.gesture.generation, 1);
    assert.equal(requests[0].args.gesture.sequence, 3); assert.equal(requests[0].signal.aborted, false);
    ui.focus(false); assert.equal(requests[0].signal.aborted, true);
    if (mode === 'windows') await ui.resolveWindows(); else await ui.resolveShortcut();
    assert.equal(ui.snapshot().voice.phase, 'ready'); assert.equal(ui.nativeCalls.length, 0);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
  }
});

test('Studio rejects old context, stale/replayed events, unfocused/hidden and replaced-session targets', async t => {
  const ui = harness({ studio: true }); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll([{ event: 'k2.down', at: 99000 }, 'k2.up']); assert.equal(ui.submitted.first, 0);
  await ui.tick(); await ui.poll([{ event: 'k2.down', at: 100001 }, 'k2.up']); assert.equal(ui.submitted.first, 0);
  await ui.tick(); await ui.poll([{ event: 'k2.down', sequence: 1 }, 'k2.up']); assert.equal(ui.submitted.first, 0);
  await ui.tick(); const oldContext = ui.pollArgs().options.context; ui.select('second');
  await ui.poll([{ event: 'k2.down', context: oldContext }, 'k2.up']); assert.equal(ui.submitted.second, 0);
  await ui.tick(); ui.focus(false); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.second, 0);
  ui.focus(true); await ui.tick(); ui.visibility('hidden'); await ui.poll(['k2.down', 'k2.up']);
  assert.equal(ui.submitted.second, 0);
  ui.visibility('visible'); ui.select('first'); await ui.tick(); ui.replaceOwner(); await ui.poll(['k2.down', 'k2.up']);
  assert.equal(ui.submitted.first, 0);
  await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.first, 1);
  assert.equal(ui.nativeCalls.length, 0);
});

test('Studio disposal aborts injected requests, unsubscribes and ignores late events without native cleanup', async t => {
  const ui = harness({ studio: true }); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect();
  await ui.poll(['k1.down']); assert.equal(ui.snapshot().voice.phase, 'recording'); await ui.tick();
  const pending = ui.bridgeCalls.at(-1), before = ui.controller.getSnapshot();
  await ui.controller.dispose(); assert.equal(pending.signal.aborted, true);
  const disposedSnapshot = ui.controller.getSnapshot();
  assert.equal(before.inputFeedback.k1, 'down'); assert.deepEqual({ ...disposedSnapshot.inputFeedback }, {});
  assert.equal(ui.timers.size, 0); assert.ok(ui.tracks.every(track => track.stopped));
  assert.equal(ui.ctx.uiSession.adapter.current.listeners.size, 0);
  assert.equal(ui.ctx.uiSession.sessionStatus.listeners.size, 0); assert.equal(ui.ctx.sessions.list.listeners.size, 0);
  await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.first, 0); assert.equal(ui.controller.getSnapshot(), disposedSnapshot);
  const disconnects = ui.bridgeCalls.filter(item => item.method === 'disconnect').length;
  await ui.controller.dispose(); await ui.controller.connect();
  assert.equal(ui.bridgeCalls.filter(item => item.method === 'disconnect').length, disconnects);
  assert.equal(ui.nativeCalls.length, 0);
});

test('Studio poll loss recovers status and disconnects exclusively through injected transport', async t => {
  const ui = harness({ studio: true, statusSnapshot: { state: 'stopped', connected: false } }); t.after(() => ui.dispose());
  ui.open(); await ui.connect(); await ui.failPoll();
  assert.deepEqual(ui.bridgeCalls.map(item => item.method), ['connect', 'poll', 'status', 'disconnect']);
  assert.equal(ui.nativeCalls.length, 0); assert.equal(ui.timers.size, 0);
  assert.match(ui.snapshot().message, /Studio 按键桥已中断/);
});

test('Studio connection failures remain injected and never fall back to native connect', async t => {
  const calls = [];
  const ui = harness({ studio: true, studioRpc: async (method, args, signal) => { calls.push({ method, args, signal }); throw new Error('bridge unavailable'); } });
  t.after(() => ui.dispose()); ui.open(); await ui.connect();
  assert.deepEqual(calls.map(item => item.method), ['connect', 'disconnect']);
  assert.equal(ui.snapshot().connected, false); assert.equal(ui.snapshot().transport, 'studio');
  assert.equal(ui.nativeCalls.length, 0); assert.equal(ui.timers.size, 0);
});

test('product overlay is collapsed and inert until explicit connect; no token/debug collector UI', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  const initial = ui.render(); assert.equal(node(initial, 'data-au05-panel'), undefined); assert.equal(ui.calls.length, 0);
  const panel = ui.open(); assert.ok(node(panel, 'data-au05-connect')); assert.equal(ui.calls.length, 0);
  assert.equal(find(panel, item => item[0] === 'input' && item[1].type === 'password'), undefined);
  assert.doesNotMatch(JSON.stringify(panel), /临时观察令牌|限时120秒|事件报告|视图挂载/);
  assert.match(JSON.stringify(panel), /灯光反馈|按键1|按键2|按键3|旋钮/);
  assert.equal(node(panel, 'data-au05-k1-lamp-note'), undefined, 'normal Direct view omits lamp implementation notes');
  assert.equal(node(panel, 'data-au05-light-brightness-status'), undefined, 'unset brightness does not need a status paragraph');
  assert.equal(node(panel, 'data-au05-shortcut-recovery'), undefined, 'normal view does not advertise recovery internals');
  assert.doesNotMatch(JSON.stringify(panel), /未验证实体灯|实体灯未验证/);
  assert.equal(node(panel, 'data-au05-mode-capabilities'), undefined);
  await ui.connect(); assert.deepEqual(ui.calls.map(call => call.method), ['au05/connect', 'au05/poll']);
  const before = ui.calls.length; node(ui.render(), 'data-au05-close')[1].onClick(); ui.render();
  assert.equal(ui.calls.length, before, 'folding does not disconnect or reconnect');
  assert.match(source, /var\(--dsw-alias-bg-base,Canvas\)/); assert.match(source, /var\(--dsw-alias-label-primary,CanvasText\)/);
  assert.doesNotMatch(source, /--dsw-alias-interactive-bg-hover|sessionStorage|fetch\(/);
  assert.match(source, /:focus-visible/);
  assert.match(source, /prefers-reduced-motion/);
});

test('grouped settings remain inert and knob help follows the selected behavior', t => {
  const ui = harness(); t.after(() => ui.dispose());
  const panel = ui.open();
  for (const marker of ['data-au05-device-settings', 'data-au05-advanced']) {
    const section = node(panel, marker);
    assert.equal(section[0], 'details'); assert.equal(section[1].open, undefined);
  }
  const row = node(panel, 'data-au05-connection-row');
  for (const marker of ['data-au05-device-status', 'data-au05-connect', 'data-au05-disconnect']) assert.ok(node(row, marker));
  assert.equal(node(panel, 'data-au05-session')[2], '会话：待命', 'idle remains visible independently of original device lighting');
  assert.equal(node(panel, 'data-au05-voice-mode')[0], 'select');
  assert.equal(find(panel, item => item[0] === 'input' && item[1]?.type === 'radio'), undefined);
  assert.ok(node(panel, 'data-au05-auto-connect'));
  assert.ok(node(node(panel, 'data-au05-device-settings'), 'data-au05-auto-connect'));
  assert.equal(visibleNode(panel, 'data-au05-auto-connect'), undefined, 'startup preference is not a daily control');
  assert.equal(node(panel, 'data-au05-auto-connect-help').at(-1), 'DSH 启动时自动连接');
  const layout = JSON.stringify(panel);
  assert.ok(layout.indexOf('data-au05-auto-connect-help') > layout.indexOf('data-au05-connection-row'));
  assert.ok(layout.indexOf('data-au05-auto-connect-help') > layout.indexOf('data-au05-inspector'));
  for (const marker of ['data-au05-microphone', 'data-au05-knob-mode', 'data-au05-lights'])
    assert.ok(node(node(panel, 'data-au05-device-settings'), marker), marker);
  for (const marker of ['data-au05-light-brightness', 'data-au05-light-diagnostics'])
    assert.ok(node(node(panel, 'data-au05-advanced'), marker), marker);
  for (const [mode, text] of [['sessions', '切换会话'], ['scroll', '上下滚动当前会话'], ['scroll-page', '整屏滚动当前会话'], ['disabled', '旋转无动作']]) {
    ui.knob(mode);
    assert.match(JSON.stringify(find(ui.render(), item => item[1]?.['data-au05-mapping'] === 'knob')), new RegExp(text));
  }
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
});

test('panel polish aligns named settings without duplicate knob copy or controller effects', async t => {
  const ui = harness({ optionalNavigation: true }); t.after(() => ui.dispose());
  const panel = ui.open(), microphone = node(panel, 'data-au05-microphone-settings');
  assert.equal(microphone[1].className, 'au05-field');
  assert.equal(find(microphone, item => item[0] === 'label')[1].htmlFor, node(microphone, 'data-au05-microphone')[1].id);
  const actions = find(microphone, item => item[1]?.className === 'au05-field-actions');
  assert.ok(node(actions, 'data-au05-refresh-microphones'));
  assert.ok(node(actions, 'data-au05-voice-settings'), 'configuration stays with microphone controls');
  const knob = find(panel, item => item[1]?.['data-au05-mapping'] === 'knob');
  assert.doesNotMatch(visibleText(knob), /旋钮：/);
  assert.match(visibleText(knob), /高亮区域.*切换区域/s);
  assert.equal(node(panel, 'data-au05-connection-row')[1]['data-studio'], false);
  assert.equal(node(panel, 'data-au05-connection-row')[1]['data-status-hidden'], false);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
});

test('Escape consumes only an open panel event and restores pill focus without actions', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  const closed = ui.render(); let focused = 0, prevented = 0, stopped = 0;
  node(closed, 'data-au05-pill')[1].ref.current = { focus() { focused++; } };
  const event = key => ({ key, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  closed[1].onKeyDown(event('Escape'));
  assert.equal(prevented, 0); assert.equal(stopped, 0);
  const panel = ui.open();
  panel[1].onKeyDown(event('Enter'));
  assert.ok(node(ui.render(), 'data-au05-panel')); assert.equal(prevented, 0);
  panel[1].onKeyDown(event('Escape'));
  assert.equal(node(ui.render(), 'data-au05-panel'), undefined);
  assert.equal(focused, 1); assert.equal(prevented, 1); assert.equal(stopped, 1);
  assert.equal(node(ui.render(), 'data-au05-pill')[1]['aria-expanded'], false);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
});

test('compact capsule highlights actionable faults with visible panel detail', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  assert.equal(node(ui.render(), 'data-au05-connection')[2], '未连接');
  await ui.connect(); assert.equal(node(ui.render(), 'data-au05-connection')[2], '已连接');
  await ui.poll([], { lightResult: 'mismatch' });
  assert.equal(node(ui.render(), 'data-au05-connection')[2], '需处理');
  assert.equal(node(ui.render(), 'data-au05-pill')[1]['data-attention'], true);
  assert.equal(node(ui.render(), 'data-au05-light-status')[1].role, 'alert');
  assert.match(node(ui.render(), 'data-au05-light-status')[2], /配置回读不一致/);
  assert.doesNotMatch(visibleText(ui.render()), /不代表实体灯已亮或已熄灭/);
  const before = ui.calls.length;
  node(ui.render(), 'data-au05-close')[1].onClick();
  assert.equal(node(ui.render(), 'data-au05-panel'), undefined);
  assert.equal(node(ui.render(), 'data-au05-connection')[2], '需处理');
  assert.equal(ui.calls.length, before);
});

test('normal panel omits verbose explanations and duplicate key help without changing actions', async t => {
  const ui = harness({ optionalNavigation: true }); t.after(() => ui.dispose());
  const defaultPanel = ui.open();
  assert.equal(node(defaultPanel, 'data-au05-preferences-status'), undefined, 'saving normally is silent');
  assert.equal(node(defaultPanel, 'data-au05-voice-status'), undefined, 'unchecked voice needs no duplicate disabled label');
  assert.equal(node(defaultPanel, 'data-au05-key-help'), undefined);
  assert.ok(find(node(defaultPanel, 'data-au05-light-diagnostics'), item => item[0] === 'summary' && item[2] === '灯光诊断'));
  assert.doesNotMatch(visibleText(defaultPanel), /当前映射|仅查看，不执行操作|非光学检测|已实测|Task 模式交付待验证/);
  for (const mode of ['dsh', 'windows', 'shortcut', 'custom']) {
    ui.mode(mode); const text = JSON.stringify(ui.render());
    assert.doesNotMatch(text, /三种模式分别记住|不会安装、启动或检测|录音生命周期|仅作用于当前唯一活动会话|语音设置保存在当前客户端|首次优先 AU05，选定后记住选择/);
    assert.equal(node(ui.render(), 'data-au05-connect')[1].disabled, false);
    assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, false);
  }
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
});

test('restoration warnings appear once outside collapsed settings and recovery failures remain actionable', t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const countStatus = tree => !Array.isArray(tree) ? 0
    : Number(tree[1]?.['data-au05-light-status'] === '') + tree.slice(2).reduce((sum, child) => sum + countStatus(child), 0);
  for (const lightResult of ['restore_written', 'restore_mismatch']) {
    ui.snapshot().lightResult = lightResult;
    const tree = ui.render(), status = visibleNode(tree, 'data-au05-light-status');
    assert.equal(countStatus(tree), 1, 'one status, not an outside alert plus a duplicate in settings');
    assert.ok(status); assert.equal(status[1].role, 'alert');
    assert.equal(node(node(tree, 'data-au05-device-settings'), 'data-au05-light-status'), undefined);
  }
  ui.mode('shortcut');
  Object.assign(ui.snapshot(), { connected: true, shortcutRecovery: false });
  assert.match(visibleNode(ui.render(), 'data-au05-shortcut-recovery')[2], /不可用.*重新加载 AU05 组件/);
  assert.equal(visibleNode(ui.render(), 'data-au05-shortcut-recovery')[1].role, 'alert');
  ui.snapshot().shortcutRecovery = true;
  assert.equal(node(ui.render(), 'data-au05-shortcut-recovery'), undefined, 'successful recovery support is silent');
  ui.mode('windows');
  ui.snapshot().windowsVoiceState = { state: 'unknown', error: null, level: 0 };
  assert.match(JSON.stringify(visibleNode(ui.render(), 'data-au05-windows-voice-state')), /收音状态未知/);
  assert.doesNotMatch(JSON.stringify(visibleNode(ui.render(), 'data-au05-windows-voice-state')), /指示灯已关闭/);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0);
});

test('lamp UI distinguishes pending, delivery, verified configuration and mismatched readback without claiming physical success', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const status = () => node(ui.render(), 'data-au05-light-status');
  assert.match(status()[2], /灯光.*待确认/);
  assert.equal(status()[1].title, undefined);
  await ui.connect(); assert.match(status()[2], /已提交，未回读/);
  for (const [lightResult, expected] of [['verified', /配置回读一致/], ['mismatch', /配置回读不一致/],
    ['failed', /未确认.*唤醒设备.*断开重连/], ['pending', /待确认/], ['constructor', /待确认/]]) {
    await ui.poll([], { lightResult });
    assert.match(status()[2], expected); assert.doesNotMatch(status()[2], /已亮|已显示|已恢复|写入失败/);
    await ui.tick();
  }
  node(ui.render(), 'data-au05-lights')[1].onChange({ target: { checked: false } });
  assert.equal(status()[2], '已请求恢复原灯光');
  await ui.poll([], { lightResult: 'verified' });
  assert.equal(status()[2], '已请求恢复原灯光', 'old enabled poll cannot confirm a newly requested restore');
  for (const [lightResult, expected] of [['pending', '已请求恢复原灯光'], ['restore_written', '恢复原灯光已提交，未回读'],
    ['restored', '原灯光配置已恢复并回读一致'], ['restore_mismatch', '原灯光恢复回读不一致'],
    ['failed', '恢复原灯光未确认，请断开重连']]) {
    await ui.tick(); await ui.poll([], { lightResult });
    assert.equal(status()[2], expected); assert.doesNotMatch(status()[2], /灯光已关闭|物理.*已/);
  }
});

test('lamp toggles invalidate previous verified results including late connect and off-on poll races', async t => {
  const ui = harness({ deferConnect: true, connectSnapshot: { lightResult: 'verified' } }); t.after(() => ui.dispose()); ui.open();
  const status = () => node(ui.render(), 'data-au05-light-status')[2];
  const toggle = checked => node(ui.render(), 'data-au05-lights')[1].onChange({ target: { checked } });
  const connected = ui.connect(); await flush(); toggle(false); ui.resolveConnect(); await connected;
  assert.equal(status(), '已请求恢复原灯光', 'connect result preceded changed preference');
  await ui.poll([], { lightResult: 'restored' }); assert.equal(status(), '原灯光配置已恢复并回读一致');
  await ui.tick(); toggle(true); assert.match(status(), /待确认/);
  toggle(false); assert.equal(status(), '已请求恢复原灯光');
  await ui.poll([], { lightResult: 'restored' }); assert.equal(status(), '已请求恢复原灯光', 'same boolean after two toggles is still a newer request');
  await ui.tick(); await ui.poll([], { lightResult: 'restored' }); assert.equal(status(), '原灯光配置已恢复并回读一致');
});

test('panel exposes a separate translated connection status without changing fixed pill accessibility or IDs', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const status = () => node(ui.render(), 'data-au05-device-status');
  assert.equal(status()[1].role, 'status'); assert.equal(status()[2], '未连接');
  assert.equal(status()[1]['aria-label'], '连接状态', 'status purpose remains named without a repeated visible prefix');
  assert.equal(node(ui.render(), 'data-au05-pill')[1]['aria-label'], 'AU05 设备控制：未连接');
  assert.equal(node(ui.render(), 'data-au05-panel')[1].id, 'au05-device-panel');
  await ui.connect(); assert.equal(status()[2], '已连接');
  await ui.poll([], { state: 'no_device', connected: false, error: 'no_device' });
  assert.equal(status(), undefined, 'same connection failure is consolidated into the recovery alert');
  assert.match(node(ui.render(), 'data-au05-connection-alert')[2], /未找到 AU05/);
});

const nativeFailureCases = [
  ['mode_conflict', /Studio 协作模式正在运行，请先在 AU05 \/ Studio 停止跟随，再连接直连模式。/],
  ['no_device', /未找到 AU05.*接收器.*唤醒/],
  ['access_denied', /访问被拒绝.*退出 AU05 Studio.*权限/],
  ['protocol_error', /通信协议异常.*重新启用 AU05 插件/],
  ['compile_or_runtime_failed', /编译或运行失败.*PowerShell 7.*安装完整性/],
  ['start_failed', /无法启动.*PowerShell 7（pwsh）.*安装完整性/],
  ['unsupported_runtime', /运行环境不受支持.*Windows.*PowerShell 7/],
];

for (const [code, expected] of nativeFailureCases) {
  test(`native ${code} is translated on connect and poll, including state-only fallback`, async t => {
    for (const phase of ['connect', 'poll']) for (const errorField of [true, false]) {
      const failure = { state: errorField ? 'failed' : code, connected: false, error: errorField ? code : null };
      const ui = harness({ connectSnapshot: phase === 'connect' ? failure : {} }); t.after(() => ui.dispose());
      ui.open(); await ui.connect();
      if (phase === 'poll') await ui.poll(['k2.down'], failure);
      const text = JSON.stringify(node(ui.render(), 'data-au05-connection-alert'));
      assert.match(text, expected); assert.doesNotMatch(text, new RegExp(code));
      assert.equal(ui.snapshot().error, code, 'retain only the fixed public diagnostic code');
      assert.equal(ui.calls.filter(call => call.method === 'au05/connect').length, 1);
      assert.equal([...ui.timers.values()].some(timer => timer.delay === 200), false, 'terminal errors never poll or reconnect');
      assert.equal(node(ui.render(), 'data-au05-connect')[1].disabled, false);
      assert.equal(ui.submitted.first, 0); assert.equal(ui.tracks.length, 0);
    }
  });
}

test('native diagnostics redact unknown strings, identifiers, paths and prototype keys on connect and poll', async t => {
  for (const value of ['private-device-id C:/private/native.ps1', 'constructor', '__proto__', 'toString', { message: 'private-error' }]) {
    for (const phase of ['connect', 'poll']) {
      const failure = { state: typeof value === 'string' ? value : 'failed', connected: false, error: value };
      const ui = harness({ connectSnapshot: phase === 'connect' ? failure : {} }); t.after(() => ui.dispose());
      ui.open(); await ui.connect(); if (phase === 'poll') await ui.poll([], failure);
      const text = JSON.stringify(ui.render());
      assert.doesNotMatch(text, /private-device-id|private\/native|private-error|constructor|__proto__|toString/);
      assert.match(JSON.stringify(node(ui.render(), 'data-au05-message')), /手动重新连接/);
      assert.equal(ui.snapshot().error, null);
    }
  }
});

test('known native error takes priority over terminal state and clears on explicit disconnect or successful reconnect', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll([], { state: 'disconnected', connected: false, error: 'compile_or_runtime_failed' });
  assert.match(JSON.stringify(node(ui.render(), 'data-au05-connection-alert')), /编译或运行失败/);
  assert.equal(ui.snapshot().error, 'compile_or_runtime_failed');
  await ui.connect(); assert.equal(ui.snapshot().error, null);
  assert.equal(node(ui.render(), 'data-au05-message'), undefined);
  await ui.poll([], { state: 'access_denied', connected: false, error: 'unknown_native_error' });
  assert.equal(ui.snapshot().error, 'access_denied');
  await node(ui.render(), 'data-au05-disconnect')[1].onClick(); await flush();
  assert.equal(ui.snapshot().error, null); assert.equal(node(ui.render(), 'data-au05-message'), undefined);
});

test('poll owner loss recovers one matching-generation native terminal diagnostic without reconnecting', async t => {
  const ui = harness({ statusSnapshot: { state: 'disconnected', connected: false, error: 'compile_or_runtime_failed' } });
  t.after(() => ui.dispose()); ui.open(); await ui.connect(); await ui.failPoll();
  assert.equal(ui.snapshot().error, 'compile_or_runtime_failed');
  assert.match(JSON.stringify(node(ui.render(), 'data-au05-connection-alert')), /编译或运行失败/);
  assert.deepEqual(ui.calls.map(call => call.method), ['au05/connect', 'au05/poll', 'au05/status', 'au05/disconnect']);
  assert.equal(ui.timers.size, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
});

test('status recovery rejects wrong generation, nonterminal/connected results and unknown native codes', async t => {
  for (const statusSnapshot of [
    { state: 'compile_or_runtime_failed', connected: false, error: 'compile_or_runtime_failed', generation: 2 },
    { state: 'compile_or_runtime_failed', connected: true, error: 'compile_or_runtime_failed' },
    { state: 'ready', connected: false, error: 'compile_or_runtime_failed' },
    { state: 'connecting', connected: false, error: 'compile_or_runtime_failed' },
    { state: 'failed', connected: false, error: 'private-id C:/secret/native.ps1' },
  ]) {
    const ui = harness({ statusSnapshot }); t.after(() => ui.dispose()); ui.open(); await ui.connect(); await ui.failPoll();
    assert.equal(ui.snapshot().error, null);
    assert.equal(node(ui.render(), 'data-au05-message')[2], '设备连接中断，请手动重新连接');
    assert.equal(ui.calls.filter(call => call.method === 'au05/status').length, 1);
    assert.equal(ui.calls.filter(call => call.method === 'au05/disconnect').length, 1);
    assert.equal(ui.timers.size, 0); assert.doesNotMatch(JSON.stringify(ui.render()), /private-id|secret/);
  }
});

test('unavailable or timed-out status retains generic failure and never retries', async t => {
  const unavailable = harness(); t.after(() => unavailable.dispose()); unavailable.open(); await unavailable.connect(); await unavailable.failPoll();
  assert.equal(node(unavailable.render(), 'data-au05-message')[2], '设备连接中断，请手动重新连接');
  assert.equal(unavailable.calls.filter(call => call.method === 'au05/status').length, 1); assert.equal(unavailable.timers.size, 0);
  const delayed = harness({ deferStatus: true }); t.after(() => delayed.dispose()); delayed.open(); await delayed.connect(); await delayed.failPoll();
  await delayed.expireStatus(); assert.equal(delayed.timers.size, 0);
  await delayed.resolveStatus({ state: 'compile_or_runtime_failed', connected: false, error: 'compile_or_runtime_failed' });
  assert.equal(delayed.snapshot().error, null);
  assert.equal(node(delayed.render(), 'data-au05-message')[2], '设备连接中断，请手动重新连接');
  assert.equal(delayed.calls.filter(call => call.method === 'au05/status').length, 1);
  assert.equal(delayed.calls.filter(call => call.method === 'au05/disconnect').length, 1);
});

test('late status cannot clobber explicit disconnect, new connect or disposed controller', async t => {
  for (const action of ['disconnect', 'connect', 'dispose']) {
    const ui = harness({ deferStatus: true }); t.after(() => ui.dispose()); ui.open(); await ui.connect(); await ui.failPoll();
    if (action === 'disconnect') { await node(ui.render(), 'data-au05-disconnect')[1].onClick(); await flush(); }
    else if (action === 'connect') await ui.connect();
    else await ui.dispose();
    const before = ui.snapshot(), calls = ui.calls.length;
    await ui.resolveStatus({ state: 'compile_or_runtime_failed', connected: false, error: 'compile_or_runtime_failed' });
    assert.equal(ui.snapshot(), before); assert.equal(ui.calls.length, calls, 'late status never sends a stale stop request');
    assert.equal(ui.snapshot().error, null);
    if (action === 'connect') assert.equal(ui.snapshot().connected, true);
  }
});

test('new controller sends the current draft only once per physical press and rejects repeat/expired events', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll(['k2.down', 'k2.down', 'k2.up']); assert.equal(ui.submitted.first, 1);
  await ui.tick(); await ui.poll([{ event: 'k2.down', at: 98999 }, 'k2.up']); assert.equal(ui.submitted.first, 1);
  await ui.tick(); await ui.poll([{ event: 'k2.down', generation: 99 }, 'k2.up']); assert.equal(ui.submitted.first, 1);
  await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.first, 2);
});

test('approval is scoped, answerable and single-use; never grants permanent permission or falls through to send', async t => {
  const ui = harness(); t.after(() => ui.dispose());
  const answers = []; ui.status('first', { running: true, pendingInteraction: { kind: 'approval', key: 'approval-1',
    sessionId: 'first', answerable: true, answer: value => answers.push(value) } });
  ui.open(); await ui.connect(); await ui.poll(['k2.down', 'k2.up', 'k2.down', 'k2.up']);
  assert.deepEqual(answers, ['allowed-once']); assert.equal(ui.submitted.first, 0);
  ui.status('first', { running: true, pendingInteraction: { kind: 'approval', key: 'approval-2',
    sessionId: 'first', answerable: true, answer: value => answers.push(value) } });
  await ui.tick(); await ui.poll(['k3.down', 'k3.up']); assert.deepEqual(answers, ['allowed-once', 'rejected']);
  ui.status('first', { pendingInteraction: { kind: 'question', key: 'question-1', sessionId: 'first', answerable: true } });
  await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.first, 0);
  ui.status('first', { pendingInteraction: { kind: 'approval', key: 'foreign', sessionId: 'second', answerable: true,
    answer: value => answers.push(value) } });
  await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.deepEqual(answers, ['allowed-once', 'rejected']);
});

test('cancel uses the current session binding and never a global Escape or stale binding', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.status('first', { running: true }); ui.open(); await ui.connect();
  await ui.poll(['k3.down', 'k3.down', 'k3.up']); assert.equal(ui.cancelled.first, 1);
  await ui.tick(); const old = ui.pollArgs().options.context; ui.select('second');
  await ui.poll([{ event: 'k3.down', context: old }, 'k3.up']); assert.equal(ui.cancelled.first, 1); assert.equal(ui.cancelled.second, 0);
  ui.status('second', { running: true }); await ui.tick(); await ui.poll(['k3.down', 'k3.up']); assert.equal(ui.cancelled.second, 1);
});

test('session, approval, owner, focus and visibility changes invalidate in-flight events; held gestures do not cross contexts', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll(['k2.down']); assert.equal(ui.submitted.first, 1);
  ui.select('second'); await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.second, 0);
  await ui.tick(); const stale = ui.pollArgs().options.context; ui.focus(false);
  await ui.poll([{ event: 'k2.down', context: stale }, 'k2.up']); assert.equal(ui.submitted.second, 0);
  ui.focus(true); await ui.tick(); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.second, 1);
  await ui.tick(); ui.visibility('hidden'); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.second, 1);
  ui.visibility('visible'); ui.select('first'); await ui.tick(); ui.replaceOwner(); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.first, 1);
  await ui.tick(); ui.ambiguous(); await ui.poll(['k2.down', 'k2.up']); assert.equal(ui.submitted.first, 1);
});

test('rotary navigation uses public workspace order, skips archives/subagents and invalidates the rest of the old batch', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('sessions'); await ui.connect();
  await ui.poll(['right.pulse', 'k2.down', 'k2.up']); assert.deepEqual(ui.actions, [['open', 'second']]);
  assert.equal(ui.submitted.first + ui.submitted.second, 0);
  await ui.tick(); await ui.poll(['right.pulse']); assert.deepEqual(ui.actions, [['open', 'second']], 'no wrapping at end');
  await ui.tick(); await ui.poll(['left.pulse']); assert.deepEqual(ui.actions, [['open', 'second'], ['open', 'first']]);
});

test('knob focuses the unique composer owned by the session slot without inherited keyboard props; unmount revokes it', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('sessions'); let focused = 0;
  const bridge = ui.render('conversation.input.left', { sessionId: 'first' });
  assert.equal(bridge[0], 'span'); assert.equal(bridge[1]['aria-hidden'], true);
  const card = { isConnected: true, querySelectorAll(selector) {
    assert.equal(selector, '[data-composer-input][contenteditable="true"][role="textbox"]'); return [input]; } };
  const input = { isConnected: true, closest(selector) { return selector === '[data-composer-card]' ? card : null; },
    getClientRects: () => [{}], focus(options) { assert.equal(options.preventScroll, true); focused++; ui.document.activeElement = input; } };
  bridge[1].ref.current = { isConnected: true, closest(selector) { assert.equal(selector, '[data-composer-card]'); return card; } };
  await ui.connect(); await ui.poll(['knob.down', 'knob.down', 'knob.up']); assert.equal(focused, 1);
  ui.unmount('conversation.input.left'); await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 1);
});

test('composer bridge fails closed for detached, ambiguous, hidden, nested or stale session inputs without global lookup', async t => {
  const ui = harness(); t.after(() => ui.dispose()); let focused = 0, inputs = [];
  const bridge = ui.render('conversation.input.left', { sessionId: 'first' });
  const card = { isConnected: true, querySelectorAll: () => inputs };
  const marker = { isConnected: true, closest: () => card }; bridge[1].ref.current = marker;
  const input = { isConnected: true, closest: selector => selector === '[data-composer-card]' ? card : null,
    getClientRects: () => [{}], focus() { focused++; ui.document.activeElement = input; } };
  ui.open(); await ui.connect();
  await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  inputs = [input, input]; await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  inputs = [input]; marker.isConnected = false; await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  marker.isConnected = true; input.isConnected = false; await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  input.isConnected = true; input.getClientRects = () => []; await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  input.getClientRects = () => [{}]; input.closest = () => ({}); await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  input.closest = selector => selector === '[data-composer-card]' ? card : {};
  await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  input.closest = selector => selector === '[data-composer-card]' ? card : null;
  ui.replaceOwner(); await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  ui.select('second'); await ui.tick(); await ui.poll(['knob.down', 'knob.up']); assert.equal(focused, 0);
  assert.equal(ui.document.querySelector, undefined); assert.equal(ui.document.querySelectorAll, undefined);
});

test('task lamp table uses 0 off, 1 solid progress and 2 breathing actionable human attention', async t => {
  const approval = { kind: 'approval', key: 'a', answerable: true, sessionId: 'first', answer() {} };
  const question = { kind: 'question', key: 'q', sessionId: 'first', getSnapshot: () => ({ state: 'open', closed: false, channel: 'rpc' }) };
  const cases = [
    ['idle', {}, true, 'idle', [0, 0, 0, 0]],
    ['running with interrupt request', { running: true }, true, 'running', [0, 0, 2, 1]],
    ['running without cancel capability', { running: true }, false, 'running', [0, 0, 0, 1]],
    ['nonboolean running is not activity', { running: 'true' }, true, 'idle', [0, 0, 0, 0]],
    ['unsupported activity fields are not inferred', { thinking: true, executing: true, backgroundActive: true }, true, 'idle', [0, 0, 0, 0]],
    ['answerable approval', { pendingInteraction: approval }, true, 'approval', [0, 2, 2, 0]],
    ['running remains true while approval pauses progress', { running: true, pendingInteraction: approval }, true, 'approval', [0, 2, 2, 0]],
    ['settled unanswerable approval is not a live prompt', { pendingInteraction: { ...approval, answerable: false } }, true, 'idle', [0, 0, 0, 0]],
    ['approval without answer API is not confirmable', { pendingInteraction: { ...approval, answer: undefined } }, true, 'idle', [0, 0, 0, 0]],
    ['settled retained approval still suppresses progress', { running: true, pendingInteraction: { ...approval, answerable: false } }, true, 'running', [0, 0, 2, 0]],
    ['approval without concrete key is ignored', { pendingInteraction: { ...approval, key: undefined } }, true, 'idle', [0, 0, 0, 0]],
    ['foreign pending cannot pause current progress', { running: true, pendingInteraction: { ...approval, sessionId: 'second' } }, true, 'running', [0, 0, 2, 1]],
    ['unscoped pending is ignored', { pendingInteraction: { ...approval, sessionId: undefined } }, true, 'idle', [0, 0, 0, 0]],
    ['open answerable question needs human confirmation', { pendingInteraction: question }, false, 'attention', [0, 2, 2, 0]],
    ['running paused on question', { running: true, pendingInteraction: question }, true, 'attention', [0, 2, 2, 0]],
    ['waterfall plan review needs human confirmation', { pendingInteraction: { ...question, kind: 'plan-review', getSnapshot: () => ({ state: 'open', closed: false, channel: 'waterfall' }) } }, false, 'attention', [0, 2, 2, 0]],
    ['question with no answer channel is not confirmable', { pendingInteraction: { ...question, getSnapshot: () => ({ state: 'open', closed: false, channel: 'none' }) } }, false, 'idle', [0, 0, 0, 0]],
    ['closed question is no longer actionable', { pendingInteraction: { ...question, getSnapshot: () => ({ state: 'open', closed: true, channel: 'rpc' }) } }, false, 'idle', [0, 0, 0, 0]],
    ['continued question is not blocking progress', { running: true, pendingInteraction: { ...question, getSnapshot: () => ({ state: 'continued', closed: false, channel: 'rpc' }) } }, true, 'running', [0, 0, 2, 1]],
    ['missing question getter fails closed', { running: true, pendingInteraction: { ...question, getSnapshot: undefined } }, false, 'running', [0, 0, 0, 0]],
    ['throwing question getter fails closed', { running: true, pendingInteraction: { ...question, getSnapshot() { throw new Error('synthetic'); } } }, false, 'running', [0, 0, 0, 0]],
    ['unknown confirm kind is not an approval API', { pendingInteraction: { ...approval, kind: 'confirmation' } }, true, 'idle', [0, 0, 0, 0]],
    ['unknown continue kind is not an approval API', { pendingInteraction: { ...approval, kind: 'continue' } }, true, 'idle', [0, 0, 0, 0]],
  ];
  for (const [name, status, cancellable, light, channels] of cases) {
    const ui = harness({ cancellable }); t.after(() => ui.dispose());
    ui.status('first', status); ui.open(); await ui.connect();
    assert.equal(ui.pollArgs().options.light, light, name);
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), channels, name);
    assert.equal(ui.cancelled.first + ui.cancelled.second + ui.submitted.first + ui.submitted.second, 0, 'lamps perform no actions');
  }
});

test('pending removal, answered approvals, turn end and disabled lamps clear without stacking', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const pending = { kind: 'approval', key: 'one', answerable: true, sessionId: 'first', answer() {} };
  ui.status('first', { running: true, pendingInteraction: pending }); await ui.connect();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 2, 2, 0]);
  await ui.poll(['k2.down', 'k2.up']); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 0], 'answered pending no longer lights K2; pending still pauses progress');
  await ui.poll(); ui.status('first', { running: true }); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1], 'pending removal restores running progress');
  await ui.poll(); ui.status('first', { running: false }); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], 'turn end clears all lamps');
  await ui.poll(); ui.status('first', { pendingInteraction: { ...pending, key: 'two' } }); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 2, 2, 0], 'a new approval is a boolean, not accumulated count');
  await ui.poll(); node(ui.render(), 'data-au05-lights')[1].onChange({ target: { checked: false } }); await ui.tick();
  assert.equal(ui.pollArgs().options.lights, false);
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0]);
  await ui.poll(); node(ui.render(), 'data-au05-lights')[1].onChange({ target: { checked: true } });
  ui.status('first', {}); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], 'reenabling never restores removed pending');
});

test('task lamps follow only the unique current main session, retaining background feedback but never background actions', async t => {
  for (const change of ['session', 'ambiguous', 'binding-mismatch', 'blur', 'hidden']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); let answers = 0;
    ui.status('first', { running: true, pendingInteraction: { kind: 'approval', key: 'one', answerable: true, sessionId: 'first', answer() { answers++; } } });
    await ui.connect(); assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 2, 2, 0]);
    await ui.poll();
    if (change === 'session') ui.select('second');
    if (change === 'ambiguous') ui.ambiguous();
    if (change === 'binding-mismatch') ui.ctx.uiSession.adapter.current.set({ key: 'second' });
    if (change === 'blur') ui.focus(false);
    if (change === 'hidden') ui.visibility('hidden');
    await ui.tick();
    const background = change === 'blur' || change === 'hidden';
    assert.equal(ui.pollArgs().options.light, background ? 'approval' : 'idle', change);
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), background ? [0, 2, 2, 0] : [0, 0, 0, 0], change);
    if (background) {
      assert.equal(ui.pollArgs().options.context, null, 'task feedback does not authorize background keys');
      await ui.poll(['k2.down', 'k2.up', 'k3.down', 'k3.up']); assert.equal(answers, 0);
      assert.equal(ui.cancelled.first + ui.cancelled.second + ui.submitted.first + ui.submitted.second, 0);
    }
    if (change === 'session') {
      await ui.poll(); ui.status('second', { running: true }); await ui.tick();
      assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1], 'old approval cannot leak to another running session');
    }
  }
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.status('first', { running: true }); ui.focus(false); await ui.connect();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1], 'background progress remains solid for the bound session');
  await ui.poll(['k3.down', 'k3.up']); assert.equal(ui.cancelled.first, 0);
});

test('only active cross-app mode hides task lamps on blur or hidden and restores their current state on return', async t => {
  for (const crossApp of [false, true]) for (const change of ['blur', 'hidden']) {
    for (const kind of ['running', 'approval', 'question', 'plan-review']) {
      const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.preset('bugu'); await ui.enableVoice();
      ui.controller.setBageshuoCrossApp(crossApp);
      let answers = 0;
      const pending = kind === 'approval'
        ? { kind, key: kind, sessionId: 'first', answerable: true, answer() { answers++; } }
        : { kind, key: kind, sessionId: 'first', getSnapshot: () => ({ state: 'open', closed: false, channel: 'rpc' }) };
      ui.status('first', { running: true, ...(kind === 'running' ? {} : { pendingInteraction: pending }) });
      await ui.connect();
      const channels = kind === 'running' ? [0, 0, 2, 1] : [0, 2, 2, 0];
      const light = kind === 'running' ? 'running' : kind === 'approval' ? 'approval' : 'attention';
      assert.deepEqual(Array.from(ui.pollArgs().options.channels), channels);
      await ui.poll();
      if (change === 'blur') ui.focus(false); else ui.visibility('hidden');
      await ui.tick();
      const options = ui.pollArgs().options;
      assert.equal(options.bageshuoCrossAppEnabled, crossApp);
      assert.equal(options.light, crossApp ? 'idle' : light, `${kind}/${change}/${crossApp}`);
      assert.deepEqual(Array.from(options.channels), crossApp ? [0, 0, 0, 0] : channels);
      assert.equal(options.lights, true, 'focus loss requests off, not ownership release');
      assert.equal(options.context, null, 'background feedback never authorizes DSH actions');
      await ui.poll(['k2.down', 'k2.up', 'k3.down', 'k3.up']);
      assert.deepEqual(Array.from(ui.snapshot().lightObservation.reasons), crossApp ? [null, null, null, null]
        : kind === 'running' ? [null, null, 'cancel', 'progress'] : [null, kind, kind, null]);
      if (change === 'blur') ui.focus(true); else ui.visibility('visible');
      await ui.tick();
      assert.equal(ui.pollArgs().options.light, light);
      assert.deepEqual(Array.from(ui.pollArgs().options.channels), channels, 'return restores task feedback without a new run');
      assert.equal(answers, 0);
      assert.equal(ui.cancelled.first + ui.cancelled.second + ui.submitted.first + ui.submitted.second, 0);
      assert.equal(ui.tracks.length, 0);
    }
  }
});

test('cross-app return rereads changed or completed tasks rather than replaying pre-blur lamps', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.preset('bugu'); await ui.enableVoice();
  ui.controller.setBageshuoCrossApp(true); ui.status('first', { running: true }); await ui.connect();
  await ui.poll(); ui.focus(false); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0]);
  await ui.poll();
  ui.status('first', { running: true, pendingInteraction: { kind: 'approval', key: 'new', sessionId: 'first', answerable: true, answer() {} } });
  await ui.tick(); assert.equal(ui.pollArgs().options.light, 'idle');
  await ui.poll(); ui.focus(true); await ui.tick();
  assert.equal(ui.pollArgs().options.light, 'approval');
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 2, 2, 0]);
  await ui.poll(); ui.focus(false); await ui.tick(); await ui.poll();
  ui.status('first', { running: false }); ui.focus(true); await ui.tick();
  assert.equal(ui.pollArgs().options.light, 'idle');
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0]);
  assert.equal(ui.cancelled.first + ui.submitted.first, 0);
});

test('cross-app task focus policy follows live opt-in and mode, not the stored preference alone', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.preset('bugu'); await ui.enableVoice();
  ui.status('first', { running: true }); ui.focus(false); await ui.connect();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1]);
  for (const enabled of [true, false, true]) {
    ui.controller.setBageshuoCrossApp(enabled); await ui.poll(); await ui.tick();
    assert.equal(ui.pollArgs().options.bageshuoCrossAppEnabled, enabled);
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), enabled ? [0, 0, 0, 0] : [0, 0, 2, 1]);
  }
  await ui.poll(); ui.preset('typeless'); await ui.tick();
  assert.equal(ui.snapshot().bageshuoCrossAppEnabled, true, 'saved preference remains intact');
  assert.equal(ui.pollArgs().options.bageshuoCrossAppEnabled, false, 'other voice modes are not cross-app mode');
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1]);
  await ui.poll(); ui.preset('bugu'); await ui.tick();
  assert.equal(ui.pollArgs().options.bageshuoCrossAppEnabled, true);
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0]);
});

test('cross-app background task suppression preserves trusted K1 recording and sends no voice actions', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.preset('bugu'); await ui.enableVoice();
  ui.controller.setBageshuoCrossApp(true); ui.status('first', { running: true }); await ui.connect();
  ui.focus(false); await ui.poll([], { bageshuo: { state: 'recording', error: null } }); await ui.tick();
  assert.equal(ui.pollArgs().options.light, 'recording');
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [2, 0, 0, 0]);
  await ui.poll([], { bageshuo: { state: 'recording', error: null } });
  assert.deepEqual(Array.from(ui.snapshot().lightObservation.reasons), ['recording', null, null, null]);
  ui.focus(true); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [2, 0, 2, 1]);
  assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  assert.equal(ui.calls.some(call => call.method?.includes('shortcutVoice')), false);
  assert.equal(ui.cancelled.first + ui.submitted.first, 0);
});

test('live question and plan-review snapshots are reread on each poll without replacing their carriers', async t => {
  for (const kind of ['question', 'plan-review']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); let reads = 0;
    let live = { state: 'open', closed: false, channel: 'rpc' };
    const carrier = { kind, key: kind, sessionId: 'first', getSnapshot() { reads++; return live; } };
    ui.status('first', { running: true, pendingInteraction: carrier }); await ui.connect();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 2, 2, 0], `${kind} open`);
    const firstReads = reads;
    await ui.poll(); live = { ...live, state: 'continued' }; await ui.tick();
    assert.ok(reads > firstReads, 'same carrier is observed again');
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1], `${kind} continued no longer requires confirmation`);
    await ui.poll(); live = { ...live, closed: true }; await ui.tick();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 0], `${kind} closed retained carrier waits for projection removal`);
    await ui.poll(); ui.status('first', { running: true }); await ui.tick();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 2, 1], `${kind} removed`);
    await ui.poll(); ui.status('first', { running: false }); await ui.tick();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], `${kind} turn ended`);
  }
});

test('legacy K1 lamp opt-out leaves actual DSH recording active without making idle knob busy', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect();
  ui.controller.setExperimentalK1Lamp(false);
  const acquire = ui.media.getUserMedia; let release;
  ui.media.getUserMedia = options => new Promise(resolve => { release = () => resolve(acquire(options)); });
  await ui.poll(['k1.down']); assert.equal(ui.snapshot().voice.phase, 'recording'); assert.equal(ui.snapshot().voice.preparing, true);
  await ui.tick(); assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], 'permission/acquisition preparation is not recording');
  await ui.poll(); release(); await flush();
  assert.equal(ui.snapshot().voice.preparing, false); assert.equal(ui.tracks.at(-1).stopped, false);
  await ui.tick(); assert.equal(ui.pollArgs().options.light, 'recording');
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], 'unverified K1 recording lamp is deliberately disabled while voice capture remains active');
  await ui.poll(['k1.up']); await ui.tick();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], 'recording end clears K1');
});

test('K1 configuration defaults on and only actual focused DSH recording authorizes channel zero', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect();
  const toggle = value => ui.controller.setExperimentalK1Lamp(value);
  assert.equal(ui.snapshot().experimentalK1Lamp, true);
  assert.equal(node(ui.render(), 'data-au05-experimental-k1-lamp'), undefined, 'no separate lamp opt-in checkbox');
  const acquire = ui.media.getUserMedia; let release;
  ui.media.getUserMedia = options => new Promise(resolve => { release = () => resolve(acquire(options)); });
  await ui.poll(['k1.down']); assert.equal(ui.snapshot().voice.preparing, true);
  await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 0, 'preparation never writes recording configuration');
  await ui.poll(); release(); await flush(); assert.equal(ui.snapshot().voice.preparing, false);
  ui.media.getUserMedia = acquire;
  await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 2);
  await ui.poll(); toggle(false); await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 0);
  await ui.poll(); toggle(true); await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 2);
  await ui.poll(['k1.up']); await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 0, 'phase end clears configuration');
  await ui.poll(['k1.down']); await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 2);
  ui.focus(false); await ui.poll(); await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 0, 'loss of focus cancels capture');
  for (const mode of ['windows', 'shortcut', 'custom']) {
    const external = harness({ deferWindows: true, deferShortcut: true }); t.after(() => external.dispose());
    external.open(); external.mountComposer(); external.mode(mode); await external.enableVoice(); await external.connect();
    assert.equal(external.snapshot().experimentalK1Lamp, true);
    await external.poll(['k1.down', 'k1.up']); await external.tick(); assert.equal(external.snapshot().voice.phase, 'requesting');
    assert.equal(external.pollArgs().options.channels[0], 0);
    await external.poll(); if (mode === 'windows') await external.resolveWindows(); else await external.resolveShortcut();
    await external.tick(); assert.equal(external.snapshot().voice.phase, 'requested'); assert.equal(external.pollArgs().options.channels[0], 0);
  }
});

test('K1 lamp defaults on across reconnect and recreation without persisting a separate preference', async t => {
  const storage = memoryStorage(preferencesV3({ experimentalK1Lamp: false }));
  const ui = harness({ storage }); t.after(() => ui.dispose()); ui.open();
  assert.equal(ui.snapshot().experimentalK1Lamp, true, 'obsolete saved opt-out is ignored');
  assert.equal(node(ui.render(), 'data-au05-experimental-k1-lamp'), undefined);
  await ui.connect(); const writes = storage.writes.length;
  ui.controller.setExperimentalK1Lamp(false); assert.equal(ui.snapshot().experimentalK1Lamp, false);
  assert.equal(storage.writes.length, writes, 'legacy override is never persisted');
  await node(ui.render(), 'data-au05-disconnect')[1].onClick();
  assert.equal(ui.snapshot().experimentalK1Lamp, true);
  await ui.connect(); assert.equal(ui.snapshot().experimentalK1Lamp, true);
  await ui.dispose();
  const next = harness({ storage }); t.after(() => next.dispose()); next.open(); assert.equal(next.snapshot().experimentalK1Lamp, true);
});

test('idle no-takeover snapshot failure is neutral only with current all-off host evidence; diagnostics remain intact', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  const snapshot = ui.snapshot();
  const request = { type: 'request', requestId: 7, state: 'idle', channels: [0, 0, 0, 0] };
  const result = { ...request, type: 'result', result: 'failed', reason: 'snapshot_unavailable', readback: { stage: 'initial', matched: 0 } };
  const reset = () => Object.assign(snapshot, { connected: true, state: 'ready', lightsEnabled: true, error: null,
    lightState: 'idle', lightResult: 'failed', lightError: 'snapshot_unavailable', lightTrace: [request, result], snapshotDiagnostics: [] });
  reset();
  assert.equal(node(ui.render(), 'data-au05-light-status')[2], '灯光：待命，尚未接管');
  assert.equal(node(ui.render(), 'data-au05-light-status')[1].role, 'status');
  assert.equal(node(ui.render(), 'data-au05-pill')[1]['data-attention'], false);
  assert.equal(snapshot.lightError, 'snapshot_unavailable'); assert.equal(snapshot.lightResult, 'failed');
  assert.equal(snapshot.lightTrace[1], result);
  snapshot.lightTrace = [request, { ...result, readback: undefined }];
  snapshot.snapshotDiagnostics = [{ outcome: 'auth_unconfirmed' }];
  assert.equal(node(ui.render(), 'data-au05-light-status')[1].role, 'status');
  for (const patch of [
    { lightState: 'running' }, { lightState: 'recording' }, { lightState: 'approval' },
    { lightTrace: [request, { ...result, channels: [2, 0, 0, 0] }] },
    { lightTrace: [{ ...request, brightness: 21 }, result] },
    { lightTrace: [request, { ...result, requestId: 8 }] }, { lightTrace: [] },
    { lightTrace: [request, { ...result, readback: undefined }] },
    { lightTrace: [request, { ...result, readback: { stage: 'post_write', matched: 0 } }] },
    { lightTrace: [request, { ...result, readback: { stage: 'initial', matched: 1 } }] },
    { lightTrace: [request, { ...result, readback: { stage: 'initial', matched: 0, comparison: {} } }] },
    { lightResult: 'restore_mismatch' }, { lightResult: 'restore_written' }, { lightResult: 'mismatch' },
    { error: 'write_failed' },
  ]) {
    reset(); Object.assign(snapshot, patch);
    assert.equal(node(ui.render(), 'data-au05-light-status')[1].role, 'alert', JSON.stringify(patch));
    assert.equal(node(ui.render(), 'data-au05-pill')[1]['data-attention'], true);
  }
  reset(); snapshot.lightBrightnessSaved = false;
  assert.equal(node(ui.render(), 'data-au05-light-status')[1].role, 'status');
  // An independent fault still owns capsule attention.
  snapshot.keyFeedbackSaved = false;
  assert.equal(node(ui.render(), 'data-au05-pill')[1]['data-attention'], true);
});

test('lamp snapshot-unavailable diagnostics propagate from connect and poll without guessing or claiming a write', async t => {
  const ui = harness({ connectSnapshot: { lightResult: 'failed', lightError: 'snapshot_unavailable' } }); t.after(() => ui.dispose());
  ui.open(); await ui.connect();
  assert.equal(ui.snapshot().lightError, 'snapshot_unavailable');
  assert.equal(node(ui.render(), 'data-au05-light-status')[2], '未取得原灯光快照，未写灯');
  await ui.poll([], { lightResult: 'written', lightError: null }); assert.equal(ui.snapshot().lightError, null);
  await ui.tick(); await ui.poll([], { lightResult: 'failed', lightError: 'snapshot_unavailable' });
  assert.equal(ui.snapshot().lightError, 'snapshot_unavailable');
  assert.equal(node(ui.render(), 'data-au05-light-status')[2], '未取得原灯光快照，未写灯');
});

test('K1 lamp clears and recording cancels across focus, visibility, session and ambiguous main changes', async t => {
  for (const change of ['blur', 'hidden', 'session', 'ambiguous']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down']);
    await ui.tick(); assert.deepEqual(Array.from(ui.pollArgs().options.channels), [2, 0, 0, 0], 'actual capture enables K1 by default');
    if (change === 'blur') ui.focus(false);
    if (change === 'hidden') ui.visibility('hidden');
    if (change === 'session') ui.select('second');
    if (change === 'ambiguous') ui.ambiguous();
    await ui.poll(); await ui.tick();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], change);
    assert.equal(ui.tracks.every(track => track.stopped), true, change);
  }
});

test('Windows and third-party requesting/requested phases never claim recording or busy lamps', async t => {
  for (const mode of ['windows', 'shortcut', 'custom']) {
    const ui = harness({ deferWindows: true, deferShortcut: true }); t.after(() => ui.dispose());
    ui.open(); ui.mountComposer(); ui.mode(mode); await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.snapshot().voice.phase, 'requesting'); await ui.tick();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], `${mode} requesting`);
    await ui.poll(); if (mode === 'windows') await ui.resolveWindows(); else await ui.resolveShortcut();
    assert.equal(ui.snapshot().voice.phase, 'requested'); await ui.tick();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0], `${mode} requested`);
    assert.equal(ui.tracks.length, 0);
  }
});

test('overflow and transport failure suppress actions and never reconnect automatically', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll(['k2.down'], { overflow: true }); assert.equal(ui.submitted.first, 0);
  await ui.tick(); await ui.poll([], { generation: 99 });
  assert.equal(ui.calls.filter(call => call.method === 'au05/connect').length, 1);
  assert.equal([...ui.timers.values()].some(timer => timer.delay === 200), false);
  assert.match(JSON.stringify(ui.render()), /手动重新连接/);
});

test('view teardown does not release hardware; plugin teardown does and removes listeners', async () => {
  const ui = harness(); ui.open(); await ui.connect(); ui.unmount();
  assert.equal(ui.calls.filter(call => call.method === 'au05/disconnect').length, 0);
  await ui.dispose(); assert.equal(ui.calls.filter(call => call.method === 'au05/disconnect').length, 1);
  assert.equal(ui.ctx.uiSession.adapter.current.listeners.size, 0); assert.equal(ui.timers.size, 0);
});

test('K1 only records after explicit microphone opt-in; blur cancels audio without uploading or sending', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  await ui.poll(['k1.down', 'k1.up']); assert.equal(ui.tracks.length, 0);
  await node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: true } }); await flush();
  assert.equal(ui.tracks.length, 1); assert.equal(ui.tracks[0].stopped, true, 'permission-only stream closes immediately');
  await ui.tick(); await ui.poll(['k1.down']); assert.equal(ui.tracks.length, 2); assert.equal(ui.tracks[1].stopped, false);
  assert.match(JSON.stringify(ui.render()), /正在录音/);
  ui.focus(false); await flush(); assert.equal(ui.tracks[1].stopped, true);
  await ui.tick(); await ui.poll(['k1.up']);
  assert.equal(ui.actions.filter(item => item[0] === 'transcribe').length, 0);
  assert.equal(ui.submitted.first + ui.submitted.second, 0);
});

test('absent optional speech leaves the capsule available without microphone or Host calls', async t => {
  const ui = harness({ optionalSpeech: false }); t.after(() => ui.dispose());
  assert.ok(node(ui.render(), 'data-au05-pill')); ui.open();
  await node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: true } }); await flush();
  assert.equal(ui.tracks.length, 0); assert.equal(ui.calls.length, 0);
  assert.match(JSON.stringify(ui.render()), /请先在 DSH 配置语音服务/);
});

test('speech namespace withdrawal stops recording and disables voice without hiding the capsule', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  await node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: true } }); await flush(); await ui.connect();
  await ui.poll(['k1.down']); assert.equal(ui.tracks[1].stopped, false);
  ui.withdrawSpeech(); await flush();
  assert.equal(ui.tracks.every(track => track.stopped), true);
  assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, true, 'remembered opt-in is separate from unavailable runtime');
  assert.equal(ui.snapshot().voice.enabled, false);
  assert.ok(node(ui.render(), 'data-au05-pill'));
  await ui.tick(); await ui.poll(['k1.up']);
  assert.equal(ui.actions.filter(item => item[0] === 'transcribe').length, 0);
});

test('K1 release transcribes canonical WAV through the configured service and inserts once without submitting', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  await node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: true } }); await flush(); await ui.connect();
  await ui.poll(['k1.down']); await ui.tick(); await ui.poll(['k1.up']); await flush();
  assert.deepEqual(ui.actions.filter(item => item[0] === 'insert'), [['insert', 'first', '测试']]);
  assert.equal(ui.actions.filter(item => item[0] === 'transcribe').length, 1);
  assert.equal(ui.submitted.first + ui.submitted.second, 0); assert.equal(ui.tracks.every(track => track.stopped), true);
});

test('conflicting transcription survives focus and view changes until explicitly cleared, and blocks replacement audio', async t => {
  const ui = harness({ insertionConflict: true }); t.after(() => ui.dispose()); ui.open();
  await node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: true } }); await flush(); await ui.connect();
  await ui.poll(['k1.down']); await ui.tick(); await ui.poll(['k1.up']); await flush();
  assert.match(JSON.stringify(node(ui.render(), 'data-au05-voice-conflict')), /first.*测试/);
  ui.focus(false); ui.focus(true); ui.select('second');
  assert.match(JSON.stringify(node(ui.render(), 'data-au05-voice-conflict')), /first.*测试/);
  const count = ui.tracks.length; await ui.tick(); await ui.poll(['k1.down', 'k1.up']); assert.equal(ui.tracks.length, count);
  node(ui.render(), 'data-au05-clear-conflict')[1].onClick();
  assert.equal(node(ui.render(), 'data-au05-voice-conflict'), undefined);
});

test('late connect after explicit disconnect is released and never starts polling or restores the UI', async () => {
  const ui = harness({ deferConnect: true }); ui.open(); const connecting = ui.connect(); await flush();
  assert.equal(ui.calls.length, 1); await node(ui.render(), 'data-au05-disconnect')[1].onClick();
  ui.resolveConnect(); await connecting; await flush();
  assert.equal(ui.calls.filter(call => call.method === 'au05/poll').length, 0);
  assert.equal(ui.calls.filter(call => call.method === 'au05/disconnect').length, 2);
  assert.match(JSON.stringify(node(ui.render(), 'data-au05-connection')), /未连接/); await ui.dispose();
});

test('voice modes are controlled, default DSH/off, switch locally without speech, media or Host side effects', async t => {
  const ui = harness({ optionalNavigation: true }); t.after(() => ui.dispose()); ui.open();
  assert.equal(ui.snapshot().voiceMode, 'dsh'); assert.equal(ui.snapshot().voice.enabled, false);
  assert.equal(node(ui.render(), 'data-au05-voice-mode')[1].value, 'dsh');
  ui.mode('windows'); assert.equal(ui.snapshot().voiceMode, 'windows');
  assert.equal(node(ui.render(), 'data-au05-voice-settings'), undefined);
  assert.match(JSON.stringify(ui.render()), /Microsoft.*系统面板手动结束.*断开设备不会停止/);
  await ui.enableVoice(); assert.equal(ui.snapshot().voice.enabled, true);
  ui.withdrawSpeech(); assert.equal(ui.snapshot().voice.enabled, true, 'optional speech withdrawal cannot disable Windows');
  ui.mode('dsh'); assert.equal(ui.snapshot().voice.enabled, false);
  assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0); assert.equal(ui.calls.length, 0);
});

test('Windows K1 down requests once with original Host gesture; release never transcribes, submits, focuses or records', async t => {
  const ui = harness({ optionalSpeech: false }); t.after(() => ui.dispose()); ui.open();
  const composer = ui.mountComposer(); ui.mode('windows'); await ui.enableVoice(); await ui.connect();
  const sentContext = ui.pollArgs().options.context; assert.equal(ui.pollArgs().options.windowsVoice, true);
  await ui.poll(['k1.down', 'k1.down', 'k1.up']);
  const calls = ui.calls.filter(call => call.method === 'au05/windowsVoice'); assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].args.owner, 'string');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args.gesture)), { generation: 1, sequence: 1, context: sentContext });
  assert.equal(ui.snapshot().voice.phase, 'requested');
  assert.match(JSON.stringify(ui.render()), /已请求 Windows 语音输入；请在系统面板结束/);
  assert.doesNotMatch(JSON.stringify(ui.render()), /正在录音|测试语音/);
  assert.equal(composer.focusCalls(), 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  assert.equal(ui.submitted.first + ui.submitted.second, 0);
  await ui.tick(); assert.equal(ui.pollArgs().options.light, 'idle'); assert.equal(ui.pollArgs().options.channels[0], 0);
});

test('Windows requires explicit enable and locally focused unique composer; browser clients never request Host WinH', async t => {
  for (const protocol of ['https:', 'http:', 'dsh-app:']) {
    const ui = harness({ protocol }); t.after(() => ui.dispose()); ui.open(); ui.mode('windows'); await ui.connect();
    await ui.poll(['k1.down', 'k1.up']); assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 0);
    await ui.enableVoice(); await ui.tick(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 0);
    assert.match(JSON.stringify(ui.render()), protocol === 'dsh-app:' ? /请先点击当前会话的输入框/ : /当前浏览器不支持/);
    const composer = ui.mountComposer();
    composer.card.querySelectorAll = () => [composer.input, composer.input];
    await ui.tick(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 0); assert.equal(composer.focusCalls(), 0);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  }
});

test('Windows rejects stale generation/context/age and held keys across mode changes', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode('windows'); await ui.enableVoice(); await ui.connect();
  await ui.poll([{ event: 'k1.down', at: 99000 }, 'k1.up', { event: 'k1.down', context: 'stale' }, 'k1.up',
    { event: 'k1.down', generation: 99 }, 'k1.up']);
  assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 0);
  await ui.tick(); await ui.poll(['k1.down']); assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 1);
  ui.mode('dsh'); ui.mode('windows'); await ui.enableVoice();
  await ui.tick(); await ui.poll(['k1.down', 'k1.up']); assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 1);
  await ui.tick(); await ui.poll(['k1.down', 'k1.up']); assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 2);
});

test('Windows pending results are aborted and ignored after mode, session, composer focus, window blur, unmount or disconnect changes', async t => {
  for (const change of ['mode', 'session', 'composer', 'blur', 'unmount', 'disconnect']) {
    const ui = harness({ deferWindows: true }); t.after(() => ui.dispose()); ui.open(); const composer = ui.mountComposer();
    ui.mode('windows'); await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down', 'k1.down', 'k1.up']);
    const request = ui.calls.find(call => call.method === 'au05/windowsVoice'); assert.ok(request);
    if (change === 'mode') ui.mode('dsh');
    if (change === 'session') ui.select('second');
    if (change === 'composer') composer.focus(false);
    if (change === 'blur') ui.focus(false);
    if (change === 'unmount') ui.unmount('conversation.input.left');
    if (change === 'disconnect') await node(ui.render(), 'data-au05-disconnect')[1].onClick();
    assert.equal(request.signal.aborted, true, change);
    await ui.resolveWindows();
    assert.notEqual(ui.snapshot().voice.phase, 'requested', change);
    assert.match(JSON.stringify(ui.render()), /手动结束/, change);
    assert.doesNotMatch(JSON.stringify(node(ui.render(), 'data-au05-message')), /已取消.*系统语音|已停止.*系统语音/);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  }
});

test('Windows failures render only fixed public Chinese messages and do not disable other hardware actions', async t => {
  for (const value of [{ activated: false, error: 'windows_voice_focus_not_editable' }, { activated: false, error: 'private C:/secret device-id' },
    { activated: false, error: 'constructor' }, { activated: true, error: 'private' }]) {
    const ui = harness({ windowsResult: value }); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode('windows');
    await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down', 'k1.up', 'k2.down', 'k2.up']);
    assert.equal(ui.snapshot().voice.phase, 'error'); assert.equal(ui.submitted.first, 1);
    assert.doesNotMatch(JSON.stringify(ui.render()), /private|secret|device-id|constructor|已请求 Windows 语音输入；请在系统面板结束/);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  }
  const ui = harness({ deferWindows: true }); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode('windows');
  await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down', 'k1.up']); await ui.rejectWindows();
  assert.equal(ui.snapshot().voice.error, 'windows_voice_failed'); assert.doesNotMatch(JSON.stringify(ui.render()), /private native/);
});

test('mode switching cancels DSH recording and requires fresh opt-in; retained transcript blocks silent mode switch', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down']);
  assert.equal(ui.tracks[1].stopped, false); const before = ui.calls.length;
  ui.mode('windows'); assert.equal(ui.tracks.every(track => track.stopped), true); assert.equal(ui.calls.length, before);
  assert.equal(ui.snapshot().voice.enabled, false); await ui.tick(); await ui.poll(['k1.up']); assert.equal(ui.actions.filter(x => x[0] === 'transcribe').length, 0);
  const conflict = harness({ insertionConflict: true }); t.after(() => conflict.dispose()); conflict.open(); await conflict.enableVoice(); await conflict.connect();
  await conflict.poll(['k1.down']); await conflict.tick(); await conflict.poll(['k1.up']); await flush();
  assert.equal(node(conflict.render(), 'data-au05-voice-mode')[1].disabled, true);
  conflict.mode('windows'); assert.equal(conflict.snapshot().voiceMode, 'dsh');
  assert.match(JSON.stringify(node(conflict.render(), 'data-au05-voice-conflict')), /first.*测试/);
  node(conflict.render(), 'data-au05-clear-conflict')[1].onClick(); conflict.mode('windows'); assert.equal(conflict.snapshot().voiceMode, 'windows');
});

test('saved DSH opt-in and microphone restore without catalog, audio, Host RPC or automatic connection', async t => {
  const storage = memoryStorage({ version: 1, mode: 'dsh', enabledByMode: { dsh: true, windows: false }, microphoneId: 'mic-au05' });
  const ui = harness({ storage, devices: [{ kind: 'audioinput', deviceId: 'mic-au05', label: '麦克风 (AU05)' }] }); t.after(() => ui.dispose());
  ui.open(); await flush();
  assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, true);
  assert.equal(node(ui.render(), 'data-au05-microphone')[1].value, 'mic-au05');
  assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0); assert.equal(ui.calls.length, 0);
  await ui.connect(); assert.equal(ui.tracks.length, 0);
  await ui.poll(['k1.down']); assert.equal(ui.tracks.length, 1, 'only fresh explicit physical key starts capture');
  assert.equal(ui.constraints[0].audio.deviceId.exact, 'mic-au05');
  ui.focus(false); assert.equal(ui.tracks[0].stopped, true);
});

test('per-mode opt-ins survive mode changes and plugin recreation without reauthorizing or launching Windows', async t => {
  const storage = memoryStorage(), ui = harness({ storage }); ui.open(); await ui.enableVoice();
  ui.mode('windows'); assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, false, 'first Windows use needs separate consent');
  await ui.enableVoice(); ui.mode('dsh'); assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, true);
  assert.equal(ui.tracks.length, 1, 'returning to a mode does not reopen microphone');
  await ui.dispose();
  const again = harness({ storage }); t.after(() => again.dispose()); again.open();
  assert.equal(node(again.render(), 'data-au05-voice')[1].checked, true); assert.equal(again.snapshot().voiceMode, 'dsh');
  again.mode('windows'); assert.equal(node(again.render(), 'data-au05-voice')[1].checked, true);
  assert.equal(node(again.render(), 'data-au05-microphone'), undefined);
  assert.match(JSON.stringify(node(again.render(), 'data-au05-windows-microphone')), /Windows.*系统设置/);
  assert.equal(again.tracks.length, 0); assert.equal(again.calls.length, 0); assert.equal(again.actions.length, 0);
  node(again.render(), 'data-au05-voice')[1].onChange({ target: { checked: false } });
  assert.equal(JSON.parse(storage.getItem(voicePreferencesKey)).enabledByMode.windows, false);
});

test('DSH microphone enumeration prefers AU05 once, persists only approved fields, and respects explicit selection after reload', async t => {
  const devices = [{ kind: 'audioinput', deviceId: 'mic-other', label: '桌面麦克风' }, { kind: 'audioinput', deviceId: 'mic-au05', label: '麦克风 (AU05)' }, { kind: 'audiooutput', deviceId: 'speaker', label: '扬声器' }];
  const storage = memoryStorage(), ui = harness({ storage, devices }); ui.open(); await flush();
  assert.equal(node(ui.render(), 'data-au05-microphone')[1].value, 'mic-au05');
  ui.selectMicrophone('mic-other');
  assert.equal(node(ui.render(), 'data-au05-microphone')[1].value, 'mic-other');
  await node(ui.render(), 'data-au05-refresh-microphones')[1].onClick();
  assert.equal(ui.tracks.length, 0); assert.equal(ui.calls.length, 0); assert.equal(ui.actions.length, 0);
  for (const [key, value] of storage.writes) {
    assert.equal(key, voicePreferencesKey);
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ['autoConnect', 'bageshuoCrossAppEnabled', 'customShortcut', 'enabledByMode', 'knobMode', 'microphoneId', 'mode', 'shortcutPreset', 'version']);
    assert.equal(JSON.parse(value).bageshuoCrossAppEnabled, false, 'new cross-app preference defaults off');
    assert.deepEqual(Object.keys(JSON.parse(value).enabledByMode).sort(), ['custom', 'dsh', 'shortcut', 'windows']);
    assert.doesNotMatch(value, /桌面|扬声器|audioBase64|transcript|owner|sessionId|provider/);
  }
  await ui.dispose(); const again = harness({ storage, devices }); t.after(() => again.dispose()); again.open(); await flush();
  assert.equal(node(again.render(), 'data-au05-microphone')[1].value, 'mic-other'); assert.equal(again.tracks.length, 0);
});

test('missing saved microphone stays selected and blocks capture rather than falling back to AU05 or system default', async t => {
  const storage = memoryStorage({ version: 1, mode: 'dsh', enabledByMode: { dsh: true, windows: false }, microphoneId: 'unplugged' });
  const ui = harness({ storage, devices: [{ kind: 'audioinput', deviceId: 'other-au05', label: 'AU05' }] }); t.after(() => ui.dispose());
  ui.open(); await flush(); assert.equal(node(ui.render(), 'data-au05-microphone')[1].value, 'unplugged');
  assert.match(JSON.stringify(ui.render()), /不会自动改用其他麦克风|不会自动换麦克风/);
  await ui.connect(); await ui.poll(['k1.down']); assert.equal(ui.tracks.length, 0);
  assert.equal(JSON.parse(storage.getItem(voicePreferencesKey)).microphoneId, 'unplugged');
});

test('invalid or unavailable preference storage fails safely with an unsaved warning and in-memory controls', async t => {
  for (const seed of ['not-json', { version: 2, mode: 'windows', enabledByMode: { dsh: true, windows: true }, microphoneId: null },
    { version: 1, mode: 'dsh', enabledByMode: { dsh: 'true', windows: false }, microphoneId: null },
    { version: 1, mode: 'dsh', enabledByMode: { dsh: true, windows: false }, microphoneId: {} }]) {
    const ui = harness({ storage: memoryStorage(seed) }); t.after(() => ui.dispose()); ui.open();
    assert.equal(ui.snapshot().voicePreferenceEnabled, false); assert.equal(ui.tracks.length, 0);
    assert.match(JSON.stringify(node(ui.render(), 'data-au05-preferences-status')), /无法保存/);
  }
  const blocked = harness({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } } });
  t.after(() => blocked.dispose()); blocked.open(); blocked.mode('windows'); await blocked.enableVoice();
  assert.equal(blocked.snapshot().voicePreferenceEnabled, true); assert.equal(blocked.snapshot().voicePreferencesSaved, false);
  assert.match(JSON.stringify(node(blocked.render(), 'data-au05-preferences-status')), /本次仍可使用/);
  assert.equal(blocked.tracks.length, 0); assert.equal(blocked.calls.length, 0);
});

test('Windows restored preference never enumerates or acquires DSH microphone and has no per-app microphone selector', async t => {
  const storage = memoryStorage({ version: 1, mode: 'windows', enabledByMode: { dsh: true, windows: true }, microphoneId: 'dsh-specific' });
  const ui = harness({ storage }); t.after(() => ui.dispose()); ui.open(); await flush();
  assert.equal(ui.snapshot().voiceMode, 'windows'); assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, true);
  assert.equal(node(ui.render(), 'data-au05-microphone-settings'), undefined); assert.equal(ui.tracks.length, 0);
  assert.equal(ui.calls.length, 0); assert.equal(ui.actions.length, 0);
});

test('optional configuration button opens only the public voice settings bundle and does not enable voice', async t => {
  const ui = harness({ optionalNavigation: true }); t.after(() => ui.dispose()); ui.open();
  node(ui.render(), 'data-au05-voice-settings')[1].onClick(); await flush();
  assert.deepEqual(ui.actions, [['configure', '@deepseek-ai/dsh-experimental-voice-input-bundle']]);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0);
});

const savedPreferences = (update = {}) => ({ version: 2, mode: 'shortcut', enabledByMode: { dsh: false, windows: false, shortcut: true },
  microphoneId: null, shortcutPreset: 'typeless', shortcut: 'RightAlt', autoConnect: false, ...update });

test('third-party controls expose a compact preset and necessary stop notice without side effects', async t => {
  const ui = harness({ optionalNavigation: true }); t.after(() => ui.dispose()); ui.open(); ui.mode('shortcut');
  assert.equal(node(ui.render(), 'data-au05-voice-mode')[1].value, 'shortcut:typeless');
  assert.equal(ui.snapshot().shortcutPreset, 'typeless'); assert.equal(ui.snapshot().shortcut, 'RightAlt');
  assert.equal(node(ui.render(), 'data-au05-voice')[1].checked, false);
  assert.equal(node(ui.render(), 'data-au05-microphone-settings'), undefined);
  assert.equal(node(ui.render(), 'data-au05-voice-settings'), undefined);
  assert.equal(node(ui.render(), 'data-au05-shortcut-help'), undefined, 'preset has no redundant help copy');
  assert.match(JSON.stringify(node(ui.render(), 'data-au05-shortcut-stop-help')), /结束|停止/);
  assert.match(JSON.stringify(find(ui.render(), item => item[1]?.['data-au05-mapping'] === 'k1')), /聚焦输入框.*单按切换Typeless.*RightAlt/);
  assert.ok(find(node(ui.render(), 'data-au05-shortcut-diagnostics'), item => item[0] === 'summary' && item[2] === '快捷键诊断'));
  assert.equal(node(ui.render(), 'data-au05-mode-typeless')[2], 'Typeless');
  assert.equal(node(ui.render(), 'data-au05-shortcut-preset'), undefined);
  assert.equal(node(ui.render(), 'data-au05-key-help'), undefined);
  ui.mode('custom'); ui.shortcut('ctrl+shift+space'); assert.equal(ui.snapshot().shortcut, 'Ctrl+Shift+Space');
  ui.mode('shortcut'); ui.preset('typeless'); assert.equal(ui.snapshot().shortcut, 'RightAlt');
  await ui.enableVoice(); ui.withdrawSpeech(); assert.equal(ui.snapshot().voice.enabled, true);
  ui.mode('dsh'); ui.mode('windows'); ui.mode('shortcut'); assert.equal(ui.snapshot().voice.enabled, true);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
});

test('v1 migrates preserving mode opt-ins and microphone; new settings default off and third mode independently persists', async t => {
  for (const mode of ['dsh', 'windows']) {
    const storage = memoryStorage({ version: 1, mode, enabledByMode: { dsh: true, windows: true }, microphoneId: 'saved-mic',
      autoConnect: true, shortcut: 'Ctrl+W', context: 'private-context', token: 'private-token' });
    const ui = harness({ storage }); ui.open(); await flush();
    assert.equal(ui.snapshot().voiceMode, mode); assert.equal(ui.snapshot().autoConnect, false);
    ui.mode('shortcut'); assert.equal(ui.snapshot().voicePreferenceEnabled, false); assert.equal(ui.snapshot().shortcut, 'RightAlt');
    await ui.enableVoice(); ui.mode('custom'); await ui.enableVoice(); ui.shortcut('Ctrl+Alt+F9'); ui.autoConnect(true);
    const saved = JSON.parse(storage.getItem(voicePreferencesKey));
    assert.equal(saved.version, 3); assert.equal(saved.microphoneId, 'saved-mic');
    assert.deepEqual(saved.enabledByMode, { dsh: true, windows: true, shortcut: true, custom: true });
    assert.doesNotMatch(JSON.stringify(saved), /private|context|token/);
    assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
    ui.autoConnect(false); await ui.dispose();
    const again = harness({ storage }); t.after(() => again.dispose()); again.open(); await flush();
    assert.equal(again.snapshot().voiceMode, 'custom'); assert.equal(again.snapshot().shortcutPreset, 'typeless');
    assert.equal(again.snapshot().shortcut, 'Ctrl+Alt+F9'); assert.equal(again.snapshot().voice.enabled, true);
    assert.equal(again.calls.length, 0); assert.equal(again.tracks.length, 0); assert.equal(again.actions.length, 0);
  }
});

test('safe custom chords canonicalize but reject commands, naked text, OS and destructive shortcuts without storing raw input', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mode('custom');
  for (const [input, expected] of [['rightalt', 'RightAlt'], ['shift+ctrl+space', 'Ctrl+Shift+Space'], ['alt+ctrl+f9', 'Ctrl+Alt+F9'],
    ['Shift+Z', 'Shift+Z'], ['Alt+7', 'Alt+7'], ['f9', 'F9'], [' rightalt ', 'RightAlt'], ['Ctrl+F24', 'Ctrl+F24']]) {
    ui.shortcut(input); assert.equal(ui.snapshot().shortcut, expected, input);
  }
  for (const input of ['hello', 'A', 'Space', 'Win+H', 'Fn+A', 'Ctrl+Enter', 'Alt+Esc', 'Ctrl+Tab', 'Shift+Delete',
    'Alt+F4', 'Ctrl+Shift+F4', 'Ctrl+Alt+F4', 'Ctrl+Ctrl+F9', 'Ctrl+F25', 'C:/private/run.ps1', 'Ctrl+F9;start bad',
    ...'WQRLTNOPSCVXAZY'.split('').flatMap(key => [`Ctrl+${key}`, `Ctrl+Shift+${key}`, `Ctrl+Alt+Shift+${key}`])]) {
    ui.shortcut(input); assert.equal(ui.snapshot().shortcut, 'Ctrl+F24', input);
    assert.match(JSON.stringify(node(ui.render(), 'data-au05-message')), /快捷键不受支持/);
    assert.equal(JSON.parse(ui.storage.getItem(voicePreferencesKey)).customShortcut, 'Ctrl+F24');
  }
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0);
});

test('shortcut each fresh K1 down sends one complete tap with exact guard, no up action and independent poll opt-in', async t => {
  const ui = harness({ optionalSpeech: false }); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode('shortcut');
  await ui.enableVoice(); await ui.connect();
  const context = ui.pollArgs().options.context;
  assert.equal(ui.pollArgs().options.shortcutVoice, true); assert.equal(ui.pollArgs().options.windowsVoice, false);
  await ui.poll(['k1.down', 'k1.down', 'k1.up']);
  const calls = () => ui.calls.filter(call => call.method === 'au05/shortcutVoice');
  assert.equal(calls().length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls()[0].args)), { owner: calls()[0].args.owner,
    gesture: { generation: 1, sequence: 1, context }, options: { shortcut: 'RightAlt' } });
  assert.equal(ui.snapshot().voice.phase, 'requested');
  await ui.tick(); await ui.poll(['k1.down', 'k1.up']); assert.equal(calls().length, 2, 'second down requests stop tap, not hold');
  assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0); assert.equal(ui.submitted.first, 0);
  ui.mode('windows'); await ui.enableVoice(); await ui.tick();
  assert.equal(ui.pollArgs().options.shortcutVoice, false); assert.equal(ui.pollArgs().options.windowsVoice, true);
});

test('shortcut requires opt-in and live unique focused composer; browsers, stale events and held contexts fail closed', async t => {
  for (const protocol of ['https:', 'http:', 'dsh-app:']) {
    const ui = harness({ protocol }); t.after(() => ui.dispose()); ui.open(); ui.mode('shortcut'); await ui.connect();
    assert.equal(ui.pollArgs().options.shortcutVoice, false);
    await ui.poll(['k1.down', 'k1.up']); await ui.enableVoice(); await ui.tick(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.calls.filter(call => call.method === 'au05/shortcutVoice').length, 0);
    const composer = ui.mountComposer(); composer.card.querySelectorAll = () => [composer.input, composer.input];
    await ui.tick(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.calls.filter(call => call.method === 'au05/shortcutVoice').length, 0);
    assert.equal(composer.focusCalls(), 0); assert.equal(ui.tracks.length, 0);
  }
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode('shortcut'); await ui.enableVoice(); await ui.connect();
  await ui.poll([{ event: 'k1.down', at: 99000 }, 'k1.up', { event: 'k1.down', context: 'stale' }, 'k1.up',
    { event: 'k1.down', generation: 99 }, 'k1.up']);
  assert.equal(ui.calls.filter(call => call.method === 'au05/shortcutVoice').length, 0);
  await ui.tick(); await ui.poll(['k1.down']);
  ui.mode('custom'); await ui.enableVoice(); ui.shortcut('Ctrl+Alt+F9');
  await ui.tick(); await ui.poll(['k1.down', 'k1.up']);
  assert.equal(ui.calls.filter(call => call.method === 'au05/shortcutVoice').length, 1);
  await ui.tick(); await ui.poll(['k1.down', 'k1.up']);
  assert.equal(ui.calls.filter(call => call.method === 'au05/shortcutVoice').length, 2);
});

test('shortcut pending requests abort on every configuration and live target change, never sending a cleanup tap', async t => {
  for (const change of ['mode', 'preset', 'shortcut', 'disable', 'session', 'composer', 'blur', 'unmount', 'disconnect', 'overflow']) {
    const ui = harness({ deferShortcut: true }); t.after(() => ui.dispose()); ui.open(); const composer = ui.mountComposer();
    ui.mode('custom'); await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down']);
    const request = ui.calls.find(call => call.method === 'au05/shortcutVoice'); assert.ok(request);
    if (change === 'mode') ui.mode('dsh');
    if (change === 'preset') { ui.mode('shortcut'); ui.preset('bugu'); }
    if (change === 'shortcut') ui.shortcut('Ctrl+Shift+Space');
    if (change === 'disable') node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: false } });
    if (change === 'session') ui.select('second');
    if (change === 'composer') composer.focus(false);
    if (change === 'blur') ui.focus(false);
    if (change === 'unmount') ui.unmount('conversation.input.left');
    if (change === 'disconnect') await node(ui.render(), 'data-au05-disconnect')[1].onClick();
    if (change === 'overflow') { await ui.tick(); await ui.poll([], { overflow: true }); }
    assert.equal(request.signal.aborted, true, change); await ui.resolveShortcut();
    assert.notEqual(ui.snapshot().voice.phase, 'requested', change);
    assert.equal(ui.calls.filter(call => call.method === 'au05/shortcutVoice').length, 1, change);
    assert.match(JSON.stringify(ui.render()), /断开不会保证停止/, change);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  }
});

test('shortcut errors are fixed Chinese shortcut-only errors, never raw or Windows error messages', async t => {
  for (const error of ['shortcut_voice_focus_not_editable', 'shortcut_voice_invalid_shortcut', 'windows_voice_native_failed', 'constructor', 'private C:/secret.ps1']) {
    const ui = harness({ shortcutResult: { activated: false, error } }); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode('shortcut');
    await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.snapshot().voice.error.startsWith('shortcut_voice_'), true);
    assert.equal(ui.snapshot().voice.phase, 'error');
    assert.doesNotMatch(JSON.stringify(ui.render()), /private|secret|constructor|Windows 语音系统请求失败/);
  }
  const ui = harness({ deferShortcut: true }); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode('shortcut');
  await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down', 'k1.up']); await ui.rejectShortcut();
  assert.equal(ui.snapshot().voice.error, 'shortcut_voice_failed'); assert.doesNotMatch(JSON.stringify(ui.render()), /private native/);
});

test('auto-connect defaults OFF; toggling ON only saves a future preference and never connects on focus/view/session changes', async t => {
  const storage = memoryStorage(), ui = harness({ storage }); ui.open(); await flush();
  assert.equal(node(ui.render(), 'data-au05-auto-connect')[1].checked, false);
  assert.equal(node(ui.render(), 'data-au05-auto-connect-help')[0], 'label');
  assert.match(node(ui.render(), 'data-au05-auto-connect-help')[1].title, /下次加载时尝试一次，不自动重试/);
  ui.autoConnect(true); await flush(); ui.focus(false); ui.focus(true); ui.select('second'); ui.unmount(); ui.open(); await flush();
  assert.equal(JSON.parse(storage.getItem(voicePreferencesKey)).autoConnect, true);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0);
  await ui.dispose(); const again = harness({ storage }); t.after(() => again.dispose()); await flush();
  assert.equal(again.calls.filter(call => call.method === 'au05/connect').length, 1);
  assert.equal(again.tracks.length, 0); assert.equal(again.actions.length, 0);
});

test('saved auto-connect runs exactly once per controller, without remount duplicates, retries or shortcut/microphone activation', async t => {
  for (const failure of [false, true]) {
    const ui = harness({ storage: memoryStorage(savedPreferences({ autoConnect: true })),
      connectSnapshot: failure ? { state: 'unsupported_runtime', connected: false, error: 'unsupported_runtime' } : {} });
    t.after(() => ui.dispose()); await flush(); ui.open();
    assert.equal(ui.calls.filter(call => call.method === 'au05/connect').length, 1);
    if (!failure) await ui.poll([], { state: 'disconnected', connected: false });
    ui.unmount(); ui.open(); ui.focus(false); ui.focus(true); ui.select('second'); ui.service(false); ui.service(true); await flush();
    assert.equal(ui.calls.filter(call => call.method === 'au05/connect').length, 1);
    assert.equal([...ui.timers.values()].some(timer => timer.delay === 200), false);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
    assert.equal(ui.calls.filter(call => /Voice$/.test(call.method)).length, 0);
    if (failure) assert.match(JSON.stringify(node(ui.render(), 'data-au05-connection-alert')), /运行环境不受支持/);
  }
});

test('auto-connect browser/unavailable service explains no attempt; late service and manual disconnect cannot restart it', async t => {
  for (const options of [{ protocol: 'http:' }, { serviceAvailable: false }]) {
    const ui = harness({ ...options, storage: memoryStorage(savedPreferences({ autoConnect: true })) });
    t.after(() => ui.dispose()); await flush(); ui.open();
    assert.equal(ui.calls.length, 0); assert.match(JSON.stringify(node(ui.render(), 'data-au05-auto-connect-status')), /当前浏览器不会尝试连接|设备服务不可用/);
    ui.service(true); ui.focus(false); ui.focus(true); ui.unmount(); ui.open(); await flush(); assert.equal(ui.calls.length, 0);
  }
  const ui = harness({ storage: memoryStorage(savedPreferences({ autoConnect: true })) }); t.after(() => ui.dispose()); ui.open();
  await node(ui.render(), 'data-au05-disconnect')[1].onClick(); await flush();
  assert.equal(ui.calls.filter(call => call.method === 'au05/connect').length, 0);
  ui.focus(false); ui.focus(true); await flush(); assert.equal(ui.calls.filter(call => call.method === 'au05/connect').length, 0);
});

const preferencesV3 = (update = {}) => ({ version: 3, mode: 'dsh',
  enabledByMode: { dsh: false, windows: false, shortcut: false, custom: false }, microphoneId: null,
  shortcutPreset: 'typeless', customShortcut: 'RightAlt', autoConnect: false, knobMode: 'sessions', ...update });

test('unified select maps restored presets and rejects unknown values without actions', async t => {
  const storage = memoryStorage(preferencesV3({ mode: 'shortcut', shortcutPreset: 'bugu' }));
  const ui = harness({ storage }); t.after(() => ui.dispose()); ui.open();
  assert.equal(node(ui.render(), 'data-au05-voice-mode')[1].value, 'shortcut:bugu');
  assert.equal(node(ui.render(), 'data-au05-shortcut-preset'), undefined);
  for (const value of ['shortcut:unknown', 'shortcut', 'invalid']) {
    assert.equal(node(ui.render(), 'data-au05-voice-mode')[1].onChange({ target: { value } }), false);
    assert.equal(ui.snapshot().voiceMode, 'shortcut'); assert.equal(ui.snapshot().shortcutPreset, 'bugu');
  }
  ui.preset('typeless'); assert.equal(ui.snapshot().voicePreferenceEnabled, false);
  assert.equal(node(ui.render(), 'data-au05-voice-mode')[1].value, 'shortcut:typeless');
  ui.mode('windows'); ui.preset('bugu');
  assert.equal(ui.snapshot().voiceMode, 'shortcut'); assert.equal(ui.snapshot().shortcutPreset, 'bugu');
  assert.equal(ui.snapshot().voicePreferenceEnabled, false);
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
});

test('mode select separates application presets from remembered custom chords and independent consent', async t => {
  const storage = memoryStorage(preferencesV3({ enabledByMode: { dsh: true, windows: true, shortcut: false, custom: false } }));
  const ui = harness({ storage }); t.after(() => ui.dispose()); ui.open();
  const select = node(ui.render(), 'data-au05-voice-mode');
  assert.deepEqual(select.slice(2).map(option => [option[1].value, option[2]]), [
    ['dsh', 'DSH 内置语音'], ['windows', 'Windows 语音'], ['shortcut:typeless', 'Typeless'],
    ['shortcut:bugu', '网易叭哥说'], ['custom', '自定义快捷键']]);
  assert.equal(node(node(ui.render(), 'data-au05-device-settings'), 'data-au05-voice-mode'), undefined);
  assert.equal(node(ui.render(), 'data-au05-mode-custom')[2], '自定义快捷键');
  ui.mode('custom'); assert.equal(node(ui.render(), 'data-au05-shortcut-preset'), undefined);
  assert.ok(node(ui.render(), 'data-au05-shortcut')); await ui.enableVoice(); ui.shortcut('Ctrl+Alt+F9');
  ui.mode('shortcut'); assert.equal(ui.snapshot().voicePreferenceEnabled, false);
  assert.equal(node(ui.render(), 'data-au05-shortcut'), undefined);
  assert.equal(node(ui.render(), 'data-au05-shortcut-preset'), undefined);
  ui.preset('bugu'); assert.equal(ui.snapshot().shortcut, 'RightAlt');
  assert.equal(node(ui.render(), 'data-au05-preset-help'), undefined);
  assert.equal(node(ui.render(), 'data-au05-shortcut-preset'), undefined);
  assert.equal(node(ui.render(), 'data-au05-voice-mode')[1].value, 'shortcut:bugu');
  await ui.enableVoice(); ui.mode('custom'); assert.equal(ui.snapshot().voicePreferenceEnabled, true);
  assert.equal(ui.snapshot().shortcut, 'Ctrl+Alt+F9');
  node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: false } });
  ui.mode('shortcut'); assert.equal(ui.snapshot().shortcutPreset, 'bugu'); assert.equal(ui.snapshot().voicePreferenceEnabled, true);
  ui.preset('typeless'); assert.equal(ui.snapshot().shortcut, 'RightAlt');
  ui.mode('custom'); assert.equal(ui.snapshot().voicePreferenceEnabled, false); assert.equal(ui.snapshot().shortcut, 'Ctrl+Alt+F9');
  ui.knob('scroll-page');
  const saved = JSON.parse(storage.getItem(voicePreferencesKey));
  assert.deepEqual(saved.enabledByMode, { dsh: true, windows: true, shortcut: true, custom: false });
  assert.equal(saved.customShortcut, 'Ctrl+Alt+F9'); assert.equal(saved.knobMode, 'scroll-page');
  assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  const again = harness({ storage }); t.after(() => again.dispose()); again.open(); await flush();
  assert.equal(again.snapshot().voiceMode, 'custom'); assert.equal(again.snapshot().customShortcut, 'Ctrl+Alt+F9');
  assert.equal(again.snapshot().knobMode, 'scroll-page'); assert.equal(again.calls.length, 0); assert.equal(again.tracks.length, 0);
});

test('v2 migrates custom selection and consent without enabling app presets or invoking Host, microphone or reconnect', async t => {
  for (const mode of ['dsh', 'windows', 'shortcut']) for (const custom of [true, false]) for (const consent of [true, false]) {
    const storage = memoryStorage(savedPreferences({ mode, enabledByMode: { dsh: true, windows: true, shortcut: consent },
      microphoneId: 'saved-microphone', shortcutPreset: custom ? 'custom' : 'typeless', shortcut: custom ? 'Ctrl+Alt+F9' : 'RightAlt' }));
    const ui = harness({ storage }); t.after(() => ui.dispose()); await flush();
    assert.equal(ui.snapshot().voiceMode, custom && mode === 'shortcut' ? 'custom' : mode);
    assert.equal(ui.snapshot().voice.microphoneId, 'saved-microphone');
    assert.equal(storage.writes.length, 0, 'hydration does not rewrite storage');
    ui.open(); ui.mode('custom'); assert.equal(ui.snapshot().voicePreferenceEnabled, custom && consent);
    assert.equal(ui.snapshot().shortcut, custom ? 'Ctrl+Alt+F9' : 'RightAlt');
    ui.mode('shortcut'); assert.equal(ui.snapshot().voicePreferenceEnabled, !custom && consent);
    assert.equal(ui.snapshot().shortcutPreset, 'typeless');
    const saved = JSON.parse(storage.getItem(voicePreferencesKey));
    assert.equal(saved.version, 3); assert.equal(saved.enabledByMode.dsh, true); assert.equal(saved.enabledByMode.windows, true);
    assert.equal(saved.knobMode, 'regions'); assert.equal(saved.autoConnect, false);
    assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  }
});

test('v3 rejects unapproved preset, prototype keys, unsafe custom chords and unknown rotary behavior atomically', async t => {
  for (const update of [{ shortcutPreset: 'constructor' }, { shortcutPreset: '__proto__' }, { shortcutPreset: 'custom' },
    { customShortcut: 'Win+H' }, { customShortcut: 'Ctrl+W' }, { knobMode: 'top' }, { knobMode: 'constructor' },
    { mode: 'other' }, { enabledByMode: { dsh: false, windows: false, shortcut: true } }]) {
    const ui = harness({ storage: memoryStorage(preferencesV3(update)) }); t.after(() => ui.dispose()); ui.open(); await flush();
    assert.equal(ui.snapshot().voiceMode, 'dsh'); assert.equal(ui.snapshot().voicePreferenceEnabled, false);
    assert.equal(ui.snapshot().knobMode, 'regions'); assert.equal(ui.snapshot().shortcutPreset, 'typeless');
    assert.equal(ui.snapshot().voicePreferencesSaved, false); assert.equal(ui.calls.length, 0); assert.equal(ui.tracks.length, 0);
  }
  const valid = harness({ storage: memoryStorage(preferencesV3({ mode: 'shortcut', shortcutPreset: 'bugu', customShortcut: 'ctrl+alt+f9', knobMode: 'scroll' })) });
  t.after(() => valid.dispose()); valid.open(); assert.equal(valid.snapshot().shortcut, 'RightAlt');
  assert.equal(valid.snapshot().customShortcut, 'Ctrl+Alt+F9');
  for (const value of ['constructor', '__proto__', 'custom', 'missing']) assert.equal(valid.preset(value), false);
  for (const value of ['constructor', 'top', 'missing']) assert.equal(valid.knob(value), false);
  assert.equal(valid.snapshot().shortcutPreset, 'bugu'); assert.equal(valid.snapshot().knobMode, 'scroll');
});

test('both preset and custom K1 use existing single-use Host shortcut ticket, including bugu RightAlt default', async t => {
  for (const mode of ['shortcut', 'custom']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode(mode);
    if (mode === 'shortcut') ui.preset('bugu'); else ui.shortcut('Ctrl+Alt+F9');
    await ui.enableVoice(); await ui.connect(); assert.equal(ui.pollArgs().options.shortcutVoice, true);
    if (mode === 'shortcut') {
      await ui.poll([], { bageshuo: { state: 'idle', error: null } }); await ui.tick();
    }
    await ui.poll(['k1.down', 'k1.down', 'k1.up'], mode === 'shortcut' ? { bageshuo: { state: 'idle', error: null } } : {});
    const requests = ui.calls.filter(call => call.method === 'au05/shortcutVoice');
    assert.equal(requests.length, 1); assert.equal(requests[0].args.options.shortcut, mode === 'shortcut' ? 'RightAlt' : 'Ctrl+Alt+F9');
    assert.deepEqual(Object.keys(requests[0].args).sort(), ['gesture', 'options', 'owner']);
    assert.equal(ui.calls.filter(call => call.method === 'au05/windowsVoice').length, 0);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  }
});

test('rotary settings and every live target change abort pending external requests without cleanup taps or held-key reuse', async t => {
  for (const mode of ['shortcut', 'custom']) for (const change of ['knob', 'owner', 'visibility', 'configuration']) {
    const ui = harness({ deferShortcut: true }); t.after(() => ui.dispose()); ui.open(); ui.mountComposer(); ui.mode(mode);
    await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down']);
    const request = ui.calls.find(call => call.method === 'au05/shortcutVoice');
    if (change === 'knob') ui.knob('disabled');
    if (change === 'owner') ui.replaceOwner();
    if (change === 'visibility') ui.visibility('hidden');
    if (change === 'configuration') { if (mode === 'shortcut') ui.preset('bugu'); else ui.shortcut('Ctrl+Alt+F9'); }
    assert.equal(request.signal.aborted, true, `${mode}/${change}`); await ui.resolveShortcut();
    assert.notEqual(ui.snapshot().voice.phase, 'requested');
    await ui.tick(); await ui.poll(['k1.down', 'k1.up']);
    assert.equal(ui.calls.filter(call => call.method === 'au05/shortcutVoice').length, 1);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.actions.length, 0);
  }
});

test('rotary scroll and page act only on the current scoped official slot geometry; pressing still focuses the draft', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); const scroll = ui.mountScroll(), composer = ui.mountComposer();
  assert.equal(scroll.bridge[0], 'span'); assert.equal(scroll.bridge[1].hidden, true);
  ui.knob('scroll'); await ui.connect(); await ui.poll(['right.pulse', 'left.pulse', 'knob.down', 'knob.up']);
  assert.deepEqual(ui.actions, []);
  const wheel = ui.calls.filter(call => call.method === 'au05/nativeScroll');
  assert.equal(wheel.length, 2);
  assert.deepEqual(wheel.map(call => call.args.gesture.sequence), [1, 2]);
  assert.ok(wheel.every(call => Object.keys(call.args).sort().join() === 'gesture,owner'));
  assert.equal(composer.focusCalls(), 1);
  ui.knob('scroll-page'); await ui.tick(); await ui.poll(['right.pulse', 'left.pulse']);
  assert.deepEqual(ui.actions, [['scroll', 'first', 400, 'smooth'], ['scroll', 'first', -400, 'smooth']]);
  scroll.port.clientHeight = 100; await ui.tick(); await ui.poll(['right.pulse']);
  assert.deepEqual(ui.actions.at(-1), ['scroll', 'first', 120, 'smooth']);
  ui.knob('disabled'); await ui.tick(); await ui.poll(['left.pulse', 'right.pulse', 'knob.down', 'knob.up']);
  assert.equal(ui.actions.length, 3); assert.equal(composer.focusCalls(), 2);
  assert.equal(ui.calls.filter(call => /Voice$/.test(call.method)).length, 0); assert.equal(ui.tracks.length, 0);
  assert.equal(ui.document.querySelector, undefined); assert.equal(ui.document.querySelectorAll, undefined);
});

test('native rotary requires desktop direct transport and hovered non-editor scrollport; never DOM fallback', async t => {
  for (const kind of ['browser', 'studio', 'not-hovered', 'editor', 'helper-failure']) {
    const ui = harness({ protocol: kind === 'browser' ? 'https:' : 'dsh-app:', studio: kind === 'studio',
      nativeScrollResult: { scrolled: false, error: 'native_wheel_foreground_mismatch' } });
    t.after(() => ui.dispose()); ui.open(); const { port } = ui.mountScroll(); ui.knob('scroll');
    if (kind === 'not-hovered') port.hovered = false;
    if (kind === 'editor') port.blockedHover = true;
    await ui.connect(); await ui.poll(['right.pulse']);
    const wheel = ui.calls.filter(call => call.method === 'au05/nativeScroll');
    assert.equal(wheel.length, kind === 'helper-failure' ? 1 : 0, kind);
    assert.deepEqual(ui.actions, [], kind);
    assert.equal(ui.pollArgs(), undefined);
    if (kind === 'helper-failure') assert.match(node(ui.render(), 'data-au05-message')[2], /未重试/);
    await ui.tick();
    assert.equal(ui.pollArgs().options.nativeScroll, kind === 'studio' ? undefined : kind !== 'browser', kind);
  }
});

test('region rotary observes detents at 16ms without parallel polls, returning to idle cadence when unfocused', async t => {
  for (const studio of [false, true]) {
    const ui = harness({ studio }); t.after(() => ui.dispose()); ui.open();
    await ui.connect(); await ui.poll([]);
    assert.ok([...ui.timers.values()].some(timer => timer.delay === 16));
    assert.equal(ui.pendingPollCount(), 0); await ui.tick(); assert.equal(ui.pendingPollCount(), 1);
    ui.focus(false); await ui.poll([]);
    assert.ok([...ui.timers.values()].some(timer => timer.delay === 200));
    assert.equal(ui.pendingPollCount(), 0);
  }
});

function startRegionSample(ui) {
  const before = new Set(ui.timers.keys());
  assert.equal(ui.controller.startRegionDiagnostics(), true);
  const finish = [...ui.timers].filter(([id, timer]) => !before.has(id) && timer.delay === 5000);
  assert.equal(finish.length, 1, 'one local completion timeout, distinct from the existing Host poll timeout');
  return { id: finish[0][0], ...finish[0][1] };
}
async function finishRegionSample(ui, timer, elapsed = 5000) {
  ui.advance(elapsed); ui.timers.delete(timer.id); timer.fn(); await flush();
  return ui.controller.getSnapshot().regionDiagnostics;
}

test('scroll diagnostics stay collapsed in advanced settings and require a connected region controller', async t => {
  for (const studio of [false, true]) {
    const ui = harness({ studio, animationFrames: true }); t.after(() => ui.dispose()); ui.open();
    const section = node(node(ui.render(), 'data-au05-advanced'), 'data-au05-region-diagnostics');
    assert.equal(section[0], 'details'); assert.equal(section[1].open, undefined); assert.equal(section[2][2], '滚动诊断');
    const button = () => node(ui.render(), 'data-au05-start-region-diagnostics');
    assert.equal(button()[2], '采样 5 秒'); assert.equal(button()[1].className, 'au05-action');
    assert.equal(button()[1].disabled, true); assert.equal(ui.controller.startRegionDiagnostics(), false);
    assert.equal(find(section, item => item[0] === 'textarea'), undefined);
    await ui.connect(); assert.equal(button()[1].disabled, false);
    for (const mode of ['sessions', 'scroll', 'scroll-page', 'disabled']) {
      ui.knob(mode);
      assert.equal(node(ui.render(), 'data-au05-region-diagnostics'), undefined, mode);
      assert.equal(button(), undefined, mode);
      assert.equal(ui.controller.startRegionDiagnostics(), false, mode);
    }
    ui.knob('regions'); assert.equal(button()[1].disabled, false);
    assert.equal(node(ui.render(), 'data-au05-region-diagnostics')[0], 'details');
    const timer = startRegionSample(ui);
    assert.equal(button()[1].disabled, true); assert.equal(ui.controller.startRegionDiagnostics(), false);
    assert.equal(node(ui.render(), 'data-au05-region-diagnostics')[1]['aria-busy'], true);
    assert.equal(find(node(ui.render(), 'data-au05-region-diagnostics'), item => item[0] === 'textarea'), undefined);
    const report = await finishRegionSample(ui, timer);
    const field = find(node(ui.render(), 'data-au05-region-diagnostics'), item => item[0] === 'textarea');
    assert.equal(field[1]['aria-label'], 'AU05 滚动诊断 JSON'); assert.equal(field[1].readOnly, true);
    assert.deepEqual(JSON.parse(field[1].value), JSON.parse(JSON.stringify(report)));
    assert.equal(report.state, 'expired'); assert.equal(report.elapsedMs, 5000);
    assert.equal(button()[1].disabled, false);
    assert.equal(node(ui.render(), 'data-au05-region-diagnostics')[1]['aria-busy'], false);
    ui.knob('sessions');
    assert.equal(button()[1].disabled, true, 'retained result remains reachable outside region mode');
    const retained = find(node(ui.render(), 'data-au05-region-diagnostics'), item => item[0] === 'textarea');
    assert.equal(retained[1].readOnly, true); assert.equal(retained[1].value, field[1].value);
    assert.equal(ui.controller.getSnapshot().regionDiagnostics, report);
    assert.equal(ui.controller.startRegionDiagnostics(), false);
    assert.deepEqual(ui.actions, []); assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
    assert.equal(ui.calls.some(call => /nativeScroll|Voice$/.test(call.method)), false);
  }
  const noClock = harness(); t.after(() => noClock.dispose()); noClock.open(); await noClock.connect();
  const before = new Set(noClock.timers.keys());
  assert.equal(noClock.controller.startRegionDiagnostics(), false);
  assert.equal(noClock.controller.getSnapshot().regionDiagnostics, null);
  assert.deepEqual([...noClock.timers.keys()], [...before]);
});

test('scroll diagnostics record only numeric pulse metadata at existing acceptance and rejection stages', async t => {
  for (const studio of [false, true]) {
    const ui = harness({ studio, animationFrames: true }); t.after(() => ui.dispose()); ui.open();
    ui.mountRegionSurface(); ui.mountScroll(); await ui.connect(); const timer = startRegionSample(ui);
    await ui.poll([
      { event: 'right.pulse', at: 99983, privatePayload: 'PRIVATE-EVENT-CONTENT' },
      { event: 'left.pulse', at: 99000 },
      { event: 'right.pulse', at: 100001 },
      { event: 'left.pulse', at: '100000' },
      { event: 'right.pulse', generation: 2 },
      { event: 'left.pulse', sequence: 1 },
      { event: 'right.pulse', context: 'PRIVATE-CONTEXT' },
      { event: 'left.pulse', sequence: 0.5 },
    ]);
    ui.focus(false); await ui.tick(); await ui.poll(['left.pulse']);
    const report = await finishRegionSample(ui, timer), input = report.entries.filter(row => row.type === 'input');
    assert.deepEqual(Array.from(input, row => [row.phase, row.reason]), [
      ['received', 'none'], ['accepted', 'none'],
      ['received', 'none'], ['discarded', 'stale'],
      ['received', 'none'], ['discarded', 'stale'],
      ['received', 'none'], ['discarded', 'invalid_event'],
      ['received', 'none'], ['discarded', 'invalid_event'],
      ['received', 'none'], ['discarded', 'invalid_event'],
      ['received', 'none'], ['blocked', 'context'],
      ['received', 'none'], ['discarded', 'invalid_event'],
      ['received', 'none'], ['blocked', 'unfocused'],
    ]);
    assert.deepEqual(Array.from(input.slice(0, 6), row => [row.direction, row.sequence, row.ageMs]),
      [[1, 1, 17], [1, 1, 17], [-1, 2, 1000], [-1, 2, 1000], [1, 3, -1], [1, 3, -1]]);
    for (const row of input) {
      assert.deepEqual(Object.keys(row).sort(), ['ageMs', 'direction', 'phase', 'reason', 'sequence', 'tMs', 'type']);
      assert.ok([-1, 1].includes(row.direction)); assert.ok(Number.isInteger(row.sequence));
      assert.ok(Number.isFinite(row.ageMs)); assert.ok(Number.isFinite(row.tMs));
    }
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE-|"owner":|"context":|sessionId|privatePayload|inputActions/);
    assert.equal(ui.calls.some(call => /nativeScroll|Voice$/.test(call.method)), false);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0); assert.equal(ui.submitted.second, 0);
    assert.equal(ui.cancelled.first, 0); assert.equal(ui.wheelEvents.length, 0);
  }
});

test('scroll diagnostics publish only capture boundaries, never RAF updates or incremental row copies', async t => {
  const ui = harness({ animationFrames: true }); t.after(() => ui.dispose()); ui.open(); ui.mountRegionSurface();
  const { port } = ui.mountScroll(); observeRegionScroll(port); await ui.connect();
  await ui.poll(['knob.down', 'knob.up', 'right.pulse']); await ui.tick();
  let publishes = 0; const unsubscribe = ui.controller.subscribe(() => publishes++); t.after(unsubscribe);
  const calls = ui.calls.length, timer = startRegionSample(ui);
  assert.equal(publishes, 1); assert.equal(ui.calls.length, calls);
  const recording = ui.controller.getSnapshot().regionDiagnostics;
  assert.equal(recording.state, 'recording'); assert.deepEqual(Array.from(recording.entries), []);
  assert.equal(recording.dropped, 0); assert.equal(recording.elapsedMs, 0);
  await ui.poll(['right.pulse', 'left.pulse']);
  const afterInput = publishes;
  for (let index = 0; index < 8; index++) await ui.frame(16);
  assert.equal(publishes, afterInput, 'frame telemetry must not publish React state');
  assert.equal(ui.controller.getSnapshot().regionDiagnostics, recording, 'only the getter copies rows at capture boundaries');
  assert.deepEqual(Array.from(recording.entries), []);
  const beforeFinish = publishes, report = await finishRegionSample(ui, timer, 5000 - 128);
  assert.equal(publishes, beforeFinish + 1);
  assert.equal(report.entries.some(row => row.type === 'frame'), false);
  assert.equal(report.config.backend, 'native'); assert.equal(report.config.wheelDelta, 120);
  assert.equal(report.entries.filter(row => row.type === 'input').length, 4, 'only post-start detents are captured');
  assert.ok(Number.isFinite(port.scrollTop));
  const again = startRegionSample(ui); assert.deepEqual(Array.from(ui.controller.getSnapshot().regionDiagnostics.entries), []);
  const afterRestart = publishes; timer.fn();
  assert.equal(publishes, afterRestart, 'an old completion callback cannot finish a later sample');
  assert.equal(ui.timers.has(again.id), true);
  assert.equal(ui.controller.getSnapshot().regionDiagnostics.state, 'recording');
  assert.equal(nativeRegionCalls(ui).length, 3);
  assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
});

test('scroll diagnostic completion timers cancel on connection, mode and disposal loss while keeping the result', async t => {
  for (const change of ['disconnect', 'poll-disconnect', 'terminal-state', 'poll-failure', 'mode', 'dispose']) {
    const ui = harness({ animationFrames: true }); t.after(() => ui.dispose()); ui.open(); await ui.connect();
    const timer = startRegionSample(ui); ui.advance(25);
    if (change === 'disconnect') await ui.controller.disconnect();
    if (change === 'poll-disconnect') await ui.poll([], { connected: false });
    if (change === 'terminal-state') await ui.poll([], { state: 'stopped' });
    if (change === 'poll-failure') await ui.failPoll();
    if (change === 'mode') ui.knob('disabled');
    if (change === 'dispose') await ui.dispose();
    assert.equal(ui.timers.has(timer.id), false, change);
    const report = ui.controller.getSnapshot().regionDiagnostics;
    assert.equal(report.state, 'stopped', change); assert.equal(report.elapsedMs, 25, change);
    timer.fn(); assert.equal(ui.controller.getSnapshot().regionDiagnostics, report, 'cancelled callback is inert');
    if (change !== 'dispose') {
      const field = find(node(ui.render(), 'data-au05-region-diagnostics'), item => item[0] === 'textarea');
      assert.equal(field[1].readOnly, true); assert.equal(JSON.parse(field[1].value).state, 'stopped');
      if (change === 'mode') ui.knob('regions');
      else if (change === 'poll-disconnect') { await ui.tick(); await ui.poll([]); }
      else await ui.controller.connect();
      assert.equal(ui.controller.getSnapshot().regionDiagnostics, report, 'restored eligibility never auto-resumes sampling');
    } else assert.equal(ui.controller.startRegionDiagnostics(), false);
    assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
    assert.equal(ui.calls.some(call => /nativeScroll|Voice$/.test(call.method)), false);
  }
});

test('native rotary fast polling remains serialized; pending requests abort on focus/session/mode/unmount', async t => {
  for (const change of ['focus', 'session', 'mode', 'unmount', 'dispose']) {
    const ui = harness({ deferNativeScroll: true }); t.after(() => ui.dispose()); ui.open(); ui.mountScroll(); ui.knob('scroll');
    await ui.connect(); await ui.poll(['right.pulse', 'right.pulse', 'left.pulse']);
    const wheel = ui.calls.filter(call => call.method === 'au05/nativeScroll');
    assert.equal(wheel.length, 3);
    assert.ok([...ui.timers.values()].some(timer => timer.delay === 16));
    assert.equal(ui.pendingPollCount(), 0); await ui.tick(); assert.equal(ui.pendingPollCount(), 1);
    if (change === 'focus') ui.focus(false);
    if (change === 'session') ui.select('second');
    if (change === 'mode') ui.knob('scroll-page');
    if (change === 'unmount') ui.unmount('conversation.input.dock');
    if (change === 'dispose') await ui.dispose();
    assert.ok(wheel.every(call => call.signal.aborted), change);
    assert.deepEqual(ui.actions, []);
  }
});

test('rotary page DOM smooth scroll accumulates bursts, reverses immediately and clamps at bounds', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  const { port } = ui.mountScroll(); ui.knob('scroll-page'); await ui.connect();
  await ui.poll(['right.pulse', 'right.pulse', 'right.pulse', 'left.pulse']);
  assert.deepEqual(ui.actions, [
    ['scroll', 'first', 400, 'smooth'], ['scroll', 'first', 800, 'smooth'],
    ['scroll', 'first', 1000, 'smooth'], ['scroll', 'first', -400, 'smooth'],
  ]);
  port.scrollTop = 20; await ui.tick(); await ui.poll(['left.pulse']);
  assert.deepEqual(ui.actions.at(-1), ['scroll', 'first', -20, 'smooth']);
  port.scrollTop = 1490; await ui.tick(); await ui.poll(['right.pulse', 'right.pulse']);
  assert.deepEqual(ui.actions.slice(-2), [['scroll', 'first', 10, 'smooth'], ['scroll', 'first', 10, 'smooth']]);
});

test('scroll fails closed for absent API, missing geometry, wrong session, hidden/editor roots and detached nodes', async t => {
  for (const problem of ['missing-slot', 'missing-style', 'missing-scrollBy', 'non-overflow', 'empty', 'zero-height', 'nan-height',
    'marker-detached', 'root-detached', 'port-detached', 'wrong-session', 'hidden-root', 'hidden-port', 'invisible-port',
    'editor', 'foreign-parent', 'missing-marker', 'wrong-attribute', 'wrong-style', 'zero-width', 'offscreen', 'invisible-root']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); const value = ui.mountScroll(); ui.knob('scroll');
    if (problem === 'missing-slot') ui.unmount('conversation.input.dock');
    if (problem === 'missing-style') ui.computedStyle(false);
    if (problem === 'missing-scrollBy') value.port.scrollBy = undefined;
    if (problem === 'non-overflow') value.port.scrollHeight = value.port.clientHeight;
    if (problem === 'empty') value.port.scrollHeight = 0;
    if (problem === 'zero-height') value.port.clientHeight = 0;
    if (problem === 'nan-height') value.port.clientHeight = NaN;
    if (problem === 'marker-detached') value.marker.isConnected = false;
    if (problem === 'root-detached') value.root.isConnected = false;
    if (problem === 'port-detached') value.port.isConnected = false;
    if (problem === 'wrong-session') value.root.dataset.conversationSession = 'second';
    if (problem === 'hidden-root') value.root.closest = () => ({});
    if (problem === 'hidden-port') value.port.closest = selector => selector.includes('[hidden]') ? {} : null;
    if (problem === 'invisible-port') value.port.getClientRects = () => [];
    if (problem === 'editor') value.port.closest = selector => selector.startsWith('textarea') ? {} : null;
    if (problem === 'foreign-parent') value.marker.parentElement = { parentElement: null, tagName: 'BODY' };
    if (problem === 'missing-marker') value.bridge[1].ref.current = null;
    if (problem === 'wrong-attribute') value.port.hasAttribute = () => false;
    if (problem === 'wrong-style') value.port.overflowY = 'visible';
    if (problem === 'zero-width') value.port.clientWidth = 0;
    if (problem === 'offscreen') value.port.getBoundingClientRect = () => ({ left: 1300, top: 10, right: 1900, bottom: 510, width: 600, height: 500 });
    if (problem === 'invisible-root') value.root.getBoundingClientRect = () => ({ left: 10, top: 10, right: 10, bottom: 610, width: 0, height: 600 });
    await ui.connect(); await ui.poll(['left.pulse', 'right.pulse']);
    assert.deepEqual(ui.actions, [], problem); assert.match(node(ui.render(), 'data-au05-message')[2], /当前会话未提供可靠的滚动接口，旋转无动作/, problem);
    assert.equal(ui.submitted.first, 0); assert.equal(ui.tracks.length, 0);
  }
});

test('ambiguous scroll bridges stop before unrelated layout reads and revalidate after removal', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('scroll');
  ui.mountScroll(); ui.mountScroll('first', 'second-scroll');
  const third = ui.mountScroll('first', 'third-scroll');
  let layoutReads = 0;
  const rect = third.root.getBoundingClientRect;
  third.root.getBoundingClientRect = function () { layoutReads++; return rect.call(this); };
  await ui.connect(); await ui.poll(['right.pulse']);
  assert.equal(layoutReads, 0, 'two distinct ports already prove ambiguity');
  assert.deepEqual(ui.actions, []);
  ui.unmount('second-scroll');
  assert.ok(layoutReads > 0, 'remaining bridges are resolved afresh, not cached');
  assert.deepEqual(ui.actions, []);
});

test('multiple visible scroll roots of the same session are ambiguous; stale owner and unmounted slot never scroll', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.knob('scroll');
  ui.mountScroll(); ui.mountScroll('first', 'embedded-scroll'); await ui.connect(); await ui.poll(['right.pulse']);
  assert.deepEqual(ui.actions, []);
  await ui.tick(); ui.unmount('embedded-scroll'); await ui.poll(['right.pulse']); assert.deepEqual(ui.actions, [], 'unmount invalidates old poll');
  await ui.tick(); await ui.poll(['right.pulse']); assert.deepEqual(ui.actions, []);
  assert.equal(ui.calls.filter(call => call.method === 'au05/nativeScroll').length, 1);
  await ui.tick(); ui.replaceOwner(); await ui.poll(['right.pulse']); assert.equal(ui.actions.length, 0);
  await ui.tick(); await ui.poll(['right.pulse']); assert.equal(ui.actions.length, 0, 'old owner cannot lend geometry');
  assert.equal(ui.calls.filter(call => call.method === 'au05/nativeScroll').length, 1);
  assert.match(node(ui.render(), 'data-au05-message')[2], /未提供可靠/);
});

test('every mode, rotary setting, live owner, session, window and visibility transition invalidates old rotary batches', async t => {
  for (const change of ['mode', 'preset', 'chord', 'knob', 'owner', 'session', 'focus', 'visibility', 'unmount', 'replacement', 'ambiguous']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); const value = ui.mountScroll();
    ui.mode(change === 'preset' ? 'shortcut' : 'custom'); ui.knob('scroll'); await ui.connect();
    const stale = ui.pollArgs().options.context;
    if (change === 'mode') ui.mode('dsh');
    if (change === 'preset') ui.preset('bugu');
    if (change === 'chord') ui.shortcut('Ctrl+Alt+F9');
    if (change === 'knob') ui.knob('scroll-page');
    if (change === 'owner') ui.replaceOwner();
    if (change === 'session') ui.select('second');
    if (change === 'focus') { ui.focus(false); ui.focus(true); }
    if (change === 'visibility') { ui.visibility('hidden'); ui.visibility('visible'); }
    if (change === 'unmount') ui.unmount('conversation.input.dock');
    if (change === 'replacement') value.marker.isConnected = false;
    if (change === 'ambiguous') ui.ambiguous();
    await ui.poll([{ event: 'right.pulse', context: stale }, { event: 'left.pulse', context: stale }]);
    assert.deepEqual(ui.actions, [], change);
  }
});

test('light diagnostics expose synchronized metadata without voice text or owner identity', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.connect();
  const trace = [{ at: 100000, type: 'request', requestId: 1, state: 'idle', channels: [0, 0, 0, 0], result: 'pending' }];
  const snapshotDiagnostics = [{ attempt: 1, outcome: 'auth_unconfirmed', auth: 'reply_timeout', link: 'not_sent', timedOut: 0, rejected: 0 },
    { attempt: 2, outcome: 'matched', auth: 'matched', link: 'matched', timedOut: 0, rejected: 0 }];
  await ui.poll([], { lightTrace: trace, snapshotDiagnostics, lightResult: 'verified' });
  const diagnostic = node(ui.render(), 'data-au05-light-diagnostics');
  const field = find(diagnostic, item => item[1]?.['aria-label'] === 'AU05 灯光诊断 JSON');
  assert.equal(field[1].readOnly, true);
  const value = JSON.parse(field[1].value);
  assert.deepEqual(value.trace, trace);
  assert.deepEqual(value.snapshotDiagnostics, snapshotDiagnostics, 'verified results retain earlier sanitized failure diagnostics');
  assert.equal(typeof value.observation.at, 'number');
  assert.equal(value.observation.channels.length, 4);
  assert.equal(value.observation.recording, false);
  assert.deepEqual(Object.keys(value.observation).sort(), ['at', 'brightness', 'channels', 'experimentalK1Lamp', 'focused', 'hasTarget', 'lightsEnabled', 'preparing', 'reasons', 'recording', 'state', 'voiceEnabled', 'voiceMode', 'voicePhase'].sort());
  assert.equal(ui.tracks.length, 0); assert.equal(ui.submitted.first, 0);
});

test('built-in K1 lamp refreshes immediately on actual recording and release without overlapping Host polls', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect();
  ui.controller.setExperimentalK1Lamp(true);
  const acquire = ui.media.getUserMedia; let release;
  ui.media.getUserMedia = options => new Promise(resolve => { release = () => resolve(acquire(options)); });
  await ui.poll(['k1.down']);
  assert.equal(ui.snapshot().voice.preparing, true);
  assert.equal([...ui.timers.values()].some(timer => timer.delay === 0), false, 'permission/preparation is not recording');
  await ui.tick(); assert.equal(ui.pollArgs().options.channels[0], 0);
  release(); await flush();
  assert.equal(ui.snapshot().voice.preparing, false);
  assert.equal(ui.pendingPollCount(), 1, 'recording publication must not overlap the existing poll');
  await ui.poll(); await ui.tickK1();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [2, 0, 0, 0]);
  await ui.poll(['k1.up']); await ui.tickK1();
  assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0]);
  assert.equal(ui.pendingPollCount(), 1);
  assert.equal(ui.actions.filter(action => action[0] === 'insert').length, 1, 'voice insertion is unchanged');
  assert.equal(ui.submitted.first, 0);
});

test('built-in K1 cancellation, capture error and blur immediately clear only its requested lamp', async t => {
  for (const change of ['disable', 'ended', 'blur']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect();
    ui.controller.setExperimentalK1Lamp(true);
    await ui.poll(['k1.down']); await ui.tickK1();
    assert.equal(ui.pollArgs().options.channels[0], 2);
    if (change === 'disable') await node(ui.render(), 'data-au05-voice')[1].onChange({ target: { checked: false } });
    else if (change === 'ended') ui.tracks.at(-1).onended();
    else ui.focus(false);
    await flush();
    assert.equal(ui.pendingPollCount(), 1, 'cancellation keeps one serialized poll');
    await ui.poll(); await ui.tickK1();
    assert.deepEqual(Array.from(ui.pollArgs().options.channels), [0, 0, 0, 0]);
    assert.equal(ui.actions.some(action => action[0] === 'transcribe'), false);
    assert.equal(ui.submitted.first, 0);
  }
});

test('legacy K1 overrides wake an idle poll without changing capture or unrelated poll cadence', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect();
  ui.controller.setExperimentalK1Lamp(false);
  await ui.poll(['k1.down']);
  assert.equal(ui.snapshot().voice.preparing, false);
  assert.equal([...ui.timers.values()].some(timer => timer.delay === 0), false, 'no opt-in keeps the original poll cadence');
  ui.controller.setExperimentalK1Lamp(true);
  await ui.tickK1(); assert.equal(ui.pollArgs().options.channels[0], 2);
  await ui.poll();
  ui.controller.setExperimentalK1Lamp(false);
  await ui.tickK1(); assert.equal(ui.pollArgs().options.channels[0], 0);
  assert.equal(ui.snapshot().voice.phase, 'recording', 'lamp opt-in never stops or starts capture');
  assert.equal(ui.tracks.at(-1).stopped, false);
  await ui.poll();
  await node(ui.render(), 'data-au05-disconnect')[1].onClick();
  assert.equal([...ui.timers.values()].some(timer => timer.delay === 0), false, 'disconnect cancels the immediate lamp wake');
});

test('poll-discovered focus loss cannot create a second K1 poll while the first request is being constructed', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); await ui.enableVoice(); await ui.connect();
  ui.controller.setExperimentalK1Lamp(true);
  await ui.poll(['k1.down']); await ui.tickK1();
  assert.equal(ui.pollArgs().options.channels[0], 2);
  await ui.poll();
  ui.focus(false, { notify: false }); // Model a missed browser focus event; the next sync must discover it.
  await ui.tick();
  assert.equal(ui.pollArgs().options.channels[0], 0);
  assert.equal(ui.pendingPollCount(), 1);
  assert.equal([...ui.timers.values()].some(timer => timer.delay === 0), false, 'sync cancellation is already represented by this request');
  await ui.poll(); await ui.tick();
  assert.equal(ui.pendingPollCount(), 1);
  assert.equal(ui.actions.some(action => action[0] === 'transcribe'), false);
});

test('Windows real host peak observation defaults on and stale legacy off-on replies cannot rearm it', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mode('windows'); ui.mountComposer(); await ui.enableVoice(); await ui.connect();
  assert.equal(ui.pollArgs().options.windowsVoiceState, true);
  await ui.poll([], { windowsVoiceState: { state: 'recording', error: null, level: 0.61 } });
  assert.equal(node(ui.render(), 'data-au05-windows-voice-level')[1].value, 0.61);
  await ui.tick();
  const toggle = value => ui.controller.setExperimentalK1Lamp(value);
  toggle(false); toggle(true);
  await ui.poll([], { windowsVoiceState: { state: 'recording', error: null, level: 0.99 } });
  assert.equal(ui.snapshot().windowsVoiceState.level, 0);
  await ui.tick(); assert.equal(ui.pollArgs().options.windowsVoiceState, false, 'serialize explicit revocation before rearming');
  await ui.poll(); await ui.tick(); assert.equal(ui.pollArgs().options.windowsVoiceState, true);
  assert.equal(ui.tracks.length, 0); assert.equal(ui.calls.some(call => call.method === 'au05/windowsVoice'), false);
});


const visibleFind = (tree, predicate) => {
  if (!Array.isArray(tree)) return undefined;
  if (predicate(tree)) return tree;
  const children = tree[0] === 'details' && !tree[1]?.open ? tree.slice(2, 3) : tree.slice(2);
  for (const child of children) { const found = visibleFind(child, predicate); if (found) return found; }
};
const visibleNode = (tree, marker) => visibleFind(tree, item => item[1]?.[marker] === '');
const visibleText = tree => {
  if (!Array.isArray(tree)) return typeof tree === 'string' ? tree : '';
  const children = tree[0] === 'details' && !tree[1]?.open ? tree.slice(2, 3) : tree.slice(2);
  return children.map(visibleText).join('\n');
};

test('protocol recovery appears once outside collapsed diagnostics and retains the accessible code', async t => {
  const ui = harness({ storage: memoryStorage(preferencesV3({ autoConnect: true })),
    connectSnapshot: { state: 'protocol_error', connected: false, error: 'protocol_error' } });
  t.after(() => ui.dispose()); ui.open(); await flush();
  const tree = ui.render(), text = visibleText(tree);
  assert.equal(text.split('设备桥接通信协议异常').length - 1, 1);
  assert.match(visibleNode(tree, 'data-au05-connection-alert')[2], /停用并重新启用 AU05 插件后手动重新连接/);
  assert.equal(visibleNode(tree, 'data-au05-connection-alert')[1].role, 'alert');
  assert.equal(visibleNode(tree, 'data-au05-auto-connect-status'), undefined);
  assert.equal(visibleNode(tree, 'data-au05-device-status'), undefined);
  assert.equal(visibleNode(tree, 'data-au05-message'), undefined);
  assert.doesNotMatch(text, /protocol_error|已尝试启动时连接/);
  const diagnostic = node(node(tree, 'data-au05-advanced'), 'data-au05-connection-diagnostic');
  assert.equal(diagnostic[1]['aria-label'], 'AU05 连接错误码');
  assert.match(diagnostic[2], /protocol_error/);
  assert.equal(visibleNode(tree, 'data-au05-connection-diagnostic'), undefined);
  assert.equal(ui.tracks.length, 0);
});

test('connection consolidation preserves different state, message, voice and light warnings', async t => {
  const ui = harness({ connectSnapshot: { state: 'failed', connected: false, error: 'protocol_error' } });
  t.after(() => ui.dispose()); ui.open(); await ui.connect();
  Object.assign(ui.snapshot(), { state: 'no_device', message: '请在叭哥说内手动停止采集',
    lightError: 'snapshot_unavailable', lightResult: 'mismatch', lightBrightnessSaved: false });
  Object.assign(ui.snapshot().voice, { error: 'microphone_denied', conflictText: '保留的转写文本' });
  const tree = ui.render(), text = visibleText(tree);
  assert.match(visibleNode(tree, 'data-au05-device-status')[2], /未找到设备/);
  assert.equal(visibleNode(tree, 'data-au05-message')[2], '请在叭哥说内手动停止采集');
  assert.match(text, /未取得原灯光快照，未写灯/);
  assert.match(text, /亮度设置未保存/);
  assert.match(text, /保留的转写文本/);
  assert.ok(visibleNode(tree, 'data-au05-connection-alert'));
  assert.equal(visibleNode(tree, 'data-au05-light-status')[1].role, 'alert');
  assert.equal(text.split('设备桥接通信协议异常').length - 1, 1);
});

test('GUI copy omits idle instructions and repeated action headings while retaining field names', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open();
  await ui.enableVoice();
  assert.equal(node(ui.render(), 'data-au05-voice-status'), undefined, 'ready controls and mapping already explain the action');
  const tree = ui.render();
  assert.equal(find(tree, item => item[1]?.['data-au05-mapping'] === 'k2')[2][2], '按键2');
  assert.equal(find(tree, item => item[1]?.['data-au05-mapping'] === 'k3')[2][2], '按键3');
  assert.ok(find(tree, item => item[0] === 'label' && item[1]?.htmlFor === 'au05-knob-mode'));
  assert.doesNotMatch(JSON.stringify(tree), /高级 \/ 诊断 \/ 帮助|快捷键帮助/);
  ui.mode('custom');
  assert.equal(node(ui.render(), 'data-au05-shortcut')[1]['aria-describedby'], 'au05-shortcut-help');
  assert.equal(node(ui.render(), 'data-au05-shortcut-help')[2], '需与应用快捷键一致。');
});

test('bageshuo disconnect keeps one visible safety notice without redundant help entry', async t => {
  const ui = harness(); t.after(() => ui.dispose()); ui.open(); ui.mode('shortcut'); ui.preset('bugu');
  await node(ui.render(), 'data-au05-disconnect')[1].onClick();
  const tree = ui.render(), text = visibleText(tree);
  assert.match(visibleNode(tree, 'data-au05-bageshuo-stop-help')[2], /焦点离开输入框.*叭哥说内手动停止.*断开设备或关闭观察不会停止采集/);
  assert.equal(text.split('不会停止采集').length - 1, 1);
  assert.equal(visibleNode(tree, 'data-au05-message'), undefined);
  assert.equal(node(tree, 'data-au05-shortcut-help'), undefined);
  assert.match(node(tree, 'data-au05-preset-requirement')[2], /Right Alt 单击切换/);
  assert.doesNotMatch(JSON.stringify(tree), /快捷键帮助|松开无动作，长按不重复/);
});

test('closed settings keep faults, conflicts and external capture stop notices visible', async t => {
  const ui = harness({ insertionConflict: true }); t.after(() => ui.dispose()); ui.open();
  assert.equal(visibleNode(ui.render(), 'data-au05-microphone'), undefined);
  assert.equal(visibleNode(ui.render(), 'data-au05-light-brightness'), undefined);
  await ui.enableVoice(); await ui.connect(); await ui.poll(['k1.down']); await ui.tick();
  await ui.poll(['k1.up'], { lightResult: 'mismatch' });
  assert.ok(visibleNode(ui.render(), 'data-au05-voice-conflict'));
  assert.equal(visibleNode(ui.render(), 'data-au05-light-status')[1].role, 'alert');
  assert.equal(visibleNode(ui.render(), 'data-au05-voice-mode')[1].disabled, true);
  assert.equal(ui.preset('bugu'), false, 'synthetic change cannot bypass the conflict guard');
  assert.equal(ui.snapshot().voiceMode, 'dsh');
  assert.equal(ui.snapshot().shortcutPreset, 'typeless');
  node(ui.render(), 'data-au05-clear-conflict')[1].onClick();
  ui.mode('windows');
  assert.match(JSON.stringify(visibleNode(ui.render(), 'data-au05-windows-help')), /手动结束.*断开设备不会停止/);
  ui.mode('shortcut');
  assert.match(JSON.stringify(visibleNode(ui.render(), 'data-au05-shortcut-stop-help')), /手动停止.*断开不会保证停止/);
  ui.preset('bugu');
  assert.match(JSON.stringify(visibleNode(ui.render(), 'data-au05-bageshuo-stop-help')), /手动停止.*不会停止采集/);
  assert.equal(node(ui.render(), 'data-au05-k1-lamp-note'), undefined, 'recording-lamp mechanism is not normal interface copy');
  assert.equal(node(ui.render(), 'data-au05-advanced')[1].open, undefined);
  assert.equal(node(ui.render(), 'data-au05-device-settings')[1].open, undefined);
});
