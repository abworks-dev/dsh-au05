import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const nativeURL = new URL('../packages/dsh-plugin/native/bageshuo-state.ps1', import.meta.url);
const source = readFileSync(nativeURL, 'utf8');

// Compile these fixtures into the same assembly as the shipped C# source. Only
// the fake adapter is invoked: no process handles, waits, COM, endpoints or Observe.
const fixtures = String.raw`
namespace DshBageshuoState
{
    internal sealed class FakeIdentityApi : IProcessIdentityApi
    {
        internal readonly System.Collections.Generic.List<string> Calls = new();
        internal readonly System.Collections.Generic.Queue<uint> Waits = new();
        internal uint Access;
        internal int Error = 5, Closes;
        internal bool OpenFails, TimesOk = true, ImageOk = true;
        internal string ThrowAt, Path = @"C:\Verified\bageshuo.exe";
        internal long Created = 100, Exited = unchecked((long)0xDEADBEEFCAFEBABEUL);
        private int waits;
        private void Call(string name)
        {
            Calls.Add(name);
            if (ThrowAt == name) throw new System.InvalidOperationException("fixture_failure");
        }
        public System.IntPtr Open(uint access, int pid, out int error)
        {
            Call("open"); Access = access; error = Error;
            return OpenFails ? System.IntPtr.Zero : new System.IntPtr(42);
        }
        public uint Wait(System.IntPtr handle)
        {
            Call("wait" + ++waits);
            return Waits.Count == 0 ? ProcessIdentity.WaitTimeout : Waits.Dequeue();
        }
        public bool Times(System.IntPtr handle, out Native.FILETIME created, out Native.FILETIME exited,
            out Native.FILETIME kernel, out Native.FILETIME user)
        {
            Call("times");
            created = new Native.FILETIME { Low = (uint)Created, High = (uint)((ulong)Created >> 32) };
            exited = new Native.FILETIME { Low = (uint)Exited, High = (uint)((ulong)Exited >> 32) };
            kernel = user = default;
            return TimesOk;
        }
        public bool Image(System.IntPtr handle, out string image)
        {
            Call("image"); image = Path; return ImageOk;
        }
        public void Close(System.IntPtr handle) { Call("close"); Closes++; }
    }
    public static class LivenessRegression
    {
        private static readonly System.Collections.Generic.List<string> Passed = new();
        private static void Assert(bool ok) { if (!ok) throw new System.Exception("regression_failed"); }
        private static Identity Read(FakeIdentityApi api, IdentityRead expected, string calls)
        {
            IdentityRead result = ProcessIdentity.Read(10, api, out Identity id);
            Assert(result == expected);
            Assert((id != null) == (expected == IdentityRead.Ok));
            Assert(api.Access == 0x00101000); // query-limited + SYNCHRONIZE, nothing writable.
            Assert(api.Closes == (api.OpenFails ? 0 : 1));
            Assert(string.Join(",", api.Calls) == calls);
            return id;
        }
        private static void Case(string name, System.Action action) { action(); Passed.Add(name); }
        public static string Run()
        {
            Case("running ignores every exit FILETIME", () => {
                foreach (long exit in new[] { 0L, 1L, -1L, unchecked((long)0xDEADBEEFCAFEBABEUL) }) {
                    var api = new FakeIdentityApi { Exited = exit };
                    Identity id = Read(api, IdentityRead.Ok, "open,wait1,times,image,wait2,close");
                    Assert(id.Pid == 10 && id.Start == 100 && id.Image == api.Path);
                }
            });
            Case("pre-read signaled is gone without metadata", () => {
                var api = new FakeIdentityApi(); api.Waits.Enqueue(ProcessIdentity.WaitObject0);
                Read(api, IdentityRead.Gone, "open,wait1,close");
            });
            Case("post-read signaled is gone without identity", () => {
                var api = new FakeIdentityApi(); api.Waits.Enqueue(0x102); api.Waits.Enqueue(0);
                Read(api, IdentityRead.Gone, "open,wait1,times,image,wait2,close");
            });
            Case("failed or unexpected pre-wait fails closed", () => {
                foreach (uint wait in new[] { uint.MaxValue, 0x80U, 1U }) {
                    var api = new FakeIdentityApi(); api.Waits.Enqueue(wait);
                    Read(api, IdentityRead.Error, "open,wait1,close");
                }
            });
            Case("failed or unexpected post-wait fails closed", () => {
                foreach (uint wait in new[] { uint.MaxValue, 0x80U, 1U }) {
                    var api = new FakeIdentityApi(); api.Waits.Enqueue(0x102); api.Waits.Enqueue(wait);
                    Read(api, IdentityRead.Error, "open,wait1,times,image,wait2,close");
                }
            });
            Case("missing PID is gone without closing absent handle", () => {
                Read(new FakeIdentityApi { OpenFails = true, Error = 87 }, IdentityRead.Gone, "open");
            });
            Case("denied open remains error without retry", () => {
                Read(new FakeIdentityApi { OpenFails = true, Error = 5 }, IdentityRead.Error, "open");
            });
            Case("metadata failures retain authoritative post-wait", () => {
                foreach (bool timesFail in new[] { true, false }) {
                    foreach (uint after in new[] { 0x102U, 0U, uint.MaxValue }) {
                        var api = new FakeIdentityApi { TimesOk = !timesFail, ImageOk = false };
                        api.Waits.Enqueue(0x102); api.Waits.Enqueue(after);
                        Read(api, after == 0 ? IdentityRead.Gone : IdentityRead.Error,
                            timesFail ? "open,wait1,times,wait2,close" : "open,wait1,times,image,wait2,close");
                    }
                }
            });
            Case("every acquired handle closes exactly once on exceptions", () => {
                foreach (string where in new[] { "wait1", "times", "image", "wait2" }) {
                    var api = new FakeIdentityApi { ThrowAt = where };
                    bool threw = false;
                    try { ProcessIdentity.Read(10, api, out _); }
                    catch (System.InvalidOperationException) { threw = true; }
                    Assert(threw && api.Closes == 1 && api.Calls[api.Calls.Count - 1] == "close");
                }
                var invalidPath = new FakeIdentityApi { Path = "invalid\0image" };
                bool invalid = false;
                try { ProcessIdentity.Read(10, invalidPath, out _); }
                catch (System.ArgumentException) { invalid = true; }
                Assert(invalid && invalidPath.Closes == 1);
            });
            Case("immutable PID creation and path pins remain enforced", () => {
                var root = new Identity(10, @"C:\Verified\bageshuo.exe", 100);
                var same = Read(new FakeIdentityApi(), IdentityRead.Ok, "open,wait1,times,image,wait2,close");
                Assert(Rules.Pin(root, IdentityRead.Ok, same) == PinState.Ok);
                var start = Read(new FakeIdentityApi { Created = 101 }, IdentityRead.Ok, "open,wait1,times,image,wait2,close");
                var path = Read(new FakeIdentityApi { Path = @"C:\Other\bageshuo.exe" }, IdentityRead.Ok, "open,wait1,times,image,wait2,close");
                Assert(Rules.Pin(root, IdentityRead.Ok, start) == PinState.Changed);
                Assert(Rules.Pin(root, IdentityRead.Ok, path) == PinState.Changed);
                Assert(Rules.Pin(root, IdentityRead.Ok, new Identity(11, root.Image, root.Start)) == PinState.Changed);
                Assert(Rules.Pin(root, IdentityRead.Gone, null) == PinState.Gone);
                Assert(Rules.Pin(root, IdentityRead.Error, null) == PinState.Error);
            });
            Case("production cadence is 250ms with bounded sleeps", () => {
                Assert(PollDelay.CadenceMilliseconds == 250);
                Assert(PollDelay.Milliseconds(PollDelay.CadenceMilliseconds, 0) == 25);
                Assert(PollDelay.Milliseconds(PollDelay.CadenceMilliseconds, 249) == 1);
                Assert(PollDelay.Milliseconds(PollDelay.CadenceMilliseconds, 250) == 0);
                Assert(PollDelay.Milliseconds(PollDelay.CadenceMilliseconds, 251) == 0);
            });
            Case("sleep duration is bounded positive or zero at crossed tick", () => {
                Assert(PollDelay.Milliseconds(250, 0) == 25);
                Assert(PollDelay.Milliseconds(250, 225) == 25);
                Assert(PollDelay.Milliseconds(250, 249) == 1);
                Assert(PollDelay.Milliseconds(250, 250) == 0);
                Assert(PollDelay.Milliseconds(250, 251) == 0);
                Assert(PollDelay.Milliseconds(250, 1000) == 0);
                Assert(PollDelay.Milliseconds(250, long.MaxValue) == 0);
                // Synthetic scheduler preemption: an older sample precedes the tick,
                // but the next sample crosses it; neither -1 nor another negative escapes.
                long[] samples = { 249, 251, 1000 };
                int reads = 0;
                System.Func<long> clock = () => samples[reads++];
                Assert(PollDelay.Milliseconds(250, clock()) == 1 && reads == 1);
                Assert(PollDelay.Milliseconds(250, clock()) == 0 && reads == 2);
                Assert(PollDelay.Milliseconds(250, clock()) == 0 && reads == 3);
            });
            return System.Text.Json.JsonSerializer.Serialize(Passed);
        }
    }
}
`;

