// Offline product compatibility verifier. Uses installed UI code with a mock Host RPC;
// never installs into the live GUI, opens real sessions, or invokes hardware.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const defaultAsar = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData/Local'),
  'Programs/DeepSeek Harness/resources/app.asar');
export function extractRuntime(asar = defaultAsar) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'au05-plugin-runtime-'));
  const modules = path.join(asar, 'dsh/node_modules/@deepseek-ai');
  const frontend = path.join(modules, 'dsh-web-frontend/dist');
  const files = [
    ['modules.js', path.join(modules, 'dsh-client-modules/lib/client.js')],
    ['renderer.js', path.join(modules, 'dsh-client-ui-renderer/lib/client.js')],
  ];
  for (const [name, source] of files) fs.copyFileSync(source, path.join(output, name));
  for (const name of fs.readdirSync(path.join(frontend, 'assets'))) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(frontend, 'assets', name), path.join(output, name));
  }
  const desktop = JSON.parse(fs.readFileSync(path.join(asar, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(output, 'identity.json'), JSON.stringify({ version: desktop.version, commit: desktop.dshBuildCommit }));
  return output;
}

// Offline fixture body is serialized into the extracted shell; it must be self-contained.
async function browserVerify(seeds, identity) {
  const report = { fixture: 'installed-runtime/product/mock-host-rpc/offline-file', liveGuiInstalled: false,
    identity, react: seeds.react.version, passed: [], errors: [], networkCalls: 0, mockHostRpc: true };
  const assert = (value, label) => { if (!value) throw new Error(label); report.passed.push(label); };
  const delay = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
  const output = document.getElementById('report');
  let ctx, fork, unmount;
  try {
    const bootstrap = window.__ModuleLoader__.pendingQueue.shift();
    const bootstrapExports = bootstrap.factory(() => { throw new Error('unexpected bootstrap require'); });
    const modules = bootstrapExports.createClientModuleSystem(window.__ModuleLoader__,
      { id: bootstrap.id, exports: bootstrapExports }, {
        boot: { rev: 'offline-fixture', release: identity, entries: [], batches: [] }, staticModules: seeds,
        loadBundle: async () => { report.networkCalls++; throw new Error('network forbidden'); },
      });
    window.fetch = () => { report.networkCalls++; throw new Error('network forbidden'); };
    const renderer = await modules.import('@deepseek-ai/dsh-client-ui-renderer/client');
    const product = await modules.import('@abworks/dsh-plugin-au05/client');
    assert(product === await modules.import('@abworks/dsh-plugin-au05'), 'real module loader resolves and memoizes product /client');
    const { Context, Service } = seeds['@deepseek-ai/cordis'];
    ctx = new Context(); renderer.apply(ctx);
    const h = seeds.react.createElement;
    const store = value => {
      const listeners = new Set();
      return { listeners, getSnapshot: () => value,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        set(next) { value = next; for (const listener of listeners) listener(); } };
    };
    const noActions = () => { throw new Error('real conversation actions forbidden in fixture'); };
    const binding = { key: 'fixture-A', ctx, hooks: {}, keyedHooks: {},
      props: { sessionId: 'fixture-A', inputActions: { submit: noActions, captureInsertion: noActions, insertText: noActions } } };
    const current = store(binding), scopeSource = store(binding);
    const statuses = store(new Map([['fixture-A', { running: false }]]));
    const sessions = store({ byId: { 'fixture-A': { id: 'fixture-A', retainedBy: { mainView: 1 } } }, ids: ['fixture-A'] });
    const owner = { session: { cancel: noActions } };
    const calls = [], pendingPolls = [];
    const counts = method => calls.filter(call => call.method === method).length;
    const hardware = (state = 'ready') => ({ state, generation: 1, sequence: 0,
      lightsEnabled: true, lightState: 'idle', lightResult: 'written', error: null, connected: state === 'ready', stopping: false });
    const connection = { rpc: { call(path, method, payload, signal) {
      if (path !== '/api' || !['au05/connect', 'au05/poll', 'au05/disconnect'].includes(method)) throw new Error('unexpected Host RPC');
      if (!/^[a-z0-9]{32}$/.test(payload.args.owner)) throw new Error('invalid synthetic owner');
      calls.push({ method, args: payload.args, signal });
      if (method === 'au05/connect') return Promise.resolve({ ok: true, value: hardware() });
      if (method === 'au05/disconnect') return Promise.resolve({ ok: true, value: hardware('stopped') });
      return new Promise((resolve, reject) => {
        const abort = () => reject(new Error('synthetic poll aborted'));
        signal?.addEventListener('abort', abort, { once: true });
        pendingPolls.push({ signal, finish(value) { signal?.removeEventListener('abort', abort); resolve({ ok: true, value }); },
          fail() { signal?.removeEventListener('abort', abort); reject(new Error('synthetic transport fault')); } });
      });
    } } };
    const voiceCalls = [];
    for (const [name, value] of Object.entries({ connection,
      sessions: { list: sessions, binding: id => id === 'fixture-A' ? owner : undefined },
      uiSession: { adapter: { current }, sessionStatus: statuses }, uiWorkspace: { openSession: noActions },
      workspaces: { list: store({ items: [{ workspaceId: 'fixture-workspace', sessionIds: ['fixture-A'] }], archivedSessionIds: [] }) },
    })) ctx.reflect.provide(name, value);
    // A plain { remote: { speech } } mock masks undeclared namespace access.
    await ctx.plugin({ name: 'fixture-remote-provider', apply(scope) { new Service(scope, 'remote'); } });
    const speechProvider = ctx.plugin({ name: 'fixture-speech-provider', apply(scope) {
      Object.assign(new Service(scope, 'remote.speech'), {
        catalog() { voiceCalls.push('catalog'); throw new Error('microphone not requested'); },
        transcribe() { voiceCalls.push('transcribe'); throw new Error('audio not requested'); },
      });
    } });
    await speechProvider;
    ctx.slots.provideRoot({ hooks: {} });
    ctx.slots.installScope('session', { current: scopeSource, bindingSource: () => scopeSource,
      renderArea: (_binding, props) => props.children });
    const visibility = store(true);
    let probeProps;
    // Match the installed composer: keyboard is parent-entry-private; left gets no owner props.
    // Verify the renderer boundary honestly instead of supplying a fake public keyboard API.
    const privateKeyboard = { focus: noActions };
    ctx.slots.register({ name: 'root', id: 'fixture-root', children: {
      'shell.overlay': { kind: 'list', scope: 'root' }, 'fixture.composer': { kind: 'single', scope: 'session' },
    } }, ({ renderSlot, SessionProvider }) => {
      const visible = seeds.react.useSyncExternalStore(visibility.subscribe, visibility.getSnapshot);
      return visible ? h(seeds.react.Fragment, null, renderSlot('shell.overlay', {}),
        h(SessionProvider, { session: 'fixture-A' }, renderSlot('fixture.composer', {}))) : null;
    });
    ctx.slots.register({ name: 'fixture.composer', id: 'fixture-composer', inject: () => ({ keyboard: privateKeyboard }),
      children: { 'conversation.input.left': { kind: 'list', scope: 'session' },
        'conversation.input.dock': { kind: 'list', scope: 'session' } },
    }, ({ renderSlot }) => h('div', { 'data-conversation-content': '', 'data-conversation-session': 'fixture-A',
      style: { height: 320, overflow: 'hidden' } },
      h('div', { 'data-conversation-scroll': '', style: { height: 320, overflowY: 'auto' } },
        h('div', { style: { height: 1500 } }), renderSlot('conversation.input.dock', {}),
        h('div', { 'data-composer-card': true },
          h('div', { 'data-composer-input': true, contentEditable: true, role: 'textbox', 'aria-multiline': true }),
          renderSlot('conversation.input.left', {})))));
    ctx.slots.register({ name: 'conversation.input.left', id: 'fixture-probe', order: -1 }, props => { probeProps = props; return null; });
    fork = ctx.plugin(product); await fork; await delay();
    assert(ctx.slots.entries('shell.overlay').length === 1,
      'real root overlay slots.inject/register mounted one product capsule');
    assert(ctx.slots.entries('conversation.composer.dock').length === 0, 'product adds no composer dock UI');
    assert(calls.length === 0, 'product activation is lazy and makes no Host RPC');
    unmount = ctx.uiRenderer.mount(document.getElementById('fixture')); await delay();
    const pill = () => document.querySelector('[data-au05-pill]');
    const connectionText = () => document.querySelector('[data-au05-connection]')?.textContent;
    assert(pill()?.getAttribute('aria-label') === 'AU05 设备控制：未连接', 'product capsule has a Chinese accessible label');
    assert(pill()?.getAttribute('aria-expanded') === 'false', 'product capsule defaults to collapsed');
    assert(connectionText() === '未连接', 'product capsule shows disconnected state');
    assert(document.querySelector('[data-au05-panel]') === null, 'collapsed capsule has no panel');
    assert(calls.length === 0, 'mounting product capsule does not connect hardware');
    assert(probeProps?.sessionId === 'fixture-A', 'real session slot renderer forwards standard sessionId');
    assert(probeProps?.keyboard === undefined, 'real session slot renderer does not leak parent-private keyboard');
    const anchor = document.querySelector('[data-au05-input-anchor]');
    assert(anchor?.hidden && anchor.closest('[data-composer-card]')?.querySelectorAll('[data-composer-input]').length === 1,
      'real React attaches the hidden session input anchor inside its unique composer card');
    assert(current.listeners.size === 1 && statuses.listeners.size === 1 && sessions.listeners.size === 1,
      'product subscribes once to current binding status and session list');
    pill().click(); await delay();
    assert(document.querySelector('[data-au05-panel]')?.getAttribute('aria-modal') === 'false', 'product opens a Chinese non-modal device panel');
    assert(document.querySelector('[data-au05-panel] h2')?.textContent === 'AU05 设备', 'product panel uses the real device title');
    assert(document.querySelector('[data-au05-connect]')?.textContent === '连接设备', 'product offers explicit device connection');
    assert(document.querySelector('[data-au05-disconnect]')?.textContent === '断开设备', 'product offers explicit device disconnection');
    assert(document.querySelector('[data-au05-voice]')?.checked === false, 'voice starts disabled');
    assert(document.querySelector('[data-au05-lights]')?.checked === true, 'lamp feedback starts enabled');
    assert(document.querySelector('[data-au05-session]') === null && !document.querySelector('[data-au05-panel]').textContent.includes('fixture-A'), 'idle panel omits redundant session status without exposing a raw session identifier');
    assert(document.querySelector('[data-au05-key-help]')?.tagName === 'DETAILS' && !document.querySelector('[data-au05-key-help]').open, 'key help stays collapsed by default');
    assert(document.querySelector('[data-au05-preferences-status]') === null, 'normal saved settings add no persistent explanation');
    assert(document.querySelectorAll('[data-au05-panel] .au05-keys li').length === 4, 'panel documents three keys and the knob');
    assert(document.querySelector('[data-au05-token]') === null, 'product does not request an observer token');
    assert(calls.length === 0 && voiceCalls.length === 0 && report.networkCalls === 0, 'opening panel makes no device microphone or network request');
    const rotation = document.querySelector('[data-au05-knob-mode]');
    assert(rotation?.value === 'sessions' && ['sessions', 'scroll', 'scroll-page', 'disabled'].every(value =>
      [...rotation.options].some(option => option.value === value)), 'real Chinese panel exposes all four rotary modes with session switching as the default');
    const selectVoiceMode = async value => {
      const select = document.querySelector('[data-au05-voice-mode]');
      select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await delay();
    };
    const voiceModes = document.querySelector('[data-au05-voice-mode]');
    assert(voiceModes?.tagName === 'SELECT' && ['dsh', 'windows', 'shortcut:typeless', 'shortcut:bugu', 'custom'].every(value =>
      [...voiceModes.options].some(option => option.value === value)), 'voice dropdown exposes built-in, Windows, application presets and a separate custom mode');
    await selectVoiceMode('shortcut:bugu');
    assert(document.querySelector('[data-au05-voice-mode]').selectedOptions[0].textContent === '网易叭哥说'
      && !document.querySelector('[data-au05-preset-help]'), 'NetEase preset is selected directly without requiring users to replace their default application shortcut');
    await selectVoiceMode('custom');
    assert(document.querySelector('[data-au05-shortcut]') && !document.querySelector('[data-au05-shortcut-preset]'),
      'custom third-party shortcut has its own mode and editor, separate from application presets');
    await selectVoiceMode('dsh');
    assert(calls.length === 0 && voiceCalls.length === 0, 'voice preset and custom-mode changes stay local without microphone, Host or shortcut activation');
    const scrollAnchor = document.querySelector('[data-au05-scroll-anchor]');
    assert(scrollAnchor?.hidden && scrollAnchor.closest('[data-conversation-content]')?.dataset.conversationSession === 'fixture-A',
      'real session renderer mounts the hidden scroll anchor inside its own conversation boundary');
    document.querySelector('[data-au05-lights]').click(); await delay();
    assert(document.querySelector('[data-au05-lights]')?.checked === false
      && !document.querySelector('[data-au05-light-alerts]'), 'lamp switch retains off preference without presenting a normal pending request as a warning');
    const lightStatus = document.querySelector('[data-au05-light-status]');
    assert(!lightStatus || (lightStatus.textContent === '已请求熄灯'
      && lightStatus.title.includes('不代表物理灯') && lightStatus.title.includes('不会断开设备')),
      'any pending lamp status avoids claiming physical confirmation or device disconnection');
    assert(calls.length === 0, 'changing lamp preference before connection does not contact the device');
    document.querySelector('[data-au05-connect]').click(); await delay();
    assert(counts('au05/connect') === 1 && counts('au05/poll') === 1, 'explicit connect calls mock Host once and starts one poll');
    assert(calls[0].args.options.lights === false && calls[1].args.options.lights === false
      && calls[1].args.options.channels.every(value => value === 0), 'disabled feedback sends false and four off channels through Host RPC');
    assert(connectionText() === '已连接', 'real React displays mock Host connected state');
    assert(document.querySelector('[data-au05-connect]').disabled, 'connected state disables duplicate connect');
    const firstPoll = pendingPolls[0];
    document.querySelector('[data-au05-close]').click(); await delay();
    assert(document.querySelector('[data-au05-panel]') === null && !firstPoll.signal.aborted, 'folding product panel does not disconnect active transport');
    visibility.set(false); await delay();
    assert(document.querySelector('[data-au05-plugin]') === null, 'root view can unmount the product capsule');
    assert(!firstPoll.signal.aborted, 'root view unmount keeps the plugin-owned connection alive');
    visibility.set(true); await delay();
    assert(pill()?.getAttribute('aria-expanded') === 'false' && connectionText() === '已连接', 'root remount retains connection and resets only expansion state');
    assert(counts('au05/connect') === 1 && counts('au05/poll') === 1, 'fold and root remount never reconnect or duplicate polling');
    firstPoll.fail(); await delay(260);
    assert(connectionText() === '未连接' && pill()?.getAttribute('title')?.startsWith('设备异常 · '), 'transport fault renders the real product error state');
    assert(counts('au05/connect') === 1 && counts('au05/poll') === 1, 'transport fault never automatically reconnects');
    assert(counts('au05/disconnect') === 1, 'transport fault asks mock Host to release its owner');
    pill().click(); await delay();
    assert(document.querySelector('[data-au05-message]')?.textContent.includes('手动重新连接'), 'fault panel explains manual recovery');
    document.querySelector('[data-au05-connect]').click(); await delay();
    assert(counts('au05/connect') === 2 && counts('au05/poll') === 2, 'manual reconnect makes exactly one new connection and poll');
    const focusedContext = calls.filter(call => call.method === 'au05/poll').at(-1).args.options.context;
    assert(typeof focusedContext === 'string' && document.hasFocus(), 'offline browser has a real focused current-session input context');
    pendingPolls[1].finish({ ...hardware(), sequence: 1, overflow: false,
      events: [{ generation: 1, sequence: 1, at: Date.now(), context: focusedContext, event: 'knob.down' }] });
    await delay(240);
    assert(document.activeElement === document.querySelector('[data-composer-input]'),
      'synthetic knob event focuses only the real session-slot-owned composer textbox');
    const secondPoll = pendingPolls[2];
    document.querySelector('[data-au05-disconnect]').click(); await delay();
    assert(secondPoll.signal.aborted && connectionText() === '未连接', 'manual disconnect aborts pending poll and updates UI');
    assert(counts('au05/disconnect') === 2, 'manual disconnect calls mock Host release once');
    document.querySelector('[data-au05-connect]').click(); await delay();
    assert(counts('au05/connect') === 3 && counts('au05/poll') === 4, 'only another explicit click starts a third connection');
    let fixtureSequence = 1;
    const scrollport = document.querySelector('[data-conversation-scroll]');
    const changeRotation = async mode => {
      const select = document.querySelector('[data-au05-knob-mode]');
      select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true })); await delay();
      // Configuration invalidates the current poll context; finish it without any input.
      pendingPolls.at(-1).finish({ ...hardware(), sequence: fixtureSequence, overflow: false, events: [] });
      await delay(240);
    };
    const rotate = async event => {
      const context = calls.filter(call => call.method === 'au05/poll').at(-1).args.options.context;
      const next = ++fixtureSequence;
      pendingPolls.at(-1).finish({ ...hardware(), sequence: next, overflow: false,
        events: [{ generation: 1, sequence: next, at: Date.now(), context, event }] });
      await delay(240);
    };
    await changeRotation('scroll'); scrollport.scrollTop = 300;
    await rotate('right.pulse');
    assert(scrollport.scrollTop === 300 && counts('au05/nativeScroll') === 0,
      'offline file fixture cannot invoke desktop native wheel or fall back to DOM scrolling');
    await rotate('left.pulse');
    assert(scrollport.scrollTop === 300 && counts('au05/nativeScroll') === 0,
      'unsupported reverse rotation never injects keys or scrolls the DOM');
    await changeRotation('scroll-page'); scrollport.scrollTop = 600;
    // Headless virtual time does not reliably advance compositor smooth animations.
    // Observe the real DOM call and its geometry, not the animation's elapsed pixels.
    const pageScrolls = [], originalScrollBy = scrollport.scrollBy;
    scrollport.scrollBy = function(options) { pageScrolls.push({ ...options }); };
    await rotate('left.pulse');
    scrollport.scrollBy = originalScrollBy;
    assert(pageScrolls.length === 1 && pageScrolls[0].behavior === 'smooth'
      && pageScrolls[0].top === -Math.min(600, Math.max(120, scrollport.clientHeight * 0.8)),
      'page rotation uses current scrollport geometry for a bounded partial-screen movement');
    await changeRotation('disabled'); scrollport.scrollTop = 300;
    await rotate('right.pulse');
    assert(scrollport.scrollTop === 300 && counts('au05/connect') === 3,
      'disabled rotation does not scroll or reconnect, while the established transport remains intact');
    const finalPoll = pendingPolls.at(-1);
    await fork.dispose(); fork = null; await delay();
    assert(finalPoll.signal.aborted, 'plugin fiber unload aborts its pending poll');
    assert(counts('au05/disconnect') === 3, 'plugin fiber unload releases its mock Host owner');
    assert(ctx.slots.entries('shell.overlay').length === 0, 'plugin fiber unload removes overlay slot registration');
    assert(ctx.slots.entries('conversation.input.left').length === 1, 'plugin fiber unload removes any input bridge registration');
    assert(ctx.slots.entries('conversation.input.dock').length === 0, 'plugin fiber unload removes the hidden scroll bridge registration');
    assert(document.querySelector('[data-au05-plugin]') === null, 'plugin fiber unload removes rendered product');
    assert(current.listeners.size === 0 && statuses.listeners.size === 0 && sessions.listeners.size === 0, 'plugin fiber unload releases all controller store subscriptions');
    assert(voiceCalls.length === 0 && report.networkCalls === 0, 'fixture never requests microphone speech or network');
    await speechProvider.dispose();
    fork = ctx.plugin(product); await fork; await delay();
    assert(pill()?.getAttribute('aria-expanded') === 'false', 'product capsule still starts when optional speech namespace is absent');
    assert(counts('au05/connect') === 3 && voiceCalls.length === 0, 'optional speech absence never connects hardware or requests microphone');
    await fork.dispose(); fork = null; await delay();
    unmount(); unmount = null;
    assert(scopeSource.listeners.size === 0 && visibility.listeners.size === 0, 'renderer unmount releases fixture scope and visibility subscriptions');
    await ctx.fiber.dispose(); ctx = null;
  } catch (error) { report.errors.push(String(error.stack ?? error)); }
  finally {
    try { await fork?.dispose(); unmount?.(); await ctx?.fiber.dispose(); }
    catch (error) { report.errors.push(String(error.stack ?? error)); }
  }
  output.textContent = JSON.stringify(report);
  document.documentElement.dataset.au05Verification = report.errors.length ? 'failed' : 'passed';
}

