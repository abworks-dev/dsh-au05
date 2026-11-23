import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { win32 } from 'node:path';
import { readFileSync } from 'node:fs';
import { ShortcutVoiceBridge } from '../packages/dsh-plugin/host/shortcut-voice.js';

// Independent wire fixtures: never import the old test or copy its escaped paths/lines.
// No native process, SelfTest, keyboard, focus, HID, audio or UI is used.
// The old test is read as text only; it is never imported or executed.
const slash = String.fromCharCode(92);
const localAppData = win32.normalize('C:/Users/WireProbe/AppData/Local');
const normalExe = win32.join(localAppData, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe');
const LF = Buffer.from([10]);
const CRLF = Buffer.from([13, 10]);
const GO = Buffer.from([103, 111, 10]);
const failure = error => ({ activated: false, error });
const notSent = error => ({ ...failure(error), notSent: true });
const jsonLine = (item, ending = LF) => Buffer.concat([Buffer.from(JSON.stringify(item), 'utf8'), ending]);

function fixture(options = {}) {
  let time = 1000, nextId = 0, spawnCount = 0, spawnArgs, spawnOptions;
  const timers = new Map();
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kills = 0;
  child.kill = () => { child.kills++; return true; };
  const writes = [];
  child.stdin.on('data', chunk => writes.push(Buffer.from(chunk)));
  const bridge = new ShortcutVoiceBridge({
    platform: 'win32', env: { LOCALAPPDATA: localAppData }, now: () => time,
    schedule: callback => { const id = ++nextId; timers.set(id, callback); return id; },
    cancelTimer: id => timers.delete(id),
    ...options,
    // Always last: caller can never restore the actual spawn implementation.
    spawnChild: (command, args, settings) => {
      assert.equal(command, 'pwsh');
      spawnCount++; spawnArgs = args; spawnOptions = settings;
      return child;
    },
  });
  return {
    bridge, child, writes,
    open: () => bridge.open({ shortcut: 'RightAlt', isCurrent: () => true, expiresAt: 6000 }),
    expire: () => { time = 6000; const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); },
    get spawned() { return spawnCount; },
    get args() { return spawnArgs; },
    get options() { return spawnOptions; },
  };
}

test('wire fixture independently produces ordinary Windows paths and actual newline bytes', () => {
  assert.equal(win32.isAbsolute(normalExe), true);
  assert.equal(normalExe.charCodeAt(2), 92);
  assert.notEqual(normalExe.charCodeAt(3), 92);
  assert.equal(normalExe.includes(slash + slash), false);
  assert.deepEqual([...LF], [10]);
  assert.deepEqual([...CRLF], [13, 10]);
  assert.deepEqual([...GO], [103, 111, 10]);
});

test('old fixture literals decode to an ordinary path and LF, independently of display escaping', () => {
  const source = readFileSync(new URL('./shortcut-voice.test.js', import.meta.url), 'utf8');
  const exeLiteral = source.match(/^const EXE = '([^']+)';/m)?.[1];
  const lineLiteral = source.split('line: item =>')[1]?.match(/[+] '([^']+)'/)?.[1];
  assert.equal(typeof exeLiteral, 'string');
  assert.equal(typeof lineLiteral, 'string');
  // These two simple literals contain no quote escapes: JSON and JS decode
  // their backslash escapes identically. No old fixture code is evaluated.
  const oldExe = JSON.parse('"' + exeLiteral + '"');
  const oldLineEnding = JSON.parse('"' + lineLiteral + '"');
  assert.equal(oldExe, win32.join(win32.normalize('C:/Users/Test/AppData/Local'), 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'));
  assert.equal(oldExe.includes(slash + slash), false);
  assert.deepEqual([...Buffer.from(oldLineEnding, 'utf8')], [10]);
});

test('default LOCALAPPDATA executable must reach the fake child without doubled separators', async () => {
  const f = fixture();
  const pending = f.open();
  try {
    assert.equal(f.bridge.expectedExe, normalExe);
    assert.equal(f.spawned, 1, 'canonical default path must not return unsupported_client before spawn');
    assert.equal(f.args[f.args.indexOf('-ExpectedExe') + 1], normalExe);
    assert.equal(f.options.shell, false);
  } finally { f.bridge.cancel(); }
  assert.deepEqual(await pending, notSent('shortcut_voice_cancelled'));
});

test('explicit win32.normalize executable must pass the host path gate', async () => {
  const f = fixture({ expectedExe: win32.normalize(normalExe) });
  const pending = f.open();
  try {
    assert.equal(f.spawned, 1, 'canonical explicit path must be accepted');
  } finally { f.bridge.cancel(); }
  assert.deepEqual(await pending, notSent('shortcut_voice_cancelled'));
});

for (const [name, ending] of [['LF', LF], ['CRLF', CRLF]]) {
  test(`native ready/result with actual ${name} bytes must complete two-phase authorization`, async () => {
    const f = fixture();
    const pending = f.open();
    try {
      assert.equal(f.spawned, 1, 'ordinary default path must reach fake child');
      assert.equal(f.writes.length, 0);
      const ready = jsonLine({ type: 'ready' }, ending);
      // Real streams may split JSON and CR/LF at arbitrary byte boundaries.
      for (const byte of ready) f.child.stdout.write(Buffer.from([byte]));
      const afterReady = f.writes.map(bytes => [...bytes]);
      f.child.stdout.write(jsonLine({ activated: true, error: null }, ending));
      f.expire();
      const actual = await pending;
      assert.deepEqual({ afterReady, actual }, { afterReady: [[...GO]], actual: { activated: true, error: null } });
    } finally { f.bridge.cancel(); }
  });
}

test('native JSON error plus LF must retain its native error instead of timing out', async () => {
  const f = fixture();
  const pending = f.open();
  try {
    assert.equal(f.spawned, 1);
    f.child.stdout.write(jsonLine(failure('shortcut_voice_focus_not_editable')));
    f.expire();
    assert.deepEqual(await pending, notSent('shortcut_voice_focus_not_editable'));
    assert.deepEqual(f.writes, []);
  } finally { f.bridge.cancel(); }
});

test('stdin authorization is exactly go plus byte 10, emitted only once after complete ready', async () => {
  const f = fixture();
  const pending = f.open();
  try {
    assert.equal(f.spawned, 1);
    f.child.stdout.write(Buffer.from(JSON.stringify({ type: 'ready' }), 'utf8'));
    assert.deepEqual(f.writes, []);
    f.child.stdout.write(LF);
    assert.deepEqual(f.writes.map(bytes => [...bytes]), [[103, 111, 10]]);
    f.child.stdout.write(jsonLine({ activated: true, error: null }));
    assert.deepEqual(await pending, { activated: true, error: null });
    assert.deepEqual(f.writes.map(bytes => [...bytes]), [[103, 111, 10]]);
    assert.equal(f.child.kills, 1);
    assert.equal(f.child.stdin.destroyed, true);
    assert.equal(f.bridge.operation, null);
  } finally { f.bridge.cancel(); }
});

test('literal backslash-n is not a native line terminator and must not authorize', async () => {
  const f = fixture();
  const pending = f.open();
  try {
    assert.equal(f.spawned, 1);
    f.child.stdout.write(jsonLine({ type: 'ready' }, Buffer.from([92, 110])));
    assert.deepEqual(f.writes.map(bytes => [...bytes]), []);
  } finally { f.bridge.cancel(); }
  await pending;
});
