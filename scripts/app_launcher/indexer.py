"""Application indexer — scans the system for installed applications and
writes a metadata index to ``index.json``.

Sources scanned (in order of preference):

1. **Start Menu shortcuts** under both per-machine and per-user directories.
   These carry a clean display name (the .lnk filename) and a target
   path. Most reliable source for "user-facing" names like ``WeChat`` vs
   the executable name ``WeChat.exe``.

2. **Registry App Paths** at ``HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths``
   and the per-user ``HKCU`` mirror. Catches things like ``code.exe`` ->
   ``C:\\Users\\<u>\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe``
   that aren't always in the Start Menu.

3. **Common install roots** (Program Files, Program Files (x86), and the
   per-user ``%LOCALAPPDATA%\\Programs``) — top-level ``*.exe`` files only,
   shallow scan to keep wall-time reasonable.

The output schema is documented in :func:`build_index_record`.

Dev-tool flagging: a hand-curated ``DEV_TOOL_PATTERNS`` regex catches the
common offenders (microsoft visual studio, jetbrains, "developer tools",
"sdk", "powershell ise", android studio, etc.). The arbiter uses this to
prefer the consumer app when "微信" matches both ``WeChat`` and
``WeChat developer tools``.
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable

from store_paths import INDEX_PATH, USAGE_PATH, ensure_dirs

# A .lnk shortcut is a binary OLE compound document. We could pull in
# pywin32 + shell32 to parse them, but we want the indexer to work even
# without pywin32 installed (so the dry-run CLI is useful before 83.7
# wires up the window control). The lnk_target_extract function below
# handles the common case of "absolute path link" by walking the binary
# format directly — based on Microsoft's MS-SHLLINK spec.

DEV_TOOL_PATTERNS = re.compile(
    r"(developer\s*tool|devtools?|开发\s*工具|开发者|sdk|powershell\s+ise|"
    r"visual\s+studio\s+(20\d\d|code|installer)|jetbrains|android\s+studio|"
    r"toolbox|setup|installer|uninstall)",
    re.IGNORECASE,
)


@dataclass
class AppRecord:
    app_id: str           # canonical key (lowercase exe absolute path)
    display_name: str     # human label (e.g. "WeChat" / "微信")
    exe_path: str         # absolute path to the launchable file
    aliases: list[str] = field(default_factory=list)
    is_dev_tool: bool = False
    source: str = "unknown"  # start_menu / app_paths / fs_scan
    last_used_at: float | None = None
    use_count: int = 0


def _normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip()


def _detect_dev_tool(display: str, exe_path: str) -> bool:
    return bool(DEV_TOOL_PATTERNS.search(display) or DEV_TOOL_PATTERNS.search(exe_path))


def lnk_target_extract(lnk_path: Path) -> str | None:
    """Crude .lnk parser. Reads the LinkInfo block and returns the
    LocalBasePath if present. Returns None for relative-only links or
    network paths we don't understand.

    This is intentionally narrow — full MS-SHLLINK is large. We only
    need the absolute filesystem path for ~95% of Start Menu shortcuts.
    """
    try:
        data = lnk_path.read_bytes()
    except OSError:
        return None
    if len(data) < 0x4C or data[:4] != b"L\x00\x00\x00":
        return None  # not a shell link
    # Header: 76 bytes. Flags at offset 20.
    flags = struct.unpack_from("<I", data, 20)[0]
    cursor = 0x4C
    HasLinkTargetIDList = 0x01
    HasLinkInfo = 0x02
    if flags & HasLinkTargetIDList:
        # Skip IDList: WORD size + bytes.
        if cursor + 2 > len(data):
            return None
        idlist_size = struct.unpack_from("<H", data, cursor)[0]
        cursor += 2 + idlist_size
    if not (flags & HasLinkInfo):
        return None
    if cursor + 4 > len(data):
        return None
    link_info_size = struct.unpack_from("<I", data, cursor)[0]
    if link_info_size < 0x1C or cursor + link_info_size > len(data):
        return None
    link_info_header_size = struct.unpack_from("<I", data, cursor + 4)[0]
    link_info_flags = struct.unpack_from("<I", data, cursor + 8)[0]
    local_base_path_offset = struct.unpack_from("<I", data, cursor + 16)[0]
    if not (link_info_flags & 0x01):  # VolumeIDAndLocalBasePath
        return None
    abs_offset = cursor + local_base_path_offset
    end = data.find(b"\x00", abs_offset)
    if end < 0:
        return None
    try:
        path_bytes = data[abs_offset:end]
        # Unicode local path lives at offset 28 of the LinkInfo header when
        # the header is > 0x1C bytes. Prefer it — the ANSI path gets garbled
        # for non-ASCII names (e.g. 微信) on English-locale Python where mbcs
        # is Windows-1252.
        if link_info_header_size > 0x1C:
            unicode_offset_field = struct.unpack_from("<I", data, cursor + 28)[0]
            if unicode_offset_field:
                u_start = cursor + unicode_offset_field
                end_utf16 = u_start
                while end_utf16 + 1 < len(data) and not (data[end_utf16] == 0 and data[end_utf16 + 1] == 0):
                    end_utf16 += 2
                try:
                    return data[u_start:end_utf16].decode("utf-16-le")
                except UnicodeDecodeError:
                    pass
        # Fallback chain: UTF-8 first (correct for modern Chinese apps that
        # produce ANSI-format .lnk with UTF-8 contents), then GBK (Chinese
        # Windows ACP), then mbcs, then latin-1 as a last resort.
        for encoding in ("utf-8", "gbk", "mbcs", "latin-1"):
            try:
                decoded = path_bytes.decode(encoding)
                # Sanity-check: the result should look like a real Windows path.
                if ":" in decoded[:3] or decoded.startswith("\\\\"):
                    return decoded
            except (UnicodeDecodeError, LookupError):
                continue
        return path_bytes.decode("latin-1", errors="replace")
    except Exception:
        return None


def _start_menu_dirs() -> list[Path]:
    candidates = [
        os.environ.get("PROGRAMDATA", r"C:\ProgramData") + r"\Microsoft\Windows\Start Menu\Programs",
        os.environ.get("APPDATA", "") + r"\Microsoft\Windows\Start Menu\Programs",
    ]
    return [Path(c) for c in candidates if c and Path(c).exists()]


def _scan_start_menu() -> Iterable[AppRecord]:
    for root in _start_menu_dirs():
        for lnk in root.rglob("*.lnk"):
            target = lnk_target_extract(lnk)
            if not target:
                continue
            target_path = Path(target)
            if target_path.suffix.lower() != ".exe":
                continue
            if not target_path.exists():
                continue
            display = lnk.stem
            yield AppRecord(
                app_id=str(target_path).lower(),
                display_name=_normalize_name(display),
                exe_path=str(target_path),
                aliases=[_normalize_name(display).lower(), target_path.stem.lower()],
                is_dev_tool=_detect_dev_tool(display, str(target_path)),
                source="start_menu",
            )


def _scan_app_paths() -> Iterable[AppRecord]:
    """Read ``HKLM`` and ``HKCU`` ``App Paths`` registry. Skipped silently
    when winreg is unavailable (non-Windows test contexts)."""
    try:
        import winreg  # type: ignore
    except ImportError:
        return
    bases = [
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Wow6432Node\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\App Paths"),
    ]
    for hive, subkey in bases:
        try:
            with winreg.OpenKey(hive, subkey) as root:
                i = 0
                while True:
                    try:
                        name = winreg.EnumKey(root, i)
                    except OSError:
                        break
                    i += 1
                    try:
                        with winreg.OpenKey(root, name) as appkey:
                            try:
                                exe, _ = winreg.QueryValueEx(appkey, None)  # default value
                            except OSError:
                                continue
                            exe_path = exe.strip().strip('"')
                            if not exe_path or not Path(exe_path).exists():
                                continue
                            display = Path(exe_path).stem
                            yield AppRecord(
                                app_id=str(Path(exe_path)).lower(),
                                display_name=_normalize_name(display),
                                exe_path=exe_path,
                                aliases=[name.lower().rsplit(".", 1)[0], display.lower()],
                                is_dev_tool=_detect_dev_tool(display, exe_path),
                                source="app_paths",
                            )
                    except OSError:
                        continue
        except OSError:
            continue


def _scan_program_files() -> Iterable[AppRecord]:
    """Shallow scan for top-level executables in common install roots.
    Catches portable apps in non-standard locations like ``E:\\WeChat``."""
    roots = [
        os.environ.get("PROGRAMFILES"),
        os.environ.get("PROGRAMFILES(X86)"),
        os.environ.get("LOCALAPPDATA", "") + r"\Programs",
    ]
    extra_roots = os.environ.get("LINGXY_LAUNCHER_EXTRA_ROOTS", "")
    if extra_roots:
        roots.extend(extra_roots.split(os.pathsep))
    for root_str in roots:
        if not root_str:
            continue
        root = Path(root_str)
        if not root.exists():
            continue
        try:
            for child in root.iterdir():
                if not child.is_dir():
                    continue
                # Look 1-2 levels deep for *.exe; skip "uninstall" / setup binaries.
                for exe in list(child.glob("*.exe")) + list(child.glob("*/*.exe")):
                    name = exe.stem
                    if re.search(r"(unins|setup|update|installer|crashpad|helper)", name, re.IGNORECASE):
                        continue
                    yield AppRecord(
                        app_id=str(exe).lower(),
                        display_name=_normalize_name(child.name),
                        exe_path=str(exe),
                        aliases=[child.name.lower(), name.lower()],
                        is_dev_tool=_detect_dev_tool(child.name, str(exe)),
                        source="fs_scan",
                    )
        except (PermissionError, OSError):
            continue


def build_index() -> dict[str, dict]:
    """Run all scanners, dedup by ``app_id`` (lowercase exe path), and
    merge alias lists. Returns a ``{app_id: dict}`` mapping ready to
    serialize as JSON.
    """
    merged: dict[str, AppRecord] = {}
    for scanner in (_scan_start_menu, _scan_app_paths, _scan_program_files):
        for rec in scanner():
            existing = merged.get(rec.app_id)
            if existing is None:
                merged[rec.app_id] = rec
                continue
            # Prefer a non-dev-tool display when sources disagree.
            if existing.is_dev_tool and not rec.is_dev_tool:
                existing.display_name = rec.display_name
                existing.is_dev_tool = False
            existing.aliases = list({*existing.aliases, *rec.aliases})
            # Source priority: start_menu > app_paths > fs_scan.
            priority = {"start_menu": 3, "app_paths": 2, "fs_scan": 1}
            if priority.get(rec.source, 0) > priority.get(existing.source, 0):
                existing.source = rec.source
                existing.display_name = rec.display_name

    return {app_id: asdict(rec) for app_id, rec in merged.items()}


def load_usage() -> dict:
    """Load usage.json (per-app last_used_at and use_count) and merge into
    the freshly-built index. Missing file is treated as empty history."""
    if not USAGE_PATH.exists():
        return {}
    try:
        return json.loads(USAGE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def write_index(index: dict[str, dict]) -> Path:
    ensure_dirs()
    usage = load_usage()
    for app_id, record in index.items():
        u = usage.get(app_id)
        if u:
            record["last_used_at"] = u.get("last_used_at")
            record["use_count"] = int(u.get("use_count", 0))
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    return INDEX_PATH


def load_index() -> dict[str, dict]:
    if not INDEX_PATH.exists():
        return {}
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def main(argv: list[str]) -> int:
    """CLI entry: ``python indexer.py [--rescan] [--json]``."""
    rescan = "--rescan" in argv
    as_json = "--json" in argv
    if rescan or not INDEX_PATH.exists():
        started = time.time()
        index = build_index()
        write_index(index)
        elapsed = time.time() - started
    else:
        index = load_index()
        elapsed = 0.0
    if as_json:
        print(json.dumps({
            "ok": True,
            "count": len(index),
            "elapsed_s": round(elapsed, 3),
            "index_path": str(INDEX_PATH),
        }, ensure_ascii=False))
    else:
        print(f"Indexed {len(index)} apps in {elapsed:.2f}s. Saved to {INDEX_PATH}")
        for rec in list(index.values())[:5]:
            print(f"  - {rec['display_name']:<30} {rec['source']:<10} {rec['exe_path']}")
        print(f"  ...and {max(0, len(index) - 5)} more")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
