#!/usr/bin/env python3
"""Collecte des preuves visuelles réelles pour les Shorts de Lisa.

Deux modes :

  python3 collect-evidence.py URL --category official
  python3 collect-evidence.py --sujet "Claude Opus 5"

Le navigateur ne publie rien et ne contourne aucun accès. Chaque collecte
produit un PNG de la fenêtre, un recadrage 1080x960 compatible avec la moitié
haute de ``wrap-short.py --layout split`` et un manifeste ``.meta.json``.
"""

from __future__ import annotations

import argparse
import base64
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
import hashlib
from html import unescape
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from editorial_policy import find_excluded_topic


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = Path('~/Documents/preuves-lisa').expanduser()
DEFAULT_CATALOGUE = Path('~/.codebuddy/veille/CATALOGUE-OUTILS.md').expanduser()
DEFAULT_SUBJECTS = Path(
    '~/.codebuddy/influencer-work/sujets-du-jour.md'
).expanduser()
DEFAULT_INVENTORY = Path(
    '~/.codebuddy/veille/inventaire-vision-ia.json'
).expanduser()
SOURCES_PATH = SCRIPT_DIR / 'sources.json'
PARIS = ZoneInfo('Europe/Paris')
FULL_WIDTH = 1200
FULL_HEIGHT = 850


def split_dimensions(wrap_path: Path = SCRIPT_DIR / 'wrap-short.py') -> tuple[int, int]:
    """Lit la taille de panneau réellement utilisée par wrap-short.py.

    Le filtre split applique la même paire ``scale=L:H`` au visage et au
    B-roll avant ``vstack``. La paire la plus répétée est donc la zone haute,
    sans dupliquer ici une valeur susceptible de diverger.
    """
    source = wrap_path.read_text(encoding='utf-8')
    dimensions = Counter(
        (int(width), int(height))
        for width, height in re.findall(r'scale=(\d+):(\d+)', source)
    )
    if not dimensions:
        raise RuntimeError(
            f'dimensions du layout split introuvables dans {wrap_path}'
        )
    return dimensions.most_common(1)[0][0]


SPLIT_WIDTH, SPLIT_HEIGHT = split_dimensions()
USER_AGENT = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 '
    'CodeBuddyEvidenceCollector/1.0'
)
LEGAL_RULES = {
    # « Libre » signifie ici libre pour une capture de couverture éditoriale,
    # et non libre de droits ou placé sous une licence de republication.
    'official': (
        'Libre pour couverture éditoriale : page officielle, source citée ; '
        "pas de republication intégrale."
    ),
    'press': (
        'Citation partielle uniquement, attribution visible obligatoire ; '
        "article entier et contournement de paywall interdits."
    ),
    'own': (
        'Production propre de Patrice : test ou enregistrement d’écran maison.'
    ),
    'thirdparty': (
        "Extrait tiers : crédit insuffisant juridiquement, accord explicite "
        "du titulaire obligatoire et journalisé."
    ),
    'agency': (
        "Interdit : image ou média d’agence de presse soumis à licence."
    ),
}
AGENCY_MARKERS = (
    'afpforum.com',
    'afp.com',
    'reutersconnect.com',
    'reutersagency.com',
    'gettyimages.',
    'media.gettyimages.com',
    'apimages.com',
    'newsroom.ap.org',
    'shutterstock.',
)
COOKIE_SCRIPT = r"""
(() => {
  const styleId = 'codebuddy-evidence-cookie-hider';
  const selectors = [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk',
    '.onetrust-pc-dark-filter', '.qc-cmp2-container',
    '#didomi-host', '.didomi-popup-container',
    '#CybotCookiebotDialog', '#cookie-law-info-bar',
    '[id*="cookie-banner" i]', '[class*="cookie-banner" i]',
    '[id*="cookie-consent" i]', '[class*="cookie-consent" i]',
    '[id*="cookie-notice" i]', '[class*="cookie-notice" i]',
    '[id*="consent-banner" i]', '[class*="consent-banner" i]',
    '[aria-label*="cookie" i][role="dialog"]',
    '[aria-label*="consent" i][role="dialog"]'
  ];
  const installStyle = () => {
    if (!document.documentElement || document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = selectors.join(',') +
      '{display:none!important;visibility:hidden!important;opacity:0!important;}';
    document.documentElement.appendChild(style);
  };
  const hide = () => {
    installStyle();
    let hidden = 0;
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        node.style.setProperty('display', 'none', 'important');
        node.setAttribute('data-codebuddy-cookie-hidden', '1');
        hidden += 1;
      }
    }
    for (const node of document.querySelectorAll(
      '[role="dialog"], [class*="modal" i], [class*="overlay" i]'
    )) {
      const text = (node.innerText || '').slice(0, 800);
      const rect = node.getBoundingClientRect();
      const css = getComputedStyle(node);
      if (/cookie|cookies|consentement|privacy choices|vie privée/i.test(text)
          && rect.width > 250 && rect.height > 80
          && (css.position === 'fixed' || css.position === 'sticky')) {
        node.style.setProperty('display', 'none', 'important');
        node.setAttribute('data-codebuddy-cookie-hidden', '1');
        hidden += 1;
      }
    }
    for (const node of document.body?.querySelectorAll('*') || []) {
      const css = getComputedStyle(node);
      if (css.position !== 'fixed' && css.position !== 'sticky') continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 250 || rect.height < 50) continue;
      const text = (node.innerText || '').slice(0, 1200);
      if (/uses cookies|utilise des cookies|cookie settings|paramètres des cookies|accepter les cookies|privacy choices|choix de confidentialité/i.test(text)) {
        node.style.setProperty('display', 'none', 'important');
        node.setAttribute('data-codebuddy-cookie-hidden', '1');
        hidden += 1;
      }
    }
    if (document.body) {
      document.body.style.setProperty('overflow', 'auto', 'important');
      document.body.style.setProperty('position', 'static', 'important');
    }
    document.documentElement.style.setProperty('overflow', 'auto', 'important');
    window.__codebuddyCookieHidden =
      (window.__codebuddyCookieHidden || 0) + hidden;
    return hidden;
  };
  installStyle();
  const observer = new MutationObserver(() => hide());
  observer.observe(document.documentElement || document, {
    childList: true, subtree: true
  });
  document.addEventListener('DOMContentLoaded', hide);
  window.addEventListener('load', hide);
  window.__codebuddyHideCookies = hide;
  hide();
})();
"""


