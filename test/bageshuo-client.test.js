// Synthetic integration tests of the real browser controller. No GUI, hardware or capture is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
const flush = async () => { for (let index = 0; index < 48; index++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));
function find(tree, marker) {
  if (!Array.isArray(tree)) return;
  if (tree[1]?.[marker] === '') return tree;
  for (const child of tree.slice(2)) { const result = find(child, marker); if (result) return result; }
}
function store(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of listeners) fn(); } };
}
function harness({ studio = false, protocol = 'dsh-app:', deferShortcut = false,
  shortcutResult = { activated: true, error: null }, shortcutReject = false, savedPreferences = null } = {}) {
  const saved = new Map(savedPreferences ? [['abworks.au05.voice-preferences.v1', JSON.stringify(savedPreferences)]] : []);
  let loaded, dispose, random = 0, serial = 0, sequence = 0, focused = true, hook = 0, clock = 100000, monotonic = 0;
  const calls = [], polls = [], shortcuts = [], timers = new Map(), effects = new Map(), hooks = [], registrations = new Map(), events = new Map();
  let activeHooks = hooks, mediaCalls = 0, submitted = 0, cancelled = 0;
  const on = (type, fn) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); };
  const document = { visibilityState: 'visible', activeElement: {}, hasFocus: () => focused,
    addEventListener: on, removeEventListener: (type, fn) => events.get(type)?.delete(fn) };
  const window = { __ModuleLoader__: { load(value) { loaded = value; } }, addEventListener: on,
    removeEventListener: (type, fn) => events.get(type)?.delete(fn),
    dispatchEvent(event) { for (const fn of events.get(event.type) ?? []) fn(event); return !event.defaultPrevented; } };
  const React = { createElement: (...args) => args,
    useState(initial) { const index = hook++, values = activeHooks;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }]; },
    useRef(initial) { return activeHooks[hook++] ??= { current: initial }; },
    useEffect(callback, deps) { const index = hook++, previous = effects.get(index);
      if (previous && deps?.length === previous.deps?.length && deps.every((value, i) => value === previous.deps[i])) return;
      previous?.cleanup?.(); effects.set(index, { deps, cleanup: callback() }); } };
  const inputActions = { submit() { submitted++; } }, owner = { session: { cancel() { cancelled++; } } };
  const binding = { key: 'main', props: { inputActions } }, current = store(binding);
  const list = store({ byId: { main: { id: 'main', retainedBy: { mainView: 1 } } } });
  const sessionStatus = store(new Map([['main', { running: false }]]));
  const native = extra => ({ state: 'ready', connected: true, generation: 1, sequence, lightState: 'idle', lightResult: 'written', error: null, ...extra });
  const request = async (method, args, signal) => {
    calls.push({ method, args, signal, transport: studio ? 'studio' : 'native' });
    if (method === 'connect') return native();
    if (method === 'disconnect') return native({ state: 'disconnected', connected: false });
    if (method === 'poll') return new Promise((resolve, reject) => {
      const pending = { args, resolve }; polls.push(pending);
      signal.addEventListener('abort', () => { const index = polls.indexOf(pending); if (index >= 0) polls.splice(index, 1); reject(new Error('aborted')); }, { once: true });
    });
    if (method === 'shortcutVoice') {
      if (shortcutReject) throw new Error('synthetic shortcut RPC failure');
      return deferShortcut ? new Promise(resolve => shortcuts.push(resolve)) : shortcutResult;
    }
    throw new Error(`unexpected request: ${method}`);
  };
  const ctx = { slots: { inject(name, callback) { callback(); }, register(options, component) { registrations.set(options.name, component); } },
    effect(callback) { dispose = callback(); }, uiSession: { adapter: { current }, sessionStatus }, sessions: { list, binding: () => owner },
    workspaces: { list: store({ items: [{ sessionIds: ['main'] }], archivedSessionIds: [] }) }, uiWorkspace: { openSession() {} },
    connection: { rpc: { async call(path, method, envelope, signal) { assert.equal(studio, false, 'Studio must not invoke native RPC');
      return { ok: true, value: await request(method.slice('au05/'.length), envelope.args, signal) }; } } } };
  const sandbox = { window, document, React, CustomEvent, location: { protocol }, Uint8Array, AbortController,
    navigator: { mediaDevices: { async getUserMedia() { mediaCalls++; throw new Error('capture forbidden'); } } },
    localStorage: { getItem: key => saved.get(key) ?? null, setItem(key, value) { saved.set(key, value); } }, crypto: { getRandomValues(value) { value.fill(++random); return value; } },
    Date: class extends Date { static now() { return clock; } }, performance: { now: () => monotonic },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  let directController;
  sandbox.captureTestController = controller => { directController = controller; return controller; };
  vm.runInNewContext(source.replace('const controller = createController(ctx), Device = productView(controller);',
    'const controller = captureTestController(createController(ctx)), Device = productView(controller);'), sandbox);
  const plugin = loaded.factory(name => { assert.equal(name, 'react'); return React; });
  const actions = studio ? plugin.createStudioActions(ctx, { rpc: request }) : null;
  if (!studio) plugin.apply(ctx);
  const View = studio ? actions.View : registrations.get('shell.overlay');
  const render = () => { hook = 0; activeHooks = hooks; return View(); };
  const node = marker => find(render(), marker);
  render(); node('data-au05-pill')[1].onClick(); render();
  // Isolate voice scheduling from the regions knob's independent 16ms cadence.
  (actions?.controller ?? directController).setKnobMode('scroll');
  // Mount the real public input-slot bridge without sharing its React hook indexes.
  const bridgeHooks = [], bridgeEffects = effects.size;
  activeHooks = bridgeHooks; hook = 1000;
  const bridge = registrations.get('conversation.input.left')({ sessionId: 'main' });
  const input = { isConnected: true, getClientRects: () => [{}], closest: selector => selector === '[data-composer-card]' ? card : null };
  const card = { isConnected: true, querySelectorAll: () => [input] };
  bridge[1].ref.current = { isConnected: true, closest: () => card };
  document.activeElement = input;
  for (const fn of events.get('focusin') ?? []) fn();
  assert.ok(effects.size > bridgeEffects);
  const api = { calls, timers, node, render, current, list, binding, sessionStatus, document,
    crossApp(value) { node('data-au05-bageshuo-cross-app')[1].onChange({ target: { checked: value } }); },
    preferences: () => JSON.parse(saved.get('abworks.au05.voice-preferences.v1')),
    snapshot: () => { render(); return hooks[0]; }, mediaCalls: () => mediaCalls,
    submitted: () => submitted, cancelled: () => cancelled,
    // Presets now share the grouped voice selector instead of a separate preset control.
    mode(value) { node('data-au05-voice-mode')[1].onChange({ target: { value: value === 'shortcut' ? `shortcut:${hooks[0].shortcutPreset}` : value } }); },
    preset(value) { node('data-au05-voice-mode')[1].onChange({ target: { value: `shortcut:${value}` } }); },
    async voice(value = true) { await node('data-au05-voice')[1].onChange({ target: { checked: value } }); await flush(); },
    lamp(value) { return (actions?.controller ?? directController).setExperimentalK1Lamp(value); },
    lights(value) { node('data-au05-lights')[1].onChange({ target: { checked: value } }); },
    focus(value) { focused = value; for (const fn of events.get(value ? 'focus' : 'blur') ?? []) fn(); },
    composer(value) { document.activeElement = value ? input : {}; for (const fn of events.get('focusin') ?? []) fn(); },
    async connect() { await node('data-au05-connect')[1].onClick(); await flush(); },
    async disconnect() { await node('data-au05-disconnect')[1].onClick(); await flush(); },
    options: () => polls[0]?.args.options,
    async poll(eventsToSend = [], bageshuo = undefined, extra = {}) {
      const pending = polls.shift(); assert.ok(pending, 'one pending poll expected');
      const events = eventsToSend.map(event => ({ generation: 1, sequence: ++sequence, context: pending.args.options.context, at: clock,
        ...(typeof event === 'string' ? { event } : event) }));
      pending.resolve(native({ events, overflow: false, ...(bageshuo === undefined ? {} : { bageshuo }), ...extra })); await flush();
    },
    async tick(immediate = false) {
      const entry = [...timers].find(([, value]) => value.delay === 0)
        ?? (!immediate && [...timers].find(([, value]) => value.delay === 50 || value.delay === 100 || value.delay === 200));
      assert.ok(entry, 'serialized successor poll expected'); timers.delete(entry[0]); entry[1].fn(); await flush();
    },
    async shortcut(value = shortcutResult) { const resolve = shortcuts.shift(); assert.ok(resolve); resolve(value); await flush(); },
    advance(ms) { clock += ms; monotonic += ms; },
    adjustWallClock(ms) { clock += ms; },
    pollDelay: () => [...timers.values()].find(value => [0, 50, 100, 200].includes(value.delay))?.delay,
    pendingPollCount: () => polls.length,
    taps: () => calls.filter(call => call.method === 'shortcutVoice'),
    async dispose() { for (const effect of effects.values()) effect.cleanup?.(); await dispose(); await flush(); },
  };
  return api;
}
const state = (state, error = null) => ({ state, error });
async function bugu(t, options = {}, observe = true) {
  const ui = harness(options); t.after(() => ui.dispose()); ui.mode('shortcut'); ui.preset('bugu'); await ui.voice(); await ui.connect();
  if (!options.studio) {
    assert.equal(ui.snapshot().experimentalK1Lamp, true);
    assert.equal(ui.node('data-au05-experimental-k1-lamp'), undefined);
    if (!observe) ui.lamp(false);
    await ui.poll(); await ui.tick();
  }
  return ui;
}
async function next(ui, events = [], observed = state('idle')) { await ui.tick(); await ui.poll(events, observed); }

