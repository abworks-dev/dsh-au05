import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { k1LampCapability } from '../packages/dsh-plugin/host/k1-lamp.js';
import { DeviceController } from '../packages/dsh-plugin/host/device-controller.js';
import { createModeLease } from '../packages/dsh-plugin/host/mode-lease.js';

const owner = 'owner_0000000000000001';
function fixture() {
  const commands = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough();
  child.stdin.on('data', chunk => commands.push(JSON.parse(chunk.toString())));
  child.kill = () => { child.emit('close', 0); return true; };
  const device = new DeviceController({ platform: 'win32',
    modeLease: createModeLease('direct', new Map()), spawnChild: () => child });
  const emit = item => child.stdout.write(JSON.stringify(item) + '\n');
  device.connect(owner); emit({ type: 'status', state: 'ready' });
  return { device, commands, emit, cleanup() { device.dispose(); child.emit('close', 0); } };
}

test('K1 metadata separates direct configuration capability from unverified physical appearance', () => {
  const capability = k1LampCapability();
  assert.equal(capability.configurationSupported, true);
  assert.equal(capability.physicalVerified, false);
  assert.equal(capability.requiresOptIn, true);
  assert.equal(capability.status, 'configuration_only');
  capability.physicalVerified = true;
  assert.equal(k1LampCapability('direct').physicalVerified, false);
});

test('known Studio task hooks do not expose K1 control', () => {
  const capability = k1LampCapability('studio');
  assert.equal(capability.configurationSupported, false);
  assert.equal(capability.physicalVerified, false);
  assert.equal(capability.path, null);
  assert.equal(capability.reason, 'studio_task_hooks_have_no_k1_control');
  assert.throws(() => k1LampCapability('other'), /invalid_k1_mode/);
});

test('snapshot unavailable is a lamp failure, not a disconnected input controller', () => {
  const f = fixture();
  try {
    f.emit({ type: 'lights', state: 'idle', requestId: f.commands.at(-1).requestId,
      result: 'failed', reason: 'snapshot_unavailable' });
    const snapshot = f.device.snapshot();
    assert.equal(snapshot.connected, true);
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.lightResult, 'failed');
    assert.equal(snapshot.lightError, 'snapshot_unavailable');
    f.device.poll(owner, { light: 'recording' });
    assert.equal(f.device.snapshot().lightError, null);
    f.emit({ type: 'lights', state: 'recording', requestId: f.commands.at(-1).requestId, result: 'verified' });
    assert.equal(f.device.snapshot().lightError, null);
    assert.equal(f.device.snapshot().k1Lamp.physicalVerified, false);
  } finally { f.cleanup(); }
});

test('old snapshot failure cannot overwrite the current request result', () => {
  const f = fixture();
  try {
    const old = f.commands.at(-1).requestId;
    f.device.poll(owner, { light: 'approval' });
    f.emit({ type: 'lights', state: 'idle', requestId: old, result: 'failed', reason: 'snapshot_unavailable' });
    assert.equal(f.device.snapshot().lightError, null);
    assert.equal(f.device.snapshot().lightResult, 'not_requested');
  } finally { f.cleanup(); }
});

for (const [result, reason] of [['verified', 'snapshot_unavailable'], ['failed', 'arbitrary'], ['failed', null]]) {
  test(`closed lamp failure vocabulary rejects ${result}/${reason}`, () => {
    const f = fixture();
    try {
      f.emit({ type: 'lights', state: 'idle', requestId: f.commands.at(-1).requestId, result, reason });
      assert.equal(f.device.snapshot().state, 'protocol_error');
    } finally { f.cleanup(); }
  });
}
