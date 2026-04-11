param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("docx", "xlsx", "pptx")]
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
    "pptx" {
      # UCA-049: minimal-but-valid pptx package. The outline text is split
      # into slides on a blank line. Each slide gets its own slideN.xml +
      # relationships. We keep it intentionally simple (no theme / images)
      # so PowerPoint/LibreOffice can open it without warnings, while still
      # producing a real, readable .pptx that downstream tooling (UCA-042
      # multi-intent / UCA-044 email digest) can later enrich.

      New-Item -ItemType Directory -Path (Join-Path $tempRoot "ppt/slides/_rels") -Force | Out-Null
      New-Item -ItemType Directory -Path (Join-Path $tempRoot "ppt/_rels") -Force | Out-Null
      New-Item -ItemType Directory -Path (Join-Path $tempRoot "_rels") -Force | Out-Null

      $slideBlocks = @()
      foreach ($block in ($Text -split "(\r?\n){2,}")) {
        $trimmed = $block.Trim()
        if ($trimmed.Length -gt 0) { $slideBlocks += ,$trimmed }
      }
      if ($slideBlocks.Count -eq 0) { $slideBlocks = ,"UCA generated pptx (empty)" }

      $contentTypes = New-Object System.Text.StringBuilder
      [void]$contentTypes.Append('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">')
      [void]$contentTypes.Append('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>')
      [void]$contentTypes.Append('<Default Extension="xml" ContentType="application/xml"/>')
      [void]$contentTypes.Append('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>')
      for ($i = 1; $i -le $slideBlocks.Count; $i++) {
        [void]$contentTypes.Append(('<Override PartName="/ppt/slides/slide{0}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' -f $i))
      }
      [void]$contentTypes.Append('</Types>')
      [System.IO.File]::WriteAllText((Join-Path $tempRoot "[Content_Types].xml"), $contentTypes.ToString(), $utf8)

      [System.IO.File]::WriteAllText(
        (Join-Path $tempRoot "_rels/.rels"),
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        $utf8
      )

      $presRels = New-Object System.Text.StringBuilder
      [void]$presRels.Append('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">')
      for ($i = 1; $i -le $slideBlocks.Count; $i++) {
        [void]$presRels.Append(('<Relationship Id="rId{0}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{0}.xml"/>' -f $i))
      }
      [void]$presRels.Append('</Relationships>')
      [System.IO.File]::WriteAllText((Join-Path $tempRoot "ppt/_rels/presentation.xml.rels"), $presRels.ToString(), $utf8)

      $presentation = New-Object System.Text.StringBuilder
      [void]$presentation.Append('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>')
      for ($i = 1; $i -le $slideBlocks.Count; $i++) {
        [void]$presentation.Append(('<p:sldId id="{0}" r:id="rId{1}"/>' -f (255 + $i), $i))
      }
      [void]$presentation.Append('</p:sldIdLst></p:presentation>')
      [System.IO.File]::WriteAllText((Join-Path $tempRoot "ppt/presentation.xml"), $presentation.ToString(), $utf8)

      for ($i = 1; $i -le $slideBlocks.Count; $i++) {
        $block = $slideBlocks[$i - 1]
        $escaped = $block.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')
        $slideXml = ('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{0}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>' -f $escaped)
        [System.IO.File]::WriteAllText((Join-Path $tempRoot ("ppt/slides/slide{0}.xml" -f $i)), $slideXml, $utf8)
        [System.IO.File]::WriteAllText((Join-Path $tempRoot ("ppt/slides/_rels/slide{0}.xml.rels" -f $i)), '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>', $utf8)
      }
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
