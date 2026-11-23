import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStudioInputBridge } from '../packages/dsh-studio-hook/input.js';
const target = { owner: 'owner_0123456789abcdef', sessionNonce: 'nonce_0123456789abcdef', generation: 1, epoch: 1,
  bindings: [{ control: 'k1', key: '0_0', actionid: 'action-k1' }] };
test('disposing a pending listen rejects start without a ghost listener or resurrected run', async () => {
  let socket;
  class DeferredServer extends EventEmitter {
    listen(port, host, ready) { this.ready = ready; this.boundHost = host; }
    close(callback) { queueMicrotask(() => { this.emit('close'); callback?.(); }); }
    closeAllConnections() { this.connectionsClosed = true; }
    address() { return { address: '127.0.0.1', port: 54321 }; }
  }
  const bridge = createStudioInputBridge({ createServer() { socket = new DeferredServer(); return socket; } });
  const start = bridge.start(target);
  const rejected = assert.rejects(start, /input_bridge_start_cancelled/);
  await bridge.dispose(); await rejected;
  assert.equal(socket.boundHost, '127.0.0.1');
  assert.equal(socket.connectionsClosed, true);
  assert.equal(bridge.status().listening, false);
  assert.equal(bridge.status().state, 'stopped');
  await assert.rejects(bridge.start(target), /input_bridge_unavailable/);
});
test('unsafe listener address fails closed and never grants pairing', async () => {
  class UnsafeServer extends EventEmitter {
    listen(port, host, ready) { queueMicrotask(ready); }
    close(callback) { callback?.(); }
    address() { return { address: '0.0.0.0', port: 54321 }; }
  }
  const bridge = createStudioInputBridge({ createServer: () => new UnsafeServer() });
  await assert.rejects(bridge.start(target), /unsafe_input_bridge_address/);
  assert.equal(bridge.status().listening, false);
  assert.equal(bridge.status().state, 'stopped');
  assert.throws(() => bridge.pairing(target.owner), /not_listening/);
  await bridge.dispose();
});
test('listener startup error is propagated while invalidating its owner lease', async () => {
  class ErrorServer extends EventEmitter {
    listen() { queueMicrotask(() => this.emit('error', new Error('fixture_listen_failed'))); }
    close(callback) { callback?.(); }
  }
  const bridge = createStudioInputBridge({ createServer: () => new ErrorServer() });
  await assert.rejects(bridge.start(target), /fixture_listen_failed/);
  assert.equal(bridge.status().state, 'stopped');
  assert.equal(bridge.status().listening, false);
  await bridge.dispose();
});
