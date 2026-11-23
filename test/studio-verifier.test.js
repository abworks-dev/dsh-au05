import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioVerifier } from '../packages/dsh-studio-hook/verifier.js';
import { mountStudioVerifier, descriptors, parseSnapshot } from '../packages/dsh-studio-hook/rpc.js';
const OWNER = 'test_owner_verifier_0123456789';
function fixture() {
  let time = 0, tick;
  const selected = { id: 'real-private-session', seq: 0 }, foreign = { id: 'other-private-session', seq: 0 };
  const registry = new Map([[selected.id, selected], [foreign.id, foreign]]), callbacks = new Map(), senders = [];
  const registrations = new Map();
  const ctx = { sessions: { get: id => registry.get(id) }, on(name, listener, options) {
    const set = callbacks.get(name) ?? new Set(); callbacks.set(name, set); set.add(listener); registrations.set(listener, options);
    return () => { registrations.delete(listener); set.delete(listener); };
  } };
  const verifier = createStudioVerifier({ ctx, now: () => time, seconds: 10,
    setIntervalImpl(fn) { tick = fn; return { unref() {} }; }, clearIntervalImpl() { tick = null; },
    Sender(options) {
      const events = []; let stopped = false;
      const sender = { options, events, enqueue(event) { if (stopped || !options.isCurrent()) return false; events.push(event); options.onRecord({ code: 'cli_returned_not_lamp_ack', event }); return true; },
        stop() { stopped = true; }, snapshot: () => ({ accepted: events.length, completed: events.length, dropped: 0 }) };
      senders.push(sender); return sender;
    } });
  const emit = (name, ...args) => { for (const callback of [...(callbacks.get(name) ?? [])]) callback(...args); };
  const emitCrossScope = (name, ...args) => {
    for (const callback of [...(callbacks.get(name) ?? [])]) if (registrations.get(callback)?.global === true) callback(...args);
  };
  return { verifier, selected, foreign, registry, callbacks, ctx, senders, emit, emitCrossScope,
    advance(ms) { time += ms; tick?.(); } };
}
function event(f, seq, type, data = {}, target = f.selected) { f.emit('session/event', target, { time: 0, seq, type, data }); }
test('verification creation is inert and does not fabricate SessionStart', () => {
  const f = fixture(); assert.equal(f.senders.length, 0); assert.equal(f.callbacks.size, 0);
  f.verifier.start(f.selected.id, OWNER); assert.deepEqual(f.senders[0].events, []);
  assert.match(f.senders[0].options.sessionId, /^dsh-[a-f0-9-]+$/);
  assert.ok(!JSON.stringify(f.verifier.status()).includes(f.selected.id)); f.verifier.dispose();
});
test('only real selected-session user/tool/end events automatically enqueue canonical names', () => {
  const f = fixture(); f.verifier.start(f.selected.id, OWNER);
  event(f, 1, 'user/message', { source: { kind: 'user' }, text: 'private text' });
  event(f, 2, 'tool/call', { callId: 'private-call', arguments: 'private' });
  event(f, 3, 'tool/result', { message: { toolCallId: 'private-call', role: 'tool', content: 'private result' } });
  event(f, 4, 'turn/end', { reason: { kind: 'completed' } });
  assert.deepEqual(f.senders[0].events, ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
  assert.equal(f.verifier.poll(OWNER).completed, 4); f.verifier.dispose();
});
test('cross-scope Host delivery is explicit while exact selected-session isolation remains enforced', () => {
  const f = fixture(); f.verifier.start(f.selected.id, OWNER);
  const envelope = (_target, seq) => ({ time: 0, seq, type: 'user/message', data: { source: { kind: 'user' } } });
  f.emitCrossScope('session/event', f.foreign, envelope(f.foreign, 1));
  assert.deepEqual(f.senders[0].events, []);
  f.emitCrossScope('session/event', f.selected, envelope(f.selected, 1));
  assert.deepEqual(f.senders[0].events, ['UserPromptSubmit']);
  f.verifier.stop(OWNER);
  f.emitCrossScope('session/event', f.selected, envelope(f.selected, 2));
  assert.deepEqual(f.senders[0].events, ['UserPromptSubmit']); f.verifier.dispose();
});

test('arming captures the real next-seq cursor and rejects delayed historical replay', () => {
  const f = fixture(); f.selected.seq = 100; f.verifier.start(f.selected.id, OWNER);
  event(f, 99, 'user/message', { source: { kind: 'user' } });
  event(f, 98, 'tool/call', { callId: 'old' });
  assert.deepEqual(f.senders[0].events, []);
  event(f, 100, 'user/message', { source: { kind: 'user' } });
  assert.deepEqual(f.senders[0].events, ['UserPromptSubmit']); f.verifier.dispose();
});

test('other sessions, ordinary approval lifecycle and status do not fabricate notifications', () => {
  const f = fixture(); f.verifier.start(f.selected.id, OWNER);
  event(f, 1, 'user/message', { source: { kind: 'user' } }, f.foreign);
  event(f, 1, 'approval/asked'); event(f, 2, 'approval/decided');
  f.emit('agent/status', { agent: { id: f.selected.id, session: f.selected }, status: 'running' });
  assert.deepEqual(f.senders[0].events, []); f.verifier.dispose();
});
test('registry replacement permanently stops old binding; callbacks never auto-rebind', () => {
  const f = fixture(); f.verifier.start(f.selected.id, OWNER);
  const next = { id: f.selected.id }; f.registry.set(next.id, next);
  event(f, 1, 'user/message', { source: { kind: 'user' } }); f.emit('session/created', next);
  assert.equal(f.verifier.status().state, 'binding_lost'); assert.deepEqual(f.senders[0].events, []);
  assert.equal(f.senders[0].options.isCurrent(), false); f.verifier.dispose();
});
test('owner token, busy state, explicit stop and full listener cleanup', () => {
  const f = fixture(); f.verifier.start(f.selected.id, OWNER);
  assert.throws(() => f.verifier.poll('different_owner'), /owner_mismatch/);
  assert.throws(() => f.verifier.stop('different_owner'), /owner_mismatch/);
  assert.throws(() => f.verifier.start(f.foreign.id, OWNER), /busy/);
  assert.equal(f.verifier.stop(OWNER).state, 'stopped');
  assert.ok([...f.callbacks.values()].every(set => set.size === 0));
  assert.deepEqual(f.senders[0].events, []); f.verifier.dispose();
});
test('heartbeat loss and hard duration cannot be revived by a late poll', () => {
  const a = fixture(); a.verifier.start(a.selected.id, OWNER); a.advance(5000);
  assert.equal(a.verifier.poll(OWNER).state, 'binding_lost'); a.verifier.dispose();
  const b = fixture(); b.verifier.start(b.selected.id, OWNER); b.advance(4000); b.verifier.poll(OWNER);
  b.advance(4000); b.verifier.poll(OWNER); b.advance(2000);
  assert.equal(b.verifier.poll(OWNER).state, 'expired'); b.verifier.dispose();
});
test('new explicitly selected run has a distinct wire session and invalidates old guard', () => {
  const f = fixture(); f.verifier.start(f.selected.id, OWNER); const first = f.senders[0];
  f.verifier.stop(OWNER); f.verifier.start(f.foreign.id, OWNER);
  assert.notEqual(first.options.sessionId, f.senders[1].options.sessionId); assert.equal(first.options.isCurrent(), false);
  f.verifier.dispose(); assert.throws(() => f.verifier.start(f.selected.id, OWNER), /disposed/);
});
test('real verifier snapshots including the revision marker satisfy the strict RPC codec at every stage', () => {
  const f = fixture();
  try {
    assert.equal(parseSnapshot(f.verifier.status()).state, 'idle');
    const started = parseSnapshot(f.verifier.start(f.selected.id, OWNER));
    assert.equal(started.lastCode, 'session_contract_vthree');
    event(f, 1, 'tool/call', { callId: 'codec-call' });
    assert.equal(parseSnapshot(f.verifier.poll(OWNER)).completed, 1);
    assert.equal(parseSnapshot(f.verifier.stop(OWNER)).state, 'stopped');
    f.verifier.start(f.selected.id, OWNER); f.advance(5000);
    assert.equal(parseSnapshot(f.verifier.status()).state, 'binding_lost');
  } finally { f.verifier.dispose(); }
});

test('RPC schema contains no raw event injection or pending approval method', () => {
  assert.deepEqual(descriptors.map(value => value.method), ['start', 'poll', 'stop']);
  assert.throws(() => parseSnapshot({ state: 'running', privateText: 'never' }));
});
test('RPC start/poll/stop are owner-only and service disposal stops the verifier', async () => {
  const calls = [], hooks = [];
  const value = { state: 'idle', accepted: 0, completed: 0, dropped: 0, lastEvent: '', lastCode: '', remaining: 0 };
  const ctx = { invocation: { peer: { principal: { kind: 'owner' } } }, effect(fn) { const off = fn(); hooks.push(off); return off; },
    typert: { register(bundle) { assert.equal(bundle.package, '@abworks/dsh-studio-hook'); return () => calls.push('released'); } } };
  class Remote { constructor(scope, name) { this.ctx = scope; scope[name] = this; } }
  const dispose = mountStudioVerifier(ctx, { TypertRemoteService: Remote, Verifier: () => ({
    start: (...args) => { calls.push(args); return value; }, poll: () => value, stop: () => value, dispose: () => calls.push('disposed'),
  }) });
  assert.equal(ctx.studioHook.start('session', OWNER).state, 'idle');
  ctx.invocation.peer.principal.kind = 'guest';
  assert.throws(() => ctx.studioHook.start('session', OWNER), /owner_client_required/);
  assert.throws(() => ctx.studioHook.poll(OWNER), /owner_client_required/);
  assert.throws(() => ctx.studioHook.stop(OWNER), /owner_client_required/);
  await dispose(); assert.deepEqual(calls.slice(-2), ['released', 'disposed']);
});
