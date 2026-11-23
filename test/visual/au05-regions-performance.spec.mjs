// Offline operation-count comparison, not a hardware latency/FPS benchmark.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const marker = 'export function createRegionNavigation(';
const current = await readFile(new URL('../../packages/dsh-plugin/src/regions.js', import.meta.url), 'utf8');
// Optional read-only pre-change source; fresh checkouts still run current invariants.
const before = process.env.AU05_REGION_PERF_BASELINE ? await readFile(process.env.AU05_REGION_PERF_BASELINE, 'utf8') : null;
if (before) assert.equal(createHash('sha256').update(before).digest('hex').toUpperCase(), 'A203C93E3E65E2282D13AFF4625C91374EC0542BB1BB0657470DBB87D7C9C0CA');
for (const source of [before, current].filter(Boolean)) assert.equal(source.split(marker).length, 2);
const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'"><style>
*{box-sizing:border-box}body{margin:16px;font:14px/20px sans-serif}#layout{display:flex;gap:24px;align-items:start}.port{overflow-y:auto;scroll-behavior:smooth;border:1px solid;width:260px;height:240px}[data-row-key]{height:28px}#conversation{width:500px}#content{height:6000px}textarea{height:120px;width:260px}#noise{position:absolute;top:1200px}.noise{height:1px}
</style><button id="sentinel">Fixture focus</button><div id="layout"><div id="sidebar" class="port" role="tree">${Array.from({ length: 1000 }, (_, i) => `<div data-row-key="${i % 10 === 0 ? 'workspace:' : 'session:'}${i === 1 ? 'isolated' : i}">Row ${i}</div>`).join('')}</div><div id="conversation" class="port" data-conversation-scroll><div id="content">Synthetic conversation</div></div><textarea id="input"></textarea></div><div id="noise">${'<div class="noise"><span>Unrelated</span></div>'.repeat(2000)}</div>`;

test.use({ screenshot: 'off', trace: 'off', reducedMotion: 'no-preference' });

async function run(browser, source) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference', serviceWorkers: 'block', permissions: [] });
  const page = await context.newPage(), requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  try {
    await page.setContent(html);
    await page.evaluate(() => {
      window.__forbidden = [];
      const deny = name => () => { window.__forbidden.push(name); throw Error('forbidden_region_performance_effect:' + name); };
      for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'RTCPeerConnection', 'Audio', 'AudioContext', 'MediaRecorder', 'KeyboardEvent', 'open']) window[name] = deny(name);
      for (const name of ['mediaDevices', 'hid', 'serial', 'usb', 'bluetooth', 'clipboard']) Object.defineProperty(navigator, name, { configurable: true, get: deny(name) });
      navigator.sendBeacon = deny('sendBeacon');
      for (const name of ['__DSH_BOOT__', '__ModuleLoader__', 'dsh', 'electronAPI', 'ipcRenderer', 'require']) Object.defineProperty(window, name, { configurable: true, get: deny(name) });
      let now = 1000, serial = 0;
      const pending = new Map(), callbacks = new Map();
      Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
      window.requestAnimationFrame = callback => { const id = ++serial; pending.set(id, callback); callbacks.set(id, callback); return id; };
      window.cancelAnimationFrame = id => pending.delete(id);
      window.__frames = { pending, frame() { now += 16; for (const [id, callback] of [...pending]) if (pending.delete(id)) callback(now); }, replay(ids) { now += 16; for (const id of ids) callbacks.get(id)?.(now); } };
      const counts = {}, reset = () => { for (const key of Object.keys(counts)) delete counts[key]; };
      const hit = key => { counts[key] = (counts[key] || 0) + 1; };
      for (const [proto, label] of [[Document.prototype, 'document'], [Element.prototype, 'element']]) {
        for (const method of ['querySelectorAll', 'querySelector']) {
          const native = proto[method];
          proto[method] = function (selector) { hit(label + 'Queries'); hit(label + ':' + method); if (/data-row-key|role="tree"/.test(selector)) hit('sidebarQueries'); if (/data-question|radiogroup/.test(selector)) hit('questionQueries'); const result = Reflect.apply(native, this, [selector]); hit(label + 'Results'); counts[label + 'ResultNodes'] = (counts[label + 'ResultNodes'] || 0) + (method === 'querySelectorAll' ? result.length : Number(Boolean(result))); return result; };
        }
      }
      const attr = Element.prototype.getAttribute;
      Element.prototype.getAttribute = function (name) { if (name === 'data-row-key') hit('rowAttributes'); return Reflect.apply(attr, this, [name]); };
      for (const method of ['getBoundingClientRect', 'getClientRects']) {
        const native = Element.prototype[method]; Element.prototype[method] = function (...args) { hit(method); return Reflect.apply(native, this, args); };
      }
      const style = window.getComputedStyle;
      window.getComputedStyle = function (...args) { hit('computedStyles'); return Reflect.apply(style, this, args); };
      const observer = new MutationObserver(() => {});
      observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
      window.__counts = { reset() { observer.takeRecords(); reset(); }, sample() { const mutations = observer.takeRecords().filter(r => r.target.closest?.('[data-au05-region]')); return { ...counts, overlayMutations: mutations.length }; } };
    });
    await page.addScriptTag({ content: source.replace(marker, marker.slice(7)) });
    await page.bringToFront();
    await page.locator('#sentinel').focus();
    const result = await page.evaluate(() => {
      const el = id => document.getElementById(id), frames = window.__frames;
      const base = { sessionId: 'isolated', binding: 'binding-a', sessionOwner: 'owner-a', focused: true, pending: null, pendingKey: null };
      const qa = window.__qa = { target: { ...base }, ports: { input: el('input'), conversation: { port: el('conversation') } } };
      el('input').value = 'Synthetic line\n'.repeat(100);
      qa.nav = createRegionNavigation({ document, window, readTarget: () => qa.target, readPorts: () => qa.ports });
      const nav = qa.nav, counts = window.__counts;
      const select = id => { nav.clear(); qa.target = { ...base }; qa.ports.conversation.port = el('conversation'); for (let i = 0; i < 3; i++) { nav.cycle(qa.target, qa.ports); if (nav.activeId === id) return; } throw Error('selection_failed:' + id); };
      const state = () => ({ active: nav.activeId, top: el('conversation').scrollTop, sidebar: el('sidebar').scrollTop, input: el('input').scrollTop, pending: frames.pending.size });
      const sample = action => { counts.reset(); const value = action(); return { counts: counts.sample(), value }; };
      select('conversation'); el('conversation').scrollTo({ top: 120, behavior: 'instant' });
      const phases = {};
      phases.reconcile = sample(() => Array.from({ length: 24 }, () => nav.reconcile(qa.target, qa.ports)));
      phases.rotate = sample(() => [1, 1, 1, 1, 1].map(d => nav.rotate(qa.target, d, qa.ports)));
      phases.frames = sample(() => Array.from({ length: 20 }, () => { frames.frame(); return state(); }));
      phases.geometry = sample(() => { for (let i = 0; i < 24; i++) window.dispatchEvent(new Event('resize')); return state(); });
      const settled = state();
      select('sessions');
      phases.sidebar = sample(() => Array.from({ length: 24 }, () => nav.reconcile(qa.target, qa.ports)));
      phases.sidebarRotate = sample(() => [1, 1, 1, 1, 1].map(d => nav.rotate(qa.target, d, qa.ports)));
      phases.sidebarFrames = sample(() => Array.from({ length: 20 }, () => { frames.frame(); return state(); }));
      const sidebarSettled = state();
      select('conversation');
      // Geometry is real and must remain fresh even when session/ports are unchanged.
      const geometry = [];
      for (const margin of [40, 90]) {
        el('conversation').style.marginTop = margin + 'px'; window.dispatchEvent(new Event('resize'));
        const overlay = document.querySelector('[data-au05-region]');
        geometry.push({ expected: el('conversation').getBoundingClientRect().top, actual: overlay.getBoundingClientRect().top });
      }
      const guards = [];
      for (const kind of ['owner', 'focus', 'replacement']) {
        select('conversation'); el('conversation').scrollTo({ top: 160, behavior: 'instant' });
        const handled = nav.rotate(qa.target, 1, qa.ports); frames.frame(); frames.frame();
        const held = [...frames.pending.keys()];
        if (kind === 'owner') qa.target = { ...qa.target, sessionOwner: 'owner-b' };
        if (kind === 'focus') qa.target = { ...qa.target, focused: false };
        if (kind === 'replacement') { const old = el('conversation'), top = old.scrollTop, replacement = old.cloneNode(true); old.replaceWith(replacement); replacement.scrollTo({ top, behavior: 'instant' }); qa.ports.conversation.port = replacement; }
        const top = el('conversation').scrollTop; frames.frame(); frames.replay(held); frames.frame();
        guards.push({ kind, handled, before: top, after: el('conversation').scrollTop, active: nav.activeId, pending: frames.pending.size });
      }
      // First discover no sidebar, then add one, then a second independent modern tree.
      nav.clear(); qa.target = { ...base }; const sidebar = el('sidebar'), parent = sidebar.parentNode; sidebar.remove();
      nav.cycle(qa.target, qa.ports); const without = nav.activeId; nav.clear(); parent.prepend(sidebar);
      nav.cycle(qa.target, qa.ports); const withOne = nav.activeId;
      const duplicate = sidebar.cloneNode(true); duplicate.id = 'sidebar-duplicate'; parent.append(duplicate);
      const duplicateHandled = nav.reconcile(qa.target, qa.ports), duplicateActive = nav.activeId;
      nav.dispose();
      return { phases, settled, sidebarSettled, geometry, guards, ambiguity: { without, withOne, duplicateHandled, duplicateActive }, forbidden: window.__forbidden, url: location.href, focused: document.hasFocus() };
    });
    expect(requests).toEqual([]); expect(errors).toEqual([]); expect(result.forbidden).toEqual([]); expect(result.url).toBe('about:blank'); expect(result.focused).toBe(true);
    return result;
  } finally { await context.close(); }
}

test('large modern sidebar: current native geometry, motion and fresh lease guards', async ({ browser }, info) => {
  expect(browser.version()).toBe('145.0.7632.6');
  const result = await run(browser, current);
  expect(result.settled).toEqual({ active: 'conversation', top: 520, sidebar: 0, input: 0, pending: 0 });
  expect(result.sidebarSettled).toEqual({ active: 'sessions', top: 520, sidebar: 400, input: 0, pending: 0 });
  for (const geometry of result.geometry) expect(geometry.actual).toBe(geometry.expected);
  for (const guard of result.guards) { expect(guard.handled).toBe(true); expect(guard.before).toBeGreaterThan(160); expect(guard.after).toBe(guard.before); expect(guard.active).toBe(null); expect(guard.pending).toBe(0); }
  expect(result.ambiguity).toEqual({ without: 'conversation', withOne: 'sessions', duplicateHandled: false, duplicateActive: null });
  for (const phase of ['reconcile', 'rotate', 'frames', 'geometry']) {
    expect(result.phases[phase].counts.sidebarQueries || 0).toBe(0);
    expect(result.phases[phase].counts.questionQueries || 0).toBe(0);
  }
  await info.attach('region-current-operation-counts', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });
});

test('large modern sidebar: deterministic before/after DOM work with equivalent motion and fresh guards', async ({ browser }, info) => {
  test.skip(!before, 'Set AU05_REGION_PERF_BASELINE to the preserved SHA-verified pre-change source for A/B comparison.');
  expect(browser.version()).toBe('145.0.7632.6');
  const baseline = await run(browser, before), optimized = await run(browser, current);
  for (const result of [baseline, optimized]) {
    expect(result.settled).toEqual({ active: 'conversation', top: 520, sidebar: 0, input: 0, pending: 0 });
    expect(result.sidebarSettled).toEqual({ active: 'sessions', top: 520, sidebar: 400, input: 0, pending: 0 });
    expect(result.phases.reconcile.value).toEqual(Array(24).fill(true)); expect(result.phases.rotate.value).toEqual(Array(5).fill(true));
    for (const geometry of result.geometry) expect(geometry.actual).toBe(geometry.expected);
    for (const guard of result.guards) { expect(guard.handled).toBe(true); expect(guard.before).toBeGreaterThan(160); expect(guard.after).toBe(guard.before); expect(guard.active).toBe(null); expect(guard.pending).toBe(0); }
    expect(result.ambiguity).toEqual({ without: 'conversation', withOne: 'sessions', duplicateHandled: false, duplicateActive: null });
  }
  for (const phase of ['reconcile', 'rotate', 'frames', 'geometry']) {
    expect(optimized.phases[phase].value).toEqual(baseline.phases[phase].value);
    const old = baseline.phases[phase].counts, fresh = optimized.phases[phase].counts;
    expect(old.sidebarQueries).toBeGreaterThan(0);
    expect(fresh.sidebarQueries || 0, phase + ': selected conversation must not rediscover sidebar').toBe(0);
    expect(fresh.questionQueries || 0, phase + ': selected conversation must not discover questions').toBe(0);
    expect(fresh.rowAttributes || 0).toBe(0);
    expect(fresh.getBoundingClientRect).toBeLessThan(old.getBoundingClientRect);
    expect(fresh.computedStyles).toBeLessThan(old.computedStyles);
  }
  for (const phase of ['sidebar', 'sidebarRotate', 'sidebarFrames']) {
    expect(optimized.phases[phase].value).toEqual(baseline.phases[phase].value);
    expect(optimized.phases[phase].counts.rowAttributes || 0).toBe(0);
    expect(optimized.phases[phase].counts.elementResultNodes).toBeLessThan(baseline.phases[phase].counts.elementResultNodes);
  }
  expect(optimized.phases.sidebar.counts.rowAttributes || 0).toBeLessThan(baseline.phases.sidebar.counts.rowAttributes);
  expect(optimized.phases.sidebar.counts.documentResultNodes).toBeLessThan(baseline.phases.sidebar.counts.documentResultNodes);
  expect(optimized.phases.geometry.counts.overlayMutations).toBe(0);
  expect(baseline.phases.geometry.counts.overlayMutations).toBeGreaterThan(0);
  await mkdir(info.outputPath(), { recursive: true });
  const path = info.outputPath('region-operation-counts-before-after.json');
  await writeFile(path, JSON.stringify({ evidence: 'Isolated native Chromium geometry; deterministic operation counts, not hardware timing or frame FPS.', fixture: { sidebarRows: 1000, unrelatedNodes: 4000, controlledFrameMs: 16 }, baseline, optimized }, null, 2));
  await info.attach('region-operation-counts-before-after', { path, contentType: 'application/json' });
  console.log('AU05 operation counts', JSON.stringify({ baseline: Object.fromEntries(Object.entries(baseline.phases).map(([k, v]) => [k, v.counts])), optimized: Object.fromEntries(Object.entries(optimized.phases).map(([k, v]) => [k, v.counts])) }));
});
