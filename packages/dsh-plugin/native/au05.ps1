# Original standalone Windows AU05 bridge. Default SelfTest never enumerates or opens HID.
# Connect is explicit; only the verified vendor collection can acquire report access.
# stdout is sanitized NDJSON. stdin is a closed command vocabulary, never a payload API.
[CmdletBinding()]
param(
    [ValidateSet('SelfTest', 'Connect')][string]$Mode = 'SelfTest',
    [switch]$EnableLights,
    [switch]$TraceInitialization
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($PSVersionTable.PSVersion.Major -lt 7 -or [Environment]::Version.Major -lt 6) {
    [Console]::WriteLine('{"type":"status","state":"unsupported_runtime"}')
    exit 2
}
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace DshAu05 {
    internal sealed class Failure : Exception {
        internal readonly string Code;
        internal Failure(string code) : base("au05_failure") { Code = code; }
    }
    internal sealed class Device {
        internal string Path;
        internal int OutputBytes;
    }
    public static class Native {
        public static bool TraceInitialization = false;
        sealed class InitializationStage {
            internal bool WriteCompleted, ReplyMatched;
            internal int ReadsWhilePending;
            internal string Status = "not_sent";
            internal object Json() { return new { writeCompleted = WriteCompleted, replyMatched = ReplyMatched, readsWhilePending = ReadsWhilePending, status = Status }; }
        }
        static string InitializationJson(InitializationStage auth, InitializationStage link) {
            return JsonSerializer.Serialize(new { schema = "au05-light-init-v1", auth = auth.Json(), link = link.Json() });
        }
        const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
        const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3;
        const uint FILE_FLAG_OVERLAPPED = 0x40000000;
        const uint DIGCF_PRESENT = 2, DIGCF_DEVICEINTERFACE = 16;
        const int ERROR_NO_MORE_ITEMS = 259, ERROR_INSUFFICIENT_BUFFER = 122;
        const int HIDP_STATUS_SUCCESS = 0x00110000;
        static readonly uint[] Key = { 0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA };
        [StructLayout(LayoutKind.Sequential)]
        struct InterfaceData {
            public uint cbSize;
            public Guid InterfaceClassGuid;
            public uint Flags;
            public IntPtr Reserved;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct Attributes {
            public uint Size;
            public ushort VendorID, ProductID, VersionNumber;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct Caps {
            public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices;
            public ushort NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices;
            public ushort NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
        }
        [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid guid);
        [DllImport("hid.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool HidD_GetAttributes(SafeFileHandle handle, ref Attributes attributes);
        [DllImport("hid.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool HidD_GetPreparsedData(SafeFileHandle handle, out IntPtr data);
        [DllImport("hid.dll")]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool HidD_FreePreparsedData(IntPtr data);
        [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data, out Caps caps);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr SetupDiGetClassDevsW(ref Guid guid, IntPtr enumerator, IntPtr parent, uint flags);
        [DllImport("setupapi.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid guid, uint index, ref InterfaceData data);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr set, ref InterfaceData data, IntPtr detail, uint size, out uint required, IntPtr info);
        [DllImport("setupapi.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool PeekNamedPipe(IntPtr handle, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr remaining);
        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool ReadFile(IntPtr handle, byte[] buffer, uint size, out uint read, IntPtr overlapped);

        public static bool IsTargetPath(string path) {
            return path != null && Regex.IsMatch(path, @"(?:^|[#\\])vid_fff1&pid_00dd(?=[&#\\])",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }
        public static bool IsTargetCaps(int vid, int pid, int page, int usage, int inputBytes) {
            return vid == 0xFFF1 && pid == 0x00DD && page == 0xFFFC && usage == 1 && inputBytes == 64;
        }
        static Device Inspect(SafeFileHandle handle, string path) {
            Attributes attributes = new Attributes { Size = (uint)Marshal.SizeOf(typeof(Attributes)) };
            if (!HidD_GetAttributes(handle, ref attributes)) throw new Failure("metadata_failed");
            if (attributes.VendorID != 0xFFF1 || attributes.ProductID != 0x00DD) throw new Failure("caps_changed");
            IntPtr data;
            if (!HidD_GetPreparsedData(handle, out data)) throw new Failure("metadata_failed");
            try {
                Caps caps;
                if (HidP_GetCaps(data, out caps) != HIDP_STATUS_SUCCESS) throw new Failure("metadata_failed");
                if (!IsTargetCaps(attributes.VendorID, attributes.ProductID, caps.UsagePage, caps.Usage, caps.InputReportByteLength)) return null;
                return new Device { Path = path, OutputBytes = caps.OutputReportByteLength };
            } finally { HidD_FreePreparsedData(data); }
        }
        static Device[] Enumerate() {
            Guid guid;
            HidD_GetHidGuid(out guid);
            IntPtr set = SetupDiGetClassDevsW(ref guid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if (set == new IntPtr(-1)) throw new Failure("metadata_failed");
            List<Device> devices = new List<Device>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try {
                for (uint index = 0; ; index++) {
                    InterfaceData item = new InterfaceData { cbSize = (uint)Marshal.SizeOf(typeof(InterfaceData)) };
                    if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref guid, index, ref item)) {
                        if (Marshal.GetLastWin32Error() == ERROR_NO_MORE_ITEMS) break;
                        throw new Failure("metadata_failed");
                    }
                    uint required;
                    bool sized = SetupDiGetDeviceInterfaceDetailW(set, ref item, IntPtr.Zero, 0, out required, IntPtr.Zero);
                    if (sized || Marshal.GetLastWin32Error() != ERROR_INSUFFICIENT_BUFFER || required < 8 || required > 65536)
                        throw new Failure("metadata_failed");
                    IntPtr detail = Marshal.AllocHGlobal((int)required);
                    string path;
                    try {
                        Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                        if (!SetupDiGetDeviceInterfaceDetailW(set, ref item, detail, required, out required, IntPtr.Zero))
                            throw new Failure("metadata_failed");
                        path = Marshal.PtrToStringUni(IntPtr.Add(detail, 4));
                    } finally { Marshal.FreeHGlobal(detail); }
                    if (!IsTargetPath(path) || !seen.Add(path)) continue;
                    using (SafeFileHandle handle = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE,
                        IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero)) {
                        if (handle.IsInvalid) {
                            if (Marshal.GetLastWin32Error() == 5) continue;
                            throw new Failure("metadata_failed");
                        }
                        Device device = Inspect(handle, path);
                        if (device != null) devices.Add(device);
                    }
                }
            } finally { SetupDiDestroyDeviceInfoList(set); }
            return devices.ToArray();
        }
        static uint Load(byte[] bytes, int offset) {
            return (uint)(bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24);
        }
        static void Store(byte[] bytes, int offset, uint word) {
            for (int i = 0; i < 4; i++) bytes[offset + i] = (byte)(word >> (8 * i));
        }
        static void EncryptBlock(byte[] input, int offset, byte[] output, int outputOffset, uint[] key) {
            uint left = Load(input, offset), right = Load(input, offset + 4), sum = 0;
            unchecked {
                for (int round = 0; round < 32; round++) {
                    sum += 0x9E3779B9;
                    left += ((right << 4) + key[0]) ^ (right + sum) ^ ((right >> 5) + key[1]);
                    right += ((left << 4) + key[2]) ^ (left + sum) ^ ((left >> 5) + key[3]);
                }
            }
            Store(output, outputOffset, left); Store(output, outputOffset + 4, right);
        }
        static void DecryptBlock(byte[] input, int offset, byte[] output, int outputOffset, uint[] key) {
            uint left = Load(input, offset), right = Load(input, offset + 4);
            unchecked {
                uint sum = 0xC6EF3720;
                for (int round = 0; round < 32; round++) {
                    right -= ((left << 4) + key[2]) ^ (left + sum) ^ ((left >> 5) + key[3]);
                    left -= ((right << 4) + key[0]) ^ (right + sum) ^ ((right >> 5) + key[1]);
                    sum -= 0x9E3779B9;
                }
            }
            Store(output, outputOffset, left); Store(output, outputOffset + 4, right);
        }
        public static string Classify(byte[] plain) {
            if (plain == null || plain.Length < 5 || (plain[0] != 0x0B && plain[0] != 0x8B)
                || plain[1] != 0x10 || plain[3] > 1 || plain[4] > 5) return null;
            switch (plain[4]) {
                case 0: return plain[3] == 1 ? "k1.down" : "k1.up";
                case 1: return plain[3] == 1 ? "k2.down" : "k2.up";
                case 2: return plain[3] == 1 ? "k3.down" : "k3.up";
                case 3: return plain[3] == 1 ? "knob.down" : "knob.up";
                case 4: return "right.pulse";
                case 5: return "left.pulse";
                default: return null;
            }
        }
        // MIT protocol facts: ihavespoons/vibed f7c89385416e626a9c6c0c9d674153a9f4af6112,
        // Messages.swift parseNotice. A notice is only a retry hint, never proof of link/snapshot readiness.
        static bool IsLightingWakeNotice(byte[] plain) {
            return plain != null && plain.Length >= 2 && (plain[0] & 31) == 0x0B
                && (plain[1] == 0xF0 || (plain[1] == 0x0B && plain.Length >= 3 && (plain[2] & 1) != 0));
        }
        static byte[] DecodePlain(byte[] report) {
            if (report == null || report.Length != 64 || report[0] != 0x55) return null;
            byte[] plain = new byte[56];
            for (int offset = 0; offset < 56; offset += 8) DecryptBlock(report, offset + 1, plain, offset, Key);
            return plain;
        }
        public static string DecodeInput(byte[] report) {
            byte[] plain = DecodePlain(report);
            if (plain == null) return null;
            try { return Classify(plain); }
            finally { Array.Clear(plain, 0, plain.Length); }
        }
        static byte[] SnapshotReply(byte[] plain) {
            if (plain == null || plain.Length < 28 || (plain[0] & 0x1F) != 1 || (plain[0] & 0x80) == 0
                || plain[1] != 0x0B || plain[2] != 0x88 || plain[3] != 0x11 || plain[6] > 2) return null;
            for (int i = 0; i < 4; i++) if (plain[8 + 5 * i] > 2) return null;
            byte[] saved = new byte[24]; Array.Copy(plain, 4, saved, 0, 24); return saved;
        }
        // Public protocol facts (MIT), independently implemented here:
        // patrick-fu/vibekey-elements c42b5ba73c87bb9dbe75efab6aa9d96ea91ddf73
        // global LED payload 01 0B 88 04 01 00 <mode>: off=00, solid=01, hardware-auto=02.
        // The five app states are semantic presets, not arbitrary channel/color commands.
        static byte[] LightsFrame(string state) {
            byte mode;
            switch (state) {
                case "idle": mode = 0; break;
                case "running": mode = 1; break;
                case "auto": mode = 2; break;
                default: throw new Failure("command_invalid");
            }
            return EncodeFixedCommand(new byte[] { 0x01, 0x0B, 0x88, 0x04, 0x01, 0x00, mode });
        }
        static byte[] DefaultChannels(string state) {
            switch (state) {
                case "idle": return new byte[] { 0, 0, 0, 0 };
                case "running": return new byte[] { 0, 0, 0, 1 };
                case "approval": return new byte[] { 0, 2, 0, 0 };
                case "attention": return new byte[] { 0, 0, 2, 0 };
                case "recording": return new byte[] { 2, 0, 0, 0 };
                default: throw new Failure("command_invalid");
            }
        }
        // Independent implementation of public MIT protocol facts:
        // OpenVibeKey c6466fd4687da612c9c52b006399f87148903727 VibeKitDevice.swift.
        // Full four-record vector preserves all channels. Indices: K1,K2,K3,dial.
        // Work types: 0=off, 1=solid, 2=breathing. Fixed timing/levels, never host-supplied.
        static byte[] ChannelsFrame(byte[] channels, int channel) {
            if (channels == null || channels.Length != 4 || channel < 0 || channel > 3) throw new Failure("command_invalid");
            byte[] command = new byte[28];
            command[0] = 0x01; command[1] = 0x0B; command[2] = 0x88; command[3] = 0x04;
            // 0x7C selects work-record fields; byte 5 selects the single channel applied by firmware.
            command[4] = 0x7C; command[5] = (byte)channel; command[6] = 0; command[7] = 0;
            for (int i = 0; i < 4; i++) {
                if (channels[i] > 2) throw new Failure("command_invalid");
                int offset = 8 + i * 5;
                // vibed f7c89385416e626a9c6c0c9d674153a9f4af6112 Config.swift: ledWorkTime = 255.
                // Adopt its implemented byte value; no timing unit or unlimited-duration claim.
                command[offset] = channels[i]; command[offset + 1] = 0xFF;
                command[offset + 2] = 2; command[offset + 3] = 2; command[offset + 4] = 2;
            }
            return EncodeFixedCommand(command);
        }
        // Official mode-2 setters: keys select breathe brightness, dial selects always-on.
        // A single-field mask never requests timing, level, type or the other brightness.
        static byte[] BrightnessFrame(int channel, byte brightness) {
            if (channel < 0 || channel > 3) throw new Failure("command_invalid");
            byte[] command = new byte[28];
            command[0] = 1; command[1] = 11; command[2] = 136; command[3] = 4;
            command[4] = (byte)(channel == 3 ? 0x40 : 0x20); command[5] = (byte)channel;
            command[8 + 5 * channel + (channel == 3 ? 4 : 3)] = brightness;
            return EncodeFixedCommand(command);
        }
        static bool MatchesBrightness(byte[] observed, byte[] channels, byte brightness, byte[] baseline) {
            if (observed == null || observed.Length != 24 || observed[2] != 2 || channels == null || channels.Length != 4
                || baseline == null || baseline.Length != 24 || observed[3] != baseline[3]) return false;
            for (int i = 0; i < 4; i++) {
                int offset = 4 + 5 * i, target = i == 3 ? 4 : 3;
                if (observed[offset] != channels[i]) return false;
                for (int field = 1; field < 5; field++)
                    if (observed[offset + field] != (field == target ? brightness : baseline[offset + field])) return false;
            }
            return true;
        }
        static byte[] TypeFrame(byte[] channels, int channel) {
            if (channels == null || channels.Length != 4 || channel < 0 || channel > 3 || channels[channel] > 2) throw new Failure("command_invalid");
            byte[] command = new byte[28];
            command[0] = 1; command[1] = 0x0B; command[2] = 0x88; command[3] = 4;
            command[4] = 4; command[5] = (byte)channel; command[8 + 5 * channel] = channels[channel];
            return EncodeFixedCommand(command);
        }
        // Closed, native-only K2/K3 overlay: touch type and solid brightness together.
        // The known key brightness is the breathe field; an unknown/zero solid field is not a visible pulse.
        static byte[] KeyFeedbackFrame(byte[] saved, int channel, bool on) {
            if (saved == null || saved.Length != 24 || saved[2] != 2 || channel < 1 || channel > 2)
                throw new Failure("lights_unavailable");
            int offset = 4 + 5 * channel;
            byte[] command = new byte[28];
            command[0] = 1; command[1] = 11; command[2] = 136; command[3] = 4;
            command[4] = 0x44; command[5] = (byte)channel;
            command[8 + 5 * channel] = on ? (byte)1 : saved[offset];
            command[12 + 5 * channel] = saved[offset + (on ? 3 : 4)];
            return EncodeFixedCommand(command);
        }
        // Keep the existing K1-only optimization and no-brightness policy unchanged.
        static byte[] K1TypeFrame(byte[] channels) { return TypeFrame(channels, 0); }
        static bool MatchesK1PreservingLights(byte[] observed, byte[] channels, byte[] original) {
            if (observed == null || observed.Length != 24 || channels == null || channels.Length != 4
                || original == null || original.Length != 24 || observed[2] != 2 || observed[4] != channels[0]) return false;
            for (int j = 1; j < 5; j++) if (observed[4 + j] != original[4 + j]) return false;
            for (int i = 1; i < 4; i++) {
                int offset = 4 + 5 * i;
                if (observed[offset] != channels[i] || observed[offset + 1] != 255
                    || observed[offset + 2] != 2 || observed[offset + 3] != 2 || observed[offset + 4] != 2) return false;
            }
            return true;
        }
        // This private encoder is reachable only from compile-time protocol constructors.
        static byte[] EncodeFixedCommand(byte[] command) {
            byte[] plain = new byte[64], cipher = new byte[64], report = new byte[64];
            try {
                Array.Copy(command, plain, command.Length);
                for (int offset = 0; offset < 64; offset += 8) EncryptBlock(plain, offset, cipher, offset, Key);
                report[0] = 0x55;
                Array.Copy(cipher, 0, report, 1, 63);
                return report;
            } finally { Array.Clear(plain, 0, plain.Length); Array.Clear(cipher, 0, cipher.Length); }
        }
        static byte[] GetLightsFrame() { return EncodeFixedCommand(new byte[] { 0x01, 0x0B, 0x88, 0x01 }); }
        static byte[] RestoreGlobalFrame(byte[] saved) {
            if (saved == null || saved.Length != 24 || saved[2] > 2) throw new Failure("lights_unavailable");
            return EncodeFixedCommand(new byte[] { 0x01, 0x0B, 0x88, 0x04, 0x01, 0x00, saved[2] });
        }
        static byte[] RestoreChannelsFrame(byte[] saved, int channel) {
            if (saved == null || saved.Length != 24) throw new Failure("lights_unavailable");
            if (channel < 0 || channel > 3) throw new Failure("command_invalid");
            byte[] command = new byte[28];
            command[0] = 1; command[1] = 0x0B; command[2] = 0x88; command[3] = 4; command[4] = 0x7C;
            command[5] = (byte)channel;
            Array.Copy(saved, 4, command, 8, 20);
            return EncodeFixedCommand(command);
        }
        static bool MatchesLights(byte[] observed, byte[] channels) {
            if (observed == null || observed.Length != 24 || channels == null || channels.Length != 4 || observed[2] != 2) return false;
            for (int i = 0; i < 4; i++) {
                int offset = 4 + 5 * i;
                if (observed[offset] != channels[i] || observed[offset + 1] != 255
                    || observed[offset + 2] != 2 || observed[offset + 3] != 2 || observed[offset + 4] != 2) return false;
            }
            return true;
        }
        static byte[] SoftwareFrame(bool online) {
            return EncodeFixedCommand(new byte[] { 0x01, 0x01, 0x10, 0x00, (byte)(online ? 0x03 : 0x00) });
        }
        // MIT protocol facts: ihavespoons/vibed f7c89385416e626a9c6c0c9d674153a9f4af6112,
        // Sources/VibeKit/Protocol.swift, Requests.swift and Messages.swift. Public table, never logged.
        static readonly uint[] DongleAuthTable = { 0x20141107U, 0xC138BF6DU, 0xA8AB23C7U, 0x73165329U, 0x30629139U, 0xD9F4E04CU, 0xEC8C35BFU, 0x64101856U, 0x47201988U, 0x98211053U, 0xF0D4ECA9U, 0x82991136U, 0x09153583U, 0x16141925U, 0xBF8A7CEDU, 0x54557049U };
        static byte[] DongleAuthFrame(uint challenge) {
            byte[] command = new byte[9];
            try {
                command[0] = 6; command[1] = 2; command[2] = 5; command[3] = 1;
                command[4] = (byte)(challenge & 15); Store(command, 5, challenge);
                return EncodeFixedCommand(command);
            } finally { Array.Clear(command, 0, command.Length); }
        }
        static bool DongleAuthMatches(byte[] plain, uint challenge) {
            return plain != null && plain.Length >= 9 && (plain[0] & 31) == 6
                && (plain[1] & 15) == 2 && plain[2] == 5 && (plain[3] & 0x10) != 0
                && plain[4] < 16 && (Load(plain, 5) ^ DongleAuthTable[plain[4]]) == challenge;
        }
        static byte[] DeviceActiveFrame() { return EncodeFixedCommand(new byte[] { 6, 3, 10, 1 }); }
        static bool DeviceActiveMatches(byte[] plain) {
            return plain != null && plain.Length >= 5 && (plain[0] & 31) == 6
                && (plain[1] & 15) == 3 && plain[2] == 10 && plain[3] == 0x11;
        }
        static byte[] HeartbeatFrame() {
            return EncodeFixedCommand(new byte[] { 0x06, 0x01, 0x23, 0x00, 0x01 });
        }
        static bool IsLightState(string state) {
            return state == "idle" || state == "running" || state == "approval" || state == "attention" || state == "recording";
        }
        static bool ValidRequestId(long value) { return value >= 1 && value <= 9007199254740991L; }
        static void LightsResult(Command command, string result) {
            string json = LightsResultJson(command, result);
            if (json == null) return;
            Console.WriteLine(json);
            Console.Out.Flush();
        }
        static string LightsResultJson(Command command, string result) {
            if (command == null || !IsLightState(command.State) || !ValidRequestId(command.RequestId)) return null;
            if (result != "verified" && result != "written" && result != "mismatch" && result != "failed"
                && result != "preserved" && result != "restored" && result != "restore_written" && result != "restore_mismatch") return null;
            string reason = result == "failed" && command.FailureCode == "snapshot_unavailable"
                ? ",\"reason\":\"snapshot_unavailable\"" : "";
            return "{\"type\":\"lights\",\"state\":\"" + command.State + "\",\"result\":\"" + result
                + "\",\"requestId\":" + command.RequestId.ToString(System.Globalization.CultureInfo.InvariantCulture) + reason
                + (command.Readback == null || command.Readback.Attempts == 0 ? "" : ",\"readback\":" + command.Readback.Json())
                + (command.SnapshotDiagnostics == null ? "" : ",\"snapshotDiagnostics\":" + command.SnapshotDiagnostics) + "}";
        }
        internal sealed class ReadbackStats {
            internal string Stage;
            // Only global mode and four five-byte lamp records; never export identity bytes 0,1,3.
            internal string Comparison;
            internal void Compare(byte[] observed, byte[] channels, byte? brightness, byte[] original) {
                int[] expected = new int[20], actual = new int[20];
                for (int i = 0; i < 20; i++) {
                    int channel = i / 5, field = i % 5;
                    actual[i] = observed[4 + i];
                    expected[i] = field == 0 ? channels[channel]
                        : brightness.HasValue ? (field == (channel == 3 ? 4 : 3) ? brightness.Value : original[4 + i])
                        : channel == 0 ? original[4 + i] : field == 1 ? 255 : 2;
                }
                Comparison = JsonSerializer.Serialize(new { expected = new { mode = 2, lights = expected },
                    observed = new { mode = (int)observed[2], lights = actual } });
            }
            internal int Attempts, ReadsWhilePending, ShortReads, OuterRejected, NonMatchingHeader, ModeRejected, Matched, TimedOut, GetWritesCompleted;
            internal sealed class HeaderCounts {
                public int lightingNoRelay { get; set; }
                public int lightingGroupFlags { get; set; }
                public int lightingOtherOperation { get; set; }
                public int dongle { get; set; }
                public int notice { get; set; }
                public int otherDevice { get; set; }
                public int other { get; set; }
                internal HeaderCounts Copy() { return (HeaderCounts)MemberwiseClone(); }
                internal void Classify(byte[] plain) {
                    if (plain == null || plain.Length < 4) { other = Math.Min(65535, other + 1); return; }
                    int type = plain[0] & 0x1F;
                    if (type == 1 && (plain[1] & 0x0F) == 0x0B && plain[2] == 0x88) {
                        if (plain[3] != 0x11) lightingOtherOperation = Math.Min(65535, lightingOtherOperation + 1);
                        else {
                            if ((plain[0] & 0x80) == 0) lightingNoRelay = Math.Min(65535, lightingNoRelay + 1);
                            if (plain[1] != 0x0B) lightingGroupFlags = Math.Min(65535, lightingGroupFlags + 1);
                        }
                    } else if (type == 6) dongle = Math.Min(65535, dongle + 1);
                    else if (type == 0x0B) notice = Math.Min(65535, notice + 1);
                    else if (type == 1) otherDevice = Math.Min(65535, otherDevice + 1);
                    else other = Math.Min(65535, other + 1);
                }
            }
            internal HeaderCounts HeaderKinds = new HeaderCounts();
            internal ReadbackStats Copy() {
                ReadbackStats copy = (ReadbackStats)MemberwiseClone();
                copy.HeaderKinds = HeaderKinds.Copy(); return copy;
            }
            internal string Json() {
                string json = JsonSerializer.Serialize(new { stage = Stage, attempts = Attempts, readsWhilePending = ReadsWhilePending,
                    shortReads = ShortReads, outerRejected = OuterRejected, nonMatchingHeader = NonMatchingHeader,
                    modeRejected = ModeRejected, matched = Matched, timedOut = TimedOut, getWritesCompleted = GetWritesCompleted, headerKinds = HeaderKinds });
                return Comparison == null ? json : json.Substring(0, json.Length - 1) + ",\"comparison\":" + Comparison + "}";
            }
            internal void ClassifyRead(int size, byte[] plain) {
                ReadsWhilePending = Math.Min(65535, ReadsWhilePending + 1);
                if (size != 64) { ShortReads = Math.Min(65535, ShortReads + 1); return; }
                if (plain == null) { OuterRejected = Math.Min(65535, OuterRejected + 1); return; }
                if (plain.Length < 28 || (plain[0] & 0x1F) != 1 || (plain[0] & 0x80) == 0
                    || plain[1] != 0x0B || plain[2] != 0x88 || plain[3] != 0x11) {
                    NonMatchingHeader = Math.Min(65535, NonMatchingHeader + 1);
                    HeaderKinds.Classify(plain); return;
                }
                if (plain[6] > 2) { ModeRejected = Math.Min(65535, ModeRejected + 1); return; }
                for (int i = 0; i < 4; i++) if (plain[8 + 5 * i] > 2) { ModeRejected = Math.Min(65535, ModeRejected + 1); return; }
            }
        }
        internal sealed class SnapshotRead {
            internal readonly byte[] Saved;
            internal readonly ReadbackStats Stats;
            internal SnapshotRead(byte[] saved, ReadbackStats stats) { Saved = saved; Stats = stats; }
        }
        internal sealed class Command {
            internal ReadbackStats Readback;
            internal string SnapshotDiagnostics;
            internal string State;
            internal string FailureCode;
            internal byte[] Channels;
            internal byte? Brightness;
            internal bool KeyFeedback, Release;
            internal long RequestId;
        }
        static Command ParseCommand(byte[] bytes, int count) {
            try {
                using (JsonDocument doc = JsonDocument.Parse(new ReadOnlyMemory<byte>(bytes, 0, count),
                    new JsonDocumentOptions { MaxDepth = 2, AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow })) {
                    if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new Failure("command_invalid");
                    string type = null, state = null;
                    byte[] channels = null;
                    byte? brightness = null;
                    long requestId = 0;
                    bool hasRequestId = false, hasKeyFeedback = false, keyFeedback = false, hasRelease = false, release = false;
                    int fields = 0;
                    foreach (JsonProperty field in doc.RootElement.EnumerateObject()) {
                        fields++;
                        if (field.Name == "requestId" && !hasRequestId) {
                            if (field.Value.ValueKind != JsonValueKind.Number || !field.Value.TryGetInt64(out requestId)
                                || !ValidRequestId(requestId)) throw new Failure("command_invalid");
                            hasRequestId = true;
                        } else if (field.Name == "release" && !hasRelease) {
                            if (field.Value.ValueKind != JsonValueKind.True && field.Value.ValueKind != JsonValueKind.False) throw new Failure("command_invalid");
                            release = field.Value.GetBoolean(); hasRelease = true;
                        } else if (field.Name == "keyFeedback" && !hasKeyFeedback) {
                            if (field.Value.ValueKind != JsonValueKind.True && field.Value.ValueKind != JsonValueKind.False) throw new Failure("command_invalid");
                            keyFeedback = field.Value.GetBoolean(); hasKeyFeedback = true;
                        } else if (field.Name == "brightness" && !brightness.HasValue) {
                            byte level;
                            if (field.Value.ValueKind != JsonValueKind.Number || !field.Value.TryGetByte(out level)) throw new Failure("command_invalid");
                            brightness = level;
                        } else if (field.Name == "channels" && channels == null) {
                            if (field.Value.ValueKind != JsonValueKind.Array || field.Value.GetArrayLength() != 4) throw new Failure("command_invalid");
                            channels = new byte[4]; int index = 0;
                            foreach (JsonElement item in field.Value.EnumerateArray()) {
                                int channel;
                                if (item.ValueKind != JsonValueKind.Number || !item.TryGetInt32(out channel) || channel < 0 || channel > 2)
                                    throw new Failure("command_invalid");
                                channels[index++] = (byte)channel;
                            }
                        } else {
                            if (field.Value.ValueKind != JsonValueKind.String) throw new Failure("command_invalid");
                            if (field.Name == "type" && type == null) type = field.Value.GetString();
                            else if (field.Name == "state" && state == null) state = field.Value.GetString();
                            else throw new Failure("command_invalid");
                        }
                    }
                    if (type == "stop" && fields == 1) return new Command { State = "stop" };
                    fields -= (hasKeyFeedback ? 1 : 0) + (hasRelease ? 1 : 0);
                    if (type == "lights" && hasRequestId && (fields == 3 + (channels != null ? 1 : 0) + (brightness.HasValue ? 1 : 0)) && IsLightState(state)) {
                        channels = channels ?? DefaultChannels(state);
                        if (release && (keyFeedback || !Array.TrueForAll(channels, channel => channel == 0))) throw new Failure("command_invalid");
                        return new Command { State = state, Channels = channels, Brightness = brightness, KeyFeedback = keyFeedback, Release = release, RequestId = requestId };
                    }
                    throw new Failure("command_invalid");
                }
            } catch (JsonException) { throw new Failure("command_invalid"); }
        }
        internal sealed class CommandDecoder {
            internal const int MaxLineBytes = 256, MaxMessagesPerSecond = 30;
            readonly byte[] line = new byte[MaxLineBytes];
            int length, count;
            long window;
            internal Command Feed(byte value, long milliseconds) {
                if (value != 10) {
                    if (length == MaxLineBytes) throw new Failure("command_limit");
                    line[length++] = value;
                    return null;
                }
                if (milliseconds - window >= 1000) { window = milliseconds; count = 0; }
                if (++count > MaxMessagesPerSecond) throw new Failure("command_rate_limited");
                try {
                    int size = length > 0 && line[length - 1] == 13 ? length - 1 : length;
                    return ParseCommand(line, size);
                } finally { Array.Clear(line, 0, line.Length); length = 0; }
            }
            internal void Clear() { Array.Clear(line, 0, line.Length); length = 0; }
        }
        // Fixed record construction only. No native exception, path, serial or report enters stdout.
        public static void Status(string state) {
            switch (state) {
                case "ready": case "unsupported_runtime": case "unsupported_platform":
                case "compile_or_runtime_failed": case "physical_receiver_unverified":
                case "no_device": case "ambiguous_device": case "metadata_failed": case "open_failed":
                case "caps_changed": case "disconnected": case "input_failed": case "stdin_failed":
                case "command_invalid": case "command_limit": case "command_rate_limited":
                case "lights_disabled": case "lights_unavailable": case "lights_written":
                case "write_failed": case "auto_restore_failed": break;
                default: state = "compile_or_runtime_failed"; break;
            }
            Console.WriteLine("{\"type\":\"status\",\"state\":\"" + state + "\"}");
            Console.Out.Flush();
        }
        public static string ErrorCode(Exception error) {
            for (int depth = 0; error != null && depth < 16; depth++, error = error.InnerException) {
                Failure failure = error as Failure;
                if (failure != null) return failure.Code;
            }
            return "compile_or_runtime_failed";
        }
        sealed class Session {
            readonly Stream stream;
            readonly bool lights, selfTest;
            readonly Func<Session, Task> syntheticCommands;
            internal readonly CancellationTokenSource stop = new CancellationTokenSource();
            internal readonly Channel<Command> commands = Channel.CreateBounded<Command>(new BoundedChannelOptions(8) {
                SingleReader = true, SingleWriter = true, FullMode = BoundedChannelFullMode.Wait
            });
            string error;
            bool touchedLights, touchedOnline, onlineAuthenticated, snapshotAttempted, recordingRecoveryAttempted;
            byte[] snapshot;
            readonly object snapshotGate = new object();
            ReadbackStats activeReadback, initialReadback;
            TaskCompletionSource<SnapshotRead> pendingSnapshot;
            TaskCompletionSource<bool> pendingAuth, pendingLink;
            uint authChallenge;
            bool authReady, linkReady;
            readonly InitializationStage authInitialization = new InitializationStage(), linkInitialization = new InitializationStage();
            internal string LastInitializationJson;
            internal readonly List<string> Results = new List<string>(); // Synthetic evidence only; production emits bounded NDJSON.
            internal readonly TaskCompletionSource<string> ResultReady = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            internal ReadbackStats LastReadback;
            int snapshotRetries, wakeRecoveryPending;
            bool wakeRecoveryAttempted;
            readonly List<object> snapshotDiagnostics = new List<object>();
            long sequence;
            readonly object feedbackGate = new object();
            readonly bool[] feedbackDown = new bool[2];
            readonly long[] feedbackPressed = new long[2];
            bool feedbackEnabled;
            void ConfigureKeyFeedback(bool enabled) {
                lock (feedbackGate) {
                    feedbackEnabled = enabled;
                    Array.Clear(feedbackPressed, 0, feedbackPressed.Length);
                    // Do not reset held keys: enabling cannot synthesize a fresh physical down.
                }
            }
            void ObserveKeyFeedback(string input) {
                int key = input == "k2.down" || input == "k2.up" ? 0 : input == "k3.down" || input == "k3.up" ? 1 : -1;
                if (key < 0) return;
                bool down = input.EndsWith(".down", StringComparison.Ordinal);
                lock (feedbackGate) {
                    if (down && !feedbackDown[key] && feedbackEnabled) feedbackPressed[key] = Environment.TickCount64;
                    feedbackDown[key] = down;
                }
            }
            int TakeKeyFeedback(out long pressed) {
                lock (feedbackGate) {
                    for (int key = 0; key < 2; key++) {
                        pressed = feedbackPressed[key]; feedbackPressed[key] = 0;
                        if (feedbackEnabled && pressed != 0 && Environment.TickCount64 - pressed < 500) return key + 1;
                    }
                    pressed = 0; return -1;
                }
            }
            async Task WriteKeyFeedback(Command intent, byte[] known, int channel, long pressed) {
                // Feedback overlays only the known, owned task configuration, never released preferences.
                if (intent == null || intent.Release || !intent.KeyFeedback || intent.Brightness == 0 || intent.Channels[channel] != 0) return;
                byte[] baseline = null;
                try {
                    if (known != null) baseline = (byte[])known.Clone();
                    if (snapshot == null || baseline == null || baseline[2] != 2 || baseline[4 + 5 * channel] != 0
                        || baseline[7 + 5 * channel] == 0 || Environment.TickCount64 - pressed >= 500
                        || commands.Reader.TryPeek(out _) || stop.IsCancellationRequested) return;
                    bool previouslyTouched = touchedLights;
                    touchedLights = true; // An attempted overlay can reach hardware even if its write fails.
                    long started = Environment.TickCount64;
                    try {
                        await WritePacket(KeyFeedbackFrame(baseline, channel, true), stop.Token).ConfigureAwait(false);
                        // The pulse owns the writer: no GET, heartbeat or 80ms full transaction can extend it.
                        // Count write latency inside the budget, not as an extra 250ms after a slow write.
                        while (Environment.TickCount64 - started < 250 && !commands.Reader.TryPeek(out _))
                            await Task.Delay(5, stop.Token).ConfigureAwait(false);
                    } finally {
                        // Restore only the two temporary fields before any task transaction or slow GET.
                        // Stop/disconnect still attempts this once; a failure retains original-snapshot cleanup ownership.
                        await WritePacket(KeyFeedbackFrame(baseline, channel, false), CancellationToken.None).ConfigureAwait(false);
                        touchedLights = previouslyTouched;
                    }
                } finally { if (baseline != null) Array.Clear(baseline, 0, baseline.Length); }
            }
            void ReportResult(Command command, string result) {
                command.SnapshotDiagnostics = JsonSerializer.Serialize(snapshotDiagnostics);
                if (selfTest) { LastReadback = command.Readback; Results.Add(result); ResultReady.TrySetResult(result); }
                else LightsResult(command, result);
            }
            internal Session(Stream stream, bool lights, Func<Session, Task> syntheticCommands = null) {
                this.stream = stream; this.lights = lights; this.syntheticCommands = syntheticCommands;
                selfTest = syntheticCommands != null;
            }
            void Fail(string code) { Interlocked.CompareExchange(ref error, code, null); stop.Cancel(); }
            async Task ReadInputs() {
                byte[] report = new byte[64];
                try {
                    while (true) {
                        int size = await stream.ReadAsync(report, 0, report.Length, stop.Token).ConfigureAwait(false);
                        if (size == 0) { Fail("disconnected"); return; }
                        string input = null;
                        byte[] plain = size == 64 ? DecodePlain(report) : null;
                        lock (snapshotGate) {
                            if (pendingAuth != null && !pendingAuth.Task.IsCompleted) {
                                authInitialization.ReadsWhilePending = Math.Min(65535, authInitialization.ReadsWhilePending + 1);
                                if (DongleAuthMatches(plain, authChallenge)) { authInitialization.ReplyMatched = true; pendingAuth.TrySetResult(true); }
                            }
                            if (pendingLink != null && !pendingLink.Task.IsCompleted) {
                                linkInitialization.ReadsWhilePending = Math.Min(65535, linkInitialization.ReadsWhilePending + 1);
                                if (DeviceActiveMatches(plain)) { linkInitialization.ReplyMatched = true; pendingLink.TrySetResult(plain[4] != 0); }
                            }
                            if (pendingSnapshot != null && !pendingSnapshot.Task.IsCompleted) {
                                activeReadback.ClassifyRead(size, plain);
                                byte[] saved = SnapshotReply(plain);
                                if (saved != null) {
                                    activeReadback.Matched++;
                                    // Freeze counters before publishing completion; writer may resume immediately.
                                    SnapshotRead read = new SnapshotRead(saved, activeReadback.Copy());
                                    if (!pendingSnapshot.TrySetResult(read)) Array.Clear(saved, 0, saved.Length);
                                }
                            }
                        }
                        if (plain != null) {
                            try {
                                if (IsLightingWakeNotice(plain)) Interlocked.Exchange(ref wakeRecoveryPending, 1);
                                input = Classify(plain);
                                ObserveKeyFeedback(input);
                            } finally { Array.Clear(plain, 0, plain.Length); }
                        }
                        if (input != null) {
                            // Classify is the only producer; sequence counts accepted reports, not inferred actions.
                            sequence++;
                            Console.WriteLine("{\"type\":\"input\",\"event\":\"" + input + "\",\"sequence\":"
                                + sequence.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}");
                            Console.Out.Flush();
                        }
                        Array.Clear(report, 0, report.Length);
                    }
                } catch (OperationCanceledException) { }
                catch (Exception) { Fail("input_failed"); }
                finally { Array.Clear(report, 0, report.Length); }
            }
            async Task ReadCommands() {
                CommandDecoder decoder = new CommandDecoder();
                byte[] bytes = new byte[128];
                Stopwatch clock = Stopwatch.StartNew();
                IntPtr input = GetStdHandle(-10);
                try {
                    while (!stop.IsCancellationRequested) {
                        uint available;
                        // Node spawn supplies an anonymous pipe. Never issue an unbounded pending stdin read.
                        if (!PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero)) {
                            int nativeError = Marshal.GetLastWin32Error();
                            if (nativeError == 109 || nativeError == 232) { stop.Cancel(); return; }
                            throw new Failure("stdin_failed");
                        }
                        if (available == 0) { await Task.Delay(10, stop.Token).ConfigureAwait(false); continue; }
                        uint read;
                        if (!ReadFile(input, bytes, Math.Min(available, (uint)bytes.Length), out read, IntPtr.Zero)) {
                            if (Marshal.GetLastWin32Error() == 109) { stop.Cancel(); return; }
                            throw new Failure("stdin_failed");
                        }
                        if (read == 0) { stop.Cancel(); return; }
                        for (int i = 0; i < read && !stop.IsCancellationRequested; i++) {
                            Command command = decoder.Feed(bytes[i], clock.ElapsedMilliseconds);
                            if (command == null) continue;
                            if (command.State == "stop") { stop.Cancel(); return; }
                            if (!lights) throw new Failure("lights_disabled");
                            if (!commands.Writer.TryWrite(command)) throw new Failure("command_limit");
                        }
                        Array.Clear(bytes, 0, bytes.Length);
                    }
                } catch (OperationCanceledException) { }
                catch (Failure failure) { Fail(failure.Code); }
                catch (Exception) { Fail("stdin_failed"); }
                finally { decoder.Clear(); Array.Clear(bytes, 0, bytes.Length); commands.Writer.TryComplete(); }
            }
            Task WriteFrame(string state, CancellationToken token) {
                return WritePacket(LightsFrame(state), token);
            }
            async Task WritePacket(byte[] report, CancellationToken token) {
                try {
                    using (CancellationTokenSource write = CancellationTokenSource.CreateLinkedTokenSource(token)) {
                        write.CancelAfter(300);
                        // Await native I/O completion even on cancellation before clearing report or closing its handle.
                        await stream.WriteAsync(report, 0, report.Length, write.Token).ConfigureAwait(false);
                        // Buffer-size-one HID writes are complete here; flushing is not a device ACK.
                    }
                } finally { Array.Clear(report, 0, report.Length); }
            }
            async Task InitializeLighting() {
                // Only a notice received after this fresh initialization may request the later wake recovery.
                Interlocked.Exchange(ref wakeRecoveryPending, 0);
                try { await InitializeLightingCore().ConfigureAwait(false); }
                finally {
                    lock (snapshotGate) { LastInitializationJson = InitializationJson(authInitialization, linkInitialization); }
                    if (TraceInitialization && !selfTest) { Console.Error.WriteLine(LastInitializationJson); Console.Error.Flush(); }
                }
            }
            async Task<bool> WaitForInitializationReply(Task<bool> reply, CancellationToken token) {
                while (!reply.IsCompleted) {
                    await Task.WhenAny(reply, Task.Delay(800, token)).ConfigureAwait(false);
                    token.ThrowIfCancellationRequested();
                    if (!reply.IsCompleted && touchedOnline) await WritePacket(HeartbeatFrame(), token).ConfigureAwait(false);
                }
                return await reply.ConfigureAwait(false);
            }
            async Task InitializeLightingCore() {
                // One bounded auth (only if still needed), then the existing online/input lease, then linked-state read.
                if (!authReady) {
                    authInitialization.WriteCompleted = false; authInitialization.ReplyMatched = false;
                    byte[] random = System.Security.Cryptography.RandomNumberGenerator.GetBytes(4);
                    TaskCompletionSource<bool> auth = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                    try {
                        lock (snapshotGate) { authChallenge = Load(random, 0); pendingAuth = auth; }
                        await WritePacket(DongleAuthFrame(authChallenge), stop.Token).ConfigureAwait(false);
                        authInitialization.WriteCompleted = true;
                        using (CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token)) {
                            deadline.CancelAfter(1500);
                            authReady = await WaitForInitializationReply(auth.Task, deadline.Token).ConfigureAwait(false);
                            authInitialization.Status = "matched";
                        }
                    } catch (OperationCanceledException) {
                        authInitialization.Status = stop.IsCancellationRequested ? "cancelled" : authInitialization.WriteCompleted ? "reply_timeout" : "write_timeout";
                        if (stop.IsCancellationRequested) throw;
                    }
                    catch (IOException) { authInitialization.Status = "write_failed"; }
                    finally { lock (snapshotGate) { pendingAuth = null; authChallenge = 0; } Array.Clear(random, 0, random.Length); }
                }
                stop.Token.ThrowIfCancellationRequested();
                // Even unconfirmed auth must not disable the established online, heartbeat and input path.
                if (!touchedOnline || (authReady && !onlineAuthenticated)) {
                    touchedOnline = true; // An attempted online write may reach hardware even if cancelled.
                    await WritePacket(SoftwareFrame(true), stop.Token).ConfigureAwait(false);
                    onlineAuthenticated = authReady; // Fallback Online before confirmed auth is not an authenticated announcement.
                }
                await WritePacket(HeartbeatFrame(), stop.Token).ConfigureAwait(false);
                if (!authReady) return;
                linkInitialization.WriteCompleted = false; linkInitialization.ReplyMatched = false;
                linkReady = false; // A recovery query must establish fresh readiness, not retain an old true after timeout.
                TaskCompletionSource<bool> linked = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                try {
                    lock (snapshotGate) { pendingLink = linked; }
                    await WritePacket(DeviceActiveFrame(), stop.Token).ConfigureAwait(false);
                    linkInitialization.WriteCompleted = true;
                    using (CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(stop.Token)) {
                        deadline.CancelAfter(750);
                        linkReady = await linked.Task.WaitAsync(deadline.Token).ConfigureAwait(false);
                        linkInitialization.Status = linkReady ? "matched" : "linked_false";
                    }
                } catch (OperationCanceledException) {
                    linkInitialization.Status = stop.IsCancellationRequested ? "cancelled" : linkInitialization.WriteCompleted ? "reply_timeout" : "write_timeout";
                    if (stop.IsCancellationRequested) throw;
                }
                catch (IOException) { linkInitialization.Status = "write_failed"; }
                finally { lock (snapshotGate) { pendingLink = null; } }
            }
            async Task<byte[]> ReadSnapshot(CancellationToken token, ReadbackStats stats) {
                TaskCompletionSource<SnapshotRead> pending = new TaskCompletionSource<SnapshotRead>(TaskCreationOptions.RunContinuationsAsynchronously);
                lock (snapshotGate) {
                    if (pendingSnapshot != null) throw new Failure("lights_unavailable");
                    stats.Attempts++; activeReadback = stats; pendingSnapshot = pending;
                }
                byte[] observed = null;
                try {
                    await WritePacket(GetLightsFrame(), token).ConfigureAwait(false);
                    lock (snapshotGate) { stats.GetWritesCompleted++; }
                    using (CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(token)) {
                        // Conservative public default (3s), not a claim that 500ms was the sole cause.
                        timeout.CancelAfter(3000);
                        try {
                            while (!pending.Task.IsCompleted) {
                                await Task.WhenAny(pending.Task, Task.Delay(800, timeout.Token)).ConfigureAwait(false);
                                timeout.Token.ThrowIfCancellationRequested();
                                if (!pending.Task.IsCompleted) await WritePacket(HeartbeatFrame(), timeout.Token).ConfigureAwait(false);
                            }
                            observed = (await pending.Task.ConfigureAwait(false)).Saved;
                        }
                        catch (OperationCanceledException) when (!token.IsCancellationRequested) {
                            lock (snapshotGate) { stats.TimedOut++; }
                            return null;
                        }
                    }
                    return observed;
                } finally {
                    lock (snapshotGate) {
                        pendingSnapshot = null; activeReadback = null;
                        pending.TrySetCanceled();
                        if (observed == null && pending.Task.Status == TaskStatus.RanToCompletion) {
                            byte[] abandoned = pending.Task.Result.Saved; Array.Clear(abandoned, 0, abandoned.Length);
                        }
                    }
                }
            }
            async Task<bool> CaptureSnapshot() {
                if (snapshotAttempted) return snapshot != null;
                snapshotAttempted = true;
                initialReadback = new ReadbackStats { Stage = "initial" };
                stop.Token.ThrowIfCancellationRequested();
                if (authReady && linkReady) snapshot = await ReadSnapshot(stop.Token, initialReadback).ConfigureAwait(false);
                string outcome = !authReady ? "auth_unconfirmed" : !linkReady ? "link_not_ready" : snapshot != null ? "matched"
                    : initialReadback.ShortReads + initialReadback.OuterRejected + initialReadback.NonMatchingHeader + initialReadback.ModeRejected > 0 ? "reply_rejected" : "timeout";
                // Keep the first three attempts intact and wire-compatible with existing hosts.
                // A later event-triggered recovery is evidenced by its actual result/readback, not a fourth history entry.
                if (snapshotDiagnostics.Count < 3) snapshotDiagnostics.Add(new { attempt = snapshotDiagnostics.Count + 1, outcome,
                    auth = authInitialization.Status, link = linkInitialization.Status,
                    timedOut = initialReadback.TimedOut, rejected = initialReadback.ShortReads + initialReadback.OuterRejected + initialReadback.NonMatchingHeader + initialReadback.ModeRejected });
                return snapshot != null;
            }
            bool CanRetrySnapshot() {
                return snapshotRetries < 2 && snapshot == null && !touchedLights && !stop.IsCancellationRequested;
            }
            async Task RetrySnapshot() {
                snapshotRetries++;
                await Task.Delay(250 * snapshotRetries, stop.Token).ConfigureAwait(false);
                await InitializeLighting().ConfigureAwait(false);
                snapshotAttempted = false;
            }
            bool CanRecoverWake() {
                // A real device notice is a bounded recovery hint, never authorization to write LEDs.
                return !wakeRecoveryAttempted && snapshotAttempted && snapshotRetries == 2
                    && snapshot == null && !touchedLights && !stop.IsCancellationRequested
                    && Volatile.Read(ref wakeRecoveryPending) != 0;
            }
            bool CanRecoverRecording(Command command) {
                return !recordingRecoveryAttempted && snapshotAttempted && CanRetrySnapshot()
                    && command.State == "recording" && command.Channels[0] == 2;
            }
            Command ReplaceReleasedRecording(Command command) {
                Command next;
                // Single reader: inspect only the queue head; a recording state may also explicitly disable K1.
                if (command.State == "recording" && command.Channels[0] == 2 && commands.Reader.TryPeek(out next)
                    && next.RequestId > command.RequestId && IsLightState(next.State) && next.Channels[0] == 0
                    && next.Channels[1] == command.Channels[1] && next.Channels[2] == command.Channels[2]
                    && next.Channels[3] == command.Channels[3] && next.Brightness == command.Brightness && commands.Reader.TryRead(out next)) {
                    ReportResult(command, "failed"); // Only the stale requestId; the host ignores superseded IDs.
                    return next;
                }
                return command;
            }
            Command ReplaceSupersededCommand(Command command) {
                Command next;
                while (commands.Reader.TryPeek(out next) && next.RequestId > command.RequestId && commands.Reader.TryRead(out next)) {
                    ReportResult(command, "failed");
                    command = next;
                }
                return command;
            }
            async Task WriteLights() {
                Command current = null, deferred = null, feedbackIntent = null;
                byte[] verifiedChannels = null;
                byte? verifiedBrightness = null;
                byte[] k1Preferences = null;
                bool k1BaselineUnknown = false;
                string releaseResult = null;
                try {
                    if (!lights) { await Task.Delay(Timeout.Infinite, stop.Token).ConfigureAwait(false); return; }
                    stop.Token.ThrowIfCancellationRequested();
                    await InitializeLighting().ConfigureAwait(false);
                    stop.Token.ThrowIfCancellationRequested();
                    Stopwatch clock = Stopwatch.StartNew();
                    long nextHeartbeat = 800, nextLight = 0;
                    while (!stop.IsCancellationRequested) {
                        if (clock.ElapsedMilliseconds >= nextHeartbeat) {
                            await WritePacket(HeartbeatFrame(), stop.Token).ConfigureAwait(false);
                            nextHeartbeat = clock.ElapsedMilliseconds + 800;
                        }
                        if (clock.ElapsedMilliseconds >= nextLight && (commands.Reader.TryRead(out current)
                            || ((current = CanRecoverWake() ? deferred : null) != null))) {
                            stop.Token.ThrowIfCancellationRequested();
                        ProcessLightingCommand:
                            feedbackIntent = current;
                            ConfigureKeyFeedback(!current.Release && current.KeyFeedback);
                            deferred = null; // A newer command (including ownership release) supersedes the failed intent.
                            // Enabled idle owns an all-off vector. Only explicit opt-out releases the saved configuration.
                            // Native recording can still override K1 while the client state is idle.
                            if (current.Release) {
                                Interlocked.Exchange(ref wakeRecoveryPending, 0);
                                if (releaseResult != null) ReportResult(current, releaseResult);
                                else if (!touchedLights) { releaseResult = "preserved"; ReportResult(current, releaseResult); }
                                else {
                                    await WritePacket(RestoreGlobalFrame(snapshot), stop.Token).ConfigureAwait(false);
                                    for (int channel = 0; channel < 4; channel++) {
                                        await Task.Delay(80, stop.Token).ConfigureAwait(false);
                                        await WritePacket(RestoreChannelsFrame(snapshot, channel), stop.Token).ConfigureAwait(false);
                                    }
                                    await Task.Delay(80, stop.Token).ConfigureAwait(false);
                                    ReadbackStats restoredReadback = new ReadbackStats { Stage = "post_write" };
                                    byte[] restored = await ReadSnapshot(stop.Token, restoredReadback).ConfigureAwait(false);
                                    current.Readback = restoredReadback.Copy();
                                    try {
                                        bool matches = restored != null && restored[2] == snapshot[2];
                                        for (int field = 4; matches && field < 24; field++) matches = restored[field] == snapshot[field];
                                        releaseResult = restored == null ? "restore_written" : matches ? "restored" : "restore_mismatch";
                                        ReportResult(current, releaseResult);
                                        // Only exact readback releases ownership. Unconfirmed restoration is
                                        // retried on disconnect, never by a repeating release request.
                                        if (matches) touchedLights = false;
                                    } finally { if (restored != null) Array.Clear(restored, 0, restored.Length); }
                                }
                                if (snapshot != null) {
                                    if (verifiedChannels != null) Array.Clear(verifiedChannels, 0, verifiedChannels.Length);
                                    verifiedChannels = null; verifiedBrightness = null;
                                    if (k1Preferences != null) Array.Clear(k1Preferences, 0, k1Preferences.Length);
                                    // Even a preserved release after GET (but before any LED write) permits
                                    // external changes. Never reuse the original snapshot on reacquisition.
                                    k1Preferences = null; k1BaselineUnknown = true;
                                }
                                current = null; nextLight = clock.ElapsedMilliseconds + 50;
                                continue;
                            }
                            releaseResult = null;
                            bool ready = await CaptureSnapshot().ConfigureAwait(false);
                            if (!ready && CanRecoverRecording(current)) {
                                recordingRecoveryAttempted = true; // Per connection, never a timer or idle/task retry.
                                await RetrySnapshot().ConfigureAwait(false);
                                ready = await CaptureSnapshot().ConfigureAwait(false);
                                stop.Token.ThrowIfCancellationRequested();
                                Command previous = current;
                                current = ReplaceReleasedRecording(current);
                                if (!Object.ReferenceEquals(previous, current)) goto ProcessLightingCommand;
                            }
                            while (!ready && CanRetrySnapshot()) {
                                await RetrySnapshot().ConfigureAwait(false);
                                ready = await CaptureSnapshot().ConfigureAwait(false);
                            }
                            if (!ready && CanRecoverWake()) {
                                wakeRecoveryAttempted = true; // Once per connection; repeated notices cannot refill this budget.
                                Interlocked.Exchange(ref wakeRecoveryPending, 0);
                                await Task.Delay(300, stop.Token).ConfigureAwait(false);
                                current = ReplaceSupersededCommand(current);
                                if (current.Release) goto ProcessLightingCommand;
                                // The replacement owns both the task vector and optional physical-key feedback.
                                feedbackIntent = current;
                                ConfigureKeyFeedback(current.KeyFeedback);
                                await InitializeLighting().ConfigureAwait(false);
                                snapshotAttempted = false;
                                ready = await CaptureSnapshot().ConfigureAwait(false);
                            }
                            stop.Token.ThrowIfCancellationRequested();
                            Command beforeRecovery = current;
                            current = ReplaceSupersededCommand(current);
                            if (!Object.ReferenceEquals(beforeRecovery, current)) goto ProcessLightingCommand;
                            if (!ready) {
                                current.Readback = initialReadback.Copy();
                                current.FailureCode = "snapshot_unavailable";
                                ReportResult(current, "failed"); // Keep input usable when original LED state cannot be read.
                                if (!wakeRecoveryAttempted) deferred = current; // Host deduplicates an unchanged desired vector.
                            } else {
                                current.FailureCode = null;
                                // Recover the live preservation baseline after an unobserved write; never reuse
                                // the immutable restoration snapshot as a guess about current hardware.
                                if (k1BaselineUnknown) {
                                    ReadbackStats baselineReadback = new ReadbackStats { Stage = "initial" };
                                    k1Preferences = await ReadSnapshot(stop.Token, baselineReadback).ConfigureAwait(false);
                                    if (k1Preferences == null) {
                                        current.Readback = baselineReadback.Copy();
                                        ReportResult(current, "failed");
                                        current = null;
                                        nextLight = clock.ElapsedMilliseconds + 50;
                                        continue;
                                    }
                                    k1BaselineUnknown = false;
                                }
                                stop.Token.ThrowIfCancellationRequested();
                                Command beforeBaseline = current;
                                current = ReplaceSupersededCommand(current);
                                if (!Object.ReferenceEquals(beforeBaseline, current)) goto ProcessLightingCommand;
                                // Only a strictly verified prior transaction can isolate a K1 type change.
                                bool k1Only = !current.Brightness.HasValue && !verifiedBrightness.HasValue && verifiedChannels != null && current.Channels[0] != verifiedChannels[0]
                                    && current.Channels[1] == verifiedChannels[1] && current.Channels[2] == verifiedChannels[2]
                                    && current.Channels[3] == verifiedChannels[3];
                                if (verifiedChannels != null) Array.Clear(verifiedChannels, 0, verifiedChannels.Length);
                                verifiedChannels = null; // Any incomplete, unknown or mismatched write invalidates trust.
                                // An attempted frame can have reached hardware even when its write is cancelled.
                                touchedLights = true;
                                if (k1Preferences == null && !k1BaselineUnknown) k1Preferences = (byte[])snapshot.Clone();
                                if (k1Only) {
                                    await WritePacket(K1TypeFrame(current.Channels), stop.Token).ConfigureAwait(false);
                                } else {
                                    // The full vector is carried each time, but byte 5 selects only ONE channel.
                                    await WriteFrame("auto", stop.Token).ConfigureAwait(false);
                                    for (int channel = 0; channel < 4; channel++) {
                                        await Task.Delay(80, stop.Token).ConfigureAwait(false);
                                        await WritePacket(current.Brightness.HasValue ? TypeFrame(current.Channels, channel)
                                            : channel == 0 ? K1TypeFrame(current.Channels) : ChannelsFrame(current.Channels, channel), stop.Token).ConfigureAwait(false);
                                        if (current.Brightness.HasValue) {
                                            await Task.Delay(80, stop.Token).ConfigureAwait(false);
                                            await WritePacket(BrightnessFrame(channel, current.Brightness.Value), stop.Token).ConfigureAwait(false);
                                        }
                                    }
                                }
                                await Task.Delay(80, stop.Token).ConfigureAwait(false);
                                ReadbackStats readback = new ReadbackStats { Stage = "post_write" };
                                byte[] observed;
                                try { observed = await ReadSnapshot(stop.Token, readback).ConfigureAwait(false); }
                                finally { current.Readback = readback.Copy(); }
                                try {
                                    if (observed != null) current.Readback.Compare(observed, current.Channels, current.Brightness, k1Preferences);
                                    // Configuration readback is not evidence of physical LED appearance.
                                    string result = observed == null ? "written" : (current.Brightness.HasValue ? MatchesBrightness(observed, current.Channels, current.Brightness.Value, k1Preferences)
                                        : MatchesK1PreservingLights(observed, current.Channels, k1Preferences)) ? "verified" : "mismatch";
                                    // Commit only observed values, after comparing against the pre-write baseline.
                                    // A mismatch still supplies the actual preservation fields; silence does not.
                                    if (k1Preferences != null) Array.Clear(k1Preferences, 0, k1Preferences.Length);
                                    k1Preferences = observed == null ? null : (byte[])observed.Clone();
                                    k1BaselineUnknown = observed == null;
                                    if (result == "verified") verifiedChannels = (byte[])current.Channels.Clone();
                                    verifiedBrightness = current.Brightness;
                                    ReportResult(current, result);
                                } finally { if (observed != null) Array.Clear(observed, 0, observed.Length); }
                            }
                            current = null;
                            nextLight = clock.ElapsedMilliseconds + 50;
                        }
                        if (!commands.Reader.TryPeek(out _) && feedbackIntent != null) {
                            long pressed;
                            int channel = TakeKeyFeedback(out pressed);
                            if (channel > 0) await WriteKeyFeedback(feedbackIntent, k1BaselineUnknown ? null : k1Preferences, channel, pressed).ConfigureAwait(false);
                        }
                        await Task.Delay(10, stop.Token).ConfigureAwait(false);
                    }
                } catch (OperationCanceledException) {
                    if (!stop.IsCancellationRequested) { if (current != null) { if (current.Readback == null && initialReadback != null && snapshot == null) current.Readback = initialReadback.Copy(); ReportResult(current, "failed"); } Fail("write_failed"); }
                } catch (Exception) {
                    if (current != null) { if (current.Readback == null && initialReadback != null && snapshot == null) current.Readback = initialReadback.Copy(); ReportResult(current, "failed"); }
                    Fail("write_failed");
                } finally {
                    ConfigureKeyFeedback(false);
                    if (verifiedChannels != null) Array.Clear(verifiedChannels, 0, verifiedChannels.Length);
                    if (k1Preferences != null) Array.Clear(k1Preferences, 0, k1Preferences.Length);
                }
            }
            internal async Task Run() {
                ConsoleCancelEventHandler cancel = delegate(object sender, ConsoleCancelEventArgs args) {
                    args.Cancel = true;
                    try { stop.Cancel(); } catch (ObjectDisposedException) { }
                };
                Console.CancelKeyPress += cancel;
                try {
                    if (!selfTest) Status("ready");
                    // One reader, one bounded command parser, one serial writer. No reconnect loop or duration cap.
                    await Task.WhenAll(ReadInputs(), syntheticCommands == null ? ReadCommands() : syntheticCommands(this), WriteLights()).ConfigureAwait(false);
                    // All cancelled read/write tasks are complete before cleanup writes or handle disposal.
                    // Restore only the exact global/work-record fields that this session changed.
                    // No takeover was permitted without a matched original snapshot.
                    if (touchedLights && snapshot != null) {
                        try { await WritePacket(RestoreGlobalFrame(snapshot), CancellationToken.None).ConfigureAwait(false); }
                        catch (Exception) { Interlocked.CompareExchange(ref error, "auto_restore_failed", null); }
                        for (int channel = 0; channel < 4; channel++) {
                            await Task.Delay(80).ConfigureAwait(false);
                            try { await WritePacket(RestoreChannelsFrame(snapshot, channel), CancellationToken.None).ConfigureAwait(false); }
                            catch (Exception) { Interlocked.CompareExchange(ref error, "auto_restore_failed", null); }
                        }
                    }
                    if (touchedOnline) {
                        try { await WritePacket(SoftwareFrame(false), CancellationToken.None).ConfigureAwait(false); }
                        catch (Exception) { Interlocked.CompareExchange(ref error, "auto_restore_failed", null); }
                    }
                    if (error != null) throw new Failure(error);
                } finally {
                    Console.CancelKeyPress -= cancel;
                    if (snapshot != null) Array.Clear(snapshot, 0, snapshot.Length);
                    stop.Dispose();
                }
            }
        }
        public static void Connect(int physicalReceiverCount, bool enableLights) {
            if (physicalReceiverCount != 1) throw new Failure("physical_receiver_unverified");
            Device[] devices = Enumerate();
            if (devices.Length == 0) throw new Failure("no_device");
            if (devices.Length != 1) throw new Failure("ambiguous_device");
            Device device = devices[0];
            if (!IsTargetPath(device.Path)) throw new Failure("caps_changed");
            uint access = GENERIC_READ | (enableLights ? GENERIC_WRITE : 0);
            // Exclusive report handle: never share a verified writer with another AU05 controller.
            SafeFileHandle handle = CreateFileW(device.Path, access, 0, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, IntPtr.Zero);
            if (handle.IsInvalid) { handle.Dispose(); throw new Failure("open_failed"); }
            FileStream stream = null;
            try {
                Device verified = Inspect(handle, device.Path);
                if (verified == null || (enableLights && verified.OutputBytes != 64)) throw new Failure("caps_changed");
                stream = new FileStream(handle, enableLights ? FileAccess.ReadWrite : FileAccess.Read, 1, true);
                new Session(stream, enableLights).Run().GetAwaiter().GetResult();
            } finally { if (stream != null) stream.Dispose(); else handle.Dispose(); }
        }
        static void Check(bool condition) { if (!condition) throw new Failure("compile_or_runtime_failed"); }
        static void Reject(string json) {
            byte[] bytes = System.Text.Encoding.UTF8.GetBytes(json);
            bool rejected = false;
            try { ParseCommand(bytes, bytes.Length); } catch (Failure) { rejected = true; }
            Check(rejected);
        }
        // Synthetic stream never opens a handle. Exercises real session cancellation and serial cleanup.
        sealed class SyntheticStream : Stream {
            internal readonly TaskCompletionSource<bool> ReadStarted = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            internal readonly TaskCompletionSource<bool> ManualStarted = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            internal readonly List<byte[]> Frames = new List<byte[]>();
            internal bool ReadCompleted, ManualCompleted, ReplyToGet = true, ReplyToReadback = true;
            internal bool MalformedInitial = false;
            internal bool CancelManual, MismatchReadback, MalformedReadback, FailReadback, NoiseBeforeReply;
            internal bool SuppressAuth, RejectAuth, FailAuth, SuppressLink, Linked = true, LinkedOnlyOnline = true;
            internal bool Online;
            internal readonly TaskCompletionSource<bool> RecoveryLinked = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            internal int AuthCount, LinkCount, HeartbeatCount, SnapshotDelayMs, FlushCalls;
            internal bool ThrowOnFlush;
            internal bool ExplicitBrightness, RejectK1Brightness;
            bool hasLampWrite;
            internal readonly byte[] Original = SyntheticSnapshot();
            internal readonly byte[] Current;
            readonly Channel<byte[]> responses = Channel.CreateUnbounded<byte[]>();
            internal readonly TaskCompletionSource<bool> GetStarted = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            int activeWrites;
            internal int PeakWrites, GetCount;
            internal SyntheticStream() { Current = (byte[])Original.Clone(); }
            public override bool CanRead { get { return true; } }
            public override bool CanWrite { get { return true; } }
            public override bool CanSeek { get { return false; } }
            public override long Length { get { throw new NotSupportedException(); } }
            public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
            public override void Flush() { }
            public override Task FlushAsync(CancellationToken token) {
                FlushCalls++;
                if (ThrowOnFlush) throw new IOException("synthetic_flush_failed");
                return Task.CompletedTask;
            }
            public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
            public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
            public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
            public override void SetLength(long value) { throw new NotSupportedException(); }
            public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken token) {
                ReadStarted.TrySetResult(true);
                try {
                    byte[] response = await responses.Reader.ReadAsync(token).ConfigureAwait(false);
                    byte[] decoded = response.Length == 64 ? DecodePlain(response) : null;
                    try {
                        if (SnapshotDelayMs > 0 && decoded != null && (decoded[0] & 31) == 1 && decoded[2] == 0x88)
                            await Task.Delay(SnapshotDelayMs, token).ConfigureAwait(false);
                        Array.Copy(response, 0, buffer, offset, response.Length);
                        return response.Length;
                    } finally { if (decoded != null) Array.Clear(decoded, 0, decoded.Length); }
                } catch (OperationCanceledException) { ReadCompleted = true; throw; }
            }
            public override async Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken token) {
                activeWrites++; PeakWrites = Math.Max(PeakWrites, activeWrites);
                byte[] copy = new byte[count]; Array.Copy(buffer, offset, copy, 0, count);
                byte[] decoded = DecodePlain(copy);
                try {
                    if (decoded[0] == 6 && decoded[1] == 2 && decoded[2] == 5) {
                        Check(++AuthCount <= 4 && decoded[3] == 1);
                        if (FailAuth) throw new IOException();
                        if (!SuppressAuth) {
                            byte[] reply = new byte[9]; reply[0] = 6; reply[1] = 2; reply[2] = 5; reply[3] = 0x11; reply[4] = decoded[4];
                            Store(reply, 5, Load(decoded, 5) ^ DongleAuthTable[reply[4]] ^ (RejectAuth ? 1U : 0U));
                            responses.Writer.TryWrite(EncodeFixedCommand(reply)); Array.Clear(reply, 0, reply.Length);
                        }
                        return;
                    }
                    if (decoded[0] == 6 && decoded[1] == 3 && decoded[2] == 10) {
                        Check(AuthCount >= 1 && ++LinkCount <= 4 && decoded[3] == 1);
                        if (LinkCount == 2) RecoveryLinked.TrySetResult(true);
                        if (!SuppressLink) responses.Writer.TryWrite(EncodeFixedCommand(new byte[] { 6, 3, 10, 0x11, (byte)(Linked && (!LinkedOnlyOnline || Online) ? 1 : 0) }));
                        return;
                    }
                    if (decoded[0] == 6 && decoded[1] == 1 && decoded[2] == 0x23) { HeartbeatCount++; return; }
                    // Transaction assertions below exclude separately counted initialization and heartbeats.
                    Frames.Add(copy);
                    if (decoded[0] == 1 && decoded[1] == 1 && decoded[2] == 0x10) Online = decoded[4] == 3;
                    if (decoded[0] != 1 || decoded[1] != 0x0B || decoded[2] != 0x88) return;
                    if (decoded[3] == 1) {
                        GetCount++; GetStarted.TrySetResult(true);
                        if (hasLampWrite && !ExplicitBrightness) for (int j = 1; j < 5; j++) Check(Current[4 + j] == Original[4 + j]);
                        if (hasLampWrite && FailReadback) throw new IOException("synthetic_readback_write_failed");
                        if (hasLampWrite ? ReplyToReadback : ReplyToGet) {
                            byte[] reply = new byte[28]; reply[0] = 0x81; reply[1] = 0x0B; reply[2] = 0x88; reply[3] = 0x11;
                            Array.Copy(Current, 0, reply, 4, 24);
                            if (hasLampWrite && MismatchReadback) reply[27] ^= 1;
                            if (hasLampWrite ? MalformedReadback : MalformedInitial) reply[2] = 0;
                            if (NoiseBeforeReply) {
                                responses.Writer.TryWrite(new byte[12]); // short read, no decoding
                                responses.Writer.TryWrite(new byte[64]); // invalid outer report marker
                                responses.Writer.TryWrite(EncodeFixedCommand(new byte[] { 0x81, 0x01, 0x10, 0 })); // non-snapshot protocol header
                                byte[] badMode = (byte[])reply.Clone(); badMode[6] = 3;
                                responses.Writer.TryWrite(EncodeFixedCommand(badMode));
                            }
                            responses.Writer.TryWrite(EncodeFixedCommand(reply));
                        }
                    } else if (decoded[3] == 4 && decoded[4] == 1) {
                        hasLampWrite = true;
                        Current[2] = decoded[6];
                        if (CancelManual && !ManualStarted.Task.IsCompleted) {
                            ManualStarted.TrySetResult(true);
                            try { await Task.Delay(Timeout.Infinite, token).ConfigureAwait(false); }
                            finally { ManualCompleted = true; }
                        }
                    } else if (decoded[3] == 4 && (decoded[4] == 4 || decoded[4] == 0x20 || decoded[4] == 0x40 || decoded[4] == 0x7C)) {
                        int selected = decoded[5]; Check(selected < 4);
                        // Model both the actual focus selector and field mask, never an atomic vector.
                        for (int field = 0; field < 5; field++) {
                            if ((decoded[4] & (4 << field)) == 0 || (selected == 0 && field >= 3 && RejectK1Brightness)) continue;
                            Current[4 + 5 * selected + field] = decoded[8 + 5 * selected + field];
                        }
                        ManualCompleted = true; ManualStarted.TrySetResult(true);
                    }
                } finally { Array.Clear(decoded, 0, decoded.Length); activeWrites--; }
            }
        }
        static byte[] SyntheticSnapshot() {
            byte[] saved = new byte[24]; saved[2] = 1;
            for (int i = 0; i < 4; i++) {
                int offset = 4 + 5 * i; saved[offset] = (byte)(i % 3);
                saved[offset + 1] = (byte)(9 + i); saved[offset + 2] = 1;
                saved[offset + 3] = 3; saved[offset + 4] = 4;
            }
            return saved;
        }
        static void CheckFrame(byte[] actual, byte[] expected) {
            Check(actual.Length == expected.Length);
            for (int i = 0; i < actual.Length; i++) Check(actual[i] == expected[i]);
        }
        static void ReadbackLifecycle(SyntheticStream stream, string expectedResult, bool writeFailure = false, byte? brightness = null) {
            byte[] channels = { 2, 2, 1, 0 };
            stream.ExplicitBrightness = brightness.HasValue;
            Session session = new Session(stream, true, async delegate(Session value) {
                await stream.ReadStarted.Task.ConfigureAwait(false);
                Check(value.commands.Writer.TryWrite(new Command { State = "approval", Channels = channels, Brightness = brightness, RequestId = 27 }));
                Check(await value.ResultReady.Task.ConfigureAwait(false) == expectedResult);
                value.stop.Cancel();
            });
            Task run = session.Run();
            if (writeFailure) {
                bool failed = false;
                try { Check(run.Wait(4000)); run.GetAwaiter().GetResult(); }
                catch (AggregateException exception) { failed = ErrorCode(exception) == "write_failed"; }
                catch (Failure failure) { failed = failure.Code == "write_failed"; }
                Check(failed);
            } else { Check(run.Wait(12000)); run.GetAwaiter().GetResult(); }
            Check(stream.ReadCompleted && stream.PeakWrites == 1 && session.Results.Count == 1 && session.Results[0] == expectedResult);
            Check(stream.FlushCalls == 0 && stream.AuthCount == 1 && stream.LinkCount == (stream.ReplyToGet ? 1 : 3));
            CheckInitializationJson(session.LastInitializationJson, "matched", "matched");
            ReadbackStats stats = session.LastReadback;
            Check(stats != null);
            Check((stats.Comparison != null) == (expectedResult == "verified" || expectedResult == "mismatch"));
            if (stats.Comparison != null) {
                using (JsonDocument comparison = JsonDocument.Parse(stats.Comparison)) {
                    JsonElement expected = comparison.RootElement.GetProperty("expected"), actual = comparison.RootElement.GetProperty("observed");
                    Check(expected.GetProperty("mode").GetInt32() == 2 && actual.GetProperty("mode").GetInt32() == 2);
                    Check(expected.GetProperty("lights").GetArrayLength() == 20 && actual.GetProperty("lights").GetArrayLength() == 20);
                    Check((expected.GetRawText() == actual.GetRawText()) == (expectedResult == "verified"));
                    if (expectedResult == "mismatch") Check(expected.GetProperty("lights")[19].GetInt32() != actual.GetProperty("lights")[19].GetInt32());
                }
                Check(System.Text.Encoding.UTF8.GetByteCount(LightsResultJson(new Command { State = "recording", RequestId = 9007199254740991, Readback = stats }, expectedResult)) <= 2048);
            }
            if (!stream.ReplyToGet) {
                Check(stats.Stage == "initial" && stats.Attempts == 1 && stats.GetWritesCompleted == 1
                    && stats.TimedOut == 1 && stats.Matched == 0 && stats.ReadsWhilePending == 0);
                Check(stream.Frames.Count == 5 && stream.GetCount == 3 && stream.HeartbeatCount >= 3);
                CheckFrame(stream.Frames[1], GetLightsFrame());
                CheckFrame(stream.Frames[4], SoftwareFrame(false));
            } else {
                Check(stats.Stage == "post_write" && stats.Attempts == 1);
                Check(stats.GetWritesCompleted == (writeFailure ? 0 : 1));
                Check(stats.TimedOut == (!writeFailure && (!stream.ReplyToReadback || stream.MalformedReadback) ? 1 : 0));
                Check(stats.Matched == (!writeFailure && stream.ReplyToReadback && !stream.MalformedReadback ? 1 : 0));
                if (stream.NoiseBeforeReply) Check(stats.ReadsWhilePending == 5 && stats.ShortReads == 1
                    && stats.OuterRejected == 1 && stats.NonMatchingHeader == 1 && stats.ModeRejected == 1);
                if (stream.MalformedReadback) Check(stats.NonMatchingHeader == 1 && stats.ModeRejected == 0);
                int extra = brightness.HasValue ? 4 : 0;
                Check(stream.Frames.Count == 14 + extra && stream.GetCount == 2);
                CheckFrame(stream.Frames[0], SoftwareFrame(true));
                CheckFrame(stream.Frames[1], GetLightsFrame());
                CheckFrame(stream.Frames[2], LightsFrame("auto"));
                for (int channel = 0; channel < 4; channel++) {
                    int index = 3 + channel * (brightness.HasValue ? 2 : 1);
                    CheckFrame(stream.Frames[index], brightness.HasValue ? TypeFrame(channels, channel)
                        : channel == 0 ? K1TypeFrame(channels) : ChannelsFrame(channels, channel));
                    if (brightness.HasValue) CheckFrame(stream.Frames[index + 1], BrightnessFrame(channel, brightness.Value));
                }
                CheckFrame(stream.Frames[7 + extra], GetLightsFrame());
                CheckFrame(stream.Frames[8 + extra], RestoreGlobalFrame(stream.Original));
                for (int channel = 0; channel < 4; channel++) CheckFrame(stream.Frames[9 + extra + channel], RestoreChannelsFrame(stream.Original, channel));
                CheckFrame(stream.Frames[13 + extra], SoftwareFrame(false));
            }
            // The original snapshot is immutable even after successful/mismatched post-write GETs.
            CheckFrame(stream.Current, stream.Original);
        }
        static void BrightnessBaselineTests() {
            // Consecutive transactions, not an echo-only single-write check:
            // accepted brightness, rejected K1 brightness, lost reply, failed baseline recovery.
            for (int scenario = 0; scenario < 4; scenario++) {
                int mode = scenario;
                using (SyntheticStream stream = new SyntheticStream {
                    ExplicitBrightness = true, RejectK1Brightness = mode == 1,
                    ReplyToReadback = mode < 2
                }) {
                    Session session = new Session(stream, true, async delegate(Session value) {
                        await stream.ReadStarted.Task.ConfigureAwait(false);
                        Check(value.commands.Writer.TryWrite(new Command { State = "running", Channels = new byte[] { 0, 0, 0, 1 }, Brightness = 123, RequestId = 1 }));
                        string first = await value.ResultReady.Task.ConfigureAwait(false);
                        Check(first == (mode == 0 ? "verified" : mode == 1 ? "mismatch" : "written"));
                        if (mode >= 2) { stream.Current[7] = 17; stream.Current[8] = 19; }
                        byte breathe = stream.Current[7], solid = stream.Current[8];
                        int framesBefore = stream.Frames.Count, getsBefore = stream.GetCount;
                        stream.ReplyToReadback = mode != 3;
                        Check(value.commands.Writer.TryWrite(new Command { State = "recording", Channels = new byte[] { 2, 0, 0, 1 }, RequestId = 2 }));
                        while (value.Results.Count < 2) await Task.Delay(10).ConfigureAwait(false);
                        Check(value.Results[1] == (mode == 3 ? "failed" : "verified"));
                        Check(stream.Current[7] == breathe && stream.Current[8] == solid);
                        Check(stream.GetCount - getsBefore == (mode == 2 ? 2 : 1));
                        if (mode == 3) {
                            // Unknown baseline: GET only, no guessed K1/global/channel write.
                            Check(stream.Frames.Count == framesBefore + 1);
                        } else {
                            Check(stream.Frames.Count - framesBefore == (mode == 2 ? 7 : 6));
                            using (JsonDocument comparison = JsonDocument.Parse(value.LastReadback.Comparison)) {
                                JsonElement expected = comparison.RootElement.GetProperty("expected").GetProperty("lights");
                                Check(expected[3].GetInt32() == breathe && expected[4].GetInt32() == solid);
                            }
                            framesBefore = stream.Frames.Count;
                            Check(value.commands.Writer.TryWrite(new Command { State = "running", Channels = new byte[] { 0, 0, 0, 1 }, RequestId = 3 }));
                            while (value.Results.Count < 3) await Task.Delay(10).ConfigureAwait(false);
                            Check(value.Results[2] == "verified" && stream.Frames.Count == framesBefore + 2);
                            Check(stream.Current[7] == breathe && stream.Current[8] == solid);
                        }
                        stream.RejectK1Brightness = false;
                        value.stop.Cancel();
                    });
                    Task run = session.Run(); Check(run.Wait(12000)); run.GetAwaiter().GetResult();
                    // Live-baseline changes must never contaminate exact exit restoration.
                    CheckFrame(stream.Current, stream.Original);
                }
            }
        }
        static void CheckInitializationJson(string json, string authStatus, string linkStatus) {
            using (JsonDocument doc = JsonDocument.Parse(json)) {
                JsonElement root = doc.RootElement;
                int rootCount = 0; foreach (JsonProperty property in root.EnumerateObject()) rootCount++;
                Check(rootCount == 3 && root.GetProperty("schema").GetString() == "au05-light-init-v1");
                foreach (string stage in new string[] { "auth", "link" }) {
                    JsonElement item = root.GetProperty(stage);
                    int fields = 0; foreach (JsonProperty property in item.EnumerateObject()) fields++;
                    Check(fields == 4 && item.GetProperty("status").GetString() == (stage == "auth" ? authStatus : linkStatus));
                    Check(item.GetProperty("writeCompleted").ValueKind == JsonValueKind.True || item.GetProperty("writeCompleted").ValueKind == JsonValueKind.False);
                    Check(item.GetProperty("replyMatched").ValueKind == JsonValueKind.True || item.GetProperty("replyMatched").ValueKind == JsonValueKind.False);
                    Check(item.GetProperty("readsWhilePending").GetInt32() >= 0 && item.GetProperty("readsWhilePending").GetInt32() <= 65535);
                }
            }
        }
        static void InitializationTests() {
            for (int mode = 0; mode < 5; mode++) {
                using (SyntheticStream stream = new SyntheticStream {
                    RejectAuth = mode == 0, SuppressAuth = mode == 1, FailAuth = mode == 2,
                    Linked = mode != 3, SuppressLink = mode == 4
                }) {
                    Session session = new Session(stream, true, async delegate(Session value) {
                        await stream.ReadStarted.Task.ConfigureAwait(false);
                        Check(value.commands.Writer.TryWrite(new Command { State = "running", Channels = DefaultChannels("running"), RequestId = 1 }));
                        Check(await value.ResultReady.Task.ConfigureAwait(false) == "failed");
                        // Failed lamp initialization leaves the input reader and online lease alive.
                        Check(!value.stop.IsCancellationRequested && !stream.ReadCompleted);
                        value.stop.Cancel();
                    });
                    Task run = session.Run(); Check(run.Wait(8000)); run.GetAwaiter().GetResult();
                    CheckInitializationJson(session.LastInitializationJson, mode < 2 ? "reply_timeout" : mode == 2 ? "write_failed" : "matched", mode < 3 ? "not_sent" : mode == 3 ? "linked_false" : "reply_timeout");
                    Check(stream.AuthCount == (mode < 3 ? 3 : 1) && stream.LinkCount == (mode < 3 ? 0 : 3));
                    Check(stream.GetCount == 0 && stream.Frames.Count == 2 && stream.HeartbeatCount >= 1);
                    CheckFrame(stream.Frames[0], SoftwareFrame(true)); CheckFrame(stream.Frames[1], SoftwareFrame(false));
                    Check(stream.ReadCompleted && stream.PeakWrites == 1 && session.LastReadback.Attempts == 0);
                }
            }
        }
        static void IdleDarkTests() {
            for (int scenario = 0; scenario < 3; scenario++) {
                int mode = scenario;
                using (SyntheticStream stream = new SyntheticStream { ExplicitBrightness = true }) {
                    Session session = new Session(stream, true, async delegate(Session value) {
                        await stream.ReadStarted.Task.ConfigureAwait(false);
                        long request = 0;
                        Func<string, byte[], byte?, bool, Task> send = async delegate(string state, byte[] channels, byte? brightness, bool release) {
                            int count = value.Results.Count;
                            Check(value.commands.Writer.TryWrite(new Command { State = state, Channels = channels, Brightness = brightness, Release = release, RequestId = ++request }));
                            while (value.Results.Count == count) await Task.Delay(10).ConfigureAwait(false);
                        };
                        await send("idle", new byte[4], 123, true);
                        Check(value.Results[0] == "preserved" && stream.GetCount == 0);
                        CheckFrame(stream.Current, stream.Original);
                        byte? brightness = mode == 0 ? (byte?)0 : mode == 1 ? (byte?)2 : null;
                        await send("idle", new byte[4], brightness, false);
                        Check(value.Results[1] == "verified" && stream.Current[2] == 2);
                        for (int channel = 0; channel < 4; channel++) Check(stream.Current[4 + channel * 5] == 0);
                        Check(value.LastReadback.Stage == "post_write" && value.LastReadback.Matched == 1);
                        // Native recording remains an explicit exception to client idle.
                        await send("idle", new byte[] { 2, 0, 0, 0 }, null, false);
                        Check(value.Results[2] == "verified" && stream.Current[4] == 2);
                        await send("idle", new byte[4], brightness, false);
                        Check(value.Results[3] == "verified" && stream.Current[2] == 2);
                        for (int channel = 0; channel < 4; channel++) Check(stream.Current[4 + channel * 5] == 0);
                        await send("running", DefaultChannels("running"), null, false);
                        Check(value.Results[4] == "verified");
                        stream.ReplyToReadback = mode != 1; stream.MismatchReadback = mode == 2;
                        int before = stream.Frames.Count;
                        await send("idle", new byte[4], brightness, true);
                        Check(value.Results[5] == (mode == 0 ? "restored" : mode == 1 ? "restore_written" : "restore_mismatch"));
                        CheckFrame(stream.Frames[before], RestoreGlobalFrame(stream.Original));
                        for (int channel = 0; channel < 4; channel++) CheckFrame(stream.Frames[before + 1 + channel], RestoreChannelsFrame(stream.Original, channel));
                        CheckFrame(stream.Current, stream.Original);
                        before = stream.Frames.Count;
                        await send("idle", new byte[4], 5, true);
                        Check(stream.Frames.Count == before);
                        stream.ReplyToReadback = true; stream.MismatchReadback = false;
                        // Re-enable idle takes ownership again, but cannot overwrite the exit snapshot.
                        await send("idle", new byte[4], null, false);
                        Check(value.Results[7] == "verified" && stream.Current[2] == 2);
                        for (int channel = 0; channel < 4; channel++) Check(stream.Current[4 + channel * 5] == 0);
                        value.stop.Cancel();
                    });
                    Task run = session.Run(); Check(run.Wait(12000)); run.GetAwaiter().GetResult();
                    Check(stream.PeakWrites == 1 && stream.ReadCompleted);
                    CheckFrame(stream.Current, stream.Original);
                }
            }
        }
        static void LifecycleTests() {
            IdleDarkTests();
            InitializationTests();
            using (SyntheticStream stream = new SyntheticStream()) {
                Session session = new Session(stream, false, async delegate(Session value) {
                    await stream.ReadStarted.Task.ConfigureAwait(false);
                    value.stop.Cancel(); // Same cancellation path as stop, EOF and Ctrl+C.
                });
                Task run = session.Run();
                Check(run.Wait(2000)); run.GetAwaiter().GetResult();
                Check(stream.ReadCompleted && stream.Frames.Count == 0);
            }
            using (SyntheticStream stream = new SyntheticStream { CancelManual = true }) {
                Session session = new Session(stream, true, async delegate(Session value) {
                    await stream.ReadStarted.Task.ConfigureAwait(false);
                    Check(value.commands.Writer.TryWrite(new Command { State = "running", Channels = DefaultChannels("running"), RequestId = 1 }));
                    await stream.ManualStarted.Task.ConfigureAwait(false);
                    value.stop.Cancel();
                });
                Task run = session.Run();
                Check(run.Wait(2000)); run.GetAwaiter().GetResult();
                Check(stream.ReadCompleted && stream.ManualCompleted && stream.PeakWrites == 1);
                Check(stream.Frames.Count == 9); // online, GET, attempted mode, restore mode, FOUR restore selectors, offline.
                CheckFrame(stream.Frames[0], SoftwareFrame(true));
                CheckFrame(stream.Frames[1], GetLightsFrame());
                CheckFrame(stream.Frames[2], LightsFrame("auto"));
                CheckFrame(stream.Frames[3], RestoreGlobalFrame(stream.Original));
                for (int channel = 0; channel < 4; channel++) CheckFrame(stream.Frames[4 + channel], RestoreChannelsFrame(stream.Original, channel));
                CheckFrame(stream.Frames[8], SoftwareFrame(false));
                CheckFrame(stream.Current, stream.Original);
            }
            using (SyntheticStream stream = new SyntheticStream { ThrowOnFlush = true }) ReadbackLifecycle(stream, "verified");
            using (SyntheticStream stream = new SyntheticStream { SnapshotDelayMs = 650 }) ReadbackLifecycle(stream, "verified");
            using (SyntheticStream stream = new SyntheticStream { ReplyToGet = false }) {
                Session session = new Session(stream, true, async delegate(Session value) {
                    await stream.ReadStarted.Task.ConfigureAwait(false);
                    Command first = new Command { State = "running", Channels = DefaultChannels("running"), RequestId = 1 };
                    Check(value.commands.Writer.TryWrite(first));
                    Check(await value.ResultReady.Task.ConfigureAwait(false) == "failed");
                    Check(first.FailureCode == "snapshot_unavailable");
                    Check(value.commands.Writer.TryWrite(new Command { State = "recording", Channels = DefaultChannels("recording"), RequestId = 2 }));
                    while (value.Results.Count < 2) await Task.Delay(10).ConfigureAwait(false);
                    value.stop.Cancel();
                });
                Task run = session.Run(); Check(run.Wait(12000)); run.GetAwaiter().GetResult();
                Check(stream.GetCount == 3 && stream.Frames.Count == 5 && stream.LinkCount == 3); // Shared bounded retry budget, never a fabricated baseline.
                foreach (byte[] packet in stream.Frames) {
                    byte[] plain = DecodePlain(packet);
                    try { Check(!(plain[0] == 1 && plain[1] == 0x0B && plain[2] == 0x88 && plain[3] == 4)); }
                    finally { Array.Clear(plain, 0, plain.Length); }
                }
                CheckFrame(stream.Current, stream.Original);
            }
            using (SyntheticStream stream = new SyntheticStream { NoiseBeforeReply = true }) ReadbackLifecycle(stream, "verified");
            using (SyntheticStream stream = new SyntheticStream { ReplyToReadback = false }) ReadbackLifecycle(stream, "written");
            using (SyntheticStream stream = new SyntheticStream { MismatchReadback = true }) ReadbackLifecycle(stream, "mismatch");
            using (SyntheticStream stream = new SyntheticStream { MalformedReadback = true }) ReadbackLifecycle(stream, "written");
            using (SyntheticStream stream = new SyntheticStream { ReplyToGet = false }) ReadbackLifecycle(stream, "failed");
            using (SyntheticStream stream = new SyntheticStream { FailReadback = true }) ReadbackLifecycle(stream, "failed", true);
        }
        public static void SelfTest() {
            foreach (byte brightness in new byte[] { 0, 2, 20, 255 }) {
                string json = "{\"type\":\"lights\",\"state\":\"running\",\"requestId\":1,\"brightness\":" + brightness + "}";
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(json);
                Check(ParseCommand(bytes, bytes.Length).Brightness == brightness);
                byte[] saved = SyntheticSnapshot(), channels = { 2, 1, 0, 2 }; saved[3] = 93;
                byte[] observed = (byte[])saved.Clone(); observed[2] = 2;
                for (int i = 0; i < 4; i++) {
                    int offset = 4 + 5 * i;
                    observed[offset] = channels[i]; observed[offset + (i == 3 ? 4 : 3)] = brightness;
                }
                for (int selected = 0; selected < 4; selected++) {
                    byte[] decoded = DecodePlain(BrightnessFrame(selected, brightness));
                    int target = 8 + 5 * selected + (selected == 3 ? 4 : 3);
                    Check(decoded[4] == (selected == 3 ? 0x40 : 0x20) && decoded[5] == selected);
                    for (int i = 6; i < 28; i++) Check(decoded[i] == (i == target ? brightness : 0));
                    decoded = DecodePlain(TypeFrame(channels, selected));
                    Check(decoded[4] == 4 && decoded[5] == selected);
                    for (int i = 6; i < 28; i++) Check(decoded[i] == (i == 8 + 5 * selected ? channels[selected] : 0));
                }
                Check(MatchesBrightness(observed, channels, brightness, saved));
                for (int i = 3; i < 24; i++) {
                    observed[i] ^= 1; Check(!MatchesBrightness(observed, channels, brightness, saved)); observed[i] ^= 1;
                }
                ReadbackLifecycle(new SyntheticStream(), "verified", false, brightness);
            }
            ReadbackLifecycle(new SyntheticStream { MismatchReadback = true }, "mismatch", false, 123);
            foreach (string invalid in new string[] { "-1", "256", "1.5", "true", "null", "\"2\"" })
                Reject("{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"brightness\":" + invalid + "}");
            Reject("{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"brightness\":1,\"brightness\":2}");
            Reject("{\"type\":\"stop\",\"brightness\":1}");
            Command unavailable = new Command { State = "running", RequestId = 1, FailureCode = "snapshot_unavailable", Readback = new ReadbackStats { Stage = "initial" } };
            using (JsonDocument zeroAttempt = JsonDocument.Parse(LightsResultJson(unavailable, "failed"))) {
                JsonElement omitted;
                Check(!zeroAttempt.RootElement.TryGetProperty("readback", out omitted));
                Check(zeroAttempt.RootElement.GetProperty("reason").GetString() == "snapshot_unavailable");
            }
            unavailable.Readback.Attempts = 1; unavailable.Readback.GetWritesCompleted = 1; unavailable.Readback.TimedOut = 1;
            using (JsonDocument attempted = JsonDocument.Parse(LightsResultJson(unavailable, "failed"))) {
                Check(attempted.RootElement.GetProperty("readback").GetProperty("attempts").GetInt32() == 1);
                Check(attempted.RootElement.GetProperty("reason").GetString() == "snapshot_unavailable");
            }
            foreach (string result in new string[] { "verified", "written", "mismatch", "failed", "preserved", "restored", "restore_written", "restore_mismatch" }) {
                Command wireCommand = new Command { State = "idle", RequestId = 9007199254740991, Release = true };
                using (JsonDocument wireResult = JsonDocument.Parse(LightsResultJson(wireCommand, result))) {
                    Check(wireResult.RootElement.GetProperty("result").GetString() == result);
                    Check(wireResult.RootElement.GetProperty("requestId").GetInt64() == wireCommand.RequestId);
                    Check(wireResult.RootElement.GetProperty("state").GetString() == "idle");
                }
                Check(LightsResultJson(wireCommand, "unknown") == null);
                wireCommand.RequestId = 0; Check(LightsResultJson(wireCommand, result) == null);
            }
            CheckFrame(DefaultChannels("idle"), new byte[] { 0, 0, 0, 0 });
            CheckFrame(DefaultChannels("running"), new byte[] { 0, 0, 0, 1 });
            CheckFrame(DefaultChannels("approval"), new byte[] { 0, 2, 0, 0 });
            CheckFrame(DefaultChannels("attention"), new byte[] { 0, 0, 2, 0 });
            CheckFrame(DefaultChannels("recording"), new byte[] { 2, 0, 0, 0 });
            byte[] k1Original = SyntheticSnapshot();
            byte[] k1Observed = (byte[])k1Original.Clone(); k1Observed[2] = 2;
            byte[] k1Channels = { 2, 0, 2, 1 };
            for (int i = 1; i < 4; i++) {
                int offset = 4 + 5 * i; k1Observed[offset] = k1Channels[i];
                k1Observed[offset + 1] = 255;
                for (int j = 2; j < 5; j++) k1Observed[offset + j] = 2;
            }
            foreach (byte k1Type in new byte[] { 2, 0 }) {
                k1Channels[0] = k1Type; k1Observed[4] = k1Type;
                byte[] k1Decoded = DecodePlain(K1TypeFrame(k1Channels));
                Check(k1Decoded[0] == 1 && k1Decoded[1] == 11 && k1Decoded[2] == 136
                    && k1Decoded[3] == 4 && k1Decoded[4] == 4 && k1Decoded[8] == k1Type);
                for (int i = 5; i < 56; i++) if (i != 8) Check(k1Decoded[i] == 0);
                Check(MatchesK1PreservingLights(k1Observed, k1Channels, k1Original));
                k1Observed[4] ^= 1; Check(!MatchesK1PreservingLights(k1Observed, k1Channels, k1Original)); k1Observed[4] ^= 1;
                for (int j = 1; j < 5; j++) {
                    k1Observed[4 + j] ^= 1;
                    Check(!MatchesK1PreservingLights(k1Observed, k1Channels, k1Original));
                    k1Observed[4 + j] ^= 1;
                }
                for (int i = 9; i < 24; i++) {
                    k1Observed[i] ^= 1; Check(!MatchesK1PreservingLights(k1Observed, k1Channels, k1Original)); k1Observed[i] ^= 1;
                }
            }
            byte[] zero = new byte[8], encrypted = new byte[8], plain = new byte[8];
            byte[] kat = { 0x0A, 0x3A, 0xEA, 0x41, 0x40, 0xA9, 0xBA, 0x94 };
            EncryptBlock(zero, 0, encrypted, 0, new uint[4]);
            DecryptBlock(kat, 0, plain, 0, new uint[4]);
            for (int i = 0; i < 8; i++) Check(encrypted[i] == kat[i] && plain[i] == 0);
            byte[] input = new byte[64]; input[0] = 0x55;
            byte[] protocolKat = { 0xDC, 0xEE, 0xA9, 0x6C, 0x89, 0x8F, 0x6E, 0x8F };
            Array.Copy(protocolKat, 0, input, 1, 8);
            Check(DecodeInput(input) == "k1.down");
            byte[] protocolPlain = { 0x8B, 0x10, 0, 1, 0, 0, 0, 0 };
            EncryptBlock(protocolPlain, 0, encrypted, 0, Key);
            for (int i = 0; i < 8; i++) Check(encrypted[i] == protocolKat[i]);
            for (int control = 0; control < 6; control++) for (int phase = 0; phase < 2; phase++) {
                string[] names = { "k1", "k2", "k3", "knob", "right", "left" };
                string expected = names[control] + (control >= 4 ? ".pulse" : phase == 1 ? ".down" : ".up");
                Check(Classify(new byte[] { 0x8B, 0x10, 0, (byte)phase, (byte)control }) == expected);
                Check(Classify(new byte[] { 0x0B, 0x10, 0, (byte)phase, (byte)control }) == expected);
            }
            Check(Classify(new byte[] { 0x8B, 0x10, 0, 2, 0 }) == null);
            Check(Classify(new byte[] { 0x8B, 0x10, 0, 1, 6 }) == null);
            Check(DecodeInput(new byte[63]) == null && DecodeInput(new byte[64]) == null);
            Check(IsTargetCaps(0xFFF1, 0x00DD, 0xFFFC, 1, 64));
            Check(!IsTargetCaps(0xFFF1, 0x00DD, 1, 1, 64) && !IsTargetCaps(0xFFF1, 0x00DD, 0xFFFC, 1, 65));
            Check(IsTargetPath(@"\\?\hid#vid_fff1&pid_00dd&mi_03#synthetic"));
            Check(!IsTargetPath(@"\\?\hid#vid_fff1&pid_00ddd&mi_03#synthetic"));
            Check(Marshal.SizeOf(typeof(Caps)) == 64 && Marshal.SizeOf(typeof(Attributes)) == 12);
            Check(Marshal.SizeOf(typeof(InterfaceData)) == (IntPtr.Size == 8 ? 32 : 28));
            byte[] command = System.Text.Encoding.UTF8.GetBytes("{\"type\":\"stop\"}");
            Check(ParseCommand(command, command.Length).State == "stop");
            foreach (string invalid in new string[] {
                "{}", "null", "[]", "{\"type\":\"stop\",\"state\":\"auto\"}",
                "{\"type\":\"stop\",\"type\":\"stop\"}", "{\"type\":true}",
                "{\"type\":\"macro\"}", "{\"type\":\"firmware\"}", "{\"type\":\"mapping\"}",
                "{\"type\":\"lights\",\"state\":\"arbitrary\"}", "{\"type\":\"stop\",\"payload\":[1]}",
                "{\"type\":\"stop\",}", "{\"type\":\"stop\"}{}"
            }) Reject(invalid);
            CommandDecoder decoder = new CommandDecoder();
            foreach (byte value in command) Check(decoder.Feed(value, 0) == null);
            Check(decoder.Feed(10, 0).State == "stop");
            bool limit = false;
            try { for (int i = 0; i < 257; i++) decoder.Feed(32, 0); } catch (Failure failure) { limit = failure.Code == "command_limit"; }
            Check(limit); decoder.Clear();
            CommandDecoder rate = new CommandDecoder();
            bool rateLimit = false;
            try {
                for (int i = 0; i < 31; i++) { foreach (byte value in command) rate.Feed(value, 0); rate.Feed(10, 0); }
            } catch (Failure failure) { rateLimit = failure.Code == "command_rate_limited"; }
            Check(rateLimit); rate.Clear();
            Check(ErrorCode(new Exception("private_path_or_serial")) == "compile_or_runtime_failed");
            foreach (string state in new string[] { "idle", "running", "auto" }) {
                byte[] frame = LightsFrame(state);
                Check(frame.Length == 64 && frame[0] == 0x55);
                byte[] block = new byte[8]; DecryptBlock(frame, 1, block, 0, Key);
                Check(block[0] == 1 && block[1] == 0x0B && block[2] == 0x88 && block[3] == 4 && block[4] == 1 && block[5] == 0);
                Check(block[6] == (state == "idle" ? 0 : state == "running" ? 1 : 2) && block[7] == 0);
                for (int offset = 8; offset < 56; offset += 8) {
                    DecryptBlock(frame, offset + 1, block, 0, Key);
                    for (int j = 0; j < 8; j++) Check(block[j] == 0);
                }
            }
            foreach (string state in new string[] { "idle", "running", "approval", "attention", "recording" }) {
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes("{\"type\":\"lights\",\"state\":\"" + state + "\",\"requestId\":9007199254740991}");
                Command valid = ParseCommand(bytes, bytes.Length);
                Check(valid.State == state && valid.RequestId == 9007199254740991L);
            }
            Reject("{\"type\":\"lights\",\"state\":\"auto\",\"requestId\":1}"); // Cleanup-only mode is not host-commandable.
            foreach (string invalid in new string[] {
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,0]}",
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,0,0,0]}",
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,-1,0]}",
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,3,0]}",
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,1.5,0]}",
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,true,0]}",
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,\"2\",0]}",
                "{\"type\":\"lights\",\"requestId\":1,\"state\":\"idle\",\"channels\":[0,0,0,0],\"channels\":[0,0,0,0]}",
                "{\"type\":\"stop\",\"channels\":[0,0,0,0]}",
                "{\"type\":\"stop\",\"requestId\":1}",
                "{\"type\":\"lights\",\"state\":\"idle\"}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":0}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":-1}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1.5}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":9007199254740992}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":\"1\"}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":true}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":null}",
                "{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"requestId\":2}"
            }) Reject(invalid);
            byte[] combined = System.Text.Encoding.UTF8.GetBytes("{\"type\":\"lights\",\"requestId\":1,\"state\":\"running\",\"channels\":[2,2,1,0]}");
            Command parsed = ParseCommand(combined, combined.Length);
            Check(parsed.State == "running" && parsed.RequestId == 1 && !parsed.Release && parsed.Channels[0] == 2 && parsed.Channels[1] == 2 && parsed.Channels[2] == 1 && parsed.Channels[3] == 0);
            foreach (bool release in new bool[] { false, true }) {
                byte[] commandBytes = System.Text.Encoding.UTF8.GetBytes("{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"channels\":[0,0,0,0],\"release\":" + (release ? "true" : "false") + "}");
                Check(ParseCommand(commandBytes, commandBytes.Length).Release == release);
            }
            foreach (string invalid in new string[] { "0", "1", "\"true\"", "null", "[]", "{}" })
                Reject("{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"release\":" + invalid + "}");
            Reject("{\"type\":\"stop\",\"release\":true}");
            Reject("{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"release\":true,\"release\":false}");
            Reject("{\"type\":\"lights\",\"state\":\"running\",\"requestId\":1,\"release\":true}");
            Reject("{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"release\":true,\"channels\":[0,0,2,0]}");
            Reject("{\"type\":\"lights\",\"state\":\"idle\",\"requestId\":1,\"release\":true,\"keyFeedback\":true}");
            byte[] get = GetLightsFrame();
            byte[] getKat = { 0x4E, 0x3E, 0x82, 0x16, 0x20, 0xCF, 0xF3, 0xAC };
            for (int i = 0; i < 8; i++) Check(get[i + 1] == getKat[i]);
            // All 81 closed vectors times FOUR selectors, with zero padding checked after decryption.
            for (int combination = 0; combination < 81; combination++) for (int selected = 0; selected < 4; selected++) {
                byte[] channels = new byte[4]; int digits = combination;
                for (int i = 0; i < 4; i++) { channels[i] = (byte)(digits % 3); digits /= 3; }
                byte[] decoded = DecodePlain(ChannelsFrame(channels, selected));
                Check(decoded[0] == 1 && decoded[1] == 0x0B && decoded[2] == 0x88 && decoded[3] == 4 && decoded[4] == 0x7C);
                Check(decoded[5] == selected && decoded[6] == 0 && decoded[7] == 0);
                for (int i = 0; i < 4; i++) {
                    int offset = 8 + 5 * i;
                    Check(decoded[offset] == channels[i] && decoded[offset + 1] == 255);
                    Check(decoded[offset + 2] == 2 && decoded[offset + 3] == 2 && decoded[offset + 4] == 2);
                }
                for (int i = 28; i < 56; i++) Check(decoded[i] == 0);
            }
            foreach (int invalidChannel in new int[] { -1, 4, int.MaxValue }) {
                bool rejected = false;
                try { ChannelsFrame(new byte[4], invalidChannel); } catch (Failure failure) { rejected = failure.Code == "command_invalid"; }
                Check(rejected); rejected = false;
                try { RestoreChannelsFrame(SyntheticSnapshot(), invalidChannel); } catch (Failure failure) { rejected = failure.Code == "command_invalid"; }
                Check(rejected);
            }
            byte[] matched = new byte[24]; matched[2] = 2;
            byte[] matchChannels = { 0, 1, 2, 1 };
            for (int i = 0; i < 4; i++) {
                int offset = 4 + 5 * i; matched[offset] = matchChannels[i]; matched[offset + 1] = 255;
                matched[offset + 2] = 2; matched[offset + 3] = 2; matched[offset + 4] = 2;
            }
            Check(MatchesLights(matched, matchChannels));
            matched[5] = 10; Check(!MatchesLights(matched, matchChannels)); matched[5] = 255;
            foreach (int index in new int[] { 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23 }) {
                matched[index] ^= 1; Check(!MatchesLights(matched, matchChannels)); matched[index] ^= 1;
            }
            Check(!MatchesLights(null, matchChannels) && !MatchesLights(new byte[23], matchChannels));
            byte[] reply = new byte[28]; reply[0] = 0x81; reply[1] = 0x0B; reply[2] = 0x88; reply[3] = 0x11;
            byte[] savedOriginal = SyntheticSnapshot(); Array.Copy(savedOriginal, 0, reply, 4, 24);
            byte[] savedReply = SnapshotReply(reply); Check(savedReply != null);
            for (int i = 0; i < 24; i++) Check(savedReply[i] == savedOriginal[i]);
            foreach (int index in new int[] { 0, 1, 2, 3, 6, 8 }) {
                byte old = reply[index]; reply[index] = 0xFF; Check(SnapshotReply(reply) == null); reply[index] = old;
            }
            Check(SnapshotReply(new byte[27]) == null);
            ReadbackStats classification = new ReadbackStats { Stage = "initial", Attempts = 1 };
            classification.ClassifyRead(64, new byte[] { 0x8B, 0x10, 0, 1, 0 });
            Check(classification.NonMatchingHeader == 1 && classification.ModeRejected == 0); // legal K1 input is not malformed
            Check(classification.HeaderKinds.notice == 1);
            ReadbackStats frozen = classification.Copy();
            foreach (byte[] header in new byte[][] {
                new byte[] { 1, 0x0B, 0x88, 0x11 }, new byte[] { 0x81, 0x2B, 0x88, 0x11 },
                new byte[] { 1, 0x2B, 0x88, 0x11 }, new byte[] { 1, 0x2B, 0x88, 1 },
                new byte[] { 0x86, 0x0B, 0x88, 0x11 }, new byte[] { 0x81, 0, 0, 0 },
                new byte[] { 0x82, 0, 0, 0 } }) {
                byte[] rejected = new byte[56]; Array.Copy(header, rejected, 4);
                Check(SnapshotReply(rejected) == null); // Classification must never widen acceptance.
                classification.ClassifyRead(64, rejected);
            }
            Check(classification.HeaderKinds.lightingNoRelay == 2 && classification.HeaderKinds.lightingGroupFlags == 2);
            Check(classification.HeaderKinds.lightingOtherOperation == 1 && classification.HeaderKinds.dongle == 1);
            Check(classification.HeaderKinds.otherDevice == 1 && classification.HeaderKinds.other == 1);
            Check(frozen.HeaderKinds.lightingNoRelay == 0 && frozen.HeaderKinds.notice == 1);
            ReadbackStats accepted = new ReadbackStats();
            accepted.ClassifyRead(64, new byte[] { 0x81, 0x0B, 0x88, 0x11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 });
            Check(accepted.NonMatchingHeader == 0 && accepted.HeaderKinds.lightingNoRelay == 0);
            classification.HeaderKinds.notice = 65535;
            classification.ClassifyRead(64, new byte[] { 0x8B, 0x10, 0, 1, 0 });
            Check(classification.HeaderKinds.notice == 65535);
            using (JsonDocument counters = JsonDocument.Parse(classification.Json())) {
                Check(counters.RootElement.GetProperty("headerKinds").GetProperty("lightingNoRelay").GetInt32() == 2);
            }
            classification.ReadsWhilePending = 65535; classification.ShortReads = 65535;
            classification.ClassifyRead(12, null);
            Check(classification.ReadsWhilePending == 65535 && classification.ShortReads == 65535 && frozen.ReadsWhilePending == 1);
            BrightnessBaselineTests();
            LifecycleTests();
        }
    }
}
'@
try {
    if (-not ('DshAu05.Native' -as [type])) { Add-Type -TypeDefinition $source -Language CSharp }
    if ($Mode -eq 'SelfTest') {
        [DshAu05.Native]::SelfTest()
        [DshAu05.Native]::Status('ready')
        exit 0
    }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        [DshAu05.Native]::Status('unsupported_platform')
        exit 2
    }
    $physicalReceiverCount = -1
    try {
        $parents = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
            $_.InstanceId -match '^USB\\VID_FFF1&PID_00DD\\'
        })
        $physicalReceiverCount = $parents.Count
    } catch { $physicalReceiverCount = -1 }
    [DshAu05.Native]::TraceInitialization = [bool]$TraceInitialization
    [DshAu05.Native]::Connect($physicalReceiverCount, [bool]$EnableLights)
    exit 0
} catch {
    $code = 'compile_or_runtime_failed'
    if ('DshAu05.Native' -as [type]) { $code = [DshAu05.Native]::ErrorCode($_.Exception) }
    if ('DshAu05.Native' -as [type]) { [DshAu05.Native]::Status($code) }
    else { [Console]::WriteLine('{"type":"status","state":"compile_or_runtime_failed"}') }
    exit 2
}
