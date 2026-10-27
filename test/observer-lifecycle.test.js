import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Offline lifecycle regression tests: the plugin source runs only in a VM with
// synthetic React hooks, mocked fetch/readers, and synthetic session status.
// No browser, HTTP server, collector, device, or live DSH configuration is used.
const source = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const frame = (sequence = 1) => new TextEncoder().encode(`event: input\ndata: ${JSON.stringify({
  type: 'input', event: 'k1.down', sequence, counts: { 'k1.down': sequence },
  hardware: true, finished: false, readOnly: true, writes: 0,
})}\n\n`);

function transport({ ignoreAbort = false } = {}) {
  const queue = [], waiting = [];
  let ended = false, cancels = 0, releases = 0;
  const deliver = value => waiting.length ? waiting.shift().resolve(value) : queue.push(value);
  const reader = {
    read() {
      if (queue.length) return Promise.resolve(queue.shift());
      if (ended) return Promise.resolve({ done: true });
      const next = deferred(); waiting.push(next); return next.promise;
    },
    async cancel() { cancels++; ended = true; while (waiting.length) waiting.shift().resolve({ done: true }); },
    releaseLock() { releases++; },
  };
  return {
    response: { ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader: () => reader } },
    push(sequence) { deliver({ done: false, value: frame(sequence) }); },
    close() { ended = true; while (waiting.length) waiting.shift().resolve({ done: true }); },
    fail() { ended = true; while (waiting.length) waiting.shift().reject(new Error('synthetic_stream_failure')); },
    attach(signal) {
      if (ignoreAbort) return; // Adversarial reader may resolve once more after abort.
      signal.addEventListener('abort', () => {
        ended = true;
        while (waiting.length) waiting.shift().reject(new Error('synthetic_abort'));
      }, { once: true });
    },
    get cancels() { return cancels; }, get releases() { return releases; },
  };
}

