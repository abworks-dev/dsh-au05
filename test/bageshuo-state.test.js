import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BageshuoStateObserver } from '../packages/dsh-plugin/host/bageshuo-state.js';

const value = (state, error = null) => ({ state, error });
function fixture(options = {}) {
  let time = 1000, wallOffset = 0, nextTimer = 0;
  const timers = new Map(), children = [], calls = [], changes = [], diagnostics = [];
  const schedule = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, at: time + delay });
    return id;
  };
  const makeChild = () => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter(); child.stdout = new EventEmitter();
    child.ends = 0; child.kills = 0; child.probes = [];
    child.stdin.write = text => { child.probes.push(text); return true; };
    child.stdin.end = () => { child.ends++; };
    child.kill = () => { child.kills++; };
    children.push(child);
    return child;
  };
  const observer = new BageshuoStateObserver({ platform: 'win32', now: () => time, wallNow: () => time + wallOffset,
    onDiagnostic: row => diagnostics.push(row),
    schedule, cancelTimer: id => timers.delete(id), onChange: row => changes.push(row),
    spawnChild: (...args) => { calls.push(args); return makeChild(); }, ...options });
  const advance = ms => {
    const target = time + ms;
    while (true) {
      const due = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, item] = due;
      timers.delete(id); time = Math.max(time, item.at); item.callback();
    }
    time = target;
  };
  return { observer, timers, children, calls, changes, diagnostics, advance,
    jump: ms => { time += ms; }, wallJump: ms => { wallOffset += ms; },
    get child() { return children.at(-1); },
    raw: (text, child = children.at(-1)) => child.stdout.emit('data', Buffer.from(text)),
    row: (row, child = children.at(-1)) => child.stdout.emit('data', Buffer.from(JSON.stringify(
      row && typeof row === 'object' && !Array.isArray(row) ? { request: 0, ...row } : row) + '\n')),
    close: (child = children.at(-1)) => child.emit('close', 0),
  };
}

test('import/constructor/snapshot/stop/dispose are inert until explicit start', () => {
  const f = fixture();
  assert.deepEqual(f.observer.snapshot(), value('stopped'));
  assert.deepEqual(f.observer.stop(), value('stopped'));
  f.observer.dispose(); f.observer.dispose();
  assert.deepEqual(f.observer.start(), value('stopped'));
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});

test('unsupported platform is sanitized, latched, and never spawns', () => {
  const f = fixture({ platform: 'linux' });
  assert.deepEqual(f.observer.start(), value('error', 'unsupported_platform'));
  assert.deepEqual(f.observer.start(), value('error', 'unsupported_platform'));
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
});

test('start is synchronous/idempotent and only launches fixed owned Observe script', () => {
  const f = fixture();
  assert.deepEqual(f.observer.start(), value('starting'));
  assert.deepEqual(f.observer.start(), value('starting'));
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 1);
  const [command, args, settings] = f.calls[0];
  assert.equal(command, 'pwsh'); assert.equal(args[args.indexOf('-Mode') + 1], 'Observe');
  assert.match(args[args.indexOf('-File') + 1], /[\\/]native[\\/]bageshuo-state\.ps1$/);
  assert.deepEqual(Object.keys(settings).sort(), ['env', 'shell', 'stdio', 'windowsHide']);
  assert.equal(settings.shell, false); assert.equal(settings.windowsHide, true);
  assert.deepEqual(settings.stdio, ['pipe', 'pipe', 'ignore']);
  const allowed = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE',
    'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'APPDATA', 'PSModulePath'];
  assert.deepEqual(Object.keys(settings.env).sort(), allowed.filter(key => typeof process.env[key] === 'string').sort(), 'observer must not inherit credentials or arbitrary Host environment');
  assert.deepEqual(f.changes, [value('starting')]);
  f.observer.dispose(); f.close(); assert.equal(f.timers.size, 0);
});

