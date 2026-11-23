import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const source = readFileSync(new URL('../packages/dsh-plugin/native/au05.ps1', import.meta.url), 'utf8')
  .match(/\$source = @'\r?\n([\s\S]*?)\r?\n'@/u)[1];
const windows = process.platform === 'win32';

// Independent encoder: neither C# constructors nor the synthetic device build expected packets.
function packet(payload) {
  const plain = Buffer.alloc(64); plain.set(payload);
  const cipher = Buffer.alloc(64);
  const key = [0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA];
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
const get = packet([1, 11, 136, 1]);
const mode = value => packet([1, 11, 136, 4, 1, 0, value]);
const online = packet([1, 1, 16, 0, 3]), offline = packet([1, 1, 16, 0, 0]);
function fieldPacket(mask, focus, field, value) {
  const bytes = Array(28).fill(0); bytes.splice(0, 6, 1, 11, 136, 4, mask, focus);
  bytes[8 + 5 * focus + field] = value;
  return packet(bytes);
}
function explicitFrames(channels, brightness) {
  return [mode(2), ...channels.flatMap((type, focus) => [
    fieldPacket(4, focus, 0, type),
    fieldPacket(focus === 3 ? 0x40 : 0x20, focus, focus === 3 ? 4 : 3, brightness),
  ]), get];
}
function normalFrames(channels) {
  return [mode(2), fieldPacket(4, 0, 0, channels[0]), ...[1, 2, 3].map(focus =>
    packet([1, 11, 136, 4, 0x7C, focus, 0, 0, ...channels.flatMap(type => [type, 255, 2, 2, 2])])), get];
}
function restoreFrames(original, readback = false) {
  return [mode(original[2]), ...[0, 1, 2, 3].map(focus =>
    packet([1, 11, 136, 4, 0x7C, focus, 0, 0, ...original.slice(4)])), ...(readback ? [get] : [])];
}
function apply(baseline, channels, brightness) {
  const expected = [...baseline]; expected[2] = 2;
  for (let focus = 0; focus < 4; focus++) {
    const offset = 4 + 5 * focus;
    expected[offset] = channels[focus];
    if (brightness !== null) expected[offset + (focus === 3 ? 4 : 3)] = brightness;
    else if (focus > 0) expected.splice(offset + 1, 4, 255, 2, 2, 2);
  }
  return expected;
}
function replaceOnce(code, before, after) {
  assert.equal(code.split(before).length, 2, `native test seam changed: ${before}`);
  return code.replace(before, after);
}
function compile(code, entry, timeout = 120000) {
  return execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); try { Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; ${entry} } catch { [Console]::Error.WriteLine($_.Exception.ToString()); exit 1 }`],
  { input: code, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 }).trim();
}

test('explicit brightness uses official single-field masks and observed baseline for both verification paths', () => {
  const constructor = source.slice(source.indexOf('static byte[] BrightnessFrame('), source.indexOf('static bool MatchesBrightness('));
  assert.doesNotMatch(constructor, /0x7C|Array\.Copy|snapshot|saved|baseline/u);
  assert.match(constructor, /channel == 3 \? 0x40 : 0x20/u);
  assert.match(source, /observed\[3\] != baseline\[3\]/u);
  assert.match(source, /field == \(channel == 3 \? 4 : 3\) \? brightness.Value : original\[4 \+ i\]/u);
  assert.match(source, /MatchesBrightness\(observed, current.Channels, current.Brightness.Value, k1Preferences\)/u);
  assert.match(source, /Compare\(observed, current.Channels, current.Brightness, k1Preferences\)/u);
  assert.match(source, /k1Preferences = null; k1BaselineUnknown = true/u);
  assert.doesNotMatch(source, /k1BaselineUnknown && !current.Brightness.HasValue/u);
});

test('independent byte encoder checks B=0,2,20,255, every focus, strict matcher and expected diagnostics', { skip: !windows }, () => {
  const channels = [2, 1, 2, 1];
  const baseline = [0, 0, 1, 93, ...[0, 1, 2, 0].flatMap((type, index) => [type, 31 + index, 5 + index, 61 + index, 91 + index])];
  const fixtures = [];
  for (const brightness of [0, 2, 20, 255]) {
    for (let focus = 0; focus < 4; focus++) {
      fixtures.push(`$args2=[object[]]@([int]${focus},[byte]${brightness}); $actual=$native.GetMethod('BrightnessFrame',$flags).Invoke($null,$args2); if ([Convert]::ToBase64String($actual) -cne '${fieldPacket(focus === 3 ? 0x40 : 0x20, focus, focus === 3 ? 4 : 3, brightness)}') { throw 'brightness_packet_${focus}_${brightness}' }`);
      fixtures.push(`$args2=[object[]]::new(2); $args2[0]=[byte[]]@(${channels}); $args2[1]=[int]${focus}; $actual=$native.GetMethod('TypeFrame',$flags).Invoke($null,$args2); if ([Convert]::ToBase64String($actual) -cne '${fieldPacket(4, focus, 0, channels[focus])}') { throw 'type_packet_${focus}' }`);
    }
    const expected = apply(baseline, channels, brightness);
    fixtures.push(`$args4=[object[]]::new(4); $args4[0]=[byte[]]@(${expected}); $args4[1]=[byte[]]@(${channels}); $args4[2]=[byte]${brightness}; $args4[3]=[byte[]]@(${baseline}); $match=$native.GetMethod('MatchesBrightness',$flags); if (!$match.Invoke($null,$args4)) { throw 'match_expected_${brightness}' }; foreach ($i in 2..23) { $args4[0][$i]=$args4[0][$i] -bxor 1; if ($match.Invoke($null,$args4)) { throw 'false_verified_${brightness}' }; $args4[0][$i]=$args4[0][$i] -bxor 1 }; $statsType=$native.GetNestedType('ReadbackStats',[Reflection.BindingFlags]'NonPublic'); $stats=[Activator]::CreateInstance($statsType,$true); $statsType.GetMethod('Compare',[Reflection.BindingFlags]'NonPublic,Instance').Invoke($stats,$args4); $comparison=$statsType.GetField('Comparison',[Reflection.BindingFlags]'NonPublic,Instance').GetValue($stats) | ConvertFrom-Json; if (($comparison.expected.lights -join ',') -cne '${expected.slice(4)}') { throw 'diagnostic_expected_${brightness}' }`);
  }
  assert.equal(compile(source, `$native=[DshAu05.Native]; $flags=[Reflection.BindingFlags]'NonPublic,Static'; ${fixtures.join('\n')}; 'passed'`), 'passed');
});

test('real Session preserves live fields, reacquires unknown baselines, supersedes safely and restores immutable snapshot (synthetic only)', { skip: !windows }, () => {
  const methods = `
    static async Task BrightnessAwait(Func<bool> condition, Session session, string label) {
      Stopwatch deadline = Stopwatch.StartNew();
      while (!condition()) {
        if (deadline.ElapsedMilliseconds > 8000) throw new InvalidOperationException("brightness timeout: " + label);
        await Task.Delay(5, session.stop.Token).ConfigureAwait(false);
      }
    }
    public static string BrightnessSessionEvidence() {
      var evidence = new List<object>();
      foreach (string scenario in new string[] { "B0", "B2", "B20", "B255", "noB_to_B", "B_to_B", "B_to_noB", "unknown_noB", "unknown_B",
        "failed_noB", "failed_B", "malformed_B", "reacquire", "reacquire_failed", "preserved_reacquire", "superseded", "released", "idle_dark", "idle_B0", "idle_superseded", "stop" }) {
        using (SyntheticStream stream = new SyntheticStream { ExplicitBrightness = true }) {
          stream.Original[3] = stream.Current[3] = 93;
          for (int i = 0; i < 4; i++) {
            int offset = 4 + i * 5;
            stream.Original[offset + 1] = stream.Current[offset + 1] = (byte)(31 + i);
            stream.Original[offset + 2] = stream.Current[offset + 2] = (byte)(5 + i);
            stream.Original[offset + 3] = stream.Current[offset + 3] = (byte)(61 + i);
            stream.Original[offset + 4] = stream.Current[offset + 4] = (byte)(91 + i);
          }
          var transactions = new List<object>();
          var ends = new List<int>();
          int beforeStop = -1;
          Session session = new Session(stream, true, async delegate(Session value) {
            try {
              await stream.ReadStarted.Task.WaitAsync(value.stop.Token).ConfigureAwait(false);
              long request = 0;
              async Task send(byte[] channels, byte? brightness, bool release = false) {
                int count = value.Results.Count;
                byte[] baseline = (byte[])stream.Current.Clone();
                Command command = new Command { State = "running", Channels = channels, Brightness = brightness, Release = release, RequestId = ++request };
                Check(value.commands.Writer.TryWrite(command));
                await BrightnessAwait(() => value.Results.Count > count, value, "transaction result").ConfigureAwait(false);
                transactions.Add(new { requestId = command.RequestId, baseline, channels, brightness, release,
                  current = (byte[])stream.Current.Clone(), result = value.Results[count], comparison = command.Readback == null ? null : command.Readback.Comparison });
                ends.Add(stream.Frames.Count);
              }
              byte[] first = { 0, 2, 1, 1 }, second = { 2, 2, 1, 1 };
              Action changeReleasedPreferences = delegate {
                for (int i = 0; i < 4; i++) {
                  int offset = 4 + 5 * i;
                  stream.Current[offset + 1] = (byte)(111 + i); stream.Current[offset + 2] = (byte)(11 + i);
                  stream.Current[offset + 3] = (byte)(141 + i); stream.Current[offset + 4] = (byte)(171 + i);
                }
              };
              if (scenario == "preserved_reacquire") {
                stream.SnapshotDelayMs = 650;
                Check(value.commands.Writer.TryWrite(new Command { State = "running", Channels = first, Brightness = 2, RequestId = ++request }));
                await BrightnessAwait(() => stream.GetCount > 0, value, "first snapshot GET").ConfigureAwait(false);
                Command release = new Command { State = "idle", Channels = new byte[4], Release = true, RequestId = ++request };
                Check(value.commands.Writer.TryWrite(release));
                await BrightnessAwait(() => value.Results.Count == 2, value, "preserved pre-write release").ConfigureAwait(false);
                transactions.Add(new { requestId = release.RequestId, baseline = (byte[])stream.Original.Clone(), channels = release.Channels,
                  brightness = release.Brightness, release = release.Release, current = (byte[])stream.Current.Clone(), result = value.Results[1], comparison = (string)null });
                ends.Add(stream.Frames.Count);
                changeReleasedPreferences(); stream.SnapshotDelayMs = 0;
                await send(second, 20).ConfigureAwait(false);
                return;
              }
              if (scenario == "idle_dark" || scenario == "idle_B0") {
                await send(new byte[4], scenario == "idle_B0" ? (byte?)0 : null).ConfigureAwait(false);
                return;
              }
              if (scenario.StartsWith("B") && !scenario.Contains("_")) {
                await send(first, byte.Parse(scenario.Substring(1))).ConfigureAwait(false);
                return;
              }
              bool unknown = scenario.StartsWith("unknown_") || scenario.StartsWith("failed_") || scenario == "malformed_B"
                || scenario == "superseded" || scenario == "released" || scenario == "idle_superseded" || scenario == "stop";
              stream.ReplyToReadback = !unknown;
              bool noBrightness = scenario == "noB_to_B" || scenario == "unknown_noB" || scenario == "failed_noB";
              await send(first, noBrightness ? (byte?)null : (byte)2).ConfigureAwait(false);
              if (scenario == "reacquire" || scenario == "reacquire_failed") {
                await send(new byte[4], null, true).ConfigureAwait(false);
                changeReleasedPreferences();
              }
              stream.ReplyToReadback = !scenario.StartsWith("failed_") && scenario != "reacquire_failed";
              stream.MalformedReadback = scenario == "malformed_B";
              if (scenario == "noB_to_B") await send(first, 2).ConfigureAwait(false);
              else if (scenario == "B_to_B") await send(first, 0).ConfigureAwait(false);
              else if (scenario == "B_to_noB") {
                await send(second, null).ConfigureAwait(false);
                await send(first, null).ConfigureAwait(false);
              } else if (scenario == "superseded" || scenario == "released" || scenario == "idle_superseded" || scenario == "stop") {
                stream.SnapshotDelayMs = 650;
                int gets = stream.GetCount;
                Command stale = new Command { State = "recording", Channels = second, Brightness = 20, RequestId = ++request };
                Check(value.commands.Writer.TryWrite(stale));
                await BrightnessAwait(() => stream.GetCount > gets, value, "baseline GET").ConfigureAwait(false);
                if (scenario == "stop") return;
                Command latest = new Command { State = "running", Channels = scenario == "released" || scenario == "idle_superseded" ? new byte[4] : first,
                  Brightness = 0, Release = scenario == "released", RequestId = ++request };
                byte[] baseline = (byte[])stream.Current.Clone();
                Check(value.commands.Writer.TryWrite(latest));
                await BrightnessAwait(() => value.Results.Count == 3, value, "superseding result").ConfigureAwait(false);
                transactions.Add(new { requestId = latest.RequestId, baseline, channels = latest.Channels, brightness = latest.Brightness, release = latest.Release,
                  current = (byte[])stream.Current.Clone(), result = value.Results[2], comparison = latest.Readback == null ? null : latest.Readback.Comparison });
                ends.Add(stream.Frames.Count);
              } else await send(second, 20).ConfigureAwait(false);
            } catch (Exception error) { throw new InvalidOperationException("brightness scenario " + scenario + ": " + error.Message, error); }
            finally { beforeStop = stream.Frames.Count; value.stop.Cancel(); }
          });
          session.Run().WaitAsync(TimeSpan.FromSeconds(18)).GetAwaiter().GetResult();
          Check(stream.ReadCompleted && stream.PeakWrites == 1 && !stream.Online);
          // Failed reacquisition after release never owned the external changes and must not undo them.
          if (scenario != "reacquire_failed") {
            try { CheckFrame(stream.Current, stream.Original); }
            catch (Exception error) { throw new InvalidOperationException("brightness cleanup " + scenario, error); }
          }
          evidence.Add(new { scenario, original = stream.Original, finalCurrent = stream.Current, transactions, ends, beforeStop, results = session.Results,
            frames = stream.Frames.ConvertAll(bytes => Convert.ToBase64String(bytes)) });
        }
      }
      return JsonSerializer.Serialize(evidence);
    }
  `;
  const code = replaceOnce(source, 'public static void SelfTest() {', `${methods}\npublic static void SelfTest() {`);
  const evidence = JSON.parse(compile(code, '[DshAu05.Native]::BrightnessSessionEvidence()', 120000));
  assert.equal(evidence.length, 21);
  for (const item of evidence) {
    const original = [...Buffer.from(item.original, 'base64')];
    assert.equal(original[3], 93, item.scenario);
    const transactions = item.transactions.map(tx => ({ ...tx,
      baseline: [...Buffer.from(tx.baseline, 'base64')], current: [...Buffer.from(tx.current, 'base64')],
      channels: [...Buffer.from(tx.channels, 'base64')],
    }));
    const expected = [online, get];
    for (let index = 0; index < transactions.length; index++) {
      const tx = transactions[index];
      if (index > 0 && ['unknown_noB', 'unknown_B', 'failed_noB', 'failed_B', 'malformed_B', 'superseded', 'released', 'idle_superseded', 'reacquire', 'reacquire_failed', 'preserved_reacquire'].includes(item.scenario)
        && !(item.scenario.startsWith('reacquire') && index === 1)) expected.push(get);
      if (tx.release) {
        assert.deepEqual(tx.channels, [0, 0, 0, 0], `${item.scenario}: release is explicitly dark-only`);
        if (item.scenario === 'preserved_reacquire') assert.equal(tx.result, 'preserved', item.scenario);
        else {
          expected.push(...restoreFrames(original, true));
          assert.equal(tx.result, 'restored', item.scenario);
        }
        assert.deepEqual(tx.current, original, item.scenario);
      } else if (index > 0 && ['failed_noB', 'failed_B', 'malformed_B', 'reacquire_failed'].includes(item.scenario)) {
        assert.equal(tx.result, 'failed', item.scenario);
        assert.deepEqual(tx.current, tx.baseline, `${item.scenario}: failed GET cannot write lamps`);
      } else {
        if (item.scenario === 'B_to_noB' && index === 2) expected.push(fieldPacket(4, 0, 0, tx.channels[0]), get);
        else expected.push(...(tx.brightness === null ? normalFrames(tx.channels) : explicitFrames(tx.channels, tx.brightness)));
        const actualExpected = apply(tx.baseline, tx.channels, tx.brightness);
        assert.deepEqual(tx.current, actualExpected, `${item.scenario}: preserve all untargeted fields`);
        const written = index === 0 && ['unknown_noB', 'unknown_B', 'failed_noB', 'failed_B', 'malformed_B', 'superseded', 'released', 'idle_superseded', 'stop'].includes(item.scenario);
        assert.equal(tx.result, written ? 'written' : 'verified', item.scenario);
        if (!written) {
          const comparison = JSON.parse(tx.comparison);
          assert.deepEqual(comparison.expected, { mode: 2, lights: actualExpected.slice(4) }, item.scenario);
          assert.deepEqual(comparison.observed, comparison.expected, item.scenario);
        }
      }
      assert.equal(item.ends[index], expected.length, `${item.scenario}: transaction boundary ${index}`);
    }
    if (item.scenario === 'stop') expected.push(get);
    assert.equal(item.beforeStop, expected.length, `${item.scenario}: no hidden task writes`);
    const released = item.scenario === 'released';
    if (!released && item.scenario !== 'reacquire_failed') expected.push(...restoreFrames(original));
    assert.deepEqual([...Buffer.from(item.finalCurrent, 'base64')], item.scenario === 'reacquire_failed' ? transactions.at(-1).baseline : original,
      `${item.scenario}: restore only owned changes`);
    expected.push(offline);
    assert.deepEqual(item.frames, expected, `${item.scenario}: independent exact packets and immutable cleanup`);
    if (['superseded', 'idle_superseded'].includes(item.scenario) || released) assert.deepEqual(item.results, ['written', 'failed', released ? 'restored' : 'verified'], item.scenario);
    if (item.scenario === 'stop') assert.deepEqual(item.results, ['written']);
    if (item.scenario === 'preserved_reacquire') assert.deepEqual(item.results, ['failed', 'preserved', 'verified']);
  }
});
