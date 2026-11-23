# UTF-8; PowerShell 7 / Windows only. Opening this window never opens a device.
[CmdletBinding()]
param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Pure layout and protocol data are also available to the offline self-test.
$script:EventNames = [ordered]@{
    'k1.down' = '按键一按下'; 'k1.up' = '按键一松开'
    'k2.down' = '按键二按下'; 'k2.up' = '按键二松开'
    'k3.down' = '按键三按下'; 'k3.up' = '按键三松开'
    'knob.down' = '旋钮按下'; 'knob.up' = '旋钮松开'
    'right.pulse' = '向右脉冲'; 'left.pulse' = '向左脉冲'
}
$script:StatusNames = @{
    idle = '启动中'; waiting = '启动中'; ready = '采集中'
    timeout = '到期结束'; report_limit = '到期结束'; collector_timeout = '到期结束'
    disconnected = '设备断开'; io_error = '设备断开'; no_device = '未检测到设备'
    cancelled = '已停止'; stopped = '已停止'
    ambiguous_device = '启动失败'; physical_receiver_unverified = '启动失败'
    hid_operation_failed = '启动失败'; collector_error = '启动失败'
    collector_protocol_error = '启动失败'; collector_exit = '启动失败'
}
$script:Layout = @(
    @{ Name = 'title'; Text = 'AU05 只读观察器'; X = 20; Y = 18; W = 640; H = 30 },
    @{ Name = 'status'; Text = '未启动'; X = 20; Y = 56; W = 640; H = 32 },
    @{ Name = 'safety'; Text = '设备写入关闭 / 会话控制关闭'; X = 20; Y = 98; W = 640; H = 25 },
    @{ Name = 'limit'; Text = '每次最多采集 120 秒或 10000 份报告；到期不自动重试。'; X = 20; Y = 130; W = 640; H = 25 },
    @{ Name = 'hint'; Text = '仅点击“开始”才启动采集；重启也必须手动点击。'; X = 20; Y = 162; W = 640; H = 25 },
    @{ Name = 'hardware'; Text = '设备：未连接；采集：未结束'; X = 20; Y = 198; W = 640; H = 25 },
    @{ Name = 'last'; Text = '最近事件：无'; X = 20; Y = 230; W = 640; H = 25 },
    @{ Name = 'counts'; Text = ''; X = 20; Y = 266; W = 640; H = 170 },
    @{ Name = 'disclaimer'; Text = '计数为解码后的事件报告数，不代表物理按键或旋转次数。'; X = 20; Y = 446; W = 640; H = 28 },
    @{ Name = 'connection'; Text = '复制令牌后，在 DSH 观察器中手动粘贴并连接。程序不将口令写入磁盘。'; X = 20; Y = 480; W = 640; H = 28 },
    @{ Name = 'notice'; Text = '打开窗口不会启动 Node，也不会访问设备。'; X = 20; Y = 514; W = 640; H = 28 }
)

function Format-ObserverCountRows([string[]]$Lines) {
    if ($Lines.Count -ne 10) { throw 'invalid_count_layout' }
    $rows = for ($index = 0; $index -lt 10; $index += 2) {
        '{0}     |     {1}' -f $Lines[$index], $Lines[$index + 1]
    }
    return $rows -join "`r`n"
}