test('samples are exact sanitized snapshots, chunked NDJSON and CRLF work', () => {
  const f = fixture(); f.observer.start();
  f.raw('{"state":"rec'); assert.deepEqual(f.observer.snapshot(), value('starting'));
  f.raw('ording","error":null,"request":0}\r\n'); assert.deepEqual(f.observer.snapshot(), value('recording'));
  const copy = f.observer.snapshot(); copy.state = 'evil'; copy.pid = 42;
  assert.deepEqual(f.observer.snapshot(), value('recording'));
  f.row(value('unknown', 'capture_unknown')); assert.deepEqual(f.observer.snapshot(), value('unknown', 'capture_unknown'));
  f.row(value('idle')); assert.deepEqual(f.observer.snapshot(), value('idle'));
  assert.equal(f.timers.size, 1);
  f.observer.stop(); f.close(); assert.equal(f.timers.size, 0);
});

test('unchanged heartbeat refreshes freshness without callback/timer leaks', () => {
  const f = fixture(); f.observer.start(); f.row(value('idle'));
  for (let i = 0; i < 100; i++) {
    f.advance(250); f.row(value('idle')); assert.equal(f.timers.size, 1);
  }
  assert.deepEqual(f.changes, [value('starting'), value('idle')]);
  f.advance(1999); assert.deepEqual(f.observer.snapshot(), value('idle'));
  f.advance(1); assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  assert.deepEqual(f.child.probes, ['probe:1\n']);
  assert.equal(f.child.ends, 0); assert.equal(f.child.kills, 0);
  f.advance(9999); assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  f.advance(1); assert.deepEqual(f.observer.snapshot(), value('error', 'observer_timeout'));
  assert.equal(f.child.ends, 1);
  f.advance(750); assert.equal(f.child.kills, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.calls.length, 1);
});

test('startup times out at 10 seconds; no sample can resurrect it or autoretry', () => {
  const f = fixture(); f.observer.start(); f.advance(9999);
  assert.deepEqual(f.observer.snapshot(), value('starting'));
  f.advance(1); assert.deepEqual(f.observer.snapshot(), value('error', 'observer_start_timeout'));
  f.row(value('recording')); f.observer.start();
  assert.deepEqual(f.observer.snapshot(), value('error', 'observer_start_timeout'));
  f.advance(20000); assert.equal(f.calls.length, 1); assert.equal(f.child.kills, 1);
  assert.equal(f.timers.size, 0);
});

test('snapshot and incoming samples revoke stale delayed event-loop data until fresh challenge response', () => {
  for (const trigger of ['snapshot', 'sample']) {
    const f = fixture(); f.observer.start(); f.row(value('recording')); f.jump(2000);
    if (trigger === 'sample') f.row(value('recording'));
    assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
    assert.deepEqual(f.child.probes, ['probe:1\n']);
    assert.equal(f.child.ends, 0); assert.equal(f.calls.length, 1);
    f.row(value('recording')); assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
    f.row({ ...value('idle'), request: 1 });
    assert.deepEqual(f.observer.snapshot(), value('idle'));
    assert.equal(f.child.ends, 0); assert.equal(f.calls.length, 1);
    assert.equal(f.diagnostics.find(row => row.event === 'sample_timeout').hostDelayMs, 1750);
    f.observer.stop(); f.close(); assert.equal(f.timers.size, 0);
  }
});

test('partial bytes cannot extend deadlines and old partial rows cannot recover confidence', () => {
  const f = fixture(); f.observer.start(); f.advance(9999); f.raw('{'); f.advance(1);
  assert.deepEqual(f.observer.snapshot(), value('error', 'observer_start_timeout')); f.close();
  const g = fixture(); g.observer.start(); g.row(value('recording')); g.advance(1999); g.raw('{'); g.advance(1);
  assert.deepEqual(g.observer.snapshot(), value('unknown', 'observer_recovering'));
  g.raw('"state":"recording","error":null,"request":0}\n');
  assert.deepEqual(g.observer.snapshot(), value('unknown', 'observer_recovering'));
  g.row({ ...value('idle'), request: 1 }); assert.deepEqual(g.observer.snapshot(), value('idle'));
  g.observer.stop(); g.close(); assert.equal(g.timers.size, 0);
});