test('Direct Bageshuo single down is one full tap; up/longhold inert, actual snapshots alone drive K1 and no auto-submit', async t => {
  const ui = await bugu(t);
  assert.equal(ui.options().bageshuoState, true);
  const context = ui.options().context;
  assert.deepEqual(plain(ui.options().channels), [0, 0, 0, 0]);
  await ui.poll(['k1.down', 'k1.down'], state('idle'));
  assert.equal(ui.taps().length, 1); assert.equal(ui.taps()[0].args.options.shortcut, 'RightAlt');
  assert.equal(ui.snapshot().voice.phase, 'requested'); assert.equal(ui.snapshot().bageshuo.state, 'idle');
  await ui.tick(); assert.equal(ui.options().channels[0], 0, 'request success is not recording');
  await ui.poll(['k1.down'], state('recording'));
  await ui.tick(true);
  assert.equal(ui.options().context, context, 'observer update must not recreate input context');
  assert.equal(ui.options().light, 'recording', 'native recovery must know actual capture is active');
  assert.equal(ui.options().channels[0], 2);
  await ui.poll(['k1.down', 'k1.up'], state('recording')); assert.equal(ui.taps().length, 1, 'observer update must not clear held keys');
  await next(ui, ['k1.down', 'k1.up'], state('recording')); assert.equal(ui.taps().length, 2, 'second fresh down sends one stop tap');
  await next(ui, [], state('idle')); await ui.tick(true); assert.equal(ui.options().channels[0], 0);
  assert.equal(ui.submitted(), 0); assert.equal(ui.cancelled(), 0); assert.equal(ui.mediaCalls(), 0);
});

