Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $RepoRoot ".tmp\\trial"
$RuntimePidFile = Join-Path $StateDir "runtime.pid"
$ElectronPidFile = Join-Path $StateDir "electron.pid"

function Stop-ProcessFromPidFile {
  param(
    [string]$PidFile,
    [string]$Name
  )

  if (-not (Test-Path $PidFile)) {
    return
  }

  $pidValue = Get-Content $PidFile -Raw
  if (-not [string]::IsNullOrWhiteSpace($pidValue)) {
    try {
      Stop-Process -Id ([int]$pidValue.Trim()) -Force -ErrorAction Stop
      Write-Host "Stopped $Name process: $($pidValue.Trim())"
    } catch {
      Write-Host "$Name process was already gone: $($pidValue.Trim())"
    }
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-ProcessFromPidFile -PidFile $ElectronPidFile -Name "Electron"
Stop-ProcessFromPidFile -PidFile $RuntimePidFile -Name "Runtime"
