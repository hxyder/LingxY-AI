param(
  [switch]$WithShell,
  [switch]$RuntimeOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $RepoRoot ".tmp\\trial"
$RuntimeLog = Join-Path $StateDir "runtime.out.log"
$RuntimeErrorLog = Join-Path $StateDir "runtime.err.log"
$RuntimePidFile = Join-Path $StateDir "runtime.pid"
$ElectronLog = Join-Path $StateDir "electron.out.log"
$ElectronErrorLog = Join-Path $StateDir "electron.err.log"
$ElectronPidFile = Join-Path $StateDir "electron.pid"
$RuntimeUrl = "http://127.0.0.1:4310"
$NodeExe = (Get-Command node).Source
$ElectronCli = Join-Path $RepoRoot "node_modules\\electron\\cli.js"

try {
  & (Join-Path $PSScriptRoot "stop-trial.ps1") | Out-Null
} catch {
  # Best effort cleanup of stale repo-local trial processes before launch.
}

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Test-RuntimeHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$RuntimeUrl/health" -TimeoutSec 2
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Write-PidFile {
  param(
    [string]$Path,
    [int]$ProcessId
  )
  Set-Content -Path $Path -Value $ProcessId -Encoding ascii
}

function Get-RuntimeProcessId {
  try {
    return (Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction Stop |
      Select-Object -First 1 -ExpandProperty OwningProcess)
  } catch {
    return $null
  }
}

if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
  throw "node_modules is missing. Run npm install in the repo root first."
}

$LaunchShell = $WithShell -or (-not $RuntimeOnly)

if (-not (Test-RuntimeHealth)) {
  if (Test-Path $RuntimePidFile) {
    Remove-Item -LiteralPath $RuntimePidFile -Force
  }

  $runtimeStartArgs = @{
    FilePath = "node"
    ArgumentList = "scripts/start-runtime.mjs"
    WorkingDirectory = $RepoRoot
    RedirectStandardOutput = $RuntimeLog
    RedirectStandardError = $RuntimeErrorLog
    WindowStyle = "Hidden"
    PassThru = $true
  }
  $runtimeProcess = Start-Process @runtimeStartArgs

  Write-PidFile -Path $RuntimePidFile -ProcessId $runtimeProcess.Id

  $started = $false
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 500
    if (Test-RuntimeHealth) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    throw "Local runtime failed to start. Check $RuntimeLog"
  }
}
elseif (-not (Test-Path $RuntimePidFile)) {
  $existingRuntimePid = Get-RuntimeProcessId
  if ($existingRuntimePid) {
    Write-PidFile -Path $RuntimePidFile -ProcessId ([int]$existingRuntimePid)
  }
}

if ($LaunchShell) {
  if (-not (Test-Path $ElectronCli)) {
    throw "Electron CLI entry was not found: $ElectronCli"
  }

  $existingElectronPid = $null
  if (Test-Path $ElectronPidFile) {
    $existingElectronPid = Get-Content $ElectronPidFile -Raw
  }

  if ($existingElectronPid) {
    try {
      $null = Get-Process -Id ([int]$existingElectronPid) -ErrorAction Stop
    } catch {
      Remove-Item -LiteralPath $ElectronPidFile -Force -ErrorAction SilentlyContinue
      $existingElectronPid = $null
    }
  }

  if (-not $existingElectronPid) {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $NodeExe
    $startInfo.WorkingDirectory = $RepoRoot
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.UseShellExecute = $false
    $startInfo.Arguments = "`"$ElectronCli`" ."
    if ($startInfo.Environment.ContainsKey("ELECTRON_RUN_AS_NODE")) {
      $startInfo.Environment.Remove("ELECTRON_RUN_AS_NODE")
    }

    $electronProcess = [System.Diagnostics.Process]::Start($startInfo)
    $stdoutWriter = [System.IO.StreamWriter]::new($ElectronLog, $false, [System.Text.Encoding]::UTF8)
    $stderrWriter = [System.IO.StreamWriter]::new($ElectronErrorLog, $false, [System.Text.Encoding]::UTF8)
    $electronProcess.BeginOutputReadLine()
    $electronProcess.BeginErrorReadLine()
    $electronProcess.add_OutputDataReceived({
      param($sender, $eventArgs)
      if ($null -ne $eventArgs.Data) {
        $stdoutWriter.WriteLine($eventArgs.Data)
        $stdoutWriter.Flush()
      }
    })
    $electronProcess.add_ErrorDataReceived({
      param($sender, $eventArgs)
      if ($null -ne $eventArgs.Data) {
        $stderrWriter.WriteLine($eventArgs.Data)
        $stderrWriter.Flush()
      }
    })
    Write-PidFile -Path $ElectronPidFile -ProcessId $electronProcess.Id
  }
}

Write-Host "LingxY started."
Write-Host "Runtime: $RuntimeUrl"
Write-Host "Runtime out log: $RuntimeLog"
Write-Host "Runtime err log: $RuntimeErrorLog"
if ($LaunchShell) {
  Write-Host "Electron out log: $ElectronLog"
  Write-Host "Electron err log: $ElectronErrorLog"
} else {
  Write-Host "Runtime-only mode is active. Use the default start command to launch the desktop shell as well."
}
Write-Host "Stop command: powershell -ExecutionPolicy Bypass -File .\\scripts\\stop-trial.ps1"
