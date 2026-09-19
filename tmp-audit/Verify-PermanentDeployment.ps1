<#
  VERIFY THE SAME-ORIGIN / IP-INDEPENDENT DEPLOYMENT
  READ-ONLY. Reads files, queries IIS/process/port state, issues HTTP requests.
  Changes no file, no database, no IIS configuration, no process.

      powershell -ExecutionPolicy Bypass -File D:\DPCellSalaryWeb\tmp-audit\Verify-PermanentDeployment.ps1
#>

$ErrorActionPreference = 'Continue'

$OLD_IP   = '10.83.45.136'
$WWWROOT  = 'C:\inetpub\wwwroot'
$FRONTEND = 'D:\DPCellSalaryWeb\frontend'
$BACKEND  = 'D:\DPCellSalaryWeb\backend'
$DIST     = Join-Path $FRONTEND 'dist'
$MACHINE  = $env:COMPUTERNAME

# LAN addresses are DISCOVERED, never hard-coded.
$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
            ForEach-Object { $_.IPAddress })

$script:pass = 0; $script:fail = 0; $script:warn = 0
function Chk($name, $ok, $detail) {
    if ($ok) { $script:pass++; Write-Host ("PASS  " + $name + " " + $detail) }
    else     { $script:fail++; Write-Host ("FAIL  " + $name + " " + $detail) -ForegroundColor Red }
}
function Note($name, $detail) {
    $script:warn++; Write-Host ("WARN  " + $name + " " + $detail) -ForegroundColor Yellow
}

Write-Host "===== PERMANENT (IP-INDEPENDENT) DEPLOYMENT VERIFICATION ====="
Write-Host ("Machine: " + $MACHINE + "   LAN IPv4: " + ($lanIps -join ', '))
Write-Host ""

# ---------- 1 / 2. ports ----------
$p80 = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Chk "1. IIS port 80 listening" ([bool]$p80) $(if ($p80) { "(" + $p80.LocalAddress + ")" })

$p5000 = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
Chk "2. Node port 5000 listening" ([bool]$p5000) $(if ($p5000) { "(" + $p5000.LocalAddress + ")" })

# ---------- 3. node process identity ----------
if ($p5000) {
    $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p5000.OwningProcess) -ErrorAction SilentlyContinue
    $isOurs = $proc -and ($proc.CommandLine -match 'DPCellSalaryWeb') -and ($proc.CommandLine -match 'server\.js')
    Chk "3. Node process is this project's server.js" $isOurs ("(PID " + $p5000.OwningProcess + ")")
    if ($proc) { Write-Host ("      command: " + $proc.CommandLine) }
} else { Chk "3. Node process identity" $false "(nothing on port 5000)" }

# ---------- IIS site ----------
try {
    Import-Module WebAdministration -ErrorAction Stop
    $site = Get-Website -Name 'Default Web Site' -ErrorAction SilentlyContinue
    if ($site) {
        Chk "   IIS site started" ($site.State -eq 'Started') ("(" + $site.State + ", " + $site.PhysicalPath + ", pool " + $site.ApplicationPool + ")")
        Get-WebBinding -Name 'Default Web Site' -EA SilentlyContinue |
            ForEach-Object { Write-Host ("      binding: " + $_.protocol + " " + $_.bindingInformation) }
    } else { Note "   IIS site" "(Default Web Site not found)" }
} catch { Note "   IIS inspection" "(WebAdministration unavailable - run elevated)" }

# ---------- 11. URL Rewrite / ARR ----------
$rewrite = Test-Path 'C:\Windows\System32\inetsrv\rewrite.dll'
$arr     = Test-Path 'C:\Program Files\IIS\Application Request Routing\requestRouter.dll'
Chk "11a. URL Rewrite installed" $rewrite ""
Chk "11b. ARR installed" $arr ""
$proxyOn = $false; $preserveHost = $false
try {
    $ahc = Get-Content 'C:\Windows\System32\inetsrv\config\applicationHost.config' -Raw -ErrorAction Stop
    $proxyOn      = ($ahc -match '<proxy[^>]*enabled\s*=\s*"true"')
    $preserveHost = ($ahc -match '<proxy[^>]*preserveHostHeader\s*=\s*"true"')
} catch { }
Chk "11c. ARR proxy enabled at server level" $proxyOn "(applicationHost.config)"
if ($preserveHost) { Write-Host "      ARR preserveHostHeader = true (tighter: same-origin matched on Host)" }
else { Write-Host "      ARR preserveHostHeader = false (loopback fallback rule applies)" }