test('manual target stop, no physical K1 click, updates K1 immediately and leaves all task lamps intact', async t => {
  const ui = await bugu(t);
  ui.sessionStatus.set(new Map([['main', { running: true }]]));
  await ui.poll([], state('recording')); await ui.tick(true);
  assert.deepEqual(plain(ui.options().channels), [2, 0, 2, 1]);
  await ui.poll([], state('idle')); await ui.tick(true);
  assert.deepEqual(plain(ui.options().channels), [0, 0, 2, 1]); assert.equal(ui.options().light, 'running');
  assert.equal(ui.taps().length, 0); assert.equal(ui.submitted(), 0); assert.equal(ui.cancelled(), 0);
});

test('startup, unknown, errors, missing/malformed snapshots never advertise recording or send taps/retries', async t => {
  for (const observed of [state('starting'), state('unknown'), state('unknown', 'capture_unknown'), state('unknown', 'observer_recovering'),
    state('error', 'observer_start_timeout'), state('error', 'observer_timeout'), state('error', 'app_not_running'), state('error', 'target_exited'), undefined, state('recording', 'capture_unknown'),
    { state: 'recording', error: 'private C:/secret.exe' }, { state: 'constructor', error: null }]) {
    const ui = await bugu(t);
    await ui.poll(['k1.down', 'k1.up'], observed); await ui.tick();
    assert.equal(ui.options().channels[0], 0); assert.notEqual(ui.options().light, 'recording');
    assert.equal(ui.taps().length, 0); assert.equal(ui.mediaCalls(), 0);
    assert.doesNotMatch(JSON.stringify(ui.render()), /private|secret\.exe|"state":"constructor"/);
  }
});

test('pending RPC and unconfirmed capture transition suppress extra taps; observer changes never retry', async t => {
  const ui = await bugu(t, { deferShortcut: true });
  await ui.poll(['k1.down', 'k1.up', 'k1.down', 'k1.up'], state('idle'));
  assert.equal(ui.taps().length, 1); assert.equal(ui.snapshot().voice.phase, 'requesting');
  await next(ui, ['k1.down', 'k1.up'], state('idle')); assert.equal(ui.taps().length, 1);
  await ui.shortcut(); await next(ui, ['k1.down', 'k1.up'], state('idle'));
  assert.equal(ui.taps().length, 1); assert.match(JSON.stringify(ui.node('data-au05-message')), /不会重复发送/);
  await next(ui, [], state('recording')); assert.equal(ui.taps().length, 1);
  await next(ui, ['k1.down', 'k1.up'], state('recording')); assert.equal(ui.taps().length, 2);
  await ui.shortcut({ activated: false, error: 'shortcut_voice_timeout' });
  await next(ui, ['k1.down', 'k1.up'], state('recording')); assert.equal(ui.taps().length, 2, 'ambiguous failure must not cause a second toggle');
});

test('observer errors stay armed without auto-rebind; fast explicit off/on sends false before true and rejects stale recording', async t => {
  const ui = await bugu(t);
  await ui.poll([], state('error', 'app_not_running')); await ui.tick();
  assert.equal(ui.options().bageshuoState, true);
  assert.match(JSON.stringify(ui.node('data-au05-bageshuo-status')), /未运行.*断开并重新连接/);
  ui.lamp(false); ui.lamp(true);
  await ui.poll([], state('recording')); assert.notEqual(ui.snapshot().bageshuo.state, 'recording'); await ui.tick(true);
  assert.equal(ui.options().bageshuoState, false); assert.equal(ui.options().channels[0], 0);
  await ui.poll([], state('recording')); await ui.tick(true);
  assert.equal(ui.options().bageshuoState, true); assert.equal(ui.options().channels[0], 0);
  await ui.poll([], state('recording')); await ui.tick(true); assert.equal(ui.options().channels[0], 2);
});

test('observation ignores blur, but K1/actions stay focus-gated and explain floating-window manual stop', async t => {
  const ui = await bugu(t); await ui.poll([], state('recording')); await ui.tick(true);
  ui.focus(false); await ui.poll(['k1.down', 'k1.up'], state('recording')); await ui.tick();
  assert.equal(ui.options().bageshuoState, true); assert.equal(ui.options().channels[0], 0); assert.equal(ui.options().context, null);
  assert.equal(ui.taps().length, 0); assert.match(ui.snapshot().message, /浮窗抢焦点.*手动停止/);
  assert.match(JSON.stringify(ui.node('data-au05-bageshuo-stop-help')), /焦点离开输入框.*手动停止/);
  ui.focus(true); ui.composer(false); await ui.poll(['k1.down', 'k1.up'], state('recording'));
  assert.equal(ui.taps().length, 0); assert.match(ui.snapshot().message, /不能安全停止/);
  assert.match(JSON.stringify(ui.node('data-au05-bageshuo-stop-help')), /焦点离开输入框.*手动停止/);
});

test('native editable/foreground rejection retains manual-stop warning and never sends a cleanup tap', async t => {
  for (const error of ['shortcut_voice_foreground_mismatch', 'shortcut_voice_focus_not_editable']) {
    const ui = await bugu(t, { shortcutResult: { activated: false, error } });
    await ui.poll(['k1.down', 'k1.up'], state('recording'));
    assert.equal(ui.taps().length, 1); assert.match(ui.snapshot().message, /浮窗抢焦点.*手动停止/);
    assert.match(JSON.stringify(ui.node('data-au05-bageshuo-stop-help')), /焦点离开输入框.*手动停止/);
    await next(ui, [], state('idle')); assert.equal(ui.taps().length, 1);
  }
});

