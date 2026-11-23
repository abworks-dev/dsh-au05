import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';

export const STUDIO_INPUT_UUID = 'com.abworks.ulanzistudio.dshinput';
export const STUDIO_INPUT_ORIGIN = `dsh-studio-input://${STUDIO_INPUT_UUID}`;
export const STUDIO_INPUT_EVENTS = Object.freeze(['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up',
  'knob.down', 'knob.up', 'right.pulse', 'left.pulse']);
const controls = new Set(['k1', 'k2', 'k3', 'knob']);
const events = new Set(STUDIO_INPUT_EVENTS);
const tokenPattern = /^[A-Za-z0-9_-]{16,128}$/;
const idPattern = /^[A-Za-z0-9_.:{}-]{1,128}$/;
const validToken = value => typeof value === 'string' && tokenPattern.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const copy = value => JSON.parse(JSON.stringify(value));

export function parseStudioInputBindings(value) {
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new Error('invalid_input_bindings');
  const seenControls = new Set(), ids = new Set(), keys = new Set();
  return value.map(binding => {
    if (!exact(binding, ['control', 'actionid', 'key']) || !controls.has(binding.control)
      || typeof binding.actionid !== 'string' || !idPattern.test(binding.actionid)
      || !/^0_[0-3]$/.test(binding.key) || seenControls.has(binding.control) || ids.has(binding.actionid) || keys.has(binding.key)) {
      throw new Error('invalid_input_bindings');
    }
    seenControls.add(binding.control); ids.add(binding.actionid); keys.add(binding.key);
    return { control: binding.control, actionid: binding.actionid, key: binding.key };
  });
}

/** Input-only inbox. Construction is inert; a caller-owned, foreground-polled lease is mandatory.
 * No session content, OS key listener, HID, microphone, approval or DSH action is accessed here.
 * The Client must independently check foreground/session/epoch and freshness before acting.
 */
