import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioInput, STUDIO_INPUT_UUID, parseStudioInputBindings } from '../packages/dsh-studio-hook/input.js';
const owner = 'owner_0123456789abcdef', sessionNonce = 'nonce_0123456789abcdef', producerId = 'producer_0123456789abcdef';
const bindings = ['k1', 'k2', 'k3', 'knob'].map((control, index) => ({ control, actionid: `action-${control}`, key: `0_${index}` }));
function setup(options = {}) {
  let time = 100000;
  const input = createStudioInput({ now: () => time, ...options });
  const target = { owner, sessionNonce, generation: 1, epoch: 2, bindings };
  input.start(target); input.lease(STUDIO_INPUT_UUID, producerId);
  function event(name = 'k1.down', sequence = 1, extra = {}) {
    const control = name.endsWith('.pulse') ? 'knob' : name.split('.')[0], binding = bindings.find(value => value.control === control);
    return { pluginUuid: STUDIO_INPUT_UUID, producerId, owner, sessionNonce, generation: 1, epoch: 2,
      sequence, timestamp: time, event: name, actionid: binding.actionid, key: binding.key, ...extra };
  }
  return { input, target, event, advance: ms => { time += ms; } };
}
test('input validates exact bindings and rejects duplicate coordinates, control and ActionID', () => {
  assert.deepEqual(parseStudioInputBindings(bindings), bindings);
  for (const value of [[], [{ ...bindings[0], arbitrary: true }], [bindings[0], bindings[0]], [{ ...bindings[0], key: 'other' }]]) {
    assert.throws(() => parseStudioInputBindings(value), /invalid_input_bindings/);
  }
});
test('input emits every fixed down/up and knob pulse with monotonic metadata only', () => {
  const { input, event } = setup();
  let sequence = 0;
  for (const name of ['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up', 'knob.down', 'right.pulse', 'left.pulse', 'knob.up']) {
    assert.equal(input.accept(event(name, ++sequence), 'context_0123456789abcdef'), true);
  }
  const values = input.drain(owner);
  assert.equal(values.length, 10);
  assert.equal(values[0].at, values[0].timestamp);
  assert.equal(values[0].context, 'context_0123456789abcdef');
  assert.equal(values.at(-1).sequence, 10);
  assert.equal(JSON.stringify(values).includes(owner), false);
  assert.equal(input.drain(owner).length, 0);
});
test('input rejects impersonation, stale epoch/generation/nonce, SDK leakage and replay', () => {
  const { input, event } = setup();
  const bad = [{ pluginUuid: 'com.vendor.official.plugin' }, { producerId: 'other_producer_123456789' }, { owner: 'other_owner_123456789' },
    { sessionNonce: 'other_nonce_123456789' }, { generation: 2 }, { epoch: 3 }, { sequence: 0 }, { timestamp: 98000 },
    { timestamp: 100101 }, { event: 'execute' }, { key: '0_3' }, { actionid: 'other' }, { params: { secret: true } }];
  for (const extra of bad) assert.equal(input.accept(event('k1.down', 1, extra)), false);
  assert.equal(input.accept(event()), true);
  assert.equal(input.accept(event('k1.up', 1)), false);
  assert.equal(input.accept(event('k1.down', 2)), false);
  assert.equal(input.accept(event('k2.up', 2)), false);
  assert.equal(input.accept(event('k1.up', 2)), true);
});
test('producer capability cannot steal pinned identity or renew owner lease', () => {
  const { input, advance } = setup();
  assert.equal(input.lease(STUDIO_INPUT_UUID, 'another_producer_123456789'), null);
  advance(7900);
  assert.equal(input.lease(STUDIO_INPUT_UUID, producerId).remainingMs, 100);
  advance(101);
  assert.equal(input.lease(STUDIO_INPUT_UUID, producerId), null);
  assert.equal(input.status().state, 'binding_lost');
});
test('poll lease is owner-only and expired records cannot resurrect', () => {
  const { input, advance, event } = setup();
  assert.throws(() => input.renew('wrong_owner_123456789'), /owner_mismatch/);
  assert.throws(() => input.drain('wrong_owner_123456789'), /owner_mismatch/);
  input.accept(event()); advance(8000);
  assert.equal(input.renew(owner).state, 'binding_lost');
  assert.deepEqual(input.drain(owner), []);
  assert.equal(input.accept(event('k1.up', 2)), false);
});
test('mode loss, queue overflow and disposal invalidate input instead of replay', () => {
  let allowed = true;
  const { input, event } = setup({ maxQueue: 1, canRun: () => allowed });
  assert.equal(input.accept(event()), true);
  assert.equal(input.accept(event('k1.up', 2)), false);
  assert.equal(input.status().state, 'binding_lost');
  assert.deepEqual(input.drain(owner), []);
  const next = setup({ canRun: () => allowed });
  allowed = false;
  assert.equal(next.input.accept(next.event()), false);
  assert.equal(next.input.status().state, 'binding_lost');
  next.input.dispose();
  assert.throws(() => next.input.start(next.target), /input_disposed/);
});
test('queue drops old entries and preserves accept-time null/old context', () => {
  const { input, event, advance } = setup();
  input.accept(event());
  input.accept(event('k1.up', 2), 'context_0123456789abcdef');
  let values = input.drain(owner);
  assert.equal(values[0].context, null);
  assert.equal(values[1].context, 'context_0123456789abcdef');
  input.accept(event('left.pulse', 3)); advance(1201);
  values = input.drain(owner);
  assert.deepEqual(values, []);
  assert.equal(input.status().dropped, 1);
});
