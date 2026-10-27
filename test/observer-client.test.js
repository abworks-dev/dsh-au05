import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
function setup(fetchImpl = () => { throw new Error('unexpected_network'); }) {
  let registration, Component, cleanup, dispose; const states = []; let stateIndex = 0, mounted = false;
  const React = { createElement: (...args) => args,
    useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = value; }]; },
    useEffect(effect) { if (!mounted) { mounted = true; cleanup = effect(); } } };
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value; } } },
    fetch: fetchImpl, AbortController, TextDecoder, Set, Error, JSON });
  registration.factory(() => React).apply({ effect(callback) { dispose = callback(); }, slots: { inject(_name, callback) { callback(); },
    register(_options, component) { Component = component; } } });
  const observer = Component({ sessionId: 'A', useSessionStatus: () => ({ running: false }) })[3][0];
  return { states, dispose: () => dispose?.(), unmount: () => cleanup?.(), render() { stateIndex = 0; return observer(); } };
}
const button = (tree, label) => tree.slice(2).find(child => child?.[0] === 'button' && child[2] === label);
const input = tree => tree.slice(2).find(child => child?.[0] === 'input');
const status = tree => tree.slice(2).find(child => child?.[1]?.['data-au05-connection'] === '')[2];
const frame = data => `event: input\ndata: ${JSON.stringify(data)}\n\n`;
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
  assert.match(status(ui.render()), /disconnected/);
  button(ui.render(), 'Disconnect observer')[1].onClick(); ui.unmount();
  assert.equal(calls, 0);
});

test('observer rejects invalid token and never uses persisted credentials', async () => {
  const ui = setup(); let tree = ui.render();
  input(tree)[1].onChange({ target: { value: 'invalid' } }); tree = ui.render();
  await button(tree, 'Connect observer')[1].onClick();
  assert.match(status(ui.render()), /invalid token/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
});

test('observer uses explicit bearer GET, no cookies/referrer, clears token, parses split SSE', async () => {
  const calls = [];
  const ui = setup(async (...args) => { calls.push(args); return response(': heartbeat\n\n' + frame(safe)); });
  input(ui.render())[1].onChange({ target: { value: 'b'.repeat(64) } });
  await button(ui.render(), 'Connect observer')[1].onClick();
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'http://127.0.0.1:17376/v1/events');
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.cache, 'no-store');
  assert.equal(options.headers.Authorization, `Bearer ${'b'.repeat(64)}`);
  assert.equal(input(ui.render())[1].value, '');
  assert.equal(ui.states[1].sample.lastEvent, 'k1.down'); assert.equal(ui.states[1].sample.sequence, 1);
  assert.match(status(ui.render()), /stream closed/);
  ui.unmount(); ui.dispose();
});

test('observer refuses control-bearing or unrecognized events and oversized frames', async () => {
  for (const data of [{ ...safe, writes: 1 }, { ...safe, readOnly: false }, { ...safe, event: 'approve' },
    { ...safe, counts: { 'unknown-secret': 1 } }, { ...safe, sequence: -1 }, { ...safe, hardware: 'yes' }]) {
    const ui = setup(async () => response(frame(data)));
    input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
    await button(ui.render(), 'Connect observer')[1].onClick();
    assert.match(status(ui.render()), /unavailable/); assert.equal(ui.states[1].sample, null);
  }
  const ui = setup(async () => response('x'.repeat(65537)));
  input(ui.render())[1].onChange({ target: { value: 'a'.repeat(64) } });
  await button(ui.render(), 'Connect observer')[1].onClick();
  assert.match(status(ui.render()), /unavailable/);
});
