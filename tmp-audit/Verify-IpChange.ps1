<#
  VERIFY THE 10.83.45.136 -> 10.83.45.101 CHANGE
  Read-only. Changes no file, no database, no IIS, no process.
  Run AFTER editing .env.production, rebuilding and redeploying.

    powershell -ExecutionPolicy Bypass -File D:\DPCellSalaryWeb\tmp-audit\Verify-IpChange.ps1
#>
$ErrorActionPreference = 'Continue'
$NEW = '10.83.45.101'; $OLD = '10.83.45.136'
$pass = 0; $fail = 0
function Chk($name, $ok, $detail) {
    if ($ok) { $script:pass++; Write-Host "PASS  $name $detail" }
    else     { $script:fail++; Write-Host "FAIL  $name $detail" -ForegroundColor Red }
}
Write-Host "===== IP CHANGE VERIFICATION =====`n"

# 1. server IP
$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $NEW })
Chk "1. Server Ethernet IP is $NEW" ([bool]$ips) ""

# 2. .env.production
$envp = Get-Content 'D:\DPCellSalaryWeb\frontend\.env.production' -Raw
Chk "2. .env.production uses ${NEW}:5000" ($envp -match [regex]::Escape("$NEW`:5000")) ""
Chk "   .env.production no longer has $OLD" (-not ($envp -match [regex]::Escape($OLD))) ""

# 3/4. built bundle  +  deployed bundle
foreach ($p in @(@{n='dist';d='D:\DPCellSalaryWeb\frontend\dist\assets'},
                 @{n='wwwroot';d='C:\inetpub\wwwroot\assets'})) {
    if (Test-Path $p.d) {
        $newHits = (Select-String "$($p.d)\*.js" -Pattern ([regex]::Escape("$NEW`:5000")) -ErrorAction SilentlyContinue | Measure-Object).Count
        $oldHits = (Select-String "$($p.d)\*.js" -Pattern ([regex]::Escape($OLD))        -ErrorAction SilentlyContinue | Measure-Object).Count
        Chk "3. $($p.n) bundle contains ${NEW}:5000" ($newHits -ge 1) "(hits: $newHits)"
        Chk "4. $($p.n) bundle contains no $OLD"     ($oldHits -eq 0) "(hits: $oldHits)"
    } else { Chk "3/4. $($p.n) assets folder exists" $false "(not found: $($p.d))" }
}

# 5. backend process + port
$conn = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Chk "5. Backend listening on port 5000" ([bool]$conn) $(if ($conn) { "(PID $($conn.OwningProcess), $($conn.LocalAddress))" })
if ($conn) {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -EA SilentlyContinue).CommandLine
    Write-Host "      command: $cmd"
}

# 6/7. HTTP
foreach ($u in @("http://localhost:5000", "http://${NEW}:5000")) {
    try { $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 10
          Chk "6/7. GET $u" ($r.StatusCode -eq 200) "(HTTP $($r.StatusCode))" }
    catch { Chk "6/7. GET $u" $false "($($_.Exception.Message))" }
}

# old IP must NOT be needed
$t = Test-NetConnection $OLD -Port 5000 -WarningAction SilentlyContinue -InformationLevel Quiet
Write-Host "INFO  old IP $OLD`:5000 reachable = $t  (expected False; not required)"

# 8. CORS preflight
$h = @{ "Origin" = "http://$NEW"; "Access-Control-Request-Method" = "POST"; "Access-Control-Request-Headers" = "content-type" }
$st = $null; $ao = ''
try {
    $r = Invoke-WebRequest "http://${NEW}:5000/api/auth/login" -Method OPTIONS -Headers $h -UseBasicParsing -TimeoutSec 10
    $st = $r.StatusCode; $ao = $r.Headers['Access-Control-Allow-Origin']
} catch {
    $resp = $_.Exception.Response
    if ($resp) { $st = [int]$resp.StatusCode; try { $ao = $resp.Headers['Access-Control-Allow-Origin'] } catch {} }
    else { Write-Host "      transport error: $($_.Exception.Message)" }
}
Chk "8. CORS preflight returns 204/200" (($st -eq 204) -or ($st -eq 200)) "(HTTP $st)"
Chk "   Allow-Origin is http://$NEW" ($ao -eq "http://$NEW") "(got '$ao')"
if ($st -eq 500) { Write-Host "      HINT: 500 here means the running backend still holds the OLD CORS_ORIGIN. Restart it." -ForegroundColor Yellow }

Write-Host "`n===== $pass passed, $fail failed ====="
if ($fail -eq 0) { Write-Host "Static + network checks PASS. Still confirm the browser login in DevTools > Network." }
