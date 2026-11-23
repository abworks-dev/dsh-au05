import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { run, createPost, writeStartupFailure } = require('../packages/ulanzi-dsh-input/service.cjs');
const { UUID, ORIGIN, createStudioProducer } = require('../packages/ulanzi-dsh-input/producer.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));
const secret = 'PRIVATE_fixture_error_payload_never_emit';
const pairing = {
  version: 1, pluginUuid: UUID, origin: ORIGIN, endpoint: 'http://127.0.0.1:54321',
  leaseToken: 'L'.repeat(43), eventToken: 'E'.repeat(43),
};
const bindings = [{ control: 'k1', actionid: 'action-k1', key: '0_0' },
  { control: 'knob', actionid: 'action-knob', key: '0_3' }];
const producerCodes = [
  'lease_request_timeout', 'lease_http_rejected', 'lease_response_limit', 'lease_invalid_response',
  'lease_transport_error', 'lease_invalid', 'lease_expired', 'identity_failed', 'confirmation_with_inflight',
  'event_request_timeout', 'event_http_rejected', 'event_response_limit', 'event_invalid_response',
  'event_transport_error', 'event_invalid_reply', 'event_stale_or_changed', 'event_queue_full',
];
const codes = new Set([...producerCodes, 'sdk_connected', 'sdk_error', 'sdk_closed',
  'signal_sigint', 'signal_sigterm', 'explicit_close', 'test_complete', 'startup_failed']);
function lease(request, extra = {}) {
  return { ok: true, lease: {
    pluginUuid: UUID, producerId: request.producerId, owner: 'owner_PRIVATE_0123456789abcdef',
    sessionNonce: 'nonce_PRIVATE_0123456789abcdef', generation: 1, epoch: 1,
    remainingMs: 8000, bindings, ...extra,
  } };
}
function frame(cmd = 'keydown', control = 'k1') {
  const binding = bindings.find(value => value.control === control);
  return { cmd, uuid: `${UUID}.${control}`, actionid: binding.actionid, key: binding.key,
    params: { private: secret }, payload: secret };
}
function checkRecords(records) {
  assert.ok(records.length > 0);
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ['code', 'elapsedMs', 'event', 'type']);
    assert.equal(record.type, 'studio_input_diagnostic');
    assert.ok(['sdk_connected', 'producer_failure', 'service_closed'].includes(record.event));
    assert.ok(codes.has(record.code), `unexpected diagnostic code ${record.code}`);
    assert.ok(Number.isSafeInteger(record.elapsedMs) && record.elapsedMs >= 0);
  }
  const json = JSON.stringify(records);
  for (const value of [secret, pairing.leaseToken, pairing.eventToken, pairing.endpoint,
    'owner_PRIVATE_0123456789abcdef', 'nonce_PRIVATE_0123456789abcdef', 'action-k1']) {
    assert.equal(json.includes(value), false, 'diagnostics contain only fixed codes and elapsed time');
  }
}
function fixture({ post = async (route, value) => route === '/lease' ? lease(value) : { ok: true },
  onDiagnostic, defaultSink = false, timerId = 0 } = {}) {
  let socket, time = 100000, refresh;
  const records = [], requests = [], cleared = [];
  const baseline = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]));
  class FakeSocket extends EventEmitter {
    constructor() { super(); socket = this; this.terminated = 0; this.sent = []; }
    send(value) { this.sent.push(JSON.parse(value)); }
    terminate() { this.terminated++; this.emit('close', 4999, Buffer.from(secret)); }
  }
  const options = {
    argv: [], WebSocket: FakeSocket, pairing,
    post: async (route, value) => { requests.push({ route, value }); return post(route, value); },
    now: () => time,
    timers: {
      setInterval(fn, ms) { assert.equal(ms, 1000); refresh = fn; return timerId; },
      clearInterval(id) { cleared.push(id); },
    },
  };
  if (!defaultSink) options.onDiagnostic = onDiagnostic || (record => records.push(record));
  const service = run(options);
  return {
    service, socket, records, requests, cleared,
    advance(ms) { time += ms; },
    async open() { socket.emit('open'); await settle(); },
    async tick() { assert.equal(typeof refresh, 'function'); refresh(); await settle(); },
    async send(data) { socket.emit('message', Buffer.from(JSON.stringify(data)), false); await settle(); },
    signal(name) {
      const added = process.listeners(name).filter(listener => !baseline.get(name).includes(listener));
      assert.equal(added.length, 1, 'one owned signal handler');
      added[0]();
    },
    assertCleanup() {
      assert.equal(socket.terminated, 1);
      assert.deepEqual(cleared, [timerId]);
      for (const [signal, listeners] of baseline) assert.deepEqual(process.listeners(signal), listeners);
    },
  };
}
function closed(records) { return records.filter(record => record.event === 'service_closed'); }
function failures(records) { return records.filter(record => record.event === 'producer_failure').map(record => record.code); }
function captureStdout(body) {
  const original = fs.writeSync;
  let output = '';
  const descriptors = [];
  fs.writeSync = function (fd, chunk) {
    descriptors.push(fd);
    output += String(chunk);
    return Buffer.byteLength(String(chunk));
  };
  try {
    body();
    assert.ok(descriptors.every(fd => fd === 1), 'diagnostics write only to stdout');
    return output;
  } finally { fs.writeSync = original; }
}

