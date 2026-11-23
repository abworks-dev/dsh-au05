import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Opt-in: the extractor only writes to os.tmpdir(), not the live DSH profile.
// Installed-code product fixture with in-memory Host RPC, NOT a live GUI or hardware test.
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
  assert.equal(report.fixture, 'installed-runtime/product/mock-host-rpc/offline-file');
  assert.equal(report.mockHostRpc, true);
  assert.equal(report.liveGuiInstalled, false);
  for (const label of ['real root overlay slots.inject/register mounted one product capsule',
    'product capsule defaults to collapsed',
    'product activation is lazy and makes no Host RPC',
    'opening panel makes no device microphone or network request',
    'real session slot renderer forwards standard sessionId',
    'real session slot renderer does not leak parent-private keyboard',
    'real React attaches the hidden session input anchor inside its unique composer card',
    'synthetic knob event focuses only the real session-slot-owned composer textbox',
    'explicit connect calls mock Host once and starts one poll',
    'fold and root remount never reconnect or duplicate polling',
    'transport fault never automatically reconnects',
    'manual disconnect aborts pending poll and updates UI',
    'plugin fiber unload removes overlay slot registration',
    'plugin fiber unload releases all controller store subscriptions',
    'renderer unmount releases fixture scope and visibility subscriptions']) assert.ok(report.passed.includes(label), label);
  assert.match(report.identity.version, /^\d+\.\d+\.\d+/);
});