function ConvertTo-ObserverView($Health) {
    # Only fixed enums, booleans and bounded integer counts can reach UI labels.
    if ($null -eq $Health -or $Health -isnot [System.Collections.IDictionary]) { throw 'invalid_health' }
    $allowedKeys = @('mode', 'readOnly', 'writes', 'sequence', 'status', 'finished', 'hardware', 'counts', 'lastEvent')
    foreach ($key in $Health.Keys) { if ($allowedKeys -cnotcontains $key) { throw 'invalid_health' } }
    if ($Health.mode -isnot [string] -or $Health.mode -cne 'read-only' -or
        $Health.readOnly -isnot [bool] -or -not $Health.readOnly) { throw 'invalid_health' }
    if (($Health.writes -isnot [long] -and $Health.writes -isnot [int]) -or $Health.writes -ne 0) { throw 'invalid_health' }
    if (($Health.sequence -isnot [long] -and $Health.sequence -isnot [int]) -or
        $Health.sequence -lt 0 -or $Health.sequence -gt 9007199254740991) { throw 'invalid_health' }
    if ($Health.status -isnot [string] -or @($script:StatusNames.Keys) -cnotcontains $Health.status) { throw 'invalid_health' }
    if ($Health.finished -isnot [bool] -or $Health.hardware -isnot [bool]) { throw 'invalid_health' }
    if ($Health.counts -isnot [System.Collections.IDictionary] -or $Health.counts.Count -ne 10) { throw 'invalid_health' }
    foreach ($key in $Health.counts.Keys) { if (@($script:EventNames.Keys) -cnotcontains $key) { throw 'invalid_health' } }
    if ($Health.status -ceq 'ready') {
        if ($Health.finished -or -not $Health.hardware) { throw 'invalid_health' }
    } elseif ($Health.status -cin @('idle', 'waiting')) {
        if ($Health.finished -or $Health.hardware) { throw 'invalid_health' }
    } elseif (-not $Health.finished -or $Health.hardware) { throw 'invalid_health' }
    $total = 0
    $lines = foreach ($key in $script:EventNames.Keys) {
        $value = $Health.counts[$key]
        if (($value -isnot [long] -and $value -isnot [int]) -or $value -lt 0 -or $value -gt 10000) { throw 'invalid_health' }
        $total += $value
        '{0}：{1}' -f $script:EventNames[$key], $value
    }
    if ($total -gt 10000) { throw 'invalid_health' }
    $last = '无'
    if ($Health.Contains('lastEvent')) {
        if ($Health.lastEvent -isnot [string] -or @($script:EventNames.Keys) -cnotcontains $Health.lastEvent) { throw 'invalid_health' }
        $last = $script:EventNames[$Health.lastEvent]
    }
    return @{
        Status = $script:StatusNames[$Health.status]
        Hardware = $(if ($Health.hardware) { '设备：已就绪' } else { '设备：未连接' }) +
            $(if ($Health.finished) { '；采集：已结束' } else { '；采集：未结束' })
        Last = '最近事件：' + $last
        Counts = Format-ObserverCountRows -Lines $lines
    }
}

function Test-OfflineLayout {
    if ($script:Layout.Count -ne 11 -or $script:EventNames.Count -ne 10) { throw 'layout_invalid' }
    $names = @{}
    foreach ($item in $script:Layout) {
        if ($names.ContainsKey($item.Name) -or $item.X -lt 0 -or $item.Y -lt 0 -or
            $item.X + $item.W -gt 680 -or $item.Y + $item.H -gt 550) { throw 'layout_invalid' }
        $names[$item.Name] = $true
    }
    $counts = @{}; foreach ($key in $script:EventNames.Keys) { $counts[$key] = 0 }
    $health = @{ mode = 'read-only'; readOnly = $true; writes = 0; sequence = 1
        status = 'ready'; hardware = $true; finished = $false; counts = $counts; lastEvent = 'k1.down' }
    $view = ConvertTo-ObserverView $health
    if ($view.Status -ne '采集中' -or $view.Last -ne '最近事件：按键一按下') { throw 'view_invalid' }
    $countRows = @($view.Counts -split "`r`n")
    if ($countRows.Count -ne 5 -or $countRows[0] -cne '按键一按下：0     |     按键一松开：0' -or
        $countRows[4] -cne '向右脉冲：0     |     向左脉冲：0') { throw 'view_invalid' }
    foreach ($status in $script:StatusNames.Keys) {
        $health.status = $status
        $health.hardware = $status -eq 'ready'
        $health.finished = $status -notin @('idle', 'waiting', 'ready')
        $null = ConvertTo-ObserverView $health
    }
    $health.status = 'ready'; $health.hardware = $true; $health.finished = $false
    $mutations = @(
        { param($h) $h.status = 'untrusted-private-data' },
        { param($h) $h.status = 'READY' },
        { param($h) $h.Remove('mode') },
        { param($h) $h.mode = 'control' },
        { param($h) $h.mode = @('read-only') },
        { param($h) $h.readOnly = $false },
        { param($h) $h.writes = 1 },
        { param($h) $h.sequence = -1 },
        { param($h) $h.sequence = 9007199254740992L },
        { param($h) $h.hardware = $false },
        { param($h) $h.finished = $true },
        { param($h) $h.status = 'waiting' },
        { param($h) $h.status = 'timeout' },
        { param($h) $h.counts.Remove('k1.down') },
        { param($h) $h.counts['unknown'] = 1 },
        { param($h) $h.counts['k1.down'] = -1 },
        { param($h) $h.counts['k1.down'] = 10001 },
        { param($h) $h.counts['k1.down'] = 9999; $h.counts['k1.up'] = 2 },
        { param($h) $h.counts['k1.down'] = '1' },
        { param($h) $h.lastEvent = 'private-device-path' },
        { param($h) $h['privateExtension'] = 'private-data' }
    )
    foreach ($mutate in $mutations) {
        $candidate = ConvertFrom-Json -AsHashtable -InputObject (ConvertTo-Json -Depth 8 $health)
        $null = & $mutate $candidate
        $rejected = $false
        try { $null = ConvertTo-ObserverView $candidate } catch { $rejected = $true }
        if (-not $rejected) { throw 'view_invalid' }
    }
    # Parse the whole script, without loading Windows Forms or executing runtime paths.
    $parseErrors = $null; $tokens = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -ne 0) { throw 'parse_failed' }
}

