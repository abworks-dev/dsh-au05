import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegionNavigation } from '../packages/dsh-plugin/src/regions.js';

function fixture(onChange = () => {}, animated = false, scrollBackend = 'dom') {
  const listeners = new Map(), frames = new Map(), cancelled = new Map(), mediaListeners = new Set();
  let time = 0, nextFrame = 0;
  const media = { matches: false, addEventListener: (_, fn) => mediaListeners.add(fn), removeEventListener: (_, fn) => mediaListeners.delete(fn) };
  const window = { innerWidth: 1000, innerHeight: 800, addEventListener: (k, fn) => listeners.set(k, fn), removeEventListener: k => listeners.delete(k),
    matchMedia: () => media, performance: { now: () => time } };
  if (animated) {
    window.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
    window.cancelAnimationFrame = id => { if (frames.has(id)) cancelled.set(id, frames.get(id)); frames.delete(id); };
  }
  const document = { visibilityState: 'visible', hasFocus: () => true, activeElement: null,
    addEventListener: (k, fn) => listeners.set(k, fn), removeEventListener: k => listeners.delete(k), querySelectorAll: () => [] };
  function element(attrs = {}) {
    return { attrs, isConnected: true, style: {}, children: [], parentElement: null, scrollTop: 0, scrollHeight: 600, clientHeight: 100,
      getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; },
      closest() { return this.hidden ? this : null; }, getClientRects() { return this.isConnected ? [{}] : []; },
      getBoundingClientRect() { return this.rect ?? { left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 }; },
      appendChild(child) { child.parentElement = this; this.children.push(child); },
      remove() { this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.isConnected = false; },
      focus() { document.activeElement = this; }, scrollIntoView() {}, click() { this.clicks = (this.clicks ?? 0) + 1; }, querySelectorAll() { return []; }
    };
  }
  document.body = element(); document.createElement = () => element();
  const conversation = element(), input = element();
  const target = { sessionId: 's', binding: {}, sessionOwner: {}, focused: true };
  let current = target;
  const nav = createRegionNavigation({ document, window, getComputedStyle: el => el.style, readTarget: () => current, scrollBackend, onChange });
  return { nav, target, conversation, input, document, window, listeners, element, frames, cancelled, mediaListeners,
    setCurrent: value => { current = value; },
    advance(ms) { time += ms; },
    frame(ms = 16, deliveryLag = 0) { time += ms; const pending = [...frames]; frames.clear(); for (const [, fn] of pending) fn(time - deliveryLag); },
    reduce(value) { media.matches = value; for (const fn of mediaListeners) fn({ matches: value }); } };
}

test('cycles only visible regions and paints border with operational label', () => {
  const f = fixture(), ports = { input: f.input, conversation: f.conversation };
  assert.equal(f.nav.cycle(f.target, ports), true); assert.equal(f.nav.activeId, 'conversation');
  assert.equal(f.document.body.children[0].attrs['data-au05-region'], 'conversation');
  assert.equal(f.document.body.children[0].children[0].textContent, '对话');
  const overlay = f.document.body.children[0];
  f.listeners.get('resize')(); f.listeners.get('scroll')();
  assert.equal(f.document.body.children[0], overlay);
  assert.equal(f.nav.rotate(f.target, 1, ports), true); assert.equal(f.conversation.scrollTop, 80);
  assert.equal(f.nav.cycle(f.target, ports), true); assert.equal(f.document.activeElement, f.input);
  f.input.hidden = true; f.nav.reconcile(f.target, ports);
  assert.equal(f.nav.activeId, null); assert.equal(f.document.body.children.length, 0);
  f.conversation.style.display = 'none'; assert.equal(f.nav.cycle(f.target, ports), false);
});

test('native backend exposes a fresh lease but never falls back to DOM scrolling or RAF', () => {
  const f = fixture(() => {}, true, 'native'), ports = { input: f.input, conversation: f.conversation };
  const wheel = [];
  f.conversation.attrs['data-conversation-scroll'] = '';
  f.conversation.dispatchEvent = event => wheel.push(event);
  f.window.WheelEvent = class { constructor(type) { this.type = type; } };
  assert.equal(f.nav.cycle(f.target, ports), true);
  const selected = f.nav.currentScroll(f.target, ports);
  assert.equal(selected.element, f.conversation);
  assert.equal(f.nav.currentScroll(f.target, ports), selected, 'same valid selection retains its lease');
  assert.equal(f.nav.rotate(f.target, 1, ports), false);
  assert.equal(f.nav.rotate(f.target, -1, ports), false);
  assert.equal(f.conversation.scrollTop, 0); assert.equal(f.frames.size, 0); assert.deepEqual(wheel, []);
  assert.deepEqual(f.nav.getDiagnostics().config, { durationMs: 5000, maxEntries: 240, backend: 'native', wheelDelta: 120, clockAvailable: true });
  f.nav.cycle(f.target, ports); f.nav.cycle(f.target, ports);
  const returned = f.nav.currentScroll(f.target, ports);
  assert.equal(returned.element, selected.element);
  assert.notEqual(returned, selected, 'A to B to A must not revive the original pending native request');
  f.nav.clear(); assert.equal(f.nav.currentScroll(f.target, ports), null);
  f.nav.cycle(f.target, ports);
  const changedPorts = { ...ports, conversation: f.element() };
  assert.equal(f.nav.currentScroll(f.target, changedPorts), null, 'replacement port revokes the lease');
  assert.equal(f.nav.activeId, null);
  f.nav.dispose(); assert.equal(f.frames.size, 0);
});

test('offscreen and disabled inputs are not candidates', () => {
  const f = fixture(); f.input.disabled = true;
  f.conversation.rect = { left: 10, right: 110, top: 900, bottom: 1000, width: 100, height: 100 };
  assert.equal(f.nav.cycle(f.target, f), false);
});