test('forward/backward wall-clock jumps never change startup or sample trust budgets', () => {
  for (const delta of [3_600_000, -3_600_000]) {
    const f = fixture(); f.observer.start(); f.wallJump(delta);
    assert.deepEqual(f.observer.snapshot(), value('starting'));
    f.row(value('recording')); f.wallJump(-delta * 2);
    f.advance(1999); assert.deepEqual(f.observer.snapshot(), value('recording'));
    f.advance(1); assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
    assert.equal(f.calls.length, 1);
    assert.equal(f.diagnostics.filter(row => row.event === 'clock_changed').length, 2);
    assert.ok(f.diagnostics.every(row => Object.keys(row).every(key =>
      ['event', 'phase', 'sampleAgeMs', 'hostDelayMs', 'wallDriftMs'].includes(key))));
    f.observer.stop(); f.close();
  }
});

test('large old batches, old probe replies and old partial suffixes cannot reassert recording', () => {
  const f = fixture(); f.observer.start(); f.row(value('recording')); f.jump(2500);
  const old = JSON.stringify({ ...value('recording'), request: 0 }) + '\n';
  f.raw(old.repeat(200)); // Legitimate drain >4096 bytes, not an oversized individual row.
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  assert.equal(f.calls.length, 1); assert.deepEqual(f.child.probes, ['probe:1\n']);
  f.raw(JSON.stringify({ ...value('idle'), request: 1 }) + '\n' + old);
  assert.deepEqual(f.observer.snapshot(), value('idle'));
  assert.deepEqual(f.changes.slice(2), [value('unknown', 'observer_recovering'), value('idle')]);
  f.advance(2000); assert.deepEqual(f.child.probes, ['probe:1\n', 'probe:2\n']);
  f.row({ ...value('recording'), request: 1 });
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  f.row({ ...value('recording'), request: 2 });
  assert.deepEqual(f.observer.snapshot(), value('recording'));
  assert.equal(f.diagnostics.filter(row => row.event === 'recovered').length, 2);
  f.observer.stop(); f.close(); assert.equal(f.timers.size, 0);
});

test('fresh unknown is responsive but never claims capture; phase traffic cannot extend recovery', () => {
  const f = fixture(); f.observer.start(); f.row(value('idle')); f.advance(2000);
  f.row({ ...value('unknown', 'capture_unknown'), request: 1 });
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'capture_unknown'));
  f.advance(2000);
  for (let i = 0; i < 39; i++) {
    f.row({ phase: 'audio', request: 2 }); f.advance(250);
  }
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  f.advance(250); assert.deepEqual(f.observer.snapshot(), value('error', 'observer_timeout'));
  f.row({ ...value('recording'), request: 2 });
  assert.deepEqual(f.observer.snapshot(), value('error', 'observer_timeout'));
  assert.equal(f.diagnostics.at(-1).event, 'recovery_timeout');
  assert.equal(f.diagnostics.at(-1).phase, 'audio');
  assert.equal(f.child.ends, 1); f.advance(750); assert.equal(f.child.kills, 1);
  assert.equal(f.calls.length, 1); f.close(); assert.equal(f.timers.size, 0);
});

test('phase traffic cannot establish initial confidence or extend the 10 second startup', () => {
  const f = fixture(); f.observer.start();
  for (let i = 0; i < 40; i++) { f.row({ phase: 'process_tree' }); f.advance(250); }
  assert.deepEqual(f.observer.snapshot(), value('error', 'observer_start_timeout'));
  assert.equal(f.diagnostics.at(-1).phase, 'process_tree');
  assert.deepEqual(f.child.probes, ['probe:1\n', 'probe:2\n', 'probe:3\n', 'probe:4\n']); f.close();
});

test('startup and recovery discard even matching queued replies after 2 seconds without extending their hard budgets', () => {
  const f = fixture(); f.observer.start(); f.jump(2000);
  f.row(value('recording'));
  assert.deepEqual(f.observer.snapshot(), value('starting'));
  assert.deepEqual(f.child.probes, ['probe:1\n']);
  f.jump(2000); f.row({ ...value('recording'), request: 1 });
  assert.deepEqual(f.observer.snapshot(), value('starting'));
  assert.deepEqual(f.child.probes, ['probe:1\n', 'probe:2\n']);
  f.row({ ...value('idle'), request: 2 });
  assert.deepEqual(f.observer.snapshot(), value('idle'));
  f.advance(2000);
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  assert.equal(f.child.probes.at(-1), 'probe:3\n');
  f.jump(8000); f.row({ ...value('recording'), request: 3 });
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  assert.equal(f.child.probes.at(-1), 'probe:4\n');
  f.jump(1999); f.row({ ...value('idle'), request: 4 });
  assert.deepEqual(f.observer.snapshot(), value('idle'));
  assert.equal(f.calls.length, 1); f.observer.stop(); f.close();

  for (const phase of ['startup', 'recovery']) {
    const g = fixture(); g.observer.start();
    if (phase === 'recovery') { g.row(value('recording')); g.advance(2000); }
    for (let i = 0; i < 5; i++) {
      g.jump(2000); g.row({ ...value('recording'), request: i + (phase === 'recovery' ? 1 : 0) });
    }
    assert.deepEqual(g.observer.snapshot(), value('error', phase === 'startup' ? 'observer_start_timeout' : 'observer_timeout'));
    assert.equal(g.calls.length, 1); g.close(); assert.equal(g.timers.size, 0);
  }
});

