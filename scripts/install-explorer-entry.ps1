$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node).Source
$helperProject = Join-Path $repoRoot "src\helper\explorer_selection\UcaExplorerSelectionHelper\UcaExplorerSelectionHelper.csproj"
$publishDir = Join-Path $env:LOCALAPPDATA "UCA\helper\explorer-selection"
$helperExe = Join-Path $publishDir "UcaExplorerSelectionHelper.exe"
$electronCli = Join-Path $repoRoot "node_modules\electron\cli.js"

dotnet publish $helperProject -c Release -o $publishDir | Out-Null

$command = "`"$helperExe`" --files `"%1`" --source shell_menu --capture-mode shell_menu --launch-mode overlay_prompt --electron-exe `"$nodeExe`" --electron-cli `"$electronCli`" --app-dir `"$repoRoot`" --service-url `"http://127.0.0.1:4310`""
$shellKey = "HKCU:\Software\Classes\*\shell\UCA.Analyze"
$commandKey = Join-Path $shellKey "command"

New-Item -Path $shellKey -Force | Out-Null
New-ItemProperty -Path $shellKey -Name "MUIVerb" -Value "用 UCA 分析" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $shellKey -Name "MultiSelectModel" -Value "Player" -PropertyType String -Force | Out-Null
New-Item -Path $commandKey -Force | Out-Null
New-ItemProperty -Path $commandKey -Name "(default)" -Value $command -PropertyType String -Force | Out-Null

Write-Host "Explorer context menu installed at $shellKey"
Write-Host "Helper published to $publishDir"
