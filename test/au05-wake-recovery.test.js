import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DeviceController, parseSnapshotDiagnostics } from '../packages/dsh-plugin/host/device-controller.js';
import { createModeLease } from '../packages/dsh-plugin/host/mode-lease.js';

const source = readFileSync(new URL('../packages/dsh-plugin/native/au05.ps1', import.meta.url), 'utf8').match(/\$source = @'\r?\n([\s\S]*?)\r?\n'@/u)[1];
const owner = 'owner_wake_000000000001';
const initialHistory = Array.from({ length: 3 }, (_, index) => ({ attempt: index + 1,
  outcome: 'link_not_ready', auth: 'matched', link: 'linked_false', timedOut: 0, rejected: 0 }));
const noRecovery = new Set(['false_notice', 'wrong_notice', 'wrong_subtype', 'release_debounce']);
const noLamps = new Set([...noRecovery, 'still_false', 'malformed_snapshot', 'release', 'stop']);

function replaceOnce(text, before, after) {
  assert.equal(text.split(before).length, 2, `native test seam changed: ${before}`);
  return text.replace(before, after);
}

// A fake child, not a native process: replay the exact production serializer's lines
// through the unchanged <=3-attempt host parser, including stale and repeated IDs.
function replayWireEvidence(item) {
  let child;
  const commands = [];
  const controller = new DeviceController({ platform: 'win32', modeLease: createModeLease('direct', new Map()),
    spawnChild() {
      child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
      child.stdin.on('data', chunk => commands.push(JSON.parse(chunk.toString())));
      child.kill = () => { child.emit('close', 0); return true; };
      return child;
    } });
  try {
    controller.connect(owner);
    child.stdout.write(JSON.stringify({ type: 'status', state: 'ready' }) + '\n');
    assert.equal(commands.at(-1).requestId, 1);
    controller.poll(owner, { light: 'running' });
    assert.equal(commands.at(-1).requestId, 2);
    controller.poll(owner, { light: 'attention' });
    assert.equal(commands.at(-1).requestId, 3);
    if (item.latestState !== null) {
      controller.poll(owner, { light: item.latestState, ...(['release', 'release_debounce'].includes(item.mode) ? { lights: false } : {}) });
      assert.equal(commands.at(-1).requestId, 4);
    }
    for (const record of item.reports) {
      assert.deepEqual(parseSnapshotDiagnostics(JSON.parse(record.history)), initialHistory, item.mode);
      assert.notEqual(record.wire, null, `${item.mode}: every closed native result must be serialized`);
      assert.ok(Buffer.byteLength(record.wire) <= 2048, item.mode);
      const packet = JSON.parse(record.wire);
      assert.equal(packet.requestId, record.requestId, item.mode);
      assert.equal(packet.result, record.result, item.mode);
      assert.deepEqual(packet.snapshotDiagnostics, initialHistory, item.mode);
      child.stdout.write(record.wire + '\n');
      assert.equal(controller.snapshot().connected, true, `${item.mode}: host rejected serialized result`);
      assert.equal(controller.snapshot().error, null, item.mode);
    }
    assert.deepEqual(controller.snapshot().snapshotDiagnostics, initialHistory, item.mode);
    if (!noLamps.has(item.mode)) {
      assert.equal(controller.snapshot().lightResult, 'verified', item.mode);
      assert.equal(controller.snapshot().lightError, null, item.mode);
      assert.equal(JSON.parse(item.reports.at(-1).wire).readback.stage, 'post_write', item.mode);
    } else if (['release', 'release_debounce'].includes(item.mode)) {
      assert.equal(commands.at(-1).release, true, item.mode);
      assert.equal(controller.snapshot().lightResult, 'preserved', item.mode);
      assert.equal(controller.snapshot().lightError, null, item.mode);
    } else if (item.latestState === null) {
      assert.equal(controller.snapshot().lightResult, 'failed', item.mode);
      assert.equal(controller.snapshot().lightError, 'snapshot_unavailable', item.mode);
    }
  } finally { controller.dispose(); }
}

