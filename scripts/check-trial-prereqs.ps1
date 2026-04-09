param(
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$NodeModulesDir = Join-Path $RepoRoot "node_modules"
$ElectronCli = Join-Path $RepoRoot "node_modules\electron\cli.js"
$RuntimeScript = Join-Path $PSScriptRoot "start-trial.ps1"
$SetupScript = Join-Path $PSScriptRoot "setup-trial.ps1"

function New-CheckResult {
  param(
    [string]$Name,
    [bool]$Ok,
    [string]$Detail,
    [string]$Severity = "required"
  )

  [pscustomobject]@{
    name = $Name
    ok = $Ok
    detail = $Detail
    severity = $Severity
  }
}

$checks = @()

$node = Get-Command node -ErrorAction SilentlyContinue
$nodeDetail = if ($node) { "Found at $($node.Source)" } else { "Node.js is missing" }
$checks += New-CheckResult -Name "node" -Ok ([bool]$node) -Detail $nodeDetail

$nodeModulesPresent = Test-Path $NodeModulesDir
$nodeModulesDetail = if ($nodeModulesPresent) { "Repository dependencies are installed" } else { "Run npm install in the repo root first" }
$checks += New-CheckResult -Name "node_modules" -Ok $nodeModulesPresent -Detail $nodeModulesDetail

$electronCliPresent = Test-Path $ElectronCli
$electronCliDetail = if ($electronCliPresent) { "Electron CLI entry is available" } else { "Electron CLI entry is missing; reinstall dependencies" }
$checks += New-CheckResult -Name "electron_cli" -Ok $electronCliPresent -Detail $electronCliDetail

$setupScriptPresent = Test-Path $SetupScript
$setupScriptDetail = if ($setupScriptPresent) { "Desktop setup script is present" } else { "setup-trial.ps1 is missing" }
$checks += New-CheckResult -Name "setup_script" -Ok $setupScriptPresent -Detail $setupScriptDetail

$runtimeScriptPresent = Test-Path $RuntimeScript
$runtimeScriptDetail = if ($runtimeScriptPresent) { "Desktop start script is present" } else { "start-trial.ps1 is missing" }
$checks += New-CheckResult -Name "start_script" -Ok $runtimeScriptPresent -Detail $runtimeScriptDetail

$kimiCommand = Get-Command kimi -ErrorAction SilentlyContinue
$kimiDetail = if ($kimiCommand) { "Kimi CLI detected at $($kimiCommand.Source)" } else { "Kimi CLI is not installed or not on PATH" }
$checks += New-CheckResult -Name "kimi_cli" -Ok ([bool]$kimiCommand) -Detail $kimiDetail -Severity "recommended"

$requiredFailures = @($checks | Where-Object { -not $_.ok -and $_.severity -eq "required" })
$recommendedFailures = @($checks | Where-Object { -not $_.ok -and $_.severity -eq "recommended" })

$summary = [pscustomobject]@{
  repoRoot = $RepoRoot
  ok = ($requiredFailures.Count -eq 0)
  requiredFailures = $requiredFailures.Count
  recommendedFailures = $recommendedFailures.Count
  checks = $checks
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 4
  exit 0
}

Write-Host "UCA Desktop Trial Preflight"
Write-Host "Workspace: $RepoRoot"
Write-Host ""

foreach ($check in $checks) {
  $prefix = if ($check.ok) { "[OK]" } elseif ($check.severity -eq "required") { "[FAIL]" } else { "[WARN]" }
  Write-Host "$prefix $($check.name): $($check.detail)"
}

Write-Host ""
if ($summary.ok) {
  if ($summary.recommendedFailures -gt 0) {
    Write-Host "Required prerequisites are ready. Some recommended items are still missing." -ForegroundColor Yellow
  } else {
    Write-Host "All required prerequisites are ready for the desktop trial." -ForegroundColor Green
  }
} else {
  Write-Host "Some required prerequisites are missing. Fix them before launching the desktop trial." -ForegroundColor Red
}
