import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeShortcut, ShortcutVoiceBridge } from '../packages/dsh-plugin/host/shortcut-voice.js';

const EXE = 'C:\\Users\\Test\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe';
const failure = (error, notSent = true) => ({ activated: false, error, ...(notSent ? { notSent: true } : {}) });
function fixture(options = {}) {
  let time = 1000, current = true, spawned = 0, args, spawnOptions, serial = 0;
  const timers = new Map();
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough();
  child.writes = []; child.kills = 0;
  child.stdin.on('data', chunk => child.writes.push(chunk.toString()));
  child.kill = () => { child.kills++; };
  const bridge = new ShortcutVoiceBridge({ platform: 'win32', expectedExe: EXE, now: () => time,
    schedule: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; },
    cancelTimer: id => timers.delete(id),
    spawnChild: (command, values, settings) => { assert.equal(command, 'pwsh'); spawned++; args = values; spawnOptions = settings; return child; },
    ...options });
  return { bridge, child, timers,
    open: (shortcut = 'RightAlt') => bridge.open({ shortcut, isCurrent: () => current, expiresAt: 6000 }),
    line: item => child.stdout.write(JSON.stringify(item) + '\n'), invalidate: () => { current = false; },
    advance: value => { time = value; },
    tick: () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); },
    get spawned() { return spawned; }, get args() { return args; }, get spawnOptions() { return spawnOptions; } };
}

test('after-go timeout and native partial-error remain uncertain two-field results', async () => {
  for (const native of [false, true]) {
    const f = fixture(); const pending = f.open(); f.line({ type: 'ready' });
    if (native) f.line({ activated: false, error: 'shortcut_voice_input_failed' });
    else { f.advance(6000); f.tick(); }
    assert.deepEqual(await pending, failure(native ? 'shortcut_voice_input_failed' : 'shortcut_voice_timeout', false));
  }
});

test('normalizer accepts RightAlt and canonicalizes only the documented chord grammar', () => {
  for (const value of ['RightAlt', 'rightalt', ' RIGHTALT ']) assert.equal(normalizeShortcut(value), 'RightAlt');
  for (const [value, expected] of [['shift+ctrl+f8', 'Ctrl+Shift+F8'], [' alt + SHIFT + 7 ', 'Alt+Shift+7'],
    ['shift+space', 'Shift+Space'], ['Ctrl+b', 'Ctrl+B'], ['F24', 'F24'], ['f1', 'F1']]) assert.equal(normalizeShortcut(value), expected);
  for (let key = 1; key <= 24; key++) assert.equal(normalizeShortcut(`f${key}`), `F${key}`);
  for (const key of 'BDEFGHIJKMU0123456789') assert.equal(normalizeShortcut(`Ctrl+${key}`), `Ctrl+${key}`);
  for (let mask = 0; mask < 8; mask++) {
    const modifiers = ['Ctrl', 'Alt', 'Shift'].filter((_, index) => mask & (1 << index));
    assert.equal(normalizeShortcut([...modifiers.toReversed(), 'F8'].join('+')), [...modifiers, 'F8'].join('+'));
  }
});

test('normalizer rejects unsafe shortcuts, naked typing, duplicates, aliases and command syntax', () => {
  const rejected = [null, undefined, 5, {}, [], '', ' ', 'A', '0', 'Space', 'Right Alt', 'AltRight', 'RAlt', 'Ctrl+RightAlt',
    'Win+H', 'Meta+F8', 'Cmd+F8', 'Fn', 'Fn+F8', 'Control+F8', 'Ctrl', 'Alt', 'Shift', 'Ctrl+Ctrl+F8', 'ctrl+CTRL+F8',
    'Ctrl+Shift+Alt+Shift+F8', 'Ctrl++F8', '+F8', 'F8+', 'F8+Ctrl', 'Ctrl+Enter', 'Esc', 'Alt+Tab', 'Ctrl+Delete',
    'F0', 'F25', 'F01', 'F+8', 'Ctrl+F4', 'Alt+F4', 'Ctrl+Alt+Shift+F4', 'Alt+Shift+F4', 'Ctrl+Shift+F4',
    'Ctrl+F8;whoami', 'Ctrl+F8\nwhoami', 'Ctrl+F8,F9', 'Ctrl+F8&&calc', 'x'.repeat(65)];
  for (const key of 'WQRLTNOPSCVXAZY') for (const modifier of ['Ctrl', 'Ctrl+Shift', 'Alt+Ctrl', 'Shift+Alt+Ctrl']) rejected.push(`${modifier}+${key}`);
  for (const value of rejected) assert.throws(() => normalizeShortcut(value), { name: 'TypeError', message: 'invalid_shortcut' }, String(value));
});

