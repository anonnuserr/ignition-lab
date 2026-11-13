"""Build report/report.pdf from report/report.md.

Usage
-----
    pip install markdown latex2mathml
    python report/build_report.py

The Markdown source is converted to HTML (equations become MathML) and then
printed to PDF with a Chromium-based browser in headless mode. Microsoft Edge
or Google Chrome must be installed.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import latex2mathml.converter
import markdown

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "report.md"
HTML = HERE / "report.html"
PDF = HERE / "report.pdf"

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]
BROWSER_COMMANDS = ["msedge", "google-chrome", "chromium", "chromium-browser", "chrome"]

CSS = """
@page { size: A4; margin: 21mm 20mm 22mm 20mm;
        @bottom-center { content: counter(page); font: 9pt "Segoe UI", Arial, sans-serif; color: #52514e; } }
html { font: 10.5pt/1.45 Cambria, Georgia, "Times New Roman", serif; color: #0b0b0b; }
body { margin: 0; }
h1, h2, h3 { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; line-height: 1.25; break-after: avoid; }
h1 { font-size: 18pt; margin: 0 0 10pt; text-align: center; }
h2 { font-size: 12.5pt; margin: 18pt 0 6pt; }
h3 { font-size: 10.5pt; margin: 12pt 0 4pt; }
p { margin: 0 0 7pt; text-align: justify; hyphens: auto; orphans: 3; widows: 3; }
.byline { text-align: center; margin-bottom: 14pt; }
.byline p { text-align: center; margin: 0; }
h2.abstract { text-align: center; font-size: 10.5pt; margin: 6pt 0 4pt; }
.abstract-text { margin: 0 9mm 4pt; font-size: 10pt; }
ol, ul { margin: 0 0 7pt; padding-left: 18pt; }
li { margin-bottom: 2.5pt; text-align: justify; }
img { display: block; max-width: 100%; max-height: 92mm; margin: 8pt auto 4pt; }
img.tall { max-height: 198mm; }
.figure-block { break-inside: avoid; }
p.figure { margin: 0; }
p.caption { font-size: 9.3pt; line-height: 1.35; margin: 0 4mm 10pt; }
p.table-caption { font-size: 9.3pt; line-height: 1.35; margin: 10pt 0 4pt; break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 0 0 10pt; font-size: 9.3pt; break-inside: avoid;
        font-family: "Segoe UI", Arial, sans-serif; }
th, td { padding: 3pt 6pt; text-align: left; vertical-align: top; }
thead th { border-top: 1pt solid #0b0b0b; border-bottom: 0.6pt solid #0b0b0b; font-weight: 600; }
tbody tr:last-child td { border-bottom: 1pt solid #0b0b0b; }
.equation { display: flex; align-items: center; margin: 7pt 0 9pt; break-inside: avoid; }
.equation .body { flex: 1; text-align: center; }
.equation .number { width: 12mm; text-align: right; }
math { font-family: "Cambria Math", "STIX Two Math", "Latin Modern Math", math; font-size: 105%; }
a { color: inherit; text-decoration: none; }
"""


def find_browser() -> str:
    for path in BROWSERS:
        if Path(path).exists():
            return path
    for command in BROWSER_COMMANDS:
        found = shutil.which(command)
        if found:
            return found
    sys.exit("No Chromium-based browser found. Install Microsoft Edge or Google Chrome.")


def to_mathml(latex: str, display: bool) -> str:
    return latex2mathml.converter.convert(latex.strip(), display="block" if display else "inline")


def build_html(text: str) -> str:
    stash: list[str] = []

    def keep(html: str) -> str:
        stash.append(html)
        return f"MATHSTASH{len(stash) - 1:04d}END"

    def display(match: re.Match) -> str:
        latex = match.group(1)
        tag = re.search(r"\\tag\{(.+?)\}", latex)
        latex = re.sub(r"\\tag\{.+?\}", "", latex)
        number = f"({tag.group(1)})" if tag else ""
        return keep(
            f'<div class="equation"><span class="number"></span><span class="body">{to_mathml(latex, True)}</span>'
            f'<span class="number">{number}</span></div>'
        )

    text = re.sub(r"\$\$(.+?)\$\$", display, text, flags=re.DOTALL)
    text = re.sub(r"\$(.+?)\$", lambda m: keep(to_mathml(m.group(1), False)), text)

    body = markdown.markdown(text, extensions=["tables", "sane_lists"])
    body = re.sub(r"<p>(MATHSTASH\d{4}END)</p>", r"\1", body)
    body = re.sub(r"MATHSTASH(\d{4})END", lambda m: stash[int(m.group(1))], body)

    # Figures: vector graphics in the PDF, and caption styling.
    body = body.replace(".png", ".svg")
    body = re.sub(r"<p>(<img [^>]*>)</p>", r'<p class="figure">\1</p>', body)
    body = body.replace('src="../figures/fig4_', 'class="tall" src="../figures/fig4_')
    body = re.sub(r"<p><strong>(Figure \d+\.)</strong>", r'<p class="caption"><strong>\1</strong>', body)
    body = re.sub(r"<p><strong>(Table \d+\.)</strong>", r'<p class="table-caption"><strong>\1</strong>', body)
    # Keep each figure on the same page as its caption.
    body = re.sub(
        r'(<p class="figure">.*?</p>\s*<p class="caption">.*?</p>)',
        r'<div class="figure-block">\1</div>',
        body,
        flags=re.DOTALL,
    )

    # Title block and abstract.
    body = re.sub(r"(</h1>\s*)<p>(.*?)</p>", r'\1<div class="byline"><p>\2</p></div>', body, count=1, flags=re.DOTALL)
    body = body.replace("<h2>Abstract</h2>", '<h2 class="abstract">Abstract</h2>', 1)
    body = re.sub(r'(<h2 class="abstract">Abstract</h2>\s*)<p>', r'\1<p class="abstract-text">', body, count=1)

    title = re.search(r"<h1>(.*?)</h1>", body).group(1)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f"<title>{title}</title><style>{CSS}</style></head><body>{body}</body></html>"
    )


def main() -> None:
    HTML.write_text(build_html(SOURCE.read_text(encoding="utf-8")), encoding="utf-8")
    browser = find_browser()
    PDF.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
        subprocess.run(
            [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                f"--user-data-dir={profile}",
                f"--print-to-pdf={PDF}",
                HTML.as_uri(),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=180,
        )
        # The browser launcher can return before the PDF is on disk, so wait for it.
        deadline = time.monotonic() + 90.0
        size = -1
        while time.monotonic() < deadline:
            current = PDF.stat().st_size if PDF.exists() else -1
            if current > 0 and current == size:
                break
            size = current
            time.sleep(1.0)
    if not PDF.exists():
        sys.exit("The browser did not produce a PDF. report.html has been kept for inspection.")
    HTML.unlink()
    print(f"Wrote {PDF.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
