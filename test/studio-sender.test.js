import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStudioSender } from '../packages/dsh-studio-hook/sender.js';

const SHA = '7364b7d15b0a7de22faaae950876f5f6bf6372947c3bd9c34f9dc16d67d0797c';
const tick = () => new Promise(resolve => queueMicrotask(resolve));
function fixture(overrides = {}) {
  const children = [], calls = [], records = [], timers = new Map();
  let reads = 0, timerId = 0;
  const options = {
    sessionId: 'dsh-opaque-one', isCurrent: () => true, platform: 'win32',
    env: { APPDATA: 'C:\\Users\\private\\AppData\\Roaming', SystemRoot: 'C:\\Windows',
      PATH: 'untrusted', NODE_OPTIONS: 'secret', DSH_API_KEY: 'private-key', TEMP: 'C:\\Temp' },
    fsImpl: { lstatSync() { reads++; return { isFile: () => true, isSymbolicLink: () => false }; },
      readFileSync() { reads++; return Buffer.from('mock executable'); } },
    sha256Impl: () => SHA,
    setTimeoutImpl(fn, ms) { assert.equal(ms, 3000); timers.set(++timerId, fn); return timerId; },
    clearTimeoutImpl(id) { timers.delete(id); },
    onRecord: record => records.push(record),
    spawnImpl(...args) {
      calls.push(args);
      const child = new EventEmitter();
      child.stdin = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.writes = []; child.kills = 0;
      child.stdin.end = value => {
        assert.equal(Buffer.from(value).at(-1), 10);
        child.writes.push(JSON.parse(value.trim()));
      };
      child.kill = () => { child.kills++; };
      children.push(child); return child;
    },
    ...overrides,
  };
  const sender = createStudioSender(options);
  return { sender, children, calls, records, timers, options, get reads() { return reads; } };
}

test('construction and disposal are inert; only opaque wire IDs and current guard accepted', async () => {
  const f = fixture();
  assert.equal(f.reads, 0); assert.equal(f.calls.length, 0);
  f.sender.stop(); f.sender.stop(); await tick();
  assert.equal(f.calls.length, 0); assert.equal(f.sender.enqueue('Stop'), false);
  assert.equal(f.sender.snapshot().queued, 0);
  assert.throws(() => fixture({ sessionId: 'real/private/session' }), /opaque_dsh_session_required/);
  assert.throws(() => fixture({ isCurrent: undefined }), /studio_current_guard_required/);
});

test('only explicit canonical events serialize with fixed DSH identity and sanitized process settings', async () => {
  const f = fixture();
  for (const invalid of ['idle', 'constructor', {}, '__proto__']) assert.equal(f.sender.enqueue(invalid), false);
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest'];
  for (const event of events) assert.equal(f.sender.enqueue(event), true);
  for (let i = 0; i < events.length; i++) {
    await tick(); assert.equal(f.children.length, i + 1);
    const child = f.children[i], wire = child.writes[0];
    assert.equal(wire.params.agent_id, 'dsh'); assert.equal(wire.params.hook_source, 'ulanzi-studio');
    assert.equal(wire.params.session_id, 'dsh-opaque-one'); assert.equal(wire.params.event, events[i]);
    assert.deepEqual(Object.keys(wire.params).sort(), ['agent_id', 'event', 'hook_source', 'session_id', 'state', 'type']);
    child.stdout.emit('data', Buffer.from('private raw stdout'));
    child.stderr.emit('data', Buffer.from('private raw stderr'));
    child.emit('close', 0);
  }
  await tick();
  const [cli, args, opts] = f.calls[0];
  assert.ok(cli.endsWith('Ulanzi\\UlanziDeck\\ustudio-cli\\bin\\1.0.24\\ustudio-cli.exe'));
  assert.deepEqual(args, ['--stdin']); assert.equal(opts.shell, false); assert.equal(opts.windowsHide, true);
  assert.equal(opts.env.NODE_OPTIONS, undefined); assert.equal(opts.env.DSH_API_KEY, undefined);
  assert.equal(opts.env.PATH, 'C:/Program Files (x86)/Ulanzi Studio;C:\\Windows/System32');
  assert.equal(opts.env.USTUDIO_CLI_WRAPPER_ACTIVE, '1');
  assert.equal(f.sender.snapshot().completed, 6); assert.equal(f.timers.size, 0);
  assert.ok(f.records.some(x => x.code === 'cli_returned_not_lamp_ack'));
  const diagnostics = JSON.stringify([f.records, f.sender.snapshot()]);
  for (const value of ['opaque-one', 'private', 'stdout', 'stderr', 'C:', 'exitCode']) assert.ok(!diagnostics.includes(value));
});

test('separate instances never write another session alias and stop kills only owned child', async () => {
  const a = fixture(), b = fixture({ sessionId: 'dsh-opaque-two' });
  a.sender.enqueue('PreToolUse'); b.sender.enqueue('Stop'); await tick();
  a.sender.stop();
  assert.equal(a.children[0].kills, 1); assert.equal(b.children[0].kills, 0);
  assert.equal(a.children[0].writes[0].params.session_id, 'dsh-opaque-one');
  assert.equal(b.children[0].writes[0].params.session_id, 'dsh-opaque-two'); b.sender.stop();
});

test('queue is bounded at 32 and stopping clears without synthetic Stop/idle', async () => {
  const f = fixture();
  for (let i = 0; i < 32; i++) assert.equal(f.sender.enqueue('PreToolUse'), true);
  assert.equal(f.sender.enqueue('Stop'), false); assert.equal(f.sender.snapshot().queued, 32);
  await tick(); assert.equal(f.sender.snapshot().queued, 31);
  f.sender.stop(); await tick();
  assert.equal(f.children.length, 1); assert.equal(f.children[0].writes.length, 1);
  assert.equal(f.sender.snapshot().queued, 0); assert.equal(f.children[0].kills, 1);
});

