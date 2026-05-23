# UCA-047 — Active window deep context probe.
#
# Invoked by src/desktop/tray/electron-main.mjs's captureActiveWindowContext()
# whenever the user triggers a context capture hotkey. Figures out what the
# user is actually looking at right now and returns it as a single JSON blob:
#
#   {
#     ok: true,
#     process: "msedge",
#     pid: 12345,
#     title: "UCA-047 · Active window probe — Claude · Microsoft Edge",
#     detected_kind: "web_url" | "file_path" | "window_title" | "unknown",
#     payload: {
#       url: "https://claude.ai/chat/abc",       // web_url
#       filePath: "C:\\Users\\der\\Documents\\report.docx",  // file_path
#       extra: { raw_title, raw_folder }        // window_title / unknown
#     },
#     blocked: false
#   }
#
# Failure shape:
#   { ok: false, reason: "blocklisted_process" | "no_foreground" | "probe_failed", ... }
#
# Conventions:
#  - UTF-8 no-BOM stdout (same as capture-context.ps1), so Node's JSON.parse
#    can consume it without a BOM stripping step
#  - Every probe branch wrapped in try/catch — probe must never crash
#  - Hardcoded blocklist is the *baseline*; UCA-048 will let the user extend
#    it via Settings.v2 feature flags

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

# --- Win32 foreground window helpers (same shape as capture-context.ps1) ---

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class UcaActiveWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    public static string GetForegroundTitle() {
        var sb = new StringBuilder(1024);
        GetWindowText(GetForegroundWindow(), sb, 1024);
        return sb.ToString();
    }

    public static string GetWindowTitle(IntPtr hWnd) {
        var sb = new StringBuilder(1024);
        GetWindowText(hWnd, sb, 1024);
        return sb.ToString();
    }

    public static uint GetForegroundPid() {
        uint pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid;
    }

    public static uint GetWindowPid(IntPtr hWnd) {
        uint pid = 0;
        GetWindowThreadProcessId(hWnd, out pid);
        return pid;
    }

    public static IntPtr GetForegroundHandle() {
        return GetForegroundWindow();
    }

    public static IntPtr GetNextWindow(IntPtr hWnd) {
        return GetWindow(hWnd, 2);
    }

    public static bool IsVisible(IntPtr hWnd) {
        return IsWindowVisible(hWnd);
    }

    public static RECT GetBounds(IntPtr hWnd) {
        RECT rect;
        if (!GetWindowRect(hWnd, out rect)) {
            rect.Left = 0;
            rect.Top = 0;
            rect.Right = 0;
            rect.Bottom = 0;
        }
        return rect;
    }
}
'@ -ReferencedAssemblies @() -ErrorAction SilentlyContinue

# ---- Default blocklist ------------------------------------------------------
# Keep this conservative. UCA-048 will let users edit this via Settings → Features.
$BLOCKLIST_PROCESSES = @(
  "KeePass",
  "KeePassXC",
  "1Password",
  "BitWarden",
  "Dashlane",
  "LastPass",
  "BankClient",
  "TokenKeeper",
  "Authy"
)

# ---- Helpers ---------------------------------------------------------------

function Write-JsonLine {
  param([object]$Object)
  $json = $Object | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Write-ProbeFailure {
  param([string]$Reason, [hashtable]$Extra = @{})
  $payload = @{ ok = $false; reason = $Reason }
  foreach ($k in $Extra.Keys) { $payload[$k] = $Extra[$k] }
  Write-JsonLine -Object $payload
  exit 0
}

function Test-Blocklisted {
  param([string]$ProcessName, [string]$Title)
  foreach ($blocked in $BLOCKLIST_PROCESSES) {
    if ($ProcessName -and ($ProcessName -ieq $blocked)) { return $true }
  }
  # Title heuristics for private/incognito browser sessions — we deliberately
  # refuse to probe URLs in those windows even though the user might have
  # granted probe permission at the app level.
  if ($Title -match "(?i)in ?private|incognito|隐身") { return $true }
  return $false
}

function Convert-FileUrlToPath {
  param([string]$Url)
  try {
    $uri = [System.Uri]$Url
    if (-not $uri.IsFile) { return $null }
    return $uri.LocalPath
  } catch {
    return $null
  }
}

function Get-ProcessNameForPid {
  param([uint32]$ProcessId)
  if (-not $ProcessId -or $ProcessId -eq 0) { return "" }
  try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
    return $proc.ProcessName
  } catch {
    return ""
  }
}

