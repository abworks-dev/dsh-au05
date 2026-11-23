# ASCII-only, offline SelfTest by default. Invoke is host-only and requires a fresh deadline.
# No text/clipboard reads, arbitrary keys, focus changes, microphone access or shell commands.
[CmdletBinding()]
param(
    [ValidateSet('SelfTest', 'Invoke')][string]$Mode = 'SelfTest',
    [long]$ExpiresAt = 0,
    [string]$ExpectedExe = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

namespace DshWindowsVoice {
    internal sealed class Failure : Exception {
        internal readonly string Code;
        internal Failure(string code) : base("windows_voice_failure") { Code = code; }
    }
    public static class Native {
        const ushort WIN = 0x5B, H = 0x48;
        const uint KEYUP = 2;
        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
        [StructLayout(LayoutKind.Explicit)]
        struct INPUTUNION {
            [FieldOffset(0)] public KEYBDINPUT keyboard;
            [FieldOffset(0)] public MOUSEINPUT mouse;
        }
        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public INPUTUNION data; }
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint length);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool PeekNamedPipe(IntPtr handle, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr remaining);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool ReadFile(IntPtr handle, byte[] bytes, uint count, out uint read, IntPtr overlapped);

        static void Fail(string code) { throw new Failure(code); }
        public static void Result(bool activated, string code) {
            Console.WriteLine("{\"activated\":" + (activated ? "true" : "false") + ",\"error\":" +
                (code == null ? "null" : "\"" + code + "\"") + "}");
            Console.Out.Flush();
        }
        static void Fresh(long expiresAt, Stopwatch clock) {
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= expiresAt || clock.ElapsedMilliseconds >= 5000)
                Fail("windows_voice_expired");
        }
        static void PipeOpen(IntPtr input) {
            uint available;
            if (!PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero))
                Fail("windows_voice_cancelled");
        }
        static string Image(uint pid) {
            IntPtr handle = OpenProcess(0x1000, false, pid);
            if (handle == IntPtr.Zero) Fail("windows_voice_foreground_mismatch");
            try {
                uint size = 32768;
                StringBuilder name = new StringBuilder((int)size);
                if (!QueryFullProcessImageNameW(handle, 0, name, ref size)) Fail("windows_voice_foreground_mismatch");
                return Path.GetFullPath(name.ToString());
            } finally { CloseHandle(handle); }
        }
        static uint Foreground(string expected, IntPtr originalWindow, uint originalPid, out IntPtr window) {
            window = GetForegroundWindow();
            uint pid = 0;
            if (window == IntPtr.Zero || GetWindowThreadProcessId(window, out pid) == 0)
                Fail("windows_voice_foreground_mismatch");
            // No process-name substring matching: compare the complete trusted install path.
            if ((originalWindow != IntPtr.Zero && window != originalWindow) || (originalPid != 0 && pid != originalPid) ||
                !String.Equals(Image(pid), expected, StringComparison.OrdinalIgnoreCase))
                Fail("windows_voice_foreground_mismatch");
            return pid;
        }
        static void Editable(uint pid) {
            try {
                AutomationElement focused = AutomationElement.FocusedElement;
                if (focused == null) Fail("windows_voice_focus_not_editable");
                var info = focused.Current;
                if (info.ProcessId != (int)pid || !info.HasKeyboardFocus || !info.IsEnabled || info.IsOffscreen || info.IsPassword ||
                    (info.ControlType != ControlType.Edit && info.ControlType != ControlType.Document))
                    Fail("windows_voice_focus_not_editable");
                object pattern;
                if (focused.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
                    if (((ValuePattern)pattern).Current.IsReadOnly) Fail("windows_voice_focus_not_editable");
                    return;
                }
                // Query only a read-only metadata attribute, never a text/value property or GetText.
                if (focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                    object readOnly = ((TextPattern)pattern).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
                    if (readOnly is bool && !(bool)readOnly) return;
                }
                Fail("windows_voice_focus_not_editable");
            } catch (Failure) { throw; }
            catch { Fail("windows_voice_focus_not_editable"); }
        }
        static void NoModifiers() {
            int[] keys = { 0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C, 0x48 };
            foreach (int key in keys) if ((GetAsyncKeyState(key) & 0x8000) != 0) Fail("windows_voice_modifiers_down");
        }
        static INPUT Key(ushort key, bool up) {
            return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { vk = key, flags = up ? KEYUP : 0 } } };
        }
        static void Activate() {
            INPUT[] keys = { Key(WIN, false), Key(H, false), Key(H, true), Key(WIN, true) };
            uint sent = SendInput(4, keys, Marshal.SizeOf(typeof(INPUT)));
            if (sent == 4) return;
            // A partial prefix may have pressed OUR keys. Never send release for uninserted keys.
            if (sent == 2) SendInput(1, new INPUT[] { Key(H, true) }, Marshal.SizeOf(typeof(INPUT)));
            if (sent >= 1 && sent <= 3) SendInput(1, new INPUT[] { Key(WIN, true) }, Marshal.SizeOf(typeof(INPUT)));
            Fail("windows_voice_input_failed");
        }
        static void AwaitGo(IntPtr input, long expiresAt, Stopwatch clock) {
            byte[] command = new byte[3];
            int offset = 0;
            while (offset < command.Length) {
                Fresh(expiresAt, clock);
                uint available;
                if (!PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero)) Fail("windows_voice_cancelled");
                if (available > 3 - offset) Fail("windows_voice_invalid_request");
                if (available == 0) { Thread.Sleep(5); continue; }
                byte[] part = new byte[(int)available];
                uint read;
                if (!ReadFile(input, part, available, out read, IntPtr.Zero) || read != available) Fail("windows_voice_cancelled");
                Array.Copy(part, 0, command, offset, (int)read);
                offset += (int)read;
            }
            if (command[0] != 103 || command[1] != 111 || command[2] != 10) Fail("windows_voice_invalid_request");
        }
        public static void Invoke(long expiresAt, string expectedExe) {
            try {
                if (Environment.OSVersion.Platform != PlatformID.Win32NT) Fail("windows_voice_unsupported_platform");
                long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (expiresAt <= now) Fail("windows_voice_expired");
                if (expiresAt > now + 5000 || String.IsNullOrEmpty(expectedExe) || !Path.IsPathFullyQualified(expectedExe))
                    Fail("windows_voice_invalid_request");
                string expected = Path.GetFullPath(expectedExe);
                Stopwatch clock = Stopwatch.StartNew();
                IntPtr input = GetStdHandle(-10);
                PipeOpen(input);
                Fresh(expiresAt, clock);
                IntPtr window;
                uint pid = Foreground(expected, IntPtr.Zero, 0, out window);
                Editable(pid);
                NoModifiers();
                Fresh(expiresAt, clock);
                PipeOpen(input);
                Console.WriteLine("{\"type\":\"ready\"}");
                Console.Out.Flush();
                AwaitGo(input, expiresAt, clock);
                Fresh(expiresAt, clock);
                IntPtr verifiedWindow;
                Foreground(expected, window, pid, out verifiedWindow);
                Editable(pid);
                NoModifiers();
                // UIA can block. Repeat the cheap gates after it, immediately before SendInput.
                Foreground(expected, window, pid, out verifiedWindow);
                PipeOpen(input);
                Fresh(expiresAt, clock);
                NoModifiers();
                Activate();
                Result(true, null);
            } catch (Failure error) { Result(false, error.Code); }
            catch { Result(false, "windows_voice_native_failed"); }
        }
        public static void SelfTest() {
            // Compilation and pure structure checks only: do not call UIA, user32 or open stdin/HID.
            int size = Marshal.SizeOf(typeof(INPUT));
            if (size != (IntPtr.Size == 8 ? 40 : 28)) throw new Exception("input_layout_failed");
            INPUT down = Key(WIN, false), up = Key(WIN, true);
            if (down.type != 1 || down.data.keyboard.vk != 0x5B || up.data.keyboard.flags != 2)
                throw new Exception("fixed_keys_failed");
        }
    }
}
'@
try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or [Environment]::Version.Major -lt 6) {
        [Console]::WriteLine('{"activated":false,"error":"windows_voice_native_failed"}')
        exit 2
    }
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $references = @((Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' -File).FullName)
    $references += @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location)
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies $references
    if ($Mode -eq 'SelfTest') {
        [DshWindowsVoice.Native]::SelfTest()
        [Console]::WriteLine('{"activated":false,"error":null}')
    } else {
        [DshWindowsVoice.Native]::Invoke($ExpiresAt, $ExpectedExe)
    }
    exit 0
} catch {
    [Console]::WriteLine('{"activated":false,"error":"windows_voice_native_failed"}')
    exit 2
}