test('stale guard at enqueue, dequeue and immediately before stdin fails closed', async () => {
  for (const failAt of [1, 2, 3, 4]) {
    let checks = 0;
    const f = fixture({ isCurrent: () => ++checks !== failAt });
    f.sender.enqueue('UserPromptSubmit'); await tick();
    assert.equal(f.children.flatMap(c => c.writes).length, 0);
    assert.equal(f.sender.snapshot().stopped, true);
    if (f.children.length) assert.equal(f.children[0].kills, 1);
  }
  const f = fixture({ isCurrent() { throw new Error('private raw error'); } });
  assert.equal(f.sender.enqueue('Stop'), false); assert.equal(f.calls.length, 0);
});

test('isCurrent reentrancy cannot enqueue recursively or cancel then write stdin', async () => {
  let sender, nested;
  const f = fixture({ isCurrent() { nested = sender.enqueue('Stop'); return true; } });
  sender = f.sender; sender.enqueue('PreToolUse'); await tick();
  assert.equal(nested, false); assert.equal(f.children.length, 1); sender.stop();
  let checks = 0, cancelSender;
  const g = fixture({ isCurrent() { if (++checks === 4) cancelSender.stop(); return true; } });
  cancelSender = g.sender; cancelSender.enqueue('Stop'); await tick();
  assert.equal(g.children[0].writes.length, 0); assert.equal(g.children[0].kills, 1);
});

test('timeout and combined output ceiling cancel queue and never retry', async () => {
  for (const reason of ['child_timeout', 'output_limit']) {
    const f = fixture(); f.sender.enqueue('PreToolUse'); f.sender.enqueue('Stop'); await tick();
    if (reason === 'child_timeout') [...f.timers.values()][0]();
    else {
      f.children[0].stdout.emit('data', Buffer.alloc(16384));
      f.children[0].stderr.emit('data', Buffer.alloc(16384));
      assert.equal(f.children[0].kills, 0);
      f.children[0].stderr.emit('data', Buffer.alloc(1));
    }
    f.children[0].emit('close', 0); await tick();
    assert.equal(f.children[0].kills, 1); assert.equal(f.calls.length, 1);
    assert.equal(f.sender.snapshot().lastCode, reason); assert.equal(f.sender.snapshot().stopped, true);
    assert.equal(f.sender.snapshot().completed, 0); assert.equal(f.sender.snapshot().dropped, 2);
    assert.equal(f.timers.size, 0);
  }
});

test('unsupported platform, symlink, wrong hash and FS errors never spawn', async () => {
  const variants = [{ platform: 'linux' }, { sha256Impl: () => 'bad' },
    { fsImpl: { lstatSync: () => ({ isSymbolicLink: () => true }) } },
    { fsImpl: { lstatSync() { throw new Error('private path'); } } }];
  for (const options of variants) {
    const f = fixture(options); f.sender.enqueue('Stop'); await tick();
    assert.equal(f.calls.length, 0); assert.ok(!JSON.stringify(f.records).includes('private'));
  }
  // Default real hashing rejects mocked bytes; success cannot bypass the pinned digest accidentally.
  const f = fixture({ sha256Impl: undefined }); f.sender.enqueue('Stop'); await tick();
  assert.equal(f.calls.length, 0); assert.equal(f.sender.snapshot().lastCode, 'reviewed_cli_required');
});

test('child errors and nonzero exits expose only closed codes and no raw failures', async () => {
  for (const [event, expected] of [['error', 'spawn_error'], ['close', 'cli_failed']]) {
    const f = fixture(); f.sender.enqueue('Stop'); await tick();
    f.children[0].emit(event, event === 'error' ? new Error('private executable path') : 42);
    assert.equal(f.sender.snapshot().lastCode, expected); assert.equal(f.timers.size, 0);
    assert.equal(f.sender.snapshot().completed, 0); assert.equal(f.sender.snapshot().dropped, 1);
    assert.ok(!JSON.stringify(f.records).includes('private'));
  }
  const f = fixture(); f.sender.enqueue('Stop'); await tick();
  f.children[0].stdin.emit('error', new Error('private stdin'));
  assert.equal(f.children[0].kills, 1); assert.equal(f.sender.snapshot().lastCode, 'stdin_error');
  // A synchronous close from kill must not overwrite the cancellation result with success.
  const g = fixture(); g.sender.enqueue('Stop'); await tick();
  g.children[0].kill = () => g.children[0].emit('close', 0);
  g.sender.stop(); assert.equal(g.sender.snapshot().lastCode, 'stopped');
});

test('spawn reentrancy, thrown errors and callback reentrancy cannot resurrect cancelled work', async () => {
  let sender, child;
  const base = fixture();
  const f = fixture({ spawnImpl(...args) { child = base.options.spawnImpl(...args); sender.stop(); return child; } });
  sender = f.sender; sender.enqueue('Stop'); await tick();
  assert.equal(child.writes.length, 0); assert.equal(child.kills, 1);
  const g = fixture({ spawnImpl() { throw new Error('private executable path'); } });
  g.sender.enqueue('Stop'); await tick(); assert.equal(g.sender.snapshot().lastCode, 'spawn_error');
  assert.ok(!JSON.stringify(g.records).includes('private'));
  const h = fixture({ onRecord() { h.sender.stop(); throw new Error('private callback'); } });
  h.sender.enqueue('Stop'); h.sender.enqueue('Stop'); await tick(); h.children[0].emit('close', 0); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.sender.snapshot().queued, 0);
});
