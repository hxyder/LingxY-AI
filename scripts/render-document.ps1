param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("docx", "xlsx", "pptx")]
  [string]$Kind,

  # Inline body — convenient for short payloads, but Windows command-lines
  # cap at ~8191 chars so long outlines must go through -TextFile instead.
  [Parameter(Mandatory = $false)]
  [string]$Text = "",

  # Path to a UTF-8 file containing the body. Preferred for anything
  # longer than a paragraph; the Node-side fallback always writes a
  # temp file and passes this flag.
  [Parameter(Mandatory = $false)]
  [string]$TextFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

if ($TextFile) {
  if (-not (Test-Path -LiteralPath $TextFile)) {
    throw "render-document.ps1: TextFile not found: $TextFile"
  }
  $Text = [System.IO.File]::ReadAllText($TextFile, [System.Text.UTF8Encoding]::new($false))
}
if ([string]::IsNullOrWhiteSpace($Text)) {
  throw "render-document.ps1: no text provided (both -Text and -TextFile are empty)"
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())

function Escape-XmlText {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  return [System.Security.SecurityElement]::Escape($Value)
}

function Write-Utf8File {
  param(
    [string]$RelativePath,
    [string]$Contents
  )
  $fullPath = Join-Path $tempRoot $RelativePath
  $parent = Split-Path -Parent $fullPath
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($fullPath, $Contents, $utf8)
}

function Get-TextLines {
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($Text -split "\r?\n")) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -gt 0) {
      $lines.Add($trimmed)
    }
  }
  if ($lines.Count -eq 0) {
    $lines.Add("UCA generated document")
  }
  return $lines
}