function Test-ObserverExecutable([string]$Path) {
    # Verify an actual Windows PE file, without executing it. This is not a signature/trust check.
    if ([IO.Path]::GetExtension($Path) -ine '.exe' -or -not [IO.File]::Exists($Path)) { return $false }
    $reader = $null
    try {
        $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($Path))
        if ($reader.BaseStream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { return $false }
        $reader.BaseStream.Position = 0x3c
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset -gt $reader.BaseStream.Length - 4) { return $false }
        $reader.BaseStream.Position = $offset
        return $reader.ReadUInt32() -eq 0x00004550
    } catch { return $false }
    finally { if ($null -ne $reader) { $reader.Dispose() } }
}

function Find-ObserverNode {
    # Never accept a function, alias, script, shell snippet, or user-supplied arguments.
    $command = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command -and (Test-ObserverExecutable $command.Source)) { return $command.Source }
    # The sole fallback is DSH's installed bundled Node executable, not its GUI binary.
    $local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    $bundled = [IO.Path]::Combine($local, 'Programs', 'DeepSeek Harness', 'resources', 'runtime',
        'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe')
    if (Test-ObserverExecutable $bundled) { return $bundled }
    return $null
}

function Reset-HealthRequest {
    if ($null -ne $script:HealthCancel) { $script:HealthCancel.Cancel(); $script:HealthCancel.Dispose() }
    # A cancelled pending task is never read into a replacement run's UI.
    if ($null -ne $script:HealthTask -and $script:HealthTask.IsCompletedSuccessfully) {
        $script:HealthTask.Result.Dispose()
    }
    if ($null -ne $script:HealthRequest) { $script:HealthRequest.Dispose() }
    $script:HealthTask = $null; $script:BodyTask = $null; $script:HealthResponse = $null
    $script:HealthCancel = $null; $script:HealthRequest = $null
}

function Reset-ObserverReadiness {
    $script:ObserverReady = $false
    $script:OutputLine = ''
    # Detached reads from an earlier owner can never authorize a replacement run.
    $script:OutTask = $null; $script:ErrTask = $null
}

function Receive-ObserverOutput([string]$Chunk) {
    # Only the exact canonical NDJSON record emitted by our owned Node after bind
    # success authorizes the first authenticated request. No stdout is shown/logged.
    foreach ($character in $Chunk.ToCharArray()) {
        if ($character -eq "`n") {
            $line = $script:OutputLine
            $script:OutputLine = ''
            if ($line.EndsWith("`r")) { $line = $line.Substring(0, $line.Length - 1) }
            if ($line -ceq '{"status":"observer_listening","mode":"read-only","port":17376}') {
                $script:ObserverReady = $true
            } elseif ($line -cmatch '^\{"status":"observer_finished","reason":"[a-z_]{1,64}"\}$') {
                # A bounded terminal notification is not readiness and contains no UI data.
            } else { throw 'invalid_observer_readiness' }
        } else {
            if ($script:OutputLine.Length -ge 1024) { throw 'observer_output_line_too_long' }
            $script:OutputLine += $character
        }
    }
}

