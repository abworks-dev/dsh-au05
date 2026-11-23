#requires -Version 7.0
<#
Read-only CoreAudio session METADATA observer, derived from reviewed
.local/bageshuo-audio-state-20261031.ps1 (Bageshuo 1.0.41 trial).
Default SelfTest is PURE: synthetic identities/rules/JSON only; no COM, process
inspection, endpoints, stdin readers, filesystem inspection, or app resources.
Only -Mode Observe opens read-only metadata resources. No audio stream, window,
content, history, settings write, process launch, or app termination API exists.
Observe stdout contains sanitized {state,error,request} or {phase,request} NDJSON;
SelfTest returns {state,error}. An active attributed capture session means recording,
not proof of speech or recording-file creation.
The root's PID + creation time + full image path are immutable within Observe.
EOF on owned stdin requests graceful stop via one background ReadLine thread;
the poll loop never blocks on Peek. Every poll releases all its own COM objects.
#>
[CmdletBinding()]
param([ValidateSet('SelfTest', 'Observe')][string]$Mode = 'SelfTest')
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace DshBageshuoState
{
    // Reviewed complete, explicitly flattened COM vtables. Unused ABI slots are
    // declarations only: no setters, property stores, names or stream APIs used.
    [ComImport, Guid("a95664d2-9614-4f35-a746-de8db63617e6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice endpoint);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }
    [ComImport, Guid("0bd7a1be-7a1a-44db-8397-cc5392387b5e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }
    [ComImport, Guid("d666063f-1587-4e43-81f1-b948e807363f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [ComImport, Guid("77aa99a0-1bd6-484f-8bc7-2c654c9a9b6f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(ref Guid session, uint flags, out IAudioSessionControl control);
        [PreserveSig] int GetSimpleAudioVolume(ref Guid session, uint flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
        [PreserveSig] int RegisterSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
        [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
    }
    [ComImport, Guid("e2f5bb11-0570-40ca-acdd-3aa01277dee8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl control);
    }
    [ComImport, Guid("f4b1a599-7266-4319-a8ca-e70acb11e8cd"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
    }
    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, ref Guid context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    internal sealed class Identity
    {
        internal readonly int Pid;
        internal readonly string Image;
        internal readonly long Start;
        internal Identity(int pid, string image, long start) { Pid = pid; Image = image; Start = start; }
    }
    internal sealed class Node
    {
        internal readonly Identity Id;
        internal readonly int Parent;
        internal Node(Identity id, int parent) { Id = id; Parent = parent; }
    }
    internal enum IdentityRead { Ok, Gone, Error }
    internal enum PinState { Ok, Gone, Changed, Error }
    internal sealed class Frame
    {
        internal int Active;
        internal bool Unknown;
        internal void Fail() { Unknown = true; }
        internal void ClearAttributed() { Active = 0; Unknown = true; }
    }
    internal static class Rules
    {
        internal const int NoSingleProcess = 0x0889000D;
        internal static bool Same(Identity a, Identity b) => a != null && b != null && a.Pid == b.Pid &&
            a.Start == b.Start && string.Equals(a.Image, b.Image, StringComparison.OrdinalIgnoreCase);
        internal static PinState Pin(Identity expected, IdentityRead result, Identity actual)
        {
            if (result == IdentityRead.Gone) return PinState.Gone;
            if (result != IdentityRead.Ok) return PinState.Error;
            return Same(expected, actual) ? PinState.Ok : PinState.Changed;
        }
        internal static bool ParentOf(Node parent, Node child) => parent.Id.Pid != child.Id.Pid &&
            child.Parent == parent.Id.Pid && parent.Id.Start <= child.Id.Start &&
            string.Equals(parent.Id.Image, child.Id.Image, StringComparison.OrdinalIgnoreCase);
        internal static List<Identity> Roots(Dictionary<int, Node> nodes) => nodes.Values
            .Where(n => !nodes.TryGetValue(n.Parent, out Node p) || !ParentOf(p, n)).Select(n => n.Id).ToList();
        internal static bool Belongs(int pid, Identity root, Dictionary<int, Node> nodes)
        {
            var visited = new HashSet<int>();
            Identity child = null;
            while (visited.Add(pid) && nodes.TryGetValue(pid, out Node n))
            {
                if (!string.Equals(n.Id.Image, root.Image, StringComparison.OrdinalIgnoreCase) || n.Id.Start < root.Start) return false;
                if (child != null && n.Id.Start > child.Start) return false;
                if (pid == root.Pid) return Same(root, n.Id);
                child = n.Id; pid = n.Parent;
            }
            return false;
        }
        internal static void Aggregate(Frame f, int pidHr, bool attributed, bool ambiguous, int stateHr, int state)
        {
            // Even positive HRESULTs (notably AUDCLNT_S_NO_SINGLE_PROCESS) cannot prove attribution.
            if (pidHr > 0) { if (attributed || ambiguous) f.Fail(); return; }
            if (pidHr < 0) { f.Fail(); return; }
            if (!attributed) { if (ambiguous) f.Fail(); return; }
            if (stateHr != 0) { f.Fail(); return; }
            if (state == 1) f.Active++;
            else if (state != 0 && state != 2) f.Fail();
        }
        internal static string State(Frame f) => f.Unknown ? "unknown" : f.Active > 0 ? "recording" : "idle";
    }

    // This seam keeps the production identity-read orchestration testable without
    // opening a process. A process handle's wait state, never exit FILETIME, proves exit.
    internal interface IProcessIdentityApi
    {
        IntPtr Open(uint access, int pid, out int error);
        uint Wait(IntPtr handle);
        bool Times(IntPtr handle, out Native.FILETIME created, out Native.FILETIME exited,
            out Native.FILETIME kernel, out Native.FILETIME user);
        bool Image(IntPtr handle, out string image);
        void Close(IntPtr handle);
    }
    internal sealed class Win32ProcessIdentityApi : IProcessIdentityApi
    {
        public IntPtr Open(uint access, int pid, out int error)
        {
            IntPtr handle = Native.OpenProcess(access, false, pid);
            error = handle == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
            return handle;
        }
        public uint Wait(IntPtr handle) => Native.WaitForSingleObject(handle, 0);
        public bool Times(IntPtr handle, out Native.FILETIME created, out Native.FILETIME exited,
            out Native.FILETIME kernel, out Native.FILETIME user) =>
            Native.GetProcessTimes(handle, out created, out exited, out kernel, out user);
        public bool Image(IntPtr handle, out string image)
        {
            var path = new StringBuilder(32768); uint size = (uint)path.Capacity;
            bool ok = Native.QueryFullProcessImageName(handle, 0, path, ref size);
            image = ok ? path.ToString() : null;
            return ok;
        }
        public void Close(IntPtr handle) { Native.CloseHandle(handle); }
    }
    internal static class ProcessIdentity
    {
        internal const uint WaitObject0 = 0, WaitTimeout = 0x102;
        private static long Value(Native.FILETIME time) => ((long)time.High << 32) | time.Low;
        internal static IdentityRead Read(int pid, IProcessIdentityApi api, out Identity identity)
        {
            identity = null;
            IntPtr handle = api.Open(Native.QueryLimitedInformation | Native.Synchronize, pid, out int error);
            if (handle == IntPtr.Zero) return error == 87 ? IdentityRead.Gone : IdentityRead.Error;
            try
            {
                uint before = api.Wait(handle);
                if (before == WaitObject0) return IdentityRead.Gone;
                if (before != WaitTimeout) return IdentityRead.Error;
                // GetProcessTimes documents lpExitTime as undefined while running.
                bool timesOk = api.Times(handle, out Native.FILETIME created, out _, out _, out _);
                string image = null;
                bool imageOk = timesOk && api.Image(handle, out image);
                uint after = api.Wait(handle);
                if (after == WaitObject0) return IdentityRead.Gone;
                if (after != WaitTimeout || !timesOk || !imageOk) return IdentityRead.Error;
                identity = new Identity(pid, Path.GetFullPath(image), Value(created));
                return IdentityRead.Ok;
            }
            finally { api.Close(handle); }
        }
    }
    internal static class PollDelay
    {
        internal const int CadenceMilliseconds = 250;
        internal static int Milliseconds(long nextTick, long elapsed)
        {
            if (elapsed >= nextTick) return 0;
            return (int)Math.Min(25, nextTick - elapsed);
        }
    }

    internal static class Native
    {
        internal const uint QueryLimitedInformation = 0x1000;
        internal const uint Synchronize = 0x00100000;
        [StructLayout(LayoutKind.Sequential)] internal struct FILETIME { public uint Low, High; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct PROCESSENTRY32
        {
            public uint dwSize, cntUsage, th32ProcessID;
            public UIntPtr th32DefaultHeapID;
            public uint th32ModuleID, cntThreads, th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        private static readonly IProcessIdentityApi IdentityApi = new Win32ProcessIdentityApi();
        internal static IdentityRead ReadIdentity(int pid, out Identity identity) =>
            ProcessIdentity.Read(pid, IdentityApi, out identity);
        internal static bool CandidateParents(out Dictionary<int, int> parents)
        {
            parents = new Dictionary<int, int>();
            IntPtr snapshot = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS, metadata only.
            if (snapshot == new IntPtr(-1)) return false;
            try
            {
                var entry = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
                if (!Process32First(snapshot, ref entry)) return false;
                do
                {
                    if (string.Equals(entry.szExeFile, "bageshuo.exe", StringComparison.OrdinalIgnoreCase) &&
                        entry.th32ProcessID <= int.MaxValue && entry.th32ParentProcessID <= int.MaxValue)
                        parents[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                } while (Process32Next(snapshot, ref entry));
                return Marshal.GetLastWin32Error() == 18;
            }
            finally { CloseHandle(snapshot); }
        }
    }

    internal sealed class ObserverControl
    {
        private int request;
        internal int Request => Volatile.Read(ref request);
        internal static bool SampleFresh(long started, long finished) => finished >= started && finished - started < 2000;
        internal bool Accept(string line)
        {
            // Host-generated freshness challenge only; never commands, identity or key payloads.
            if (line == null || line.Length > 16 || !line.StartsWith("probe:", StringComparison.Ordinal) ||
                !int.TryParse(line.Substring(6), System.Globalization.NumberStyles.None,
                    System.Globalization.CultureInfo.InvariantCulture, out int next) || next <= Request) return false;
            Volatile.Write(ref request, next);
            return true;
        }
    }

    public static class Runner
    {
        private static string Json(string state, string error) => JsonSerializer.Serialize(new { state, error });
        private static void Emit(string state, string error = null, int request = 0)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { state, error, request })); Console.Out.Flush();
        }
        private static void Phase(string phase, int request)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { phase, request })); Console.Out.Flush();
        }
        private static void Release(ref object owner)
        {
            object value = owner; owner = null;
            try { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
            catch (InvalidComObjectException) { }
            catch (COMException) { }
        }
        private static void RequireOk(int hr) { if (hr != 0) throw new COMException("metadata_failure", hr); }
        private static PinState Check(Identity expected)
        {
            IdentityRead result = Native.ReadIdentity(expected.Pid, out Identity actual);
            return Rules.Pin(expected, result, actual);
        }
        private static string PinError(PinState state) => state == PinState.Gone ? "target_exited" :
            state == PinState.Changed ? "identity_changed" : "observer_start_failed";
        private static bool ReadTree(out Dictionary<int, Node> nodes)
        {
            nodes = new Dictionary<int, Node>();
            if (!Native.CandidateParents(out Dictionary<int, int> parents)) return false;
            foreach (var p in parents)
            {
                IdentityRead result = Native.ReadIdentity(p.Key, out Identity id);
                // A disappearing candidate cannot justify binding another root in an unstable snapshot.
                if (result != IdentityRead.Ok || !string.Equals(Path.GetFileName(id.Image), "bageshuo.exe", StringComparison.OrdinalIgnoreCase)) return false;
                nodes[p.Key] = new Node(id, p.Value);
            }
            return true;
        }
        private static string UniqueRoot(Dictionary<int, Node> nodes, out Identity root)
        {
            root = null;
            if (nodes.Count == 0) return "app_not_running";
            var roots = Rules.Roots(nodes);
            if (roots.Count != 1) return "app_ambiguous";
            Identity selected = roots[0];
            root = selected;
            // Cycles/orphans/reused parents cannot be silently attributed to the one visible root.
            if (nodes.Keys.Any(pid => !Rules.Belongs(pid, selected, nodes))) { root = null; return "app_ambiguous"; }
            return null;
        }
        private static void PollAudio(Frame frame, Dictionary<int, Identity> targets, HashSet<int> uncertain)
        {
            object enumeratorOwner = null, collectionOwner = null;
            try
            {
                enumeratorOwner = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("bcde0395-e52f-467c-8e3d-c4579291692e"), true));
                var devices = (IMMDeviceEnumerator)enumeratorOwner;
                IMMDeviceCollection collection = null;
                int collectionHr = devices.EnumAudioEndpoints(1, 1, out collection); // eCapture + active endpoints only.
                collectionOwner = collection; RequireOk(collectionHr);
                RequireOk(collection.GetCount(out uint count));
                if (count == 0) frame.Fail();
                for (uint d = 0; d < count; d++)
                {
                    object endpointOwner = null, managerOwner = null, sessionsOwner = null;
                    try
                    {
                        IMMDevice endpoint = null;
                        int endpointHr = collection.Item(d, out endpoint); endpointOwner = endpoint; RequireOk(endpointHr);
                        Guid managerIid = new Guid("77aa99a0-1bd6-484f-8bc7-2c654c9a9b6f");
                        int managerHr = endpoint.Activate(ref managerIid, 23, IntPtr.Zero, out managerOwner);
                        RequireOk(managerHr);
                        var manager = (IAudioSessionManager2)managerOwner;
                        IAudioSessionEnumerator sessions = null;
                        int sessionsHr = manager.GetSessionEnumerator(out sessions); sessionsOwner = sessions; RequireOk(sessionsHr);
                        RequireOk(sessions.GetCount(out int sessionCount));
                        if (sessionCount < 0) throw new InvalidOperationException("metadata_failure");
                        for (int s = 0; s < sessionCount; s++)
                        {
                            object controlOwner = null;
                            try
                            {
                                IAudioSessionControl control = null;
                                int controlHr = sessions.GetSession(s, out control); controlOwner = control; RequireOk(controlHr);
                                // Cast shares the same RCW; release controlOwner exactly once.
                                var control2 = (IAudioSessionControl2)controlOwner;
                                int pidHr = control2.GetProcessId(out uint pid);
                                bool attributed = pid <= int.MaxValue && targets.ContainsKey((int)pid);
                                bool ambiguous = pid <= int.MaxValue && uncertain.Contains((int)pid);
                                if (attributed && Check(targets[(int)pid]) != PinState.Ok) { frame.Fail(); continue; }
                                if (pidHr != 0) { Rules.Aggregate(frame, pidHr, attributed, ambiguous, 0, 0); continue; }
                                if (!attributed) { Rules.Aggregate(frame, 0, false, ambiguous, 0, 0); continue; }
                                int stateHr = control2.GetState(out int state);
                                Rules.Aggregate(frame, 0, true, false, stateHr, state);
                            }
                            catch { frame.Fail(); }
                            finally { Release(ref controlOwner); }
                        }
                    }
                    catch { frame.Fail(); }
                    finally { Release(ref sessionsOwner); Release(ref managerOwner); Release(ref endpointOwner); }
                }
            }
            catch { frame.Fail(); }
            finally { Release(ref collectionOwner); Release(ref enumeratorOwner); }
        }
        public static int Observe()
        {
            if (!OperatingSystem.IsWindows()) { Emit("error", "unsupported_platform"); return 1; }
            int result = 1;
            // Dedicated MTA regardless of PowerShell's apartment.
            var worker = new Thread(() => { result = ObserveCore(); });
            worker.SetApartmentState(ApartmentState.MTA);
            worker.Start(); worker.Join();
            return result;
        }
        private static int ObserveCore()
        {
            int stopped = 0;
            var control = new ObserverControl();
            // A blocking read belongs to a dedicated background thread, NEVER the polling thread.
            // EOF/invalid input stops. A challenge requests a fresh poll with the SAME identity pin.
            var input = new Thread(() => {
                try { while (control.Accept(Console.In.ReadLine())) { } }
                catch { }
                finally { Volatile.Write(ref stopped, 1); }
            });
            input.IsBackground = true;
            input.Start();
            try
            {
                if (Volatile.Read(ref stopped) != 0) return 0;
                Phase("process_tree", 0);
                if (!ReadTree(out Dictionary<int, Node> initial)) { Emit("error", "observer_start_failed"); return 1; }
                string error = UniqueRoot(initial, out Identity expected);
                if (error != null) { Emit("error", error); return 1; }
                // expected is assigned ONCE. Never replace it with a newly discovered process.
                var clock = Stopwatch.StartNew();
                long nextTick = 0;
                while (Volatile.Read(ref stopped) == 0)
                {
                    // Capture BEFORE any identity/tree/audio call. A challenge received during a
                    // blocked old poll must never relabel that old result as a fresh response.
                    long sampleAt = clock.ElapsedMilliseconds;
                    int request = control.Request;
                    Phase("identity", request);
                    PinState before = Check(expected);
                    if (before != PinState.Ok) { Emit("error", PinError(before), request); return 1; }
                    Phase("process_tree", request);
                    if (!ReadTree(out Dictionary<int, Node> nodes)) { Emit("unknown", "capture_unknown", request); }
                    else
                    {
                        error = UniqueRoot(nodes, out Identity current);
                        if (error != null) { Emit("error", error == "app_not_running" ? "target_exited" : error, request); return 1; }
                        if (!Rules.Same(expected, current)) { Emit("error", "identity_changed", request); return 1; }
                        var targets = nodes.Values.Where(n => Rules.Belongs(n.Id.Pid, expected, nodes)).ToDictionary(n => n.Id.Pid, n => n.Id);
                        var frame = new Frame();
                        Phase("audio", request);
                        PollAudio(frame, targets, new HashSet<int>());
                        Phase("verify", request);
                        PinState after = Check(expected);
                        if (after != PinState.Ok) { frame.ClearAttributed(); Emit("error", PinError(after), request); return 1; }
                        foreach (var target in targets.Values)
                            if (Check(target) != PinState.Ok) { frame.ClearAttributed(); break; }
                        if (Volatile.Read(ref stopped) != 0) break;
                        // Even a matching challenge must not bless a sample collected too slowly.
                        if (!ObserverControl.SampleFresh(sampleAt, clock.ElapsedMilliseconds)) frame.ClearAttributed();
                        Emit(Rules.State(frame), frame.Unknown ? "capture_unknown" : null, request);
                    }
                    // Restore the previously verified 250ms nominal capture-detection cadence.
                    // Slow OS calls may exceed cadence. Host revokes confidence after 2s and
                    // requests a new full sample without rediscovery; bounded recovery fails closed.
                    nextTick += PollDelay.CadenceMilliseconds;
                    if (nextTick < clock.ElapsedMilliseconds) nextTick = clock.ElapsedMilliseconds;
                    while (Volatile.Read(ref stopped) == 0)
                    {
                        // Sample elapsed once: crossing the tick cannot cause Sleep(-1).
                        int delay = PollDelay.Milliseconds(nextTick, clock.ElapsedMilliseconds);
                        if (delay == 0) break;
                        Thread.Sleep(delay);
                    }
                }
                return 0;
            }
            catch { if (Volatile.Read(ref stopped) == 0) Emit("error", "observer_start_failed"); return 1; }
        }
        private static void Assert(bool condition) { if (!condition) throw new InvalidOperationException("selftest_failed"); }
        public static int SelfTest()
        {
            try
            {
                // Pure synthetic fixtures: no native/COM/stdin/process/endpoint calls.
                var root = new Identity(10, @"C:\Verified\bageshuo.exe", 100);
                Assert(Rules.Pin(root, IdentityRead.Ok, new Identity(10, @"c:\verified\BAGESHUO.exe", 100)) == PinState.Ok);
                Assert(Rules.Pin(root, IdentityRead.Ok, new Identity(10, root.Image, 101)) == PinState.Changed);
                Assert(Rules.Pin(root, IdentityRead.Ok, new Identity(10, @"C:\Other\bageshuo.exe", 100)) == PinState.Changed);
                Assert(Rules.Pin(root, IdentityRead.Ok, new Identity(11, root.Image, 100)) == PinState.Changed);
                Assert(Rules.Pin(root, IdentityRead.Gone, null) == PinState.Gone);
                Assert(Rules.Pin(root, IdentityRead.Error, null) == PinState.Error);
                var nodes = new Dictionary<int, Node> {
                    [10] = new Node(root, 1), [11] = new Node(new Identity(11, root.Image, 101), 10),
                    [12] = new Node(new Identity(12, root.Image, 102), 11)
                };
                Assert(UniqueRoot(nodes, out Identity chosen) == null && Rules.Same(root, chosen));
                Assert(Rules.Belongs(12, root, nodes) && !Rules.Belongs(99, root, nodes));
                nodes[20] = new Node(new Identity(20, root.Image, 103), 1);
                Assert(UniqueRoot(nodes, out _) == "app_ambiguous"); nodes.Remove(20);
                nodes[20] = new Node(new Identity(20, @"C:\Other\bageshuo.exe", 103), 10);
                Assert(!Rules.Belongs(20, root, nodes) && UniqueRoot(nodes, out _) == "app_ambiguous"); nodes.Remove(20);
                nodes[20] = new Node(new Identity(20, root.Image, 99), 10);
                Assert(!Rules.Belongs(20, root, nodes) && UniqueRoot(nodes, out _) == "app_ambiguous"); nodes.Remove(20);
                nodes[20] = new Node(new Identity(20, root.Image, 101), 21);
                nodes[21] = new Node(new Identity(21, root.Image, 101), 20);
                Assert(!Rules.Belongs(20, root, nodes) && UniqueRoot(nodes, out _) == "app_ambiguous");
                Assert(UniqueRoot(new Dictionary<int, Node>(), out _) == "app_not_running");
                var frame = new Frame();
                Rules.Aggregate(frame, 0, false, false, 0, 1); Assert(Rules.State(frame) == "idle");
                Rules.Aggregate(frame, 0, true, false, 0, 0); Assert(Rules.State(frame) == "idle");
                Rules.Aggregate(frame, 0, true, false, 0, 2); Assert(Rules.State(frame) == "idle");
                Rules.Aggregate(frame, 0, true, false, 0, 1); Assert(Rules.State(frame) == "recording");
                frame.ClearAttributed(); Assert(frame.Active == 0 && Rules.State(frame) == "unknown");
                foreach (int status in new[] { 1, Rules.NoSingleProcess, -1 }) {
                    var f = new Frame(); Rules.Aggregate(f, status, true, false, 0, 1);
                    Assert(f.Active == 0 && Rules.State(f) == "unknown");
                }
                var failed = new Frame(); Rules.Aggregate(failed, 0, true, false, 1, 1); Assert(Rules.State(failed) == "unknown");
                var invalid = new Frame(); Rules.Aggregate(invalid, 0, true, false, 0, 9); Assert(Rules.State(invalid) == "unknown");
                var mixed = new Frame(); Rules.Aggregate(mixed, 0, true, false, 0, 1); mixed.Fail(); Assert(Rules.State(mixed) == "unknown");
                var unrelated = new Frame(); Rules.Aggregate(unrelated, Rules.NoSingleProcess, false, false, 0, 1); Assert(Rules.State(unrelated) == "idle");
                foreach (var pair in new[] { new[] { "idle", null }, new[] { "recording", null }, new[] { "unknown", "capture_unknown" }, new[] { "error", "identity_changed" } }) {
                    using (JsonDocument doc = JsonDocument.Parse(Json(pair[0], pair[1]))) {
                        var keys = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
                        Assert(keys.Length == 2 && keys.Contains("state") && keys.Contains("error"));
                        Assert(doc.RootElement.GetProperty("state").GetString() == pair[0]);
                        Assert(doc.RootElement.GetProperty("error").GetString() == pair[1]);
                    }
                }
                var control = new ObserverControl();
                int inFlight = control.Request;
                Assert(control.Accept("probe:1") && control.Request == 1 && inFlight == 0);
                Assert(!control.Accept("probe:1") && !control.Accept("probe:0") && !control.Accept("probe:-1"));
                Assert(!control.Accept("probe:2147483648") && !control.Accept("stop") && !control.Accept(null));
                Assert(control.Accept("probe:2") && control.Request == 2);
                Assert(ObserverControl.SampleFresh(1000, 2999) && !ObserverControl.SampleFresh(1000, 3000));
                Assert(!ObserverControl.SampleFresh(1000, 999));
                Console.WriteLine(Json("idle", null)); return 0;
            }
            catch { Console.WriteLine(Json("error", "observer_start_failed")); return 1; }
        }
    }
}
'@
try {
    if (-not ('DshBageshuoState.Runner' -as [type])) {
        Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
    }
    if ($Mode -eq 'Observe') { $result = [DshBageshuoState.Runner]::Observe() }
    else { $result = [DshBageshuoState.Runner]::SelfTest() }
    if ($result -ne 0) { exit $result }
} catch {
    # Never disclose compiler messages, exception text, identities, paths or endpoints.
    if ($Mode -eq 'Observe') { [Console]::WriteLine('{"state":"error","error":"observer_start_failed","request":0}') }
    else { [Console]::WriteLine('{"state":"error","error":"observer_start_failed"}') }
    exit 1
}