// All transport behavior below is an in-memory EventEmitter; no socket, filesystem,
// SDK installation, pairing file, GUI, HID, or audio resource is opened.
function mockRequest(outcome) {
  return (_options, respond) => {
    const req = new EventEmitter();
    req.destroy = error => { if (error) req.emit('error', error); };
    req.end = () => {
      if (outcome === 'timeout') { req.emit('timeout'); return; }
      if (outcome === 'transport') { req.emit('error', new Error(secret)); return; }
      const res = new EventEmitter();
      res.statusCode = outcome === 'rejected' ? 403 : 200;
      res.headers = { 'content-type': 'application/json' };
      res.resume = () => {};
      respond(res);
      if (outcome === 'rejected') return;
      res.emit('data', Buffer.from(outcome === 'limit' ? 'x'.repeat(4097) : secret));
      if (outcome !== 'limit') res.emit('end');
    };
    return req;
  };
}
const transportCases = [
  ['timeout', 'request_timeout'], ['rejected', 'http_rejected'], ['limit', 'response_limit'],
  ['invalid', 'invalid_response'], ['transport', 'transport_error'],
];
for (const [outcome, suffix] of transportCases) {
  test(`initial lease ${outcome} has fixed diagnostics and closes once`, async () => {
    const f = fixture({ post: createPost(pairing, mockRequest(outcome)) });
    try {
      await f.open();
      assert.deepEqual(failures(f.records), [`lease_${suffix}`]);
      assert.deepEqual(closed(f.records).map(record => record.code), [`lease_${suffix}`]);
      assert.equal(f.records[0].event, 'sdk_connected');
      f.assertCleanup();
      const requestCount = f.requests.length;
      await f.tick(); f.service.close('test_complete');
      assert.equal(f.requests.length, requestCount, 'no retry/rebind after failure');
      assert.equal(closed(f.records).length, 1);
      checkRecords(f.records);
    } finally { f.service.close(); }
  });
}

test('malformed initial lease is lease_invalid without exposing its payload', async () => {
  const f = fixture({ post: async () => ({ ok: true, lease: { owner: secret, payload: secret } }) });
  try {
    await f.open();
    assert.deepEqual(failures(f.records), ['lease_invalid']);
    assert.equal(closed(f.records)[0].code, 'lease_invalid');
    f.assertCleanup(); checkRecords(f.records);
  } finally { f.service.close(); }
});

test('post-live lease loss closes with its classified failure and never resumes', async () => {
  let lost = false;
  const f = fixture({ post: async (route, value) => {
    assert.equal(route, '/lease');
    if (lost) throw new Error(secret);
    return lease(value);
  } });
  try {
    await f.open(); assert.equal(f.socket.terminated, 0);
    f.advance(23); lost = true; await f.tick();
    assert.deepEqual(failures(f.records), ['lease_transport_error']);
    assert.equal(closed(f.records)[0].code, 'lease_transport_error');
    assert.equal(closed(f.records)[0].elapsedMs, 23);
    const count = f.requests.length; lost = false; await f.tick();
    assert.equal(f.requests.length, count);
    f.assertCleanup(); checkRecords(f.records);
  } finally { f.service.close(); }
});