export function createStudioInput({ now = Date.now, canRun = () => true, maxAgeMs = 1200, maxQueue = 64 } = {}) {
  if (typeof now !== 'function' || typeof canRun !== 'function' || !positive(maxAgeMs) || maxAgeMs > 2000
    || !positive(maxQueue) || maxQueue > 128) throw new Error('invalid_input_config');
  let active = null, disposed = false;
  function current() {
    if (!active || active.state !== 'running') return false;
    let allowed = false;
    try { allowed = canRun() === true; } catch { /* deny */ }
    if (disposed || !allowed || now() >= active.expiresAt) {
      active.state = 'binding_lost'; active.queue.length = 0; active.pressed.clear(); return false;
    }
    return true;
  }
  function requireOwner(owner) {
    if (!active || !validToken(owner) || owner !== active.owner) throw new Error('input_owner_mismatch');
  }
  function leaseDuration(ms) {
    if (!positive(ms) || ms > 8000) throw new Error('invalid_input_lease');
    return ms;
  }
  const api = {
    start({ owner, sessionNonce, generation, epoch, bindings, leaseMs = 8000 } = {}) {
      if (disposed) throw new Error('input_disposed');
      if (current()) throw new Error('input_busy');
      if (!validToken(owner) || !validToken(sessionNonce) || !positive(generation) || !positive(epoch)) throw new Error('invalid_input_target');
      const parsed = Array.isArray(bindings) && bindings.length === 0 ? [] : parseStudioInputBindings(bindings), duration = leaseDuration(leaseMs);
      active = { owner, sessionNonce, generation, epoch, bindings: parsed, expiresAt: now() + duration,
        producerId: null, state: 'running', sequence: 0, accepted: 0, dropped: 0, notBefore: now(), queue: [], pressed: new Set() };
      if (!current()) throw new Error('input_mode_conflict');
      return api.status();
    },
    configure(owner, bindings) {
      requireOwner(owner);
      if (!current() || active.bindings.length || active.accepted) throw new Error('input_binding_confirmation_unavailable');
      active.bindings = parseStudioInputBindings(bindings);
      active.queue.length = 0; active.pressed.clear(); active.notBefore = now() + 1;
      return api.status();
    },
    renew(owner, leaseMs = 8000) {
      requireOwner(owner);
      if (current()) active.expiresAt = now() + leaseDuration(leaseMs);
      return api.status();
    },
    stop(owner) {
      requireOwner(owner); active.state = 'stopped'; active.queue.length = 0; active.pressed.clear(); return api.status();
    },
    status() {
      current();
      return { state: active?.state ?? 'idle', accepted: active?.accepted ?? 0, dropped: active?.dropped ?? 0,
        queued: active?.queue.length ?? 0, sequence: active?.sequence ?? 0, remainingMs: current() ? Math.max(0, active.expiresAt - now()) : 0 };
    },
    lease(pluginUuid, producerId) {
      if (pluginUuid !== STUDIO_INPUT_UUID || !validToken(producerId) || !current()) return null;
      if (active.producerId && active.producerId !== producerId) return null;
      active.producerId = producerId;
      return copy({ pluginUuid: STUDIO_INPUT_UUID, producerId, owner: active.owner, sessionNonce: active.sessionNonce,
        generation: active.generation, epoch: active.epoch, bindings: active.bindings, remainingMs: Math.max(0, active.expiresAt - now()) });
    },
    accept(value, context = null) {
      if (!current()) return false;
      if (context !== null && !validToken(context)) return false;
      const reject = () => { active.dropped++; return false; };
      if (!exact(value, ['pluginUuid', 'producerId', 'owner', 'sessionNonce', 'generation', 'epoch', 'sequence', 'timestamp', 'event', 'actionid', 'key'])
        || value.pluginUuid !== STUDIO_INPUT_UUID || value.producerId !== active.producerId || !active.producerId
        || value.owner !== active.owner || value.sessionNonce !== active.sessionNonce || value.generation !== active.generation || value.epoch !== active.epoch
        || !positive(value.sequence) || value.sequence <= active.sequence || !Number.isSafeInteger(value.timestamp)
        || value.timestamp < active.notBefore || value.timestamp > now() + 100 || now() - value.timestamp > maxAgeMs || !events.has(value.event)) return reject();
      const control = value.event.endsWith('.pulse') ? 'knob' : value.event.split('.')[0];
      if (!active.bindings.some(binding => binding.control === control && binding.actionid === value.actionid && binding.key === value.key)) return reject();
      const down = value.event.endsWith('.down'), up = value.event.endsWith('.up');
      if ((down && active.pressed.has(control)) || (up && !active.pressed.has(control))) return reject();
      if (active.queue.length >= maxQueue) {
        active.state = 'binding_lost'; active.queue.length = 0; active.pressed.clear(); return reject();
      }
      if (down) active.pressed.add(control);
      if (up) active.pressed.delete(control);
      active.sequence = value.sequence; active.accepted++;
      // Deliberately excludes bridge capabilities and arbitrary SDK params.
      active.queue.push({ event: value.event, sequence: value.sequence, generation: value.generation, epoch: value.epoch,
        sessionNonce: value.sessionNonce, timestamp: value.timestamp, at: value.timestamp, context, source: 'studio', actionid: value.actionid, key: value.key });
      return true;
    },
    drain(owner) {
      requireOwner(owner);
      if (!current()) return [];
      const queued = active.queue.splice(0), fresh = queued.filter(value => now() - value.timestamp <= maxAgeMs);
      active.dropped += queued.length - fresh.length;
      return fresh;
    },
    dispose() { disposed = true; if (active) { active.state = 'stopped'; active.queue.length = 0; active.pressed.clear(); } },
  };
  return api;
}