test('lamp/voice/preset/mode opt-outs revoke observation and stale replies cannot restore K1', async t => {
  for (const change of ['lamp', 'voice', 'preset', 'mode']) {
    const ui = await bugu(t); await ui.poll([], state('recording')); await ui.tick(true);
    if (change === 'lamp') ui.lamp(false);
    if (change === 'voice') await ui.voice(false);
    if (change === 'preset') ui.preset('typeless');
    if (change === 'mode') ui.mode('custom');
    await ui.poll([], state('recording')); await ui.tick();
    assert.equal(ui.options().bageshuoState, false, change); assert.equal(ui.options().channels[0], 0, change);
    assert.equal(ui.snapshot().bageshuo.state, 'stopped', change); assert.equal(ui.taps().length, 0);
  }
});

test('global light switch clears K1 only and observer defaults on after reconnect', async t => {
  const ui = await bugu(t); await ui.poll([], state('recording')); await ui.tick(true);
  ui.lights(false); await ui.poll([], state('recording')); await ui.tick(true);
  assert.deepEqual(plain(ui.options().channels), [0, 0, 0, 0]); assert.equal(ui.options().bageshuoState, true);
  await ui.disconnect(); assert.equal(ui.snapshot().bageshuo.state, 'stopped');
  await ui.connect(); assert.equal(ui.options().bageshuoState, true); assert.equal(ui.snapshot().experimentalK1Lamp, true);
});

test('observer is opt-in only for Direct preset Bageshuo; Typeless/custom/Windows/browser/Studio cannot arm it', async t => {
  for (const mode of ['shortcut', 'custom', 'windows']) {
    const ui = harness(); t.after(() => ui.dispose()); ui.mode(mode); await ui.voice(); await ui.connect(); ui.lamp(true);
    await ui.poll([], state('recording')); await ui.tick(); assert.equal(ui.options().bageshuoState, false);
    assert.equal(ui.options().channels[0], 0); assert.equal(ui.mediaCalls(), 0);
  }
  const off = await bugu(t, {}, false); assert.equal(off.options().bageshuoState, false);
  await off.poll(['k1.down', 'k1.up'], state('recording')); assert.equal(off.taps().length, 1); assert.equal(off.snapshot().bageshuo.state, 'stopped');
  const browser = await bugu(t, { protocol: 'https:' }); assert.equal(browser.options().bageshuoState, false);
  await browser.poll(['k1.down', 'k1.up'], state('recording')); assert.equal(browser.taps().length, 0);
  const studio = await bugu(t, { studio: true }); assert.equal(Object.hasOwn(studio.options(), 'bageshuoState'), false);
  await studio.poll(['k1.down', 'k1.up'], state('recording')); await studio.tick();
  assert.equal(studio.options().channels[0], 0); assert.equal(studio.snapshot().bageshuo.state, 'stopped');
  assert.equal(studio.calls.every(call => call.transport === 'studio'), true); assert.equal(studio.mediaCalls(), 0);
});

test('terminal transport state drops stale actual-capture claims and never reconnects or retries', async t => {
  const ui = await bugu(t); await ui.poll([], state('recording')); await ui.tick(true);
  await ui.poll([], state('recording'), { state: 'disconnected', connected: false });
  assert.equal(ui.snapshot().bageshuo.state, 'stopped'); assert.equal(ui.snapshot().connected, false);
  assert.equal(ui.taps().length, 0); assert.equal(ui.calls.filter(call => call.method === 'connect').length, 1);
  assert.doesNotMatch(JSON.stringify(ui.node('data-au05-connection')), /正在实际采集/);
});

test('DSH builtin mode never requests native Bageshuo state or microphone without voice consent', async t => {
  const ui = harness(); t.after(() => ui.dispose()); await ui.connect(); ui.lamp(true);
  await ui.poll([], state('recording')); await ui.tick();
  assert.equal(ui.options().bageshuoState, false); assert.equal(ui.options().channels[0], 0); assert.equal(ui.mediaCalls(), 0);
});

test('Bageshuo actual stop never changes K2 submit, K3 cancel or approval semantics', async t => {
  const ui = await bugu(t); await ui.poll([], state('recording'));
  await next(ui, [], state('idle')); assert.equal(ui.submitted(), 0); assert.equal(ui.cancelled(), 0);
  ui.sessionStatus.set(new Map([['main', { running: true }]]));
  await next(ui, ['k2.down', 'k2.down', 'k2.up', 'k3.down', 'k3.down', 'k3.up'], state('idle'));
  assert.equal(ui.submitted(), 1); assert.equal(ui.cancelled(), 1);
  const answers = []; ui.sessionStatus.set(new Map([['main', { running: true, pendingInteraction: {
    kind: 'approval', key: 'approval', sessionId: 'main', answerable: true, answer: answer => answers.push(answer),
  } }]]));
  await next(ui, ['k3.down', 'k3.up', 'k2.down', 'k2.up'], state('idle'));
  assert.deepEqual(answers, ['rejected']); assert.equal(ui.submitted(), 1); assert.equal(ui.cancelled(), 1);
});