for (const [outcome, suffix] of transportCases) {
  test(`rejected event ${outcome} poisons confirmed binding; refresh retains first failure`, async () => {
    const eventPost = createPost(pairing, mockRequest(outcome));
    const f = fixture({ post: async (route, value) => route === '/lease' ? lease(value) : eventPost(route, value) });
    try {
      await f.open(); await f.send(frame());
      assert.equal(f.requests.filter(request => request.route === '/events').length, 1);
      assert.equal(failures(f.records)[0], `event_${suffix}`);
      assert.equal(closed(f.records).length, 0, 'event poison closes at the existing refresh boundary');
      await f.tick();
      assert.equal(closed(f.records)[0].code, `event_${suffix}`, 'identity_failed must not replace first code');
      const count = f.requests.length; await f.send(frame('keyup')); await f.tick();
      assert.equal(f.requests.length, count);
      f.assertCleanup(); checkRecords(f.records);
    } finally { f.service.close(); }
  });
}

test('negative event reply is fixed event_invalid_reply, not arbitrary bridge payload', async () => {
  const f = fixture({ post: async (route, value) => route === '/lease' ? lease(value)
    : { ok: false, code: secret, error: secret, payload: secret } });
  try {
    await f.open(); await f.send(frame()); await f.tick();
    assert.equal(failures(f.records)[0], 'event_invalid_reply');
    assert.equal(closed(f.records)[0].code, 'event_invalid_reply');
    f.assertCleanup(); checkRecords(f.records);
  } finally { f.service.close(); }
});

for (const [kind, expected] of [['close', 'sdk_closed'], ['error', 'sdk_error'],
  ['SIGINT', 'signal_sigint'], ['SIGTERM', 'signal_sigterm']]) {
  test(`${kind} emits one sanitized terminal record and cleans all owned resources`, async () => {
    const f = fixture();
    try {
      await f.open(); f.advance(12);
      if (kind === 'close') f.socket.emit('close', 4321, Buffer.from(secret));
      else if (kind === 'error') f.socket.emit('error', Object.assign(new Error(secret), { code: secret }));
      else f.signal(kind);
      f.service.close(secret); f.service.close('test_complete');
      assert.deepEqual(closed(f.records).map(record => record.code), [expected]);
      assert.equal(closed(f.records)[0].elapsedMs, 12);
      assert.deepEqual(failures(f.records), []);
      f.assertCleanup(); checkRecords(f.records);
    } finally { f.service.close(); }
  });
}

for (const reason of ['explicit_close', 'test_complete', 'sdk_error', 'lease_request_timeout', 'signal_sigint', secret, undefined, { reason: secret }]) {
  test(`explicit deadline close sanitizes ${typeof reason === 'string' && reason !== secret ? reason : typeof reason}`, async () => {
    const f = fixture();
    try {
      await f.open(); f.advance(15000); f.service.close(reason); f.service.close('test_complete');
      assert.equal(closed(f.records).length, 1);
      assert.equal(closed(f.records)[0].code, reason === 'test_complete' ? 'test_complete' : 'explicit_close');
      assert.equal(closed(f.records)[0].elapsedMs, 15000);
      assert.deepEqual(failures(f.records), []);
      f.assertCleanup(); checkRecords(f.records);
    } finally { f.service.close(); }
  });
}

test('fractional and backwards clocks never emit negative or fractional elapsed time', async () => {
  const f = fixture();
  try {
    f.advance(-50.25); await f.open(); f.advance(0.75); f.service.close('test_complete');
    for (const record of f.records) assert.equal(record.elapsedMs, 0);
    checkRecords(f.records); f.assertCleanup();
  } finally { f.service.close(); }
  const g = fixture();
  try {
    await g.open(); g.advance(12.75); g.service.close('test_complete');
    assert.equal(closed(g.records)[0].elapsedMs, 12);
    checkRecords(g.records); g.assertCleanup();
  } finally { g.service.close(); }
});

test('throwing diagnostic sink cannot prevent producer failure or service cleanup', async () => {
  const observed = [];
  const f = fixture({ post: async () => { throw new Error('input_request_timeout'); },
    onDiagnostic(record) { observed.push(record); throw new Error(secret); } });
  try {
    await f.open(); f.service.close('test_complete');
    assert.deepEqual(failures(observed), ['lease_request_timeout']);
    assert.deepEqual(closed(observed).map(record => record.code), ['lease_request_timeout']);
    f.assertCleanup(); checkRecords(observed);
  } finally { f.service.close(); }
});