test('real writer merges wake notices, rechecks link/strict snapshot once, keeps latest intent and old wire compatibility (synthetic only)', { skip: process.platform !== 'win32' }, () => {
  const methods = `
    static async Task AwaitWakeCondition(Func<bool> condition, Session session, string label) {
      Stopwatch limit = Stopwatch.StartNew();
      while (!condition()) {
        if (limit.ElapsedMilliseconds > 6000) throw new InvalidOperationException("wake evidence did not reach " + label);
        await Task.Delay(5, session.stop.Token).ConfigureAwait(false);
      }
    }
    static Task AwaitWakeResults(Session session, int count) {
      return AwaitWakeCondition(() => session.Results.Count >= count, session, "result " + count);
    }
    static int WakeLampWrites(SyntheticStream stream) {
      return stream.Frames.FindAll(packet => {
        byte[] plain = DecodePlain(packet);
        try { return plain[0] == 1 && plain[1] == 11 && plain[2] == 136 && plain[3] == 4; }
        finally { Array.Clear(plain, 0, plain.Length); }
      }).Count;
    }
    public static string WakeRecoveryEvidence() {
      var evidence = new List<object>();
      foreach (string mode in new string[] { "link", "power", "burst", "early_notice", "false_notice", "wrong_notice", "wrong_subtype",
        "still_false", "malformed_snapshot", "release_debounce", "superseded_debounce", "idle_debounce", "release", "superseded", "idle_dark", "stop" }) {
        using (SyntheticStream stream = new SyntheticStream { Linked = false }) {
          Command first = new Command { State = "running", Channels = DefaultChannels("running"), RequestId = 2 };
          Command second = new Command { State = "attention", Channels = DefaultChannels("attention"), RequestId = 3 };
          Command latest = null;
          int lampWritesBeforeStop = -1;
          int[] appliedChannels = new int[4];
          Session session = new Session(stream, true, async delegate(Session value) {
            try {
              await stream.ReadStarted.Task.WaitAsync(value.stop.Token).ConfigureAwait(false);
              Check(value.commands.Writer.TryWrite(first));
              if (mode == "early_notice") {
                await AwaitWakeCondition(() => stream.LinkCount >= 1, value, "first link query").ConfigureAwait(false);
                // This hint predates the later fresh initializations, so it cannot refill their budget.
                stream.InjectWakeNotice(new byte[] { 0x8B, 0x0B, 1 });
              }
              await AwaitWakeResults(value, 1).ConfigureAwait(false);
              Check(value.Results[0] == "failed" && stream.AuthCount == 1 && stream.LinkCount == 3 && stream.GetCount == 0);
              if (mode == "early_notice") {
                await Task.Delay(400, value.stop.Token).ConfigureAwait(false);
                Check(stream.LinkCount == 3 && !value.wakeRecoveryAttempted);
              }
              // Changed semantic requests alone still cannot refill the bounded initialization budget.
              Check(value.commands.Writer.TryWrite(second));
              await AwaitWakeResults(value, 2).ConfigureAwait(false);
              Check(stream.AuthCount == 1 && stream.LinkCount == 3 && stream.GetCount == 0);
              stream.Linked = mode != "still_false";
              stream.MalformedInitial = mode == "malformed_snapshot";
              if (mode == "release" || mode == "superseded" || mode == "idle_dark") stream.SnapshotDelayMs = 650;
              if (mode == "stop") stream.SuppressLink = true;
              stream.InjectWakeNotice(mode == "power" ? new byte[] { 0x0B, 0xF0 }
                : mode == "false_notice" ? new byte[] { 0x8B, 0x0B, 2 }
                : mode == "wrong_notice" ? new byte[] { 6, 0x0B, 1 }
                : mode == "wrong_subtype" ? new byte[] { 0x8B, 0x1B, 1 }
                : new byte[] { 0x8B, 0x0B, 3 });
              if (mode == "false_notice" || mode == "wrong_notice" || mode == "wrong_subtype") {
                await Task.Delay(700, value.stop.Token).ConfigureAwait(false);
                Check(stream.AuthCount == 1 && stream.LinkCount == 3 && stream.GetCount == 0 && !value.wakeRecoveryAttempted);
                return;
              }
              await AwaitWakeCondition(() => value.wakeRecoveryAttempted, value, "wake debounce start").ConfigureAwait(false);
              if (mode == "burst") {
                // Unlike the later repeated-notice check, these arrive INSIDE the 300ms window.
                for (int i = 0; i < 8; i++) {
                  stream.InjectWakeNotice(new byte[] { 0x8B, i % 2 == 0 ? (byte)0xF0 : (byte)0x0B, 1 });
                  await Task.Delay(10, value.stop.Token).ConfigureAwait(false);
                }
                Check(stream.LinkCount == 3 && stream.GetCount == 0);
              }
              if (mode == "release_debounce" || mode == "superseded_debounce" || mode == "idle_debounce") {
                latest = new Command { State = mode == "superseded_debounce" ? "approval" : "idle",
                  Channels = mode == "superseded_debounce" ? DefaultChannels("approval") : new byte[4], Release = mode == "release_debounce", RequestId = 4 };
                Check(stream.LinkCount == 3 && stream.GetCount == 0);
                Check(value.commands.Writer.TryWrite(latest));
              }
              if (mode == "stop") {
                await AwaitWakeCondition(() => stream.LinkCount >= 4, value, "fourth link query").ConfigureAwait(false);
                return;
              }
              if (mode == "release" || mode == "superseded" || mode == "idle_dark") {
                await stream.GetStarted.Task.WaitAsync(value.stop.Token).ConfigureAwait(false);
                latest = new Command { State = mode == "superseded" ? "approval" : "idle",
                  Channels = mode == "superseded" ? DefaultChannels("approval") : new byte[4], Release = mode == "release", RequestId = 4 };
                Check(value.commands.Writer.TryWrite(latest));
              }
              await AwaitWakeResults(value, latest == null ? 3 : 4).ConfigureAwait(false);
              int auth = stream.AuthCount, linked = stream.LinkCount, gets = stream.GetCount;
              // Repeated notices must not turn failed recovery or a successful session into polling.
              stream.Linked = true;
              for (int i = 0; i < 8; i++) stream.InjectWakeNotice(new byte[] { 0x8B, 0xF0 });
              await Task.Delay(700, value.stop.Token).ConfigureAwait(false);
              Check(stream.AuthCount == auth && stream.LinkCount == linked && stream.GetCount == gets);
            } catch (Exception error) {
              throw new InvalidOperationException("wake mode " + mode + ": " + error.Message, error);
            } finally {
              lampWritesBeforeStop = WakeLampWrites(stream);
              for (int i = 0; i < 4; i++) appliedChannels[i] = stream.Current[4 + 5 * i];
              value.stop.Cancel(); // Assertions fail promptly instead of leaving Run waiting on input forever.
            }
          });
          session.Run().WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
          Check(stream.ReadCompleted && stream.PeakWrites == 1 && !stream.Online);
          CheckFrame(stream.Current, stream.Original);
          evidence.Add(new { mode, auth = stream.AuthCount, link = stream.LinkCount, get = stream.GetCount,
            results = session.Results, reports = session.WakeReports, latestState = latest == null ? null : latest.State,
            lampWritesBeforeStop, lampWrites = WakeLampWrites(stream), appliedChannels });
        }
      }
      return JsonSerializer.Serialize(evidence);
    }
  `;
  // Instrument only observation and input injection. No replacement writer/initializer is used.
  let code = replaceOnce(source, 'internal SyntheticStream() {', 'internal void InjectWakeNotice(byte[] notice) { responses.Writer.TryWrite(EncodeFixedCommand(notice)); } internal SyntheticStream() {');
  code = replaceOnce(code, 'bool wakeRecoveryAttempted;', 'internal bool wakeRecoveryAttempted;');
  code = replaceOnce(code, 'internal readonly List<string> Results = new List<string>();', 'internal readonly List<object> WakeReports = new List<object>(); internal readonly List<string> Results = new List<string>();');
  code = replaceOnce(code, 'if (selfTest) { LastReadback = command.Readback;', 'if (selfTest) { WakeReports.Add(new { result, requestId = command.RequestId, history = command.SnapshotDiagnostics, wire = LightsResultJson(command, result) }); LastReadback = command.Readback;');
  code = replaceOnce(code, 'public static void SelfTest() {', `${methods}\npublic static void SelfTest() {`);
  const result = JSON.parse(execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; [DshAu05.Native]::WakeRecoveryEvidence()"], { input: code, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 }).trim());
  assert.equal(result.length, 16);
  for (const item of result) {
    // Authentication is dongle-session state; waking the mic does not discard an already matched challenge.
    assert.equal(item.auth, 1, item.mode);
    assert.equal(item.link, noRecovery.has(item.mode) ? 3 : 4, item.mode);
    if (['false_notice', 'wrong_notice', 'wrong_subtype', 'stop'].includes(item.mode)) {
      assert.deepEqual(item.results, ['failed', 'failed'], item.mode);
    } else if (['still_false', 'malformed_snapshot'].includes(item.mode)) {
      assert.deepEqual(item.results, ['failed', 'failed', 'failed'], item.mode);
    } else if (['release', 'release_debounce'].includes(item.mode)) {
      assert.deepEqual(item.results, ['failed', 'failed', 'failed', 'preserved'], item.mode);
    } else if (item.latestState !== null) {
      assert.deepEqual(item.results, ['failed', 'failed', 'failed', 'verified'], item.mode);
    } else {
      assert.deepEqual(item.results, ['failed', 'failed', 'verified'], item.mode);
    }
    const expectedGets = noRecovery.has(item.mode) || ['still_false', 'stop'].includes(item.mode) ? 0
      : ['malformed_snapshot', 'release'].includes(item.mode) ? 1 : 2;
    assert.equal(item.get, expectedGets, item.mode);
    assert.equal(item.lampWritesBeforeStop, noLamps.has(item.mode) ? 0 : 5, item.mode);
    assert.equal(item.lampWrites, noLamps.has(item.mode) ? 0 : 10, item.mode);
    if (!noLamps.has(item.mode)) assert.deepEqual(item.appliedChannels,
      item.latestState === 'idle' ? [0, 0, 0, 0] : item.latestState === 'approval' ? [0, 2, 0, 0] : [0, 0, 2, 0], item.mode);
    replayWireEvidence(item);
  }
});

test('wake debounce uses the latest idle key-feedback opt-in in both directions (synthetic only)', { skip: process.platform !== 'win32' }, () => {
  const methods = `
    static async Task AwaitOptIn(Func<bool> condition, Session value) {
      long started = Environment.TickCount64;
      while (!condition()) {
        if (Environment.TickCount64 - started > 6000) throw new InvalidOperationException("wake opt-in timeout");
        await Task.Delay(5, value.stop.Token).ConfigureAwait(false);
      }
    }
    static int OptInLampWrites(SyntheticStream stream) {
      return stream.Frames.FindAll(packet => DecodePlain(packet)[3] == 4).Count;
    }
    public static string WakeOptInEvidence() {
      var evidence = new List<object>();
      foreach (bool originalOptIn in new bool[] { true, false }) {
        using (SyntheticStream stream = new SyntheticStream { Linked = false }) {
          int beforePress = 0, afterPress = 0;
          byte[] restoredIdle = null;
          Session session = new Session(stream, true, async delegate(Session value) {
            try {
              await stream.ReadStarted.Task.WaitAsync(value.stop.Token).ConfigureAwait(false);
              Check(value.commands.Writer.TryWrite(new Command { State = "idle", Channels = new byte[4], KeyFeedback = originalOptIn, RequestId = 1 }));
              await AwaitOptIn(() => value.Results.Count == 1, value).ConfigureAwait(false);
              Check(value.Results[0] == "failed" && stream.LinkCount == 3);
              stream.Linked = true;
              stream.InjectOptInWake();
              await AwaitOptIn(() => value.wakeRecoveryAttempted, value).ConfigureAwait(false);
              Check(stream.LinkCount == 3 && stream.GetCount == 0);
              Check(value.commands.Writer.TryWrite(new Command { State = "idle", Channels = new byte[4], KeyFeedback = !originalOptIn, RequestId = 2 }));
              await AwaitOptIn(() => value.Results.Count == 3, value).ConfigureAwait(false);
              Check(stream.LinkCount == 4 && stream.GetCount == 2);
              beforePress = OptInLampWrites(stream);
              long sequence = value.sequence;
              stream.Physical(1, true);
              await AwaitOptIn(() => value.sequence > sequence, value).ConfigureAwait(false);
              if (!originalOptIn) await AwaitOptIn(() => OptInLampWrites(stream) == beforePress + 2, value).ConfigureAwait(false);
              else await Task.Delay(350, value.stop.Token).ConfigureAwait(false);
              afterPress = OptInLampWrites(stream);
              restoredIdle = (byte[])stream.Current.Clone();
            } finally { value.stop.Cancel(); }
          });
          session.Run().WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
          Check(stream.ReadCompleted && stream.PeakWrites == 1 && !stream.Online);
          CheckFrame(stream.Current, stream.Original);
          evidence.Add(new { originalOptIn, beforePress, afterPress, restoredIdle, results = session.Results });
        }
      }
      return JsonSerializer.Serialize(evidence);
    }
  `;
  let code = replaceOnce(source, 'internal SyntheticStream() {',
    `internal void InjectOptInWake() { responses.Writer.TryWrite(EncodeFixedCommand(new byte[] { 0x8B, 0x0B, 3 })); }
     internal void Physical(int key, bool down) { responses.Writer.TryWrite(EncodeFixedCommand(new byte[] { 11, 16, 0, (byte)(down ? 1 : 0), (byte)key })); }
     internal SyntheticStream() {`);
  code = replaceOnce(code, 'decoded[4] == 0x40 || decoded[4] == 0x7C', 'decoded[4] == 0x40 || decoded[4] == 0x44 || decoded[4] == 0x7C');
  code = replaceOnce(code, 'bool wakeRecoveryAttempted;', 'internal bool wakeRecoveryAttempted;');
  code = replaceOnce(code, 'long sequence;', 'internal long sequence;');
  code = replaceOnce(code, 'public static void SelfTest() {', `${methods}\npublic static void SelfTest() {`);
  const evidence = JSON.parse(execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; [Console]::WriteLine('EVIDENCE:'+[DshAu05.Native]::WakeOptInEvidence())"],
  { input: code, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }).split(/\r?\n/u).find(line => line.startsWith('EVIDENCE:')).slice(9));
  assert.equal(evidence.length, 2);
  for (const item of evidence) {
    assert.deepEqual(item.results, ['failed', 'failed', 'verified'], `${item.originalOptIn}: old request deferred, latest idle verified`);
    assert.equal(item.beforePress, 5, 'idle writes exactly the full dark configuration');
    assert.equal(item.afterPress - item.beforePress, item.originalOptIn ? 0 : 2, `latest opt-in ${!item.originalOptIn} controls physical feedback`);
    const current = Buffer.from(item.restoredIdle, 'base64');
    assert.deepEqual([current[4], current[9], current[14], current[19]], [0, 0, 0, 0], 'pulse restores idle darkness');
  }
});

