param(
  [Parameter(Mandatory=$true)]
  [string]$Root
)

$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
$serverJs = [IO.Path]::GetFullPath((Join-Path $rootPath 'server.js'))
$nodeModules = Join-Path $rootPath 'node_modules'
$lockFile = Join-Path $rootPath 'package-lock.json'
$envFile = Join-Path $rootPath '.env'

if (-not (Test-Path -LiteralPath $serverJs -PathType Leaf)) {
  Write-Error "server.js not found: $serverJs"
  exit 1
}

$port = 3010
if (Test-Path -LiteralPath $envFile -PathType Leaf) {
  foreach ($line in [IO.File]::ReadAllLines($envFile)) {
    if ($line -match '^APP_PORT=(\d+)$') {
      $candidate = [int]$Matches[1]
      if ($candidate -ge 1 -and $candidate -le 65535) { $port = $candidate }
    }
  }
}

function Get-ListenerOwners([int]$Port) {
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  $result = @()
  foreach ($connection in $connections) {
    $pidValue = [int]$connection.OwningProcess
    if ($pidValue -le 0) { continue }
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $pidValue) -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $result += [pscustomobject]@{
      Pid = $pidValue
      Name = [string]$process.Name
      CommandLine = [string]$process.CommandLine
    }
  }
  return @($result | Sort-Object Pid -Unique)
}

function Test-ExactFpchatProcess($ProcessInfo, [string]$ExpectedServer) {
  if (-not $ProcessInfo) { return $false }
  if ($ProcessInfo.Name -notmatch '^node(?:\.exe)?$') { return $false }
  $commandLine = [string]$ProcessInfo.CommandLine
  if ([string]::IsNullOrWhiteSpace($commandLine)) { return $false }

  $expected = [IO.Path]::GetFullPath($ExpectedServer)
  $normalized = $commandLine.Replace('"','').Replace("'","")
  return $normalized.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

$owners = @(Get-ListenerOwners $port)
if ($owners.Count -gt 0) {
  $ours = @($owners | Where-Object { Test-ExactFpchatProcess $_ $serverJs })
  if ($ours.Count -eq 1 -and $owners.Count -eq 1) {
    Write-Host "FPChat is already running on port $port (PID $($ours[0].Pid))."
    exit 0
  }

  foreach ($owner in $owners) {
    Write-Host "Port $port is already used by PID $($owner.Pid) [$($owner.Name)]."
  }
  Write-Error "Port $port is busy and is not owned exclusively by this FPChat server.js. No process was stopped."
  exit 2
}

if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
  if (-not (Test-Path -LiteralPath $lockFile -PathType Leaf)) {
    Write-Error 'node_modules is missing and package-lock.json is unavailable.'
    exit 3
  }
  Write-Host 'node_modules is missing. Installing locked production dependencies...'
  Push-Location $rootPath
  try {
    & npm.cmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
} else {
  Write-Host 'Dependencies are already installed; dependency install is skipped.'
}

$owners = @(Get-ListenerOwners $port)
if ($owners.Count -gt 0) {
  Write-Error "Port $port became busy before FPChat start. No process was stopped."
  exit 2
}

Write-Host "Starting FPChat from $serverJs on configured port $port..."
Push-Location $rootPath
try {
  & node.exe $serverJs
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
