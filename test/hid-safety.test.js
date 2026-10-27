import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptUrl = new URL('../scripts/windows-hid-readonly.ps1', import.meta.url);
const script = readFileSync(scriptUrl, 'utf8');
const source = script.match(/\$source = @'\r?\n([\s\S]*?)\r?\n'@/u)?.[1];
assert.ok(source, 'embedded original C# must be available to static audit');

test('HID diagnostic is ASCII and exposes no arbitrary payload/path/output arguments', () => {
  assert.match(script, /^[\x00-\x7f]*$/u);
  const parameters = script.slice(script.indexOf('param('), script.indexOf('Set-StrictMode'));
  assert.match(parameters, /ValidateSet\('list', 'capture', 'SelfTest'\)/u);
  assert.match(parameters, /ValidateRange\(1, 120\)/u);
  assert.match(parameters, /ValidateRange\(1, 10000\)/u);
  assert.deepEqual([...parameters.matchAll(/\$(\w+)/gu)].map(match => match[1]), ['Mode', 'Seconds', 'MaxReports']);
  assert.match(script, /PSVersionTable\.PSVersion\.Major -lt 7/u);
  assert.match(script, /Environment\]::Version\.Major -lt 6/u);
});

test('native import allowlist excludes every report write/feature/control/hook API', () => {
  const imports = [...source.matchAll(/\bstatic extern (?:\w+) (\w+)\(/gu)].map(match => match[1]).sort();
  assert.deepEqual(imports, [
    'CreateFileW', 'HidD_FreePreparsedData', 'HidD_GetAttributes', 'HidD_GetHidGuid',
    'HidD_GetPreparsedData', 'HidP_GetCaps', 'SetupDiDestroyDeviceInfoList',
    'SetupDiEnumDeviceInterfaces', 'SetupDiGetClassDevsW', 'SetupDiGetDeviceInterfaceDetailW',
  ].sort());
  assert.doesNotMatch(source, /\b(?:GENERIC_WRITE|WriteFile|GetFeature|SetFeature|HidD_GetInputReport|DeviceIoControl|SetOutputReport|SendInput|SetWindowsHookEx)\b/u);
  assert.doesNotMatch(script, /\b(?:Out-File|Set-Content|Add-Content|WriteAllBytes|WriteAllText|AppendAllText|CreateDirectory|FileAccess\.Write|FileAccess\.ReadWrite)\b/iu);
});

test('enumeration opens only VID/PID-prefiltered metadata handles; capture revalidates identity/caps', () => {
  assert.match(source, /if \(!IsTargetPath\(path\) \|\| !seen\.Add\(path\)\) continue;/u);
  assert.match(source, /CreateFileW\(path, 0, FILE_SHARE_READ \| FILE_SHARE_WRITE/u);
  assert.match(source, /vid == 0xFFF1 && pid == 0x00DD && page == 0xFFFC && usage == 1 && inputBytes == 64/u);
  assert.match(source, /attributes\.VendorID != 0xFFF1 \|\| attributes\.ProductID != 0x00DD/u);
  assert.match(source, /devices == null \|\| devices\.Length != 1/u);
  assert.match(script, /if \(\$devices\.Count -ne 1\)/u);
  assert.match(source, /CreateFileW\(device\.Path, GENERIC_READ,\s*FILE_SHARE_READ \| FILE_SHARE_WRITE, IntPtr\.Zero, OPEN_EXISTING, FILE_FLAG_OVERLAPPED/u);
  assert.match(source, /if \(Inspect\(handle, device\.Path\) == null\) throw/u);
  assert.equal([...source.matchAll(/\bCreateFileW\(/gu)].length, 3, 'exactly one declaration and two reviewed call sites');
});

test('only metadata access-denied is skipped; capture requires one physical parent and one verified vendor', () => {
  assert.match(source, /if \(metadataError == 5\) \{ metadataDenied\+\+; continue; \}/u);
  assert.match(source, /throw new NativeFailure\("metadata_open_failed", metadataError\)/u);
  assert.match(source, /if \(physicalReceiverCount != 1\) throw/u);
  assert.match(script, /Get-PnpDevice -PresentOnly -ErrorAction Stop/u);
  assert.match(script, /catch \{ \$physicalReceiverCount = -1 \}/u);
  assert.match(script, /if \(\$physicalReceiverCount -ne 1\)/u);
  const guard = script.indexOf('if ($physicalReceiverCount -ne 1)');
  const capture = script.indexOf('$summary = [Au05ReadOnly.Native]::Capture(');
  assert.ok(guard > 0 && guard < capture);
  assert.match(script.slice(guard, capture), /exit 2/u);
  assert.match(script, /Capture\(\$devices, \$physicalReceiverCount, \$Seconds, \$MaxReports\)/u);
  const pattern = script.match(/\$_\.InstanceId -match '([^']+)'/u)?.[1];
  assert.equal(pattern, String.raw`^USB\\VID_FFF1&PID_00DD\\`);
  const parent = new RegExp(pattern, 'i');
  assert.ok(parent.test(String.raw`USB\VID_FFF1&PID_00DD\synthetic`));
  for (const value of [String.raw`USB\VID_FFF1&PID_00DD&MI_03\synthetic`,
    String.raw`HID\VID_FFF1&PID_00DD\synthetic`, String.raw`USB\VID_FFF1&PID_00DDD\synthetic`,
    String.raw`USB\VID_FFFF&PID_00DD\synthetic`]) assert.equal(parent.test(value), false);
});

test('async read cancellation completes before ownership cleanup; resources have finally guards', () => {
  assert.match(source, /cancel\.CancelAfter\(TimeSpan\.FromSeconds\(seconds\)\)/u);
  assert.match(source, /Console\.CancelKeyPress \+= onCancel/u);
  assert.match(source, /finally \{ Console\.CancelKeyPress -= onCancel; \}/u);
  assert.match(source, /new FileStream\(handle, FileAccess\.Read, 64, true\)/u);
  assert.match(source, /ReadAsync\(buffer, 0, buffer\.Length, cancel\.Token\)\.GetAwaiter\(\)\.GetResult\(\)/u);
  assert.match(source, /finally \{\s*if \(stream != null\) stream\.Dispose\(\); else handle\.Dispose\(\);\s*Array\.Clear\(buffer/u);
  assert.match(source, /finally \{ HidD_FreePreparsedData\(data\); \}/u);
  assert.match(source, /finally \{ SetupDiDestroyDeviceInfoList\(set\); \}/u);
  assert.doesNotMatch(source, /Task\.WhenAny|Task\.Run|Thread\.Abort|WaitAsync\(/u);
});

test('only complete TEA blocks are decoded; input classifier is strict and no encoder exists', () => {
  assert.match(source, /new byte\[56\]/u);
  assert.match(source, /offset < 56; offset \+= 8/u);
  assert.match(source, /DecryptBlock\(report, offset \+ 1, plain, offset, key\)/u);
  assert.match(source, /report\.Length != 64 \|\| report\[0\] != 0x55/u);
  assert.match(source, /plain\[0\] != 0x0B && plain\[0\] != 0x8B/u);
  assert.match(source, /plain\[1\] != 0x10 \|\| plain\[3\] > 1 \|\| plain\[4\] > 5/u);
  assert.match(source, /round < 32/u);
  assert.match(source, /0xCAA5BACA, 0xBC2A8A6D, 0xCA5A9EBA, 0x9BB88BCA/u);
  assert.doesNotMatch(source, /\b(?:Encrypt|Encoder|EncodeReport)\w*\s*\(/u);
});

test('default output is explicit sanitized metadata/event counters, never path/serial/raw errors', () => {
  assert.match(source, /internal string Path;/u);
  assert.doesNotMatch(script, /\$devices\s*\|\s*ConvertTo-Json/iu);
  assert.doesNotMatch(script, /Write-(?:Host|Output|Warning|Error).*\.(?:Path|Message)|Exception\.Message|ToHexString|ToBase64String/u);
  assert.match(script, /physicalActionCountsVerified = \$false/u);
  assert.match(script, /eventReportCounts = \$summary\.Events/u);
  assert.match(script, /status = 'no_device'; mode = \$Mode; deviceCount = 0; metadataDenied = \$metadataDenied;/u);
  const selfTest = script.indexOf("if ($Mode -eq 'SelfTest')");
  assert.ok(selfTest > 0 && selfTest < script.indexOf('$enumeration = [Au05ReadOnly.Native]::List()'));
  assert.match(script.slice(selfTest, script.indexOf('$enumeration = ')), /exit 0/u);
});

test('failure diagnostics expose fixed codes and numeric errors, not exception text', () => {
  const diagnostics = source.slice(source.indexOf('public static Diagnostic Diagnose('), source.indexOf('const uint GENERIC_READ'));
  assert.doesNotMatch(diagnostics, /\.Message|\.StackTrace|\.ToString\(/u);
  assert.match(diagnostics, /switch \(native\.Code\)/u);
  assert.match(diagnostics, /Reason = "native_entrypoint_missing"/u);
  assert.match(diagnostics, /Reason = "powershell_binding_failed"/u);
  assert.match(script, /reason = \$reason;\s*nativeError = \$nativeError; writes = 0/u);
  assert.match(source, /int metadataError = Marshal\.GetLastWin32Error\(\);/u);
  assert.match(source, /new NativeFailure\("metadata_open_failed", metadataError\)/u);
  assert.match(source, /diagnostic_privacy_failed/u);
});

test('Windows offline SelfTest compiles C#, verifies TEA KAT/layout and touches no devices', {
  skip: process.platform !== 'win32' ? 'Windows PowerShell 7 compile/runtime check only' : false,
}, () => {
  // SelfTest returns before List(); neither this test nor CI runs list or capture.
  const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-File', fileURLToPath(scriptUrl), '-Mode', 'SelfTest'], { encoding: 'utf8', timeout: 30000 });
  assert.deepEqual(JSON.parse(output.trim()), { status: 'self_test_passed', deviceAccess: false, writes: 0 });
});
