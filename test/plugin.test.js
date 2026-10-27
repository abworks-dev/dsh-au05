import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('official-format lazy module registers read-only composer decoration', async () => {
  const source = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
  let registration;
  const sandbox = { window: { __ModuleLoader__: { load(value) { registration = value; } } } };
  vm.runInNewContext(source, sandbox);
  assert.equal(registration.id, '@abworks/dsh-plugin-au05');
  const React = { createElement: (...args) => args };
  const plugin = registration.factory(name => { assert.equal(name, 'react'); return React; });
  let Component;
  plugin.apply({ effect(callback) { callback(); }, slots: { inject(name, callback) { assert.equal(name, 'conversation.composer.dock'); callback(); },
    register(options, component) { assert.equal(options.id, 'au05-preview'); Component = component; } } });
  for (const [state, expected] of [[undefined, 'unknown'], [{ running: undefined }, 'unknown'],
    [{ running: false }, 'idle'], [{ running: true }, 'running'],
    [{ running: true, pendingInteraction: { kind: 'approval' } }, 'approval'],
    [{ pendingInteraction: { kind: 'question' } }, 'interaction']]) {
    const result = Component({ sessionId: 'A', useSessionStatus: selector => selector(new Map([['A', state]])) });
    assert.equal(result[2][2], `AU05 preview · ${expected} · controls off`);
  }
  const statuses = new Map([['B', { running: true }], ['A', { running: false }]]);
  assert.equal(Component({ sessionId: 'A', useSessionStatus: selector => selector(statuses) })[2][2],
    'AU05 preview · idle · controls off', 'never fall back to the first session');
  const absent = Component({ sessionId: undefined, useSessionStatus: selector => selector(statuses) });
  assert.equal(absent[2][2], 'AU05 preview · unknown · controls off', 'no explicit session means unknown');
  assert.equal(absent[0], 'div');
  assert.equal(Object.keys(absent[1]).some(name => /^on[A-Z]/.test(name)), false,
    'read-only status exposes no input or approval event handler');
  assert.doesNotMatch(source, /localStorage|sessionStorage|(?:inputActions|uiSession|session|approval)\.(?:submit|cancel|answer|prompt|command)\(/,
    'observer must not persist tokens or invoke session control');
});
test('plugin manifest points only at published files', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/dsh-plugin/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  for (const path of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE'])
    assert.ok((await readFile(new URL(`../packages/dsh-plugin/${path}`, import.meta.url))).length);
});
