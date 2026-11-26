# One-time setup of a DEVELOPMENT machine (Windows, no Docker). Run inside the cloned backend repo:
#   powershell -ExecutionPolicy Bypass -File scripts\dev\setup.ps1 -AiRepo <git url of AIService> [-CopyDir <folder from export-prod-copy.ps1>]
# Layout it makes (next to this repo):   <root>\NestjsBE   <root>\JobAura   <root>\AIService
# Needs, installed first: Git, Node.js 20+, Python 3.12, PostgreSQL 17 (winget commands are printed if missing).
# Safe to run again: it skips what is already done and never overwrites an existing .env.
param(
  [string]$AiRepo,
  [string]$FrontendRepo = 'https://github.com/Tai874vn/JobAura.git',
  [string]$CopyDir,
  [string]$PgSuperUser = 'postgres',
  [string]$PgHost = 'localhost',
  [int]$PgPort = 5432,
  [string]$DbName = 'jobaura_dev',
  [string]$DbUser = 'jobaura',
  [string]$DbPassword = 'jobaura_password'
)
$ErrorActionPreference = 'Stop'
$Backend = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Root = Split-Path $Backend -Parent
$Frontend = Join-Path $Root 'JobAura'
$Ai = Join-Path $Root 'AIService'
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Need($cmd, $install) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found. Install it: $install (then open a new terminal)" }
}
function New-Secret([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function Set-EnvValue([string]$file, [string]$key, [string]$value) {
  $lines = Get-Content $file
  $found = $false
  $lines = $lines | ForEach-Object { if ($_ -match "^\s*$key\s*=") { $found = $true; "$key=`"$value`"" } else { $_ } }
  if (-not $found) { $lines += "$key=`"$value`"" }
  Set-Content -Path $file -Value $lines -Encoding utf8
}

Step 'Tools'
Need git 'winget install Git.Git'
Need node 'winget install OpenJS.NodeJS.LTS'
Need python 'winget install Python.Python.3.12'
# PostgreSQL's bin folder is often not on PATH after install.
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  $pgBin = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin' -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($pgBin) { $env:Path = "$($pgBin.FullName);$env:Path" }
}
Need psql 'winget install PostgreSQL.PostgreSQL.17'
Need pg_restore 'winget install PostgreSQL.PostgreSQL.17'
corepack enable 2>$null
Write-Host "node $(node -v), python $(python --version), $(psql --version)"

Step 'Repositories'
if (-not (Test-Path $Frontend)) { git clone $FrontendRepo $Frontend } else { Write-Host "frontend: $Frontend (already there)" }
if (-not (Test-Path $Ai)) {
  if ($AiRepo) { git clone $AiRepo $Ai } else { Write-Host 'AI service skipped: pass -AiRepo <url> to clone it.' -ForegroundColor Yellow }
} else { Write-Host "ai: $Ai (already there)" }

Step '.env files (existing files are kept)'
$sharedAiKey = New-Secret 32
if (-not (Test-Path "$Backend\.env")) {
  Copy-Item "$Backend\.env.example" "$Backend\.env"
  Set-EnvValue "$Backend\.env" 'JWT_SECRET' (New-Secret 64)
  Set-EnvValue "$Backend\.env" 'AI_SERVICE_API_KEY' $sharedAiKey
  Set-EnvValue "$Backend\.env" 'DATABASE_URL' "postgresql://${DbUser}:${DbPassword}@${PgHost}:${PgPort}/${DbName}?schema=public"
  Write-Host 'backend .env created (new JWT secret and AI key)'
}
if (-not (Test-Path "$Frontend\.env")) { Copy-Item "$Frontend\.env.example" "$Frontend\.env"; Write-Host 'frontend .env created' }
if ((Test-Path $Ai) -and -not (Test-Path "$Ai\.env")) {
  Copy-Item "$Ai\.env.example" "$Ai\.env"
  $key = (Select-String -Path "$Backend\.env" -Pattern '^AI_SERVICE_API_KEY=(.*)$').Matches[0].Groups[1].Value.Trim('"')
  Set-EnvValue "$Ai\.env" 'AI_SERVICE_API_KEY' $key
  Write-Host 'AI .env created: set MODEL_PATH to the folder where you copied the encoder model' -ForegroundColor Yellow
}

Step 'Packages'
Push-Location $Backend; corepack yarn install --frozen-lockfile; corepack yarn prisma generate; Pop-Location
Push-Location $Frontend; npm ci; Pop-Location
if (Test-Path $Ai) {
  Push-Location $Ai
  if (-not (Test-Path '.venv')) { python -m venv .venv }
  .\.venv\Scripts\python -m pip install --upgrade pip
  .\.venv\Scripts\python -m pip install -e '.[dev]'
  Pop-Location
}

Step 'Database'
Write-Host "Connecting as $PgSuperUser (enter the password chosen when PostgreSQL was installed)."
$sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN CREATE ROLE $DbUser LOGIN PASSWORD '$DbPassword'; END IF;
END `$`$;
"@
psql -h $PgHost -p $PgPort -U $PgSuperUser -d postgres -v ON_ERROR_STOP=1 -c $sql
$exists = psql -h $PgHost -p $PgPort -U $PgSuperUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
if ($exists -ne '1') {
  psql -h $PgHost -p $PgPort -U $PgSuperUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DbName OWNER $DbUser"
  if ($CopyDir -and (Test-Path "$CopyDir\db.dump")) {
    Write-Host 'Restoring the production copy ...'
    $env:PGPASSWORD = $DbPassword
    pg_restore -h $PgHost -p $PgPort -U $DbUser -d $DbName --no-owner --no-privileges "$CopyDir\db.dump"
    Remove-Item Env:PGPASSWORD
  }
} else { Write-Host "database $DbName already exists (not restored again)" }
# Applies migrations newer than the copy (or all of them on an empty database).
Push-Location $Backend; corepack yarn prisma migrate deploy; Pop-Location

if ($CopyDir -and (Test-Path "$CopyDir\uploads")) {
  Step 'Uploaded files'
  New-Item -ItemType Directory -Force "$Backend\uploads" | Out-Null
  Copy-Item "$CopyDir\uploads\*" "$Backend\uploads" -Recurse -Force
  Write-Host "copied into $Backend\uploads"
}

Step 'Check'
node "$PSScriptRoot\check-env.mjs" --frontend $Frontend --ai $Ai
Write-Host "`nNext: powershell -ExecutionPolicy Bypass -File $PSScriptRoot\start.ps1"
