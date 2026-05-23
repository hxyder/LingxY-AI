param(
  [string]$ChromeExtensionId = $env:UCA_CHROME_EXTENSION_ID,
  [string]$EdgeExtensionId = $env:UCA_EDGE_EXTENSION_ID,
  [ValidateSet("both", "chrome", "edge")]
  [string]$Browser = "both",
  [switch]$StatusOnly,
  [switch]$OpenExtensionPage,
  [switch]$OpenExtensionFolder,
  [switch]$SkipNativeHost
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DefaultExtensionId = "oegpgmnonnejpkgpjmpnbnjlpfmkojkf"
if (-not $ChromeExtensionId) { $ChromeExtensionId = $DefaultExtensionId }
if (-not $EdgeExtensionId) { $EdgeExtensionId = $DefaultExtensionId }

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

function Copy-DirectoryContents {
  param(
    [string]$Source,
    [string]$Destination
  )
  New-Item -Path $Destination -ItemType Directory -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

function Get-RegistryDefaultValue {
  param([string]$Path)
  try {
    $item = Get-Item -Path $Path -ErrorAction Stop
    $value = [string]$item.GetValue("")
    if (-not $value) {
      $value = [string]$item.GetValue("(default)")
    }
    return $value
  } catch {
    return ""
  }
}

function Set-RegistryDefaultValue {
  param(
    [string]$SubKey,
    [string]$Value
  )
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKey)
  try {
    $key.SetValue("", $Value, [Microsoft.Win32.RegistryValueKind]::String)
  } finally {
    $key.Close()
  }
}

function Read-AllowedOrigins {
  param([string]$ManifestPath)
  try {
    $parsed = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    return @($parsed.allowed_origins)
  } catch {
    return @()
  }
}

function Open-BrowserPage {
  param(
    [string]$ExecutableName,
    [string]$Url
  )

  try {
    $command = Get-Command $ExecutableName -ErrorAction SilentlyContinue
    if ($command) {
      Start-Process -FilePath $command.Source -ArgumentList $Url | Out-Null
      return $true
    }
  } catch {}

  try {
    Start-Process -FilePath $Url | Out-Null
    return $true
  } catch {
    return $false
  }
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ExtensionDir = Join-Path $RepoRoot "browser_ext"
$ExtensionManifestPath = Join-Path $ExtensionDir "manifest.json"
$Project = Join-Path $RepoRoot "uca-native-host\UcaNativeHost\UcaNativeHost.csproj"
$PrebuiltHostDir = Join-Path $RepoRoot "uca-native-host"
$PrebuiltHostExe = Join-Path $PrebuiltHostDir "UcaNativeHost.exe"
$PublishDir = Join-Path $env:LOCALAPPDATA "UCA\native-host"
$ManifestDir = Join-Path $PublishDir "manifests"
$ExePath = Join-Path $PublishDir "UcaNativeHost.exe"
$ChromeManifestPath = Join-Path $ManifestDir "com.uca.host.chrome.json"
$EdgeManifestPath = Join-Path $ManifestDir "com.uca.host.edge.json"
$ChromeRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.uca.host"
$EdgeRegistryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host"

function Get-SelectedOrigins {
  $selected = @()
  if ($Browser -eq "both" -or $Browser -eq "chrome") {
    $selected += Convert-ToAllowedOrigin -Scheme "chrome-extension" -ExtensionId $ChromeExtensionId
  }
  if ($Browser -eq "both" -or $Browser -eq "edge") {
    $selected += Convert-ToAllowedOrigin -Scheme "edge-extension" -ExtensionId $EdgeExtensionId
  }
  return @($selected | Where-Object { $_ })
}

function Get-BrowserNativeHostStatus {
  $chromeRegistryValue = Get-RegistryDefaultValue -Path $ChromeRegistryPath
  $edgeRegistryValue = Get-RegistryDefaultValue -Path $EdgeRegistryPath
  $chromeOrigins = Read-AllowedOrigins -ManifestPath $ChromeManifestPath
  $edgeOrigins = Read-AllowedOrigins -ManifestPath $EdgeManifestPath
  $expectedChromeOrigin = Convert-ToAllowedOrigin -Scheme "chrome-extension" -ExtensionId $ChromeExtensionId
  $expectedEdgeOrigin = Convert-ToAllowedOrigin -Scheme "edge-extension" -ExtensionId $EdgeExtensionId
  $chromeSelected = $Browser -eq "both" -or $Browser -eq "chrome"
  $edgeSelected = $Browser -eq "both" -or $Browser -eq "edge"
  $chromeReady = (-not $chromeSelected) -or (
    (Test-Path -LiteralPath $ChromeManifestPath) -and
    ($chromeRegistryValue -eq $ChromeManifestPath) -and
    ($chromeOrigins -contains $expectedChromeOrigin)
  )
  $edgeReady = (-not $edgeSelected) -or (
    (Test-Path -LiteralPath $EdgeManifestPath) -and
    ($edgeRegistryValue -eq $EdgeManifestPath) -and
    ($edgeOrigins -contains $expectedEdgeOrigin)
  )
  $extensionManifestExists = Test-Path -LiteralPath $ExtensionManifestPath
  $nativeHostExeExists = Test-Path -LiteralPath $ExePath

  return [ordered]@{
    ok = ($extensionManifestExists -and ($SkipNativeHost -or ($nativeHostExeExists -and $chromeReady -and $edgeReady)))
    browser = $Browser
    stableExtensionId = $DefaultExtensionId
    chromeExtensionId = $ChromeExtensionId
    edgeExtensionId = $EdgeExtensionId
    extensionDir = $ExtensionDir
    extensionManifestPath = $ExtensionManifestPath
    extensionManifestExists = $extensionManifestExists
    requiresUserLoadUnpacked = $true
    extensionPages = [ordered]@{
      chrome = "chrome://extensions/"
      edge = "edge://extensions/"
    }
    nativeHost = [ordered]@{
      publishDir = $PublishDir
      exePath = $ExePath
      exeExists = $nativeHostExeExists
      manifestDir = $ManifestDir
      allowedOrigins = Get-SelectedOrigins
      prebuiltHostDir = $PrebuiltHostDir
      prebuiltHostExists = Test-Path -LiteralPath $PrebuiltHostExe
      projectExists = Test-Path -LiteralPath $Project
    }
    chrome = [ordered]@{
      selected = $chromeSelected
      expectedOrigin = $expectedChromeOrigin
      registryPath = $ChromeRegistryPath
      registryManifestPath = $chromeRegistryValue
      hostManifestPath = $ChromeManifestPath
      registered = $chromeReady
      allowedOrigins = $chromeOrigins
    }
    edge = [ordered]@{
      selected = $edgeSelected
      expectedOrigin = $expectedEdgeOrigin
      registryPath = $EdgeRegistryPath
      registryManifestPath = $edgeRegistryValue
      hostManifestPath = $EdgeManifestPath
      registered = $edgeReady
      allowedOrigins = $edgeOrigins
    }
  }
}

function Write-StatusJson {
  param([hashtable]$Extra = @{})
  $status = Get-BrowserNativeHostStatus
  foreach ($key in $Extra.Keys) {
    $status[$key] = $Extra[$key]
  }
  $status | ConvertTo-Json -Depth 8 -Compress
}

if ($StatusOnly) {
  Write-StatusJson
  exit 0
}

if (-not (Test-Path -LiteralPath $ExtensionManifestPath)) {
  throw "Browser extension manifest not found at '$ExtensionManifestPath'."
}

if (-not $SkipNativeHost) {
  $origins = Get-SelectedOrigins
  if ($origins.Count -eq 0) {
    throw "No browser extension origins were provided."
  }

  if (Test-Path -LiteralPath $PrebuiltHostExe) {
    Copy-DirectoryContents -Source $PrebuiltHostDir -Destination $PublishDir
  } elseif (Test-Path -LiteralPath $Project) {
    $dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if (-not $dotnet) {
      throw "Prebuilt native host is missing and dotnet is not available to publish '$Project'."
    }
    New-Item -Path $PublishDir -ItemType Directory -Force | Out-Null
    & dotnet publish $Project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -o $PublishDir | Out-Null
  } else {
    throw "No prebuilt native host or native host project was found under '$RepoRoot'."
  }

  New-Item -Path $ManifestDir -ItemType Directory -Force | Out-Null

  $hostManifest = @{
    name = "com.uca.host"
    description = "LingxY Native Messaging Host"
    path = $ExePath
    type = "stdio"
    allowed_origins = $origins
  } | ConvertTo-Json -Depth 4

  $hostManifest | Set-Content -Path $ChromeManifestPath -Encoding UTF8
  $hostManifest | Set-Content -Path $EdgeManifestPath -Encoding UTF8

  if ($Browser -eq "both" -or $Browser -eq "chrome") {
    Set-RegistryDefaultValue -SubKey "Software\Google\Chrome\NativeMessagingHosts\com.uca.host" -Value $ChromeManifestPath
  }
  if ($Browser -eq "both" -or $Browser -eq "edge") {
    Set-RegistryDefaultValue -SubKey "Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host" -Value $EdgeManifestPath
  }
}

$openedFolder = $false
if ($OpenExtensionFolder) {
  Invoke-Item -LiteralPath $ExtensionDir
  $openedFolder = $true
}

$openedBrowsers = [ordered]@{ chrome = $false; edge = $false }
if ($OpenExtensionPage) {
  if ($Browser -eq "both" -or $Browser -eq "edge") {
    $openedBrowsers.edge = Open-BrowserPage -ExecutableName "msedge.exe" -Url "edge://extensions/"
  }
  if ($Browser -eq "both" -or $Browser -eq "chrome") {
    $openedBrowsers.chrome = Open-BrowserPage -ExecutableName "chrome.exe" -Url "chrome://extensions/"
  }
}

Write-StatusJson @{
  configured = (-not $SkipNativeHost)
  openedExtensionFolder = $openedFolder
  openedBrowsers = $openedBrowsers
}
