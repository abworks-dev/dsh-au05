import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../apps/bridge/server.mjs';
import { ControlGate } from '../packages/core/control-gate.mjs';
import { randomBytes } from 'node:crypto';

test('expired owner SSE closes before next lease can publish an intent', async t => {
  let time = 1000;
  const gate = new ControlGate({ now: () => time });
  const token = randomBytes(32).toString('hex');
  const server = createBridge({ token, gate });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  t.after(() => { controller.abort(); server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (path, data, id) => fetch(base + path, { method: 'POST', headers: { ...headers,
    ...(id ? { 'X-AU05-Lease': id } : {}) }, body: JSON.stringify(data) });
  const oldLease = (await (await post('/v1/lease', { owner: 'old' })).json()).id;
  const stream = await fetch(base + '/v1/events', { headers: { ...headers, 'X-AU05-Lease': oldLease }, signal: controller.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  assert.equal((await reader.read()).done, false);
  time += 5000;
  const newLease = (await (await post('/v1/lease', { owner: 'new' })).json()).id;
  await post('/v1/snapshot', { sessionId: 'new-session', revision: 1, focused: true,
    running: true, completionUnread: false, pending: null }, newLease);
  assert.equal((await post('/v1/mock/input', { eventId: 'new-event', action: 'cancel' }, newLease)).status, 200);
  const tail = await reader.read();
  assert.equal(tail.done, true, 'old stream must not receive the next owner ticket');
});