function Test-LingxyShellWindow {
  param([string]$ProcessName, [string]$Title)
  $name = ""
  if ($ProcessName) { $name = $ProcessName.ToLowerInvariant() }
  $rawTitle = ""
  if ($Title) { $rawTitle = $Title.ToLowerInvariant() }

  if ($name -eq "lingxy" -or $name -eq "uca" -or $name -eq "universal-context-agent") { return $true }
  if (($name -eq "electron" -or $name -eq "node") -and ($rawTitle -match "lingxy|uca|universal context agent")) { return $true }
  if ($rawTitle -match "^(lingxy|uca)$") { return $true }
  if ($rawTitle -match "^(lingxy|uca)\s+(overlay|dock|console|preview|popup|echo bubble|browser)") { return $true }
  if ($rawTitle -match "universal context agent") { return $true }
  return $false
}

function New-ProbeWindowInfo {
  param([IntPtr]$WindowHandle)
  if ($WindowHandle -eq [IntPtr]::Zero) { return $null }
  try {
    $title = [UcaActiveWindow]::GetWindowTitle($WindowHandle)
    $windowPid = [UcaActiveWindow]::GetWindowPid($WindowHandle)
    $procName = Get-ProcessNameForPid -ProcessId $windowPid
    $bounds = [UcaActiveWindow]::GetBounds($WindowHandle)
    return @{
      handle = $WindowHandle
      title = $title
      pid = [uint32]$windowPid
      processName = $procName
      bounds = @{
        left = [int]$bounds.Left
        top = [int]$bounds.Top
        right = [int]$bounds.Right
        bottom = [int]$bounds.Bottom
        width = [int]([Math]::Max(0, $bounds.Right - $bounds.Left))
        height = [int]([Math]::Max(0, $bounds.Bottom - $bounds.Top))
      }
    }
  } catch {
    return $null
  }
}

function Test-ProbeWindowInfoUsable {
  param([hashtable]$Info)
  if (-not $Info) { return $false }
  if (-not $Info.pid -or $Info.pid -eq 0) { return $false }
  if (-not $Info.processName) { return $false }
  if (-not $Info.title) { return $false }
  return $true
}

function Resolve-ProbeWindowInfo {
  $foreground = [UcaActiveWindow]::GetForegroundHandle()
  $foregroundInfo = New-ProbeWindowInfo -WindowHandle $foreground
  if ((Test-ProbeWindowInfoUsable -Info $foregroundInfo) -and
      -not (Test-LingxyShellWindow -ProcessName $foregroundInfo.processName -Title $foregroundInfo.title)) {
    return $foregroundInfo
  }

  # If the Overlay/Dock has focus, walk down the top-level Z order and use the
  # next visible non-LingxY window instead of returning LingxY itself.
  $cursor = $foreground
  for ($i = 0; $i -lt 80; $i += 1) {
    if ($cursor -eq [IntPtr]::Zero) { break }
    $cursor = [UcaActiveWindow]::GetNextWindow($cursor)
    if ($cursor -eq [IntPtr]::Zero) { break }
    if (-not [UcaActiveWindow]::IsVisible($cursor)) { continue }
    $info = New-ProbeWindowInfo -WindowHandle $cursor
    if (-not (Test-ProbeWindowInfoUsable -Info $info)) { continue }
    if (Test-LingxyShellWindow -ProcessName $info.processName -Title $info.title) { continue }
    return $info
  }

  if ($foregroundInfo -and (Test-LingxyShellWindow -ProcessName $foregroundInfo.processName -Title $foregroundInfo.title)) {
    return $null
  }
  return $foregroundInfo
}

# ---- Browser URL probe (UI Automation) -------------------------------------

