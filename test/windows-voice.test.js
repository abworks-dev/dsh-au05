import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WindowsVoiceBridge } from '../packages/dsh-plugin/host/windows-voice.js';

const EXE = 'C:\\Users\\Test\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe';
function fixture(options = {}) {
  let time = 1000, current = true, timer, spawned = 0, args, spawnOptions;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough();
  child.writes = []; child.kills = 0;
  child.stdin.on('data', chunk => child.writes.push(chunk.toString()));
  child.kill = () => { child.kills++; };
  const bridge = new WindowsVoiceBridge({ platform: 'win32', expectedExe: EXE, now: () => time,
    schedule: callback => { timer = callback; return 1; }, cancelTimer: () => { timer = null; },
    spawnChild: (command, values, settings) => { assert.equal(command, 'pwsh'); spawned++; args = values; spawnOptions = settings; return child; },
    ...options });
  return { bridge, child, open: () => bridge.open({ isCurrent: () => current, expiresAt: 6000 }),
    line: item => child.stdout.write(JSON.stringify(item) + '\n'), invalidate: () => { current = false; },
    advance: value => { time = value; }, timeout: () => timer(),
    get spawned() { return spawned; }, get args() { return args; }, get spawnOptions() { return spawnOptions; } };
}
const failure = error => ({ activated: false, error });

test('construction, cancellation and disposal are inert without explicit open', () => {
  const f = fixture(); f.bridge.cancel(); f.bridge.dispose(); assert.equal(f.spawned, 0);
});

test('unsupported platform, invalid request, expired and stale context never spawn', async () => {
  const f = fixture({ platform: 'linux' }); assert.deepEqual(await f.open(), failure('windows_voice_unsupported_platform')); assert.equal(f.spawned, 0);
  const g = fixture();
  assert.deepEqual(await g.bridge.open(), failure('windows_voice_invalid_request'));
  assert.deepEqual(await g.bridge.open({ isCurrent: () => true, expiresAt: 1000 }), failure('windows_voice_expired'));
  g.invalidate(); assert.deepEqual(await g.open(), failure('windows_voice_cancelled')); assert.equal(g.spawned, 0);
  const h = fixture({ expectedExe: 'relative.exe' }); assert.deepEqual(await h.open(), failure('windows_voice_unsupported_client')); assert.equal(h.spawned, 0);
});