test('Bageshuo switch briefly polls at 50ms, but only actual capture wakes K1 on or off', async t => {
  const ui = await bugu(t);
  await ui.poll(['k1.down', 'k1.up'], state('idle'));
  assert.equal(ui.pollDelay(), 0, 'first successor is woken without another RPC in flight');
  assert.equal(ui.pendingPollCount(), 0); assert.equal(ui.taps().length, 1);
  await ui.tick(true); assert.equal(ui.pendingPollCount(), 1); assert.equal(ui.options().channels[0], 0);
  await ui.poll([], state('idle')); assert.equal(ui.pollDelay(), 50);
  await ui.tick(); await ui.poll([], state('idle'));
  assert.equal(ui.pollDelay(), 50); assert.equal(ui.taps().length, 1);
  await ui.tick(); await ui.poll([], state('recording'));
  assert.equal(ui.pollDelay(), 0, 'trusted transition still wakes lamp update immediately');
  await ui.tick(true); assert.equal(ui.options().channels[0], 2);
  await ui.poll([], state('recording')); assert.equal(ui.pollDelay(), 100, 'stable composer uses HID delivery cadence, not transition acceleration');
  await ui.tick(); await ui.poll(['k1.down', 'k1.up'], state('recording'));
  await ui.tick(true); assert.equal(ui.options().channels[0], 2, 'stop request alone cannot pretend capture ended');
  await ui.poll([], state('recording')); assert.equal(ui.pollDelay(), 50);
  await ui.tick(); await ui.poll([], state('idle')); await ui.tick(true);
  assert.equal(ui.options().channels[0], 0); assert.equal(ui.taps().length, 2); assert.equal(ui.mediaCalls(), 0);
});

test('ready Bageshuo composer delivers HID at 100ms without accelerating native capture or starting shortcuts', async t => {
  const ui = await bugu(t);
  await ui.poll([], state('idle')); assert.equal(ui.pollDelay(), 100);
  ui.composer(false); await next(ui); assert.equal(ui.pollDelay(), 200);
  ui.composer(true); await next(ui); assert.equal(ui.pollDelay(), 100);
  ui.focus(false); await next(ui); assert.equal(ui.pollDelay(), 200);
  ui.focus(true); await next(ui); assert.equal(ui.pollDelay(), 100);
  ui.lights(false); await next(ui); assert.equal(ui.pollDelay(), 200);
  assert.equal(ui.taps().length, 0); assert.equal(ui.mediaCalls(), 0);
});

test('Bageshuo fast polling expires without retrying an unconfirmed shortcut', async t => {
  const ui = await bugu(t); await ui.poll(['k1.down', 'k1.up'], state('idle'));
  await ui.tick(true); await ui.poll([], state('idle')); assert.equal(ui.pollDelay(), 50);
  ui.adjustWallClock(-60000); // Wall-clock rollback cannot extend the monotonic fast window.
  ui.advance(2000); await ui.tick(); await ui.poll([], state('idle'));
  assert.equal(ui.pollDelay(), 200, 'hard deadline, even if no state transition arrives');
  await ui.tick(); await ui.poll(['k1.down', 'k1.up'], state('idle'));
  assert.equal(ui.taps().length, 1, 'expiry never authorizes a retry or clears transition guard');
  assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'transition_unconfirmed');
  await ui.tick(); assert.equal(ui.options().channels[0], 0); assert.equal(ui.mediaCalls(), 0);
});

test('Bageshuo fast polling ends on blur, revocation, feedback, context or untrusted observation', async t => {
  for (const change of ['blur', 'optout', 'unknown', 'observer-error', 'feedback', 'context']) {
    const ui = await bugu(t); await ui.poll(['k1.down', 'k1.up'], state('idle'));
    await ui.tick(true); await ui.poll([], state('idle')); assert.equal(ui.pollDelay(), 50);
    if (change === 'blur') ui.focus(false);
    if (change === 'optout') ui.lamp(false);
    if (change === 'feedback') ui.lights(false);
    if (change === 'context') ui.current.set({ ...ui.binding });
    await ui.tick(); await ui.poll([], change === 'unknown' ? state('unknown', 'capture_unknown')
      : change === 'observer-error' ? state('error', 'target_exited') : state('idle'));
    if (ui.pollDelay() === 0) { await ui.tick(true); await ui.poll([], state('idle')); }
    if (change === 'feedback') ui.lights(true);
    if (change === 'observer-error' || change === 'unknown') { await ui.tick(); await ui.poll([], state('idle')); }
    assert.equal(ui.pollDelay(), 200, change); assert.equal(ui.taps().length, 1); assert.equal(ui.mediaCalls(), 0);
  }
});

test('Bageshuo Host shortcut rejection or RPC failure cancels acceleration without retrying', async t => {
  for (const options of [{ shortcutResult: { activated: false, error: 'shortcut_voice_timeout' } }, { shortcutReject: true }]) {
    const ui = await bugu(t, options); await ui.poll(['k1.down', 'k1.up'], state('idle'));
    await ui.tick(true); await ui.poll([], state('idle'));
    assert.equal(ui.pollDelay(), 200); assert.equal(ui.taps().length, 1);
    await ui.tick(); assert.equal(ui.options().channels[0], 0); assert.equal(ui.mediaCalls(), 0);
  }
});

test('shortcut stage diagnostics retain closed Host errors after focus clears transient voice error', async t => {
  for (const error of ['shortcut_voice_foreground_mismatch', 'shortcut_voice_focus_not_editable', 'shortcut_voice_invalid_gesture',
    'shortcut_voice_native_failed', 'shortcut_voice_unsupported_client', 'shortcut_voice_timeout', 'private C:/secret.exe']) {
    const ui = await bugu(t, { shortcutResult: { activated: false, error } });
    await ui.poll(['k1.down', 'k1.up'], state('idle'));
    const code = error.startsWith('shortcut_voice_') ? error : 'shortcut_voice_failed';
    const retained = plain(ui.snapshot().shortcutTrace);
    assert.deepEqual(retained.map(item => [item.stage, item.code]), [
      ['input', 'k1_down'], ['host_requested', 'sent_to_host'], ['host_result', code]]);
    for (const item of retained) assert.deepEqual(Object.keys(item).sort(), ['at', 'code', 'stage']);
    ui.focus(false); ui.focus(true);
    assert.equal(ui.snapshot().voice.error, null, 'existing transient-error reset remains unchanged');
    assert.deepEqual(plain(ui.snapshot().shortcutTrace), retained);
    assert.doesNotMatch(JSON.stringify(ui.node('data-au05-shortcut-diagnostics')), /private|secret/);
    assert.equal(ui.taps().length, 1); assert.equal(ui.mediaCalls(), 0);
  }
});