class EvidenceError(RuntimeError):
    """Erreur attendue et présentable à l'opérateur."""


@dataclass(frozen=True)
class Candidate:
    url: str
    category: str
    score: float
    actor: str = ''
    reason: str = ''


@dataclass(frozen=True)
class BrowserCapture:
    png_path: Path
    title: str
    final_url: str
    cookies_hidden: int


def normalise(value: str) -> str:
    decomposed = unicodedata.normalize('NFKD', unescape(value))
    plain = ''.join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', plain.lower()).split())


def slugify(value: str, limit: int = 60) -> str:
    slug = normalise(value).replace(' ', '-').strip('-')
    return slug[:limit].rstrip('-') or 'preuve'


def canonical_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme not in ('http', 'https', 'file'):
        return value.strip()
    host = parsed.netloc.lower().removeprefix('www.')
    path = re.sub(r'/+$', '', parsed.path) or '/'
    return urllib.parse.urlunsplit(
        (parsed.scheme.lower(), host, path, parsed.query, '')
    )


def url_domain(value: str) -> str:
    return urllib.parse.urlsplit(value).netloc.lower().removeprefix('www.')


def source_label(value: str) -> str:
    if value.startswith('file:') or '://' not in value:
        return Path(urllib.parse.urlsplit(value).path or value).name
    return url_domain(value)


def is_hidden_path(path: Path, home: Path) -> bool:
    try:
        relative = path.expanduser().resolve().relative_to(home.resolve())
    except ValueError:
        return False
    return any(part.startswith('.') for part in relative.parts)


def is_snap_chromium(chromium: str) -> bool:
    return (
        chromium.startswith('/snap/')
        or chromium.startswith('/var/lib/snapd/snap/')
        or Path(chromium).parent.name == 'snap'
    )


def visible_staging_root(
    chromium: str,
    output_dir: Path,
    home: Path | None = None,
) -> Path:
    """Choisit un dossier que le Chromium snap peut effectivement utiliser."""
    home = (home or Path.home()).resolve()
    output_dir = output_dir.expanduser().resolve()
    confined = is_snap_chromium(chromium)
    forbidden_for_snap = (
        output_dir == Path('/tmp')
        or Path('/tmp') in output_dir.parents
        or is_hidden_path(output_dir, home)
        or home not in (output_dir, *output_dir.parents)
    )
    if confined and forbidden_for_snap:
        return home / 'Documents' / 'codebuddy-preuves-chromium'
    if confined:
        # Un nom visible évite aussi les profils .chromium ou .cache.
        return home / 'Documents' / 'codebuddy-preuves-chromium'
    return output_dir / 'travail-chromium'


def find_chromium(explicit: str | None = None) -> str:
    candidates = (
        [explicit]
        if explicit
        else ['chromium', 'chromium-browser', 'google-chrome', 'brave-browser']
    )
    for candidate in candidates:
        executable = shutil.which(candidate) if candidate else None
        if executable:
            # Ne pas resolve() : /snap/bin/chromium est un lien vers
            # /usr/bin/snap. Lancer la cible détruirait le nom d'application
            # utilisé par le wrapper snap et ferait interpréter --headless
            # comme une option de la commande `snap`.
            return executable
    raise EvidenceError(
        'Chromium introuvable ; installe chromium ou utilise --chromium.'
    )