test('reentrant request renewal never writes duplicate or reversed tokens, including delayed pre-spawn callbacks', () => {
  let f, nested = false;
  f = fixture({ onChange: row => {
    if (row.error === 'observer_recovering' && !nested) { nested = true; f.jump(2000); f.observer.snapshot(); }
  } });
  f.observer.start(); f.row(value('recording')); f.jump(2000); f.observer.snapshot();
  assert.deepEqual(f.child.probes, ['probe:2\n']);
  f.row({ ...value('idle'), request: 2 }); assert.deepEqual(f.observer.snapshot(), value('idle'));
  f.observer.stop(); f.close();

  let g, once = false;
  g = fixture({ onChange: row => {
    if (row.state === 'starting' && !once) { once = true; g.jump(2000); g.observer.snapshot(); }
  } });
  assert.deepEqual(g.observer.start(), value('starting'));
  assert.equal(g.calls.length, 1); assert.deepEqual(g.child.probes, ['probe:1\n']);
  g.row({ ...value('idle'), request: 1 }); assert.deepEqual(g.observer.snapshot(), value('idle'));
  g.observer.stop(); g.close();
});

test('identity failure from old request is still terminal during recovery and never rebinds', () => {
  for (const error of ['identity_changed', 'target_exited', 'app_ambiguous']) {
    const f = fixture(); f.observer.start(); f.row(value('recording')); f.advance(2000);
    f.row(value('error', error));
    assert.deepEqual(f.observer.snapshot(), value('error', error));
    f.row({ ...value('recording'), request: 1 }); f.observer.start();
    assert.deepEqual(f.observer.snapshot(), value('error', error));
    assert.equal(f.calls.length, 1); f.close(); assert.equal(f.timers.size, 0);
  }
});

test('reentrant revoke during recovery sends no probe and cannot retain or revive the old worker', () => {
  let f;
  f = fixture({ onChange: row => { if (row.error === 'observer_recovering') f.observer.stop(); } });
  f.observer.start(); f.row(value('recording')); f.advance(2000);
  assert.deepEqual(f.observer.snapshot(), value('stopped'));
  assert.deepEqual(f.child.probes, []); assert.equal(f.child.ends, 1);
  f.row({ ...value('recording'), request: 1 });
  assert.deepEqual(f.observer.snapshot(), value('stopped')); f.close(); assert.equal(f.timers.size, 0);
});

test('a broken challenge pipe is terminal; a throwing diagnostic cannot break cleanup', () => {
  const f = fixture({ onDiagnostic: () => { throw new Error('logging unavailable'); } });
  f.observer.start(); f.row(value('recording'));
  f.child.stdin.write = () => { throw new Error('private path'); };
  f.advance(2000); assert.deepEqual(f.observer.snapshot(), value('error', 'observer_exit'));
  assert.equal(f.child.ends, 1); f.close(); assert.equal(f.timers.size, 0);
});

