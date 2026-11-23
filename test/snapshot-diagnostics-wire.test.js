import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DeviceController, parseSnapshotDiagnostics } from '../packages/dsh-plugin/host/device-controller.js';
import { createModeLease } from '../packages/dsh-plugin/host/mode-lease.js';
const owner = 'owner_snapshot_000000001';
function fixture() {
  let child;
  const commands = [];
  const controller = new DeviceController({ platform: 'win32', modeLease: createModeLease('direct', new Map()),
    spawnChild() {
      child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
      child.stdin.on('data', chunk => commands.push(JSON.parse(chunk.toString())));
      child.kill = () => { child.emit('close', 0); return true; };
      return child;
    } });
  return { controller, commands, emit(value) { child.stdout.write(JSON.stringify(value) + '\n'); }, close() { child.emit('close', 0); } };
}
const history = () => Array.from({ length: 3 }, (_, index) => ({ attempt: index + 1,
  outcome: index === 2 ? 'matched' : 'reply_rejected', auth: 'matched', link: 'matched', timedOut: index === 2 ? 0 : 1, rejected: 327675 }));

test('bounded snapshot history fits native line budget alongside maximal readback comparison', () => {
  const f = fixture();
  try {
    f.controller.connect(owner); f.emit({ type: 'status', state: 'ready' });
    f.controller.poll(owner, { light: 'running' });
    const request = f.commands.at(-1);
    const counters = Object.fromEntries(['readsWhilePending', 'shortReads', 'outerRejected', 'nonMatchingHeader', 'modeRejected'].map(key => [key, 65535]));
    const headerKinds = Object.fromEntries(['lightingNoRelay', 'lightingGroupFlags', 'lightingOtherOperation', 'dongle', 'notice', 'otherDevice', 'other'].map(key => [key, 65535]));
    const lights = Array.from({ length: 20 }, (_, index) => index % 5 === 0 ? 2 : 255);
    const readback = { stage: 'post_write', attempts: 1, ...counters, matched: 1, timedOut: 1, getWritesCompleted: 1, headerKinds,
      comparison: { expected: { mode: 2, lights }, observed: { mode: 2, lights } } };
    const packet = { type: 'lights', state: request.state, result: 'verified', requestId: request.requestId, readback, snapshotDiagnostics: history() };
    assert.ok(Buffer.byteLength(JSON.stringify({ ...packet, requestId: Number.MAX_SAFE_INTEGER })) <= 2048);
    f.emit(packet);
    assert.equal(f.controller.snapshot().connected, true);
    const result = f.controller.poll(owner, { light: 'running' });
    assert.deepEqual(result.snapshotDiagnostics, history());
    result.snapshotDiagnostics[0].outcome = 'matched';
    assert.equal(f.controller.snapshot().snapshotDiagnostics[0].outcome, 'reply_rejected');
    f.controller.stop(owner); f.close(); f.controller.connect(owner);
    assert.deepEqual(f.controller.snapshot().snapshotDiagnostics, []);
  } finally { f.controller.dispose(); }
});

test('unattempted auth gate is a lamp fault and retains diagnostics after recovery', () => {
  const f = fixture();
  try {
    f.controller.connect(owner); f.emit({ type: 'status', state: 'ready' });
    f.controller.poll(owner, { light: 'running' });
    const request = f.commands.at(-1);
    const first = { attempt: 1, outcome: 'auth_unconfirmed', auth: 'reply_timeout', link: 'not_sent', timedOut: 0, rejected: 0 };
    f.emit({ type: 'lights', state: request.state, result: 'failed', reason: 'snapshot_unavailable', requestId: request.requestId, snapshotDiagnostics: [first] });
    assert.equal(f.controller.snapshot().connected, true);
    assert.equal(f.controller.snapshot().lightError, 'snapshot_unavailable');
    const recovered = { attempt: 2, outcome: 'matched', auth: 'matched', link: 'matched', timedOut: 0, rejected: 0 };
    f.emit({ type: 'lights', state: request.state, result: 'verified', requestId: request.requestId, snapshotDiagnostics: [first, recovered] });
    assert.equal(f.controller.snapshot().lightError, null);
    assert.deepEqual(f.controller.snapshot().snapshotDiagnostics, [first, recovered]);
    f.emit({ type: 'lights', state: request.state, result: 'verified', requestId: request.requestId });
    assert.deepEqual(f.controller.snapshot().snapshotDiagnostics, [first, recovered]);
  } finally { f.controller.dispose(); }
});

test('pending native lamp reply never blocks synchronous status or poll', () => {
  const f = fixture();
  try {
    assert.equal(f.controller.connect(owner).state, 'connecting');
    f.emit({ type: 'status', state: 'ready' });
    const result = f.controller.poll(owner, { light: 'running' });
    assert.equal(result.connected, true);
    assert.equal(typeof result.then, 'undefined');
    assert.equal(f.controller.snapshot().connected, true);
  } finally { f.controller.dispose(); }
});

test('snapshot diagnostics reject oversized, sparse, decorated and identity-bearing histories', () => {
  for (const value of [Array(1), [...history(), history()[0]], Object.assign([], { owner }),
    [{ ...history()[0], owner }], [{ ...history()[0], attempt: 2 }],
    [{ ...history()[0], outcome: 'raw_device_path' }], [{ ...history()[0], rejected: 327676 }]]) {
    assert.throws(() => parseSnapshotDiagnostics(value), /invalid_result/);
  }
});
