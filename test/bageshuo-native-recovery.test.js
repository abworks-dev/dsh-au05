// Runs the actual native ObserveCore loop with uniquely replaced, pure fake metadata seams.
// The shipped PowerShell script and Runner.Observe are never invoked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const source = readFileSync(new URL('../packages/dsh-plugin/native/bageshuo-state.ps1', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const csharp = source.match(/\$source = @'\n([\s\S]*?)\n'@/)[1];
const occurrences = (text, needle) => text.split(needle).length - 1;

function replaceOnce(text, before, after) {
  assert.equal(occurrences(text, before), 1, `fixture injection must be unique: ${before}`);
  return text.replace(before, after);
}
function fakeMethod(text, signature, nextSignature, replacement) {
  assert.equal(occurrences(text, signature), 1, `metadata seam must be unique: ${signature}`);
  assert.equal(occurrences(text, nextSignature), 1, `metadata seam end must be unique: ${nextSignature}`);
  const start = text.indexOf(signature), end = text.indexOf(nextSignature, start);
  assert.ok(end > start);
  assert.doesNotMatch(replacement, /\b(?:Native|Activator|Marshal|Process|Win32ProcessIdentityApi)\b/);
  return text.slice(0, start) + replacement + text.slice(end);
}

const fixtures = String.raw`
namespace DshBageshuoState
{
    internal static class RecoveryFixture
    {
        internal static readonly Identity Root = new Identity(10, @"C:\Fixture\bageshuo.exe", 100);
        private static readonly System.Threading.ManualResetEventSlim ReleaseOld = new(false);
        internal static int Polls, Trees, Checks, Discoveries, Probes, ProbeDuringOldPoll;
        internal static int SlowSampleMilliseconds = 0;
        internal static readonly FakeClock Clock = new();
        internal sealed class FakeClock
        {
            private long elapsed;
            internal long ElapsedMilliseconds => System.Threading.Interlocked.Add(ref elapsed, 25);
            internal void Advance(int milliseconds) => System.Threading.Interlocked.Add(ref elapsed, milliseconds);
        }
        private static int oldPollBlocked;
        internal static PinState Check(Identity expected)
        {
            System.Threading.Interlocked.Increment(ref Checks);
            if (!Rules.Same(Root, expected)) throw new System.InvalidOperationException("fake_pin_changed");
            return PinState.Ok;
        }
        internal static bool ReadTree(out System.Collections.Generic.Dictionary<int, Node> nodes)
        {
            System.Threading.Interlocked.Increment(ref Trees);
            nodes = new System.Collections.Generic.Dictionary<int, Node> { [Root.Pid] = new Node(Root, 1) };
            return true;
        }
        internal static void PollAudio(Frame frame)
        {
            int poll = System.Threading.Interlocked.Increment(ref Polls);
            if (poll == 1)
            {
                System.Threading.Volatile.Write(ref oldPollBlocked, 1);
                System.Console.WriteLine("{\"fixture\":\"old_poll_blocked\"}"); System.Console.Out.Flush();
                if (!ReleaseOld.Wait(System.TimeSpan.FromSeconds(5)))
                    throw new System.InvalidOperationException("fake_probe_timeout");
                System.Threading.Volatile.Write(ref oldPollBlocked, 0);
                frame.Active = 1;
            }
            else if (poll == 2 && SlowSampleMilliseconds > 0)
            {
                frame.Active = 1; // A slow old positive must be demoted by production freshness logic.
                Clock.Advance(SlowSampleMilliseconds);
            }
        }
        internal static void Probe(int next)
        {
            if (next != 1) throw new System.InvalidOperationException("fake_unexpected_probe");
            System.Threading.Interlocked.Increment(ref Probes);
            if (System.Threading.Volatile.Read(ref oldPollBlocked) == 1)
                System.Threading.Volatile.Write(ref ProbeDuringOldPoll, 1);
            ReleaseOld.Set();
        }
    }
}
`;

