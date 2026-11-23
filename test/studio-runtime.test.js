import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioRuntime } from '../packages/dsh-studio-hook/runtime.js';
import { mountStudioRuntime, runtimeDescriptors, parseRuntimeSnapshot, parseSnapshot } from '../packages/dsh-studio-hook/rpc.js';
import { createStudioSender } from '../packages/dsh-studio-hook/sender.js';
import { EventEmitter } from 'node:events';

const OWNER = 'runtime_owner_0123456789';
const OTHER = 'runtime_other_0123456789';
function fixture() {
  let time = 0, enabled = true;
  const ticks = new Set(), callbacks = new Map(), senders = [], registrations = [];
  const selected = { id: 'private-selected-session', seq: 100 }, foreign = { id: 'private-foreign-session', seq: 0 };
  const registry = new Map([[selected.id, selected], [foreign.id, foreign]]);
  const ctx = { sessions: { get: id => registry.get(id) }, on(name, callback, options) {
    const set = callbacks.get(name) ?? new Set(); callbacks.set(name, set); set.add(callback);
    registrations.push(options);
    return () => set.delete(callback);
  } };
  const options = { ctx, now: () => time, canRun: () => enabled, timers: {
    setInterval(fn) { ticks.add(fn); return fn; }, clearInterval(fn) { ticks.delete(fn); },
  }, Sender(options) {
    const events = []; let stopped = false;
    const sender = { options, events, get stopped() { return stopped; },
      enqueue(event) { if (stopped || !options.isCurrent()) return false; events.push(event); options.onRecord({ event, code: 'cli_returned_not_lamp_ack' }); return true; },
      stop() { stopped = true; }, snapshot: () => ({ accepted: events.length, completed: events.length, dropped: 0 }) };
    senders.push(sender); return sender;
  } };
  const runtime = createStudioRuntime(options);
  return { runtime, options, ctx, selected, foreign, registry, senders, callbacks, registrations, ticks,
    advance(ms, tick = true) { time += ms; if (tick) for (const fn of [...ticks]) fn(); },
    set enabled(value) { enabled = value; },
    emit(name, ...args) { for (const fn of [...(callbacks.get(name) ?? [])]) fn(...args); },
    event(seq, type, data = {}, target = selected, extra = {}) {
      this.emit('session/event', target, { seq, time: 0, type, data, ...extra });
    },
  };
}

test('runtime creation is inert; explicit start has opaque identity and no fake SessionStart', () => {
  const f = fixture();
  assert.equal(f.senders.length, 0); assert.equal(f.callbacks.size, 0); assert.equal(f.ticks.size, 0);
  assert.equal(parseSnapshot(f.runtime.status()).state, 'idle');
  assert.equal(f.runtime.start(f.selected.id, OWNER).state, 'running');
  assert.deepEqual(f.senders[0].events, []);
  assert.match(f.senders[0].options.sessionId, /^dsh-[a-f0-9-]{36}$/);
  assert.ok(f.registrations.every(value => value.global === true));
  const status = parseRuntimeSnapshot(f.runtime.status());
  assert.deepEqual(Object.keys(status), ['state', 'accepted', 'completed', 'dropped', 'lastEvent', 'lastCode', 'remaining']);
  for (const secret of [OWNER, f.selected.id, f.senders[0].options.sessionId]) assert.ok(!JSON.stringify(status).includes(secret));
  assert.equal(status.remaining, 0); f.runtime.dispose();
});

test('real user/tool schema projects canonical events only for exact registered selected session', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER);
  f.event(100, 'user/message', { source: { kind: 'user' } }, f.foreign);
  f.event(100, 'user/message', { source: { kind: 'user' } }, { ...f.selected });
  f.event(100, 'user/message', { source: { kind: 'user' } }, f.selected, { sessionId: f.foreign.id });
  f.event(100, 'user/message', { source: { kind: 'agent' } });
  f.event(101, 'user/message', { source: { kind: 'user' }, text: 'private user content' });
  f.event(102, 'tool/call', { callId: 'private-call', name: 'private-tool', arguments: 'private arguments' });
  f.event(103, 'tool/result', { source: { callId: 'private-call' } }); // Not the installed result schema.
  f.event(104, 'tool/result', { message: { toolCallId: 'private-call', role: 'tool', content: 'private result' } });
  f.event(105, 'turn/end', { reason: { kind: 'completed' } });
  f.event(106, 'turn/end', { reason: { kind: 'completed' } });
  assert.deepEqual(f.senders[0].events, ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
  assert.equal(parseSnapshot(f.runtime.status()).completed, 4); f.runtime.dispose();
});

