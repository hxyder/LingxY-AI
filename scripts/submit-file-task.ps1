param(
  [Parameter(Mandatory = $true)]
  [string[]]$Files,
  [string]$Prompt = "Analyze these files and generate a concise report.",
  [string]$Executor = "kimi",
  [int]$PollIntervalSeconds = 2,
  [int]$TimeoutSeconds = 600,
  [switch]$OpenReport
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeUrl = "http://127.0.0.1:4310"

function Test-RuntimeHealth {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$RuntimeUrl/health" -TimeoutSec 2
    return ($response.StatusCode -eq 200)
  } catch {
    return $false
  }
}

if (-not (Test-RuntimeHealth)) {
  Write-Host "Runtime is not running. Starting it now..."
  powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-trial.ps1")
  Start-Sleep -Seconds 2
}

if (-not (Test-RuntimeHealth)) {
  throw "Runtime is still unavailable at $RuntimeUrl"
}

$resolvedFiles = @()
foreach ($file in $Files) {
  $resolvedPath = Resolve-Path -LiteralPath $file -ErrorAction Stop
  $resolvedFiles += $resolvedPath.Path
}

$body = @{
  sourceApp = "submit-file-task.ps1"
  captureMode = "manual_script"
  filePaths = $resolvedFiles
  userCommand = $Prompt
  executorOverride = $Executor
  executionMode = "interactive"
  background = $true
} | ConvertTo-Json -Depth 6

$submitResult = Invoke-RestMethod -Method Post -Uri "$RuntimeUrl/task" -ContentType "application/json" -Body $body
$taskId = $submitResult.task.task_id

Write-Host "Task submitted: $taskId"
Write-Host "Executor: $Executor"
Write-Host "Prompt: $Prompt"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$terminalStates = @("success", "failed", "cancelled", "unsupported", "partial_success")
$lastStatus = $null

while ((Get-Date) -lt $deadline) {
  $taskResult = Invoke-RestMethod -Method Get -Uri "$RuntimeUrl/task/$taskId"
  $status = $taskResult.task.status
  $subStatus = $taskResult.task.sub_status

  if ($status -ne $lastStatus) {
    Write-Host "Status: $status ($subStatus)"
    $lastStatus = $status
  }

  if ($terminalStates -contains $status) {
    if ($status -eq "success") {
      Write-Host "Task completed successfully."
      foreach ($artifact in ($taskResult.artifacts | Where-Object { $_.path })) {
        Write-Host "Artifact: $($artifact.path)"
        if ($OpenReport) {
          Start-Process -FilePath $artifact.path
        }
      }
      exit 0
    }

    Write-Host "Task finished with status: $status"
    if ($taskResult.task.failure_user_message) {
      Write-Host "Reason: $($taskResult.task.failure_user_message)"
    }
    foreach ($event in ($taskResult.events | Where-Object { $_.event_type -eq "failed" })) {
      if ($event.payload.internal_excerpt) {
        Write-Host "Internal detail: $($event.payload.internal_excerpt)"
      }
    }
    exit 1
  }

  Start-Sleep -Seconds $PollIntervalSeconds
}

throw "Task timed out after $TimeoutSeconds seconds: $taskId"
