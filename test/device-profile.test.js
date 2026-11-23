import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceProfile } from '../packages/dsh-plugin/core/device-profile.js';

test('device capabilities are not tied to AU05 controls or four lamps', () => {
  const profile = createDeviceProfile({ id: 'example.dial', inputs: ['dial.increment', 'talk.down', 'talk.up'],
    feedback: { channels: 1, maxValue: 1, states: { idle: [0], busy: [1] } } });
  assert.equal(profile.acceptsInput('dial.increment'), true);
  assert.equal(profile.acceptsInput('k1.down'), false);
  assert.equal(profile.validatesChannels([1]), true);
  assert.equal(profile.validatesChannels([0, 0, 0, 0]), false);
  assert.equal(profile.acceptsFeedback('approval'), false);
  assert.equal(profile.defaultChannels('unknown'), undefined);
});

test('input-only devices have no invented lamp channels', () => {
  const profile = createDeviceProfile({ id: 'example.buttons', inputs: ['button.down'],
    feedback: { channels: 0, maxValue: 0, states: { idle: [] } } });
  assert.deepEqual(profile.defaultChannels('idle'), []);
  assert.equal(profile.validatesChannels([0]), false);
});

test('capabilities are copied and frozen; callers cannot alter defaults', () => {
  const inputs = ['button.down'], states = { idle: [0] };
  const profile = createDeviceProfile({ id: 'example.buttons', inputs, feedback: { channels: 1, maxValue: 2, states } });
  inputs.push('injected.down'); states.idle[0] = 2;
  const channels = profile.defaultChannels('idle'); channels[0] = 1;
  assert.deepEqual(profile.defaultChannels('idle'), [0]);
  assert.equal(profile.acceptsInput('injected.down'), false);
  assert.equal(Object.isFrozen(profile.feedback.states.idle), true);
  assert.equal(profile.acceptsFeedback('toString'), false);
});

test('invalid or sparse capability vectors fail closed', () => {
  const base = { id: 'example.buttons', inputs: ['button.down'], feedback: { channels: 1, maxValue: 2, states: { idle: [0] } } };
  for (const value of [{ ...base, inputs: [] }, { ...base, inputs: Array(1) }, { ...base, inputs: ['x', 'x'] },
    { ...base, feedback: { ...base.feedback, states: { idle: Array(1) } } },
    { ...base, feedback: { ...base.feedback, states: { idle: [3] } } }]) {
    assert.throws(() => createDeviceProfile(value), /invalid_device_profile/);
  }
  const profile = createDeviceProfile(base);
  for (const channels of [Array(1), [NaN], [-1], [1.5], ['1'], null]) assert.equal(profile.validatesChannels(channels), false);
});