test('production loop consumes the pure 250ms capture cadence constant', () => {
  const pollDelay = source.slice(source.indexOf('internal static class PollDelay'), source.indexOf('internal static class Native'));
  const observeCore = source.slice(source.indexOf('private static int ObserveCore()'), source.indexOf('private static void Assert(bool condition)'));
  assert.match(pollDelay, /internal const int CadenceMilliseconds = 250;/);
  assert.match(observeCore, /nextTick \+= PollDelay\.CadenceMilliseconds;/);
  assert.doesNotMatch(observeCore, /nextTick \+= \d+;/);
});

test('production uses zero-time process waits, immutable identity orchestration and single-sample sleep', () => {
  assert.match(source, /QueryLimitedInformation = 0x1000/);
  assert.match(source, /Synchronize = 0x00100000/);
  assert.match(source, /Native\.WaitForSingleObject\(handle, 0\)/);
  assert.match(source, /ProcessIdentity\.Read\(pid, IdentityApi, out identity\)/);
  assert.match(source, /api\.Open\(Native\.QueryLimitedInformation \| Native\.Synchronize/);
  assert.match(source, /finally \{ api\.Close\(handle\); \}/);
  assert.doesNotMatch(source, /Value\(exited\)|GetExitCodeProcess/);
  assert.match(source, /int delay = PollDelay\.Milliseconds\(nextTick, clock\.ElapsedMilliseconds\);\s*if \(delay == 0\) break;\s*Thread\.Sleep\(delay\);/);
  assert.doesNotMatch(source, /Thread\.Sleep\(\(int\)Math\.Min/);
});

test('pure fake Win32 adapter exercises actual reader and clock regressions',
  { skip: process.platform !== 'win32' }, () => {
    const csharp = source.match(/\$source = @'\r?\n([\s\S]*?)\r?\n'@/)[1];
    const script = `$ErrorActionPreference = 'Stop'\n$code = @'\n${csharp}\n${fixtures}\n'@\ntry { Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop; [DshBageshuoState.LivenessRegression]::Run() } catch { [Console]::Error.WriteLine($_); exit 1 }\n`;
    const run = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Invoke-Expression ([Console]::In.ReadToEnd())'],
      { input: script, encoding: 'utf8', timeout: 20000, windowsHide: true,
        env: { ...process.env, TERM: 'dumb' } });
    assert.equal(run.status, 0, run.stderr || run.error?.code || 'pure liveness harness failed');
    assert.equal(run.stderr, '');
    const passed = JSON.parse(run.stdout.trim());
    assert.equal(passed.length, 12);
    assert.equal(new Set(passed).size, 12);
  });