def load_registry(path: Path = SOURCES_PATH) -> dict:
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise EvidenceError(f'référentiel de sources illisible : {error}') from error
    if not isinstance(value.get('sources'), list):
        raise EvidenceError('référentiel de sources invalide : sources absent')
    return value


def registry_category(url: str, registry: dict) -> tuple[str | None, str]:
    domain = url_domain(url)
    if not domain:
        return None, ''
    best: tuple[str | None, str, int] = (None, '', -1)
    for source in registry['sources']:
        source_domains = [
            url_domain(str(source.get('url', ''))),
            *(str(value).lower().removeprefix('www.')
              for value in source.get('domains', [])),
        ]
        for source_domain in source_domains:
            if source_domain and (
                domain == source_domain or domain.endswith('.' + source_domain)
            ):
                if len(source_domain) > best[2]:
                    best = (
                        str(source.get('categorie', 'press')),
                        str(source.get('acteur', '')),
                        len(source_domain),
                    )
    return best[0], best[1]


def has_agency_marker(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in AGENCY_MARKERS)


def validate_legal_category(
    category: str,
    source: str,
    consent: str | None,
) -> None:
    if category == 'agency' or has_agency_marker(source):
        raise EvidenceError(LEGAL_RULES['agency'])
    if category == 'thirdparty' and not (consent or '').strip():
        raise EvidenceError(
            'Refus contenu tiers : --consent-obtenu '
            '"nom, date et canal de l’accord" est obligatoire.'
        )


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    temporary.replace(path)


def journal(path: Path, event: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'at': datetime.now(PARIS).isoformat(timespec='seconds'),
        **event,
    }
    with path.open('a', encoding='utf-8') as output:
        output.write(json.dumps(payload, ensure_ascii=False) + '\n')


