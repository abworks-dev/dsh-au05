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
      get now() { return now; },
      deliver(timestamp, delivery) { now = delivery; const batch = [...pending]; for (const [id, cb] of batch) if (pending.delete(id)) cb(timestamp); },
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
  controlledFrames: [true, { option: true }],
  regionMotion: ['no-preference', { option: true }],
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


test.use({ screenshot: 'off', trace: 'off' });

test('stale callback delivery cancels before writing despite a timely RAF timestamp', async ({ regions: page }, info) => {
  await selectRegion(page, 'conversation');
  const result = await page.evaluate(() => {
    const qa = window.__regions, f = window.__regionFrames, el = document.getElementById('conversation');
    const results = [];
    for (const delay of [0, 150]) {
      qa.nav.clear(); qa.nav.cycle(qa.target, qa.ports); qa.nav.cycle(qa.target, qa.ports);
      el.scrollTo({top:120, behavior:'instant'}); f.resetWrites(); qa.nav.startDiagnostics();
      const epoch = f.now, requests = f.requests;
      const handled = Array.from({length:5}, () => qa.nav.rotate(qa.target, 1, qa.ports));
      const state = label => ({label, now:f.now-epoch, top:el.scrollTop, writes:f.writes.length, requests:f.requests-requests, pending:f.pending.length});
      const initial = state('initial');
      f.deliver(epoch+16, epoch+16); const first = state('first');
      const held = f.pending;
      f.deliver(epoch+32, epoch+32+delay); const delayed = state('delivered');
      f.deliver(epoch+48+delay, epoch+48+delay); const next = state('next');
      qa.nav.clear(); const cleared = state('cleared'); f.replay(held); const replayed = state('replayed');
      results.push({delay, handled, initial, first, delayed, next, cleared, replayed, diagnostics:qa.nav.getDiagnostics()});
      qa.nav.stopDiagnostics();
    }
    return results;
  });
  console.log('AU05 scheduling baseline', JSON.stringify(result));
  await info.attach('dual-clock-evidence', {body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
  for (const r of result) {
    expect(r.handled).toEqual(Array(5).fill(true));
    expect(r.initial).toMatchObject({top:120,writes:0,requests:1,pending:1});
    expect(r.first.top).toBeGreaterThan(120);
    expect(r.first.top).toBeLessThan(520);
    expect(r.replayed.top).toBe(r.cleared.top);
    expect(r.replayed.writes).toBe(r.cleared.writes);
    expect(r.replayed.pending).toBe(0);
  }
  // Pre-fix isolated baseline: delivery182/RAF32 wrote324 from240, then RAF198 cancelled.
  // Five detents target520; the new policy must refuse that stale84px write immediately.
  expect(result[0].first.top).toBe(240);
  expect(result[0].delayed.top).toBe(324);
  expect(result[0].next.top).toBe(382);
  expect(result[1].delayed.top).toBe(result[1].first.top);
  expect(result[1].delayed.writes).toBe(1);
  expect(result[1].delayed.pending).toBe(0);
  expect(result[1].next.top).toBe(result[1].delayed.top);
  expect(result[1].next.pending).toBe(0);
  expect(result[1].diagnostics.entries.some(r=>r.type==='frame' && r.dtMs===16 && r.callbackLagMs===150)).toBe(true);
});

test('80ms delivery jitter limits easing integration to32ms and still settles the complete target', async ({ regions: page }, info) => {
  await selectRegion(page, 'conversation');
  const result = await page.evaluate(() => {
    const qa=window.__regions,f=window.__regionFrames,el=document.getElementById('conversation');
    el.scrollTo({top:120,behavior:'instant'}); f.resetWrites(); qa.nav.startDiagnostics();
    const epoch=f.now, startRequests=f.requests;
    for(let i=0;i<5;i++) qa.nav.rotate(qa.target,1,qa.ports);
    f.deliver(epoch+16,epoch+16); const first=el.scrollTop;
    f.deliver(epoch+96,epoch+96); const jitter={top:el.scrollTop,writes:f.writes.length,pending:f.pending.length};
    const samples=[];
    for(let i=1;i<=24;i++){ f.deliver(epoch+96+i*16,epoch+96+i*16); samples.push(el.scrollTop); }
    return {first,jitter,samples,requests:f.requests-startRequests,maxPending:f.maxPending,pending:f.pending.length,diagnostics:qa.nav.getDiagnostics()};
  });
  // Old80ms integration jumped240->473. With32ms cap ideal382.338 rounds382.
  expect(result.first).toBe(240);
  expect(result.jitter).toEqual({top:382,writes:2,pending:1});
  expect(result.samples.at(-1)).toBe(520);
  for(let i=1;i<result.samples.length;i++) expect(result.samples[i]).toBeGreaterThanOrEqual(result.samples[i-1]);
  expect(result.pending).toBe(0); expect(result.maxPending).toBe(1);
  console.log('AU05 bounded jitter',JSON.stringify(result));
  await info.attach('bounded-jitter-evidence',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
});

test('first stale delivery and revoked callbacks cannot write or revive a newer selection', async ({ regions: page }, info) => {
  await selectRegion(page,'conversation');
  const result=await page.evaluate(()=>{
    const qa=window.__regions,f=window.__regionFrames,el=document.getElementById('conversation');
    const rows=[];
    for(const kind of ['first-stale','callback-lag','frame-gap','clear','owner','focus','replacement']){
      qa.nav.clear();qa.target={...qa.baseTarget};qa.ports.conversation.port=el;
      qa.nav.cycle(qa.target,qa.ports);qa.nav.cycle(qa.target,qa.ports);
      el.scrollTo({top:120,behavior:'instant'});f.resetWrites();qa.nav.startDiagnostics();
      const epoch=f.now;qa.nav.rotate(qa.target,1,qa.ports);const held=f.pending;
      if(kind==='clear')qa.nav.clear();
      if(kind==='owner')qa.target={...qa.target,sessionOwner:'changed'};
      if(kind==='focus')qa.target={...qa.target,focused:false};
      let replacement;
      if(kind==='replacement'){replacement=el.cloneNode(true);el.replaceWith(replacement);qa.ports.conversation.port=replacement;replacement.scrollTo({top:120,behavior:'instant'});f.resetWrites();}
      const before={top:el.scrollTop,replacement:replacement?.scrollTop,writes:f.writes.length};
      if(kind==='callback-lag')f.deliver(epoch-20,epoch+90);
      else f.deliver(epoch+(kind==='frame-gap'?101:16),epoch+(kind==='first-stale'?216:kind==='frame-gap'?101:16));
      const after={top:el.scrollTop,replacement:replacement?.scrollTop,writes:f.writes.length,pending:f.pending.length};
      const diagnostics=qa.nav.getDiagnostics();qa.nav.stopDiagnostics();qa.nav.clear();
      if(replacement)replacement.replaceWith(el);
      qa.target={...qa.baseTarget};qa.ports.conversation.port=el;qa.nav.cycle(qa.target,qa.ports);qa.nav.cycle(qa.target,qa.ports);
      const fresh=el.scrollTop,writes=f.writes.length;f.replay(held);
      rows.push({kind,before,after,diagnostics,fresh,replayed:el.scrollTop,writes,replayedWrites:f.writes.length,pending:f.pending.length,active:qa.nav.activeId});
    }
    return rows;
  });
  for(const r of result){
    expect(r.after.top,r.kind).toBe(r.before.top);
    expect(r.after.replacement,r.kind).toBe(r.before.replacement);
    expect(r.after.writes,r.kind).toBe(r.before.writes);
    expect(r.after.pending,r.kind).toBe(0);
    expect(r.replayed,r.kind).toBe(r.fresh);
    expect(r.replayedWrites,r.kind).toBe(r.writes);
    expect(r.pending,r.kind).toBe(0);expect(r.active,r.kind).toBe('conversation');
  }
  console.log('AU05 stale guards',JSON.stringify(result));
  await info.attach('stale-guard-evidence',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
});

test('fractionally earlier first RAF timestamp rebases without mistaking delivery clock for regression', async ({ regions: page }, info) => {
  await selectRegion(page,'conversation');
  const result=await page.evaluate(()=>{
    const qa=window.__regions,f=window.__regionFrames,el=document.getElementById('conversation');
    el.scrollTo({top:120,behavior:'instant'});f.resetWrites();qa.nav.startDiagnostics();
    const epoch=f.now;qa.nav.rotate(qa.target,1,qa.ports);
    f.deliver(epoch-0.25,epoch+1);
    const rebased={top:el.scrollTop,writes:f.writes.length,pending:f.pending.length};
    const samples=[];
    for(let i=1;i<=20;i++){f.deliver(epoch-0.25+i*16,epoch+1+i*16);samples.push(el.scrollTop);}
    return {rebased,samples,pending:f.pending.length,diagnostics:qa.nav.getDiagnostics()};
  });
  expect(result.rebased).toEqual({top:120,writes:0,pending:1});
  expect(result.samples[0]).toBeGreaterThan(120);
  expect(result.samples[0]).toBeLessThan(200);
  expect(result.samples.at(-1)).toBe(200);expect(result.pending).toBe(0);
  expect(result.diagnostics.entries.some(r=>r.reason==='first_timestamp_rebase'&&r.dtMs===-0.25)).toBe(true);
  expect(result.diagnostics.entries.some(r=>r.type==='stop'&&r.reason==='clock_backwards')).toBe(false);
  console.log('AU05 fractional timestamp',JSON.stringify(result));
  await info.attach('fractional-timestamp-evidence',{body:Buffer.from(JSON.stringify(result,null,2)),contentType:'application/json'});
});

test.describe('native isolated scheduling diagnostics',()=>{
  test.use({controlledFrames:false});
  test('native PerformanceObserver captures only bounded numeric long-task timing and stops cleanly',async({regions:page},info)=>{
    const supported=await page.evaluate(()=>PerformanceObserver.supportedEntryTypes.filter(t=>['longtask','long-animation-frame'].includes(t)));
    test.skip(!supported.length,'Pinned Chromium exposes neither longtask nor long-animation-frame PerformanceObserver entries.');
    await selectRegion(page,'conversation');
    expect(await page.evaluate(()=>window.__regions.nav.startDiagnostics())).toBe(true);
    const busy=()=>page.evaluate(()=>new Promise(resolve=>setTimeout(()=>{
      const start=performance.now();while(performance.now()-start<75){}resolve({durationMs:performance.now()-start});
    },0)));
    const injected=await busy();
    await expect.poll(()=>page.evaluate(()=>window.__regions.nav.getDiagnostics().entries.filter(r=>r.type==='longtask'||r.type==='longframe').length),{timeout:3000}).toBeGreaterThan(0);
    const recording=await page.evaluate(()=>window.__regions.nav.getDiagnostics());
    expect(recording.state).toBe('recording');expect(recording.entries.length).toBeLessThanOrEqual(240);
    const tasks=recording.entries.filter(r=>r.type==='longtask'||r.type==='longframe');
    if(supported.includes('longtask'))expect(tasks.some(r=>r.type==='longtask'&&r.durationMs>=50)).toBe(true);
    for(const row of tasks){
      expect(Object.keys(row).sort()).toEqual((row.type==='longframe'?['type','region','tMs','startMs','durationMs','blockingMs']:['type','region','tMs','startMs','durationMs']).sort());
      expect(row.region).toBe('conversation');
      for(const key of ['tMs','startMs','durationMs',...(row.type==='longframe'?['blockingMs']:[])]){
        expect(typeof row[key]).toBe('number');expect(Number.isFinite(row[key])).toBe(true);expect(row[key]).toBeGreaterThanOrEqual(0);
      }
      expect(row.startMs).toBeLessThan(5000);expect(row.tMs).toBeLessThan(5000);
    }
    const stopped=await page.evaluate(()=>{window.__regions.nav.stopDiagnostics();return window.__regions.nav.getDiagnostics();});
    await busy();
    await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),100)));
    expect(await page.evaluate(()=>window.__regions.nav.getDiagnostics())).toEqual(stopped);
    const reset=await page.evaluate(()=>{window.__regions.nav.startDiagnostics();return window.__regions.nav.getDiagnostics();});
    expect(reset.state).toBe('recording');expect(reset.entries).toEqual([]);expect(reset.dropped).toBe(0);
    await page.evaluate(()=>window.__regions.nav.stopDiagnostics());
    const final=await page.evaluate(()=>window.__regions.nav.getDiagnostics());
    expect(final.state).toBe('stopped');expect(final.entries).toEqual([]);
    // This deliberate fixture task verifies observer delivery, not attribution of real-user stalls.
    const evidence={supported,injected,recording,stopped,reset,final};
    console.log('AU05 native observer',JSON.stringify(evidence));
    await info.attach('native-observer-numeric-evidence',{body:Buffer.from(JSON.stringify(evidence,null,2)),contentType:'application/json'});
  });
});