function fixture(fetchImpl) {
  let registration, Preview, current;
  const effects = [], calls = [];
  const React = {
    createElement: (...args) => args,
    useState(initial) {
      const owner = current, index = owner.stateIndex++;
      if (!(index in owner.states)) owner.states[index] = typeof initial === 'function' ? initial() : initial;
      return [owner.states[index], value => {
        owner.states[index] = typeof value === 'function' ? value(owner.states[index]) : value;
      }];
    },
    useRef(initial) {
      const owner = current, index = owner.refIndex++;
      return owner.refs[index] ??= { current: initial };
    },
    useEffect(effect, deps) {
      const owner = current, index = owner.effectIndex++, previous = owner.effects[index];
      const changed = !previous || deps === undefined || previous.deps === undefined
        || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]));
      if (changed) owner.pending.push(() => {
        previous?.cleanup?.();
        owner.effects[index] = { deps, cleanup: effect() };
      });
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      // The fixture explicitly renders after stimuli; subscribe/unsubscribe still
      // has actual mount/dependency/unmount ownership and a stable hook index.
      React.useEffect(() => subscribe(() => {}), [subscribe]);
      return getSnapshot();
    },
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { registration = value; } } },
    fetch(...args) { calls.push(args); return fetchImpl(...args); },
    AbortController, TextDecoder, Set, Error, JSON,
  });
  const plugin = registration.factory(name => { assert.equal(name, 'react'); return React; });
  plugin.apply({
    slots: { inject(_name, callback) { callback(); }, register(_options, component) { Preview = component; } },
    effect(effect) { const cleanup = effect(); if (typeof cleanup === 'function') effects.push(cleanup); return cleanup; },
  });
  return {
    calls,
    mount() {
      const owner = { states: [], refs: [], effects: [], pending: [], stateIndex: 0, refIndex: 0, effectIndex: 0 };
      return {
        render(session = { running: false }) {
          current = owner; owner.stateIndex = owner.refIndex = owner.effectIndex = 0;
          const preview = Preview({ sessionId: 'synthetic-A', useSessionStatus: () => session });
          const observer = preview.slice(2).find(child => typeof child?.[0] === 'function')[0];
          if (owner.observer) assert.equal(observer, owner.observer, 'ordinary rendering keeps the observer component type stable');
          owner.observer = observer;
          const tree = observer(); current = undefined;
          for (const effect of owner.pending.splice(0)) effect();
          return tree;
        },
        unmount() { for (const effect of owner.effects) effect?.cleanup?.(); owner.effects = []; },
      };
    },
    dispose() { for (const cleanup of effects.splice(0).reverse()) cleanup(); },
  };
}
const child = (tree, predicate) => tree.slice(2).find(predicate);
const button = (ui, label) => child(ui.render(), value => value?.[0] === 'button' && value[2] === label)[1].onClick();
const text = (ui, attribute) => child(ui.render(), value => value?.[1]?.[attribute] === '')[2];
const status = ui => text(ui, 'data-au05-connection');
const sample = ui => text(ui, 'data-au05-input');
function enterToken(ui, token = 'a'.repeat(64)) {
  child(ui.render(), value => value?.[0] === 'input')[1].onChange({ target: { value: token } });
}
function expectReadonly(calls) {
  for (const [url, options] of calls) {
    assert.equal(url, 'http://127.0.0.1:17376/v1/events');
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.match(options.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
  }
}

test('one explicit observer connection and last sample survive ordinary rendering and view remount', { timeout: 5000 }, async t => {
  const stream = transport();
  const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
  t.after(() => plugin.dispose());
  let ui = plugin.mount();
  assert.match(status(ui), /disconnected/); assert.equal(plugin.calls.length, 0);
  enterToken(ui); const connecting = button(ui, 'Connect observer'); await flush();
  stream.push(1); await flush();
  for (const session of [{ running: true }, { pendingInteraction: { kind: 'approval' } }, { pendingInteraction: { kind: 'question' } }]) {
    ui.render(session); assert.match(status(ui), /receiving \(read-only\)/); assert.match(sample(ui), /sequence 1/);
  }
  const signal = plugin.calls[0][1].signal;
  ui.unmount();
  assert.equal(signal.aborted, false, 'a slot view unmount is not explicit disconnect or plugin unload');
  stream.push(2); await flush(); // Store progresses while there are no mounted views.
  ui = plugin.mount();
  assert.match(status(ui), /receiving \(read-only\)/); assert.match(sample(ui), /sequence 2/);
  assert.equal(child(ui.render(), value => value?.[0] === 'input')[1].value, '', 'token never survives as view state');
  assert.equal(plugin.calls.length, 1, 'remount never reconnects or needs to retain a token');
  stream.push(3); await flush(); assert.match(sample(ui), /sequence 3/);
  plugin.dispose(); await connecting;
  assert.equal(signal.aborted, true, 'actual ctx.effect plugin disposal owns transport abort');
  assert.equal(stream.cancels, 1); assert.equal(stream.releases, 1); expectReadonly(plugin.calls);
});

test('explicit Disconnect aborts once and clears shared evidence across subsequent view remount', { timeout: 5000 }, async t => {
  const stream = transport();
  const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
  t.after(() => plugin.dispose());
  const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, 'Connect observer'); await flush();
  stream.push(3); await flush(); assert.match(sample(ui), /sequence 3/);
  button(ui, 'Disconnect observer'); await connecting;
  assert.equal(plugin.calls[0][1].signal.aborted, true);
  assert.match(status(ui), /disconnected/); assert.equal(sample(ui), 'No input observed');
  ui.unmount(); const remount = plugin.mount();
  assert.match(status(remount), /disconnected/); assert.equal(sample(remount), 'No input observed');
  assert.equal(plugin.calls.length, 1); assert.equal(stream.cancels, 1); expectReadonly(plugin.calls);
});

test('empty or invalid token on an already connected view does not falsify live connection state', { timeout: 5000 }, async t => {
  const stream = transport();
  const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
  t.after(() => plugin.dispose());
  const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, 'Connect observer'); await flush();
  stream.push(4); await flush();
  await button(ui, 'Connect observer');
  assert.match(status(ui), /receiving \(read-only\)/); assert.match(sample(ui), /sequence 4/);
  enterToken(ui, 'not-a-token'); await button(ui, 'Connect observer');
  assert.match(status(ui), /receiving \(read-only\)/); assert.match(sample(ui), /sequence 4/);
  assert.equal(plugin.calls.length, 1); assert.equal(plugin.calls[0][1].signal.aborted, false);
  plugin.dispose(); await connecting; expectReadonly(plugin.calls);
});

