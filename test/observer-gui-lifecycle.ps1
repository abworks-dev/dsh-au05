# Offline behavioral fixture: parse production code, execute only selected function/event
# bodies against harmless objects. Never dot-source the launcher or create a real UI,
# Process, HttpClient, collector, device handle, token, or clipboard operation.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../scripts/observer-gui.ps1'
$parseErrors = $null; $tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'production_parse_failed' }

foreach ($name in @('Reset-HealthRequest', 'Reset-ObserverReadiness', 'Receive-ObserverOutput', 'Start-Observer', 'Request-ObserverStop', 'Complete-ObserverExit', 'Update-Observer')) {
    $nodes = @($ast.FindAll({ param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
    }, $true))
    if ($nodes.Count -ne 1) { throw 'fixture_function_not_found' }
    # Defining a function is not invoking its body. Start is invoked only through
    # its early owned/closing guards, then replaced by a harmless call recorder.
    . ([scriptblock]::Create($nodes[0].Extent.Text))
}
$script:RealStart = (Get-Command Start-Observer -CommandType Function).ScriptBlock
function Get-Handler([string]$Owner, [string]$Method) {
    $nodes = @($ast.FindAll({ param($node)
        $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
        $node.Expression.Extent.Text -ceq $Owner -and $node.Member.Value -ceq $Method
    }, $true))
    if ($nodes.Count -ne 1 -or $nodes[0].Arguments.Count -ne 1 -or
        $nodes[0].Arguments[0] -isnot [System.Management.Automation.Language.ScriptBlockExpressionAst]) {
        throw 'fixture_handler_not_found'
    }
    return $nodes[0].Arguments[0].ScriptBlock.GetScriptBlock()
}
$stopClick = Get-Handler '$script:StopButton' 'Add_Click'
$restartClick = Get-Handler '$script:RestartButton' 'Add_Click'
$windowClosing = Get-Handler '$script:Form' 'Add_FormClosing'

function Assert-True([bool]$Condition, [string]$Name) {
    if (-not $Condition) { throw ('fixture_assertion_failed:' + $Name) }
    $script:Assertions++
}
function New-Fixture {
    $script:Calls = [Collections.Generic.List[string]]::new()
    $script:StartCalls = 0; $script:NetworkCalls = 0
    $script:StartObservedOldOwner = $false
    $script:OwnedProcess = [pscustomobject]@{
        HasExited = $false; Disposed = $false; KillCount = 0; KillTree = $false
        StandardInput = [pscustomobject]@{
            Writes = [Collections.Generic.List[string]]::new(); CloseCount = 0
            Task = [pscustomobject]@{ IsCompleted = $false; IsCompletedSuccessfully = $false }
        }
    }
    $script:OwnedProcess.StandardInput | Add-Member ScriptMethod WriteAsync {
        param([string]$Text)
        $this.Writes.Add($Text)
        $script:Calls.Add('write')
        return $this.Task
    }
    $script:OwnedProcess.StandardInput | Add-Member ScriptMethod Close {
        $this.CloseCount++
        $script:Calls.Add('stdin_close')
    }
    $script:OwnedProcess | Add-Member ScriptMethod Kill {
        param([bool]$EntireProcessTree)
        $this.KillCount++; $this.KillTree = $EntireProcessTree
        $script:Calls.Add('kill')
        # Deliberately refuse exit: exercise bounded cleanup without terminating anything.
    }
    $script:OwnedProcess | Add-Member ScriptMethod Dispose {
        $this.Disposed = $true
        $script:Calls.Add('dispose')
    }
    foreach ($stream in @('StandardOutput', 'StandardError')) {
        $reader = [pscustomobject]@{ ReadCount = 0 }
        $reader | Add-Member ScriptMethod ReadAsync {
            $this.ReadCount++
            return [pscustomobject]@{ IsCompleted = $false; IsCompletedSuccessfully = $false; Result = 0 }
        }
        $script:OwnedProcess | Add-Member NoteProperty $stream $reader
    }
    $script:OutBuffer = [char[]]::new(2048); $script:ErrBuffer = [char[]]::new(2048)
    Reset-ObserverReadiness
    $script:Labels = @{}
    foreach ($key in @('status', 'notice', 'hardware', 'last', 'counts')) {
        $script:Labels[$key] = [pscustomobject]@{ Text = '' }
    }
    $script:StartButton = [pscustomobject]@{ Enabled = $false }
    $script:StopButton = [pscustomobject]@{ Enabled = $true }
    $script:RestartButton = [pscustomobject]@{ Enabled = $true }
    $script:Form = [pscustomobject]@{ CloseCount = 0 }
    $script:Form | Add-Member ScriptMethod Close { $this.CloseCount++; $script:Calls.Add('form_close') }
    $script:Http = [pscustomobject]@{}
    $script:Http | Add-Member ScriptMethod SendAsync {
        # Existing endpoint is deliberately modeled as accepting any request. Calling
        # this recorder never constructs HttpClient, opens a socket or reaches a port.
        $script:NetworkCalls++
        return [pscustomobject]@{ IsCompleted = $false; IsCompletedSuccessfully = $false }
    }
    $script:ConnectionToken = '0' * 64 # Public fixture value, not a generated credential.
    $script:OutTask = $null; $script:ErrTask = $null; $script:WriteTask = $null
    $script:HealthTask = $null; $script:BodyTask = $null; $script:HealthResponse = $null
    $script:HealthCancel = $null; $script:HealthRequest = $null
    $script:StopDeadline = $null; $script:KillDeadline = $null
    $script:StartupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    # Avoid health even if a regression accidentally falls past the stopping branch;
    # a separate fake records any attempted SendAsync without opening a socket.
    $script:NextHealth = [DateTime]::UtcNow.AddHours(1)
    $script:Closing = $false; $script:AllowClose = $false
    $script:RestartPending = $false; $script:HealthFailed = $false; $script:HadHealth = $false
}
function Set-OutputChunk([string]$Text) {
    if ($Text.Length -gt $script:OutBuffer.Length) { throw 'fixture_chunk_too_large' }
    $Text.CopyTo(0, $script:OutBuffer, 0, $Text.Length)
    $script:OutTask = [pscustomobject]@{
        IsCompleted = $true; IsCompletedSuccessfully = $true; Result = $Text.Length
    }
}
$script:Assertions = 0

