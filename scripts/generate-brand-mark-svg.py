"""generate-brand-mark-svg.py — C18 #B5 round-2 (image-based brand mark)

After R reported "图标没全替换成我给你的图片" (the previous arrow-only
SVG didn't match the source visually — wrong color, no hand), codex
recommended switching the in-app brand mark from a hand-drawn vector
approximation to an SVG that EMBEDS the canonical brand-source PNG.

This script:
  1. Reads assets/icons/lingxy-64.png (the PIL-resized 64×64 of the
     R-supplied source) and the canonical 256×256 of the same.
  2. Base64-encodes the 64×64 (small enough to inline; 7.3 KB base64
     is acceptable for a logo asset).
  3. Computes the sha256 of the inlined bytes — this is the canonical
     hash the verifier will pin all consumers to.
  4. Writes:
       - src/desktop/assets/logo/lingxy-mark.svg       (image-based)
       - src/desktop/assets/logo/lingxy-wordmark.svg   (image + LingxY text)
  5. Updates src/desktop/renderer/icons.mjs LOGO_MARK with the same
     embedded image SVG.
  6. Updates src/desktop/renderer/console.html rail-brand-mark inline
     SVG with the same embedded image.
  7. Reports the canonical hash so the verifier can be updated by hand.

Run with project venv:
    .venv/Scripts/python.exe scripts/generate-brand-mark-svg.py
"""
from pathlib import Path
import base64
import hashlib
import re

ROOT = Path(__file__).resolve().parents[1]
SRC_64 = ROOT / "assets" / "icons" / "lingxy-64.png"
MARK_SVG = ROOT / "src" / "desktop" / "assets" / "logo" / "lingxy-mark.svg"
WORDMARK_SVG = ROOT / "src" / "desktop" / "assets" / "logo" / "lingxy-wordmark.svg"
ICONS_MJS = ROOT / "src" / "desktop" / "renderer" / "icons.mjs"
CONSOLE_HTML = ROOT / "src" / "desktop" / "renderer" / "console.html"

def main():
    if not SRC_64.exists():
        raise SystemExit(f"missing {SRC_64} — run scripts/generate-brand-icons.py first")

    png_bytes = SRC_64.read_bytes()
    b64 = base64.b64encode(png_bytes).decode("ascii")
    sha256 = hashlib.sha256(png_bytes).hexdigest()
    data_url = f"data:image/png;base64,{b64}"

    print(f"PNG bytes: {len(png_bytes)}")
    print(f"base64 chars: {len(b64)}")
    print(f"sha256: {sha256}")

    # 1. lingxy-mark.svg — single <image> at 32x32 viewBox, fills viewport.
    mark_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="LingxY">
  <title>LingxY</title>
  <!-- Image-based brand mark. The visual canonical truth is
       assets/brand-source/lingxy-icon-source.png; the 64x64 PIL
       resize is embedded here so the SVG renders the actual user-
       supplied design at every callsite (Console rail / topbar /
       wordmark composite). Drift is detected by
       scripts/verify-brand-assets.mjs comparing the embedded
       sha256 against the canonical asset. -->
  <image href="{data_url}" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>
</svg>
'''
    MARK_SVG.write_text(mark_svg, encoding="utf-8")
    print(f"wrote {MARK_SVG.relative_to(ROOT)}")

    # 2. lingxy-wordmark.svg — same image inset on the left, LingxY text on the right.
    wordmark_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 32" role="img" aria-label="LingxY">
  <title>LingxY</title>
  <!-- Wordmark = mark + LingxY text. See lingxy-mark.svg for the
       image-based mark rationale. -->
  <image href="{data_url}" x="0" y="0" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>
  <text x="40" y="22" font-family="'Segoe UI Variable Display','PingFang SC','Microsoft YaHei UI',system-ui,sans-serif" font-size="17" font-weight="600" fill="currentColor" letter-spacing="0.2">LingxY</text>
</svg>
'''
    WORDMARK_SVG.write_text(wordmark_svg, encoding="utf-8")
    print(f"wrote {WORDMARK_SVG.relative_to(ROOT)}")

    # 3. icons.mjs LOGO_MARK — same shape as lingxy-mark.svg but as a
    #    JS string literal. Keep the existing exports; only swap the
    #    LOGO_MARK template literal.
    logo_mark_js = (
        '`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" '
        'width="20" height="20" aria-hidden="true">'
        f'<image href="{data_url}" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>'
        '</svg>`'
    )
    icons_src = ICONS_MJS.read_text(encoding="utf-8")
    new_icons = re.sub(
        r"export const LOGO_MARK = `[^`]*`;",
        f"export const LOGO_MARK = {logo_mark_js};",
        icons_src,
        count=1
    )
    if new_icons == icons_src:
        raise SystemExit("could not patch LOGO_MARK in icons.mjs — pattern miss")
    ICONS_MJS.write_text(new_icons, encoding="utf-8")
    print(f"patched {ICONS_MJS.relative_to(ROOT)}")

    # 4. console.html — replace the inline SVG inside .rail-brand-mark.
    console_src = CONSOLE_HTML.read_text(encoding="utf-8")
    pattern = re.compile(
        r'(<span class="rail-mark rail-brand-mark"[^>]*>)\s*<svg[^>]*viewBox="0 0 32 32"[^>]*>.*?</svg>',
        re.DOTALL
    )
    replacement_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f'<image href="{data_url}" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>'
        '</svg>'
    )
    new_console, count = pattern.subn(rf'\1\n          {replacement_svg}', console_src, count=1)
    if count != 1:
        raise SystemExit("could not patch rail-brand-mark inline SVG in console.html")
    CONSOLE_HTML.write_text(new_console, encoding="utf-8")
    print(f"patched {CONSOLE_HTML.relative_to(ROOT)} ({count} site)")

    print("\ndone. canonical sha256 to wire into verify-brand-assets.mjs:")
    print(f"  {sha256}")

if __name__ == "__main__":
    main()
