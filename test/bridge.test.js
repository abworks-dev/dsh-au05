import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createBridge } from '../apps/bridge/server.mjs';

test('loopback bridge enforces token, origin, host, lease and mock-only routes', async t => {
  const token = randomBytes(32).toString('hex');
  const server = createBridge({ token });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: `Bearer ${token}` };
  const get = headers => fetch(base + '/v1/health', { headers });
  assert.equal((await get({})).status, 401);
  assert.equal((await get({ ...auth, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await get({ ...auth, Origin: 'null' })).status, 403);
  // Node fetch rewrites forbidden Host; send a real forged header through node:http.
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = http.get(base + '/v1/health', { headers: { ...auth, Host: 'evil.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(forgedHostStatus, 403);
  const health = await get({ ...auth, Origin: 'http://127.0.0.1:3080' });
  assert.equal(health.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3080');
  assert.deepEqual(await health.json(), { protocol: 1, mode: 'mock', hardware: false, status: 'unknown' });
  const preflight = await fetch(base + '/v1/snapshot', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3080' } });
  assert.equal(preflight.status, 204);
  const post = (path, data, lease) => fetch(base + path, { method: 'POST', headers: { ...auth,
    'Content-Type': 'application/json', ...(lease ? { 'X-AU05-Lease': lease } : {}) }, body: JSON.stringify(data) });
  const leased = await post('/v1/lease', { owner: 'test' }); assert.equal(leased.status, 201);
  const lease = (await leased.json()).id;
  assert.equal((await post('/v1/lease', { owner: 'other' })).status, 409);
  assert.equal((await post('/v1/snapshot', {}, 'wrong')).status, 409);
  assert.equal((await post('/v1/snapshot', { sessionId: 'A', revision: 1, focused: true,
    running: true, completionUnread: false, pending: null }, lease)).status, 200);
  assert.equal((await post('/v1/mock/input', { eventId: '1', action: 'allow_once' }, lease)).status, 409);
  const input = await post('/v1/mock/input', { eventId: '2', action: 'cancel' }, lease);
  const { ticket } = await input.json();
  const result = await (await post('/v1/mock/consume', { ticket }, lease)).json();
  assert.equal(result.executed, false);
  assert.equal((await post('/v1/hid/write', {}, lease)).status, 404);
  const oversized = await post('/v1/lease', { owner: 'a'.repeat(9000) }); assert.equal(oversized.status, 413);
});
test('bridge rejects weak token and non-loopback allowed origin', () => {
  assert.throws(() => createBridge({ token: 'weak' }), /token_must/);
  assert.throws(() => createBridge({ token: '0'.repeat(64), origins: ['https://evil.example'] }), /loopback/);
});
