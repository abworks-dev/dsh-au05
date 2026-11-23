import test from 'node:test';
import assert from 'node:assert/strict';
import { createDshHookObserver } from '../packages/dsh-studio-hook/core.js';
import { apply } from '../packages/dsh-studio-hook/index.js';

function fixture() {
  let session = { id: 'selected-session' };
  const records = [], sessions = { get: id => id === 'selected-session' ? session : undefined };
  const observer = createDshHookObserver({ sessionId: session.id, sessions, emit: item => records.push(item), alias: 'opaque-test-session' });
  let seq = 0;
  const event = (type, data = {}, target = session, extra = {}) => observer.listeners['session/event'](target, { type, data, seq: seq++, time: 1793340000000 + seq, ...extra });
  return { observer, records, sessions, event, get session() { return session; }, set session(value) { session = value; } };
}

test('default Hook activation is inert and cannot send Studio events', () => {
  assert.equal(apply({}), undefined);
  assert.equal(apply({}, { enabled: false }), undefined);
  assert.throws(() => apply({}, { enabled: true, transport: 'studio' }), /studio_sender_not_verified/);
});
test('an explicit selected session and bounded duration are required', () => {
  assert.throws(() => createDshHookObserver({ sessionId: '', sessions: {}, emit() {} }), /selected_session_required/);
  for (const seconds of [0, 121, 1.5, '60']) assert.throws(() => apply({}, { enabled: true, transport: 'dry-run-only', seconds }), /invalid_observer_duration/);
});
test('attaching observer never invents SessionStart or running state', () => {
  const f = fixture(); f.observer.attach();
  assert.equal(f.records.length, 1); assert.equal(f.records[0].kind, 'observer-attached');
  assert.equal(f.records[0].attached, true); assert.equal(f.records[0].status, undefined);
  assert.equal(f.records[0].source, 'dsh'); assert.equal(f.records[0].transport, 'dry-run-only');
});
test('real DSH metadata lifecycles map without copying user content', () => {
  const f = fixture();
  const privateFields = { source: { kind: 'user' } };
  for (const key of ['text', 'content', 'toolName', 'reason', 'cwd']) Object.defineProperty(privateFields, key, { get() { throw new Error('private_field_read'); } });
  f.event('user/message', privateFields); f.event('turn/start', { turn: 99 });
  f.event('approval/asked', { reason: 'do-not-copy', toolName: 'private', id: 'private-id' });
  f.event('approval/decided', { outcome: 'private' });
  f.event('turn/end', { reason: { kind: 'error', error: { message: 'do-not-copy' } } });
  assert.deepEqual(f.records.map(x => x.kind), ['user-prompt', 'turn-start', 'approval-requested', 'approval-decided', 'turn-settled']);
  assert.equal(f.records.at(-1).endKind, 'error');
  const output = JSON.stringify(f.records);
  for (const value of ['do-not-copy', 'private-id', 'selected-session', 'toolName', 'cwd', 'text']) assert.ok(!output.includes(value));
});
test('non-user messages and unknown event types do not become Hooks', () => {
  const f = fixture(); f.event('user/message', { source: { kind: 'agent' } }); f.event('tool/call', { text: 'hidden' });
  assert.equal(f.records.length, 0);
});
test('SDK event without sessionId is scoped only by the exact selected callback session', () => {
  const f = fixture();
  f.event('turn/start', {}, { id: 'foreign' });
  f.event('turn/start', {}, { id: f.session.id });
  assert.equal(f.records.length, 0, 'foreign or reconstructed callback objects cannot establish scope');
  f.event('turn/start');
  assert.deepEqual(f.records.map(record => record.kind), ['turn-start']);
});
test('an optional contradictory event sessionId cannot override callback scope', () => {
  const f = fixture();
  f.event('turn/start', {}, f.session, { sessionId: 'foreign' });
  f.event('turn/start', {}, { id: 'foreign' }, { sessionId: f.session.id });
  assert.equal(f.records.length, 0);
  f.event('turn/start', {}, f.session, { sessionId: f.session.id });
  assert.deepEqual(f.records.map(record => record.kind), ['turn-start']);
});
test('only exact bound agent and known running states are accepted', () => {
  const f = fixture();
  const dispatch = (agent, status) => f.observer.listeners['agent/status']({ agent, status });
  dispatch({ id: 'selected-session', session: f.session }, 'running');
  dispatch({ id: 'selected-session', session: f.session }, 'idle');
  dispatch({ id: 'selected-session', session: f.session }, 'other');
  dispatch({ id: 'foreign', session: f.session }, 'running');
  dispatch({ id: 'selected-session', session: { id: 'selected-session' } }, 'running');
  assert.deepEqual(f.records.map(x => x.status), ['running', 'idle']);
});
test('detach and reattachment invalidate stale-generation events', () => {
  const f = fixture(), old = f.session;
  f.observer.listeners['session/disposed'](old);
  f.event('turn/start', {}, old); f.session = { id: old.id };
  f.observer.listeners['session/created'](f.session); f.event('turn/start'); f.event('turn/start', {}, old);
  assert.deepEqual(f.records.map(x => x.kind), ['session-detached', 'session-attached', 'turn-start']);
  assert.equal(f.records.at(-1).generation, 2);
});
test('session registry replacement fails closed before creation callback', () => {
  const f = fixture(), old = f.session; f.session = { id: old.id }; f.event('turn/start', {}, old);
  assert.equal(f.records.length, 0);
});
test('end reasons are a small enum and never publish error bodies', () => {
  const f = fixture(); f.event('turn/end', { reason: { kind: 'private-message' } });
  assert.equal(f.records[0].endKind, 'other');
});
test('stop is idempotent and later callbacks are inert', () => {
  const f = fixture(); f.observer.stop(); f.observer.stop(); f.event('turn/start'); f.observer.attach();
  assert.deepEqual(f.records.map(x => x.kind), ['observer-stopped']);
});
test('a failing sink cannot break DSH lifecycle processing', () => {
  const f = fixture(); const observer = createDshHookObserver({ sessionId: f.session.id, sessions: f.sessions, emit() { throw new Error('sink_failure'); } });
  assert.doesNotThrow(() => { observer.attach(); observer.listeners['session/event'](f.session, { seq: 0, time: 1793340000000, type: 'turn/start', data: {} }); observer.stop(); });
});
test('Host plugin registers passive listeners only and fully disposes them', () => {
  const f = fixture(), registered = [], off = [], effects = [], logs = [];
  const ctx = { sessions: f.sessions, logger: { info: line => logs.push(JSON.parse(line)) },
    on(name, listener) { registered.push({ name, listener }); return () => off.push(name); },
    effect(fn) { effects.push(fn()); } };
  const dispose = apply(ctx, { enabled: true, transport: 'dry-run-only', sessionId: f.session.id, seconds: 60 });
  assert.deepEqual(registered.map(x => x.name), ['session/created', 'session/disposed', 'agent/status', 'session/event']);
  assert.ok(!registered.some(x => x.name === 'approval/request'));
  dispose(); effects[0](); assert.equal(off.length, 4);
  registered.find(x => x.name === 'session/event').listener(f.session, { seq: 0, time: 1793340000000, type: 'turn/start', data: {} });
  assert.deepEqual(logs.map(x => x.kind), ['observer-attached', 'observer-stopped']);
});