export function prepareBrowser(runtime, repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  const shellName = fs.readdirSync(runtime).find(name => /^index-.*\.js$/.test(name));
  const shell = fs.readFileSync(path.join(runtime, shellName), 'utf8');
  const cut = shell.lastIndexOf('const Ls=globalThis.dshDesktopBoot');
  if (cut === -1 || !shell.includes('function OZ(){return{react:')) throw new Error('Installed shell layout changed; refuse unsafe transform');
  const identity = JSON.parse(fs.readFileSync(path.join(runtime, 'identity.json'), 'utf8'));
  fs.writeFileSync(path.join(runtime, 'fixture-shell.js'), shell.slice(0, cut)
    + `\n(${browserVerify.toString()})(OZ(), ${JSON.stringify(identity)});\n`);
  fs.copyFileSync(path.join(repo, 'packages/dsh-plugin/client.js'), path.join(runtime, 'preview.js'));
  fs.writeFileSync(path.join(runtime, 'verify.html'), `<!doctype html><meta charset="utf-8"><title>AU05 offline compatibility fixture</title>
<div id="fixture"></div><pre id="report">pending</pre><script>
window.fetch=()=>{throw new Error('network forbidden')};
window.WebSocket=class {constructor(){throw new Error('WebSocket forbidden')}};
window.__ModuleLoader__={mode:'queue',pendingQueue:[],load(value){this.pendingQueue.push(value)}};
window.addEventListener('error',event=>{document.getElementById('report').textContent=JSON.stringify({errors:[event.message]})});
</script><script src="modules.js"></script><script src="renderer.js"></script><script src="preview.js"></script>
<script type="module" src="fixture-shell.js"></script>`);
  return path.join(runtime, 'verify.html');
}

