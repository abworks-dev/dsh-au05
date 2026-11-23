/** Official Hook event/state pairs, applied under DSH's own identity. No I/O. */
export const STUDIO_EVENT_STATES = Object.freeze({
  SessionStart: 'idle',
  UserPromptSubmit: 'thinking',
  PreToolUse: 'working',
  PostToolUse: 'working',
  Stop: 'attention',
  PermissionRequest: 'notification',
});

/** Build only allowlisted metadata. The supplied ID must be an opaque DSH alias. */
export function createDshStudioEnvelope(event, session) {
  if (typeof event !== 'string' || !Object.hasOwn(STUDIO_EVENT_STATES, event)) {
    throw new Error('unsupported_studio_hook_event');
  }
  if (typeof session !== 'string' || !/^dsh-[A-Za-z0-9-]{1,80}$/.test(session)) {
    throw new Error('opaque_dsh_session_required');
  }
  return Object.freeze({
    type: 'event',
    action: 'hook-fired',
    params: Object.freeze({
      type: 'state',
      agent_id: 'dsh',
      hook_source: 'ulanzi-studio',
      session_id: session,
      event,
      state: STUDIO_EVENT_STATES[event],
    }),
  });
}
