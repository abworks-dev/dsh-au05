import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseSnapshotDiagnostics } from '../packages/dsh-plugin/host/device-controller.js';

const source = readFileSync(new URL('../packages/dsh-plugin/native/au05.ps1', import.meta.url), 'utf8').match(/\$source = @'\r?\n([\s\S]*?)\r?\n'@/u)[1];
const diagnostic = (outcome = 'timeout', attempt = 1) => ({ attempt, outcome, auth: 'matched', link: 'matched', timedOut: outcome === 'timeout' ? 1 : 0, rejected: 0 });

test('snapshot history codec is closed, dense, bounded and copies without identity fields', () => {
  const input = [diagnostic(), diagnostic('matched', 2)];
  const copy = parseSnapshotDiagnostics(input); input[0].auth = 'write_failed';
  assert.equal(copy[0].auth, 'matched');
  for (const invalid of [[{ ...diagnostic(), identity: [1] }], [{ ...diagnostic(), attempt: 2 }], [{ ...diagnostic(), outcome: 'raw' }], [{ ...diagnostic(), rejected: 327676 }], Array(1), Array.from({ length: 4 }, (_, i) => diagnostic('timeout', i + 1))]) assert.throws(() => parseSnapshotDiagnostics(invalid));
});

test('full native bounded retry recovers gates/timeouts, retains history and never writes stale or cancelled commands (synthetic only)', { skip: process.platform !== 'win32' }, () => {
  const methods = `
    public static string SnapshotRecoveryEvidence() {
      var output = new List<object>();
      foreach (string mode in new string[] { "auth", "link", "timeout", "exhausted", "rejected", "release", "stop", "delay_stop", "baseline_release", "idle_dark", "baseline_idle_dark" }) {
        using (SyntheticStream stream = new SyntheticStream { ReplyToReadback = mode != "baseline_release" && mode != "baseline_idle_dark", MalformedInitial = mode == "rejected", SuppressAuth = mode == "auth", Linked = mode != "link", ReplyToGet = mode != "timeout" && mode != "exhausted" && mode != "stop" && mode != "delay_stop", SnapshotDelayMs = mode == "release" || mode == "idle_dark" ? 650 : 0 }) {
          Command first = new Command { State = "running", Channels = DefaultChannels("running"), RequestId = 1 };
          Command next = new Command { State = "running", Channels = DefaultChannels("running"), RequestId = 2 };
          int[] appliedChannels = null;
          Session session = new Session(stream, true, async delegate(Session value) {
            await stream.ReadStarted.Task;
            value.commands.Writer.TryWrite(first);
            if (mode == "baseline_release" || mode == "baseline_idle_dark") {
              while (value.Results.Count < 1) await Task.Delay(5);
              stream.ReplyToReadback = true; stream.SnapshotDelayMs = 650;
              next.State = "recording"; next.Channels = DefaultChannels("recording");
              value.commands.Writer.TryWrite(next);
              while (stream.GetCount < 3) await Task.Delay(5);
              value.commands.Writer.TryWrite(new Command { State = "idle", Channels = new byte[4], Release = mode == "baseline_release", RequestId = 3 });
              while (value.Results.Count < 3) await Task.Delay(5);
              appliedChannels = new int[] { stream.Current[4], stream.Current[9], stream.Current[14], stream.Current[19] };
              value.stop.Cancel(); return;
            }
            if (mode == "auth" || mode == "link") {
              while (value.snapshotDiagnostics.Count < 1) await Task.Delay(5);
              stream.SuppressAuth = false; stream.Linked = true;
            }
            if (mode == "rejected") { while (value.snapshotDiagnostics.Count < 1) await Task.Delay(5); stream.MalformedInitial = false; }
            if (mode == "timeout" || mode == "stop" || mode == "delay_stop") {
              await stream.GetStarted.Task;
              if (mode == "timeout") { while (value.snapshotDiagnostics.Count < 1) await Task.Delay(5); stream.ReplyToGet = true; }
              else { if (mode == "delay_stop") while (value.snapshotDiagnostics.Count < 1) await Task.Delay(5); await Task.Delay(25); value.stop.Cancel(); return; }
            }
            if (mode == "release" || mode == "idle_dark") {
              await stream.GetStarted.Task;
              value.commands.Writer.TryWrite(new Command { State = "idle", Channels = new byte[4], Release = mode == "release", RequestId = 2 });
            }
            while (value.Results.Count < (mode == "release" || mode == "idle_dark" ? 2 : 1)) await Task.Delay(5);
            if (mode != "release" && mode != "idle_dark") {
              value.commands.Writer.TryWrite(next);
              while (value.Results.Count < 2) await Task.Delay(5);
            }
            appliedChannels = new int[] { stream.Current[4], stream.Current[9], stream.Current[14], stream.Current[19] };
            value.stop.Cancel();
          });
          session.Run().WaitAsync(TimeSpan.FromSeconds(14)).GetAwaiter().GetResult();
          CheckFrame(stream.Current, stream.Original);
          Check(stream.PeakWrites == 1 && stream.ReadCompleted);
          output.Add(new { mode, get = stream.GetCount, auth = stream.AuthCount, link = stream.LinkCount, results = session.Results,
            first = first.SnapshotDiagnostics, next = next.SnapshotDiagnostics, appliedChannels,
            lampWrites = stream.Frames.FindAll(packet => { byte[] plain = DecodePlain(packet); return plain[0] == 1 && plain[1] == 11 && plain[2] == 136 && plain[3] == 4; }).Count });
        }
      }
      return JsonSerializer.Serialize(output);
    }
  `;
  const code = source.replace('readonly List<object> snapshotDiagnostics', 'internal readonly List<object> snapshotDiagnostics')
    .replace('public static void SelfTest() {', `${methods}\npublic static void SelfTest() {`);
  const result = JSON.parse(execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; [DshAu05.Native]::SnapshotRecoveryEvidence()"], { input: code, encoding: 'utf8', timeout: 90000 }).trim());
  for (const item of result) {
    assert.ok(item.auth <= 3 && item.link <= 3, item.mode);
    if (['release', 'stop', 'delay_stop', 'exhausted'].includes(item.mode)) assert.equal(item.lampWrites, 0, item.mode);
    if (item.mode === 'baseline_release') { assert.equal(item.lampWrites, 10); assert.deepEqual(item.results, ['written', 'failed', 'restored']); }
    if (item.mode === 'release') assert.deepEqual(item.results, ['failed', 'preserved']);
    if (['idle_dark', 'baseline_idle_dark'].includes(item.mode)) {
      assert.deepEqual(item.appliedChannels, [0, 0, 0, 0], item.mode);
      assert.equal(item.lampWrites, item.mode === 'idle_dark' ? 10 : 15, item.mode);
      assert.deepEqual(item.results, item.mode === 'idle_dark' ? ['failed', 'verified'] : ['written', 'failed', 'verified'], item.mode);
    }
    if (item.mode === 'exhausted') { assert.equal(item.get, 3); assert.deepEqual(item.results, ['failed', 'failed']); }
    if (['auth', 'link', 'timeout', 'rejected'].includes(item.mode)) {
      const history = JSON.parse(item.first);
      assert.equal(history.length, 2); assert.equal(history[0].outcome, { auth: 'auth_unconfirmed', link: 'link_not_ready', timeout: 'timeout', rejected: 'reply_rejected' }[item.mode]);
      assert.equal(history[1].outcome, 'matched'); assert.deepEqual(JSON.parse(item.next), history);
      assert.deepEqual(item.results, ['verified', 'verified']);
    }
  }
});
