import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_EVENT_STATES, createDshStudioEnvelope } from '../packages/dsh-studio-hook/mapping.js';
import { createDshHookObserver } from '../packages/dsh-studio-hook/core.js';

function fixture(alias = 'opaque-one') {
  let session = { id: 'private-real-session' }, seq = 0;
  const records = [], sessions = { get: id => id === 'private-real-session' ? session : undefined };
  const observer = createDshHookObserver({ sessionId: session.id, sessions, emit: value => records.push(value), alias });
  function event(type, data = {}, extra = {}, target = session) {
    observer.listeners['session/event'](target, { seq: seq++, time: 1793340000000 + seq, type, data, ...extra });
  }
  function pending(key = 'private-request') {
    return { kind: 'approval', sessionId: session.id, key, answerable: true,
      answer() { throw new Error('must_never_answer'); } };
  }
  return { observer, records, event, pending, get session() { return session; }, set session(value) { session = value; },
    hooks: () => records.filter(r => r.hook).map(r => r.hook),
  };
}

for (const [event, state] of Object.entries({ SessionStart: 'idle', UserPromptSubmit: 'thinking',
  PreToolUse: 'working', PostToolUse: 'working', Stop: 'attention', PermissionRequest: 'notification' })) {
  test(`official pair ${event}/${state} keeps DSH identity`, () => {
    const envelope = createDshStudioEnvelope(event, 'dsh-opaque');
    assert.deepEqual(envelope, { type: 'event', action: 'hook-fired', params: { type: 'state', agent_id: 'dsh',
      hook_source: 'ulanzi-studio', session_id: 'dsh-opaque', event, state } });
    assert.ok(Object.isFrozen(envelope) && Object.isFrozen(envelope.params));
  });
}
test('mapping cannot be mutated or changed to a custom event or Codex session', () => {
  assert.ok(Object.isFrozen(STUDIO_EVENT_STATES));
  assert.throws(() => { STUDIO_EVENT_STATES.PermissionRequest = 'attention'; }, TypeError);
  for (const event of ['DshCoopLightTest', 'constructor', '__proto__', 'notification', null, {}]) {
    assert.throws(() => createDshStudioEnvelope(event, 'dsh-opaque'), /unsupported_studio_hook_event/);
  }
  for (const session of ['codex-opaque', 'private-real-session', 'dsh-', 'dsh-a/b', 'dsh-a\n', 'dsh-' + 'a'.repeat(81), null]) {
    assert.throws(() => createDshStudioEnvelope('Stop', session), /opaque_dsh_session_required/);
  }
});
test('mount, restore and status never invent SessionStart or tool Hooks', () => {
  const f = fixture(); f.observer.attach();
  f.observer.listeners['agent/status']({ agent: { id: f.session.id, session: f.session }, status: 'running' });
  f.event('turn/start'); f.observer.listeners['session/created'](f.session);
  assert.deepEqual(f.hooks(), []);
});
test('real lifecycle projects canonical pairs and only opaque metadata', () => {
  const f = fixture();
  const user = { source: { kind: 'user' } };
  for (const key of ['text', 'content', 'cwd']) Object.defineProperty(user, key, { get() { throw new Error('private_read'); } });
  f.event('user/message', user);
  f.event('tool/call', { callId: 'private-call', arguments: { secret: 'never' } });
  f.event('tool/result', { message: { toolCallId: 'private-call', content: 'private-output' } }, { surfaceOp: 'append' });
  f.event('turn/end', { reason: { kind: 'completed', body: 'private-output' } });
  assert.deepEqual(f.hooks().map(h => [h.params.event, h.params.state]), [
    ['UserPromptSubmit', 'thinking'], ['PreToolUse', 'working'], ['PostToolUse', 'working'], ['Stop', 'attention'],
  ]);
  const text = JSON.stringify(f.records);
  for (const value of ['private-real-session', 'private-call', 'private-output', 'arguments', 'secret', 'cwd']) assert.ok(!text.includes(value));
  assert.ok(f.hooks().every(h => h.params.agent_id === 'dsh' && h.params.session_id === 'dsh-opaque-one'));
});
test('SDK events without sessionId project only from the exact selected callback object', () => {
  const f = fixture();
  const user = { source: { kind: 'user' } };
  f.event('user/message', user, {}, { id: 'foreign' });
  f.event('user/message', user, {}, { id: f.session.id });
  f.event('user/message', user, { sessionId: 'foreign' });
  f.event('user/message', user, { sessionId: f.session.id }, { id: 'foreign' });
  assert.deepEqual(f.hooks(), []);
  f.event('user/message', user);
  assert.deepEqual(f.hooks().map(h => h.params.event), ['UserPromptSubmit']);
});
test('legacy source.callId alone is not a canonical tool result and cannot consume a matching call', () => {
  const f = fixture();
  f.event('tool/call', { callId: 'call' });
  f.event('tool/result', { message: { source: { callId: 'call' } } });
  assert.deepEqual(f.hooks().map(h => h.params.event), ['PreToolUse']);
  f.event('tool/result', { message: { toolCallId: 'call' } });
  assert.deepEqual(f.hooks().map(h => h.params.event), ['PreToolUse', 'PostToolUse']);
});
test('automatic approval request/decision events do not fabricate PermissionRequest', () => {
  const f = fixture(); f.event('approval/asked'); f.event('approval/decided');
  assert.deepEqual(f.hooks(), []);
});
test('only the exact current, answerable GUI approval projects PermissionRequest, once', () => {
  const f = fixture(), p = f.pending();
  Object.defineProperty(p, 'reason', { get() { throw new Error('reason_read'); } });
  assert.equal(f.observer.syncPendingApproval(f.session, f.observer.generation, p), true);
  assert.equal(f.observer.syncPendingApproval(f.session, f.observer.generation, p), false);
  assert.deepEqual(f.hooks().map(h => [h.params.event, h.params.state]), [['PermissionRequest', 'notification']]);
  assert.ok(!JSON.stringify(f.records).includes('private-request'));
});
test('foreign, nonapproval, settled, malformed and stale pending projections fail closed', () => {
  const f = fixture(), p = f.pending();
  for (const invalid of [null, { ...p, sessionId: 'foreign' }, { ...p, kind: 'question' },
    { ...p, kind: 'plan-review' }, { ...p, key: '' }, { ...p, answerable: false }, { ...p, answerable: 'true' },
    { ...p, answer: undefined }]) assert.equal(f.observer.syncPendingApproval(f.session, 1, invalid), false);
  assert.equal(f.observer.syncPendingApproval({ id: f.session.id }, 1, p), false);
  assert.equal(f.observer.syncPendingApproval(f.session, 0, p), false);
  assert.equal(f.observer.syncPendingApproval(f.session, 1, p), false, 'settled keys cannot revive');
  assert.deepEqual(f.hooks(), []);
});
test('completion deduplicates by seq and call association, not output text', () => {
  const f = fixture(); f.event('tool/result', { message: { toolCallId: 'orphan' } });
  f.event('tool/call', { callId: 12 }, { seq: 10 });
  f.event('tool/call', { callId: 12 }, { seq: 10 });
  f.event('tool/result', { message: { toolCallId: 12 } }, { seq: 9 });
  f.event('tool/result', { message: { toolCallId: 12 } }, { seq: 11, surfaceOp: 'replace' });
  f.event('tool/result', { callId: 12 }, { seq: 12 });
  f.event('tool/result', { message: { toolCallId: 12 } }, { seq: 13, surfaceOp: 'append' });
  f.event('tool/result', { message: { toolCallId: 12 } }, { seq: 14, surfaceOp: 'append' });
  assert.deepEqual(f.hooks().map(h => h.params.event), ['PreToolUse', 'PostToolUse']);
});
test('semantic Host result without surface metadata still requires a matching call', () => {
  const f = fixture(); f.event('tool/call', { callId: 'call' });
  f.event('tool/result', { message: { toolCallId: 'call' } });
  assert.deepEqual(f.hooks().map(h => h.params.event), ['PreToolUse', 'PostToolUse']);
});
test('invalid seq, unknown tool schema and unknown events never create Hooks', () => {
  const f = fixture();
  for (const seq of [undefined, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) f.event('user/message', { source: { kind: 'user' } }, { seq });
  f.event('tool/call', { arguments: 'private' }); f.event('tool/ptc-dispatch', { subCallId: 'x' });
  f.event('tool/start'); f.event('tool/end');
  assert.deepEqual(f.hooks(), []);
});
test('replacement invalidates old session events, old tool completions and old pending generation', () => {
  const f = fixture(), old = f.session, p = f.pending();
  f.event('tool/call', { callId: 'old-call' });
  f.session = { id: old.id };
  f.event('user/message', { source: { kind: 'user' } }, {}, old);
  assert.equal(f.observer.syncPendingApproval(old, 1, p), false);
  f.observer.listeners['session/created'](f.session);
  assert.equal(f.observer.generation, 2);
  assert.equal(f.observer.syncPendingApproval(f.session, 1, p), false);
  f.event('tool/result', { message: { toolCallId: 'old-call' } });
  assert.deepEqual(f.hooks().map(h => h.params.event), ['PreToolUse']);
  f.event('user/message', { source: { kind: 'user' } });
  assert.equal(f.hooks().at(-1).params.session_id, 'dsh-opaque-one');
});
test('terminal and stopped observers reject late tool and pending callbacks', () => {
  const f = fixture(); f.event('tool/call', { callId: 'call' }); f.event('turn/end', { reason: { kind: 'aborted' } });
  f.event('turn/end'); f.event('tool/result', { message: { toolCallId: 'call' } });
  assert.equal(f.observer.syncPendingApproval(f.session, 1, f.pending()), false);
  assert.deepEqual(f.hooks().map(h => h.params.event), ['PreToolUse', 'Stop']);
  f.event('user/message', { source: { kind: 'user' } });
  assert.equal(f.observer.syncPendingApproval(f.session, 1, f.pending('new-request')), true);
  f.observer.stop(); f.event('tool/call', { callId: 'late' });
  assert.equal(f.observer.syncPendingApproval(f.session, 1, f.pending('late')), false);
  assert.deepEqual(f.hooks().map(h => h.params.event), ['PreToolUse', 'Stop', 'UserPromptSubmit', 'PermissionRequest']);
});
test('two observer scopes never share a wire session or accept each other\'s object', () => {
  const a = fixture('opaque-a'), b = fixture('opaque-b');
  a.event('user/message', { source: { kind: 'user' } }); b.event('user/message', { source: { kind: 'user' } });
  assert.notEqual(a.hooks()[0].params.session_id, b.hooks()[0].params.session_id);
  assert.equal(a.observer.syncPendingApproval(b.session, 1, b.pending()), false);
});
