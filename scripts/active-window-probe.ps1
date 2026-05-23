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
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static string GetForegroundTitle() {
        var sb = new StringBuilder(1024);
        GetWindowText(GetForegroundWindow(), sb, 1024);
        return sb.ToString();
    }

    public static uint GetForegroundPid() {
        uint pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid;
    }

    public static IntPtr GetForegroundHandle() {
        return GetForegroundWindow();
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

# ---- Browser URL probe (UI Automation) -------------------------------------

function Test-LooksLikeBrowserUrl {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  return $Value -match "^(https?|file|chrome|edge|about):" `
    -or $Value -match "^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}([/:?#]|$)"
}

function Get-BrowserUrlFromHandle {
  param([IntPtr]$WindowHandle)

  try {
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
      # Match the English + CJK names Edge / Chrome / Firefox actually use.
      $isAddressBar = $name -match "(?i)address|地址|搜索栏|URL|omnibox"

      # Try ValuePattern first — most accurate way to read the address bar text.
      $valuePatternObj = $null
      if ($edit.TryGetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern,
            [ref]$valuePatternObj)) {
        $candidate = $valuePatternObj.Current.Value
        if ($isAddressBar -and $candidate) { return $candidate }
        if (Test-LooksLikeBrowserUrl -Value $candidate) { return $candidate }
      }

      # Fallback to LegacyIAccessiblePattern.Value
      $legacyPatternObj = $null
      if ($edit.TryGetCurrentPattern(
            [System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,
            [ref]$legacyPatternObj)) {
        $candidate = $legacyPatternObj.Current.Value
        if ($isAddressBar -and $candidate) { return $candidate }
        if (Test-LooksLikeBrowserUrl -Value $candidate) { return $candidate }
      }
    }
  } catch {
    return $null
  }
  return $null
}

function Get-BrowserUrl {
  param([IntPtr]$WindowHandle, [string]$WindowTitle, [uint32]$ProcessId)

  try {
    # Loading UIAutomationClient is expensive. Only attempt it for browsers.
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop

    $url = Get-BrowserUrlFromHandle -WindowHandle $WindowHandle
    if ($url) { return $url }

    # GetForegroundWindow can be a browser child surface. If that subtree does
    # not expose the omnibox, retry the top-level browser window for the same
    # process instead of falling back to title-only context.
    try {
      $proc = Get-Process -Id $ProcessId -ErrorAction Stop
      if ($proc.MainWindowHandle -and $proc.MainWindowHandle -ne [IntPtr]::Zero -and $proc.MainWindowHandle -ne $WindowHandle) {
        $url = Get-BrowserUrlFromHandle -WindowHandle $proc.MainWindowHandle
        if ($url) { return $url }
      }
    } catch { }
  } catch {
    return $null
  }
  return $null
}

function New-BrowserResult {
  param([string]$Process, [uint32]$ProcessId, [string]$Title, [IntPtr]$WindowHandle)

  $url = Get-BrowserUrl -WindowHandle $WindowHandle -WindowTitle $Title -ProcessId $ProcessId

  if ($url) {
    # The address bar sometimes omits the scheme — normalize.
    if ($url -notmatch "^(https?|file|chrome|edge|about):") {
      if ($url -match "^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}") {
        $url = "https://$url"
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

function Get-OfficeDocumentPath {
  param([string]$Process)

  try {
    switch -Regex ($Process) {
      "^winword$" {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
        if ($app -and $app.ActiveDocument) {
          return $app.ActiveDocument.FullName
        }
      }
      "^excel$" {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
        if ($app -and $app.ActiveWorkbook) {
          return $app.ActiveWorkbook.FullName
        }
      }
      "^powerpnt$" {
        $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject("PowerPoint.Application")
        if ($app -and $app.ActivePresentation) {
          return $app.ActivePresentation.FullName
        }
      }
    }
  } catch {
    return $null
  }
  return $null
}

function New-OfficeResult {
  param([string]$Process, [uint32]$ProcessId, [string]$Title)

  $filePath = Get-OfficeDocumentPath -Process $Process

  if ($filePath) {
    return @{
      ok = $true
      process = $Process
      pid = [int]$ProcessId
      title = $Title
      detected_kind = "file_path"
      payload = @{ filePath = $filePath }
      blocked = $false
    }
  }

  # COM might be disabled by group policy / no running Office app / etc. Fall
  # back to title parsing: Word titles look like `report.docx - Word` or
  # `report.docx [Read-Only] - Word`.
  $parsedName = $null
  if ($Title -match "^(?<name>[^-]+?)(\s+\[.*?\])?\s+-\s+(Word|Excel|PowerPoint|WPS)") {
    $parsedName = $Matches.name.Trim()
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
  $handle = [UcaActiveWindow]::GetForegroundHandle()
  $title = [UcaActiveWindow]::GetForegroundTitle()
  $fgPid = [UcaActiveWindow]::GetForegroundPid()

  if (-not $fgPid -or $fgPid -eq 0) {
    Write-ProbeFailure -Reason "no_foreground"
  }

  $procName = ""
  try {
    $proc = Get-Process -Id $fgPid -ErrorAction Stop
    $procName = $proc.ProcessName
  } catch {
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

  Write-JsonLine -Object $result
} catch {
  Write-ProbeFailure -Reason "probe_failed" -Extra @{ error = $_.Exception.Message }
}
