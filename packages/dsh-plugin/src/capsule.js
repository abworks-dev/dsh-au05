// Local presentation only: never calls device, microphone, session or approval APIs.
export function createFloatingCapsule({ root, pill, window = globalThis, storage }) {
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
