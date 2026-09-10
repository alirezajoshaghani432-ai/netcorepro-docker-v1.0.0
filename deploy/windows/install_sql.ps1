# NetCore Pro - SQL Server Schema Installer (PowerShell)
# Applies scripts\db\mssql_schema.sql against a target SQL Server instance.
#
# Usage:
#   PS> .\install_sql.ps1 -SqlServer "localhost" -SqlUser "sa" -SqlPassword "YourStrong!Passw0rd"

param(
    [string]$SqlServer   = "localhost",
    [string]$SqlUser     = "sa",
    [Parameter(Mandatory=$true)][string]$SqlPassword,
    [string]$SqlDatabase = "netcorepro"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$schemaFile  = Join-Path $projectRoot "scripts\db\mssql_schema.sql"

if (-not (Test-Path $schemaFile)) {
    throw "Schema file not found: $schemaFile"
}

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
    Write-Host "sqlcmd not found. Installing SqlServer module..." -ForegroundColor Yellow
    Install-Module -Name SqlServer -Scope CurrentUser -Force -AllowClobber
    Import-Module SqlServer
    $sql = Get-Content $schemaFile -Raw
    Invoke-Sqlcmd -ServerInstance $SqlServer -Username $SqlUser -Password $SqlPassword -Query $sql
} else {
    Write-Host "Applying schema to $SqlServer ..." -ForegroundColor Cyan
    sqlcmd -S $SqlServer -U $SqlUser -P $SqlPassword -i $schemaFile
}

Write-Host "SQL Server schema applied successfully." -ForegroundColor Green
Write-Host "Database: $SqlDatabase" -ForegroundColor White