function Get-BrowserUrl {
  param([IntPtr]$WindowHandle, [string]$WindowTitle)

  try {
    # Loading UIAutomationClient is expensive. Only attempt it for browsers.
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
    if (-not $root) { return $null }

    $editCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit
    )
    $edits = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      $editCondition
    )

    foreach ($edit in $edits) {
      $name = $edit.Current.Name
      if ([string]::IsNullOrEmpty($name)) { continue }
      # Match the English + CJK names Edge / Chrome / Firefox actually use.
      $isAddressBar = $name -match "(?i)address|地址|搜索栏|URL|omnibox"
      if (-not $isAddressBar) { continue }

      # Try ValuePattern first — most accurate way to read the address bar text.
      $valuePatternObj = $null
      if ($edit.TryGetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern,
            [ref]$valuePatternObj)) {
        $candidate = $valuePatternObj.Current.Value
        if ($candidate) { return $candidate }
      }

      # Fallback to LegacyIAccessiblePattern.Value
      $legacyPatternObj = $null
      if ($edit.TryGetCurrentPattern(
            [System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,
            [ref]$legacyPatternObj)) {
        $candidate = $legacyPatternObj.Current.Value
        if ($candidate) { return $candidate }
      }
    }
  } catch {
    return $null
  }
  return $null
}

function New-BrowserResult {
  param([string]$Process, [uint32]$ProcessId, [string]$Title, [IntPtr]$WindowHandle)

  $url = Get-BrowserUrl -WindowHandle $WindowHandle -WindowTitle $Title

  if ($url) {
    # The address bar sometimes omits the scheme — normalize.
    if ($url -notmatch "^(https?|file|chrome|edge|about):") {
      if ($url -match "^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}") {
        $url = "https://$url"
      }
    }
    $filePath = Convert-FileUrlToPath -Url $url
    if ($filePath) {
      return @{
        ok = $true
        process = $Process
        pid = [int]$ProcessId
        title = $Title
        detected_kind = "file_path"
        payload = @{ filePath = $filePath; extra = @{ source = "browser_file_url"; raw_url = $url } }
        blocked = $false
      }
    }
    return @{
      ok = $true
      process = $Process
      pid = [int]$ProcessId
      title = $Title
      detected_kind = "web_url"
      payload = @{ url = $url }
      blocked = $false
    }
  }

  # Address bar unreadable (minimised / DPI scaling / Widevine block / etc.)
  return @{
    ok = $true
    process = $Process
    pid = [int]$ProcessId
    title = $Title
    detected_kind = "window_title"
    payload = @{ extra = @{ reason = "address_bar_unreadable"; raw_title = $Title } }
    blocked = $false
  }
}

# ---- Office COM probe ------------------------------------------------------

function Convert-OfficeText {
  param([object]$Value, [int]$MaxChars = 30000)
  try {
    $text = [string]$Value
    if (-not $text) { return $null }
    $normalized = $text.Trim()
    if (-not $normalized) { return $null }
    if ($normalized.Length -gt $MaxChars) {
      return $normalized.Substring(0, $MaxChars) + "...[truncated]"
    }
    return $normalized
  } catch {
    return $null
  }
}

function Get-PowerPointText {
  param([object]$Presentation, [int]$MaxChars = 30000)
  try {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($slide in @($Presentation.Slides)) {
      foreach ($shape in @($slide.Shapes)) {
        try {
          if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
            $text = Convert-OfficeText -Value $shape.TextFrame.TextRange.Text -MaxChars $MaxChars
            if ($text) { [void]$parts.Add($text) }
          }
        } catch {}
      }
    }
    return Convert-OfficeText -Value ($parts -join "`n") -MaxChars $MaxChars
  } catch {
    return $null
  }
}

