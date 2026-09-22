$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root = Join-Path $env:RUNNER_TEMP ('fpchat-1805-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $root 'source'
$live = Join-Path $root 'live'
$backups = Join-Path $root 'backups'
$launchMarker = Join-Path $root 'SERVER_WAS_LAUNCHED.txt'
New-Item -ItemType Directory -Force -Path $source,$live,$backups | Out-Null

function Copy-Tree($from,$to) {
  robocopy $from $to /E /XD (Join-Path $from '.git') (Join-Path $from 'node_modules') /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
}

try {
  Copy-Tree $repo $source
  Copy-Tree $repo $live

  @('@echo off', 'echo launched>"' + $launchMarker + '"', 'exit /b 99') | Set-Content -LiteralPath (Join-Path $source 'start_chat.bat') -Encoding ASCII
  Set-Content -LiteralPath (Join-Path $source 'source-1805-marker.txt') -Value 'NEW_SOURCE_1805' -NoNewline
  Set-Content -LiteralPath (Join-Path $live 'legacy-live-marker.txt') -Value 'OLD_LIVE_1805' -NoNewline

  $dataDir = Join-Path $live 'data'
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $dataDir 'chat.sqlite'), [byte[]](0,1,2,3,4,250,251,252,253,254,255))
  [IO.File]::WriteAllBytes((Join-Path $dataDir 'upload-sentinel.bin'), [byte[]](255,0,127,64,32,16,8,4,2,1))
  $envText = "APP_PORT=39851" + [Environment]::NewLine + "FPCHAT_1805_SENTINEL=config-preserved" + [Environment]::NewLine
  [IO.File]::WriteAllText((Join-Path $live '.env'), $envText, [Text.UTF8Encoding]::new($false))

  $beforeDb = (Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'chat.sqlite')).Hash
  $beforeUpload = (Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'upload-sentinel.bin')).Hash
  $beforeEnv = (Get-FileHash -Algorithm SHA256 (Join-Path $live '.env')).Hash

  Push-Location $live
  try {
    & npm.cmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "live npm ci failed: $LASTEXITCODE" }
    & node.exe -e "require('express'); require('better-sqlite3'); require('ws');"
    if ($LASTEXITCODE -ne 0) { throw "live dependency precheck failed: $LASTEXITCODE" }
  } finally { Pop-Location }

  $env:FPCHAT_UPDATE_DST = $live
  $env:FPCHAT_UPDATE_BACKUP_ROOT = $backups
  $env:FPCHAT_UPDATE_NONINTERACTIVE = '1'

  Push-Location $source
  try {
    & cmd.exe /d /c update.bat
    $updateExit = $LASTEXITCODE
  } finally { Pop-Location }
  if ($updateExit -ne 0) { throw "update.bat failed: $updateExit" }

  if (Test-Path $launchMarker) { throw 'update.bat invoked start_chat.bat' }
  if (-not (Test-Path (Join-Path $live 'source-1805-marker.txt'))) { throw 'application files were not applied' }
  if ((Get-Content -Raw (Join-Path $live 'source-1805-marker.txt')) -ne 'NEW_SOURCE_1805') { throw 'source marker content changed' }

  if ((Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'chat.sqlite')).Hash -ne $beforeDb) { throw 'SQLite data changed' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'upload-sentinel.bin')).Hash -ne $beforeUpload) { throw 'upload data changed' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $live '.env')).Hash -ne $beforeEnv) { throw '.env changed' }

  if (-not (Test-Path (Join-Path $live 'node_modules'))) { throw 'node_modules missing after update' }
  Push-Location $live
  try {
    & node.exe -e "require('express'); require('better-sqlite3'); require('ws');"
    if ($LASTEXITCODE -ne 0) { throw "updated dependency verification failed: $LASTEXITCODE" }
  } finally { Pop-Location }

  $backup = Get-ChildItem -LiteralPath $backups -Directory -Filter 'backup_*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $backup) { throw 'backup directory not created' }
  if (-not (Test-Path (Join-Path $backup.FullName 'app\legacy-live-marker.txt'))) { throw 'old application marker not backed up' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $backup.FullName 'data\chat.sqlite')).Hash -ne $beforeDb) { throw 'backup SQLite differs from pre-update data' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $backup.FullName 'data\upload-sentinel.bin')).Hash -ne $beforeUpload) { throw 'backup upload differs from pre-update data' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $backup.FullName '.env')).Hash -ne $beforeEnv) { throw 'backup .env differs from pre-update config' }
  if (Test-Path (Join-Path $backup.FullName 'node_modules')) { throw 'node_modules unexpectedly included in backup root' }

  $stageLeftovers = @(Get-ChildItem -LiteralPath $backups -Directory -Filter '_stage_*' -ErrorAction SilentlyContinue)
  if ($stageLeftovers.Count -ne 0) { throw 'staging directory was not cleaned' }

  $listener = Get-NetTCPConnection -LocalPort 39851 -State Listen -ErrorAction SilentlyContinue
  if ($listener) { throw 'updater started a server/listener on APP_PORT' }

  Write-Host 'PASS 180.5 isolated Windows update applied application files'
  Write-Host 'PASS 180.5 live data and .env hashes are unchanged; backup copies match originals'
  Write-Host 'PASS 180.5 installed runtime dependencies remain present and loadable after staged npm ci mirror'
  Write-Host 'PASS 180.5 updater did not invoke start_chat.bat or open APP_PORT'
} finally {
  Remove-Item Env:FPCHAT_UPDATE_DST -ErrorAction SilentlyContinue
  Remove-Item Env:FPCHAT_UPDATE_BACKUP_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:FPCHAT_UPDATE_NONINTERACTIVE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
