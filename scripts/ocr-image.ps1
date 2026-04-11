param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = "Stop"

# Force UTF-8 stdout (no BOM) so OCR'd CJK text survives Node's UTF-8 decode.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

# OCR strategy:
#   1. Windows.Media.Ocr (built into Windows 10/11, free, no install)
#   2. Tesseract (if installed on PATH)
#   3. Empty result (Vision API will analyze the image directly)

# Resolve to an absolute path -- Windows.Storage.StorageFile requires it
try {
  $ImagePath = (Resolve-Path -LiteralPath $ImagePath -ErrorAction Stop).Path
} catch {
  @{ ok = $true; text = ""; lineCount = 0; engine = "none"; error = "image_not_found" } | ConvertTo-Json -Compress
  exit 0
}

# --- Try Windows.Media.Ocr --------------------------------------------------
$ocrText = $null
$ocrEngine = $null
$ocrLineCount = 0
$wmocrError = $null

try {
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and `
    $_.GetParameters().Count -eq 1 -and `
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

  function Invoke-WinRtAsync {
    param($AsyncOp, $ResultType)
    $asTask = $script:asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($AsyncOp))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }
  $script:asTaskGeneric = $asTaskGeneric

  $storageFile = Invoke-WinRtAsync ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
  $stream = Invoke-WinRtAsync ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Invoke-WinRtAsync ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Invoke-WinRtAsync ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -ne $engine) {
    $result = Invoke-WinRtAsync ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    if ($null -ne $result -and -not [string]::IsNullOrWhiteSpace($result.Text)) {
      $ocrText = $result.Text
      $ocrEngine = "windows-media-ocr"
      $ocrLineCount = $result.Lines.Count
    }
  }
} catch {
  $wmocrError = $_.Exception.Message
}

if ($null -ne $ocrText) {
  @{ ok = $true; text = $ocrText; lineCount = $ocrLineCount; engine = $ocrEngine } | ConvertTo-Json -Compress
  exit 0
}

# --- Try Tesseract ----------------------------------------------------------
try {
  $tesseract = Get-Command "tesseract" -ErrorAction SilentlyContinue
  if ($null -ne $tesseract) {
    $tempOut = [System.IO.Path]::GetTempFileName()
    & tesseract $ImagePath $tempOut --oem 3 --psm 3 2>$null
    $text = Get-Content "$tempOut.txt" -Raw -ErrorAction SilentlyContinue
    Remove-Item "$tempOut*" -Force -ErrorAction SilentlyContinue

    if ($text -and $text.Trim().Length -gt 0) {
      @{
        ok = $true
        text = $text.Trim()
        lineCount = ($text -split "`n").Count
        engine = "tesseract"
      } | ConvertTo-Json -Compress
      exit 0
    }
  }
} catch {}

# --- Fallback: empty result (Vision API will analyze the image directly) ----
$empty = @{ ok = $true; text = ""; lineCount = 0; engine = "none" }
if ($null -ne $wmocrError) { $empty.error = $wmocrError }
$empty | ConvertTo-Json -Compress