test('shortcut diagnostics distinguish Client blocks and bound repeated hardware metadata without new actions', async t => {
  const ui = await bugu(t);
  await ui.poll([], state('idle')); ui.composer(false); await ui.tick();
  await ui.poll(['k1.down', 'k1.up'], state('idle'));
  assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'composer_not_focused');
  assert.equal(ui.taps().length, 0);
  await next(ui, ['k1.down', 'k1.up'], state('error', 'target_exited'));
  assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'composer_not_focused');
  ui.composer(true); await next(ui, ['k1.down', 'k1.up'], state('error', 'target_exited'));
  assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'capture_not_ready');
  ui.focus(false);
  for (let i = 0; i < 12; i++) await next(ui, ['k1.down', 'k1.up'], state('idle'));
  assert.equal(ui.snapshot().shortcutTrace.length, 16);
  assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'window_not_focused');
  assert.equal(ui.taps().length, 0); assert.equal(ui.mediaCalls(), 0);
  await ui.disconnect(); await ui.connect();
  assert.deepEqual(plain(ui.snapshot().shortcutTrace), [], 'a new connection clears the old ring');
});

test('shortcut diagnostics record Host result even if context changed, without accepting stale success', async t => {
  const ui = await bugu(t, { deferShortcut: true });
  await ui.poll(['k1.down', 'k1.up'], state('idle'));
  ui.focus(false); await ui.shortcut();
  assert.deepEqual(plain(ui.snapshot().shortcutTrace).map(item => [item.stage, item.code]), [
    ['input', 'k1_down'], ['host_requested', 'sent_to_host'], ['host_result', 'activated'], ['discarded', 'context_changed']]);
  assert.notEqual(ui.snapshot().voice.phase, 'requested');
  assert.equal(ui.taps().length, 1); assert.equal(ui.mediaCalls(), 0);
});

test('proven pre-go cancellation releases only its own transition, without a retry or fake capture', async t => {
  for (const baseline of ['idle', 'recording']) {
    const ui = await bugu(t, { deferShortcut: true });
    await ui.poll(['k1.down', 'k1.up'], state(baseline));
    ui.sessionStatus.set(new Map([['main', { running: true }]]));
    await ui.shortcut({ activated: false, error: 'shortcut_voice_cancelled', notSent: true });
    assert.equal(ui.taps().length, 1, 'acknowledgement never sends another shortcut');
    await next(ui, ['k1.down', 'k1.up'], state(baseline));
    assert.equal(ui.taps().length, 2, 'a new physical down is allowed after proven non-delivery');
    assert.equal(ui.snapshot().bageshuo.state, baseline);
    assert.equal(ui.mediaCalls(), 0);
  }
});

test('poll acknowledgement recovers a lost RPC after context cancellation, matching exact gesture', async t => {
  const ui = await bugu(t, { shortcutReject: true });
  await ui.poll(['k1.down', 'k1.up'], state('idle'));
  const gesture = plain(ui.taps()[0].args.gesture);
  ui.sessionStatus.set(new Map([['main', { running: true }]]));
  for (const outcome of [undefined, { generation: 2, sequence: gesture.sequence, notSent: true },
    { generation: 1, sequence: gesture.sequence + 1, notSent: true },
    { generation: 1, sequence: gesture.sequence, notSent: false }]) {
    await ui.tick(); await ui.poll(['k1.down', 'k1.up'], state('idle'), { shortcutOutcome: outcome });
    assert.equal(ui.taps().length, 1, 'missing, stale or ambiguous evidence cannot unlock');
  }
  await ui.tick(); await ui.poll([], state('idle'), { shortcutOutcome: { generation: 1, sequence: gesture.sequence, notSent: true } });
  assert.equal(ui.taps().length, 1);
  await next(ui, ['k1.down', 'k1.up']); assert.equal(ui.taps().length, 2);
  await ui.tick(); await ui.poll(['k1.down', 'k1.up'], state('idle'), { shortcutOutcome: { generation: 1, sequence: gesture.sequence, notSent: true } });
  assert.equal(ui.taps().length, 2, 'old acknowledgement cannot release a newer transition');
  assert.equal(ui.mediaCalls(), 0);
});

