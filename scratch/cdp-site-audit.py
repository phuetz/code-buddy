#!/usr/bin/env python3
"""Capture a web page and its commercial-content DOM through Patrice's Brave CDP."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import sys
import time
from pathlib import Path

CDP_LIB_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "influencer" / "cdp-lib.py"
)
CDP_LIB_SPEC = importlib.util.spec_from_file_location("cdp_lib", CDP_LIB_PATH)
if CDP_LIB_SPEC is None or CDP_LIB_SPEC.loader is None:
    raise RuntimeError(f"Unable to load CDP helper: {CDP_LIB_PATH}")
CDP_LIB = importlib.util.module_from_spec(CDP_LIB_SPEC)
CDP_LIB_SPEC.loader.exec_module(CDP_LIB)
CDP = CDP_LIB.CDP
get_tab = CDP_LIB.get_tab


def wait_ready(cdp: CDP, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cdp.ev("document.readyState") == "complete":
            time.sleep(2)
            return
        time.sleep(0.25)
    raise TimeoutError("document did not reach readyState=complete")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("slug")
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    seed = get_tab(("console.groq.com", "admin.mistral.ai", "labs.google"))
    if not seed:
        raise RuntimeError("No Brave page target is available on CDP port 9222")
    seed_cdp = CDP(seed)
    created = seed_cdp.cmd("Target.createTarget", {"url": "about:blank"})
    target_id = created["result"]["targetId"]

    try:
        time.sleep(0.5)
        tab = get_tab(("about:blank",))
        if not tab or tab.get("id") != target_id:
            tabs = __import__("urllib.request").request.urlopen(
                "http://127.0.0.1:9222/json/list", timeout=5
            )
            tab = next(t for t in json.load(tabs) if t.get("id") == target_id)

        cdp = CDP(tab)
        cdp.cmd("Runtime.enable")
        cdp.cmd("Page.enable")
        cdp.cmd(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": 1440,
                "height": 900,
                "deviceScaleFactor": 1,
                "mobile": False,
            },
        )
        nav = cdp.cmd("Page.navigate", {"url": args.url}, to=30)
        if not nav or nav.get("error"):
            raise RuntimeError(f"Navigation failed: {nav}")
        wait_ready(cdp)

        args.output_dir.mkdir(parents=True, exist_ok=True)
        audit_js = r"""
(() => {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const abs = value => {
    try { return new URL(value, location.href).href; } catch { return value || ''; }
  };
  const visible = el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const link = a => ({
    text: clean(a.innerText || a.textContent),
    href: abs(a.getAttribute('href')),
    visible: visible(a),
    target: a.getAttribute('target') || ''
  });
  const button = el => ({
    text: clean(el.innerText || el.textContent || el.value),
    tag: el.tagName.toLowerCase(),
    href: el.tagName === 'A' ? abs(el.getAttribute('href')) : '',
    visible: visible(el)
  });
  return {
    capturedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || '',
    metaDescription: document.querySelector('meta[name=description]')?.content || '',
    canonical: document.querySelector('link[rel=canonical]')?.href || '',
    statusText: document.body ? clean(document.body.innerText).slice(0, 50000) : '',
    headings: [...document.querySelectorAll('h1,h2,h3')].map(el => ({
      level: el.tagName.toLowerCase(),
      text: clean(el.innerText || el.textContent),
      visible: visible(el)
    })),
    navs: [...document.querySelectorAll('nav')].map((nav, index) => ({
      index,
      text: clean(nav.innerText || nav.textContent),
      links: [...nav.querySelectorAll('a')].map(link)
    })),
    ctas: [...document.querySelectorAll('a,button,input[type=submit]')]
      .filter(el => visible(el))
      .map(button)
      .filter(item => item.text)
      .slice(0, 250),
    links: [...document.querySelectorAll('a[href]')].map(link),
    images: [...document.images].map(img => ({
      src: abs(img.currentSrc || img.src),
      alt: img.alt || '',
      width: img.naturalWidth,
      height: img.naturalHeight,
      visible: visible(img)
    })),
    forms: [...document.forms].map(form => ({
      action: abs(form.action),
      method: form.method,
      fields: [...form.elements].map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        placeholder: el.placeholder || ''
      }))
    })),
    bodyMetrics: document.body ? {
      scrollWidth: document.body.scrollWidth,
      scrollHeight: document.body.scrollHeight
    } : null
  };
})()
"""
        audit = cdp.ev(audit_js)
        if not isinstance(audit, dict):
            raise RuntimeError(f"DOM audit returned unexpected value: {type(audit)!r}")
        (args.output_dir / f"{args.slug}.json").write_text(
            json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        metrics = cdp.cmd("Page.getLayoutMetrics")
        size = metrics["result"]["cssContentSize"]
        width = min(max(int(size["width"]), 1440), 3000)
        height = min(max(int(size["height"]), 900), 16384)
        shot = cdp.cmd(
            "Page.captureScreenshot",
            {
                "format": "png",
                "captureBeyondViewport": True,
                "fromSurface": True,
                "clip": {"x": 0, "y": 0, "width": width, "height": height, "scale": 1},
            },
            to=60,
        )
        if not shot or "data" not in shot.get("result", {}):
            raise RuntimeError(f"Screenshot failed: {shot}")
        (args.output_dir / f"{args.slug}.png").write_bytes(
            base64.b64decode(shot["result"]["data"])
        )

        print(
            json.dumps(
                {
                    "targetId": target_id,
                    "url": audit["url"],
                    "title": audit["title"],
                    "headings": audit["headings"],
                    "navs": audit["navs"],
                    "metrics": {"width": width, "height": height},
                    "files": [
                        str(args.output_dir / f"{args.slug}.json"),
                        str(args.output_dir / f"{args.slug}.png"),
                    ],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    finally:
        seed_cdp.cmd("Target.closeTarget", {"targetId": target_id})


if __name__ == "__main__":
    raise SystemExit(main())
