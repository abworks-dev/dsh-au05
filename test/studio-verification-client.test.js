import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
const source = fs.readFileSync(new URL('../packages/dsh-studio-hook/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const result = (state = 'running', extra = {}) => ({ ok: true, value: {
  state, accepted: 1, completed: 1, dropped: 0, lastEvent: 'PreToolUse', lastCode: '', remaining: 0, ...extra,
} });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture({ protocol = 'dsh-app:', multiple = false, none = false, rpc, publicStatus = true } = {}) {
  let module, View, registration, interval, intervalMs, mounted = false, snapshotReader;
  const viewCleanups = [], applyCleanups = [], calls = [], slots = [];
  let subscriptions = 0, releases = 0, owner = {};
  let currentId = none ? '' : 'selected-private-id';
  let byId = none ? {} : { [currentId]: { id: currentId, retainedBy: { mainView: 1 } } };
  if (multiple) byId.other = { id: 'other', retainedBy: { mainView: 1 } };
  let listing = { byId };
  const currentListeners = new Set(), listListeners = new Set(), statusListeners = new Set();
  let statuses = new Map(), inputRpc, inputOwner = null, actionFactoryCalls = 0;
  const actions = { createStudioActions(ctx, options) {
    actionFactoryCalls++; inputRpc = options.rpc;
    return { View() { return { type: 'shared-actions' }; }, controller: { async disconnect() {
      const old = inputOwner; inputOwner = null;
      if (old) await inputRpc('disconnect', { owner: old });
    } } };
  } };
  const subscribe = listeners => fn => { subscriptions++; listeners.add(fn); return () => { releases++; listeners.delete(fn); }; };
  const notify = listeners => { for (const listener of listeners) listener(); };
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useSyncExternalStore(sub, getSnapshot) { snapshotReader = getSnapshot; if (!mounted) viewCleanups.push(sub(() => {})); return getSnapshot(); } };
  vm.runInNewContext(source, { window: { location: { protocol }, __ModuleLoader__: { load(value) { module = value.factory(name => name === 'react' ? React : name === '@abworks/dsh-plugin-au05' ? actions : assert.fail(`unexpected dependency ${name}`)); } } },
    crypto: { randomUUID }, setInterval(fn, ms) { interval = fn; intervalMs = ms; return 1; }, clearInterval() { interval = null; } });
  const ctx = { sessions: { list: { getSnapshot: () => listing, subscribe: subscribe(listListeners) }, binding: id => id === currentId ? owner : null },
    uiSession: { current: { getSnapshot: () => ({ key: currentId }), subscribe: subscribe(currentListeners) },
      ...(publicStatus ? { sessionStatus: { getSnapshot: () => statuses, subscribe: subscribe(statusListeners) } } : {}) },
    connection: { rpc: { async call(path, method, params) { const call = { path, method, args: params.args }; calls.push(call);
      return rpc ? rpc(call, calls) : result(method.endsWith('/stop') ? 'stopped' : 'running'); } } },
    effect(fn) { applyCleanups.push(fn()); },
    slots: { inject(name, fn) { slots.push(name); return fn(); }, register(config, Component) { registration = config; View = Component; return () => {}; } } };
  module.apply(ctx);
  function render(props = { close() {} }) { const tree = View(props); mounted = true; return tree; }
  function button(tree, label) { for (const node of tree.children.flat(2)) { if (node?.type === 'button' && node.children[0] === label) return node; } throw new Error('button missing'); }
  const f = { render, calls, button, slots, registration, tick: async () => interval?.(), intervalMs: () => intervalMs,
    subscriptionCounts: () => ({ subscriptions, releases }), snapshot: () => snapshotReader(),
    actionFactoryCalls: () => actionFactoryCalls,
    async input(method, args = {}, signal) { const value = await inputRpc(method, args, signal); if (method === 'connect') inputOwner = args.owner; if (method === 'disconnect') inputOwner = null; return value; },
    pairing: () => button(render(), '读取按键配对配置').props.onClick(),
    candidates: () => button(render(), '读取已发现绑定').props.onClick(),
    configure: () => button(render(), '确认这些按键绑定').props.onClick(),
    setBindings(value) { render().children.find(node => node?.props?.['aria-label'] === '按键绑定 JSON').props.onChange({ target: { value } }); },
    setPending(pendingInteraction, notifyNow = true) { statuses = new Map([[currentId, { pendingInteraction }]]); if (notifyNow) notify(statusListeners); },
    start: () => button(render(), '开始跟随当前会话').props.onClick(), stop: () => button(render(), '停止跟随').props.onClick(),
    unmount() { for (const fn of viewCleanups.splice(0)) fn?.(); mounted = false; },
    dispose() { for (const fn of applyCleanups.splice(0)) fn?.(); },
    loseBinding() { owner = {}; notify(listListeners); },
    replaceTarget() { currentId = 'other'; byId = { other: { id: 'other', retainedBy: { mainView: 1 } } }; listing = { byId }; notify(currentListeners); notify(listListeners); },
    removeMain() { listing = { byId: {} }; notify(listListeners); },
    addMain() { listing = { byId: { ...byId, other: { id: 'other', retainedBy: { mainView: 1 } } } }; notify(listListeners); } };
  return f;
}
test('Studio registers an independent public settings section, not an input dock', () => {
  const f = fixture();
  assert.deepEqual(f.slots, ['settings.section']);
  assert.equal(f.registration.name, 'settings.section'); assert.equal(f.registration.id, 'au05-studio');
  assert.equal(f.registration.label(), 'AU05 / Studio'); assert.equal(f.render().type, 'section');
  const manifest = JSON.parse(fs.readFileSync(new URL('../packages/dsh-studio-hook/package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-general'));
  assert.ok(manifest.dsh.client.inject.includes('@abworks/dsh-plugin-au05'));
  assert.equal(f.actionFactoryCalls(), 1, 'only the reusable factory mounts action bridges; Studio owns no input dock');
  assert.ok(f.render().children.some(node => typeof node?.type === 'function'), 'shared action View mounts inside settings');
});
test('mount, remount and idle 1s polling never start or restore a sender', async () => {
  const f = fixture(); f.render(); await f.tick(); f.unmount(); f.render(); await f.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.intervalMs(), 1000); assert.equal(f.snapshot().status.state, 'idle');
});
test('explicit start uses the public current-main store and new runtime contract', async () => {
  const f = fixture(); let tree = f.render({ close() {}, sessionId: 'foreign-slot-prop' });
  const start = f.button(tree, '开始跟随当前会话'); assert.equal(start.props.disabled, false); await start.props.onClick();
  assert.equal(f.calls[0].method, 'studioRuntime/start'); assert.deepEqual(Object.keys(f.calls[0].args), ['sessionId', 'owner']);
  assert.equal(f.calls[0].args.sessionId, 'selected-private-id'); assert.match(f.calls[0].args.owner, /^[0-9a-f-]{36}$/);
  tree = f.render(); assert.equal(f.button(tree, '停止跟随').props.disabled, false);
  await f.tick(); assert.equal(f.calls.at(-1).method, 'studioRuntime/poll');
  await f.button(tree, '停止跟随').props.onClick(); assert.equal(f.calls.at(-1).method, 'studioRuntime/stop');
  assert.equal(f.snapshot().status.remaining, 0);
});
test('remote browser, absent or ambiguous main session cannot start even by direct callback', async () => {
  for (const options of [{ protocol: 'http:' }, { multiple: true }, { none: true }]) {
    const f = fixture(options), start = f.button(f.render(), '开始跟随当前会话');
    assert.equal(start.props.disabled, true); await start.props.onClick(); assert.equal(f.calls.length, 0);
  }
});
test('binding replacement, switching, missing or ambiguous main immediately stops without rebinding', async () => {
  for (const change of ['loseBinding', 'replaceTarget', 'removeMain', 'addMain']) {
    const f = fixture(); await f.start(); const token = f.calls[0].args.owner;
    f[change](); await flush(); await f.tick();
    assert.equal(f.calls.at(-1).method, 'studioRuntime/stop'); assert.equal(f.calls.at(-1).args.owner, token);
    assert.equal(f.calls.filter(call => call.method.endsWith('/start')).length, 1);
    assert.equal(f.snapshot().status.state, 'binding_lost');
  }
});
test('question or slot props cannot reset the immutable run owner', async () => {
  const f = fixture(); await f.start(); const token = f.calls[0].args.owner;
  const tree = f.render({ close() {}, activity: 'question', sessionId: undefined });
  assert.equal(tree.type, 'section'); assert.equal(f.button(tree, '停止跟随').props.disabled, false);
  await f.tick(); assert.equal(f.calls.at(-1).method, 'studioRuntime/poll'); assert.equal(f.calls.at(-1).args.owner, token);
  assert.equal(f.calls.filter(call => call.method.endsWith('/start')).length, 1);
  assert.equal(f.calls.filter(call => call.method.endsWith('/stop')).length, 0);
});
test('Settings unmount keeps following; reopen can stop; apply disposal releases subscriptions and timer', async () => {
  const f = fixture(); await f.start(); const token = f.calls[0].args.owner;
  f.unmount(); await f.tick(); assert.equal(f.calls.at(-1).method, 'studioRuntime/poll');
  assert.deepEqual(f.subscriptionCounts(), { subscriptions: 3, releases: 0 });
  assert.equal(f.button(f.render(), '停止跟随').props.disabled, false); await f.stop();
  await f.start(); const lastToken = f.calls.at(-1).args.owner; assert.notEqual(token, lastToken);
  f.dispose(); await flush();
  assert.equal(f.calls.at(-1).method, 'studioRuntime/stop'); assert.equal(f.calls.at(-1).args.owner, lastToken);
  assert.deepEqual(f.subscriptionCounts(), { subscriptions: 3, releases: 3 });
  const count = f.calls.length; await f.tick(); assert.equal(f.calls.length, count);
});
test('switching while Settings is closed still stops the pinned run', async () => {
  const f = fixture(); await f.start(); f.unmount(); f.replaceTarget(); await flush();
  assert.equal(f.calls.at(-1).method, 'studioRuntime/stop');
  assert.equal(f.snapshot().status.state, 'binding_lost'); assert.equal(f.calls.filter(c => c.method.endsWith('/start')).length, 1);
});
test('stop overtaking pending start fences late reply and prevents a concurrent new start', async () => {
  const pending = deferred(); let first = true;
  const f = fixture({ rpc(call) { if (call.method.endsWith('/start') && first) { first = false; return pending.promise; } return result(call.method.endsWith('/stop') ? 'stopped' : 'running'); } });
  const starting = f.start(), oldOwner = f.calls[0].args.owner;
  await f.stop(); assert.equal(f.snapshot().canStart, false); await f.start(); assert.equal(f.calls.filter(c => c.method.endsWith('/start')).length, 1);
  pending.resolve(result()); await starting;
  assert.equal(f.snapshot().status.state, 'stopped'); assert.equal(f.snapshot().canStart, true);
  assert.equal(f.calls.filter(c => c.method.endsWith('/stop') && c.args.owner === oldOwner).length, 2);
  await f.start(); assert.notEqual(f.calls.at(-1).args.owner, oldOwner); assert.equal(f.snapshot().status.state, 'running');
});
test('old poll completion cannot overwrite a stopped or newer run', async () => {
  const pending = deferred(); let firstPoll = true;
  const f = fixture({ rpc(call) { if (call.method.endsWith('/poll') && firstPoll) { firstPoll = false; return pending.promise; } return result(call.method.endsWith('/stop') ? 'stopped' : 'running'); } });
  await f.start(); const polling = f.tick(); await f.stop(); await f.start();
  pending.resolve(result('error', { completed: 99 })); await polling;
  assert.equal(f.snapshot().status.state, 'running'); assert.equal(f.snapshot().status.completed, 1);
});
test('late start after binding loss or apply disposal is stopped and cannot revive service', async () => {
  for (const change of ['replaceTarget', 'dispose']) {
    const pending = deferred(); const f = fixture({ rpc: call => call.method.endsWith('/start') ? pending.promise : result('stopped') });
    const starting = f.start(), token = f.calls[0].args.owner;
    f[change](); await flush(); pending.resolve(result()); await starting;
    assert.ok(f.calls.filter(c => c.method.endsWith('/stop') && c.args.owner === token).length >= 2);
    if (change === 'replaceTarget') assert.equal(f.snapshot().status.state, 'binding_lost');
  }
});
test('start conflict and poll failure are visible sanitized errors, never silent retries', async () => {
  for (const failedMethod of ['start', 'poll']) {
    const f = fixture({ rpc(call) { if (call.method.endsWith(`/${failedMethod}`)) throw new Error('owner=secret session=secret conflict'); return result(call.method.endsWith('/stop') ? 'stopped' : 'running'); } });
    await f.start(); await f.tick(); const text = JSON.stringify(f.render());
    assert.equal(f.snapshot().status.state, 'error'); assert.ok(f.snapshot().error);
    assert.ok(!text.includes('secret')); assert.equal(f.calls.filter(c => c.method.endsWith('/start')).length, 1);
  }
});
test('confirmed start rejection never stops a foreign owner or blocks a successful manual retry', async () => {
  for (const code of ['mode_conflict', 'owner_mismatch']) {
    let reject = true;
    const f = fixture({ rpc(call) {
      if (call.method.endsWith('/start')) return reject ? { ok: false, error: { code, message: 'foreign-owner-private-id' } } : result();
      if (reject) return { ok: false, error: { code: 'owner_mismatch' } };
      return result(call.method.endsWith('/stop') ? 'stopped' : 'running');
    } });
    await f.start(); const rejectedToken = f.calls[0].args.owner;
    assert.equal(f.snapshot().status.state, 'error'); assert.equal(f.snapshot().canStart, true); assert.equal(f.snapshot().canStop, false);
    assert.equal(f.calls.length, 1, 'rejected candidate must not send any stop against the foreign runtime');
    assert.ok(!JSON.stringify(f.render()).includes('foreign-owner-private-id'));
    reject = false; await f.start(); assert.equal(f.snapshot().status.state, 'running');
    assert.notEqual(f.calls.at(-1).args.owner, rejectedToken);
    await f.stop(); assert.equal(f.snapshot().status.state, 'stopped');
  }
});
test('ambiguous thrown or malformed start still compensates and retains owner when stop cannot confirm', async () => {
  for (const malformed of [false, true]) {
    const f = fixture({ rpc(call) {
      if (call.method.endsWith('/start')) { if (malformed) return { ok: true, value: {} }; throw new Error('private transport failure'); }
      return { ok: false, error: { code: 'unavailable' } };
    } });
    await f.start(); assert.equal(f.calls.at(-1).method, 'studioRuntime/stop');
    assert.equal(f.calls.at(-1).args.owner, f.calls[0].args.owner);
    assert.equal(f.snapshot().canStart, false); assert.equal(f.snapshot().canStop, true);
  }
});
test('failed stop is reported rather than claiming confirmed success', async () => {
  const f = fixture({ rpc(call) { if (call.method.endsWith('/stop')) return { ok: false, error: 'private-owner-conflict' }; return result(); } });
  await f.start(); await f.stop(); assert.equal(f.snapshot().status.state, 'error');
  assert.match(f.snapshot().error, /停止请求未确认/); assert.ok(!JSON.stringify(f.render()).includes('private-owner-conflict'));
});
test('unconfirmed stop retains owner for manual retry and apply cleanup and blocks restart', async () => {
  let fail = true;
  const f = fixture({ rpc(call) { if (call.method.endsWith('/stop')) return fail ? result('error') : result('stopped'); return result(); } });
  await f.start(); const token = f.calls[0].args.owner; await f.stop();
  assert.equal(f.snapshot().canStop, true); assert.equal(f.snapshot().canStart, false);
  await f.start(); assert.equal(f.calls.filter(c => c.method.endsWith('/start')).length, 1);
  fail = false; await f.stop(); assert.equal(f.calls.at(-1).args.owner, token);
  assert.equal(f.snapshot().canStop, false); assert.equal(f.snapshot().canStart, true);
  await f.start(); fail = true; await f.stop(); const lastToken = f.calls.at(-1).args.owner;
  f.dispose(); await flush(); assert.equal(f.calls.at(-1).method, 'studioRuntime/stop'); assert.equal(f.calls.at(-1).args.owner, lastToken);
});
test('formal Chinese page describes continuous collaboration and safe capability limits without opaque IDs', async () => {
  const f = fixture({ rpc: () => result('running', { lastEvent: 'private-event', lastCode: 'private-code' }) });
  await f.start(); const text = JSON.stringify(f.render());
  for (const expected of ['Studio协作模式', 'Studio 必须保持运行', '断开直连模式', 'K1录音灯关闭', '不会启动按键桥或麦克风', '当前真实可回答状态', '已转发']) assert.ok(text.includes(expected), expected);
  for (const expected of ['关闭设置不会停止', '切换会话后需重新开始', '每次重新连接均需重新确认', '勿发布或粘贴到日志', '不代表实体灯已确认']) assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes('真实任务状态可用'));
  for (const hidden of ['120', 'selected-private-id', f.calls[0].args.owner, 'private-event', 'private-code', 'CLI 成功 1']) assert.ok(!text.includes(hidden), hidden);
});
const approval = (extra = {}) => ({ kind: 'approval', answerable: true, sessionId: 'selected-private-id', key: 'approval-key', answer() { assert.fail('projection must never answer'); }, ...extra });
const inputResult = (extra = {}) => ({ ok: true, value: { generation: 1, sequence: 0, connected: true, state: 'listening', events: [], ...extra } });
test('shared action factory is inert; explicit input calls use only the captured Studio runtime and input owners', async () => {
  const f = fixture({ rpc(call) { return call.method.includes('/input') ? inputResult() : result(call.method.endsWith('/stop') ? 'stopped' : 'running'); } });
  assert.equal(f.actionFactoryCalls(), 1); f.render(); assert.equal(f.calls.length, 0);
  await assert.rejects(f.input('connect', { owner: 'input-a' })); assert.equal(f.calls.length, 0);
  await f.start(); const owner = f.calls[0].args.owner;
  assert.deepEqual(f.calls.map(call => call.method), ['studioRuntime/start']);
  await f.input('connect', { owner: 'input-a', options: { lights: false } });
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1).args)), { owner, inputOwner: 'input-a', options: { lights: false } });
  for (const [method, route] of [['poll', 'inputPoll'], ['windowsVoice', 'inputWindowsVoice'], ['shortcutVoice', 'inputShortcutVoice']]) {
    await f.input(method, { owner: 'input-a', options: { after: 2 }, gesture: { generation: 1, sequence: 2, context: 'context-a' } });
    assert.equal(f.calls.at(-1).method, `studioRuntime/${route}`); assert.equal(f.calls.at(-1).args.owner, owner);
    assert.equal(f.calls.at(-1).args.inputOwner, 'input-a'); assert.equal(f.calls.at(-1).args.gesture.sequence, 2);
  }
  const count = f.calls.length;
  await assert.rejects(f.input('status')); await assert.rejects(f.input('poll', { owner: 'foreign' }));
  assert.equal(f.calls.length, count, 'no unknown input status or foreign owner request');
  await f.stop();
  assert.equal(f.calls.at(-2).method, 'studioRuntime/inputDisconnect'); assert.equal(f.calls.at(-2).args.owner, owner);
  assert.equal(f.calls.at(-1).method, 'studioRuntime/stop');
  assert.ok(f.calls.every(call => call.method.startsWith('studioRuntime/')));
});
test('input RPC rejects failed envelopes and late replies after stop or a newer run without retargeting', async () => {
  for (const route of ['inputConnect', 'inputPoll', 'inputWindowsVoice', 'inputShortcutVoice']) {
    const pending = deferred(); let delayed = false;
    const f = fixture({ rpc(call) {
      if (call.method === `studioRuntime/${route}` && !delayed) { delayed = true; return pending.promise; }
      return call.method.includes('/input') ? inputResult() : result(call.method.endsWith('/stop') ? 'stopped' : 'running');
    } });
    await f.start(); const old = f.calls[0].args.owner;
    if (route !== 'inputConnect') await f.input('connect', { owner: 'input-a' });
    const method = { inputConnect: 'connect', inputPoll: 'poll', inputWindowsVoice: 'windowsVoice', inputShortcutVoice: 'shortcutVoice' }[route];
    const request = f.input(method, { owner: 'input-a' }); const rejected = assert.rejects(request);
    await f.stop(); await f.start(); const current = f.calls.at(-1).args.owner; assert.notEqual(current, old);
    pending.resolve(inputResult()); await rejected;
    assert.equal(f.snapshot().status.state, 'running'); assert.equal(f.snapshot().canPair, false);
    assert.equal(f.calls.filter(c => c.method === `studioRuntime/${route}` && c.args.owner === current).length, 0);
  }
  const f = fixture({ rpc: call => call.method.includes('/input') ? { ok: false, value: { state: 'listening' }, error: 'secret' } : result() });
  await f.start(); await assert.rejects(f.input('connect', { owner: 'input-a' })); assert.equal(f.snapshot().canPair, false);
});
test('pairing is read only on explicit request, contains no default status secret and clears on stop', async () => {
  const f = fixture({ rpc(call) {
    if (call.method.endsWith('/inputPairing')) return { ok: true, value: { token: 'pairing-private-token', endpoint: 'loopback' } };
    return call.method.includes('/input') ? inputResult() : result(call.method.endsWith('/stop') ? 'stopped' : 'running');
  } });
  await f.pairing(); assert.equal(f.calls.length, 0);
  await f.start(); await f.input('connect', { owner: 'input-a' }); await f.tick();
  assert.equal(f.calls.filter(c => c.method.endsWith('/inputPairing')).length, 0);
  assert.ok(!JSON.stringify(f.render()).includes('pairing-private-token'));
  await f.pairing(); const call = f.calls.at(-1); assert.equal(call.method, 'studioRuntime/inputPairing');
  assert.equal(call.args.inputOwner, 'input-a'); assert.equal(call.args.owner, f.calls[0].args.owner);
  const field = f.render().children.find(node => node?.type === 'textarea' && node.props['aria-label'] === '按键配对配置');
  assert.equal(field.props.readOnly, true); assert.equal(JSON.parse(field.props.value).token, 'pairing-private-token');
  assert.ok(!JSON.stringify(f.snapshot().status).includes('pairing-private-token'));
  await f.stop(); assert.equal(f.snapshot().pairing, ''); assert.equal(f.snapshot().canPair, false);
});
test('late pairing reply cannot expose a prior run secret after stop, reconnect or disposal', async () => {
  for (const change of ['stop', 'dispose']) {
    const pending = deferred();
    const f = fixture({ rpc(call) { if (call.method.endsWith('/inputPairing')) return pending.promise;
      return call.method.includes('/input') ? inputResult() : result(call.method.endsWith('/stop') ? 'stopped' : 'running'); } });
    await f.start(); await f.input('connect', { owner: 'input-a' }); const reading = f.pairing();
    await f[change](); if (change === 'stop') await f.start();
    pending.resolve({ ok: true, value: { token: 'old-pairing-secret' } }); await reading;
    assert.ok(!JSON.stringify(f.render()).includes('old-pairing-secret'));
  }
});
test('approval projects exactly the live public answerable carrier once per key and per run without answering', async () => {
  const f = fixture(); f.setPending(approval()); assert.equal(f.calls.length, 0);
  const before = Date.now(); await f.start(); await flush();
  const projections = () => f.calls.filter(call => call.method === 'studioRuntime/approval');
  assert.equal(projections().length, 1); const { projection } = projections()[0].args;
  assert.deepEqual(Object.keys(projection), ['sessionId', 'key', 'observedAt', 'revision', 'answerable']);
  assert.equal(projection.sessionId, 'selected-private-id'); assert.equal(projection.key, 'approval-key'); assert.equal(projection.answerable, true);
  assert.ok(projection.observedAt >= before && projection.observedAt <= Date.now()); assert.equal(projection.revision, 1);
  assert.equal(projections()[0].args.owner, f.calls[0].args.owner);
  f.setPending(approval()); await flush(); await f.tick(); assert.equal(projections().length, 1, 'new carrier with same key never resends');
  f.setPending(approval({ key: 'next-key' })); await flush(); assert.equal(projections().length, 2); assert.equal(projections()[1].args.projection.revision, 2);
  await f.stop(); await f.start(); await flush(); assert.equal(projections().length, 3); assert.equal(projections()[2].args.projection.revision, 1);
});
test('approval rejects absent public status, mismatched, unanswerable, malformed and non-approval carriers', async () => {
  const unavailable = fixture({ publicStatus: false }); await unavailable.start(); await unavailable.tick();
  assert.equal(unavailable.calls.filter(c => c.method.endsWith('/approval')).length, 0);
  const f = fixture(); await f.start();
  for (const extra of [{ kind: 'question' }, { kind: 'asked' }, { sessionId: 'foreign' }, { answerable: false }, { answerable: 1 }, { key: '' }, { key: 'x'.repeat(257) }, { key: 1 }, { answer: undefined }]) {
    f.setPending(approval(extra)); await flush(); await f.tick();
  }
  assert.equal(f.calls.filter(c => c.method.endsWith('/approval')).length, 0);
  f.setPending(approval(), false); await f.tick(); assert.equal(f.calls.filter(c => c.method.endsWith('/approval')).length, 1, 'poll fallback rereads public snapshot');
});
test('approval in-flight guard, settings unmount and binding/app teardown retain strict per-run fences', async () => {
  for (const change of ['replaceTarget', 'dispose', 'stop']) {
    const pending = deferred(); let delayed = false;
    const f = fixture({ rpc(call) { if (call.method.endsWith('/approval') && !delayed) { delayed = true; return pending.promise; } return result(call.method.endsWith('/stop') ? 'stopped' : 'running'); } });
    await f.start(); f.setPending(approval()); await flush();
    f.unmount(); f.setPending(approval()); await f.tick(); assert.equal(f.calls.filter(c => c.method.endsWith('/approval')).length, 1);
    await f[change](); await flush(); if (change === 'stop') await f.start();
    pending.resolve(result('running', { completed: 99 })); await flush();
    assert.notEqual(f.snapshot().status.completed, 99);
    if (change === 'replaceTarget') assert.equal(f.snapshot().status.state, 'binding_lost');
  }
});
test('capture-first pairing then explicit candidates and confirmation never starts input or routes manifest UUIDs implicitly', async () => {
  const bindings = [{ control: 'k1', actionid: 'owned-instance-id', key: '0_0' }];
  const f = fixture({ rpc(call) {
    if (call.method.endsWith('/inputCandidates')) return { ok: true, value: bindings };
    return call.method.includes('/input') ? inputResult() : result(call.method.endsWith('/stop') ? 'stopped' : 'running');
  } });
  await f.candidates(); await f.configure(); assert.equal(f.calls.length, 0);
  await f.start(); await f.configure(); assert.equal(f.calls.length, 1);
  await f.input('connect', { owner: 'input-a' }); const runOwner = f.calls[0].args.owner;
  assert.equal(f.snapshot().bindingsConfigured, false); assert.equal(f.calls.filter(c => c.method.endsWith('/inputCandidates')).length, 0);
  await f.configure(); assert.match(f.snapshot().bindingsError, /空白示例不可保存/); assert.equal(f.calls.filter(c => c.method.endsWith('/inputConfigure')).length, 0);
  await f.candidates(); assert.deepEqual(JSON.parse(f.snapshot().bindingsDraft), bindings);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1).args)), { owner: runOwner, inputOwner: 'input-a' });
  assert.equal(f.snapshot().bindingsConfigured, false, 'reading candidates never confirms them');
  await f.configure(); assert.equal(f.calls.at(-1).method, 'studioRuntime/inputConfigure');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1).args)), { owner: runOwner, inputOwner: 'input-a', bindings });
  assert.equal(f.snapshot().bindingsConfigured, true); assert.equal(f.snapshot().status.state, 'running', 'DeviceSnapshot cannot overwrite runtime snapshot');
  assert.equal(f.calls.filter(c => c.method.endsWith('/inputConnect')).length, 1, 'confirmation keeps existing capture listener and tokens');
  await f.input('disconnect', { owner: 'input-a' }); assert.equal(f.snapshot().bindingsConfigured, false);
  await f.input('connect', { owner: 'input-b' }); assert.equal(f.snapshot().bindingsConfigured, false);
});
test('candidate and configure errors, obsolete replies and post-disposal pairing remain sanitized and fenced', async () => {
  for (const route of ['inputCandidates', 'inputConfigure']) {
    const pending = deferred();
    const f = fixture({ rpc(call) { if (call.method.endsWith(`/${route}`)) return pending.promise;
      return call.method.includes('/input') ? inputResult() : result(call.method.endsWith('/stop') ? 'stopped' : 'running'); } });
    await f.start(); await f.input('connect', { owner: 'input-a' });
    f.setBindings(JSON.stringify([{ control: 'k1', actionid: 'old-instance', key: '0_0' }]));
    const request = route === 'inputCandidates' ? f.candidates() : f.configure();
    await f.stop(); await f.start(); await f.input('connect', { owner: 'input-b' });
    pending.resolve({ ok: true, value: route === 'inputCandidates' ? [{ control: 'k2', actionid: 'obsolete-secret', key: '0_1' }] : { state: 'connected' } });
    await request; assert.ok(!f.snapshot().bindingsDraft.includes('obsolete-secret')); assert.equal(f.snapshot().bindingsConfigured, false);
  }
  const f = fixture({ rpc(call) {
    if (call.method.endsWith('/inputPairing')) return { ok: true, value: { token: 'dispose-secret' } };
    if (call.method.endsWith('/inputConfigure') || call.method.endsWith('/inputCandidates')) return { ok: false, error: 'private-owner-and-path' };
    return call.method.includes('/input') ? inputResult() : result(call.method.endsWith('/stop') ? 'stopped' : 'running');
  } });
  await f.start(); await f.input('connect', { owner: 'input-a' }); f.setBindings(JSON.stringify([{ control: 'k1', actionid: 'owned-instance', key: '0_0' }]));
  await f.configure(); assert.equal(f.snapshot().bindingsConfigured, false); assert.ok(f.snapshot().bindingsError);
  await f.candidates(); assert.ok(!JSON.stringify(f.render()).includes('private-owner-and-path'));
  await f.pairing(); assert.ok(JSON.stringify(f.render()).includes('dispose-secret')); f.dispose();
  assert.ok(!JSON.stringify(f.render()).includes('dispose-secret'));
});
test('runtime terminal poll prevents stale approval submission and releases active input locally', async () => {
  const f = fixture({ rpc(call) { if (call.method.endsWith('/poll')) return result('stopped');
    return call.method.includes('/input') ? inputResult() : result(); } });
  await f.start(); await f.input('connect', { owner: 'input-a' }); f.setPending(approval(), false); await f.tick();
  assert.equal(f.snapshot().status.state, 'stopped'); assert.equal(f.snapshot().canPair, false);
  assert.equal(f.calls.filter(c => c.method.endsWith('/approval')).length, 0);
  await assert.rejects(f.input('connect', { owner: 'input-b' }));
});
test('candidate reads keep the binding view mounted through pending, poll, reopen and failure', async () => {
  for (const failed of [false, true]) {
    const pending = deferred();
    const f = fixture({ rpc(call) {
      if (call.method.endsWith('/inputCandidates')) return pending.promise;
      return call.method.includes('/input') ? inputResult() : result();
    } });
    const field = () => {
      const tree = f.render();
      assert.equal(tree.type, 'section');
      const fields = tree.children.filter(node => node?.type === 'textarea' && node.props['aria-label'] === '按键绑定 JSON');
      assert.equal(fields.length, 1);
      return fields[0];
    };
    await f.start(); await f.input('connect', { owner: 'input-a' }); field();
    const reading = f.candidates();
    assert.equal(f.button(f.render(), '读取已发现绑定').props.disabled, true); field();
    for (let n = 0; n < 50; n++) { await f.tick(); field(); }
    f.unmount(); field();
    pending.resolve(failed ? { ok: false, error: 'private-error' } : { ok: true, value: [] });
    await reading;
    field(); assert.equal(f.snapshot().status.state, 'running');
    assert.equal(f.button(f.render(), '读取已发现绑定').props.disabled, false);
    assert.equal(f.calls.filter(call => /\/(?:stop|inputDisconnect|inputConfigure|inputWindowsVoice|inputShortcutVoice)$/.test(call.method)).length, 0);
    f.dispose();
  }
});
