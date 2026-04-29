"""Build the companion document (roadmap extracted from Q/R doc) — generic version.

Generic version of `_build_roadmap.py` from Alise project (28/04/2026).
Reads a config JSON, extracts a section from the v3 skeleton (e.g. §9 Roadmap),
and produces a separate compact PDF with its own cover (compagnon variant).

Why separate: presenting roadmap inside the Q/R doc pushes the recipient to commit
on the WHEN/HOW before validating the WHAT (anchoring bias). See feedback memory
`feedback_qa_docs_scope.md` (28/04/2026 Patrice).

Usage:
    python _build_companion.py --config <config.json>

Skips silently if config.companion.enabled = false.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def to_wsl_path(p: Path) -> str:
    s = str(p.resolve()).replace("\\", "/")
    if len(s) > 2 and s[1] == ":":
        s = "/mnt/" + s[0].lower() + s[2:]
    return s


def extract_section(skeleton_md: Path, from_section: str, to_section: str) -> str:
    """Extract the content between two ## headings (inclusive of from, exclusive of to)."""
    md = skeleton_md.read_text(encoding="utf-8")
    pattern = re.escape(from_section) + r"\n(.*?)(?=\n" + re.escape(to_section) + r"\n)"
    m = re.search(pattern, md, re.DOTALL)
    if not m:
        raise RuntimeError(f"Section '{from_section}' → '{to_section}' not found in {skeleton_md}")
    section_with_heading = from_section + "\n" + m.group(1).rstrip()
    return section_with_heading


def renumber_section(content: str, from_top_num: str = "9", to_top_num: str = "2") -> str:
    """Renumber 'X.Y' → 'TO.Y' in headings to make standalone (X = from_top_num)."""
    # Replace "## X. <title>" → "## TO. <new_title>"
    # Replace "### X.Y <title>" → "### TO.Y <title>"
    content = re.sub(rf"^## {from_top_num}\. ", f"## {to_top_num}. ", content, flags=re.MULTILINE)
    content = re.sub(rf"^### {from_top_num}\.(\d+) ", rf"### {to_top_num}.\1 ", content, flags=re.MULTILINE)
    return content


def render_cover(template_path: Path, config: dict) -> str:
    """Render compagnon cover with placeholders."""
    template = template_path.read_text(encoding="utf-8")
    pdf = config.get("pdf", {})
    delivery = config.get("delivery", {})
    companion = config.get("companion", {})
    repl = {
        "{{eyebrow}}": companion.get("title", "ROADMAP").upper(),
        "{{title}}": config.get("project", {}).get("name", "Projet"),
        "{{subtitle}}": companion.get("title", "Plan de réalisation"),
        "{{subtitle_b}}": "(extrait de la doc Q/R principale)",
        "{{author}}": f"{delivery.get('author','')} · {delivery.get('company','')}",
        "{{date}}": delivery.get("date", ""),
        "{{version}}": f"version {delivery.get('version', '?')}",
        "{{caption}}": "",
        "{{footer}}": "À utiliser après validation de la doc Q/R principale.<br>Phase 0 (cadrage) bloquante pour toutes les phases suivantes.",
        "{{principal_doc}}": delivery.get("deliverables", {}).get("main_pdf", ""),
    }
    out = template
    for k, v in repl.items():
        out = out.replace(k, v)
    out = re.sub(r"<!--.*?-->", "", out, count=1, flags=re.DOTALL).strip()
    return out


INTRO_TEMPLATE = """# {project_name} — {companion_title}

**Document compagnon de** `{principal_doc}` — extraction de la roadmap pour communication
séparée du périmètre Q/R.

| | |
|---|---|
| **Version** | {version} (compagnon) |
| **Date** | {date} |
| **Auteur** | {author} · {company} |
| **Document principal** | `{principal_doc}` (même date) |
| **Public visé** | DSI / Chef de projet / Architecte technique — décision Phase 0 puis go/no-go par phase |

---

## 1. Contexte

{context_paragraph}

**Pré-requis avant ouverture de ce document** : avoir lu — ou au moins survolé — le PDF
Q/R principal, en particulier les sections constats critiques et check-list de validation.

---
"""