# Actual Start body: ownership and closing guards prevent even runtime discovery.
New-Fixture
& $script:RealStart
Assert-True ($script:OwnedProcess.KillCount -eq 0 -and $script:Calls.Count -eq 0) 'start_owned_guard'
$script:OwnedProcess = $null; $script:Closing = $true
& $script:RealStart
Assert-True ($null -eq $script:OwnedProcess -and $script:Calls.Count -eq 0) 'start_closing_guard'
# Start discovery/new Process/Start are deliberately never executed in this fixture.
function Start-Observer {
    $script:StartCalls++
    $script:StartObservedOldOwner = $null -ne $script:OwnedProcess
    $script:Calls.Add('start')
}

# Ordinary exit never starts again, including repeated idle timer callbacks.
New-Fixture
$original = $script:OwnedProcess
$original.HasExited = $true
Update-Observer
Update-Observer
Assert-True ($original.Disposed -and $null -eq $script:OwnedProcess) 'ordinary_exit_releases_owner'
Assert-True ($script:StartCalls -eq 0) 'ordinary_exit_no_restart'
Assert-True ($script:StartButton.Enabled -and -not $script:StopButton.Enabled) 'ordinary_exit_buttons'
Assert-True ($script:NetworkCalls -eq 0) 'ordinary_exit_no_network'

# Restart click sets explicit intent, requests stop once, and waits for actual exit.
New-Fixture
$original = $script:OwnedProcess
$before = [DateTime]::UtcNow
& $restartClick
Assert-True ($script:RestartPending -and $script:StartCalls -eq 0) 'restart_waits_for_exit'
Assert-True ($original.StandardInput.Writes.Count -eq 1 -and $original.StandardInput.Writes[0] -ceq "stop`n") 'stop_exact_lf'
Assert-True ($script:StopDeadline -ge $before.AddSeconds(5) -and $script:StopDeadline -le [DateTime]::UtcNow.AddSeconds(5)) 'stop_five_second_grace'
$deadline = $script:StopDeadline
Request-ObserverStop
Assert-True ($original.StandardInput.Writes.Count -eq 1 -and $script:StopDeadline -eq $deadline) 'stop_is_idempotent'
Update-Observer
Assert-True ($original.StandardInput.CloseCount -eq 0 -and $original.KillCount -eq 0) 'pending_write_nonblocking'
$original.StandardInput.Task.IsCompleted = $true
Update-Observer
Assert-True ($original.StandardInput.CloseCount -eq 1 -and $original.KillCount -eq 0) 'completed_write_closes_stdin_before_grace'
Assert-True ($script:StartCalls -eq 0) 'restart_still_waits'
$original.HasExited = $true
Update-Observer
Assert-True ($original.Disposed -and $script:StartCalls -eq 1 -and -not $script:StartObservedOldOwner) 'restart_only_after_owned_exit'
Assert-True (-not $script:RestartPending -and $script:Calls.IndexOf('dispose') -lt $script:Calls.IndexOf('start')) 'restart_clears_intent_and_disposes_first'
Update-Observer
Assert-True ($script:StartCalls -eq 1 -and $script:NetworkCalls -eq 0) 'restart_not_repeated'