test('construction, cancel and disposal are inert without open', () => {
  const f = fixture(); f.bridge.cancel(); f.bridge.dispose(); f.bridge.dispose(); assert.equal(f.spawned, 0); assert.equal(f.timers.size, 0);
});

test('invalid platform, request, shortcut, client, expiry and stale context never spawn', async () => {
  const f = fixture({ platform: 'linux' }); assert.deepEqual(await f.open(), failure('shortcut_voice_unsupported_platform')); assert.equal(f.spawned, 0);
  const g = fixture();
  assert.deepEqual(await g.bridge.open(), failure('shortcut_voice_invalid_request'));
  for (const expiresAt of [NaN, Infinity, 1.5, undefined]) assert.deepEqual(await g.bridge.open({ shortcut: 'RightAlt', isCurrent: () => true, expiresAt }), failure('shortcut_voice_invalid_request'));
  for (const shortcut of [undefined, 'Ctrl+V', 'Win+H', 'Space']) assert.deepEqual(await g.open(shortcut === undefined ? null : shortcut), failure('shortcut_voice_invalid_shortcut'));
  assert.deepEqual(await g.bridge.open({ shortcut: 'RightAlt', isCurrent: () => true, expiresAt: 1000 }), failure('shortcut_voice_expired'));
  g.invalidate(); assert.deepEqual(await g.open(), failure('shortcut_voice_cancelled')); assert.equal(g.spawned, 0);
  for (const expectedExe of ['', null, 'relative.exe', '\\\\server\\share\\app.exe']) {
    const h = fixture({ expectedExe }); assert.deepEqual(await h.open(), failure('shortcut_voice_unsupported_client')); assert.equal(h.spawned, 0);
  }
  for (const isCurrent of [() => 1, () => { throw new Error('private'); }]) {
    const h = fixture(); assert.deepEqual(await h.bridge.open({ shortcut: 'RightAlt', isCurrent, expiresAt: 6000 }), failure('shortcut_voice_cancelled')); assert.equal(h.spawned, 0);
  }
});