function Start-Observer {
    if ($null -ne $script:OwnedProcess -or $script:Closing) { return }
    Reset-ObserverReadiness
    $script:Labels.status.Text = '启动中'
    $process = [Diagnostics.Process]::new()
    try {
        $node = Find-ObserverNode
        if ($null -eq $node) {
            $process.Dispose()
            $script:Labels.status.Text = '启动失败'
            $script:Labels.notice.Text = '未找到 Node.js。请安装 Node.js 22 或使用含 Node 的 DSH 安装版。'
            return
        }
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = $node
        $info.WorkingDirectory = $script:RepoRoot
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.ArgumentList.Add('apps/observer/main.mjs')
        $info.ArgumentList.Add('--managed')
        $info.Environment['AU05_OBSERVER_TOKEN'] = $script:ConnectionToken
        $info.Environment['AU05_OBSERVER_PORT'] = '17376'
        $process.StartInfo = $info
        if (-not $process.Start()) { throw 'start_failed' }
        $script:OwnedProcess = $process
        # Drop the extra environment copy; the lifetime token itself is memory-only.
        $info.Environment.Remove('AU05_OBSERVER_TOKEN') | Out-Null
        $script:OutBuffer = [char[]]::new(2048); $script:ErrBuffer = [char[]]::new(2048)
        $script:OutTask = $process.StandardOutput.ReadAsync($script:OutBuffer, 0, 2048)
        $script:ErrTask = $process.StandardError.ReadAsync($script:ErrBuffer, 0, 2048)
        $script:StopDeadline = $null; $script:KillDeadline = $null; $script:WriteTask = $null
        $script:HadHealth = $false; $script:HealthFailed = $false
        $script:StartupDeadline = [DateTime]::UtcNow.AddSeconds(10)
        $script:NextHealth = [DateTime]::UtcNow
        $script:Labels.hardware.Text = '设备：未连接；采集：未结束'
        $script:Labels.last.Text = '最近事件：无'
        $script:Labels.counts.Text = Format-ObserverCountRows -Lines @($script:EventNames.Values | ForEach-Object { $_ + '：0' })
        $script:Labels.notice.Text = '等待采集就绪；不会自动重试或自动重新连接。'
        $script:StartButton.Enabled = $false; $script:StopButton.Enabled = $true
        $script:RestartButton.Enabled = $true
    } catch {
        if ($null -ne $script:OwnedProcess) { Request-ObserverStop } else { $process.Dispose() }
        $script:Labels.status.Text = '启动失败'
        $script:Labels.notice.Text = '无法启动只读观察器。请检查运行环境；不会自动重试。'
    }
}

function Request-ObserverStop {
    Reset-HealthRequest
    if ($null -eq $script:OwnedProcess -or $null -ne $script:StopDeadline) { return }
    $script:StopDeadline = [DateTime]::UtcNow.AddSeconds(5)
    $script:StopButton.Enabled = $false; $script:RestartButton.Enabled = $false
    $script:Labels.notice.Text = '正在停止；最多等待 5 秒，然后仅清理本窗口启动的进程树。'
    try {
        # Exactly LF, not WriteLine's Windows CRLF. Never block the UI on a pipe.
        $script:WriteTask = $script:OwnedProcess.StandardInput.WriteAsync("stop`n")
    } catch { try { $script:OwnedProcess.StandardInput.Close() } catch {} }
}

function Complete-ObserverExit {
    $wasStopping = $null -ne $script:StopDeadline
    Reset-HealthRequest
    $script:OwnedProcess.Dispose(); $script:OwnedProcess = $null
    Reset-ObserverReadiness
    $script:WriteTask = $null
    $script:StopDeadline = $null; $script:KillDeadline = $null
    if ($wasStopping -and -not $script:HealthFailed) { $script:Labels.status.Text = '已停止' }
    elseif ($script:Labels.status.Text -in @('启动中', '采集中')) { $script:Labels.status.Text = '启动失败' }
    $script:Labels.notice.Text = '已结束。需要再次采集时，请手动点击“开始”或“重启”。'
    $script:StartButton.Enabled = $true; $script:StopButton.Enabled = $false
    $script:RestartButton.Enabled = $true
    if ($script:Closing) { $script:AllowClose = $true; $script:Form.Close(); return }
    if ($script:RestartPending) { $script:RestartPending = $false; Start-Observer }
}

