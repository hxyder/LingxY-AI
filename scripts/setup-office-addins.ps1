param(
  [switch]$Elevate,
  [switch]$StatusOnly
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
$TrustedCatalogKey = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\$TrustedCatalogGuid"

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
  try {
    $catalog = Get-ItemProperty -Path $TrustedCatalogKey -ErrorAction Stop
    $registryUrl = [string]$catalog.Url
    $registryTrusted = $registryUrl -eq $ShareUrl -and [int]$catalog.Flags -eq 1
  } catch {}

  return [ordered]@{
    ok = ((Test-Path -LiteralPath $CatalogPath) -and $share -and $registryTrusted)
    repoRoot = [string]$RepoRoot
    catalogPath = $CatalogPath
    shareName = $ShareName
    shareUrl = $ShareUrl
    catalogExists = Test-Path -LiteralPath $CatalogPath
    shareExists = [bool]$share
    sharePath = if ($share) { [string]$share.Path } else { "" }
    registryTrusted = $registryTrusted
    registryUrl = $registryUrl
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

Write-StatusJson @{ configured = $true }
