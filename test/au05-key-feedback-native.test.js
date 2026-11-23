import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = readFileSync(new URL('../packages/dsh-plugin/native/au05.ps1', import.meta.url), 'utf8')
  .match(/\$source = @'\r?\n([\s\S]*?)\r?\n'@/u)[1];
function replaceOnce(code, before, after) {
  assert.equal(code.split(before).length, 2, `native synthetic seam changed: ${before}`);
  return code.replace(before, after);
}

// Independent test-only encoder. No device, native CLI, recording or system input is used.
function packet(payload) {
  const plain = Buffer.alloc(64); plain.set(payload);
  const cipher = Buffer.alloc(64), key = [0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA];
  for (let offset = 0; offset < 64; offset += 8) {
    let left = plain.readUInt32LE(offset), right = plain.readUInt32LE(offset + 4), sum = 0;
    for (let round = 0; round < 32; round++) {
      sum = (sum + 0x9E3779B9) >>> 0;
      left = (left + (((right << 4) + key[0]) ^ (right + sum) ^ ((right >>> 5) + key[1]))) >>> 0;
      right = (right + (((left << 4) + key[2]) ^ (left + sum) ^ ((left >>> 5) + key[3]))) >>> 0;
    }
    cipher.writeUInt32LE(left, offset); cipher.writeUInt32LE(right, offset + 4);
  }
  return Buffer.concat([Buffer.from([0x55]), cipher.subarray(0, 63)]).toString('base64');
}
function feedbackPacket(baseline, channel, on) {
  const plain = Array(28).fill(0); plain.splice(0, 6, 1, 11, 136, 4, 0x44, channel);
  plain[8 + 5 * channel] = on ? 1 : baseline[4 + 5 * channel];
  plain[12 + 5 * channel] = baseline[4 + 5 * channel + (on ? 3 : 4)];
  return packet(plain);
}
const bytes = value => [...Buffer.from(value, 'base64')];