test('blur, visibility, session/owner/pending changes and dispose clean up', () => {
  const f = fixture(); f.nav.cycle(f.target, f); f.listeners.get('blur')();
  assert.equal(f.nav.activeId, null); assert.equal(f.document.body.children.length, 0);
  f.nav.cycle(f.target, f); f.setCurrent({ ...f.target, sessionOwner: {} });
  assert.equal(f.nav.rotate(f.target, 1, f), false); assert.equal(f.nav.activeId, null);
  f.setCurrent(f.target); f.nav.cycle(f.target, f);
  const changed = { ...f.target, pending: {}, pendingKey: 'new' }; f.setCurrent(changed);
  assert.equal(f.nav.reconcile(changed, f), false); assert.equal(f.nav.activeId, null);
  f.setCurrent(f.target); f.nav.cycle(f.target, f); f.document.visibilityState = 'hidden'; f.listeners.get('visibilitychange')();
  assert.equal(f.document.body.children.length, 0);
  f.document.visibilityState = 'visible'; f.nav.cycle(f.target, f); f.nav.dispose();
  assert.equal(f.listeners.size, 0); assert.equal(f.nav.cycle(f.target, f), false);
});

test('verified question options rotate focus without click or submit; explicit commit selects only', () => {
  const f = fixture();
  const pending = { kind: 'question', sessionId: 's', key: 'q', getSnapshot: () => ({ closed: false, state: 'open', channel: 'rpc' }) };
  f.target.pending = pending; f.target.pendingKey = 'q';
  const card = f.element({ 'data-question-key': 'q' }), group = f.element();
  const a = f.element({ 'aria-checked': 'true', role: 'radio' }), b = f.element({ 'aria-checked': 'false', role: 'radio' });
  a.parentElement = group; b.parentElement = group;
  f.document.querySelectorAll = selector => selector === '[data-question-key]' ? [card] : [];
  card.querySelectorAll = selector => selector.includes('radiogroup') ? [group] : [];
  group.querySelectorAll = () => [a, b];
  f.nav.cycle(f.target, f); f.nav.cycle(f.target, f); assert.equal(f.nav.activeId, 'options');
  assert.equal(f.nav.currentScroll(f.target, f), null);
  assert.equal(f.nav.rotate(f.target, 1, f), true);
  assert.equal(f.document.activeElement, b);
  assert.equal(a.clicks, undefined); assert.equal(b.clicks, undefined);
  assert.equal(f.nav.commitSelection(f.target, f), 'advanced'); assert.equal(b.clicks, 1);
  const pager = f.element(); pager.textContent = '2 / 2';
  const buttons = [f.element(), f.element(), f.element(), f.element()]; buttons[1].disabled = true;
  card.querySelectorAll = selector => selector.includes('radiogroup') ? [group]
    : selector === 'section > footer button' ? buttons : selector.includes('first-child') ? [pager] : [];
  assert.equal(f.nav.commitSelection(f.target, f), 'selected'); assert.equal(b.clicks, 2);
  pager.textContent = '1 / 2';
  assert.equal(f.nav.commitSelection(f.target, f), 'advanced'); assert.equal(b.clicks, 3);
  pending.kind = 'approval'; assert.equal(f.nav.commitSelection(f.target, f), false);
  assert.equal(b.clicks, 3); assert.equal(f.nav.activeId, null);
});

test('older sidebar discovery requires unique current-session host row and scroll ancestor', () => {
  const f = fixture(), sidebar = f.element(), row = f.element({ 'data-row-key': 'session:s' });
  sidebar.style.overflowY = 'auto'; row.parentElement = sidebar; sidebar.parentElement = f.document.body;
  f.document.querySelectorAll = selector => selector === '[data-row-key]' ? [row] : [];
  f.nav.cycle(f.target, f); assert.equal(f.nav.activeId, 'sessions');
  f.nav.rotate(f.target, 1, f); assert.equal(sidebar.scrollTop, 80);
  f.document.querySelectorAll = selector => selector === '[data-row-key]' ? [row, row] : [];
  f.nav.reconcile(f.target, f); assert.equal(f.nav.activeId, null);
});

test('sidebar remains in cycle when current row is collapsed, filtered, or offscreen', () => {
  const f = fixture(), sidebar = f.element(), tree = f.element({ role: 'tree' });
  const workspace = f.element({ 'data-row-key': 'workspace:project' });
  sidebar.style.overflowY = 'auto'; tree.parentElement = sidebar; sidebar.parentElement = f.document.body;
  workspace.parentElement = tree; tree.querySelectorAll = () => [workspace];
  f.document.querySelectorAll = selector => selector === '[role="tree"]' ? [tree] : selector === '[data-row-key]' ? [workspace] : [];
  for (const expected of ['sessions', 'conversation', 'input', 'sessions']) {
    assert.equal(f.nav.cycle(f.target, f), true); assert.equal(f.nav.activeId, expected);
  }
  assert.equal(f.document.body.children[0].children[0].textContent, '会话列表');
  f.nav.rotate(f.target, 1, f); assert.equal(sidebar.scrollTop, 80);
  f.nav.rotate(f.target, -1, f); assert.equal(sidebar.scrollTop, 0);
  workspace.rect = { top: -200, bottom: -100, left: 0, right: 100, width: 100, height: 100 };
  assert.equal(f.nav.reconcile(f.target, f), true);
  sidebar.hidden = true; f.nav.reconcile(f.target, f); assert.equal(f.nav.activeId, null);
});

test('multiple visible workspace scroll containers fail closed, not arbitrary tree panels', () => {
  const f = fixture(), a = f.element({ role: 'tree' }), b = f.element({ role: 'tree' });
  a.style.overflowY = b.style.overflowY = 'auto';
  a.querySelectorAll = () => [f.element({ 'data-row-key': 'session:a' })];
  b.querySelectorAll = () => [f.element({ 'data-row-key': 'workspace:b' })];
  f.document.querySelectorAll = selector => selector === '[role="tree"]' ? [a, b] : [];
  f.nav.cycle(f.target, f); assert.equal(f.nav.activeId, 'conversation');
  b.querySelectorAll = () => []; // A different tool's tree is not a session list.
  f.nav.cycle(f.target, f); f.nav.cycle(f.target, f); assert.equal(f.nav.activeId, 'sessions');
});

