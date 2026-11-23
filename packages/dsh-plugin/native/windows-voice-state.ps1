#requires -Version 7.0
<#
Read-only Windows speech-host capture observer. Does not launch dictation, send
keys, activate an audio client, read samples, or open a microphone stream.
Only signed Microsoft system speech-host sessions are metered. recording means
that shared HOST is capturing; it does NOT identify the dictation consumer.
All uncertain identity/COM/session/meter results fail closed to unknown/zero.
Default SelfTest is synthetic and opens no COM, process or microphone resources.
Observe owns only COM metadata objects and an EOF-cancelled stdin reader.
#>
[CmdletBinding()]
param([ValidateSet('SelfTest', 'Observe')][string]$Mode = 'SelfTest')
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
namespace DshWindowsVoiceState {
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
    [ComImport, Guid("c02216f6-8c67-4b5b-9d00-d008e73e0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioMeterInformation {
        [PreserveSig] int GetPeakValue(out float peak);
        [PreserveSig] int GetMeteringChannelCount(out uint count);
        [PreserveSig] int GetChannelsPeakValues(uint count, IntPtr values);
        [PreserveSig] int QueryHardwareSupport(out uint mask);
    }
    public static class Runner {
        private static void Ok(int hr) { if (hr != 0) throw new COMException("capture_unknown", hr); }
        private static void Release(object value) {
            if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
        }
        public static string Result(bool unknown, bool active, float peak) {
            if (float.IsNaN(peak) || float.IsInfinity(peak) || peak < 0 || peak > 1) unknown = true;
            string state = unknown ? "unknown" : active ? "recording" : "idle";
            return JsonSerializer.Serialize(new { state, error = unknown ? "capture_unknown" : null,
                level = !unknown && active ? peak : 0 });
        }
        // Inactive/expired sessions cannot be recording, even when Windows retained a
        // cross-process session with no unique PID. Validate state before attribution.
        public static bool ActiveSession(int state) {
            if (state < 0 || state > 2) throw new InvalidOperationException("capture_unknown");
            return state == 1;
        }
        // Only these system speech images are candidates; process names alone never confer trust.
        public static bool Candidate(string image, string windows) {
            string full = Path.GetFullPath(image), root = Path.GetFullPath(windows).TrimEnd(Path.DirectorySeparatorChar);
            return string.Equals(full, Path.Combine(root, "System32", "SpeechRuntime.exe"), StringComparison.OrdinalIgnoreCase) ||
                string.Equals(full, Path.Combine(root, "System32", "Speech_OneCore", "common", "SpeechRuntime.exe"), StringComparison.OrdinalIgnoreCase) ||
                (full.StartsWith(root + Path.DirectorySeparatorChar + "SystemApps" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) &&
                 string.Equals(Path.GetFileName(full), "TextInputHost.exe", StringComparison.OrdinalIgnoreCase));
        }
        private static string Identity(Process p) => p.StartTime.ToUniversalTime().Ticks + "|" + p.MainModule.FileName;
        public static string Poll(Func<string, bool> signedByMicrosoft) {
            bool unknown = false, active = false; float peak = 0;
            object enumerator = null; IMMDeviceCollection devices = null;
            try {
                enumerator = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("bcde0395-e52f-467c-8e3d-c4579291692e"), true));
                // eCapture, DEVICE_STATE_ACTIVE. Never activate IAudioClient or an endpoint meter.
                Ok(((IMMDeviceEnumerator)enumerator).EnumAudioEndpoints(1, 1, out devices));
                Ok(devices.GetCount(out uint count));
                if (count == 0) unknown = true;
                for (uint i = 0; i < count; i++) {
                    IMMDevice device = null; object manager = null; IAudioSessionEnumerator sessions = null;
                    try {
                        Ok(devices.Item(i, out device));
                        Guid iid = typeof(IAudioSessionManager2).GUID;
                        Ok(device.Activate(ref iid, 23, IntPtr.Zero, out manager));
                        Ok(((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions));
                        Ok(sessions.GetCount(out int n));
                        for (int j = 0; j < n; j++) {
                            IAudioSessionControl session = null;
                            try {
                                Ok(sessions.GetSession(j, out session));
                                var control = (IAudioSessionControl2)session;
                                Ok(control.GetState(out int state));
                                if (!ActiveSession(state)) continue;
                                int hr = control.GetProcessId(out uint pid);
                                // Includes AUDCLNT_S_NO_SINGLE_PROCESS: no guessed cross-process ownership.
                                if (hr != 0 || pid == 0 || pid > int.MaxValue) { unknown = true; continue; }
                                using (var p = Process.GetProcessById((int)pid)) {
                                    string before = Identity(p), image = p.MainModule.FileName;
                                    if (!Candidate(image, Environment.GetFolderPath(Environment.SpecialFolder.Windows))) continue;
                                    if (!signedByMicrosoft(image)) { unknown = true; continue; }
                                    // Recheck after identity/signature work: never report a stale active session.
                                    Ok(control.GetState(out state));
                                    if (!ActiveSession(state)) continue;
                                    // Capability: trusted Windows speech HOST capture, NOT proof of
                                    // the dictation consumer. These shared hosts also serve IME,
                                    // search and accessibility; the UI must disclose that limitation.
                                    Ok(((IAudioMeterInformation)session).GetPeakValue(out float measured));
                                    if (p.HasExited || Identity(p) != before) { unknown = true; continue; }
                                    if (float.IsNaN(measured) || float.IsInfinity(measured) || measured < 0 || measured > 1)
                                        throw new InvalidOperationException("capture_unknown");
                                    active = true;
                                    peak = Math.Max(peak, measured);
                                }
                            } catch { unknown = true; }
                            finally { Release(session); }
                        }
                    } catch { unknown = true; }
                    finally { Release(sessions); Release(manager); Release(device); }
                }
            } catch { unknown = true; }
            finally { Release(devices); Release(enumerator); }
            return Result(unknown, active, peak);
        }
        public static void Observe(Func<string, bool> trust) {
            var eof = Task.Run(() => { while (Console.ReadLine() != null) {} });
            while (!eof.IsCompleted) {
                Console.WriteLine(Poll(trust)); Console.Out.Flush();
                if (eof.Wait(250)) break;
            }
        }
        public static void SelfTest() {
            if (!Result(false, true, 0.25f).Contains("0.25") ||
                !Result(false, true, 0).Contains("recording") ||
                !Result(false, false, 0).Contains("idle") ||
                !Result(true, true, 1).Contains("unknown") ||
                !Result(false, true, float.NaN).Contains("unknown") ||
                !Result(false, true, float.PositiveInfinity).Contains("unknown") ||
                !Result(false, true, -0.1f).Contains("unknown") ||
                !Result(false, true, 1.1f).Contains("unknown")) throw new Exception("rules_failed");
            if (ActiveSession(0) || ActiveSession(2) || !ActiveSession(1)) throw new Exception("session_state_rules_failed");
            foreach (int invalid in new[] { -1, 3 }) {
                bool rejected = false;
                try { ActiveSession(invalid); } catch (InvalidOperationException) { rejected = true; }
                if (!rejected) throw new Exception("invalid_session_state_accepted");
            }
            string root = Path.Combine(Path.GetTempPath(), "synthetic-windows");
            if (!Candidate(Path.Combine(root, "System32", "Speech_OneCore", "common", "SpeechRuntime.exe"), root) ||
                Candidate(Path.Combine(root, "System32", "Speech_OneCore", "other", "SpeechRuntime.exe"), root) ||
                !Candidate(Path.Combine(root, "System32", "SpeechRuntime.exe"), root) ||
                Candidate(Path.Combine(root, "System32-evil", "SpeechRuntime.exe"), root) ||
                Candidate(Path.Combine(root, "System32", "other.exe"), root) ||
                Candidate(Path.Combine(root + "-evil", "System32", "SpeechRuntime.exe"), root))
                throw new Exception("identity_rules_failed");
            Console.WriteLine("windows-voice-state selftest ok");
        }
    }
}
'@
try {
    Add-Type -TypeDefinition $source
    if ($Mode -eq 'SelfTest') { [DshWindowsVoiceState.Runner]::SelfTest(); exit 0 }
    if (-not $IsWindows) {
        [Console]::WriteLine('{"state":"error","error":"unsupported_platform","level":0}')
        exit 1
    }
    # Validation is local and read-only. No signature cache: a replaced image must
    # be revalidated, with live PID creation-time/image identity checked around sampling.
    $trust = [Func[string,bool]] {
        param($image)
        $signature = Get-AuthenticodeSignature -LiteralPath $image
        return $signature.Status -eq 'Valid' -and $null -ne $signature.SignerCertificate -and
            $signature.SignerCertificate.Subject -match '(^|,\s*)O=Microsoft Corporation(,|$)'
    }
    [DshWindowsVoiceState.Runner]::Observe($trust)
} catch {
    [Console]::WriteLine('{"state":"error","error":"observer_start_failed","level":0}')
    exit 1
}

