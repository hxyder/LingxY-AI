$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node).Source
$cliPath = Join-Path $repoRoot "uca-cli\src\cli.mjs"
$helperProject = Join-Path $repoRoot "src\helper\explorer_selection\UcaExplorerSelectionHelper\UcaExplorerSelectionHelper.csproj"
$publishDir = Join-Path $env:LOCALAPPDATA "UCA\helper\explorer-selection"

dotnet publish $helperProject -c Release -o $publishDir | Out-Null

$command = "`"$nodeExe`" `"$cliPath`" submit --files `"%1`" --capture-mode shell_menu --source-app explorer.exe"
$shellKey = "HKCU:\Software\Classes\*\shell\UCA.Analyze"
$commandKey = Join-Path $shellKey "command"

New-Item -Path $shellKey -Force | Out-Null
New-ItemProperty -Path $shellKey -Name "MUIVerb" -Value "用 UCA 分析" -PropertyType String -Force | Out-Null
New-Item -Path $commandKey -Force | Out-Null
New-ItemProperty -Path $commandKey -Name "(default)" -Value $command -PropertyType String -Force | Out-Null

Write-Host "Explorer context menu installed at $shellKey"
Write-Host "Helper published to $publishDir"