test('blocking or reentrant diagnostics never re-date an obsolete sample into trusted capture', () => {
  let f, nested = false;
  f = fixture({ onDiagnostic: row => {
    if (row.event === 'recovered' && !nested) { nested = true; f.jump(2000); f.observer.snapshot(); }
  } });
  f.observer.start(); f.row(value('idle')); f.jump(2000); f.observer.snapshot();
  f.row({ ...value('recording'), request: 1 });
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  assert.deepEqual(f.child.probes, ['probe:1\n', 'probe:2\n']);
  f.row({ ...value('recording'), request: 1 });
  assert.deepEqual(f.observer.snapshot(), value('unknown', 'observer_recovering'));
  f.row({ ...value('idle'), request: 2 }); assert.deepEqual(f.observer.snapshot(), value('idle'));
  f.observer.stop(); f.close();

  let g, blocked = false;
  g = fixture({ onDiagnostic: row => {
    if (row.event === 'clock_changed' && !blocked) { blocked = true; g.jump(2000); }
  } });
  g.observer.start(); g.row(value('recording')); g.wallJump(3_600_000);
  g.row(value('recording'));
  assert.deepEqual(g.observer.snapshot(), value('unknown', 'observer_recovering'));
  assert.deepEqual(g.child.probes, ['probe:1\n']);
  g.observer.stop(); g.close();
});

for (const error of ['app_not_running', 'app_ambiguous', 'identity_changed', 'target_exited', 'observer_start_failed', 'unsupported_platform']) {
  test(`native ${error} latches terminal and never implicitly rebinds/retries`, () => {
    const f = fixture(); f.observer.start(); f.row(value('error', error));
    assert.deepEqual(f.observer.snapshot(), value('error', error));
    f.row(value('recording')); f.observer.start(); f.advance(10000);
    assert.deepEqual(f.observer.snapshot(), value('error', error));
    assert.equal(f.calls.length, 1); assert.equal(f.child.ends, 1); assert.equal(f.child.kills, 1);
    assert.equal(f.timers.size, 0);
  });
}

test('invalid schema/state/error/PII/counts/arrays/primitives are protocol errors only', () => {
  const rows = [null, [], 2, true, 'idle', {}, { state: 'idle' }, { error: null },
    value('starting'), value('stopped'), value('evil'), value('recording', 'capture_unknown'),
    value('unknown'), value('idle', 'target_exited'), value('error'), value('error', 'C:\\private\\app.exe'),
    value('error', 'observer_timeout'), { ...value('idle'), pid: 123 }, { ...value('recording'), path: 'private' },
    { ...value('idle'), activeCount: 1 }, value('unknown', 'identity_changed'),
    { ...value('idle'), request: -1 }, { ...value('idle'), request: '0' }, { ...value('idle'), request: 1 },
    { phase: 'secret' }, { phase: 'audio', path: 'private' }];
  for (const row of rows) {
    const f = fixture(); f.observer.start(); f.row(row);
    assert.deepEqual(f.observer.snapshot(), value('error', 'observer_protocol_error'));
    assert.equal(f.child.ends, 1); f.close(); assert.equal(f.timers.size, 0);
  }
});

test('blank/malformed/oversized/unterminated stdout is bounded and closed', () => {
  for (const raw of ['\n', '{invalid}\n', '{"state":"recording","error":null}\n', 'x'.repeat(257), 'x'.repeat(4097), ' '.repeat(257) + '\n']) {
    const f = fixture(); f.observer.start(); f.raw(raw);
    assert.deepEqual(f.observer.snapshot(), value('error', 'observer_protocol_error'));
    f.close(); assert.equal(f.timers.size, 0);
  }
  const f = fixture(); f.observer.start(); f.raw('{"state":"idle","error":null}'); f.close();
  assert.deepEqual(f.observer.snapshot(), value('error', 'observer_protocol_error'));
  assert.equal(f.timers.size, 0);
});

test('spawn errors and asynchronous child/pipe failures never expose raw errors', () => {
  const f = fixture({ spawnChild: () => { throw new Error('private path'); } });
  assert.deepEqual(f.observer.start(), value('error', 'observer_start_failed'));
  assert.equal(f.timers.size, 0);
  for (const [source, error] of [['child', 'observer_start_failed'], ['stdin', 'observer_exit'], ['stdout', 'observer_protocol_error']]) {
    const g = fixture(); g.observer.start();
    (source === 'child' ? g.child : g.child[source]).emit('error', new Error('secret'));
    assert.deepEqual(g.observer.snapshot(), value('error', error)); g.close(); assert.equal(g.timers.size, 0);
  }
});

