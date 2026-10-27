import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ControlGate, GateError } from '../../packages/core/control-gate.mjs';

export function createBridge({ token, origins = ['http://127.0.0.1:3080'], gate = new ControlGate() }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('token_must_be_32_random_bytes_hex');
  const originSet = new Set(origins);
  for (const origin of originSet) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.origin !== origin) throw new Error('origin_must_be_exact_loopback_origin');
  }
  const clients = new Map();
  let serial = 0;
  const closeStreams = () => { for (const client of clients.keys()) client.end(); clients.clear(); };
  const publish = event => {
    const data = `id: ${++serial}\nevent: input\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [client, lease] of clients) {
      try { gate.requireLease(lease); }
      catch { client.end(); clients.delete(client); continue; }
      if (!client.write(data)) client.destroy();
    }
  };
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const address = server.address();
    if (req.headers.host !== `127.0.0.1:${address.port}`) return reply(403, { error: 'invalid_host' });
    const origin = req.headers.origin;
    if (origin && !originSet.has(origin)) return reply(403, { error: 'invalid_origin' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-AU05-Lease');
      res.writeHead(204); return res.end();
    }
    const provided = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply(401, { error: 'unauthorized' });
    try {
      if (req.method === 'GET' && req.url === '/v1/health') return reply(200, { protocol: 1, mode: 'mock', hardware: false, status: gate.status() });
      if (req.method === 'GET' && req.url === '/v1/events') {
        gate.requireLease(req.headers['x-au05-lease']);
        if (clients.size >= 1) return reply(409, { error: 'stream_busy' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': mock stream; no hardware connected\n\n');
        clients.set(res, req.headers['x-au05-lease']);
        const timer = setInterval(() => {
          try { gate.requireLease(req.headers['x-au05-lease']); res.write(': heartbeat\n\n'); }
          catch { res.end(); }
        }, 1000);
        res.on('close', () => { clearInterval(timer); clients.delete(res); });
        return;
      }
      if (req.method !== 'POST') return reply(404, { error: 'not_found' });
      if (req.headers['content-type'] !== 'application/json') return reply(415, { error: 'json_required' });
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { reply(413, { error: 'body_too_large' }); req.resume(); return; }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'invalid_json' }); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, { error: 'object_required' });
      const id = req.headers['x-au05-lease'];
      switch (req.url) {
        case '/v1/lease': {
          const lease = gate.acquire(data.owner);
          closeStreams(); // A previous owner's stream must never observe the new lease.
          return reply(201, lease);
        }
        case '/v1/heartbeat': gate.heartbeat(id); return reply(200, { ok: true });
        case '/v1/release': gate.release(id); closeStreams(); return reply(200, { ok: true });
        case '/v1/snapshot': gate.update(id, data); return reply(200, { status: gate.status() });
        case '/v1/mock/input': {
          const ticket = gate.prepare(id, data.eventId, data.action);
          publish(ticket); return reply(200, { ticket });
        }
        case '/v1/mock/consume': return reply(200, { intent: gate.consume(id, data.ticket), executed: false });
        default: return reply(404, { error: 'not_found' });
      }
    } catch (error) {
      return reply(error instanceof GateError ? 409 : 500, { error: error instanceof GateError ? error.code : 'internal_error' });
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  // No real HID driver is loaded or available in this milestone.
  return server;
}
