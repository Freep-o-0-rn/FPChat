$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root = Join-Path $env:RUNNER_TEMP ('fpchat-1807-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $root 'source'
$live = Join-Path $root 'live'
$backups = Join-Path $root 'backups'
$port = 39871

New-Item -ItemType Directory -Force -Path $source,$live,$backups | Out-Null

function Copy-Tree($from,$to) {
  robocopy $from $to /E /XD (Join-Path $from '.git') (Join-Path $from 'node_modules') /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
}

try {
  Copy-Tree $repo $source
  Copy-Tree $repo $live

  # Give the live copy a distinguishable old-code state.
  Add-Content -LiteralPath (Join-Path $live 'server.js') -Value ([Environment]::NewLine + '// FPCHAT_1807_OLD_CODE')
  Set-Content -LiteralPath (Join-Path $live 'old-app-marker.txt') -Value 'OLD_APP_1807' -NoNewline
  Set-Content -LiteralPath (Join-Path $source 'new-app-marker.txt') -Value 'NEW_APP_1807' -NoNewline
  Add-Content -LiteralPath (Join-Path $source 'server.js') -Value ([Environment]::NewLine + '// FPCHAT_1807_NEW_CODE')

  $dataDir = Join-Path $live 'data'
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $dataDir 'chat.sqlite'), [byte[]](7,6,5,4,3,2,1,0,250,251,252))
  [IO.File]::WriteAllBytes((Join-Path $dataDir 'upload.bin'), [byte[]](99,88,77,66,55,44,33,22,11))
  [IO.File]::WriteAllText((Join-Path $live '.env'), "APP_PORT=$port" + [Environment]::NewLine + "FPCHAT_1807=old-config" + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

  Push-Location $live
  try {
    $npmLog=Join-Path $root 'fixture-npm-ci.log'
    $npmCommand='npm ci --omit=dev --no-audit --no-fund > "' + $npmLog + '" 2>&1'
    & cmd.exe /d /s /c $npmCommand
    $npmExit=$LASTEXITCODE
    if ($npmExit -ne 0) {
      $npmText=Get-Content -LiteralPath $npmLog -Raw -ErrorAction SilentlyContinue
      throw "fixture npm ci failed: $npmExit`n$npmText"
    }
  } finally {
    Pop-Location
  }
  Set-Content -LiteralPath (Join-Path $live 'node_modules\.fpchat-1807-old-deps') -Value 'OLD_DEPS_1807' -NoNewline

  $oldServerHash=(Get-FileHash -Algorithm SHA256 (Join-Path $live 'server.js')).Hash
  $oldDataHash=(Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'chat.sqlite')).Hash
  $oldUploadHash=(Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'upload.bin')).Hash
  $oldEnvHash=(Get-FileHash -Algorithm SHA256 (Join-Path $live '.env')).Hash

  $env:FPCHAT_UPDATE_DST=$live
  $env:FPCHAT_UPDATE_BACKUP_ROOT=$backups
  $env:FPCHAT_UPDATE_NONINTERACTIVE='1'
  $env:FPCHAT_UPDATE_TEST_FAIL_AFTER_DEPENDENCIES='1'

  Push-Location $source
  try {
    $output = & cmd.exe /d /c update.bat 2>&1
    $exitCode=$LASTEXITCODE
  } finally { Pop-Location }

  if ($exitCode -eq 0) { throw 'fault-injected update unexpectedly succeeded' }
  $outputText=($output | Out-String)
  if ($outputText -notmatch '\[TEST\] Injecting failure after live application and dependency writes') { throw 'fault injection point was not reached' }
  if ($outputText -notmatch '\[ROLLBACK\] Restore completed successfully') { throw "rollback did not report success`n$outputText" }
  if ($outputText -match '\[ROLLBACK ERROR\]') { throw "rollback reported an error`n$outputText" }

  if ((Get-FileHash -Algorithm SHA256 (Join-Path $live 'server.js')).Hash -ne $oldServerHash) { throw 'old server.js was not restored exactly' }
  if (-not (Test-Path (Join-Path $live 'old-app-marker.txt'))) { throw 'old application marker missing after rollback' }
  if (Test-Path (Join-Path $live 'new-app-marker.txt')) { throw 'new-only application file survived rollback mirror' }
  if ((Get-Content -Raw (Join-Path $live 'server.js')) -match 'FPCHAT_1807_NEW_CODE') { throw 'new server code survived rollback' }
  if ((Get-Content -Raw (Join-Path $live 'server.js')) -notmatch 'FPCHAT_1807_OLD_CODE') { throw 'old server code marker missing after rollback' }

  if ((Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'chat.sqlite')).Hash -ne $oldDataHash) { throw 'SQLite data differs after rollback' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $dataDir 'upload.bin')).Hash -ne $oldUploadHash) { throw 'upload data differs after rollback' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $live '.env')).Hash -ne $oldEnvHash) { throw '.env differs after rollback' }

  if (-not (Test-Path (Join-Path $live 'node_modules\.fpchat-1807-old-deps'))) { throw 'old dependency snapshot marker was not restored' }
  Push-Location $live
  try {
    & node.exe -e "require('express'); require('better-sqlite3'); require('ws');"
    if ($LASTEXITCODE -ne 0) { throw "restored dependencies are not loadable: $LASTEXITCODE" }
  } finally { Pop-Location }

  $backup = Get-ChildItem -LiteralPath $backups -Directory -Filter 'backup_*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $backup) { throw 'rollback backup missing' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $backup.FullName 'app\server.js')).Hash -ne $oldServerHash) { throw 'backup app does not match old code' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $backup.FullName 'data\chat.sqlite')).Hash -ne $oldDataHash) { throw 'backup data does not match old data' }
  if ((Get-FileHash -Algorithm SHA256 (Join-Path $backup.FullName '.env')).Hash -ne $oldEnvHash) { throw 'backup config does not match old config' }
  if (-not (Test-Path (Join-Path $backup.FullName 'node_modules\.fpchat-1807-old-deps'))) { throw 'backup dependency snapshot missing old marker' }

  $stageLeftovers=@(Get-ChildItem -LiteralPath $backups -Directory -Filter '_stage_*' -ErrorAction SilentlyContinue)
  if($stageLeftovers.Count -ne 0){throw 'failed update left staging directory'}

  $listener=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if($listener){throw 'rollback/update unexpectedly launched a server'}

  if ([IO.Path]::GetFullPath($live).TrimEnd('\') -ieq 'C:\_BOTS\FPChat') { throw 'test unexpectedly targeted production default path' }

  Write-Host 'PASS 180.7 injected failure occurred after live code/dependency writes'
  Write-Host 'PASS 180.7 old application tree was mirror-restored and new-only files were removed'
  Write-Host 'PASS 180.7 SQLite/upload/.env hashes match the pre-update isolated copy'
  Write-Host 'PASS 180.7 old dependency snapshot was restored and runtime modules are loadable'
  Write-Host 'PASS 180.7 updater/rollback did not launch FPChat and never targeted the production default path'
} finally {
  Remove-Item Env:FPCHAT_UPDATE_DST -ErrorAction SilentlyContinue
  Remove-Item Env:FPCHAT_UPDATE_BACKUP_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:FPCHAT_UPDATE_NONINTERACTIVE -ErrorAction SilentlyContinue
  Remove-Item Env:FPCHAT_UPDATE_TEST_FAIL_AFTER_DEPENDENCIES -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
