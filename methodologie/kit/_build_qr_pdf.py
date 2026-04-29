"""Build the Q/R technical doc PDF (qualité conseil) via pandoc + Chrome headless.

Generic version of `_build_pdf_v7.py` from the Alise project (28/04/2026).
Reads a config JSON, takes a fused markdown, and produces a PDF with:
  - cover page (HTML template injected post-pandoc)
  - mermaid diagrams rendered as PNG (via _render_mermaid.py)
  - optional screenshots extracted from a source DOCX (one per question)
  - CSS qualité conseil (EB Garamond + cartouches couleur)
  - pandoc HTML5 → Chrome --print-to-pdf

Usage:
    python _build_qr_pdf.py --config <config.json> [--md <enriched.md>]

If --md is omitted, expects <skeleton>-enriched.md next to the v3 skeleton.

Toolchain required (verified at start) :
  - WSL bash + pandoc (>= 2.9) + google-chrome
  - Python 3.10+ + python-docx (for screenshot extraction)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R_OFFICE = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
R_PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).strip().lower()
    s = s.replace("’", "'").replace("«", "<<").replace("»", ">>")
    s = re.sub(r"<<\s*", "<<", s)
    s = re.sub(r"\s*>>", ">>", s)
    s = re.sub(r"\s+", " ", s)
    return s


def to_wsl_path(p: Path) -> str:
    s = str(p.resolve()).replace("\\", "/")
    if len(s) > 2 and s[1] == ":":
        s = "/mnt/" + s[0].lower() + s[2:]
    return s


def extract_screenshots(docx_path: Path, screenshot_dir: Path) -> dict[str, list[str]]:
    """Extract images from a DOCX, mapped by H2 heading they appear under."""
    if not docx_path.is_file():
        return {}
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(docx_path)
    for name in z.namelist():
        if name.startswith("word/media/"):
            target = screenshot_dir / Path(name).name
            target.write_bytes(z.read(name))
    rels = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    rid_to_image = {
        r.get("Id"): r.get("Target").replace("media/", "")
        for r in rels.findall(R_PKG + "Relationship")
        if "image" in r.get("Type", "")
    }
    doc = ET.fromstring(z.read("word/document.xml"))
    body = doc.find(W + "body")
    mapping: dict[str, list[str]] = {}
    current = None
    for child in body:
        if child.tag != W + "p":
            continue
        style_e = child.find(W + "pPr/" + W + "pStyle")
        style = style_e.get(W + "val") if style_e is not None else None
        if style in ("Heading2", "Titre2"):
            text = "".join(t.text or "" for t in child.iter(W + "t"))
            current = _norm(text)
            mapping.setdefault(current, [])
        for blip in child.iter(A + "blip"):
            embed = blip.get(R_OFFICE + "embed")
            if embed in rid_to_image and current:
                mapping[current].append(rid_to_image[embed])
    return mapping


def screenshot_block(qid: str, qkey: str, screenshot_map: dict[str, list[str]],
                     screenshot_dir: Path) -> str:
    """Render <figure> blocks for screenshots associated with a question."""
    images = screenshot_map.get(qkey, [])
    if not images:
        return ""
    out = []
    for i, img in enumerate(images, 1):
        cap = f"Capture — {qid} ({i}/{len(images)})" if len(images) > 1 else f"Capture — {qid}"
        wsl_p = to_wsl_path(screenshot_dir / img)
        out.append(
            f'<figure class="screenshot">\n'
            f'  <img src="file://{wsl_p}" alt="{cap}">\n'
            f'  <figcaption>{cap}</figcaption>\n'
            f'</figure>\n'
        )
    return "\n".join(out)


def replace_mermaid_with_png(md: str, diag_cache: Path) -> str:
    """Replace ```mermaid blocks with <figure><img src="..."> when a cached PNG exists."""
    lines = md.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```mermaid"):
            j = i + 1
            while j < len(lines) and not lines[j].strip().startswith("```"):
                j += 1
            mermaid_src = "\n".join(lines[i + 1:j])
            h = hashlib.sha256(mermaid_src.encode("utf-8")).hexdigest()[:16]
            png = diag_cache / f"{h}.png"
            if png.exists():
                wsl_p = to_wsl_path(png)
                out.append(
                    f'\n<figure class="diagram">\n'
                    f'  <img src="file://{wsl_p}" alt="Diagramme Mermaid">\n'
                    f'  <figcaption>Diagramme — section §7</figcaption>\n'
                    f'</figure>\n'
                )
            else:
                # Keep as code block
                out.append("```")
                out.append(mermaid_src)
                out.append("```")
            i = j + 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def find_qid_for_heading(heading_text: str, qid_map: dict[str, str]) -> str | None:
    """Match a markdown H3/H4 heading to a Q-id from config."""
    for qid, title_md in qid_map.items():
        if title_md and (title_md in heading_text or qid + " —" in heading_text or qid + " -" in heading_text):
            return qid
    m = re.match(r"^(Q\d+\.\d+)\b", heading_text.strip())
    if m and m.group(1) in qid_map:
        return m.group(1)
    return None


