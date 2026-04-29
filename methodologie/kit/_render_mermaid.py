"""Render mermaid blocks from a Q/R markdown via mermaid.ink.

Generic version of the renderer used by Alise multi-barèmes (28/04/2026).
Reads the source markdown, finds all ```mermaid blocks, hashes them with SHA-256[:16],
and renders missing ones via mermaid.ink (encoded URL-safe base64 of a JSON envelope).

Kroki was used as the original renderer but tends to hang on POST in restricted sandboxes.
mermaid.ink is faster and more reliable. Cache lives next to the markdown source as
`_meta/diagrams/<sha16>.png` — both _build_qr_pdf.py and _build_companion.py look up
PNGs there using the same hash convention.

Usage:
    python _render_mermaid.py <markdown_path>

Idempotent: skips blocks whose PNG already exists with size > 1 KB and PNG signature OK.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


def to_wsl_path(p: Path) -> str:
    """Convert Windows path to /mnt/<drive>/... for WSL bash invocations."""
    s = str(p.resolve()).replace("\\", "/")
    if len(s) > 2 and s[1] == ":":
        s = "/mnt/" + s[0].lower() + s[2:]
    return s


def render(markdown_path: Path, cache_dir: Path | None = None) -> int:
    """Render all mermaid blocks from `markdown_path`. Returns number of failures."""
    md = markdown_path.read_text(encoding="utf-8")
    blocks = re.findall(r"```mermaid\n(.*?)\n```", md, flags=re.DOTALL)
    print(f"Found {len(blocks)} mermaid blocks in {markdown_path.name}", flush=True)

    if cache_dir is None:
        cache_dir = markdown_path.parent / "_meta" / "diagrams"
    cache_dir.mkdir(parents=True, exist_ok=True)

    rendered, cached, failed = 0, 0, 0
    for idx, src in enumerate(blocks, 1):
        h = hashlib.sha256(src.encode("utf-8")).hexdigest()[:16]
        target = cache_dir / f"{h}.png"

        # Cache hit?
        if target.exists() and target.stat().st_size > 1000:
            with open(target, "rb") as f:
                if f.read(8).startswith(b"\x89PNG\r\n\x1a\n"):
                    print(f"  block {idx}: cached {target.name}", flush=True)
                    cached += 1
                    continue

        # Encode for mermaid.ink: JSON envelope { code, mermaid: { theme: 'default' } }
        payload = json.dumps({"code": src, "mermaid": {"theme": "default"}})
        enc = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")
        url = f"https://mermaid.ink/img/{enc}?type=png&bgColor=ffffff"
        wsl_target = to_wsl_path(target)
        print(f"  block {idx}: rendering {h} (src={len(src)}c, enc={len(enc)}c)", flush=True)

        cmd = ["wsl", "bash", "-c", f"curl -sS --max-time 90 -o '{wsl_target}' '{url}'; echo exit=$?"]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print(f"    wsl/curl FAIL rc={r.returncode}: {r.stderr.strip()}", flush=True)
            failed += 1
            continue

        if not target.exists():
            print(f"    no file produced", flush=True)
            failed += 1
            continue

        size = target.stat().st_size
        with open(target, "rb") as f:
            sig = f.read(8)
        if not sig.startswith(b"\x89PNG\r\n\x1a\n"):
            with open(target, "rb") as f:
                snippet = f.read(300)
            print(f"    not a PNG ({size} bytes): {snippet[:200]!r}", flush=True)
            target.unlink()
            failed += 1
            continue

        print(f"    -> {target.name} ({size//1024} KB)", flush=True)
        rendered += 1

    print(f"Done: rendered={rendered}, cached={cached}, failed={failed}", flush=True)
    return failed


def main() -> int:
    parser = argparse.ArgumentParser(description="Render mermaid blocks via mermaid.ink")
    parser.add_argument("markdown", type=Path, help="Path to the source markdown file")
    parser.add_argument("--cache-dir", type=Path, default=None,
                        help="Override PNG cache dir (default: <md>/_meta/diagrams)")
    args = parser.parse_args()

    if not args.markdown.is_file():
        print(f"ERROR: {args.markdown} not found", file=sys.stderr)
        return 2

    failures = render(args.markdown, cache_dir=args.cache_dir)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