test('labels stay anchored to the top-left border, above it when space permits', () => {
  const f = fixture(); f.conversation.rect = { left: 50, top: 70, right: 350, bottom: 400, width: 300, height: 330 };
  f.nav.cycle(f.target, f);
  const overlay = f.document.body.children[0], label = overlay.children[0];
  assert.equal(overlay.style.left, '50px'); assert.equal(overlay.style.top, '70px');
  assert.equal(label.style.left, '0'); assert.equal(label.style.top, '0');
  assert.equal(label.style.transform, 'translateY(-100%)');
  f.conversation.rect.top = 0; f.listeners.get('resize')();
  assert.equal(label.style.transform, 'none'); assert.equal(label.style.whiteSpace, 'nowrap');
});

test('choice questions cycle four independent regions including wrapped host options and offscreen custom input', () => {
  for (const wrapped of [false, true]) {
    const f = fixture(), sidebar = f.element(), tree = f.element({ role: 'tree' }), row = f.element({ 'data-row-key': 'workspace:p' });
    sidebar.style.overflowY = 'auto'; tree.parentElement = sidebar; tree.querySelectorAll = () => [row];
    const card = f.element({ 'data-question-key': 'q' }), viewport = f.element(), group = f.element(), custom = f.element();
    viewport.rect = { left: 10, right: 210, top: 50, bottom: 250, width: 200, height: 200 }; viewport.scrollHeight = 1200;
    const optionRow = f.element({ 'data-option-row': '' }); optionRow.parentElement = group;
    const option = f.element({ role: 'radio', 'aria-checked': 'true' }); option.parentElement = wrapped ? optionRow : group;
    const nested = f.element({ role: 'radio', 'aria-checked': 'false' }); nested.parentElement = f.element();
    const rectAt = top => ({ left: 10, right: 110, top: top - viewport.scrollTop, bottom: top + 40 - viewport.scrollTop, width: 100, height: 40 });
    custom.getBoundingClientRect = () => rectAt(900); option.getBoundingClientRect = () => rectAt(100);
    group.querySelectorAll = () => [option, nested];
    card.querySelectorAll = selector => selector === '[data-question-scroll]' ? [viewport] : selector.includes('textarea') ? [custom]
      : selector.includes('radiogroup') ? [group] : [];
    f.document.querySelectorAll = selector => selector === '[role="tree"]' ? [tree] : selector === '[data-row-key]' ? [row]
      : selector === '[data-question-key]' ? [card] : [];
    f.target.pending = { kind: 'question', sessionId: 's', key: 'q', getSnapshot: () => ({ closed: false, state: 'open', channel: 'rpc' }) };
    f.target.pendingKey = 'q';
    for (const id of ['sessions', 'conversation', 'input', 'options', 'sessions']) {
      assert.equal(f.nav.cycle(f.target, f), true); assert.equal(f.nav.activeId, id);
      if (id === 'input') { assert.equal(f.document.activeElement, custom); assert.ok(viewport.scrollTop > 0); }
      if (id === 'options') { assert.equal(f.document.activeElement, option); assert.equal(option.clicks, undefined); }
    }
    assert.equal(f.conversation.scrollTop, 0, 'revealing question controls never scrolls the outer conversation');
    f.nav.dispose();
  }
});

test('host conversation wheel intent cancels follow before position writes and never targets the composer', () => {
  const f = fixture(), log = []; f.conversation.attrs['data-conversation-scroll'] = '';
  f.window.WheelEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  let following = true;
  f.conversation.dispatchEvent = event => { log.push(['intent', event.type, event.deltaY, event.bubbles]); following = false; return true; };
  f.conversation.scrollBy = value => { log.push(['scroll', value.top, value.behavior]); if (!following) f.conversation.scrollTop += value.top; };
  f.input.dispatchEvent = () => assert.fail('do not dispatch through composer wheel handlers');
  f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f);
  assert.deepEqual(log, [['intent', 'wheel', 80, true], ['scroll', 80, 'instant']]); assert.equal(f.conversation.scrollTop, 80);
  f.nav.rotate(f.target, -1, f); assert.equal(f.conversation.scrollTop, 0);
  delete f.window.WheelEvent; assert.equal(f.nav.rotate(f.target, 1, f), false); assert.equal(f.conversation.scrollTop, 0);
});

test('missing-RAF fallback uses actual positions immediately and supports reversed ports', () => {
  const f = fixture(), calls = [];
  f.conversation.scrollBy = value => { calls.push(value); f.conversation.scrollTop += value.top; };
  f.nav.cycle(f.target, f);
  f.nav.rotate(f.target, 1, f); f.nav.rotate(f.target, 1, f);
  assert.deepEqual(calls.map(x => x.top), [80, 80]);
  assert.equal(f.conversation.scrollTop, 160);
  assert.ok(calls.every(x => x.behavior === 'instant'));
  f.conversation.scrollTop = 100; f.nav.rotate(f.target, -1, f);
  assert.equal(calls.at(-1).top, -80); assert.equal(f.conversation.scrollTop, 20);
  f.conversation.scrollTop = 10; // Manual scroll or host layout update, not an old animation target.
  f.nav.rotate(f.target, 1, f); assert.equal(f.conversation.scrollTop, 90);
  f.nav.cycle(f.target, f); f.nav.cycle(f.target, f);
  f.conversation.style.flexDirection = 'column-reverse'; f.conversation.scrollTop = 0;
  f.nav.rotate(f.target, -1, f); assert.equal(calls.at(-1).top, -80);
  f.conversation.scrollTop = -100; f.nav.rotate(f.target, 1, f); assert.equal(calls.at(-1).top, 80);
  f.window.matchMedia = () => ({ matches: true });
  f.nav.rotate(f.target, -1, f); assert.equal(calls.at(-1).behavior, 'instant');
});