function fakeLoopSource({ slowSample = false } = {}) {
  let code = fakeMethod(csharp, '        private static PinState Check(Identity expected)',
    '        private static string PinError(',
    '        private static PinState Check(Identity expected) => RecoveryFixture.Check(expected);\n');
  code = fakeMethod(code, '        private static bool ReadTree(out Dictionary<int, Node> nodes)',
    '        private static string UniqueRoot(',
    '        private static bool ReadTree(out Dictionary<int, Node> nodes) => RecoveryFixture.ReadTree(out nodes);\n');
  code = fakeMethod(code, '        private static void PollAudio(Frame frame, Dictionary<int, Identity> targets, HashSet<int> uncertain)',
    '        public static int Observe()',
    '        private static void PollAudio(Frame frame, Dictionary<int, Identity> targets, HashSet<int> uncertain) => RecoveryFixture.PollAudio(frame);\n');
  code = replaceOnce(code, '            Volatile.Write(ref request, next);',
    '            Volatile.Write(ref request, next);\n            RecoveryFixture.Probe(next);');
  code = replaceOnce(code, '                string error = UniqueRoot(initial, out Identity expected);',
    '                RecoveryFixture.Discoveries++;\n                string error = UniqueRoot(initial, out Identity expected);');
  code = replaceOnce(code, '    public static class Runner\n    {', `    public static class Runner\n    {
        public static int FixtureObserveCore()
        {
            int result = ObserveCore();
            Console.WriteLine(JsonSerializer.Serialize(new { fixture = "summary", result,
                polls = RecoveryFixture.Polls, trees = RecoveryFixture.Trees, checks = RecoveryFixture.Checks,
                discoveries = RecoveryFixture.Discoveries, probes = RecoveryFixture.Probes,
                probeDuringOldPoll = RecoveryFixture.ProbeDuringOldPoll }));
            Console.Out.Flush();
            return result;
        }`);
  assert.match(code, /ObserverControl\.SampleFresh\(sampleAt, clock\.ElapsedMilliseconds\)/);
  // Keep both scenarios independent of compiler/CI scheduling delays while a fake poll is gated.
  code = replaceOnce(code, '                var clock = Stopwatch.StartNew();',
    '                var clock = RecoveryFixture.Clock;');
  const loop = code.slice(code.indexOf('        private static int ObserveCore()'), code.indexOf('        private static void Assert(bool condition)'));
  assert.doesNotMatch(loop, /\b(?:Native|Activator|Marshal|Process)\s*\./);
  assert.doesNotMatch(fixtures, /\b(?:Native|Activator|Marshal|Process|Win32ProcessIdentityApi)\b/);
  assert.match(code, /private static PinState Check\(Identity expected\) => RecoveryFixture\.Check\(expected\);/);
  assert.match(code, /private static bool ReadTree\(out Dictionary<int, Node> nodes\) => RecoveryFixture\.ReadTree\(out nodes\);/);
  assert.match(code, /private static void PollAudio\([^\n]+\) => RecoveryFixture\.PollAudio\(frame\);/);
  return code + (slowSample ? replaceOnce(fixtures, 'internal static int SlowSampleMilliseconds = 0;',
    'internal static int SlowSampleMilliseconds = 2000;') : fixtures);
}

test('fake native recovery harness uniquely removes every process and CoreAudio metadata seam before execution', () => {
  assert.ok(fakeLoopSource().includes('public static int FixtureObserveCore()'));
});

async function runNativeLoop(t, { slowSample = false } = {}) {
    const code = fakeLoopSource({ slowSample }); // All safety guards execute before a child can start.
    const command = `$ErrorActionPreference = 'Stop'; try {
      $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()));
      Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop;
      $result = [DshBageshuoState.Runner]::FixtureObserveCore(); exit $result
    } catch { [Console]::Error.WriteLine($_); exit 1 }`;
    assert.doesNotMatch(command, /-Mode|Runner\]::Observe\(/);
    const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, TERM: 'dumb' } });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stderr = '', probed = false, ended = false, summary;
    child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr += text; });
    const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const rows = [];
    child.stdin.write(Buffer.from(code, 'utf8').toString('base64') + '\n');
    const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const line of output) {
      const row = JSON.parse(line);
      rows.push(row);
      if (row.fixture === 'old_poll_blocked') {
        assert.equal(probed, false); probed = true;
        child.stdin.write('probe:1\n');
      } else if (row.state === (slowSample ? 'unknown' : 'idle') && row.request === 1 && !ended) {
        ended = true; child.stdin.end();
      } else if (row.fixture === 'summary') summary = row;
    }
    assert.equal(await closed, 0, stderr);
    assert.equal(stderr, ''); assert.equal(probed, true); assert.equal(ended, true);
    assert.ok(summary, 'EOF must return from the actual ObserveCore loop');
    const states = rows.filter(row => Object.hasOwn(row, 'state'));
    assert.deepEqual(states[0], { state: 'recording', error: null, request: 0 }, 'the old blocked sample keeps its captured tag');
    assert.deepEqual(states[1], slowSample
      ? { state: 'unknown', error: 'capture_unknown', request: 1 }
      : { state: 'idle', error: null, request: 1 }, 'only the next complete poll observes the challenge, and slow capture is not trusted');
    assert.equal(states.every(row => row.error === null || slowSample && row.error === 'capture_unknown'), true);
    assert.equal(summary.result, 0); assert.equal(summary.probeDuringOldPoll, 1);
    assert.equal(summary.probes, 1); assert.equal(summary.discoveries, 1, 'recovery never re-enters initial discovery');
    assert.ok(summary.polls >= 2); assert.equal(summary.trees, summary.polls + 1);
    assert.equal(summary.checks, summary.polls * 3, 'each fake poll traverses pre/post/root identity validation');
}

test('real ObserveCore stdin challenge cannot relabel an already blocked fake poll; next pinned poll recovers and EOF stops',
  { skip: process.platform !== 'win32', timeout: 15000 }, t => runNativeLoop(t));

test('matching challenge with a 2-second fake-clock sample demotes old recording to unknown without a real 2-second sleep',
  { skip: process.platform !== 'win32', timeout: 15000 }, t => runNativeLoop(t, { slowSample: true }));
