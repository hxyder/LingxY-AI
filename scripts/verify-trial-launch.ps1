Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $RepoRoot ".tmp\\trial"
$RuntimePidPath = Join-Path $StateDir "runtime.pid"
$ElectronPidPath = Join-Path $StateDir "electron.pid"
$RuntimeErrLogPath = Join-Path $StateDir "runtime.err.log"
$ElectronErrLogPath = Join-Path $StateDir "electron.err.log"

function Invoke-BestEffortStop {
  try {
    & (Join-Path $RepoRoot "scripts\\stop-trial.ps1") | Out-Null
  } catch {
    # Best effort cleanup before and after verification.
  }
}

function Wait-Until {
  param(
    [scriptblock]$Condition,
    [int]$TimeoutMs,
    [int]$IntervalMs,
    [string]$Label
  )

  $startedAt = Get-Date
  while (((Get-Date) - $startedAt).TotalMilliseconds -lt $TimeoutMs) {
    if (& $Condition) {
      return
    }
    Start-Sleep -Milliseconds $IntervalMs
  }

  throw "Timed out waiting for $Label"
}

function Test-RuntimeHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4310/health" -TimeoutSec 2
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

Invoke-BestEffortStop

try {
  & (Join-Path $RepoRoot "scripts\\start-trial.ps1") | Out-Null

  Wait-Until -Condition { Test-Path $RuntimePidPath } -TimeoutMs 15000 -IntervalMs 250 -Label "runtime pid file"
  Wait-Until -Condition { Test-Path $ElectronPidPath } -TimeoutMs 15000 -IntervalMs 250 -Label "electron pid file"
  Wait-Until -Condition { Test-RuntimeHealth } -TimeoutMs 15000 -IntervalMs 500 -Label "runtime health endpoint"

  $runtimePid = [int](Get-Content $RuntimePidPath -Raw).Trim()
  $electronPid = [int](Get-Content $ElectronPidPath -Raw).Trim()

  Get-Process -Id $runtimePid -ErrorAction Stop | Out-Null
  Get-Process -Id $electronPid -ErrorAction Stop | Out-Null

  if (Test-Path $RuntimeErrLogPath) {
    $runtimeErrLog = Get-Content $RuntimeErrLogPath -Raw
    if ($runtimeErrLog -match "Error:") {
      throw "Runtime err log contains Error:"
    }
  }

  if (Test-Path $ElectronErrLogPath) {
    $electronErrLog = Get-Content $ElectronErrLogPath -Raw
    if ($electronErrLog -match "Error:") {
      throw "Electron err log contains Error:"
    }
    if ($electronErrLog -match "UnhandledPromiseRejection") {
      throw "Electron err log contains UnhandledPromiseRejection"
    }
  }
}
finally {
  Invoke-BestEffortStop
}

if (Test-Path $RuntimePidPath) {
  throw "Runtime pid file still exists after stop."
}

if (Test-Path $ElectronPidPath) {
  throw "Electron pid file still exists after stop."
}

Write-Host "Trial desktop launch verification passed."
exit 0