test('selected region scrolls directly without consulting pointer location or any global scroll target', () => {
  const f = fixture(), calls = [];
  f.conversation.scrollTop = 100;
  f.conversation.matches = f.conversation.querySelector = () => assert.fail('region scrolling never hit-tests the pointer');
  f.document.elementFromPoint = () => assert.fail('no pointer hit-testing');
  f.window.scrollBy = () => assert.fail('never scroll the window');
  f.conversation.scrollBy = value => { calls.push(value); f.conversation.scrollTop += value.top; };
  f.nav.cycle(f.target, f);
  const lease = f.nav.currentScroll(f.target, f);
  assert.equal(lease.element, f.conversation); assert.equal(lease.id, 'conversation');
  assert.equal(f.nav.rotate(f.target, 1, f), true);
  assert.equal(f.nav.rotate(f.target, -1, f), true);
  assert.deepEqual(calls, [{ top: 80, behavior: 'instant' }, { top: -80, behavior: 'instant' }]);
  assert.equal(f.conversation.scrollTop, 100);
  f.nav.cycle(f.target, f);
  assert.equal(f.nav.rotate(f.target, 1, f), true);
  assert.equal(f.input.scrollTop, 80); assert.equal(f.conversation.scrollTop, 100);
  f.nav.dispose();
});

test('every cycle creates an unrevivable scroll lease while ordinary reconciliation keeps it stable', () => {
  let changes = 0; const f = fixture(() => changes++);
  assert.equal(f.nav.currentScroll(f.target, f), null);
  f.nav.cycle(f.target, f); const first = f.nav.currentScroll(f.target, f);
  f.nav.reconcile(f.target, f); assert.equal(f.nav.currentScroll(f.target, f), first);
  f.nav.cycle(f.target, f); const second = f.nav.currentScroll(f.target, f);
  assert.equal(second.element, f.input); assert.notEqual(second, first);
  f.nav.cycle(f.target, f); const again = f.nav.currentScroll(f.target, f);
  assert.equal(again.element, first.element); assert.notEqual(again, first);
  assert.equal(changes, 3);
  f.nav.clear(); assert.equal(f.nav.currentScroll(f.target, f), null); assert.equal(changes, 4);
  f.nav.clear(); assert.equal(changes, 4); f.nav.dispose();
});

test('a same-id element replacement revokes the lease and requires a new explicit cycle', () => {
  let changes = 0; const f = fixture(() => changes++);
  f.nav.cycle(f.target, f); const old = f.nav.currentScroll(f.target, f);
  const replacement = f.element(), ports = { conversation: replacement, input: f.input };
  assert.equal(f.nav.reconcile(f.target, ports), false); assert.equal(f.nav.activeId, null);
  assert.equal(f.nav.currentScroll(f.target, ports), null); assert.equal(changes, 2);
  assert.equal(f.nav.rotate(f.target, 1, ports), false);
  f.nav.cycle(f.target, ports);
  assert.equal(f.nav.currentScroll(f.target, ports).element, replacement);
  assert.notEqual(f.nav.currentScroll(f.target, ports), old);
  f.nav.dispose(); assert.equal(changes, 4);
});

test('host wheel listeners cannot revive a revoked selection or write to a replaced region', () => {
  const changes = [
    f => f.nav.clear(),
    f => f.nav.cycle(f.target, f),
    f => { f.nav.cycle(f.target, f); f.nav.cycle(f.target, f); },
    f => { f.conversation.isConnected = false; },
    f => { f.conversation.hidden = true; },
    f => { f.conversation = f.element(); },
    f => f.setCurrent({ ...f.target, focused: false }),
    f => f.setCurrent({ ...f.target, sessionOwner: {} }),
    f => f.setCurrent({ ...f.target, pending: {}, pendingKey: 'new' }),
  ];
  for (const change of changes) {
    const f = fixture(), original = f.conversation;
    original.attrs['data-conversation-scroll'] = '';
    f.window.WheelEvent = class {};
    original.dispatchEvent = () => { change(f); return true; };
    original.scrollBy = () => assert.fail('no old scroll after synchronous revocation');
    f.nav.cycle(f.target, f);
    assert.equal(f.nav.rotate(f.target, 1, f), false);
    assert.equal(original.scrollTop, 0); assert.equal(f.input.scrollTop, 0);
    f.nav.dispose();
  }
});

test('RAF merges detents into one time-based destination without per-detent loops', () => {
  const f = fixture(undefined, true), calls = [];
  f.conversation.scrollBy = value => { calls.push(value); f.conversation.scrollTop += value.top; };
  f.nav.cycle(f.target, f);
  f.nav.rotate(f.target, 1, f); f.nav.rotate(f.target, 1, f); f.nav.rotate(f.target, 1, f);
  assert.equal(f.frames.size, 1); assert.equal(f.conversation.scrollTop, 0);
  f.frame(); assert.ok(f.conversation.scrollTop > 0 && f.conversation.scrollTop < 240);
  for (let i = 0; i < 20; i++) { assert.ok(f.frames.size <= 1); f.frame(); }
  assert.equal(f.conversation.scrollTop, 240); assert.equal(f.frames.size, 0);
  assert.ok(calls.length > 2 && calls.every(value => value.behavior === 'instant'));
  f.nav.dispose();
});

test('RAF reversal discards outstanding travel immediately, including a queued old callback', () => {
  const f = fixture(undefined, true); f.conversation.scrollTop = 200; f.conversation.scrollHeight = 2000;
  f.nav.cycle(f.target, f);
  for (let i = 0; i < 3; i++) f.nav.rotate(f.target, 1, f);
  f.frame(); const before = f.conversation.scrollTop, stale = [...f.frames.values()][0];
  f.nav.rotate(f.target, -1, f);
  assert.equal(f.frames.size, 1); stale(32); assert.equal(f.conversation.scrollTop, before);
  f.frame(); assert.ok(f.conversation.scrollTop < before, 'next frame brakes and reverses, never advances toward the old destination');
  for (let i = 0; i < 20; i++) f.frame();
  assert.ok(Math.abs(f.conversation.scrollTop - (before - 80)) < 1e-9); assert.equal(f.frames.size, 0);
  f.nav.dispose();
});