test('default expected path comes from host LOCALAPPDATA and ignores open path injection', async () => {
  const f = fixture({ expectedExe: undefined, env: { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local', SECRET: 'never forward' } });
  const pending = f.bridge.open({ isCurrent: () => true, expiresAt: 6000, expectedExe: 'C:\\evil.exe', command: 'evil' });
  assert.equal(f.args.at(-1), EXE); assert.equal(f.spawnOptions.env.SECRET, undefined);
  assert.equal(f.spawnOptions.shell, false); assert.deepEqual(f.spawnOptions.stdio, ['pipe', 'pipe', 'ignore']);
  assert.equal(f.args[f.args.indexOf('-Mode') + 1], 'Invoke'); assert.equal(f.args[f.args.indexOf('-ExpiresAt') + 1], '6000');
  f.bridge.cancel(); assert.deepEqual(await pending, failure('windows_voice_cancelled'));
});

test('two-phase protocol writes one fixed go only after ready and returns sanitized success', async () => {
  const f = fixture(); const pending = f.open(); assert.deepEqual(f.child.writes, []);
  f.child.stdout.write('{"type":'); f.child.stdout.write('"ready"}\n'); assert.deepEqual(f.child.writes, ['go\n']);
  f.line({ activated: true, error: null }); assert.deepEqual(await pending, { activated: true, error: null });
  assert.equal(f.child.kills, 1); assert.equal(f.child.stdin.destroyed, true); assert.equal(f.bridge.operation, null);
});

test('context is rechecked after compilation and stale ready cannot authorize input', async () => {
  const f = fixture(); const pending = f.open(); f.invalidate(); f.line({ type: 'ready' });
  assert.deepEqual(await pending, failure('windows_voice_cancelled')); assert.deepEqual(f.child.writes, []);
});

test('deadline is rechecked after compilation and long requested expiry is clamped', async () => {
  const f = fixture(); const pending = f.bridge.open({ isCurrent: () => true, expiresAt: 999999 });
  assert.equal(f.args[f.args.indexOf('-ExpiresAt') + 1], '6000'); f.advance(6000); f.line({ type: 'ready' });
  assert.deepEqual(await pending, failure('windows_voice_expired')); assert.deepEqual(f.child.writes, []);
});

test('cancel before ready kills owned child and suppresses late native ready/success', async () => {
  const f = fixture(); const pending = f.open(); f.bridge.cancel();
  f.line({ type: 'ready' }); f.line({ activated: true, error: null });
  assert.deepEqual(await pending, failure('windows_voice_cancelled')); assert.deepEqual(f.child.writes, []); assert.equal(f.child.kills, 1);
});

test('cancel after authorization never accepts late activation and closes pipe', async () => {
  const f = fixture(); const pending = f.open(); f.line({ type: 'ready' }); f.bridge.cancel(); f.line({ activated: true, error: null });
  assert.deepEqual(await pending, failure('windows_voice_cancelled')); assert.deepEqual(f.child.writes, ['go\n']); assert.equal(f.child.stdin.destroyed, true);
});

test('busy, timeout, disposal and process failures are bounded and cleaned up', async () => {
  const f = fixture(); const pending = f.open(); assert.deepEqual(await f.open(), failure('windows_voice_busy')); f.timeout();
  assert.deepEqual(await pending, failure('windows_voice_timeout')); assert.equal(f.child.kills, 1);
  const g = fixture(); const active = g.open(); g.bridge.dispose(); assert.deepEqual(await active, failure('windows_voice_cancelled'));
  assert.deepEqual(await g.open(), failure('windows_voice_disposed'));
  const h = fixture(); const failed = h.open(); h.child.emit('error', new Error('private process detail'));
  assert.deepEqual(await failed, failure('windows_voice_start_failed'));
  const i = fixture({ spawnChild: () => { throw new Error('private spawn detail'); } });
  assert.deepEqual(await i.open(), failure('windows_voice_start_failed'));
});

test('native failures are closed codes and never expose text or paths', async () => {
  const f = fixture(); const pending = f.open(); f.line({ activated: false, error: 'windows_voice_focus_not_editable' });
  assert.deepEqual(await pending, failure('windows_voice_focus_not_editable')); assert.deepEqual(f.child.writes, []);
  for (const value of [{ activated: false, error: 'C:\\private\\secret' }, { activated: true, error: null }, { type: 'ready', path: EXE }, null, []]) {
    const g = fixture(); const active = g.open(); g.line(value);
    assert.deepEqual(await active, failure('windows_voice_protocol_error')); assert.deepEqual(g.child.writes, []);
  }
});

test('duplicate ready cannot send repeated shortcuts; oversized and malformed output fail closed', async () => {
  const f = fixture(); const pending = f.open(); f.line({ type: 'ready' }); f.line({ type: 'ready' });
  assert.deepEqual(await pending, failure('windows_voice_protocol_error')); assert.deepEqual(f.child.writes, ['go\n']);
  for (const output of ['x'.repeat(1025), '{invalid}\n', '\n']) {
    const g = fixture(); const active = g.open(); g.child.stdout.write(output); assert.deepEqual(await active, failure('windows_voice_protocol_error'));
  }
});

test('reentrant cancellation during isCurrent callback never sends authorization', async () => {
  const f = fixture(); let checks = 0;
  const pending = f.bridge.open({ expiresAt: 6000, isCurrent: () => { if (++checks > 1) f.bridge.cancel(); return true; } });
  f.line({ type: 'ready' }); assert.deepEqual(await pending, failure('windows_voice_cancelled')); assert.deepEqual(f.child.writes, []);
});

test('disposal during initial current check cannot spawn a child', async () => {
  const f = fixture();
  const output = await f.bridge.open({ expiresAt: 6000, isCurrent: () => { f.bridge.dispose(); return true; } });
  assert.deepEqual(output, failure('windows_voice_cancelled')); assert.equal(f.spawned, 0);
});

test('native script stays ASCII and SelfTest has no input/UI calls', () => {
  const source = readFileSync(new URL('../packages/dsh-plugin/native/windows-voice.ps1', import.meta.url), 'utf8');
  assert.match(source, /^[\x00-\x7F]*$/); assert.match(source, /\$Mode = 'SelfTest'/);
  const selftest = source.slice(source.indexOf('public static void SelfTest()'), source.indexOf("'@"));
  assert.doesNotMatch(selftest, /Activate\(|SendInput\(|Editable\(|GetForegroundWindow\(|Invoke\(/);
  assert.doesNotMatch(source, /GetText\(|Clipboard|SetForegroundWindow|SendKeys|\.Current\.Value|CommandLine|GetTokenInformation/);
  assert.match(source, /TextPattern\.IsReadOnlyAttribute/); assert.match(source, /info\.IsPassword/);
  assert.match(source, /StringComparison\.OrdinalIgnoreCase/); assert.match(source, /info\.ProcessId != \(int\)pid/);
});

test('native default SelfTest compiles offline without Invoke or WinH', { skip: process.platform !== 'win32' }, () => {
  const script = fileURLToPath(new URL('../packages/dsh-plugin/native/windows-voice.ps1', import.meta.url));
  const run = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(run.status, 0, run.error?.code || 'native SelfTest failed');
  assert.deepEqual(JSON.parse(run.stdout.trim()), { activated: false, error: null });
  assert.equal(run.stderr, '');
});
