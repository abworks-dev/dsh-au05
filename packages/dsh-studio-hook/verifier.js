import { randomUUID } from 'node:crypto';
import { createDshHookObserver } from './core.js';
import { createStudioSender } from './sender.js';

const events = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest']);
export function createStudioVerifier({ ctx, Sender = createStudioSender, seconds = 120, now = Date.now,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  if (!ctx?.sessions?.get || typeof ctx.on !== 'function' || !Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw new Error('invalid_verifier_config');
  let active = null, disposed = false;
  const empty = { state: 'idle', accepted: 0, completed: 0, dropped: 0, lastEvent: '', lastCode: '', remaining: 0 };
  function snapshot() {
    if (!active) return { ...empty };
    const value = active.sender.snapshot();
    return { state: active.state, accepted: value.accepted, completed: value.completed, dropped: value.dropped,
      lastEvent: active.lastEvent, lastCode: active.lastCode, remaining: active.state === 'running' ? Math.max(0, Math.ceil((active.deadline - now()) / 1000)) : 0 };
  }
  function close(record, state) {
    if (!record || record.state !== 'running') return;
    record.state = state; clearIntervalImpl(record.timer); record.sender.stop(); record.observer.stop();
    for (const off of record.offs.splice(0)) { try { off(); } catch {} }
  }
  function current(record) {
    return !disposed && active === record && record.state === 'running' && now() < record.deadline && now() - record.heartbeat < 5000
      && ctx.sessions.get(record.sessionId) === record.session && record.observer.generation === record.generation;
  }
  function requireToken(token) {
    if (!active || token !== active.owner) throw new Error('verification_owner_mismatch');
    return active;
  }
  return {
    start(sessionId, owner) {
      if (disposed) throw new Error('verification_disposed');
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256
        || typeof owner !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(owner)) throw new Error('invalid_verification_target');
      if (active?.state === 'running') throw new Error('verification_busy');
      const session = ctx.sessions.get(sessionId);
      if (!session || session.id !== sessionId || !Number.isSafeInteger(session.seq) || session.seq < 0) throw new Error('verification_session_unavailable');
      const alias = randomUUID();
      const record = { session, sessionId, owner, startSeq: session.seq, generation: 0, state: 'running', heartbeat: now(), deadline: now() + seconds * 1000,
        lastEvent: '', lastCode: 'session_contract_vthree', offs: [], observer: null, sender: null, timer: null };
      record.observer = createDshHookObserver({ sessionId, sessions: ctx.sessions, alias, emit(value) {
        if (!current(record)) return;
        if (value.hook && value.generation === record.generation) record.sender.enqueue(value.hook.params.event);
      } });
      record.generation = record.observer.generation;
      record.sender = Sender({ sessionId: `dsh-${alias}`, isCurrent: () => current(record), onRecord(value) {
        if (active !== record) return;
        if (events.has(value?.event)) record.lastEvent = value.event;
        if (typeof value?.code === 'string' && /^[a-z_]{1,64}$/.test(value.code)) record.lastCode = value.code;
      } });
      active = record;
      try {
        for (const [name, listener] of Object.entries(record.observer.listeners)) record.offs.push(ctx.on(name, (...args) => {
          if (!current(record)) { close(record, 'binding_lost'); return; }
          // Session.seq is the next append cursor in the installed public Session API.
          // Never project historical replay merely because a client has just attached.
          if (name === 'session/event') {
            // Fixed diagnostics for the selected object only; never retain payloads,
            // other-session activity, IDs, text, arguments or result bodies.
            if (args[0] === record.session) record.lastCode = args[1]?.sessionId === record.sessionId
              ? 'selected_event_id_matches' : args[1]?.sessionId === undefined ? 'selected_event_id_absent' : 'selected_event_id_conflict';
            if (!Number.isSafeInteger(args[1]?.seq) || args[1].seq < record.startSeq) {
              if (args[0] === record.session) record.lastCode = 'selected_event_old_or_invalid_seq';
              return;
            }
          }
          listener(...args);
          if (!current(record)) close(record, 'binding_lost');
        }, { global: true }));
        // Session events originate in another Cordis scope. Global delivery is
        // necessary; exact registry object, owner, generation and seq checks above
        // still decide what this explicitly armed observer may project.
        record.timer = setIntervalImpl(() => {
          if (now() >= record.deadline) close(record, 'expired');
          else if (!current(record)) close(record, 'binding_lost');
        }, 250);
        record.timer.unref?.(); record.observer.attach();
      } catch (error) { close(record, 'error'); throw error; }
      return snapshot();
    },
    poll(owner) { const record = requireToken(owner); if (current(record)) record.heartbeat = now(); else close(record, now() >= record.deadline ? 'expired' : 'binding_lost'); return snapshot(); },
    stop(owner) { close(requireToken(owner), 'stopped'); return snapshot(); },
    status: snapshot,
    dispose() { close(active, 'stopped'); disposed = true; },
  };
}
