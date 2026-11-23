import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { run } = require('../packages/ulanzi-dsh-input/service.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(post) {
  let socket, refresh, clears = 0;
  class FakeSocket extends EventEmitter {
    constructor() { super(); socket = this; this.terminated = 0; this.sent = []; }
    send(value) { this.sent.push(JSON.parse(value)); }
    terminate() { this.terminated++; this.emit('close'); }
  }
  const timers = {
    setInterval(fn) { refresh = fn; return { unref() {} }; },
    clearInterval() { clears++; },
  };
  const service = run({ argv: [], WebSocket: FakeSocket, pairing: {}, post, timers });
  return { service, socket, tick: () => refresh(), clears: () => clears };
}
function lease(request) {
  return { ok: true, lease: { pluginUuid: request.pluginUuid, producerId: request.producerId,
    owner: 'owned-runtime-identity', sessionNonce: 'owned-session-nonce', generation: 1, epoch: 1,
    remainingMs: 8000, bindings: [] } };
}
test('SDK connection cannot remain alive with rejected initial pairing', async () => {
  const f = fixture(async () => { throw new Error('private-detail-not-logged'); });
  try {
    f.socket.emit('open'); await settle();
    assert.equal(f.socket.terminated, 1); assert.equal(f.clears(), 1);
    assert.equal(f.socket.sent.length, 1);
    f.tick(); await settle(); assert.equal(f.socket.terminated, 1);
  } finally { f.service.close(); }
});
test('lease loss closes the service rather than silently resuming the same held-input generation', async () => {
  let failed = false, requests = 0;
  const f = fixture(async (route, request) => {
    assert.equal(route, '/lease'); requests++;
    if (failed) throw new Error('expired-pairing');
    return lease(request);
  });
  try {
    f.socket.emit('open'); await settle(); assert.equal(f.socket.terminated, 0);
    failed = true; f.tick(); await settle();
    assert.equal(f.socket.terminated, 1); assert.equal(f.clears(), 1);
    const before = requests; failed = false; f.tick(); await settle();
    assert.equal(requests, before, 'no automatic rebind/reload or stale recovery');
  } finally { f.service.close(); }
});
test('malformed lease closes safely and explicit cleanup is idempotent', async () => {
  const f = fixture(async () => ({ ok: true, lease: {} }));
  f.socket.emit('open'); await settle(); f.service.close(); f.service.close();
  assert.equal(f.socket.terminated, 1); assert.equal(f.clears(), 1);
});