test('clean or failing unexpected exit is terminal even following recording', () => {
  const f = fixture(); f.observer.start(); f.row(value('recording')); f.close();
  assert.deepEqual(f.observer.snapshot(), value('error', 'observer_exit'));
  assert.equal(f.child.kills, 0); assert.equal(f.child.ends, 0); assert.equal(f.timers.size, 0);
  f.observer.start(); assert.equal(f.calls.length, 1);
});

test('stop is graceful/idempotent and cancels fallback on acknowledged close', () => {
  const f = fixture(); f.observer.start(); f.row(value('recording'));
  assert.deepEqual(f.observer.stop(), value('stopped')); f.observer.stop();
  assert.equal(f.child.ends, 1); assert.equal(f.child.kills, 0); assert.equal(f.timers.size, 1);
  f.advance(749); assert.equal(f.child.kills, 0); f.close(); f.advance(1);
  assert.equal(f.child.kills, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.child.stdout.listenerCount('data'), 0); assert.equal(f.child.listenerCount('close'), 0);
});

test('synchronous close during owned stdin closure leaves no timer', () => {
  const f = fixture(); f.observer.start();
  f.child.stdin.end = () => { f.child.ends++; f.close(); };
  f.observer.dispose(); assert.equal(f.timers.size, 0); assert.equal(f.child.kills, 0);
});

test('unresponsive native observer gets one bounded owned-child kill, never any application kill', () => {
  const f = fixture(); f.observer.start(); f.observer.dispose();
  f.advance(750); assert.equal(f.child.kills, 1); assert.equal(f.timers.size, 0);
  f.advance(100000); assert.equal(f.child.kills, 1); assert.equal(f.calls.length, 1);
  // Errors after termination remain harmless until the OS close notification arrives.
  f.child.emit('error', new Error('late')); f.child.stdin.emit('error', new Error('late'));
  f.close(); assert.equal(f.child.listenerCount('error'), 0);
});

test('explicit stop/start creates fresh generation; late old samples/errors/close cannot touch it', () => {
  const f = fixture(); f.observer.start(); const old = f.child;
  f.row(value('recording')); f.observer.stop(); f.observer.start(); const current = f.child;
  assert.notEqual(current, old); assert.equal(f.calls.length, 2);
  f.row(value('idle'), current); f.row(value('recording'), old);
  old.emit('error', new Error('late')); f.advance(750);
  assert.equal(old.kills, 1); assert.equal(current.kills, 0); f.close(old);
  assert.deepEqual(f.observer.snapshot(), value('idle')); assert.equal(f.timers.size, 1);
  f.observer.dispose(); f.close(current); assert.equal(f.timers.size, 0);
});

test('explicit reset after native identity error alone permits a new discovery generation', () => {
  const f = fixture(); f.observer.start(); const old = f.child;
  f.row(value('error', 'identity_changed')); f.observer.start(); assert.equal(f.calls.length, 1);
  f.observer.stop(); f.observer.start(); assert.equal(f.calls.length, 2);
  f.row(value('recording')); f.close(old); assert.deepEqual(f.observer.snapshot(), value('recording'));
  f.observer.dispose(); f.close(); assert.equal(f.timers.size, 0);
});

test('reentrant onChange stop/dispose cannot spawn or retain a watcher', () => {
  let f;
  f = fixture({ onChange: row => { if (row.state === 'starting') f.observer.dispose(); } });
  assert.deepEqual(f.observer.start(), value('stopped'));
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  const g = fixture({ onChange: () => { throw new Error('consumer failure'); } });
  g.observer.start(); g.row(value('recording')); g.observer.dispose(); g.close(); assert.equal(g.timers.size, 0);
});

test('reentrant stop in sample callback cannot accept remaining rows or extend old timers', () => {
  let f;
  f = fixture({ onChange: row => { if (row.state === 'recording') f.observer.stop(); } });
  f.observer.start(); f.raw('{"state":"recording","error":null,"request":0}\n{"state":"idle","error":null,"request":0}\n');
  assert.deepEqual(f.observer.snapshot(), value('stopped')); assert.equal(f.child.ends, 1);
  f.close(); assert.equal(f.timers.size, 0);
});

