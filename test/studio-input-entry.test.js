import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
const root = new URL('../packages/ulanzi-dsh-input/', import.meta.url);
const source = readFileSync(new URL('service.js', root), 'utf8');
test('Studio manifest uses its documented .js entry and packaging retains the tested service', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  const metadata = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.CodePath, 'service.js');
  assert.equal(metadata.type, 'commonjs');
  assert.equal(metadata.main, manifest.CodePath);
  assert.ok(metadata.files.includes('service.js'));
  assert.ok(metadata.files.includes('service.cjs'));
});
test('the entry imports passively and starts exactly once only when explicitly executed', () => {
  for (const main of [false, true]) {
    let calls = 0;
    const run = () => { calls++; };
    const module = { exports: {} };
    const require = name => { assert.equal(name, './service.cjs'); return { run }; };
    require.main = main ? module : {};
    new Script(source).runInNewContext({ module, require, process: { exitCode: 0 } });
    assert.equal(module.exports.run, run);
    assert.equal(calls, Number(main));
  }
});
test('the entry fails closed without logging pairing or exception payloads', () => {
  const module = { exports: {} }, process = { exitCode: 0 };
  let diagnostics = 0;
  const require = () => ({ run() { throw new Error('sensitive_fixture_not_logged'); },
    writeStartupFailure(...args) { assert.deepEqual(args, []); diagnostics++; } });
  require.main = module;
  new Script(source).runInNewContext({ module, require, process });
  assert.equal(process.exitCode, 1);
  assert.equal(diagnostics, 1, 'fixed startup diagnostic carries no exception or pairing payload');
});
