import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { DeviceController } from '../packages/dsh-plugin/host/device-controller.js';
import { createPlatformAdapters } from '../packages/dsh-plugin/host/adapters/platform.js';
import { au05DeviceAdapter, createAu05LaunchSpec } from '../packages/dsh-plugin/host/adapters/au05.js';
import { au05Profile } from '../packages/dsh-plugin/host/adapters/au05-profile.js';

const owner = 'owner_0000000000000001';
const inert = () => ({ dispose() {}, cancel() {}, stop() {} });
function services(callbacks = {}) {
  return {
    createNativeWheelBridge: inert,
    createWindowsVoiceBridge: inert,
    createShortcutVoiceBridge: inert,
    createBageshuoStateObserver(onChange) { callbacks.bageshuo = onChange; return { ...inert(), snapshot: () => ({ state: 'idle' }) }; },
    createWindowsVoiceStateObserver(onChange) { callbacks.windows = onChange; return inert(); },
  };
}

test('AU05 launch description preserves command, switches, script and restricted environment', () => {
  const source = { SystemRoot: 'system', PATH: 'path', TEMP: 'temp', APPDATA: 'app', PSModulePath: 'modules', SECRET: 'never', TMP: 7 };
  const spec = createAu05LaunchSpec(source);
  assert.equal(spec.command, 'pwsh');
  assert.deepEqual(spec.args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../packages/dsh-plugin/native/au05.ps1', import.meta.url)), '-Mode', 'Connect', '-EnableLights']);
  assert.deepEqual(spec.options, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: { SystemRoot: 'system', TEMP: 'temp', PATH: 'path', APPDATA: 'app', PSModulePath: 'modules' } });
  spec.args.push('mutated'); spec.options.env.PATH = 'mutated'; spec.options.stdio[2] = 'pipe';
  const next = createAu05LaunchSpec(source);
  assert.equal(next.options.env.PATH, 'path'); assert.equal(next.options.stdio[2], 'ignore'); assert.equal(next.args.length, 8);
});

test('AU05 profile preserves accepted events, task lamp defaults and validation', () => {
  assert.equal(au05DeviceAdapter.profile, au05Profile);
  for (const event of ['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up', 'knob.down', 'knob.up', 'right.pulse', 'left.pulse']) assert.equal(au05Profile.acceptsInput(event), true);
  assert.equal(au05Profile.acceptsInput('k4.down'), false);
  for (const [state, channels] of Object.entries({ idle: [0, 0, 0, 0], running: [0, 0, 0, 1], approval: [0, 2, 0, 0], attention: [0, 0, 2, 0], recording: [2, 0, 0, 0] })) {
    assert.equal(au05Profile.acceptsFeedback(state), true); assert.deepEqual(au05Profile.defaultChannels(state), channels);
  }
  assert.equal(au05Profile.acceptsFeedback('unknown'), false);
  for (const value of [null, [], [0, 0, 0], [0, 0, 0, 3], [0, 0, 0, 0.5]]) assert.equal(au05Profile.validatesChannels(value), false);
  assert.equal(au05Profile.validatesChannels([0, 1, 2, 0]), true);
});

test('platform factory only constructs idle bridges and preserves dependency forwarding', () => {
  const now = () => 123, schedule = () => { throw new Error('must not schedule'); }, cancel = () => {};
  const monotonicNow = () => 456;
  const factory = createPlatformAdapters({ platform: 'linux', now, monotonicNow, schedule, cancel });
  for (const name of ['createNativeWheelBridge', 'createWindowsVoiceBridge', 'createShortcutVoiceBridge']) {
    const bridge = factory[name]();
    assert.equal(bridge.platform, 'linux'); assert.equal(bridge.now, now); assert.ok(!bridge.child);
    bridge.dispose();
  }
  for (const name of ['createBageshuoStateObserver', 'createWindowsVoiceStateObserver']) {
    const onChange = () => {}, observer = factory[name](onChange);
    assert.equal(observer.platform, 'linux');
    assert.equal(observer.now, name === 'createBageshuoStateObserver' ? monotonicNow : now);
    if (name === 'createBageshuoStateObserver') assert.equal(observer.wallNow, now);
    assert.equal(observer.schedule, schedule);
    assert.equal(observer.cancelTimer, cancel); assert.equal(observer.onChange, onChange); assert.ok(!observer.child);
    observer.dispose();
  }
});

