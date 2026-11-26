# Run on the MAIN machine (where the Docker production stack runs). Makes a copy for a development machine:
#   <OutDir>\db.dump     PostgreSQL custom-format dump of the production database
#   <OutDir>\uploads\    the uploaded files (public images and private CVs)
# The copy holds real personal data (emails, password hashes, CVs). Move it by USB or a private drive,
# never a public link, and delete it when it is no longer needed.
#   powershell -ExecutionPolicy Bypass -File scripts\dev\export-prod-copy.ps1 -OutDir F:\jobaura-dev-copy
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$PostgresContainer = 'jobaura-postgres-1',
  [string]$UploadsVolume = 'jobaura_jobaura_uploads'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$dump = Join-Path $OutDir 'db.dump'

Write-Host "Dumping the database from $PostgresContainer ..."
# Dump inside the container, then copy the file out (a pipe through PowerShell would damage binary data).
docker exec $PostgresContainer sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/jobaura-dev-copy.dump'
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
docker cp "${PostgresContainer}:/tmp/jobaura-dev-copy.dump" $dump
docker exec $PostgresContainer rm -f /tmp/jobaura-dev-copy.dump | Out-Null

Write-Host "Copying uploads from volume $UploadsVolume ..."
$uploads = Join-Path $OutDir 'uploads'
New-Item -ItemType Directory -Force $uploads | Out-Null
docker run --rm -v "${UploadsVolume}:/from:ro" -v "${uploads}:/to" alpine sh -c 'cp -a /from/. /to/'
if ($LASTEXITCODE -ne 0) { throw 'copying uploads failed' }

$size = '{0:N1} MB' -f ((Get-Item $dump).Length / 1MB)
$files = (Get-ChildItem $uploads -Recurse -File).Count
Write-Host "Done: $dump ($size), $files uploaded files in $uploads"
Write-Host 'Contains personal data: keep it private and delete it after use.' -ForegroundColor Yellow
