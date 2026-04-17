param(
  [switch]$Elevate,
  [switch]$StatusOnly,
  [switch]$ResetCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$CatalogPath = Join-Path $RepoRoot "office_addin\catalog"
$ShareName = "UCAOfficeAddins"
# Use the machine name rather than "localhost". SMB loopback to "localhost"
# is blocked on many Windows configurations (the Workstation/Server services
# resolve the NetBIOS alias differently from a real hostname), and Office's
# Trusted Catalog code treats \\localhost\... as unreachable even when the
# share itself is healthy. \\<COMPUTERNAME>\<share> routes through the same
# SMB stack users actually browse with and is the form Microsoft's own Office
# Add-in docs recommend for single-box testing.
$ShareHost = $env:COMPUTERNAME
$ShareUrl = "\\$ShareHost\$ShareName"
$TrustedCatalogGuid = "{1d1dd5db-1b91-4e32-8fd5-0cb0f8d4ca70}"
$TrustedCatalogRootKey = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs"
$TrustedCatalogKey = "$TrustedCatalogRootKey\$TrustedCatalogGuid"
$OfficeWefCachePath = Join-Path $env:LOCALAPPDATA "Microsoft\Office\16.0\Wef"
$OfficeHostProcesses = @("WINWORD", "EXCEL", "POWERPNT")

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-OfficeAddinSetupStatus {
  $manifestTargets = @(
    @{ host = "word"; source = Join-Path $RepoRoot "office_addin\word\manifest.xml"; target = Join-Path $CatalogPath "uca-word.xml" },
    @{ host = "excel"; source = Join-Path $RepoRoot "office_addin\excel\manifest.xml"; target = Join-Path $CatalogPath "uca-excel.xml" },
    @{ host = "ppt"; source = Join-Path $RepoRoot "office_addin\ppt\manifest.xml"; target = Join-Path $CatalogPath "uca-ppt.xml" }
  )

  $share = $null
  try {
    $share = Get-SmbShare -Name $ShareName -ErrorAction Stop
  } catch {}

  $registryTrusted = $false
  $registryUrl = ""
  $clearInstalledExtensions = $null
  try {
    $catalog = Get-ItemProperty -Path $TrustedCatalogKey -ErrorAction Stop
    $registryUrl = [string]$catalog.Url
    $registryTrusted = $registryUrl -eq $ShareUrl -and [int]$catalog.Flags -eq 1
  } catch {}

  try {
    $trustedCatalogRoot = Get-ItemProperty -Path $TrustedCatalogRootKey -ErrorAction Stop
    if ($null -ne $trustedCatalogRoot.ClearInstalledExtensions) {
      $clearInstalledExtensions = [int]$trustedCatalogRoot.ClearInstalledExtensions
    }
  } catch {}

  $shareReadable = $false
  try {
    Get-ChildItem -LiteralPath $ShareUrl -ErrorAction Stop | Out-Null
    $shareReadable = $true
  } catch {}

  $runningOfficeHosts = @(Get-Process -Name $OfficeHostProcesses -ErrorAction SilentlyContinue | ForEach-Object {
    $_.ProcessName
  } | Sort-Object -Unique)

  $officeWefCacheItemCount = 0
  if (Test-Path -LiteralPath $OfficeWefCachePath) {
    $officeWefCacheItemCount = @(Get-ChildItem -LiteralPath $OfficeWefCachePath -Force -ErrorAction SilentlyContinue).Count
  }

  return [ordered]@{
    ok = ((Test-Path -LiteralPath $CatalogPath) -and $share -and $shareReadable -and $registryTrusted)
    repoRoot = [string]$RepoRoot
    catalogPath = $CatalogPath
    shareName = $ShareName
    shareUrl = $ShareUrl
    catalogExists = Test-Path -LiteralPath $CatalogPath
    shareExists = [bool]$share
    shareReadable = $shareReadable
    sharePath = if ($share) { [string]$share.Path } else { "" }
    registryTrusted = $registryTrusted
    registryUrl = $registryUrl
    clearInstalledExtensions = $clearInstalledExtensions
    officeWefCachePath = $OfficeWefCachePath
    officeWefCacheExists = Test-Path -LiteralPath $OfficeWefCachePath
    officeWefCacheItemCount = $officeWefCacheItemCount
    runningOfficeHosts = $runningOfficeHosts
    manifests = @($manifestTargets | ForEach-Object {
      [ordered]@{
        host = $_.host
        source = $_.source
        target = $_.target
        sourceExists = Test-Path -LiteralPath $_.source
        targetExists = Test-Path -LiteralPath $_.target
      }
    })
    isAdministrator = Test-IsAdministrator
  }
}

function Write-StatusJson {
  param([hashtable]$Extra = @{})
  $status = Get-OfficeAddinSetupStatus
  foreach ($key in $Extra.Keys) {
    $status[$key] = $Extra[$key]
  }
  $status | ConvertTo-Json -Depth 6 -Compress
}

if ($StatusOnly) {
  Write-StatusJson
  exit 0
}

if ($Elevate -and -not (Test-IsAdministrator)) {
  $argumentList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`""
  ) -join " "
  if ($ResetCache) {
    $argumentList = "$argumentList -ResetCache"
  }
  Start-Process -FilePath "powershell.exe" -ArgumentList $argumentList -Verb RunAs -Wait
  Write-StatusJson @{ elevationRequested = $true }
  exit 0
}

New-Item -Path $CatalogPath -ItemType Directory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot "office_addin\word\manifest.xml") -Destination (Join-Path $CatalogPath "uca-word.xml") -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "office_addin\excel\manifest.xml") -Destination (Join-Path $CatalogPath "uca-excel.xml") -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "office_addin\ppt\manifest.xml") -Destination (Join-Path $CatalogPath "uca-ppt.xml") -Force

$existingShare = $null
try {
  $existingShare = Get-SmbShare -Name $ShareName -ErrorAction Stop
} catch {}

if ($existingShare) {
  if ([string]$existingShare.Path -ne $CatalogPath) {
    throw "SMB share '$ShareName' already exists at '$($existingShare.Path)'. Please remove or rename it before running UCA Office setup."
  }
} else {
  New-SmbShare -Name $ShareName -Path $CatalogPath -ChangeAccess $env:USERNAME | Out-Null
}

New-Item -Path $TrustedCatalogKey -Force | Out-Null
New-ItemProperty -Path $TrustedCatalogKey -Name "Id" -Value $TrustedCatalogGuid -PropertyType String -Force | Out-Null
New-ItemProperty -Path $TrustedCatalogKey -Name "Url" -Value $ShareUrl -PropertyType String -Force | Out-Null
New-ItemProperty -Path $TrustedCatalogKey -Name "Flags" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $TrustedCatalogRootKey -Name "ClearInstalledExtensions" -Value 1 -PropertyType DWord -Force | Out-Null

$cacheReset = $false
if ($ResetCache -and (Test-Path -LiteralPath $OfficeWefCachePath)) {
  $runningOfficeHosts = @(Get-Process -Name $OfficeHostProcesses -ErrorAction SilentlyContinue)
  if ($runningOfficeHosts.Count -gt 0) {
    throw "Close Word, Excel, and PowerPoint before resetting the Office web add-in cache."
  }

  $resolvedCache = [System.IO.Path]::GetFullPath($OfficeWefCachePath)
  $allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Microsoft\Office\16.0"))
  if (-not $resolvedCache.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clear unexpected Office cache path '$resolvedCache'."
  }

  Get-ChildItem -LiteralPath $resolvedCache -Force | Remove-Item -Recurse -Force
  $cacheReset = $true
}

Write-StatusJson @{ configured = $true; cacheReset = $cacheReset }
