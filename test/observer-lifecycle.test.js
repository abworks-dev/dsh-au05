import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Offline lifecycle regression tests: the plugin source runs only in a VM with
// synthetic React hooks and mocked fetch/readers; no session context is needed.
// No browser, HTTP server, collector, device, or live DSH configuration is used.
const source = await readFile(new URL('./fixtures/legacy-observer-client.fixture', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const frame = (sequence = 1, data = {}) => new TextEncoder().encode(`event: ${data.type ?? 'input'}\ndata: ${JSON.stringify({
  type: 'input', event: 'k1.down', sequence, counts: { 'k1.down': sequence },
  hardware: true, finished: false, readOnly: true, writes: 0, ...data,
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
    push(sequence, data) { deliver({ done: false, value: frame(sequence, data) }); },
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
    mount({ expand = true } = {}) {
      const owner = { states: [], refs: [], effects: [], pending: [], stateIndex: 0, refIndex: 0, effectIndex: 0 };
      const ui = {
        render(props = {}) {
          current = owner; owner.stateIndex = owner.refIndex = owner.effectIndex = 0;
          const tree = Preview(props); current = undefined;
          for (const effect of owner.pending.splice(0)) effect();
          return tree;
        },
        unmount() { for (const effect of owner.effects) effect?.cleanup?.(); owner.effects = []; },
        refs: owner.refs,
      };
      if (expand) child(ui.render(), value => value?.[1]?.['data-au05-pill'] === '')[1].onClick();
      return ui;
    },
    dispose() { for (const cleanup of effects.splice(0).reverse()) cleanup(); },
  };
}
function child(tree, predicate) {
  if (!Array.isArray(tree)) return undefined;
  if (predicate(tree)) return tree;
  for (const value of tree.slice(2)) { const found = child(value, predicate); if (found) return found; }
}
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

test('collapsed top-right overlay is network-free; open/close/Escape preserve the one live connection', { timeout: 5000 }, async t => {
  const stream = transport();
  const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
  t.after(() => plugin.dispose());
  const ui = plugin.mount({ expand: false });
  let tree = ui.render(), focusPill = 0, focusPanel = 0;
  ui.refs[0].current = { focus() { focusPill++; } };
  ui.refs[1].current = { focus() { focusPanel++; } };
  const pill = () => child(ui.render(), value => value?.[1]?.['data-au05-pill'] === '');
  assert.equal(pill()[1]['aria-expanded'], false);
  assert.equal(child(tree, value => value?.[1]?.role === 'dialog'), undefined);
  assert.equal(plugin.calls.length, 0);
  assert.equal(child(tree, value => value?.[0] === 'style')[1]['data-au05-styles'], '');
  pill()[1].onClick(); tree = ui.render();
  assert.equal(focusPanel, 1); assert.equal(plugin.calls.length, 0, 'opening does not connect');
  const panel = child(tree, value => value?.[1]?.role === 'dialog');
  assert.equal(panel[1]['aria-modal'], false); assert.equal(panel[1]['aria-label'], 'AU05 只读观察面板');
  enterToken(ui); const connecting = button(ui, '连接'); await flush();
  stream.push(4); await flush();
  const signal = plugin.calls[0][1].signal;
  enterToken(ui, 'b'.repeat(64)); button(ui, '收起');
  assert.equal(focusPill, 1); assert.equal(pill()[1]['aria-expanded'], false);
  assert.equal(signal.aborted, false);
  stream.push(5); await flush();
  pill()[1].onClick(); tree = ui.render();
  assert.equal(plugin.calls.length, 1); assert.match(sample(ui), /序号 5/);
  assert.equal(child(tree, value => value?.[0] === 'input')[1].value, '', 'fold discards unsubmitted token');
  let prevented = 0, stopped = 0;
  tree[1].onKeyDown({ key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.equal(prevented, 1); assert.equal(stopped, 1); assert.equal(focusPill, 2);
  assert.equal(pill()[1]['aria-expanded'], false); assert.equal(signal.aborted, false);
  pill()[1].onClick(); ui.render();
  assert.equal(plugin.calls.length, 1); assert.match(sample(ui), /序号 5/);
  pill()[1].onClick(); assert.equal(pill()[1]['aria-expanded'], false, 'second click also folds');
  plugin.dispose(); await connecting;
  assert.equal(signal.aborted, true); assert.equal(stream.cancels, 1); expectReadonly(plugin.calls);
});

test('one explicit observer connection and last sample survive ordinary rendering and view remount', { timeout: 5000 }, async t => {
  const stream = transport();
  const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
  t.after(() => plugin.dispose());
  let ui = plugin.mount();
  assert.match(status(ui), /未连接/); assert.equal(plugin.calls.length, 0);
  enterToken(ui); const connecting = button(ui, '连接'); await flush();
  stream.push(1); await flush();
  for (const session of [{ running: true }, { pendingInteraction: { kind: 'approval' } }, { pendingInteraction: { kind: 'question' } }]) {
    ui.render(session); assert.match(status(ui), /采集中/); assert.match(sample(ui), /序号 1/);
  }
  const signal = plugin.calls[0][1].signal;
  ui.unmount();
  assert.equal(signal.aborted, false, 'a slot view unmount is not explicit disconnect or plugin unload');
  stream.push(2); await flush(); // Store progresses while there are no mounted views.
  ui = plugin.mount();
  assert.match(status(ui), /采集中/); assert.match(sample(ui), /序号 2/);
  assert.equal(child(ui.render(), value => value?.[0] === 'input')[1].value, '', 'token never survives as view state');
  assert.equal(plugin.calls.length, 1, 'remount never reconnects or restores a token to view state');
  stream.push(3); await flush(); assert.match(sample(ui), /序号 3/);
  plugin.dispose(); await connecting;
  assert.equal(signal.aborted, true, 'actual ctx.effect plugin disposal owns transport abort');
  assert.equal(stream.cancels, 1); assert.equal(stream.releases, 1); expectReadonly(plugin.calls);
});

test('explicit Disconnect aborts once and clears shared evidence across subsequent view remount', { timeout: 5000 }, async t => {
  const stream = transport();
  const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
  t.after(() => plugin.dispose());
  const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, '连接'); await flush();
  stream.push(3); await flush(); assert.match(sample(ui), /序号 3/);
  button(ui, '断开观察'); await connecting;
  assert.equal(plugin.calls[0][1].signal.aborted, true);
  assert.match(status(ui), /未连接/); assert.equal(sample(ui), '尚无输入报告');
  ui.unmount(); const remount = plugin.mount();
  assert.match(status(remount), /未连接/); assert.equal(sample(remount), '尚无输入报告');
  assert.equal(plugin.calls.length, 1); assert.equal(stream.cancels, 1); expectReadonly(plugin.calls);
});

test('empty or invalid token on an already connected view does not falsify live connection state', { timeout: 5000 }, async t => {
  const stream = transport();
  const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
  t.after(() => plugin.dispose());
  const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, '连接'); await flush();
  stream.push(4); await flush();
  await button(ui, '连接');
  assert.match(status(ui), /采集中/); assert.match(sample(ui), /序号 4/);
  enterToken(ui, 'not-a-token'); await button(ui, '连接');
  assert.match(status(ui), /采集中/); assert.match(sample(ui), /序号 4/);
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
  const ui = plugin.mount(); enterToken(ui); const oldConnect = button(ui, '连接');
  enterToken(ui, 'b'.repeat(64)); const newConnect = button(ui, '连接'); await flush();
  assert.equal(plugin.calls[0][1].signal.aborted, true);
  fresh.push(8); await flush(); assert.match(sample(ui), /序号 8/);
  stale.push(999); first.resolve(stale.response); await oldConnect; await flush();
  assert.match(status(ui), /采集中/); assert.match(sample(ui), /序号 8/);
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
  const ui = plugin.mount(); enterToken(ui); const oldConnect = button(ui, '连接'); await flush();
  stale.push(1); await flush();
  enterToken(ui, 'b'.repeat(64)); const newConnect = button(ui, '连接'); await flush();
  fresh.push(5); await flush(); assert.match(sample(ui), /序号 5/);
  stale.push(999); await oldConnect;
  assert.match(status(ui), /采集中/); assert.match(sample(ui), /序号 5/);
  assert.doesNotMatch(sample(ui), /999/); assert.equal(stale.cancels, 1);
  plugin.dispose(); await newConnect; expectReadonly(plugin.calls);
});

test('plugin disposal during pending fetch prevents any late reader acquisition or state publication', { timeout: 5000 }, async t => {
  const pending = deferred(); let readers = 0;
  const plugin = fixture(() => pending.promise);
  t.after(() => plugin.dispose());
  const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, '连接');
  assert.match(status(ui), /连接中/);
  plugin.dispose(); assert.equal(plugin.calls[0][1].signal.aborted, true);
  pending.resolve({ ok: true, headers: { get: () => 'text/event-stream' },
    body: { getReader() { readers++; throw new Error('disposed_reader_acquisition'); } } });
  await connecting;
  assert.equal(readers, 0, 'a stale fetch result is rejected before body acquisition');
  assert.match(status(ui), /连接中/, 'disposed store does not publish late unavailable/closed state');
  assert.equal(sample(ui), '尚无输入报告'); expectReadonly(plugin.calls);
});

test('explicit manual reconnect reuses only validated in-memory credential and makes exactly one GET', { timeout: 5000 }, async t => {
  const first = transport(), second = transport(); let attempts = 0;
  const plugin = fixture(async (_url, options) => {
    const stream = attempts++ === 0 ? first : second; stream.attach(options.signal); return stream.response;
  });
  t.after(() => plugin.dispose());
  let ui = plugin.mount();
  await button(ui, '手动重连'); assert.equal(plugin.calls.length, 0); assert.match(status(ui), /请先粘贴令牌连接/);
  enterToken(ui, 'b'.repeat(64)); const initial = button(ui, '连接'); await flush();
  first.push(7, { status: 'ready' }); await flush(); first.close(); await initial;
  assert.match(sample(ui), /序号 7/); assert.equal(plugin.calls.length, 1);
  ui.unmount(); ui = plugin.mount();
  assert.equal(plugin.calls.length, 1, 'mount must not reconnect even with a validated credential');
  const reconnect = button(ui, '手动重连'); await flush();
  assert.equal(plugin.calls.length, 2); assert.match(status(ui), /连接中/);
  assert.match(sample(ui), /序号 7/, 'manual reconnect retains the latest counts while connecting');
  assert.equal(plugin.calls[1][1].headers.Authorization, `Bearer ${'b'.repeat(64)}`);
  assert.equal(child(ui.render(), value => value?.[0] === 'input')[1].value, '');
  second.push(8, { status: 'ready' }); await flush(); second.close(); await reconnect; await flush();
  assert.match(sample(ui), /序号 8/); assert.equal(plugin.calls.length, 2, 'EOF does not retry');
  expectReadonly(plugin.calls);
});

for (const [terminal, label] of [['timeout', '到期结束'], ['disconnected', '设备断开'], ['no_device', '未找到设备']]) {
  for (const ending of ['close', 'fail']) {
    test(`${terminal} survives SSE ${ending}, remount and a manual snapshot reconnect`, { timeout: 5000 }, async t => {
      const first = transport(), second = transport(); let attempts = 0;
      const plugin = fixture(async (_url, options) => {
        const stream = attempts++ === 0 ? first : second; stream.attach(options.signal); return stream.response;
      });
      t.after(() => plugin.dispose());
      let ui = plugin.mount(); enterToken(ui); const initial = button(ui, '连接'); await flush();
      const summary = { type: 'status', event: terminal, hardware: false, finished: true, status: terminal };
      first.push(9, summary); await flush();
      assert.equal(status(ui), `只读观察：${label}`);
      first[ending](); await initial;
      assert.equal(status(ui), `只读观察：${label}`); assert.match(sample(ui), /事件报告 9/);
      ui.unmount(); ui = plugin.mount();
      assert.equal(status(ui), `只读观察：${label}`); assert.equal(plugin.calls.length, 1);
      const reconnect = button(ui, '手动重连'); await flush();
      second.push(9, { ...summary, type: 'snapshot', event: undefined }); await flush();
      second.close(); await reconnect;
      assert.equal(status(ui), `只读观察：${label}`); assert.match(sample(ui), /事件报告 9/);
      assert.equal(plugin.calls.length, 2); expectReadonly(plugin.calls);
    });
  }
}

test('manual reconnect obeys replacement epochs and cannot restore an obsolete credential', { timeout: 5000 }, async t => {
  const initial = transport(), obsolete = transport(), current = transport(), last = transport();
  const pending = deferred(); let attempts = 0;
  const plugin = fixture(async (_url, options) => {
    attempts++;
    if (attempts === 2) return pending.promise;
    const stream = attempts === 1 ? initial : attempts === 3 ? current : last;
    stream.attach(options.signal); return stream.response;
  });
  t.after(() => { plugin.dispose(); obsolete.close(); });
  const ui = plugin.mount(); enterToken(ui); const first = button(ui, '连接'); await flush();
  initial.push(1); await flush(); initial.close(); await first;
  const staleReconnect = button(ui, '手动重连');
  enterToken(ui, 'b'.repeat(64)); const freshConnect = button(ui, '连接'); await flush();
  current.push(8); await flush();
  obsolete.push(99); pending.resolve(obsolete.response); await staleReconnect;
  assert.match(sample(ui), /序号 8/); assert.equal(plugin.calls[1][1].signal.aborted, true);
  current.close(); await freshConnect;
  const reconnect = button(ui, '手动重连'); await flush();
  assert.equal(plugin.calls.length, 4);
  assert.equal(plugin.calls[3][1].headers.Authorization, `Bearer ${'b'.repeat(64)}`);
  last.close(); await reconnect; expectReadonly(plugin.calls);
});

test('disconnect erases reusable credential and abort races cannot restore it', { timeout: 5000 }, async t => {
  const stream = transport({ ignoreAbort: true });
  const plugin = fixture(async () => stream.response);
  t.after(() => { plugin.dispose(); stream.close(); });
  let ui = plugin.mount(); enterToken(ui); const connecting = button(ui, '连接'); await flush();
  stream.push(1); await flush();
  enterToken(ui, 'b'.repeat(64));
  button(ui, '断开观察');
  stream.push(99); await connecting;
  assert.equal(sample(ui), '尚无输入报告');
  assert.equal(child(ui.render(), value => value?.[0] === 'input')[1].value, '', 'disconnect also clears an unsubmitted pasted token');
  await button(ui, '手动重连'); assert.equal(plugin.calls.length, 1);
  assert.match(status(ui), /请先粘贴令牌连接/);
  ui.unmount(); ui = plugin.mount(); await button(ui, '手动重连');
  assert.equal(plugin.calls.length, 1); expectReadonly(plugin.calls);
});

test('dispose erases reusable credential and makes captured reconnect/connect handlers inert', { timeout: 5000 }, async t => {
  const stream = transport({ ignoreAbort: true });
  const plugin = fixture(async () => stream.response);
  t.after(() => { plugin.dispose(); stream.close(); });
  const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, '连接'); await flush();
  stream.push(1); await flush();
  const reconnect = child(ui.render(), value => value?.[1]?.['data-au05-reconnect'] === '')[1].onClick;
  plugin.dispose(); stream.push(99); await connecting;
  await reconnect(); enterToken(ui); await button(ui, '连接');
  assert.equal(plugin.calls.length, 1); assert.match(sample(ui), /序号 1/);
  expectReadonly(plugin.calls);
});

for (const mode of ['close', 'fail']) {
  test(`stream ${mode} preserves last valid evidence and never retries on a view remount`, { timeout: 5000 }, async t => {
    const stream = transport();
    const plugin = fixture(async (_url, options) => { stream.attach(options.signal); return stream.response; });
    t.after(() => plugin.dispose());
    const ui = plugin.mount(); enterToken(ui); const connecting = button(ui, '连接'); await flush();
    stream.push(9); await flush(); stream[mode](); await connecting;
    assert.match(status(ui), /连接中断/);
    assert.match(sample(ui), /序号 9/);
    ui.unmount(); const remount = plugin.mount();
    assert.match(status(remount), /连接中断/);
    assert.match(sample(remount), /序号 9/); assert.equal(plugin.calls.length, 1); expectReadonly(plugin.calls);
  });
}