const nativeURL = new URL('../packages/dsh-plugin/native/bageshuo-state.ps1', import.meta.url);
test('native boundaries: metadata only, immutable full identity, capture endpoints, EOF not polling Peek', () => {
  const source = readFileSync(nativeURL, 'utf8');
  assert.match(source, /\$Mode = 'SelfTest'/);
  assert.doesNotMatch(source, /IAudioClient|IAudioCaptureClient|GetBuffer\(|ReleaseBuffer\(|GetMixFormat|Initialize\(|Process\.Kill|TerminateProcess|Stop-Process|SendInput|GetForegroundWindow|GetWindowText|GetText\(|Clipboard|Get-Content|Set-Content|WriteAllText|\.Peek\(/);
  assert.match(source, /EnumAudioEndpoints\(1, 1,/);
  assert.match(source, /GetSessionEnumerator/); assert.match(source, /control2\.GetState\(out int state\)/);
  assert.match(source, /QueryLimitedInformation = 0x1000/);
  assert.match(source, /a\.Pid == b\.Pid/); assert.match(source, /a\.Start == b\.Start/);
  assert.match(source, /string\.Equals\(a\.Image, b\.Image, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(source, /if \(!Rules\.Same\(expected, current\)\)/);
  assert.match(source, /roots\.Count != 1/); assert.match(source, /CadenceMilliseconds = 250/); assert.match(source, /nextTick \+= PollDelay\.CadenceMilliseconds/);
  assert.match(source, /input\.IsBackground = true/); assert.match(source, /Console\.In\.ReadLine\(\)/);
  const loop = source.slice(source.indexOf('int request = control.Request;'), source.indexOf('nextTick += PollDelay'));
  assert.ok(loop.indexOf('int request = control.Request;') < loop.indexOf('Check(expected)'));
  assert.ok(loop.indexOf('Check(expected)') < loop.indexOf('PollAudio(frame'));
  assert.match(loop, /Emit\(Rules\.State\(frame\), frame\.Unknown \? "capture_unknown" : null, request\)/);
  assert.equal((source.match(/out Identity expected/g) || []).length, 1, 'pin is assigned exactly once; probes never rediscover');
  const pure = source.slice(source.indexOf('public static int SelfTest()'), source.indexOf("'@"));
  assert.doesNotMatch(pure, /Native\.|Check\(|PollAudio\(|ReadTree\(|Observe\(|Console\.In|Activator\.|Thread\.|File\./);
  assert.match(pure, /PinState\.Changed/); assert.match(pure, /app_ambiguous/); assert.match(pure, /NoSingleProcess/);
});

test('reviewed COM ABI GUIDs and vtable method order are unchanged', () => {
  const source = readFileSync(nativeURL, 'utf8');
  // Hard-coded reviewed ABI anchors: no dependency on unshipped local trial files.
  for (const guid of ['a95664d2-9614-4f35-a746-de8db63617e6', '0bd7a1be-7a1a-44db-8397-cc5392387b5e',
    'd666063f-1587-4e43-81f1-b948e807363f', '77aa99a0-1bd6-484f-8bc7-2c654c9a9b6f',
    'e2f5bb11-0570-40ca-acdd-3aa01277dee8', 'f4b1a599-7266-4319-a8ca-e70acb11e8cd', 'bfb7ff88-7239-4fc9-8fa2-07c950be9c6d']) assert.ok(source.includes(guid));
  const methods = source.slice(source.indexOf('internal interface IAudioSessionControl2'), source.indexOf('internal sealed class Identity'));
  assert.deepEqual([...methods.matchAll(/\[PreserveSig\] int (\w+)\(/g)].map(match => match[1]), [
    'GetState', 'GetDisplayName', 'SetDisplayName', 'GetIconPath', 'SetIconPath', 'GetGroupingParam',
    'SetGroupingParam', 'RegisterAudioSessionNotification', 'UnregisterAudioSessionNotification',
    'GetSessionIdentifier', 'GetSessionInstanceIdentifier', 'GetProcessId', 'IsSystemSoundsSession', 'SetDuckingPreference']);
});

test('native default SelfTest compiles and verifies pure PID/creation/path/ancestry/state/JSON fixtures',
  { skip: process.platform !== 'win32' }, () => {
    const run = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(nativeURL)],
      { encoding: 'utf8', timeout: 20000, windowsHide: true });
    assert.equal(run.status, 0, run.error?.code || 'native pure SelfTest failed');
    assert.equal(run.stderr, ''); assert.deepEqual(JSON.parse(run.stdout.trim()), value('idle'));
  });
