<#
  STEP 11I-D - restart the DP Cell backend and verify CORS.

  Modifies no source, no .env, no IIS, no database. Runs no migration.
  Stops exactly one process: the one listening on TCP 5000, and only after
  confirming it is a node.exe running this project's server.js.
  Prints no secret: .env is never read or echoed.

  Run in PowerShell (elevated not required unless the backend was started
  by another user):

    powershell -ExecutionPolicy Bypass -File D:\DPCellSalaryWeb\tmp-audit\Step11ID-RestartAndVerify.ps1
#>

$ErrorActionPreference = 'Continue'
$root   = 'D:\DPCellSalaryWeb'
$back   = Join-Path $root 'backend'
$outDir = Join-Path $root 'tmp-audit'
$log    = Join-Path $outDir 'step11id-result.txt'
$svrOut = Join-Path $outDir 'backend-stdout.log'
$svrErr = Join-Path $outDir 'backend-stderr.log'

function Say($m) { $m | Tee-Object -FilePath $log -Append }
Remove-Item $log -ErrorAction SilentlyContinue
Say "===== STEP 11I-D ====="
Say ("Run at: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ""

# ---------- 1/2. identify and verify the process on port 5000 ----------
$before = 'NONE'
$conn = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
if (-not $conn) {
    Say "Backend process before restart: NONE LISTENING ON 5000"
} else {
    $p = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue).CommandLine
    $before = "PID $($conn.OwningProcess)  $($p.ProcessName)  [$($conn.LocalAddress):$($conn.LocalPort)]"
    Say "Backend process before restart: $before"
    Say ("  command line: " + $cmd)

    $isNode    = $p -and $p.ProcessName -match '^node$'
    $isProject = $cmd -and ($cmd -match 'server\.js') -and ($cmd -match 'DPCellSalaryWeb')
    if (-not ($isNode -and $isProject)) {
        Say ""
        Say "ABORT: the process on port 5000 is NOT a verified DP Cell backend."
        Say "       Nothing was stopped. Investigate before continuing."
        exit 1
    }
    Say "  verified: node.exe running this project's server.js -> safe to stop"

    # ---------- 3. stop ONLY that process ----------
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
    Start-Sleep -Seconds 2
    Say "  stopped PID $($conn.OwningProcess)"
}
Say ""

# ---------- 4/5. start again and wait for the listener ----------
Push-Location $back
$proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' `
        -WorkingDirectory $back -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $svrOut -RedirectStandardError $svrErr
Pop-Location

$listening = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $listening = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue |
                 Select-Object -First 1
    if ($listening) { break }
}

if (-not $listening) {
    Say "Backend process after restart: FAILED TO START"
    Say "  stdout tail:"; Get-Content $svrOut -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Say "    $_" }
    Say "  stderr tail:"; Get-Content $svrErr -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Say "    $_" }
    Say ""
    Say "FINAL: FAIL - backend did not come up. Nothing else was changed."
    exit 1
}

$np = Get-Process -Id $listening.OwningProcess -ErrorAction SilentlyContinue
Say ("Backend process after restart: PID $($listening.OwningProcess)  $($np.ProcessName)  " +
     "[$($listening.LocalAddress):$($listening.LocalPort)]")
Say ("Port 5000 listening: YES  (bound to $($listening.LocalAddress))")
Say ""
Say "  server startup output:"
Get-Content $svrOut -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Say "    $_" }
Say ""
# ---------- TEST A: local GET ----------
try {
    $a = Invoke-WebRequest "http://127.0.0.1:5000" -UseBasicParsing -TimeoutSec 10
    Say "Local GET:  $($a.StatusCode)"
} catch {
    Say ("Local GET:  FAILED - " + $_.Exception.Message)
}

# ---------- TEST B: LAN GET ----------
try {
    $b = Invoke-WebRequest "http://10.83.45.101:5000" -UseBasicParsing -TimeoutSec 10
    Say "LAN GET:    $($b.StatusCode)"
} catch {
    Say ("LAN GET:    FAILED - " + $_.Exception.Message)
}

# ---------- TEST C: CORS preflight ----------
$headers = @{
    "Origin"                         = "http://10.83.45.101"
    "Access-Control-Request-Method"  = "POST"
    "Access-Control-Request-Headers" = "content-type"
}
$status = $null; $ao = ''; $am = ''; $ah = ''
try {
    $r = Invoke-WebRequest "http://10.83.45.101:5000/api/auth/login" `
         -Method OPTIONS -Headers $headers -UseBasicParsing -TimeoutSec 10
    $status = $r.StatusCode
    $ao = $r.Headers['Access-Control-Allow-Origin']
    $am = $r.Headers['Access-Control-Allow-Methods']
    $ah = $r.Headers['Access-Control-Allow-Headers']
} catch {
    # Capture the real status and headers from the error response.
    $resp = $_.Exception.Response
    if ($resp) {
        $status = [int]$resp.StatusCode
        try {
            $ao = $resp.Headers['Access-Control-Allow-Origin']
            $am = $resp.Headers['Access-Control-Allow-Methods']
            $ah = $resp.Headers['Access-Control-Allow-Headers']
        } catch { }
        try {
            $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $sr.ReadToEnd(); $sr.Close()
            # First line only, and never echo anything secret-shaped.
            $first = ($body -split "`n" | Select-Object -First 1)
            Say ("  OPTIONS error body (first line): " + $first)
        } catch { }
    } else {
        Say ("  OPTIONS transport error: " + $_.Exception.Message)
    }
}
Say "CORS OPTIONS: $status"
Say "Allow-Origin:  $ao"
Say "Allow-Methods: $am"
Say "Allow-Headers: $ah"
Say ""

# ---------- verdict ----------
$okA = $a -and $a.StatusCode -eq 200
$okB = $b -and $b.StatusCode -eq 200
$okC = ($status -eq 204 -or $status -eq 200)
$okO = ($ao -eq 'http://10.83.45.136')

Say "Files modified: NONE"
Say "Database modified: NO"
Say "IIS modified: NO"
Say "Migrations run: NO"
Say ""
if ($okA -and $okB -and $okC -and $okO) {
    Say "FINAL: PASS"
} else {
    Say "FINAL: FAIL"
    if (-not $okA) { Say "  - local GET did not return 200" }
    if (-not $okB) { Say "  - LAN GET did not return 200" }
    if (-not $okC) { Say "  - preflight did not return 204/200 (got $status)" }
    if (-not $okO) { Say "  - Access-Control-Allow-Origin was '$ao', expected http://10.83.45.101" }
    Say "  Diagnose only - change nothing."
}
Say ""
Say "Result file: $log"
