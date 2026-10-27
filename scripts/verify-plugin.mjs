// Read-only compatibility verifier. Never installs, configures, opens sessions, or invokes hardware.
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

// Runs in a disposable file:// page, with installed runtime code but synthetic status/session data.
async function browserVerify(seeds, identity) {
  const report = { fixture: 'installed-runtime/synthetic-session/offline-file', liveGuiInstalled: false,
    identity, react: seeds.react.version, passed: [], errors: [], networkCalls: 0 };
  const assert = (value, label) => { if (!value) throw new Error(label); report.passed.push(label); };
  const delay = () => new Promise(resolve => setTimeout(resolve, 30));
  const output = document.getElementById('report');
  try {
    const registrations = window.__ModuleLoader__.pendingQueue;
    const bootstrap = registrations.shift();
    const bootstrapExports = bootstrap.factory(() => { throw new Error('unexpected bootstrap require'); });
    const modules = bootstrapExports.createClientModuleSystem(window.__ModuleLoader__,
      { id: bootstrap.id, exports: bootstrapExports }, {
        boot: { rev: 'offline-fixture', release: identity, entries: [], batches: [] },
        staticModules: seeds,
        loadBundle: async () => { report.networkCalls++; throw new Error('network forbidden'); },
      });
    const renderer = await modules.import('@deepseek-ai/dsh-client-ui-renderer/client');
    const preview = await modules.import('@abworks/dsh-plugin-au05/client');
    assert(preview === await modules.import('@abworks/dsh-plugin-au05'), 'real module loader resolves and memoizes /client');
    const { Context } = seeds['@deepseek-ai/cordis'];
    const ctx = new Context();
    renderer.apply(ctx);
    ctx.reflect.provide('uiSession', {});
    let statuses = new Map();
    const listeners = new Set();
    const statusSource = { getSnapshot: () => statuses,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
    ctx.slots.provideRoot({ hooks: { sessionStatus: statusSource } });
    const binding = { key: 'fixture-A', ctx, hooks: {}, keyedHooks: {}, props: { sessionId: 'fixture-A' } };
    const bindingSource = { getSnapshot: () => binding, subscribe: () => () => {} };
    ctx.slots.installScope('session', { current: bindingSource, bindingSource: () => bindingSource,
      renderArea: (_binding, props) => props.children });
    const h = seeds.react.createElement;
    const child = ({ renderSlot }) => renderSlot('conversation.composer.dock', {});
    ctx.slots.register({ name: 'root', id: 'fixture-root', children: {
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
    } }, ({ SessionProvider, renderSlot }) => h(SessionProvider, { session: 'fixture-A' }, h(child, { renderSlot })));
    const fork = ctx.plugin(preview);
    await delay();
    assert(ctx.slots.entries('conversation.composer.dock').length === 1, 'real slots.inject/register mounted one preview');
    const unmount = ctx.uiRenderer.mount(document.getElementById('fixture'));
    for (const [state, label] of [[undefined, 'unknown'], [{ running: undefined }, 'unknown'],
      [{ running: false }, 'idle'], [{ running: true }, 'running'],
      [{ running: true, pendingInteraction: { kind: 'approval' } }, 'approval'],
      [{ pendingInteraction: { kind: 'question' } }, 'interaction']]) {
      // The first entry deliberately disagrees; only slot-bound fixture-A may be observed.
      statuses = new Map([['fixture-B', { running: label !== 'running' }], ['fixture-A', state]]);
      for (const listener of listeners) listener();
      await delay();
      assert(document.querySelector('[role=status]')?.textContent === `AU05 preview · ${label} · HID off`, `real React/slot status: ${label}`);
    }
    assert(listeners.size > 0, 'selector hook subscribed to the actual root status source');
    await fork.dispose();
    await delay();
    assert(ctx.slots.entries('conversation.composer.dock').length === 0, 'plugin fiber unload removes slot registration');
    assert(document.querySelector('[role=status]') === null, 'plugin fiber unload removes rendered preview');
    assert(listeners.size === 0, 'plugin fiber unload releases status subscription');
    assert(report.networkCalls === 0, 'zero bundle network calls');
    unmount();
    await ctx.fiber.dispose();
  } catch (error) { report.errors.push(String(error.stack ?? error)); }
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
