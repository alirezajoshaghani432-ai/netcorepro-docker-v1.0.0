# NetCore Pro - Windows Uninstaller (PowerShell)
# Removes the IIS Site, App Pool, and firewall rules created by install.ps1.

param(
    [string]$SitePath = "C:\inetpub\netcorepro",
    [string]$SiteName = "NetCorePro",
    [string]$AppPool  = "NetCoreProPool",
    [switch]$KeepFiles
)

$ErrorActionPreference = "Continue"
Import-Module WebAdministration

if (Test-Path "IIS:\Sites\$SiteName") {
    Write-Host "Removing IIS site $SiteName ..." -ForegroundColor Yellow
    Remove-Website -Name $SiteName
}

if (Test-Path "IIS:\AppPools\$AppPool") {
    Write-Host "Removing App Pool $AppPool ..." -ForegroundColor Yellow
    Remove-WebAppPool -Name $AppPool
}

Get-NetFirewallRule -DisplayName "NetCore Pro *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if (-not $KeepFiles -and (Test-Path $SitePath)) {
    Write-Host "Deleting $SitePath ..." -ForegroundColor Yellow
    Remove-Item -Path $SitePath -Recurse -Force
}

Write-Host "NetCore Pro uninstalled." -ForegroundColor Green
