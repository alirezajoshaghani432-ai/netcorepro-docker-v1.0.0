# NetCore Pro - Windows Server Installation Script (PowerShell)
# Run as Administrator on Windows Server 2019/2022.
#
# Usage:
#   PS> Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   PS> .\install.ps1
#
# What it does:
#   1. Checks for Node.js 20 / npm and installs via Chocolatey if missing.
#   2. Installs IIS roles + URL Rewrite + iisnode.
#   3. Creates application pool and IIS site bound to C:\inetpub\netcorepro.
#   4. Opens firewall ports 80/443 and 1433 (SQL).
#   5. Runs npm ci + npm run build.
#   6. Optional: applies SQL Server schema (mssql_schema.sql).

param(
    [string]$SitePath  = "C:\inetpub\netcorepro",
    [string]$SiteName  = "NetCorePro",
    [string]$AppPool   = "NetCoreProPool",
    [int]   $HttpPort  = 80,
    [int]   $HttpsPort = 443,
    [string]$Hostname  = "",
    [switch]$SkipSql,
    [string]$SqlServer   = "localhost",
    [string]$SqlUser     = "sa",
    [string]$SqlPassword = "",
    [string]$SqlDatabase = "netcorepro"
)

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  NetCore Pro - Windows / IIS Installer"        -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

# 1. Admin check
$current = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($current)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run as Administrator."
}

# 2. Chocolatey
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "[1/8] Installing Chocolatey..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
} else {
    Write-Host "[1/8] Chocolatey already installed." -ForegroundColor Green
}

# 3. Node.js 20
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[2/8] Installing Node.js 20 LTS..." -ForegroundColor Yellow
    choco install nodejs-lts -y --version=20.18.1
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "[2/8] Node.js detected: $(node --version)" -ForegroundColor Green
}

# 4. IIS roles
Write-Host "[3/8] Installing IIS roles + features..." -ForegroundColor Yellow
$iisFeatures = @(
    "Web-Server","Web-WebServer","Web-Common-Http","Web-Default-Doc","Web-Static-Content",
    "Web-Http-Errors","Web-Http-Logging","Web-Stat-Compression","Web-Filtering",
    "Web-Mgmt-Console","Web-AppInit"
)
Install-WindowsFeature -Name $iisFeatures -IncludeManagementTools | Out-Null

# 5. URL Rewrite + iisnode
if (-not (Test-Path "C:\Windows\System32\inetsrv\rewrite.dll")) {
    Write-Host "[4/8] Installing URL Rewrite 2.x..." -ForegroundColor Yellow
    choco install urlrewrite -y
} else {
    Write-Host "[4/8] URL Rewrite already installed." -ForegroundColor Green
}

if (-not (Test-Path "C:\Program Files\iisnode")) {
    Write-Host "[4/8] Installing iisnode..." -ForegroundColor Yellow
    choco install iisnode -y
} else {
    Write-Host "[4/8] iisnode already installed." -ForegroundColor Green
}

# 6. Site directory + copy files
Write-Host "[5/8] Preparing site directory $SitePath ..." -ForegroundColor Yellow
if (-not (Test-Path $SitePath)) {
    New-Item -ItemType Directory -Path $SitePath -Force | Out-Null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Write-Host "      Copying application files from $projectRoot ..."
$exclude = @("node_modules","logs","data\*.db*","dist","\.env\.production")
robocopy $projectRoot $SitePath /MIR /XD node_modules logs dist /XF *.db *.db-wal *.db-shm .env.production | Out-Null

# Copy web.config to site root
Copy-Item "$projectRoot\deploy\windows\web.config" "$SitePath\web.config" -Force

# 7. npm ci + build
Write-Host "[6/8] Running npm ci & build..." -ForegroundColor Yellow
Push-Location $SitePath
try {
    npm ci --omit=dev
    npm install -D typescript tsx @types/node @types/bcryptjs @types/better-sqlite3 @types/jsonwebtoken
    npm run build
} finally { Pop-Location }

# 8. IIS App Pool + Site
Write-Host "[7/8] Creating IIS App Pool & Site..." -ForegroundColor Yellow
Import-Module WebAdministration
if (Test-Path "IIS:\AppPools\$AppPool") {
    Remove-WebAppPool -Name $AppPool
}
New-WebAppPool -Name $AppPool
Set-ItemProperty "IIS:\AppPools\$AppPool" -Name "managedRuntimeVersion" -Value ""
Set-ItemProperty "IIS:\AppPools\$AppPool" -Name "processModel.identityType" -Value "ApplicationPoolIdentity"

if (Test-Path "IIS:\Sites\$SiteName") { Remove-Website -Name $SiteName }
New-Website -Name $SiteName -PhysicalPath $SitePath -ApplicationPool $AppPool -Port $HttpPort -HostHeader $Hostname -Force | Out-Null

# Grant ApplicationPoolIdentity full control
$acl = Get-Acl $SitePath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("IIS APPPOOL\$AppPool","FullControl","ContainerInherit,ObjectInherit","None","Allow")
$acl.SetAccessRule($rule)
Set-Acl $SitePath $acl

# 9. Firewall
Write-Host "[8/8] Opening firewall ports..." -ForegroundColor Yellow
New-NetFirewallRule -DisplayName "NetCore Pro HTTP"  -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpPort  -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "NetCore Pro HTTPS" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpsPort -ErrorAction SilentlyContinue | Out-Null
if (-not $SkipSql) {
    New-NetFirewallRule -DisplayName "NetCore Pro SQL" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1433 -ErrorAction SilentlyContinue | Out-Null
}

# 10. Optional SQL schema
if (-not $SkipSql -and $SqlPassword -ne "") {
    if (Get-Command sqlcmd -ErrorAction SilentlyContinue) {
        Write-Host "      Applying SQL Server schema..." -ForegroundColor Yellow
        sqlcmd -S $SqlServer -U $SqlUser -P $SqlPassword -i "$projectRoot\scripts\db\mssql_schema.sql"
    } else {
        Write-Host "      sqlcmd not found - skipping schema apply (run scripts\db\install_sql.ps1 manually)" -ForegroundColor DarkYellow
    }
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host " Installation completed!"                       -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host " Site URL:    http://localhost:$HttpPort"        -ForegroundColor White
Write-Host " Admin:       http://localhost:$HttpPort/admin/login" -ForegroundColor White
Write-Host " Health:      http://localhost:$HttpPort/api/health"  -ForegroundColor White
Write-Host " Site Path:   $SitePath"                          -ForegroundColor White
Write-Host " App Pool:    $AppPool"                           -ForegroundColor White
Write-Host ""
Write-Host " Default credentials:"                            -ForegroundColor Yellow
Write-Host "   admin@netcorepro.ir / admin123"                -ForegroundColor Yellow
Write-Host "   customer@example.com / 123456"                 -ForegroundColor Yellow
Write-Host ""
