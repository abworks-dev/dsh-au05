// Inlined into the browser client by scripts/build-plugin.mjs; no extra runtime dependency.
export function createDshApplication({ ctx, document, focusBridges, resolveScroll, answered = new WeakMap(), invoke }) {
  function readTarget() {
    try {
      const binding = ctx.uiSession.adapter.current.getSnapshot();
      const rows = Object.values(ctx.sessions.list.getSnapshot().byId);
      let main = null;
      for (const row of rows) {
        if (!((row.retainedBy?.mainView ?? 0) > 0)) continue;
        // A second retained main view is already ambiguous; do not inspect the
        // remaining session records or resolve any DOM bridges in that case.
        if (main) return null;
        main = row;
      }
      if (!main || !binding?.key || main.id !== binding.key) return null;
      const sessionOwner = ctx.sessions.binding(binding.key);
      if (!sessionOwner) return null;
      const status = ctx.uiSession.sessionStatus.getSnapshot().get(binding.key);
      const bridge = focusBridges.get(binding.key);
      const composerFocused = bridge?.owner === sessionOwner && bridge.isFocused?.() === true;
      const scroll = resolveScroll(binding.key, sessionOwner);
      return { sessionId: binding.key, binding, sessionOwner, inputActions: binding.props?.inputActions, composerFocused,
        scrollPort: scroll?.port ?? null, scrollRoot: scroll?.root ?? null,
        pending: status?.pendingInteraction, pendingKey: status?.pendingInteraction?.key,
        pendingAnswerable: status?.pendingInteraction?.answerable, pendingKind: status?.pendingInteraction?.kind,
        pendingSessionId: status?.pendingInteraction?.sessionId, running: status?.running === true,
        focused: document.visibilityState === 'visible' && document.hasFocus(), element: document.activeElement };
    } catch { return null; }
  }
  const equalTarget = (first, second) => first === second || Boolean(first && second
    && first.sessionId === second.sessionId && first.binding === second.binding && first.sessionOwner === second.sessionOwner
    && first.pending === second.pending && first.pendingKey === second.pendingKey && first.inputActions === second.inputActions
    && first.pendingAnswerable === second.pendingAnswerable && first.pendingKind === second.pendingKind
    && first.pendingSessionId === second.pendingSessionId && first.running === second.running
    && first.focused === second.focused && first.element === second.element && first.composerFocused === second.composerFocused
    && first.scrollPort === second.scrollPort && first.scrollRoot === second.scrollRoot);
  function approve(target, answer) {
    const pending = target.pending;
    if (pending?.kind !== 'approval' || pending.answerable !== true || pending.sessionId !== target.sessionId
      || typeof pending.key !== 'string' || typeof pending.answer !== 'function') return false;
    let keys = answered.get(target.sessionOwner);
    if (!keys) answered.set(target.sessionOwner, keys = new Set());
    if (keys.has(pending.key)) return true;
    keys.add(pending.key);
    invoke(() => pending.answer(answer));
    return true;
  }
  // Local DSH QuestionFlow compatibility: data-question-key identifies the live
  // carrier; its footer owns Next/Submit and all validation/default recommendations.
  // Never construct answers from labels, touch plan approvals, or fall back to drafts.
  function questionAction(target, action) {
    const current = readTarget(), pending = target?.pending;
    if (!current?.focused || current.binding !== target.binding || current.sessionOwner !== target.sessionOwner
      || current.pending !== pending || current.pendingKey !== target.pendingKey || pending?.kind !== 'question'
      || pending.sessionId !== target.sessionId || typeof pending.key !== 'string' || !pending.key || pending.review !== undefined) return false;
    const state = pending.getSnapshot?.();
    if (state?.closed !== false || !['open', 'continued'].includes(state.state)
      || !['waterfall', 'rpc'].includes(state.channel)) return false;
    const visible = element => element?.isConnected && !element.disabled
      && !element.closest('[hidden], [aria-hidden="true"], [inert]') && element.getClientRects().length > 0;
    const cards = Array.from(document.querySelectorAll?.('[data-question-key]') ?? [])
      .filter(card => card.getAttribute('data-question-key') === pending.key && visible(card));
    if (cards.length !== 1) return false;
    const card = cards[0];
    const fields = Array.from(card.querySelectorAll('[data-question-scroll] textarea')).filter(visible);
    if (fields.length !== 1) return false;
    const field = fields[0];
    if (action === 'focus') {
      field.focus({ preventScroll: true });
      return document.activeElement === field;
    }
    if (action !== 'submit' || document.activeElement === field && !field.value.trim()) return false;
    // The generic flow footer has previous/next pager buttons, then Skip and
    // Next/Submit. Fail closed if a host update changes that presentation.
    const buttons = Array.from(card.querySelectorAll('section > footer button'));
    if (buttons.length !== 4 || !visible(buttons[3]) || buttons[3].getAttribute('aria-disabled') === 'true') return false;
    buttons[3].click();
    return true;
  }
  return { readTarget, equalTarget, approve, questionAction };
}