# ---------- 10. web.config ----------
$wc = Join-Path $WWWROOT 'web.config'
if (Test-Path $wc) {
    $x = Get-Content $wc -Raw
    Chk "10a. web.config deployed in wwwroot" $true ""
    Chk "10b. web.config proxies /api to loopback" ($x -match '127\.0\.0\.1:5000') ""
    Chk "10c. web.config contains no LAN IP" (-not ($x -match '10\.83\.45\.\d+')) ""
} else { Chk "10. web.config deployed in wwwroot" $false ("(missing: " + $wc + ")") }

# ---------- 2. frontend/.env.production : the value that decides the build ----------
$envProd = Join-Path $FRONTEND '.env.production'
if (Test-Path $envProd) {
    $ep = (Get-Content $envProd -Raw)
    $line = ($ep -split "`r?`n" | Where-Object { $_ -match '^\s*VITE_API_BASE_URL\s*=' } | Select-Object -First 1)
    $value = if ($line) { ($line -split '=', 2)[1].Trim() } else { '' }
    if ($value -eq '') {
        Chk "2. .env.production selects same-origin" $true "(VITE_API_BASE_URL is empty)"
    } else {
        Chk "2. .env.production selects same-origin" $false ("(VITE_API_BASE_URL=" + $value + " -> this value is COMPILED INTO the bundle and overrides the same-origin default; blank it and rebuild)")
    }
} else {
    Chk "2. .env.production selects same-origin" $true "(file absent - production default '' applies)"
}

# ---------- 7 / 8 / 9. production bundle ----------
foreach ($pair in @(@{n='dist'; d=(Join-Path $DIST 'assets')}, @{n='wwwroot'; d=(Join-Path $WWWROOT 'assets')})) {
    if (Test-Path $pair.d) {
        $body = (Get-ChildItem (Join-Path $pair.d '*.js') -EA SilentlyContinue |
                 ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
        $oldHits = ([regex]::Matches($body, [regex]::Escape($OLD_IP))).Count
        $anyLan  = ([regex]::Matches($body, '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b')).Count
        $portHit = ([regex]::Matches($body, ':5000')).Count
        $rel     = ([regex]::Matches($body, '/api/auth/login')).Count
        Chk ("7a. " + $pair.n + " bundle: zero " + $OLD_IP)   ($oldHits -eq 0) ("(hits " + $oldHits + ")")
        Chk ("7b. " + $pair.n + " bundle: zero IPv4 literals") ($anyLan  -eq 0) ("(hits " + $anyLan + ")")
        Chk ("8.  " + $pair.n + " bundle: zero :5000")         ($portHit -eq 0) ("(hits " + $portHit + ")")
        Chk ("9.  " + $pair.n + " bundle: relative /api path") ($rel     -ge 1) ("(hits " + $rel + ")")
    } else { Chk ("7-9. " + $pair.n + " assets folder") $false ("(not found: " + $pair.d + ")") }
}

# ---------- 9b. api configuration source is relative ----------
$cfg = Join-Path $FRONTEND 'src\utils\apiConfig.js'
if (Test-Path $cfg) {
    $c = Get-Content $cfg -Raw
    Chk "9b. apiConfig.js has no LAN IP" (-not ($c -match '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b' -and $c -notmatch '127\.0\.0\.1')) ""
} else { Note "9b. apiConfig.js" "(not found)" }

# ---------- 15. no hard-coded CORS IP ----------
$srv = Join-Path $BACKEND 'server.js'
if (Test-Path $srv) {
    $s = Get-Content $srv -Raw
    Chk "15a. server.js contains no LAN IP" (-not ($s -match '10\.\d{1,3}\.\d{1,3}\.\d{1,3}')) ""
    Chk "15b. server.js decides CORS from the request" (($s -match 'browserFacingHost') -and ($s -match 'arrivedOverLoopback')) ""
} else { Chk "15. server.js" $false "(not found)" }

$envf = Join-Path $BACKEND '.env'
if (Test-Path $envf) {
    $co = (Get-Content $envf | Where-Object { $_ -match '^\s*CORS_ORIGIN\s*=' })
    if ($co) {
        $hasIp = ($co -match '\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b')
        if ($hasIp) { Note "15c. backend\.env CORS_ORIGIN still names a LAN IP" "(harmless now, but no longer required - safe to blank)" }
        else { Chk "15c. backend\.env CORS_ORIGIN has no LAN IP" $true "" }
    } else { Chk "15c. backend\.env CORS_ORIGIN absent (same-origin logic covers it)" $true "" }
}

# ---------- 16. database configuration unchanged ----------
if (Test-Path $envf) {
    $e = Get-Content $envf -Raw
    $dbHostBased = ($e -match 'DB_SERVER\s*=\s*[^\r\n]*\\SQLEXPRESS')
    $dbNoIp      = -not ($e -match 'DB_SERVER\s*=\s*\d{1,3}\.\d{1,3}')
    Chk "16. DB config still hostname-based, no IP" ($dbHostBased -and $dbNoIp) ""
}

# ---------- 4 / 5 / 6 / 13 / 14. live HTTP ----------
$targets = @('http://localhost') + ($lanIps | ForEach-Object { 'http://' + $_ }) + @('http://' + $MACHINE)
$targets = $targets | Select-Object -Unique

foreach ($t in $targets) {
    try {
        $r = Invoke-WebRequest $t -UseBasicParsing -TimeoutSec 10
        $isApp = ($r.Content -match '/assets/index-') -and ($r.Content -notmatch 'iisstart')
        Chk ("4. React served at " + $t) (($r.StatusCode -eq 200) -and $isApp) ("(HTTP " + $r.StatusCode + ", app: " + $isApp + ")")
    } catch { Chk ("4. React served at " + $t) $false ("(" + $_.Exception.Message + ")") }
}

foreach ($t in $targets) {
    $u = $t + '/api/auth/login'
    try {
        $r = Invoke-WebRequest $u -Method POST -Body '{}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
        Chk ("5/6/13. POST " + $u) ($r.StatusCode -lt 500) ("(HTTP " + $r.StatusCode + ")")
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $code = [int]$resp.StatusCode
            $why = switch ($code) {
                400 { " - Node validated and rejected the empty body: proxy WORKS" }
                401 { " - Node answered: proxy WORKS" }
                404 { " - rewrite rule did not match" }
                502 { " - ARR cannot reach Node" }
                500 { " - Node errored (CORS rejection?)" }
                default { "" }
            }
            Chk ("5/6/13. POST " + $u) (($code -eq 400) -or ($code -eq 401)) ("(HTTP " + $code + $why + ")")
        } else { Chk ("5/6/13. POST " + $u) $false ("(" + $_.Exception.Message + ")") }
    }
}