function Get-ExcelText {
  param([object]$Workbook, [int]$MaxChars = 30000)
  try {
    $sheet = $Workbook.Application.ActiveSheet
    if (-not $sheet) { return $null }
    $used = $sheet.UsedRange
    if (-not $used) { return $null }
    $rows = [Math]::Min([int]$used.Rows.Count, 80)
    $cols = [Math]::Min([int]$used.Columns.Count, 30)
    $lines = New-Object System.Collections.Generic.List[string]
    for ($r = 1; $r -le $rows; $r += 1) {
      $cells = New-Object System.Collections.Generic.List[string]
      for ($c = 1; $c -le $cols; $c += 1) {
        try {
          $value = [string]$used.Cells.Item($r, $c).Text
          if ($value) { [void]$cells.Add($value) } else { [void]$cells.Add("") }
        } catch {
          [void]$cells.Add("")
        }
      }
      $line = (($cells.ToArray()) -join "`t").Trim()
      if ($line) { [void]$lines.Add($line) }
    }
    return Convert-OfficeText -Value ($lines -join "`n") -MaxChars $MaxChars
  } catch {
    return $null
  }
}

function Get-OfficeDocumentContext {
  param([string]$Process)

  try {
    switch -Regex ($Process) {
      "^winword$" {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
        if ($app -and $app.ActiveDocument) {
          return @{
            filePath = [string]$app.ActiveDocument.FullName
            documentName = [string]$app.ActiveDocument.Name
            text = Convert-OfficeText -Value $app.ActiveDocument.Content.Text
            officeApp = "Word"
          }
        }
      }
      "^excel$" {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
        if ($app -and $app.ActiveWorkbook) {
          return @{
            filePath = [string]$app.ActiveWorkbook.FullName
            documentName = [string]$app.ActiveWorkbook.Name
            text = Get-ExcelText -Workbook $app.ActiveWorkbook
            officeApp = "Excel"
          }
        }
      }
      "^powerpnt$" {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
        if ($app -and $app.ActivePresentation) {
          return @{
            filePath = [string]$app.ActivePresentation.FullName
            documentName = [string]$app.ActivePresentation.Name
            text = Get-PowerPointText -Presentation $app.ActivePresentation
            officeApp = "PowerPoint"
          }
        }
      }
    }
  } catch {
    return $null
  }
  return $null
}

function Get-OfficeAppLabel {
  param([string]$Process)
  switch -Regex ($Process) {
    "^winword$" { return "Word" }
    "^excel$" { return "Excel" }
    "^powerpnt$" { return "PowerPoint" }
  }
  return "Office"
}

function Get-OfficeTitleFilename {
  param([string]$Title, [string]$Process)
  $appLabel = Get-OfficeAppLabel -Process $Process
  $appPattern = [regex]::Escape($appLabel)
  $patterns = @(
    "^(?<name>.+?)\s+-\s+Read-Only\s+-\s+$appPattern$",
    "^(?<name>.+?)\s+\[Read-Only\]\s+-\s+$appPattern$",
    "^(?<name>.+?)\s+-\s+Protected View\s+-\s+$appPattern$",
    "^(?<name>.+?)\s+-\s+Compatibility Mode\s+-\s+$appPattern$",
    "^(?<name>.+?)\s+-\s+$appPattern$"
  )
  foreach ($pattern in $patterns) {
    if ($Title -match $pattern) {
      $name = $Matches.name.Trim()
      if ($name) { return $name }
    }
  }
  return $null
}

function Add-UniquePath {
  param([System.Collections.Generic.List[string]]$Paths, [string]$Path)
  if (-not $Path) { return }
  try {
    $normalized = [System.IO.Path]::GetFullPath($Path)
    if ((Test-Path -LiteralPath $normalized) -and -not $Paths.Contains($normalized)) {
      [void]$Paths.Add($normalized)
    }
  } catch {}
}

function Add-PathCandidatesFromText {
  param(
    [System.Collections.Generic.List[string]]$Paths,
    [string]$Text,
    [string]$FileName
  )
  if (-not $Text -or -not $FileName) { return }
  $escapedFile = [regex]::Escape($FileName)
  $matches = [regex]::Matches($Text, "([A-Za-z]:\\[^`r`n\]\[]*?$escapedFile)", "IgnoreCase")
  foreach ($match in $matches) {
    Add-UniquePath -Paths $Paths -Path $match.Groups[1].Value
  }
}