test('initial cursor, duplicate seq, stale replay, result correlation and terminal guards are preserved', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER);
  f.event(99, 'user/message', { source: { kind: 'user' } });
  f.event(98, 'tool/call', { callId: 'stale' });
  f.event(100, 'tool/result', { message: { toolCallId: 'stale' } });
  f.event(101, 'tool/call', { callId: 'live' });
  f.event(101, 'tool/call', { callId: 'duplicate' });
  f.event(102, 'tool/result', { message: { toolCallId: 'live' } }, f.selected, { surfaceOp: 'replace' });
  f.event(103, 'tool/result', { message: { toolCallId: 'live' } });
  f.event(104, 'turn/end', { reason: { kind: 'aborted' } });
  f.event(105, 'tool/call', { callId: 'after-terminal' });
  assert.deepEqual(f.senders[0].events, ['PreToolUse', 'PostToolUse', 'Stop']); f.runtime.dispose();
});

test('approval lifecycle and agent status cannot fabricate approval or running hooks', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER);
  f.event(100, 'approval/asked');
  f.event(101, 'approval/decided');
  f.emit('agent/status', { agent: { id: f.selected.id, session: f.selected }, status: 'running' });
  assert.deepEqual(f.senders[0].events, []);
  assert.equal(f.runtime.syncPendingApproval, undefined); f.runtime.dispose();
});

test('continuous lease runs beyond 120 seconds while the client module keeps polling', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER);
  for (let i = 0; i < 40; i++) { f.advance(5000); assert.equal(f.runtime.poll(OWNER).state, 'running'); }
  assert.equal(f.runtime.status().remaining, 0); f.runtime.dispose();
});

test('lease expires at eight seconds, status cannot maintain it, and late heartbeat never restarts', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER);
  f.advance(7999); assert.equal(f.runtime.status().state, 'running');
  f.advance(1, false);
  assert.equal(f.runtime.poll(OWNER).state, 'binding_lost');
  assert.equal(f.runtime.status().lastCode, 'lease_lost'); assert.equal(f.ticks.size, 0);
  assert.equal(f.senders[0].stopped, true);
  f.event(100, 'user/message', { source: { kind: 'user' } });
  assert.deepEqual(f.senders[0].events, []); f.runtime.dispose();
});

test('registry object replacement is permanent binding loss, with no implicit rebind', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER);
  const replacement = { id: f.selected.id, seq: 100 }; f.registry.set(replacement.id, replacement);
  f.emit('session/created', replacement);
  f.event(100, 'user/message', { source: { kind: 'user' } }, replacement);
  assert.equal(f.runtime.status().state, 'binding_lost'); assert.equal(f.runtime.poll(OWNER).state, 'binding_lost');
  assert.equal(f.senders.length, 1); assert.deepEqual(f.senders[0].events, []); f.runtime.dispose();
});

test('session disposal stops even if registry deletion has not yet happened; no synthetic Stop', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER);
  f.emit('session/disposed', f.foreign); assert.equal(f.runtime.status().state, 'running');
  f.emit('session/disposed', f.selected);
  assert.equal(f.runtime.status().state, 'binding_lost'); assert.deepEqual(f.senders[0].events, []); f.runtime.dispose();
});

test('competing tokens cannot poll, stop, replace a run, or bypass per-context global ownership', () => {
  const f = fixture(), second = createStudioRuntime(f.options); f.runtime.start(f.selected.id, OWNER);
  assert.throws(() => f.runtime.poll(OTHER), /owner_mismatch/);
  assert.throws(() => f.runtime.stop(OTHER), /owner_mismatch/);
  assert.throws(() => f.runtime.start(f.foreign.id, OTHER), /runtime_busy/);
  assert.throws(() => second.start(f.foreign.id, OTHER), /runtime_busy/);
  assert.equal(f.runtime.status().state, 'running');
  const first = f.senders[0]; f.runtime.stop(OWNER); second.start(f.foreign.id, OTHER);
  assert.notEqual(first.options.sessionId, f.senders[1].options.sessionId);
  assert.equal(first.options.isCurrent(), false); assert.deepEqual(first.events, []);
  second.dispose(); f.runtime.dispose();
});

test('canRun interlock fails closed before start and during sender guard; never automatically resumes', () => {
  const f = fixture(); f.enabled = false;
  assert.throws(() => f.runtime.start(f.selected.id, OWNER), /mode_conflict/); assert.equal(f.senders.length, 0);
  f.enabled = true; f.runtime.start(f.selected.id, OWNER); f.enabled = false;
  assert.equal(f.senders[0].options.isCurrent(), false);
  assert.equal(f.runtime.status().state, 'stopped'); assert.equal(f.runtime.status().lastCode, 'mode_conflict');
  f.enabled = true; assert.equal(f.runtime.poll(OWNER).state, 'stopped'); assert.deepEqual(f.senders[0].events, []); f.runtime.dispose();
});