test('default Bageshuo adapter never inherits the controller wall clock for trust deadlines', () => {
  const wall = () => 9_000_000_000_000;
  const observer = createPlatformAdapters({ now: wall }).createBageshuoStateObserver();
  assert.notEqual(observer.now, wall); assert.equal(observer.wallNow, wall);
  assert.ok(observer.now() < wall());
  observer.dispose();
});

test('legacy explicit bridge injections bypass platform construction', () => {
  const bridges = { nativeWheelBridge: inert(), windowsVoiceBridge: inert(), shortcutVoiceBridge: inert(), bageshuoStateObserver: inert(), windowsVoiceStateObserver: inert() };
  const controller = new DeviceController({ ...bridges, platformServices: new Proxy({}, { get() { throw new Error('must not construct'); } }) });
  assert.equal(controller.nativeWheelBridge, bridges.nativeWheelBridge); assert.equal(controller.windowsVoiceBridge, bridges.windowsVoiceBridge);
  assert.equal(controller.shortcutVoiceBridge, bridges.shortcutVoiceBridge); assert.equal(controller.bageshuoObserver, bridges.bageshuoStateObserver);
  assert.equal(controller.windowsVoiceObserver, bridges.windowsVoiceStateObserver); controller.dispose();
});

test('injected adapter is inert until explicit connect; launch errors retain cleanup', () => {
  let launches = 0, releases = 0, spawned = 0;
  const spec = { command: 'fake', args: ['connect'], options: { shell: false } };
  const controller = new DeviceController({ platform: 'win32', platformServices: services(),
    deviceAdapter: { profile: au05Profile, createLaunchSpec() { launches++; return spec; } },
    modeLease: { acquire: () => true, release() { releases++; } },
    spawnChild(...args) { spawned++; assert.deepEqual(args, [spec.command, spec.args, spec.options]); throw new Error('fake failure'); },
  });
  assert.equal(launches, 0); assert.equal(spawned, 0);
  assert.equal(controller.connect(owner, { lights: false }).state, 'start_failed');
  assert.equal(launches, 1); assert.equal(spawned, 1); assert.equal(releases, 1); assert.equal(controller.owner, null);
  controller.dispose();
});

test('launch preparation failure releases the acquired lease and owner', () => {
  let releases = 0;
  const controller = new DeviceController({ platform: 'win32', platformServices: services(),
    deviceAdapter: { profile: au05Profile, createLaunchSpec() { throw new Error('prepare failed'); } },
    modeLease: { acquire: () => true, release() { releases++; } },
    spawnChild() { throw new Error('must not spawn'); },
  });
  assert.equal(controller.connect(owner).state, 'start_failed');
  assert.equal(controller.owner, null); assert.equal(releases, 1);
  controller.dispose();
});

test('unsupported platform never builds launch or acquires device lease', () => {
  const controller = new DeviceController({ platform: 'darwin', platformServices: services(),
    deviceAdapter: { profile: au05Profile, createLaunchSpec() { throw new Error('must not launch'); } },
    modeLease: { acquire() { throw new Error('must not acquire'); }, release() {} },
  });
  assert.equal(controller.connect(owner).state, 'unsupported_platform'); controller.dispose();
});

test('observer callbacks remain coordinated by existing enabled flags', () => {
  const callbacks = {}, controller = new DeviceController({ platformServices: services(callbacks) });
  let changes = 0, bageshuo = 0, windows = 0;
  controller.changed = () => { changes++; }; controller.applyBageshuoState = () => { bageshuo++; }; controller.applyWindowsVoiceState = () => { windows++; };
  callbacks.bageshuo(); callbacks.windows(); assert.equal(changes, 2); assert.equal(bageshuo, 0); assert.equal(windows, 0);
  controller.bageshuoCrossAppEnabled = true; controller.windowsVoiceStateEnabled = true;
  callbacks.bageshuo(); callbacks.windows(); assert.equal(bageshuo, 1); assert.equal(windows, 1);
  controller.dispose();
});