CSS_COMPANION = """
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,700;1,400;1,700&display=swap');

* { box-sizing: border-box; }
html { font-family: 'EB Garamond', Garamond, Georgia, serif; font-size: 11pt; }
body { line-height: 1.45; color: #222; max-width: 17cm; margin: 0 auto; }

@page {
    size: A4;
    margin: 2.5cm 2cm;
    @bottom-center {
        content: counter(page);
        font-family: 'EB Garamond', Georgia, serif;
        font-size: 9pt;
        color: #666;
    }
}
@page :first { @bottom-center { content: ""; } }

h1 { font-size: 20pt; font-weight: bold; margin: 1em 0 0.5em; color: #1F4E79; page-break-before: always; }
h1.cover-title { page-break-before: avoid; }
h1:first-of-type { page-break-before: avoid; }
h2 { font-size: 15pt; font-weight: bold; margin: 1.2em 0 0.4em; padding-bottom: 3px; border-bottom: 1px solid #ddd; color: #1F4E79; page-break-after: avoid; }
h3 { font-size: 12.5pt; font-weight: bold; margin: 1em 0 0.3em; color: #2E5A88; page-break-after: avoid; }

p { margin: 0 0 0.6em; text-align: justify; }
ul, ol { margin: 0.4em 0 0.8em 1.4em; padding: 0; }
li { margin: 0.1em 0; }

table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 10pt; page-break-inside: auto; }
th { background: #1F4E79; color: white; padding: 6px 10px; text-align: left; }
td { border: 1px solid #ddd; padding: 5px 10px; vertical-align: top; }
tr:nth-child(even) td { background: #fafafa; }

pre { background: #f5f5f5; border: 1px solid #e0e0e0; border-left: 3px solid #555; padding: 0.6em 0.9em; font-size: 9pt; line-height: 1.4; margin: 0.6em 0; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; font-family: 'Consolas','Courier New',monospace; }
code { font-family: 'Consolas','Courier New',monospace; font-size: 9.5pt; background: #f0f0f0; padding: 1px 3px; border-radius: 2px; }

.cartouche-analyse, blockquote { background: #F2F2F2; border-left: 4px solid #1F4E79; padding: 0.8em 1.2em; margin: 1em 0; page-break-inside: avoid; }

.cover-page { page-break-after: always; break-after: page; text-align: center; padding-top: 4cm; min-height: 24cm; }
.cover-page .cover-eyebrow { font-size: 10pt; letter-spacing: 4px; color: #888; margin-bottom: 1em; }
.cover-page .cover-title { font-size: 32pt; font-weight: bold; color: #1F4E79; margin: 0; line-height: 1.2; page-break-before: avoid; }
.cover-page .cover-subtitle { font-size: 14pt; font-style: italic; color: #444; margin-top: 1.5em; line-height: 1.4; }
.cover-page .cover-divider { width: 4cm; height: 2px; background: #1F4E79; margin: 3cm auto 1.5cm; }
.cover-page .cover-meta { font-size: 12pt; line-height: 1.5; }
.cover-page .cover-foot { margin-top: 4cm; font-size: 9pt; color: #888; font-style: italic; padding: 0 2cm; }

header#title-block-header { display: none; }

nav#TOC { page-break-before: always; page-break-after: always; }
nav#TOC h1 { page-break-before: avoid; }
nav#TOC ul { list-style: none; padding-left: 0; }
nav#TOC ul ul { padding-left: 1.5em; }
nav#TOC li { margin: 0.15em 0; }
nav#TOC a { text-decoration: none; color: #1F4E79; }
"""