class CDP:
    """Client WebSocket Chrome DevTools minimal, sans dépendance Python."""

    def __init__(self, websocket_url: str):
        parsed = urllib.parse.urlsplit(websocket_url)
        self.socket = socket.create_connection(
            (parsed.hostname or '127.0.0.1', parsed.port or 80),
            timeout=10,
        )
        self.socket.settimeout(30)
        key = base64.b64encode(os.urandom(16)).decode('ascii')
        request = (
            f'GET {parsed.path} HTTP/1.1\r\n'
            f'Host: {parsed.hostname}:{parsed.port}\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            f'Sec-WebSocket-Key: {key}\r\n'
            'Sec-WebSocket-Version: 13\r\n\r\n'
        )
        self.socket.sendall(request.encode('ascii'))
        response = b''
        while b'\r\n\r\n' not in response:
            response += self.socket.recv(4096)
        if b' 101 ' not in response.split(b'\r\n', 1)[0]:
            raise EvidenceError('connexion DevTools refusée par Chromium')
        self.identifier = 0

    def close(self) -> None:
        self.socket.close()

    def _read_exact(self, size: int) -> bytes:
        result = b''
        while len(result) < size:
            chunk = self.socket.recv(size - len(result))
            if not chunk:
                raise EvidenceError('connexion DevTools interrompue')
            result += chunk
        return result

    def _send_frame(self, payload: bytes, opcode: int = 1) -> None:
        header = bytearray([0x80 | opcode])
        size = len(payload)
        if size < 126:
            header.append(0x80 | size)
        elif size < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack('>H', size))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack('>Q', size))
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytes(
            byte ^ mask[index % 4] for index, byte in enumerate(payload)
        )
        self.socket.sendall(bytes(header) + masked)

    def _receive_frame(self) -> tuple[int, bytes]:
        first, second = self._read_exact(2)
        opcode = first & 0x0F
        size = second & 0x7F
        if size == 126:
            size = struct.unpack('>H', self._read_exact(2))[0]
        elif size == 127:
            size = struct.unpack('>Q', self._read_exact(8))[0]
        mask = self._read_exact(4) if second & 0x80 else b''
        payload = self._read_exact(size)
        if mask:
            payload = bytes(
                byte ^ mask[index % 4] for index, byte in enumerate(payload)
            )
        return opcode, payload

    def command(
        self,
        method: str,
        params: dict | None = None,
        timeout: float = 30,
    ) -> dict:
        self.identifier += 1
        identifier = self.identifier
        self._send_frame(
            json.dumps(
                {'id': identifier, 'method': method, 'params': params or {}}
            ).encode('utf-8')
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            opcode, payload = self._receive_frame()
            if opcode == 8:
                raise EvidenceError('Chromium a fermé la page')
            if opcode == 9:
                self._send_frame(payload, opcode=10)
                continue
            if opcode != 1:
                continue
            message = json.loads(payload.decode('utf-8'))
            if message.get('id') != identifier:
                continue
            if 'error' in message:
                raise EvidenceError(
                    f'DevTools {method} : {message["error"].get("message")}'
                )
            return message.get('result', {})
        raise EvidenceError(f'délai DevTools dépassé pour {method}')

    def evaluate(self, expression: str) -> object:
        result = self.command(
            'Runtime.evaluate',
            {
                'expression': expression,
                'returnByValue': True,
                'awaitPromise': True,
            },
        )
        remote = result.get('result', {})
        if remote.get('subtype') == 'error':
            raise EvidenceError(f'JavaScript de capture en échec : {remote}')
        return remote.get('value')


def free_tcp_port() -> int:
    with socket.socket() as temporary:
        temporary.bind(('127.0.0.1', 0))
        return int(temporary.getsockname()[1])


def wait_devtools(port: int, process: subprocess.Popen, timeout: float = 15) -> dict:
    endpoint = f'http://127.0.0.1:{port}/json/list'
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ''
            raise EvidenceError(
                f'Chromium s’est arrêté ({process.returncode}) : '
                f'{stderr[-500:]}'
            )
        try:
            with urllib.request.urlopen(endpoint, timeout=1) as response:
                pages = json.load(response)
            page = next(
                item for item in pages if item.get('type') == 'page'
            )
            return page
        except (
            OSError,
            StopIteration,
            urllib.error.URLError,
            json.JSONDecodeError,
        ) as error:
            last_error = error
            time.sleep(0.2)
    raise EvidenceError(f'DevTools Chromium injoignable : {last_error}')


def capture_web_page(
    url: str,
    chromium: str,
    staging_root: Path,
    wait_seconds: float,
) -> BrowserCapture:
    staging_root.mkdir(parents=True, exist_ok=True)
    session_dir = Path(
        tempfile.mkdtemp(prefix='session-', dir=str(staging_root))
    )
    profile_dir = session_dir / 'profil-chromium'
    screenshot = session_dir / 'capture.png'
    port = free_tcp_port()
    command = [
        chromium,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        f'--window-size={FULL_WIDTH},{FULL_HEIGHT}',
        f'--remote-debugging-port={port}',
        f'--user-data-dir={profile_dir}',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-features=Translate,MediaRouter',
        f'--user-agent={USER_AGENT}',
        'about:blank',
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    cdp: CDP | None = None
    completed = False
    try:
        page = wait_devtools(port, process)
        cdp = CDP(str(page['webSocketDebuggerUrl']))
        cdp.command('Page.enable')
        cdp.command('Runtime.enable')
        cdp.command(
            'Emulation.setDeviceMetricsOverride',
            {
                'width': FULL_WIDTH,
                'height': FULL_HEIGHT,
                'deviceScaleFactor': 1,
                'mobile': False,
            },
        )
        cdp.command(
            'Page.addScriptToEvaluateOnNewDocument',
            {'source': COOKIE_SCRIPT},
        )
        cdp.command('Page.navigate', {'url': url})
        deadline = time.monotonic() + max(10.0, wait_seconds + 5)
        while time.monotonic() < deadline:
            ready = cdp.evaluate('document.readyState')
            if ready in ('interactive', 'complete'):
                break
            time.sleep(0.25)
        time.sleep(wait_seconds)
        info = cdp.evaluate(
            """(() => {
              if (window.__codebuddyHideCookies) {
                window.__codebuddyHideCookies();
              }
              const visible = element => {
                const r = element.getBoundingClientRect();
                const s = getComputedStyle(element);
                return r.width > 20 && r.height > 20 &&
                  r.bottom > 0 && r.top < innerHeight &&
                  s.display !== 'none' && s.visibility !== 'hidden';
              };
              const agency = [...document.images]
                .filter(visible)
                .map(img => [img.currentSrc, img.alt,
                  img.closest('figure')?.innerText || ''].join(' '))
                .filter(value =>
                  /afp|reuters|associated press|ap images|getty|shutterstock/i
                    .test(value)
                ).slice(0, 5);
              const paywall = [...document.querySelectorAll(
                '[class*="paywall" i], [id*="paywall" i], ' +
                '[class*="subscription-wall" i]'
              )].filter(visible).map(node =>
                (node.innerText || '').slice(0, 160)
              );
              return {
                title: document.title || '',
                url: location.href,
                text: (document.body?.innerText || '').slice(0, 500),
                cookiesHidden: window.__codebuddyCookieHidden || 0,
                agency,
                paywall
              };
            })()"""
        )
        if not isinstance(info, dict):
            raise EvidenceError('la page n’a pas fourni ses informations')
        final_url = str(info.get('url', url))
        if final_url.startswith(('chrome-error://', 'about:neterror')):
            raise EvidenceError(f'source injoignable : {url}')
        body_text = str(info.get('text', ''))
        if re.search(
            r'ce site est inaccessible|this site can.t be reached|'
            r'dns_probe_finished|err_name_not_resolved',
            body_text,
            re.IGNORECASE,
        ):
            raise EvidenceError(f'source injoignable : {url}')
        if (
            not body_text.strip()
            and not str(info.get('title', '')).strip()
        ):
            raise EvidenceError(f'page vide ou inaccessible : {url}')
        if info.get('paywall'):
            raise EvidenceError(
                'paywall détecté : aucune capture ni tentative de contournement'
            )
        agency = info.get('agency') or []
        if agency:
            raise EvidenceError(
                'média d’agence visible détecté, capture refusée : '
                + str(agency[0])[:180]
            )
        if has_agency_marker(final_url):
            raise EvidenceError(LEGAL_RULES['agency'])
        captured = cdp.command(
            'Page.captureScreenshot',
            {
                'format': 'png',
                'fromSurface': True,
                'captureBeyondViewport': False,
            },
        )
        screenshot.write_bytes(base64.b64decode(captured['data']))
        completed = True
        return BrowserCapture(
            png_path=screenshot,
            title=str(info.get('title', '')).strip() or source_label(final_url),
            final_url=final_url,
            cookies_hidden=int(info.get('cookiesHidden', 0)),
        )
    finally:
        if cdp is not None:
            cdp.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        # En cas de succès, collect_one déplace/normalise le PNG puis supprime
        # la session. En cas d'échec, ne jamais laisser traîner le profil.
        if not completed:
            shutil.rmtree(session_dir, ignore_errors=True)


def open_image(path: Path):
    try:
        from PIL import Image
    except ImportError as error:
        raise EvidenceError(
            'Pillow est requis pour normaliser et recadrer les PNG.'
        ) from error
    try:
        return Image.open(path)
    except OSError as error:
        raise EvidenceError(f'image illisible : {path} ({error})') from error


def normalise_full_and_crop(
    source: Path,
    full: Path,
    split: Path,
) -> tuple[int, int]:
    full.parent.mkdir(parents=True, exist_ok=True)
    with open_image(source) as image:
        rgb = image.convert('RGB')
        rgb.save(full, format='PNG', optimize=True)
        source_width, source_height = rgb.size
        target_ratio = SPLIT_WIDTH / SPLIT_HEIGHT
        source_ratio = source_width / source_height
        if source_ratio > target_ratio:
            crop_width = round(source_height * target_ratio)
            left = (source_width - crop_width) // 2
            box = (left, 0, left + crop_width, source_height)
        else:
            crop_height = round(source_width / target_ratio)
            top = (source_height - crop_height) // 2
            box = (0, top, source_width, top + crop_height)
        try:
            from PIL import Image
            resampling = Image.Resampling.LANCZOS
        except (ImportError, AttributeError):
            resampling = 1
        cropped = rgb.crop(box).resize(
            (SPLIT_WIDTH, SPLIT_HEIGHT),
            resampling,
        )
        cropped.save(split, format='PNG', optimize=True)
        return source_width, source_height


def local_media_to_png(source: Path, target: Path, instant: float) -> str:
    source = source.expanduser().resolve()
    if not source.is_file():
        raise EvidenceError(f'fichier maison introuvable : {source}')
    if source.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.bmp'):
        with open_image(source) as image:
            image.convert('RGB').save(target, format='PNG', optimize=True)
        return source.stem
    result = subprocess.run(
        [
            'ffmpeg',
            '-v',
            'error',
            '-ss',
            str(max(0.0, instant)),
            '-i',
            str(source),
            '-frames:v',
            '1',
            '-y',
            str(target),
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode or not target.exists():
        raise EvidenceError(
            f'extraction de l’enregistrement impossible : {result.stderr[-300:]}'
        )
    return source.stem


def cache_key(source: str, captured_on: str) -> str:
    raw = f'{canonical_url(source)}\n{captured_on}'.encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def load_cache(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def cached_result(entry: dict | None) -> dict | None:
    if not entry:
        return None
    files = entry.get('files', {})
    if all(Path(value).exists() for value in files.values()):
        return entry
    return None


def attribution_for(source: str, category: str, captured_at: datetime) -> str:
    date = captured_at.strftime('%d/%m/%Y')
    if category == 'own':
        return f'source : capture Patrice — {date}'
    return f'source : {source_label(source)} — {date}'


def collect_one(
    source: str,
    category: str,
    output_dir: Path,
    cache_path: Path,
    log_path: Path,
    chromium: str | None,
    wait_seconds: float,
    consent: str | None = None,
    instant: float = 0.0,
    actor: str = '',
) -> dict:
    validate_legal_category(category, source, consent)
    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(PARIS)
    captured_on = now.date().isoformat()
    key = cache_key(source, captured_on)
    cache = load_cache(cache_path)
    existing = cached_result(cache.get(key))
    if existing:
        journal(
            log_path,
            {'event': 'cache', 'source': source, 'category': category},
        )
        print(f'CACHE : {source}', file=sys.stderr)
        return existing

    temporary_source: Path | None = None
    browser_capture: BrowserCapture | None = None
    if category == 'own' and (
        source.startswith('file:') or Path(source).expanduser().exists()
    ):
        temporary_dir = Path(
            tempfile.mkdtemp(prefix='preuve-maison-', dir=str(output_dir))
        )
        temporary_source = temporary_dir / 'capture.png'
        local_path = Path(
            urllib.parse.unquote(urllib.parse.urlsplit(source).path)
            if source.startswith('file:')
            else source
        )
        try:
            title = local_media_to_png(local_path, temporary_source, instant)
        except Exception:
            shutil.rmtree(temporary_dir, ignore_errors=True)
            raise
        final_url = local_path.expanduser().resolve().as_uri()
        cookies_hidden = 0
    else:
        if not source.startswith(('http://', 'https://')):
            raise EvidenceError(
                'une URL http(s) est requise hors capture maison locale'
            )
        chromium = find_chromium(chromium)
        staging = visible_staging_root(chromium, output_dir)
        browser_capture = capture_web_page(
            source,
            chromium,
            staging,
            wait_seconds,
        )
        temporary_source = browser_capture.png_path
        title = browser_capture.title
        final_url = browser_capture.final_url
        cookies_hidden = browser_capture.cookies_hidden
        final_category, final_actor = registry_category(
            final_url,
            load_registry(),
        )
        if category == 'press' and final_category == 'official':
            category = 'official'
            actor = actor or final_actor

    digest = hashlib.sha256(canonical_url(source).encode('utf-8')).hexdigest()[:8]
    stem = f'{slugify(title)}-{digest}'
    full = output_dir / f'{stem}-full.png'
    split = output_dir / f'{stem}-split-{SPLIT_WIDTH}x{SPLIT_HEIGHT}.png'
    metadata_path = output_dir / f'{stem}.meta.json'
    try:
        full_dimensions = normalise_full_and_crop(
            temporary_source,
            full,
            split,
        )
    finally:
        if browser_capture:
            shutil.rmtree(browser_capture.png_path.parent, ignore_errors=True)
        elif temporary_source:
            shutil.rmtree(temporary_source.parent, ignore_errors=True)

    attribution = attribution_for(final_url, category, now)
    metadata = {
        'source_url': source,
        'canonical_url': canonical_url(source),
        'final_url': final_url,
        'title': title,
        'captured_at': now.isoformat(timespec='seconds'),
        'captured_on': captured_on,
        'legal_category': category,
        'legal_status': LEGAL_RULES[category],
        'actor': actor or None,
        'attribution': attribution,
        'consent_obtenu': consent if category == 'thirdparty' else None,
        'cookie_elements_hidden': cookies_hidden,
        'dimensions': {
            'full_viewport': {
                'width': full_dimensions[0],
                'height': full_dimensions[1],
            },
            'split_top': {'width': SPLIT_WIDTH, 'height': SPLIT_HEIGHT},
        },
        'files': {
            'full': str(full),
            'split': str(split),
            'metadata': str(metadata_path),
        },
    }
    atomic_json(metadata_path, metadata)
    cache[key] = metadata
    atomic_json(cache_path, cache)
    journal(
        log_path,
        {
            'event': 'captured',
            'source': source,
            'final_url': final_url,
            'category': category,
            'consent_obtenu': consent if category == 'thirdparty' else None,
            'files': metadata['files'],
        },
    )
    print(f'OK : {full}', file=sys.stderr)
    print(f'     {split}', file=sys.stderr)
    print(f'     {attribution}', file=sys.stderr)
    return metadata


URL_PATTERN = re.compile(r'https?://[^\s<>()\]"}]+')
STOP_WORDS = {
    'avec', 'dans', 'des', 'est', 'les', 'pour', 'que', 'qui', 'sur',
    'une', 'vient', 'sortie', 'nouveau', 'nouvelle', 'outil', 'modele', 'ia',
}


def subject_tokens(subject: str) -> set[str]:
    return {
        token
        for token in normalise(subject).split()
        if (len(token) >= 3 or token.isdigit()) and token not in STOP_WORDS
    }


def text_relevance(subject: str, text: str) -> float:
    tokens = subject_tokens(subject)
    haystack = set(normalise(text).split())
    if not tokens:
        return 0
    overlap = len(tokens & haystack)
    phrase_bonus = 4 if normalise(subject) in normalise(text) else 0
    return overlap * 10 + phrase_bonus


def markdown_candidates(
    subject: str,
    path: Path,
    registry: dict,
    base_score: float,
) -> list[Candidate]:
    if not path.exists():
        return []
    results = []
    minimum_relevance = min(2, len(subject_tokens(subject))) * 10
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        relevance = text_relevance(subject, line)
        if relevance < minimum_relevance:
            continue
        for raw_url in URL_PATTERN.findall(line):
            url = raw_url.rstrip('.,;')
            if url_domain(url) in (
                'youtube.com',
                'youtu.be',
                'x.com',
                'twitter.com',
            ):
                continue
            category, actor = registry_category(url, registry)
            category = category or 'press'
            results.append(
                Candidate(
                    url=url,
                    category=category,
                    score=base_score + relevance + (
                        5 if category == 'official' else 0
                    ),
                    actor=actor,
                    reason=path.name,
                )
            )
    return results


def inventory_candidates(
    subject: str,
    path: Path,
    registry: dict,
) -> list[Candidate]:
    if not path.exists():
        return []
    try:
        raw = path.read_text(encoding='utf-8', errors='replace')
        value = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return []
    results = []
    minimum_relevance = min(2, len(subject_tokens(subject))) * 10
    stack = [value]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
        elif isinstance(current, str):
            for line in current.splitlines():
                relevance = text_relevance(subject, line)
                if relevance < minimum_relevance:
                    continue
                for raw_url in URL_PATTERN.findall(line):
                    url = raw_url.rstrip('\\",.;')
                    domain = url_domain(url)
                    if domain in (
                        'youtube.com',
                        'youtu.be',
                        'x.com',
                        'twitter.com',
                    ):
                        continue
                    category, actor = registry_category(url, registry)
                    results.append(
                        Candidate(
                            url=url,
                            category=category or 'press',
                            score=35 + relevance,
                            actor=actor,
                            reason='veille-youtube.py',
                        )
                    )
    return results


def actor_candidates(subject: str, registry: dict) -> list[Candidate]:
    normalised_subject = f' {normalise(subject)} '
    results = []
    for source in registry['sources']:
        names = [source.get('acteur', ''), *source.get('aliases', [])]
        matches = [
            name for name in names
            if normalise(str(name))
            and f' {normalise(str(name))} ' in normalised_subject
        ]
        if not matches:
            continue
        category = str(source.get('categorie', 'press'))
        results.append(
            Candidate(
                url=str(source['url']),
                category=category,
                score=60 + max(len(normalise(str(name))) for name in matches),
                actor=str(source.get('acteur', '')),
                reason='sources.json',
            )
        )
    return results


def load_find_subjects_module():
    path = SCRIPT_DIR / 'find-subjects.py'
    source = path.read_text(encoding='utf-8')
    if 'def google_news_url(' not in source or 'def parse_feed(' not in source:
        raise EvidenceError(
            'find-subjects.py ne fournit pas encore son API RSS réutilisable'
        )
    spec = importlib.util.spec_from_file_location(
        'collect_evidence_find_subjects',
        path,
    )
    if not spec or not spec.loader:
        raise EvidenceError('find-subjects.py ne peut pas être chargé')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def live_news_candidates(
    subject: str,
    registry: dict,
    days: int,
) -> list[Candidate]:
    """Réutilise le collecteur RSS de find-subjects.py, sans appel LLM."""
    module = load_find_subjects_module()
    query = urllib.parse.quote_plus(subject)
    url = module.google_news_url(query, days)
    feed = module.GOOGLE_NEWS_FEED
    cutoff = datetime.now().astimezone().astimezone(
        ZoneInfo('UTC')
    ) - module.timedelta(days=days)
    fresh, _ = module.parse_feed(
        module.fetch_xml(url),
        feed,
        cutoff,
        theme='preuve-visuelle',
    )
    results = []
    minimum_relevance = min(2, len(subject_tokens(subject))) * 10
    for item in fresh:
        relevance = text_relevance(subject, str(item.get('title', '')))
        if relevance < minimum_relevance:
            continue
        candidate_url = str(item['url'])
        category, actor = registry_category(candidate_url, registry)
        results.append(
            Candidate(
                url=candidate_url,
                category=category or 'press',
                score=25 + relevance,
                actor=actor or str(item.get('publisher', '')),
                reason='find-subjects.py/Google News',
            )
        )
    return results


def discover_candidates(
    subject: str,
    registry: dict,
    days: int,
) -> list[Candidate]:
    candidates = actor_candidates(subject, registry)
    candidates.extend(
        markdown_candidates(subject, DEFAULT_CATALOGUE, registry, 55)
    )
    candidates.extend(
        markdown_candidates(subject, DEFAULT_SUBJECTS, registry, 45)
    )
    candidates.extend(
        inventory_candidates(subject, DEFAULT_INVENTORY, registry)
    )
    try:
        candidates.extend(live_news_candidates(subject, registry, days))
    except Exception as error:
        print(
            f'AVERTISSEMENT : recherche RSS du sujet indisponible ({error})',
            file=sys.stderr,
        )

    unique: dict[str, Candidate] = {}
    for candidate in candidates:
        if candidate.category in ('agency', 'thirdparty'):
            continue
        key = canonical_url(candidate.url)
        previous = unique.get(key)
        if previous is None or candidate.score > previous.score:
            unique[key] = candidate
    return sorted(
        unique.values(),
        key=lambda candidate: (
            candidate.score,
            candidate.category == 'official',
        ),
        reverse=True,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('source', nargs='?', help='URL ou fichier maison')
    group.add_argument('--sujet', help='sujet à documenter avec 3 à 5 preuves')
    parser.add_argument(
        '--category',
        '--categorie',
        choices=tuple(LEGAL_RULES),
        help='catégorie juridique (déduite de sources.json si possible)',
    )
    parser.add_argument(
        '--consent-obtenu',
        metavar='QUI_DATE_CANAL',
        help='titulaire, date et canal de son accord pour un contenu tiers',
    )
    parser.add_argument(
        '--output-dir',
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f'dossier de sortie (défaut : {DEFAULT_OUTPUT_DIR})',
    )
    parser.add_argument('--chromium', help='exécutable Chromium/Chrome')
    parser.add_argument(
        '--attente',
        type=float,
        default=4.0,
        help='secondes laissées à la page avant capture (défaut : 4)',
    )
    parser.add_argument(
        '--delai',
        type=float,
        default=2.0,
        help='délai entre deux sources du lot (défaut : 2 s)',
    )
    parser.add_argument(
        '--days',
        type=int,
        default=7,
        help='fenêtre Google News du mode sujet (défaut : 7 jours)',
    )
    parser.add_argument(
        '--max-preuves',
        type=int,
        choices=(3, 4, 5),
        default=5,
        help='maximum de preuves en mode sujet (défaut : 5)',
    )
    parser.add_argument(
        '--instant',
        type=float,
        default=0.0,
        help='instant extrait d’un enregistrement maison, en secondes',
    )
    args = parser.parse_args(argv)
    if args.attente < 0 or args.delai < 0 or args.days < 1:
        parser.error('--attente/--delai doivent être positifs et --days >= 1')
    if args.source and not args.category:
        registry = load_registry()
        inferred, _ = registry_category(args.source, registry)
        if Path(args.source).expanduser().exists():
            inferred = 'own'
        if not inferred:
            parser.error(
                '--category est obligatoire pour une source absente de sources.json'
            )
        args.category = inferred
    return args


def run(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    registry = load_registry()
    base_output = args.output_dir.expanduser().resolve()
    cache_path = base_output / 'cache-index.json'
    log_path = base_output / 'collect-evidence.log.jsonl'

    if args.source:
        try:
            category, actor = registry_category(args.source, registry)
            collect_one(
                source=args.source,
                category=args.category or category or 'press',
                output_dir=base_output,
                cache_path=cache_path,
                log_path=log_path,
                chromium=args.chromium,
                wait_seconds=args.attente,
                consent=args.consent_obtenu,
                instant=args.instant,
                actor=actor,
            )
            return 0
        except Exception as error:
            journal(
                log_path,
                {
                    'event': 'failed',
                    'source': args.source,
                    'category': args.category,
                    'error': str(error),
                },
            )
            print(f'ERREUR : {error}', file=sys.stderr)
            return 1

    subject = str(args.sujet)
    excluded = find_excluded_topic(subject)
    if excluded:
        reason, keyword = excluded
        print(
            f'REFUS ÉDITORIAL : {reason} (mot-clé {keyword!r})',
            file=sys.stderr,
        )
        return 2
    dated_output = (
        base_output
        / f'{datetime.now(PARIS).date().isoformat()}-{slugify(subject, 50)}'
    )
    candidates = discover_candidates(subject, registry, args.days)
    if not candidates:
        print('Aucune source pertinente trouvée pour ce sujet.', file=sys.stderr)
        return 1
    print(
        f'{len(candidates)} source(s) candidate(s), '
        f'objectif {args.max_preuves} preuve(s).',
        file=sys.stderr,
    )
    successes = 0
    for index, candidate in enumerate(candidates):
        if successes >= args.max_preuves:
            break
        if index:
            time.sleep(args.delai)
        try:
            collect_one(
                source=candidate.url,
                category=candidate.category,
                output_dir=dated_output,
                cache_path=cache_path,
                log_path=log_path,
                chromium=args.chromium,
                wait_seconds=args.attente,
                actor=candidate.actor,
            )
            successes += 1
        except Exception as error:
            journal(
                log_path,
                {
                    'event': 'failed',
                    'subject': subject,
                    'source': candidate.url,
                    'category': candidate.category,
                    'reason': candidate.reason,
                    'error': str(error),
                },
            )
            print(
                f'AVERTISSEMENT : {candidate.url} ignorée ({error})',
                file=sys.stderr,
            )
    if successes:
        label = 'LOT TERMINÉ' if successes >= 3 else 'LOT PARTIEL'
        print(
            f'{label} : {successes} preuve(s) dans {dated_output}',
            file=sys.stderr,
        )
        return 0
    print('LOT SANS CAPTURE : toutes les sources ont échoué.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(run())