function Update-Observer {
    if ($null -eq $script:OwnedProcess) { return }
    $readingOwnedOutput = $false
    try {
        if ($script:OwnedProcess.HasExited) { Complete-ObserverExit; return }
        if ($null -eq $script:StopDeadline -and -not $script:ObserverReady -and
            [DateTime]::UtcNow -ge $script:StartupDeadline) { throw 'observer_readiness_timeout' }
        $readingOwnedOutput = $true
        # Read only completed bounded chunks; child stdout/stderr are NEVER displayed or logged.
        foreach ($stream in @('Out', 'Err')) {
            $taskName = $stream + 'Task'; $bufferName = $stream + 'Buffer'
            $task = Get-Variable -Name $taskName -Scope Script -ValueOnly
            if ($null -ne $task -and $task.IsCompleted) {
                $next = $null
                # Clear before parsing. An invalid task cannot repeatedly bypass cleanup.
                Set-Variable -Name $taskName -Scope Script -Value $null
                if ($task.IsCompletedSuccessfully -and $task.Result -gt 0) {
                    $buffer = Get-Variable -Name $bufferName -Scope Script -ValueOnly
                    if ($task.Result -gt $buffer.Length) { throw 'invalid_observer_output_size' }
                    if ($stream -eq 'Out' -and $null -eq $script:StopDeadline) {
                        Receive-ObserverOutput -Chunk ([string]::new($buffer, 0, $task.Result))
                    }
                    $reader = $(if ($stream -eq 'Out') { $script:OwnedProcess.StandardOutput } else { $script:OwnedProcess.StandardError })
                    $next = $reader.ReadAsync($buffer, 0, 2048)
                } elseif ($stream -eq 'Out' -and $null -eq $script:StopDeadline) {
                    throw 'observer_output_ended'
                }
                Set-Variable -Name $taskName -Scope Script -Value $next
            }
        }
        $readingOwnedOutput = $false
        if ($null -ne $script:StopDeadline) {
            if ($null -ne $script:WriteTask -and $script:WriteTask.IsCompleted) {
                try { $script:OwnedProcess.StandardInput.Close() } catch {}
                $script:WriteTask = $null
            }
            if ([DateTime]::UtcNow -ge $script:StopDeadline -and $null -eq $script:KillDeadline) {
                # Retain the owned Process object. Never kill by port, PID search, name or image.
                try { $script:OwnedProcess.StandardInput.Close() } catch {}
                try { if (-not $script:OwnedProcess.HasExited) { $script:OwnedProcess.Kill($true) } } catch {}
                $script:KillDeadline = [DateTime]::UtcNow.AddSeconds(1)
            }
            if ($null -ne $script:KillDeadline -and [DateTime]::UtcNow -ge $script:KillDeadline) {
                # Cleanup has a hard bound even if the OS refuses termination. Never restart over it.
                $script:RestartPending = $false
                $script:Labels.status.Text = '启动失败'
                $script:Labels.notice.Text = '进程清理未确认完成。请检查系统；不会再次启动采集。'
                if ($script:Closing) { $script:AllowClose = $true; $script:Form.Close() }
            }
            return
        }
        # Never send the window token to whoever merely happens to own the port.
        # Timeout is independent of HTTP: until owned bind success there is no HTTP.
        if (-not $script:ObserverReady) {
            if ([DateTime]::UtcNow -ge $script:StartupDeadline) { throw 'observer_readiness_timeout' }
            return
        }
        if ($null -ne $script:HealthTask -and $script:HealthTask.IsCompleted) {
            if (-not $script:HealthTask.IsCompletedSuccessfully) { throw 'health_unavailable' }
            if ($null -eq $script:HealthResponse) {
                $script:HealthResponse = $script:HealthTask.Result
                if (-not $script:HealthResponse.IsSuccessStatusCode) { throw 'health_unavailable' }
                $script:BodyTask = $script:HealthResponse.Content.ReadAsStringAsync()
            }
            if ($script:BodyTask.IsCompleted) {
                if (-not $script:BodyTask.IsCompletedSuccessfully) { throw 'health_unavailable' }
                $health = ConvertFrom-Json -InputObject $script:BodyTask.Result -AsHashtable -Depth 8
                $view = ConvertTo-ObserverView $health
                $script:Labels.status.Text = $view.Status
                $script:Labels.hardware.Text = $view.Hardware
                $script:Labels.last.Text = $view.Last
                $script:Labels.counts.Text = $view.Counts
                $script:HadHealth = $true
                Reset-HealthRequest
                $script:NextHealth = [DateTime]::UtcNow.AddMilliseconds(750)
            }
        }
        if ($null -eq $script:HealthTask -and [DateTime]::UtcNow -ge $script:NextHealth) {
            $script:HealthCancel = [Threading.CancellationTokenSource]::new()
            $script:HealthRequest = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, 'http://127.0.0.1:17376/v1/health')
            $script:HealthRequest.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $script:ConnectionToken)
            # HttpClient buffers at most 8192 bytes asynchronously; read results only after completion.
            $script:HealthTask = $script:Http.SendAsync($script:HealthRequest, $script:HealthCancel.Token)
        }
    } catch {
        Reset-HealthRequest
        $script:NextHealth = [DateTime]::UtcNow.AddMilliseconds(750)
        if ($readingOwnedOutput -or -not $script:ObserverReady -or $script:HadHealth -or [DateTime]::UtcNow -ge $script:StartupDeadline) {
            $script:ObserverReady = $false; $script:OutputLine = ''
            $script:RestartPending = $false
            $script:HealthFailed = $true
            $script:Labels.status.Text = '启动失败'
            Request-ObserverStop
            $script:Labels.notice.Text = '无法确认观察器状态；正在停止。不会自动重启。'
        }
    }
}

