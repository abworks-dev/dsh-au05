import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createStudioInputBridge, STUDIO_INPUT_UUID, STUDIO_INPUT_ORIGIN } from '../packages/dsh-studio-hook/input.js';
const require = createRequire(import.meta.url);
const { createStudioProducer } = require('../packages/ulanzi-dsh-input/producer.cjs');
const { createPost } = require('../packages/ulanzi-dsh-input/service.cjs');
const owner = 'owner_0123456789abcdef', sessionNonce = 'nonce_0123456789abcdef';
const contextA = 'context_A_0123456789', contextB = 'context_B_0123456789';
const bindings = ['k1', 'k2', 'k3', 'knob'].map((control, index) => ({ control, actionid: `action-${control}`, key: `0_${index}` }));
async function setup(options = {}, initialBindings = bindings) {
  let clock = 100000, tick;
  const seen = [];
  const bridge = createStudioInputBridge({ now: () => clock, onEvent: value => seen.push(value),
    timers: { setInterval(fn) { tick = fn; return 1; }, clearInterval() {} }, ...options });
  const target = { owner, sessionNonce, generation: 1, epoch: 1, bindings: initialBindings };
  await bridge.start(target);
  const pairing = bridge.pairing(owner), post = createPost(pairing);
  const producer = createStudioProducer({ producerId: 'producer_0123456789abcdef', post, now: () => clock });
  const frame = (cmd, control = 'k1', extra = {}) => ({ uuid: `${STUDIO_INPUT_UUID}.${control}`, cmd,
    actionid: bindings.find(value => value.control === control).actionid, key: bindings.find(value => value.control === control).key, ...extra });
  return { bridge, pairing, post, producer, frame, target, seen, advance: ms => { clock += ms; }, tick: () => tick() };
}
function request(pairing, { path = '/lease', method = 'POST', origin = pairing.origin, host = new URL(pairing.endpoint).host,
  authorization = `Bearer ${pairing.leaseToken}`, body = JSON.stringify({ pluginUuid: STUDIO_INPUT_UUID, producerId: 'producer_0123456789abcdef' }), contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: new URL(pairing.endpoint).port, path, method, agent: false,
      headers: { Host: host, Origin: origin, Authorization: authorization, 'Content-Type': contentType } }, res => {
      let text = ''; res.on('data', value => { text += value; }); res.on('end', () => resolve({ code: res.statusCode, body: JSON.parse(text), headers: res.headers }));
    });
    req.on('error', reject); req.end(body);
  });
}
test('capture-only pairing requires explicit observed binding confirmation and a fresh foreground context', async () => {
  const x = await setup({}, []);
  try {
    x.bridge.poll(owner, { context: contextA });
    assert.equal(await x.producer.refresh(), true);
    assert.equal(await x.producer.receive(x.frame('keydown')), false);
    assert.deepEqual(x.bridge.poll(owner, { context: contextA }).events, []);
    await x.producer.receive(x.frame('add'));
    assert.deepEqual(x.bridge.bindings(owner), [bindings[0]]);
    assert.throws(() => x.bridge.bindings('wrong_owner_123456789'), /owner_mismatch/);
    assert.throws(() => x.bridge.configure(owner, [{ ...bindings[0], actionid: 'unobserved' }]), /not_observed/);
    x.bridge.configure(owner, [bindings[0]]);
    assert.throws(() => x.bridge.configure(owner, [bindings[0]]), /confirmation_unavailable/);
    await assert.rejects(x.post('/events', { pluginUuid: STUDIO_INPUT_UUID, producerId: 'producer_0123456789abcdef',
      owner, sessionNonce, generation: 1, epoch: 1, sequence: 1, timestamp: 100000, event: 'k1.down', actionid: bindings[0].actionid, key: bindings[0].key }), /input_bridge_rejected/);
    x.advance(1);
    assert.equal(await x.producer.refresh(), true);
    assert.equal(await x.producer.receive(x.frame('keydown')), true);
    assert.equal(x.bridge.poll(owner, { context: contextB }).events[0].context, null);
    assert.equal(await x.producer.receive(x.frame('keyup')), true);
    assert.equal(x.bridge.poll(owner, { context: contextB }).events[0].context, contextB);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
test('binding discovery is authenticated, own action UUID only, bounded, and expires without lease renewal', async () => {
  const x = await setup({}, []);
  try {
    await x.producer.refresh();
    await x.producer.receive(x.frame('add', 'k1', { uuid: 'foreign.plugin.k1' }));
    await x.producer.receive(x.frame('add', 'k1', { uuid: STUDIO_INPUT_UUID }));
    assert.deepEqual(x.bridge.bindings(owner), []);
    assert.equal((await request(x.pairing, { path: '/bindings', authorization: `Bearer ${x.pairing.eventToken}` })).code, 403);
    for (const control of ['k1', 'k2', 'k3', 'knob']) await x.producer.receive(x.frame('setactive', control));
    assert.deepEqual(x.bridge.bindings(owner), bindings);
    assert.equal(JSON.stringify(x.bridge.status()).includes('action-k1'), false);
    x.advance(8001);
    assert.deepEqual(x.bridge.bindings(owner), []);
    assert.throws(() => x.bridge.configure(owner, [bindings[0]]), /not_observed/);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
test('controlled loopback: real producer HTTP path delivers every event, no hardware or Studio connection', async () => {
  const x = await setup();
  try {
    assert.equal(x.bridge.status().listening, true);
    assert.equal(x.bridge.status().producerSeen, false);
    x.bridge.poll(owner, { context: contextA });
    assert.equal(await x.producer.refresh(), true);
    assert.equal(x.bridge.status().producerSeen, true);
    for (const control of ['k1', 'k2', 'k3']) {
      const down = x.producer.receive(x.frame('keydown', control)), up = x.producer.receive(x.frame('keyup', control));
      assert.deepEqual(await Promise.all([down, up]), [true, true]);
    }
    for (const [cmd, extra] of [['dialdown', {}], ['dialrotate', { rotateEvent: 'right' }], ['dialrotate', { rotateEvent: 'left' }], ['dialup', {}]]) {
      assert.equal(await x.producer.receive(x.frame(cmd, 'knob', extra)), true);
    }
    const poll = x.bridge.poll(owner, { context: contextA });
    assert.equal(poll.generation, 1); assert.equal(poll.sequence, 10); assert.equal(poll.overflow, false);
    assert.deepEqual(poll.events.map(value => value.event), ['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up', 'knob.down', 'right.pulse', 'left.pulse', 'knob.up']);
    assert.equal(x.seen.length, 10);
    assert.equal(poll.events.every(value => value.context === contextA && value.at === value.timestamp), true);
    assert.equal(JSON.stringify(x.bridge.status()).includes(x.pairing.leaseToken), false);
    assert.equal(JSON.stringify(poll).includes(x.pairing.eventToken), false);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
test('context is captured on arrival: first null and old context cannot become a new poll context', async () => {
  const x = await setup();
  try {
    await x.producer.refresh(); await x.producer.receive(x.frame('keydown'));
    let poll = x.bridge.poll(owner, { context: contextA });
    assert.equal(poll.events[0].context, null);
    await x.producer.receive(x.frame('keyup'));
    poll = x.bridge.poll(owner, { context: contextB });
    assert.equal(poll.events[0].context, contextA);
    await x.producer.receive(x.frame('keydown'));
    poll = x.bridge.poll(owner, { context: contextB });
    assert.equal(poll.events[0].context, contextB);
    assert.equal(x.seen[0].context, null); assert.equal(x.seen[1].context, contextA);
    assert.throws(() => x.bridge.poll(owner, { context: 'short' }), /invalid_input_context/);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
test('bridge enforces exact Host/Origin/POST/content type/routes and distinct capability channels', async () => {
  const x = await setup();
  try {
    for (const options of [{ origin: 'null' }, { origin: 'http://evil.test' }, { host: 'localhost' }, { method: 'GET' },
      { authorization: '' }, { authorization: `Bearer ${x.pairing.eventToken}` }, { path: '/actions' }, { path: '/lease?token=secret' }, { contentType: 'text/plain' }]) {
      assert.equal((await request(x.pairing, options)).code, 403);
    }
    assert.equal((await request(x.pairing, { body: '{broken' })).code, 400);
    assert.equal((await request(x.pairing, { body: JSON.stringify({ pluginUuid: STUDIO_INPUT_UUID, producerId: 'producer_0123456789abcdef', action: 'approve' }) })).code, 400);
    assert.equal((await request(x.pairing, { body: 'x'.repeat(4097) })).code, 413);
    const good = await request(x.pairing);
    assert.equal(good.code, 200); assert.equal(good.headers['access-control-allow-origin'], undefined);
    assert.equal(good.headers['cache-control'], 'no-store');
    assert.throws(() => x.bridge.pairing('wrong_owner_123456789'), /owner_mismatch/);
    await assert.rejects(x.bridge.stop('wrong_owner_123456789'), /owner_mismatch/);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
test('bridge bounds request rate and does not expose capabilities through events or errors', async () => {
  const x = await setup();
  try {
    let result;
    for (let i = 0; i < 65; i++) result = await request(x.pairing);
    assert.equal(result.code, 429);
    assert.deepEqual(result.body, { ok: false });
    x.advance(1000);
    assert.equal((await request(x.pairing)).code, 200);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
test('owner heartbeat alone extends lease; expiry closes listener and does not replay queued input', async () => {
  const x = await setup();
  try {
    await x.producer.refresh(); await x.producer.receive(x.frame('keydown'));
    x.advance(7900); await x.producer.refresh();
    x.advance(101); x.tick();
    assert.equal(x.bridge.status().listening, false);
    assert.equal(x.bridge.status().state, 'binding_lost');
    assert.throws(() => x.bridge.pairing(owner), /not_listening/);
    assert.deepEqual(x.bridge.poll(owner, { context: contextA }).events, []);
    assert.equal(x.bridge.poll(owner, { context: contextA }).overflow, true);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
test('explicit stop revokes endpoint, restart rotates capabilities, stale producer cannot use them', async () => {
  const x = await setup();
  try {
    await x.producer.refresh();
    await x.bridge.stop(owner);
    assert.equal(x.bridge.status().listening, false);
    await x.bridge.start({ ...x.target, generation: 2, epoch: 2 });
    const next = x.bridge.pairing(owner);
    assert.notEqual(next.leaseToken, x.pairing.leaseToken); assert.notEqual(next.eventToken, x.pairing.eventToken);
    assert.equal((await request(next, { authorization: `Bearer ${x.pairing.leaseToken}` })).code, 403);
  } finally { x.producer.close(); await x.bridge.dispose(); }
});
