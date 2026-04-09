Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $RepoRoot ".tmp\\trial"
$RuntimePidFile = Join-Path $StateDir "runtime.pid"
$ElectronPidFile = Join-Path $StateDir "electron.pid"
$RepoRootResolved = [System.IO.Path]::GetFullPath($RepoRoot)

function Get-UcaTrialProcesses {
  $escapedRepoRoot = [Regex]::Escape($RepoRootResolved)

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -match $escapedRepoRoot -or
        $_.CommandLine -match 'universal-context-agent' -or
        $_.CommandLine -match 'start-runtime\.mjs' -or
        $_.CommandLine -match 'node_modules\\electron\\cli\.js'
      )
    } |
    Where-Object {
      $_.Name -in @('electron.exe', 'node.exe')
    }
}

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

$staleProcesses = Get-UcaTrialProcesses | Sort-Object ProcessId -Descending
foreach ($process in $staleProcesses) {
  try {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    Write-Host "Stopped stale $($process.Name) process: $($process.ProcessId)"
  } catch {
    Write-Host "Stale $($process.Name) process was already gone: $($process.ProcessId)"
  }
}
