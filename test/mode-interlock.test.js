import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeviceController } from '../packages/dsh-plugin/host/device-controller.js';
import { createModeLease as createDirectLease } from '../packages/dsh-plugin/host/mode-lease.js';
import { createModeLease as createStudioLease } from '../packages/dsh-studio-hook/mode-lease.js';
import { createStudioRuntime } from '../packages/dsh-studio-hook/runtime.js';
import { mountStudioRuntime } from '../packages/dsh-studio-hook/rpc.js';

const DIRECT = 'direct_owner_0123456789', STUDIO = 'studio_owner_0123456789', OTHER = 'another_owner_0123456789';
class Remote { constructor(ctx, name) { this.ctx = ctx; ctx[name] = this; } }
function fixture({ failSpawn = false } = {}) {
  const registry = new Map(), children = [], senders = [], listeners = new Map(), ticks = new Set();
  let time = 0, spawns = 0, registrations = 0;
  const directLease = createDirectLease('direct', registry), studioLease = createStudioLease('studio', registry);
  const voice = { cancel() {}, dispose() {} };
  const device = new DeviceController({ modeLease: directLease, platform: 'win32', now: () => time,
    windowsVoiceBridge: voice, shortcutVoiceBridge: voice,
    schedule: () => ({ unref() {} }), cancel() {},
    spawnChild(command, _args, options) {
      spawns++; assert.equal(command, 'pwsh'); assert.equal(options.shell, false);
      if (failSpawn) throw new Error('mock_spawn_failure');
      const child = new EventEmitter(); children.push(child);
      child.stdout = new EventEmitter(); child.stdin = new EventEmitter();
      child.commands = []; child.stdin.writable = true; child.stdin.destroyed = false;
      child.stdin.write = line => { child.commands.push(JSON.parse(line.trim())); return true; };
      child.stdin.end = () => { child.ended = true; };
      child.kill = () => { child.killed = true; return true; };
      return child;
    },
  });
  const selected = { id: 'private-test-session', seq: 10 };
  const ctx = { sessions: { get: id => id === selected.id ? selected : undefined },
    invocation: { peer: { principal: { kind: 'owner' } } },
    on(name, fn, options) {
      assert.equal(options.global, true);
      const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(fn);
      return () => set.delete(fn);
    },
    effect: fn => fn(), typert: { register() { registrations++; return () => {}; } },
  };
  const disposeStudio = mountStudioRuntime(ctx, { TypertRemoteService: Remote, modeLease: studioLease,
    Runtime: options => createStudioRuntime({ ...options, now: () => time,
      timers: { setInterval(fn) { ticks.add(fn); return fn; }, clearInterval(fn) { ticks.delete(fn); } },
      Sender(options) {
        let stopped = false; const events = [];
        const sender = { options, events, enqueue(event) { if (stopped || !options.isCurrent()) return false; events.push(event); return true; },
          stop() { stopped = true; }, snapshot: () => ({ accepted: events.length, completed: 0, dropped: 0 }) };
        senders.push(sender); return sender;
      },
    }),
  });
  return { registry, directLease, studioLease, device, selected, ctx, children, senders, listeners, ticks,
    studio: ctx.studioRuntime,
    get spawns() { return spawns; }, get registrations() { return registrations; },
    close(child = children.at(-1)) { child?.emit('close', 0); },
    advance(ms) { time += ms; for (const tick of [...ticks]) tick(); },
    async cleanup() { await disposeStudio(); device.dispose(); for (const child of children) child.emit('close', 0); },
    disposeStudio,
  };
}

test('independent package helpers share the same ownership protocol without releasing another token', () => {
  const registry = new Map(), direct = createDirectLease('direct', registry), studio = createStudioLease('studio', registry);
  const competingStudio = createDirectLease('studio', registry);
  assert.equal(registry.size, 0); assert.equal(direct.conflict(), false); assert.equal(studio.conflict(), false);
  assert.equal(direct.acquire(), true); assert.equal(direct.acquire(), true);
  assert.equal(studio.acquire(), false); studio.release(); assert.equal(registry.get('device').mode, 'direct');
  assert.equal(direct.conflict(), false); assert.equal(studio.conflict(), true);
  direct.release(); assert.equal(studio.acquire(), true);
  assert.equal(competingStudio.acquire(), false); competingStudio.release(); direct.release();
  assert.equal(registry.get('device').mode, 'studio'); studio.release(); assert.equal(registry.size, 0);
});

test('device construction and runtime mounting are passive and acquire no lease', async () => {
  const f = fixture();
  try {
    assert.equal(f.registry.size, 0); assert.equal(f.spawns, 0); assert.equal(f.senders.length, 0);
    assert.equal(f.registrations, 1); assert.equal(f.listeners.size, 0); assert.equal(f.ticks.size, 0);
    assert.equal(f.studio.status().state, 'idle'); assert.equal(f.device.snapshot().state, 'disconnected');
  } finally { await f.cleanup(); }
  assert.equal(f.registry.size, 0);
});

