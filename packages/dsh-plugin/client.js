// Official external-client lazy module. Hardware starts only on an explicit connection.
window.__ModuleLoader__.load({
  id: '@abworks/dsh-plugin-au05',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    /* AU05_REGIONS_BEGIN */
// Host DOM compatibility is deliberately restricted to verified workspace/question markers.
function createRegionNavigation({ document, window = globalThis, getComputedStyle = window.getComputedStyle?.bind(window), readTarget, readPorts, scrollBackend = 'dom', onChange = () => {} }) {
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
/* AU05_REGIONS_END */
/* AU05_APPLICATION_ADAPTER_BEGIN */
// Inlined into the browser client by scripts/build-plugin.mjs; no extra runtime dependency.
function createDshApplication({ ctx, document, focusBridges, resolveScroll, answered = new WeakMap(), invoke }) {
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
/* AU05_APPLICATION_ADAPTER_END */
    /* AU05_VOICE_ADAPTER_BEGIN */
// Inlined into the browser client by scripts/build-plugin.mjs; no extra runtime dependency.
function createVoiceAdapter({ speech, onChange = () => {}, isCurrent = () => false,
  media = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
  Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let enabled = false, phase = 'disabled', error = null, provider = null, language = null;
  let maxBytes = 4 * 1024 * 1024, maxSeconds = 120, epoch = 0, disposed = false;
  let microphoneId = null, microphones = [], microphoneError = null, microphonesKnown = false;
  let preparing = false, enumeration = 0, trackListeners = [];
  let stream = null, recorder = null, audio = null, timer = null, target = null, insertion = null;
  let chunks = [], chunkBytes = 0, stopped = null, releaseStop = null, finishPromise = null, controller = null, conflictText = '';
  const microphoneErrors = ['voice_microphone_missing', 'voice_microphone_mismatch', 'voice_microphone_unavailable', 'voice_microphone_denied'];
  const snapshot = () => ({ enabled, phase, error, providerName: provider?.name ?? '', location: provider?.location ?? null, conflictText,
    microphoneId, microphones: microphones.map(item => ({ ...item })), microphoneError,
    ready: enabled && phase === 'ready' && !microphoneError, preparing, prepared: provider !== null });
  const publish = () => { if (!disposed) onChange(snapshot()); };
  const stopTracks = value => { for (const track of value?.getTracks?.() ?? []) { try { track.stop(); } catch {} } };
  const detachTracks = () => { for (const remove of trackListeners) remove(); trackListeners = []; };
  const cleanRecording = () => {
    clearTimeout(timer); timer = null; detachTracks();
    if (recorder) { recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null;
      if (recorder.state !== 'inactive') { try { recorder.stop(); } catch {} } }
    releaseStop?.(); releaseStop = null;
    recorder = null; stopTracks(stream); stream = null; chunks = []; chunkBytes = 0; stopped = null;
    if (audio) { try { void Promise.resolve(audio.close()).catch(() => {}); } catch {} audio = null; }
  };
  const cancel = () => {
    epoch++; enumeration++; controller?.abort(); controller = null; cleanRecording(); target = null; insertion = null;
    finishPromise = null; preparing = false; phase = enabled ? (microphoneError ? 'error' : 'ready') : 'disabled';
    error = microphoneError; conflictText = ''; publish();
  };
  const fail = code => {
    if (microphoneErrors.includes(code)) microphoneError = code;
    cancel(); phase = 'error'; error = code; publish();
  };
  const valid = generation => !disposed && epoch === generation;
  const current = generation => valid(generation) && enabled && target !== null && isCurrent(target);
  const ok = result => result?.ok === true && result.value !== null && typeof result.value === 'object';
  const supported = () => speech?.catalog && speech?.transcribe && media?.getUserMedia && Recorder && Audio;
  const concrete = id => id !== null && id !== 'default';
  const constraints = recording => ({ audio: { channelCount: 1, ...(recording ? { sampleRate: 16000 } : {}), echoCancellation: true,
    ...(microphoneId !== null ? { deviceId: { exact: microphoneId } } : {}) }, video: false });
  const audioTracks = value => value?.getAudioTracks?.() ?? value?.getTracks?.() ?? [];
  const trackDeviceId = value => {
    for (const track of audioTracks(value)) { try { const id = track.getSettings?.().deviceId; if (typeof id === 'string' && id) return id; } catch {} }
    return null;
  };
  const verifyStream = (value, selectedId) => {
    for (const track of audioTracks(value)) {
      if (track.readyState === 'ended') throw new Error('voice_microphone_missing');
      let id; try { id = track.getSettings?.().deviceId; } catch {}
      // The OS-default alias resolves to a physical ID; only physical selections can be compared literally.
      if (concrete(selectedId) && id && id !== selectedId) throw new Error('voice_microphone_mismatch');
    }
  };
  const mediaFailure = (failure, fallback) => microphoneErrors.includes(failure?.message) ? failure.message
    : ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(failure?.name) ? 'voice_microphone_missing'
      : ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(failure?.name) ? 'voice_microphone_denied' : fallback;
  const selectionError = () => !media?.enumerateDevices
    ? (microphoneId === null ? null : 'voice_microphone_unavailable')
    : microphonesKnown && microphoneId !== null && !microphones.some(item => item.deviceId === microphoneId) ? 'voice_microphone_missing' : null;
  const autoMicrophone = (devices, actualId) => {
    const physical = devices.filter(item => item.deviceId && !['default', 'communications'].includes(item.deviceId));
    const preferred = physical.find(item => /(?:^|[^a-z0-9])au[\s_-]?05(?:[^a-z0-9]|$)/i.test(item.label));
    if (preferred) return preferred.deviceId;
    const actual = physical.find(item => item.deviceId === actualId);
    if (actual) return actual.deviceId;
    const system = devices.find(item => item.deviceId === 'default');
    // Do not pin a blank-label pre-permission catalog before AU05 can be recognized.
    const resolved = system?.label && physical.find(item => item.label && ((system.groupId && item.groupId === system.groupId)
      || system.label === item.label || system.label.endsWith(` - ${item.label}`)));
    return resolved?.deviceId ?? null;
  };
  const loadMicrophones = async (generation, { actualId = null, owned = false } = {}) => {
    const request = ++enumeration;
    if (!media?.enumerateDevices) {
      microphones = []; microphonesKnown = false; microphoneError = selectionError(); publish();
      if (microphoneError) throw new Error(microphoneError);
      return true;
    }
    let devices;
    try { devices = await media.enumerateDevices(); }
    catch { if (valid(generation) && request === enumeration) throw new Error('voice_microphone_unavailable'); return false; }
    if (!valid(generation) || request !== enumeration) return false;
    devices = Array.from(devices ?? []).filter(item => item.kind === 'audioinput' && typeof item.deviceId === 'string' && item.deviceId);
    microphones = devices.map(item => ({ deviceId: item.deviceId, label: typeof item.label === 'string' ? item.label : '' }));
    microphonesKnown = true;
    if (microphoneId === null) {
      const selected = autoMicrophone(devices, actualId);
      if (selected !== null) { microphoneId = selected; if (!owned && target !== null) cancel(); }
    }
    microphoneError = selectionError();
    if (microphoneError) { fail(microphoneError); return false; }
    if (microphoneErrors.includes(error)) { error = null; if (enabled && phase === 'error') phase = 'ready'; }
    publish(); return true;
  };
  const prepareCatalog = async generation => {
    if (provider) return true;
    const catalog = await speech.catalog();
    if (!valid(generation)) return false;
    if (!ok(catalog)) throw new Error('voice_not_configured');
    const selected = catalog.value.providers?.find(item => item.id === catalog.value.selection?.providerId);
    if (!selected || !['ready', 'standby', 'waking'].includes(selected.preparation?.phase)) throw new Error('voice_not_configured');
    if (!Number.isSafeInteger(catalog.value.maxAudioBytes) || catalog.value.maxAudioBytes < 46
      || !Number.isFinite(catalog.value.maxDurationSeconds) || catalog.value.maxDurationSeconds <= 0) throw new Error('voice_invalid_catalog');
    provider = { id: selected.id, name: selected.name, location: selected.location };
    language = catalog.value.selection.language;
    maxBytes = Math.min(catalog.value.maxAudioBytes, 4 * 1024 * 1024);
    maxSeconds = Math.min(catalog.value.maxDurationSeconds, 120, (maxBytes - 44) / 32000);
    return true;
  };
  const preparationFailure = (failure, fallback) => ['voice_not_configured', 'voice_invalid_catalog'].includes(failure?.message)
    ? failure.message : mediaFailure(failure, fallback);
  const api = {
    snapshot,
    // Settings hydration is deliberately synchronous and does not probe any browser or speech API.
    restore({ enabled: desired = false, microphoneId: selected = null } = {}) {
      if (disposed) return snapshot();
      enabled = desired === true; microphoneId = typeof selected === 'string' && selected ? selected : null;
      microphones = []; microphonesKnown = false; microphoneError = null; provider = null; language = null;
      cancel(); return snapshot();
    },
    async refreshMicrophones() {
      if (disposed) return snapshot();
      const generation = epoch;
      try { await loadMicrophones(generation); }
      catch (failure) { if (valid(generation)) fail(mediaFailure(failure, 'voice_microphone_unavailable')); }
      return snapshot();
    },
    selectMicrophone(deviceId) {
      if (disposed || (deviceId !== null && (typeof deviceId !== 'string' || !deviceId))) return false;
      if (microphoneId === deviceId) return true;
      microphoneId = deviceId; microphoneError = selectionError(); cancel(); return true;
    },
    async enable() {
      if (disposed) return false;
      enabled = false; cancel(); provider = null; language = null; const generation = epoch;
      if (!supported()) { fail('voice_unavailable'); return false; }
      preparing = true; publish();
      let permissionStream;
      try {
        if (!await prepareCatalog(generation) || !await loadMicrophones(generation, { owned: true })) return false;
        if (!valid(generation)) return false;
        const selectedId = microphoneId;
        permissionStream = await media.getUserMedia(constraints(false));
        if (!valid(generation)) return false;
        verifyStream(permissionStream, selectedId);
        const actualId = trackDeviceId(permissionStream);
        stopTracks(permissionStream); permissionStream = null;
        // Permission unlocks labels. Prefer AU05 once, then keep the chosen physical ID pinned.
        if (!await loadMicrophones(generation, { actualId, owned: true }) || !valid(generation)) return false;
        enabled = true; preparing = false; phase = 'ready'; error = null; microphoneError = null; publish(); return true;
      } catch (failure) {
        if (!valid(generation)) return false;
        enabled = false; fail(preparationFailure(failure, 'voice_microphone_denied')); return false;
      } finally {
        stopTracks(permissionStream);
        if (valid(generation)) { preparing = false; publish(); }
      }
    },
    disable() { enabled = false; cancel(); provider = null; language = null; publish(); },
    cancel,
    async start(value) {
      if (disposed || !enabled || !['ready', 'error'].includes(phase) || conflictText || !isCurrent(value)
        || !value?.inputActions?.captureInsertion || !value?.inputActions?.insertText) return false;
      cancel(); target = value; const generation = epoch;
      try { insertion = target.inputActions.captureInsertion(); } catch { fail('voice_insertion_unavailable'); return false; }
      if (!supported()) { fail('voice_unavailable'); return false; }
      phase = 'recording'; preparing = true; publish();
      let acquired;
      try {
        if (!await prepareCatalog(generation) || !current(generation)) return false;
        if (!await loadMicrophones(generation, { owned: true }) || !current(generation)) return false;
        let selectedId = microphoneId;
        acquired = await media.getUserMedia(constraints(true));
        if (!current(generation) || phase !== 'recording') return false;
        verifyStream(acquired, selectedId);
        if (selectedId === null && media?.enumerateDevices) {
          if (!await loadMicrophones(generation, { actualId: trackDeviceId(acquired), owned: true }) || !current(generation)) return false;
          // A restored first-use start may unlock AU05 labels on its first acquisition. Never record a different input under the pinned ID.
          if (microphoneId !== null && trackDeviceId(acquired) !== microphoneId) {
            stopTracks(acquired); acquired = null; selectedId = microphoneId;
            acquired = await media.getUserMedia(constraints(true));
            if (!current(generation) || phase !== 'recording') return false;
            verifyStream(acquired, selectedId);
          }
        }
        stream = acquired; acquired = null;
        for (const track of audioTracks(stream)) {
          const ended = () => { if (current(generation)) fail('voice_microphone_missing'); };
          if (track.addEventListener) { track.addEventListener('ended', ended); trackListeners.push(() => track.removeEventListener?.('ended', ended)); }
          else { const previous = track.onended; track.onended = ended; trackListeners.push(() => { if (track.onended === ended) track.onended = previous; }); }
        }
        recorder = new Recorder(stream);
        stopped = new Promise((resolveStop, rejectStop) => {
          releaseStop = resolveStop; recorder.onstop = resolveStop;
          recorder.onerror = () => rejectStop(new Error('voice_recording_failed'));
        });
        // Recording errors may precede key release; retain rejection for finish without an unhandled promise.
        stopped.catch(() => { if (current(generation)) fail('voice_recording_failed'); });
        recorder.ondataavailable = event => {
          if (!current(generation) || !event.data?.size) return;
          chunkBytes += event.data.size;
          if (chunkBytes > maxBytes) { fail('voice_audio_limit'); return; }
          chunks.push(event.data);
        };
        recorder.start(250); preparing = false; publish();
        timer = setTimeout(() => { if (current(generation)) fail('voice_duration_limit'); }, maxSeconds * 1000);
        return true;
      } catch (failure) {
        if (current(generation)) fail(preparationFailure(failure, 'voice_recording_failed'));
        return false;
      } finally {
        stopTracks(acquired);
        if (valid(generation) && preparing) { preparing = false; cancel(); }
      }
    },
    finish() {
      if (finishPromise) return finishPromise;
      if (disposed || phase !== 'recording') return Promise.resolve(false);
      if (!recorder || !target || !isCurrent(target)) { cancel(); return Promise.resolve(false); }
      const generation = epoch, capturedTarget = target, capturedInsertion = insertion, stopPromise = stopped;
      clearTimeout(timer); timer = null;
      phase = 'transcribing'; publish();
      finishPromise = (async () => {
        try {
          recorder.stop(); await stopPromise;
          if (!current(generation)) return false;
          detachTracks(); stopTracks(stream); stream = null; recorder = null; releaseStop = null;
          const blob = new Blob(chunks); chunks = [];
          if (!blob.size) throw new Error('voice_empty_audio');
          const decodingAudio = new Audio(); audio = decodingAudio;
          const decoded = await decodingAudio.decodeAudioData(await blob.arrayBuffer());
          if (!current(generation)) return false;
          const samples = Math.floor(decoded.duration * 16000);
          if (samples < 1 || decoded.duration > maxSeconds + 0.1 || 44 + samples * 2 > maxBytes) throw new Error('voice_audio_limit');
          const wave = new ArrayBuffer(44 + samples * 2), view = new DataView(wave);
          const ascii = (offset, text) => { for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index)); };
          ascii(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
          view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
          view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
          ascii(36, 'data'); view.setUint32(40, samples * 2, true);
          const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
          for (let index = 0; index < samples; index++) {
            const position = index * decoded.sampleRate / 16000, first = Math.min(Math.floor(position), decoded.length - 1), second = Math.min(first + 1, decoded.length - 1);
            const fraction = position - first;
            let value = 0;
            for (const channel of channels) value += channel[first] * (1 - fraction) + channel[second] * fraction;
            value = Math.max(-1, Math.min(1, value / channels.length));
            view.setInt16(44 + index * 2, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
          }
          await decodingAudio.close(); if (audio === decodingAudio) audio = null;
          if (!current(generation)) return false;
          const bytes = new Uint8Array(wave); let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          controller = new AbortController();
          const result = await speech.transcribe({ audioBase64: btoa(binary), providerId: provider.id, ...(language ? { language } : {}) }, controller.signal);
          if (!current(generation)) return false;
          if (!ok(result) || typeof result.value.text !== 'string' || !result.value.text.trim()) throw new Error('voice_transcription_failed');
          if (result.value.text.length > 100000) throw new Error('voice_text_limit');
          const inserted = capturedTarget.inputActions.insertText(result.value.text, capturedInsertion);
          if (inserted !== true) { conflictText = result.value.text; phase = 'error'; error = 'voice_draft_changed'; publish(); return false; }
          phase = 'ready'; error = null; publish(); return true;
        } catch (failure) {
          if (!current(generation)) return false;
          phase = 'error'; error = ['voice_empty_audio', 'voice_audio_limit', 'voice_text_limit'].includes(failure?.message) ? failure.message : 'voice_transcription_failed';
          publish(); return false;
        } finally {
          if (epoch === generation) { cleanRecording(); controller = null; target = null; insertion = null; finishPromise = null; }
        }
      })();
      return finishPromise;
    },
    dispose() { if (!disposed) { enabled = false; cancel(); media?.removeEventListener?.('devicechange', deviceChange); disposed = true; } },
  };
  const deviceChange = () => { if (!disposed && enabled) void api.refreshMicrophones(); };
  media?.addEventListener?.('devicechange', deviceChange);
  return api;
}
/* AU05_VOICE_ADAPTER_END */

    const eventNames = new Set(['k1.down', 'k1.up', 'k2.down', 'k2.up', 'k3.down', 'k3.up', 'knob.down', 'knob.up', 'left.pulse', 'right.pulse']);
    const lightLabels = { idle: '待命', running: '运行中', approval: '等待审批', attention: '等待处理', recording: '正在录音' };
    const maxLightBrightness = 20; // Official AU05 slider range; the protocol still accepts bytes.
    const stateLabels = { disconnected: '未连接', connecting: '连接中', ready: '已连接', stopped: '已断开',
      client_gone: '连接已释放', failed: '连接失败', no_device: '未找到设备', ambiguous_device: '检测到多个设备',
      error: '设备异常', mode_conflict: 'Studio 协作模式正在运行', start_timeout: '连接超时', device_disconnected: '设备已拔出',
      access_denied: '设备访问受限', protocol_error: '设备通信异常', compile_or_runtime_failed: '桥接程序失败',
      start_failed: '桥接启动失败', unsupported_runtime: '运行环境不支持', unsupported_platform: '系统不支持' };
    // Only fixed public codes are retained. Never render native text, paths or identifiers.
    const deviceErrors = {
      mode_conflict: 'Studio 协作模式正在运行，请先在 AU05 / Studio 停止跟随，再连接直连模式。',
      no_device: '未找到 AU05；请确认接收器已插入、唤醒设备后手动重新连接',
      ambiguous_device: '检测到多个匹配设备；请仅保留一个 AU05 接收器后手动重新连接',
      access_denied: '设备访问被拒绝；请退出 AU05 Studio 或其他占用程序，并检查设备权限后手动重新连接',
      protocol_error: '设备桥接通信协议异常；请停用并重新启用 AU05 插件后手动重新连接',
      compile_or_runtime_failed: '设备桥接程序编译或运行失败；请检查 PowerShell 7 和插件安装完整性后手动重新连接',
      start_failed: '无法启动设备桥接程序；请确认已安装 PowerShell 7（pwsh），并检查插件安装完整性后手动重新连接',
      unsupported_runtime: '设备桥接运行环境不受支持；请在 Windows 中使用 PowerShell 7 后手动重新连接',
      unsupported_platform: 'AU05 设备桥接仅支持 Windows；请在 Windows 中运行 DSH',
      start_timeout: '设备连接超时；请唤醒 AU05、退出占用程序后手动重新连接',
      disconnected: '设备连接已断开；请检查接收器并唤醒 AU05 后手动重新连接',
      device_disconnected: '设备已拔出；请重新插入接收器并唤醒 AU05 后手动重新连接',
      io_error: '设备通信失败；请检查接收器、退出占用程序后手动重新连接',
      open_failed: '无法打开设备；请退出占用程序、检查接收器后手动重新连接',
      metadata_failed: '无法读取设备信息；请重新插入接收器后手动重新连接',
      unsupported_caps: '设备 HID 能力不受支持；请确认接收器型号并检查插件版本',
      device_unverified: '设备校验未通过；请确认使用受支持的 AU05 接收器',
      physical_receiver_unverified: '接收器校验未通过；请确认使用受支持的 AU05 接收器',
      caps_changed: '设备 HID 能力已变化；请重新插入接收器后手动重新连接',
      input_failed: '读取设备按键失败；请检查接收器后手动重新连接',
      stdin_failed: '设备桥接命令通道中断；请手动重新连接',
      write_failed: '设备指令写入失败；请唤醒 AU05、退出占用程序后手动重新连接',
      command_invalid: '设备桥接命令不兼容；请检查插件安装完整性后手动重新连接',
      command_limit: '设备桥接命令超出限制；请手动重新连接',
      command_rate_limited: '设备桥接命令过于频繁；请稍后手动重新连接',
      lights_disabled: '设备灯光反馈未启用；请检查灯光反馈设置后手动重新连接',
      auto_restore_failed: '设备状态恢复失败；请重新插入接收器后手动重新连接',
      stopped: '设备连接已停止；如需使用，请手动重新连接',
      client_gone: '设备连接租期已结束；请手动重新连接',
    };
    const knownDeviceError = value => typeof value === 'string' && Object.hasOwn(deviceErrors, value) ? value : null;
    const snapshotError = result => knownDeviceError(result.error) ?? knownDeviceError(result.state);
    const deviceFailure = (result, fallback) => deviceErrors[snapshotError(result)] ?? fallback;
    const voiceErrors = { voice_unavailable: '当前浏览器不支持录音', voice_not_configured: '请先在 DSH 配置语音服务',
      voice_invalid_catalog: '语音服务配置不可用', voice_microphone_denied: '麦克风授权失败，请检查权限后重试',
      voice_microphone_missing: '所选麦克风不可用或已断开；不会自动改用其他麦克风，请重新连接或手动选择',
      voice_microphone_mismatch: '实际输入与所选麦克风不一致，已停止录音；请重新选择麦克风',
      voice_microphone_unavailable: '当前环境无法使用所选麦克风，请检查浏览器支持与权限',
      voice_insertion_unavailable: '当前草稿无法接收语音', voice_recording_failed: '录音失败，请重试',
      voice_audio_limit: '录音过长，请缩短后重试', voice_duration_limit: '录音已达服务上限', voice_empty_audio: '没有录到声音',
      voice_transcription_failed: '语音转写失败，请重试', voice_text_limit: '转写文本过长',
      windows_voice_unavailable: 'Windows 语音输入不可用，需要本机 DSH 桌面和 Windows 11 支持',
      windows_voice_expired: '按键请求已过期，请松开后重新按下', windows_voice_not_focused: '请先点击当前会话的输入框',
      windows_voice_busy: 'Windows 语音请求正在处理，请稍后重试', windows_voice_failed: 'Windows 语音输入请求未完成，请检查系统设置后重试',
      windows_voice_cancelled: 'Windows 语音请求已失效；如系统面板已打开，请手动结束',
      windows_voice_timeout: 'Windows 语音请求超时；如系统面板已打开，请手动结束',
      windows_voice_unsupported_platform: 'Windows 语音输入需要 Windows 11 支持',
      windows_voice_unsupported_client: 'Windows 语音输入仅支持本机 DSH 桌面',
      windows_voice_invalid_request: 'Windows 语音请求无效，请重新按下按键1',
      windows_voice_disposed: 'Windows 语音服务已结束，请重新连接后重试',
      windows_voice_start_failed: 'Windows 语音输入启动请求失败，请检查系统设置',
      windows_voice_protocol_error: 'Windows 语音请求通信异常，请重试',
      windows_voice_native_failed: 'Windows 语音系统请求失败，请检查系统设置',
      windows_voice_foreground_mismatch: '请先切回本机 DSH 桌面并点击输入框',
      windows_voice_focus_not_editable: '请先点击当前会话的可编辑输入框',
      windows_voice_modifiers_down: '请松开键盘修饰键后重新按下按键1',
      windows_voice_input_failed: 'Windows 语音快捷键请求未完成，请重试',
      windows_voice_invalid_gesture: '按键请求已失效，请松开后重新按下',
      windows_voice_not_enabled: '请先明确启用 Windows 语音输入' };
    const shortcutReminder = '再次按K1结束需保持DSH输入框聚焦；第三方不响应时在应用内手动停止；断开不会保证停止';
    for (const [suffix, message] of Object.entries({
      unavailable: '第三方快捷键仅支持 Windows 本机 DSH 桌面', expired: '第三方按键请求已过期，请松开后重按',
      not_focused: '请先点击当前会话的输入框', busy: '第三方快捷键请求正在处理，请稍后重试',
      failed: '第三方快捷键请求未完成，请检查应用快捷键设置', cancelled: '第三方快捷键请求已失效，请在应用内确认状态',
      timeout: '第三方快捷键请求超时，请在应用内确认状态', unsupported_platform: '第三方快捷键仅支持 Windows',
      unsupported_client: '第三方快捷键仅支持本机 DSH 桌面', invalid_request: '第三方快捷键请求无效，请重新按下按键1',
      disposed: '第三方快捷键服务已结束，请重新连接', start_failed: '第三方快捷键请求启动失败',
      protocol_error: '第三方快捷键请求通信异常', native_failed: '第三方快捷键系统请求失败',
      foreground_mismatch: '请先切回本机 DSH 桌面并点击输入框', focus_not_editable: '请先点击当前会话的可编辑输入框',
      modifiers_down: '请松开键盘修饰键后重新按下按键1', input_failed: '第三方快捷键请求未完成，请重试',
      invalid_gesture: '第三方按键请求已失效，请松开后重新按下', not_enabled: '请先明确启用第三方快捷键',
      invalid_shortcut: '快捷键不受支持，请使用安全组合键',
    })) voiceErrors[`shortcut_voice_${suffix}`] = message;
    const shortcutTraceStages = new Set(['input', 'blocked', 'host_requested', 'host_result', 'discarded']);
    const shortcutTraceCodes = new Set(['k1_down', 'already_held', 'window_not_focused', 'event_not_current', 'voice_disabled',
      'conflict_text', 'unsupported_client', 'composer_not_focused', 'capture_not_ready', 'transition_unconfirmed',
      'invalid_shortcut', 'request_busy', 'sent_to_host', 'activated', 'context_changed', 'rpc_failed',
      ...Object.keys(voiceErrors).filter(code => code.startsWith('shortcut_voice_'))]);
    function safeShortcut(value) {
      if (typeof value !== 'string' || value.length > 64) return null;
      if (/^rightalt$/i.test(value.trim())) return 'RightAlt';
      const tokens = value.split('+').map(item => item.trim());
      const parts = tokens.slice(0, -1).map(item => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' })[item.toLowerCase()] ?? item);
      const rawKey = tokens[tokens.length - 1], key = rawKey.toLowerCase() === 'space' ? 'Space' : rawKey.toUpperCase(), modifiers = new Set(parts);
      const functionKey = /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key);
      if (parts.length > 3 || modifiers.size !== parts.length
        || parts.some(item => !['Ctrl', 'Alt', 'Shift'].includes(item))
        || !functionKey && (!/^(?:[A-Z0-9]|Space)$/.test(key) || parts.length === 0)) return null;
      if (key === 'F4' && (modifiers.has('Alt') || modifiers.has('Ctrl'))
        || modifiers.has('Ctrl') && /^[WQRLTNOPSCVXAZY]$/.test(key)) return null;
      return [...['Ctrl', 'Alt', 'Shift'].filter(item => modifiers.has(item)), key].join('+');
    }
    const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
    // Local voice preferences only: never store audio, transcripts, sessions, RPC owners or credentials.
    const voicePreferencesKey = 'abworks.au05.voice-preferences.v1';
    const shortcutPresets = { typeless: { label: 'Typeless · Right Alt', shortcut: 'RightAlt' },
      bugu: { label: '网易叭哥说 · Right Alt', shortcut: 'RightAlt' } };
    const isShortcutMode = mode => mode === 'shortcut' || mode === 'custom';
    const bageshuoErrors = {
      unsupported_platform: '叭哥说状态观察仅支持 Windows 本机桌面',
      app_not_running: '叭哥说未运行；请先启动应用，再断开并重新连接设备',
      app_ambiguous: '检测到多个叭哥说进程，无法安全绑定；请确认只运行一个应用后断开并重新连接设备',
      identity_changed: '叭哥说进程身份已变化；请确认应用后断开并重新连接设备',
      target_exited: '叭哥说已退出；重启应用后请断开并重新连接设备',
      observer_start_failed: '叭哥说状态观察启动失败；请检查应用后断开并重新连接设备',
      observer_protocol_error: '叭哥说状态观察数据无效；请断开并重新连接设备',
      observer_exit: '叭哥说状态观察已退出；请断开并重新连接设备',
      observer_start_timeout: '叭哥说状态观察启动超时；请确认应用后断开并重新连接设备',
      observer_timeout: '叭哥说状态观察超时；请确认应用后断开并重新连接设备',
      observer_recovering: '叭哥说状态更新中断，正在恢复观察；请在应用内确认采集状态',
      capture_unknown: '无法确认叭哥说实际采集状态；不会重试快捷键，请在叭哥说内确认或手动停止',
    };
    const bageshuoStates = { stopped: '叭哥说采集状态观察未启用', starting: '正在启动叭哥说只读状态观察（尚未确认采集）',
      idle: '叭哥说当前未采集', recording: '叭哥说正在实际采集', unknown: '叭哥说实际采集状态未知；请在应用内确认', error: '叭哥说状态观察需要处理' };
    const bageshuoManualStop = '叭哥说浮窗抢焦点时，按键1不能安全停止；请在叭哥说内手动停止，或切回 DSH 并点击输入框后再单按。断开设备或关闭观察不会停止采集。';
    function safeBageshuo(value) {
      if (value === undefined) return { state: 'stopped', error: null };
      if (!value || !Object.hasOwn(bageshuoStates, value.state) || value.error !== null && !Object.hasOwn(bageshuoErrors, value.error)
        || value.state === 'recording' && value.error !== null) return { state: 'error', error: 'observer_protocol_error' };
      return { state: value.state, error: value.error };
    }
    const knobModes = ['regions', 'sessions', 'scroll', 'scroll-page', 'disabled'];
    const defaultVoicePreferences = () => ({ version: 3, mode: 'dsh', enabledByMode: { dsh: false, windows: false, shortcut: false, custom: false }, microphoneId: null,
      shortcutPreset: 'typeless', customShortcut: 'RightAlt', autoConnect: false, knobMode: 'regions', bageshuoCrossAppEnabled: false });
    const selectedShortcut = value => value.mode === 'custom' ? value.customShortcut : shortcutPresets[value.shortcutPreset].shortcut;
    function loadVoicePreferences() {
      try {
        const storage = globalThis.localStorage;
        if (!storage?.getItem || !storage?.setItem) return { value: defaultVoicePreferences(), available: false };
        const raw = storage.getItem(voicePreferencesKey);
        if (raw === null) return { value: defaultVoicePreferences(), available: true };
        if (typeof raw !== 'string' || raw.length > 4096) throw new Error('invalid_preferences');
        const value = JSON.parse(raw);
        const modes = value?.version === 1 ? ['dsh', 'windows'] : value?.version === 2 ? ['dsh', 'windows', 'shortcut'] : ['dsh', 'windows', 'shortcut', 'custom'];
        if (![1, 2, 3].includes(value?.version) || !modes.includes(value.mode)
          || typeof value.enabledByMode?.dsh !== 'boolean' || typeof value.enabledByMode?.windows !== 'boolean'
          || !(value.microphoneId === null || typeof value.microphoneId === 'string' && value.microphoneId.length > 0
            && value.microphoneId.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value.microphoneId))
          || value.version >= 2 && (typeof value.enabledByMode.shortcut !== 'boolean' || typeof value.autoConnect !== 'boolean')
          || value.version === 2 && (!['typeless', 'custom'].includes(value.shortcutPreset) || !safeShortcut(value.shortcut)
            || value.shortcutPreset === 'typeless' && value.shortcut !== 'RightAlt')
          || value.version === 3 && (typeof value.enabledByMode.custom !== 'boolean' || !Object.hasOwn(shortcutPresets, value.shortcutPreset)
            || !safeShortcut(value.customShortcut) || !knobModes.includes(value.knobMode))) throw new Error('invalid_preferences');
        const result = { ...defaultVoicePreferences(), mode: value.mode, microphoneId: value.microphoneId,
          enabledByMode: { ...defaultVoicePreferences().enabledByMode, dsh: value.enabledByMode.dsh, windows: value.enabledByMode.windows } };
        if (value.version === 2) {
          const custom = value.shortcutPreset === 'custom';
          if (custom && value.mode === 'shortcut') result.mode = 'custom';
          result.enabledByMode[custom ? 'custom' : 'shortcut'] = value.enabledByMode.shortcut;
          if (custom) result.customShortcut = safeShortcut(value.shortcut);
          result.autoConnect = value.autoConnect;
        } else if (value.version === 3) {
          result.enabledByMode.shortcut = value.enabledByMode.shortcut; result.enabledByMode.custom = value.enabledByMode.custom;
          result.shortcutPreset = value.shortcutPreset; result.customShortcut = safeShortcut(value.customShortcut);
          result.autoConnect = value.autoConnect; result.knobMode = value.knobMode;
          result.bageshuoCrossAppEnabled = value.bageshuoCrossAppEnabled === true;
        }
        return { value: result, available: true };
      } catch { return { value: defaultVoicePreferences(), available: false }; }
    }
    /* AU05_PANEL_UI_BEGIN */
// Shared AU05 presentation. Host theme aliases remain the color authority.
const panelCss = `
[data-au05-plugin] { --au05-space-tight:4px; --au05-space-control:8px; --au05-space-group:12px; --au05-space-section:16px; --au05-radius-control:8px; --au05-radius-panel:12px; --au05-control-height:32px; --au05-field-height:36px; --au05-label-width:72px; position:fixed; top:calc(var(--dsh-frame-overlay-top,20px) + 40px + env(safe-area-inset-top,0px)); right:calc(16px + env(safe-area-inset-right,0px)); z-index:1; display:flex; flex-direction:column; align-items:flex-end; gap:var(--au05-space-control); max-width:calc(100vw - 32px - env(safe-area-inset-right,0px) - env(safe-area-inset-left,0px)); font:inherit; font-size:12px; line-height:1.6; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-primary,CanvasText); }
[data-au05-plugin] * { box-sizing:border-box; }
[data-au05-plugin] :is(button,input,select) { font:inherit; color:inherit; }
[data-au05-plugin] button { cursor:pointer; transition:background .15s ease,border-color .15s ease,color .15s ease; }
[data-au05-plugin] button:disabled { cursor:default; opacity:.6; }
[data-au05-plugin] button:hover:not(:disabled) { background:color-mix(in srgb,var(--dsw-alias-label-primary,CanvasText) 8%,var(--dsw-alias-bg-base,Canvas)); }
[data-au05-plugin] button:active:not(:disabled) { transform:translateY(1px); }
[data-au05-plugin] :is(button,input,select,textarea,summary,[role=dialog]):focus-visible { outline:2px solid var(--dsw-alias-brand-primary,Highlight); outline-offset:3px; }
[data-au05-plugin] .au05-pill { touch-action:none; user-select:none; cursor:grab; display:inline-flex; align-items:center; gap:var(--au05-space-control); min-height:var(--au05-control-height); max-width:100%; padding:4px 12px; border-radius:16px; border:1px solid var(--dsw-alias-border-l2,currentColor); background:var(--dsw-alias-bg-layer-1,Canvas); }
[data-au05-plugin] .au05-pill strong { font-weight:600; }
[data-au05-plugin] [data-au05-connection] { max-width:8em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] .au05-dot { width:8px; height:8px; flex:none; border-radius:50%; background:var(--dsw-alias-state-idle-primary,currentColor); opacity:.6; }
[data-au05-plugin] .au05-dot[data-active=true] { background:var(--dsw-alias-state-success-primary,currentColor); opacity:1; }
[data-au05-plugin] .au05-pill[data-attention=true] .au05-dot { background:var(--dsw-alias-state-warn-primary,currentColor); opacity:1; }
[data-au05-plugin] .au05-panel { width:380px; max-width:100%; max-height:calc(100dvh - var(--dsh-frame-overlay-top,20px) - 112px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px)); overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:16px; border-radius:var(--au05-radius-panel); border:1px solid var(--dsw-alias-border-l1,currentColor); background:var(--dsw-alias-bg-base,Canvas); box-shadow:0 8px 24px #00000014; }
[data-au05-plugin] .au05-heading { display:flex; align-items:center; justify-content:space-between; gap:var(--au05-space-group); margin-bottom:12px; }
[data-au05-plugin] h2 { font-size:16px; font-weight:600; margin:0; }
[data-au05-plugin] .au05-action { min-height:var(--au05-control-height); padding:4px 12px; border:1px solid var(--dsw-alias-border-l2,currentColor); border-radius:var(--au05-radius-control); background:var(--dsw-alias-bg-layer-1,Canvas); }
[data-au05-plugin] .au05-primary:not(:disabled) { color:var(--dsw-alias-bg-base,Canvas); background:var(--dsw-alias-label-primary,CanvasText); border-color:var(--dsw-alias-label-primary,CanvasText); }
[data-au05-plugin] .au05-primary:hover:not(:disabled) { background:var(--dsw-alias-label-secondary,CanvasText); }
[data-au05-plugin] .au05-quiet { background:transparent; border-color:transparent; }
[data-au05-plugin] .au05-connection-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:var(--au05-space-control); margin-bottom:16px; }
[data-au05-plugin] .au05-connection-row [data-au05-device-status] { margin:0; }
[data-au05-plugin] .au05-connection-row .au05-action { align-self:stretch; }
[data-au05-plugin] .au05-connection-row[data-studio=true], [data-au05-plugin] .au05-connection-row[data-status-hidden=true] { grid-template-columns:repeat(2,minmax(0,1fr)); }
[data-au05-plugin] .au05-connection-row[data-studio=true] [data-au05-device-status] { grid-column:1 / -1; }
[data-au05-plugin] .au05-voice-row { display:flex; align-items:center; gap:var(--au05-space-group); margin:0 0 16px; }
[data-au05-plugin] .au05-voice-row .au05-switch { flex:none; margin:0; }
[data-au05-plugin] .au05-voice-row select { flex:1; }
[data-au05-plugin] .au05-note { margin:8px 0; color:var(--dsw-alias-label-secondary,currentColor); overflow-wrap:anywhere; text-wrap:pretty; }
[data-au05-plugin] .au05-switch { display:flex; align-items:center; gap:var(--au05-space-control); min-height:var(--au05-control-height); margin:8px 0; }
[data-au05-plugin] input[type=checkbox] { width:16px; height:16px; margin:0; flex:none; accent-color:var(--dsw-alias-brand-primary,Highlight); }
[data-au05-plugin] :is(select,input[type=text],textarea) { display:block; min-width:0; width:100%; max-width:100%; margin:0; padding:8px; border:1px solid var(--dsw-alias-border-l2,currentColor); border-radius:var(--au05-radius-control); color:var(--dsw-alias-label-primary,CanvasText); background:var(--dsw-alias-bg-base,Canvas); }
[data-au05-plugin] :is(select,input[type=text]) { min-height:var(--au05-field-height); }
[data-au05-plugin] :is(select,input):disabled { cursor:not-allowed; opacity:.6; }
[data-au05-plugin] textarea { resize:vertical; font:12px/1.6 ui-monospace,monospace; }
[data-au05-plugin] :is(input[type=range],meter) { min-width:0; width:100%; margin:0; accent-color:var(--dsw-alias-brand-primary,Highlight); }
[data-au05-plugin] details { border-top:1px solid var(--dsw-alias-border-l1,currentColor); padding:8px 0; }
[data-au05-plugin] summary { min-height:var(--au05-control-height); align-content:center; cursor:pointer; font-weight:500; border-radius:4px; }
[data-au05-plugin] summary:hover { color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] details > :not(summary) { margin-top:12px; }
[data-au05-plugin] .au05-field { display:grid; grid-template-columns:var(--au05-label-width) minmax(0,1fr); gap:var(--au05-space-control); align-items:center; margin:12px 0; }
[data-au05-plugin] .au05-field > label { color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] .au05-field-actions { grid-column:2; display:flex; flex-wrap:wrap; gap:var(--au05-space-control); }
[data-au05-plugin] .au05-actions { display:flex; flex-wrap:wrap; gap:var(--au05-space-control); margin:12px 0; }
[data-au05-plugin] .au05-conflict { white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; padding:12px; border:1px solid var(--dsw-alias-state-warn-primary,currentColor); border-radius:var(--au05-radius-control); }
[data-au05-plugin] [role=alert] { color:var(--dsw-alias-state-error-primary,CanvasText); border-inline-start:2px solid currentColor; padding-inline-start:8px; }
[data-au05-plugin] .au05-warning { color:var(--dsw-alias-state-warn-primary,CanvasText); }
[data-au05-plugin] .au05-inspector { display:grid; grid-template-columns:76px minmax(0,1fr); gap:var(--au05-space-section); align-items:center; margin:16px 0; }
[data-au05-plugin] .au05-device-art { position:relative; width:76px; aspect-ratio:364 / 1334; }
[data-au05-plugin] .au05-device-art > svg { display:block; width:100%; height:100%; pointer-events:none; }
[data-au05-plugin] .au05-lamp-echo { pointer-events:none; }
[data-au05-plugin] .au05-lamp-echo [data-au05-lamp] { fill:none; stroke:#f5bd70; stroke-width:11; opacity:0; filter:drop-shadow(0 0 11px #edab59); }
[data-au05-plugin] .au05-lamp-echo [data-au05-lamp][data-lamp-mode="1"], [data-au05-plugin] .au05-lamp-echo [data-au05-lamp][data-lamp-mode="2"] { opacity:.72; }
/* Illustrative cadence only: readback provides mode, not the physical breathing phase. */
@keyframes au05-lamp-breathe { 0%,100% { opacity:.18; } 50% { opacity:.95; } }
[data-au05-plugin] .au05-lamp-echo [data-au05-lamp][data-lamp-mode="2"] { animation:au05-lamp-breathe 1.5s ease-in-out infinite; }
[data-au05-plugin] .au05-control-detail { min-width:0; display:grid; gap:var(--au05-space-group); padding-inline-start:16px; border-inline-start:1px solid var(--dsw-alias-border-l1,currentColor); }
[data-au05-plugin] .au05-input-echo { pointer-events:none; }
[data-au05-plugin] [data-au05-input-control] { fill:#245ea81f; stroke:#245ea8; stroke-width:10; }
[data-au05-plugin] .au05-control-detail h3 { display:flex; flex-wrap:wrap; align-items:center; gap:var(--au05-space-control); margin:0; font-size:12px; font-weight:500; color:var(--dsw-alias-label-secondary,currentColor); }
[data-au05-plugin] [data-au05-input-state] { color:var(--dsw-alias-brand-primary,Highlight); font-weight:600; }
[data-au05-plugin] .au05-control-detail p { margin:4px 0 0; overflow-wrap:anywhere; }
[data-au05-plugin] .au05-control-detail .au05-key-status { font-size:12px; color:var(--dsw-alias-label-secondary,currentColor); }
@media (max-width:480px) { [data-au05-plugin] { right:calc(8px + env(safe-area-inset-right,0px)); max-width:calc(100vw - 16px - env(safe-area-inset-right,0px) - env(safe-area-inset-left,0px)); } [data-au05-plugin] .au05-panel { padding:12px; } }
@media (max-width:360px) { [data-au05-plugin] .au05-inspector { grid-template-columns:68px minmax(0,1fr); gap:var(--au05-space-group); } [data-au05-plugin] .au05-device-art { width:68px; } [data-au05-plugin] .au05-control-detail { padding-inline-start:12px; } [data-au05-plugin] .au05-voice-row { gap:var(--au05-space-control); } [data-au05-plugin] .au05-field { --au05-label-width:64px; } [data-au05-plugin] .au05-connection-row .au05-action { padding-inline:8px; } }
@media (prefers-reduced-motion:reduce) { [data-au05-plugin] *, [data-au05-plugin] *::before, [data-au05-plugin] *::after { transition:none !important; animation:none !important; } [data-au05-plugin] button:active:not(:disabled) { transform:none; } }
`;

// Presentation-only factories for the single-file client; no controller or effects.
// Call directly so native DOM shape, refs and event bindings remain unchanged.
/**
 * @param {Function} h React.createElement supplied by the host.
 * @returns {{ Field: Function, FieldActions: Function, Actions: Function }}
 */
function createPanelUi(h) {
  const classes = (base, extra) => extra ? `${base} ${extra}` : base;
  return {
    /** Label and control must share htmlFor/id; following actions stay in column 2. */
    Field(props, ...children) {
      return h('div', { ...props, className: classes('au05-field', props?.className) }, ...children);
    },
    /** Secondary actions belong to the preceding field, not the next field. */
    FieldActions(props, ...children) {
      return h('div', { ...props, className: classes('au05-field-actions', props?.className) }, ...children);
    },
    /** Independent actions can wrap; connection actions retain their dedicated grid. */
    Actions(props, ...children) {
      return h('div', { ...props, className: classes('au05-actions', props?.className) }, ...children);
    },
  };
}

/* AU05_PANEL_UI_END */

    async function rpc(ctx, method, args, signal) {
      const result = await ctx.connection.rpc.call('/api', `au05/${method}`, { args }, signal);
      if (result?.ok !== true || !result.value || typeof result.value !== 'object') throw new Error('au05_rpc_failed');
      return result.value;
    }
    function createController(ctx, { request = (method, args, signal) => rpc(ctx, method, args, signal), studio = false } = {}) {
      const owner = randomId(), listeners = new Set(), held = new Map(), focusBridges = new Map(), scrollBridges = new Map();
      let rotaryScroll = null;
      const nativeScrollRequests = new Set(), nativeScrollGuards = new Map(), inputFeedbackTimers = new Map();
      const loadedPreferences = loadVoicePreferences();
      let voicePreferences = loadedPreferences.value;
      // Saved preferences never constitute fresh Studio microphone/shortcut consent.
      const studioVoiceModes = new Set();
      const voiceEnabled = mode => voicePreferences.enabledByMode[mode] && (!studio || studioVoiceModes.has(mode));
      let disposed = false, enabled = false, epoch = 0, timer = null, activeRequest = null, generation = null, sequence = 0;
      let regionDiagnosticsTimer = null;
      let crossAppContext = randomId();
      let context = randomId(), captured = null, desiredLights = true, answered = new WeakMap(), discardConflict = false, openVoiceSettings = null;
      let windowsRequestCrossContext = null;
      let voiceEpoch = 0, windowsRequest = null, windowsMayBeActive = false, shortcutMayBeActive = false;
      let autoConnectConsumed = false, autoConnectInhibited = false, lightsEpoch = 0, k1RefreshPending = false;
      let bageshuoEpoch = 0, bageshuoHostArmed = false, bageshuoRevokePending = false, bageshuoTransition = null, bageshuoFastUntil = 0;
      let bageshuoTransitionGesture = null;
      let windowsStateEpoch = 0, windowsStateArmed = false, windowsStateRevoke = false;
      let lightBrightness = null, lightBrightnessSaved = true;
      let keyFeedback = false, keyFeedbackSaved = true, keyFeedbackHostArmed = false, keyFeedbackRevokePending = false;
      if (!studio) {
        try { keyFeedback = globalThis.localStorage.getItem('abworks.au05.key-feedback.v1') === 'true'; }
        catch { keyFeedbackSaved = false; }
      }
      try {
        const saved = globalThis.localStorage.getItem('abworks.au05.light-brightness.v1');
        if (saved !== null && /^\d{1,3}$/.test(saved) && Number(saved) <= 255) {
          lightBrightness = Math.min(maxLightBrightness, Number(saved));
          if (Number(saved) > maxLightBrightness) {
            lightBrightnessSaved = false;
            globalThis.localStorage.setItem('abworks.au05.light-brightness.v1', String(lightBrightness));
            lightBrightnessSaved = true;
          }
        }
      } catch { /* Keep the range-limited in-memory value if legacy migration cannot be saved. */ }
      const initialAutoConnect = voicePreferences.autoConnect;
      const windowsReminder = 'Windows 系统语音由系统管理；如已打开，请在系统面板手动结束';
      let snapshot = { ...(studio ? { transport: 'studio' } : {}), state: 'disconnected', connected: false, inputFeedback: {}, knobAngle: 0, sessionId: null, sessionState: '未选择会话',
        lightBrightness, lightBrightnessSaved, keyFeedback, keyFeedbackSaved, lightsEnabled: true, experimentalK1Lamp: !studio, lightState: 'idle', lightResult: 'not_requested', lightError: null, snapshotDiagnostics: [], lightTrace: [], lightObservation: null, lightObservationSessionId: null, error: null, message: '', canConfigureVoice: false,
        voiceMode: voicePreferences.mode, voicePreferenceEnabled: voiceEnabled(voicePreferences.mode),
        voicePreferencesSaved: loadedPreferences.available, shortcutPreset: voicePreferences.shortcutPreset, customShortcut: voicePreferences.customShortcut, shortcut: selectedShortcut(voicePreferences),
        autoConnect: !studio && voicePreferences.autoConnect, autoConnectStatus: '', knobMode: voicePreferences.knobMode, regionDiagnostics: null,
        bageshuoCrossAppEnabled: voicePreferences.bageshuoCrossAppEnabled,
        windowsVoiceState: { state: 'stopped', error: null, level: 0 }, bageshuo: { state: 'stopped', error: null }, shortcutTrace: [], shortcutRecovery: false,
        voice: { enabled: false, phase: 'disabled', error: null, conflictText: '', microphoneId: voicePreferences.microphoneId, microphones: [], microphoneError: null } };
      function isBageshuo() { return !studio && snapshot.voiceMode === 'shortcut' && snapshot.shortcutPreset === 'bugu'; }
      function crossAppEnabled() {
        return isBageshuo() && snapshot.bageshuoCrossAppEnabled === true && snapshot.voice.enabled === true
          && enabled && snapshot.connected && globalThis.location?.protocol === 'dsh-app:';
      }
      function wantsWindowsState() {
        return !studio && enabled && snapshot.connected && desiredLights && snapshot.voiceMode === 'windows'
          && snapshot.voice.enabled === true && snapshot.experimentalK1Lamp === true;
      }
      function wantsBageshuo() {
        return isBageshuo() && enabled && snapshot.connected && snapshot.voice.enabled === true && (snapshot.experimentalK1Lamp === true || crossAppEnabled())
          && globalThis.location?.protocol === 'dsh-app:';
      }
      // Closed, bounded poll-only comparison. Unknown shapes/accessors publish normally.
      // An unchanged observation retains its prior `at`: last semantic publication,
      // not a heartbeat. Never replace a subscribed snapshot without notification.
      const pollLeaf = null;
      const pollReadback = Object.fromEntries(['stage', 'attempts', 'readsWhilePending', 'shortReads', 'outerRejected',
        'nonMatchingHeader', 'modeRejected', 'matched', 'timedOut', 'getWritesCompleted'].map(key => [key, pollLeaf]));
      pollReadback.headerKinds = Object.fromEntries(['lightingNoRelay', 'lightingGroupFlags', 'lightingOtherOperation',
        'dongle', 'notice', 'otherDevice', 'other'].map(key => [key, pollLeaf]));
      pollReadback.comparison = { expected: { mode: pollLeaf, lights: [pollLeaf, 20] }, observed: { mode: pollLeaf, lights: [pollLeaf, 20] } };
      const pollShape = { state: pollLeaf, connected: pollLeaf, lightsEnabled: pollLeaf, lightState: pollLeaf,
        lightResult: pollLeaf, lightError: pollLeaf, error: pollLeaf, shortcutRecovery: pollLeaf,
        lightObservationSessionId: pollLeaf, windowsVoiceState: { state: pollLeaf, error: pollLeaf, level: pollLeaf },
        snapshotDiagnostics: [{ attempt: pollLeaf, outcome: pollLeaf, auth: pollLeaf, link: pollLeaf, timedOut: pollLeaf, rejected: pollLeaf }, 3],
        lightTrace: [{ at: pollLeaf, type: pollLeaf, requestId: pollLeaf, state: pollLeaf, channels: [pollLeaf, 4],
          result: pollLeaf, reason: pollLeaf, brightness: pollLeaf, readback: pollReadback }, 32],
        lightObservation: { at: pollLeaf, state: pollLeaf, channels: [pollLeaf, 4], reasons: [pollLeaf, 16],
          hasTarget: pollLeaf, focused: pollLeaf, lightsEnabled: pollLeaf, brightness: pollLeaf,
          experimentalK1Lamp: pollLeaf, voiceMode: pollLeaf, voicePhase: pollLeaf, voiceEnabled: pollLeaf,
          recording: pollLeaf, preparing: pollLeaf } };
      function unchangedPoll(update) {
        let budget = 4096;
        function equal(first, second, shape, observation = false) {
          if (--budget < 0) return false;
          if (shape === null) return (first === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof first)) && Object.is(first, second);
          if (!first || !second || typeof first !== 'object' || typeof second !== 'object') return false;
          if (Array.isArray(shape)) {
            if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length || first.length > shape[1]) return false;
            if (Reflect.ownKeys(first).length !== first.length + 1 || Reflect.ownKeys(second).length !== second.length + 1) return false;
            for (let index = 0; index < first.length; index++) {
              const a = Object.getOwnPropertyDescriptor(first, String(index)), b = Object.getOwnPropertyDescriptor(second, String(index));
              if (!a || !b || !Object.hasOwn(a, 'value') || !Object.hasOwn(b, 'value') || !equal(a.value, b.value, shape[0])) return false;
            }
            return true;
          }
          for (const value of [first, second]) {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return false;
          }
          const keys = Reflect.ownKeys(first), other = Reflect.ownKeys(second);
          if (keys.length !== other.length || keys.length > Object.keys(shape).length) return false;
          for (const key of keys) {
            if (typeof key !== 'string' || !Object.hasOwn(shape, key)) return false;
            const a = Object.getOwnPropertyDescriptor(first, key), b = Object.getOwnPropertyDescriptor(second, key);
            if (!a || !b || !Object.hasOwn(a, 'value') || !Object.hasOwn(b, 'value')) return false;
            if (observation && key === 'at') continue;
            if (!equal(a.value, b.value, shape[key], shape === pollShape && key === 'lightObservation')) return false;
          }
          return true;
        }
        try {
          const previous = {};
          for (const key of Object.keys(update)) previous[key] = snapshot[key];
          return equal(update, previous, pollShape);
        } catch { return false; }
      }
      const publish = update => {
        if (disposed) return;
        const before = wantsBageshuo(), beforeWindows = wantsWindowsState(), beforeCrossApp = crossAppEnabled();
        snapshot = { ...snapshot, ...update };
        if (regionDiagnosticsTimer !== null && (!enabled || !snapshot.connected || snapshot.knobMode !== 'regions'
          || !['connecting', 'ready'].includes(snapshot.state))) snapshot.regionDiagnostics = stopRegionDiagnostics();
        if (beforeCrossApp !== crossAppEnabled()) {
          crossAppContext = randomId();
          if (windowsRequestCrossContext) invalidateWindows();
          refreshK1();
        }
        if (!snapshot.connected || !['connecting', 'ready'].includes(snapshot.state)) {
          for (const timer of inputFeedbackTimers.values()) clearTimeout(timer);
          inputFeedbackTimers.clear(); snapshot.inputFeedback = {}; snapshot.knobAngle = 0;
        }
        if (beforeWindows !== wantsWindowsState()) {
          windowsStateEpoch++;
          if (!wantsWindowsState() && windowsStateArmed) windowsStateRevoke = true;
          snapshot.windowsVoiceState = { state: wantsWindowsState() ? 'starting' : 'stopped', error: null, level: 0 };
          refreshK1();
        }
        if (!wantsWindowsState()) snapshot.windowsVoiceState = { state: 'stopped', error: null, level: 0 };
        if (before !== wantsBageshuo()) {
          bageshuoEpoch++; bageshuoTransition = null; bageshuoTransitionGesture = null; bageshuoFastUntil = 0;
          if (!wantsBageshuo() && bageshuoHostArmed) bageshuoRevokePending = true;
          snapshot = { ...snapshot, bageshuo: { state: wantsBageshuo() ? 'starting' : 'stopped', error: null } };
          refreshK1();
        } else if (!wantsBageshuo() && snapshot.bageshuo.state !== 'stopped') {
          // Transport teardown can clear `enabled` before publishing its disconnected snapshot.
          snapshot = { ...snapshot, bageshuo: { state: 'stopped', error: null } };
        }
        for (const listener of listeners) listener();
      };
      function saveVoicePreferences(update) {
        voicePreferences = { ...voicePreferences, ...update };
        let saved = false;
        try {
          globalThis.localStorage.setItem(voicePreferencesKey, JSON.stringify({ version: 3, mode: voicePreferences.mode,
            enabledByMode: { dsh: voicePreferences.enabledByMode.dsh, windows: voicePreferences.enabledByMode.windows,
              shortcut: voicePreferences.enabledByMode.shortcut, custom: voicePreferences.enabledByMode.custom },
            microphoneId: voicePreferences.microphoneId, shortcutPreset: voicePreferences.shortcutPreset, customShortcut: voicePreferences.customShortcut,
            autoConnect: voicePreferences.autoConnect, knobMode: voicePreferences.knobMode, bageshuoCrossAppEnabled: voicePreferences.bageshuoCrossAppEnabled }));
          saved = true;
        } catch { /* Continue in memory, but never claim durability when storage is blocked. */ }
        publish({ voicePreferenceEnabled: voiceEnabled(snapshot.voiceMode), voicePreferencesSaved: saved });
      }
      function resolveScroll(sessionId, sessionOwner) {
        const candidates = new Map();
        for (const bridge of scrollBridges.get(sessionId) ?? []) {
          if (bridge.owner !== sessionOwner) continue;
          const candidate = bridge.resolve();
          if (candidate) {
            candidates.set(candidate.port, candidate);
            // Distinct ports cannot become unique again as more bridges are
            // visited. Fail closed without resolving unrelated DOM bridges.
            if (candidates.size > 1) return null;
          }
        }
        return candidates.size === 1 ? candidates.values().next().value : null;
      }
      const { readTarget, equalTarget, approve, questionAction } = createDshApplication({
        ctx, document, focusBridges, resolveScroll, answered, invoke,
      });
      function cancelNativeScrollRequests() {
        for (const request of nativeScrollRequests) request.abort();
        nativeScrollRequests.clear(); nativeScrollGuards.clear();
      }
      const regions = createRegionNavigation({ document, window: globalThis, readTarget, readPorts: regionPorts, scrollBackend: 'native' });
      function stopRegionDiagnostics() {
        if (regionDiagnosticsTimer === null) return snapshot.regionDiagnostics;
        clearTimeout(regionDiagnosticsTimer); regionDiagnosticsTimer = null;
        regions.stopDiagnostics();
        return regions.getDiagnostics();
      }
      function noteRegionInput(input, phase, reason = 'none') {
        if (input) regions.noteInput({ ...input, phase, reason });
      }
      function regionPorts(target) {
        const bridge = target && focusBridges.get(target.sessionId);
        return { conversation: target?.scrollPort ?? null,
          input: bridge && target && bridge.owner === target.sessionOwner ? bridge.resolve?.() ?? null : null };
      }
      function invalidateWindows() {
        if (windowsRequest && windowsRequestCrossContext === crossAppContext && crossAppEnabled()) return;
        voiceEpoch++; windowsRequest?.abort(); windowsRequest = null; bageshuoFastUntil = 0;
        if (snapshot.voiceMode !== 'dsh') {
          const active = ['requesting', 'requested'].includes(snapshot.voice.phase);
          publish({ voice: { ...snapshot.voice, phase: snapshot.voice.enabled ? 'ready' : 'disabled', error: null },
            ...(active ? { message: isShortcutMode(snapshot.voiceMode) ? shortcutReminder : windowsReminder } : {}) });
        }
      }
      function invalidate() {
        for (const request of nativeScrollRequests) request.abort();
        nativeScrollRequests.clear(); nativeScrollGuards.clear();
        rotaryScroll = null;
        context = randomId();
        invalidateWindows();
        // Keep physical-down knowledge: switching context must never turn a held key into a new press.
        for (const gesture of held.values()) gesture.context = null;
        voice.cancel();
      }
      function sync(force = false) {
        const next = readTarget();
        if (snapshot.knobMode === 'regions' && enabled && snapshot.connected) regions.reconcile(next, regionPorts(next));
        else regions.clear();
        if (force || !equalTarget(captured, next)) { captured = next; invalidate(); }
        const sessionState = !next ? '未选择唯一活动会话' : !next.focused ? '窗口未聚焦，按键暂停'
          : next.pending?.kind === 'approval' ? '等待审批' : next.pending ? '等待处理' : next.running ? '运行中' : '待命';
        if (snapshot.sessionId !== (next?.sessionId ?? null) || snapshot.sessionState !== sessionState)
          publish({ sessionId: next?.sessionId ?? null, sessionState });
        return captured;
      }
      function isCurrent(target) {
        const current = sync();
        return !disposed && enabled && snapshot.connected && current?.focused === true
          && target.context === context && target.sessionId === current.sessionId
          && target.inputActions === current.inputActions;
      }
      // Remote namespaces are separate traced Cordis services. Resolve speech in
      // an optional child fiber, never through the root-only `remote` injection.
      let speech = null;
      const voice = createVoiceAdapter({ speech: {
        catalog: (...args) => speech?.catalog(...args),
        transcribe: (...args) => speech?.transcribe(...args),
      }, isCurrent,
        onChange: value => {
          if (value.microphoneId !== undefined && value.microphoneId !== voicePreferences.microphoneId)
            saveVoicePreferences({ microphoneId: value.microphoneId });
          const previous = snapshot.voice, previousK1 = k1RecordingRequested();
          const conflictText = discardConflict ? '' : value.conflictText || previous.conflictText || '';
          if (snapshot.voiceMode !== 'dsh') return;
          publish({ voice: { ...value, conflictText,
            conflictSessionId: value.conflictText ? captured?.sessionId : previous.conflictSessionId } });
          if (previousK1 !== k1RecordingRequested()) refreshK1();
        } });
      voice.restore({ enabled: snapshot.voiceMode === 'dsh' && snapshot.voicePreferenceEnabled, microphoneId: voicePreferences.microphoneId });
      if (snapshot.voiceMode !== 'dsh') publish({ voice: { ...snapshot.voice, enabled: snapshot.voicePreferenceEnabled,
        phase: snapshot.voicePreferenceEnabled ? 'ready' : 'disabled' } });
      ctx.inject?.(['remote.speech'], scope => {
        scope.effect(() => {
          speech = scope.remote.speech;
          if (snapshot.voiceMode === 'dsh') voice.restore({ enabled: snapshot.voicePreferenceEnabled, microphoneId: voicePreferences.microphoneId });
          return () => { speech = null; if (snapshot.voiceMode === 'dsh') voice.disable(); };
        });
      });
      const stopTimer = () => { clearTimeout(timer); timer = null; };
      function trustedBageshuoRecording() {
        return wantsBageshuo() && !bageshuoRevokePending && snapshot.bageshuo.state === 'recording' && snapshot.bageshuo.error === null;
      }
      function k1RecordingRequested() {
        return !studio && desiredLights && snapshot.experimentalK1Lamp === true
          && (trustedBageshuoRecording() || wantsWindowsState() && snapshot.windowsVoiceState.state === 'recording' && snapshot.windowsVoiceState.error === null || snapshot.voiceMode === 'dsh'
            && snapshot.voice.enabled === true && snapshot.voice.phase === 'recording' && snapshot.voice.preparing === false);
      }
      function applyBageshuo(value) {
        const previousK1 = k1RecordingRequested(), next = safeBageshuo(value);
        if (bageshuoTransition && next.error === null && ['idle', 'recording'].includes(next.state) && next.state !== bageshuoTransition) {
          bageshuoTransition = null; bageshuoTransitionGesture = null; bageshuoFastUntil = 0;
        }
        if (next.error !== null || !['idle', 'recording'].includes(next.state)) bageshuoFastUntil = 0;
        const reminder = externalReminder();
        const recoveryMessage = bageshuoErrors.observer_recovering + (reminder ? `；${reminder}` : '');
        // Withdraw only our obsolete recovery message, including an unknown intermediate sample.
        // Current capture errors remain in bageshuo; never clear another error or capture warning.
        publish({ bageshuo: next, ...(next.error !== 'observer_recovering' && snapshot.message === recoveryMessage ? { message: reminder } : {}) });
        // Do not sync/invalidate here: observation is not a new input context or physical key edge.
        if (previousK1 !== k1RecordingRequested()) refreshK1();
      }
      function releaseUnsentTransition(outcome) {
        // A lost/aborted RPC is NOT proof of no input. Only the Host's pre-go
        // acknowledgement for this exact physical gesture can release the lock.
        const pending = bageshuoTransitionGesture;
        if (!pending || !outcome || outcome.notSent !== true
          || outcome.generation !== generation || outcome.generation !== pending.generation
          || outcome.sequence !== pending.sequence) return;
        bageshuoTransition = null; bageshuoTransitionGesture = null; bageshuoFastUntil = 0;
      }
      function refreshK1() {
        if (disposed || !enabled || !snapshot.connected || studio) return;
        // Voice owns capture; this only wakes the existing serialized poll, never starts another RPC in flight.
        k1RefreshPending = true;
        if (!activeRequest) { const currentEpoch = epoch; stopTimer(); timer = setTimeout(() => poll(currentEpoch), 0); }
      }
      const bageshuoPollClock = () => globalThis.performance?.now?.() ?? Date.now();
      function nativeScrollEnabled(target = captured) {
        return !studio && globalThis.location?.protocol === 'dsh-app:' && enabled && snapshot.connected
          && target?.focused === true && (snapshot.knobMode === 'regions'
            || snapshot.knobMode === 'scroll' && Boolean(target.scrollPort));
      }
      function scrollHovered(port) {
        try {
          return port?.matches?.(':hover') === true && typeof port.querySelector === 'function'
            && !port.querySelector('input:hover, textarea:hover, select:hover, [contenteditable]:hover, [data-composer-card]:hover, [role="dialog"]:hover');
        } catch { return false; }
      }
      async function requestNativeScroll(target, event, lease = null) {
        const port = lease ? lease.element : target.scrollPort;
        const sentMode = snapshot.knobMode;
        const selected = () => sentMode !== 'regions' || lease !== null
          && regions.currentScroll(target, regionPorts(target)) === lease
          && port.isConnected === true && Number.isFinite(port.scrollTop)
          && Number.isFinite(port.scrollHeight) && Number.isFinite(port.clientHeight)
          && port.clientHeight > 0 && port.scrollHeight > port.clientHeight;
        if (!nativeScrollEnabled(target) || !selected() || !scrollHovered(port)) return;
        const sentContext = context, requestController = new AbortController();
        if (nativeScrollRequests.size >= 32) { failure('滚轮处理繁忙，本次旋转未重试'); return; }
        nativeScrollRequests.add(requestController);
        const current = () => {
          if (requestController.signal.aborted || disposed || context !== sentContext) return false;
          const latest = sync();
          const eligible = nativeScrollEnabled(latest) && snapshot.knobMode === sentMode
            && captured === target && selected() && scrollHovered(port);
          // sync/reconcile can synchronously revoke this very request.
          return eligible && !requestController.signal.aborted && !disposed && context === sentContext;
        };
        nativeScrollGuards.set(requestController, current);
        const timeout = setTimeout(() => {
          const report = current(); requestController.abort();
          if (report) failure('滚轮响应超时，本次未重试；请稍后重新旋转');
        }, 500);
        try {
          if (!current()) return;
          const result = await request('nativeScroll', { owner, gesture: { generation: event.generation,
            sequence: event.sequence, context: sentContext } }, requestController.signal);
          if (!current()) return;
          if (result?.scrolled !== true || result.error !== null)
            failure(result?.error === 'native_wheel_modifiers_down' ? '请松开 Ctrl / Shift / Alt / Win 后旋转'
              : '原生滚轮未确认，请保持 DSH 前台、鼠标位于所选滚动区；若持续失败，切换旋钮行为后重试。本次旋转未重试');
        } catch {
          if (current()) failure('原生滚轮接口不可用或结果未确认，本次旋转未重试');
        } finally { clearTimeout(timeout); nativeScrollRequests.delete(requestController); nativeScrollGuards.delete(requestController); }
      }
      function pollDelay() {
        // Keep observed 14–31ms detents from batching behind the normal 200ms
        // task poll. Still one serialized poll; no second timer or replay path.
        if (snapshot.knobMode === 'regions' && captured?.focused === true) return 16;
        if (nativeScrollEnabled() && scrollHovered(captured.scrollPort)) return 16;
        // Briefly accelerate observation, never infer capture from the tap or retry a shortcut.
        const ready = wantsBageshuo() && desiredLights && captured?.focused === true
          && snapshot.bageshuo.error === null && ['idle', 'recording'].includes(snapshot.bageshuo.state);
        if (!ready) return 200;
        if (bageshuoTransition !== null) return bageshuoPollClock() < bageshuoFastUntil ? 50 : 200;
        // Faster HID delivery only while the actual composer is ready; the
        // independent native CoreAudio observer retains its 250ms cadence.
        return captured.composerFocused === true ? 100 : 200;
      }
      function traceShortcut(stage, code) {
        if (studio || !isShortcutMode(snapshot.voiceMode) || !shortcutTraceStages.has(stage) || !shortcutTraceCodes.has(code)) return;
        // In-memory, bounded, closed metadata only. Never store text, owner/context IDs, paths or raw RPC output.
        publish({ shortcutTrace: [...snapshot.shortcutTrace, { at: Date.now(), stage, code }].slice(-16) });
      }
      const externalReminder = () => [windowsMayBeActive ? windowsReminder : '', shortcutMayBeActive ? shortcutReminder : ''].filter(Boolean).join('；');
      const failure = message => { publish({ message: externalReminder() ? `${message}；${externalReminder()}` : message }); };
      function invoke(action) {
        try { Promise.resolve(action()).catch(() => failure('操作未完成，请在 DSH 界面确认后重试')); }
        catch { failure('当前操作不可用，请在 DSH 界面处理'); }
      }
      async function requestExternalVoice(target, event) {
        const mode = snapshot.voiceMode, shortcutMode = isShortcutMode(mode), prefix = shortcutMode ? 'shortcut_voice_' : 'windows_voice_';
        if (globalThis.location?.protocol !== 'dsh-app:') { traceShortcut('blocked', 'unsupported_client'); failure(shortcutMode ? '第三方快捷键仅支持 Windows 本机 DSH 桌面；当前浏览器不支持' : 'Windows 语音输入仅支持本机 DSH 桌面；当前浏览器不支持'); return false; }
        const crossApp = crossAppEnabled() && event.context === crossAppContext;
        if (!crossApp && !target?.composerFocused) { traceShortcut('blocked', 'composer_not_focused'); failure(isBageshuo() ? bageshuoManualStop : '请先点击当前会话的输入框，再按按键1'); return false; }
        if (isBageshuo() && wantsBageshuo() && (bageshuoRevokePending || snapshot.bageshuo.error !== null
          || !['idle', 'recording'].includes(snapshot.bageshuo.state))) {
          traceShortcut('blocked', 'capture_not_ready');
          failure(bageshuoErrors[snapshot.bageshuo.error] ?? `${bageshuoStates[snapshot.bageshuo.state]}；未发送快捷键，请先确认实际采集状态`); return false;
        }
        if (isBageshuo() && bageshuoTransition) { traceShortcut('blocked', 'transition_unconfirmed'); failure('尚未确认叭哥说采集状态变化；不会重复发送快捷键，请在应用内确认或手动停止'); return false; }
        if (shortcutMode && !safeShortcut(snapshot.shortcut)) { traceShortcut('blocked', 'invalid_shortcut'); failure(voiceErrors.shortcut_voice_invalid_shortcut); return false; }
        if (windowsRequest) { traceShortcut('blocked', 'request_busy'); return false; }
        const currentVoiceEpoch = ++voiceEpoch, targetContext = crossApp ? crossAppContext : context;
        const controller = new AbortController(); windowsRequest = controller;
        windowsRequestCrossContext = crossApp ? targetContext : null;
        const bageshuoTap = isBageshuo();
        const transitionGesture = { generation: event.generation, sequence: event.sequence };
        if (bageshuoTap && wantsBageshuo()) {
          bageshuoTransitionGesture = transitionGesture;
          bageshuoTransition = snapshot.bageshuo.state; bageshuoFastUntil = bageshuoPollClock() + 2000;
          refreshK1(); // Existing serial poll only; K1 stays off until actual recording is observed.
        }
        if (shortcutMode) shortcutMayBeActive = true; else windowsMayBeActive = true;
        publish({ voice: { ...snapshot.voice, phase: 'requesting', error: null }, message: '' });
        const current = () => {
          const next = sync();
          return !disposed && enabled && snapshot.connected && snapshot.voiceMode === mode && snapshot.voice.enabled
            && currentVoiceEpoch === voiceEpoch && (crossApp ? crossAppEnabled() && targetContext === crossAppContext
              : targetContext === context && next?.focused && next.composerFocused);
        };
        try {
          traceShortcut('host_requested', 'sent_to_host');
          const result = await request(shortcutMode ? 'shortcutVoice' : 'windowsVoice', { owner, gesture: {
            generation: event.generation, sequence: event.sequence, context: event.context,
          }, ...(shortcutMode ? { options: { shortcut: snapshot.shortcut } } : {}) }, controller.signal);
          traceShortcut('host_result', result.activated === true && result.error === null ? 'activated'
            : typeof result.error === 'string' && result.error.startsWith('shortcut_voice_') && Object.hasOwn(voiceErrors, result.error) ? result.error : 'shortcut_voice_failed');
          if (result.activated === false && result.notSent === true && bageshuoTransitionGesture === transitionGesture)
            releaseUnsentTransition({ ...transitionGesture, notSent: true });
          if (!current()) { traceShortcut('discarded', 'context_changed'); return false; }
          if (result.activated === true && result.error === null) {
            publish({ voice: { ...snapshot.voice, phase: 'requested', error: null },
              message: bageshuoTap ? '已发送一次 Right Alt；以叭哥说实际采集状态为准，不按点击次数推测录音' : shortcutMode ? `已请求第三方快捷键；${shortcutReminder}` : '已请求 Windows 语音输入；请在系统面板结束' });
            return true;
          }
          const error = typeof result.error === 'string' && result.error.startsWith(prefix) && Object.hasOwn(voiceErrors, result.error) ? result.error : `${prefix}failed`;
          bageshuoFastUntil = 0;
          publish({ voice: { ...snapshot.voice, phase: 'error', error },
            ...(bageshuoTap ? { message: ['shortcut_voice_foreground_mismatch', 'shortcut_voice_focus_not_editable'].includes(error) ? bageshuoManualStop : '快捷键未确认；不会自动重试，请在叭哥说内确认或手动停止' } : {}) });
        } catch {
          traceShortcut('host_result', 'rpc_failed');
          if (current()) {
            bageshuoFastUntil = 0;
            publish({ voice: { ...snapshot.voice, phase: 'error', error: `${prefix}failed` },
              ...(bageshuoTap ? { message: '快捷键未确认；不会自动重试，请在叭哥说内确认或手动停止' } : {}) });
          }
        } finally { if (windowsRequest === controller) { windowsRequest = null; windowsRequestCrossContext = null; } }
        return false;
      }
      function clearInputFeedback() {
        for (const timer of inputFeedbackTimers.values()) clearTimeout(timer);
        inputFeedbackTimers.clear();
        if (Object.keys(snapshot.inputFeedback).length || snapshot.knobAngle) publish({ inputFeedback: {}, knobAngle: 0 });
      }
      function showInputFeedback(key, state) {
        if (disposed || !enabled || !snapshot.connected || !['connecting', 'ready'].includes(snapshot.state)) return;
        clearTimeout(inputFeedbackTimers.get(key)); inputFeedbackTimers.delete(key);
        const inputFeedback = { ...snapshot.inputFeedback };
        if (state) inputFeedback[key] = state; else delete inputFeedback[key];
        publish({ inputFeedback });
        // Preserve taps delivered as down+up in one poll. Bound missing-release echoes;
        // this timer never changes action-held knowledge or schedules a hardware operation.
        if (!state || disposed) return;
        const timer = setTimeout(() => {
          if (disposed || inputFeedbackTimers.get(key) !== timer) return;
          inputFeedbackTimers.delete(key);
          const next = { ...snapshot.inputFeedback }; delete next[key];
          publish({ inputFeedback: next });
        }, state === 'down' ? 2000 : 450);
        inputFeedbackTimers.set(key, timer);
      }
      function processEvent(event) {
        // Diagnostics receive only local numeric metadata, never the Host event or its context.
        const regionInput = regionDiagnosticsTimer !== null && snapshot.knobMode === 'regions'
          && (event?.event === 'left.pulse' || event?.event === 'right.pulse')
          ? { direction: event.event === 'right.pulse' ? 1 : -1,
            sequence: Number.isSafeInteger(event.sequence) ? event.sequence : 0,
            ageMs: Number.isSafeInteger(event.at) ? Date.now() - event.at : 0 } : null;
        noteRegionInput(regionInput, 'received');
        if (!event || event.generation !== generation || !Number.isSafeInteger(event.sequence) || event.sequence <= sequence || event.sequence < 1) {
          noteRegionInput(regionInput, 'discarded', 'invalid_event'); return;
        }
        sequence = event.sequence;
        if (!eventNames.has(event.event)) return;
        const target = sync(), age = Date.now() - event.at;
        const fresh = enabled && snapshot.connected && Number.isSafeInteger(event.at) && age >= 0 && age < 1000;
        const crossAppK1 = event.event.startsWith('k1.') && crossAppEnabled() && event.context === crossAppContext;
        const valid = fresh && (event.event.startsWith('k1.') && crossAppEnabled() ? crossAppK1
          : target?.focused === true && event.context === context);
        const [key, edge] = event.event.split('.');
        if (regionInput && !valid) {
          noteRegionInput(regionInput, !fresh ? 'discarded' : 'blocked',
            !Number.isSafeInteger(event.at) ? 'invalid_event' : !fresh ? 'stale' : target?.focused !== true ? 'unfocused' : 'context');
        }
        // Observation is independent of session/action eligibility, and never changes the action-held map.
        if (edge === 'up' && (fresh || snapshot.inputFeedback[key] === 'down')) showInputFeedback(key, fresh ? 'up' : null);
        else if (fresh && edge === 'down' && snapshot.inputFeedback[key] !== 'down') showInputFeedback(key, 'down');
        else if (fresh && edge === 'pulse') {
          publish({ knobAngle: (snapshot.knobAngle ?? 0) + (key === 'right' ? 15 : -15) });
          showInputFeedback('rotation', key);
        }
        if (edge === 'up') {
          const gesture = held.get(key); held.delete(key);
          if (key === 'k1' && snapshot.voiceMode === 'dsh') {
            if (gesture?.context === context && valid) invoke(() => voice.finish());
            else if (gesture) voice.cancel();
          }
          return;
        }
        if (edge === 'down') {
          if (key === 'k1') traceShortcut('input', 'k1_down');
          if (held.has(key)) { if (key === 'k1') traceShortcut('blocked', 'already_held'); return; }
          const gesture = { context: valid ? context : null }; held.set(key, gesture);
          if (!valid) {
            if (key === 'k1') traceShortcut('blocked', target?.focused !== true ? 'window_not_focused' : 'event_not_current');
            if (key === 'k1' && isBageshuo() && (shortcutMayBeActive || trustedBageshuoRecording())) failure(bageshuoManualStop);
            return;
          }
          if (key === 'k1') {
            if (snapshot.voice.conflictText) { traceShortcut('blocked', 'conflict_text'); failure('请先复制或清除面板中保留的转写文本'); return; }
            if (!snapshot.voice.enabled) { traceShortcut('blocked', 'voice_disabled'); failure(isShortcutMode(snapshot.voiceMode) ? '请先明确启用第三方快捷键' : snapshot.voiceMode === 'windows' ? '请先明确启用 Windows 语音输入' : '请先启用语音并授权麦克风'); return; }
            if (snapshot.voiceMode !== 'dsh') invoke(() => requestExternalVoice(target, event));
            else invoke(() => voice.start({ sessionId: target.sessionId, context, inputActions: target.inputActions }));
          } else if (key === 'k2') {
            if (target.pending?.kind === 'question') {
              invoke(async () => {
                const selected = snapshot.knobMode === 'regions' && regions.commitSelection(target, regionPorts(target));
                if (selected === 'advanced') return;
                if (selected === 'selected') {
                  const sentContext = context;
                  await Promise.resolve(); // Let the host publish its selected draft before invoking its footer.
                  const current = sync();
                  if (!enabled || !snapshot.connected || context !== sentContext || current?.pending !== target.pending
                    || current.pendingKey !== target.pendingKey || current.binding !== target.binding || current.sessionOwner !== target.sessionOwner) return;
                  if (!questionAction(current, 'submit')) failure('当前选择题无法提交，请检查回答或在界面处理');
                  return;
                }
                if (selected) return;
                if (!questionAction(target, 'submit')) failure('当前选择题无法提交，请检查回答或在界面处理');
              });
            } else if (target.pending) {
              if (!approve(target, 'allowed-once')) failure('当前交互不能通过设备确认，请在界面处理');
            } else invoke(() => {
              // A synchronous, session-scoped request: only the suggestion plugin knows
              // whether its ghost text is currently eligible. Claiming cancels fallback;
              // no listener (or no suggestion) preserves the existing submit behavior.
              const request = new CustomEvent('dsh:suggest-prompt:accept', {
                cancelable: true, detail: { sessionId: target.sessionId },
              });
              window.dispatchEvent(request);
              if (request.defaultPrevented) return;
              if (typeof target.inputActions?.submit === 'function') target.inputActions.submit();
              else failure('当前会话输入不可用');
            });
          } else if (key === 'k3') {
            if (target.pending?.kind === 'approval') {
              if (!approve(target, 'rejected')) failure('当前审批不可回答，请在界面处理');
            } else if (target.running && typeof target.sessionOwner.session?.cancel === 'function')
              invoke(() => target.sessionOwner.session.cancel());
          } else if (key === 'knob') {
            if (snapshot.knobMode === 'regions') {
              invoke(() => {
                cancelNativeScrollRequests();
                if (!regions.cycle(target, regionPorts(target))) failure('当前没有可切换的区域');
              });
              return;
            }
            if (target.pending?.kind === 'question') {
              invoke(() => { if (!questionAction(target, 'focus')) failure('当前选择题没有可聚焦的回答框，请在界面处理'); });
              return;
            }
            const bridge = focusBridges.get(target.sessionId);
            if (bridge?.owner === target.sessionOwner && typeof bridge.focus === 'function') invoke(() => {
              if (bridge.focus() !== true) failure('当前视图没有唯一可聚焦输入');
            });
            else failure('当前视图未提供输入聚焦接口');
          }
          return;
        }
        if (edge === 'pulse' && valid) {
          if (snapshot.knobMode === 'regions') {
            noteRegionInput(regionInput, 'accepted');
            invoke(() => {
              const lease = regions.currentScroll(target, regionPorts(target));
              if (!lease) {
                // Only options rotate locally; scroll regions never enter the DOM engine.
                if (regions.activeId !== 'options'
                  || !regions.rotate(target, key === 'right' ? 1 : -1, regionPorts(target)))
                  failure('当前区域不可操作，请按旋钮切换区域');
                return;
              }
              if (!nativeScrollEnabled(target)) {
                failure('区域原生滚轮仅支持本机 DSH 桌面直连；Studio 请使用其原生滚动配置'); return;
              }
              if (!scrollHovered(lease.element)) { failure('请将鼠标移到所选滚动区再旋转'); return; }
              return requestNativeScroll(target, event, lease);
            });
            return;
          }
          if (snapshot.knobMode === 'disabled') return;
          if (snapshot.knobMode !== 'sessions') {
            if (!target.scrollPort) { failure('当前会话未提供可靠的滚动接口，旋转无动作'); return; }
            if (snapshot.knobMode === 'scroll') {
              if (studio || globalThis.location?.protocol !== 'dsh-app:') {
                failure('上下滚动的原生滚轮仅支持本机 DSH 桌面直连；Studio 请使用其原生滚动配置'); return;
              }
              if (!scrollHovered(target.scrollPort)) { failure('请将鼠标移到当前会话内容区再旋转'); return; }
              invoke(() => requestNativeScroll(target, event));
              return; // Never combine native wheel with DOM scrolling, including failures.
            }
            const distance = Math.max(120, target.scrollPort.clientHeight * 0.8);
            const port = target.scrollPort, direction = key === 'right' ? 1 : -1;
            invoke(() => {
              const now = Date.now(), current = port.scrollTop;
              // Native smooth scrolling owns the animation. Accumulate its destination,
              // not its unfinished position: bursts must not discard earlier detents.
              // Reversal, mode/context changes and idle restart from the visible position.
              const previous = rotaryScroll;
              const continuing = previous?.port === port && previous.context === context
                && previous.mode === snapshot.knobMode && previous.direction === direction
                && now - previous.at < 400;
              const base = continuing ? (direction > 0 ? Math.max(current, previous.top) : Math.min(current, previous.top)) : current;
              const top = Math.max(0, Math.min(port.scrollHeight - port.clientHeight, base + direction * distance));
              rotaryScroll = { port, context, mode: snapshot.knobMode, direction, at: now, top };
              port.scrollBy({ top: top - current, behavior: 'smooth' });
            });
            return;
          }
          // Official Workspace navigation retains/releases the main-view session; never synthesize keys or scroll globals.
          const registry = ctx.workspaces.list.getSnapshot();
          const workspace = registry.items.find(item => item.sessionIds.includes(target.sessionId));
          const rows = ctx.sessions.list.getSnapshot().byId;
          const archived = new Set(registry.archivedSessionIds);
          const ids = (workspace?.sessionIds ?? []).filter(id => rows[id] && rows[id].origin !== 'subagent' && !archived.has(id));
          const index = ids.indexOf(target.sessionId), next = ids[index + (key === 'right' ? 1 : -1)];
          if (index < 0 || !next) { failure('已到当前工作区会话列表边界'); return; }
          invalidate();
          invoke(() => ctx.uiWorkspace.openSession(next));
          sync();
        }
      }
      function lights(target) {
        // Cross-app dictation hides DSH task lamps outside the focused window.
        // Otherwise task lamps retain background feedback; K1 capture remains independent.
        const taskTarget = crossAppEnabled() && target?.focused !== true ? null : target;
        const recording = crossAppEnabled() && trustedBageshuoRecording() || target?.focused === true && (trustedBageshuoRecording() || wantsWindowsState() && snapshot.windowsVoiceState.state === 'recording' && snapshot.windowsVoiceState.error === null || snapshot.voiceMode === 'dsh' && snapshot.voice.enabled === true
          && snapshot.voice.phase === 'recording' && snapshot.voice.preparing === false);
        const scopedPending = taskTarget && taskTarget.pending?.sessionId === taskTarget.sessionId && typeof taskTarget.pending.key === 'string' ? taskTarget.pending : null;
        const pending = scopedPending && !answered.get(target.sessionOwner)?.has(scopedPending.key) ? scopedPending : null;
        const approval = pending?.kind === 'approval' && pending.answerable === true && typeof pending.answer === 'function';
        let question = null;
        if (['question', 'plan-review'].includes(pending?.kind) && typeof pending.getSnapshot === 'function') {
          // The public carrier can stay identical while its live state changes.
          try { question = pending.getSnapshot(); } catch { /* Unknown state must not advertise an answer. */ }
        }
        const questionAnswerable = question?.closed === false && question.state === 'open' && ['waterfall', 'rpc'].includes(question.channel);
        // Questions/plan reviews require GUI confirmation; lamps never synthesize their answers.
        const confirm = approval || questionAnswerable;
        const running = taskTarget?.running === true;
        const attention = confirm || running && typeof taskTarget.sessionOwner.session?.cancel === 'function';
        // running also covers blocking prompts. Continued questions no longer require confirmation.
        const progressing = running && (!scopedPending || question?.state === 'continued' && question.closed === false
          && ['waterfall', 'rpc', 'none'].includes(question.channel));
        return { light: recording ? 'recording' : approval ? 'approval' : questionAnswerable ? 'attention' : running ? 'running' : 'idle',
          // Reasons describe this request, not a physical lamp or an authorized key action.
          reasons: [recording ? 'recording' : null, approval ? 'approval' : questionAnswerable ? pending.kind : null,
            approval ? 'approval' : questionAnswerable ? pending.kind : attention ? 'cancel' : null, progressing ? 'progress' : null],
          // Opt-in authorizes configuration only, never a physical recording-lamp claim.
          channels: desiredLights ? [!studio && snapshot.experimentalK1Lamp && recording ? 2 : 0, confirm ? 2 : 0, attention ? 2 : 0, progressing ? 1 : 0] : [0, 0, 0, 0] };
      }
      async function poll(currentEpoch) {
        if (disposed || !enabled || currentEpoch !== epoch) return;
        // Reserve the serial request before sync(): it can cancel capture and publish a K1-off transition.
        const controller = new AbortController(); activeRequest = controller;
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const target = sync(), sentContext = context, sentLightsEpoch = lightsEpoch, sentBageshuoEpoch = bageshuoEpoch;
          // Serialize an explicit false before any re-arm, even if the user toggles off/on during an in-flight poll.
          const revokeWindowsState = windowsStateRevoke, sentWindowsStateEpoch = windowsStateEpoch;
          const observeWindowsState = wantsWindowsState() && !revokeWindowsState;
          windowsStateArmed = observeWindowsState;
          const revokeBageshuo = bageshuoRevokePending, observeBageshuo = wantsBageshuo() && !revokeBageshuo;
          bageshuoHostArmed = observeBageshuo;
          const revokeKeyFeedback = keyFeedbackRevokePending;
          const sendKeyFeedback = !studio && desiredLights && snapshot.keyFeedback === true && !revokeKeyFeedback;
          keyFeedbackHostArmed = sendKeyFeedback;
          const lightTarget = lights(target);
          const lightObservationSessionId = target?.sessionId ?? null;
          const lightObservation = { at: Date.now(), state: lightTarget.light, channels: [...lightTarget.channels],
            reasons: [...lightTarget.reasons],
            hasTarget: Boolean(target), focused: target?.focused === true, lightsEnabled: desiredLights, brightness: studio ? null : lightBrightness,
            experimentalK1Lamp: snapshot.experimentalK1Lamp === true, voiceMode: snapshot.voiceMode,
            voicePhase: snapshot.voice.phase, voiceEnabled: snapshot.voice.enabled === true,
            recording: lightTarget.light === 'recording', preparing: typeof snapshot.voice.preparing === 'boolean' ? snapshot.voice.preparing : null };
          k1RefreshPending = false; // Changes observed by sync() are already in this request; later changes wake its successor.
          const result = await request('poll', { owner, options: { after: sequence, context: target?.focused ? sentContext : null,
            light: lightTarget.light, channels: lightTarget.channels, ...(!studio && lightBrightness !== null ? { brightness: lightBrightness } : {}), lights: desiredLights, windowsVoice: snapshot.voiceMode === 'windows' && snapshot.voice.enabled,
            shortcutVoice: isShortcutMode(snapshot.voiceMode) && snapshot.voice.enabled, ...(!studio ? { keyFeedback: sendKeyFeedback, nativeScroll: nativeScrollEnabled(target), bageshuoCrossAppEnabled: crossAppEnabled(), bageshuoCrossAppContext: crossAppEnabled() ? crossAppContext : null, bageshuoState: observeBageshuo, windowsVoiceState: observeWindowsState, experimentalK1Lamp: snapshot.experimentalK1Lamp === true } : {}) } }, controller.signal);
          if (disposed || !enabled || currentEpoch !== epoch) return;
          sync();
          if (!Number.isSafeInteger(result.generation) || result.generation !== generation
            || !Number.isSafeInteger(result.sequence) || result.sequence < sequence || !Array.isArray(result.events) || result.events.length > 256) throw new Error('au05_invalid_poll');
          const pollUpdate = { state: result.state, connected: result.connected === true, lightsEnabled: desiredLights,
            snapshotDiagnostics: result.snapshotDiagnostics ?? [], lightState: result.lightState, lightResult: sentLightsEpoch === lightsEpoch ? result.lightResult : 'pending', lightError: result.lightError === 'snapshot_unavailable' ? result.lightError : null,
            lightTrace: Array.isArray(result.lightTrace) ? result.lightTrace : [], lightObservation, lightObservationSessionId, error: snapshotError(result),
            shortcutRecovery: result.shortcutRecovery === true,
            windowsVoiceState: observeWindowsState && sentWindowsStateEpoch === windowsStateEpoch && wantsWindowsState() && result.windowsVoiceState && ['stopped', 'starting', 'idle', 'recording', 'unknown', 'error'].includes(result.windowsVoiceState.state)
              && Number.isFinite(result.windowsVoiceState.level) && result.windowsVoiceState.level >= 0 && result.windowsVoiceState.level <= 1
              ? result.windowsVoiceState : { state: 'stopped', error: null, level: 0 } };
          if (!unchangedPoll(pollUpdate)) publish(pollUpdate);
          if (revokeKeyFeedback) {
            keyFeedbackRevokePending = false;
            if (!studio && desiredLights && snapshot.keyFeedback) refreshK1();
          }
          if (revokeWindowsState) { windowsStateRevoke = false; if (wantsWindowsState()) refreshK1(); }
          if (revokeBageshuo) {
            bageshuoRevokePending = false;
            if (wantsBageshuo()) refreshK1();
          }
          if (observeBageshuo && wantsBageshuo() && sentBageshuoEpoch === bageshuoEpoch) {
            applyBageshuo(result.bageshuo);
            releaseUnsentTransition(result.shortcutOutcome);
          }
          if (result.overflow === true) {
            clearInputFeedback(); invalidate(); sequence = Math.max(sequence, result.sequence);
            failure('设备输入过多，已丢弃旧按键；请松开后重新操作');
          } else {
            for (const event of result.events) if (event.sequence <= result.sequence) processEvent(event);
            sequence = Math.max(sequence, result.sequence);
          }
          if (!['connecting', 'ready'].includes(result.state)) {
            enabled = false; invalidate(); failure(studio ? 'Studio 按键桥已结束，请手动重新连接' : deviceFailure(result, '设备连接已结束，请手动重新连接')); return;
          }
        } catch {
          if (!disposed && enabled && currentEpoch === epoch) {
            const failedGeneration = generation;
            enabled = false; invalidate(); publish({ state: 'error', connected: false, error: null, message: studio ? 'Studio 按键桥已中断，请手动重新连接' : '设备连接中断，请手动重新连接' });
            // Native exit can release the owner before poll, hiding its terminal
            // error behind not_owner. Read retained status once; never reconnect.
            const statusController = new AbortController(); activeRequest = statusController;
            let statusTimeout;
            const expired = new Promise((_, reject) => {
              statusTimeout = setTimeout(() => { statusController.abort(); reject(new Error('au05_status_timeout')); }, 1500);
            });
            const status = request('status', {}, statusController.signal);
            // Stop remains immediate and cannot race a later explicit connect.
            void request('disconnect', { owner }).catch(() => {});
            try {
              const result = await Promise.race([status, expired]);
              if (!disposed && !enabled && currentEpoch === epoch && generation === failedGeneration
                && !statusController.signal.aborted && result.generation === failedGeneration && result.connected === false
                && !['connecting', 'ready'].includes(result.state) && snapshotError(result)) {
                publish({ state: Object.hasOwn(stateLabels, result.state) || knownDeviceError(result.state) ? result.state : 'error',
                  error: snapshotError(result), message: studio ? 'Studio 按键桥已中断，请手动重新连接' : deviceFailure(result, '设备连接中断，请手动重新连接') });
              }
            } catch {} finally {
              clearTimeout(statusTimeout); if (activeRequest === statusController) activeRequest = null;
            }
          }
        } finally {
          clearTimeout(timeout); if (activeRequest === controller) activeRequest = null;
          if (!disposed && enabled && currentEpoch === epoch) timer = setTimeout(() => poll(currentEpoch), k1RefreshPending ? 0 : pollDelay());
        }
      }
      const disposers = [];
      const observe = store => { if (store?.subscribe) disposers.push(store.subscribe(() => sync())); };
      observe(ctx.uiSession.adapter.current); observe(ctx.uiSession.sessionStatus); observe(ctx.sessions.list);
      const focusChanged = () => sync(true);
      for (const [source, event] of [[window, 'focus'], [window, 'blur'], [document, 'visibilitychange'], [document, 'focusin']]) {
        source.addEventListener(event, focusChanged);
        disposers.push(() => source.removeEventListener(event, focusChanged));
      }
      const pointerChanged = () => {
        if (!nativeScrollRequests.size) return;
        for (const current of nativeScrollGuards.values()) {
          if (!current()) { cancelNativeScrollRequests(); return; }
        }
      };
      for (const event of ['pointermove', 'pointerout', 'scroll']) {
        document.addEventListener(event, pointerChanged, true);
        disposers.push(() => document.removeEventListener(event, pointerChanged, true));
      }
      sync();
      const api = {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async connect() {
          if (disposed || enabled) return;
          const currentEpoch = ++epoch, sentLightsEpoch = lightsEpoch; enabled = true; stopTimer(); activeRequest?.abort(); generation = null; sequence = 0; held.clear(); invalidate();
          keyFeedbackHostArmed = false; keyFeedbackRevokePending = false;
          bageshuoEpoch++; bageshuoHostArmed = false; bageshuoRevokePending = false; bageshuoTransition = null; bageshuoTransitionGesture = null;
          publish({ state: 'connecting', connected: false, snapshotDiagnostics: [], lightTrace: [], lightObservation: null, lightObservationSessionId: null, experimentalK1Lamp: !studio, bageshuo: { state: 'stopped', error: null }, shortcutTrace: [], shortcutRecovery: false, lightResult: 'pending', lightError: null, error: null, message: '' });
          const controller = new AbortController(); activeRequest = controller;
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            const result = await request('connect', { owner, options: { lights: desiredLights } }, controller.signal);
            if (disposed || !enabled || currentEpoch !== epoch) { void request('disconnect', { owner }).catch(() => {}); return; }
            if (!Number.isSafeInteger(result.generation) || !Number.isSafeInteger(result.sequence)) throw new Error('au05_invalid_connect');
            generation = result.generation; sequence = result.sequence;
            publish({ state: result.state, connected: result.connected === true, lightState: result.lightState,
              snapshotDiagnostics: result.snapshotDiagnostics ?? [], lightResult: sentLightsEpoch === lightsEpoch ? result.lightResult : 'pending', lightError: result.lightError === 'snapshot_unavailable' ? result.lightError : null, error: snapshotError(result), message: '' });
            if (!['connecting', 'ready'].includes(result.state)) {
              enabled = false; failure(studio ? '无法连接 Studio 按键桥，请检查 Studio 桥服务后手动重新连接' : deviceFailure(result, '无法连接设备，请确认接收器已插入且未被其他程序占用后手动重新连接')); return;
            }
            void poll(currentEpoch);
          } catch {
            if (!disposed && currentEpoch === epoch) {
              enabled = false; publish({ state: 'error', connected: false, error: null, message: studio ? '无法连接 Studio 按键桥，请检查 Studio 桥服务后手动重新连接' : '无法连接 AU05，请确认接收器和插件 Host 服务后手动重新连接' });
              void request('disconnect', { owner }).catch(() => {});
            }
          } finally { clearTimeout(timeout); if (activeRequest === controller) activeRequest = null; }
        },
        async disconnect() {
          autoConnectInhibited = true;
          epoch++; enabled = false; stopTimer(); activeRequest?.abort(); invalidate();
          bageshuoEpoch++; bageshuoHostArmed = false; bageshuoRevokePending = false; bageshuoTransition = null; bageshuoTransitionGesture = null;
          publish({ state: 'disconnected', connected: false, experimentalK1Lamp: !studio, bageshuo: { state: 'stopped', error: null }, lightError: null, error: null, message: isBageshuo() ? bageshuoManualStop : externalReminder() });
          try { await request('disconnect', { owner }); } catch { failure(studio ? 'Studio 按键桥断开请求未确认，请在 Studio 确认状态' : '断开请求未确认，Host 将在连接租期结束时释放设备'); }
        },
        setExperimentalK1Lamp(value) {
          if (disposed || studio || !enabled || !snapshot.connected) return false;
          const previousK1 = k1RecordingRequested();
          lightsEpoch++;
          publish({ experimentalK1Lamp: value === true, lightResult: 'pending', lightError: null });
          if (previousK1 !== k1RecordingRequested()) refreshK1();
          return true;
        },
        stageLightBrightness(value) {
          if (disposed || studio || !Number.isInteger(value) || value < 0 || value > maxLightBrightness) return false;
          publish({ lightBrightnessDraft: value }); return true;
        },
        setLightBrightness(value) {
          if (disposed || studio || !Number.isInteger(value) || value < 0 || value > maxLightBrightness) return false;
          lightBrightness = value; lightsEpoch++;
          let saved = false;
          try { globalThis.localStorage.setItem('abworks.au05.light-brightness.v1', String(value)); saved = true; } catch {}
          publish({ lightBrightness: value, lightBrightnessSaved: saved, lightResult: 'pending', lightError: null });
          refreshK1();
          return true;
        },
        async clearLightBrightness() {
          if (disposed || studio) return false;
          lightBrightness = null; lightsEpoch++;
          let saved = false;
          try { globalThis.localStorage.removeItem('abworks.au05.light-brightness.v1'); saved = true; } catch {}
          publish({ lightBrightness: null, lightBrightnessDraft: null, lightBrightnessSaved: saved, lightResult: 'not_requested', lightError: null });
          // Native disconnect attempts original-snapshot restore; do not claim physical success.
          await this.disconnect();
          return true;
        },
        setKeyFeedback(value) {
          if (disposed || studio || typeof value !== 'boolean') return false;
          if (snapshot.keyFeedback === value && snapshot.keyFeedbackSaved) return true;
          if (!value && keyFeedbackHostArmed) keyFeedbackRevokePending = true;
          let saved = false;
          try { globalThis.localStorage.setItem('abworks.au05.key-feedback.v1', String(value)); saved = true; } catch {}
          lightsEpoch++;
          publish({ keyFeedback: value, keyFeedbackSaved: saved, lightResult: 'pending' });
          refreshK1();
          return true;
        },
        setLights(value) {
          if (desiredLights === (value === true)) return;
          const previousK1 = k1RecordingRequested();
          desiredLights = value === true; lightsEpoch++;
          if (!desiredLights && keyFeedbackHostArmed) keyFeedbackRevokePending = true;
          if (!desiredLights) bageshuoFastUntil = 0;
          publish({ lightsEnabled: desiredLights, lightResult: 'pending' });
          if (previousK1 !== k1RecordingRequested() || snapshot.keyFeedback || keyFeedbackRevokePending) refreshK1();
        },
        setBageshuoCrossApp(value) {
          if (disposed || studio || !isBageshuo() || globalThis.location?.protocol !== 'dsh-app:') return false;
          const bageshuoCrossAppEnabled = value === true;
          if (snapshot.bageshuoCrossAppEnabled === bageshuoCrossAppEnabled) return true;
          invalidate(); saveVoicePreferences({ bageshuoCrossAppEnabled });
          publish({ bageshuoCrossAppEnabled }); return true;
        },
        setAutoConnect(value) {
          if (disposed || studio) return false;
          const autoConnect = value === true;
          saveVoicePreferences({ autoConnect }); publish({ autoConnect }); return true;
        },
        startRegionDiagnostics() {
          if (disposed || !enabled || !snapshot.connected || snapshot.knobMode !== 'regions'
            || !['connecting', 'ready'].includes(snapshot.state) || regionDiagnosticsTimer !== null || !regions.startDiagnostics()) return false;
          const finishTimer = setTimeout(() => {
            if (disposed || regionDiagnosticsTimer !== finishTimer) return;
            publish({ regionDiagnostics: stopRegionDiagnostics() });
          }, 5000);
          regionDiagnosticsTimer = finishTimer;
          publish({ regionDiagnostics: regions.getDiagnostics() });
          return true;
        },
        setKnobMode(knobMode) {
          if (disposed || !knobModes.includes(knobMode)) return false;
          if (knobMode === snapshot.knobMode) return true;
          regions.clear(); invalidate(); saveVoicePreferences({ knobMode }); publish({ knobMode }); return true;
        },
        setShortcutPreset(preset) {
          if (disposed || !Object.hasOwn(shortcutPresets, preset) || snapshot.voice.conflictText) return false;
          if (preset === snapshot.shortcutPreset) return true;
          invalidate();
          saveVoicePreferences({ shortcutPreset: preset });
          publish({ shortcutPreset: preset, shortcut: selectedShortcut(voicePreferences) }); return true;
        },
        setShortcut(value) {
          if (disposed || snapshot.voiceMode !== 'custom' || snapshot.voice.conflictText) return false;
          const customShortcut = safeShortcut(value);
          if (!customShortcut) { invalidate(); failure(voiceErrors.shortcut_voice_invalid_shortcut); return false; }
          if (customShortcut !== snapshot.customShortcut) {
            invalidate(); saveVoicePreferences({ customShortcut }); publish({ customShortcut, shortcut: customShortcut });
          }
          return true;
        },
        setVoiceMode(mode) {
          if (disposed || !['dsh', 'windows', 'shortcut', 'custom'].includes(mode) || snapshot.voiceMode === mode) return false;
          if (snapshot.voice.conflictText) { failure('请先复制或清除面板中保留的转写文本，再切换语音模式'); return false; }
          const reminder = externalReminder();
          voice.disable(); invalidate();
          publish({ voiceMode: mode, voicePreferenceEnabled: voiceEnabled(mode),
            voice: { ...snapshot.voice, enabled: false, phase: 'disabled', error: null, conflictText: '' },
            message: reminder });
          saveVoicePreferences({ mode }); publish({ shortcut: selectedShortcut(voicePreferences) });
          voice.restore({ enabled: mode === 'dsh' && snapshot.voicePreferenceEnabled, microphoneId: voicePreferences.microphoneId });
          if (mode !== 'dsh') publish({ voice: { ...snapshot.voice, enabled: snapshot.voicePreferenceEnabled,
            phase: snapshot.voicePreferenceEnabled ? 'ready' : 'disabled' } });
          return true;
        },
        enableVoice() {
          if (disposed || snapshot.voice.conflictText) return false;
          studioVoiceModes.add(snapshot.voiceMode);
          saveVoicePreferences({ enabledByMode: { ...voicePreferences.enabledByMode, [snapshot.voiceMode]: true } });
          if (snapshot.voiceMode === 'dsh') return voice.enable();
          invalidate(); publish({ voice: { ...snapshot.voice, enabled: true, phase: 'ready', error: null }, message: '' });
          return true;
        },
        disableVoice() {
          if (disposed) return;
          studioVoiceModes.delete(snapshot.voiceMode);
          saveVoicePreferences({ enabledByMode: { ...voicePreferences.enabledByMode, [snapshot.voiceMode]: false } });
          if (snapshot.voiceMode === 'dsh') voice.disable();
          else { invalidate(); publish({ voice: { ...snapshot.voice, enabled: false, phase: 'disabled', error: null } }); }
        },
        async refreshMicrophones() {
          if (disposed || snapshot.voiceMode !== 'dsh') return false;
          try { await voice.refreshMicrophones(); return true; }
          catch { failure('无法读取麦克风列表，请检查权限后手动刷新'); return false; }
        },
        selectMicrophone(deviceId) {
          if (disposed || snapshot.voiceMode !== 'dsh' || snapshot.voice.conflictText) return false;
          invalidate();
          return voice.selectMicrophone(deviceId === '' ? null : deviceId);
        },
        clearVoiceConflict() { discardConflict = true; try { voice.cancel(); } finally { discardConflict = false; } },
        setVoiceSettings(open) {
          openVoiceSettings = open; publish({ canConfigureVoice: true });
          return () => { if (openVoiceSettings === open) { openVoiceSettings = null; publish({ canConfigureVoice: false }); } };
        },
        openVoiceSettings() { if (openVoiceSettings) invoke(() => openVoiceSettings()); },
        bridge(sessionId, focus, isFocused, resolve) {
          const sessionOwner = ctx.sessions.binding(sessionId);
          const record = { owner: sessionOwner, focus, isFocused, resolve }; focusBridges.set(sessionId, record); sync();
          return () => { if (focusBridges.get(sessionId) === record) { focusBridges.delete(sessionId); sync(); } };
        },
        scrollBridge(sessionId, resolve) {
          const sessionOwner = ctx.sessions.binding(sessionId);
          const record = { owner: sessionOwner, resolve };
          let records = scrollBridges.get(sessionId);
          if (!records) scrollBridges.set(sessionId, records = new Set());
          records.add(record); sync(true);
          return () => {
            records.delete(record); if (records.size === 0) scrollBridges.delete(sessionId);
            sync(true);
          };
        },
        async dispose() {
          if (disposed) return;
          if (regionDiagnosticsTimer !== null) publish({ regionDiagnostics: stopRegionDiagnostics() });
          clearInputFeedback(); regions.dispose();
          if (snapshot.experimentalK1Lamp) publish({ experimentalK1Lamp: false });
          for (const request of nativeScrollRequests) request.abort();
          nativeScrollRequests.clear(); nativeScrollGuards.clear();
          disposed = true; enabled = false; epoch++; stopTimer(); activeRequest?.abort(); invalidateWindows(); voice.dispose(); held.clear(); listeners.clear(); focusBridges.clear(); scrollBridges.clear();
          for (const dispose of disposers) dispose();
          try { await request('disconnect', { owner }); } catch {}
        },
      };
      // Initial saved consent is sampled once. UI changes affect only the next plugin lifetime.
      void Promise.resolve().then(() => {
        if (studio || disposed || autoConnectConsumed || autoConnectInhibited || !initialAutoConnect) return;
        autoConnectConsumed = true;
        if (globalThis.location?.protocol !== 'dsh-app:') {
          publish({ autoConnectStatus: '启动时自动连接仅支持本机 DSH 桌面；当前浏览器不会尝试连接' }); return;
        }
        if (typeof ctx.connection?.rpc?.call !== 'function') {
          publish({ autoConnectStatus: '设备服务不可用，未自动连接；请稍后手动连接' }); return;
        }
        if (enabled) return;
        publish({ autoConnectStatus: '已尝试启动时连接一次；失败或断开后请手动连接' });
        void api.connect();
      });
      return api;
    }
    // Idle is task intent, not evidence of device sleep. Only this native failure
    // precedes LED takeover; keep the failure intact and change presentation only.
    function idleLightSnapshotDeferred(snapshot) {
      if (snapshot.transport === 'studio' || !snapshot.connected || snapshot.state !== 'ready'
        || !snapshot.lightsEnabled || snapshot.error || snapshot.lightState !== 'idle'
        || snapshot.lightResult !== 'failed' || snapshot.lightError !== 'snapshot_unavailable') return false;
      const trace = Array.isArray(snapshot.lightTrace) ? snapshot.lightTrace : [];
      const request = [...trace].reverse().find(item => item?.type === 'request');
      if (!request || !Number.isSafeInteger(request.requestId) || request.requestId < 1) return false;
      const result = [...trace].reverse().find(item => item?.type === 'result' && item.requestId === request.requestId);
      const idle = item => item?.state === 'idle' && Array.isArray(item.channels)
        && item.channels.length === 4 && item.channels.every(channel => channel === 0);
      if (!idle(request) || !idle(result) || request.brightness !== undefined || result.brightness !== undefined
        || result.result !== 'failed' || result.reason !== 'snapshot_unavailable') return false;
      if (result.readback) return result.readback.stage === 'initial' && result.readback.matched === 0 && !result.readback.comparison;
      // Auth/link failures can precede the first GET and omit readback stats.
      const diagnostics = snapshot.snapshotDiagnostics;
      return Array.isArray(diagnostics) && diagnostics.length > 0
        && diagnostics.every(item => ['auth_unconfirmed', 'link_not_ready', 'reply_rejected', 'timeout'].includes(item?.outcome));
    }
    // Configuration echo only; HID readback does not detect emitted light.
    function lampConfigurationEcho(snapshot) {
      // Display device-returned post-write configuration, never the browser's desired vector.
      // In particular Host-observed Windows recording can override K1 independently of that vector.
      if (snapshot.transport === 'studio' || !snapshot.connected || snapshot.state !== 'ready'
        || snapshot.lightError || !['verified', 'mismatch'].includes(snapshot.lightResult)) return null;
      const trace = Array.isArray(snapshot.lightTrace) ? snapshot.lightTrace : [];
      const request = [...trace].reverse().find(item => item?.type === 'request');
      if (!request || !Number.isSafeInteger(request.requestId) || request.requestId < 1) return null;
      const result = [...trace].reverse().find(item => item?.type === 'result' && item.requestId === request.requestId);
      const readback = result?.readback, observed = readback?.comparison?.observed;
      if (!result || !['verified', 'mismatch'].includes(result.result)
        || readback?.stage !== 'post_write' || readback.matched !== 1 || !observed
        || !Number.isInteger(observed.mode) || observed.mode < 0 || observed.mode > 2
        || !Array.isArray(observed.lights) || observed.lights.length !== 20
        || !observed.lights.every((value, index) => Number.isInteger(value) && value >= 0 && value <= (index % 5 === 0 ? 2 : 255))) return null;
      const channels = observed.mode === 0 ? [0, 0, 0, 0] : observed.mode === 1 ? [1, 1, 1, 1]
        : [0, 1, 2, 3].map(index => observed.lights[index * 5]);
      // Raw brightness zero is not a reliable physical-off indicator on this device.
      return { channels, mode: observed.mode };
    }
    /* AU05_CAPSULE_BEGIN */
