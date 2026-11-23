import { randomUUID } from 'node:crypto';
import { createDshStudioEnvelope } from './mapping.js';

/** Metadata-only observer/projection. No Studio sender, actions, hardware or recording. */
export function createDshHookObserver({ sessionId, sessions, emit, alias = randomUUID() }) {
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256) throw new Error('selected_session_required');
  if (!sessions || typeof sessions.get !== 'function' || typeof emit !== 'function') throw new Error('observer_dependencies_required');
  if (typeof alias !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(alias)) throw new Error('invalid_observer_alias');
  let bound = sessions.get(sessionId), generation = bound ? 1 : 0, sequence = 0, stopped = false;
  let lastSeq = -1, terminal = false;
  const tools = new Set(), approvals = new Set();
  function reset() { lastSeq = -1; terminal = false; tools.clear(); approvals.clear(); }
  function publish(kind, extra = {}, hookEvent = null) {
    if (stopped) return;
    const record = Object.freeze({ schema: 1, source: 'dsh', transport: 'dry-run-only',
      session: alias, generation, sequence: ++sequence, kind, ...extra,
      ...(hookEvent ? { hook: createDshStudioEnvelope(hookEvent, `dsh-${alias}`) } : {}) });
    try { emit(record); } catch { /* Never break the DSH event pipeline for a diagnostic sink. */ }
  }
  function current(session) { return !stopped && bound && session === bound && sessions.get(sessionId) === bound; }
  function callKey(value) {
    if (typeof value === 'string' && value.length > 0 && value.length <= 256) return value;
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    return null;
  }
  const listeners = {
    'session/created'(session) {
      if (stopped || session?.id !== sessionId || sessions.get(sessionId) !== session || bound === session) return;
      bound = session; generation++; reset(); publish('session-attached');
    },
    'session/disposed'(session) {
      if (stopped || !bound || session !== bound) return;
      publish('session-detached'); bound = undefined; reset();
    },
    'agent/status'({ agent, status } = {}) {
      if (!current(agent?.session) || agent?.id !== sessionId || !['running', 'idle'].includes(status)) return;
      publish('agent-status', { status });
    },
    'session/event'(session, event) {
      // Public SessionEvent has no sessionId: the callback Session object is the
      // authority. Reject a contradictory optional ID without requiring a fake one.
      if (!current(session) || !event || (event.sessionId !== undefined && event.sessionId !== sessionId)) return;
      if (!Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq <= lastSeq) return;
      lastSeq = event.seq;
      switch (event.type) {
        case 'user/message':
          if (event.data?.source?.kind === 'user') {
            terminal = false; publish('user-prompt', {}, 'UserPromptSubmit');
          }
          break;
        case 'turn/start': terminal = false; publish('turn-start'); break;
        case 'tool/call': {
          const key = callKey(event.data?.callId);
          if (terminal || key === null || tools.has(key) || tools.size >= 256) break;
          tools.add(key); publish('tool-start', {}, 'PreToolUse'); break;
        }
        case 'tool/result': {
          // Public ToolResultMessage correlates with toolCallId, not source.callId.
          if (terminal || (event.surfaceOp !== undefined && event.surfaceOp !== 'append')) break;
          const key = callKey(event.data?.message?.toolCallId);
          if (key === null || !tools.delete(key)) break;
          publish('tool-settled', {}, 'PostToolUse'); break;
        }
        case 'turn/end': {
          if (terminal) break;
          const value = event.data?.reason?.kind;
          terminal = true; tools.clear();
          publish('turn-settled', { endKind: ['completed', 'aborted', 'error', 'blocked'].includes(value) ? value : 'other' }, 'Stop');
          break;
        }
        // Request lifecycle is not proof of a currently answerable GUI approval.
        case 'approval/asked': publish('approval-requested'); break;
        case 'approval/decided': publish('approval-decided'); break;
      }
    },
  };
  function projectApproval(session, expectedGeneration, pending, liveCarrier) {
    if (!current(session) || expectedGeneration !== generation || terminal || !pending
      || pending.kind !== 'approval' || pending.sessionId !== sessionId
      || typeof pending.key !== 'string' || !pending.key || pending.key.length > 256) return false;
    if (pending.answerable !== true) { if (approvals.size < 512) approvals.add(pending.key); return false; }
    if (liveCarrier && typeof pending.answer !== 'function' || approvals.has(pending.key) || approvals.size >= 512) return false;
    approvals.add(pending.key); publish('approval-pending', {}, 'PermissionRequest'); return true;
  }
  return {
    listeners,
    get generation() { return generation; },
    attach() { publish('observer-attached', { attached: Boolean(bound) }); },
    /** Local trusted Client projection only; never an RPC or an approval action. */
    syncPendingApproval(session, expectedGeneration, pending) {
      return projectApproval(session, expectedGeneration, pending, true);
    },
    /** Validated, fresh owner-Client attestation only. No answer capability crosses the wire. */
    syncOwnerApproval(session, expectedGeneration, pending) {
      return projectApproval(session, expectedGeneration, pending, false);
    },
    stop() { if (stopped) return; publish('observer-stopped'); stopped = true; bound = undefined; reset(); },
  };
}
