import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { DeviceController } from '../packages/dsh-plugin/host/device-controller.js';
import { pollOptions } from '../packages/dsh-plugin/host/rpc.js';
import { ShortcutVoiceBridge } from '../packages/dsh-plugin/host/shortcut-voice.js';
const OWNER = 'cross_app_owner_00001', CROSS = 'cross_app_context_001', SESSION = 'session_context_0001';
const armed = { context: null, shortcutVoice: true, bageshuoState: true, bageshuoCrossAppEnabled: true, bageshuoCrossAppContext: CROSS, lights: true, channels: [0, 1, 2, 1] };
function fixture() {
  let now = 1000, sequence = 0;
  const child = new EventEmitter(), writes = [], calls = [];
  child.stdout = new PassThrough(); child.stdin = new PassThrough();
  child.stdin.on('data', data => writes.push(JSON.parse(data)));
  child.kill = () => {}; child.stdin.end = () => child.emit('close');
  const observer = { value: { state: 'idle', error: null }, snapshot() { return { ...this.value }; }, start() {}, stop() {}, dispose() {} };
  const bridge = { cancel() {}, dispose() {}, async open(value) { calls.push(value); return { activated: true, error: null }; } };
  const controller = new DeviceController({ platform: 'win32', now: () => now, spawnChild: () => child, shortcutVoiceBridge: bridge, bageshuoStateObserver: observer, modeLease: { acquire: () => true, release() {} } });
  controller.connect(OWNER); child.stdout.write('{"type":"status","state":"ready"}\n');
  const input = event => { child.stdout.write(JSON.stringify({ type: 'input', event, sequence: ++sequence }) + '\n'); return { generation: controller.generation, sequence: controller.sequence, context: controller.events.at(-1).context }; };
  return { controller, observer, calls, writes, input, advance: value => { now = value; }, dispose: () => controller.dispose() };
}
test('cross-app poll is strict, default-off and separate from session context', () => {
  assert.equal(pollOptions({}).bageshuoCrossAppEnabled, false);
  assert.equal(pollOptions({}).bageshuoCrossAppContext, null);
  for (const value of [1, 'true', null]) assert.throws(() => pollOptions({ bageshuoCrossAppEnabled: value }));
  for (const value of ['', {}, 2]) assert.throws(() => pollOptions({ bageshuoCrossAppContext: value }));
});
test('only real K1 uses separate context, fixed RightAlt, single-use and transition lock', async () => {
  const f = fixture(); try {
    f.controller.poll(OWNER, armed);
    for (const event of ['k2.down', 'k3.down', 'right.pulse', 'left.pulse']) assert.equal(f.input(event).context, null);
    assert.equal(f.controller.nativeWheelTickets.size, 0);
    const gesture = f.input('k1.down'); assert.equal(gesture.context, CROSS); assert.equal(f.calls.length, 0, 'no auto-dispatch');
    assert.equal((await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'F8' })).activated, false);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' })).activated, true);
    assert.equal(f.calls[0].bageshuoCrossAppEnabled, true);
    assert.equal((await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' })).activated, false);
    f.input('k1.up'); const next = f.input('k1.down');
    assert.equal((await f.controller.shortcutVoice(OWNER, next, { shortcut: 'RightAlt' })).activated, false);
    f.observer.value = { state: 'recording', error: null }; f.controller.poll(OWNER, armed);
    assert.deepEqual(f.writes.at(-1).channels, [2, 1, 2, 1]);
    f.input('k1.up'); const stop = f.input('k1.down');
    assert.equal((await f.controller.shortcutVoice(OWNER, stop, { shortcut: 'RightAlt' })).activated, true);
    assert.equal(f.calls.length, 2);
  } finally { f.dispose(); }
});
test('default-off, missing markers, unknown observer and stale gesture cannot broaden authority', async () => {
  for (const override of [{ bageshuoCrossAppEnabled: false }, { bageshuoCrossAppContext: null }, { bageshuoState: false }, { shortcutVoice: false }]) {
    const f = fixture(); try { f.controller.poll(OWNER, { ...armed, ...override }); const gesture = f.input('k1.down'); assert.equal(gesture.context, null); assert.equal((await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' })).activated, false); assert.equal(f.calls.length, 0); } finally { f.dispose(); }
  }
  for (const state of ['starting', 'unknown', 'error']) {
    const f = fixture(); try { f.controller.poll(OWNER, armed); f.observer.value = { state, error: 'capture_unknown' }; const gesture = f.input('k1.down'); assert.equal((await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' })).activated, false); assert.equal(f.calls.length, 0); } finally { f.dispose(); }
  }
  const f = fixture(); try { f.controller.poll(OWNER, armed); const gesture = f.input('k1.down'); f.advance(2001); assert.equal((await f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' })).error, 'shortcut_voice_expired'); assert.equal(f.calls.length, 0); } finally { f.dispose(); }
});
test('session changes preserve cross commit, cross token or optout revokes it', async () => {
  const f = fixture(); let finish, pending;
  f.controller.shortcutVoiceBridge.open = value => { f.calls.push(value); return new Promise(resolve => { finish = resolve; }); };
  try {
    f.controller.poll(OWNER, armed); const gesture = f.input('k1.down'); pending = f.controller.shortcutVoice(OWNER, gesture, { shortcut: 'RightAlt' });
    assert.equal(f.calls[0].isCurrent(), true);
    f.controller.poll(OWNER, { ...armed, context: SESSION }); assert.equal(f.calls[0].isCurrent(), true);
    f.controller.poll(OWNER, { ...armed, bageshuoCrossAppEnabled: false }); assert.equal(f.calls[0].isCurrent(), false);
    finish({ activated: false, error: 'shortcut_voice_cancelled', notSent: true }); await pending;
  } finally { f.dispose(); }
});
test('actual observer callback drives K1 immediately without client polling or focus', () => {
  const f = fixture();
  const callbackController = new DeviceController({ platform: 'linux' });
  try {
    f.controller.poll(OWNER, armed);
    // Exercise the production callback against the fake owned transport and observer.
    callbackController.bageshuoObserver.snapshot = () => f.observer.snapshot();
    callbackController.bageshuoCrossAppEnabled = true;
    callbackController.bageshuoStateEnabled = true;
    callbackController.state = 'ready'; callbackController.child = f.child;
    const channels = [];
    callbackController.requestLights = () => channels.push([...callbackController.lightChannels]);
    f.observer.value = { state: 'recording', error: null }; callbackController.bageshuoObserver.onChange();
    assert.equal(channels.at(-1)[0], 2);
    f.observer.value = { state: 'unknown', error: 'capture_unknown' }; callbackController.bageshuoObserver.onChange();
    assert.equal(channels.at(-1)[0], 0);
    assert.equal(f.calls.length, 0);
  } finally { callbackController.child = null; callbackController.dispose(); f.dispose(); }
});
test('late proven-not-sent result cannot unlock a newer cross-app transition', async () => {
  const f = fixture(), finishes = [];
  f.controller.shortcutVoiceBridge.open = () => new Promise(resolve => finishes.push(resolve));
  try {
    f.controller.poll(OWNER, armed); const first = f.controller.shortcutVoice(OWNER, f.input('k1.down'), { shortcut: 'RightAlt' });
    f.controller.poll(OWNER, { ...armed, bageshuoCrossAppEnabled: false });
    f.controller.poll(OWNER, armed); f.input('k1.up');
    const second = f.controller.shortcutVoice(OWNER, f.input('k1.down'), { shortcut: 'RightAlt' });
    finishes[0]({ activated: false, error: 'shortcut_voice_cancelled', notSent: true }); await first;
    assert.equal(f.controller.bageshuoTransition, 'idle');
    finishes[1]({ activated: false, error: 'shortcut_voice_cancelled', notSent: true }); await second;
    assert.equal(f.controller.bageshuoTransition, null);
  } finally { f.dispose(); }
});
test('bridge external exception remains fixed RightAlt and native retains commit gates', async () => {
  let count = 0;
  const bridge = new ShortcutVoiceBridge({ platform: 'win32', expectedExe: 'C:\\App\\DSH.exe', spawnChild: () => { count++; throw Error(); } });
  for (const shortcut of ['F8', 'Ctrl+B']) assert.equal((await bridge.open({ shortcut, bageshuoCrossAppEnabled: true, isCurrent: () => true, expiresAt: Date.now() + 1000 })).error, 'shortcut_voice_invalid_request');
  assert.equal(count, 0);
  const native = readFileSync(new URL('../packages/dsh-plugin/native/shortcut-voice.ps1', import.meta.url), 'utf8');
  for (const text of ['bageshuoCrossAppEnabled && shortcut != "RightAlt"', 'if (bageshuoCrossAppEnabled) expected = Image(pid);', 'Foreground(expected, window, pid, out verifiedWindow);', 'Editable(pid, window, focus);', 'NoHeldKeys(chord);', 'Fresh(expiresAt, clock);', 'PipeOpen(input);']) assert.ok(native.includes(text), text);
  bridge.dispose();
});
