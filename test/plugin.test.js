import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('official-format product client declares only public service faces and scoped slot contributions', async () => {
  const source = await readFile(new URL('../packages/dsh-plugin/client.js', import.meta.url), 'utf8');
  let registration;
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
  assert.equal(registration.id, '@abworks/dsh-plugin-au05');
  const plugin = registration.factory(name => { assert.equal(name, 'react'); return { createElement() {} }; });
  for (const service of ['slots', 'connection', 'sessions', 'uiSession', 'uiWorkspace', 'workspaces', 'remote'])
    assert.ok(Array.from(plugin.inject).includes(service), `missing declared service ${service}`);
  assert.match(source, /name: 'shell\.overlay', id: 'au05-device'/);
  assert.equal(typeof plugin.mountActionBridges, 'function');
  assert.ok(source.includes("function mountActionBridges(ctx, controller, { prefix = 'au05' } = {})"), 'direct bridge keeps its original default namespace');
  assert.ok(source.includes("name: 'conversation.input.left', id: `${prefix}-input-bridge`"), 'reusable bridge keeps the same public scoped slot');
  assert.match(source, /top:calc\(var\(--dsh-frame-overlay-top,20px\)/);
  assert.match(source, /z-index:1;/); assert.match(source, /max-height:calc\(100dvh/);
  assert.match(source, /var\(--dsw-alias-label-primary,CanvasText\)/);
  assert.match(source, /var\(--dsw-alias-bg-base,Canvas\)/);
  // Layer and brand tokens are declared by the live theme Inspect provider.
  assert.match(source, /var\(--dsw-alias-bg-layer-1,Canvas\)/);
  assert.match(source, /var\(--dsw-alias-brand-primary,Highlight\)/);
  assert.doesNotMatch(source, /--dsw-alias-interactive-bg-hover/);
  // Allow only the session-scoped non-keyboard suggestion request, not arbitrary
  // event injection. All other event dispatch remains forbidden.
  const suggestionRequest = /const request = new CustomEvent\('dsh:suggest-prompt:accept', \{\s*cancelable: true, detail: \{ sessionId: target\.sessionId \},\s*\}\);\s*window\.dispatchEvent\(request\);\s*if \(request\.defaultPrevented\) return;/;
  assert.match(source, suggestionRequest);
  assert.equal((source.match(/dispatchEvent\(/g) ?? []).length, 1);
  assert.doesNotMatch(source.replace(suggestionRequest, ''), /sessionStorage|document\.cookie|dispatchEvent\(|KeyboardEvent\(|window\.scroll|fetch\(/,
    'only the session-scoped suggestion event is allowed; no global key injection or credential storage');
  assert.match(source, /const voicePreferencesKey = 'abworks\.au05\.voice-preferences\.v1'/);
  assert.match(source, /pending\.answer\(answer\)/);
  assert.match(source, /approve\(target, 'allowed-once'\)/);
  assert.doesNotMatch(source, /allowed-always|allow-all|allowed-for-session/);
});

test('plugin manifest lists public runtime dependencies and publishes its real Host entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('../packages/dsh-plugin/package.json', import.meta.url), 'utf8'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/);
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-renderer'));
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  for (const path of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) {
    assert.ok(manifest.files.includes(path), `not published: ${path}`);
    assert.ok((await readFile(new URL(`../packages/dsh-plugin/${path}`, import.meta.url))).length);
  }
});