test('late superseded fetch cannot overwrite the replacement observer snapshot or status', { timeout: 5000 }, async t => {
  const first = deferred(), stale = transport(), fresh = transport();
  let attempts = 0;
  const plugin = fixture((_url, options) => {
    attempts++;
    if (attempts === 1) return first.promise; // Deliberately ignores abort until it resolves.
    fresh.attach(options.signal); return Promise.resolve(fresh.response);
  });
  t.after(() => plugin.dispose());
  const ui = plugin.mount(); enterToken(ui); const oldConnect = button(ui, 'Connect observer');
  enterToken(ui, 'b'.repeat(64)); const newConnect = button(ui, 'Connect observer'); await flush();
  assert.equal(plugin.calls[0][1].signal.aborted, true);
  fresh.push(8); await flush(); assert.match(sample(ui), /sequence 8/);
  stale.push(999); first.resolve(stale.response); await oldConnect; await flush();
  assert.match(status(ui), /receiving \(read-only\)/); assert.match(sample(ui), /sequence 8/);
  assert.doesNotMatch(sample(ui), /999/);
  plugin.dispose(); await newConnect; expectReadonly(plugin.calls);
});

test('an in-flight obsolete reader cannot publish a final frame after replacement', { timeout: 5000 }, async t => {
  const stale = transport({ ignoreAbort: true }), fresh = transport();
  let attempts = 0;
  const plugin = fixture(async (_url, options) => {
    const stream = attempts++ === 0 ? stale : fresh;
    stream.attach(options.signal); return stream.response;
  });
  t.after(() => { plugin.dispose(); stale.close(); fresh.close(); });
  const ui = plugin.mount(); enterToken(ui); const oldConnect = button(ui, 'Connect observer'); await flush();
  stale.push(1); await flush();
  enterToken(ui, 'b'.repeat(64)); const newConnect = button(ui, 'Connect observer'); await flush();
  fresh.push(5); await flush(); assert.match(sample(ui), /sequence 5/);
  stale.push(999); await oldConnect;
  assert.match(status(ui), /receiving \(read-only\)/); assert.match(sample(ui), /sequence 5/);
  assert.doesNotMatch(sample(ui), /999/); assert.equal(stale.cancels, 1);
  plugin.dispose(); await newConnect; expectReadonly(plugin.calls);
});

test('plugin disposal during pending fetch prevents any late reader acquisition or state publication', { timeout: 5000 }, async t => {
  const pending = deferred(); let readers = 0;
  const plugin = fixture(() => pending.promise);
  t.after(() => plugin.dispose());
  const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, 'Connect observer');
  assert.match(status(ui), /connecting/);
  plugin.dispose(); assert.equal(plugin.calls[0][1].signal.aborted, true);
  pending.resolve({ ok: true, headers: { get: () => 'text/event-stream' },
    body: { getReader() { readers++; throw new Error('disposed_reader_acquisition'); } } });
  await connecting;
  assert.equal(readers, 0, 'a stale fetch result is rejected before body acquisition');
  assert.match(status(ui), /connecting/, 'disposed store does not publish late unavailable/closed state');
  assert.equal(sample(ui), 'No input observed'); expectReadonly(plugin.calls);
});

for (const mode of ['close', 'fail']) {
  test(`stream ${mode} preserves last valid evidence and never retries on a view remount`, { timeout: 5000 }, async t => {
    const stream = transport();
    const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
    t.after(() => plugin.dispose());
    const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, 'Connect observer'); await flush();
    stream.push(9); await flush(); stream[mode](); await connecting;
    assert.match(status(ui), mode === 'close' ? /stream closed/ : /unavailable/);
    assert.match(sample(ui), /sequence 9/);
    ui.unmount(); const remount = plugin.mount();
    assert.match(status(remount), mode === 'close' ? /stream closed/ : /unavailable/);
    assert.match(sample(remount), /sequence 9/); assert.equal(plugin.calls.length, 1); expectReadonly(plugin.calls);
  });
}