def enrich_markdown(md: str, screenshot_map: dict[str, list[str]],
                    qid_map: dict[str, str], qid_docx_keys: dict[str, str],
                    screenshot_dir: Path, diag_cache: Path) -> str:
    """Inject screenshots after each question heading + replace mermaid blocks with PNGs."""
    md = replace_mermaid_with_png(md, diag_cache)

    lines = md.split("\n")
    out: list[str] = []
    for line in lines:
        out.append(line)
        if line.startswith("### ") or line.startswith("#### "):
            heading_text = line.lstrip("#").strip()
            qid = find_qid_for_heading(heading_text, qid_map)
            if qid:
                qkey = qid_docx_keys.get(qid, "")
                if qkey:
                    block = screenshot_block(qid, qkey, screenshot_map, screenshot_dir)
                    if block:
                        out.append("")
                        out.append(block)
    return "\n".join(out)


def render_cover(template_path: Path, config: dict) -> str:
    """Render a cover HTML template from config.pdf.* placeholders."""
    template = template_path.read_text(encoding="utf-8")
    pdf = config.get("pdf", {})
    delivery = config.get("delivery", {})
    repl = {
        "{{eyebrow}}": pdf.get("cover_eyebrow", "DOCUMENTATION TECHNIQUE"),
        "{{title}}": config.get("project", {}).get("name", "Projet"),
        "{{subtitle}}": pdf.get("cover_subtitle", ""),
        "{{subtitle_b}}": pdf.get("cover_subtitle_b", ""),
        "{{author}}": f"{delivery.get('author','')} · {delivery.get('company','')}",
        "{{date}}": delivery.get("date", ""),
        "{{version}}": f"version {delivery.get('version', '?')} ({delivery.get('version_label', '')})",
        "{{caption}}": pdf.get("cover_caption", ""),
        "{{footer}}": pdf.get("cover_footer", ""),
        "{{principal_doc}}": delivery.get("deliverables", {}).get("main_pdf", ""),
    }
    out = template
    for k, v in repl.items():
        out = out.replace(k, v)
    # Strip the HTML comment block at top
    out = re.sub(r"<!--.*?-->", "", out, count=1, flags=re.DOTALL).strip()
    return out


def run_pandoc(md_path: Path, html_path: Path, css_path: Path, config: dict) -> None:
    pdf_meta = config.get("pdf", {})
    title = pdf_meta.get("metadata_title", config.get("project", {}).get("name", ""))
    author = pdf_meta.get("metadata_author", config.get("delivery", {}).get("author", ""))
    date = pdf_meta.get("metadata_date", config.get("delivery", {}).get("date", ""))
    cmd = [
        "wsl", "pandoc",
        to_wsl_path(md_path),
        "--from=markdown+smart+fenced_divs+raw_html",
        "--to=html5",
        "--standalone",
        "--toc", "--toc-depth=3",
        "--metadata", f"title={title}",
        "--metadata", f"author={author}",
        "--metadata", f"date={date}",
        "--css=" + css_path.name,
        "-o", to_wsl_path(html_path),
    ]
    print(f"[pandoc] {' '.join(cmd[:6])} ...")
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
    print(f"[chrome] {url}")
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        print(f"[chrome] STDERR: {r.stderr}")
        raise RuntimeError("chrome failed")
    print(f"[chrome] PDF: {pdf_path.stat().st_size//1024} KB")