function Resolve-OfficeRecentFilePath {
  param([string]$FileName, [string]$Process)
  if (-not $FileName) { return $null }
  $paths = New-Object System.Collections.Generic.List[string]
  $officeApp = Get-OfficeAppLabel -Process $Process

  try {
    $officeRoot = "HKCU:\Software\Microsoft\Office"
    if (Test-Path $officeRoot) {
      foreach ($versionKey in @(Get-ChildItem $officeRoot -ErrorAction SilentlyContinue)) {
        $mruPath = Join-Path $versionKey.PSPath "$officeApp\File MRU"
        if (-not (Test-Path $mruPath)) { continue }
        $props = Get-ItemProperty -Path $mruPath -ErrorAction SilentlyContinue
        foreach ($prop in @($props.PSObject.Properties)) {
          if ($prop.Name -notmatch "^Item") { continue }
          Add-PathCandidatesFromText -Paths $paths -Text ([string]$prop.Value) -FileName $FileName
        }
      }
    }
  } catch {}

  try {
    $recentDir = Join-Path $env:APPDATA "Microsoft\Windows\Recent"
    if (Test-Path $recentDir) {
      $wsh = New-Object -ComObject WScript.Shell
      $links = Get-ChildItem -LiteralPath $recentDir -Filter "*.lnk" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 120
      foreach ($link in @($links)) {
        try {
          $shortcut = $wsh.CreateShortcut($link.FullName)
          $target = [string]$shortcut.TargetPath
          if ($target -and ([System.IO.Path]::GetFileName($target) -ieq $FileName)) {
            Add-UniquePath -Paths $paths -Path $target
          }
        } catch {}
      }
    }
  } catch {}

  if ($paths.Count -gt 0) { return $paths[0] }
  return $null
}

function New-OfficeResult {
  param([string]$Process, [uint32]$ProcessId, [string]$Title)

  $officeContext = Get-OfficeDocumentContext -Process $Process
  $filePath = $null
  if ($officeContext -and $officeContext.filePath) {
    $filePath = [string]$officeContext.filePath
  }

  if ($filePath -and (Test-Path -LiteralPath $filePath)) {
    return @{
      ok = $true
      process = $Process
      pid = [int]$ProcessId
      title = $Title
      detected_kind = "file_path"
      payload = @{ filePath = $filePath; extra = @{ source = "office_com"; office_app = $officeContext.officeApp; document_name = $officeContext.documentName } }
      blocked = $false
    }
  }

  if ($officeContext -and $officeContext.text) {
    return @{
      ok = $true
      process = $Process
      pid = [int]$ProcessId
      title = $Title
      detected_kind = "office_text"
      payload = @{
        text = $officeContext.text
        extra = @{
          source = "office_com"
          office_app = $officeContext.officeApp
          document_name = $officeContext.documentName
          file_path_unavailable = $true
        }
      }
      blocked = $false
    }
  }

  # COM might be disabled by group policy / no running Office app / etc. Fall
  # back to title parsing: Word titles look like `report.docx - Word` or
  # `report.docx [Read-Only] - Word`.
  $parsedName = Get-OfficeTitleFilename -Title $Title -Process $Process
  if ($parsedName) {
    $recentPath = Resolve-OfficeRecentFilePath -FileName $parsedName -Process $Process
    if ($recentPath) {
      return @{
        ok = $true
        process = $Process
        pid = [int]$ProcessId
        title = $Title
        detected_kind = "file_path"
        payload = @{ filePath = $recentPath; extra = @{ source = "office_recent_file"; parsed_filename = $parsedName; raw_title = $Title } }
        blocked = $false
      }
    }
  }

  return @{
    ok = $true
    process = $Process
    pid = [int]$ProcessId
    title = $Title
    detected_kind = if ($parsedName) { "window_title" } else { "unknown" }
    payload = @{ extra = @{ reason = "com_unavailable"; parsed_filename = $parsedName; raw_title = $Title } }
    blocked = $false
  }
}

# ---- IDE / editor probe ----------------------------------------------------

