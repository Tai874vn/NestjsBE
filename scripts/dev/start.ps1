# Starts JobAura on this machine for development: backend, frontend and AI service, each with hot reload
# (no build step), each in its own window. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File <backend>\scripts\dev\start.ps1 [-NoAi] [-DryRun] [-FrontendDir <dir>] [-AiDir <dir>]
# It first checks the three .env files. Only NODE_ENV=development in the backend .env starts anything;
# production runs in Docker on the server and is not started here.
param(
  [string]$FrontendDir,
  [string]$AiDir,
  [switch]$NoAi,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Backend = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$checkArgs = @("$PSScriptRoot\check-env.mjs", '--quiet')
if ($FrontendDir) { $checkArgs += @('--frontend', $FrontendDir) }
if ($AiDir) { $checkArgs += @('--ai', $AiDir) }

$report = & node @checkArgs
$report | Where-Object { $_ -notmatch '^MODE=' } | ForEach-Object { Write-Host $_ }
$mode = ($report | Where-Object { $_ -match '^MODE=' }) -replace '^MODE=', ''
if ($LASTEXITCODE -ne 0) { Write-Host 'Fix the FAIL lines above, then run again.' -ForegroundColor Red; exit 1 }
if ($mode -ne 'dev') {
  Write-Host 'Production mode: nothing started here. On the server use: docker compose -p jobaura up -d' -ForegroundColor Yellow
  exit 0
}

# The same folders check-env found.
$dirsLine = $report | Where-Object { $_ -match '^\s+(frontend|ai):' }
$Frontend = (($dirsLine | Where-Object { $_ -match 'frontend:' }) -replace '^\s+frontend:\s+', '').Trim()
$Ai = (($dirsLine | Where-Object { $_ -match 'ai:' }) -replace '^\s+ai:\s+', '').Trim()

function Start-Window([string]$Title, [string]$Dir, [string]$Command) {
  $script = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$Dir'; $Command"
  if ($DryRun) { Write-Host "would start $Title  ($Dir): $Command"; return }
  Start-Process powershell -ArgumentList @('-NoExit', '-NoProfile', '-Command', $script) | Out-Null
  Write-Host "started $Title  ($Dir)"
}

Start-Window 'JobAura backend :3002' $Backend 'corepack yarn start:dev'
Start-Window 'JobAura frontend :3000' $Frontend 'npm run dev'
if (-not $NoAi -and (Test-Path (Join-Path $Ai '.env'))) {
  # --reload restarts on code changes in app/ only (the model folders are large).
  Start-Window 'JobAura AI :8001' $Ai '.\.venv\Scripts\python -m uvicorn app.main:app --env-file .env --host 127.0.0.1 --port 8001 --reload --reload-dir app'
}
Write-Host ''
Write-Host 'Open http://localhost:3000 (first load compiles the page, give it a few seconds).'
