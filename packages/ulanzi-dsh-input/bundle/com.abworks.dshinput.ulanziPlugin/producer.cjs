'use strict';
// Public SDK wire contract pinned to 550ab80c69285ecf259bd494a7fff767c14f0c0f:
// cmd=keydown/keyup/dialdown/dialup/dialrotate; key/actionid/rotateEvent are TOP LEVEL.
// This is a minimal SDK-compatible action adapter, not a redistributed full Ulanzi SDK.
const UUID = 'com.abworks.ulanzistudio.dshinput';
const ORIGIN = `dsh-studio-input://${UUID}`;
const controls = new Set(['k1', 'k2', 'k3', 'knob']);
const tokenPattern = /^[A-Za-z0-9_-]{16,128}$/;
function parsePairing(value) {
  if (!value || value.version !== 1 || value.pluginUuid !== UUID || value.origin !== ORIGIN
    || typeof value.endpoint !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value.endpoint)
    || Number(new URL(value.endpoint).port) > 65535 || typeof value.leaseToken !== 'string' || typeof value.eventToken !== 'string'
    || !tokenPattern.test(value.leaseToken) || !tokenPattern.test(value.eventToken)
    || value.leaseToken === value.eventToken) throw new Error('invalid_studio_input_pairing');
  if (value.bindingToken !== undefined && (typeof value.bindingToken !== 'string' || !tokenPattern.test(value.bindingToken)
    || [value.leaseToken, value.eventToken].includes(value.bindingToken))) throw new Error('invalid_studio_input_pairing');
  return { version: 1, endpoint: value.endpoint, origin: ORIGIN, pluginUuid: UUID, leaseToken: value.leaseToken, eventToken: value.eventToken,
    ...(value.bindingToken ? { bindingToken: value.bindingToken } : {}) };
}
function validateStartup(argv) {
  return (!argv[0] || argv[0] === '127.0.0.1' || argv[0] === 'localhost') && (!argv[1] || argv[1] === '3906');
}
const failureCodes = new Set(['lease_request_timeout', 'lease_http_rejected', 'lease_response_limit', 'lease_invalid_response',
  'lease_transport_error', 'lease_invalid', 'lease_expired', 'identity_failed', 'confirmation_with_inflight',
  'event_request_timeout', 'event_http_rejected', 'event_response_limit', 'event_invalid_response',
  'event_transport_error', 'event_invalid_reply', 'event_stale_or_changed', 'event_queue_full']);