test('dispose is idempotent, clears listeners/timers, cancels sender and permanently forbids new starts', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER); f.runtime.dispose(); f.runtime.dispose();
  assert.equal(f.runtime.status().state, 'stopped'); assert.equal(f.senders[0].stopped, true);
  assert.equal(f.ticks.size, 0); assert.ok([...f.callbacks.values()].every(set => set.size === 0));
  assert.deepEqual(f.senders[0].events, []); assert.throws(() => f.runtime.start(f.selected.id, OWNER), /disposed/);
});

test('sender startup failure cleans context reservation and all partial listeners', () => {
  const f = fixture(); const failed = createStudioRuntime({ ...f.options, Sender() { throw new Error('mock_failure'); } });
  assert.throws(() => failed.start(f.selected.id, OWNER), /mock_failure/);
  assert.equal(failed.status().state, 'error'); assert.equal(failed.status().lastCode, 'runtime_error');
  f.runtime.start(f.selected.id, OWNER); f.runtime.dispose(); failed.dispose();
});

test('onClose fires once for each terminal path and callback failures cannot prevent cleanup', () => {
  for (const action of ['stop', 'lease', 'binding', 'mode', 'dispose']) {
    const f = fixture(); let closed = 0;
    const runtime = createStudioRuntime({ ...f.options, onClose() { closed++; throw new Error('ignored_cleanup_failure'); } });
    runtime.start(f.selected.id, OWNER);
    if (action === 'stop') runtime.stop(OWNER);
    if (action === 'lease') f.advance(8000);
    if (action === 'binding') f.emit('session/disposed', f.selected);
    if (action === 'mode') { f.enabled = false; runtime.status(); }
    if (action === 'dispose') runtime.dispose();
    runtime.dispose(); runtime.dispose();
    assert.equal(closed, 1, action); assert.equal(f.senders[0].stopped, true);
    assert.equal(f.ticks.size, 0); assert.ok([...f.callbacks.values()].every(set => set.size === 0));
    f.runtime.dispose();
  }
  const f = fixture(); let closed = 0;
  const failed = createStudioRuntime({ ...f.options, onClose: () => closed++, Sender() { throw new Error('startup_failure'); } });
  assert.throws(() => failed.start(f.selected.id, OWNER), /startup_failure/);
  failed.dispose(); assert.equal(closed, 1); f.runtime.dispose();
});

class Remote { constructor(ctx, name) { this.ctx = ctx; ctx[name] = this; } }
function mountFixture() {
  const f = fixture(); const releases = [];
  f.ctx.invocation = { peer: { principal: { kind: 'owner' } } };
  f.ctx.effect = fn => fn();
  f.ctx.typert = { register(bundle) { releases.push(bundle); return () => releases.push('released'); } };
  return { ...f, releases };
}

test('runtime namespace schema is separate, metadata-only and retains old snapshot compatibility', () => {
  assert.deepEqual(runtimeDescriptors.map(value => value.method), ['start', 'poll', 'stop', 'status']);
  assert.ok(runtimeDescriptors.every(value => value.namespace === 'studioRuntime' && value.service === 'studioRuntime'));
  assert.deepEqual(runtimeDescriptors[3].parameters, []);
  const codec = runtimeDescriptors[0].result.create();
  const base = { state: 'idle', accepted: 0, completed: 0, dropped: 0, lastEvent: '', lastCode: '', remaining: 0 };
  assert.deepEqual(codec.parse(base), parseSnapshot(base));
  assert.throws(() => codec.parse({ ...base, state: 'expired' }), /invalid_runtime_result/);
  assert.throws(() => codec.parse({ ...base, owner: OWNER }), /invalid_verification_result/);
  assert.throws(() => codec.parse({ ...base, remaining: 1 }), /invalid_runtime_result/);
});

test('mount with real runtime/default sender performs no session subscriptions, timers or sender I/O', async () => {
  const f = mountFixture(); let reads = 0;
  f.ctx.sessions.get = () => { reads++; throw new Error('mount_session_read'); };
  const dispose = mountStudioRuntime(f.ctx, { TypertRemoteService: Remote });
  assert.equal(reads, 0); assert.equal(f.callbacks.size, 0); assert.equal(f.senders.length, 0);
  assert.equal(f.ctx.studioRuntime.status().state, 'idle');
  assert.throws(() => mountStudioRuntime(f.ctx, { TypertRemoteService: Remote }), /already_mounted/);
  await dispose(); assert.equal(f.releases.at(-1), 'released');
});

