import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { UUID, ORIGIN, parsePairing, validateStartup, createStudioProducer } = require('../packages/ulanzi-dsh-input/producer.cjs');
const { run, createPost } = require('../packages/ulanzi-dsh-input/service.cjs');
const pairing = { version: 1, pluginUuid: UUID, origin: ORIGIN, endpoint: 'http://127.0.0.1:54321', leaseToken: 'L'.repeat(43), eventToken: 'E'.repeat(43) };
const bindings = ['k1', 'k2', 'k3', 'knob'].map((control, index) => ({ control, actionid: `action-${control}`, key: `0_${index}` }));
function fixture(postOverride) {
  let time = 100000, generation = 1;
  const posted = [], producerId = 'producer_0123456789abcdef';
  const lease = () => ({ pluginUuid: UUID, producerId, owner: 'owner_0123456789abcdef', sessionNonce: 'nonce_0123456789abcdef', generation, epoch: 1, bindings, remainingMs: 8000 });
  const post = async (route, value) => { posted.push({ route, value }); return postOverride ? postOverride(route, value, lease()) : route === '/lease' ? { ok: true, lease: lease() } : { ok: true }; };
  const producer = createStudioProducer({ producerId, post, now: () => time });
  const frame = (cmd = 'keydown', control = 'k1', extra = {}) => ({ cmd, uuid: `${UUID}.${control}`, actionid: `action-${control}`, key: bindings.find(value => value.control === control).key, ...extra });
  return { producer, posted, frame, advance: ms => { time += ms; }, nextGeneration: () => { generation++; } };
}
test('plugin pairing rejects remote endpoints, query/path/redirect authority, equal or absent secrets', () => {
  assert.equal(parsePairing(pairing).endpoint, pairing.endpoint);
  for (const extra of [{ endpoint: 'https://127.0.0.1:5' }, { endpoint: 'http://localhost:5' }, { endpoint: 'http://127.0.0.1:65536' },
    { endpoint: 'http://127.0.0.1:5/evil' }, { endpoint: 'http://127.0.0.1:5?token=secret' }, { origin: 'null' }, { pluginUuid: 'vendor.official.plugin' },
    { leaseToken: 'short' }, { eventToken: pairing.leaseToken }]) assert.throws(() => parsePairing({ ...pairing, ...extra }));
  assert.equal(validateStartup(['127.0.0.1', '3906', 'zh_CN']), true);
  assert.equal(validateStartup(['evil.test', '3906']), false);
  assert.equal(validateStartup(['127.0.0.1', '3907']), false);
});
test('named callbacks use exact top-level SDK shape; run/settings/held rotation never become input', async () => {
  const x = fixture(); await x.producer.refresh();
  for (const frame of [x.frame('run'), x.frame('paramfromapp', 'k1', { params: { key: '0_0' } }),
    x.frame('keydown', 'k1', { uuid: 'com.ulanzi.vendor.existing' }), x.frame('keydown', 'k1', { actionid: 'wrong' }),
    x.frame('keydown', 'k1', { key: '0_2' }), x.frame('keydown', 'k1', { code: 0 }), x.frame('dialrotate', 'knob', { rotateEvent: 'hold-right' }),
    x.frame('dialrotate', 'knob', { params: { rotateEvent: 'right' } }), x.frame('keyup')]) assert.equal(await x.producer.receive(frame), false);
  assert.equal(await x.producer.onKeyDown(x.frame()), true);
  assert.equal(await x.producer.onKeyDown(x.frame()), false);
  assert.equal(await x.producer.onKeyUp(x.frame('keyup')), true);
  assert.equal(await x.producer.onDialDown(x.frame('dialdown', 'knob')), true);
  assert.equal(await x.producer.dialRotate(x.frame('dialrotate', 'knob', { rotateEvent: 'right' })), true);
  assert.equal(await x.producer.onDialUp(x.frame('dialup', 'knob')), true);
  assert.deepEqual(x.posted.filter(value => value.route === '/events').map(value => value.value.event), ['k1.down', 'k1.up', 'knob.down', 'right.pulse', 'knob.up']);
  x.producer.close();
});
test('own main-service UUID routing still requires exact explicit ActionID and coordinate', async () => {
  const x = fixture(); await x.producer.refresh();
  assert.equal(await x.producer.receive(x.frame('keydown', 'k2', { uuid: UUID })), true);
  assert.equal(await x.producer.receive(x.frame('keyup', 'k2', { uuid: UUID })), true);
  assert.equal(await x.producer.receive(x.frame('keydown', 'k2', { uuid: UUID, actionid: 'other' })), false);
  assert.deepEqual(x.posted.filter(value => value.route === '/events').map(value => value.value.event), ['k2.down', 'k2.up']);
  x.producer.close();
});
test('producer serializes rapid down/up instead of dropping up during pending HTTP down', async () => {
  let release;
  const x = fixture(async (route, value, lease) => route === '/lease' ? { ok: true, lease } : value.sequence === 1 ? new Promise(resolve => { release = resolve; }) : { ok: true });
  await x.producer.refresh();
  const down = x.producer.onKeyDown(x.frame()), up = x.producer.onKeyUp(x.frame('keyup'));
  assert.equal(x.posted.filter(value => value.route === '/events').length, 1);
  release({ ok: true });
  assert.deepEqual(await Promise.all([down, up]), [true, true]);
  assert.deepEqual(x.posted.filter(value => value.route === '/events').map(value => value.value.sequence), [1, 2]);
  x.producer.close();
});
test('stale queue or failed submission poisons that run until explicit new generation, no replay', async () => {
  const x = fixture(async (route, value, lease) => route === '/lease' ? { ok: true, lease } : { ok: false });
  await x.producer.refresh();
  assert.equal(await x.producer.onKeyDown(x.frame()), false);
  assert.equal(await x.producer.refresh(), false);
  assert.equal(await x.producer.onKeyDown(x.frame()), false);
  x.nextGeneration(); assert.equal(await x.producer.refresh(), true);
  x.producer.close();
});
test('lease refresh does not authorize stale callbacks or reset sequence in same generation', async () => {
  const x = fixture(); await x.producer.refresh();
  await x.producer.onKeyDown(x.frame()); await x.producer.onKeyUp(x.frame('keyup'));
  await x.producer.refresh(); await x.producer.onKeyDown(x.frame());
  assert.deepEqual(x.posted.filter(value => value.route === '/events').map(value => value.value.sequence), [1, 2, 3]);
  x.advance(8000); assert.equal(await x.producer.onKeyUp(x.frame('keyup')), false);
  x.producer.close();
});
test('clear revokes the exact binding without changing a global profile', async () => {
  const x = fixture(); await x.producer.refresh();
  await x.producer.receive(x.frame('clear'));
  assert.equal(await x.producer.receive(x.frame()), false);
  await x.producer.refresh(); assert.equal(await x.producer.receive(x.frame()), false);
  x.nextGeneration(); await x.producer.refresh(); assert.equal(await x.producer.receive(x.frame()), true);
  x.producer.close();
});
test('official-format manifest has distinct explicit actions, controllers and own namespace, no global profile directives', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/ulanzi-dsh-input/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.UUID, UUID);
  assert.equal(manifest.Actions.length, 4);
  assert.deepEqual(manifest.Actions.map(value => value.UUID), ['k1', 'k2', 'k3', 'knob'].map(value => `${UUID}.${value}`));
  assert.deepEqual(manifest.Actions.at(-1).Controllers, ['Encoder']);
  for (const name of ['Profiles', 'AutoInstall', 'ApplicationsToMonitor', 'InstallToDepsApp', 'PropertyInspectorPath']) assert.equal(Object.hasOwn(manifest, name), false);
});
test('Studio service sends exact official hello and routing-only ACK; unsupported run produces no event', async () => {
  let socket;
  class FakeSocket extends EventEmitter {
    constructor(url, options) { super(); this.url = url; this.options = options; this.sent = []; socket = this; }
    send(value) { this.sent.push(JSON.parse(value)); }
    terminate() { this.terminated = true; }
  }
  const posted = [];
  const service = run({ argv: ['127.0.0.1', '3906'], pairing, WebSocket: FakeSocket,
    post: async (route, value) => {
      posted.push({ route, value });
      return route === '/lease' ? { ok: true, lease: { pluginUuid: UUID, producerId: value.producerId, owner: 'owner_0123456789abcdef', sessionNonce: 'nonce_0123456789abcdef', generation: 1, epoch: 1, bindings, remainingMs: 8000 } } : { ok: true };
    } });
  try {
    assert.equal(socket.url, 'ws://127.0.0.1:3906'); assert.equal(socket.options.followRedirects, false);
    socket.emit('open'); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(socket.sent[0], { code: 0, cmd: 'connected', uuid: UUID });
    socket.emit('message', Buffer.from(JSON.stringify({ cmd: 'run', uuid: `${UUID}.k1`, key: '0_0', actionid: 'action-k1', params: { private: 'never echo' } })), false);
    socket.emit('message', Buffer.from(JSON.stringify({ cmd: 'keydown', uuid: `${UUID}.k1`, key: '0_0', actionid: 'action-k1' })), false);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(posted.filter(value => value.route === '/events').length, 1);
    assert.equal(posted.at(-1).value.event, 'k1.down');
    assert.deepEqual(socket.sent[1], { code: 0, cmd: 'run', uuid: `${UUID}.k1`, key: '0_0', actionid: 'action-k1' });
    assert.equal(JSON.stringify(socket.sent).includes('never echo'), false);
  } finally { service.close(); }
  assert.equal(socket.terminated, true);
});
test('HTTP producer uses bounded requests with explicit fixed Origin and never cookie/query capabilities', async () => {
  let observed;
  const fakeRequest = (options, callback) => {
    observed = options;
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = body => {
      assert.ok(body.length < 4096);
      const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': 'application/json' };
      callback(res); res.emit('data', Buffer.from('{"ok":true}')); res.emit('end');
    };
    return req;
  };
  const post = createPost(pairing, fakeRequest);
  assert.deepEqual(await post('/events', { event: 'k1.down' }), { ok: true });
  assert.equal(observed.hostname, '127.0.0.1'); assert.equal(observed.timeout, 700);
  assert.equal(observed.headers.Origin, ORIGIN); assert.equal(observed.headers.Authorization, `Bearer ${pairing.eventToken}`);
  assert.equal(observed.headers.Cookie, undefined); assert.equal(observed.path, '/events');
  await assert.rejects(post('/execute', {}), /invalid_input_route/);
});