test('direct process blocks Studio before sender creation and retains lease until native close', async () => {
  const f = fixture();
  try {
    assert.equal(f.device.connect(DIRECT).state, 'connecting'); assert.equal(f.spawns, 1);
    assert.throws(() => f.studio.start(f.selected.id, STUDIO), /runtime_mode_conflict/);
    assert.equal(f.senders.length, 0); assert.equal(f.registry.get('device').mode, 'direct');
    assert.equal(f.device.stop(DIRECT).stopping, true); assert.equal(f.children[0].ended, true);
    assert.throws(() => f.studio.start(f.selected.id, STUDIO), /runtime_mode_conflict/);
    assert.equal(f.senders.length, 0); assert.equal(f.registry.get('device').mode, 'direct');
    f.close(); assert.equal(f.registry.size, 0);
    assert.equal(f.studio.start(f.selected.id, STUDIO).state, 'running'); assert.equal(f.senders.length, 1);
  } finally { await f.cleanup(); }
});

test('Studio blocks direct connect before mock spawn; explicit Studio stop releases direct mode', async () => {
  const f = fixture();
  try {
    assert.equal(f.studio.start(f.selected.id, STUDIO).state, 'running');
    const rejected = f.device.connect(DIRECT);
    assert.equal(rejected.state, 'mode_conflict'); assert.equal(rejected.error, 'mode_conflict'); assert.equal(f.spawns, 0);
    assert.equal(f.registry.get('device').mode, 'studio');
    assert.equal(f.studio.stop(STUDIO).state, 'stopped'); assert.equal(f.registry.size, 0);
    assert.equal(f.device.connect(DIRECT).state, 'connecting'); assert.equal(f.spawns, 1);
    assert.equal(f.registry.get('device').mode, 'direct');
  } finally { await f.cleanup(); }
});

test('busy starts, wrong owners and invalid start arguments cannot release Studio holder', async () => {
  const f = fixture();
  try {
    f.studio.start(f.selected.id, STUDIO); const held = f.registry.get('device');
    assert.throws(() => f.studio.start(f.selected.id, OTHER), /runtime_busy/);
    assert.throws(() => f.studio.start(f.selected.id, STUDIO), /runtime_busy/);
    assert.throws(() => f.studio.start('', OTHER), /invalid_verification_request/);
    assert.throws(() => f.studio.start(f.selected.id, 'short'), /invalid_verification_request/);
    assert.throws(() => f.studio.stop(OTHER), /owner_mismatch/);
    assert.throws(() => f.studio.poll(OTHER), /owner_mismatch/);
    assert.equal(f.registry.get('device'), held); assert.equal(f.studio.status().state, 'running');
    assert.equal(f.senders.length, 1); assert.equal(f.device.connect(DIRECT).state, 'mode_conflict'); assert.equal(f.spawns, 0);
  } finally { await f.cleanup(); }
});

test('wrong direct owner and disposing an idle Studio mount cannot release direct holder', async () => {
  const f = fixture();
  try {
    f.device.connect(DIRECT); const held = f.registry.get('device');
    f.device.stop(OTHER); assert.throws(() => f.device.connect(OTHER), /device_busy/);
    assert.equal(f.registry.get('device'), held);
    await f.disposeStudio(); assert.equal(f.registry.get('device'), held);
    f.device.dispose(); assert.equal(f.registry.get('device'), held, 'dispose cannot claim native handle closed');
    f.close(); assert.equal(f.registry.size, 0);
  } finally { await f.cleanup(); }
});

test('Studio heartbeat loss and mounting disposal release the mode lease without fabricated events', async () => {
  const f = fixture();
  try {
    f.studio.start(f.selected.id, STUDIO); f.advance(8000);
    assert.equal(f.studio.status().state, 'binding_lost'); assert.equal(f.registry.size, 0);
    assert.deepEqual(f.senders[0].events, []);
    f.studio.start(f.selected.id, STUDIO); assert.equal(f.registry.get('device').mode, 'studio');
    await f.disposeStudio(); assert.equal(f.registry.size, 0); assert.deepEqual(f.senders[1].events, []);
    assert.equal(f.device.connect(DIRECT).state, 'connecting'); assert.equal(f.spawns, 1);
  } finally { await f.cleanup(); }
});

test('failed native spawn and unavailable Studio session release only their own acquisition', async () => {
  const f = fixture({ failSpawn: true });
  try {
    assert.equal(f.device.connect(DIRECT).state, 'start_failed'); assert.equal(f.registry.size, 0);
    assert.throws(() => f.studio.start('missing-session', STUDIO), /runtime_session_unavailable/);
    assert.equal(f.registry.size, 0); assert.equal(f.senders.length, 0);
    assert.equal(f.studio.start(f.selected.id, STUDIO).state, 'running');
    assert.equal(f.device.connect(DIRECT).state, 'mode_conflict'); assert.equal(f.spawns, 1);
  } finally { await f.cleanup(); }
});
