import test from 'node:test';
import assert from 'node:assert/strict';
import { createFloatingCapsule } from '../packages/dsh-plugin/src/capsule.js';

const key = 'abworks.au05.capsule-position.v1';
function target() {
  const listeners = new Map();
  return { style: {}, attrs: {}, listeners,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    setAttribute(name, value) { this.attrs[name] = value; },
    emit(name, values = {}) { const event = { button: 0, isPrimary: true, pointerId: 1, detail: 1,
      clientX: 300, clientY: 100, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...values };
      for (const fn of [...(listeners.get(name) ?? [])]) fn(event); return event; },
    count() { return [...listeners.values()].reduce((sum, list) => sum + list.size, 0); },
  };
}
function fixture({ saved = null, brokenRead = false, brokenWrite = false, width = 1200, height = 800 } = {}) {
  const root = target(), pill = target(), panel = target(), window = Object.assign(target(), { innerWidth: width, innerHeight: height });
  let panelMounted = false, pillWidth = 120, captures = new Set(), releases = [], observer;
  const writes = [], values = new Map(saved === null ? [] : [[key, typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
  const storage = { getItem(name) { if (brokenRead) throw Error('blocked'); return values.get(name) ?? null; },
    setItem(name, value) { if (brokenWrite) throw Error('blocked'); writes.push([name, value]); values.set(name, value); }, removeItem(name) { values.delete(name); } };
  root.querySelector = () => panelMounted ? panel : null;
  root.contains = element => element === pill || element === panel;
  // A fixed shrink-to-pill root: rect follows actual left/top and percentage transform.
  pill.getBoundingClientRect = () => {
    let left = root.style.left ? parseFloat(root.style.left) : width - pillWidth - 16;
    const top = root.style.top ? parseFloat(root.style.top) : 60;
    if (root.style.transform === 'translateX(-50%)') left -= pillWidth / 2;
    if (root.style.transform === 'translateX(50%)') left += pillWidth / 2;
    return { left, top, width: pillWidth, height: 32, right: left + pillWidth, bottom: top + 32 };
  };
  pill.setPointerCapture = id => captures.add(id);
  pill.hasPointerCapture = id => captures.has(id);
  pill.releasePointerCapture = id => { captures.delete(id); releases.push(id); pill.emit('lostpointercapture', { pointerId: id }); };
  window.ResizeObserver = class { constructor(callback) { observer = this; this.callback = callback; } observe() {} disconnect() { this.disconnected = true; } };
  const api = createFloatingCapsule({ root, pill, window, storage });
  return { root, pill, panel, window, api, storage, writes, values, captures, releases,
    observer: () => observer, rect: () => pill.getBoundingClientRect(),
    panelOpen(value) { panelMounted = value; api.setOpen(value); },
    size(value) { pillWidth = value; observer.callback(); },
    drag(dx, dy = 0) { pill.emit('pointerdown'); pill.emit('pointermove', { clientX: 300 + dx, clientY: 100 + dy }); pill.emit('pointerup'); },
  };
}
const saved = (edge, x = 0.5, y = 0.5) => ({ version: 1, x, y, edge });

test('scrollbar-excluding document viewport keeps restored pill and panel out of native scrollbars', () => {
  const f = fixture({ saved: saved('right', 1), width: 360, height: 640 });
  f.pill.ownerDocument = { documentElement: { clientWidth: 344, clientHeight: 624 } };
  f.panelOpen(true);
  assert.equal(f.rect().right, 344);
  const left = f.rect().left + parseFloat(f.panel.style.left);
  assert.ok(left >= 0 && left + parseFloat(f.panel.style.width) <= 344);
  f.api.dispose();
});

test('threshold preserves clicks; completed drag saves once and consumes only pointer click', () => {
  const f = fixture();
  const before = f.rect(); f.pill.emit('pointerdown');
  assert.equal(f.captures.has(1), true);
  assert.equal(f.pill.emit('pointermove', { clientX: 303, clientY: 102 }).prevented, false);
  assert.deepEqual(f.rect(), before); f.pill.emit('pointerup');
  assert.equal(f.writes.length, 0); assert.equal(f.pill.emit('click').prevented, false);
  f.drag(-100, 40); assert.equal(f.writes.length, 1); assert.equal(f.rect().left, before.left - 100);
  assert.equal(f.pill.emit('click', { detail: 0 }).prevented, false, 'keyboard activation remains available');
  const click = f.pill.emit('click'); assert.equal(click.prevented, true); assert.equal(click.stopped, true);
  assert.equal(f.pill.emit('click').prevented, false); assert.equal(f.captures.size, 0);
  f.api.dispose();
});

test('nonprimary, right button and wrong pointer do not move capsule', () => {
  const f = fixture(), before = f.rect();
  f.pill.emit('pointerdown', { button: 2 }); f.pill.emit('pointermove', { clientX: 600 });
  f.pill.emit('pointerdown', { isPrimary: false }); assert.equal(f.captures.size, 0);
  f.pill.emit('pointerdown'); f.pill.emit('pointermove', { pointerId: 2, clientX: 600 });
  f.pill.emit('pointerup', { pointerId: 2 }); assert.equal(f.captures.size, 1);
  assert.deepEqual(f.rect(), before); f.api.dispose(); assert.equal(f.captures.size, 0);
});

for (const end of ['pointercancel', 'lostpointercapture', 'blur', 'dispose']) {
  test(`${end} rolls back moved gesture and releases capture without saving`, () => {
    const f = fixture(), before = f.rect(); f.pill.emit('pointerdown');
    f.pill.emit('pointermove', { clientX: 400, clientY: 200 });
    if (end === 'blur') f.window.emit('blur'); else if (end === 'dispose') f.api.dispose(); else f.pill.emit(end);
    assert.deepEqual(f.rect(), before); assert.equal(f.writes.length, 0); assert.equal(f.captures.size, 0);
    f.api.dispose(); f.api.dispose(); assert.equal(f.root.count() + f.pill.count() + f.window.count(), 0);
    assert.equal(f.observer().disconnected, true);
  });
}

for (const edge of ['left', 'right']) {
  test(`${edge} edge is half-hidden, reveals for hover/focus/open and re-hides`, () => {
    const f = fixture({ saved: saved(edge) });
    const hiddenLeft = edge === 'left' ? -60 : 1140, visibleLeft = edge === 'left' ? 0 : 1080;
    assert.equal(f.rect().left, hiddenLeft);
    f.root.emit('pointerenter'); assert.equal(f.rect().left, visibleLeft);
    f.root.emit('pointerleave'); assert.equal(f.rect().left, hiddenLeft);
    f.root.emit('focusin'); assert.equal(f.rect().left, visibleLeft);
    f.root.emit('focusout', { relatedTarget: f.panel }); assert.equal(f.rect().left, visibleLeft);
    f.root.emit('focusout', { relatedTarget: null }); assert.equal(f.rect().left, hiddenLeft);
    f.panelOpen(true); assert.equal(f.rect().left, visibleLeft);
    f.panelOpen(false); assert.equal(f.rect().left, hiddenLeft);
    f.size(160); assert.equal(f.rect().left, edge === 'left' ? -80 : 1120);
    assert.equal(f.writes.length, 0); f.api.dispose();
  });
}

test('drag near either edge snaps and persists normalized final position only', () => {
  for (const edge of ['left', 'right']) {
    const f = fixture({ saved: saved(null) });
    f.pill.emit('pointerdown'); f.pill.emit('pointermove', { clientX: edge === 'left' ? -500 : 2000 });
    assert.equal(f.writes.length, 0); f.pill.emit('pointerup');
    assert.equal(JSON.parse(f.writes[0][1]).edge, edge);
    f.root.emit('pointerleave'); assert.equal(f.root.attrs['data-au05-hidden'], 'true'); f.api.dispose();
  }
});

test('resize clamps capsule and positions open panel within viewport, including upward opening', () => {
  for (const edge of ['left', 'right', null]) for (const y of [0, 1]) {
    const f = fixture({ saved: saved(edge, 1, y) }); f.panelOpen(true);
    f.window.innerWidth = 320; f.window.innerHeight = 240; f.window.emit('resize');
    const rect = f.rect(), panelWidth = parseFloat(f.panel.style.width);
    const left = rect.left + parseFloat(f.panel.style.left);
    assert.ok(rect.left >= 0 && rect.right <= 320); assert.ok(rect.top >= 0 && rect.bottom <= 240);
    assert.ok(left >= 0 && left + panelWidth <= 320);
    const maxHeight = parseFloat(f.panel.style.maxHeight);
    if (y === 1) { assert.equal(f.panel.style.top, 'auto'); assert.ok(rect.top - 8 - maxHeight >= 0); }
    else { assert.equal(f.panel.style.bottom, 'auto'); assert.ok(rect.bottom + 8 + maxHeight <= 240); }
    assert.equal(f.writes.length, 0); f.api.dispose();
  }
});

test('Alt arrows move by 16px, other modifiers are ignored, and Alt Home restores default without saving', () => {
  const f = fixture({ saved: saved(null) }), before = f.rect();
  for (const modifier of [{}, { altKey: true, ctrlKey: true }, { altKey: true, metaKey: true }]) {
    assert.equal(f.pill.emit('keydown', { key: 'ArrowLeft', ...modifier }).prevented, false);
  }
  assert.deepEqual(f.rect(), before);
  for (const [keyName, dx, dy] of [['ArrowLeft', -16, 0], ['ArrowRight', 16, 0], ['ArrowUp', 0, -16], ['ArrowDown', 0, 16]]) {
    const start = f.rect(), event = f.pill.emit('keydown', { key: keyName, altKey: true });
    assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.equal(f.rect().left, start.left + dx); assert.equal(f.rect().top, start.top + dy);
  }
  assert.equal(f.writes.length, 4);
  f.pill.emit('keydown', { key: 'Home', altKey: true });
  assert.equal(f.rect().left, 1064); assert.equal(f.rect().top, 60);
  assert.equal(f.values.has(key), false); assert.equal(f.writes.length, 4); f.api.dispose();
});

test('pointerup outside capsule hides docked pill without relying on pointerleave', () => {
  for (const edge of ['left', 'right']) {
    const f = fixture({ saved: saved(null) });
    f.pill.emit('pointerdown');
    const clientX = edge === 'left' ? -500 : 2000;
    f.pill.emit('pointermove', { clientX }); f.pill.emit('pointerup', { clientX });
    assert.equal(f.root.attrs['data-au05-docked'], edge);
    assert.equal(f.root.attrs['data-au05-hidden'], 'true');
    assert.equal(f.rect().left, edge === 'left' ? -60 : 1140); f.api.dispose();
  }
});

test('very short viewport uses bounded overlay panel instead of overflowing above or below pill', () => {
  for (const height of [48, 64, 100]) for (const y of [0, 0.5, 1]) {
    const f = fixture({ height, saved: saved('right', 1, y) }); f.panelOpen(true);
    const top = f.rect().top + parseFloat(f.panel.style.top), maxHeight = parseFloat(f.panel.style.maxHeight);
    assert.equal(f.panel.style.bottom, 'auto'); assert.ok(top >= 0);
    assert.ok(top + maxHeight <= height, `${height}px viewport, y=${y}`);
    assert.ok(parseFloat(f.panel.style.padding) * 2 <= maxHeight); f.api.dispose();
  }
});

test('malformed, invalid and unavailable storage retain in-memory dragging', () => {
  for (const value of ['{', 'x'.repeat(300), saved('wrong'), saved(null, -1), saved(null, 0, 2), { ...saved(null), version: 2 }]) {
    const f = fixture({ saved: value }); assert.equal(f.rect().left, 1064); f.drag(-100);
    assert.equal(f.rect().left, 964); f.api.dispose();
  }
  const blocked = fixture({ brokenRead: true, brokenWrite: true }); blocked.drag(-100);
  assert.equal(blocked.rect().left, 964); assert.equal(blocked.writes.length, 0); blocked.api.dispose();
});