test('RAF progress follows elapsed milliseconds, not monitor refresh count', () => {
  const values = [];
  for (const interval of [8, 16, 32]) {
    const f = fixture(undefined, true); f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f);
    for (let elapsed = 0; elapsed < 32; elapsed += interval) f.frame(interval);
    values.push(f.conversation.scrollTop);
    for (let elapsed = 32; elapsed < 288; elapsed += interval) f.frame(interval);
    assert.equal(f.conversation.scrollTop, 80); assert.equal(f.frames.size, 0); f.nav.dispose();
  }
  assert.ok(Math.abs(values[0] - values[1]) < 1e-9 && Math.abs(values[1] - values[2]) < 1e-9);
});

test('a first native RAF timestamp sampled just before dispatch does not discard the new detent', () => {
  const f = fixture(undefined, true); f.frame(16); f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f);
  f.frame(0, 0.25); assert.equal(f.conversation.scrollTop, 0); assert.equal(f.frames.size, 1);
  f.frame(); assert.ok(f.conversation.scrollTop > 0 && f.conversation.scrollTop < 80);
  for (let i = 0; i < 20; i++) f.frame();
  assert.equal(f.conversation.scrollTop, 80); assert.equal(f.frames.size, 0); f.nav.dispose();
});

test('every RAF revalidates ownership, selected node and focus; cancelled callbacks never revive', () => {
  const changes = [
    f => f.nav.clear(), f => f.nav.cycle(f.target, f),
    f => { f.nav.cycle(f.target, f); f.nav.cycle(f.target, f); },
    f => f.listeners.get('blur')(),
    f => { f.document.visibilityState = 'hidden'; f.listeners.get('visibilitychange')(); },
    f => f.setCurrent({ ...f.target, focused: false }),
    f => f.setCurrent({ ...f.target, sessionId: 'other' }),
    f => f.setCurrent({ ...f.target, sessionOwner: {} }),
    f => f.setCurrent({ ...f.target, binding: {} }),
    f => f.setCurrent({ ...f.target, pending: {}, pendingKey: 'new' }),
    f => { f.conversation.isConnected = false; }, f => { f.conversation.hidden = true; },
    f => { f.conversation = f.element(); }, f => f.nav.dispose(),
  ];
  for (const change of changes) {
    const f = fixture(undefined, true), original = f.conversation;
    f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f); f.frame();
    const before = original.scrollTop, stale = [...f.frames.values()][0];
    change(f); f.frame(); stale(48);
    assert.equal(original.scrollTop, before); assert.equal(f.input.scrollTop, 0); assert.equal(f.frames.size, 0);
    f.nav.dispose(); assert.equal(f.mediaListeners.size, 0);
  }
});

test('manual scrolling and stale frame clocks cancel old travel instead of fighting it', () => {
  const f = fixture(undefined, true); f.conversation.scrollHeight = 2000;
  f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f); f.frame();
  f.conversation.scrollTop = 312; f.frame();
  assert.equal(f.conversation.scrollTop, 312); assert.equal(f.frames.size, 0);
  f.nav.rotate(f.target, 1, f); for (let i = 0; i < 20; i++) f.frame();
  assert.equal(f.conversation.scrollTop, 392); f.nav.dispose();
  for (const elapsed of [100.01, -1, NaN, Infinity]) {
    const paused = fixture(undefined, true); paused.nav.cycle(paused.target, paused); paused.nav.rotate(paused.target, 1, paused);
    paused.frame(elapsed); assert.equal(paused.conversation.scrollTop, 0); assert.equal(paused.frames.size, 0); paused.nav.dispose();
  }
});

test('RAF clamps changing extents and negative reverse ports, retaining fractional progress through rounding', () => {
  const f = fixture(undefined, true), writes = [];
  f.conversation.scrollBy = value => { writes.push(value); f.conversation.scrollTop = Math.round(f.conversation.scrollTop + value.top); };
  f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f);
  for (let i = 0; i < 20; i++) f.frame(); assert.equal(f.conversation.scrollTop, 80); assert.equal(f.frames.size, 0);
  f.conversation.scrollTop = 0; f.nav.rotate(f.target, 1, f); f.conversation.scrollHeight = 140;
  for (let i = 0; i < 20; i++) f.frame(); assert.equal(f.conversation.scrollTop, 40); assert.equal(f.frames.size, 0);
  f.conversation.style.flexDirection = 'column-reverse'; f.conversation.scrollHeight = 600; f.conversation.scrollTop = 0;
  f.nav.rotate(f.target, -1, f); for (let i = 0; i < 20; i++) f.frame();
  assert.equal(f.conversation.scrollTop, -80); assert.equal(f.frames.size, 0);
  assert.ok(writes.every(value => value.behavior === 'instant')); assert.equal(f.input.scrollTop, 0); f.nav.dispose();
});

test('reduced motion cancels the active RAF and uses bounded immediate detents without resuming', () => {
  const f = fixture(undefined, true); f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f); f.frame();
  const before = f.conversation.scrollTop, stale = [...f.frames.values()][0];
  f.reduce(true); assert.equal(f.frames.size, 0); stale(32); assert.equal(f.conversation.scrollTop, before);
  f.nav.rotate(f.target, 1, f); assert.equal(f.conversation.scrollTop, before + 80); assert.equal(f.frames.size, 0);
  f.reduce(false); f.frame(); assert.equal(f.conversation.scrollTop, before + 80);
  f.nav.dispose(); assert.equal(f.mediaListeners.size, 0);
});