def post_process_html(html_path: Path, cover_html: str) -> None:
    """Replace pandoc title block with our custom cover (using callable to avoid backslash regex traps)."""
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
    print(f"[post] cover-page injected ({n if n else 'fallback'})")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Q/R technical doc PDF")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--md", type=Path, default=None,
                        help="Path to enriched markdown (default: <skeleton>-enriched.md)")
    parser.add_argument("--output", type=Path, default=None,
                        help="Path to output PDF (default: from config.delivery.deliverables.main_pdf)")
    args = parser.parse_args()

    if not args.config.is_file():
        print(f"ERROR: {args.config} not found", file=sys.stderr)
        return 2

    config = json.loads(args.config.read_text(encoding="utf-8"))
    project_root = args.config.parent

    # Resolve paths
    skeleton = Path(config["source"]["questions_md_skeleton"])
    if not skeleton.is_absolute():
        skeleton = project_root / skeleton
    md_path = args.md if args.md else skeleton.with_name(skeleton.stem + "-enriched.md")
    if not md_path.is_file():
        print(f"ERROR: enriched markdown {md_path} not found. Run _build_qr_md.py first.", file=sys.stderr)
        return 2

    # Output PDF
    if args.output:
        dst_pdf = args.output
    else:
        main_pdf = config.get("delivery", {}).get("deliverables", {}).get("main_pdf", "output.pdf")
        dst_pdf = project_root / main_pdf

    # Build dirs
    build_dir = project_root / "_meta" / "build_qr"
    build_dir.mkdir(parents=True, exist_ok=True)

    # CSS (use kit's qualite-conseil.css unless overridden)
    kit_dir = Path(__file__).parent
    css_src = kit_dir / "css" / "qualite-conseil.css"
    css_dst = build_dir / css_src.name
    shutil.copy2(css_src, css_dst)

    # Cover template
    cover_template_name = config.get("pdf", {}).get("cover_template", "principal")
    cover_template = kit_dir / "cover-templates" / f"{cover_template_name}.html"
    if not cover_template.is_file():
        print(f"ERROR: cover template {cover_template} not found", file=sys.stderr)
        return 2

    # Screenshots (optional)
    screenshot_map: dict[str, list[str]] = {}
    qid_docx_keys: dict[str, str] = {}
    pdf_cfg = config.get("pdf", {})
    if pdf_cfg.get("extract_screenshots_from_docx", False):
        questions_docx = config["source"].get("questions_docx")
        if questions_docx:
            docx_path = Path(questions_docx)
            if not docx_path.is_absolute():
                docx_path = project_root / questions_docx
            if docx_path.is_file():
                screenshot_dir = project_root / "_meta" / "screenshots"
                print("[1/5] Extracting screenshots from DOCX...")
                screenshot_map = extract_screenshots(docx_path, screenshot_dir)
                print(f"    -> {sum(len(v) for v in screenshot_map.values())} images on {len(screenshot_map)} questions")
            # Build qid → docx_key mapping from config.questions[].docx_heading_key
            for q in config.get("questions", []):
                qid = q.get("id", "")
                key = q.get("docx_heading_key") or _norm(q.get("title_short", ""))
                qid_docx_keys[qid] = key

    # qid → markdown title pour la détection de heading
    qid_md_titles = {q.get("id"): q.get("v3_heading", "").lstrip("#").strip()
                     for q in config.get("questions", [])}

    # Render mermaid PNG cache (idempotent — re-uses _meta/diagrams/)
    if pdf_cfg.get("render_mermaid", True):
        diag_cache = project_root / "_meta" / "diagrams"
        diag_cache.mkdir(parents=True, exist_ok=True)
        render_cmd = [
            sys.executable, str(kit_dir / "_render_mermaid.py"),
            str(md_path),
            "--cache-dir", str(diag_cache),
        ]
        print("[2/5] Rendering mermaid diagrams (mermaid.ink)...")
        r = subprocess.run(render_cmd, capture_output=True, text=True, encoding="utf-8")
        print(r.stdout.rstrip() if r.stdout else "")
        if r.returncode != 0:
            print(f"[mermaid] WARN rc={r.returncode}: {r.stderr}", file=sys.stderr)
    else:
        diag_cache = project_root / "_meta" / "diagrams"

    # Enrich markdown (inject screenshots + replace mermaid with PNG)
    print("[3/5] Enriching markdown...")
    md = md_path.read_text(encoding="utf-8")
    screenshot_dir = project_root / "_meta" / "screenshots"
    enriched = enrich_markdown(md, screenshot_map, qid_md_titles, qid_docx_keys,
                               screenshot_dir, diag_cache)

    enriched_path = build_dir / md_path.name
    enriched_path.write_text(enriched, encoding="utf-8")
    print(f"    -> {enriched_path.relative_to(project_root)} ({enriched_path.stat().st_size//1024} KB)")

    # Pandoc → HTML
    print("[4/5] Pandoc → HTML")
    html_path = build_dir / "Reponses.html"
    run_pandoc(enriched_path, html_path, css_dst, config)

    # Inject cover
    cover_html = render_cover(cover_template, config)
    post_process_html(html_path, cover_html)

    # Chrome → PDF
    print("[5/5] Chrome → PDF")
    out_pdf = build_dir / "Reponses.pdf"
    run_chrome(html_path, out_pdf)

    # Copy to final destination
    try:
        shutil.copy2(out_pdf, dst_pdf)
        print(f"\n[OK] {dst_pdf} ({dst_pdf.stat().st_size/1024/1024:.2f} MB)")
    except PermissionError:
        # File locked (viewer open) — fallback: -clean.pdf suffix
        fallback = dst_pdf.with_name(dst_pdf.stem + "-clean.pdf")
        shutil.copy2(out_pdf, fallback)
        print(f"\n[WARN] Final PDF locked; wrote to fallback: {fallback}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