test('host install path and allowlisted environment cannot be overridden by open arguments', async () => {
  const f = fixture({ expectedExe: undefined, env: { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local', SECRET: 'never forward' } });
  const pending = f.bridge.open({ shortcut: 'shift+ctrl+f8', isCurrent: () => true, expiresAt: 6000,
    expectedExe: 'C:\\evil.exe', command: 'evil', keys: [65], env: { SECRET: 'evil' } });
  assert.equal(f.args[f.args.indexOf('-ExpectedExe') + 1], EXE); assert.equal(f.spawnOptions.env.SECRET, undefined);
  assert.equal(f.args[f.args.indexOf('-Shortcut') + 1], 'Ctrl+Shift+F8');
  assert.match(f.args[f.args.indexOf('-File') + 1], /[/\\]native[/\\]shortcut-voice\.ps1$/);
  assert.equal(f.spawnOptions.shell, false); assert.equal(f.spawnOptions.windowsHide, true);
  assert.deepEqual(f.spawnOptions.stdio, ['pipe', 'pipe', 'ignore']);
  assert.equal(f.args[f.args.indexOf('-Mode') + 1], 'Invoke');
  assert.equal(f.args[f.args.indexOf('-ExpiresAt') + 1], '6000');
  f.bridge.cancel(); assert.deepEqual(await pending, failure('shortcut_voice_cancelled'));
});

test('two-phase protocol writes exactly one fixed authorization after ready', async () => {
  const f = fixture(); const pending = f.open(); assert.deepEqual(f.child.writes, []);
  f.child.stdout.write('{"type":'); f.child.stdout.write('"ready"}\r\n'); assert.deepEqual(f.child.writes, ['go\n']);
  f.line({ activated: true, error: null }); assert.deepEqual(await pending, { activated: true, error: null });
  assert.equal(f.child.kills, 1); assert.equal(f.child.stdin.destroyed, true); assert.equal(f.bridge.operation, null); assert.equal(f.timers.size, 0);
});

test('ready rechecks both current context and deadline after compilation', async () => {
  const f = fixture(); const pending = f.open(); f.invalidate(); f.line({ type: 'ready' });
  assert.deepEqual(await pending, failure('shortcut_voice_cancelled')); assert.deepEqual(f.child.writes, []);
  const g = fixture(); const active = g.bridge.open({ shortcut: 'F8', isCurrent: () => true, expiresAt: 999999 });
  assert.equal(g.args[g.args.indexOf('-ExpiresAt') + 1], '6000'); g.advance(6000); g.line({ type: 'ready' });
  assert.deepEqual(await active, failure('shortcut_voice_expired')); assert.deepEqual(g.child.writes, []);
});

test('watchdog bounds cancellation without native output and never extends the deadline', async () => {
  const f = fixture(); const pending = f.open(); assert.equal([...f.timers.values()][0].delay, 50);
  f.advance(1025); f.tick(); assert.equal(f.timers.size, 1);
  f.invalidate(); f.tick(); assert.deepEqual(await pending, failure('shortcut_voice_cancelled'));
  assert.equal(f.child.kills, 1); assert.equal(f.child.stdin.destroyed, true); assert.equal(f.timers.size, 0); assert.deepEqual(f.child.writes, []);
  const g = fixture(); const active = g.open(); g.advance(6000); g.tick();
  assert.deepEqual(await active, failure('shortcut_voice_timeout')); assert.equal(g.timers.size, 0);
  const h = fixture({ timeoutMs: 100 }); const short = h.open(); assert.equal(h.args[h.args.indexOf('-ExpiresAt') + 1], '1100');
  h.advance(1090); h.tick(); assert.equal([...h.timers.values()][0].delay, 10); h.advance(1100); h.tick();
  assert.deepEqual(await short, failure('shortcut_voice_timeout'));
});

test('cancel before ready or after authorization closes owned process and rejects late success', async () => {
  for (const ready of [false, true]) {
    const f = fixture(); const pending = f.open(); if (ready) f.line({ type: 'ready' }); f.bridge.cancel();
    f.line({ type: 'ready' }); f.line({ activated: true, error: null });
    assert.deepEqual(await pending, failure('shortcut_voice_cancelled', !ready)); assert.deepEqual(f.child.writes, ready ? ['go\n'] : []);
    assert.equal(f.child.kills, 1); assert.equal(f.child.stdin.destroyed, true); assert.equal(f.timers.size, 0);
  }
});

test('busy, disposal and all process/pipe failures return closed errors and clean up', async () => {
  const f = fixture(); const pending = f.open(); assert.deepEqual(await f.open('F8'), failure('shortcut_voice_busy'));
  f.bridge.dispose(); assert.deepEqual(await pending, failure('shortcut_voice_cancelled')); assert.deepEqual(await f.open(), failure('shortcut_voice_disposed'));
  const g = fixture({ spawnChild: () => { throw new Error('private spawn detail'); } }); assert.deepEqual(await g.open(), failure('shortcut_voice_start_failed'));
  for (const [target, event, code] of [['child', 'error', 'start_failed'], ['child', 'close', 'native_failed'],
    ['stdin', 'error', 'native_failed'], ['stdout', 'error', 'native_failed']]) {
    const h = fixture(); const active = h.open(); (target === 'child' ? h.child : h.child[target]).emit(event, new Error('private detail'));
    assert.deepEqual(await active, failure(`shortcut_voice_${code}`)); assert.equal(h.child.kills, 1); assert.equal(h.timers.size, 0);
  }
  const h = fixture(); h.child.stdin.write = () => { throw new Error('private write detail'); };
  const active = h.open(); h.line({ type: 'ready' }); assert.deepEqual(await active, failure('shortcut_voice_native_failed', false));
});

test('native error codes are closed, sanitized and cannot smuggle paths or raw diagnostics', async () => {
  for (const code of ['expired', 'cancelled', 'invalid_request', 'invalid_shortcut', 'unsupported_platform', 'foreground_mismatch',
    'focus_not_editable', 'modifiers_down', 'input_failed', 'native_failed']) {
    const f = fixture(); const pending = f.open(); f.line({ activated: false, error: `shortcut_voice_${code}` });
    assert.deepEqual(await pending, failure(`shortcut_voice_${code}`)); assert.deepEqual(f.child.writes, []);
  }
  for (const value of [{ activated: false, error: 'C:\\private\\secret' }, { activated: false, error: 'shortcut_voice_unknown' },
    { activated: false, error: 'windows_voice_input_failed' }, { activated: false, error: null }, { activated: true, error: null },
    { activated: 'true', error: null }, { type: 'ready', path: EXE }, { type: 'ready', activated: false }, null, [], true]) {
    const f = fixture(); const pending = f.open(); f.line(value);
    assert.deepEqual(await pending, failure('shortcut_voice_protocol_error')); assert.deepEqual(f.child.writes, []);
  }
});

test('duplicate ready and oversized, empty or malformed output never create another tap', async () => {
  const f = fixture(); const pending = f.open(); f.line({ type: 'ready' }); f.line({ type: 'ready' });
  assert.deepEqual(await pending, failure('shortcut_voice_protocol_error', false)); assert.deepEqual(f.child.writes, ['go\n']);
  for (const output of ['x'.repeat(1025), '{invalid}\n', '\n', JSON.stringify({ type: 'x'.repeat(257) }) + '\n']) {
    const g = fixture(); const active = g.open(); g.child.stdout.write(output); assert.deepEqual(await active, failure('shortcut_voice_protocol_error'));
  }
});

test('context is rechecked on success and reentrant cancel/dispose never commits a tap', async () => {
  const f = fixture(); const pending = f.open(); f.line({ type: 'ready' }); f.invalidate(); f.line({ activated: true, error: null });
  assert.deepEqual(await pending, failure('shortcut_voice_cancelled', false));
  for (const action of ['cancel', 'dispose']) {
    const g = fixture(); let checks = 0;
    const active = g.bridge.open({ shortcut: 'F8', expiresAt: 6000, isCurrent: () => { if (++checks > 1) g.bridge[action](); return true; } });
    g.line({ type: 'ready' }); assert.deepEqual(await active, failure('shortcut_voice_cancelled')); assert.deepEqual(g.child.writes, []);
  }
  const h = fixture();
  assert.deepEqual(await h.bridge.open({ shortcut: 'F8', expiresAt: 6000, isCurrent: () => { h.bridge.dispose(); return true; } }), failure('shortcut_voice_cancelled'));
  assert.equal(h.spawned, 0);
});

test('native source exposes no arbitrary key/byte API and default SelfTest is purely synthetic', () => {
  const source = readFileSync(new URL('../packages/dsh-plugin/native/shortcut-voice.ps1', import.meta.url), 'utf8');
  assert.match(source, /^[\x00-\x7F]*$/); assert.match(source, /\$Mode = 'SelfTest'/);
  const pureHelpers = source.slice(source.indexOf('static void Check(bool'), source.indexOf("'@"));
  assert.doesNotMatch(pureHelpers, /Activate\(|SendInput\(|Editable\(|GetForegroundWindow\(|Invoke\(|GetAsyncKeyState\(|GetStdHandle\(|ReadFile\(|PeekNamedPipe\(/);
  assert.doesNotMatch(source, /GetText\(|Clipboard|SetForegroundWindow|SetFocus\(|SendKeys|\.Current\.Value|CommandLine|GetTokenInformation/);
  assert.doesNotMatch(source, /public static (?:INPUT|ushort\[\]|void (?:Activate|Key|Tap|Recovery))/);
  assert.match(source, /public static void Invoke\(long expiresAt, string expectedExe, string shortcut, bool bageshuoCrossAppEnabled = false\)/);
  assert.match(source, /bageshuoCrossAppEnabled && shortcut != "RightAlt"/);
  assert.match(source, /ushort\[\] chord = ParseShortcut\(shortcut\)/);
  assert.match(source, /TextPattern\.IsReadOnlyAttribute/); assert.match(source, /info\.IsPassword/);
  assert.match(source, /StringComparison\.OrdinalIgnoreCase/); assert.match(source, /info\.ProcessId != \(int\)pid/);
  assert.match(source, /window != originalWindow/); assert.match(source, /Automation\.Compare\(focused, originalFocus\)/);
  assert.match(source, /ancestor\.Current\.NativeWindowHandle/);
  assert.match(source, /foreach \(ushort key in chord\) if \(\(GetAsyncKeyState\(key\) & 0x8000\)/);
  assert.match(source, /key == RIGHTALT \? EXTENDED : 0/); assert.match(source, /INPUT\[\] releases = Recovery\(chord, inserted\)/);
});

test('actual Windows default native SelfTest compiles offline, no Invoke or live input', { skip: process.platform !== 'win32' }, () => {
  const script = fileURLToPath(new URL('../packages/dsh-plugin/native/shortcut-voice.ps1', import.meta.url));
  const run = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(run.status, 0, run.error?.code || 'native SelfTest failed');
  assert.deepEqual(JSON.parse(run.stdout.trim()), { activated: false, error: null }); assert.equal(run.stderr, '');
});