test('a host that refuses position writes cannot leave a spinning RAF loop', () => {
  const f = fixture(undefined, true); f.conversation.scrollBy = () => {};
  f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f); f.frame();
  assert.equal(f.conversation.scrollTop, 0); assert.equal(f.frames.size, 0); f.nav.dispose();
});

test('region boundaries never chain to another region and host layout changes clamp to the new extent', () => {
  const f = fixture(); f.nav.cycle(f.target, f);
  f.nav.rotate(f.target, -1, f); assert.equal(f.conversation.scrollTop, 0);
  f.conversation.scrollTop = 500; f.nav.rotate(f.target, 1, f);
  assert.equal(f.conversation.scrollTop, 500); assert.equal(f.input.scrollTop, 0);
  f.conversation.style.flexDirection = 'column-reverse';
  f.conversation.scrollTop = -500; f.nav.rotate(f.target, -1, f);
  assert.equal(f.conversation.scrollTop, -500); assert.equal(f.input.scrollTop, 0);
  f.conversation.scrollTop = 0; f.nav.rotate(f.target, 1, f); assert.equal(f.conversation.scrollTop, 0);
  f.conversation.style.flexDirection = 'column'; f.conversation.scrollTop = 100;
  f.conversation.attrs['data-conversation-scroll'] = '';
  f.window.WheelEvent = class {};
  f.conversation.dispatchEvent = () => { f.conversation.scrollHeight = 250; return true; };
  assert.equal(f.nav.rotate(f.target, 1, f), true);
  assert.equal(f.conversation.scrollTop, 150); assert.equal(f.input.scrollTop, 0);
  f.nav.dispose();
});

test('scroll diagnostics are opt-in, numeric-only, defensively copied and bounded to five seconds', () => {
  const f = fixture(undefined, true);
  let read = false;
  const payload = { get phase() { read = true; throw Error('private-text'); } };
  assert.doesNotThrow(() => f.nav.noteInput(payload)); assert.equal(read, false);
  assert.equal(f.nav.getDiagnostics().state, 'idle');
  assert.equal(f.nav.startDiagnostics(), true);
  f.nav.noteInput({ phase: 'received', direction: 1, sequence: 7, ageMs: 12.34567, reason: 'none',
    position: 999, sessionId: 'private-session', text: 'private-text', element: f.conversation });
  const first = f.nav.getDiagnostics();
  assert.deepEqual(first.entries, [{ type: 'input', tMs: 0, phase: 'received', reason: 'none', direction: 1, sequence: 7, ageMs: 12.346 }]);
  first.entries[0].phase = 'private-text'; first.config.stepPx = 999;
  assert.equal(f.nav.getDiagnostics().entries[0].phase, 'received'); assert.equal(f.nav.getDiagnostics().config.stepPx, 80);
  assert.equal(f.nav.startDiagnostics(), true);
  for (let i = 0; i < 300; i++) f.nav.noteInput({ phase: 'accepted', direction: -1, sequence: i, ageMs: 0, reason: 'none' });
  let snapshot = f.nav.getDiagnostics();
  assert.equal(snapshot.entries.length, 240); assert.equal(snapshot.dropped, 60); assert.equal(snapshot.entries[0].sequence, 60);
  assert.equal(JSON.stringify(snapshot).includes('private-'), false);
  f.frame(5000); assert.doesNotThrow(() => f.nav.noteInput(payload)); assert.equal(read, false);
  snapshot = f.nav.getDiagnostics(); assert.equal(snapshot.state, 'expired'); assert.equal(snapshot.elapsedMs, 5000);
  assert.equal(snapshot.entries.length, 240);
  assert.equal(f.nav.startDiagnostics(), true); assert.equal(f.nav.getDiagnostics().entries.length, 0);
  f.nav.dispose(); assert.equal(f.nav.getDiagnostics().state, 'stopped'); assert.equal(f.nav.startDiagnostics(), false);
});

test('enabled scroll diagnostics preserve the exact baseline animation and report frame/readback data', () => {
  const baseline = fixture(undefined, true), sampled = fixture(undefined, true);
  for (const f of [baseline, sampled]) { f.nav.cycle(f.target, f); f.conversation.scrollTop = 120; }
  sampled.nav.startDiagnostics();
  for (const f of [baseline, sampled]) f.nav.rotate(f.target, 1, f);
  for (let i = 0; i < 20; i++) {
    for (const f of [baseline, sampled]) { f.frame(); f.listeners.get('scroll')(); }
    assert.equal(sampled.conversation.scrollTop, baseline.conversation.scrollTop);
    assert.equal(sampled.frames.size, baseline.frames.size);
  }
  const trace = sampled.nav.getDiagnostics();
  assert.equal(trace.config.stepPx, 80); assert.equal(trace.config.tauMs, 45); assert.equal(trace.config.maxGapMs, 100);
  assert.equal(trace.config.positionTolerancePx, 1); assert.equal(trace.config.rafAvailable, true); assert.equal(trace.config.reducedMotion, false);
  const frames = trace.entries.filter(row => row.type === 'frame'); assert.ok(frames.length > 2);
  assert.equal(frames[0].dtMs, 16); assert.equal(frames[0].position, 120); assert.ok(frames[0].actualPosition > 120 && frames[0].actualPosition < 200);
  assert.ok(frames.every(row => row.workMs >= 0 && Number.isFinite(row.callbackLagMs)));
  assert.ok(trace.entries.some(row => row.type === 'geometry' && row.workMs >= 0));
  assert.ok(trace.entries.some(row => row.type === 'stop' && row.reason === 'completed' && row.position === 200));
  assert.equal(baseline.nav.getDiagnostics().entries.length, 0);
  baseline.nav.dispose(); sampled.nav.dispose();
});

