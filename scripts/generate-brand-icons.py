"""generate-brand-icons.py — B5 in UPGRADE_PLAN.md

Generates all packaged icon sizes from a single brand-source PNG so the
installer icon, taskbar icon, and Office add-in icons all share one
identity. The dock orb is intentionally left untouched (it stays as
the canvas-particle animation in src/desktop/renderer/dock.html).

Run with the project venv:
    .venv/Scripts/python.exe scripts/generate-brand-icons.py

This is dev-only tooling — NOT included in build.files / extraResources.
Inputs and outputs are committed to the repo so a packaging machine
without PIL can still ship the binaries.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "brand-source" / "lingxy-icon-source.png"
ICON_DIR = ROOT / "assets" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)

PNG_SIZES = (16, 32, 48, 64, 128, 256, 512)
OFFICE_SIZES = (16, 32, 80)

def main():
    if not SOURCE.exists():
        raise SystemExit(f"missing source: {SOURCE}")
    src = Image.open(SOURCE).convert("RGBA")
    print(f"loaded {SOURCE.name} ({src.width}x{src.height})")

    # Multi-size PNGs for the icons folder.
    pngs = []
    for size in PNG_SIZES:
        out = ICON_DIR / f"lingxy-{size}.png"
        resized = src.resize((size, size), Image.LANCZOS)
        resized.save(out, "PNG", optimize=True)
        print(f"  wrote {out.relative_to(ROOT)} ({size}x{size})")
        pngs.append(resized)

    # Single .ico with all sizes — electron-builder picks the best for
    # the .exe, NSIS installer, and shortcut.
    ico_path = ICON_DIR / "lingxy.ico"
    pngs[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in PNG_SIZES if s <= 256],  # ICO format max 256
    )
    print(f"  wrote {ico_path.relative_to(ROOT)} (multi-size)")

    # Office add-in ribbon icons.
    office_dir = ROOT / "office_addin" / "shared"
    for size in OFFICE_SIZES:
        out = office_dir / f"icon-{size}.png"
        resized = src.resize((size, size), Image.LANCZOS)
        resized.save(out, "PNG", optimize=True)
        print(f"  wrote {out.relative_to(ROOT)} ({size}x{size})")

    print("done.")

if __name__ == "__main__":
    main()