# Explicit Stop cancels previously requested restart; actual stop button body is used.
New-Fixture
$original = $script:OwnedProcess
$script:RestartPending = $true
& $stopClick
Assert-True (-not $script:RestartPending) 'stop_click_cancels_restart'
$original.HasExited = $true
Update-Observer
Assert-True ($script:StartCalls -eq 0) 'stop_exit_no_restart'

# Actual close handler cancels form close, clears restart intent, and stops gracefully.
New-Fixture
$original = $script:OwnedProcess
$script:RestartPending = $true
$argsObject = [pscustomobject]@{ Cancel = $false }
& $windowClosing $null $argsObject
Assert-True ($argsObject.Cancel -and $script:Closing -and -not $script:RestartPending) 'close_clears_restart_and_defers_window'
Assert-True ($original.StandardInput.Writes.Count -eq 1 -and -not $script:StartButton.Enabled) 'close_requests_stop'
$original.HasExited = $true
Update-Observer
Assert-True ($script:AllowClose -and $script:Form.CloseCount -eq 1 -and $script:StartCalls -eq 0) 'close_after_owned_exit_only'

# Expired grace kills only this fake owner, once, then refuses restart on failed cleanup.
New-Fixture
$original = $script:OwnedProcess
& $restartClick
$script:StopDeadline = [DateTime]::UtcNow.AddMilliseconds(-1)
Update-Observer
Assert-True ($original.KillCount -eq 1 -and $original.KillTree) 'timeout_owned_tree_only'
Assert-True ($script:Calls.IndexOf('stdin_close') -lt $script:Calls.IndexOf('kill')) 'timeout_eof_before_kill'
Update-Observer
Assert-True ($original.KillCount -eq 1 -and $script:StartCalls -eq 0) 'kill_not_repeated_no_overlap'
$script:KillDeadline = [DateTime]::UtcNow.AddMilliseconds(-1)
Update-Observer
Assert-True (-not $script:RestartPending -and $script:StartCalls -eq 0) 'failed_cleanup_refuses_restart'
Assert-True (-not $script:StartButton.Enabled -and -not $script:RestartButton.Enabled) 'failed_cleanup_keeps_start_disabled'
$original.HasExited = $true
Update-Observer
Assert-True ($script:StartCalls -eq 0) 'late_exit_cannot_resurrect_cancelled_restart'

# Closing with refused termination has a bounded confirmation phase and no restart.
New-Fixture
$original = $script:OwnedProcess
$argsObject = [pscustomobject]@{ Cancel = $false }
& $windowClosing $null $argsObject
$script:StopDeadline = [DateTime]::UtcNow.AddMilliseconds(-1)
Update-Observer
$script:KillDeadline = [DateTime]::UtcNow.AddMilliseconds(-1)
Update-Observer
Assert-True ($script:AllowClose -and $script:Form.CloseCount -eq 1 -and $original.KillCount -eq 1) 'close_cleanup_is_bounded'
Assert-True ($script:StartCalls -eq 0 -and $script:NetworkCalls -eq 0 -and -not $script:RestartPending) 'close_cleanup_no_retry_or_network'

# Bind readiness must come from bounded complete owned stdout, not an existing
# endpoint that would happily accept this window's bearer token.
$readyLine = '{"status":"observer_listening","mode":"read-only","port":17376}'
New-Fixture
$script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
Update-Observer
Assert-True (-not $script:ObserverReady -and $script:NetworkCalls -eq 0) 'no_http_before_owned_bind'
Set-OutputChunk ($readyLine.Substring(0, 20))
Update-Observer
Assert-True (-not $script:ObserverReady -and $script:NetworkCalls -eq 0) 'split_readiness_prefix_not_ready'
Set-OutputChunk ($readyLine.Substring(20))
Update-Observer
Assert-True (-not $script:ObserverReady -and $script:NetworkCalls -eq 0) 'complete_json_without_newline_not_ready'
Set-OutputChunk "`n"
Update-Observer
Assert-True ($script:ObserverReady -and $script:NetworkCalls -eq 1) 'complete_owned_readiness_authorizes_first_http'
Update-Observer
Assert-True ($script:NetworkCalls -eq 1) 'pending_health_not_duplicated'
Reset-HealthRequest