test('scroll diagnostics distinguish existing cancellation reasons without changing their conditions', () => {
  const cases = [
    ['external_offset', f => { f.conversation.scrollTop += 20; f.frame(); }],
    ['frame_gap', f => f.frame(101)],
    ['clock_backwards', f => f.frame(-1)],
    ['write_refused', f => { f.conversation.scrollBy = () => {}; f.frame(); }],
    ['reversed', f => f.nav.rotate(f.target, -1, f)],
    ['axis_changed', f => { f.conversation.style.flexDirection = 'column-reverse'; f.frame(); }],
    ['reduced_motion', f => f.reduce(true)],
    ['blur', f => f.listeners.get('blur')()],
    ['port_changed', f => { f.conversation.hidden = true; f.nav.reconcile(f.target, f); }],
  ];
  for (const [reason, interrupt] of cases) {
    const f = fixture(undefined, true); f.nav.cycle(f.target, f); f.nav.startDiagnostics();
    f.nav.rotate(f.target, 1, f); f.frame(); interrupt(f);
    assert.ok(f.nav.getDiagnostics().entries.some(row => row.type === 'stop' && row.reason === reason), reason);
    f.nav.dispose();
  }
});

test('stopping diagnostic capture never stops the active scroll or creates extra callbacks', () => {
  const f = fixture(undefined, true); f.nav.cycle(f.target, f);
  const listeners = f.listeners.size;
  assert.equal(f.nav.startDiagnostics(), true); assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, listeners);
  f.nav.rotate(f.target, 1, f); f.frame(); const entries = f.nav.getDiagnostics().entries;
  f.nav.stopDiagnostics(); assert.equal(f.frames.size, 1); assert.equal(f.nav.getDiagnostics().state, 'stopped');
  for (let i = 0; i < 20; i++) f.frame();
  assert.equal(f.conversation.scrollTop, 80); assert.deepEqual(f.nav.getDiagnostics().entries, entries);
  f.nav.dispose();
});

test('diagnostics identify fallback API/reduced-motion branches and reject malformed data safely', () => {
  for (const reduce of [false, true]) {
    const f = fixture(undefined, reduce); f.reduce(reduce); f.nav.cycle(f.target, f); f.nav.startDiagnostics();
    f.nav.noteInput({ phase: 'private-phase', reason: 'private-text', direction: 2, sequence: -1, ageMs: NaN, actualPosition: 123 });
    assert.deepEqual(f.nav.getDiagnostics().entries[0], { type: 'input', tMs: 0, region: 'conversation' });
    assert.doesNotThrow(() => f.nav.noteInput({ get phase() { throw Error('private-text'); } }));
    f.nav.rotate(f.target, 1, f);
    assert.equal(f.conversation.scrollTop, 80); assert.equal(f.frames.size, 0);
    assert.ok(f.nav.getDiagnostics().entries.some(row => row.type === 'fallback' && row.reason === (reduce ? 'reduced_motion' : 'missing_api')));
    assert.equal(JSON.stringify(f.nav.getDiagnostics()).includes('private-'), false); f.nav.dispose();
  }
  const missing = fixture(); missing.window.performance.now = undefined;
  assert.equal(missing.nav.startDiagnostics(), false); assert.equal(missing.nav.getDiagnostics().config.clockAvailable, false);
  missing.nav.cycle(missing.target, missing); missing.nav.rotate(missing.target, 1, missing);
  assert.equal(missing.conversation.scrollTop, 80); missing.nav.dispose();
});

test('idle and selected conversation/input hot paths never discover unrelated regions', () => {
  const idle = fixture();
  idle.document.querySelectorAll = () => assert.fail('no discovery without a selection');
  assert.equal(idle.nav.reconcile(idle.target, idle), false);
  for (const id of ['conversation', 'input']) {
    const f = fixture(undefined, true);
    f.nav.cycle(f.target, f); if (id === 'input') f.nav.cycle(f.target, f);
    assert.equal(f.nav.activeId, id);
    f.document.querySelectorAll = () => assert.fail('selected port must not scan sidebar/question DOM');
    assert.equal(f.nav.reconcile(f.target, f), true);
    assert.equal(f.nav.rotate(f.target, 1, f), true);
    f.frame(); f.listeners.get('scroll')();
    assert.ok(f[id].scrollTop > 0);
    f.setCurrent({ ...f.target, sessionOwner: {} });
    f.frame(); assert.equal(f.frames.size, 0); assert.equal(f.nav.activeId, null);
  }
});

test('modern sidebar avoids global row enumeration and duplicate discovery without caching ambiguity', () => {
  const f = fixture(undefined, true), sidebar = f.element(), tree = f.element({ role: 'tree' });
  const row = f.element({ 'data-row-key': 'workspace:p' });
  sidebar.style.overflowY = 'auto'; tree.parentElement = sidebar; sidebar.parentElement = f.document.body;
  let probes = 0, trees = [tree];
  tree.querySelector = () => { probes++; return row; };
  tree.querySelectorAll = () => assert.fail('do not enumerate every row to establish one marker');
  f.document.querySelectorAll = selector => {
    assert.equal(selector, '[role="tree"]', 'no global row scan when a modern port exists'); return trees;
  };
  f.nav.cycle(f.target, f); assert.equal(f.nav.activeId, 'sessions'); probes = 0;
  assert.equal(f.nav.rotate(f.target, 1, f), true); assert.equal(probes, 1, 'one discovery per detent');
  f.frame(); assert.equal(probes, 2, 'one discovery per frame');
  f.listeners.get('scroll')(); assert.equal(probes, 3, 'geometry validates once');
  const duplicate = f.element({ role: 'tree' }); duplicate.style.overflowY = 'auto';
  duplicate.querySelector = () => row; duplicate.parentElement = f.document.body;
  trees = [tree, duplicate];
  assert.equal(f.nav.rotate(f.target, 1, f), false, 'new ambiguity must revoke immediately');
  assert.equal(f.nav.activeId, null); assert.equal(f.frames.size, 0);
});

