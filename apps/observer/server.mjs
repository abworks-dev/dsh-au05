import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const INPUT_EVENTS = Object.freeze([
  'k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up',
  'knob.down', 'knob.up', 'right.pulse', 'left.pulse',
]);
export const FINISH_STATUSES = Object.freeze([
  'timeout', 'report_limit', 'cancelled', 'disconnected', 'io_error', 'no_device',
  'ambiguous_device', 'physical_receiver_unverified', 'hid_operation_failed',
  'collector_error', 'collector_protocol_error', 'collector_timeout', 'collector_exit', 'stopped',
]);
const eventSet = new Set(INPUT_EVENTS);
const finishSet = new Set(FINISH_STATUSES);

// No HID, control gate, lease, command routes, or external event publisher is loaded here.
export function createObserver({ token, origins = ['http://127.0.0.1:60890', 'dsh-app://app'] }) {
  if (typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]{64}$/u.test(token)) throw new Error('invalid_token');
  if (!Array.isArray(origins) || origins.length < 1 || origins.length > 16) throw new Error('invalid_origins');
  const originSet = new Set(origins);
  for (const origin of originSet) {
    // The official desktop renderer registers this one standard, secure, CORS-enabled scheme.
    if (origin === 'dsh-app://app') continue;
    let url;
    try { url = new URL(origin); } catch { throw new Error('invalid_origin'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.origin !== origin) throw new Error('invalid_origin');
  }
  const expected = Buffer.from(`Bearer ${token}`);
  const counts = Object.fromEntries(INPUT_EVENTS.map(event => [event, 0]));
  const clients = new Map();
  let hardware = false, finished = false, sequence = 0, total = 0, lastEvent;
  let ready = false, closing = false;
  const summary = () => ({ mode: 'read-only', hardware, readOnly: true, writes: 0,
    finished, sequence, counts: { ...counts }, ...(lastEvent ? { lastEvent } : {}) });
  const advance = () => { sequence = Math.min(Number.MAX_SAFE_INTEGER, sequence + 1); };
  const removeClient = client => { clearInterval(clients.get(client)); clients.delete(client); };
  const frame = (kind, value) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
  const publish = (kind, value) => {
    const data = frame(kind, value);
    for (const client of clients.keys()) {
      // Never queue an unbounded stream for a slow consumer.
      if (client.destroyed || !client.write(data)) { removeClient(client); client.destroy(); }
    }
  };
  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const reply = (code, error) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error }));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const address = server.address();
    if (!address || req.headers.host !== `127.0.0.1:${address.port}`) return reply(403, 'invalid_host');
    const origin = req.headers.origin;
    if (origin !== undefined && !originSet.has(origin)) return reply(403, 'invalid_origin');
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    // Both routes are bodyless. Reject at headers, without accumulating attacker-controlled bytes.
    if (req.headers['transfer-encoding'] !== undefined
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
      res.setHeader('Connection', 'close');
      res.once('finish', () => req.destroy());
      return reply(413, 'body_not_allowed');
    }
    if (req.url !== '/v1/health' && req.url !== '/v1/events') return reply(404, 'not_found');
    if (req.method === 'OPTIONS') {
      if (!origin || req.headers['access-control-request-method'] !== 'GET'
        || (req.headers['access-control-request-headers'] ?? '').toLowerCase() !== 'authorization')
        return reply(403, 'invalid_preflight');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization');
      res.writeHead(204); return res.end();
    }
    if (req.method !== 'GET') return reply(405, 'method_not_allowed');
    const provided = Buffer.from(req.headers.authorization ?? '');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply(401, 'unauthorized');
    if (req.url === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(summary()));
    }
    if (closing) return reply(503, 'observer_closed');
    if (clients.size >= 4) return reply(429, 'stream_limit');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(frame('snapshot', { type: 'snapshot', ...summary() }));
    const timer = setInterval(() => {
      if (res.destroyed || !res.write(': heartbeat\n\n')) { removeClient(res); res.destroy(); }
    }, 15000);
    timer.unref();
    clients.set(res, timer);
    res.once('close', () => removeClient(res));
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;
  // This is an in-process collector boundary, not an HTTP ingestion route. Reject extensions.
  server.ingest = record => {
    if (closing || finished || !record || Object.getPrototypeOf(record) !== Object.prototype
      || Object.keys(record).length !== 2 || !Object.hasOwn(record, 'type') || !Object.hasOwn(record, 'event')) return false;
    if (record.type === 'status' && record.event === 'ready' && !ready) {
      ready = true; hardware = true; advance();
      publish('status', { type: 'status', event: 'ready', ...summary() });
      return true;
    }
    if (record.type !== 'input' || !eventSet.has(record.event) || !hardware || total >= 10000) return false;
    total++; counts[record.event]++; lastEvent = record.event; advance();
    publish('input', { type: 'input', event: record.event, ...summary() });
    return true;
  };
  server.finish = status => {
    if (finished) return false;
    finished = true; hardware = false; advance();
    publish('status', { type: 'status', event: finishSet.has(status) ? status : 'collector_error', ...summary() });
    return true;
  };
  const close = server.close.bind(server);
  server.close = callback => {
    if (!closing) {
      closing = true;
      server.finish('stopped');
      for (const client of clients.keys()) { removeClient(client); client.end(); }
      server.emit('observer:shutdown');
    }
    return close(callback);
  };
  return server;
}