const isFailureCode = code => typeof code === 'string' && failureCodes.has(code);
function postFailureCode(stage, error) {
  let message; try { message = error?.message; } catch { /* Do not inspect or emit arbitrary error data. */ }
  const suffix = { input_request_timeout: 'request_timeout', input_bridge_rejected: 'http_rejected',
    input_response_limit: 'response_limit', invalid_input_response: 'invalid_response' };
  return `${stage}_${typeof message === 'string' && Object.hasOwn(suffix, message) ? suffix[message] : 'transport_error'}`;
}
function createStudioProducer({ producerId, post, now = Date.now, onDiagnostic = () => {} } = {}) {
  if (!tokenPattern.test(producerId) || typeof post !== 'function' || typeof now !== 'function') throw new Error('invalid_studio_input_producer');
  let lease = null, deadline = 0, sequence = 0, closed = false, inFlight = false, refreshing = null;
  let identity = '', failedIdentity = '';
  const pressed = new Set(), revoked = new Set(), pending = [], observedBindings = new Map();
  function note(code) { if (!closed && isFailureCode(code)) { try { onDiagnostic(code); } catch { /* Diagnostics cannot change safety behavior. */ } } }
  function clear() { lease = null; deadline = 0; pressed.clear(); for (const item of pending.splice(0)) item.resolve(false); }
  function live() { if (!lease || closed || now() >= deadline) { clear(); return false; } return true; }
  function binding(data, control) {
    if (!live() || !data || ![UUID, `${UUID}.${control}`].includes(data.uuid) || !controls.has(control) || revoked.has(data.actionid)) return null;
    return lease.bindings.find(value => value.control === control && value.actionid === data.actionid && value.key === data.key) || null;
  }
  async function refresh() {
    if (closed) return false;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const requestedAt = now();
      let response;
      try { response = await post('/lease', { pluginUuid: UUID, producerId }); } catch (error) { note(postFailureCode('lease', error)); clear(); return false; }
      const next = response?.ok === true ? response.lease : null;
      if (closed || !next || next.pluginUuid !== UUID || next.producerId !== producerId
        || !tokenPattern.test(next.owner) || !tokenPattern.test(next.sessionNonce)
        || !Number.isSafeInteger(next.generation) || next.generation < 1 || !Number.isSafeInteger(next.epoch) || next.epoch < 1
        || !Number.isSafeInteger(next.remainingMs) || next.remainingMs < 1 || next.remainingMs > 8000
        || !Array.isArray(next.bindings) || next.bindings.length > 4
        || next.bindings.some(value => !controls.has(value.control) || typeof value.actionid !== 'string'
          || !/^[A-Za-z0-9_.:{}-]{1,128}$/.test(value.actionid) || !/^0_[0-3]$/.test(value.key))) { note('lease_invalid'); clear(); return false; }
      const nextIdentity = `${next.owner}:${next.sessionNonce}:${next.generation}:${next.epoch}`;
      if (failedIdentity === nextIdentity) { note('identity_failed'); clear(); return false; }
      const changed = identity !== nextIdentity;
      if (changed) { sequence = 0; pressed.clear(); revoked.clear(); identity = nextIdentity; }
      const confirmed = lease && lease.bindings.length === 0 && next.bindings.length > 0;
      if (confirmed && (pending.length || inFlight || pressed.size)) { note('confirmation_with_inflight'); failedIdentity = identity; clear(); return false; }
      lease = changed || !lease || confirmed ? next : lease;
      // Subtract transit time conservatively; never extend the owner's lease from the plugin.
      deadline = requestedAt + next.remainingMs;
      if (live()) { for (const record of observedBindings.values()) { if (now() - record.at < 8000) void publishBinding(record); } }
      const alive = live();
      if (!alive) note('lease_expired');
      return alive;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function publishBinding(record) {
    if (!live() || now() - record.at >= 8000) return false;
    try {
      const reply = await post('/bindings', { pluginUuid: UUID, producerId, actionUuid: `${UUID}.${record.control}`,
        control: record.control, actionid: record.actionid, key: record.key, active: record.active });
      return reply?.ok === true;
    } catch { return false; }
  }
  function observeBinding(data) {
    // Only own action-type UUID can identify a previously unknown instance; never infer
    // an action type from a reserved Task key or inspect any user's saved profile.
    const control = typeof data.uuid === 'string' && data.uuid.startsWith(`${UUID}.`) ? data.uuid.slice(UUID.length + 1) : null;
    if (!controls.has(control) || typeof data.actionid !== 'string' || !/^[A-Za-z0-9_.:{}-]{1,128}$/.test(data.actionid) || !/^0_[0-3]$/.test(data.key)) return;
    const record = { control, actionid: data.actionid, key: data.key, active: data.cmd !== 'clear', at: now() };
    observedBindings.set(control, record);
    return publishBinding(record);
  }
  async function pump() {
    if (inFlight) return;
    inFlight = true;
    try {
      while (pending.length) {
        const item = pending.shift();
        if (!live() || lease !== item.target || now() - item.envelope.timestamp > 1200) { note('event_stale_or_changed'); failedIdentity = identity; item.resolve(false); clear(); break; }
        try {
          const reply = await post('/events', item.envelope);
          if (closed || lease !== item.target || reply?.ok !== true) { note(lease !== item.target ? 'event_stale_or_changed' : 'event_invalid_reply'); failedIdentity = identity; item.resolve(false); clear(); break; }
          item.resolve(true);
        } catch (error) { note(postFailureCode('event', error)); failedIdentity = identity; item.resolve(false); clear(); break; }
      }
    } finally { inFlight = false; }
  }
  function emit(data, control, event) {
    if (!binding(data, control)) return Promise.resolve(false);
    const down = event.endsWith('.down'), up = event.endsWith('.up');
    if ((down && pressed.has(control)) || (up && !pressed.has(control))) return Promise.resolve(false);
    if (pending.length >= 32) { note('event_queue_full'); failedIdentity = identity; clear(); return Promise.resolve(false); }
    const target = lease;
    const envelope = { pluginUuid: UUID, producerId, owner: target.owner, sessionNonce: target.sessionNonce,
      generation: target.generation, epoch: target.epoch, sequence: ++sequence, timestamp: now(), event,
      actionid: data.actionid, key: data.key };
    if (down) pressed.add(control);
    if (up) pressed.delete(control);
    return new Promise(resolve => { pending.push({ target, envelope, resolve }); void pump(); });
  }
  // SDK callback arguments are the complete incoming action data; never inspect params or synthesize run/hotkey events.
  function keyControl(data) {
    if (data?.uuid === UUID && live()) return lease.bindings.find(value => value.actionid === data.actionid && value.key === data.key)?.control;
    return data?.uuid?.startsWith(`${UUID}.`) ? data.uuid.slice(UUID.length + 1) : null;
  }
  function onKeyDown(data) { const control = keyControl(data); return control !== 'knob' && controls.has(control) ? emit(data, control, `${control}.down`) : Promise.resolve(false); }
  function onKeyUp(data) { const control = keyControl(data); return control !== 'knob' && controls.has(control) ? emit(data, control, `${control}.up`) : Promise.resolve(false); }
  function onDialDown(data) { return emit(data, 'knob', 'knob.down'); }
  function onDialUp(data) { return emit(data, 'knob', 'knob.up'); }
  function dialRotate(data) {
    if (!['left', 'right'].includes(data?.rotateEvent)) return Promise.resolve(false);
    return emit(data, 'knob', `${data.rotateEvent}.pulse`);
  }
  const handlers = { keydown: onKeyDown, keyup: onKeyUp, dialdown: onDialDown, dialup: onDialUp, dialrotate: dialRotate };
  return {
    refresh, onKeyDown, onKeyUp, onDialDown, onDialUp, dialRotate,
    async receive(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.uuid !== 'string'
        || (data.uuid !== UUID && ![...controls].some(control => data.uuid === `${UUID}.${control}`))
        || (typeof data.code !== 'undefined' && data.cmdType !== 'REQUEST')) return false;
      const discovery = ['add', 'setactive', 'clear'].includes(data.cmd)
        || (!lease?.bindings.length && ['keydown', 'keyup', 'dialdown', 'dialup', 'dialrotate'].includes(data.cmd));
      const capture = discovery ? observeBinding(data) : null;
      if (data.cmd === 'add' || data.cmd === 'setactive') { await capture; return false; }
      if (data.cmd === 'clear') {
        const control = keyControl(data);
        if (binding(data, control)) { revoked.add(data.actionid); pressed.delete(control); }
        return false;
      }
      return handlers[data.cmd] ? handlers[data.cmd](data) : false;
    },
    close() { closed = true; observedBindings.clear(); clear(); },
  };
}
module.exports = { UUID, ORIGIN, parsePairing, validateStartup, createStudioProducer, isFailureCode };
