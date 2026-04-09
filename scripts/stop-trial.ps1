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
      Write-Host "已停止 $Name 进程: $($pidValue.Trim())"
    } catch {
      Write-Host "$Name 进程已不存在: $($pidValue.Trim())"
    }
  }

  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-ProcessFromPidFile -PidFile $ElectronPidFile -Name "Electron"
Stop-ProcessFromPidFile -PidFile $RuntimePidFile -Name "Runtime"