# The offline guard precedes UI assembly loads, token creation, runtime discovery, and networking.
if ($SelfTest) {
    Test-OfflineLayout
    Write-Output 'observer_gui_selftest_ok'
    return
}
if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 7 -or
    [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    Write-Output '启动失败：请在 Windows 使用 PowerShell 7，以 -STA 参数启动。'
    exit 1
}

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $script:RepoRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..'))
    # One fresh 32-byte / 64-hex secret per window lifetime, unchanged on explicit restarts.
    $script:ConnectionToken = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $script:OwnedProcess = $null
    Reset-ObserverReadiness
    $script:StopDeadline = $null; $script:KillDeadline = $null; $script:WriteTask = $null
    $script:HealthTask = $null; $script:BodyTask = $null; $script:HealthResponse = $null; $script:HealthCancel = $null
    $script:HealthRequest = $null
    $script:Closing = $false; $script:AllowClose = $false; $script:RestartPending = $false
    $script:HealthFailed = $false; $script:HadHealth = $false
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false; $handler.UseProxy = $false; $handler.UseCookies = $false
    $script:Http = [Net.Http.HttpClient]::new($handler)
    $script:Http.Timeout = [TimeSpan]::FromSeconds(2)
    $script:Http.MaxResponseContentBufferSize = 8192
    $script:Form = [Windows.Forms.Form]::new()
    $script:Form.Text = 'AU05 只读观察器'
    $script:Form.ClientSize = [Drawing.Size]::new(680, 620)
    $script:Form.MinimumSize = [Drawing.Size]::new(700, 660)
    $script:Form.StartPosition = 'CenterScreen'
    $script:Form.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)
    $script:Form.AutoScaleMode = 'Dpi'
    $script:Labels = @{}
    foreach ($item in $script:Layout) {
        $label = [Windows.Forms.Label]::new()
        $label.Text = $item.Text
        $label.SetBounds($item.X, $item.Y, $item.W, $item.H)
        $label.Anchor = 'Top, Left, Right'
        if ($item.Name -eq 'title' -or $item.Name -eq 'status') { $label.Font = [Drawing.Font]::new('Microsoft YaHei UI', 14, [Drawing.FontStyle]::Bold) }
        $script:Labels[$item.Name] = $label
        $script:Form.Controls.Add($label)
    }
    # Pair down/up and right/left counts into five readable rows at the normal UI font.
    $script:Labels.counts.Font = [Drawing.Font]::new('Microsoft YaHei UI', 10)
    $script:Labels.counts.Text = Format-ObserverCountRows -Lines @($script:EventNames.Values | ForEach-Object { $_ + '：0' })
    $script:StartButton = [Windows.Forms.Button]::new()
    $script:StartButton.Text = '开始'; $script:StartButton.SetBounds(20, 566, 100, 36)
    $script:StartButton.Add_Click({ Start-Observer })
    $script:StopButton = [Windows.Forms.Button]::new()
    $script:StopButton.Text = '停止'; $script:StopButton.SetBounds(132, 566, 100, 36)
    $script:StopButton.Enabled = $false
    $script:StopButton.Add_Click({ $script:RestartPending = $false; Request-ObserverStop })
    $script:RestartButton = [Windows.Forms.Button]::new()
    $script:RestartButton.Text = '重启'; $script:RestartButton.SetBounds(244, 566, 100, 36)
    $script:RestartButton.Add_Click({
        if ($null -eq $script:OwnedProcess) { Start-Observer }
        else { $script:RestartPending = $true; Request-ObserverStop }
    })
    $copyButton = [Windows.Forms.Button]::new()
    $copyButton.Text = '复制连接令牌'; $copyButton.SetBounds(366, 566, 180, 36)
    $copyButton.Add_Click({
        try {
            # The only place a token leaves process memory. Never copy automatically.
            [Windows.Forms.Clipboard]::SetText($script:ConnectionToken)
            $script:Labels.notice.Text = '连接令牌已复制。请只粘贴到可信的本机 DSH 观察器；剪贴板可能保留。'
        } catch { $script:Labels.notice.Text = '复制失败。未显示或记录令牌。' }
    })
    $script:Form.Controls.AddRange(@($script:StartButton, $script:StopButton, $script:RestartButton, $copyButton))
    $script:Timer = [Windows.Forms.Timer]::new(); $script:Timer.Interval = 100
    $script:Timer.Add_Tick({ Update-Observer })
    $script:Form.Add_FormClosing({
        param($sender, $eventArgs)
        if ($script:AllowClose -or $null -eq $script:OwnedProcess) { return }
        $eventArgs.Cancel = $true
        $script:Closing = $true; $script:RestartPending = $false
        $script:StartButton.Enabled = $false; $script:RestartButton.Enabled = $false
        Request-ObserverStop
    })
    $script:Timer.Start()
    $null = $script:Form.ShowDialog()
} catch {
    # Fixed failure text only; never print exception messages, paths, identifiers or child output.
    Write-Output '启动失败：无法打开只读观察器窗口。'
} finally {
    if (Get-Variable Timer -Scope Script -ErrorAction SilentlyContinue) { $script:Timer.Stop(); $script:Timer.Dispose() }
    if (Get-Variable OwnedProcess -Scope Script -ErrorAction SilentlyContinue) {
        if ($null -ne $script:OwnedProcess) {
            try { $script:OwnedProcess.StandardInput.Close() } catch {}
            # Exceptional teardown also uses an event-loop timer: never kill before the
            # same five-second grace, and never block on WaitForExit or a pipe read.
            if ($null -eq $script:StopDeadline) { $script:StopDeadline = [DateTime]::UtcNow.AddSeconds(5) }
            $script:CleanupHardEnd = $script:StopDeadline.AddSeconds(1)
            $script:CleanupKilled = $false
            $script:CleanupContext = [Windows.Forms.ApplicationContext]::new()
            $script:CleanupTimer = [Windows.Forms.Timer]::new()
            $script:CleanupTimer.Interval = 100
            $script:CleanupTimer.Add_Tick({
                try {
                    if ($script:OwnedProcess.HasExited -or [DateTime]::UtcNow -ge $script:CleanupHardEnd) {
                        $script:CleanupContext.ExitThread(); return
                    }
                    if (-not $script:CleanupKilled -and [DateTime]::UtcNow -ge $script:StopDeadline) {
                        $script:CleanupKilled = $true
                        try { $script:OwnedProcess.Kill($true) } catch {}
                    }
                } catch { $script:CleanupContext.ExitThread() }
            })
            $script:CleanupTimer.Start()
            [Windows.Forms.Application]::Run($script:CleanupContext)
            $script:CleanupTimer.Stop(); $script:CleanupTimer.Dispose(); $script:CleanupContext.Dispose()
            $script:OwnedProcess.Dispose()
        }
    }
    if (Get-Variable Http -Scope Script -ErrorAction SilentlyContinue) { Reset-HealthRequest; $script:Http.Dispose() }
    if (Get-Variable Form -Scope Script -ErrorAction SilentlyContinue) { $script:Form.Dispose() }
    $script:ConnectionToken = $null
}
