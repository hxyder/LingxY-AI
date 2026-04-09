param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("docx", "xlsx")]
  [string]$Kind,

  [Parameter(Mandatory = $true)]
  [string]$Text
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$utf8 = [System.Text.UTF8Encoding]::new($false)
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())

try {
  switch ($Kind) {
    "docx" {
      New-Item -ItemType Directory -Path (Join-Path $tempRoot "word") -Force | Out-Null
      [System.IO.File]::WriteAllText(
        (Join-Path $tempRoot "[Content_Types].xml"),
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        $utf8
      )
      [System.IO.File]::WriteAllText(
        (Join-Path $tempRoot "word/document.xml"),
        "<w:document xmlns:w=`"http://schemas.openxmlformats.org/wordprocessingml/2006/main`"><w:body><w:p><w:r><w:t>$Text</w:t></w:r></w:p></w:body></w:document>",
        $utf8
      )
    }
    "xlsx" {
      New-Item -ItemType Directory -Path (Join-Path $tempRoot "xl/worksheets") -Force | Out-Null
      [System.IO.File]::WriteAllText(
        (Join-Path $tempRoot "[Content_Types].xml"),
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
        $utf8
      )
      [System.IO.File]::WriteAllText(
        (Join-Path $tempRoot "xl/workbook.xml"),
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>',
        $utf8
      )
      [System.IO.File]::WriteAllText(
        (Join-Path $tempRoot "xl/sharedStrings.xml"),
        "<sst xmlns=`"http://schemas.openxmlformats.org/spreadsheetml/2006/main`" count=`"2`" uniqueCount=`"2`"><si><t>$Text</t></si><si><t>42</t></si></sst>",
        $utf8
      )
      [System.IO.File]::WriteAllText(
        (Join-Path $tempRoot "xl/worksheets/sheet1.xml"),
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>',
        $utf8
      )
    }
  }

  if (Test-Path $TargetPath) {
    Remove-Item -LiteralPath $TargetPath -Force
  }

  [System.IO.Compression.ZipFile]::CreateFromDirectory($tempRoot, $TargetPath)
} finally {
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Force -Recurse
  }
}
