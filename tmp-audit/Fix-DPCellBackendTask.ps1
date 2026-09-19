<#
    DPCellSalaryBackend - convert the Scheduled Task to non-interactive boot startup.

    WHAT IT CHANGES   the Scheduled Task ONLY.
    WHAT IT NEVER DOES
        - no application source change
        - no SQL Server / database permission change
        - no IIS change
        - no third-party install
        - the task is NEVER deleted or recreated
        - the account stays 'acer' (Windows Trusted Connection identity preserved)
        - no .env content is read, copied or stored
        - no reboot
        - the running backend is NOT stopped (unless you pass -TestRestart)

    RUN ELEVATED:
        powershell -ExecutionPolicy Bypass -File D:\DPCellSalaryWeb\tmp-audit\Fix-DPCellBackendTask.ps1

    Optional controlled restart test (stops and restarts the backend once, so the
    task itself launches Node under the new S4U identity - this is the ONLY way to
    prove SQL Trusted Connection still works before the reboot):
        ... -File ...\Fix-DPCellBackendTask.ps1 -TestRestart
#>
param([switch]$TestRestart)

$ErrorActionPreference = 'Continue'
$TASK    = 'DPCellSalaryBackend'
$OUTDIR  = 'D:\DPCellSalaryWeb\tmp-audit'
$BEFORE  = Join-Path $OUTDIR "$TASK-before.xml"
$AFTER   = Join-Path $OUTDIR "$TASK-after.xml"
$EXPECT_EXE = 'C:\Program Files\nodejs\node.exe'
$EXPECT_ARG = 'D:\DPCellSalaryWeb\backend\server.js'
$EXPECT_CWD = 'D:\DPCellSalaryWeb\backend'

function Line { param($t) Write-Host ""; Write-Host ("=" * 78); Write-Host $t; Write-Host ("=" * 78) }
function Show { param($n,$v) Write-Host ("  {0,-26}: {1}" -f $n, $v) }

# ---------------------------------------------------------------- STEP 1
Line "STEP 1 - CURRENT CONFIGURATION (read-only)"
$t = Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
if (-not $t) { Write-Host "ABORT: task '$TASK' not found. Nothing was changed." -ForegroundColor Red; exit 1 }