// Local presentation only: never calls device, microphone, session or approval APIs.
function createFloatingCapsule({ root, pill, window = globalThis, storage }) {
  if (!root?.style || !pill?.addEventListener || !pill.getBoundingClientRect) return { setOpen() {}, dispose() {} };
  const key = 'abworks.au05.capsule-position.v1';
  const listeners = [];
  let position = null, drag = null, suppressClick = false, hovered = false, focused = false, open = false, disposed = false;
  const listen = (element, name, fn, options) => {
    element.addEventListener?.(name, fn, options);
    listeners.push(() => element.removeEventListener?.(name, fn, options));
  };
  try {
    storage ??= window.localStorage;
    const raw = storage?.getItem(key);
    if (raw && raw.length < 256) {
      const value = JSON.parse(raw);
      if (value?.version === 1 && Number.isFinite(value.x) && value.x >= 0 && value.x <= 1
        && Number.isFinite(value.y) && value.y >= 0 && value.y <= 1 && [null, 'left', 'right'].includes(value.edge)) position = value;
    }
  } catch { /* Position storage must not affect controls. */ }
  function metrics() {
    const rect = pill.getBoundingClientRect();
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const viewport = pill.ownerDocument?.documentElement ?? window.document?.documentElement;
    return { width, height, vw: Math.max(width, viewport?.clientWidth || window.innerWidth || width),
      vh: Math.max(height, viewport?.clientHeight || window.innerHeight || height) };
  }
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  function paint() {
    if (disposed || !position) return;
    const { width, height, vw, vh } = metrics();
    const x = position.edge === 'left' ? 0 : position.edge === 'right' ? vw - width : position.x * (vw - width);
    const y = position.y * Math.max(0, vh - height);
    const hidden = position.edge && !open && !hovered && !focused && !drag;
    Object.assign(root.style, { left: `${x}px`, right: 'auto', top: `${y}px`, bottom: 'auto', maxWidth: `${vw}px`,
      transform: hidden ? `translateX(${position.edge === 'left' ? '-50%' : '50%'})` : 'none' });
    root.setAttribute?.('data-au05-docked', position.edge ?? '');
    root.setAttribute?.('data-au05-hidden', hidden ? 'true' : 'false');
    const panel = root.querySelector?.('[data-au05-panel]');
    if (panel) {
      const below = vh - y - height - 8, above = y - 8;
      const upwards = above > below;
      const panelWidth = Math.min(380, Math.max(1, vw - 16));
      const available = Math.max(0, upwards ? above : below), cramped = available < 64;
      const maxHeight = cramped ? Math.max(1, vh - 16) : available;
      Object.assign(panel.style, { position: 'absolute', width: `${panelWidth}px`, maxWidth: `${Math.max(1, vw - 16)}px`,
        left: `${clamp(x, Math.max(0, vw - panelWidth - 8)) - x}px`, right: 'auto',
        top: cramped ? `${8 - y}px` : upwards ? 'auto' : `${height + 8}px`, bottom: !cramped && upwards ? `${height + 8}px` : 'auto',
        padding: cramped ? `${Math.min(16, maxHeight / 8)}px` : '', maxHeight: `${maxHeight}px` });
    }
  }
  function fromPixels(x, y, snap = false) {
    const { width, height, vw, vh } = metrics();
    x = clamp(x, vw - width); y = clamp(y, vh - height);
    const edge = snap && x <= 24 ? 'left' : snap && vw - width - x <= 24 ? 'right' : null;
    position = { version: 1, x: vw > width ? x / (vw - width) : 0, y: vh > height ? y / (vh - height) : 0, edge };
    paint();
  }
  function save() { try { storage?.setItem(key, JSON.stringify(position)); } catch { /* In-memory movement remains available. */ } }
  function finish(cancel = false, event) {
    if (!drag) return;
    const previous = drag; drag = null;
    if (previous.moved) {
      suppressClick = true;
      if (cancel) { position = previous.position; paint(); }
      else {
        const { width, height, vw, vh } = metrics();
        fromPixels(position.x * (vw - width), position.y * (vh - height), true); save();
        if (event) {
          const r = pill.getBoundingClientRect();
          hovered = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
        }
      }
    }
    try { if (pill.hasPointerCapture?.(previous.id)) pill.releasePointerCapture(previous.id); } catch { /* Capture can already be lost. */ }
    paint();
  }
  listen(pill, 'pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || drag) return;
    suppressClick = false;
    // Reveal first so the grab offset is measured against the full capsule.
    hovered = true; paint();
    const rect = pill.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false, position };
    try { pill.setPointerCapture?.(event.pointerId); } catch { drag = null; }
  });
  listen(pill, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved && pill.ownerDocument?.activeElement === pill) pill.blur?.();
    drag.moved = true; event.preventDefault();
    fromPixels(drag.left + dx, drag.top + dy);
  });
  listen(pill, 'pointerup', event => { if (drag?.id === event.pointerId) finish(false, event); });
  listen(pill, 'pointercancel', event => { if (drag?.id === event.pointerId) finish(true); });
  listen(pill, 'lostpointercapture', event => { if (drag?.id === event.pointerId) finish(true); });
  listen(pill, 'click', event => {
    if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  listen(root, 'pointerenter', () => { hovered = true; paint(); });
  listen(root, 'pointerleave', () => { hovered = false; paint(); });
  listen(root, 'focusin', () => { focused = true; paint(); });
  listen(root, 'focusout', event => { focused = root.contains?.(event.relatedTarget) === true; paint(); });
  listen(pill, 'keydown', event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') {
      position = null; root.style.left = ''; root.style.top = ''; root.style.right = ''; root.style.bottom = ''; root.style.transform = '';
      try { storage?.removeItem(key); } catch { /* Optional preference. */ }
      initialise();
    } else {
      const rect = pill.getBoundingClientRect();
      fromPixels(rect.left + (event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0),
        rect.top + (event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0), true);
      save();
    }
  });
  listen(window, 'resize', paint);
  listen(window, 'blur', () => { finish(true); hovered = false; focused = false; paint(); });
  function initialise() {
    if (!position) {
      const rect = pill.getBoundingClientRect();
      fromPixels(rect.left, rect.top);
    } else paint();
  }
  initialise();
  const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(paint) : null;
  observer?.observe(pill);
  return {
    setOpen(value) { open = value === true; paint(); },
    dispose() { if (disposed) return; finish(true); disposed = true; observer?.disconnect(); listeners.forEach(stop => stop()); },
  };
}
/* AU05_CAPSULE_END */
    const { Field, FieldActions, Actions } = createPanelUi(h);
    function productView(controller) {
      return function Au05Device() {
        const [snapshot, setSnapshot] = React.useState(controller.getSnapshot);
        const [open, setOpen] = React.useState(false);
        const [shortcutDraft, setShortcutDraft] = React.useState(snapshot.customShortcut);
        React.useEffect(() => setShortcutDraft(snapshot.customShortcut), [snapshot.customShortcut]);
        const pillRef = React.useRef(null), panelRef = React.useRef(null), rootRef = React.useRef(null), floatingRef = React.useRef(null);
        React.useEffect(() => {
          const floating = createFloatingCapsule({ root: rootRef.current, pill: pillRef.current });
          floatingRef.current = floating;
          return () => { floating.dispose(); floatingRef.current = null; };
        }, []);
        React.useEffect(() => {
          const stop = controller.subscribe(() => setSnapshot(controller.getSnapshot()));
          setSnapshot(controller.getSnapshot()); return stop;
        }, []);
        React.useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);
        const close = () => { setOpen(false); pillRef.current?.focus(); };
        const lampReadback = lampConfigurationEcho(snapshot), lampEcho = lampReadback?.channels ?? [0, 0, 0, 0], lampEchoActive = lampEcho.some(value => value > 0);
        const studio = snapshot.transport === 'studio';
        const lampModes = ['关闭', '常亮', '呼吸'];
        const lampReasons = { recording: '录音状态', approval: '等待审批', question: '等待回答', 'plan-review': '等待审阅计划', cancel: '可停止运行', progress: '运行中' };
        const lampRequest = control => {
          const observation = snapshot.lightObservation, index = ['k1', 'k2', 'k3', 'knob'].indexOf(control);
          if (studio || !snapshot.connected || snapshot.state !== 'ready' || !snapshot.lightsEnabled || !observation?.lightsEnabled
            || snapshot.lightObservationSessionId !== snapshot.sessionId || ![1, 2].includes(observation.channels?.[index])) return null;
          const reason = lampReasons[observation.reasons?.[index]];
          return reason ? `上次请求：${lampModes[observation.channels[index]]} · ${reason}` : null;
        };
        const inputFeedback = snapshot.connected ? snapshot.inputFeedback ?? {} : {};
        const inputLabels = { down: '按下', up: '松开', left: '左转', right: '右转' };
        const inputLabel = control => [inputLabels[inputFeedback[control]], control === 'knob' ? inputLabels[inputFeedback.rotation] : null].filter(Boolean).join(' · ');
        const voice = snapshot.voice, stateLabel = studio
          ? snapshot.connected ? 'Studio 按键桥监听中' : snapshot.state === 'connecting' ? '正在连接 Studio 按键桥' : 'Studio 按键桥未连接'
          : Object.hasOwn(stateLabels, snapshot.state) ? stateLabels[snapshot.state] : '设备不可用';
        const windowsMode = snapshot.voiceMode === 'windows', presetMode = snapshot.voiceMode === 'shortcut', customMode = snapshot.voiceMode === 'custom',
          shortcutMode = isShortcutMode(snapshot.voiceMode), dshMode = snapshot.voiceMode === 'dsh';
        const bageshuoMode = !studio && presetMode && snapshot.shortcutPreset === 'bugu';
        const connectionRecovery = Object.hasOwn(deviceErrors, snapshot.error) ? deviceErrors[snapshot.error] : null;
        const redundantConnectionState = connectionRecovery && (snapshot.state === snapshot.error || ['failed', 'error'].includes(snapshot.state));
        const redundantMessage = connectionRecovery && snapshot.message === connectionRecovery
          || bageshuoMode && snapshot.message === bageshuoManualStop;
        const voiceSelectValue = presetMode ? `shortcut:${snapshot.shortcutPreset}` : snapshot.voiceMode;
        const selectVoice = value => {
          if (value === 'shortcut:typeless' || value === 'shortcut:bugu') {
            // Preserve mode-switch guards and reminders before changing the remembered preset.
            if (controller.getSnapshot().voiceMode !== 'shortcut' && !controller.setVoiceMode('shortcut')) return false;
            return controller.setShortcutPreset(value.slice('shortcut:'.length));
          }
          if (['dsh', 'windows', 'custom'].includes(value)) return controller.setVoiceMode(value);
          return false;
        };
        const voiceLabel = (bageshuoMode
          ? { disabled: '叭哥说快捷键未启用', ready: '点击输入框后，单按按键1切换叭哥说采集', requesting: '正在发送一次 Right Alt', requested: '已发送一次 Right Alt；以实际采集状态为准', error: '叭哥说快捷键请求未确认；请在应用内检查' }
          : shortcutMode
          ? { disabled: '第三方快捷键未启用', ready: '点击输入框后，按下按键1切换第三方听写', requesting: '正在请求第三方快捷键', requested: '已请求第三方快捷键；请在应用内确认状态', error: '第三方快捷键请求需要处理' }
          : windowsMode
          ? { disabled: 'Windows 语音未启用', ready: '点击输入框后，按下按键1请求 Windows 语音输入', requesting: '正在请求 Windows 语音输入', requested: '已请求 Windows 语音输入；请在系统面板结束', error: 'Windows 语音请求需要处理' }
          : { disabled: '未启用', ready: '按住按键1说话', recording: '正在录音，松开后转写', transcribing: '正在转写', error: '语音需要处理' })[voice.phase] ?? '未启用';
        const feedback = ['verified', 'mismatch', 'written', 'failed', 'preserved', 'restored', 'restore_written', 'restore_mismatch'].includes(snapshot.lightResult) ? snapshot.lightResult : 'pending';
        const lightResult = { preserved: '保留设备原灯光，未写灯', restored: '原灯光配置已恢复并回读一致', restore_written: '恢复原灯光已提交，未回读', restore_mismatch: '原灯光恢复回读不一致', verified: '配置回读一致', mismatch: '配置回读不一致', written: '已提交，未回读',
          failed: '未确认，请唤醒设备后断开重连' }[feedback] ?? '待确认';
        const lightsOff = { preserved: '保留设备原灯光，未写灯', restored: '原灯光配置已恢复并回读一致', restore_written: '恢复原灯光已提交，未回读', restore_mismatch: '原灯光恢复回读不一致',
          failed: '恢复原灯光未确认，请断开重连' }[feedback] ?? '已请求恢复原灯光';
        const idleSnapshotDeferred = idleLightSnapshotDeferred(snapshot);
        const lightAttention = !idleSnapshotDeferred && Boolean(snapshot.lightError || ['mismatch', 'failed', 'restore_mismatch', 'restore_written'].includes(feedback));
        const attention = Boolean(snapshot.error || voice.error || voice.microphoneError || voice.conflictText || lightAttention || snapshot.bageshuo.error || snapshot.windowsVoiceState.error || !snapshot.voicePreferencesSaved || snapshot.keyFeedbackSaved === false);
        const knobHelp = ({ regions: '滚动高亮区域需鼠标悬停', sessions: '切换会话', scroll: '上下滚动当前会话', 'scroll-page': '整屏滚动当前会话', disabled: '旋转无动作' })[snapshot.knobMode] ?? '旋转无动作';
        const controlDetails = {
          knob: { title: '旋钮', mapping: snapshot.knobMode === 'regions' ? `${knobHelp}；按下切换区域。` : `${knobHelp}；按下聚焦输入框。` },
          k1: { title: '按键1 · 麦克风', mapping: dshMode ? '按住说话，松开转写到草稿；不自动发送。'
            : windowsMode ? '聚焦输入框后单按请求 Windows 语音；在系统面板结束。'
            : `聚焦输入框后单按切换${customMode ? '自定义听写' : snapshot.shortcutPreset === 'bugu' ? '叭哥说' : 'Typeless'}（${snapshot.shortcut}）。` },
          k2: { title: '按键2', mapping: '有灰色建议时补齐，否则发送草稿；有选择题时提交回答或默认推荐项；有审批时批准。' },
          k3: { title: '按键3', mapping: '停止运行；有审批时拒绝。' },
        };
        const compactStatus = attention ? '需处理' : voice.phase === 'recording' ? (voice.preparing ? '准备采集' : '录音中') : voice.phase === 'transcribing' ? '转写中' : snapshot.connected ? (studio ? '桥监听中' : '已连接') : snapshot.state === 'connecting' ? '连接中' : '未连接';
        React.useEffect(() => { floatingRef.current?.setOpen(open); }, [open, compactStatus]);
        return h('div', { 'data-au05-plugin': '', ref: rootRef, onKeyDown: event => {
          if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
        } }, h('style', { 'data-au05-styles': '' }, panelCss),
        h('button', { 'data-au05-pill': '', className: 'au05-pill', type: 'button', ref: pillRef, 'data-attention': attention, title: `${stateLabel} · ${compactStatus}；拖动移动，贴近左右边缘半隐藏；Alt+方向键移动，Alt+Home 复位`,
          'aria-label': `AU05 设备控制：${compactStatus}`,  'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-controls': 'au05-device-panel',
          onClick: () => { if (open) close(); else { setOpen(true); void controller.refreshMicrophones(); } } },
          h('span', { className: 'au05-dot', 'data-active': snapshot.connected, 'aria-hidden': true }), h('strong', null, 'AU05'),
          h('span', { 'data-au05-connection': '', role: 'status' }, compactStatus)),
        open && h('section', { id: 'au05-device-panel', 'data-au05-panel': '', className: 'au05-panel', role: 'dialog',
          'aria-label': 'AU05 设备面板', 'aria-modal': false, tabIndex: -1, ref: panelRef },
          h('header', { className: 'au05-heading' }, h('h2', null, 'AU05'),
            h('button', { 'data-au05-close': '', className: 'au05-action au05-quiet', type: 'button', onClick: close, 'aria-label': '收起 AU05 设备面板' }, '收起')),
          h('div', { 'data-au05-connection-row': '', 'data-studio': studio, 'data-status-hidden': Boolean(redundantConnectionState), className: 'au05-connection-row' },
          !redundantConnectionState && h('p', { 'data-au05-device-status': '', className: 'au05-note', role: 'status', 'aria-label': '连接状态' }, stateLabel),
            h('button', { 'data-au05-connect': '', className: 'au05-action au05-primary', type: 'button', disabled: snapshot.connected || snapshot.state === 'connecting', onClick: () => controller.connect() }, studio ? '显式连接 Studio 按键桥' : '连接设备'),
            h('button', { 'data-au05-disconnect': '', className: 'au05-action', type: 'button', onClick: () => controller.disconnect() }, studio ? '断开 Studio 按键桥' : '断开设备')),
          snapshot.error && h('p', { 'data-au05-connection-alert': '', className: 'au05-note', role: 'alert' }, connectionRecovery ?? `连接或操作未完成：${snapshot.error}`),
          h('p', { 'data-au05-session': '', className: 'au05-note', role: 'status' }, `会话：${snapshot.sessionState}`),
          snapshot.autoConnectStatus && !connectionRecovery && !snapshot.connected && snapshot.state !== 'connecting' && h('p', { 'data-au05-auto-connect-status': '', className: 'au05-note', role: 'status' }, snapshot.autoConnectStatus),
          h('div', { className: 'au05-voice-row' },
          h('label', { className: 'au05-switch', title: dshMode ? '首次使用需授权麦克风' : undefined },
            h('input', { 'data-au05-voice': '', type: 'checkbox', checked: snapshot.voicePreferenceEnabled,
              onChange: event => event.target.checked ? controller.enableVoice() : controller.disableVoice() }), '启用语音'),
            h('select', { id: 'au05-voice-mode', 'data-au05-voice-mode': '', 'aria-label': '语音方式', value: voiceSelectValue,
              disabled: Boolean(voice.conflictText), onChange: event => selectVoice(event.target.value) },
              h('option', { 'data-au05-mode-dsh': '', value: 'dsh' }, 'DSH 内置语音'),
              h('option', { 'data-au05-mode-windows': '', value: 'windows' }, 'Windows 语音'),
              h('option', { 'data-au05-mode-typeless': '', value: 'shortcut:typeless' }, 'Typeless'),
              h('option', { 'data-au05-mode-bugu': '', value: 'shortcut:bugu' }, '网易叭哥说'),
              h('option', { 'data-au05-mode-custom': '', value: 'custom' }, '自定义快捷键'))),
          !snapshot.voicePreferencesSaved && h('p', { 'data-au05-preferences-status': '', className: 'au05-note', role: 'status' },
            '无法保存设置；本次仍可使用。'),
          !voice.error && (voice.preparing || voice.enabled && voice.phase !== 'ready') && h('p', { 'data-au05-voice-status': '', className: 'au05-note', role: 'status' }, dshMode && voice.phase === 'recording' && voice.preparing ? '正在准备麦克风，尚未开始录音' : voiceLabel,
            dshMode && voice.providerName ? ` · ${voice.providerName}${voice.location === 'cloud' ? '（云端转写）' : '（本机转写）'}` : ''),
          voice.error && h('p', { className: 'au05-note', role: 'alert' }, voiceErrors[voice.error] ?? '语音未完成，请重新启用后重试'),
          voice.conflictText && h('div', { className: 'au05-conflict', 'data-au05-voice-conflict': '' },
            `会话 ${voice.conflictSessionId ?? ''} 的草稿已变化，请复制以下转写文本：`, h('p', null, voice.conflictText),
            h('button', { 'data-au05-clear-conflict': '', className: 'au05-action', type: 'button', onClick: () => controller.clearVoiceConflict() }, '清除保留文本')),
          voice.microphoneError && voice.microphoneError !== voice.error && h('p', { className: 'au05-note', role: 'alert' }, voiceErrors[voice.microphoneError] ?? '麦克风列表不可用，请检查权限后刷新'),
          windowsMode && (snapshot.windowsVoiceState.state !== 'stopped' || snapshot.windowsVoiceState.error) && h('div', { 'data-au05-windows-voice-state': '', role: snapshot.windowsVoiceState.error ? 'alert' : 'status' },
            ({ stopped: 'Windows 语音宿主收音观察未启用', starting: '正在确认 Windows 语音宿主实际收音状态', idle: 'Windows 语音宿主当前未收音', recording: 'Windows 语音宿主正在实际收音', unknown: 'Windows 收音状态未知', error: 'Windows 收音观察失败' })[snapshot.windowsVoiceState.state],
            h('meter', { 'data-au05-windows-voice-level': '', min: 0, max: 1, value: snapshot.windowsVoiceState.level, 'aria-label': 'Windows 语音宿主实际收音音量' }),
            null),
          bageshuoMode && (snapshot.bageshuo.state !== 'stopped' || snapshot.bageshuo.error) && h('p', { 'data-au05-bageshuo-status': '', className: 'au05-note', role: snapshot.bageshuo.error ? 'alert' : 'status' },
            bageshuoErrors[snapshot.bageshuo.error] ?? bageshuoStates[snapshot.bageshuo.state]),
          bageshuoMode && globalThis.location?.protocol === 'dsh-app:' && h('label', { className: 'au05-switch' },
            h('input', { type: 'checkbox', 'data-au05-bageshuo-cross-app': '', checked: snapshot.bageshuoCrossAppEnabled === true,
              onChange: event => controller.setBageshuoCrossApp(event.target.checked) }), '跨应用 K1 听写'),
          bageshuoMode && h('p', { 'data-au05-bageshuo-stop-help': '', className: 'au05-note' }, snapshot.bageshuoCrossAppEnabled
            ? '跨应用听写需保持 DSH 运行；后台按键可能延迟。不会自动发送文本；断开设备不会停止采集，请在叭哥说内确认或手动停止。'
            : '焦点离开输入框时，请在叭哥说内手动停止；断开设备或关闭观察不会停止采集。'),
          windowsMode && h('p', { 'data-au05-windows-help': '', className: 'au05-note' }, '可能使用 Microsoft 云端语音；请在系统面板手动结束，断开设备不会停止听写。'),
          shortcutMode && !bageshuoMode && h('p', { 'data-au05-shortcut-stop-help': '', className: 'au05-note au05-warning' }, shortcutReminder),
          !studio && lightAttention && h('div', { 'data-au05-light-alerts': '' },
          !studio && h('p', { 'data-au05-light-status': '', className: 'au05-note', role: snapshot.lightError || feedback === 'mismatch' || feedback === 'failed' || feedback === 'restore_mismatch' || feedback === 'restore_written' ? 'alert' : 'status' }, snapshot.lightError === 'snapshot_unavailable'
            ? '未取得原灯光快照，未写灯' : snapshot.lightsEnabled ? `灯光：${lightLabels[snapshot.lightState] ?? '待命'} · ${lightResult}` : lightsOff),
          !studio && snapshot.lightError && snapshot.lightError !== 'snapshot_unavailable' && h('p', { className: 'au05-note', role: 'alert' }, `灯光请求需要处理：${snapshot.lightError}`),
          null),
          !studio && idleSnapshotDeferred && h('p', { 'data-au05-light-status': '', className: 'au05-note', role: 'status' }, '灯光：待命，尚未接管'),
          !snapshot.lightBrightnessSaved && h('p', { className: 'au05-note', role: 'alert' }, '亮度设置未保存；下次打开可能恢复旧值。'),
          !studio && snapshot.keyFeedbackSaved === false && h('p', { 'data-au05-key-feedback-status': '', className: 'au05-note', role: 'alert' }, '按键短亮设置未保存，请在设备设置中重新勾选后重试'),
          !studio && shortcutMode && snapshot.connected && !snapshot.shortcutRecovery && h('p', { 'data-au05-shortcut-recovery': '', className: 'au05-note', role: 'alert' }, '取消请求恢复不可用，请重新加载 AU05 组件。'),
          snapshot.message && !redundantMessage && h('p', { 'data-au05-message': '', className: 'au05-note', role: 'status' }, snapshot.message),
          (studio || !snapshot.lightError && !['mismatch', 'failed', 'restore_mismatch', 'restore_written'].includes(feedback)) && h('p', {
            ...(!studio ? { 'data-au05-light-status': '' } : {}), 'data-au05-task-lamp-state': '', className: 'au05-note', role: 'status' }, studio ? 'Studio 不提供灯光配置回读'
              : snapshot.lightsEnabled ? `灯光：${lightResult}` : lightsOff),
          h('section', { 'data-au05-inspector': '', className: 'au05-inspector', 'aria-label': 'AU05 按键状态与映射' },
            h('div', { className: 'au05-device-art' },
              // Original vector geometry referenced to Ulanzi's official control-front-rotation image;
              // no product-photo bytes are bundled. Coordinates retain the front reference proportions.
              h('svg', { viewBox: '332 144 364 1334', 'data-au05-device-vector': '', 'aria-hidden': true, focusable: false },
                h('rect', { x: 368, y: 146, width: 286, height: 22, rx: 9, fill: '#8e9497' }),
                ...[376, 390, 404, 418, 432, 446, 460, 474, 488, 502, 516, 530, 544, 558, 572, 586, 600, 614, 628, 642].map(x => h('circle', { key: x, cx: x, cy: 153, r: 3, fill: '#30383b' })),
                h('rect', { x: 335, y: 158, width: 359, height: 1317, rx: 35, fill: '#b7bcbe', stroke: '#e0e2e3', strokeWidth: 3 }),
                h('rect', { x: 341, y: 164, width: 347, height: 1305, rx: 30, fill: '#d5d7d7', stroke: '#eff0ef', strokeWidth: 2 }),
                h('text', { x: 512, y: 226, textAnchor: 'middle', fill: '#898d8e', fontSize: 36, fontWeight: 600, fontFamily: 'Arial,sans-serif' }, 'VibeKey'),
                ...[394, 442, 489, 537, 585, 632].map((x, index) => h('g', { key: x },
                  h('rect', { x: x - 14, y: index === 0 || index === 5 ? 270 : 260, width: 28, height: index === 0 || index === 5 ? 79 : 98, rx: 14, fill: '#777e81', stroke: '#f2f3f1', strokeWidth: 3 }),
                  ...[0, 1, 2, 3, 4, 5, 6].map(row => h('path', { key: row, d: `M${x - 5} ${277 + row * 10}h10`, stroke: '#272e32', strokeWidth: 4, strokeDasharray: '2 4' })))),
                h('circle', { cx: 512, cy: 558, r: 156, fill: '#a0a5a7' }),
                h('g', { 'data-au05-knob-rotation': '', transform: `rotate(${snapshot.knobAngle ?? 0} 512 550)` },
                  h('circle', { cx: 512, cy: 550, r: 154, fill: '#e1e3e3', stroke: '#899396', strokeWidth: 5 }),
                  h('circle', { cx: 512, cy: 550, r: 149, fill: 'none', stroke: '#f5f6f4', strokeWidth: 3 }),
                  h('g', { 'data-au05-knob-grip': '', fill: 'none', stroke: '#8d9395', strokeWidth: 5, strokeLinecap: 'round' },
                    ...['M512 420v22', 'M620 550h22', 'M512 658v22', 'M382 550h22'].map(d => h('path', { key: d, d })))),
                h('rect', { x: 397, y: 738, width: 232, height: 676, rx: 15, fill: '#b7bdbf', stroke: '#a9b0b2', strokeWidth: 2 }),
                ...[747, 970, 1191].map((y, index) => h('g', { key: y },
                  h('rect', { x: 406, y, width: 214, height: 213, rx: 8, fill: '#e7e9e8', stroke: '#a6aeb0', strokeWidth: 3 }),
                  h('circle', { cx: 512, cy: [855, 1075, 1298][index] + 5, r: 83, fill: '#c9cdce' }),
                  h('circle', { cx: 512, cy: [855, 1075, 1298][index], r: 81, fill: '#f5f6f3', stroke: '#eef0ed', strokeWidth: 3 }))),
                h('g', { 'data-au05-lamp-echo': '', 'data-active': lampEchoActive, className: 'au05-lamp-echo' },
                  ...['k1', 'k2', 'k3', 'knob'].map((control, index) => h(index === 3 ? 'circle' : 'rect', { key: control,
                    'data-au05-lamp': control, 'data-lamp-mode': lampEcho[index],
                    ...(index === 3 ? { cx: 512, cy: 550, r: 148 } : { x: 406, y: [747, 970, 1191][index], width: 214, height: 213, rx: 8 }) }))),
                h('g', { 'data-au05-input-echo': '', className: 'au05-input-echo' },
                  ...['knob', 'k1', 'k2', 'k3'].filter(control => inputLabel(control)).map(control => h(control === 'knob' ? 'circle' : 'rect', {
                    key: control, 'data-au05-input-control': control, 'data-input-state': inputFeedback[control] ?? inputFeedback.rotation,
                    ...(control === 'knob' ? { cx: 512, cy: 550, r: 132 } : { x: 421, y: { k1: 762, k2: 985, k3: 1206 }[control], width: 184, height: 183, rx: 8 }) }))),
                h('g', { fill: 'none', stroke: '#8d9395', strokeWidth: 5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  h('rect', { x: 500, y: 828, width: 24, height: 36, rx: 12 }),
                  h('path', { d: 'M490 850v6a22 22 0 0 0 44 0v-6M512 878v9' }),
                  h('path', { d: 'M490 1077a23 23 0 0 1 36-23M534 1074a23 23 0 0 1-32 23M500 1076l10 10 22-23' }),
                  h('path', { d: 'M490 1301a23 23 0 0 1 36-23M534 1298a23 23 0 0 1-32 23M503 1289l18 18M521 1289l-18 18' }))),
            ),
            h('div', { 'data-au05-control-detail': '', className: 'au05-control-detail' },
              ...['knob', 'k1', 'k2', 'k3'].map(control => h('div', { key: control, 'data-au05-mapping': control },
                h('h3', null, controlDetails[control].title,
                  inputLabel(control) && h('span', { 'data-au05-input-state': control }, inputLabel(control))),
                h('p', null, controlDetails[control].mapping),
                 !studio && h('p', { 'data-au05-key-light': control, className: 'au05-key-status' }, `配置回读：${lampReadback ? lampModes[lampReadback.channels[['k1', 'k2', 'k3', 'knob'].indexOf(control)]] : '未知'}`),
                 lampRequest(control) && h('p', { 'data-au05-key-request': control, className: 'au05-key-status' }, lampRequest(control)))))),
          h('details', { 'data-au05-device-settings': '' }, h('summary', null, '设备设置'),
          !studio && h('label', { 'data-au05-auto-connect-help': '', className: 'au05-switch', title: '下次加载时尝试一次，不自动重试' },
            h('input', { 'data-au05-auto-connect': '', type: 'checkbox', checked: snapshot.autoConnect,
              onChange: event => controller.setAutoConnect(event.target.checked) }), 'DSH 启动时自动连接'),
           dshMode && Field({ 'data-au05-microphone-settings': '' },
             h('label', { htmlFor: 'au05-microphone' }, '麦克风'),
             h('select', { id: 'au05-microphone', 'data-au05-microphone': '', value: voice.microphoneId ?? '',
               disabled: Boolean(voice.conflictText), onChange: event => controller.selectMicrophone(event.target.value) },
               h('option', { value: '' }, '自动选择（优先 AU05）'),
               h('option', { value: 'default' }, '系统默认'),
               voice.microphoneId && voice.microphoneId !== 'default' && !(voice.microphones ?? []).some(item => item.deviceId === voice.microphoneId)
                 && h('option', { value: voice.microphoneId }, '已选麦克风（不可用）'),
               ...(voice.microphones ?? []).filter(item => item.deviceId !== 'default').map((item, index) => h('option', { key: item.deviceId, value: item.deviceId }, item.label || `麦克风 ${index + 1}`))),
             FieldActions(null,
               h('button', { 'data-au05-refresh-microphones': '', className: 'au05-action', type: 'button', onClick: () => controller.refreshMicrophones() }, '刷新列表'),
               snapshot.canConfigureVoice && h('button', { 'data-au05-voice-settings': '', className: 'au05-action', type: 'button', onClick: () => controller.openVoiceSettings() }, '配置语音'))),
           windowsMode && h('p', { 'data-au05-windows-microphone': '', className: 'au05-note' }, '麦克风在 Windows 系统设置中选择。'),
          shortcutMode && h('div', { 'data-au05-shortcut-settings': '' },
            customMode && Field(null,
              h('label', { htmlFor: 'au05-shortcut' }, '快捷键'),
              h('input', { id: 'au05-shortcut', 'data-au05-shortcut': '', type: 'text', value: shortcutDraft, maxLength: 64,
                placeholder: 'Ctrl+Shift+Space', 'aria-describedby': 'au05-shortcut-help', onChange: event => setShortcutDraft(event.target.value) }),
              FieldActions(null, h('button', { 'data-au05-shortcut-apply': '', type: 'button', className: 'au05-action',
                onClick: () => { if (controller.setShortcut(shortcutDraft)) setShortcutDraft(controller.getSnapshot().customShortcut); } }, '保存快捷键'))),
            customMode && h('p', { id: 'au05-shortcut-help', 'data-au05-shortcut-help': '', className: 'au05-note' }, '需与应用快捷键一致。'),
            bageshuoMode && h('p', { 'data-au05-preset-requirement': '', className: 'au05-note' }, '叭哥说快捷键需设为 Right Alt 单击切换。')),
          Field(null,
            h('label', { htmlFor: 'au05-knob-mode' }, '旋钮行为'),
            h('select', { 'aria-label': '旋钮行为', id: 'au05-knob-mode', 'data-au05-knob-mode': '', value: snapshot.knobMode,
              onChange: event => controller.setKnobMode(event.target.value) },
              h('option', { value: 'regions' }, '区域切换'), h('option', { value: 'sessions' }, '切换会话'), h('option', { value: 'scroll' }, '上下滚动'),
              h('option', { value: 'scroll-page' }, '整屏滚动'), h('option', { value: 'disabled' }, '旋转无动作'))),
          !studio && h('label', { className: 'au05-switch' }, h('input', { 'data-au05-lights': '', type: 'checkbox', checked: snapshot.lightsEnabled,
            onChange: event => controller.setLights(event.target.checked) }), '灯光反馈'),
          !studio && h('label', { className: 'au05-switch' }, h('input', { 'data-au05-key-feedback': '', type: 'checkbox',
            checked: snapshot.keyFeedback === true, disabled: !snapshot.lightsEnabled,
            onChange: event => controller.setKeyFeedback(event.target.checked) }), 'K2 / K3 按键短亮'),
          ),
          h('details', { 'data-au05-advanced': '' }, h('summary', null, '高级设置'),
          connectionRecovery && h('p', { 'data-au05-connection-diagnostic': '', className: 'au05-note', 'aria-label': 'AU05 连接错误码' }, `连接错误码：${snapshot.error}`),
          !studio && Field(null,
            h('label', { htmlFor: 'au05-light-brightness' }, `灯光亮度（0–${maxLightBrightness}）`),
            h('input', { id: 'au05-light-brightness', 'data-au05-light-brightness': '', type: 'range', min: 0, max: maxLightBrightness, step: 1,
              value: snapshot.lightBrightnessDraft ?? snapshot.lightBrightness ?? 2, 'aria-label': '灯光亮度',
              onChange: event => controller.stageLightBrightness(Number(event.target.value)) })),
          !studio && Actions(null,
            h('button', { 'data-au05-apply-brightness': '', className: 'au05-action', type: 'button',
              onClick: () => controller.setLightBrightness(snapshot.lightBrightnessDraft ?? snapshot.lightBrightness ?? 2) },
              `应用亮度 ${snapshot.lightBrightnessDraft ?? snapshot.lightBrightness ?? 2}`),
            h('button', { 'data-au05-clear-brightness': '', className: 'au05-action', type: 'button',
              onClick: () => controller.clearLightBrightness() }, '清除亮度设置并断开')),
          !studio && snapshot.lightBrightness !== null && snapshot.lightResult === 'mismatch' && h('p', { 'data-au05-light-brightness-status': '', className: 'au05-note', role: 'alert' }, '亮度配置回读不一致'),
          studio && h('p', { 'data-au05-k1-lamp-note': '', className: 'au05-note' }, '灯光由 Studio 管理。'),
          !studio && shortcutMode && h('details', { 'data-au05-shortcut-diagnostics': '' },
            h('summary', null, '快捷键诊断'),
            h('textarea', { 'aria-label': 'AU05 快捷键链路诊断 JSON', readOnly: true, rows: 6,
              value: JSON.stringify(snapshot.shortcutTrace) }),
            null),
          (snapshot.knobMode === 'regions' || snapshot.regionDiagnostics) && h('details', { 'data-au05-region-diagnostics': '', 'aria-busy': snapshot.regionDiagnostics?.state === 'recording' },
            h('summary', null, '滚动诊断'),
            Actions(null, h('button', { 'data-au05-start-region-diagnostics': '', className: 'au05-action', type: 'button',
              disabled: !snapshot.connected || !['connecting', 'ready'].includes(snapshot.state)
                || snapshot.knobMode !== 'regions' || snapshot.regionDiagnostics?.state === 'recording',
              onClick: () => controller.startRegionDiagnostics() }, '采样 5 秒')),
            snapshot.regionDiagnostics && snapshot.regionDiagnostics.state !== 'recording'
              && h('textarea', { 'aria-label': 'AU05 滚动诊断 JSON', readOnly: true, rows: 8,
                value: JSON.stringify(snapshot.regionDiagnostics) })),
          !studio && h('details', { 'data-au05-light-diagnostics': '' },
            h('summary', null, '灯光诊断'),
            h('textarea', { 'aria-label': 'AU05 灯光诊断 JSON', readOnly: true, rows: 8,
              value: JSON.stringify({ observation: snapshot.lightObservation, snapshotDiagnostics: snapshot.snapshotDiagnostics ?? [], trace: snapshot.lightTrace ?? [] }) })),
          )));
      };
    }
    function mountActionBridges(ctx, controller, { prefix = 'au05' } = {}) {
        function InputBridge({ sessionId }) {
          const anchor = React.useRef(null), sessionOwner = sessionId && ctx.sessions.binding(sessionId);
          React.useEffect(() => {
            if (!sessionId || !sessionOwner) return;
            // DSH 0.2.1-rc.3 InputBar owns this slot and DraftEditor in this exact card.
            // Never borrow parent props, query document, or move focus to authorize Windows voice.
            const input = () => {
              const marker = anchor.current;
              if (!marker?.isConnected) return null;
              const card = marker.closest('[data-composer-card]');
              if (!card?.isConnected) return null;
              const inputs = card.querySelectorAll('[data-composer-input][contenteditable="true"][role="textbox"]');
              if (inputs.length !== 1) return null;
              const value = inputs[0];
              if (!value.isConnected || value.closest('[data-composer-card]') !== card
                || value.closest('[hidden], [aria-hidden="true"], [inert]') || value.getClientRects().length === 0) return null;
              return value;
            };
            return controller.bridge(sessionId, () => {
              const value = input(); if (!value) return false;
              value.focus({ preventScroll: true }); return document.activeElement === value;
            }, () => { const value = input(); return value !== null && document.activeElement === value; }, input);
          }, [sessionId, sessionOwner]);
          return h('span', { 'data-au05-input-anchor': '', 'aria-hidden': true, hidden: true, ref: anchor });
        }
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: `${prefix}-input-bridge`, order: 99 }, InputBridge));
        function ScrollBridge({ sessionId }) {
          const anchor = React.useRef(null), sessionOwner = sessionId && ctx.sessions.binding(sessionId);
          React.useEffect(() => {
            if (!sessionId || !sessionOwner) return;
            return controller.scrollBridge(sessionId, () => {
              // DSH 0.2.1-rc.3 compatibility: the public session-scoped dock slot is inside
              // its conversation scrollport. This is DOM geometry adaptation, not a public
              // scroll service; it cannot interrupt the host's running follow animations.
              const marker = anchor.current;
              if (!marker?.isConnected || typeof globalThis.getComputedStyle !== 'function') return null;
              const visible = element => {
                const rect = element.getBoundingClientRect(), width = globalThis.innerWidth, height = globalThis.innerHeight;
                return element.getClientRects().length > 0 && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
                  && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < width && rect.top < height;
              };
              const root = marker.closest('[data-conversation-content]');
              if (!root?.isConnected || root.dataset?.conversationSession !== sessionId || !root.contains(marker)
                || root.closest('[hidden], [aria-hidden="true"], [inert]') || !visible(root)) return null;
              for (let port = marker.parentElement, depth = 0; port && port !== root && depth < 32; port = port.parentElement, depth++) {
                if (['BODY', 'HTML'].includes(port.tagName) || !root.contains(port)) return null;
                if (!port.hasAttribute('data-conversation-scroll')) continue;
                if (!port.isConnected || port.closest('[hidden], [aria-hidden="true"], [inert]')
                  || port.closest('textarea, [contenteditable="true"], [role="textbox"]') || !visible(port)
                  || typeof port.scrollBy !== 'function' || !Number.isFinite(port.clientWidth) || port.clientWidth <= 0
                  || !Number.isFinite(port.clientHeight) || port.clientHeight <= 0
                  || !Number.isFinite(port.scrollHeight) || controller.getSnapshot().knobMode !== 'regions' && port.scrollHeight <= port.clientHeight
                  || !['auto', 'scroll'].includes(globalThis.getComputedStyle(port).overflowY)) return null;
                return { root, port };
              }
              return null;
            });
          }, [sessionId, sessionOwner]);
          return h('span', { 'data-au05-scroll-anchor': '', 'aria-hidden': true, hidden: true, ref: anchor });
        }
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: `${prefix}-scroll-bridge`, order: 99 }, ScrollBridge));
    }
    // RPC receives unprefixed controller methods and returns unwrapped values.
    // Studio owns its transport: neither this factory nor its View opens native HID.
    function createStudioActions(ctx, { rpc: request } = {}) {
      if (typeof request !== 'function') throw new TypeError('Studio actions require an explicit rpc function');
      const controller = createController(ctx, { request, studio: true });
      ctx.effect(() => () => controller.dispose());
      mountActionBridges(ctx, controller, { prefix: 'au05-studio' });
      return { controller, View: productView(controller) };
    }
    return {
      // `uiSession.sessionStatus` became a separate Cordis service in DSH 0.2.3, so it has to be
      // declared on its own: reading it through the `uiSession` handle alone throws
      // `cannot get property "uiSession.sessionStatus" without inject`.
      inject: ['slots', 'connection', 'sessions', 'uiSession', 'uiSession.sessionStatus',
        'uiWorkspace', 'workspaces', 'remote'],
      createStudioActions,
      mountActionBridges,
      apply(ctx) {
        const controller = createController(ctx), Device = productView(controller);
        ctx.effect(() => () => controller.dispose());
        ctx.inject?.(['pluginNavigation'], scope => {
          if (typeof scope.pluginNavigation?.openBundle !== 'function') return;
          scope.effect(() => controller.setVoiceSettings(() => scope.pluginNavigation.openBundle('@deepseek-ai/dsh-experimental-voice-input-bundle')));
        });
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'au05-device', order: 90 }, Device));
        mountActionBridges(ctx, controller);
      },
    };
  },
});
