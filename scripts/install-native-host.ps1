param(
  [string]$ChromeExtensionId = $env:UCA_CHROME_EXTENSION_ID,
  [string]$EdgeExtensionId = $env:UCA_EDGE_EXTENSION_ID
)

$ErrorActionPreference = "Stop"

function Convert-ToAllowedOrigin {
  param(
    [string]$Scheme,
    [string]$ExtensionId
  )

  $id = ""
  if ($null -ne $ExtensionId) {
    $id = $ExtensionId.Trim()
  }
  if (-not $id) {
    return $null
  }
  if ($id -match "^[a-z]{32}$") {
    return "${Scheme}://$id/"
  }
  if ($id -match "^$([Regex]::Escape($Scheme))://[a-z]{32}/$") {
    return $id
  }
  throw "Invalid extension id/origin for $Scheme. Provide a 32-character unpacked extension ID or a full ${Scheme}://<id>/ origin."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repoRoot "uca-native-host\UcaNativeHost\UcaNativeHost.csproj"
$publishDir = Join-Path $env:LOCALAPPDATA "UCA\native-host"
$manifestDir = Join-Path $publishDir "manifests"
$exePath = Join-Path $publishDir "UcaNativeHost.exe"

$origins = @(
  Convert-ToAllowedOrigin -Scheme "chrome-extension" -ExtensionId $ChromeExtensionId
  Convert-ToAllowedOrigin -Scheme "edge-extension" -ExtensionId $EdgeExtensionId
) | Where-Object { $_ }

if ($origins.Count -eq 0) {
  throw "No browser extension origins were provided. Pass -ChromeExtensionId / -EdgeExtensionId, or set UCA_CHROME_EXTENSION_ID / UCA_EDGE_EXTENSION_ID after loading browser_ext as an unpacked extension."
}

dotnet publish $project -c Release -o $publishDir | Out-Null
New-Item -Path $manifestDir -ItemType Directory -Force | Out-Null

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
