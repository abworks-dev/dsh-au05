import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { WindowsVoiceStateObserver } from '../packages/dsh-plugin/host/windows-voice-state.js';

function fixture(overrides = {}) {
  let time = 0, id = 0;
  const timers = new Map(), children = [], changes = [];
  const observer = new WindowsVoiceStateObserver({ platform: 'win32', now: () => time,
    schedule: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
    cancelTimer: key => timers.delete(key), onChange: row => changes.push(row),
    spawnChild: (...args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stdin = new EventEmitter();
      child.ends = 0; child.kills = 0; child.args = args;
      child.stdin.end = () => child.ends++;
      child.kill = () => child.kills++;
      children.push(child); return child;
    }, ...overrides });
  return { observer, timers, changes, children,
    get child() { return children.at(-1); },
    raw(text, child = children.at(-1)) { child.stdout.emit('data', Buffer.from(text)); },
    row(row) { this.raw(JSON.stringify(row) + '\n'); },
    jump(ms) { time += ms; },
    tick(ms) { time += ms; for (const [key, timer] of [...timers]) {
      if (timer.at <= time) { timers.delete(key); timer.fn(); }
    } },
  };
}
const row = (state, level = 0, error = null) => ({ state, error, level });

test('lifecycle is inert and start only launches fixed read-only helper', () => {
  const f = fixture();
  assert.deepEqual(f.observer.snapshot(), row('unknown'));
  assert.equal(f.children.length, 0);
  f.observer.start(); f.observer.start();
  assert.equal(f.children.length, 1);
  assert.equal(f.child.args[0], 'pwsh');
  assert.match(f.child.args[1].join(' '), /windows-voice-state\.ps1 -Mode Observe$/);
  assert.equal(f.child.args[2].shell, false);
  f.observer.stop(); assert.equal(f.child.ends, 1);
  f.tick(750); assert.equal(f.child.kills, 1);
  f.observer.dispose(); f.observer.start(); assert.equal(f.children.length, 1);
});

test('real peak protocol handles partial NDJSON, CRLF and changes of level', () => {
  const f = fixture(); f.observer.start();
  f.raw('{"state":"recording","error":null,"level":');
  assert.deepEqual(f.observer.snapshot(), row('unknown'));
  f.raw('0.25}\r\n'); assert.deepEqual(f.observer.snapshot(), row('recording', 0.25));
  f.row(row('recording', 0.8)); assert.deepEqual(f.observer.snapshot(), row('recording', 0.8));
  f.row(row('unknown', 0, 'capture_unknown'));
  assert.deepEqual(f.observer.snapshot(), row('unknown', 0, 'capture_unknown'));
  f.row(row('idle')); assert.deepEqual(f.observer.snapshot(), row('idle'));
  const snapshot = f.observer.snapshot(); snapshot.level = 1;
  assert.equal(f.observer.snapshot().level, 0);
});

test('timeout fails closed even when watchdog callback has not run', () => {
  const f = fixture(); f.observer.start(); f.row(row('recording', 1));
  f.jump(2000);
  assert.deepEqual(f.observer.snapshot(), row('error', 0, 'observer_timeout'));
  f.row(row('recording', 1)); assert.equal(f.observer.snapshot().level, 0);
  f.observer.start(); assert.equal(f.children.length, 1);
  f.observer.stop(); f.observer.start(); assert.equal(f.children.length, 2);
});

test('startup timeout, native exit, launch exception and unsupported host are sanitized', () => {
  const f = fixture(); f.observer.start(); f.tick(10000);
  assert.equal(f.observer.snapshot().error, 'observer_timeout');
  const g = fixture(); g.observer.start(); g.child.emit('close');
  assert.equal(g.observer.snapshot().error, 'observer_exit');
  const h = fixture({ spawnChild: () => { throw Error('private path'); } });
  assert.equal(h.observer.start().error, 'observer_start_failed');
  const u = fixture({ platform: 'linux' });
  assert.equal(u.observer.start().error, 'unsupported_platform'); assert.equal(u.children.length, 0);
});

for (const invalid of [row('recording', -1), row('recording', 1.1), row('recording', '0.5'),
  row('idle', 0.4), row('unknown', 1), row('starting'), row('recording', 0, 'capture_unknown'),
  row('error'), row('error', 0, 'private path'), row('unknown', 0, 'unsupported_platform'),
  [], null, { ...row('idle'), extra: 1 },
  { state: 'idle', error: null }]) {
  test(`reject malformed frame ${JSON.stringify(invalid)}`, () => {
    const f = fixture(); f.observer.start(); f.row(invalid);
    assert.deepEqual(f.observer.snapshot(), row('error', 0, 'observer_protocol_error'));
    assert.equal(f.child.ends, 1);
  });
}

test('oversized and malformed data fail closed and stale children cannot publish', () => {
  const f = fixture(); f.observer.start(); const old = f.child;
  f.raw('x'.repeat(4097)); assert.equal(f.observer.snapshot().error, 'observer_protocol_error');
  f.observer.stop(); f.observer.start();
  f.raw(JSON.stringify(row('recording', 1)) + '\n', old);
  assert.deepEqual(f.observer.snapshot(), row('unknown'));
  f.raw('not json\n'); assert.equal(f.observer.snapshot().error, 'observer_protocol_error');
});

test('native self-test compiles complete COM vtables without opening microphone', () => {
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-File',
    'packages/dsh-plugin/native/windows-voice-state.ps1', '-Mode', 'SelfTest'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /selftest ok/);
  const source = readFileSync('packages/dsh-plugin/native/windows-voice-state.ps1', 'utf8');
  assert.match(source, /EnumAudioEndpoints\(1, 1/);
  assert.match(source, /\(\(IAudioMeterInformation\)session\)\.GetPeakValue/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.ok(source.indexOf('if (!ActiveSession(state)) continue;') < source.indexOf('int hr = control.GetProcessId'),
    'inactive/expired retained cross-process sessions must be excluded before ambiguous PID attribution');
  assert.ok(source.includes('"Speech_OneCore", "common", "SpeechRuntime.exe"'),
    'allow the exact installed Windows speech runtime location');
  assert.doesNotMatch(source, /SendKeys|keybd_event|GetBuffer\(|Initialize\(/);
});
