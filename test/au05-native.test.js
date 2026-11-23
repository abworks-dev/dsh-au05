import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptUrl = new URL('../packages/dsh-plugin/native/au05.ps1', import.meta.url);
const script = readFileSync(scriptUrl, 'utf8');
const source = script.match(/\$source = @'\r?\n([\s\S]*?)\r?\n'@/u)?.[1];
assert.ok(source);

// Independent, test-only TEA encoder. No transport and no device APIs.
function frame(payload) {
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
  return Buffer.concat([Buffer.from([0x55]), cipher.subarray(0, 63)]);
}

const windows = process.platform === 'win32';
function run(extra = []) {
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(scriptUrl), ...extra],
    { encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  return result.stdout;
}

test('standalone native defaults to SelfTest and uses a closed CLI', () => {
  assert.match(script, /^[\x00-\x7f]*$/u);
  const params = script.slice(script.indexOf('param('), script.indexOf('Set-StrictMode'));
  assert.match(params, /ValidateSet\('SelfTest', 'Connect'\)/u);
  assert.match(params, /\$Mode = 'SelfTest'/u);
  assert.deepEqual([...params.matchAll(/\$(\w+)/gu)].map(value => value[1]), ['Mode', 'EnableLights', 'TraceInitialization']);
  const selfTest = script.indexOf("if ($Mode -eq 'SelfTest')");
  assert.ok(selfTest > 0 && selfTest < script.indexOf('$parents = @('));
  assert.match(script.slice(selfTest, script.indexOf('$parents = @(')), /exit 0/u);
});