test('all release result enums serialize and round-trip through Host while unknown results stay closed', { skip: process.platform !== 'win32' }, () => {
  const code = replaceOnce(source, 'public static void SelfTest() {', `
    public static string ReleaseResultEvidence() {
      var wires = new List<string>();
      Command command = new Command { State = "idle", Channels = new byte[4], Release = true, RequestId = 2 };
      foreach (string result in new string[] { "preserved", "restored", "restore_written", "restore_mismatch" })
        wires.Add(LightsResultJson(command, result));
      Check(LightsResultJson(command, "unknown") == null);
      return JsonSerializer.Serialize(wires);
    }
    public static void SelfTest() {`);
  const wires = JSON.parse(execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; [DshAu05.Native]::ReleaseResultEvidence()"],
  { input: code, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 }).trim());
  let child;
  const commands = [];
  const controller = new DeviceController({ platform: 'win32', modeLease: createModeLease('direct', new Map()), spawnChild() {
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.on('data', chunk => commands.push(JSON.parse(chunk.toString())));
    child.kill = () => { child.emit('close', 0); return true; };
    return child;
  } });
  try {
    controller.connect(owner);
    child.stdout.write(JSON.stringify({ type: 'status', state: 'ready' }) + '\n');
    controller.poll(owner, { lights: false });
    assert.equal(commands.at(-1).requestId, 2);
    assert.equal(commands.at(-1).release, true);
    assert.equal(wires.length, 4);
    for (const [index, result] of ['preserved', 'restored', 'restore_written', 'restore_mismatch'].entries()) {
      assert.notEqual(wires[index], null, result);
      assert.deepEqual(JSON.parse(wires[index]), { type: 'lights', state: 'idle', result, requestId: 2 });
      child.stdout.write(wires[index] + '\n');
      assert.equal(controller.snapshot().connected, true, result);
      assert.equal(controller.snapshot().lightResult, result);
      assert.equal(controller.snapshot().lightError, null);
    }
    child.stdout.write(JSON.stringify({ ...JSON.parse(wires[0]), result: 'unknown' }) + '\n');
    assert.equal(controller.snapshot().connected, false);
    assert.equal(controller.snapshot().error, 'protocol_error');
  } finally { controller.dispose(); }
});
