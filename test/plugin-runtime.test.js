import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Opt-in: the extractor only writes to os.tmpdir(), not the live DSH profile.
// This is an installed-code / synthetic-session fixture, NOT a live GUI installation test.
const runtime = process.env.AU05_DSH_RUNTIME_DIR;
test('installed DSH loader, React and slots work in an isolated offline Edge fixture', {
  skip: runtime ? false : 'Set AU05_DSH_RUNTIME_DIR to an extracted installed runtime to run the browser fixture',
  timeout: 45000,
}, () => {
  const args = ['scripts/verify-plugin.mjs', '--browser', runtime];
  if (process.env.AU05_EDGE_PATH) args.push(process.env.AU05_EDGE_PATH);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 40000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  assert.equal(report.networkCalls, 0);
  assert.ok(report.passed.length >= 13);
  assert.ok(report.passed.includes('plugin fiber unload removes slot registration'));
  assert.ok(report.passed.includes('plugin fiber unload releases status subscription'));
  assert.match(report.identity.version, /^\d+\.\d+\.\d+/);
});