test('hardware access is explicit, exclusive, revalidated and vendor-only', () => {
  assert.match(source, /vid == 0xFFF1 && pid == 0x00DD && page == 0xFFFC && usage == 1 && inputBytes == 64/u);
  assert.match(source, /if \(!IsTargetPath\(path\) \|\| !seen\.Add\(path\)\) continue/u);
  assert.match(source, /CreateFileW\(path, 0, FILE_SHARE_READ \| FILE_SHARE_WRITE/u);
  assert.match(source, /if \(physicalReceiverCount != 1\) throw/u);
  assert.match(source, /if \(devices\.Length != 1\) throw/u);
  assert.match(source, /CreateFileW\(device\.Path, access, 0,/u);
  assert.match(source, /uint access = GENERIC_READ \| \(enableLights \? GENERIC_WRITE : 0\)/u);
  assert.match(source, /verified == null \|\| \(enableLights && verified\.OutputBytes != 64\)/u);
  assert.doesNotMatch(source, /HidD_SetFeature|HidD_GetFeature|DeviceIoControl|SendInput|SetWindowsHookEx/u);
  assert.match(script, /Get-PnpDevice -PresentOnly -ErrorAction Stop/u);
});

test('stdin is bounded, strict, cancellable and never accepts arbitrary bytes', () => {
  assert.match(source, /MaxLineBytes = 256, MaxMessagesPerSecond = 30/u);
  assert.match(source, /Channel\.CreateBounded<Command>\(new BoundedChannelOptions\(8\)/u);
  assert.match(source, /MaxDepth = 2, AllowTrailingCommas = false/u);
  assert.match(source, /field\.Name == "type" && type == null/u);
  assert.match(source, /field\.Name == "state" && state == null/u);
  assert.match(source, /field\.Name == "release" && !hasRelease/u);
  assert.match(source, /hasRelease = false, release = false/u);
  assert.match(source, /fields -= \(hasKeyFeedback \? 1 : 0\) \+ \(hasRelease \? 1 : 0\)/u);
  assert.match(source, /Release = release/u);
  assert.match(source, /release && \(keyFeedback \|\| !Array\.TrueForAll\(channels, channel => channel == 0\)\)/u);
  assert.match(source, /if \(current\.Release\) \{/u);
  assert.match(source, /if \(current\.Release\) goto ProcessLightingCommand/u);
  assert.match(source, /IdleDarkTests\(\);/u);
  assert.doesNotMatch(source, /IdlePreservationTests/u);
  assert.match(source, /type == "stop" && fields == 1/u);
  assert.match(source, /type == "lights" && hasRequestId && \(fields == 3 \+ \(channels != null \? 1 : 0\) \+ \(brightness.HasValue \? 1 : 0\)\) && IsLightState\(state\)/u);
  assert.match(source, /field\.Name == "requestId" && !hasRequestId/u);
  assert.match(source, /TryGetInt64\(out requestId\)/u);
  assert.match(source, /value >= 1 && value <= 9007199254740991L/u);
  assert.match(source, /field\.Value\.GetArrayLength\(\) != 4/u);
  assert.match(source, /channel < 0 \|\| channel > 2/u);
  assert.match(source, /PeekNamedPipe/u);
  assert.doesNotMatch(source, /ReadLine\(|ReadLineAsync\(|ReadToEnd\(|Thread\.Abort/u);
  assert.match(source, /nativeError == 109 \|\| nativeError == 232\) \{ stop\.Cancel\(\); return;/u);
});

test('all native I/O is awaited before cleanup; writer is serial with bounded cancellation', () => {
  assert.match(source, /Task\.WhenAll\(ReadInputs\(\),/u);
  assert.match(source, /ReadAsync\(report, 0, report\.Length, stop\.Token\)/u);
  assert.match(source, /write\.CancelAfter\(300\)/u);
  assert.match(source, /await stream\.WriteAsync\(report, 0, report\.Length, write\.Token\)/u);
  assert.match(source, /if \(touchedLights && snapshot != null\)/u);
  assert.match(source, /WritePacket\(RestoreGlobalFrame\(snapshot\), CancellationToken\.None\)/u);
  assert.match(source, /WritePacket\(RestoreChannelsFrame\(snapshot, channel\), CancellationToken\.None\)/u);
  assert.match(source, /WritePacket\(SoftwareFrame\(false\), CancellationToken\.None\)/u);
  assert.match(source, /stream\.Dispose\(\); else handle\.Dispose\(\)/u);
  assert.match(source, /Console\.CancelKeyPress -= cancel;\s+if \(snapshot != null\) Array\.Clear\(snapshot, 0, snapshot\.Length\);\s+stop\.Dispose\(\)/u);
  assert.doesNotMatch(source, /CancelAfter\(TimeSpan\.FromSeconds\(120\)|Task\.Run\(/u);
});

test('header classification is nonmatching-only, bounded and covered by transport-free native SelfTest', () => {
  assert.match(source, /NonMatchingHeader = Math\.Min\(65535, NonMatchingHeader \+ 1\);\s+HeaderKinds\.Classify\(plain\); return;/u);
  assert.match(source, /copy\.HeaderKinds = HeaderKinds\.Copy\(\)/u);
  assert.match(source, /headerKinds = HeaderKinds/u);
  assert.match(source, /Check\(SnapshotReply\(rejected\) == null\)/u);
  for (const key of ['lightingNoRelay', 'lightingGroupFlags', 'lightingOtherOperation', 'dongle', 'notice', 'otherDevice', 'other']) {
    assert.ok(source.includes(`public int ${key} { get; set; }`));
    assert.ok(source.includes(`${key} = Math.Min(65535, ${key} + 1)`));
  }
});

test('snapshot matching fails closed before any LED mutation and preserves untouched fields', () => {
  assert.match(source, /plain\.Length < 28/u);
  assert.match(source, /\(plain\[0\] & 0x1F\) != 1/u);
  assert.match(source, /\(plain\[0\] & 0x80\) == 0/u);
  assert.match(source, /plain\[3\] != 0x11/u);
  assert.match(source, /timeout\.CancelAfter\(3000\)/u);
  assert.match(source, /bool ready = await CaptureSnapshot\(\)\.ConfigureAwait\(false\)/u);
  assert.match(source, /Array\.Copy\(saved, 4, command, 8, 20\)/u);
  assert.match(source, /await Task\.Delay\(80, stop\.Token\)/u);
  assert.match(source, /ReportResult\(current, "failed"\); \/\/ Keep input usable/u);
  assert.doesNotMatch(source, /Status\("lights_unavailable"\)/u);
  assert.doesNotMatch(source, /case "hooks"|SetFeature|RGB|0x0B, 0x89/u);
});

test('initialization trace is opt-in stderr only with a closed bounded schema', () => {
  assert.match(source, /public static bool TraceInitialization = false/u);
  assert.match(source, /if \(TraceInitialization && !selfTest\) \{ Console\.Error\.WriteLine\(LastInitializationJson\)/u);
  assert.match(source, /schema = "au05-light-init-v1"/u);
  assert.match(source, /readsWhilePending = ReadsWhilePending/u);
  assert.match(source, /CheckInitializationJson\(session\.LastInitializationJson/u);
  assert.match(source, /Math\.Min\(65535, authInitialization\.ReadsWhilePending \+ 1\)/u);
  assert.ok(script.indexOf('::TraceInitialization =') > script.indexOf("if ($Mode -eq 'SelfTest')"));
});

test('default SelfTest suppresses opt-in initialization stderr', { skip: !windows }, () => {
  assert.equal(run(['-TraceInitialization']).trim(), '{"type":"status","state":"ready"}');
});

test('HID writer never flushes after completed reports, even with a throwing flush transport', () => {
  const writer = source.slice(source.indexOf('async Task WritePacket('), source.indexOf('async Task InitializeLighting('));
  assert.doesNotMatch(writer, /FlushAsync|\.Flush\(/u);
  assert.match(source, /ThrowOnFlush = true/u);
  assert.match(source, /stream\.FlushCalls == 0 && stream\.AuthCount == 1 && stream\.LinkCount == \(stream\.ReplyToGet \? 1 : 3\)/u);
});

test('unattempted snapshot diagnostics are omitted, not fabricated, on the lights wire record', () => {
  assert.match(source, /command\.Readback == null \|\| command\.Readback\.Attempts == 0 \? ""/u);
  assert.match(source, /JsonDocument\.Parse\(LightsResultJson\(unavailable, "failed"\)\)/u);
  assert.match(source, /!zeroAttempt\.RootElement\.TryGetProperty\("readback", out omitted\)/u);
  assert.match(source, /attempted\.RootElement\.GetProperty\("readback"\)\.GetProperty\("attempts"\)\.GetInt32\(\) == 1/u);
});

test('lighting startup is bounded auth then online heartbeat then linked; failure gates lamps without cancelling input', () => {
  assert.match(source, /RandomNumberGenerator\.GetBytes\(4\)/u);
  assert.match(source, /deadline\.CancelAfter\(1500\)/u);
  assert.match(source, /deadline\.CancelAfter\(750\)/u);
  assert.match(source, /new byte\[\] \{ 6, 3, 10, 1 \}/u);
  assert.match(source, /if \(authReady && linkReady\) snapshot = await ReadSnapshot/u);
  assert.match(source, /pendingLink\.TrySetResult\(plain\[4\] != 0\)/u);
  assert.match(source, /SnapshotDelayMs = 650/u);
  assert.match(source, /Check\(!value\.stop\.IsCancellationRequested && !stream\.ReadCompleted\)/u);
  const init = source.slice(source.indexOf('async Task InitializeLightingCore()'), source.indexOf('async Task<byte[]> ReadSnapshot('));
  assert.equal((init.match(/WritePacket\(DongleAuthFrame/gu) ?? []).length, 1);
  assert.equal((init.match(/WritePacket\(DeviceActiveFrame/gu) ?? []).length, 1);
  assert.doesNotMatch(init, /Fail\(|Status\(|Console\.|for \(|while \(/u);
  const snapshot = source.slice(source.indexOf('async Task<bool> CaptureSnapshot()'), source.indexOf('bool CanRetrySnapshot()'));
  assert.equal((snapshot.match(/ReadSnapshot\(/gu) ?? []).length, 1);
  assert.doesNotMatch(snapshot, /for \(|while \(/u);
  assert.ok(init.indexOf('DongleAuthFrame') < init.indexOf('SoftwareFrame(true)'));
  assert.ok(init.indexOf('SoftwareFrame(true)') < init.indexOf('HeartbeatFrame()'));
  assert.ok(init.indexOf('HeartbeatFrame()') < init.indexOf('DeviceActiveFrame()'));
  assert.match(init, /if \(!touchedOnline \|\| \(authReady && !onlineAuthenticated\)\)/u);
  assert.equal((source.match(/WritePacket\(SoftwareFrame\(true\)/gu) ?? []).length, 1);
  assert.match(source, /!recordingRecoveryAttempted && snapshotAttempted && CanRetrySnapshot\(\)/u);
  assert.match(source, /command.State == "recording" && command.Channels\[0\] == 2/u);
  assert.match(source, /commands.Reader.TryPeek\(out next\)/u);
});

test('four indexed work writes are followed by independent readback without replacing the original snapshot', () => {
  assert.match(source, /ChannelsFrame\(byte\[\] channels, int channel\)/u);
  assert.match(source, /RestoreChannelsFrame\(byte\[\] saved, int channel\)/u);
  assert.match(source, /channel < 0 \|\| channel > 3/u);
  assert.match(source, /command\[5\] = \(byte\)channel/u);
  assert.match(source, /for \(int channel = 0; channel < 4; channel\+\+\)[\s\S]*?WritePacket\(current\.Brightness\.HasValue \? TypeFrame\(current\.Channels, channel\)[\s\S]*?: channel == 0 \? K1TypeFrame\(current\.Channels\) : ChannelsFrame\(current\.Channels, channel\)/u);
  assert.match(source, /if \(current\.Brightness\.HasValue\)[\s\S]*?WritePacket\(BrightnessFrame\(channel, current\.Brightness\.Value\)/u);
  assert.match(source, /snapshot = await ReadSnapshot\(stop\.Token, initialReadback\)/u);
  assert.equal((source.match(/snapshot = await ReadSnapshot/gu) ?? []).length, 1);
  assert.match(source, /observed = await ReadSnapshot\(stop\.Token, readback\)/u);
  assert.match(source, /string result = observed == null \? "written" : \(current\.Brightness\.HasValue \? MatchesBrightness[\s\S]*?: MatchesK1PreservingLights\(observed, current\.Channels, k1Preferences\)\) \? "verified" : "mismatch"/u);
  assert.match(source, /if \(result == "verified"\) verifiedChannels = \(byte\[\]\)current\.Channels\.Clone\(\)/u);
  assert.match(source, /lock \(snapshotGate\)/u);
  assert.match(source, /SnapshotRead read = new SnapshotRead\(saved, activeReadback\.Copy\(\)\)/u);
  assert.match(source, /pending\.TrySetCanceled\(\)/u);
  assert.match(source, /observed\[2\] != 2/u);
  assert.match(source, /i < 4; i\+\+\)[\s\S]*?observed\[offset \+ 4\] != 2/u);
});

test('K1 uses official type-only mask and verifies original preferences without weakening other channels', () => {
  const constructor = source.slice(source.indexOf('static byte[] TypeFrame('), source.indexOf('static bool MatchesK1PreservingLights('));
  assert.match(constructor, /command\[4\] = 4; command\[5\] = \(byte\)channel; command\[8 \+ 5 \* channel\] = channels\[channel\]/u);
  assert.match(constructor, /K1TypeFrame\(byte\[\] channels\) \{ return TypeFrame\(channels, 0\); \}/u);
  assert.doesNotMatch(constructor, /0x7C|0xFF|255/u);
  const matcher = source.slice(source.indexOf('static bool MatchesK1PreservingLights('), source.indexOf('static byte[] EncodeFixedCommand('));
  assert.match(matcher, /observed\[4\] != channels\[0\]/u);
  assert.match(matcher, /observed\[4 \+ j\] != original\[4 \+ j\]/u);
  assert.match(matcher, /for \(int i = 1; i < 4; i\+\+\)/u);
  assert.match(matcher, /observed\[offset \+ 1\] != 255/u);
  assert.match(source, /if \(hasLampWrite && !ExplicitBrightness\) for \(int j = 1; j < 5; j\+\+\) Check\(Current\[4 \+ j\] == Original\[4 \+ j\]\)/u);
  assert.match(source, /Current\[4 \+ 5 \* selected \+ field\] = decoded\[8 \+ 5 \* selected \+ field\]/u);
  assert.match(source, /CheckFrame\(stream\.Current, stream\.Original\)/u);
});

test('vibed workTime byte is 255 in new vectors and readback, never in saved-state restoration', () => {
  const constructor = source.slice(source.indexOf('static byte[] ChannelsFrame('), source.indexOf('static byte[] EncodeFixedCommand('));
  assert.match(constructor, /command\[offset \+ 1\] = 0xFF/u);
  assert.match(source, /observed\[offset \+ 1\] != 255/u);
  assert.match(source, /matched\[5\] = 10; Check\(!MatchesLights\(matched, matchChannels\)\); matched\[5\] = 255/u);
  const restore = source.slice(source.indexOf('static byte[] RestoreChannelsFrame('), source.indexOf('static bool MatchesLights('));
  assert.match(restore, /Array\.Copy\(saved, 4, command, 8, 20\)/u);
  assert.doesNotMatch(restore, /0xFF|255/u);
});

test('native semantic defaults mirror official task lamps without faking progress during recording', () => {
  const defaults = source.slice(source.indexOf('static byte[] DefaultChannels('), source.indexOf('static byte[] ChannelsFrame('));
  for (const [state, channels] of Object.entries({
    idle: [0, 0, 0, 0], running: [0, 0, 0, 1], approval: [0, 2, 0, 0],
    attention: [0, 0, 2, 0], recording: [2, 0, 0, 0],
  })) assert.ok(defaults.includes(`case "${state}": return new byte[] { ${channels.join(', ')} };`));
});

test('encoder uses 64-byte Windows framing, complete TEA blocks and zero padding', () => {
  assert.match(source, /Array\.Copy\(cipher, 0, report, 1, 63\)/u);
  assert.match(source, /report\[0\] = 0x55/u);
  assert.match(source, /offset < 64; offset \+= 8\) EncryptBlock/u);
  assert.match(source, /offset < 56; offset \+= 8\) DecryptBlock/u);
  assert.match(source, /new byte\[64\], cipher = new byte\[64\], report = new byte\[64\]/u);
});

test('offline default and explicit SelfTest compile and exercise synthetic lifecycle', { skip: !windows }, () => {
  for (const args of [[], ['-Mode', 'SelfTest'], ['-Mode', 'SelfTest', '-EnableLights']]) {
    const output = run(args);
    assert.deepEqual(output.trim().split(/\r?\n/u).map(line => JSON.parse(line)), [{ type: 'status', state: 'ready' }]);
  }
});

test('independent JS frames match private C# output constructors without opening any device', { skip: !windows }, () => {
  const channels = [2, 2, 1, 0];
  const records = channels.flatMap(value => [value, 255, 2, 2, 2]);
  const original = [2, 1, 1, 1, 2, 10, 2, 4, 7, 0, 10, 2, 4, 7, 0, 10, 2, 4, 7, 1, 10, 2, 7, 4];
  const fixtures = [
    ['LightsFrame', "$arguments = [object[]]@('idle')", [1, 0x0B, 0x88, 4, 1, 0, 0]],
    ['LightsFrame', "$arguments = [object[]]@('running')", [1, 0x0B, 0x88, 4, 1, 0, 1]],
    ['LightsFrame', "$arguments = [object[]]@('auto')", [1, 0x0B, 0x88, 4, 1, 0, 2]],
    ['SoftwareFrame', '$arguments = [object[]]@($true)', [1, 1, 0x10, 0, 3]],
    ['SoftwareFrame', '$arguments = [object[]]@($false)', [1, 1, 0x10, 0, 0]],
    ['HeartbeatFrame', '$arguments = [object[]]@()', [6, 1, 0x23, 0, 1]],
    ['GetLightsFrame', '$arguments = [object[]]@()', [1, 0x0B, 0x88, 1]],
    ...[0, 2].map(type => [
      'K1TypeFrame', `$arguments = [object[]]::new(1); $arguments[0] = [byte[]]@(${type},2,1,0)`,
      [1, 0x0B, 0x88, 4, 4, 0, 0, 0, type],
    ]),
    ...Array.from({ length: 4 }, (_, channel) => [
      'ChannelsFrame', `$arguments = [object[]]::new(2); $arguments[0] = [byte[]]@(2,2,1,0); $arguments[1] = [int]${channel}`,
      [1, 0x0B, 0x88, 4, 0x7C, channel, 0, 0, ...records],
    ]),
    ['RestoreGlobalFrame', `$arguments = [object[]]::new(1); $arguments[0] = [byte[]]@(${original.join(',')})`, [1, 0x0B, 0x88, 4, 1, 0, original[2]]],
    ...Array.from({ length: 4 }, (_, channel) => [
      'RestoreChannelsFrame', `$arguments = [object[]]::new(2); $arguments[0] = [byte[]]@(${original.join(',')}); $arguments[1] = [int]${channel}`,
      [1, 0x0B, 0x88, 4, 0x7C, channel, 0, 0, ...original.slice(4)],
    ]),
  ];
  assert.equal(frame([1, 0x0B, 0x88, 1]).subarray(1, 9).toString('hex'), '4e3e821620cff3ac');
  const assertions = fixtures.map(([method, parameters, payload]) => {
    const expected = frame(payload).toString('base64');
    return `${parameters}; $m = [DshAu05.Native].GetMethod('${method}', [Reflection.BindingFlags]'NonPublic,Static'); $bytes = $m.Invoke($null, $arguments); if ([Convert]::ToBase64String($bytes) -cne '${expected}') { throw 'independent_frame_failed_${method}' }`;
  }).join('\n');
  // Compile only the embedded source; SelfTest uses synthetic Streams and no native imports are called.
  const results = ['verified', 'written', 'mismatch', 'failed'];
  const resultAssertions = `
    $commandType = [DshAu05.Native].GetNestedType('Command', [Reflection.BindingFlags]'NonPublic');
    $request = [Activator]::CreateInstance($commandType, $true);
    $commandType.GetField('State', [Reflection.BindingFlags]'NonPublic,Instance').SetValue($request, 'approval');
    $commandType.GetField('RequestId', [Reflection.BindingFlags]'NonPublic,Instance').SetValue($request, [long]9007199254740991);
    $emit = [DshAu05.Native].GetMethod('LightsResult', [Reflection.BindingFlags]'NonPublic,Static');
    foreach ($result in @('verified','written','mismatch','failed','not_allowed')) { $emit.Invoke($null, [object[]]@($request, $result)) }
  `;
  const command = `$ErrorActionPreference = 'Stop'; $source = [Console]::In.ReadToEnd(); Add-Type -TypeDefinition $source -Language CSharp; ${assertions}\n${resultAssertions}\n'passed'`;
  const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    { input: source, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  const lines = output.trim().split(/\r?\n/u);
  assert.equal(lines.pop(), 'passed');
  assert.deepEqual(lines.map(line => JSON.parse(line)), results.map(result => ({
    type: 'lights', state: 'approval', result, requestId: Number.MAX_SAFE_INTEGER,
  })));
});

test('bounded initialization recovery preserves input, baseline, release ordering and unrelated tasks using only SyntheticStream', { skip: !windows }, () => {
  const evidenceMethod = `
    static async Task AwaitRecoveryResults(Session value, int count) {
      while (value.Results.Count < count) await Task.Delay(5, value.stop.Token).ConfigureAwait(false);
    }
    public static string InitializationRecoveryEvidence() {
      var evidence = new List<object>();
      foreach (string scenario in new string[] { "online", "link_recover", "auth_recover", "failed_link", "failed_get", "stale_link",
          "idle", "not_recording", "wrong_k1", "existing", "cancel_auth", "cancel_get", "released", "task_change", "disabled", "older_off" }) {
        using (SyntheticStream stream = new SyntheticStream { LinkedOnlyOnline = true }) {
          stream.Linked = scenario == "online" || scenario == "failed_get" || scenario == "stale_link" || scenario == "existing";
          stream.SuppressAuth = scenario == "auth_recover" || scenario == "cancel_auth";
          stream.ReplyToGet = scenario != "failed_get" && scenario != "stale_link";
          var ends = new List<int>();
          Session session = new Session(stream, true, async delegate(Session value) {
            await stream.ReadStarted.Task.ConfigureAwait(false);
            Check(value.commands.Writer.TryWrite(new Command { State = "running", Channels = new byte[] { 0, 0, 0, 1 }, RequestId = 1 }));
            await AwaitRecoveryResults(value, 1).ConfigureAwait(false);
            Check(value.Results[0] == (scenario == "online" || scenario == "existing" ? "verified" : "failed"));
            ends.Add(stream.Frames.Count);
            if (scenario == "online") { value.stop.Cancel(); return; }
            if (scenario == "auth_recover") stream.SuppressAuth = false;
            if (scenario == "stale_link") { stream.SuppressLink = true; stream.ReplyToGet = true; }
            if (scenario != "failed_link" && scenario != "idle" && scenario != "not_recording" && scenario != "wrong_k1") stream.Linked = true;
            if (scenario == "idle" || scenario == "not_recording" || scenario == "wrong_k1") {
              Check(value.commands.Writer.TryWrite(new Command { State = scenario == "wrong_k1" ? "recording" : scenario == "not_recording" ? "running" : "idle",
                Channels = scenario == "not_recording" ? new byte[] { 2, 0, 0, 0 } : new byte[4], RequestId = 2 }));
              await AwaitRecoveryResults(value, 2).ConfigureAwait(false);
            } else {
              if (scenario == "cancel_get" || scenario == "released" || scenario == "task_change" || scenario == "disabled" || scenario == "older_off") stream.SnapshotDelayMs = 650;
              Check(value.commands.Writer.TryWrite(new Command { State = "recording", Channels = new byte[] { 2, 0, 0, 0 }, RequestId = 2 }));
              if (scenario == "cancel_auth") {
                while (stream.AuthCount < 2) await Task.Delay(5).ConfigureAwait(false);
                await Task.Delay(850).ConfigureAwait(false); // Exercise heartbeat and live input during the long auth wait.
                stream.InjectInput();
                while (value.sequence == 0) await Task.Delay(5).ConfigureAwait(false);
                Check(stream.HeartbeatCount >= 2);
                value.stop.Cancel(); return;
              }
              if (scenario == "cancel_get" || scenario == "released" || scenario == "task_change" || scenario == "disabled" || scenario == "older_off") {
                await stream.GetStarted.Task.ConfigureAwait(false);
                if (scenario == "cancel_get") { value.stop.Cancel(); return; }
                Check(value.commands.Writer.TryWrite(new Command { State = scenario == "disabled" ? "recording" : scenario == "task_change" ? "attention" : "idle",
                  Channels = scenario == "task_change" ? new byte[] { 0, 0, 2, 0 } : new byte[4], RequestId = scenario == "older_off" ? 1 : 3 }));
              }
              await AwaitRecoveryResults(value, scenario == "released" || scenario == "task_change" || scenario == "disabled" || scenario == "older_off" ? 3 : 2).ConfigureAwait(false);
              ends.Add(stream.Frames.Count);
              if (scenario == "failed_link" || scenario == "failed_get" || scenario == "stale_link" || scenario == "existing" || scenario == "auth_recover") {
                Check(value.commands.Writer.TryWrite(new Command { State = "recording", Channels = new byte[] { 2, 0, 0, 0 }, RequestId = 4 }));
                await AwaitRecoveryResults(value, 3).ConfigureAwait(false);
              }
            }
            Check(!value.stop.IsCancellationRequested && !stream.ReadCompleted);
            value.stop.Cancel();
          });
          session.Run().WaitAsync(TimeSpan.FromSeconds(13)).GetAwaiter().GetResult();
          Check(stream.ReadCompleted && stream.PeakWrites == 1 && stream.FlushCalls == 0 && !stream.Online);
          CheckFrame(stream.Current, stream.Original);
          evidence.Add(new { scenario, results = session.Results, ids = session.ResultIds, ends, auth = stream.AuthCount,
            link = stream.LinkCount, get = stream.GetCount, heartbeat = stream.HeartbeatCount,
            original = Convert.ToBase64String(stream.Original), frames = stream.Frames.ConvertAll(Convert.ToBase64String) });
        }
      }
      return JsonSerializer.Serialize(evidence);
    }
  `;
  const testSource = source.replace('public static void SelfTest() {', `${evidenceMethod}\npublic static void SelfTest() {`)
    // Isolate the pre-existing recording-specific recovery path; automatic retry is covered separately.
    .replace('while (!ready && CanRetrySnapshot())', 'while (!ready && CanRetrySnapshot() && selfTest == false)')
    .replace('long sequence;', 'internal long sequence;')
    .replace('internal readonly List<string> Results', 'internal readonly List<long> ResultIds = new List<long>(); internal readonly List<string> Results')
    .replace('Results.Add(result);', 'Results.Add(result); ResultIds.Add(command.RequestId);')
    .replace('internal SyntheticStream() {', 'internal void InjectInput() { responses.Writer.TryWrite(EncodeFixedCommand(new byte[] { 0x8B, 0x10, 0, 0, 0 })); } internal SyntheticStream() {');
  const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; [DshAu05.Native]::InitializationRecoveryEvidence()"],
  { input: testSource, encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024 });
  const lines = output.trim().split(/\r?\n/u);
  const evidence = JSON.parse(lines.pop());
  assert.deepEqual(lines.map(line => JSON.parse(line).event), ['k1.up']);
  const packet = payload => frame(payload).toString('base64');
  const online = packet([1, 1, 0x10, 0, 3]), offline = packet([1, 1, 0x10, 0, 0]);
  const get = packet([1, 0x0B, 0x88, 1]);
  const full = channels => [packet([1, 0x0B, 0x88, 4, 1, 0, 2]),
    packet([1, 0x0B, 0x88, 4, 4, 0, 0, 0, channels[0]]),
    ...[1, 2, 3].map(focus => packet([1, 0x0B, 0x88, 4, 0x7C, focus, 0, 0,
      ...channels.flatMap(type => [type, 255, 2, 2, 2])])), get];
  for (const item of evidence) {
    assert.equal(item.frames.filter(value => value === online).length, item.scenario === 'auth_recover' ? 2 : 1, item.scenario);
    assert.equal(item.frames.at(-1), offline, item.scenario);
    assert.ok(item.auth <= 2 && item.link <= 2, item.scenario);
    const original = [...Buffer.from(item.original, 'base64')];
    const cleanup = [packet([1, 0x0B, 0x88, 4, 1, 0, original[2]]),
      ...[0, 1, 2, 3].map(focus => packet([1, 0x0B, 0x88, 4, 0x7C, focus, 0, 0, ...original.slice(4)])), offline];
    if (['failed_link', 'failed_get', 'stale_link', 'idle', 'not_recording', 'wrong_k1', 'cancel_auth', 'cancel_get'].includes(item.scenario)) {
      assert.ok(item.results.every(value => value === 'failed'), `${item.scenario}: dark idle requires a valid snapshot just like every takeover write`);
      assert.deepEqual(item.frames, [online, ...Array.from({ length: item.get }, () => get), offline], item.scenario);
      assert.equal(item.link, ['idle', 'not_recording', 'wrong_k1'].includes(item.scenario) ? 1 : item.scenario === 'cancel_auth' ? 0 : 2, item.scenario);
      assert.equal(item.get, item.scenario === 'failed_get' ? 2 : ['cancel_get', 'stale_link'].includes(item.scenario) ? 1 : 0, item.scenario);
      continue;
    }
    if (['released', 'disabled'].includes(item.scenario)) {
      assert.deepEqual(item.results, ['failed', 'failed', 'verified']);
      assert.deepEqual(item.ids, [1, 2, 3]);
      assert.deepEqual(item.frames, [online, get, ...full([0, 0, 0, 0]), ...cleanup],
        'K1 release or K1-only disable still owns and darkens the idle lamps');
      continue;
    }
    if (item.scenario === 'older_off') {
      assert.deepEqual(item.results, ['failed', 'verified', 'verified']);
      assert.deepEqual(item.frames, [online, get, ...full([2, 0, 0, 0]),
        packet([1, 0x0B, 0x88, 4, 4, 0, 0, 0, 0]), get, ...cleanup]);
      continue;
    }
    assert.deepEqual(item.frames.slice(-6), cleanup, item.scenario);
    if (item.scenario === 'task_change') {
      assert.deepEqual(item.results, ['failed', 'failed', 'verified'], item.scenario);
      const last = full([0, 0, 2, 0]);
      assert.deepEqual(item.frames, [online, get, ...last, ...cleanup], 'latest task is applied without a stale recording write');
    } else if (item.scenario === 'existing') {
      assert.equal(item.link, 1); assert.equal(item.auth, 1); assert.equal(item.get, 4);
      assert.deepEqual(item.results, ['verified', 'verified', 'verified']);
    } else if (item.scenario === 'online') {
      assert.equal(item.link, 1); assert.deepEqual(item.results, ['verified']);
    } else {
      assert.equal(item.auth, item.scenario === 'auth_recover' ? 2 : 1);
      assert.equal(item.link, item.scenario === 'auth_recover' ? 1 : 2);
      assert.deepEqual(item.results, item.scenario === 'auth_recover' ? ['failed', 'verified', 'verified'] : ['failed', 'verified']);
    }
  }
});

test('actual verified K1 transitions isolate focus0; unknown baselines and task changes retain full transactions', { skip: !windows }, () => {
  // Inject test-only evidence collection into the embedded class, using its real Session and
  // synthetic transport. Expected encrypted packets below come only from the independent JS encoder.
  const evidenceMethod = `
    public static string K1TransactionEvidence() {
      var evidence = new List<object>();
      foreach (string scenario in new string[] { "verified", "unprepared", "initial_mismatch", "initial_unknown",
          "transition_mismatch", "transition_unknown", "transition_malformed", "transition_failed" }) {
        using (SyntheticStream stream = new SyntheticStream()) {
          byte[][] vectors = scenario == "verified" ? new byte[][] {
            new byte[] { 0, 2, 1, 1 }, new byte[] { 2, 2, 1, 1 }, new byte[] { 0, 2, 1, 1 },
            new byte[] { 0, 2, 1, 1 }, new byte[] { 2, 0, 2, 0 }, new byte[] { 0, 0, 2, 0 }
          } : scenario == "unprepared" ? new byte[][] { new byte[4], new byte[4] }
            : new byte[][] { new byte[] { 0, 2, 1, 1 }, new byte[] { 2, 2, 1, 1 }, new byte[] { 0, 2, 1, 1 } };
          var ends = new List<int>();
          Session session = new Session(stream, true, async delegate(Session value) {
            await stream.ReadStarted.Task.ConfigureAwait(false);
            for (int i = 0; i < vectors.Length; i++) {
              bool inject = i == (scenario.StartsWith("initial_") ? 0 : 1);
              stream.MismatchReadback = inject && scenario.EndsWith("mismatch");
              stream.ReplyToReadback = !(inject && scenario.EndsWith("unknown"));
              stream.MalformedReadback = inject && scenario.EndsWith("malformed");
              stream.FailReadback = inject && scenario.EndsWith("failed");
              Check(value.commands.Writer.TryWrite(new Command { State = vectors[i][0] == 2 ? "recording" : "idle",
                Channels = vectors[i], RequestId = i + 1 }));
              while (value.Results.Count <= i) await Task.Delay(5).ConfigureAwait(false);
              if (stream.FailReadback) break; // Failure cleanup can already be running when the result is observed.
              ends.Add(stream.Frames.Count);
            }
            value.stop.Cancel();
          });
          Task run = session.Run();
          bool failed = false;
          try { run.WaitAsync(TimeSpan.FromSeconds(12)).GetAwaiter().GetResult(); }
          catch (Failure failure) { Check(failure.Code == "write_failed"); failed = true; }
          Check(failed == scenario.EndsWith("failed"));
          Check(stream.ReadCompleted && stream.PeakWrites == 1 && stream.AuthCount == 1 && stream.LinkCount == 1
            && stream.HeartbeatCount >= 1 && stream.FlushCalls == 0);
          CheckFrame(stream.Current, stream.Original);
          evidence.Add(new { scenario, results = session.Results, ends,
            original = Convert.ToBase64String(stream.Original),
            frames = stream.Frames.ConvertAll(packet => Convert.ToBase64String(packet)) });
        }
      }
      return JsonSerializer.Serialize(evidence);
    }
  `;
  const testSource = source.replace('public static void SelfTest() {', `${evidenceMethod}\npublic static void SelfTest() {`);
  const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()) -Language CSharp; [DshAu05.Native]::K1TransactionEvidence()"],
  { input: testSource, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  const evidence = JSON.parse(output);
  assert.equal(evidence.length, 8);
  const packet = payload => frame(payload).toString('base64');
  const get = packet([1, 0x0B, 0x88, 1]);
  const full = channels => [
    packet([1, 0x0B, 0x88, 4, 1, 0, 2]),
    packet([1, 0x0B, 0x88, 4, 4, 0, 0, 0, channels[0]]),
    ...[1, 2, 3].map(focus => packet([1, 0x0B, 0x88, 4, 0x7C, focus, 0, 0,
      ...channels.flatMap(type => [type, 255, 2, 2, 2])])), get,
  ];
  const isolated = channels => [packet([1, 0x0B, 0x88, 4, 4, 0, 0, 0, channels[0]]), get];
  for (const item of evidence) {
    const off = [0, 2, 1, 1], on = [2, 2, 1, 1];
    let transactions, results;
    if (item.scenario === 'verified') {
      transactions = [full(off), isolated(on), isolated(off), full(off), full([2, 0, 2, 0]), isolated([0, 0, 2, 0])];
      results = transactions.map(() => 'verified');
    } else if (item.scenario === 'unprepared') {
      transactions = [full([0, 0, 0, 0]), full([0, 0, 0, 0])];
      results = ['verified', 'verified'];
    } else if (item.scenario.startsWith('initial_')) {
      transactions = [full(off), item.scenario === 'initial_unknown' ? [get, ...full(on)] : full(on), isolated(off)];
      results = [item.scenario.endsWith('mismatch') ? 'mismatch' : 'written', 'verified', 'verified'];
    } else {
      transactions = [full(off), isolated(on)];
      results = ['verified', item.scenario.endsWith('mismatch') ? 'mismatch' : item.scenario.endsWith('failed') ? 'failed' : 'written'];
      if (!item.scenario.endsWith('failed')) {
        transactions.push(['transition_unknown', 'transition_malformed'].includes(item.scenario) ? [get, ...full(off)] : full(off));
        results.push('verified');
      }
    }
    assert.deepEqual(item.results, results, item.scenario);
    const expected = [packet([1, 1, 0x10, 0, 3]), get];
    const ends = [];
    for (const transaction of transactions) { expected.push(...transaction); ends.push(expected.length); }
    if (item.scenario.endsWith('failed')) ends.pop();
    assert.deepEqual(item.ends, ends, `${item.scenario}: exact transaction boundaries`);
    const recoveryIndex = item.scenario === 'initial_unknown' ? 1
      : ['transition_unknown', 'transition_malformed'].includes(item.scenario) ? 2 : null;
    if (recoveryIndex !== null) {
      const start = item.ends[recoveryIndex - 1];
      assert.equal(item.frames[start], get, `${item.scenario}: fresh baseline GET precedes all recovery writes`);
      assert.equal(item.frames[start + 1], packet([1, 0x0B, 0x88, 4, 1, 0, 2]), `${item.scenario}: global write follows baseline GET`);
    }
    const original = [...Buffer.from(item.original, 'base64')];
    expected.push(packet([1, 0x0B, 0x88, 4, 1, 0, original[2]]));
    for (let focus = 0; focus < 4; focus++) expected.push(packet([1, 0x0B, 0x88, 4, 0x7C, focus, 0, 0, ...original.slice(4)]));
    expected.push(packet([1, 1, 0x10, 0, 0]));
    assert.deepEqual(item.frames, expected, `${item.scenario}: no global/other writes on isolated K1; exact cleanup`);
  }
});

test('K1 preservation baseline commits observations and recovers unknown consecutive writes', () => {
  assert.doesNotMatch(source, /k1Preferences\[7\] = current\.Brightness/u);
  assert.match(source, /k1Preferences = observed == null \? null : \(byte\[\]\)observed\.Clone\(\)/u);
  assert.match(source, /k1BaselineUnknown = observed == null/u);
  assert.match(source, /if \(k1BaselineUnknown\)/u);
  assert.match(source, /k1Preferences = await ReadSnapshot\(stop\.Token, baselineReadback\)/u);
  assert.match(source, /static void BrightnessBaselineTests\(\)/u);
  assert.match(source, /BrightnessBaselineTests\(\);/u);
});

test('explicit brightness has closed byte parsing and preserves timing with strict readback', () => {
  assert.match(source, /TryGetByte\(out level\)/u);
  assert.match(source, /internal byte\? Brightness/u);
  const brightness = source.slice(source.indexOf('static byte[] BrightnessFrame('), source.indexOf('static bool MatchesBrightness('));
  assert.doesNotMatch(brightness, /0x7C|Array\.Copy|saved|snapshot/u);
  assert.match(brightness, /command\[4\] = \(byte\)\(channel == 3 \? 0x40 : 0x20\)/u);
  assert.match(brightness, /command\[8 \+ 5 \* channel \+ \(channel == 3 \? 4 : 3\)\] = brightness/u);
  assert.match(source, /!current\.Brightness\.HasValue && !verifiedBrightness\.HasValue/u);
  assert.match(source, /ReadbackLifecycle\(new SyntheticStream\(\), "verified", false, brightness\)/u);
});
