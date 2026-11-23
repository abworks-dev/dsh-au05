# ASCII-only. Default SelfTest compiles and exercises pure layouts/chords, never UIA/stdin/user32.
# Invoke is host-only: one complete tap, no holds, retries, stop macro, text/clipboard or focus changes.
# Typeless official /help/quickstart/dictate: Windows Right Alt once starts; tap again finishes.
[CmdletBinding()]
param(
    [ValidateSet('SelfTest', 'Invoke')][string]$Mode = 'SelfTest',
    [long]$ExpiresAt = 0,
    [string]$ExpectedExe = '',
    [string]$Shortcut = '',
    [switch]$BageshuoCrossAppEnabled
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

namespace DshShortcutVoice {
    internal sealed class Failure : Exception {
        internal readonly string Code;
        internal Failure(string code) : base("shortcut_voice_failure") { Code = code; }
    }
    public static class Native {
        const ushort CTRL = 0x11, ALT = 0x12, SHIFT = 0x10, RIGHTALT = 0xA5;
        const uint EXTENDED = 1, KEYUP = 2;
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
        // The CLI receives canonical text only. Revalidate independently; no key/byte payload API.
        static ushort[] ParseShortcut(string shortcut) {
            if (shortcut == "RightAlt") return new ushort[] { RIGHTALT };
            if (String.IsNullOrEmpty(shortcut) || shortcut.Length > 64) Fail("shortcut_voice_invalid_shortcut");
            string[] parts = shortcut.Split('+');
            if (parts.Length > 4) Fail("shortcut_voice_invalid_shortcut");
            List<ushort> keys = new List<ushort>();
            int previous = 0;
            bool ctrl = false, alt = false;
            for (int i = 0; i < parts.Length - 1; i++) {
                int rank = parts[i] == "Ctrl" ? 1 : parts[i] == "Alt" ? 2 : parts[i] == "Shift" ? 3 : 0;
                if (rank <= previous) Fail("shortcut_voice_invalid_shortcut");
                previous = rank;
                if (rank == 1) { ctrl = true; keys.Add(CTRL); }
                else if (rank == 2) { alt = true; keys.Add(ALT); }
                else keys.Add(SHIFT);
            }
            string key = parts[parts.Length - 1];
            ushort vk = 0;
            int number = 0;
            bool functionKey = key.Length >= 2 && key[0] == 'F' && Int32.TryParse(key.Substring(1), out number) &&
                number >= 1 && number <= 24 && key == "F" + number.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (functionKey) vk = (ushort)(0x70 + number - 1);
            else if (key.Length == 1 && ((key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= '0' && key[0] <= '9'))) vk = key[0];
            else if (key == "Space") vk = 0x20;
            else Fail("shortcut_voice_invalid_shortcut");
            if (!functionKey && keys.Count == 0) Fail("shortcut_voice_invalid_shortcut");
            if (key == "F4" && (ctrl || alt)) Fail("shortcut_voice_invalid_shortcut");
            // Always block browser/edit/file Ctrl actions, including with Shift and/or Alt.
            if (ctrl && key.Length == 1 && "WQRLTNOPSCVXAZY".IndexOf(key[0]) >= 0) Fail("shortcut_voice_invalid_shortcut");
            keys.Add(vk);
            return keys.ToArray();
        }
        static INPUT Key(ushort key, bool up) {
            uint flags = (key == RIGHTALT ? EXTENDED : 0) | (up ? KEYUP : 0);
            return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { vk = key, flags = flags } } };
        }
        static INPUT[] Tap(ushort[] chord) {
            INPUT[] tap = new INPUT[chord.Length * 2];
            for (int i = 0; i < chord.Length; i++) {
                tap[i] = Key(chord[i], false);
                tap[tap.Length - 1 - i] = Key(chord[i], true);
            }
            return tap;
        }
        static INPUT[] Recovery(ushort[] chord, uint inserted) {
            // SendInput inserts a prefix: count our downs minus our already-inserted reverse ups.
            if (inserted > chord.Length * 2) return new INPUT[0];
            int downs = Math.Min((int)inserted, chord.Length);
            int ups = Math.Max(0, (int)inserted - chord.Length);
            int held = downs - ups;
            INPUT[] releases = new INPUT[held];
            for (int i = 0; i < held; i++) releases[i] = Key(chord[held - 1 - i], true);
            return releases;
        }
        static void Activate(ushort[] chord) {
            INPUT[] tap = Tap(chord);
            int size = Marshal.SizeOf(typeof(INPUT));
            uint inserted = SendInput((uint)tap.Length, tap, size);
            if (inserted == tap.Length) return;
            INPUT[] releases = Recovery(chord, inserted);
            if (releases.Length > 0) SendInput((uint)releases.Length, releases, size);
            Fail("shortcut_voice_input_failed");
        }
        static void Fresh(long expiresAt, Stopwatch clock) {
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= expiresAt || clock.ElapsedMilliseconds >= 5000)
                Fail("shortcut_voice_expired");
        }
        static void PipeOpen(IntPtr input) {
            uint available;
            if (!PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero))
                Fail("shortcut_voice_cancelled");
        }
        static string Image(uint pid) {
            IntPtr handle = OpenProcess(0x1000, false, pid);
            if (handle == IntPtr.Zero) Fail("shortcut_voice_foreground_mismatch");
            try {
                uint size = 32768;
                StringBuilder name = new StringBuilder((int)size);
                if (!QueryFullProcessImageNameW(handle, 0, name, ref size)) Fail("shortcut_voice_foreground_mismatch");
                return Path.GetFullPath(name.ToString());
            } finally { CloseHandle(handle); }
        }
        static uint Foreground(string expected, IntPtr originalWindow, uint originalPid, out IntPtr window, bool bageshuoCrossAppEnabled = false) {
            window = GetForegroundWindow();
            uint pid = 0;
            if (window == IntPtr.Zero || GetWindowThreadProcessId(window, out pid) == 0)
                Fail("shortcut_voice_foreground_mismatch");
            if ((originalWindow != IntPtr.Zero && window != originalWindow) || (originalPid != 0 && pid != originalPid) ||
                (!bageshuoCrossAppEnabled && !String.Equals(Image(pid), expected, StringComparison.OrdinalIgnoreCase)))
                Fail("shortcut_voice_foreground_mismatch");
            return pid;
        }
        static AutomationElement Editable(uint pid, IntPtr window, AutomationElement originalFocus) {
            try {
                AutomationElement focused = AutomationElement.FocusedElement;
                if (focused == null || (originalFocus != null && !Automation.Compare(focused, originalFocus)))
                    Fail("shortcut_voice_focus_not_editable");
                var info = focused.Current;
                if (info.ProcessId != (int)pid || !info.HasKeyboardFocus || !info.IsEnabled || info.IsOffscreen || info.IsPassword ||
                    (info.ControlType != ControlType.Edit && info.ControlType != ControlType.Document))
                    Fail("shortcut_voice_focus_not_editable");
                // Prove ownership by this exact foreground HWND, not another same-process window.
                bool belongs = false;
                AutomationElement ancestor = focused;
                for (int depth = 0; ancestor != null && depth < 64; depth++) {
                    if (new IntPtr(ancestor.Current.NativeWindowHandle) == window) { belongs = true; break; }
                    ancestor = TreeWalker.RawViewWalker.GetParent(ancestor);
                }
                if (!belongs) Fail("shortcut_voice_focus_not_editable");
                object pattern;
                if (focused.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
                    if (((ValuePattern)pattern).Current.IsReadOnly) Fail("shortcut_voice_focus_not_editable");
                    return focused;
                }
                // Metadata only: never read Value, text ranges' text, names or clipboard contents.
                if (focused.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                    object readOnly = ((TextPattern)pattern).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
                    if (readOnly is bool && !(bool)readOnly) return focused;
                }
                Fail("shortcut_voice_focus_not_editable");
                return null;
            } catch (Failure) { throw; }
            catch { Fail("shortcut_voice_focus_not_editable"); return null; }
        }
        static void NoHeldKeys(ushort[] chord) {
            int[] modifiers = { 0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C };
            foreach (int key in modifiers) if ((GetAsyncKeyState(key) & 0x8000) != 0) Fail("shortcut_voice_modifiers_down");
            foreach (ushort key in chord) if ((GetAsyncKeyState(key) & 0x8000) != 0) Fail("shortcut_voice_modifiers_down");
        }
        static void AwaitGo(IntPtr input, long expiresAt, Stopwatch clock) {
            byte[] command = new byte[3];
            int offset = 0;
            while (offset < command.Length) {
                Fresh(expiresAt, clock);
                uint available;
                if (!PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero)) Fail("shortcut_voice_cancelled");
                if (available > 3 - offset) Fail("shortcut_voice_invalid_request");
                if (available == 0) { Thread.Sleep(5); continue; }
                byte[] part = new byte[(int)available];
                uint read;
                if (!ReadFile(input, part, available, out read, IntPtr.Zero) || read != available) Fail("shortcut_voice_cancelled");
                Array.Copy(part, 0, command, offset, (int)read);
                offset += (int)read;
            }
            if (command[0] != 103 || command[1] != 111 || command[2] != 10) Fail("shortcut_voice_invalid_request");
        }
        public static void Invoke(long expiresAt, string expectedExe, string shortcut, bool bageshuoCrossAppEnabled = false) {
            try {
                if (Environment.OSVersion.Platform != PlatformID.Win32NT) Fail("shortcut_voice_unsupported_platform");
                if (bageshuoCrossAppEnabled && shortcut != "RightAlt") Fail("shortcut_voice_invalid_shortcut");
                ushort[] chord = ParseShortcut(shortcut);
                long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (expiresAt <= now) Fail("shortcut_voice_expired");
                if (expiresAt > now + 5000 || String.IsNullOrEmpty(expectedExe) || !Path.IsPathFullyQualified(expectedExe) ||
                    expectedExe.Length < 3 || expectedExe[1] != ':' || expectedExe[2] != '\\')
                    Fail("shortcut_voice_invalid_request");
                string expected = Path.GetFullPath(expectedExe);
                Stopwatch clock = Stopwatch.StartNew();
                IntPtr input = GetStdHandle(-10);
                PipeOpen(input);
                Fresh(expiresAt, clock);
                IntPtr window;
                uint pid = Foreground(expected, IntPtr.Zero, 0, out window, bageshuoCrossAppEnabled);
                // External opt-in changes only the allowed executable; pin its resolved image too.
                if (bageshuoCrossAppEnabled) expected = Image(pid);
                AutomationElement focus = Editable(pid, window, null);
                NoHeldKeys(chord);
                Fresh(expiresAt, clock);
                PipeOpen(input);
                Console.WriteLine("{\"type\":\"ready\"}");
                Console.Out.Flush();
                AwaitGo(input, expiresAt, clock);
                Fresh(expiresAt, clock);
                IntPtr verifiedWindow;
                Foreground(expected, window, pid, out verifiedWindow);
                Editable(pid, window, focus);
                NoHeldKeys(chord);
                // UIA can block. Repeat cheap ownership/deadline/physical-key gates immediately before input.
                Foreground(expected, window, pid, out verifiedWindow);
                PipeOpen(input);
                Fresh(expiresAt, clock);
                NoHeldKeys(chord);
                Activate(chord);
                Result(true, null);
            } catch (Failure error) { Result(false, error.Code); }
            catch { Result(false, "shortcut_voice_native_failed"); }
        }
        static void Check(bool condition, string error) { if (!condition) throw new Exception(error); }
        static void Reject(string shortcut) {
            try { ParseShortcut(shortcut); }
            catch (Failure error) { Check(error.Code == "shortcut_voice_invalid_shortcut", "wrong_parse_error"); return; }
            throw new Exception("unsafe_shortcut_accepted");
        }
        static void CheckTap(string shortcut) {
            ushort[] chord = ParseShortcut(shortcut);
            INPUT[] tap = Tap(chord);
            Check(tap.Length == chord.Length * 2, "tap_length_failed");
            for (int i = 0; i < chord.Length; i++) {
                Check(tap[i].type == 1 && tap[i].data.keyboard.vk == chord[i] && (tap[i].data.keyboard.flags & KEYUP) == 0, "down_order_failed");
                Check(tap[tap.Length - 1 - i].data.keyboard.vk == chord[i] && (tap[tap.Length - 1 - i].data.keyboard.flags & KEYUP) != 0, "up_order_failed");
            }
            // Model every possible inserted prefix. Recovery must release exactly our outstanding downs.
            for (uint inserted = 0; inserted <= tap.Length; inserted++) {
                List<ushort> held = new List<ushort>();
                for (int i = 0; i < inserted; i++) {
                    if ((tap[i].data.keyboard.flags & KEYUP) == 0) held.Add(tap[i].data.keyboard.vk);
                    else { Check(held[held.Count - 1] == tap[i].data.keyboard.vk, "model_order_failed"); held.RemoveAt(held.Count - 1); }
                }
                INPUT[] releases = Recovery(chord, inserted);
                Check(releases.Length == held.Count, "recovery_count_failed");
                foreach (INPUT release in releases) {
                    Check(held.Count > 0 && held[held.Count - 1] == release.data.keyboard.vk && (release.data.keyboard.flags & KEYUP) != 0, "recovery_ownership_failed");
                    held.RemoveAt(held.Count - 1);
                }
                Check(held.Count == 0, "recovery_incomplete");
            }
        }
        public static void SelfTest() {
            // Compilation and pure synthetic structure/parsing/order checks only. No UIA, stdin or OS calls.
            Check(Marshal.SizeOf(typeof(INPUT)) == (IntPtr.Size == 8 ? 40 : 28), "input_layout_failed");
            Check(Marshal.OffsetOf(typeof(INPUT), "data").ToInt32() == (IntPtr.Size == 8 ? 8 : 4), "union_alignment_failed");
            INPUT[] rightAlt = Tap(ParseShortcut("RightAlt"));
            Check(rightAlt[0].data.keyboard.vk == 0xA5 && rightAlt[0].data.keyboard.flags == EXTENDED &&
                rightAlt[1].data.keyboard.flags == (EXTENDED | KEYUP), "right_alt_extended_failed");
            string[] accepted = { "RightAlt", "F1", "F24", "Shift+F4", "Ctrl+B", "Alt+1", "Shift+Space", "Ctrl+Alt+Shift+F24" };
            foreach (string shortcut in accepted) CheckTap(shortcut);
            string[] rejected = { null, "", "rightalt", " RightAlt", "Ctrl+RightAlt", "Win+H", "Fn", "Ctrl", "Alt", "Shift", "A", "0", "Space",
                "Ctrl+Ctrl+F8", "Alt+Ctrl+F8", "Ctrl+Shift+Alt+F8", "ctrl+F8", "Ctrl +F8", "F0", "F25", "F01", "Ctrl+Enter", "Alt+Tab", "Delete", "Esc", "Ctrl+F4", "Alt+F4",
                "Ctrl+Shift+F4", "Alt+Shift+F4", "Ctrl+W", "Ctrl+Shift+V", "Ctrl+Alt+Shift+A", "Ctrl+F8;whoami", "Ctrl+F8\n", "Ctrl++F8" };
            foreach (string shortcut in rejected) Reject(shortcut);
            foreach (char key in "WQRLTNOPSCVXAZY") {
                Reject("Ctrl+" + key); Reject("Ctrl+Shift+" + key); Reject("Ctrl+Alt+" + key); Reject("Ctrl+Alt+Shift+" + key);
            }
            for (int key = 1; key <= 24; key++) CheckTap("F" + key.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
    }
}
'@
try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or [Environment]::Version.Major -lt 6) {
        [Console]::WriteLine('{"activated":false,"error":"shortcut_voice_native_failed"}')
        exit 2
    }
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $references = @((Get-ChildItem -LiteralPath (Join-Path $PSHOME 'ref') -Filter '*.dll' -File).FullName)
    $references += @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location)
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies $references
    if ($Mode -eq 'SelfTest') {
        [DshShortcutVoice.Native]::SelfTest()
        [Console]::WriteLine('{"activated":false,"error":null}')
    } else {
        [DshShortcutVoice.Native]::Invoke($ExpiresAt, $ExpectedExe, $Shortcut, [bool]$BageshuoCrossAppEnabled)
    }
    exit 0
} catch {
    [Console]::WriteLine('{"activated":false,"error":"shortcut_voice_native_failed"}')
    exit 2
}
