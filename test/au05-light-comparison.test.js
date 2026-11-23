import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLightReadback } from '../packages/dsh-plugin/host/device-controller.js';
import { descriptors } from '../packages/dsh-plugin/host/rpc.js';

test('RPC trace comparison and requested brightness are validated and independently copied', () => {
  const parse = descriptors.find(item => item.method === 'connect').result.create().parse;
  const initial = { state: 'disconnected', generation: 0, sequence: 0, lightsEnabled: false,
    lightState: 'idle', lightResult: 'not_requested', error: null, connected: false, stopping: false };
  const entry = { at: 100, type: 'result', requestId: 1, state: 'idle', channels: [0, 0, 0, 0], result: 'mismatch', brightness: 123, readback: make() };
  const parsed = parse({ ...initial, lightTrace: [entry] });
  assert.deepEqual(parsed.lightTrace[0], entry);
  parsed.lightTrace[0].readback.comparison.observed.lights[1] = 255;
  assert.equal(entry.readback.comparison.observed.lights[1], 2);
  for (const brightness of [-1, 256, 1.5, null, '123']) assert.throws(() => parse({ ...initial, lightTrace: [{ ...entry, brightness }] }));
  for (const brightness of [0, 255]) assert.equal(parse({ ...initial, lightTrace: [{ ...entry, brightness }] }).lightTrace[0].brightness, brightness);
  entry.readback.comparison.observed.identity = 'secret';
  assert.throws(() => parse({ ...initial, lightTrace: [entry] }));
});

const make = () => ({ stage: 'post_write', attempts: 1, readsWhilePending: 1, shortReads: 0,
  outerRejected: 0, nonMatchingHeader: 0, modeRejected: 0, matched: 1, timedOut: 0, getWritesCompleted: 1,
  comparison: { expected: { mode: 2, lights: Array(20).fill(2) }, observed: { mode: 2, lights: Array(20).fill(2) } } });

test('comparison codec rejects unbounded, decorated, sparse, identity-bearing or wrong-stage data', () => {
  const valid = make(), copied = parseLightReadback(valid);
  assert.deepEqual(copied, valid);
  copied.comparison.expected.lights[1] = 255;
  assert.equal(valid.comparison.expected.lights[1], 2);
  const mutations = [v => { v.stage = 'initial'; }, v => { v.matched = 0; },
    v => { v.comparison.original = []; }, v => { v.comparison.expected.serial = 'secret'; },
    v => { v.comparison.expected.mode = 1; }, v => { v.comparison.observed.mode = 3; },
    v => { v.comparison.observed.lights[0] = 3; }, v => { v.comparison.observed.lights[1] = 256; },
    v => { v.comparison.observed.lights[1] = -1; }, v => { delete v.comparison.observed.lights[1]; },
    v => { v.comparison.observed.lights.push(1); }, v => { v.comparison.observed.lights.extra = 1; },
    v => { v.comparison.observed.lights[1] = 1.5; }, v => { v.comparison.expected = null; }];
  for (const mutate of mutations) { const value = make(); mutate(value); assert.throws(() => parseLightReadback(value), /invalid_result/); }
  const worst = make();
  for (const record of Object.values(worst.comparison)) record.lights = Array.from({ length: 20 }, (_, i) => i % 5 === 0 ? 2 : 255);
  assert.ok(Buffer.byteLength(JSON.stringify({ type: 'lights', state: 'recording', result: 'mismatch', requestId: Number.MAX_SAFE_INTEGER, readback: worst })) < 2048);
});
