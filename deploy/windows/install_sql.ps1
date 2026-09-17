# NetCore Pro - SQL Server Schema Installer (PowerShell)
# Applies dist\db\schema.mssql.sql against a target SQL Server instance.
# Fallback: scripts\db\mssql_schema.sql (copy of the same schema).
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
$schemaFile  = Join-Path $projectRoot "dist\db\schema.mssql.sql"
$fallback    = Join-Path $projectRoot "scripts\db\mssql_schema.sql"

if (-not (Test-Path $schemaFile)) {
    if (Test-Path $fallback) { $schemaFile = $fallback }
    else { throw "Schema file not found: $schemaFile" }
}

Write-Host "Schema: $schemaFile" -ForegroundColor White

# Ensure the database exists, then apply the idempotent IF OBJECT_ID schema.
$ensureDb = @"
IF DB_ID(N'$SqlDatabase') IS NULL CREATE DATABASE [$SqlDatabase];
"@

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
    Write-Host "sqlcmd not found. Installing SqlServer module..." -ForegroundColor Yellow
    Install-Module -Name SqlServer -Scope CurrentUser -Force -AllowClobber
    Import-Module SqlServer
    Invoke-Sqlcmd -ServerInstance $SqlServer -Username $SqlUser -Password $SqlPassword -Query $ensureDb
    $sql = Get-Content $schemaFile -Raw
    Invoke-Sqlcmd -ServerInstance $SqlServer -Username $SqlUser -Password $SqlPassword -Database $SqlDatabase -Query $sql
} else {
    Write-Host "Ensuring database $SqlDatabase on $SqlServer ..." -ForegroundColor Cyan
    sqlcmd -S $SqlServer -U $SqlUser -P $SqlPassword -Q $ensureDb
    Write-Host "Applying schema ..." -ForegroundColor Cyan
    sqlcmd -S $SqlServer -U $SqlUser -P $SqlPassword -d $SqlDatabase -i $schemaFile
}

Write-Host "SQL Server schema applied successfully." -ForegroundColor Green
Write-Host "Database: $SqlDatabase" -ForegroundColor White
