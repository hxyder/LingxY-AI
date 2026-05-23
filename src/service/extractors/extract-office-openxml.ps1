param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [Parameter(Mandatory = $true)]
  [string]$Mime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
$tempArchivePath = Join-Path ([System.IO.Path]::GetTempPath()) ("ooxml-" + [System.Guid]::NewGuid().ToString() + ".zip")
try {
  $parts = New-Object System.Collections.Generic.List[string]
  Copy-Item -LiteralPath $TargetPath -Destination $tempArchivePath -Force
  Expand-Archive -LiteralPath $tempArchivePath -DestinationPath $tempRoot -Force

  $files = Get-ChildItem -LiteralPath $tempRoot -Recurse -File -Filter *.xml
  foreach ($file in $files) {
    $xml = Get-Content -LiteralPath $file.FullName -Raw
    $text = [regex]::Replace($xml, "<[^>]+>", " ")
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    $text = [regex]::Replace($text, "\s+", " ").Trim()

    if (-not [string]::IsNullOrWhiteSpace($text)) {
      $parts.Add($text)
    }
  }

  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::Write(($parts -join [Environment]::NewLine))
} finally {
  if (Test-Path $tempArchivePath) {
    Remove-Item -LiteralPath $tempArchivePath -Force
  }
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Force -Recurse
  }
}
