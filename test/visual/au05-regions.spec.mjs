// Standalone DOM compatibility backend, not the product's native-wheel path.
// Isolated real Chromium regression. No DSH page, server, RPC or native input.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';

const source = await readFile(new URL('../../packages/dsh-plugin/src/regions.js', import.meta.url), 'utf8');
const exportMarker = 'export function createRegionNavigation(';
assert.equal(source.split(exportMarker).length, 2, 'inject the current region implementation, changing only its exact export marker');
const browserSource = source.replace(exportMarker, exportMarker.slice('export '.length));

const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'">
<title>AU05 isolated region DOM regression</title><style>
  * { box-sizing:border-box; } body { margin:20px; min-height:1800px; font:14px/20px sans-serif; }
  #layout { display:grid; grid-template-columns:230px 440px 400px; gap:20px; align-items:start; }
  .ancestor { height:440px; overflow:auto; border:1px solid #aaa; }
  .port { overflow-y:auto; scroll-behavior:smooth; border:1px solid #555; }
  #sidebar { height:180px; } [data-row-key] { height:32px; }
  .spacer { height:800px; }
  #conversation { height:240px; } #conversation-content { height:1800px; flex:none; padding:12px; }
  .conversation-row { height:32px; }
  #nested { height:80px; width:210px; } #nested-content { height:700px; background:#eee; }
  #input-ancestor { height:160px; margin-top:16px; }
  textarea { display:block; width:100%; height:110px; padding:0; resize:none; font:14px/20px monospace; }
  #elsewhere { height:180px; } #elsewhere-content { height:1000px; }
  #question { margin-top:28px; border:1px solid #777; }
  #question-scroll { height:170px; } #question-input { height:100px; }
  [role="radiogroup"] { padding-top:24px; }
  [data-option-row] { height:52px; }
  [role="radio"] { display:block; width:100%; height:44px; }
  footer { padding:8px; } footer > div { display:flex; gap:8px; }
</style></head><body><button id="focus-sentinel" type="button">Isolated fixture</button><div id="layout">
  <div id="sidebar-ancestor" class="ancestor"><div id="sidebar" class="port" role="tree">
    ${Array.from({ length: 32 }, (_, index) => `<div data-row-key="${index === 0 ? 'session:isolated' : `workspace:fixture-${index}`}">Fixture row ${index}</div>`).join('')}
  </div><div class="spacer"></div></div>
  <div><div id="conversation-ancestor" class="ancestor"><div id="conversation" class="port" data-conversation-scroll>
    <div id="conversation-content"><div id="nested" class="port" data-composer-scroll><div id="nested-content">Nested scrollport under cursor</div></div>
      ${Array.from({ length: 50 }, (_, index) => `<div class="conversation-row">Conversation fixture row ${index}</div>`).join('')}
    </div>
  </div><div class="spacer"></div></div>
  <div id="input-ancestor" class="ancestor"><textarea id="input" class="port" aria-label="Fixture input"></textarea><div class="spacer"></div></div></div>
  <div><div id="elsewhere" class="port"><div id="elsewhere-content">Unrelated hovered scrollport</div></div>
  <div id="question" data-question-key="fixture-question" hidden><section>
    <div id="question-scroll" class="port" data-question-scroll><textarea id="question-input" class="port" aria-label="Fixture custom answer"></textarea>
    <div id="options" role="radiogroup" aria-label="Fixture options">
      ${Array.from({ length: 6 }, (_, index) => `<div data-option-row><button id="option-${index}" type="button" role="radio" aria-checked="${index === 0}">Option ${index}</button></div>`).join('')}
    </div></div>
    <footer><div><button type="button">Previous</button><span>2 / 2</span><button type="button" disabled>Next</button></div>
      <button type="button">Cancel</button><button type="button">Submit</button></footer>
  </section></div></div>
</div></body></html>`;

const positionIds = ['sidebar', 'conversation', 'nested', 'input', 'elsewhere', 'sidebar-ancestor', 'conversation-ancestor', 'input-ancestor', 'question-scroll'];
const regionElements = { sessions: 'sidebar', conversation: 'conversation', input: 'input' };

// Only scheduling/time are controlled. Element geometry, native setters and scroll methods
// remain Chromium-owned; retained callbacks model a frame already dequeued at cancellation.
async function installControlledFrames(page) {
  await page.evaluate(() => {
    const nativeRAF = window.requestAnimationFrame.bind(window), pending = new Map(), callbacks = new Map();
    let now = performance.now(), serial = 0, requests = 0, maxPending = 0;
    const writes = [];
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
    window.requestAnimationFrame = callback => {
      const id = ++serial;
      pending.set(id, callback); callbacks.set(id, callback); requests++;
      maxPending = Math.max(maxPending, pending.size);
      return id;
    };
    window.cancelAnimationFrame = id => pending.delete(id);
    for (const method of ['scrollBy', 'scrollTo']) {
      const native = Element.prototype[method];
      Element.prototype[method] = function (...args) {
        writes.push({ id: this.id, method, behavior: args[0]?.behavior ?? 'auto' });
        return Reflect.apply(native, this, args);
      };
    }
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', { ...descriptor, set(value) {
      writes.push({ id: this.id, method: 'scrollTop' });
      return Reflect.apply(descriptor.set, this, [value]);
    } });
    window.__regionFrames = {
      get pending() { return [...pending.keys()]; },
      get writes() { return [...writes]; },
      get requests() { return requests; },
      get maxPending() { return maxPending; },
      resetWrites() { writes.length = 0; },
      elapse(milliseconds) { now += milliseconds; }, // Advance only the diagnostic deadline, without dispatching RAF.
      frame(milliseconds = 16) {
        now += milliseconds;
        const batch = [...pending];
        for (const [id, callback] of batch) if (pending.delete(id)) callback(now);
      },
      replay(ids) {
        now += 16;
        for (const id of ids) callbacks.get(id)?.(now);
      },
      nativeFrames: () => new Promise(resolve => nativeRAF(() => nativeRAF(resolve))),
    };
  });
}

const test = base.extend({
  controlledFrames: [false, { option: true }],
  regionMotion: ['reduce', { option: true }],
  regions: async ({ page, browser, controlledFrames, regionMotion }, use, info) => {
    expect(browser.version()).toBe('145.0.7632.6');
    info.annotations.push({ type: 'chromium', description: browser.version() });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    await page.setViewportSize({ width: 1280, height: 900 });
    // reducedMotion is a BrowserContext option, not a top-level Test fixture in 1.58.2.
    // Explicit browser emulation makes both branches real, rather than mocking matchMedia.
    await page.emulateMedia({ reducedMotion: regionMotion });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(regionMotion === 'reduce');
    await page.setContent(fixture);
    await page.evaluate(() => {
      window.__regionForbidden = [];
      const deny = name => () => { window.__regionForbidden.push(name); throw new Error('forbidden_region_effect:' + name); };
      for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'RTCPeerConnection',
        'Audio', 'AudioContext', 'webkitAudioContext', 'MediaRecorder', 'KeyboardEvent', 'open', 'scroll', 'scrollBy', 'scrollTo']) window[name] = deny(name);
      for (const name of ['mediaDevices', 'hid', 'serial', 'usb', 'bluetooth', 'clipboard']) {
        Object.defineProperty(navigator, name, { configurable: true, get: deny('navigator.' + name) });
      }
      navigator.sendBeacon = deny('navigator.sendBeacon');
      for (const name of ['__DSH_BOOT__', '__ModuleLoader__', 'dsh', 'electronAPI', 'ipcRenderer', 'require']) {
        Object.defineProperty(window, name, { configurable: true, get: deny('host_rpc:' + name) });
      }
      // Only element-local wheel intent is permitted; no keyboard or global input dispatch.
      const dispatch = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function (event) {
        if (/^key(?:down|up|press)$/.test(event.type) || event.type === 'wheel' && (this === window || this === document)) {
          return deny('global_input:' + event.type)();
        }
        return Reflect.apply(dispatch, this, [event]);
      };
      for (const name of ['keydown', 'keyup', 'keypress']) document.addEventListener(name, deny('global_input:' + name), true);
    });
    if (controlledFrames) await installControlledFrames(page);
    await page.addScriptTag({ content: browserSource });
    await page.bringToFront();
    await page.locator('#focus-sentinel').focus();
    await page.evaluate(() => {
      const target = { sessionId: 'isolated', binding: 'binding-a', sessionOwner: 'owner-a', focused: true, pending: null, pendingKey: null };
      const qa = window.__regions = { target, baseTarget: target,
        ports: { input: document.getElementById('input'), conversation: { port: document.getElementById('conversation') } },
        wheels: [], composerWheels: 0, clicks: [], followAnimating: true };
      for (const id of ['input', 'question-input']) document.getElementById(id).value = Array.from({ length: 80 }, (_, index) => `Fixture line ${index}`).join('\n');
      document.addEventListener('wheel', event => qa.wheels.push({ target: event.target.id, deltaY: event.deltaY, deltaMode: event.deltaMode,
        bubbles: event.bubbles, cancelable: event.cancelable, trusted: event.isTrusted, before: event.target.scrollTop }), true);
      document.getElementById('conversation').addEventListener('wheel', event => { qa.followAnimating = false; event.preventDefault(); });
      document.getElementById('nested').addEventListener('wheel', () => qa.composerWheels++);
      for (const option of document.querySelectorAll('[role="radio"]')) option.addEventListener('click', () => {
        qa.clicks.push(option.id);
        for (const sibling of document.querySelectorAll('[role="radio"]')) sibling.setAttribute('aria-checked', String(sibling === option));
      });
      qa.nav = createRegionNavigation({ document, window, readTarget: () => qa.target, readPorts: () => qa.ports });
    });
    expect(page.url()).toBe('about:blank');
    expect(await page.evaluate(() => ({ focused: document.hasFocus(), visible: document.visibilityState }))).toEqual({ focused: true, visible: 'visible' });
    // All scroll extents and geometry are browser-owned, not mocked DOM properties.
    const geometry = await page.evaluate(ids => Object.fromEntries(ids.map(id => {
      const el = document.getElementById(id), rect = el.getBoundingClientRect();
      return [id, { extent: el.scrollHeight - el.clientHeight, width: rect.width, height: rect.height, behavior: getComputedStyle(el).scrollBehavior }];
    })), positionIds.filter(id => id !== 'question-scroll'));
    for (const value of Object.values(geometry)) {
      expect(value.extent).toBeGreaterThan(400);
      expect(value.width).toBeGreaterThan(0);
      expect(value.height).toBeGreaterThan(0);
    }
    for (const id of ['sidebar', 'conversation', 'input']) expect(geometry[id].behavior).toBe('smooth');
    await expect(page.locator('[role="tree"] [data-row-key="session:isolated"]')).toHaveCount(1);
    await expect(page.locator('#conversation')).toHaveAttribute('data-conversation-scroll', '');
    await use(page);
    await page.evaluate(() => window.__regions.nav.dispose());
    expect(await page.evaluate(() => window.__regionForbidden)).toEqual([]);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  },
});

// Disable automatic page-content artifacts for this isolated diagnostic scope; the existing explicit fixture screenshot remains.
// Playwright 1.58.2 requires these artifact options at file scope, not inside a describe group.
test.use({ screenshot: 'off', trace: 'off' });

async function selectRegion(page, id) {
  expect(await page.evaluate(id => {
    const qa = window.__regions;
    qa.nav.clear();
    for (let index = 0; index < 4; index++) {
      if (!qa.nav.cycle(qa.target, qa.ports)) return false;
      if (qa.nav.activeId === id) return true;
    }
    return false;
  }, id)).toBe(true);
  await expect(page.locator('[data-au05-region]')).toHaveAttribute('data-au05-region', id);
}

async function positions(page) {
  return page.evaluate(ids => ({ ...Object.fromEntries(ids.map(id => [id, document.getElementById(id).scrollTop])),
    document: document.scrollingElement.scrollTop }), positionIds);
}

async function hover(page, selector) {
  await page.locator(selector).hover();
  expect(await page.locator(selector).evaluate(el => el.matches(':hover'))).toBe(true);
}

async function rotate(page, direction) {
  return page.evaluate(direction => { const qa = window.__regions; return qa.nav.rotate(qa.target, direction, qa.ports); }, direction);
}

async function nextFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('selected sidebar, conversation and input ignore the real cursor over unrelated and nested scrollers', async ({ regions: page }) => {
  for (const [region, id] of Object.entries(regionElements)) for (const hovered of ['#elsewhere', '#nested']) {
    await page.evaluate(ids => { for (const id of ids) document.getElementById(id).scrollTo({ top: 0, behavior: 'instant' }); }, positionIds);
    await selectRegion(page, region);
    await hover(page, hovered);
    const before = await positions(page);
    expect(await rotate(page, 1)).toBe(true);
    expect(await positions(page)).toEqual({ ...before, [id]: before[id] + 80 });
  }
  expect(await page.evaluate(() => window.__regions.composerWheels)).toBe(0);
});

test('rapid detents and reversal use immediate real positions despite host smooth CSS and manual repositioning', async ({ regions: page }) => {
  for (const [region, id] of Object.entries(regionElements)) {
    await selectRegion(page, region);
    const result = await page.evaluate(id => {
      const qa = window.__regions, el = document.getElementById(id);
      el.scrollTo({ top: 120, behavior: 'instant' });
      const steps = [1, 1, 1, -1, -1].map(direction => ({ handled: qa.nav.rotate(qa.target, direction, qa.ports), top: el.scrollTop }));
      el.scrollTo({ top: 312, behavior: 'instant' });
      const handled = qa.nav.rotate(qa.target, -1, qa.ports);
      return { steps, handled, top: el.scrollTop };
    }, id);
    expect(result).toEqual({ steps: [200, 280, 360, 280, 200].map(top => ({ handled: true, top })), handled: true, top: 232 });
    await nextFrames(page);
    expect(await page.locator('#' + id).evaluate(el => el.scrollTop)).toBe(232);
  }
});

test('real endpoints never chain to ancestors and column-reverse conversation retains negative scrollTop', async ({ regions: page }) => {
  for (const [region, id] of Object.entries(regionElements)) for (const [edge, direction] of [['bottom', 1], ['top', -1]]) {
    await selectRegion(page, region);
    await hover(page, '#elsewhere');
    await page.locator('#' + id).evaluate((el, edge) => el.scrollTo({ top: edge === 'bottom' ? el.scrollHeight - el.clientHeight : 0, behavior: 'instant' }), edge);
    const before = await positions(page);
    expect(await page.evaluate(direction => {
      const qa = window.__regions;
      return Array.from({ length: 12 }, () => qa.nav.rotate(qa.target, direction, qa.ports));
    }, direction)).toEqual(Array(12).fill(true));
    await nextFrames(page);
    expect(await positions(page)).toEqual(before);
  }
  await page.locator('#conversation').evaluate(el => { el.style.display = 'flex'; el.style.flexDirection = 'column-reverse'; el.scrollTo({ top: 0, behavior: 'instant' }); });
  await selectRegion(page, 'conversation');
  const reverse = await page.evaluate(() => {
    const qa = window.__regions, el = document.getElementById('conversation');
    const steps = [-1, -1, 1].map(direction => { qa.nav.rotate(qa.target, direction, qa.ports); return el.scrollTop; });
    const extent = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: -extent, behavior: 'instant' });
    qa.nav.rotate(qa.target, -1, qa.ports);
    const minimum = el.scrollTop;
    qa.nav.rotate(qa.target, 1, qa.ports);
    const fromMinimum = el.scrollTop;
    el.scrollTo({ top: 0, behavior: 'instant' });
    qa.nav.rotate(qa.target, 1, qa.ports);
    return { steps, extent, minimum, fromMinimum, maximum: el.scrollTop };
  });
  expect(reverse.extent).toBeGreaterThan(400);
  expect(reverse.steps).toEqual([-80, -160, -80]);
  expect(reverse.minimum).toBe(-reverse.extent);
  expect(reverse.fromMinimum).toBe(-reverse.extent + 80);
  expect(reverse.maximum).toBe(0);
});

test('conversation wheel intent reaches only its exact outer port, never the hovered composer', async ({ regions: page }) => {
  await selectRegion(page, 'conversation');
  await hover(page, '#nested');
  expect(await rotate(page, 1)).toBe(true);
  expect(await rotate(page, -1)).toBe(true);
  const intent = await page.evaluate(() => ({ wheels: window.__regions.wheels, composer: window.__regions.composerWheels,
    following: window.__regions.followAnimating, top: document.getElementById('conversation').scrollTop }));
  expect(intent).toEqual({ wheels: [
    { target: 'conversation', deltaY: 80, deltaMode: 0, bubbles: true, cancelable: true, trusted: false, before: 0 },
    { target: 'conversation', deltaY: -80, deltaMode: 0, bubbles: true, cancelable: true, trusted: false, before: 80 },
  ], composer: 0, following: false, top: 0 });
  for (const region of ['sessions', 'input']) { await selectRegion(page, region); expect(await rotate(page, 1)).toBe(true); }
  await selectRegion(page, 'conversation');
  await page.locator('#conversation').evaluate(el => el.removeAttribute('data-conversation-scroll'));
  expect(await rotate(page, 1)).toBe(true);
  expect(await page.locator('#conversation').evaluate(el => el.scrollTop)).toBe(80);
  expect(await page.evaluate(() => window.__regions.wheels.length)).toBe(2);
});

test('clear, session, owner, pending, focus and replacement revoke selection, including inside a wheel listener', async ({ regions: page }) => {
  const results = await page.evaluate(() => {
    const qa = window.__regions, results = [];
    const select = () => {
      qa.nav.clear(); qa.target = { ...qa.baseTarget };
      qa.ports.conversation.port = document.getElementById('conversation');
      qa.ports.conversation.port.scrollTo({ top: 160, behavior: 'instant' });
      qa.nav.cycle(qa.target, qa.ports); qa.nav.cycle(qa.target, qa.ports);
    };
    const invalidate = kind => {
      if (kind === 'clear') qa.nav.clear();
      if (kind === 'reselect') { qa.nav.clear(); qa.nav.cycle(qa.target, qa.ports); qa.nav.cycle(qa.target, qa.ports); }
      if (kind === 'session') qa.target = { ...qa.target, sessionId: 'other-session' };
      if (kind === 'owner') qa.target = { ...qa.target, sessionOwner: 'other-owner' };
      if (kind === 'binding') qa.target = { ...qa.target, binding: 'other-binding' };
      if (kind === 'pending') qa.target = { ...qa.target, pending: { kind: 'question' }, pendingKey: 'other-question' };
      if (kind === 'focus') qa.target = { ...qa.target, focused: false };
      if (kind === 'blur') window.dispatchEvent(new Event('blur'));
      if (kind === 'replacement') {
        const old = document.getElementById('conversation'), replacement = old.cloneNode(true);
        old.replaceWith(replacement); replacement.scrollTo({ top: 160, behavior: 'instant' });
        qa.ports.conversation.port = replacement;
      }
    };
    for (const kind of ['clear', 'session', 'owner', 'binding', 'pending', 'focus', 'blur', 'replacement']) {
      select(); const selectedTarget = qa.target; invalidate(kind);
      results.push({ kind, handled: qa.nav.rotate(selectedTarget, 1, qa.ports), top: document.getElementById('conversation').scrollTop });
    }
    for (const kind of ['clear', 'reselect', 'session', 'pending', 'focus', 'replacement']) {
      select(); const selectedTarget = qa.target;
      document.getElementById('conversation').addEventListener('wheel', () => invalidate(kind), { once: true });
      results.push({ kind: 'during-wheel:' + kind, handled: qa.nav.rotate(selectedTarget, 1, qa.ports), top: document.getElementById('conversation').scrollTop });
    }
    return results;
  });
  expect(results).toHaveLength(14);
  for (const result of results) expect(result, result.kind).toEqual({ kind: result.kind, handled: false, top: 160 });
  expect(await page.evaluate(() => window.__regions.clicks)).toEqual([]);
});

test('question textarea scrolls locally and option rotation only reveals/focuses until explicit dummy commit', async ({ regions: page }) => {
  await page.evaluate(() => {
    const qa = window.__regions;
    document.getElementById('question').hidden = false;
    const pending = { kind: 'question', sessionId: qa.target.sessionId, key: 'fixture-question',
      getSnapshot: () => ({ closed: false, state: 'open', channel: 'rpc' }) };
    qa.target = { ...qa.target, pending, pendingKey: pending.key };
  });
  await expect(page.locator('[data-question-key="fixture-question"] [data-question-scroll] [role="radiogroup"] [data-option-row] > button[type="button"][role="radio"][aria-checked]')).toHaveCount(6);
  await selectRegion(page, 'input');
  await expect(page.locator('#question-input')).toBeFocused();
  await hover(page, '#elsewhere');
  const beforeInput = await positions(page);
  expect(await rotate(page, 1)).toBe(true);
  expect(await page.locator('#question-input').evaluate(el => el.scrollTop)).toBe(80);
  expect(await positions(page)).toEqual(beforeInput);
  await selectRegion(page, 'options');
  await expect(page.locator('#option-0')).toBeFocused();
  const beforeOptions = await positions(page);
  const focused = await page.evaluate(() => {
    const qa = window.__regions;
    return [1, 1, 1, 1, 1, 1, -1].map(direction => ({ handled: qa.nav.rotate(qa.target, direction, qa.ports), id: document.activeElement.id }));
  });
  expect(focused).toEqual([1, 2, 3, 4, 5, 0, 5].map(index => ({ handled: true, id: `option-${index}` })));
  expect(await page.evaluate(() => window.__regions.clicks)).toEqual([]);
  await expect(page.locator('#option-0')).toHaveAttribute('aria-checked', 'true');
  const afterOptions = await positions(page);
  expect(afterOptions['question-scroll']).toBeGreaterThan(0);
  expect({ ...afterOptions, 'question-scroll': beforeOptions['question-scroll'] }).toEqual(beforeOptions);
  const bounds = await page.evaluate(() => {
    const option = document.getElementById('option-5').getBoundingClientRect(), port = document.getElementById('question-scroll').getBoundingClientRect();
    return { top: option.top - port.top, bottom: port.bottom - option.bottom };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => { const qa = window.__regions; return qa.nav.commitSelection(qa.target, qa.ports); })).toBe('selected');
  expect(await page.evaluate(() => window.__regions.clicks)).toEqual(['option-5']);
  await expect(page.locator('#option-5')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__regions.wheels)).toEqual([]);
});

async function animationState(page, id) {
  return page.evaluate(id => ({ top: document.getElementById(id).scrollTop,
    pending: window.__regionFrames.pending.length, requests: window.__regionFrames.requests,
    maxPending: window.__regionFrames.maxPending, writes: window.__regionFrames.writes }), id);
}

async function advanceFrames(page, id, count) {
  return page.evaluate(({ id, count }) => Array.from({ length: count }, (_, index) => {
    window.__regionFrames.frame();
    return { milliseconds: (index + 1) * 16, top: document.getElementById(id).scrollTop,
      pending: window.__regionFrames.pending.length };
  }), { id, count });
}

async function assertNoNativeTail(page, id) {
  const before = await animationState(page, id);
  await page.evaluate(() => window.__regionFrames.nativeFrames());
  expect(await animationState(page, id)).toEqual(before);
  for (const write of before.writes) {
    expect(write.method === 'scrollTop' || write.behavior === 'instant', JSON.stringify(write)).toBe(true);
  }
  expect(await page.locator('#' + id).evaluate(el => getComputedStyle(el).scrollBehavior)).toBe('smooth');
}

async function attachFrameSamples(info, samples) {
  await mkdir(info.outputPath(), { recursive: true });
  const path = info.outputPath('real-chromium-frame-samples.json');
  await writeFile(path, JSON.stringify(samples, null, 2));
  await info.attach('real-chromium-frame-samples', { path, contentType: 'application/json' });
  console.log('AU05 real Chromium frame samples:', JSON.stringify(samples));
}

function assertNumericDiagnostics(snapshot) {
  expect(snapshot.version).toBe(1);
  expect(['idle', 'recording', 'stopped', 'expired']).toContain(snapshot.state);
  expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(snapshot.elapsedMs).toBeLessThanOrEqual(5000);
  expect(snapshot.entries.length).toBeLessThanOrEqual(240);
  expect(snapshot.config).toEqual({ durationMs: 5000, maxEntries: 240, stepPx: 80, tauMs: 45, maxGapMs: 100, maxFrameStepMs: 32,
    positionTolerancePx: 1, reducedMotion: false, rafAvailable: true, cancelAvailable: true, clockAvailable: true });
  const enums = {
    type: ['input', 'detent', 'frame', 'stop', 'fallback', 'selection', 'geometry', 'longtask', 'longframe'],
    region: ['sessions', 'conversation', 'input', 'options'],
    phase: ['received', 'accepted', 'discarded', 'blocked'],
    reason: ['none', 'invalid_event', 'stale', 'context', 'unfocused', 'mode', 'cancelled', 'cleared',
      'target_changed', 'port_changed', 'selection_changed', 'not_scrollable', 'reversed', 'lease_changed',
      'axis_changed', 'external_offset', 'clock_invalid', 'clock_backwards', 'frame_gap', 'boundary',
      'reduced_motion', 'missing_api', 'raf_schedule_failed', 'write_refused', 'completed', 'exception',
      'blur', 'hidden', 'read_failed', 'disposed', 'first_timestamp_rebase'],
  };
  const numbers = ['tMs', 'direction', 'sequence', 'ageMs', 'dtMs', 'position', 'previousPosition', 'idealPosition',
    'target', 'desiredPosition', 'actualPosition', 'offsetPx', 'workMs', 'callbackLagMs',
    'deliveryGapMs', 'queueWaitMs', 'integratedMs', 'startMs', 'durationMs', 'blockingMs', 'targetMs', 'portsMs', 'validationMs'];
  for (const row of snapshot.entries) {
    expect(enums.type).toContain(row.type);
    expect(row.tMs).toBeGreaterThanOrEqual(0);
    expect(row.tMs).toBeLessThan(5000);
    for (const [key, value] of Object.entries(row)) {
      if (enums[key]) expect(enums[key]).toContain(value);
      else { expect(numbers).toContain(key); expect(typeof value).toBe('number'); expect(Number.isFinite(value)).toBe(true); }
    }
  }
}

async function attachDiagnostics(info, snapshots) {
  for (const snapshot of Object.values(snapshots)) assertNumericDiagnostics(snapshot);
  await mkdir(info.outputPath(), { recursive: true });
  const path = info.outputPath('region-diagnostics.json');
  await writeFile(path, JSON.stringify(snapshots, null, 2));
  await info.attach('region-diagnostics', { path, contentType: 'application/json' });
}

test.describe('opt-in selected-region animation in real Chromium', () => {
  test.use({ regionMotion: 'no-preference', controlledFrames: true });

  test('one detent has visible intermediate positions, settles at 80px and never adds native CSS smoothing', async ({ regions: page }, info) => {
    const samples = [];
    for (const [region, id] of Object.entries(regionElements)) {
      await selectRegion(page, region);
      await hover(page, '#elsewhere');
      await page.locator('#' + id).evaluate(el => el.scrollTo({ top: 120, behavior: 'instant' }));
      const before = await positions(page);
      await page.evaluate(() => window.__regionFrames.resetWrites());
      expect(await rotate(page, 1)).toBe(true);
      expect((await animationState(page, id)).top).toBe(120);
      expect((await animationState(page, id)).pending).toBe(1);
      const early = await advanceFrames(page, id, 2);
      expect(early.at(-1).top).toBeGreaterThan(120);
      expect(early.at(-1).top).toBeLessThan(200);
      await assertNoNativeTail(page, id);
      if (region === 'conversation') {
        const path = info.outputPath('conversation-intermediate-frame.png');
        await page.screenshot({ path });
        await info.attach('conversation-intermediate-frame', { path, contentType: 'image/png' });
      }
      const remaining = await advanceFrames(page, id, 16);
      const settled = await animationState(page, id);
      expect(settled.top).toBe(200);
      expect(settled.pending).toBe(0);
      expect(settled.maxPending).toBe(1);
      expect(await positions(page)).toEqual({ ...before, [id]: 200 });
      await assertNoNativeTail(page, id);
      samples.push({ region, initial: 120, early, remaining });
    }
    await attachFrameSamples(info, samples);
  });

  test('same-direction detents merge their whole targets into one pending RAF loop', async ({ regions: page }, info) => {
    await selectRegion(page, 'conversation');
    await hover(page, '#nested');
    await page.locator('#conversation').evaluate(el => el.scrollTo({ top: 120, behavior: 'instant' }));
    const before = await positions(page);
    const initial = await page.evaluate(() => {
      const qa = window.__regions, frames = window.__regionFrames;
      const requests = frames.requests;
      return { handled: [1, 1, 1].map(direction => qa.nav.rotate(qa.target, direction, qa.ports)),
        requested: frames.requests - requests, pending: frames.pending.length, top: document.getElementById('conversation').scrollTop };
    });
    expect(initial).toEqual({ handled: [true, true, true], requested: 1, pending: 1, top: 120 });
    const early = await advanceFrames(page, 'conversation', 2);
    const mergingFrom = early.at(-1).top;
    expect(mergingFrom).toBeGreaterThan(120);
    expect(mergingFrom).toBeLessThan(360);
    const merged = await page.evaluate(() => {
      const qa = window.__regions, frames = window.__regionFrames, requests = frames.requests;
      return { handled: [1, 1].map(direction => qa.nav.rotate(qa.target, direction, qa.ports)), requested: frames.requests - requests,
        pending: frames.pending.length, top: document.getElementById('conversation').scrollTop };
    });
    expect(merged).toEqual({ handled: [true, true], requested: 0, pending: 1, top: mergingFrom });
    const remaining = await advanceFrames(page, 'conversation', 18);
    const settled = await animationState(page, 'conversation');
    expect(settled.top).toBe(520); // 120 + five complete 80px detents, not current + 160.
    expect(settled.pending).toBe(0);
    expect(settled.maxPending).toBe(1);
    expect(await positions(page)).toEqual({ ...before, conversation: 520 });
    expect(await page.evaluate(() => window.__regions.composerWheels)).toBe(0);
    await assertNoNativeTail(page, 'conversation');
    await attachFrameSamples(info, { initial, early, merged, remaining });
  });

  test('reversal discards old outstanding travel before the next frame', async ({ regions: page }, info) => {
    await selectRegion(page, 'conversation');
    await page.locator('#conversation').evaluate(el => el.scrollTo({ top: 320, behavior: 'instant' }));
    expect(await page.evaluate(() => {
      const qa = window.__regions;
      return [1, 1, 1].map(direction => qa.nav.rotate(qa.target, direction, qa.ports));
    })).toEqual([true, true, true]);
    const forward = await advanceFrames(page, 'conversation', 2), turnAt = forward.at(-1).top;
    expect(turnAt).toBeGreaterThan(320);
    expect(turnAt).toBeLessThan(560);
    expect(await rotate(page, -1)).toBe(true);
    expect((await animationState(page, 'conversation')).top).toBe(turnAt);
    const reverse = await advanceFrames(page, 'conversation', 18);
    expect(reverse[0].top).toBeLessThanOrEqual(turnAt);
    expect(reverse[1].top).toBeLessThan(turnAt);
    for (let index = 1; index < reverse.length; index++) expect(reverse[index].top).toBeLessThanOrEqual(reverse[index - 1].top);
    expect(reverse.at(-1).top).toBeCloseTo(turnAt - 80, 0);
    expect((await animationState(page, 'conversation')).pending).toBe(0);
    expect((await animationState(page, 'conversation')).maxPending).toBe(1);
    await assertNoNativeTail(page, 'conversation');
    await attachFrameSamples(info, { forward, reversalStart: turnAt, reverse });
  });

  test('animation clamps real endpoints and retains column-reverse negative positions without ancestor chaining', async ({ regions: page }, info) => {
    const samples = [];
    for (const [region, id] of Object.entries(regionElements)) {
      await selectRegion(page, region);
      if (region === 'conversation') await page.locator('#conversation').evaluate(el => { el.style.display = 'flex'; el.style.flexDirection = 'column-reverse'; });
      const edge = await page.locator('#' + id).evaluate(el => {
        const reversed = getComputedStyle(el).flexDirection === 'column-reverse', extent = el.scrollHeight - el.clientHeight;
        el.scrollTo({ top: reversed ? -extent + 40 : extent - 40, behavior: 'instant' });
        return { reversed, extent, initial: el.scrollTop, final: reversed ? -extent : extent };
      });
      const before = await positions(page);
      const direction = edge.reversed ? -1 : 1;
      expect(await page.evaluate(direction => { const qa = window.__regions; return Array.from({ length: 3 }, () => qa.nav.rotate(qa.target, direction, qa.ports)); }, direction)).toEqual([true, true, true]);
      const frames = await advanceFrames(page, id, 18);
      expect(frames[1].top).not.toBe(edge.initial);
      for (const frame of frames) expect(frame.top).toBeGreaterThanOrEqual(Math.min(edge.initial, edge.final));
      for (const frame of frames) expect(frame.top).toBeLessThanOrEqual(Math.max(edge.initial, edge.final));
      expect(frames.at(-1).top).toBe(edge.final);
      expect(await positions(page)).toEqual({ ...before, [id]: edge.final });
      expect(await rotate(page, direction)).toBe(true);
      await advanceFrames(page, id, 18);
      expect(await positions(page)).toEqual({ ...before, [id]: edge.final });
      await assertNoNativeTail(page, id);
      samples.push({ region, edge, frames });
    }
    await attachFrameSamples(info, samples);
  });

  test('queued and already-dequeued callbacks cannot write or revive after lease, region, target, focus or node cancellation', async ({ regions: page }, info) => {
    const results = await page.evaluate(ids => {
      const qa = window.__regions, frames = window.__regionFrames;
      const positions = () => Object.fromEntries(ids.map(id => [id, document.getElementById(id).scrollTop]));
      const select = () => {
        qa.nav.clear(); qa.target = { ...qa.baseTarget };
        qa.ports.conversation.port = document.getElementById('conversation');
        qa.nav.cycle(qa.target, qa.ports); qa.nav.cycle(qa.target, qa.ports);
      };
      return ['clear', 'reselect', 'region', 'session', 'owner', 'binding', 'pending', 'focus', 'blur', 'replacement', 'port-reference', 'hidden', 'dispose'].map(kind => {
        select();
        const old = document.getElementById('conversation');
        old.scrollTo({ top: 160, behavior: 'instant' });
        const handled = qa.nav.rotate(qa.target, 1, qa.ports);
        frames.frame(); frames.frame();
        const intermediate = old.scrollTop, held = frames.pending;
        if (kind === 'clear') qa.nav.clear();
        if (kind === 'reselect') select();
        if (kind === 'region') qa.nav.cycle(qa.target, qa.ports);
        if (kind === 'session') qa.target = { ...qa.target, sessionId: 'other-session' };
        if (kind === 'owner') qa.target = { ...qa.target, sessionOwner: 'other-owner' };
        if (kind === 'binding') qa.target = { ...qa.target, binding: 'other-binding' };
        if (kind === 'pending') qa.target = { ...qa.target, pending: { kind: 'question' }, pendingKey: 'other-question' };
        if (kind === 'focus') qa.target = { ...qa.target, focused: false };
        if (kind === 'blur') window.dispatchEvent(new Event('blur'));
        if (kind === 'replacement') {
          const replacement = old.cloneNode(true);
          old.replaceWith(replacement); replacement.scrollTo({ top: intermediate, behavior: 'instant' });
          qa.ports.conversation.port = replacement;
        }
        if (kind === 'port-reference') qa.ports = { ...qa.ports, conversation: { port: document.getElementById('elsewhere') } };
        if (kind === 'hidden') old.hidden = true;
        if (kind === 'dispose') qa.nav.dispose();
        const before = positions(), oldBefore = old.scrollTop, writesBefore = frames.writes.length;
        frames.frame(); frames.replay(held); frames.frame(); frames.replay(held);
        const after = positions(), oldAfter = old.scrollTop, writesAfter = frames.writes.length;
        const active = qa.nav.activeId, pending = frames.pending.length;
        old.hidden = false;
        let fresh = null;
        if (kind !== 'dispose') {
          select(); const freshBefore = positions(), freshWrites = frames.writes.length;
          frames.replay(held); frames.frame();
          fresh = { before: freshBefore, after: positions(), writesBefore: freshWrites, writesAfter: frames.writes.length,
            active: qa.nav.activeId, pending: frames.pending.length };
        }
        return { kind, handled, intermediate, held: held.length, before, after, oldBefore, oldAfter, writesBefore, writesAfter, active, pending, fresh };
      });
    }, positionIds);
    for (const result of results) {
      expect(result.handled, result.kind).toBe(true);
      expect(result.intermediate, result.kind).toBeGreaterThan(160);
      expect(result.intermediate, result.kind).toBeLessThan(240);
      expect(result.held, result.kind).toBe(1);
      expect(result.after, result.kind).toEqual(result.before);
      expect(result.oldAfter, result.kind).toBe(result.oldBefore);
      expect(result.writesAfter, result.kind).toBe(result.writesBefore);
      expect(result.pending, result.kind).toBe(0);
      expect(result.active, result.kind).toBe(result.kind === 'reselect' ? 'conversation' : result.kind === 'region' ? 'input' : null);
      if (result.fresh) {
        expect(result.fresh.after, result.kind).toEqual(result.fresh.before);
        expect(result.fresh.writesAfter, result.kind).toBe(result.fresh.writesBefore);
        expect(result.fresh.active, result.kind).toBe('conversation');
        expect(result.fresh.pending, result.kind).toBe(0);
      }
    }
    await attachFrameSamples(info, results);
  });

  test.describe('local numeric-only diagnostic capture', () => {
    // Diagnostics produce only the validated JSON below: no new image, trace or page-content capture.

    test('diagnostics preserve the original motion loop, reversal and guards while dropping raw input fields', async ({ regions: page }, info) => {
      const result = await page.evaluate(ids => {
        const qa = window.__regions, frames = window.__regionFrames, el = document.getElementById('conversation');
        let unknownReads = 0;
        const run = enabled => {
          qa.nav.clear(); qa.target = { ...qa.baseTarget };
          qa.nav.cycle(qa.target, qa.ports); qa.nav.cycle(qa.target, qa.ports);
          el.scrollTo({ top: 120, behavior: 'instant' }); frames.resetWrites();
          const requested = frames.requests, epoch = performance.now(), trace = [], frameSamples = [];
          if (enabled) {
            if (!qa.nav.startDiagnostics()) throw new Error('isolated_diagnostic_start_failed');
            const raw = { phase: 'received', direction: 1, sequence: 7, ageMs: 12.5, reason: 'none',
              text: 'synthetic-private-text', session: 'synthetic-private-session', sessionId: 'synthetic-private-id',
              sourceObject: el, unknown: { raw: 'synthetic-private-object' }, dtMs: 999, target: 999 };
            Object.defineProperty(raw, 'unrecognizedGetter', { enumerable: true, get() { unknownReads++; return el; } });
            qa.nav.noteInput(raw);
            qa.nav.noteInput({ phase: 'synthetic-private-phase', direction: 'up', sequence: -1, ageMs: NaN,
              reason: 'synthetic-private-reason', text: 'synthetic-private-text', sourceObject: el });
          }
          const state = label => ({ label, top: el.scrollTop, active: qa.nav.activeId,
            positions: { ...Object.fromEntries(ids.map(id => [id, document.getElementById(id).scrollTop])), document: document.scrollingElement.scrollTop },
            pending: frames.pending.length, requested: frames.requests - requested, writes: frames.writes.length });
          const tick = (count, milliseconds = 16) => Array.from({ length: count }, () => {
            frames.frame(milliseconds);
            frameSamples.push({ tMs: Math.round((performance.now() - epoch) * 1000) / 1000, top: el.scrollTop });
            return state('frame');
          });
          const turn = direction => qa.nav.rotate(qa.target, direction, qa.ports);
          const handled = [turn(1), turn(1), turn(1)];
          const initial = state('initial'); trace.push(initial, ...tick(2));
          handled.push(turn(1), turn(1)); const merged = state('merged'); trace.push(merged, ...tick(18));
          const settled = state('settled');
          el.scrollTo({ top: 320, behavior: 'instant' });
          handled.push(turn(1), turn(1), turn(1)); trace.push(...tick(2));
          const turnAt = el.scrollTop, heldForward = frames.pending;
          handled.push(turn(-1)); const reversed = state('reversed');
          frames.replay(heldForward); const staleForward = state('stale-forward');
          trace.push(reversed, staleForward, ...tick(18));
          const reverseEnd = state('reverse-end'), guards = [];
          for (const kind of ['external_offset', 'frame_gap', 'focus']) {
            el.scrollTo({ top: 160, behavior: 'instant' }); handled.push(turn(1)); trace.push(...tick(2));
            const held = frames.pending;
            if (kind === 'external_offset') el.scrollTo({ top: 312, behavior: 'instant' });
            if (kind === 'focus') qa.target = { ...qa.target, focused: false };
            const before = state(kind); tick(1, kind === 'frame_gap' ? 101 : 16); frames.replay(held);
            const after = state(kind); guards.push({ kind, before, after }); trace.push(after);
          }
          const snapshot = qa.nav.getDiagnostics(); qa.nav.stopDiagnostics();
          return { handled, initial, merged, settled, turnAt, reversed, staleForward, reverseEnd, guards, trace, frameSamples,
            maxPending: frames.maxPending, snapshot };
        };
        const baseline = run(false), diagnosed = run(true);
        return { baseline, diagnosed, unknownReads };
      }, positionIds);
      const { baseline, diagnosed } = result;
      expect(baseline.snapshot.state).toBe('idle');
      expect(diagnosed.trace).toEqual(baseline.trace);
      expect(diagnosed.handled).toEqual(Array(12).fill(true));
      expect(diagnosed.initial).toMatchObject({ top: 120, pending: 1, requested: 1 });
      expect(diagnosed.merged.pending).toBe(1);
      expect(diagnosed.merged.requested).toBe(diagnosed.trace[2].requested);
      expect(diagnosed.settled).toMatchObject({ top: 520, pending: 0 });
      expect(diagnosed.reverseEnd.top).toBeCloseTo(diagnosed.turnAt - 80, 0);
      expect(diagnosed.reverseEnd.pending).toBe(0);
      expect(diagnosed.staleForward).toEqual({ ...diagnosed.reversed, label: 'stale-forward' });
      expect(diagnosed.maxPending).toBe(1);
      for (const guard of diagnosed.guards) {
        expect(guard.after.positions, guard.kind).toEqual(guard.before.positions);
        expect(guard.after.writes, guard.kind).toBe(guard.before.writes);
        expect(guard.after.requested, guard.kind).toBe(guard.before.requested);
        expect(guard.after.pending, guard.kind).toBe(0);
        expect(guard.after.active).toBe(guard.kind === 'focus' ? null : 'conversation');
      }
      const snapshot = diagnosed.snapshot;
      assertNumericDiagnostics(snapshot);
      expect(snapshot.state).toBe('recording');
      expect(snapshot.dropped).toBe(0);
      expect(result.unknownReads).toBe(0);
      expect(snapshot.entries.filter(row => row.type === 'input')).toEqual([
        { type: 'input', tMs: 0, region: 'conversation', phase: 'received', direction: 1, sequence: 7, ageMs: 12.5, reason: 'none' },
        { type: 'input', tMs: 0, region: 'conversation' },
      ]);
      const frameRows = snapshot.entries.filter(row => row.type === 'frame');
      const writes = frameRows.filter(row => row.reason === 'none');
      expect(writes.length).toBeGreaterThan(10);
      expect(writes.some(row => row.actualPosition > row.position && row.actualPosition - row.position < 80)).toBe(true);
      expect(writes.some(row => row.actualPosition < row.position)).toBe(true);
      for (const row of writes) {
        expect(row.position).toBe(row.previousPosition);
        expect(row.offsetPx).toBe(0);
        expect(row.workMs).toBe(0);
        expect(row.callbackLagMs).toBe(0);
        let desired = row.target + (row.idealPosition - row.target) * Math.exp(-row.dtMs / 45);
        if (Math.abs(row.target - desired) <= 0.5) desired = row.target;
        expect(row.desiredPosition).toBeCloseTo(desired, 2);
        expect(Math.abs(row.actualPosition - row.desiredPosition)).toBeLessThanOrEqual(0.501);
        expect(row.actualPosition).toBe(diagnosed.frameSamples.find(sample => sample.tMs === row.tMs).top);
        expect((row.actualPosition - row.position) * row.direction).toBeGreaterThanOrEqual(0);
      }
      expect(frameRows.find(row => row.reason === 'external_offset')).toMatchObject({ position: 312 });
      expect(frameRows.find(row => row.reason === 'frame_gap').dtMs).toBe(101);
      expect(snapshot.entries.filter(row => row.type === 'stop').map(row => row.reason)).toEqual([
        'completed', 'reversed', 'completed', 'external_offset', 'frame_gap', 'target_changed',
      ]);
      expect(await page.evaluate(() => window.__regions.composerWheels)).toBe(0);
      await attachDiagnostics(info, { recording: snapshot });
    });

    test('stop and 5000ms expiry bound capture to 240 entries without changing ongoing DOM movement or RAF', async ({ regions: page }, info) => {
      await selectRegion(page, 'conversation');
      const result = await page.evaluate(ids => {
        const qa = window.__regions, nav = qa.nav, frames = window.__regionFrames, el = document.getElementById('conversation');
        const state = () => ({ positions: { ...Object.fromEntries(ids.map(id => [id, document.getElementById(id).scrollTop])), document: document.scrollingElement.scrollTop },
          top: el.scrollTop, active: nav.activeId, pending: frames.pending, requests: frames.requests, writes: frames.writes.length });
        el.scrollTo({ top: 120, behavior: 'instant' });
        const beforeStart = state(), started = nav.startDiagnostics(), afterStart = state();
        const handled = nav.rotate(qa.target, 1, qa.ports); frames.frame(); frames.frame();
        const beforeStop = state(), recording = nav.getDiagnostics(); nav.stopDiagnostics();
        const stopped = nav.getDiagnostics();
        nav.noteInput({ phase: 'accepted', direction: 1, sequence: 999, ageMs: 0, reason: 'none' });
        const afterStop = state();
        frames.frame(); const afterNextFrame = state();
        for (let index = 0; index < 18; index++) frames.frame();
        const settled = state(), stoppedAfterMovement = nav.getDiagnostics();
        const beforeRestart = state(), restarted = nav.startDiagnostics(), afterRestart = state();
        for (let sequence = 0; sequence < 360; sequence++) nav.noteInput({ phase: 'received', direction: 1, sequence, ageMs: 0, reason: 'none' });
        const bounded = nav.getDiagnostics();
        frames.elapse(4999);
        const at4999 = nav.getDiagnostics(), continued = nav.rotate(qa.target, 1, qa.ports);
        const beforeExpiry = state(); frames.elapse(1);
        const expired = nav.getDiagnostics(); nav.stopDiagnostics();
        nav.noteInput({ phase: 'accepted', direction: -1, sequence: 1000, ageMs: 0, reason: 'none' });
        const afterExpiry = state();
        frames.frame(); const afterExpiredFrame = state();
        for (let index = 0; index < 18; index++) frames.frame();
        const final = state(), expiredAfterMovement = nav.getDiagnostics();
        return { started, beforeStart, afterStart, handled, beforeStop, recording, stopped, afterStop, afterNextFrame, settled,
          stoppedAfterMovement, beforeRestart, restarted, afterRestart, bounded, at4999, continued, beforeExpiry, expired,
          afterExpiry, afterExpiredFrame, final, expiredAfterMovement, maxPending: frames.maxPending };
      }, positionIds);
      expect(result.started).toBe(true);
      expect(result.afterStart).toEqual(result.beforeStart);
      expect(result.handled).toBe(true);
      expect(result.recording.state).toBe('recording');
      expect(result.beforeStop.top).toBeGreaterThan(120);
      expect(result.beforeStop.top).toBeLessThan(200);
      expect(result.beforeStop.pending).toHaveLength(1);
      expect(result.afterStop).toEqual(result.beforeStop);
      expect(result.stopped.state).toBe('stopped');
      expect(result.stopped.entries).toEqual(result.recording.entries);
      expect(result.stoppedAfterMovement).toEqual(result.stopped);
      expect(result.afterNextFrame.top).toBeGreaterThan(result.beforeStop.top);
      expect(result.afterNextFrame.requests).toBe(result.beforeStop.requests + 1);
      expect(result.settled.top).toBe(200);
      expect(result.settled.pending).toEqual([]);
      expect(result.restarted).toBe(true);
      expect(result.afterRestart).toEqual(result.beforeRestart);
      expect(result.bounded).toMatchObject({ state: 'recording', elapsedMs: 0, dropped: 120 });
      expect(result.bounded.entries).toHaveLength(240);
      expect(result.bounded.entries.map(row => row.sequence)).toEqual(Array.from({ length: 240 }, (_, index) => index + 120));
      expect(result.at4999).toMatchObject({ state: 'recording', elapsedMs: 4999, dropped: 120 });
      expect(result.continued).toBe(true);
      expect(result.beforeExpiry.pending).toHaveLength(1);
      expect(result.afterExpiry).toEqual(result.beforeExpiry);
      expect(result.expired).toMatchObject({ state: 'expired', elapsedMs: 5000, dropped: 121 });
      expect(result.expired.entries).toHaveLength(240);
      expect(result.expired.entries.at(-1)).toEqual({ type: 'detent', tMs: 4999, region: 'conversation', direction: 1, position: 200, target: 280 });
      expect(result.expiredAfterMovement).toEqual(result.expired);
      expect(result.afterExpiredFrame.top).toBeGreaterThan(200);
      expect(result.afterExpiredFrame.requests).toBe(result.beforeExpiry.requests + 1);
      expect(result.final.top).toBe(280);
      expect(result.final.pending).toEqual([]);
      expect(result.maxPending).toBe(1);
      await attachDiagnostics(info, { stopped: result.stopped, bounded: result.bounded, expired: result.expired });
    });
  });

  test.describe('native-clock browser integration', () => {
    test.use({ controlledFrames: false });
    test('native RAF timestamps and asynchronous scroll events advance only the selected conversation', async ({ regions: page }, info) => {
      await selectRegion(page, 'conversation');
      await hover(page, '#nested');
      await page.locator('#conversation').evaluate(el => el.scrollTo({ top: 120, behavior: 'instant' }));
      const before = await positions(page);
      const result = await page.evaluate(() => new Promise((resolve, reject) => {
        const qa = window.__regions, el = document.getElementById('conversation'), samples = [];
        let scrollEvents = 0, stableFrames = 0;
        const onScroll = () => scrollEvents++;
        el.addEventListener('scroll', onScroll);
        const started = performance.now(), handled = qa.nav.rotate(qa.target, 1, qa.ports);
        samples.push({ milliseconds: 0, top: el.scrollTop });
        const timeout = setTimeout(() => { el.removeEventListener('scroll', onScroll); reject(new Error('native_region_animation_did_not_settle_within_2s')); }, 2000);
        const sample = at => {
          samples.push({ milliseconds: at - started, top: el.scrollTop });
          stableFrames = el.scrollTop === 200 ? stableFrames + 1 : 0;
          if (stableFrames < 3) requestAnimationFrame(sample);
          else {
            clearTimeout(timeout); el.removeEventListener('scroll', onScroll);
            resolve({ handled, samples, scrollEvents });
          }
        };
        requestAnimationFrame(sample);
      }));
      expect(result.handled).toBe(true);
      expect(result.samples[0].top).toBe(120);
      expect(result.samples.some(sample => sample.top > 120 && sample.top < 200)).toBe(true);
      for (let index = 1; index < result.samples.length; index++) {
        expect(result.samples[index].top).toBeGreaterThanOrEqual(result.samples[index - 1].top);
        expect(result.samples[index].top).toBeLessThanOrEqual(200);
        if (index === 1 && result.samples[index].milliseconds < 0) {
          // A native RAF frame timestamp can precede dispatch's performance.now slightly.
          expect(result.samples[index].milliseconds).toBeGreaterThanOrEqual(-32);
          expect(result.samples[index].top).toBe(120);
        } else expect(result.samples[index].milliseconds).toBeGreaterThanOrEqual(result.samples[index - 1].milliseconds);
      }
      expect(result.samples.at(-1).top).toBe(200);
      expect(result.scrollEvents).toBeGreaterThan(0);
      expect(await positions(page)).toEqual({ ...before, conversation: 200 });
      expect(await page.evaluate(() => window.__regions.composerWheels)).toBe(0);
      // This is native browser scheduling evidence, not a physical device/FPS benchmark.
      await attachFrameSamples(info, result);
    });
  });

  test.describe('reduced motion bypass', () => {
    test.use({ regionMotion: 'reduce' });
    test('reduced motion writes directly and never queues an animation frame', async ({ regions: page }, info) => {
      await selectRegion(page, 'conversation');
      await page.locator('#conversation').evaluate(el => el.scrollTo({ top: 120, behavior: 'instant' }));
      const before = await positions(page);
      await page.evaluate(() => window.__regionFrames.resetWrites());
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      expect(await rotate(page, 1)).toBe(true);
      const direct = await animationState(page, 'conversation');
      expect(direct.top).toBe(200);
      expect(direct.pending).toBe(0);
      expect(direct.requests).toBe(0);
      await advanceFrames(page, 'conversation', 18);
      expect(await positions(page)).toEqual({ ...before, conversation: 200 });
      await assertNoNativeTail(page, 'conversation');
      await attachFrameSamples(info, { before: 120, direct });
    });
  });
});