test('default diagnostic sink writes parseable JSON only, without SDK or bridge secrets', () => {
  let f;
  // Intercept the fixed stdout descriptor synchronously, restoring the shared
  // filesystem module before any asynchronous test-runner work resumes.
  const output = captureStdout(() => {
    f = fixture({ defaultSink: true });
    try {
      f.socket.emit('open');
      f.socket.emit('error', Object.assign(new Error(secret), { code: secret, payload: secret }));
    } finally { f.service.close(); }
  });
  const records = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
  checkRecords(records);
  assert.deepEqual(records.map(record => record.event), ['sdk_connected', 'service_closed']);
  assert.equal(closed(records)[0].code, 'sdk_error');
  f.assertCleanup();
});

test('broken stdout cannot escape diagnostics or prevent SDK service cleanup', async () => {
  const original = fs.writeSync, attempts = [];
  let f;
  fs.writeSync = function (fd, chunk) {
    attempts.push({ fd, record: JSON.parse(String(chunk)) });
    throw Object.assign(new Error(secret), { code: 'EPIPE' });
  };
  try {
    f = fixture({ defaultSink: true });
    assert.doesNotThrow(() => f.socket.emit('open'));
    assert.doesNotThrow(() => f.socket.emit('error', new Error(secret)));
    assert.doesNotThrow(() => f.service.close('test_complete'));
    assert.doesNotThrow(() => writeStartupFailure());
  } finally {
    try { f?.service.close(); } finally { fs.writeSync = original; }
  }
  await settle();
  f.assertCleanup();
  assert.deepEqual(attempts.map(attempt => attempt.fd), [1, 1, 1]);
  assert.deepEqual(attempts.map(attempt => attempt.record.code), ['sdk_connected', 'sdk_error', 'startup_failed']);
  checkRecords(attempts.map(attempt => attempt.record));
});

test('startup failure writer emits one fixed, zero-elapsed JSON record', () => {
  assert.equal(typeof writeStartupFailure, 'function');
  const output = captureStdout(() => writeStartupFailure());
  const records = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.deepEqual(records, [{ type: 'studio_input_diagnostic', event: 'service_closed', code: 'startup_failed', elapsedMs: 0 }]);
  checkRecords(records);
});

for (const message of [secret, 'input_request_timeout' + secret, 'lease_request_timeout', 'input_bridge_rejected' + secret]) {
  test(`producer maps non-whitelisted error ${message === secret ? 'payload' : 'lookalike'} to transport_error`, async () => {
    const observed = [];
    const producer = createStudioProducer({ producerId: 'producer_0123456789abcdef',
      post: async () => { throw new Error(message); }, now: () => 100000,
      onDiagnostic(code) { observed.push(code); throw new Error(secret); } });
    try {
      assert.equal(await producer.refresh(), false);
      assert.deepEqual(observed, ['lease_transport_error']);
    } finally { producer.close(); }
  });
}

test('producer callback receives fixed failure codes and cannot override event poisoning', async () => {
  const observed = [], producerId = 'producer_0123456789abcdef';
  const producer = createStudioProducer({ producerId, now: () => 100000,
    post: async (route, value) => route === '/lease' ? lease(value) : { ok: false, error: secret },
    onDiagnostic(code) { observed.push(code); throw new Error(secret); } });
  try {
    assert.equal(await producer.refresh(), true);
    assert.equal(await producer.receive(frame()), false);
    assert.equal(await producer.refresh(), false);
    assert.deepEqual(observed, ['event_invalid_reply', 'identity_failed']);
    assert.equal(await producer.receive(frame('keyup')), false);
  } finally { producer.close(); }
});

test('transit-expired lease is classified without changing lease deadline policy', async () => {
  let now = 100000;
  const observed = [];
  const producer = createStudioProducer({ producerId: 'producer_0123456789abcdef', now: () => now,
    post: async (_route, value) => { now += 8000; return lease(value); },
    onDiagnostic: code => observed.push(code) });
  try {
    assert.equal(await producer.refresh(), false);
    assert.deepEqual(observed, ['lease_expired']);
  } finally { producer.close(); }
});