def run_pandoc(md_path: Path, html_path: Path, css_path: Path, config: dict) -> None:
    delivery = config.get("delivery", {})
    title = f"{config.get('project', {}).get('name', '')} — Roadmap (compagnon)"
    cmd = [
        "wsl", "pandoc",
        to_wsl_path(md_path),
        "--from=markdown+smart+fenced_divs+raw_html",
        "--to=html5",
        "--standalone",
        "--toc", "--toc-depth=2",
        "--metadata", f"title={title}",
        "--metadata", f"author={delivery.get('author', '')}",
        "--metadata", f"date={delivery.get('date', '')}",
        "--css=" + css_path.name,
        "-o", to_wsl_path(html_path),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print(f"[pandoc] STDERR: {r.stderr}")
        raise RuntimeError("pandoc failed")
    print(f"[pandoc] HTML: {html_path.stat().st_size//1024} KB")


def run_chrome(html_path: Path, pdf_path: Path) -> None:
    url = "file://" + to_wsl_path(html_path)
    cmd = [
        "wsl", "google-chrome",
        "--headless=new", "--disable-gpu", "--no-sandbox",
        "--run-all-compositor-stages-before-draw",
        "--no-pdf-header-footer",
        "--print-to-pdf=" + to_wsl_path(pdf_path),
        url,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print(f"[chrome] STDERR: {r.stderr}")
        raise RuntimeError("chrome failed")
    print(f"[chrome] PDF: {pdf_path.stat().st_size//1024} KB")


def post_process_html(html_path: Path, cover_html: str) -> None:
    html = html_path.read_text(encoding="utf-8")
    new_html, n = re.subn(
        r'<header id="title-block-header">[\s\S]*?</header>',
        lambda _m: cover_html,
        html,
        count=1,
    )
    if n == 0:
        new_html = re.sub(r'(<body[^>]*>)', lambda m: m.group(1) + "\n" + cover_html, html, count=1)
    html_path.write_text(new_html, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build companion roadmap PDF")
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    if not args.config.is_file():
        print(f"ERROR: {args.config} not found", file=sys.stderr)
        return 2

    config = json.loads(args.config.read_text(encoding="utf-8"))
    project_root = args.config.parent

    companion = config.get("companion", {})
    if not companion.get("enabled", False):
        print("Companion disabled in config (companion.enabled=false). Skipping.")
        return 0

    skeleton = Path(config["source"]["questions_md_skeleton"])
    if not skeleton.is_absolute():
        skeleton = project_root / skeleton

    delivery = config.get("delivery", {})
    project = config.get("project", {})

    # Extract section
    print("[1/4] Extracting section from skeleton...")
    section = extract_section(
        skeleton,
        companion.get("extract_from_section", "## 9. Préconisations & roadmap"),
        companion.get("extract_to_section", "## 10. Annexes"),
    )
    section = renumber_section(section, from_top_num="9", to_top_num="2")

    # Compose markdown
    intro = INTRO_TEMPLATE.format(
        project_name=project.get("name", "Projet"),
        companion_title=companion.get("title", "Roadmap de réalisation"),
        principal_doc=delivery.get("deliverables", {}).get("main_pdf", "doc-principal.pdf"),
        version=delivery.get("version", "?"),
        date=delivery.get("date", ""),
        author=delivery.get("author", ""),
        company=delivery.get("company", ""),
        context_paragraph=companion.get(
            "context_paragraph",
            "La doc Q/R principale a fait l'objet d'une analyse technique détaillée. Le présent "
            "document compagnon isole le plan d'exécution proposé pour la migration.",
        ),
    )

    full_md = intro + "\n" + section + "\n\n---\n\n*Document compagnon généré par le kit méthodologique Doc Q/R technique v1.0.*\n"

    # Build dirs
    build_dir = project_root / "_meta" / "build_companion"
    build_dir.mkdir(parents=True, exist_ok=True)

    md_path = project_root / f"Roadmap-{project.get('module', 'companion').replace(' ', '-')}-v{delivery.get('version', '0')}.md"
    md_path.write_text(full_md, encoding="utf-8")
    print(f"    -> {md_path.name} ({len(full_md.splitlines())} lines, {md_path.stat().st_size//1024} KB)")

    # CSS for companion (self-contained)
    css_path = build_dir / "companion.css"
    css_path.write_text(CSS_COMPANION, encoding="utf-8")

    # Cover
    kit_dir = Path(__file__).parent
    cover_template = kit_dir / "cover-templates" / "compagnon.html"
    cover_html = render_cover(cover_template, config)

    # Pandoc → HTML
    print("[2/4] Pandoc → HTML")
    html_path = build_dir / "Roadmap.html"
    run_pandoc(md_path, html_path, css_path, config)
    post_process_html(html_path, cover_html)

    # Chrome → PDF
    print("[3/4] Chrome → PDF")
    out_pdf = build_dir / "Roadmap.pdf"
    run_chrome(html_path, out_pdf)

    # Copy to final
    print("[4/4] Copy to final destination")
    companion_pdf_name = delivery.get("deliverables", {}).get("companion_pdf",
                                                              f"Roadmap-Compagnon-v{delivery.get('version', '0')}.pdf")
    dst_pdf = project_root / companion_pdf_name
    try:
        shutil.copy2(out_pdf, dst_pdf)
        print(f"\n[OK] {dst_pdf} ({dst_pdf.stat().st_size/1024/1024:.2f} MB)")
    except PermissionError:
        fallback = dst_pdf.with_name(dst_pdf.stem + "-clean.pdf")
        shutil.copy2(out_pdf, fallback)
        print(f"\n[WARN] Final PDF locked; wrote to fallback: {fallback}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