function Write-Docx {
  $lines = Get-TextLines
  $body = New-Object System.Text.StringBuilder
  foreach ($line in $lines) {
    $style = if ($line.StartsWith("# ")) { '<w:pStyle w:val="Heading1"/>' } else { "" }
    $clean = $line -replace "^#\s+", ""
    [void]$body.Append("<w:p><w:pPr>$style</w:pPr><w:r><w:t xml:space=`"preserve`">$(Escape-XmlText $clean)</w:t></w:r></w:p>")
  }

  Write-Utf8File "[Content_Types].xml" '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
  Write-Utf8File "_rels/.rels" '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  Write-Utf8File "word/_rels/document.xml.rels" '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
  Write-Utf8File "word/styles.xml" '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>'
  Write-Utf8File "word/document.xml" "<w:document xmlns:w=`"http://schemas.openxmlformats.org/wordprocessingml/2006/main`"><w:body>$($body.ToString())<w:sectPr><w:pgSz w:w=`"12240`" w:h=`"15840`"/><w:pgMar w:top=`"1440`" w:right=`"1440`" w:bottom=`"1440`" w:left=`"1440`"/></w:sectPr></w:body></w:document>"
}

function Write-Xlsx {
  $lines = Get-TextLines
  $sheetData = New-Object System.Text.StringBuilder
  for ($rowIndex = 0; $rowIndex -lt $lines.Count; $rowIndex++) {
    $rowNumber = $rowIndex + 1
    [void]$sheetData.Append("<row r=`"$rowNumber`">")
    $cells = $lines[$rowIndex] -split "\t|,"
    for ($cellIndex = 0; $cellIndex -lt $cells.Count; $cellIndex++) {
      $col = [char]([int][char]'A' + $cellIndex)
      $cellRef = "$col$rowNumber"
      [void]$sheetData.Append("<c r=`"$cellRef`" t=`"inlineStr`"><is><t>$(Escape-XmlText $cells[$cellIndex].Trim())</t></is></c>")
    }
    [void]$sheetData.Append("</row>")
  }

  Write-Utf8File "[Content_Types].xml" '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  Write-Utf8File "_rels/.rels" '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  Write-Utf8File "xl/_rels/workbook.xml.rels" '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
  Write-Utf8File "xl/workbook.xml" '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
  Write-Utf8File "xl/worksheets/sheet1.xml" "<worksheet xmlns=`"http://schemas.openxmlformats.org/spreadsheetml/2006/main`"><sheetData>$($sheetData.ToString())</sheetData></worksheet>"
}

function Write-Pptx {
  $blocks = New-Object System.Collections.Generic.List[string]
  foreach ($block in ($Text -split "(\r?\n){2,}")) {
    $trimmed = $block.Trim()
    if ($trimmed.Length -gt 0) {
      $blocks.Add($trimmed)
    }
  }
  if ($blocks.Count -eq 0) {
    $blocks.Add("UCA generated presentation")
  }

  $contentTypes = New-Object System.Text.StringBuilder
  [void]$contentTypes.Append('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>')
  for ($i = 1; $i -le $blocks.Count; $i++) {
    [void]$contentTypes.Append(('<Override PartName="/ppt/slides/slide{0}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' -f $i))
  }
  [void]$contentTypes.Append('</Types>')

  $rels = New-Object System.Text.StringBuilder
  [void]$rels.Append('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')
  for ($i = 1; $i -le $blocks.Count; $i++) {
    [void]$rels.Append(('<Relationship Id="rId{0}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{0}.xml"/>' -f $i))
  }
  [void]$rels.Append('</Relationships>')

  $slideIds = New-Object System.Text.StringBuilder
  for ($i = 1; $i -le $blocks.Count; $i++) {
    [void]$slideIds.Append(('<p:sldId id="{0}" r:id="rId{1}"/>' -f (255 + $i), $i))
  }

  Write-Utf8File "[Content_Types].xml" $contentTypes.ToString()
  Write-Utf8File "_rels/.rels" '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'
  Write-Utf8File "ppt/_rels/presentation.xml.rels" $rels.ToString()
  Write-Utf8File "ppt/presentation.xml" "<p:presentation xmlns:p=`"http://schemas.openxmlformats.org/presentationml/2006/main`" xmlns:r=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships`"><p:sldIdLst>$($slideIds.ToString())</p:sldIdLst><p:sldSz cx=`"9144000`" cy=`"5143500`" type=`"screen16x9`"/><p:notesSz cx=`"6858000`" cy=`"9144000`"/></p:presentation>"

  for ($i = 1; $i -le $blocks.Count; $i++) {
    $lines = $blocks[$i - 1] -split "\r?\n"
    $title = if ($lines.Count -gt 0) { $lines[0].TrimStart("#", " ").Trim() } else { "Slide $i" }
    $paragraphs = New-Object System.Text.StringBuilder
    if ($lines.Count -gt 1) {
      for ($lineIndex = 1; $lineIndex -lt $lines.Count; $lineIndex++) {
        $line = $lines[$lineIndex].TrimStart("-", "*", " ").Trim()
        if ($line.Length -gt 0) {
          [void]$paragraphs.Append("<a:p><a:r><a:t>$(Escape-XmlText $line)</a:t></a:r></a:p>")
        }
      }
    }
    if ($paragraphs.Length -eq 0) {
      [void]$paragraphs.Append('<a:p/>')
    }

    $slideXml = "<p:sld xmlns:p=`"http://schemas.openxmlformats.org/presentationml/2006/main`" xmlns:a=`"http://schemas.openxmlformats.org/drawingml/2006/main`"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=`"1`" name=`"`"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id=`"2`" name=`"Title`"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x=`"457200`" y=`"274320`"/><a:ext cx=`"8229600`" cy=`"914400`"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz=`"3600`" b=`"1`"/><a:t>$(Escape-XmlText $title)</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id=`"3`" name=`"Content`"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x=`"685800`" y=`"1371600`"/><a:ext cx=`"7772400`" cy=`"3200400`"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>$($paragraphs.ToString())</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
    Write-Utf8File ("ppt/slides/slide{0}.xml" -f $i) $slideXml
    Write-Utf8File ("ppt/slides/_rels/slide{0}.xml.rels" -f $i) '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  }
}

try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  switch ($Kind) {
    "docx" { Write-Docx }
    "xlsx" { Write-Xlsx }
    "pptx" { Write-Pptx }
  }

  $targetParent = Split-Path -Parent $TargetPath
  if ($targetParent -and -not (Test-Path $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
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
