import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { NativeWheelBridge } from '../packages/dsh-plugin/host/native-wheel.js';

function fixture(options = {}) {
  let now = 1000; const timers = new Map(); let timerId = 0; const writes = []; const spawns = [];
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.write = text => writes.push(JSON.parse(text)); child.stdin.destroy = () => {}; child.kill = () => { child.killed = true; };
  const bridge = new NativeWheelBridge({ platform: 'win32', expectedExe: 'C:\\DSH\\DeepSeek Harness.exe', env: {}, now: () => now,
    schedule: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; }, cancelTimer: id => timers.delete(id),
    spawnChild: (...args) => { spawns.push(args); return child; }, ...options });
  return { bridge, writes, spawns, child, output: value => child.stdout.emit('data', JSON.stringify(value) + '\n'),
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
    request: (overrides = {}) => bridge.dispatch({ direction: 'up', expiresAt: now + 500, isCurrent: () => true, ...overrides }) };
}
const ok = { scrolled: true, error: null };
test('start never writes; ready required; script and arguments fixed', async () => {
  const f = fixture(); const start = f.bridge.start(); assert.equal(f.writes.length, 0);
  assert.equal(f.spawns.length, 1); const [exe, args, options] = f.spawns[0];
  assert.equal(exe, 'pwsh'); assert.match(args[4].replaceAll('\\', '/'), /\/native\/native-wheel\.ps1$/);
  assert.deepEqual(args.slice(5), ['-Mode', 'Listen', '-ExpectedExe', 'C:\\DSH\\DeepSeek Harness.exe']); assert.equal(options.shell, false);
  const pending = f.request(); assert.equal(f.writes.length, 0); f.output({ type: 'ready' });
  assert.deepEqual(await start, { scrolled: false, error: null }); assert.equal(f.writes.length, 1);
  f.output({ type: 'result', id: 1, ...ok }); assert.deepEqual(await pending, ok); f.bridge.dispose();
});
test('invalid or unauthorized dispatch never writes or spawns', async () => {
  const f = fixture(); assert.equal((await f.request({ isCurrent: () => false })).error, 'native_wheel_cancelled');
  assert.equal((await f.request({ direction: 'left' })).error, 'native_wheel_invalid_request');
  assert.equal((await f.request()).error, 'native_wheel_not_ready'); assert.equal(f.spawns.length, 0);
  f.bridge.dispose(); assert.equal((await f.request()).error, 'native_wheel_disposed');
});
test('ordered bounded queue and expiration before readiness', async () => {
  const f = fixture(); const start = f.bridge.start(); const pending = Array.from({ length: 32 }, () => f.request());
  assert.equal((await f.request()).error, 'native_wheel_queue_full'); f.output({ type: 'ready' }); await start;
  for (let id = 1; id <= 32; id++) { assert.equal(f.writes.at(-1).id, id); f.output({ type: 'result', id, ...ok }); }
  assert.ok((await Promise.all(pending)).every(x => x.scrolled)); assert.equal(f.spawns.length, 1); f.bridge.dispose();
  const g = fixture(); const startup = g.bridge.start(); const expired = g.request(); g.advance(500);
  assert.equal((await expired).error, 'native_wheel_expired'); g.output({ type: 'ready' }); await startup; assert.equal(g.writes.length, 0); g.bridge.dispose();
});
test('deadline clamps at 500ms; callback revocation kills owned process and all pending', async () => {
  const f = fixture(); const start = f.bridge.start(); f.output({ type: 'ready' }); await start;
  let current = true; const a = f.request({ expiresAt: 99999, isCurrent: () => current }); const b = f.request();
  assert.equal(f.writes[0].deadline, 1500); current = false; f.advance(10);
  assert.equal((await a).error, 'native_wheel_cancelled'); assert.equal((await b).error, 'native_wheel_cancelled'); assert.equal(f.child.killed, true);
  f.output({ type: 'result', id: 1, ...ok });
  assert.equal((await f.request()).error, 'native_wheel_not_ready');
  assert.equal(f.writes.length, 1); assert.equal(f.spawns.length, 1);
});
test('watch drops only revoked unsent entries while an authorized command remains active', async () => {
  const f = fixture(); const start = f.bridge.start(); f.output({ type: 'ready' }); await start;
  const active = f.request(); let current = true;
  const revoked = f.request({ isCurrent: () => current }); const queued = f.request();
  current = false; f.advance(10);
  assert.equal((await revoked).error, 'native_wheel_cancelled');
  assert.equal(f.bridge.state, 'ready'); assert.notEqual(f.child.killed, true);
  assert.deepEqual(f.writes.map(x => x.id), [1]); assert.equal(f.bridge.active.id, 1);
  f.output({ type: 'result', id: 1, ...ok }); assert.deepEqual(await active, ok);
  assert.deepEqual(f.writes.map(x => x.id), [1, 3]);
  f.output({ type: 'result', id: 3, ...ok }); assert.deepEqual(await queued, ok);
  const future = f.request(); f.output({ type: 'result', id: 4, ...ok }); assert.deepEqual(await future, ok);
  assert.equal(f.spawns.length, 1); f.bridge.dispose();
});
test('pump skips revoked unsent entries and continues the authorized queue without restarting', async () => {
  const f = fixture(); const start = f.bridge.start(); f.output({ type: 'ready' }); await start;
  const active = f.request(); let current = true;
  const revoked = f.request({ isCurrent: () => current }); const queued = f.request();
  current = false; f.output({ type: 'result', id: 1, ...ok });
  assert.deepEqual(await active, ok); assert.equal((await revoked).error, 'native_wheel_cancelled');
  assert.deepEqual(f.writes.map(x => x.id), [1, 3]); assert.notEqual(f.child.killed, true);
  f.output({ type: 'result', id: 3, ...ok }); assert.deepEqual(await queued, ok);
  const future = f.request(); f.output({ type: 'result', id: 4, ...ok }); assert.deepEqual(await future, ok);
  assert.equal(f.bridge.state, 'ready'); assert.equal(f.spawns.length, 1); f.bridge.dispose();
});
test('cancel/dispose/start failures, malformed output and unsupported platform', async () => {
  for (const method of ['cancel', 'dispose']) {
    const f = fixture(); const start = f.bridge.start(); const pending = f.request(); f.bridge[method]();
    assert.equal((await pending).error, `native_wheel_${method === 'cancel' ? 'cancelled' : 'disposed'}`); await start;
    assert.equal(f.child.killed, true); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); const start = f.bridge.start(); f.child.stdout.emit('data', '{bad}\n');
  assert.equal((await start).error, 'native_wheel_protocol_error'); assert.equal(f.child.killed, true);
  const g = fixture({ platform: 'linux' }); assert.equal((await g.bridge.start()).error, 'native_wheel_unsupported_platform'); assert.equal(g.spawns.length, 0);
  const h = fixture({ spawnChild: () => { throw Error('private'); } }); assert.equal((await h.bridge.start()).error, 'native_wheel_start_failed');
});
test('expiry in flight never auto restarts; callback checked again at ready', async () => {
  const f = fixture(); const start = f.bridge.start(); f.output({ type: 'ready' }); await start;
  const pending = f.request({ expiresAt: 1005 }); f.advance(10);
  assert.equal((await pending).error, 'native_wheel_expired'); assert.equal(f.child.killed, true);
  assert.equal((await f.request()).error, 'native_wheel_not_ready'); assert.equal(f.spawns.length, 1);
  const g = fixture(); const startup = g.bridge.start(); let current = true;
  const queued = g.request({ isCurrent: () => current }); current = false; g.output({ type: 'ready' }); await startup;
  assert.equal((await queued).error, 'native_wheel_cancelled'); assert.equal(g.writes.length, 0); assert.notEqual(g.child.killed, true);
  assert.equal(g.bridge.state, 'ready'); const future = g.request();
  g.output({ type: 'result', id: 2, ...ok }); assert.deepEqual(await future, ok); assert.equal(g.spawns.length, 1); g.bridge.dispose();
});
test('explicit start after cancel or failure creates fresh child and ignores old child events', async () => {
  const children = [];
  const f = fixture({ spawnChild: () => {
    const child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new EventEmitter();
    child.stdin.write = () => {}; child.stdin.destroy = () => {}; child.kill = () => {};
    children.push(child); return child;
  } });
  const a = f.bridge.start(); f.bridge.cancel(); assert.equal((await a).error, 'native_wheel_cancelled');
  const b = f.bridge.start(); assert.equal(children.length, 2);
  children[0].emit('close'); children[0].stdout.emit('data', '{bad}\n');
  children[1].stdout.emit('data', '{"type":"ready"}\n'); assert.equal((await b).error, null);
  children[1].emit('close'); assert.equal((await f.request()).error, 'native_wheel_not_ready');
  const c = f.bridge.start(); assert.equal(children.length, 3);
  children[2].stdout.emit('data', '{"type":"ready"}\n'); assert.equal((await c).error, null);
  f.bridge.dispose(); assert.equal((await f.bridge.start()).error, 'native_wheel_disposed'); assert.equal(children.length, 3);
});
test('native result error whitelist; unsolicited or extra output fails closed', async () => {
  for (const value of [{ type: 'result', id: 1, scrolled: false, error: 'private' }, { type: 'ready', path: 'private' }, { type: 'ready' }]) {
    const f = fixture(); const start = f.bridge.start(); f.output({ type: 'ready' }); await start; const pending = f.request(); f.output(value);
    assert.equal((await pending).error, 'native_wheel_protocol_error'); assert.equal(f.child.killed, true);
  }
});
