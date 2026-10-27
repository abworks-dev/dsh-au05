import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlGate } from '../packages/core/control-gate.mjs';
function setup() {
  let time = 10000;
  const gate = new ControlGate({ now: () => time });
  const lease = gate.acquire('tab-A').id;
  const snapshot = { sessionId: 'session-A', revision: 1, focused: true, running: true,
    completionUnread: false, pending: { key: 'request-A', kind: 'approval', answerable: true } };
  gate.update(lease, snapshot);
  return { gate, lease, snapshot, advance: ms => { time += ms; } };
}
test('approval creates only a one-time simulated intent', () => {
  const { gate, lease } = setup();
  const ticket = gate.prepare(lease, 'press-1', 'allow_once');
  assert.deepEqual(gate.consume(lease, ticket), { action: 'allow_once', sessionId: 'session-A', requestKey: 'request-A' });
  assert.throws(() => gate.consume(lease, ticket), /invalid_ticket/);
  assert.throws(() => gate.prepare(lease, 'press-1', 'allow_once'), /duplicate_event/);
});
test('concurrent owner and expired lease fail closed', () => {
  const { gate, lease, advance } = setup();
  assert.throws(() => gate.acquire('tab-B'), /controller_busy/);
  advance(5000);
  assert.equal(gate.status(), 'unknown');
  assert.throws(() => gate.prepare(lease, 'late', 'cancel'), /lease_expired/);
  const next = gate.acquire('tab-B'); assert.notEqual(next.id, lease);
  assert.equal(gate.status(), 'unknown');
});
test('stale status and blurred controller cannot execute', () => {
  const { gate, lease, snapshot, advance } = setup();
  advance(2000);
  assert.throws(() => gate.prepare(lease, 'x', 'allow_once'), /stale_snapshot/);
  gate.update(lease, { ...snapshot, revision: 2, focused: false });
  assert.throws(() => gate.prepare(lease, 'y', 'allow_once'), /not_focused/);
});
test('request replacement, session switch and status update invalidate gesture', () => {
  for (const change of [{ pending: { key: 'request-B', kind: 'approval', answerable: true } },
    { sessionId: 'session-B' }, { running: false }]) {
    const { gate, lease, snapshot } = setup();
    const ticket = gate.prepare(lease, 'x', 'allow_once');
    gate.update(lease, { ...snapshot, ...change, revision: 2 });
    assert.throws(() => gate.consume(lease, ticket), /invalid_ticket/);
  }
});
test('interaction kinds and answerable flag cannot be bypassed', () => {
  for (const pending of [null, { key: 'x', kind: 'form', answerable: true }, { key: 'x', kind: 'approval', answerable: false }]) {
    const { gate, lease, snapshot } = setup(); gate.update(lease, { ...snapshot, revision: 2, pending });
    assert.throws(() => gate.prepare(lease, 'x', 'allow_once'), /not_answerable/);
  }
  const { gate, lease } = setup();
  assert.throws(() => gate.prepare(lease, 'x', 'allowed-session'), /invalid_event/);
});
test('tampering and timeout cannot change action', () => {
  const { gate, lease, advance } = setup();
  const ticket = gate.prepare(lease, 'x', 'reject');
  assert.throws(() => gate.consume(lease, { ...ticket, action: 'allow_once' }), /tampered_ticket/);
  const late = gate.prepare(lease, 'y', 'reject'); advance(1000);
  assert.throws(() => gate.consume(lease, late), /stale_ticket/);
});
test('revision, input validation and unknown running are conservative', () => {
  const { gate, lease, snapshot } = setup();
  assert.throws(() => gate.update(lease, snapshot), /stale_revision/);
  assert.throws(() => gate.update(lease, { ...snapshot, revision: 2, running: 'yes' }), /invalid_snapshot/);
  gate.update(lease, { ...snapshot, revision: 2, pending: null, running: undefined });
  assert.equal(gate.status(), 'unknown');
  assert.throws(() => gate.prepare(lease, 'x', 'cancel'), /not_running/);
});
test('release clears gestures and owner state', () => {
  const { gate, lease } = setup(); const ticket = gate.prepare(lease, 'x', 'cancel');
  gate.release(lease); assert.equal(gate.status(), 'unknown');
  const next = gate.acquire('new').id;
  assert.throws(() => gate.consume(next, ticket), /stale_snapshot/);
});
