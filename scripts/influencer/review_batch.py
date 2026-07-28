#!/usr/bin/env python3
"""Planche HTML locale pour approuver dix vidéos en moins de deux minutes."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from html import escape
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
from pathlib import Path
import secrets
import subprocess
import tempfile
from typing import Any
import urllib.parse
import webbrowser

from publish_queue import (
    DEFAULT_AUDIT_LOG,
    DEFAULT_DATABASE,
    PublicationQueue,
    QueueEntry,
    QueueError,
)


@dataclass(frozen=True)
class ReviewAsset:
    entry: QueueEntry
    clip: Path | None


def first_description_lines(value: str, count: int = 2) -> str:
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if len(lines) < count:
        words = value.split()
        width = max(1, (len(words) + count - 1) // count)
        lines = [
            ' '.join(words[index:index + width])
            for index in range(0, len(words), width)
        ]
    return '\n'.join(lines[:count])


def format_duration(seconds: float | None) -> str:
    if seconds is None:
        return 'durée inconnue'
    minutes, remainder = divmod(round(seconds), 60)
    return f'{minutes}:{remainder:02d}'


def make_preview(entry: QueueEntry, directory: Path) -> Path | None:
    output = directory / f'{entry.id}.mp4'
    try:
        subprocess.run(
            [
                'ffmpeg',
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-ss',
                '0',
                '-i',
                entry.video_file,
                '-t',
                '3',
                '-vf',
                "scale='min(360,iw)':-2",
                '-an',
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-movflags',
                '+faststart',
                str(output),
            ],
            check=True,
            timeout=90,
        )
        return output
    except (FileNotFoundError, subprocess.SubprocessError):
        return None


def prepare_assets(
    entries: list[QueueEntry],
    directory: Path,
) -> list[ReviewAsset]:
    directory.mkdir(parents=True, exist_ok=True)
    return [
        ReviewAsset(entry=entry, clip=make_preview(entry, directory))
        for entry in entries
    ]


def render_html(
    assets: list[ReviewAsset],
    *,
    csrf_token: str,
    approver: str,
) -> str:
    cards = []
    for index, asset in enumerate(assets, start=1):
        entry = asset.entry
        clip = (
            f'<video muted loop playsinline preload="metadata" '
            f'src="/media/clip/{escape(entry.id)}"></video>'
            if asset.clip
            else '<div class="sans-extrait">Extrait indisponible (ffmpeg)</div>'
        )
        cards.append(
            f"""
            <article class="card">
              <label class="decision">
                <input type="checkbox" name="approved"
                       value="{escape(entry.id)}" checked>
                <span>APPROUVER</span>
              </label>
              <div class="index">{index:02d}</div>
              <div class="media">
                <img src="/media/thumb/{escape(entry.id)}"
                     alt="Miniature de {escape(entry.title)}">
                {clip}
              </div>
              <div class="copy">
                <div class="meta">
                  <span>{escape(entry.persona)}</span>
                  <span>{escape(entry.platform.upper())}</span>
                  <span>{escape(format_duration(entry.duration_seconds))}</span>
                </div>
                <h2>{escape(entry.title)}</h2>
                <p>{escape(first_description_lines(entry.description))}</p>
                <small>{escape(entry.scheduled_for)}</small>
              </div>
            </article>
            """
        )
    return f"""<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Validation du lot Lisa & Ambre</title>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, system-ui, sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; background:#0e1015; color:#f5f1e8; }}
    header {{ position:sticky; top:0; z-index:5; padding:14px 22px;
      background:rgba(14,16,21,.96); border-bottom:1px solid #343945;
      display:flex; align-items:center; justify-content:space-between; gap:18px; }}
    h1 {{ font-size:20px; margin:0; }}
    .toolbar {{ display:flex; gap:8px; align-items:center; }}
    button {{ border:0; border-radius:8px; padding:10px 14px; font-weight:750;
      cursor:pointer; }}
    button[type=submit] {{ background:#86efac; color:#102016; }}
    button[type=button] {{ background:#2c313d; color:#fff; }}
    main {{ max-width:1500px; margin:0 auto; padding:18px;
      display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }}
    .card {{ position:relative; display:grid; grid-template-columns:310px 1fr;
      min-height:260px; border:1px solid #303641; border-radius:14px;
      overflow:hidden; background:#171a21; }}
    .index {{ position:absolute; top:10px; left:12px; z-index:2;
      background:#101218cc; padding:5px 8px; border-radius:6px; }}
    .decision {{ position:absolute; right:12px; top:12px; z-index:3;
      background:#101218e8; padding:8px 10px; border-radius:8px;
      display:flex; gap:8px; align-items:center; font-weight:800; }}
    .decision:has(input:not(:checked)) {{ background:#742a2a; }}
    .decision input {{ width:20px; height:20px; accent-color:#22c55e; }}
    .media {{ display:grid; grid-template-columns:1fr 1fr; background:#090a0d; }}
    .media img,.media video {{ width:100%; height:260px; object-fit:cover; }}
    .sans-extrait {{ display:grid; place-items:center; padding:15px; color:#999; }}
    .copy {{ padding:52px 18px 16px; min-width:0; }}
    .meta {{ display:flex; flex-wrap:wrap; gap:7px; }}
    .meta span {{ border:1px solid #434a58; border-radius:999px;
      padding:4px 8px; font-size:12px; }}
    h2 {{ font-size:20px; line-height:1.15; margin:15px 0 10px; }}
    p {{ white-space:pre-line; color:#c9c4b8; line-height:1.35; }}
    small {{ color:#838a98; }}
    @media(max-width:1000px) {{
      main {{ grid-template-columns:1fr; }}
    }}
    @media(max-width:650px) {{
      .card {{ grid-template-columns:1fr; }}
      .media img,.media video {{ height:220px; }}
    }}
  </style>
</head>
<body>
  <form method="post" action="/decisions">
    <header>
      <div>
        <h1>Lot de {len(assets)} publication(s)</h1>
        <span id="count">{len(assets)} approuvée(s)</span>
      </div>
      <div class="toolbar">
        <button type="button" id="all">Tout cocher</button>
        <button type="button" id="none">Tout décocher</button>
        <button type="submit">ENREGISTRER LE LOT</button>
      </div>
    </header>
    <input type="hidden" name="csrf" value="{escape(csrf_token)}">
    <input type="hidden" name="approver" value="{escape(approver)}">
    <input type="hidden" name="entry_ids"
           value="{escape(','.join(asset.entry.id for asset in assets))}">
    <main>{''.join(cards)}</main>
  </form>
  <script>
    const checks=[...document.querySelectorAll('input[name=approved]')];
    const count=document.querySelector('#count');
    const refresh=()=>{{
      count.textContent=`${{checks.filter(x=>x.checked).length}} approuvée(s)`;
    }};
    checks.forEach(x=>{{
      x.addEventListener('change',refresh);
      x.closest('.card').addEventListener('mouseenter',()=>{{
        const v=x.closest('.card').querySelector('video'); if(v) v.play();
      }});
      x.closest('.card').addEventListener('mouseleave',()=>{{
        const v=x.closest('.card').querySelector('video');
        if(v){{v.pause();v.currentTime=0;}}
      }});
    }});
    document.querySelector('#all').onclick=()=>{{checks.forEach(x=>x.checked=true);refresh();}};
    document.querySelector('#none').onclick=()=>{{checks.forEach(x=>x.checked=false);refresh();}};
  </script>
</body>
</html>"""


class ReviewServer(ThreadingHTTPServer):
    queue: PublicationQueue
    assets: dict[str, ReviewAsset]
    html: str
    csrf_token: str
    completed: bool


class ReviewHandler(BaseHTTPRequestHandler):
    server: ReviewServer

    def log_message(self, template: str, *args: Any) -> None:
        return

    def _send(
        self,
        status: HTTPStatus,
        body: bytes,
        content_type: str,
    ) -> None:
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == '/':
            self._send(
                HTTPStatus.OK,
                self.server.html.encode('utf-8'),
                'text/html; charset=utf-8',
            )
            return
        parts = self.path.strip('/').split('/')
        if len(parts) != 3 or parts[0] != 'media':
            self._send(HTTPStatus.NOT_FOUND, b'Introuvable', 'text/plain')
            return
        kind, identifier = parts[1:]
        asset = self.server.assets.get(identifier)
        if asset is None:
            self._send(HTTPStatus.NOT_FOUND, b'Introuvable', 'text/plain')
            return
        path = (
            Path(asset.entry.thumbnail)
            if kind == 'thumb'
            else asset.clip if kind == 'clip' else None
        )
        if path is None or not path.is_file():
            self._send(HTTPStatus.NOT_FOUND, b'Introuvable', 'text/plain')
            return
        body = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0]
        self._send(
            HTTPStatus.OK,
            body,
            content_type or 'application/octet-stream',
        )

    def do_POST(self) -> None:
        if self.path != '/decisions':
            self._send(HTTPStatus.NOT_FOUND, b'Introuvable', 'text/plain')
            return
        length = int(self.headers.get('Content-Length', '0'))
        if length > 100_000:
            self._send(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                b'Requete trop grande',
                'text/plain',
            )
            return
        form = urllib.parse.parse_qs(
            self.rfile.read(length).decode('utf-8'),
            keep_blank_values=True,
        )
        if form.get('csrf', [''])[0] != self.server.csrf_token:
            self._send(HTTPStatus.FORBIDDEN, b'Jeton invalide', 'text/plain')
            return
        identifiers = [
            value for value in form.get('entry_ids', [''])[0].split(',') if value
        ]
        approved = form.get('approved', [])
        approver = form.get('approver', [''])[0]
        try:
            decisions = self.server.queue.apply_review_decisions(
                identifiers,
                approved,
                approver=approver,
            )
        except QueueError as error:
            self._send(
                HTTPStatus.CONFLICT,
                f'Le lot n’a pas été écrit : {error}'.encode('utf-8'),
                'text/plain; charset=utf-8',
            )
            return
        self.server.completed = True
        approved_count = sum(value == 'approuvé' for value in decisions.values())
        body = (
            '<!doctype html><meta charset="utf-8">'
            '<body style="font-family:system-ui;padding:4rem">'
            '<h1>Lot enregistré</h1>'
            f'<p>{approved_count} approuvée(s), '
            f'{len(decisions) - approved_count} rejetée(s).</p>'
            '<p>Vous pouvez fermer cet onglet.</p></body>'
        ).encode('utf-8')
        self._send(HTTPStatus.OK, body, 'text/html; charset=utf-8')


def serve_review(
    queue: PublicationQueue,
    assets: list[ReviewAsset],
    *,
    approver: str,
    open_browser: bool,
    port: int,
) -> None:
    csrf_token = secrets.token_urlsafe(32)
    server = ReviewServer(('127.0.0.1', port), ReviewHandler)
    server.queue = queue
    server.assets = {asset.entry.id: asset for asset in assets}
    server.csrf_token = csrf_token
    server.html = render_html(
        assets,
        csrf_token=csrf_token,
        approver=approver,
    )
    server.completed = False
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'Planche locale : {url}')
    if open_browser:
        webbrowser.open(url)
    try:
        while not server.completed:
            server.handle_request()
    finally:
        server.server_close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=DEFAULT_DATABASE)
    parser.add_argument('--journal', type=Path, default=DEFAULT_AUDIT_LOG)
    parser.add_argument('--approbateur', default='Patrice')
    parser.add_argument('--taille', type=int, default=10)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--sans-ouvrir', action='store_true')
    parser.add_argument(
        '--html-seul',
        type=Path,
        help="écrit un instantané non interactif au lieu d'ouvrir le serveur",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.taille <= 50:
        parser.error('--taille doit être comprise entre 1 et 50')
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    queue = PublicationQueue(args.base, args.journal)
    entries = queue.list(['à_valider'], limit=args.taille)
    if not entries:
        print('Aucune vidéo à valider.')
        return 0
    with tempfile.TemporaryDirectory(prefix='revue-publication-') as temporary:
        assets = prepare_assets(entries, Path(temporary))
        if args.html_seul:
            html = render_html(
                assets,
                csrf_token='APERÇU_NON_INTERACTIF',
                approver=args.approbateur,
            )
            args.html_seul.write_text(html, encoding='utf-8')
            print(args.html_seul.resolve())
            return 0
        serve_review(
            queue,
            assets,
            approver=args.approbateur,
            open_browser=not args.sans_ouvrir,
            port=args.port,
        )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
