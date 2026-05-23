$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node).Source
$helperProject = Join-Path $repoRoot "src\helper\explorer_selection\UcaExplorerSelectionHelper\UcaExplorerSelectionHelper.csproj"
$publishDir = Join-Path $env:LOCALAPPDATA "UCA\helper\explorer-selection"
$helperExe = Join-Path $publishDir "UcaExplorerSelectionHelper.exe"
$electronCli = Join-Path $repoRoot "node_modules\electron\cli.js"

dotnet publish $helperProject -c Release -o $publishDir | Out-Null

$baseCommand = "`"$helperExe`" --files `"%1`" --source shell_menu --capture-mode shell_menu --launch-mode overlay_prompt --electron-exe `"$nodeExe`" --electron-cli `"$electronCli`" --app-dir `"$repoRoot`" --service-url `"http://127.0.0.1:4310`""
$directoryCommand = "`"$helperExe`" --files `"%V`" --source shell_menu --capture-mode shell_menu --launch-mode overlay_prompt --electron-exe `"$nodeExe`" --electron-cli `"$electronCli`" --app-dir `"$repoRoot`" --service-url `"http://127.0.0.1:4310`""

$entries = @(
  @{ Path = "HKCU:\Software\Classes\*\shell\UCA.Analyze"; Command = $baseCommand },
  @{ Path = "HKCU:\Software\Classes\Directory\shell\UCA.Analyze"; Command = $baseCommand },
  @{ Path = "HKCU:\Software\Classes\Directory\Background\shell\UCA.Analyze"; Command = $directoryCommand }
)

foreach ($entry in $entries) {
  $shellKey = $entry.Path
  $commandKey = Join-Path $shellKey "command"
  New-Item -Path $shellKey -Force | Out-Null
  New-ItemProperty -Path $shellKey -Name "MUIVerb" -Value "用 LingxY 分析" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $shellKey -Name "MultiSelectModel" -Value "Player" -PropertyType String -Force | Out-Null
  New-Item -Path $commandKey -Force | Out-Null
  New-ItemProperty -Path $commandKey -Name "(default)" -Value $entry.Command -PropertyType String -Force | Out-Null
}

Write-Host "Explorer context menu installed for files, folders, and folder backgrounds"
Write-Host "Helper published to $publishDir"