test('cross-app opt-in keeps only fresh K1 independent of focus/session and actual lamp truthful', async t => {
  const ui = await bugu(t);
  assert.equal(ui.options().bageshuoCrossAppEnabled, false);
  ui.crossApp(true); assert.equal(ui.preferences().bageshuoCrossAppEnabled, true);
  await ui.poll([], state('idle')); await ui.tick();
  const token = ui.options().bageshuoCrossAppContext;
  assert.ok(token); assert.notEqual(token, ui.options().context);
  ui.focus(false); ui.current.set(null); ui.list.set({ byId: {} });
  await ui.poll([], state('idle')); await ui.tick();
  assert.equal(ui.options().context, null); assert.equal(ui.options().bageshuoCrossAppContext, token);
  const event = event => ({ event, context: token });
  await ui.poll([event('k1.down'), event('k1.down'), event('k2.down'), event('k3.down'), event('right.pulse')], state('idle'));
  assert.equal(ui.taps().length, 1); assert.equal(ui.taps()[0].args.gesture.context, token);
  await next(ui, [event('k1.down')], state('recording')); await ui.tick(true);
  assert.equal(ui.options().channels[0], 2); assert.equal(ui.taps().length, 1);
  ui.focus(true); await ui.poll([event('k1.down'), event('k1.up')], state('recording'));
  assert.equal(ui.taps().length, 1, 'held through focus never replays');
  await next(ui, [event('k1.down'), event('k1.up')], state('recording'));
  assert.equal(ui.taps().length, 2);
  assert.equal(ui.submitted(), 0); assert.equal(ui.cancelled(), 0); assert.equal(ui.mediaCalls(), 0);
  ui.crossApp(false); await ui.tick(); await ui.poll([event('k1.down'), event('k1.up')], state('idle')); await ui.tick();
  assert.equal(ui.options().bageshuoCrossAppContext, null); assert.equal(ui.taps().length, 2);
});

test('cross-app requests survive session focus changes but revoke on opt-out; lights never gate dictation', async t => {
  const ui = await bugu(t, { deferShortcut: true }); ui.crossApp(true);
  await ui.poll([], state('idle')); await ui.tick();
  const token = ui.options().bageshuoCrossAppContext;
  ui.lights(false); ui.lamp(false);
  await ui.poll([], state('idle')); await ui.tick();
  assert.equal(ui.options().bageshuoState, true);
  assert.equal(ui.options().bageshuoCrossAppEnabled, true);
  await ui.poll([{ event: 'k1.down', context: token }, { event: 'k1.up', context: token }], state('idle'));
  const request = ui.taps()[0]; assert.ok(request);
  ui.focus(false); ui.current.set(null); ui.list.set({ byId: {} });
  assert.equal(request.signal.aborted, false);
  await ui.shortcut(); assert.equal(ui.snapshot().voice.phase, 'requested');
  ui.crossApp(false); ui.crossApp(true); await ui.tick();
  assert.notEqual(ui.options().bageshuoCrossAppContext, token);
  await ui.poll([{ event: 'k1.down', context: token }, { event: 'k1.up', context: token }], state('recording'));
  assert.equal(ui.taps().length, 1, 'revoked token cannot trigger a new toggle');
});

test('cross-app control is Direct local Bageshuo only and preference remains optional v3', async t => {
  const ui = await bugu(t); const legacy = ui.preferences(); delete legacy.bageshuoCrossAppEnabled;
  const restored = harness({ savedPreferences: legacy }); t.after(() => restored.dispose());
  assert.equal(restored.snapshot().bageshuoCrossAppEnabled, false);
  ui.crossApp(true);
  assert.match(JSON.stringify(ui.node('data-au05-bageshuo-stop-help')), /DSH 运行.*不会自动发送/);
  ui.preset('typeless'); assert.equal(ui.node('data-au05-bageshuo-cross-app'), undefined);
  for (const options of [{ studio: true }, { protocol: 'https:' }]) {
    const other = harness(options); t.after(() => other.dispose()); other.mode('shortcut'); other.preset('bugu');
    assert.equal(other.node('data-au05-bageshuo-cross-app'), undefined);
  }
});

test('recovering observation revokes only K1 and resumes actual capture without a tap or reconnect', async t => {
  for (const restored of ['idle', 'recording']) {
    const ui = await bugu(t);
    ui.sessionStatus.set(new Map([['main', { running: true }]]));
    await ui.poll([], state('recording')); await ui.tick(true);
    assert.deepEqual(plain(ui.options().channels), [2, 0, 2, 1]);
    await ui.poll(['k1.down', 'k1.up'], state('unknown', 'observer_recovering')); await ui.tick(true);
    assert.deepEqual(plain(ui.snapshot().bageshuo), state('unknown', 'observer_recovering'));
    assert.match(JSON.stringify(ui.node('data-au05-bageshuo-status')), /正在恢复观察/);
    assert.deepEqual(plain(ui.options().channels), [0, 0, 2, 1]);
    assert.equal(ui.options().bageshuoState, true, 'recovery retains the same armed observation');
    assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'capture_not_ready');
    assert.equal(ui.taps().length, 0);
    await ui.poll([], state(restored)); await ui.tick();
    assert.deepEqual(plain(ui.options().channels), [restored === 'recording' ? 2 : 0, 0, 2, 1]);
    assert.equal(ui.snapshot().bageshuo.state, restored);
    assert.doesNotMatch(ui.snapshot().message, /正在恢复观察/, 'completed observation recovery must not leave an active recovery error');
    assert.equal(ui.taps().length, 0, 'observer recovery never requests a shortcut');
    assert.equal(ui.calls.filter(call => call.method === 'connect').length, 1);
    assert.equal(ui.calls.filter(call => call.method === 'disconnect').length, 0);
    await ui.poll(['k1.down', 'k1.up'], state(restored));
    assert.equal(ui.taps().length, 1, 'only a new physical down may request a shortcut');
    assert.equal(ui.submitted(), 0); assert.equal(ui.cancelled(), 0); assert.equal(ui.mediaCalls(), 0);
  }
});

