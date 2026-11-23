'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { UUID, parsePairing, validateStartup, createStudioProducer, isFailureCode } = require('./producer.cjs');
const closeCodes = new Set(['explicit_close', 'test_complete', 'sdk_closed', 'sdk_error', 'signal_sigterm',
  'signal_sigint', 'lease_unavailable', 'refresh_exception']);
function diagnosticLog(record) { try { fs.writeSync(1, `${JSON.stringify(record)}\n`); } catch { /* A closed stdout pipe must not terminate the service. */ } }
function writeStartupFailure() {
  diagnosticLog({ type: 'studio_input_diagnostic', event: 'service_closed', code: 'startup_failed', elapsedMs: 0 });
}

function loadPairing() {
  // Sole provisioning location is this owned plugin directory. No discovery of profiles,
  // histories, global configuration, environment URLs, or arbitrary filesystem paths.
  const filename = path.join(__dirname, 'bridge.json');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('invalid_studio_input_pairing_file');
  return parsePairing(JSON.parse(fs.readFileSync(filename, 'utf8')));
}
function createPost(pairing, request = http.request) {
  pairing = parsePairing(pairing);
  return (route, value) => new Promise((resolve, reject) => {
    if (!['/lease', '/events', '/bindings'].includes(route) || (route === '/bindings' && !pairing.bindingToken)) return reject(new Error('invalid_input_route'));
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > 4096) return reject(new Error('input_body_limit'));
    const url = new URL(pairing.endpoint);
    const req = request({ hostname: '127.0.0.1', port: Number(url.port), method: 'POST', path: route,
      agent: false, timeout: 700, headers: { Host: url.host, Origin: pairing.origin, 'Content-Type': 'application/json',
        'Content-Length': body.length, Authorization: `Bearer ${route === '/lease' ? pairing.leaseToken : route === '/bindings' ? pairing.bindingToken : pairing.eventToken}` } }, res => {
      if (res.statusCode !== 200 || res.headers['content-type'] !== 'application/json') {
        res.resume(); reject(new Error('input_bridge_rejected')); return;
      }
      let bytes = 0, chunks = [];
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 4096) { req.destroy(new Error('input_response_limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid_input_response')); } });
    });
    req.on('timeout', () => req.destroy(new Error('input_request_timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
function run({ argv = process.argv.slice(2), WebSocket, pairing, post, timers = globalThis,
  onDiagnostic = diagnosticLog, now = Date.now } = {}) {
  if (!validateStartup(argv)) throw new Error('unsafe_studio_startup_arguments');
  pairing = pairing || loadPairing();
  WebSocket = WebSocket || require('./vendor/ws');
  const started = now();
  let timer = null, closed = false, firstFailure = null;
  function report(event, code) {
    let elapsedMs = 0;
    try { const value = now() - started; if (Number.isFinite(value)) elapsedMs = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))); } catch {}
    try { onDiagnostic({ type: 'studio_input_diagnostic', event, code, elapsedMs }); } catch { /* Never bypass fail-closed cleanup. */ }
  }
  const producer = createStudioProducer({ producerId: randomUUID(), post: post || createPost(pairing), now,
    onDiagnostic(code) {
      if (closed || !isFailureCode(code)) return;
      firstFailure ??= code;
      report('producer_failure', code);
    } });
  const socket = new WebSocket('ws://127.0.0.1:3906', { handshakeTimeout: 5000, maxPayload: 32768,
    perMessageDeflate: false, followRedirects: false });
  const onSigterm = () => close('signal_sigterm'), onSigint = () => close('signal_sigint');
  function close(reason = 'explicit_close') {
    if (closed) return;
    closed = true;
    const code = typeof reason === 'string' && (closeCodes.has(reason) || isFailureCode(reason)) ? reason : 'explicit_close';
    producer.close();
    if (timer !== null) timers.clearInterval(timer);
    try { socket.terminate(); } catch { /* already closed */ }
    process.removeListener('SIGTERM', onSigterm); process.removeListener('SIGINT', onSigint);
    report('service_closed', code);
  }
  async function refresh() {
    if (closed) return;
    // A dead owner/old pairing must not leave an apparently healthy SDK service.
    // Never reload credentials or resume partially held inputs automatically.
    try { if (!await producer.refresh()) close(firstFailure ?? 'lease_unavailable'); } catch { close('refresh_exception'); }
  }
  socket.on('open', () => {
    if (closed) return;
    socket.send(JSON.stringify({ code: 0, cmd: 'connected', uuid: UUID }));
    report('sdk_connected', 'sdk_connected');
    void refresh();
    timer = timers.setInterval(() => { void refresh(); }, 1000);
    timer.unref?.();
  });
  socket.on('message', (bytes, binary) => {
    if (closed || binary || bytes.length > 32768) return;
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); } catch { return; }
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || (data.uuid !== UUID && !['k1', 'k2', 'k3', 'knob'].some(control => data.uuid === `${UUID}.${control}`))
      || (typeof data.code !== 'undefined' && data.cmdType !== 'REQUEST')
      || !['add', 'setactive', 'clear', 'run', 'paramfromapp', 'keydown', 'keyup', 'dialdown', 'dialup', 'dialrotate'].includes(data.cmd)) return;
    // Official SDK main-service ACK, limited to routing fields; never echo settings/params.
    const ack = { code: 0, cmd: data.cmd, uuid: data.uuid };
    if (typeof data.key === 'string' && /^0_[0-3]$/.test(data.key)) ack.key = data.key;
    if (typeof data.actionid === 'string' && /^[A-Za-z0-9_.:{}-]{1,128}$/.test(data.actionid)) ack.actionid = data.actionid;
    socket.send(JSON.stringify(ack));
    void producer.receive(data);
  });
  socket.on('error', () => close('sdk_error')); socket.on('close', () => close('sdk_closed'));
  process.once('SIGTERM', onSigterm); process.once('SIGINT', onSigint);
  return { close: reason => close(reason === 'test_complete' ? 'test_complete' : 'explicit_close') };
}
module.exports = { loadPairing, createPost, run, writeStartupFailure };
if (require.main === module) {
  // Deliberately no credentials, paths, SDK frames, session text or error payloads in logs.
  try { run(); } catch { writeStartupFailure(); process.exitCode = 1; }
}
