import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// Offline only: never execute the wrapper, show the GUI, click Start, open HTTP,
// or import the collector. Windows executes -SelfTest and an AST-only behavioral
// fixture whose selected production bodies receive harmless process/control fakes.
const scriptUrl = new URL('../scripts/observer-gui.ps1', import.meta.url);
const source = await readFile(scriptUrl, 'utf8');
const wrapper = await readFile(new URL('../启动只读观察器.cmd', import.meta.url), 'utf8');
const exec = promisify(execFile);

test('ASCII cmd body quotes the UTF-8 script path and requests PowerShell 7 STA', () => {
  assert.match(wrapper, /^[\x00-\x7f]*$/);
  assert.match(wrapper, /pwsh\.exe -NoLogo -NoProfile -STA -File "%~dp0scripts\\observer-gui\.ps1"/);
  assert.doesNotMatch(wrapper, /(?:node|powershell\.exe|runas|schtasks|reg\s+add|ExecutionPolicy|start\s+\/)/i);
});

test('self-test returns before loading UI, creating credentials or discovering runtimes', () => {
  const guard = source.indexOf('if ($SelfTest) {');
  const ui = source.indexOf('Add-Type -AssemblyName');
  const token = source.indexOf('$script:ConnectionToken = [Convert]::ToHexString');
  assert.ok(guard > 0 && ui > guard && token > guard);
  assert.match(source.slice(guard, ui), /Test-OfflineLayout[\s\S]*?observer_gui_selftest_ok[\s\S]*?return/);
  const selfTest = source.slice(source.indexOf('function Test-OfflineLayout'), source.indexOf('function Find-ObserverNode'));
  assert.doesNotMatch(selfTest, /Start-Observer|HttpClient|\.Start\(|Clipboard|Add-Type|Get-Command|HidD_|CreateFile/);
  assert.match(selfTest, /Parser\]::ParseFile/);
});