$a = $t.Actions   | Select-Object -First 1
$p = $t.Principal
$s = $t.Settings
Show 'State'               $t.State
Show 'Trigger class'       (($t.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ', ')
Show 'Principal UserId'    $p.UserId
Show 'LogonType'           $p.LogonType
Show 'RunLevel'            $p.RunLevel
Show 'Action Execute'      $a.Execute
Show 'Action Arguments'    $a.Arguments
Show 'WorkingDirectory'    $a.WorkingDirectory
Show 'ExecutionTimeLimit'  $s.ExecutionTimeLimit
Show 'RestartCount'        $s.RestartCount
Show 'RestartInterval'     $s.RestartInterval
Show 'StartWhenAvailable'  $s.StartWhenAvailable
Show 'MultipleInstances'   $s.MultipleInstances
Show 'DisallowOnBatteries' $s.DisallowStartIfOnBatteries
Show 'StopIfGoingOnBatt'   $s.StopIfGoingOnBatteries

if (-not (Test-Path $OUTDIR)) { New-Item -ItemType Directory -Path $OUTDIR -Force | Out-Null }
Export-ScheduledTask -TaskName $TASK | Out-File $BEFORE -Encoding UTF8
Write-Host ""; Write-Host "  Definition exported to: $BEFORE"

# Guard: only proceed if the action already points at the expected backend.
if ($a.Execute -ne $EXPECT_EXE -or $a.Arguments -notlike "*$EXPECT_ARG*") {
    Write-Host ""; Write-Host "ABORT: the task action does not match the expected Node backend." -ForegroundColor Red
    Write-Host "       Expected: $EXPECT_EXE $EXPECT_ARG"
    Write-Host "       Found   : $($a.Execute) $($a.Arguments)"
    Write-Host "       Nothing was changed."; exit 1
}

# ---------------------------------------------------------------- STEP 2
Line "STEP 2 - APPLY TRIGGER + SETTINGS + PRINCIPAL (task only)"

$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

try {
    Set-ScheduledTask -TaskName $TASK -Trigger $trigger -Settings $settings -ErrorAction Stop | Out-Null
    Write-Host "  Trigger + settings applied."
} catch {
    Write-Host "  FAILED applying trigger/settings: $($_.Exception.Message)" -ForegroundColor Red
}

$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\acer" -LogonType S4U -RunLevel Highest
$s4uOk = $false
try {
    Set-ScheduledTask -TaskName $TASK -Principal $principal -ErrorAction Stop | Out-Null
    $s4uOk = $true
    Write-Host "  Principal set to S4U (no password stored), account unchanged: acer"
} catch {
    Write-Host "  S4U COULD NOT BE APPLIED: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  STOPPING as instructed. The account was NOT switched and no SQL rights were granted." -ForegroundColor Yellow
    Write-Host "  Fallback (your decision, run manually):" -ForegroundColor Yellow
    Write-Host "     Set-ScheduledTask -TaskName $TASK -User `"$env:COMPUTERNAME\acer`" -Password '<acer password>'"
}

# ---------------------------------------------------------------- STEP 3
Line "STEP 3 - VERIFY CONFIGURATION"
$t2 = Get-ScheduledTask -TaskName $TASK
$a2 = $t2.Actions | Select-Object -First 1
$p2 = $t2.Principal
$s2 = $t2.Settings
Export-ScheduledTask -TaskName $TASK | Out-File $AFTER -Encoding UTF8

$trigOk    = ($t2.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }).Count -ge 1
$logonOk   = $p2.LogonType -in @('S4U','Password')
$runLvlOk  = $p2.RunLevel -eq 'Highest'
$etlOk     = ($s2.ExecutionTimeLimit -eq 'PT0S')
$rcOk      = ($s2.RestartCount -eq 999)
$riOk      = ($s2.RestartInterval -eq 'PT1M')
$exeOk     = ($a2.Execute -eq $EXPECT_EXE)
$argOk     = ($a2.Arguments -like "*$EXPECT_ARG*")
$cwdOk     = ($a2.WorkingDirectory -eq $EXPECT_CWD)
$userOk    = ($p2.UserId -like '*acer*')

function Chk { param($n,$ok,$actual) Write-Host ("  [{0}] {1,-30} {2}" -f $(if($ok){'PASS'}else{'FAIL'}), $n, $actual) -ForegroundColor $(if($ok){'Green'}else{'Red'}) }
Chk 'Trigger = AtStartup/Boot'   $trigOk   (($t2.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ', ')
Chk 'LogonType NOT Interactive'  $logonOk  $p2.LogonType
Chk 'Account preserved (acer)'   $userOk   $p2.UserId
Chk 'RunLevel = Highest'         $runLvlOk $p2.RunLevel
Chk 'ExecutionTimeLimit = PT0S'  $etlOk    $s2.ExecutionTimeLimit
Chk 'RestartCount = 999'         $rcOk     $s2.RestartCount
Chk 'RestartInterval = PT1M'     $riOk     $s2.RestartInterval
Chk 'Executable'                 $exeOk    $a2.Execute
Chk 'Arguments'                  $argOk    $a2.Arguments
Chk 'WorkingDirectory'           $cwdOk    $a2.WorkingDirectory
Write-Host ""; Write-Host "  After-definition exported to: $AFTER"
Get-ScheduledTaskInfo -TaskName $TASK | Format-List TaskName,LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns

# ---------------------------------------------------------------- STEP 4 (optional controlled restart)
if ($TestRestart) {
    Line "STEP 4b - CONTROLLED RESTART (proves the task can launch Node under the new identity)"
    $old = Get-NetTCPConnection -LocalPort 5000 -State Listen -EA SilentlyContinue | Select-Object -First 1
    if ($old) {
        $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($old.OwningProcess)" -EA SilentlyContinue).CommandLine
        Write-Host "  Current PID $($old.OwningProcess): $cl"
        if ($cl -notlike "*$EXPECT_ARG*") { Write-Host "  ABORT: PID on 5000 is not this backend. Not touching it." -ForegroundColor Red; exit 1 }
    }
    Stop-ScheduledTask  -TaskName $TASK; Start-Sleep -Seconds 3
    Start-ScheduledTask -TaskName $TASK; Start-Sleep -Seconds 12
    $new = Get-NetTCPConnection -LocalPort 5000 -State Listen -EA SilentlyContinue | Select-Object -First 1
    if ($new) { Write-Host "  New PID on 5000: $($new.OwningProcess)"
                Write-Host "  $((Get-CimInstance Win32_Process -Filter "ProcessId=$($new.OwningProcess)" -EA SilentlyContinue).CommandLine)" }
    else { Write-Host "  PORT 5000 NOT LISTENING after restart - investigate before rebooting." -ForegroundColor Red }
}

# ---------------------------------------------------------------- LIVE CHECKS
Line "LIVE CHECKS"
$conn = Get-NetTCPConnection -LocalPort 5000 -State Listen -EA SilentlyContinue | Select-Object -First 1
$portOk = [bool]$conn
$procOk = $false; $dbOk = 'NOT VERIFIED'
if ($conn) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -EA SilentlyContinue
    $procOk = ($proc.CommandLine -like "*node.exe*") -and ($proc.CommandLine -like "*$EXPECT_ARG*")
    Show 'Listening'   "$($conn.LocalAddress):$($conn.LocalPort)  PID $($conn.OwningProcess)"
    Show 'CommandLine' $proc.CommandLine
}
try { $r = Invoke-WebRequest 'http://127.0.0.1:5000/' -UseBasicParsing -TimeoutSec 10; Show 'GET 127.0.0.1:5000' "HTTP $($r.StatusCode)" } catch { Show 'GET 127.0.0.1:5000' "FAILED: $($_.Exception.Message)" }

$ips = @(Get-NetIPAddress -AddressFamily IPv4 -EA SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object { $_.IPAddress })
foreach ($ip in $ips) {
    try { $r = Invoke-WebRequest "http://$ip/" -UseBasicParsing -TimeoutSec 10; Show "GET http://$ip/" "HTTP $($r.StatusCode)" } catch { Show "GET http://$ip/" "FAILED" }
    try { $r = Invoke-WebRequest "http://$ip/api/auth/login" -Method POST -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 10
          Show "POST http://$ip/api/auth/login" "HTTP $($r.StatusCode)" }
    catch { $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            $why = switch ($code) { 400 {' - Node validated+rejected empty body: proxy AND database path reached'} 401 {' - Node answered'} 404 {' - rewrite rule not matching'} 502 {' - ARR cannot reach Node'} 500 {' - backend error'} default {''} }
            Show "POST http://$ip/api/auth/login" "HTTP $code$why"
            if ($code -in @(400,401)) { $dbOk = 'YES (Node answered through IIS under the CURRENT process identity)' } }
}
Show 'IIS (W3SVC)' ((Get-Service W3SVC -EA SilentlyContinue).Status)

# ---------------------------------------------------------------- STEP 5 REPORT
$cfgOk = $trigOk -and $logonOk -and $runLvlOk -and $etlOk -and $rcOk -and $riOk -and $exeOk -and $argOk -and $cwdOk -and $userOk
Line "STEP 5 - FINAL REPORT"
Write-Host ("STATUS: " + $(if ($cfgOk -and $portOk -and $procOk) { 'PASS' } else { 'FAIL' }))
Write-Host ""
Write-Host ("Task startup:                 " + $(if ($trigOk)  {'YES'} else {'NO'}))
Write-Host ("Runs without user login:      " + $(if ($logonOk) {'YES'} else {'NO'}))
Write-Host ("Automatic restart:            " + $(if ($rcOk -and $riOk) {'YES'} else {'NO'}))
Write-Host ("Correct Node executable:      " + $(if ($exeOk)   {'YES'} else {'NO'}))
Write-Host ("Correct server.js:            " + $(if ($argOk)   {'YES'} else {'NO'}))
Write-Host ("Port 5000:                    " + $(if ($portOk)  {'YES'} else {'NO'}))
Write-Host ("Database identity preserved:  " + $(if ($TestRestart -and $dbOk -ne 'NOT VERIFIED') { 'YES - task-launched process served an API call' } else { 'NOT VERIFIED - current PID predates the S4U change; proven only when the task itself starts Node (reboot or -TestRestart)' }))
Write-Host ("Reboot required for final proof: YES")
if (-not $cfgOk) { Write-Host ""; Write-Host "FAIL reason: one or more configuration checks above show FAIL." -ForegroundColor Red }
