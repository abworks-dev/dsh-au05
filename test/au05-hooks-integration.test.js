import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const find = (tree, marker) => {
  if (!Array.isArray(tree)) return;
  if (tree[1]?.[marker] === '') return tree;
  for (const child of tree.slice(2)) { const found = find(child, marker); if (found) return found; }
};
const store = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
function fixture({ open = false } = {}) {
  let loaded, cleanup, pendingPoll;
  const registrations = new Map(), calls = [], timers = new Map(), subscriptions = [], overlayStates = [];
  let timer = 0;
  const React = {
    createElement: (...args) => args,
    useSyncExternalStore(subscribe, getSnapshot) { subscriptions.push({ subscribe, getSnapshot }); return getSnapshot(); },
    useState(value) { const state = typeof value === 'function' ? value() : value === false ? open : value; overlayStates.push(state); return [state, () => {}]; },
    useRef: () => ({ current: null }), useEffect() {},
  };
  const status = { state: 'ready', connected: true, generation: 1, sequence: 0, lightState: 'idle', lightResult: 'written' };
  const document = { visibilityState: 'visible', activeElement: {}, hasFocus: () => true, addEventListener() {}, removeEventListener() {} };
  const window = { __ModuleLoader__: { load(value) { loaded = value; } }, addEventListener() {}, removeEventListener() {} };
  const owner = {}, current = store({ key: 'first', props: { inputActions: {} } });
  const ctx = {
    slots: { inject(name, callback) { callback(); }, register(options, Component) { registrations.set(options.name, { options, Component }); } },
    effect(callback) { cleanup = callback(); },
    uiSession: { adapter: { current }, sessionStatus: store(new Map([['first', { running: true }]])) },
    sessions: { binding: () => owner, list: store({ byId: { first: { id: 'first', retainedBy: { mainView: 1 } } } }) },
    workspaces: { list: store({ items: [] }) }, uiWorkspace: {}, remote: {},
    connection: { rpc: { async call(path, method, envelope, signal) {
      calls.push({ method, args: envelope.args });
      if (method === 'au05/poll') return new Promise((resolve, reject) => {
        pendingPoll = resolve; signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { ok: true, value: method === 'au05/disconnect' ? { ...status, state: 'disconnected', connected: false } : status };
    } } },
  };
  vm.runInNewContext(source, { window, document, AbortController, Uint8Array, location: { protocol: 'https:' },
    crypto: { getRandomValues(value) { value.fill(1); return value; } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout(fn) { const id = ++timer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
  loaded.factory(() => React).apply(ctx);
  return { calls, registrations, subscriptions, overlayStates, cleanup,
    overlay: () => registrations.get('shell.overlay').Component(),
    async nextPoll() {
      pendingPoll({ ok: true, value: { ...status, lightState: 'running', lightResult: 'verified', events: [] } });
      await flush();
      const [id, fn] = [...timers].at(-1); timers.delete(id); fn(); await flush();
    } };
}

test('AU05 contributes only its original overlay and action bridges, never a Hooks device card', async () => {
  const f = fixture();
  assert.equal(f.registrations.has('abworks.hooks.device'), false);
  assert.deepEqual([...f.registrations.keys()].sort(), ['conversation.input.dock', 'conversation.input.left', 'shell.overlay']);
  const registration = f.registrations.get('shell.overlay');
  assert.equal(registration.options.id, 'au05-device');
  assert.equal(registration.options.order, 90);
  assert.ok(find(f.overlay(), 'data-au05-plugin'));
  assert.equal(find(f.overlay(), 'data-au05-connect'), undefined, 'closed overlay remains compact');
  await flush();
  assert.equal(f.calls.length, 0, 'loading and rendering must not connect, poll or write HID');
  await f.cleanup();
});

test('original expanded AU05 panel stays inert until explicit connection and retains session lights', async () => {
  const f = fixture({ open: true });
  const panel = f.overlay();
  assert.ok(find(panel, 'data-au05-connect'));
  await flush();
  assert.equal(f.calls.length, 0, 'expanding the original device panel must not open HID');
  await find(panel, 'data-au05-connect')[1].onClick(); await flush();
  assert.equal(f.calls.filter(call => call.method === 'au05/connect').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'au05/poll')[0].args.options.light, 'running', 'official sessionStatus still drives arbitration');
  assert.equal(f.registrations.has('abworks.hooks.device'), false);
  await f.cleanup();
  assert.equal(f.calls.filter(call => call.method === 'au05/disconnect').length, 1, 'plugin cleanup retains original disconnect behavior');
});
