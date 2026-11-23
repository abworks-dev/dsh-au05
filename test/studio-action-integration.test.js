// Full action splice with synthetic browser/HTTP/Sender resources only: no sockets or hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createStudioRuntime } from '../packages/dsh-studio-hook/runtime.js';
import { runtimeDescriptors } from '../packages/dsh-studio-hook/rpc.js';
import { featureDescriptors, createInputService } from '../packages/dsh-studio-hook/feature-rpc.js';
import { StudioInputRuntime } from '../packages/dsh-studio-hook/input-runtime.js';
import { createStudioInputBridge, STUDIO_INPUT_UUID, STUDIO_INPUT_ORIGIN } from '../packages/dsh-studio-hook/input.js';

const productSource = readFileSync(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
const studioSource = readFileSync(new URL('../packages/dsh-studio-hook/client.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 64; i++) await Promise.resolve(); };
const wire = value => JSON.parse(JSON.stringify(value));
function store(value) {
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of listeners) fn(); } };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return;
  if (predicate(tree)) return tree;
  for (const child of tree.children?.flat(Infinity) ?? []) { const found = find(child, predicate); if (found) return found; }
}
function fixture() {
  let clock = 100000, timerId = 0, activeHooks, hookIndex, focused = true, settings;
  let bridge, handler, producerSequence = 0, submitted = 0, cancelled = 0;
  const timers = new Map(), intervals = new Map(), states = new Map(), effects = new Map();
  const applyCleanups = [], registrations = new Map(), browserListeners = new Map(), rpcCalls = [];
  const setTimeoutMock = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
  const hostTimers = { setInterval(fn) { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); } };
  const subscribeBrowser = (name, fn) => { if (!browserListeners.has(name)) browserListeners.set(name, new Set()); browserListeners.get(name).add(fn); };
  const removeBrowser = (name, fn) => browserListeners.get(name)?.delete(fn);
  const document = { visibilityState: 'visible', activeElement: {}, hasFocus: () => focused,
    addEventListener: (name, fn) => subscribeBrowser(name, fn), removeEventListener: removeBrowser };
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const index = hookIndex++, values = states.get(activeHooks); if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }]; },
    useRef(initial) { const index = hookIndex++, values = states.get(activeHooks); return values[index] ??= { current: initial }; },
    useEffect(callback, deps) { const key = `${activeHooks}:${hookIndex++}`, previous = effects.get(key);
      if (previous && deps?.length === previous.deps?.length && deps.every((value, i) => value === previous.deps[i])) return;
      previous?.cleanup?.(); effects.set(key, { deps, cleanup: callback() }); },
    useSyncExternalStore(subscribe, getSnapshot) { React.useEffect(() => subscribe(() => {}), []); return getSnapshot(); } };
  const session = { id: 'synthetic-session', seq: 100 }, owner = { session: { cancel() { cancelled++; } } };
  const binding = { key: session.id, props: { inputActions: { submit() { submitted++; } } } };
  const current = store(binding), statuses = store(new Map([[session.id, { running: false }]]));
  const list = store({ byId: { [session.id]: { id: session.id, retainedBy: { mainView: 1 } } } });
  const hostCallbacks = new Map();
  const hostContext = { sessions: { get: id => id === session.id ? session : null }, on(name, fn) {
    if (!hostCallbacks.has(name)) hostCallbacks.set(name, new Set()); hostCallbacks.get(name).add(fn);
    return () => hostCallbacks.get(name).delete(fn);
  } };
  let inputService;
  const runtime = createStudioRuntime({ ctx: hostContext, now: () => clock, timers: hostTimers,
    onClose: () => inputService?.dispose(), Sender() { return { enqueue() {}, stop() {}, snapshot: () => ({ accepted: 0, completed: 0, dropped: 0 }) }; } });
  class MockServer extends EventEmitter {
    listen(_port, host, ready) { assert.equal(host, '127.0.0.1'); queueMicrotask(ready); }
    address() { return { address: '127.0.0.1', port: 54321 }; }
    close(callback) { callback?.(); }
    closeAllConnections() {}
  }
  const nativeVoice = () => ({ cancel() {}, dispose() {}, open() { assert.fail('external voice resources must remain unused'); } });
  class InputRuntime extends StudioInputRuntime {
    constructor(options) { super({ ...options, now: () => clock, windowsVoiceBridge: nativeVoice(), shortcutVoiceBridge: nativeVoice(),
      Bridge(options) { bridge = createStudioInputBridge({ ...options, timers: hostTimers,
        createServer(fn) { handler = fn; return new MockServer(); } }); return bridge; } }); }
  }
  inputService = createInputService(runtime, { InputRuntime });
  const descriptors = [...runtimeDescriptors, ...featureDescriptors(runtimeDescriptors[0].result)];
  const dispatch = {
    start: (id, token) => runtime.start(id, token), poll: token => runtime.poll(token), stop: token => runtime.stop(token), status: () => runtime.status(),
    approval: (token, projection) => runtime.projectApproval(token, projection),
    inputConnect: (...args) => inputService.connect(...args), inputPoll: (...args) => inputService.poll(...args),
    inputDisconnect: (...args) => inputService.disconnect(...args), inputCandidates: (...args) => inputService.candidates(...args),
    inputConfigure: (...args) => inputService.configure(...args), inputPairing: (...args) => inputService.pairing(...args),
  };
  const ctx = { sessions: { list, binding: id => id === session.id ? owner : null },
    uiSession: { current, adapter: { current }, sessionStatus: statuses },
    uiWorkspace: { openSession() { assert.fail('navigation not part of this acceptance'); } },
    workspaces: { list: store({ items: [{ sessionIds: [session.id] }], archivedSessionIds: [] }) }, remote: {},
    effect(fn) { const cleanup = fn(); applyCleanups.push(cleanup); return cleanup; },
    slots: { inject(_name, fn) { return fn(); }, register(options, Component) { registrations.set(options.id, Component); if (options.id === 'au05-studio') settings = Component; return () => {}; } },
    connection: { rpc: { async call(path, method, envelope, signal) {
      assert.equal(path, '/api'); assert.ok(!signal?.aborted); rpcCalls.push(method);
      const descriptor = descriptors.find(value => `${value.namespace}/${value.method}` === method);
      assert.ok(descriptor, `undeclared RPC ${method}`);
      // Actual strict parameter/result codecs, with JSON realm separation just like transport.
      const args = wire(envelope.args);
      const parameters = descriptor.parameters.map(parameter => parameter.codec.create().parse(args[parameter.wire]));
      const value = await dispatch[descriptor.method](...parameters);
      return wire({ ok: true, value: descriptor.result.create().parse(value) });
    } } } };
  let product, studio;
  const window = { location: { protocol: 'dsh-app:' }, addEventListener: subscribeBrowser, removeEventListener: removeBrowser,
    dispatchEvent(event) { for (const fn of browserListeners.get(event.type) ?? []) fn(event); return !event.defaultPrevented; },
    __ModuleLoader__: { load(definition) {
      const value = definition.factory(name => name === 'react' ? React : name === '@abworks/dsh-plugin-au05' ? product : assert.fail(`unexpected import ${name}`));
      if (definition.id === '@abworks/dsh-plugin-au05') product = value; else studio = value;
    } } };
  const sandbox = { window, document, CustomEvent, location: window.location, crypto: { randomUUID, getRandomValues: values => { values.set(Buffer.from(randomUUID().replaceAll('-', ''), 'hex')); return values; } },
    localStorage: { getItem: () => null, setItem() {} }, AbortController, Uint8Array,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: setTimeoutMock, clearTimeout: id => timers.delete(id), ...hostTimers };
  vm.runInNewContext(productSource, sandbox); vm.runInNewContext(studioSource, sandbox); studio.apply(ctx);
  function render(Component, key) { activeHooks = key; hookIndex = 0; if (!states.has(key)) states.set(key, []); return Component(); }
  const settingsTree = () => render(settings, 'settings');
  const button = label => { const value = find(settingsTree(), node => node.type === 'button' && node.children[0] === label); assert.ok(value, label); return value.props.onClick(); };
  const sharedView = () => find(settingsTree(), node => typeof node.type === 'function').type;
  const renderActions = () => render(sharedView(), 'actions');
  const marker = name => { const value = find(renderActions(), node => node.props?.[name] === ''); assert.ok(value, name); return value; };
  const bindings = ['k2', 'k3'].map((control, i) => ({ control, actionid: `synthetic-${control}`, key: `0_${i + 1}` }));
  let pairing, lease;
  function post(route, body, token) {
    return new Promise(resolve => {
      const req = new EventEmitter(); Object.assign(req, { url: route, method: 'POST', socket: { remoteAddress: '127.0.0.1' },
        headers: { host: '127.0.0.1:54321', origin: STUDIO_INPUT_ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${token}` } });
      let status; handler(req, { writeHead(value) { status = value; }, end(value) { resolve({ status, value: JSON.parse(value) }); } });
      req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end');
    });
  }
  const api = {
    counts: () => ({ submitted, cancelled }), rpcCalls, runtime,
    async poll() { const candidates = [...timers].filter(([, value]) => [16, 50, 100, 200].includes(value.delay)); assert.ok(candidates.length > 0, 'one scheduled action poll'); const timer = candidates.sort((a, b) => a[1].delay - b[1].delay)[0]; timers.delete(timer[0]); timer[1].fn(); await flush(); },
    async start() {
      await button('开始跟随当前会话'); marker('data-au05-pill').props.onClick();
      await marker('data-au05-connect').props.onClick(); await flush();
      // Explicit pairing goes through the real manager + strict result codec; never a file.
      await button('读取按键配对配置');
      pairing = JSON.parse(find(settingsTree(), node => node.props?.['aria-label'] === '按键配对配置').props.value);
      const result = await post('/lease', { pluginUuid: STUDIO_INPUT_UUID, producerId: 'synthetic_producer_123456789' }, pairing.leaseToken);
      assert.equal(result.status, 200); lease = result.value.lease;
      for (const value of bindings) assert.equal((await post('/bindings', { pluginUuid: STUDIO_INPUT_UUID, producerId: lease.producerId,
        actionUuid: `${STUDIO_INPUT_UUID}.${value.control}`, ...value, active: true }, pairing.bindingToken)).status, 200);
    },
    async confirm() { await button('读取已发现绑定'); await button('确认这些按键绑定'); clock++; },
    async event(event) {
      const control = event.split('.')[0], binding = bindings.find(value => value.control === control);
      const result = await post('/events', { pluginUuid: STUDIO_INPUT_UUID, producerId: lease.producerId, owner: lease.owner,
        sessionNonce: lease.sessionNonce, generation: lease.generation, epoch: lease.epoch,
        sequence: ++producerSequence, timestamp: clock, event, actionid: binding.actionid, key: binding.key }, pairing.eventToken);
      return result.status;
    },
    running() { statuses.set(new Map([[session.id, { running: true }]])); },
    refocus() { focused = false; for (const fn of browserListeners.get('blur') ?? []) fn(); focused = true; for (const fn of browserListeners.get('focus') ?? []) fn(); },
    unmountSettings() {
      for (const [key, value] of effects) if (key.startsWith('settings:') || key.startsWith('actions:')) { value.cleanup?.(); effects.delete(key); }
      states.delete('settings'); states.delete('actions');
    },
    async dispose() { for (const cleanup of applyCleanups.reverse()) await cleanup?.(); await flush(); inputService.dispose(); runtime.dispose(); await bridge?.dispose(); },
  };
  return api;
}

test('confirmed Studio bindings reach K2 submit and K3 cancel through real manager, strict codecs and validated queue after Settings unmount', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.start(); await f.confirm();
  await f.poll(); // Confirmation clears context; only this poll authorizes future arrivals.
  assert.equal(await f.event('k2.down'), 200); assert.equal(await f.event('k2.up'), 200);
  await f.poll(); assert.deepEqual(f.counts(), { submitted: 1, cancelled: 0 });
  f.running(); await f.poll(); // Running status is a target/context transition.
  f.unmountSettings();
  assert.equal(f.runtime.status().state, 'running');
  assert.equal(await f.event('k3.down'), 200); assert.equal(await f.event('k3.up'), 200);
  await f.poll(); assert.deepEqual(f.counts(), { submitted: 1, cancelled: 1 });
  assert.equal(await f.event('k2.down'), 200); assert.equal(await f.event('k2.up'), 200);
  await f.poll(); assert.deepEqual(f.counts(), { submitted: 2, cancelled: 1 });
  for (const method of ['start', 'inputConnect', 'inputPairing', 'inputCandidates', 'inputConfigure', 'inputPoll'])
    assert.ok(f.rpcCalls.includes(`studioRuntime/${method}`), method);
  assert.ok(f.rpcCalls.every(method => method.startsWith('studioRuntime/')), 'no direct/native transport fallback');
});

test('Studio capture-only, post-confirmation null context and queued old context never become DSH actions', async t => {
  const f = fixture(); t.after(() => f.dispose()); await f.start();
  assert.equal(await f.event('k2.down'), 409); assert.equal(await f.event('k2.up'), 409);
  await f.poll(); assert.deepEqual(f.counts(), { submitted: 0, cancelled: 0 });
  await f.confirm();
  assert.equal(await f.event('k2.down'), 200); assert.equal(await f.event('k2.up'), 200);
  await f.poll(); assert.equal(f.counts().submitted, 0, 'next poll cannot authorize queued null-context input');
  assert.equal(await f.event('k2.down'), 200); assert.equal(await f.event('k2.up'), 200);
  f.refocus(); await f.poll(); assert.equal(f.counts().submitted, 0, 'focus transition revokes already queued context');
  assert.equal(await f.event('k2.down'), 200); assert.equal(await f.event('k2.up'), 200);
  await f.poll(); assert.deepEqual(f.counts(), { submitted: 1, cancelled: 0 }, 'fresh physical edges under new context execute once');
});