function New-EditorResult {
  param([string]$Process, [uint32]$ProcessId, [string]$Title)

  # VSCode: "filename.ext - folder - Visual Studio Code"
  # JetBrains Rider/IDEA/PyCharm: "project [path] - file.ext"
  # Sublime / Notepad++: "file.ext - Editor"
  $parsedFilename = $null
  $parsedFolder = $null

  if ($Title -match "^(?<file>[^-]+?)\s+-\s+(?<folder>.+?)\s+-\s+Visual Studio Code\b") {
    $parsedFilename = $Matches.file.Trim()
    $parsedFolder = $Matches.folder.Trim()
  } elseif ($Title -match "^(?<project>.+?)\s+\[(?<path>[^\]]+)\]") {
    # JetBrains
    $parsedFolder = $Matches.path.Trim()
    if ($Title -match "-\s+(?<file>[^-]+?)$") {
      $parsedFilename = $Matches.file.Trim()
    }
  } elseif ($Title -match "^(?<file>.+?)\s+-\s+(Notepad\+\+|Sublime Text)") {
    $parsedFilename = $Matches.file.Trim()
  }

  if ($parsedFilename) {
    return @{
      ok = $true
      process = $Process
      pid = [int]$ProcessId
      title = $Title
      detected_kind = "file_path"
      payload = @{
        filePath = $parsedFilename
        extra = @{ parsed_folder = $parsedFolder; source = "window_title" }
      }
      blocked = $false
    }
  }

  return @{
    ok = $true
    process = $Process
    pid = [int]$ProcessId
    title = $Title
    detected_kind = "window_title"
    payload = @{ extra = @{ reason = "title_unparsed"; raw_title = $Title } }
    blocked = $false
  }
}

# ---- Main dispatch ---------------------------------------------------------

try {
  $windowInfo = Resolve-ProbeWindowInfo
  if (-not $windowInfo) {
    Write-ProbeFailure -Reason "no_foreground"
  }
  $handle = $windowInfo.handle
  $title = $windowInfo.title
  $fgPid = $windowInfo.pid

  if (-not $fgPid -or $fgPid -eq 0) {
    Write-ProbeFailure -Reason "no_foreground"
  }

  $procName = $windowInfo.processName
  if (-not $procName) {
    Write-ProbeFailure -Reason "no_process_for_pid" -Extra @{ pid = [int]$fgPid; title = $title }
  }

  if (Test-Blocklisted -ProcessName $procName -Title $title) {
    Write-JsonLine -Object @{
      ok = $true
      process = $procName
      pid = [int]$fgPid
      title = ""
      detected_kind = "unknown"
      payload = @{ extra = @{ reason = "blocklisted_process" } }
      blocked = $true
    }
    exit 0
  }

  $lowerName = $procName.ToLower()
  $result = $null

  switch -Wildcard ($lowerName) {
    "msedge"   { $result = New-BrowserResult -Process $procName -ProcessId $fgPid -Title $title -WindowHandle $handle; break }
    "chrome"   { $result = New-BrowserResult -Process $procName -ProcessId $fgPid -Title $title -WindowHandle $handle; break }
    "brave"    { $result = New-BrowserResult -Process $procName -ProcessId $fgPid -Title $title -WindowHandle $handle; break }
    "firefox"  { $result = New-BrowserResult -Process $procName -ProcessId $fgPid -Title $title -WindowHandle $handle; break }
    "winword"  { $result = New-OfficeResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "excel"    { $result = New-OfficeResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "powerpnt" { $result = New-OfficeResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "code"     { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "notepad++" { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "sublime_text" { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "idea64"   { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "rider64"  { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "pycharm64" { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "webstorm64" { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    "clion64"  { $result = New-EditorResult -Process $procName -ProcessId $fgPid -Title $title; break }
    default {
      $result = @{
        ok = $true
        process = $procName
        pid = [int]$fgPid
        title = $title
        detected_kind = "unknown"
        payload = @{ extra = @{ raw_title = $title } }
        blocked = $false
      }
    }
  }

  if ($result -and $windowInfo.bounds) {
    $result.bounds = $windowInfo.bounds
  }

  Write-JsonLine -Object $result
} catch {
  Write-ProbeFailure -Reason "probe_failed" -Extra @{ error = $_.Exception.Message }
}
