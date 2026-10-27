import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export class GateError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new GateError(code); };
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const actions = new Set(['allow_once', 'reject', 'cancel', 'scroll_up', 'scroll_down']);

// Original policy model, NOT a DSH permission service or a hardware driver.
export class ControlGate {
  constructor({ now = () => performance.now(), leaseMs = 5000, freshMs = 2000 } = {}) {
    this.now = now; this.leaseMs = leaseMs; this.freshMs = freshMs;
    this.lease = null; this.snapshot = null; this.seen = new Set(); this.issued = new Map();
  }
  acquire(owner) {
    if (!text(owner)) fail('invalid_owner');
    if (this.lease && this.lease.until > this.now()) fail('controller_busy');
    this.lease = { id: randomUUID(), owner, until: this.now() + this.leaseMs };
    this.snapshot = null; this.seen.clear(); this.issued.clear();
    return { ...this.lease };
  }
  requireLease(id) {
    if (!this.lease || this.lease.id !== id || this.lease.until <= this.now()) fail('lease_expired');
  }
  heartbeat(id) { this.requireLease(id); this.lease.until = this.now() + this.leaseMs; }
  release(id) { this.requireLease(id); this.lease = null; this.snapshot = null; this.issued.clear(); }
  update(id, snapshot) {
    this.requireLease(id);
    if (!snapshot || !text(snapshot.sessionId) || !Number.isSafeInteger(snapshot.revision)
      || snapshot.revision < 0 || typeof snapshot.focused !== 'boolean'
      || !['boolean', 'undefined'].includes(typeof snapshot.running)
      || typeof snapshot.completionUnread !== 'boolean') fail('invalid_snapshot');
    const pending = snapshot.pending;
    if (pending !== null && (typeof pending !== 'object' || !text(pending?.key)
      || !text(pending.kind) || typeof pending.answerable !== 'boolean')) fail('invalid_pending');
    if (this.snapshot && snapshot.revision <= this.snapshot.revision) fail('stale_revision');
    this.snapshot = { sessionId: snapshot.sessionId, revision: snapshot.revision,
      focused: snapshot.focused, running: snapshot.running,
      completionUnread: snapshot.completionUnread,
      pending: pending ? { key: pending.key, kind: pending.kind, answerable: pending.answerable } : null,
      observedAt: this.now() };
    // State changes cancel every in-flight gesture, even one for the same session.
    this.issued.clear();
  }
  current(id) {
    this.requireLease(id);
    if (!this.snapshot || this.now() - this.snapshot.observedAt >= this.freshMs) fail('stale_snapshot');
    if (!this.snapshot.focused) fail('not_focused');
    return this.snapshot;
  }
  prepare(id, eventId, action) {
    const s = this.current(id);
    if (!text(eventId) || !actions.has(action)) fail('invalid_event');
    if (this.seen.has(eventId)) fail('duplicate_event');
    // Bounded fail-closed deduplication; renew the lease instead of forgetting old IDs.
    if (this.seen.size >= 4096) fail('event_budget_exhausted');
    if (['allow_once', 'reject'].includes(action)
      && (s.pending?.kind !== 'approval' || !s.pending.answerable)) fail('not_answerable');
    if (action === 'cancel' && s.running !== true) fail('not_running');
    this.seen.add(eventId);
    const ticket = { id: randomUUID(), leaseId: id, sessionId: s.sessionId,
      revision: s.revision, requestKey: s.pending?.key ?? null, action,
      expiresAt: this.now() + 1000 };
    this.issued.set(ticket.id, ticket);
    return { ...ticket };
  }
  consume(id, ticket) {
    const s = this.current(id);
    const expected = this.issued.get(ticket?.id);
    if (!expected) fail('invalid_ticket');
    this.issued.delete(ticket.id);
    if (Object.keys(expected).some(key => expected[key] !== ticket[key])) fail('tampered_ticket');
    if (ticket.expiresAt <= this.now() || ticket.leaseId !== id
      || ticket.sessionId !== s.sessionId || ticket.revision !== s.revision
      || ticket.requestKey !== (s.pending?.key ?? null)) fail('stale_ticket');
    // This only validates a simulated intent. DSH must re-check its own live object.
    return { action: ticket.action, sessionId: ticket.sessionId, requestKey: ticket.requestKey };
  }
  status() {
    if (!this.lease || this.lease.until <= this.now() || !this.snapshot
      || this.now() - this.snapshot.observedAt >= this.freshMs || !this.snapshot.focused) return 'unknown';
    if (this.snapshot.pending?.kind === 'approval') return 'approval';
    if (this.snapshot.pending) return 'interaction';
    return this.snapshot.running === true ? 'running' : this.snapshot.running === false ? 'idle' : 'unknown';
  }
}