test('all RPC methods require owner principal; valid schema has no owner secret or IDs', async () => {
  const f = mountFixture();
  const dispose = mountStudioRuntime(f.ctx, { TypertRemoteService: Remote, Runtime: options => {
    assert.equal(options.canRun(), true); return f.runtime;
  } });
  const service = f.ctx.studioRuntime;
  assert.equal(service.start(f.selected.id, OWNER).state, 'running');
  assert.throws(() => service.start(f.selected.id, 'short'), /invalid_verification_request/);
  f.ctx.invocation.peer.principal.kind = 'guest';
  for (const call of [() => service.start(f.selected.id, OWNER), () => service.poll(OWNER), () => service.stop(OWNER), () => service.status()]) assert.throws(call, /owner_client_required/);
  delete f.ctx.invocation;
  assert.throws(() => service.status(), /owner_client_required/);
  await dispose(); assert.equal(f.runtime.status().state, 'stopped');
});

test('mount failure disposes runtime and allows a later mount; canRun callback remains effective', async () => {
  const f = mountFixture(), canRun = () => false;
  f.ctx.typert.register = () => { throw new Error('mock_registration_failure'); };
  assert.throws(() => mountStudioRuntime(f.ctx, { TypertRemoteService: Remote, canRun,
    Runtime(options) { assert.equal(options.canRun(), false); return f.runtime; },
  }), /mock_registration_failure/);
  assert.throws(() => f.runtime.start(f.selected.id, OWNER), /disposed/);
  f.ctx.typert.register = () => () => {};
  const dispose = mountStudioRuntime(f.ctx, { TypertRemoteService: Remote }); await dispose();
});

test('runtime uses the canonical sender and real tool schema with fully mocked process/filesystem', async () => {
  const f = fixture(), wires = [], children = [];
  const runtime = createStudioRuntime({ ...f.options, Sender: options => createStudioSender({ ...options,
    platform: 'win32', env: { APPDATA: 'C:\\Mock', SystemRoot: 'C:\\Windows' },
    fsImpl: { lstatSync: () => ({ isSymbolicLink: () => false, isFile: () => true }), readFileSync: () => Buffer.from('mock') },
    sha256Impl: () => '7364b7d15b0a7de22faaae950876f5f6bf6372947c3bd9c34f9dc16d67d0797c',
    setTimeoutImpl: () => 1, clearTimeoutImpl() {},
    spawnImpl(_command, args) {
      assert.deepEqual(args, ['--stdin']);
      const child = new EventEmitter(); children.push(child);
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = line => { wires.push(JSON.parse(line.trim())); queueMicrotask(() => child.emit('close', 0)); };
      child.kill = () => {}; return child;
    },
  }) });
  runtime.start(f.selected.id, OWNER);
  for (const fn of [...f.callbacks.get('session/event')]) fn(f.selected, { seq: 100, time: 0, type: 'tool/call', data: { callId: 'private-call' } });
  for (const fn of [...f.callbacks.get('session/event')]) fn(f.selected, { seq: 101, time: 0, type: 'tool/result', data: { message: { toolCallId: 'private-call', role: 'tool', content: 'private' } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(wires.map(value => value.params.event), ['PreToolUse', 'PostToolUse']);
  assert.equal(runtime.status().completed, 2);
  assert.ok(!JSON.stringify(wires).includes(f.selected.id)); assert.ok(!JSON.stringify(wires).includes('private'));
  runtime.stop(OWNER); assert.equal(wires.length, 2); runtime.dispose(); f.runtime.dispose();
});

test('fresh owner public approval projection publishes once without serializing answer capabilities', () => {
  const f = fixture(); f.runtime.start(f.selected.id, OWNER); f.advance(1000);
  const projection = { sessionId: f.selected.id, key: 'approval-key', observedAt: 1000, revision: 1, answerable: true };
  assert.throws(() => f.runtime.projectApproval(OTHER, projection), /owner_mismatch/);
  assert.throws(() => f.runtime.projectApproval(OWNER, { ...projection, sessionId: 'other' }), /invalid_approval_projection/);
  assert.throws(() => f.runtime.projectApproval(OWNER, { ...projection, answer() {} }), /invalid_approval_projection/);
  assert.equal(f.runtime.projectApproval(OWNER, projection).state, 'running');
  assert.deepEqual(f.senders[0].events, ['PermissionRequest']);
  assert.throws(() => f.runtime.projectApproval(OWNER, projection), /invalid_approval_projection/);
  f.runtime.projectApproval(OWNER, { ...projection, revision: 2 });
  assert.deepEqual(f.senders[0].events, ['PermissionRequest']);
  assert.throws(() => f.runtime.projectApproval(OWNER, { ...projection, observedAt: 1001, revision: 3 }), /invalid_approval_projection/);
  f.advance(1500);
  assert.throws(() => f.runtime.projectApproval(OWNER, { ...projection, revision: 3 }), /invalid_approval_projection/);
  f.runtime.dispose();
});
