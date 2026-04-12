param(
  [switch]$InstallBrowserNativeHost,
  [string]$ChromeExtensionId = $env:UCA_CHROME_EXTENSION_ID,
  [string]$EdgeExtensionId = $env:UCA_EDGE_EXTENSION_ID,
  [switch]$SkipExplorerEntry,
  [switch]$SkipLaunch,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ExplorerScript = Join-Path $PSScriptRoot "install-explorer-entry.ps1"
$NativeHostScript = Join-Path $PSScriptRoot "install-native-host.ps1"
$StartScript = Join-Path $PSScriptRoot "start-trial.ps1"

function Assert-CommandAvailable {
  param(
    [string]$CommandName,
    [string]$Hint
  )

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$CommandName is missing. $Hint"
  }
  return $command.Source
}

function Invoke-Step {
  param(
    [string]$Title,
    [scriptblock]$Action
  )

  if ($DryRun) {
    Write-Host "[DryRun] $Title"
    return
  }

  Write-Host "==> $Title"
  & $Action
}

$null = Assert-CommandAvailable -CommandName "node" -Hint "Install Node.js and run npm install in the repo root first."

if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
  throw "node_modules is missing. Run npm install in the repo root first."
}

$kimiCommand = Get-Command kimi -ErrorAction SilentlyContinue

Write-Host "UCA Desktop Trial Setup"
Write-Host "Workspace: $RepoRoot"
Write-Host "Explorer entry: $(-not $SkipExplorerEntry)"
Write-Host "Browser native host: $InstallBrowserNativeHost"
Write-Host "Launch desktop after setup: $(-not $SkipLaunch)"
Write-Host "Kimi CLI detected: $([bool]$kimiCommand)"

if (-not $SkipExplorerEntry) {
  Invoke-Step -Title "Install Explorer right-click entry" -Action {
    & powershell -ExecutionPolicy Bypass -File $ExplorerScript
  }
}

if ($InstallBrowserNativeHost) {
  Invoke-Step -Title "Install browser native host" -Action {
    & powershell -ExecutionPolicy Bypass -File $NativeHostScript -ChromeExtensionId $ChromeExtensionId -EdgeExtensionId $EdgeExtensionId
  }
}

if (-not $SkipLaunch) {
  Invoke-Step -Title "Launch desktop trial" -Action {
    & powershell -ExecutionPolicy Bypass -File $StartScript
  }
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "Recommended next steps:"
Write-Host "1. Right-click a file and use the UCA Explorer menu entry to test the desktop overlay."
if (-not $kimiCommand) {
  Write-Host "2. Install and sign in to Kimi CLI before submitting real tasks."
} else {
  Write-Host "2. Kimi CLI is already available for Code CLI tasks."
}
if (-not $InstallBrowserNativeHost) {
  Write-Host "3. If you need webpage capture later, rerun setup with -InstallBrowserNativeHost."
} else {
  Write-Host "3. Browser native host origins registered for the extension IDs you provided."
}
