# Original Windows-only AU05 input diagnostic. No protocol writes or feature requests.
# list: opens matching VID/PID interfaces with zero desired access for local caps.
# capture: reads one verified vendor collection; aggregate by default, optional fixed NDJSON events.
# Run interactively; Ctrl+C requests cancellation. A total timeout is always enforced.
# No raw reports, stable identifiers, paths, serial numbers, or files are emitted.
[CmdletBinding()]
param(
    [ValidateSet('list', 'capture', 'SelfTest')][string]$Mode = 'list',
    [ValidateRange(1, 120)][int]$Seconds = 15,
    [ValidateRange(1, 10000)][int]$MaxReports = 1000,
    [switch]$StreamEvents
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# .NET Framework FileStream does not reliably cancel an in-flight asynchronous read.
if ($PSVersionTable.PSVersion.Major -lt 7 -or [Environment]::Version.Major -lt 6) {
    throw 'PowerShell 7 with .NET 6 or newer is required for cancellable reads.'
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Windows is required.'
}

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Au05ReadOnly {
    public sealed class Device {
        internal string Path;
        public string Alias { get; internal set; }
        public int UsagePage { get; internal set; }
        public int Usage { get; internal set; }
        public int InputBytes { get; internal set; }
    }

    public sealed class EnumerationResult {
        public Device[] Devices { get; internal set; }
        public int MetadataDenied { get; internal set; }
    }

    public sealed class Summary {
        public string Status { get; internal set; }
        public int Reports { get; internal set; }
        public int ExpectedReportId { get; internal set; }
        public int OtherReportId { get; internal set; }
        public int UnexpectedLength { get; internal set; }
        public long ElapsedMs { get; internal set; }
        public int UnknownReports { get; internal set; }
        public Dictionary<string, int> Events { get; private set; } = new Dictionary<string, int>();
        public bool DecodedEvents { get { return true; } }
    }

    public sealed class Diagnostic {
        public string Reason { get; internal set; }
        public int NativeError { get; internal set; }
    }

    internal sealed class NativeFailure : IOException {
        internal string Code { get; private set; }
        internal int Error { get; private set; }
        internal NativeFailure(string code, int error) : base("hid_native_failure") {
            Code = code;
            Error = error;
        }
    }

    public static class Native {
        // No exception text, device paths, type names or stacks enter diagnostics.
        public static Diagnostic Diagnose(Exception error) {
            for (int depth = 0; error != null && depth < 16; depth++, error = error.InnerException) {
                NativeFailure native = error as NativeFailure;
                if (native != null) {
                    switch (native.Code) {
                        case "attributes_failed": case "identity_changed": case "preparsed_failed":
                        case "caps_failed": case "enumeration_failed": case "interface_enumeration_failed":
                        case "detail_size_failed": case "detail_failed": case "metadata_open_failed":
                        case "read_open_failed": case "caps_changed":
                            return new Diagnostic { Reason = native.Code, NativeError = native.Error };
                    }
                }
                if (error is EntryPointNotFoundException) return new Diagnostic { Reason = "native_entrypoint_missing" };
                if (error is DllNotFoundException) return new Diagnostic { Reason = "native_library_missing" };
                if (error is MarshalDirectiveException) return new Diagnostic { Reason = "native_marshalling_failed" };
                if (error is UnauthorizedAccessException) return new Diagnostic { Reason = "access_denied", NativeError = 5 };
                if (error.InnerException == null) {
                    if (error is ArgumentException) return new Diagnostic { Reason = "argument_or_binding_failed" };
                    if (error is IOException) return new Diagnostic { Reason = "io_exception", NativeError = error.HResult & 0xFFFF };
                    if (error is InvalidCastException) return new Diagnostic { Reason = "type_conversion_failed" };
                    switch (error.GetType().FullName) {
                        case "System.Management.Automation.MethodException":
                        case "System.Management.Automation.MethodInvocationException":
                        case "System.Management.Automation.PSInvalidCastException":
                            return new Diagnostic { Reason = "powershell_binding_failed" };
                        case "System.Management.Automation.PropertyNotFoundException":
                            return new Diagnostic { Reason = "powershell_property_failed" };
                    }
                }
            }
            return new Diagnostic { Reason = "unclassified_exception" };
        }

        const uint GENERIC_READ = 0x80000000;
        const uint FILE_SHARE_READ = 1;
        const uint FILE_SHARE_WRITE = 2;
        const uint OPEN_EXISTING = 3;
        const uint FILE_FLAG_OVERLAPPED = 0x40000000;
        const uint DIGCF_PRESENT = 2;
        const uint DIGCF_DEVICEINTERFACE = 16;
        const int ERROR_NO_MORE_ITEMS = 259;
        const int ERROR_INSUFFICIENT_BUFFER = 122;
        const int HIDP_STATUS_SUCCESS = 0x00110000;

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
            public ushort VendorID;
            public ushort ProductID;
            public ushort VersionNumber;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct Caps {
            public ushort Usage;
            public ushort UsagePage;
            public ushort InputReportByteLength;
            public ushort OutputReportByteLength;
            public ushort FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)]
            public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes;
            public ushort NumberInputButtonCaps;
            public ushort NumberInputValueCaps;
            public ushort NumberInputDataIndices;
            public ushort NumberOutputButtonCaps;
            public ushort NumberOutputValueCaps;
            public ushort NumberOutputDataIndices;
            public ushort NumberFeatureButtonCaps;
            public ushort NumberFeatureValueCaps;
            public ushort NumberFeatureDataIndices;
        }

        [DllImport("hid.dll")]
        static extern void HidD_GetHidGuid(out Guid guid);
        [DllImport("hid.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool HidD_GetAttributes(SafeFileHandle handle, ref Attributes attributes);
        [DllImport("hid.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool HidD_GetPreparsedData(SafeFileHandle handle, out IntPtr data);
        [DllImport("hid.dll")]
        [return: MarshalAs(UnmanagedType.U1)]
        static extern bool HidD_FreePreparsedData(IntPtr data);
        [DllImport("hid.dll")]
        static extern int HidP_GetCaps(IntPtr data, out Caps caps);
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

        public static bool IsTargetPath(string path) {
            return path != null && Regex.IsMatch(path,
                @"(?:^|[#\\])vid_fff1&pid_00dd(?=[&#\\])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }

        public static bool IsTargetCaps(int vid, int pid, int page, int usage, int inputBytes) {
            return vid == 0xFFF1 && pid == 0x00DD && page == 0xFFFC && usage == 1 && inputBytes == 64;
        }

        static uint ReadLe32(byte[] bytes, int offset) {
            return (uint)(bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24);
        }
        static void StoreLe32(byte[] bytes, int offset, uint word) {
            for (int i = 0; i < 4; i++) bytes[offset + i] = (byte)(word >> (i * 8));
        }
        static void DecryptBlock(byte[] input, int inputOffset, byte[] output, int outputOffset, uint[] key) {
            uint left = ReadLe32(input, inputOffset), right = ReadLe32(input, inputOffset + 4);
            unchecked {
                uint sum = 0xC6EF3720;
                for (int round = 0; round < 32; round++) {
                    right -= ((left << 4) + key[2]) ^ (left + sum) ^ ((left >> 5) + key[3]);
                    left -= ((right << 4) + key[0]) ^ (right + sum) ^ ((right >> 5) + key[1]);
                    sum -= 0x9E3779B9;
                }
            }
            StoreLe32(output, outputOffset, left);
            StoreLe32(output, outputOffset + 4, right);
        }

        // This event layout is NOT the generic route/subsystem/command/direction layout.
        // Fixed reference: complete plaintext[0]=0B/8B, [1]=10, [3]=phase, [4]=control.
        public static string ClassifyPlaintext(byte[] plain) {
            if (plain == null || plain.Length < 5 || (plain[0] != 0x0B && plain[0] != 0x8B)
                || plain[1] != 0x10 || plain[3] > 1 || plain[4] > 5) return null;
            int control = plain[4];
            if (control == 4) return "rotate_right_pulse";
            if (control == 5) return "rotate_left_pulse";
            string name = control == 3 ? "knob_press" : "button_" + control;
            return name + (plain[3] == 1 ? "_down" : "_up");
        }

        public static string DecodeInput(byte[] report) {
            if (report == null || report.Length != 64 || report[0] != 0x55) return null;
            byte[] plain = new byte[56];
            uint[] key = { 0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA };
            try {
                // Only seven complete TEA blocks: report bytes 57..63 are never decoded.
                for (int offset = 0; offset < 56; offset += 8) DecryptBlock(report, offset + 1, plain, offset, key);
                return ClassifyPlaintext(plain);
            } finally { Array.Clear(plain, 0, plain.Length); }
        }

        // Keep the aggregate vocabulary unchanged. Stream output has a separate, closed whitelist.
        public static string NormalizeInputEvent(string inputEvent) {
            switch (inputEvent) {
                case "button_0_down": return "k1.down";
                case "button_0_up": return "k1.up";
                case "button_1_down": return "k2.down";
                case "button_1_up": return "k2.up";
                case "button_2_down": return "k3.down";
                case "button_2_up": return "k3.up";
                case "knob_press_down": return "knob.down";
                case "knob_press_up": return "knob.up";
                case "rotate_right_pulse": return "right.pulse";
                case "rotate_left_pulse": return "left.pulse";
                default: return null;
            }
        }

        static void EmitInput(string inputEvent) {
            string normalized = NormalizeInputEvent(inputEvent);
            if (normalized == null) return;
            // Only compile-time whitelist strings enter JSON; never report bytes or device metadata.
            Console.WriteLine("{\"type\":\"input\",\"event\":\"" + normalized + "\"}");
            Console.Out.Flush();
        }

        public static void SelfTest() {
            byte[] knownCipher = { 0x0A, 0x3A, 0xEA, 0x41, 0x40, 0xA9, 0xBA, 0x94 };
            byte[] plain = new byte[8];
            DecryptBlock(knownCipher, 0, plain, 0, new uint[4]);
            for (int i = 0; i < plain.Length; i++) if (plain[i] != 0) throw new Exception("tea_kat_failed");
            // Independently generated JS synthetic vector, NOT a hardware capture.
            // Protocol key: 8B10000100000000 -> DCEEA96C898F6E8F.
            byte[] syntheticReport = new byte[64];
            byte[] firstBlock = { 0xDC, 0xEE, 0xA9, 0x6C, 0x89, 0x8F, 0x6E, 0x8F };
            syntheticReport[0] = 0x55;
            Array.Copy(firstBlock, 0, syntheticReport, 1, firstBlock.Length);
            if (DecodeInput(syntheticReport) != "button_0_down") throw new Exception("protocol_key_vector_failed");
            if (ClassifyPlaintext(new byte[] { 0x8B, 0x10, 0, 1, 0 }) != "button_0_down"
                || ClassifyPlaintext(new byte[] { 0x0B, 0x10, 0, 0, 3 }) != "knob_press_up"
                || ClassifyPlaintext(new byte[] { 0x8B, 0x10, 0, 1, 4 }) != "rotate_right_pulse"
                || ClassifyPlaintext(new byte[] { 0x8B, 0x10, 0, 0, 5 }) != "rotate_left_pulse"
                || ClassifyPlaintext(new byte[] { 0x8B, 0x10, 0, 2, 0 }) != null
                || ClassifyPlaintext(new byte[] { 0x8B, 0x10, 0, 1, 6 }) != null
                || ClassifyPlaintext(new byte[] { 0xAB, 0x10, 0, 1, 0 }) != null
                || DecodeInput(new byte[63]) != null || DecodeInput(new byte[64]) != null)
                throw new Exception("input_validation_failed");
            if (!IsTargetCaps(0xFFF1, 0x00DD, 0xFFFC, 1, 64)
                || IsTargetCaps(0xFFF1, 0x00DD, 1, 1, 64)
                || IsTargetCaps(0xFFF1, 0x00DD, 0xFFFC, 2, 64)
                || IsTargetCaps(0xFFF1, 0x00DD, 0xFFFC, 1, 65)
                || IsTargetCaps(0xFFF0, 0x00DD, 0xFFFC, 1, 64)
                || IsTargetCaps(0xFFF1, 0x00DE, 0xFFFC, 1, 64)
                || !IsTargetPath(@"\\?\hid#vid_fff1&pid_00dd&mi_03#test")
                || IsTargetPath(@"\\?\hid#vid_fff1&pid_00ddd&mi_03#test")
                || IsTargetPath(@"\\?\hid#vid_ffff&pid_00dd&mi_03#test"))
                throw new Exception("target_filter_failed");
            if (Marshal.SizeOf(typeof(Caps)) != 64 || Marshal.SizeOf(typeof(Attributes)) != 12
                || Marshal.SizeOf(typeof(InterfaceData)) != (IntPtr.Size == 8 ? 32 : 28))
                throw new Exception("native_layout_failed");
            string[] aggregateNames = { "button_0_down", "button_0_up", "button_1_down", "button_1_up",
                "button_2_down", "button_2_up", "knob_press_down", "knob_press_up", "rotate_right_pulse", "rotate_left_pulse" };
            string[] streamNames = { "k1.down", "k1.up", "k2.down", "k2.up", "k3.down", "k3.up",
                "knob.down", "knob.up", "right.pulse", "left.pulse" };
            for (int i = 0; i < aggregateNames.Length; i++)
                if (NormalizeInputEvent(aggregateNames[i]) != streamNames[i]) throw new Exception("stream_whitelist_failed");
            if (NormalizeInputEvent(null) != null || NormalizeInputEvent("private_path_marker") != null)
                throw new Exception("stream_privacy_failed");
            Diagnostic expectedFailure = Diagnose(new NativeFailure("metadata_open_failed", 32));
            if (expectedFailure.Reason != "metadata_open_failed" || expectedFailure.NativeError != 32
                || Diagnose(new IOException("private_path_marker")).Reason != "io_exception"
                || Diagnose(new EntryPointNotFoundException("private_path_marker")).Reason != "native_entrypoint_missing"
                || Diagnose(new Exception("private_path_marker")).Reason != "unclassified_exception")
                throw new Exception("diagnostic_privacy_failed");
        }

        static Device Inspect(SafeFileHandle handle, string path) {
            Attributes attributes = new Attributes();
            attributes.Size = (uint)Marshal.SizeOf(typeof(Attributes));
            if (!HidD_GetAttributes(handle, ref attributes)) throw new NativeFailure("attributes_failed", Marshal.GetLastWin32Error());
            if (attributes.VendorID != 0xFFF1 || attributes.ProductID != 0x00DD)
                throw new NativeFailure("identity_changed", 0);
            IntPtr data;
            if (!HidD_GetPreparsedData(handle, out data)) throw new NativeFailure("preparsed_failed", Marshal.GetLastWin32Error());
            try {
                Caps caps;
                int capsStatus = HidP_GetCaps(data, out caps);
                if (capsStatus != HIDP_STATUS_SUCCESS) throw new NativeFailure("caps_failed", capsStatus);
                if (!IsTargetCaps(attributes.VendorID, attributes.ProductID,
                    caps.UsagePage, caps.Usage, caps.InputReportByteLength)) return null;
                return new Device { Path = path, UsagePage = caps.UsagePage,
                    Usage = caps.Usage, InputBytes = caps.InputReportByteLength };
            } finally { HidD_FreePreparsedData(data); }
        }

        public static EnumerationResult List() {
            int metadataDenied = 0;
            Guid guid;
            HidD_GetHidGuid(out guid);
            IntPtr set = SetupDiGetClassDevsW(ref guid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if (set == new IntPtr(-1)) throw new NativeFailure("enumeration_failed", Marshal.GetLastWin32Error());
            List<Device> result = new List<Device>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try {
                for (uint index = 0; ; index++) {
                    InterfaceData item = new InterfaceData();
                    item.cbSize = (uint)Marshal.SizeOf(typeof(InterfaceData));
                    if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref guid, index, ref item)) {
                        int enumError = Marshal.GetLastWin32Error();
                        if (enumError == ERROR_NO_MORE_ITEMS) break;
                        throw new NativeFailure("interface_enumeration_failed", enumError);
                    }
                    uint required;
                    bool sized = SetupDiGetDeviceInterfaceDetailW(set, ref item, IntPtr.Zero, 0, out required, IntPtr.Zero);
                    int sizeError = Marshal.GetLastWin32Error();
                    if (sized || sizeError != ERROR_INSUFFICIENT_BUFFER || required < 8 || required > 65536)
                        throw new NativeFailure("detail_size_failed", sizeError);
                    IntPtr detail = Marshal.AllocHGlobal((int)required);
                    string path;
                    try {
                        // Unicode structure header: 8 bytes on x64, 6 on x86; path starts at offset 4 on both.
                        Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                        if (!SetupDiGetDeviceInterfaceDetailW(set, ref item, detail, required, out required, IntPtr.Zero))
                            throw new NativeFailure("detail_failed", Marshal.GetLastWin32Error());
                        path = Marshal.PtrToStringUni(IntPtr.Add(detail, 4));
                    } finally { Marshal.FreeHGlobal(detail); }
                    if (!IsTargetPath(path) || !seen.Add(path)) continue;
                    // Metadata only; this handle cannot read input reports or write output reports.
                    using (SafeFileHandle handle = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE,
                        IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero)) {
                        if (handle.IsInvalid) {
                            int metadataError = Marshal.GetLastWin32Error();
                            // Protected standard-input collections can deny even metadata access.
                            // Count access denial only; never read that collection or guess its usage.
                            if (metadataError == 5) { metadataDenied++; continue; }
                            throw new NativeFailure("metadata_open_failed", metadataError);
                        }
                        Device device = Inspect(handle, path);
                        if (device != null) {
                            device.Alias = "au05-" + (result.Count + 1);
                            result.Add(device);
                        }
                    }
                }
            } finally { SetupDiDestroyDeviceInfoList(set); }
            return new EnumerationResult { Devices = result.ToArray(), MetadataDenied = metadataDenied };
        }

        // Returns counters, optionally emitting normalized events only; no report contents escape.
        public static Summary Capture(Device[] devices, int physicalReceiverCount, int seconds, int maxReports, bool streamEvents = false) {
            if (physicalReceiverCount != 1) throw new ArgumentException("exactly_one_receiver_required");
            if (seconds < 1 || seconds > 120 || maxReports < 1 || maxReports > 10000)
                throw new ArgumentOutOfRangeException("capture_limits");
            if (devices == null || devices.Length != 1) throw new IOException("exactly_one_device_required");
            Device device = devices[0];
            if (!IsTargetPath(device.Path)) throw new IOException("path_rejected");
            Summary summary = new Summary { Status = "timeout" };
            Stopwatch clock = Stopwatch.StartNew();
            using (CancellationTokenSource cancel = new CancellationTokenSource()) {
                ConsoleCancelEventHandler onCancel = delegate(object sender, ConsoleCancelEventArgs args) {
                    args.Cancel = true;
                    // A console signal already in dispatch can race handler removal/disposal.
                    try { cancel.Cancel(); } catch (ObjectDisposedException) { }
                };
                Console.CancelKeyPress += onCancel;
                try {
                    cancel.CancelAfter(TimeSpan.FromSeconds(seconds));
                    // The only report-capable handle is read-only; no write access is requested.
                    SafeFileHandle handle = CreateFileW(device.Path, GENERIC_READ,
                        FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, IntPtr.Zero);
                    if (handle.IsInvalid) {
                        int openError = Marshal.GetLastWin32Error();
                        handle.Dispose();
                        throw new NativeFailure("read_open_failed", openError);
                    }
                    FileStream stream = null;
                    byte[] buffer = new byte[64];
                    try {
                        if (Inspect(handle, device.Path) == null) throw new NativeFailure("caps_changed", 0);
                        // On successful construction FileStream owns the handle. No second wrapper owns it.
                        stream = new FileStream(handle, FileAccess.Read, 64, true);
                        cancel.Token.ThrowIfCancellationRequested();
                        // Never announce readiness before revalidated caps and a usable read-only stream.
                        if (streamEvents) {
                            Console.WriteLine("{\"type\":\"status\",\"event\":\"ready\"}");
                            Console.Out.Flush();
                        }
                        while (summary.Reports < maxReports) {
                            cancel.Token.ThrowIfCancellationRequested();
                            // Await cancellation completion before disposing the stream/handle or clearing the buffer.
                            // Windows FileStream cancels overlapped I/O internally; no manual buffer lifetime race.
                            int length = stream.ReadAsync(buffer, 0, buffer.Length, cancel.Token).GetAwaiter().GetResult();
                            if (length == 0) { summary.Status = "disconnected"; break; }
                            summary.Reports++;
                            if (length != 64) { summary.UnexpectedLength++; summary.UnknownReports++; }
                            else if (buffer[0] == 0x55) {
                                summary.ExpectedReportId++;
                                string inputEvent = DecodeInput(buffer);
                                if (inputEvent == null) summary.UnknownReports++;
                                else {
                                    int count;
                                    summary.Events.TryGetValue(inputEvent, out count);
                                    summary.Events[inputEvent] = count + 1;
                                    if (streamEvents) EmitInput(inputEvent);
                                }
                            } else { summary.OtherReportId++; summary.UnknownReports++; }
                            // Counts are reports, not deduplicated physical actions or inferred long presses.
                            Array.Clear(buffer, 0, buffer.Length);
                        }
                        if (summary.Reports == maxReports) summary.Status = "report_limit";
                    } catch (OperationCanceledException) {
                        summary.Status = clock.ElapsedMilliseconds >= seconds * 1000L ? "timeout" : "cancelled";
                    } catch (IOException) {
                        summary.Status = "io_error";
                    } finally {
                        if (stream != null) stream.Dispose(); else handle.Dispose();
                        Array.Clear(buffer, 0, buffer.Length);
                    }
                } finally { Console.CancelKeyPress -= onCancel; }
            }
            clock.Stop();
            summary.ElapsedMs = clock.ElapsedMilliseconds;
            return summary;
        }
    }
}
'@

try {
    if (-not ('Au05ReadOnly.Native' -as [type])) { Add-Type -TypeDefinition $source -Language CSharp }
    if ($Mode -eq 'SelfTest') {
        [Au05ReadOnly.Native]::SelfTest()
        [ordered]@{ status = 'self_test_passed'; deviceAccess = $false; writes = 0 } | ConvertTo-Json -Compress
        exit 0
    }
    $enumeration = [Au05ReadOnly.Native]::List()
    $devices = @($enumeration.Devices)
    $metadataDenied = $enumeration.MetadataDenied
    # Only physical USB parent devnodes, never &MI_XX interfaces. No identifiers are emitted.
    # Failure to obtain an authoritative count is a capture refusal, not an assumed singleton.
    $physicalReceiverCount = -1
    try {
        $physicalReceivers = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
            $_.InstanceId -match '^USB\\VID_FFF1&PID_00DD\\'
        })
        $physicalReceiverCount = $physicalReceivers.Count
    } catch { $physicalReceiverCount = -1 }
    if ($devices.Count -eq 0) {
        [ordered]@{ status = 'no_device'; mode = $Mode; deviceCount = 0; metadataDenied = $metadataDenied;
            physicalReceiverCount = $physicalReceiverCount; writes = 0 } | ConvertTo-Json -Compress
        exit 0
    }
    if ($Mode -eq 'list') {
        $safeDevices = @($devices | ForEach-Object {
            [ordered]@{ alias = $_.Alias; vid = 'FFF1'; pid = '00DD'; usagePage = 'FFFC'; usage = 1; inputBytes = $_.InputBytes }
        })
        [ordered]@{ status = 'listed'; mode = 'list'; deviceCount = $devices.Count;
            metadataDenied = $metadataDenied; physicalReceiverCount = $physicalReceiverCount;
            devices = $safeDevices; writes = 0 } | ConvertTo-Json -Depth 4 -Compress
        exit 0
    }
    if ($devices.Count -ne 1) {
        [ordered]@{ status = 'ambiguous_device'; mode = 'capture'; deviceCount = $devices.Count; writes = 0 } | ConvertTo-Json -Compress
        exit 2
    }
    if ($physicalReceiverCount -ne 1) {
        [ordered]@{ status = 'physical_receiver_unverified'; mode = 'capture'; deviceCount = $devices.Count;
            physicalReceiverCount = $physicalReceiverCount; metadataDenied = $metadataDenied; writes = 0 } | ConvertTo-Json -Compress
        exit 2
    }
    $summary = [Au05ReadOnly.Native]::Capture($devices, $physicalReceiverCount, $Seconds, $MaxReports, [bool]$StreamEvents)
    [ordered]@{ status = $summary.Status; mode = 'capture'; reports = $summary.Reports;
        physicalReceiverCount = $physicalReceiverCount; metadataDenied = $metadataDenied;
        expectedReportId = $summary.ExpectedReportId; otherReportId = $summary.OtherReportId;
        unexpectedLength = $summary.UnexpectedLength; elapsedMs = $summary.ElapsedMs;
        decodedEvents = $summary.DecodedEvents; unknownReports = $summary.UnknownReports;
        eventReportCounts = $summary.Events; physicalActionCountsVerified = $false; writes = 0 } | ConvertTo-Json -Depth 4 -Compress
    if ($summary.Status -eq 'io_error') { exit 1 }
    exit 0
} catch {
    # Only fixed reason codes and numeric native errors; never exception text or type names.
    $reason = 'compile_or_runtime_failed'
    $nativeError = 0
    if ('Au05ReadOnly.Native' -as [type]) {
        $diagnostic = [Au05ReadOnly.Native]::Diagnose($_.Exception)
        $reason = $diagnostic.Reason
        $nativeError = $diagnostic.NativeError
    }
    [ordered]@{ status = 'hid_operation_failed'; mode = $Mode; reason = $reason;
        nativeError = $nativeError; writes = 0 } | ConvertTo-Json -Compress
    exit 1
}