test('K1 blocked during recovery remains held across resumed capture in scoped and cross-app modes', async t => {
  for (const crossApp of [false, true]) {
    const ui = await bugu(t);
    if (crossApp) ui.crossApp(true);
    await ui.poll([], state('idle')); await ui.tick();
    const token = ui.options().bageshuoCrossAppContext;
    const event = event => crossApp ? { event, context: token } : event;
    await ui.poll([event('k1.down')], state('unknown', 'observer_recovering'));
    assert.equal(ui.taps().length, 0);
    assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'capture_not_ready');
    await next(ui, [event('k1.down')], state('recording'));
    assert.equal(ui.taps().length, 0, 'fresh capture does not replay the blocked held down');
    await next(ui, [event('k1.down'), event('k1.up')], state('recording'));
    assert.equal(ui.taps().length, 0, 'the release edge remains inert');
    await next(ui, [event('k1.down'), event('k1.up')], state('recording'));
    assert.equal(ui.taps().length, 1, 'release followed by a new down is a new gesture');
    assert.equal(ui.mediaCalls(), 0);
  }
});

test('recovery to the original state preserves ambiguous tap locks until opposite capture or exact not-sent evidence', async t => {
  for (const baseline of ['idle', 'recording']) {
    for (const resolution of ['opposite', 'not-sent']) {
      const ui = await bugu(t, { shortcutReject: true });
      await ui.poll(['k1.down', 'k1.up'], state(baseline));
      const gesture = plain(ui.taps()[0].args.gesture);
      await next(ui, ['k1.down', 'k1.up'], state('unknown', 'observer_recovering'));
      assert.equal(ui.taps().length, 1);
      ui.advance(10000);
      await next(ui, ['k1.down', 'k1.up'], state(baseline));
      assert.equal(ui.taps().length, 1, 'elapsed recovery and same capture state cannot unlock an ambiguous tap');
      assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'transition_unconfirmed');
      const restored = resolution === 'opposite' ? baseline === 'idle' ? 'recording' : 'idle' : baseline;
      const extra = resolution === 'not-sent'
        ? { shortcutOutcome: { generation: gesture.generation, sequence: gesture.sequence, notSent: true } } : {};
      await ui.tick(); await ui.poll([], state(restored), extra);
      assert.equal(ui.taps().length, 1, 'proof clears only the lock; it never replays a shortcut');
      await next(ui, ['k1.down', 'k1.up'], state(restored));
      assert.equal(ui.taps().length, 2, 'a new physical down is allowed after the original guard is satisfied');
      assert.equal(ui.mediaCalls(), 0);
    }
  }
});

test('a fresh unknown capture sample between recovery and trusted capture cannot leave the old recovery message', async t => {
  const ui = await bugu(t);
  await ui.poll(['k1.down', 'k1.up'], state('unknown', 'observer_recovering'));
  assert.match(ui.snapshot().message, /正在恢复观察/);
  await next(ui, [], state('unknown', 'capture_unknown'));
  assert.deepEqual(plain(ui.snapshot().bageshuo), state('unknown', 'capture_unknown'));
  await next(ui, [], state('idle'));
  assert.doesNotMatch(ui.snapshot().message, /正在恢复观察/);
  assert.equal(ui.taps().length, 0); assert.equal(ui.mediaCalls(), 0);
});

test('withdrawing an obsolete recovery message preserves capture warnings and unrelated errors', async t => {
  for (const kind of ['capture-warning', 'unrelated-error']) {
    const ui = await bugu(t);
    await ui.poll(kind === 'capture-warning' ? ['k1.down', 'k1.up'] : [], state('idle'));
    await next(ui, [], state('recording'));
    if (kind === 'unrelated-error') ui.composer(false);
    await next(ui, ['k1.down', 'k1.up'], state('unknown', 'observer_recovering'));
    const message = ui.snapshot().message;
    if (kind === 'capture-warning') {
      assert.match(message, /正在恢复观察/); assert.match(message, /断开不会保证停止/);
    } else {
      assert.doesNotMatch(message, /正在恢复观察/); assert.match(message, /手动停止/);
    }
    await next(ui, [], state('recording'));
    assert.doesNotMatch(ui.snapshot().message, /正在恢复观察/);
    if (kind === 'capture-warning') assert.match(ui.snapshot().message, /断开不会保证停止/);
    else assert.equal(ui.snapshot().message, message, 'a different error must not be cleared by observer recovery');
    assert.equal(ui.taps().length, kind === 'capture-warning' ? 1 : 0);
    assert.equal(ui.mediaCalls(), 0);
  }
});

test('startup and running timeout statuses remain distinct from recoverable interruption', async t => {
  const ui = await bugu(t);
  await ui.poll([], state('error', 'observer_start_timeout'));
  assert.equal(ui.snapshot().bageshuo.error, 'observer_start_timeout');
  assert.match(JSON.stringify(ui.node('data-au05-bageshuo-status')), /启动超时/);
  await next(ui, [], state('error', 'observer_timeout'));
  assert.equal(ui.snapshot().bageshuo.error, 'observer_timeout');
  assert.match(JSON.stringify(ui.node('data-au05-bageshuo-status')), /状态观察超时/);
  assert.doesNotMatch(JSON.stringify(ui.node('data-au05-bageshuo-status')), /启动/);
  assert.equal(ui.taps().length, 0); assert.equal(ui.mediaCalls(), 0);
});

test('ambiguous cancellation and timeout still require actual state change, never a timed retry', async t => {
  for (const error of ['shortcut_voice_cancelled', 'shortcut_voice_timeout']) {
    const ui = await bugu(t, { shortcutResult: { activated: false, error } });
    await ui.poll(['k1.down', 'k1.up'], state('idle'));
    ui.advance(10000); await next(ui, ['k1.down', 'k1.up']);
    assert.equal(ui.taps().length, 1); assert.equal(ui.snapshot().shortcutTrace.at(-1).code, 'transition_unconfirmed');
    assert.equal(ui.snapshot().bageshuo.state, 'idle'); assert.equal(ui.mediaCalls(), 0);
  }
});
