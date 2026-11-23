import { randomUUID } from 'node:crypto';
import { createDshHookObserver } from './core.js';
import { createStudioSender } from './sender.js';

const activeContexts = new WeakMap();
const events = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest']);
const senderCodes = new Set(['stopped', 'stale_session', 'windows_only', 'reviewed_cli_required',
  'cli_returned_not_lamp_ack', 'cli_failed', 'spawn_error', 'stdin_error', 'output_limit',
  'child_timeout', 'unsupported_event', 'queue_full']);
const empty = { state: 'idle', accepted: 0, completed: 0, dropped: 0, lastEvent: '', lastCode: '', remaining: 0 };
const LEASE_MS = 8000;

/** Explicit continuous run. The owning client module must poll for its entire lifetime.
 * Construction and mounting are inert; only real events in a live lease reach Sender.
 */
export function createStudioRuntime({ ctx, Sender = createStudioSender, now = Date.now,
  timers = globalThis, canRun = () => true, onClose = () => {} } = {}) {
  if (!ctx?.sessions?.get || typeof ctx.on !== 'function' || typeof Sender !== 'function'
    || typeof now !== 'function' || typeof canRun !== 'function' || typeof onClose !== 'function'
    || typeof timers?.setInterval !== 'function' || typeof timers?.clearInterval !== 'function') throw new Error('invalid_runtime_config');
  let active = null, disposed = false;
  function allowed() { try { return canRun() === true; } catch { return false; } }
  function close(record, state, code) {
    if (!record || record.state !== 'running') return;
    record.state = state;
    if (activeContexts.get(ctx) === record) activeContexts.delete(ctx);
    if (record.timer !== null) { try { timers.clearInterval(record.timer); } catch {} record.timer = null; }
    // Invalidate first, then cancel queued/in-flight work; never synthesize a Stop.
    try { record.sender?.stop(); } catch {}
    try { record.observer?.stop(); } catch {}
    for (const off of record.offs.splice(0)) { try { off(); } catch {} }
    record.lastCode = code;
    try { onClose(); } catch { /* Cleanup must remain fail-closed. */ }
  }
  function current(record) {
    if (disposed || active !== record || record.state !== 'running' || activeContexts.get(ctx) !== record) return false;
    if (!allowed()) { close(record, 'stopped', 'mode_conflict'); return false; }
    if (now() - record.heartbeat >= LEASE_MS) { close(record, 'binding_lost', 'lease_lost'); return false; }
    if (ctx.sessions.get(record.sessionId) !== record.session || record.observer.generation !== record.generation) {
      close(record, 'binding_lost', 'session_binding_lost'); return false;
    }
    return true;
  }
  function snapshot() {
    if (!active) return { ...empty };
    current(active);
    const value = active.sender?.snapshot() ?? empty;
    return { state: active.state, accepted: value.accepted, completed: value.completed, dropped: value.dropped,
      lastEvent: active.lastEvent, lastCode: active.lastCode, remaining: 0 };
  }
  function requireOwner(owner) {
    if (!active || owner !== active.owner) throw new Error('runtime_owner_mismatch');
    return active;
  }
  return {
    start(sessionId, owner) {
      if (disposed) throw new Error('runtime_disposed');
      if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256
        || typeof owner !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(owner)) throw new Error('invalid_runtime_target');
      if (active?.state === 'running') current(active);
      if (activeContexts.has(ctx)) throw new Error('runtime_busy');
      if (!allowed()) throw new Error('runtime_mode_conflict');
      const session = ctx.sessions.get(sessionId);
      if (!session || session.id !== sessionId || !Number.isSafeInteger(session.seq) || session.seq < 0) throw new Error('runtime_session_unavailable');
      const alias = randomUUID();
      const record = { session, sessionId, owner, startSeq: session.seq, generation: 0, heartbeat: now(),
        state: 'running', lastEvent: '', lastCode: 'runtime_started', projectionSeq: 0, offs: [], observer: null, sender: null, timer: null };
      record.observer = createDshHookObserver({ sessionId, sessions: ctx.sessions, alias, emit(value) {
        if (value.hook && value.generation === record.generation && current(record)) record.sender.enqueue(value.hook.params.event);
      } });
      record.generation = record.observer.generation;
      active = record; activeContexts.set(ctx, record);
      try {
        record.sender = Sender({ sessionId: `dsh-${alias}`, isCurrent: () => current(record), onRecord(value) {
          if (active !== record || record.state !== 'running') return;
          if (events.has(value?.event)) record.lastEvent = value.event;
          if (senderCodes.has(value?.code)) record.lastCode = value.code;
        } });
        for (const [name, listener] of Object.entries(record.observer.listeners)) record.offs.push(ctx.on(name, (...args) => {
          if (!current(record)) return;
          if (name === 'session/disposed' && args[0] === record.session) {
            close(record, 'binding_lost', 'session_binding_lost'); return;
          }
          // Session.seq is the next append cursor. Delayed history cannot arm hooks.
          if (name === 'session/event' && (!Number.isSafeInteger(args[1]?.seq) || args[1].seq < record.startSeq)) return;
          listener(...args);
          current(record);
        }, { global: true }));
        record.timer = timers.setInterval(() => current(record), 250);
        record.timer?.unref?.();
        record.observer.attach();
      } catch (error) { close(record, 'error', 'runtime_error'); throw error; }
      return snapshot();
    },
    poll(owner) { const record = requireOwner(owner); if (current(record)) record.heartbeat = now(); return snapshot(); },
    /** Owner Client attests the current public pendingInteraction, never approval/asked alone. */
    projectApproval(owner, projection) {
      const record = requireOwner(owner);
      const keys = ['sessionId', 'key', 'observedAt', 'revision', 'answerable'];
      if (!projection || typeof projection !== 'object' || Array.isArray(projection)
        || Object.keys(projection).length !== keys.length || keys.some(key => !Object.hasOwn(projection, key))
        || projection.sessionId !== record.sessionId || typeof projection.key !== 'string'
        || !projection.key || projection.key.length > 256 || projection.answerable !== true
        || !Number.isSafeInteger(projection.revision) || projection.revision <= record.projectionSeq
        || !Number.isSafeInteger(projection.observedAt) || now() < projection.observedAt
        || now() - projection.observedAt >= 1500) throw new Error('invalid_approval_projection');
      if (current(record)) {
        record.projectionSeq = projection.revision;
        record.observer.syncOwnerApproval(record.session, record.generation, { kind: 'approval',
          sessionId: record.sessionId, key: projection.key, answerable: true });
      }
      return snapshot();
    },
    stop(owner) { close(requireOwner(owner), 'stopped', 'runtime_stopped'); return snapshot(); },
    status: snapshot,
    owns(owner) { return Boolean(active && active.owner === owner && current(active)); },
    dispose() { close(active, 'stopped', 'runtime_disposed'); disposed = true; },
  };
}