test('child launch is fixed, shell-free, redirected and explicitly managed', () => {
  assert.match(source, /Get-Command node -CommandType Application/);
  assert.match(source, /if \(Test-ObserverExecutable \$bundled\)/);
  assert.match(source, /\[IO\.File\]::Exists\(\$Path\)/);
  assert.match(source, /ReadUInt16\(\) -ne 0x5a4d/);
  assert.match(source, /ReadUInt32\(\) -eq 0x00004550/);
  assert.match(source, /'primary-runtime', 'dependencies', 'node', 'bin', 'node\.exe'/);
  assert.match(source, /\$info\.UseShellExecute = \$false/);
  for (const stream of ['Input', 'Output', 'Error']) {
    assert.match(source, new RegExp(`\\$info\\.RedirectStandard${stream} = \\$true`));
  }
  assert.match(source, /\$info\.WorkingDirectory = \$script:RepoRoot/);
  assert.match(source, /ArgumentList\.Add\('apps\/observer\/main\.mjs'\)/);
  assert.match(source, /ArgumentList\.Add\('--managed'\)/);
  assert.equal((source.match(/ArgumentList\.Add\(/g) ?? []).length, 2);
  assert.match(source, /\$info\.Environment\['AU05_OBSERVER_TOKEN'\] = \$script:ConnectionToken/);
  assert.match(source, /\$info\.Environment\['AU05_OBSERVER_PORT'\] = '17376'/);
  assert.doesNotMatch(source, /Start-Process|Invoke-Expression|cmd\.exe|\.WaitForExit\(|taskkill|Stop-Process|HidD_|CreateFile/);
  assert.match(source, /StartButton\.Add_Click\(\{ Start-Observer \}\)/);
});

test('token is fresh in-memory, stable on restart and copied only on an explicit click', () => {
  assert.equal((source.match(/\$script:ConnectionToken = \[Convert\]/g) ?? []).length, 1);
  assert.match(source, /RandomNumberGenerator\]::GetBytes\(32\)/);
  assert.equal((source.match(/Clipboard\]::SetText/g) ?? []).length, 1);
  assert.match(source, /\$copyButton\.Add_Click\(\{[\s\S]*?Clipboard\]::SetText\(\$script:ConnectionToken\)/);
  assert.doesNotMatch(source, /(?:Write-Output|Write-Host|WriteAllText|Set-Content|Out-File|\.Text\s*=)[^\r\n]*\$script:ConnectionToken/);
});

test('health is bounded asynchronous authenticated fixed-loopback GET without redirects or proxies', () => {
  const endpoints = [...source.matchAll(/https?:\/\/[^'"\s]+/g)].map(match => match[0]);
  assert.deepEqual(endpoints, ['http://127.0.0.1:17376/v1/health']);
  assert.match(source, /HttpMethod\]::Get/);
  assert.match(source, /AuthenticationHeaderValue\]::new\('Bearer', \$script:ConnectionToken\)/);
  assert.match(source, /AllowAutoRedirect = \$false/);
  assert.match(source, /UseProxy = \$false/);
  assert.match(source, /MaxResponseContentBufferSize = 8192/);
  assert.match(source, /Http\.SendAsync/);
  assert.match(source, /HealthTask\.IsCompleted/);
  assert.match(source, /ReadAsStringAsync/);
  assert.doesNotMatch(source, /Invoke-WebRequest|Invoke-RestMethod|\.GetAwaiter\(|\.Wait\(/);
  assert.match(source, /StatusNames\.Keys\) -cnotcontains \$Health\.status/);
  assert.match(source, /EventNames\.Keys\) -cnotcontains \$Health\.lastEvent/);
  assert.match(source, /Health\.mode -cne 'read-only'/);
  assert.match(source, /Health\.readOnly -isnot \[bool\]/);
  assert.match(source, /Health\.writes -ne 0/);
  assert.match(source, /Health\.counts\.Count -ne 10/);
  assert.match(source, /\$total -gt 10000/);
});

test('authenticated health waits for exact bounded owned-stdout bind readiness and resets per owner', () => {
  const start = source.slice(source.indexOf('function Start-Observer'), source.indexOf('function Request-ObserverStop'));
  assert.ok(start.indexOf('Reset-ObserverReadiness') < start.indexOf('[Diagnostics.Process]::new()'));
  const complete = source.slice(source.indexOf('function Complete-ObserverExit'), source.indexOf('function Update-Observer'));
  assert.match(complete, /Reset-ObserverReadiness/);
  const update = source.slice(source.indexOf('function Update-Observer'), source.indexOf('if ($SelfTest) {'));
  assert.ok(update.indexOf('if (-not $script:ObserverReady)') < update.indexOf('$script:Http.SendAsync'));
  assert.match(update, /observer_readiness_timeout/);
  assert.match(update, /observer_output_ended/);
  assert.match(source, /OutputLine\.Length -ge 1024/);
  assert.match(source, /line -ceq '\{"status":"observer_listening","mode":"read-only","port":17376\}'/);
});

test('stop writes exact LF asynchronously and owns a bounded timer-based process tree cleanup', () => {
  assert.match(source, /StandardInput\.WriteAsync\("stop`n"\)/);
  assert.match(source, /StopDeadline = \[DateTime\]::UtcNow\.AddSeconds\(5\)/);
  assert.match(source, /OwnedProcess\.Kill\(\$true\)/);
  assert.match(source, /Windows\.Forms\.Timer\]::new/);
  assert.match(source, /Timer\.Add_Tick\(\{ Update-Observer \}\)/);
  assert.match(source, /Add_FormClosing/);
  assert.match(source, /\$eventArgs\.Cancel = \$true/);
  assert.doesNotMatch(source, /\$_\.Exception|\.Standard(?:Output|Error)\.ReadToEnd|\.ReadLine\(/);
});

test('ten validated event counters use five paired rows at the normal font size', () => {
  assert.match(source, /function Format-ObserverCountRows\(\[string\[\]\]\$Lines\)/);
  assert.match(source, /\$Lines\.Count -ne 10/);
  assert.match(source, /\$index \+= 2/);
  assert.match(source, /Counts = Format-ObserverCountRows -Lines \$lines/);
  assert.match(source, /Labels\.counts\.Font = \[Drawing\.Font\]::new\('Microsoft YaHei UI', 10\)/);
  assert.match(source, /\$countRows\.Count -ne 5/);
});

test('Chinese labels clearly describe collection limits and safety boundaries', () => {
  for (const label of ['未启动', '启动中', '采集中', '到期结束', '设备断开', '已停止', '启动失败',
    '设备写入关闭', '会话控制关闭', '120 秒', '不自动重试', '事件报告数', '不代表物理按键或旋转次数']) {
    assert.ok(source.includes(label), label);
  }
});

test('PowerShell offline SelfTest parses and validates layout without UI/process/network/HID',
  { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const { stdout, stderr } = await exec('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-File', fileURLToPath(scriptUrl), '-SelfTest'], { windowsHide: true, timeout: 20000, maxBuffer: 4096 });
    assert.equal(stderr, '');
    assert.equal(stdout.trim(), 'observer_gui_selftest_ok');
  });

test('actual PowerShell lifecycle bodies enforce explicit restart, LF stop and bounded owned cleanup with offline fakes',
  { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const fixture = fileURLToPath(new URL('./observer-gui-lifecycle.ps1', import.meta.url));
    const { stdout, stderr } = await exec('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-File', fixture], { windowsHide: true, timeout: 20000, maxBuffer: 8192 });
    assert.equal(stderr, '');
    assert.match(stdout.trim(), /^observer_gui_lifecycle_ok assertions=\d+$/);
    assert.ok(Number(stdout.trim().split('=')[1]) >= 25);
  });
