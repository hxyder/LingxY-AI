$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repoRoot "uca-native-host\UcaNativeHost\UcaNativeHost.csproj"
$publishDir = Join-Path $env:LOCALAPPDATA "UCA\native-host"
$manifestDir = Join-Path $publishDir "manifests"
$exePath = Join-Path $publishDir "UcaNativeHost.exe"

dotnet publish $project -c Release -o $publishDir | Out-Null
New-Item -Path $manifestDir -ItemType Directory -Force | Out-Null

$origins = @(
  "chrome-extension://placeholder/",
  "edge-extension://placeholder/"
)

$manifest = @{
  name = "com.uca.host"
  description = "UCA Native Messaging Host"
  path = $exePath
  type = "stdio"
  allowed_origins = $origins
} | ConvertTo-Json -Depth 4

$chromeManifestPath = Join-Path $manifestDir "com.uca.host.chrome.json"
$edgeManifestPath = Join-Path $manifestDir "com.uca.host.edge.json"
$manifest | Set-Content -Path $chromeManifestPath -Encoding UTF8
$manifest | Set-Content -Path $edgeManifestPath -Encoding UTF8

New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.uca.host" -Force | Out-Null
New-ItemProperty -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.uca.host" -Name "(default)" -Value $chromeManifestPath -PropertyType String -Force | Out-Null
New-Item -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host" -Force | Out-Null
New-ItemProperty -Path "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host" -Name "(default)" -Value $edgeManifestPath -PropertyType String -Force | Out-Null

Write-Host "Native host published to $publishDir"
Write-Host "Chrome manifest: $chromeManifestPath"
Write-Host "Edge manifest: $edgeManifestPath"