const randomToken = () => randomBytes(32).toString('base64url');
function sameSecret(value, expected) {
  if (typeof value !== 'string') return false;
  const left = Buffer.from(value), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Separate capabilities: plugin may read the current lease and submit metadata; it cannot
 * start/renew/stop the owner lease or execute actions. No CORS, redirects or public binding.
 * pairing() is secret material for explicit local provisioning, never a public RPC result.
 */
export function createStudioInputBridge({ now = Date.now, canRun = () => true, onEvent = () => {}, timers = globalThis,
  input = createStudioInput({ now, canRun }), createServer = createHttpServer } = {}) {
  if (!input || typeof input.lease !== 'function' || typeof input.accept !== 'function' || typeof createServer !== 'function') throw new Error('invalid_input_bridge');
  if (typeof now !== 'function' || typeof onEvent !== 'function') throw new Error('invalid_input_bridge');
  let server = null, address = null, capabilities = null, disposed = false, owner = null, target = null;
  let rateStart = now(), requests = 0, totalBytes = 0, watchdog = null, context = null, producerSeen = false;
  const candidateBindings = new Map();
  const closeServer = async () => {
    if (watchdog !== null) { timers.clearInterval(watchdog); watchdog = null; }
    address = null; capabilities = null;
    if (!server) return;
    const previous = server; server = null;
    await new Promise(resolve => { previous.close(resolve); previous.closeAllConnections?.(); });
  };
  const handler = (req, res) => {
    const respond = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    if (!address || disposed || req.socket?.remoteAddress !== '127.0.0.1' || req.headers.host !== `127.0.0.1:${address.port}`
      || req.headers.origin !== STUDIO_INPUT_ORIGIN || req.method !== 'POST' || req.headers['content-type'] !== 'application/json'
      || !['/lease', '/events', '/bindings'].includes(req.url)) return respond(403, { ok: false });
    if (now() - rateStart >= 1000) { rateStart = now(); requests = 0; totalBytes = 0; }
    if (++requests > 64 || totalBytes >= 65536) { req.resume?.(); return respond(429, { ok: false }); }
    const requestCapabilities = capabilities, requestAddress = address;
    const capability = req.url === '/lease' ? capabilities.leaseToken : req.url === '/bindings' ? capabilities.bindingToken : capabilities.eventToken;
    if (!sameSecret(req.headers.authorization, `Bearer ${capability}`)) return respond(403, { ok: false });
    let bytes = 0, chunks = [], ended = false;
    req.on('data', chunk => {
      if (ended) return;
      bytes += Buffer.byteLength(chunk); totalBytes += Buffer.byteLength(chunk);
      if (bytes > 4096 || totalBytes > 65536) { ended = true; chunks = []; respond(413, { ok: false }); req.resume?.(); return; }
      chunks.push(Buffer.from(chunk));
    });
    req.on('error', () => { ended = true; chunks = []; });
    req.on('end', () => {
      if (ended || disposed || !address || address !== requestAddress || capabilities !== requestCapabilities) return;
      ended = true;
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return respond(400, { ok: false }); }
      if (req.url === '/lease') {
        if (!exact(value, ['pluginUuid', 'producerId'])) return respond(400, { ok: false });
        const lease = input.lease(value.pluginUuid, value.producerId);
        if (lease) producerSeen = true;
        return respond(lease ? 200 : 409, { ok: Boolean(lease), lease });
      }
      if (req.url === '/bindings') {
        if (!exact(value, ['pluginUuid', 'producerId', 'actionUuid', 'control', 'actionid', 'key', 'active'])
          || value.actionUuid !== `${STUDIO_INPUT_UUID}.${value.control}`
          || typeof value.active !== 'boolean' || !input.lease(value.pluginUuid, value.producerId)) return respond(409, { ok: false });
        let binding;
        try { [binding] = parseStudioInputBindings([{ control: value.control, actionid: value.actionid, key: value.key }]); }
        catch { return respond(400, { ok: false }); }
        if (value.active) candidateBindings.set(binding.control, { ...binding, at: now() });
        else if (candidateBindings.get(binding.control)?.actionid === binding.actionid) candidateBindings.delete(binding.control);
        return respond(200, { ok: true });
      }
      const accepted = input.accept(value, context);
      if (accepted) {
        try { onEvent({ event: value.event, sequence: value.sequence, generation: value.generation, epoch: value.epoch,
          sessionNonce: value.sessionNonce, timestamp: value.timestamp, at: value.timestamp, context, source: 'studio', actionid: value.actionid, key: value.key }); }
        catch { /* Observer errors do not bypass validation or grant another capability. */ }
      }
      respond(accepted ? 200 : 409, { ok: accepted });
    });
  };
  return {
    input,
    async start(options) {
      if (disposed || server) throw new Error('input_bridge_unavailable');
      input.start(options); owner = options.owner; target = { generation: options.generation, epoch: options.epoch, sessionNonce: options.sessionNonce };
      capabilities = { leaseToken: randomToken(), eventToken: randomToken(), bindingToken: randomToken() };
      rateStart = now(); requests = 0; totalBytes = 0; context = null; producerSeen = false; candidateBindings.clear();
      const candidate = createServer(handler);
      server = candidate;
      candidate.maxConnections = 8; candidate.requestTimeout = 2000; candidate.headersTimeout = 2000; candidate.keepAliveTimeout = 1000;
      try {
        await new Promise((resolve, reject) => {
          const onError = error => { candidate.removeListener('close', onClose); reject(error); };
          const onClose = () => { candidate.removeListener('error', onError); reject(new Error('input_bridge_start_cancelled')); };
          candidate.once('error', onError); candidate.once('close', onClose);
          candidate.listen(0, '127.0.0.1', () => {
            candidate.removeListener('error', onError); candidate.removeListener('close', onClose); resolve();
          });
        });
        if (disposed || server !== candidate || input.status().state !== 'running') throw new Error('input_bridge_start_cancelled');
        address = candidate.address();
        if (!address || address.address !== '127.0.0.1' || !positive(address.port)) throw new Error('unsafe_input_bridge_address');
        candidate.unref?.();
        candidate.on('error', () => { if (server === candidate) { input.stop(owner); void closeServer(); } });
        watchdog = timers.setInterval(() => { if (input.status().state !== 'running') void closeServer(); }, 250);
        watchdog?.unref?.();
        return input.status();
      } catch (error) {
        candidate.close(() => {});
        if (server === candidate) { server = null; address = null; capabilities = null; input.stop(owner); }
        throw error;
      }
    },
    poll(token, { context: nextContext = null } = {}) {
      if (!owner || token !== owner) throw new Error('input_owner_mismatch');
      if (nextContext !== null && !validToken(nextContext)) throw new Error('invalid_input_context');
      // Context authorizes FUTURE arrivals only. Already queued records keep the context
      // captured at accept-time (including initial null), never the new poll context.
      context = nextContext;
      input.renew(owner);
      const status = input.status();
      return { generation: target.generation, sequence: status.sequence, events: input.drain(owner), overflow: status.state === 'binding_lost' };
    },
    bindings(token) {
      if (!owner || token !== owner) throw new Error('input_owner_mismatch');
      if (input.status().state !== 'running') return [];
      return [...candidateBindings.values()].filter(value => now() - value.at < 8000)
        .map(({ control, actionid, key }) => ({ control, actionid, key }));
    },
    configure(token, bindings) {
      if (!owner || token !== owner) throw new Error('input_owner_mismatch');
      const parsed = parseStudioInputBindings(bindings), candidates = this.bindings(token);
      if (parsed.some(value => !candidates.some(candidate => candidate.control === value.control && candidate.actionid === value.actionid && candidate.key === value.key))) {
        throw new Error('input_binding_not_observed');
      }
      const status = input.configure(token, parsed); context = null;
      return status;
    },
    pairing(token) {
      if (!owner || token !== owner) throw new Error('input_owner_mismatch');
      if (!address || disposed || input.status().state !== 'running') throw new Error('input_bridge_not_listening');
      return { version: 1, endpoint: `http://127.0.0.1:${address.port}`, origin: STUDIO_INPUT_ORIGIN, pluginUuid: STUDIO_INPUT_UUID,
        expiresInMs: input.status().remainingMs, ...capabilities };
    },
    async stop(token) {
      if (!owner || token !== owner) throw new Error('input_owner_mismatch');
      const previousTarget = target, status = input.stop(owner);
      await closeServer();
      if (target === previousTarget) { owner = null; target = null; }
      return status;
    },
    status() { return { ...input.status(), listening: Boolean(address), producerSeen, received: input.status().accepted }; },
    async dispose() { disposed = true; input.dispose(); await closeServer(); owner = null; target = null; },
  };
}
