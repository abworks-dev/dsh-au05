// Host DOM compatibility is deliberately restricted to verified workspace/question markers.
export function createRegionNavigation({ document, window = globalThis, getComputedStyle = window.getComputedStyle?.bind(window), readTarget, readPorts, scrollBackend = 'dom', onChange = () => {} }) {
  let active = null, owner = null, overlay = null, disposed = false, lastTarget = null, lastPorts, lease = null, motion = null;
  let reducedMotion;
  try { reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)'); } catch { /* No media API: retain the bounded fallback. */ }
  const clock = () => window.performance?.now?.();
  const clamp = (value, state) => Math.max(state.min, Math.min(state.max, value));
  // Opt-in, local numbers only. No timers, DOM references, text, callbacks or frame-driven UI updates.
  let diagnostic = null, taskObserver = null;
  const diagnosticTypes = new Set(['input', 'detent', 'frame', 'stop', 'fallback', 'selection', 'geometry', 'longtask', 'longframe']);
  const diagnosticReasons = new Set(['none', 'invalid_event', 'stale', 'context', 'unfocused', 'mode',
    'cancelled', 'cleared', 'target_changed', 'port_changed', 'selection_changed', 'not_scrollable',
    'reversed', 'lease_changed', 'axis_changed', 'external_offset', 'clock_invalid', 'clock_backwards',
    'frame_gap', 'boundary', 'reduced_motion', 'missing_api', 'raf_schedule_failed', 'write_refused',
    'completed', 'exception', 'blur', 'hidden', 'read_failed', 'disposed', 'first_timestamp_rebase']);
  const diagnosticNumbers = ['direction', 'sequence', 'ageMs', 'dtMs', 'position', 'previousPosition',
    'idealPosition', 'target', 'desiredPosition', 'actualPosition', 'offsetPx', 'workMs', 'callbackLagMs',
    'deliveryGapMs', 'queueWaitMs', 'integratedMs', 'startMs', 'durationMs', 'blockingMs',
    'targetMs', 'portsMs', 'validationMs'];
  function stopTaskObserver() {
    const previous = taskObserver; taskObserver = null;
    try { previous?.disconnect(); } catch { /* Optional diagnostics never control scrolling. */ }
  }
  function observeTasks() {
    const capture = diagnostic;
    try {
      const Observer = window.PerformanceObserver;
      const types = Observer?.supportedEntryTypes;
      if (typeof Observer !== 'function' || !Array.isArray(types)) return;
      const wanted = ['longtask', 'long-animation-frame'].filter(type => types.includes(type));
      if (!wanted.length) return;
      taskObserver = new Observer(list => {
        if (diagnostic !== capture || capture.state !== 'recording') return;
        try {
          // Never read attribution, scripts, names, URLs, nodes or cross-origin data.
          // Only entries beginning within this manually armed five-second window.
          for (const entry of list.getEntries().slice(0, 240)) {
            if (diagnostic !== capture || capture.state !== 'recording') break;
            const start = entry.startTime, duration = entry.duration, type = entry.entryType;
            if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 0
              || start < capture.started || start >= capture.started + 5000) continue;
            if (type !== 'longtask' && type !== 'long-animation-frame') continue;
            record(type === 'longtask' ? 'longtask' : 'longframe', { startMs: start - capture.started,
              durationMs: duration, blockingMs: type === 'long-animation-frame' ? entry.blockingDuration : undefined });
          }
        } catch { /* Unsupported/malformed timing entries do not affect motion. */ }
      });
      for (const type of wanted) taskObserver.observe({ type }); // No buffered, pre-capture entries.
    } catch { stopTaskObserver(); }
  }
  function diagnosticClock() {
    try { const value = clock(); return Number.isFinite(value) ? value : null; } catch { return null; }
  }
  function expireDiagnostics(now) {
    if (diagnostic?.state !== 'recording') return;
    if (now === null || now < diagnostic.started || now - diagnostic.started >= 5000) {
      diagnostic.state = 'expired'; stopTaskObserver();
      diagnostic.elapsedMs = now === null ? diagnostic.elapsedMs : Math.max(0, Math.min(5000, now - diagnostic.started));
    }
  }
  function record(type, values = {}) {
    if (diagnostic?.state !== 'recording') return;
    try {
      const now = diagnosticClock(); expireDiagnostics(now);
      if (diagnostic.state !== 'recording' || !diagnosticTypes.has(type)) return;
      const row = { type, tMs: Math.round((now - diagnostic.started) * 1000) / 1000 };
      if (['sessions', 'conversation', 'input', 'options'].includes(active)) row.region = active;
      if (diagnosticReasons.has(values.reason)) row.reason = values.reason;
      if (['received', 'accepted', 'discarded', 'blocked'].includes(values.phase)) row.phase = values.phase;
      for (const key of diagnosticNumbers) {
        const value = values[key];
        if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12)
          row[key] = Math.round(value * 1000) / 1000;
      }
      if (diagnostic.entries.length === 240) { diagnostic.entries.shift(); diagnostic.dropped++; }
      diagnostic.entries.push(row); diagnostic.elapsedMs = row.tMs;
    } catch { /* Sampling must never change input or animation behavior. */ }
  }
  function diagnosticConfig(clockAvailable) {
    if (scrollBackend === 'native') return { durationMs: 5000, maxEntries: 240, backend: 'native', wheelDelta: 120, clockAvailable };
    return { durationMs: 5000, maxEntries: 240, stepPx: 80, tauMs: 45, maxGapMs: 100, maxFrameStepMs: 32, positionTolerancePx: 1,
      reducedMotion: typeof reducedMotion?.matches === 'boolean' ? reducedMotion.matches : null,
      rafAvailable: typeof window.requestAnimationFrame === 'function',
      cancelAvailable: typeof window.cancelAnimationFrame === 'function', clockAvailable };
  }
  function startDiagnostics() {
    const now = diagnosticClock();
    if (disposed || now === null) return false;
    stopTaskObserver();
    diagnostic = { state: 'recording', started: now, elapsedMs: 0, dropped: 0, entries: [], config: diagnosticConfig(true) };
    observeTasks(); return true;
  }
  function stopDiagnostics() {
    stopTaskObserver();
    if (diagnostic?.state !== 'recording') return;
    const now = diagnosticClock(); expireDiagnostics(now);
    if (diagnostic.state === 'recording') {
      diagnostic.state = 'stopped'; diagnostic.elapsedMs = Math.max(0, Math.min(5000, now - diagnostic.started));
    }
  }
  function getDiagnostics() {
    if (!diagnostic) return { version: 1, state: 'idle', elapsedMs: 0, dropped: 0, entries: [], config: diagnosticConfig(diagnosticClock() !== null) };
    const now = diagnosticClock(); expireDiagnostics(now);
    const elapsedMs = diagnostic.state === 'recording' ? Math.max(0, now - diagnostic.started) : diagnostic.elapsedMs;
    return { version: 1, state: diagnostic.state, elapsedMs, dropped: diagnostic.dropped,
      config: { ...diagnostic.config }, entries: diagnostic.entries.map(row => ({ ...row })) };
  }
  function noteInput(values) {
    if (diagnostic?.state !== 'recording') return;
    expireDiagnostics(diagnosticClock());
    if (diagnostic.state !== 'recording') return;
    try {
      record('input', { phase: values?.phase, reason: values?.reason,
        direction: values?.direction === 1 || values?.direction === -1 ? values.direction : undefined,
        sequence: Number.isSafeInteger(values?.sequence) && values.sequence >= 0 ? values.sequence : undefined,
        ageMs: values?.ageMs });
    } catch { /* A malformed diagnostic-only row cannot affect input routing. */ }
  }
  function stopMotion(reason = 'cancelled') {
    const previous = motion; motion = null;
    if (previous) record('stop', { reason, direction: previous.direction, position: previous.lastTop, target: previous.to });
    if (previous && previous.frame !== null) {
      const frame = previous.frame; previous.frame = null;
      try { window.cancelAnimationFrame?.(frame); } catch { /* Identity checks also revoke an already-running callback. */ }
    }
  }
  function scrollState(element) {
    try {
      const extent = element.scrollHeight - element.clientHeight, top = element.scrollTop;
      if (!Number.isFinite(extent) || extent <= 0 || !Number.isFinite(top)) return null;
      const reversed = getComputedStyle?.(element)?.flexDirection === 'column-reverse';
      return { top, reversed, min: reversed ? -extent : 0, max: reversed ? 0 : extent };
    } catch { return null; }
  }
  function writePosition(element, top, current) {
    // Only our RAF interpolates. Never start a second, browser-owned smooth animation.
    if (typeof element.scrollBy === 'function') element.scrollBy({ top: top - current, behavior: 'instant' });
    else element.scrollTop = top;
  }
  function queueFrame(current) {
    if (motion !== current) return false;
    if (current.frame !== null) return true;
    try {
      current.queuedAt = diagnostic?.state === 'recording' ? diagnosticClock() : null;
      current.frame = window.requestAnimationFrame(at => animate(current, at)); return true;
    }
    catch { if (motion === current) stopMotion('raf_schedule_failed'); return false; }
  }
  function recordFrame(current, at, started, state, desiredPosition, actualPosition, reason = 'none', deliveredAt) {
    if (started === null) return;
    const finished = diagnosticClock();
    record('frame', { reason, direction: current.direction, dtMs: at - current.at,
      position: state?.top, previousPosition: current.lastTop, idealPosition: current.position,
      target: current.to, desiredPosition, actualPosition, offsetPx: state ? state.top - current.lastTop : undefined,
      workMs: finished === null ? undefined : finished - started, callbackLagMs: started - at,
      queueWaitMs: current.queuedAt === null ? undefined : started - current.queuedAt,
      deliveryGapMs: deliveredAt === undefined ? undefined : deliveredAt - current.deliveredAt,
      integratedMs: reason === 'none' && deliveredAt !== undefined ? Math.min(at - current.at, deliveredAt - current.deliveredAt, 32) : undefined,
      ...current.timings });
  }
  function animate(current, at) {
    if (motion !== current) return;
    current.frame = null;
    const diagnosticStarted = diagnostic?.state === 'recording' ? diagnosticClock() : null;
    try {
      const target = readTarget ? readTarget() : lastTarget;
      const targetAt = diagnosticStarted === null ? null : diagnosticClock();
      const ports = readPorts ? readPorts(target) : lastPorts;
      const portsAt = targetAt === null ? null : diagnosticClock();
      const matched = !reducedMotion?.matches && reconcile(target, ports, false);
      const validationAt = portsAt === null ? null : diagnosticClock();
      current.timings = validationAt === null ? undefined : { targetMs: targetAt - diagnosticStarted,
        portsMs: portsAt - targetAt, validationMs: validationAt - portsAt };
      if (!matched || motion !== current || lease !== current.lease) {
        if (motion === current) stopMotion(reducedMotion?.matches ? 'reduced_motion' : 'target_changed'); return;
      }
      const element = current.lease.element, state = scrollState(element), elapsed = at - current.at;
      // RAF's timestamp is shared by the entire rendering opportunity. Earlier
      // callbacks may block it for hundreds of ms: it is not the delivery clock.
      // Check after live DOM validation too, so our own work cannot age a write.
      const deliveredAt = clock(), deliveryGap = deliveredAt - current.deliveredAt;
      if (!state || state.reversed !== current.reversed || Math.abs(state.top - current.lastTop) > 1
        || !Number.isFinite(elapsed) || at < 0 || !Number.isFinite(deliveryGap) || deliveredAt < 0
        || elapsed > 100 || deliveryGap < 0 || deliveryGap > 100 || deliveredAt - at > 100) {
        const reason = !state ? 'not_scrollable' : state.reversed !== current.reversed ? 'axis_changed'
          : Math.abs(state.top - current.lastTop) > 1 ? 'external_offset'
            : !Number.isFinite(elapsed) || at < 0 || !Number.isFinite(deliveryGap) || deliveredAt < 0 ? 'clock_invalid'
              : deliveryGap < 0 ? 'clock_backwards' : 'frame_gap';
        recordFrame(current, at, diagnosticStarted, state, undefined, undefined, reason, deliveredAt);
        stopMotion(reason); return;
      }
      // The first RAF timestamp can precede performance.now() at dispatch by a
      // fraction of a frame. Establish its origin without dropping the detent;
      // a clock regression after animation has begun still cancels old travel.
      if (elapsed < 0) {
        recordFrame(current, at, diagnosticStarted, state, undefined, undefined, current.started || elapsed < -32 ? 'clock_backwards' : 'first_timestamp_rebase');
        if (current.started || elapsed < -32) stopMotion('clock_backwards');
        else { current.at = at; current.deliveredAt = deliveredAt; queueFrame(current); }
        return;
      }
      if (elapsed === 0) { recordFrame(current, at, diagnosticStarted, state); queueFrame(current); return; }
      current.started = true;
      current.to = clamp(current.to, state);
      // Time-based exponential ease-out: bursts extend one destination without
      // restarting easing; fractional progress survives DOM pixel rounding.
      // A timely but uneven frame must not spend its entire missed interval in
      // one visible jump. Discard excess integration time; never queue catch-up.
      const integrated = Math.min(elapsed, deliveryGap, 32);
      let next = clamp(current.to + (current.position - current.to) * Math.exp(-integrated / 45), state);
      if (Math.abs(current.to - next) <= 0.5) next = current.to;
      if (motion !== current || lease !== current.lease || !element.isConnected) return;
      writePosition(element, next, state.top);
      if (motion !== current) return;
      const actual = element.scrollTop;
      recordFrame(current, at, diagnosticStarted, state, next, actual, 'none', deliveredAt);
      if (!Number.isFinite(actual) || Math.abs(actual - state.top) < 0.01 && Math.abs(next - state.top) >= 1) { stopMotion('write_refused'); return; }
      current.position = next; current.lastTop = actual; current.at = at; current.deliveredAt = deliveredAt;
      if (next === current.to || Math.abs(actual - current.to) <= 0.5) stopMotion('completed');
      else queueFrame(current);
    } catch { if (motion === current) stopMotion('exception'); }
  }
  const all = (root, selector) => Array.from(root?.querySelectorAll?.(selector) ?? []);
  const same = (a, b) => Boolean(a && b && a.sessionId === b.sessionId && a.binding === b.binding
    && a.sessionOwner === b.sessionOwner && a.pending === b.pending && a.pendingKey === b.pendingKey);
  function valid(target) {
    try {
      if (disposed || target?.focused !== true || !target.sessionId || !target.binding || !target.sessionOwner
        || document.visibilityState !== 'visible' || document.hasFocus?.() !== true) return false;
      const current = readTarget ? readTarget() : target;
      return current?.focused === true && same(target, current);
    } catch { return false; }
  }
  function renderedRect(element) {
    try {
    if (!element?.isConnected || element.disabled || element.getAttribute?.('aria-disabled') === 'true'
      || element.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle?.(node);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.opacity === '0') return false;
    }
    if (!element.getClientRects?.().length) return false;
    const r = element.getBoundingClientRect?.();
    if (!r) return false;
    return r.width > 0 && r.height > 0 ? r : null;
    } catch { return null; }
  }
  const rendered = element => Boolean(renderedRect(element));
  function visible(element) {
    const r = renderedRect(element);
    if (!r) return false;
    return r.bottom > 0 && r.right > 0 && r.top < (window.innerHeight ?? Infinity) && r.left < (window.innerWidth ?? Infinity);
  }
  function clear(reason = 'cleared') {
    const changed = active !== null;
    stopMotion(reason);
    if (changed) record('selection', { reason });
    overlay?.remove(); overlay = null; active = null; owner = null; lease = null;
    if (changed) onChange();
  }
  function question(target) {
    const p = target.pending;
    if (p?.kind !== 'question' || p.sessionId !== target.sessionId || !p.key || p.key !== target.pendingKey || p.review !== undefined) return null;
    let state;
    try { state = p.getSnapshot?.(); } catch { return null; }
    if (state?.closed !== false || !['open', 'continued'].includes(state.state) || !['waterfall', 'rpc'].includes(state.channel)) return null;
    const cards = all(document, '[data-question-key]').filter(el => el.getAttribute('data-question-key') === p.key && visible(el));
    return cards.length === 1 ? cards[0] : null;
  }
  function candidates(target, { input, conversation } = {}, only = null) {
    const result = [];
    // Rotation/frames validate only their selected family. Cycling still discovers
    // the complete ordered list; no DOM identity/visibility survives this call.
    if (only === null || only === 'sessions') {
    // Workspace AnimatedRows uses role=tree and stable row keys. A collapsed,
    // filtered or offscreen current session must not remove the whole list.
    const scrollAncestor = start => {
      for (let node = start; node && node !== document.body; node = node.parentElement) {
        let style;
        try { style = getComputedStyle?.(node); } catch { return null; }
        if (/^(auto|scroll|overlay)$/.test(style?.overflowY ?? '') && visible(node)) return node;
      }
      return null;
    };
    const trees = all(document, '[role="tree"]').filter(tree => visible(tree)
      && (typeof tree.querySelector === 'function'
        ? Boolean(tree.querySelector('[data-row-key^="session:"], [data-row-key^="workspace:"], [data-row-key^="overflow:"], [data-row-key="empty"]'))
        : all(tree, '[data-row-key]').some(row => /^(session:|workspace:|overflow:|empty$)/.test(row.getAttribute('data-row-key') ?? ''))));
    const treePorts = [...new Set(trees.map(scrollAncestor).filter(Boolean))];
    // Compatibility with older hosts without the tree marker; row geometry is
    // irrelevant, but its actual visible scroll container must be unambiguous.
    const currentRows = treePorts.length === 0
      ? all(document, '[data-row-key]').filter(el => el.isConnected && el.getAttribute('data-row-key') === `session:${target.sessionId}`) : [];
    const sidebar = treePorts.length === 1 ? treePorts[0]
      : treePorts.length === 0 && currentRows.length === 1 ? scrollAncestor(currentRows[0].parentElement) : null;
    if (sidebar) result.push({ id: 'sessions', label: '会话列表', element: sidebar });
    }
    if (only === null || only === 'conversation') {
      const port = conversation?.port ?? conversation ?? target.scrollPort;
      if (visible(port)) result.push({ id: 'conversation', label: '对话', element: port });
    }
    if (only === 'sessions' || only === 'conversation') return result;
    const card = question(target);
    if (card) {
      // Offscreen inside the host answer scrollport is not hidden. Keep both
      // regions reachable, then reveal only within that scrollport on entry.
      const scrolls = all(card, '[data-question-scroll]').filter(visible);
      const viewport = scrolls.length === 1 ? scrolls[0] : null;
      const fields = all(card, '[data-question-scroll] textarea').filter(rendered);
      if (fields.length === 1) result.push({ id: 'input', label: '自定义输入', element: fields[0], viewport });
      const groups = all(card, '[data-question-scroll] [role="radiogroup"], [data-question-scroll] [role="group"]').filter(rendered);
      if (groups.length === 1) {
        const options = all(groups[0], 'button[type="button"][role="radio"][aria-checked], button[type="button"][role="checkbox"][aria-checked]')
          .filter(el => (el.parentElement === groups[0]
            || typeof el.parentElement?.getAttribute === 'function' && el.parentElement.getAttribute('data-option-row') !== null
              && el.parentElement.parentElement === groups[0]) && rendered(el));
        if (options.length) result.push({ id: 'options', label: '选项', element: groups[0], options, viewport });
      }
    } else if (!target.pending && visible(input)) result.push({ id: 'input', label: '输入', element: input });
    return result;
  }
  function reveal(element, viewport) {
    if (!viewport || !visible(viewport)) return;
    const r = element.getBoundingClientRect(), box = viewport.getBoundingClientRect();
    const delta = r.top < box.top ? r.top - box.top : r.bottom > box.bottom ? r.bottom - box.bottom : 0;
    if (delta && typeof viewport.scrollBy === 'function') viewport.scrollBy({ top: delta, behavior: 'instant' });
    else if (delta) viewport.scrollTop += delta;
  }
  function paint(region) {
    if (!region || !document.body) return;
    const highlighted = region.options?.find(option => option === document.activeElement) ?? region.element;
    const r = highlighted.getBoundingClientRect();
    const fresh = !overlay;
    if (fresh) {
      overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
        boxSizing: 'border-box', border: '2px solid #3b82f6', borderRadius: '6px' });
    }
    // Repeated polls and our own scroll events must not rewrite identical styles
    // and label text, dirtying layout immediately before the next validation.
    if (overlay.getAttribute('data-au05-region') !== region.id) overlay.setAttribute('data-au05-region', region.id);
    const geometry = { left: `${Math.max(0, r.left)}px`, top: `${Math.max(0, r.top)}px`,
      width: `${Math.min(r.right, window.innerWidth ?? r.right) - Math.max(0, r.left)}px`,
      height: `${Math.min(r.bottom, window.innerHeight ?? r.bottom) - Math.max(0, r.top)}px` };
    for (const [key, value] of Object.entries(geometry)) if (overlay.style[key] !== value) overlay.style[key] = value;
    const label = fresh ? document.createElement('span') : overlay.children[0];
    if (label.textContent !== region.label) label.textContent = region.label;
    if (fresh) Object.assign(label.style, { position: 'absolute', top: '0', left: '0', right: 'auto', bottom: 'auto',
      display: 'block', margin: '0', width: 'max-content', whiteSpace: 'nowrap', textAlign: 'left', writingMode: 'horizontal-tb',
      color: '#fff', background: '#1d4ed8', padding: '2px 6px', font: '12px/18px sans-serif', borderRadius: '4px 4px 0 0' });
    const transform = r.top >= 24 ? 'translateY(-100%)' : 'none';
    if (label.style.transform !== transform) label.style.transform = transform;
    if (fresh) { overlay.appendChild(label); document.body.appendChild(overlay); }
  }
  function resolveRegion(target, ports, paintRegion = true) {
    if (!valid(target) || owner && !same(owner, target)) { clear('target_changed'); return null; }
    lastTarget = target; lastPorts = ports;
    if (!active) return null;
    const region = candidates(target, ports, active).find(item => item.id === active);
    if (!region || region.element !== lease?.element) { clear('port_changed'); return null; }
    if (paintRegion) paint(region);
    return region;
  }
  function reconcile(target, ports, paintRegion = true) {
    return Boolean(resolveRegion(target, ports, paintRegion));
  }
  function currentScroll(target, ports) {
    if (!reconcile(target, ports) || active === 'options') return null;
    return lease;
  }
  function cycle(target, ports) {
    if (!valid(target)) { clear(); return false; }
    if (owner && !same(owner, target)) clear();
    lastTarget = target; lastPorts = ports;
    const list = candidates(target, ports);
    if (!list.length) { clear(); return false; }
    const index = list.findIndex(item => item.id === active);
    const region = list[(index + 1) % list.length];
    stopMotion('selection_changed');
    active = region.id; owner = { ...target }; lease = { id: region.id, element: region.element };
    record('selection', { reason: 'selection_changed' });
    onChange();
    const focus = region.options?.find(option => option.getAttribute('aria-checked') === 'true') ?? region.options?.[0]
      ?? (region.id === 'input' ? region.element : null);
    if (focus) { reveal(focus, region.viewport); focus.focus?.({ preventScroll: true }); }
    paint(region);
    return true;
  }
  function rotate(target, direction, ports) {
    const region = resolveRegion(target, ports);
    if (!region || !Number.isFinite(direction) || direction === 0) return false;
    const selected = lease;
    if (region.options) {
      const options = region.options;
      let index = options.indexOf(document.activeElement);
      if (index < 0) index = options.findIndex(el => el.getAttribute('aria-checked') === 'true');
      const next = index < 0 ? (direction > 0 ? 0 : options.length - 1) : (index + Math.sign(direction) + options.length) % options.length;
      // Host onKeyDown(Enter) submits; focus only, never synthesize keys/clicks here.
      reveal(options[next], region.viewport);
      options[next].focus?.({ preventScroll: true });
      paint(region);
      return document.activeElement === options[next];
    }
    // Production uses the existing native wheel bridge. Never accidentally fall
    // back to DOM animation or a synthetic wheel when that transport refuses.
    if (scrollBackend === 'native') return false;
    const el = region.element, sign = Math.sign(direction);
    if (!scrollState(el)) { stopMotion('not_scrollable'); return false; }
    // Brake before dispatching host wheel intent: even reentrant listeners must
    // not get one last forward frame after an opposite detent.
    if (motion && motion.direction !== sign) stopMotion('reversed');
    // Current DSH ChatViewport listens for wheel intent on this exact outer
    // port to cancel both native follow animation and pending fold-to-tail.
    // A DOM position write alone is ignored while follow.animating is true.
    // Dispatch on the port, never a child composer (its wheel handler scrolls
    // separately). Synthetic wheel has no browser default scroll; we apply it
    // below. This is a verified host compatibility path, not a public API.
    if (region.id === 'conversation' && typeof el.getAttribute === 'function' && el.getAttribute('data-conversation-scroll') !== null) {
      const Wheel = el.ownerDocument?.defaultView?.WheelEvent ?? window.WheelEvent;
      if (typeof Wheel !== 'function' || typeof el.dispatchEvent !== 'function') return false;
      try { el.dispatchEvent(new Wheel('wheel', { bubbles: true, cancelable: true, deltaY: Math.sign(direction) * 80, deltaMode: 0 })); }
      catch { return false; }
      // Host listeners can synchronously clear/cycle the selection or replace
      // its element. Never apply the old detent to a revoked selection.
      if (lease !== selected || !reconcile(target, ports) || lease !== selected
        || !el.isConnected || !Number.isFinite(el.scrollTop)) return false;
    }
    const state = scrollState(el);
    if (!state || lease !== selected) { stopMotion(state ? 'lease_changed' : 'not_scrollable'); return false; }
    let at;
    try { at = clock(); } catch { /* A missing monotonic clock uses the instant fallback. */ }
    if (reducedMotion?.matches || typeof window.requestAnimationFrame !== 'function'
      || typeof window.cancelAnimationFrame !== 'function' || !Number.isFinite(at)) {
      const reason = reducedMotion?.matches ? 'reduced_motion' : 'missing_api';
      stopMotion(reason); writePosition(el, clamp(state.top + sign * 80, state), state.top);
      record('fallback', { reason, direction: sign, position: state.top, target: clamp(state.top + sign * 80, state) }); return true;
    }
    if (motion && (motion.lease !== selected || motion.reversed !== state.reversed
      || Math.abs(state.top - motion.lastTop) > 1 || at - motion.deliveredAt < 0 || at - motion.deliveredAt > 100)) {
      const reason = motion.lease !== selected ? 'lease_changed' : motion.reversed !== state.reversed ? 'axis_changed'
        : Math.abs(state.top - motion.lastTop) > 1 ? 'external_offset' : at - motion.deliveredAt < 0 ? 'clock_backwards' : 'frame_gap';
      stopMotion(reason);
    }
    const to = clamp((motion ? motion.to : state.top) + sign * 80, state);
    record('detent', { direction: sign, position: state.top, target: to });
    if (to === state.top) { stopMotion('boundary'); return true; }
    if (motion) { motion.to = to; return queueFrame(motion); }
    const current = { lease: selected, direction: sign, reversed: state.reversed,
      to, position: state.top, lastTop: state.top, at, deliveredAt: at, frame: null, started: false };
    motion = current;
    return queueFrame(current);
  }
  function commitSelection(target, ports) {
    const region = resolveRegion(target, ports);
    if (!region || active !== 'options') return false;
    const option = region?.options.find(el => el === document.activeElement);
    if (!option || !valid(target)) return false;
    // Verified host footer: pager div contains Prev, numeric progress span, Next.
    // Single-choice choose() auto-advances except on the last question.
    const card = question(target);
    const pagers = all(card, 'section > footer > div:first-child > span');
    const buttons = all(card, 'section > footer button');
    const progress = pagers.length === 1 ? /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(pagers[0].textContent ?? '') : null;
    const final = option.getAttribute('role') === 'radio' && buttons.length === 4
      && progress && Number(progress[1]) > 0 && Number(progress[1]) === Number(progress[2])
      && buttons[1].disabled === true;
    option.click();
    return final ? 'selected' : 'advanced';
  }
  const onBlur = () => clear('blur');
  const onVisibility = () => { if (document.visibilityState !== 'visible') clear('hidden'); };
  const onGeometry = () => {
    if (!active) return;
    const started = diagnostic?.state === 'recording' ? diagnosticClock() : null;
    try {
      const target = readTarget ? readTarget() : lastTarget;
      reconcile(target, readPorts ? readPorts(target) : lastPorts);
    } catch { clear('read_failed'); }
    if (started !== null) {
      const finished = diagnosticClock(); record('geometry', { workMs: finished === null ? undefined : finished - started });
    }
  };
  const onReducedMotion = () => { if (reducedMotion?.matches) stopMotion('reduced_motion'); };
  reducedMotion?.addEventListener?.('change', onReducedMotion);
  window.addEventListener?.('blur', onBlur);
  window.addEventListener?.('resize', onGeometry);
  document.addEventListener?.('visibilitychange', onVisibility);
  document.addEventListener?.('scroll', onGeometry, true);
  function dispose() {
    clear('disposed'); stopDiagnostics(); disposed = true;
    window.removeEventListener?.('blur', onBlur);
    window.removeEventListener?.('resize', onGeometry);
    document.removeEventListener?.('visibilitychange', onVisibility);
    document.removeEventListener?.('scroll', onGeometry, true);
    reducedMotion?.removeEventListener?.('change', onReducedMotion);
  }
  return { cycle, rotate, reconcile, currentScroll, commitSelection, clear, dispose,
    startDiagnostics, stopDiagnostics, getDiagnostics, noteInput, get activeId() { return active; } };
}