test('feedback has a closed optional boolean contract and a private two-field K2/K3 overlay', () => {
  assert.match(source, /field.Name == "keyFeedback" && !hasKeyFeedback/u);
  assert.match(source, /JsonValueKind.True && field.Value.ValueKind != JsonValueKind.False/u);
  assert.match(source, /keyFeedback = false/u);
  assert.match(source, /hasKeyFeedback \? 1 : 0/u);
  assert.match(source, /input = Classify\(plain\);\s+ObserveKeyFeedback\(input\)/u);
  const overlay = source.slice(source.indexOf('static byte[] KeyFeedbackFrame('), source.indexOf('// Keep the existing K1-only'));
  assert.match(overlay, /channel < 1 \|\| channel > 2/u);
  assert.match(overlay, /command\[4\] = 0x44/u);
  assert.doesNotMatch(overlay, /0x7C|255|RestoreGlobalFrame|BrightnessFrame/u);
  const pulse = source.slice(source.indexOf('async Task WriteKeyFeedback('), source.indexOf('void ReportResult('));
  assert.match(pulse, /intent\.Release/u);
  assert.doesNotMatch(pulse, /bool released|CaptureSnapshot|ReadSnapshot/u);
  assert.match(pulse, /Environment.TickCount64 - pressed >= 500/u);
  assert.match(pulse, /Environment.TickCount64 - started < 250/u);
  const active = pulse.slice(pulse.indexOf('long started'));
  assert.doesNotMatch(active, /ReadSnapshot|Task.Delay\(80|verifiedChannels|k1Preferences|WriteFrame/u);
  assert.match(active, /KeyFeedbackFrame\(baseline, channel, false\), CancellationToken.None/u);
});

test('real native Session exercises feedback timing, priority, restoration and fail-closed cases with synthetic reports only',
  { skip: process.platform !== 'win32', timeout: 120000 }, () => {
    // Instrument only the in-memory stream, not production logic. Existing native SelfTest is not invoked.
    let code = replaceOnce(source, 'internal int PeakWrites, GetCount;', `internal int PeakWrites, GetCount;
      internal readonly List<long> FrameTimes = new List<long>();
      internal int OverlayDelayMs;
      internal bool FailOverlayRestore, FailOverlayOn;
      internal string ObservedBoundary;
      internal void Physical(int key, bool down) { responses.Writer.TryWrite(EncodeFixedCommand(new byte[] { 11, 16, 0, (byte)(down ? 1 : 0), (byte)key })); }
      internal void Disconnect() { responses.Writer.TryWrite(new byte[0]); }`);
    code = replaceOnce(code, 'long sequence;', 'internal long sequence;');
    code = replaceOnce(code, 'bool touchedLights, touchedOnline, onlineAuthenticated, snapshotAttempted, recordingRecoveryAttempted;', 'internal bool touchedLights, touchedOnline, onlineAuthenticated, snapshotAttempted, recordingRecoveryAttempted;');
    code = replaceOnce(code, 'TaskCompletionSource<SnapshotRead> pendingSnapshot;', 'internal TaskCompletionSource<SnapshotRead> pendingSnapshot;');
    code = replaceOnce(code, 'Frames.Add(copy);', `Frames.Add(copy); FrameTimes.Add(Environment.TickCount64);
      if (decoded[3] == 1 && GetCount == 1) {
        if (ObservedBoundary == "current_mode0") Current[2] = 0;
        if (ObservedBoundary == "current_mode1") Current[2] = 1;
        if (ObservedBoundary == "current_raw_lit") Current[9] = 2;
        if (ObservedBoundary == "current_B0") Current[12] = 0;
      }
      if (decoded[3] == 4 && decoded[4] == 0x44) {
        if (decoded[8 + 5 * decoded[5]] == 1) {
          if (FailOverlayOn) { FailOverlayOn = false; throw new IOException("synthetic_feedback_on_failed"); }
          if (OverlayDelayMs > 0) await Task.Delay(OverlayDelayMs, token).ConfigureAwait(false);
        } else if (FailOverlayRestore) { FailOverlayRestore = false; throw new IOException("synthetic_feedback_restore_failed"); }
      }`);
    code = replaceOnce(code, 'decoded[4] == 0x40 || decoded[4] == 0x7C', 'decoded[4] == 0x40 || decoded[4] == 0x44 || decoded[4] == 0x7C');
    code = replaceOnce(code, 'public static void SelfTest() {', `
      static async Task FeedbackAwait(Func<bool> condition, Session session, string label) {
        long start = Environment.TickCount64;
        while (!condition()) {
          if (Environment.TickCount64 - start > 13000) throw new InvalidOperationException("feedback timeout: " + label);
          await Task.Delay(2).ConfigureAwait(false);
        }
      }
      static List<int> FeedbackIndices(SyntheticStream stream) {
        var found = new List<int>();
        for (int i = 0; i < stream.Frames.Count; i++) {
          byte[] plain = DecodePlain(stream.Frames[i]);
          if (plain[0] == 1 && plain[1] == 11 && plain[2] == 136 && plain[3] == 4 && plain[4] == 0x44) found.Add(i);
        }
        return found;
      }
      public static string KeyFeedbackEvidence() {
        // Parse through the real closed stdin parser, including duplicate and spoofed-event rejection.
        foreach (string suffix in new string[] { "", ",\\"keyFeedback\\":true", ",\\"keyFeedback\\":false" }) {
          byte[] json = System.Text.Encoding.UTF8.GetBytes("{\\"type\\":\\"lights\\",\\"state\\":\\"idle\\",\\"requestId\\":1" + suffix + "}");
          Check(ParseCommand(json, json.Length).KeyFeedback == suffix.EndsWith("true", StringComparison.Ordinal));
        }
        foreach (string json in new string[] {
          "{\\"type\\":\\"lights\\",\\"state\\":\\"idle\\",\\"requestId\\":1,\\"keyFeedback\\":0}",
          "{\\"type\\":\\"lights\\",\\"state\\":\\"idle\\",\\"requestId\\":1,\\"keyFeedback\\":\\"true\\"}",
          "{\\"type\\":\\"lights\\",\\"state\\":\\"idle\\",\\"requestId\\":1,\\"keyFeedback\\":null}",
          "{\\"type\\":\\"lights\\",\\"state\\":\\"idle\\",\\"requestId\\":1,\\"keyFeedback\\":true,\\"keyFeedback\\":true}",
          "{\\"type\\":\\"stop\\",\\"keyFeedback\\":true}",
          "{\\"type\\":\\"keyFeedback\\",\\"key\\":\\"k2\\"}",
          "{\\"type\\":\\"lights\\",\\"state\\":\\"idle\\",\\"requestId\\":1,\\"event\\":\\"k2.down\\"}"
        }) {
          bool rejected = false; byte[] raw = System.Text.Encoding.UTF8.GetBytes(json);
          try { ParseCommand(raw, raw.Length); } catch (Failure failure) { rejected = failure.Code == "command_invalid"; }
          Check(rejected);
        }
        var evidence = new List<object>();
        foreach (string scenario in new string[] { "idle_k2", "idle_k3", "dedup", "nonkeys", "disabled", "enable_held", "mode0", "mode1", "raw_lit", "B0", "raw_B0",
          "unknown_original", "stale_get", "task_busy_stale", "priority_approval", "priority_disable", "stop", "disconnect", "restore_failure", "on_failure", "slow_write",
          "known_running", "known_approval_k3", "status_lit", "unknown_current", "idle_reacquire", "K1_optimization", "queued_during_get", "current_mode0", "current_mode1", "current_raw_lit", "current_B0" }) {
          using (SyntheticStream stream = new SyntheticStream { ExplicitBrightness = true, ObservedBoundary = scenario }) {
            stream.Original[2] = stream.Current[2] = (byte)(scenario == "mode0" ? 0 : scenario == "mode1" ? 1 : 2);
            for (int channel = 0; channel < 4; channel++) {
              int offset = 4 + 5 * channel;
              stream.Original[offset] = stream.Current[offset] = (byte)(channel == 0 ? 2 : channel == 3 ? 1 : 0);
              stream.Original[offset + 3] = stream.Current[offset + 3] = (byte)(scenario == "raw_B0" ? 0 : 37 + channel);
              stream.Original[offset + 4] = stream.Current[offset + 4] = 0;
            }
            if (scenario == "raw_lit") stream.Original[9] = stream.Current[9] = 2;
            if (scenario == "unknown_original") stream.MalformedInitial = true;
            if (scenario == "stale_get" || scenario == "task_busy_stale") stream.SnapshotDelayMs = 650;
            if (scenario == "slow_write") stream.OverlayDelayMs = 120;
            if (scenario == "restore_failure") stream.FailOverlayRestore = true;
            if (scenario == "on_failure") stream.FailOverlayOn = true;
            long queuedAt = 0; int beforeStop = 0, commandStart = -1; byte[] beforePulse = null, afterPulse = null;
            var pulseBaselines = new List<byte[]>();
            Session session = new Session(stream, true, async delegate(Session value) {
              try {
                await stream.ReadStarted.Task.ConfigureAwait(false);
                long request = 0;
                async Task send(byte[] channels, bool enabled, byte? brightness, bool release = false) {
                  int count = value.Results.Count;
                  Check(value.commands.Writer.TryWrite(new Command { State = channels[0] == 2 ? "recording" : "running", Channels = channels,
                    KeyFeedback = enabled, Brightness = brightness, Release = release, RequestId = ++request }));
                  await FeedbackAwait(() => value.Results.Count > count, value, "lights result").ConfigureAwait(false);
                }
                Func<int, bool, Task> physical = async delegate(int key, bool down) {
                  long sequence = value.sequence; stream.Physical(key, down);
                  await FeedbackAwait(() => value.sequence > sequence, value, "physical report").ConfigureAwait(false);
                };
                bool task = scenario == "known_running" || scenario == "unknown_current" || scenario == "K1_optimization"
                  || scenario == "status_lit" || scenario == "known_approval_k3";
                if (scenario == "unknown_current") stream.ReplyToReadback = false;
                if (scenario == "task_busy_stale" || scenario == "stale_get" || scenario == "queued_during_get") {
                  if (scenario == "queued_during_get") stream.SnapshotDelayMs = 300;
                  Check(value.commands.Writer.TryWrite(new Command { State = "running",
                    Channels = scenario == "task_busy_stale" ? new byte[] { 0, 0, 0, 1 } : new byte[4], KeyFeedback = true, RequestId = ++request }));
                  await FeedbackAwait(() => stream.GetCount > 0, value, "busy GET").ConfigureAwait(false);
                  await physical(1, true).ConfigureAwait(false);
                  if (scenario == "queued_during_get") {
                    Check(value.commands.Writer.TryWrite(new Command { State = "approval", Channels = new byte[] { 0, 2, 0, 0 }, KeyFeedback = true, RequestId = ++request }));
                  }
                  await FeedbackAwait(() => value.Results.Count >= (scenario == "queued_during_get" ? 2 : 1), value, "busy result").ConfigureAwait(false);
                  await Task.Delay(100).ConfigureAwait(false);
                  return;
                }
                await send(scenario == "status_lit" || scenario == "known_approval_k3" ? new byte[] { 0, 2, 0, 0 }
                  : task ? new byte[] { 0, 0, 0, 1 } : new byte[4], scenario != "disabled" && scenario != "enable_held", scenario == "B0" ? (byte?)0 : null).ConfigureAwait(false);
                if (scenario == "enable_held") {
                  await physical(1, true).ConfigureAwait(false);
                  await send(new byte[4], true, null).ConfigureAwait(false);
                  await physical(1, true).ConfigureAwait(false);
                  await Task.Delay(100).ConfigureAwait(false);
                  return;
                }
                beforePulse = (byte[])stream.Current.Clone(); pulseBaselines.Add(beforePulse);
                if (scenario == "nonkeys") {
                  foreach (int key in new int[] { 0, 3, 4, 5 }) { await physical(key, true).ConfigureAwait(false); await physical(key, false).ConfigureAwait(false); }
                  await physical(1, false).ConfigureAwait(false); await physical(2, false).ConfigureAwait(false);
                  await Task.Delay(100).ConfigureAwait(false); return;
                }
                int selected = scenario == "idle_k3" || scenario == "known_approval_k3" ? 2 : 1;
                await physical(selected, true).ConfigureAwait(false);
                bool skip = scenario == "disabled" || scenario == "B0" || scenario.StartsWith("current_")
                  || scenario == "unknown_original" || scenario == "unknown_current" || scenario == "status_lit";
                if (skip) {
                  if (scenario == "unknown_original") await FeedbackAwait(() => value.snapshotAttempted && value.pendingSnapshot == null, value, "rejected snapshot").ConfigureAwait(false);
                  else await Task.Delay(150).ConfigureAwait(false);
                  return;
                }
                await FeedbackAwait(() => FeedbackIndices(stream).Count >= 1, value, "pulse start").ConfigureAwait(false);
                if (scenario == "dedup") {
                  await physical(1, true).ConfigureAwait(false); await physical(1, true).ConfigureAwait(false); await physical(1, false).ConfigureAwait(false);
                }
                if (scenario == "priority_approval" || scenario == "priority_disable") {
                  await Task.Delay(35).ConfigureAwait(false); queuedAt = Environment.TickCount64; commandStart = stream.Frames.Count;
                  await send(scenario == "priority_disable" ? new byte[4] : new byte[] { 0, 2, 0, 0 }, scenario != "priority_disable", null).ConfigureAwait(false);
                  if (scenario == "priority_disable") {
                    await physical(1, true).ConfigureAwait(false); // held down after disabling cannot retrigger
                    await physical(1, false).ConfigureAwait(false); await physical(1, true).ConfigureAwait(false); // disabled fresh down ignored
                    await send(new byte[4], true, null).ConfigureAwait(false);
                    await physical(1, true).ConfigureAwait(false); // re-enabling while held still is not a new down
                    await Task.Delay(100).ConfigureAwait(false);
                  }
                } else if (scenario == "stop") value.stop.Cancel();
                else if (scenario == "disconnect") stream.Disconnect();
                await FeedbackAwait(() => FeedbackIndices(stream).Count >= 2, value, "pulse restore").ConfigureAwait(false);
                if (scenario == "restore_failure" || scenario == "on_failure") {
                  await FeedbackAwait(() => value.stop.IsCancellationRequested, value, "write failure").ConfigureAwait(false); return;
                }
                afterPulse = (byte[])stream.Current.Clone();
                if (scenario == "dedup") await Task.Delay(300).ConfigureAwait(false);
                if (scenario == "K1_optimization") {
                  commandStart = stream.Frames.Count;
                  await send(new byte[] { 2, 0, 0, 1 }, true, null).ConfigureAwait(false);
                }
                if (scenario == "idle_reacquire") {
                  await send(new byte[4], false, null, true).ConfigureAwait(false);
                  stream.Current[12] = 73; stream.Current[13] = 9; // external preferences changed only after explicit release
                  await send(new byte[4], true, 20).ConfigureAwait(false);
                  pulseBaselines.Add((byte[])stream.Current.Clone());
                  await physical(1, false).ConfigureAwait(false); await physical(1, true).ConfigureAwait(false);
                  await FeedbackAwait(() => FeedbackIndices(stream).Count == 4, value, "second restored pulse").ConfigureAwait(false);
                  afterPulse = (byte[])stream.Current.Clone();
                }
              } catch (Exception error) { throw new InvalidOperationException("feedback scenario " + scenario + ": " + error.Message, error); }
              finally { beforeStop = stream.Frames.Count; value.stop.Cancel(); }
            });
            string failure = null;
            try { session.Run().WaitAsync(TimeSpan.FromSeconds(15)).GetAwaiter().GetResult(); }
            catch (Failure error) { failure = error.Code; }
            if (stream.PeakWrites != 1 || (!stream.ReadCompleted && scenario != "disconnect") || stream.Online)
              throw new InvalidOperationException("feedback lifecycle " + scenario + ": peak=" + stream.PeakWrites + ", readCancelled=" + stream.ReadCompleted + ", online=" + stream.Online);
            evidence.Add(new { scenario, original = stream.Original, beforePulse, afterPulse, pulseBaselines, finalCurrent = stream.Current, failure, queuedAt, commandStart, beforeStop,
              frames = stream.Frames.ConvertAll(value => Convert.ToBase64String(value)), times = stream.FrameTimes, feedback = FeedbackIndices(stream), results = session.Results });
          }
        }
        return JsonSerializer.Serialize(evidence);
      }
      public static void SelfTest() {`);
    const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); try { Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; [Console]::WriteLine('EVIDENCE:'+[DshAu05.Native]::KeyFeedbackEvidence()) } catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }`],
    { input: code, encoding: 'utf8', timeout: 110000, maxBuffer: 8 * 1024 * 1024 });
    const evidence = JSON.parse(output.split(/\r?\n/u).find(line => line.startsWith('EVIDENCE:')).slice(9));
    assert.equal(evidence.length, 32);
    const skipped = new Set(['nonkeys', 'disabled', 'enable_held', 'B0', 'unknown_original', 'stale_get', 'task_busy_stale', 'unknown_current', 'status_lit', 'queued_during_get',
      'current_mode0', 'current_mode1', 'current_raw_lit', 'current_B0']);
    for (const item of evidence) {
      const label = item.scenario;
      assert.equal(item.failure, label === 'disconnect' ? 'disconnected' : ['restore_failure', 'on_failure'].includes(label) ? 'write_failed' : null, label);
      if (skipped.has(label)) {
        assert.deepEqual(item.feedback, [], label);
        if (!['task_busy_stale', 'unknown_current'].includes(label)) assert.deepEqual(bytes(item.finalCurrent), bytes(item.original), label);
        continue;
      }
      assert.equal(item.feedback.length, label === 'idle_reacquire' ? 4 : 2, label);
      const channel = ['idle_k3', 'known_approval_k3'].includes(label) ? 2 : 1;
      for (let pair = 0; pair < item.feedback.length / 2; pair++) {
        const baseline = bytes(item.pulseBaselines[pair]), start = item.feedback[pair * 2], end = item.feedback[pair * 2 + 1];
        assert.equal(item.frames[start], feedbackPacket(baseline, channel, true), `${label}: known visible brightness + type only`);
        assert.equal(item.frames[end], feedbackPacket(baseline, channel, false), `${label}: exact two-field restore`);
        assert.equal(end, start + 1, `${label}: no heartbeat, GET or task write inside pulse`);
        const duration = item.times[end] - item.times[start];
        if (!['stop', 'disconnect', 'on_failure', 'priority_approval', 'priority_disable'].includes(label)) {
          assert.ok(duration >= 230 && duration < 450, `${label}: native nominal pulse ${duration}ms`);
        }
        if (label === 'priority_approval' || label === 'priority_disable') {
          assert.ok(item.times[end] - item.queuedAt < 120, `${label}: task preemption ${item.times[end] - item.queuedAt}ms`);
          assert.ok(duration < 220, `${label}: task does not wait out pulse`);
        }
      }
      if (!['priority_approval', 'restore_failure', 'on_failure', 'stop', 'disconnect'].includes(label)) {
        assert.deepEqual(bytes(item.afterPulse), bytes(item.pulseBaselines.at(-1)), `${label}: no K1, brightness or mode contamination`);
      }
      if (label === 'priority_approval') {
        assert.equal(bytes(item.afterPulse)[9], 2, 'queued approval wins after exact pulse restoration');
        assert.equal(item.feedback[1], item.commandStart, 'restoration is first write after the queued status');
      }
      if (label === 'K1_optimization') {
        const changed = Array(28).fill(0); changed.splice(0, 6, 1, 11, 136, 4, 4, 0); changed[8] = 2;
        assert.equal(item.frames[item.commandStart], packet(changed), 'verifiedChannels retained for existing K1-only optimization');
        assert.equal(item.frames[item.commandStart + 1], packet([1, 11, 136, 1]));
        assert.equal(item.beforeStop, item.commandStart + 2);
      }
      if (label === 'restore_failure') assert.deepEqual(bytes(item.finalCurrent), bytes(item.original), 'failed overlay restore falls back to original snapshot cleanup');
      if (label === 'idle_reacquire') {
        assert.deepEqual(item.results, ['verified', 'restored', 'verified'], 'only explicit release restores before a fresh idle takeover');
        assert.equal(bytes(item.pulseBaselines[1])[13], 9, 'reacquisition preserves externally changed untargeted solid brightness');
      }
      assert.deepEqual(bytes(item.finalCurrent), bytes(item.original), `${label}: active takeover restores immutable original snapshot on exit`);
    }
    const timing = evidence.filter(item => item.feedback.length && !['on_failure'].includes(item.scenario))
      .map(item => `${item.scenario}=${item.times[item.feedback[1]] - item.times[item.feedback[0]]}ms`).join(', ');
    console.log(`synthetic native feedback timing: ${timing}`);
  });