export function runBrowser(runtime, edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') {
  const html = prepareBrowser(runtime);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'au05-edge-fixture-'));
  const child = spawnSync(edge, ['--headless', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-background-networking', '--allow-file-access-from-files', `--user-data-dir=${profile}`,
    '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(html).href],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  if (child.error) throw child.error;
  fs.writeFileSync(path.join(runtime, 'browser-result.html'), child.stdout ?? '');
  const raw = child.stdout?.match(/<pre id="report">(.*?)<\/pre>/s)?.[1];
  const decoded = raw?.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  if (!decoded || decoded === 'pending') throw new Error(`Browser fixture did not finish: ${child.stderr?.slice(-2000)}`);
  const report = JSON.parse(decoded);
  fs.writeFileSync(path.join(runtime, 'verification-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, artifactDir: runtime }, null, 2));
  if (child.status !== 0 || report.errors?.length) process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--extract') console.log(extractRuntime(process.argv[3]));
  else if (process.argv[2] === '--browser' && process.argv[3]) runBrowser(process.argv[3], process.argv[4]);
  else if (process.argv[2] === '--verify') runBrowser(extractRuntime(process.argv[3]), process.argv[4]);
  else { console.error('Usage: installed Electron (ELECTRON_RUN_AS_NODE=1) scripts/verify-plugin.mjs --verify [app.asar] [msedge.exe]\nOr: node scripts/verify-plugin.mjs --browser <extracted-dir> [msedge.exe]'); process.exitCode = 2; }
}