# Exact canonical emitter JSON also rejects duplicate keys, extra fields, wrong
# casing/types/mode/port, arbitrary output and oversized partial lines.
foreach ($invalid in @(
    '{"status":"observer_listening","mode":"read-only","port":"17376"}',
    '{"status":"observer_listening","mode":"read-only","port":17377}',
    '{"status":"observer_listening","mode":"read-only","port":17376,"extra":true}',
    '{"status":"observer_listening","mode":"write","port":17376}',
    '{"status":"observer_listening","mode":"read-only","port":17376.0}',
    '{"status":"observer_listening","mode":"read-only","port":17376,"port":17376}',
    '{"status":"observer_listening","mode":"read-only","port":true}',
    '{"status":"Observer_Listening","mode":"read-only","port":17376}',
    'arbitrary untrusted stdout',
    ('x' * 1025)
)) {
    New-Fixture
    $script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
    Set-OutputChunk ($invalid + "`n")
    Update-Observer
    Assert-True (-not $script:ObserverReady -and $script:NetworkCalls -eq 0 -and
        $script:HealthFailed -and $null -ne $script:StopDeadline) 'invalid_readiness_fails_closed'
    Assert-True ($script:OwnedProcess.StandardInput.Writes.Count -eq 1) 'invalid_readiness_stops_owned_process'
}

# A too-long line across chunks is equally bounded; a valid line followed by an
# invalid complete line in one chunk must not authorize HTTP from that chunk.
New-Fixture
Set-OutputChunk ('x' * 1024)
Update-Observer
Assert-True ($script:OutputLine.Length -eq 1024 -and -not $script:ObserverReady) 'partial_line_bound'
Set-OutputChunk 'x'
Update-Observer
Assert-True ($script:HealthFailed -and $script:NetworkCalls -eq 0) 'partial_line_overflow_stops'
New-Fixture
$script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
Set-OutputChunk ($readyLine + "`ninvalid`n")
Update-Observer
Assert-True (-not $script:ObserverReady -and $script:HealthFailed -and $script:NetworkCalls -eq 0) 'invalid_same_chunk_revokes_readiness'

# Unrelated bounded terminal notification is safely ignored, never readiness.
New-Fixture
$script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
Set-OutputChunk "{`"status`":`"observer_finished`",`"reason`":`"no_device`"}`n"
Update-Observer
Assert-True (-not $script:ObserverReady -and -not $script:HealthFailed -and $script:NetworkCalls -eq 0) 'finished_is_not_listening'

# Deadline works even though no HTTP exception can happen before readiness.
New-Fixture
$script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
$script:StartupDeadline = [DateTime]::UtcNow.AddSeconds(-1)
Update-Observer
Assert-True ($script:HealthFailed -and $null -ne $script:StopDeadline -and $script:NetworkCalls -eq 0) 'unready_startup_deadline_stops_without_http'
New-Fixture
$script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
$script:StartupDeadline = [DateTime]::UtcNow.AddSeconds(-1)
Set-OutputChunk ($readyLine + "`n")
Update-Observer
Assert-True (-not $script:ObserverReady -and $script:HealthFailed -and $script:NetworkCalls -eq 0) 'late_readiness_cannot_override_expired_deadline'
New-Fixture
$script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
Set-OutputChunk ''
Update-Observer
Assert-True ($script:HealthFailed -and $null -ne $script:StopDeadline -and $script:NetworkCalls -eq 0) 'startup_stdout_eof_stops_without_http'
New-Fixture
$script:OutTask = [pscustomobject]@{ IsCompleted = $true; IsCompletedSuccessfully = $false; Result = 0 }
Update-Observer
Assert-True ($script:HealthFailed -and $script:NetworkCalls -eq 0) 'startup_stdout_fault_stops_without_http'

# Exit drops readiness, partial line and detached tasks. Completing an old task
# after reset cannot authorize the replacement owner's polling.
New-Fixture
$script:ObserverReady = $true; $script:OutputLine = 'stale prefix'
Set-OutputChunk ($readyLine + "`n")
$detached = $script:OutTask
$script:OwnedProcess.HasExited = $true
Update-Observer
Assert-True (-not $script:ObserverReady -and $script:OutputLine -ceq '' -and $null -eq $script:OutTask) 'exit_resets_readiness_and_tasks'
New-Fixture
$script:ObserverReady = $true; $script:OutputLine = 'stale prefix'; $script:OutTask = $detached
Reset-ObserverReadiness
$script:NextHealth = [DateTime]::UtcNow.AddSeconds(-1)
Update-Observer
Assert-True (-not $script:ObserverReady -and $script:OutputLine -ceq '' -and $null -eq $script:OutTask -and
    $script:NetworkCalls -eq 0) 'restart_reset_cannot_consume_detached_ready_task'

Write-Output ('observer_gui_lifecycle_ok assertions=' + $script:Assertions)
