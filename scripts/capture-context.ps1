param(
  [switch]$SimulateCopy,
  [int]$PreCopyDelayMs = 80,
  [int]$PostCopyPollMs = 900,
  [int]$PostCopyPollIntervalMs = 55
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Force UTF-8 stdout so non-ASCII selection text (CJK, accented Latin, etc.)
# survives the round-trip through Node's child_process.execFile.
# Without this, PowerShell on a non-UTF-8 system locale (e.g. CP936/Win1252)
# emits text in the legacy OEM codepage and Node decodes it as UTF-8 -> mojibake.
# Use the no-BOM encoding because Node's JSON.parse rejects a leading U+FEFF.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class UcaCapture {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public static string GetForegroundTitle() {
        var sb = new StringBuilder(512);
        GetWindowText(GetForegroundWindow(), sb, 512);
        return sb.ToString();
    }

    public static uint GetForegroundPid() {
        uint pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid;
    }

    public static void SimulateCopy() {
        keybd_event(0x10, 0, 2, UIntPtr.Zero);  // Shift up
        keybd_event(0xA0, 0, 2, UIntPtr.Zero);  // Left Shift up
        keybd_event(0xA1, 0, 2, UIntPtr.Zero);  // Right Shift up
        keybd_event(0x12, 0, 2, UIntPtr.Zero);  // Alt up
        keybd_event(0x5B, 0, 2, UIntPtr.Zero);  // Left Win up
        keybd_event(0x5C, 0, 2, UIntPtr.Zero);  // Right Win up
        keybd_event(0x11, 0, 0, UIntPtr.Zero);  // Ctrl down
        keybd_event(0x43, 0, 0, UIntPtr.Zero);  // C down
        keybd_event(0x43, 0, 2, UIntPtr.Zero);  // C up
        keybd_event(0x11, 0, 2, UIntPtr.Zero);  // Ctrl up
    }
}
'@ -ReferencedAssemblies @() -ErrorAction SilentlyContinue

# Get foreground window info
$title = [UcaCapture]::GetForegroundTitle()
$fgPid = [UcaCapture]::GetForegroundPid()
$procName = ""
try {
    $proc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
    $procName = $proc.ProcessName
} catch {}

function Get-ExplorerSelection {
    param(
        [UInt32]$ForegroundPid
    )

    $result = @{
        files = @()
        folder = ""
    }

    try {
        $shell = New-Object -ComObject Shell.Application
        foreach ($window in @($shell.Windows())) {
            try {
                $hwnd = [IntPtr]::new([int64]$window.HWND)
                [uint32]$windowPid = 0
                [void][UcaCapture]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)
                if ([uint32]$windowPid -ne $ForegroundPid) {
                    continue
                }

                $folderPath = ""
                try {
                    $folderPath = $window.Document.Folder.Self.Path
                } catch {}
                $result.folder = $folderPath

                $selection = @($window.Document.SelectedItems())
                foreach ($item in $selection) {
                    if ($item.Path) {
                        $result.files += [string]$item.Path
                    }
                }
                return $result
            } catch {
                continue
            }
        }
    } catch {}

    return $result
}

$explorerSelection = $null
if ($procName -eq "explorer") {
    $explorerSelection = Get-ExplorerSelection -ForegroundPid $fgPid
}

function Get-ClipboardSnapshot {
    $snapshot = @{
        files = @()
        text = ""
    }
    try {
        $fileList = [System.Windows.Forms.Clipboard]::GetFileDropList()
        if ($fileList -and $fileList.Count -gt 0) {
            foreach ($f in $fileList) { $snapshot.files += [string]$f }
        }
    } catch {}

    try {
        $snapshot.text = [System.Windows.Forms.Clipboard]::GetText()
    } catch {}

    return $snapshot
}

function Join-ClipboardFiles {
    param($Files)
    if (-not $Files) { return "" }
    return (@($Files) | ForEach-Object { [string]$_ }) -join "`n"
}

# Simulate Ctrl+C if requested
$preCopySnapshot = $null
if ($SimulateCopy) {
    $preCopySnapshot = Get-ClipboardSnapshot
    if ($PreCopyDelayMs -gt 0) {
        Start-Sleep -Milliseconds $PreCopyDelayMs
    }
    [UcaCapture]::SimulateCopy()
    $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(0, $PostCopyPollMs))
    $baselineText = if ($preCopySnapshot) { [string]$preCopySnapshot.text } else { "" }
    $baselineFiles = if ($preCopySnapshot) { Join-ClipboardFiles $preCopySnapshot.files } else { "" }
    $pollIntervalMs = [Math]::Max(10, $PostCopyPollIntervalMs)
    do {
        $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        $sleepMs = if ($remaining -gt 0) { [Math]::Min($pollIntervalMs, $remaining) } else { 0 }
        if ($sleepMs -gt 0) {
            Start-Sleep -Milliseconds $sleepMs
        }
        $candidate = Get-ClipboardSnapshot
        $candidateText = [string]$candidate.text
        $candidateFiles = Join-ClipboardFiles $candidate.files
        if ($candidateFiles -and $candidateFiles -ne $baselineFiles) { break }
        if ($candidateText.Trim().Length -gt 2 -and $candidateText.Trim() -ne $baselineText.Trim()) { break }
    } while ([DateTime]::UtcNow -lt $deadline)
}

# Read clipboard
$clipboardSnapshot = Get-ClipboardSnapshot
$files = @($clipboardSnapshot.files)
$text = [string]$clipboardSnapshot.text

if ($explorerSelection -and $explorerSelection.files -and $explorerSelection.files.Count -gt 0) {
    $files = @($explorerSelection.files)
    $text = ""
} elseif ($procName -eq "explorer" -and $text) {
    $candidate = $text.Trim()
    if ($explorerSelection -and $explorerSelection.folder) {
        $resolved = Join-Path $explorerSelection.folder $candidate
        if (Test-Path -LiteralPath $resolved) {
            $files = @($resolved)
            $text = ""
        }
    }
}

# Output JSON
$result = @{
    title = $title
    process = $procName
    files = $files
    text = $text
    folder = if ($explorerSelection) { $explorerSelection.folder } else { "" }
}

$result | ConvertTo-Json -Compress
