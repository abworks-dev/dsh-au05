import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { FINISH_STATUSES } from '../apps/observer/server.mjs';

const source = await readFile(new URL('./fixtures/legacy-observer-client.fixture', import.meta.url), 'utf8');
function setup(fetchImpl = () => { throw new Error('unexpected_network'); }, { expand = true } = {}) {
  let registration, Component, cleanup, dispose; const states = [], refs = []; let stateIndex = 0, refIndex = 0, mounted = false;
  const React = { createElement: (...args) => args,
    useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = value; }]; },
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useEffect(effect) { if (!mounted) { mounted = true; cleanup = effect(); } } };
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value; } } },
    fetch: fetchImpl, AbortController, TextDecoder, Set, Error, JSON });
  registration.factory(() => React).apply({ effect(callback) { dispose = callback(); }, slots: { inject(_name, callback) { callback(); },
    register(_options, component) { Component = component; } } });
  const ui = { states, refs, dispose: () => dispose?.(), unmount: () => cleanup?.(),
    render() { stateIndex = refIndex = 0; return Component({}); } };
  if (expand) find(ui.render(), child => child?.[1]?.['data-au05-pill'] === '')[1].onClick();
  return ui;
}
function find(tree, predicate) {
  if (!Array.isArray(tree)) return undefined;
  if (predicate(tree)) return tree;
  for (const child of tree.slice(2)) { const result = find(child, predicate); if (result) return result; }
}
const button = (tree, label) => find(tree, child => child?.[0] === 'button' && child[2] === label);
const input = tree => find(tree, child => child?.[0] === 'input');
const status = tree => find(tree, child => child?.[1]?.['data-au05-connection'] === '')[2];
const frame = (data, kind = 'input') => `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
const safe = { type: 'input', event: 'k1.down', sequence: 1, counts: { 'k1.down': 1 },
  hardware: true, finished: false, readOnly: true, writes: 0 };
function response(text) {
  const encoded = new TextEncoder().encode(text); let index = 0;
  return { ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({
    async read() { if (index >= encoded.length) return { done: true }; const value = encoded.slice(index, index += 7); return { value, done: false }; },
    async cancel() {}, releaseLock() {},
  }) } };
}

test('observer mount makes no network request; disconnect and unload stay local', () => {
  let calls = 0;
  const ui = setup(() => { calls++; throw new Error('forbidden'); });
  assert.match(status(ui.render()), /未连接/);
  button(ui.render(), '断开观察')[1].onClick(); ui.unmount();
  assert.equal(calls, 0);
});

test('observer rejects invalid token and never uses persisted credentials', async () => {
  const ui = setup(); let tree = ui.render();
  input(tree)[1].onChange({ target: { value: 'invalid' } }); tree = ui.render();
  await button(tree, '连接')[1].onClick();
  assert.match(status(ui.render()), /令牌无效/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
});

test('observer uses explicit bearer GET, no cookies/referrer, clears token, parses split SSE', async () => {
  const calls = [];
  const ui = setup(async (...args) => { calls.push(args); return response(': heartbeat\n\n' + frame(safe)); });
  input(ui.render())[1].onChange({ target: { value: 'b'.repeat(64) } });
  await button(ui.render(), '连接')[1].onClick();
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'http://127.0.0.1:17376/v1/events');
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.cache, 'no-store');
  assert.equal(options.headers.Authorization, `Bearer ${'b'.repeat(64)}`);
  assert.equal(input(ui.render())[1].value, '');
  assert.equal(ui.states[1].sample.lastEvent, 'k1.down'); assert.equal(ui.states[1].sample.sequence, 1);
  assert.match(status(ui.render()), /连接中断/);
  ui.unmount(); ui.dispose();
});

test('observer refuses control-bearing or unrecognized events and oversized frames', async () => {
  for (const data of [{ ...safe, writes: 1 }, { ...safe, readOnly: false }, { ...safe, event: 'approve' },
    { ...safe, counts: { 'unknown-secret': 1 } }, { ...safe, sequence: -1 }, { ...safe, hardware: 'yes' },
    { ...safe, status: 'unknown-secret' }, { ...safe, status: null }, { ...safe, status: 'timeout' },
    { ...safe, status: 'ready', finished: true }, null]) {
    const ui = setup(async () => response(frame(data)));
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), '连接')[1].onClick();
    assert.match(status(ui.render()), /连接中断/); assert.equal(ui.states[1].sample, null);
  }
  const ui = setup(async () => response('x'.repeat(65537)));
  input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
  await button(ui.render(), '连接')[1].onClick();
  assert.match(status(ui.render()), /连接中断/);
});

test('explicit capture status rejects contradictory hardware/finished flags without retaining credentials', async () => {
  const contradictions = [
    { status: 'ready', hardware: false, finished: false },
    { status: 'ready', hardware: true, finished: true },
    { status: 'waiting', hardware: true, finished: false },
    { status: 'waiting', hardware: false, finished: true },
    ...FINISH_STATUSES.map(status => ({ status, hardware: true, finished: true })),
    ...FINISH_STATUSES.map(status => ({ status, hardware: false, finished: false })),
  ];
  for (const data of contradictions) {
    let calls = 0;
    const ui = setup(async () => { calls++; return response(frame({ ...safe, ...data }, 'snapshot')); });
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), '连接')[1].onClick();
    assert.match(status(ui.render()), /连接中断/, JSON.stringify(data));
    assert.equal(ui.states[1].sample, null); assert.equal(ui.states[1].canReconnect, false);
    await button(ui.render(), '手动重连')[1].onClick(); assert.equal(calls, 1);
    ui.dispose();
  }
});

test('legacy and explicit-status report counts reject individual or aggregate overflow', async () => {
  for (const metadata of [{}, { status: 'ready' }]) {
    for (const counts of [{ 'k1.down': 10001 }, { 'k1.down': Number.MAX_SAFE_INTEGER },
      { 'k1.down': -1 }, { 'k1.down': 0.5 }, { 'k1.down': '1' }, { 'k1.down': 6000, 'k2.down': 4001 }]) {
      const ui = setup(async () => response(frame({ ...safe, ...metadata, counts })));
      input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
      await button(ui.render(), '连接')[1].onClick();
      assert.match(status(ui.render()), /连接中断/, JSON.stringify(counts));
      assert.equal(ui.states[1].sample, null); assert.equal(ui.states[1].canReconnect, false);
      ui.dispose();
    }
    for (const counts of [{}, { 'k1.down': 10000 }, { 'k1.down': 6000, 'k2.down': 4000 }]) {
      const ui = setup(async () => response(frame({ ...safe, ...metadata, counts })));
      input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
      await button(ui.render(), '连接')[1].onClick();
      assert.ok(ui.states[1].sample, 'partial count objects including exact capture limit remain valid');
      assert.equal(ui.states[1].canReconnect, true); ui.dispose();
    }
  }
});

test('waiting and ready snapshots accept their exact hardware/finished flags without mode', async () => {
  for (const [captureStatus, hardware, label] of [['waiting', false, '等待设备'], ['ready', true, '采集中']]) {
    const ui = setup(async () => response(frame({ ...safe, status: captureStatus, hardware }, 'snapshot')));
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), '连接')[1].onClick();
    assert.equal(ui.states[1].sample.status, captureStatus);
    const evidence = find(ui.render(), child => child?.[1]?.['data-au05-input'] === '')[2];
    assert.match(evidence, new RegExp(`采集状态：${label}`));
    ui.dispose();
  }
});

test('unsafe future frames cannot overwrite a validated terminal reason or its last counts', async () => {
  const terminal = { ...safe, status: 'timeout', hardware: false, finished: true };
  for (const unsafe of [{ ...safe, status: 'ready', hardware: false },
    { ...safe, counts: { 'k1.down': 10001 } }, { ...safe, writes: 1 }]) {
    const ui = setup(async () => response(frame(terminal, 'snapshot') + frame(unsafe)));
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), '连接')[1].onClick();
    assert.equal(status(ui.render()), '只读观察：到期结束');
    assert.equal(ui.states[1].sample.status, 'timeout');
    assert.equal(ui.states[1].sample.counts['k1.down'], 1);
    assert.equal(ui.states[1].canReconnect, true, 'only the prior validated frame authorized credential reuse');
    ui.dispose();
  }
});

test('Chinese observer labels describe session-safe local controls and translated input', async () => {
  const ui = setup(async () => response(frame({ ...safe, status: 'ready' })));
  let tree = ui.render();
  assert.equal(input(tree)[1]['aria-label'], 'AU05 临时观察令牌');
  assert.equal(input(tree)[1].placeholder, '粘贴临时观察令牌');
  assert.ok(button(tree, '连接')); assert.ok(button(tree, '手动重连')); assert.ok(button(tree, '断开观察'));
  const safety = find(tree, child => child?.[1]?.['data-au05-safety'] === '')[2];
  assert.match(safety, /本机启动器负责启动\/停止\/重新采集，限时120秒，不自动重连/);
  assert.match(safety, /断开观察不停止设备采集/);
  input(tree)[1].onChange({ target: { value: 'a'.repeat(64) } });
  await button(ui.render(), '连接')[1].onClick();
  tree = ui.render();
  const sample = find(tree, child => child?.[1]?.['data-au05-input'] === '')[2];
  assert.match(sample, /采集状态：采集中 · 事件报告 1 · 序号 1 · 最近：按键1按下/);
  assert.doesNotMatch(sample, /k1\.down/);
  assert.equal(ui.states[1].canReconnect, true);
  assert.equal(JSON.stringify(ui.states).includes('a'.repeat(64)), false, 'validated credential is not exposed as React/store state');
  ui.dispose();
});

test('five paired count rows show translated labels, both directions and zero defaults', async () => {
  const data = { ...safe, counts: { 'k1.down': 2, 'k1.up': 1, 'left.pulse': 3 } };
  const ui = setup(async () => response(frame(data)));
  input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
  await button(ui.render(), '连接')[1].onClick();
  const tree = ui.render();
  for (const name of ['按键1', '按键2', '按键3', '旋钮按压', '旋钮转动'])
    assert.ok(find(tree, child => child?.[1]?.['data-au05-count-pair'] === name));
  const keys = JSON.stringify(find(tree, child => child?.[1]?.['data-au05-count-pair'] === '按键1'));
  assert.match(keys, /按下 2/); assert.match(keys, /松开 1/);
  const turns = JSON.stringify(find(tree, child => child?.[1]?.['data-au05-count-pair'] === '旋钮转动'));
  assert.match(turns, /右转 0/); assert.match(turns, /左转 3/);
  assert.doesNotMatch(turns, /left\.pulse|right\.pulse/); ui.dispose();
});

test('all server terminal statuses are validated, displayed and survive EOF', async () => {
  for (const terminal of FINISH_STATUSES) {
    const ui = setup(async () => response(frame({ ...safe, event: undefined, hardware: false, finished: true, status: terminal }, 'snapshot')));
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), '连接')[1].onClick();
    assert.equal(ui.states[1].sample.status, terminal);
    assert.doesNotMatch(status(ui.render()), /连接中断|undefined/);
    assert.equal(ui.states[1].sample.counts['k1.down'], 1);
    ui.dispose();
  }
});

test('legacy absent status supports validated terminal events without trusting unknown reasons', async () => {
  for (const [event, expected] of [['timeout', '到期结束'], ['disconnected', '设备断开'], ['no_device', '未找到设备'],
    ['unknown-secret', '采集结束']]) {
    const text = `event: status\ndata: ${JSON.stringify({ ...safe, event, hardware: false, finished: true })}\n\n`;
    const ui = setup(async () => response(text));
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), '连接')[1].onClick();
    assert.equal(status(ui.render()), `只读观察：${expected}`);
    assert.doesNotMatch(status(ui.render()), /unknown-secret/);
    ui.dispose();
  }
});

test('manual reconnect requires validated evidence, not token syntax or successful HTTP alone', async () => {
  for (const reply of [{ ok: false }, response(': heartbeat\n\n'), response(frame({ ...safe, status: 'unknown' }))]) {
    let calls = 0;
    const ui = setup(async () => { calls++; return reply; });
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), '连接')[1].onClick();
    assert.equal(ui.states[1].canReconnect, false);
    await button(ui.render(), '手动重连')[1].onClick();
    assert.equal(calls, 1);
    assert.match(status(ui.render()), /请先粘贴令牌连接/);
    ui.dispose();
  }
});