test('unchanged overlay geometry performs no DOM writes and visibility reads its rect once', () => {
  const f = fixture(); f.nav.cycle(f.target, f);
  const overlay = f.document.body.children[0], label = overlay.children[0];
  let writes = 0, reads = 0;
  for (const node of [overlay, label]) {
    node.style = new Proxy(node.style, { set(object, key, value) { writes++; object[key] = value; return true; } });
    const setAttribute = node.setAttribute; node.setAttribute = function (...args) { writes++; return setAttribute.apply(this, args); };
    let text = node.textContent;
    Object.defineProperty(node, 'textContent', { get: () => text, set: value => { writes++; text = value; } });
  }
  const rect = f.conversation.getBoundingClientRect;
  f.conversation.getBoundingClientRect = function () { reads++; return rect.call(this); };
  f.nav.reconcile(f.target, f); assert.equal(reads, 2, 'one visibility rect plus one overlay geometry rect');
  f.listeners.get('scroll')(); f.listeners.get('resize')();
  assert.equal(writes, 0, 'poll/own-scroll must not dirty unchanged layout or label text');
  f.conversation.rect = { left: 10, top: 11, right: 110, bottom: 111, width: 100, height: 100 };
  f.listeners.get('resize')(); assert.equal(writes, 1, 'changed geometry still updates immediately');
  assert.equal(overlay.style.top, '11px');
});

test('actual delivery clock rejects stale RAF timestamps before any delayed position write', () => {
  for (const first of [true, false]) {
    const f = fixture(undefined, true); f.nav.cycle(f.target, f); f.nav.startDiagnostics();
    f.nav.rotate(f.target, 1, f);
    if (!first) f.frame();
    const before = f.conversation.scrollTop;
    f.frame(first ? 216 : 166, first ? 200 : 150);
    assert.equal(f.conversation.scrollTop, before); assert.equal(f.frames.size, 0);
    const row = f.nav.getDiagnostics().entries.find(row => row.type === 'frame' && row.reason === 'frame_gap');
    assert.ok(row.deliveryGapMs > 100 && row.callbackLagMs > 100);
    assert.equal(row.actualPosition, undefined); f.nav.dispose();
  }
});

test('timely uneven delivery caps integration without losing the destination or adding catch-up callbacks', () => {
  const f = fixture(undefined, true); f.nav.cycle(f.target, f); f.nav.startDiagnostics();
  for (let i = 0; i < 5; i++) f.nav.rotate(f.target, 1, f);
  f.frame(); const before = f.conversation.scrollTop;
  f.frame(80);
  const expected = 400 + (before - 400) * Math.exp(-32 / 45);
  assert.ok(Math.abs(f.conversation.scrollTop - expected) < 1e-9);
  assert.equal(f.frames.size, 1);
  const row = f.nav.getDiagnostics().entries.filter(row => row.type === 'frame').at(-1);
  assert.equal(row.dtMs, 80); assert.equal(row.deliveryGapMs, 80); assert.equal(row.integratedMs, 32);
  for (let i = 0; i < 30; i++) f.frame();
  assert.equal(f.conversation.scrollTop, 400); assert.equal(f.frames.size, 0); f.nav.dispose();
});

test('slow own DOM validation cannot age a frame past its delivery deadline', () => {
  const f = fixture(undefined, true); f.nav.cycle(f.target, f); f.nav.rotate(f.target, 1, f);
  const rect = f.conversation.getBoundingClientRect;
  f.conversation.getBoundingClientRect = function () { f.advance(101); return rect.call(this); };
  f.frame(); assert.equal(f.conversation.scrollTop, 0); assert.equal(f.frames.size, 0); f.nav.dispose();
});

test('long task diagnostics sample only bounded numeric timings during the current manual window', () => {
  const f = fixture(undefined, true), observers = [];
  class Observer {
    static supportedEntryTypes = ['longtask', 'long-animation-frame'];
    constructor(callback) { this.callback = callback; this.types = []; this.disconnected = false; observers.push(this); }
    observe(options) { this.types.push(options); }
    disconnect() { this.disconnected = true; }
  }
  f.window.PerformanceObserver = Observer;
  assert.equal(observers.length, 0); f.advance(100);
  assert.equal(f.nav.startDiagnostics(), true); assert.equal(observers.length, 1);
  const first = observers[0];
  assert.deepEqual(first.types, [{ type: 'longtask' }, { type: 'long-animation-frame' }]);
  let leaked = false;
  const entry = { entryType: 'longtask', startTime: 110, duration: 215,
    get attribution() { leaked = true; throw Error('private-attribution'); },
    get name() { leaked = true; throw Error('private-url'); } };
  const entries = [entry, { entryType: 'long-animation-frame', startTime: 120, duration: 220, blockingDuration: 170 },
    { entryType: 'longtask', startTime: 99, duration: 999 }, { entryType: 'other', startTime: 120, duration: 123 }];
  f.advance(250); first.callback({ getEntries: () => entries });
  const trace = f.nav.getDiagnostics();
  assert.deepEqual(trace.entries.map(row => row.type), ['longtask', 'longframe']);
  assert.equal(trace.entries[0].startMs, 10); assert.equal(trace.entries[0].durationMs, 215);
  assert.equal(trace.entries[1].blockingMs, 170); assert.equal(leaked, false);
  assert.equal(JSON.stringify(trace).includes('private-'), false);
  f.nav.startDiagnostics(); assert.equal(first.disconnected, true);
  first.callback({ getEntries: () => [entry] }); assert.equal(f.nav.getDiagnostics().entries.length, 0);
  const second = observers[1]; f.advance(5000);
  second.callback({ getEntries: () => [{ entryType: 'longtask', startTime: 400, duration: 300 }] });
  assert.equal(f.nav.getDiagnostics().state, 'expired'); assert.equal(second.disconnected, true);
  f.nav.startDiagnostics(); f.nav.stopDiagnostics(); assert.equal(observers[2].disconnected, true);
  f.nav.startDiagnostics(); f.nav.dispose(); assert.equal(observers[3].disconnected, true);
});
