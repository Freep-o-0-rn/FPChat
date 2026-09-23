$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root = Join-Path $env:RUNNER_TEMP ('fpchat-1806-' + [guid]::NewGuid().ToString('N'))
$live = Join-Path $root 'live'
$shim = Join-Path $root 'shim'
$npmMarker = Join-Path $root 'NPM_WAS_CALLED.txt'
$foreignScript = Join-Path $root 'foreign-listener.cjs'
$port = 39861

New-Item -ItemType Directory -Force -Path $live,$shim | Out-Null

function Copy-Tree($from,$to) {
  robocopy $from $to /E /XD (Join-Path $from '.git') (Join-Path $from 'node_modules') /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
}

function Wait-Listener([int]$Port,[int]$TimeoutMs=10000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($connections.Count -gt 0) { return @($connections) }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "listener on port $Port did not appear"
}

function Wait-NoListener([int]$Port,[int]$TimeoutMs=5000) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  do {
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($connections.Count -eq 0) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "listener on port $Port did not disappear"
}

$launcher1=$null
$foreignSamePort=$null
$foreignUnrelated=$null
$fpchatPid=$null
$oldPath=$env:PATH

try {
  Copy-Tree $repo $live

  Push-Location $live
  try {
    & npm.cmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "fixture npm ci failed: $LASTEXITCODE" }
  } finally { Pop-Location }

  [IO.File]::WriteAllText((Join-Path $live '.env'), "APP_PORT=$port" + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

  # Any npm call after this point is a regression because node_modules already exists.
  $realNpm = (Get-Command npm.cmd).Source
  $shimBody = '@echo off' + [Environment]::NewLine +
    'echo %*>>"' + $npmMarker + '"' + [Environment]::NewLine +
    'exit /b 97' + [Environment]::NewLine
  [IO.File]::WriteAllText((Join-Path $shim 'npm.cmd'), $shimBody, [Text.Encoding]::ASCII)
  $env:PATH = $shim + ';' + $oldPath
  $env:FPCHAT_LAUNCH_NONINTERACTIVE = '1'

  # Unrelated node must survive every launcher action.
  $foreignUnrelated = Start-Process -FilePath node.exe -ArgumentList @('-e','setInterval(()=>{},1000)') -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 300
  if ($foreignUnrelated.HasExited) { throw 'unrelated node fixture exited early' }

  # First launcher starts this exact FPChat.
  $launcher1 = Start-Process -FilePath cmd.exe -ArgumentList @('/d','/c',(Join-Path $live 'start_chat.bat')) -WorkingDirectory $live -PassThru -WindowStyle Hidden
  $listeners = Wait-Listener $port
  $ownerPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($ownerPids.Count -ne 1) { throw "expected one FPChat listener PID, got $($ownerPids.Count)" }
  $fpchatPid = [int]$ownerPids[0]
  $fpchatProcess = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $fpchatPid)
  if (-not $fpchatProcess) { throw 'FPChat listener process missing' }
  $expectedServer = [IO.Path]::GetFullPath((Join-Path $live 'server.js'))
  $normalizedCommand = ([string]$fpchatProcess.CommandLine).Replace('"','').Replace("'","")
  if ($normalizedCommand.IndexOf($expectedServer,[StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw "listener is not exact FPChat server.js: $($fpchatProcess.CommandLine)"
  }

  # Second launcher must return success without spawning another FPChat.
  $launcher2 = Start-Process -FilePath cmd.exe -ArgumentList @('/d','/c',(Join-Path $live 'start_chat.bat')) -WorkingDirectory $live -PassThru -Wait -WindowStyle Hidden
  if ($launcher2.ExitCode -ne 0) { throw "second launcher should accept existing FPChat, exit=$($launcher2.ExitCode)" }
  $afterSecond = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  $afterPids = @($afterSecond | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($afterPids.Count -ne 1 -or [int]$afterPids[0] -ne $fpchatPid) { throw 'second launcher changed FPChat listener ownership' }

  if (Test-Path $npmMarker) { throw 'launcher invoked npm even though node_modules already existed' }
  if ($foreignUnrelated.HasExited) { throw 'launcher terminated unrelated node process' }

  # Stop only the fixture FPChat PID from the harness, never through launcher logic.
  Stop-Process -Id $fpchatPid -Force
  Wait-NoListener $port
  $fpchatPid=$null

  # Put an unrelated Node listener on FPChat's port. Launcher must refuse and not kill it.
  $foreignSource = @"
const net=require('net');
const port=Number(process.argv[2]);
net.createServer(()=>{}).listen(port,'127.0.0.1');
setInterval(()=>{},1000);
"@
  [IO.File]::WriteAllText($foreignScript,$foreignSource,[Text.UTF8Encoding]::new($false))
  $foreignSamePort = Start-Process -FilePath node.exe -ArgumentList @($foreignScript,[string]$port) -PassThru -WindowStyle Hidden
  $foreignListeners=Wait-Listener $port
  $foreignOwner=@($foreignListeners | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($foreignOwner.Count -ne 1 -or [int]$foreignOwner[0] -ne $foreignSamePort.Id) { throw 'foreign listener fixture ownership mismatch' }

  $conflictLauncher = Start-Process -FilePath cmd.exe -ArgumentList @('/d','/c',(Join-Path $live 'start_chat.bat')) -WorkingDirectory $live -PassThru -Wait -WindowStyle Hidden
  if ($conflictLauncher.ExitCode -eq 0) { throw 'launcher accepted a foreign process on FPChat port' }
  if ($foreignSamePort.HasExited) { throw 'launcher killed foreign Node listener on FPChat port' }
  $stillForeign=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($stillForeign.Count -ne 1 -or [int]$stillForeign[0] -ne $foreignSamePort.Id) { throw 'foreign port owner changed after launcher refusal' }

  if (Test-Path $npmMarker) { throw 'conflict path invoked npm unnecessarily' }
  if ($foreignUnrelated.HasExited) { throw 'unrelated Node process was killed during conflict handling' }

  Write-Host 'PASS 180.6 first launcher owns APP_PORT with exact absolute FPChat server.js command line'
  Write-Host 'PASS 180.6 second launcher returns without creating a second FPChat instance'
  Write-Host 'PASS 180.6 existing node_modules causes zero npm calls'
  Write-Host 'PASS 180.6 foreign Node on another port survives; foreign Node on APP_PORT is refused and not killed'
} finally {
  $env:PATH=$oldPath
  Remove-Item Env:FPCHAT_LAUNCH_NONINTERACTIVE -ErrorAction SilentlyContinue
  foreach($proc in @($foreignSamePort,$foreignUnrelated,$launcher1)) {
    if($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  }
  if($fpchatPid) { Stop-Process -Id $fpchatPid -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