# ---------- 12. CORS preflight through IIS, per address ----------
foreach ($t in $targets) {
    $h = @{ "Origin" = $t; "Access-Control-Request-Method" = "POST"; "Access-Control-Request-Headers" = "content-type" }
    $u = $t + '/api/auth/login'
    $st = $null; $ao = ''
    try {
        $r = Invoke-WebRequest $u -Method OPTIONS -Headers $h -UseBasicParsing -TimeoutSec 10
        $st = $r.StatusCode; $ao = $r.Headers['Access-Control-Allow-Origin']
    } catch {
        $resp = $_.Exception.Response
        if ($resp) { $st = [int]$resp.StatusCode; try { $ao = $resp.Headers['Access-Control-Allow-Origin'] } catch { } }
    }
    Chk ("12. CORS preflight from Origin " + $t) (($st -eq 204) -or ($st -eq 200)) ("(HTTP " + $st + ", Allow-Origin '" + $ao + "')")
}

# ---------- 14. hostname access ----------
$hostUrl = 'http://' + $MACHINE
try { $null = Invoke-WebRequest $hostUrl -UseBasicParsing -TimeoutSec 8
      Chk ("14. hostname access works (" + $hostUrl + ")") $true "" }
catch { Note ("14. hostname access (" + $hostUrl + ")") "(not resolvable from this machine - ask IT for a DNS record if users need it)" }

# ---------- backend direct on loopback ----------
try { $r = Invoke-WebRequest 'http://127.0.0.1:5000/' -UseBasicParsing -TimeoutSec 10
      Chk "   Node health on 127.0.0.1:5000" ($r.StatusCode -eq 200) ("(HTTP " + $r.StatusCode + ")") }
catch { Chk "   Node health on 127.0.0.1:5000" $false ("(" + $_.Exception.Message + ")") }

Write-Host ""
Write-Host ("===== " + $script:pass + " passed, " + $script:fail + " failed, " + $script:warn + " warnings =====")
Write-Host "Browser check still required: DevTools > Network, log in, confirm"
Write-Host "  POST http://<server>/api/auth/login     and NOT  ...:5000/api/auth/login"
