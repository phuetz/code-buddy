#!/usr/bin/env python3
"""Veille YouTube IA gratuite pour Code Buddy, les médias et la recherche.

Le collecteur lit les flux RSS publics des chaînes, télécharge uniquement les
sous-titres automatiques avec yt-dlp, puis confie leur analyse à Gemini via
``agy``. Aucune API YouTube ni API LLM payante n'est utilisée.

Sorties par défaut :
  ~/.codebuddy/veille/VEILLE-IA.md
  ~/.codebuddy/veille/A-TESTER.md
  ~/.codebuddy/veille/index.json
  ~/.codebuddy/veille/journal.jsonl

La configuration facultative ``~/.codebuddy/veille-chaines.yml`` remplace la
liste intégrée. Voir ``veille-chaines.example.yml``.
"""

from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import fcntl
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


DEFAULT_CONFIG = Path('~/.codebuddy/veille-chaines.yml').expanduser()
DEFAULT_WORKDIR = Path('~/.codebuddy/veille').expanduser()
DEFAULT_MODEL = 'gemini-3.6-flash-low'
DEFAULT_DAYS = 14
DEFAULT_MAX_VIDEOS = 2
MAX_TRANSCRIPT_CHARS = 120_000
USER_AGENT = 'CodeBuddy-YouTube-Watch/1.0 (+local RSS reader)'
CHANNEL_ID = re.compile(r'^UC[A-Za-z0-9_-]{20,30}$')
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
TIMING_LINE = re.compile(
    r'^\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+'
    r'\d{2}:\d{2}(?::\d{2})?[.,]\d{3}'
)
INLINE_TIMESTAMP = re.compile(r'<\d{2}:\d{2}(?::\d{2})?[.,]\d{3}>')
TAG = re.compile(r'<[^>]+>')
JSON_FENCE = re.compile(r'^```(?:json)?\s*|\s*```$', re.IGNORECASE)

MEDICAL_NOTICE = (
    "Cette veille ne donne aucun avis médical. Les sorties d'IA sur la "
    'littérature biomédicale doivent être vérifiées par des professionnels. '
    "Toute donnée de santé exige un cadre légal adapté (RGPD, accords d'accès "
    'et interdiction de ré-identification).'
)


@dataclass(frozen=True)
class Channel:
    name: str
    channel_id: str
    language: str
    focus: str
    enabled: bool = True


@dataclass(frozen=True)
class Video:
    video_id: str
    channel_name: str
    channel_id: str
    title: str
    published: str
    url: str
    description: str = ''


# Ordre éditorial intentionnel : Vision IA doit rester la première source.
DEFAULT_CHANNELS = (
    Channel(
        'Vision IA',
        'UCyc03X3uRuxM9n7fyRH_gIw',
        'fr',
        'actualité IA, outils, science et biomédical',
    ),
    Channel(
        'Ludo Salenne',
        'UCnnYqSNKKygemgmxC9PyLTw',
        'fr',
        'outils IA concrets, automatisation et actualité',
    ),
    Channel(
        'Defend Intelligence',
        'UCnEHCrot2HkySxMTmDPhZyg',
        'fr',
        'vulgarisation technique IA et machine learning',
    ),
    Channel(
        'Matt Wolfe',
        'UChpleBmo18P08aKCIgti38g',
        'en',
        'revue hebdomadaire des outils et actualités IA',
    ),
    Channel(
        'Matthew Berman',
        'UCawZsQWqfGSbCI5yjkdVkTA',
        'en',
        'LLM ouverts, agents, code et benchmarks',
    ),
    Channel(
        'AI Explained',
        'UCNJ1Ymd5yFuUPtn21xtRbbw',
        'en',
        'modèles, articles et analyse des annonces IA',
    ),
    Channel(
        'MattVidPro',
        'UC5Wz4fFacYuON6IKbhSa7Zw',
        'en',
        'génération vidéo et image, modèles créatifs',
    ),
    Channel(
        'Theoretically Media',
        'UC9Ryt3XOGYBoAJVsBHNGDzA',
        'en',
        'outils vidéo, image, voix et production média',
    ),
    Channel(
        'Two Minute Papers',
        'UCbfYPyITQ-7l4upoX8nvctg',
        'en',
        'articles de recherche IA, vision et sciences',
    ),
)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    os.replace(temporary, path)


def journal(path: Path, event: str, **values: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as handle:
        handle.write(
            json.dumps(
                {'at': now_iso(), 'event': event, **values},
                ensure_ascii=False,
            )
            + '\n'
        )


def default_state() -> dict[str, Any]:
    return {
        'version': 1,
        'created_at': now_iso(),
        'seen_videos': {},
        'items': {},
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return default_state()
    value = json.loads(path.read_text(encoding='utf-8'))
    if value.get('version') != 1:
        raise ValueError(
            f"version d'index inconnue : {value.get('version')!r}"
        )
    value.setdefault('seen_videos', {})
    value.setdefault('items', {})
    return value


def scalar(value: str) -> Any:
    value = value.strip()
    if (
        len(value) >= 2
        and value[0] == value[-1]
        and value[0] in {'"', "'"}
    ):
        return value[1:-1]
    if value.lower() in {'true', 'yes', 'oui'}:
        return True
    if value.lower() in {'false', 'no', 'non'}:
        return False
    return value


def parse_simple_yaml(text: str) -> dict[str, Any]:
    """Parse le sous-ensemble YAML utilisé par le fichier de chaînes.

    Le repli garde le timer autonome avec le Python système, même sans PyYAML.
    """
    result: dict[str, Any] = {'channels': []}
    current: dict[str, Any] | None = None
    in_channels = False
    for number, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.split('#', 1)[0].rstrip()
        if not line.strip():
            continue
        stripped = line.strip()
        if stripped == 'channels:':
            in_channels = True
            continue
        if not in_channels:
            if ':' not in stripped:
                raise ValueError(f'YAML invalide ligne {number}')
            key, value = stripped.split(':', 1)
            result[key.strip()] = scalar(value)
            continue
        if stripped.startswith('- '):
            current = {}
            result['channels'].append(current)
            remainder = stripped[2:].strip()
            if remainder:
                if ':' not in remainder:
                    raise ValueError(f'YAML invalide ligne {number}')
                key, value = remainder.split(':', 1)
                current[key.strip()] = scalar(value)
            continue
        if current is None or ':' not in stripped:
            raise ValueError(f'YAML invalide ligne {number}')
        key, value = stripped.split(':', 1)
        current[key.strip()] = scalar(value)
    return result


def load_yaml(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding='utf-8')
    try:
        import yaml  # type: ignore[import-not-found]

        value = yaml.safe_load(text)
    except ImportError:
        value = parse_simple_yaml(text)
    if not isinstance(value, dict):
        raise ValueError('la configuration YAML doit être un objet')
    return value


def configured_channels(path: Path) -> tuple[Channel, ...]:
    if not path.exists():
        return DEFAULT_CHANNELS
    raw = load_yaml(path)
    values = raw.get('channels')
    if not isinstance(values, list) or not values:
        raise ValueError('channels doit être une liste YAML non vide')
    channels = []
    for index, value in enumerate(values, 1):
        if not isinstance(value, dict):
            raise ValueError(f'channels[{index}] doit être un objet')
        channel = Channel(
            name=str(value.get('name', '')).strip(),
            channel_id=str(value.get('channel_id', '')).strip(),
            language=str(value.get('language', '')).strip() or 'fr',
            focus=str(value.get('focus', '')).strip() or 'actualité IA',
            enabled=bool(value.get('enabled', True)),
        )
        if not channel.name or not CHANNEL_ID.fullmatch(channel.channel_id):
            raise ValueError(
                f'chaîne invalide à la position {index}: '
                f'{channel.name!r}, {channel.channel_id!r}'
            )
        channels.append(channel)
    if len({channel.channel_id for channel in channels}) != len(channels):
        raise ValueError('la configuration contient des channel_id dupliqués')
    return tuple(channels)


def fetch_bytes(url: str, attempts: int = 3) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            'Accept': 'application/atom+xml, application/xml, text/xml, */*',
            'User-Agent': USER_AGENT,
        },
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except (OSError, urllib.error.URLError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    assert last_error is not None
    raise last_error


def node_text(node: ET.Element, local_name: str) -> str:
    for child in node.iter():
        if child.tag.rsplit('}', 1)[-1] == local_name:
            return (child.text or '').strip()
    return ''


def parse_feed(xml: bytes, channel: Channel) -> list[Video]:
    root = ET.fromstring(xml)
    videos = []
    for entry in root:
        if entry.tag.rsplit('}', 1)[-1] != 'entry':
            continue
        video_id = node_text(entry, 'videoId')
        if not VIDEO_ID.fullmatch(video_id):
            continue
        videos.append(
            Video(
                video_id=video_id,
                channel_name=channel.name,
                channel_id=channel.channel_id,
                title=node_text(entry, 'title') or video_id,
                published=node_text(entry, 'published'),
                url=f'https://www.youtube.com/watch?v={video_id}',
                description=node_text(entry, 'description'),
            )
        )
    return videos


def fetch_channel_videos(channel: Channel) -> list[Video]:
    url = (
        'https://www.youtube.com/feeds/videos.xml?channel_id='
        + channel.channel_id
    )
    return parse_feed(fetch_bytes(url), channel)


def parse_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def yt_dlp_base() -> list[str]:
    executable = shutil.which('yt-dlp')
    if not executable:
        raise RuntimeError('yt-dlp est introuvable dans PATH')
    return [
        executable,
        '--extractor-args',
        'youtube:player_client=web_embedded',
        '--no-playlist',
        '--skip-download',
        '--ignore-no-formats-error',
        '--no-warnings',
    ]


def add_auth_options(command: list[str], args: argparse.Namespace) -> None:
    if args.cookies:
        command.extend(['--cookies', str(args.cookies)])
    elif args.cookies_from_browser:
        command.extend(
            ['--cookies-from-browser', args.cookies_from_browser]
        )


def targeted_video(
    video_id: str,
    channels: tuple[Channel, ...],
    args: argparse.Namespace,
) -> Video:
    command = [
        *yt_dlp_base(),
        '--dump-single-json',
        f'https://www.youtube.com/watch?v={video_id}',
    ]
    add_auth_options(command, args)
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            f'métadonnées yt-dlp indisponibles pour {video_id}: '
            f'{result.stderr.strip()[-500:]}'
        )
    metadata = json.loads(result.stdout)
    channel_id = str(metadata.get('channel_id', '')).strip()
    known = next(
        (channel for channel in channels if channel.channel_id == channel_id),
        None,
    )
    upload_date = str(metadata.get('upload_date', '')).strip()
    published = ''
    if re.fullmatch(r'\d{8}', upload_date):
        published = (
            f'{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}T00:00:00Z'
        )
    return Video(
        video_id=video_id,
        channel_name=known.name if known else str(metadata.get('channel', 'YouTube')),
        channel_id=channel_id,
        title=str(metadata.get('title', video_id)),
        published=published,
        url=f'https://www.youtube.com/watch?v={video_id}',
        description=str(metadata.get('description', '')),
    )


def clean_vtt(text: str) -> str:
    """Supprime le balisage VTT et les répétitions glissantes de YouTube."""
    output: list[str] = []
    recent: deque[str] = deque(maxlen=24)
    in_metadata_block = False
    for raw_line in text.replace('\r\n', '\n').splitlines():
        line = raw_line.strip()
        if line.startswith(('STYLE', 'REGION', 'NOTE')):
            in_metadata_block = True
            continue
        if in_metadata_block:
            if not line:
                in_metadata_block = False
            continue
        if (
            not line
            or line == 'WEBVTT'
            or line.startswith(('Kind:', 'Language:'))
            or TIMING_LINE.match(line)
            or line.isdigit()
        ):
            continue
        line = INLINE_TIMESTAMP.sub('', line)
        line = TAG.sub('', line)
        line = html.unescape(line).replace('\u200b', '').replace('\xa0', ' ')
        line = re.sub(r'\s+', ' ', line).strip()
        if not line:
            continue
        normalized = unicodedata.normalize('NFKC', line).casefold()
        if normalized in recent:
            continue
        output.append(line)
        recent.append(normalized)
    return '\n'.join(output).strip() + '\n'


def download_transcript(
    video: Video,
    args: argparse.Namespace,
) -> tuple[str, str]:
    with tempfile.TemporaryDirectory(prefix='codebuddy-veille-') as directory:
        root = Path(directory)
        template = str(root / '%(id)s.%(ext)s')

        def download(languages: str) -> subprocess.CompletedProcess[str]:
            command = [
                *yt_dlp_base(),
                '--write-auto-subs',
                '--write-subs',
                '--sub-langs',
                languages,
                '--sub-format',
                'vtt',
                '--output',
                template,
                video.url,
            ]
            add_auth_options(command, args)
            return subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=240,
                check=False,
            )

        result = download('fr-orig,en-orig')
        files = sorted(root.glob(f'{video.video_id}.*.vtt'))
        if not files:
            result = download('fr,en')
            files = sorted(root.glob(f'{video.video_id}.*.vtt'))
        if not files:
            detail = (result.stderr or result.stdout).strip()[-700:]
            raise RuntimeError(
                f'aucun transcript fr/en pour {video.video_id}: {detail}'
            )
        preferred = sorted(
            files,
            key=lambda path: (
                '-orig.' not in path.name,
                '.fr' not in path.name,
                path.name,
            ),
        )[0]
        transcript = clean_vtt(preferred.read_text(encoding='utf-8'))
        if len(transcript) < 80:
            raise RuntimeError(
                f'transcript trop court pour {video.video_id} '
                f'({len(transcript)} caractères)'
            )
        language = preferred.name.split('.')[-2]
        return transcript[:MAX_TRANSCRIPT_CHARS], language


def analysis_prompt(video: Video, transcript: str) -> str:
    return f"""Tu analyses factuellement le transcript automatique d'une vidéo YouTube de veille IA.
Ne complète PAS avec ta mémoire et n'invente aucun produit. Corrige seulement les
erreurs de transcription évidentes quand le contexte donne un nom identifiable.
Une mention publicitaire sans nouveauté technique n'est pas une nouveauté.

VIDÉO: {video.title}
CHAÎNE: {video.channel_name}
DATE: {video.published or 'inconnue'}
URL: {video.url}

DESCRIPTION / CHAPITRES (indice prioritaire pour les noms propres) :
{video.description[:16_000]}

Pour chaque outil, modèle, article, jeu de données, méthode ou nouveauté
réellement mentionné, rends un objet. Utilise le nom officiel le plus probable
dans "name" et une famille stable dans "family" pour dédupliquer les versions
(exemples : "Wan 2.2 Bernini", "LongCat-Video", "PaperQA").

Évalue quatre axes indépendants de 0 à 10 :
1. code_buddy : LLM, embeddings, RAG, agents, MCP, vision, voix, code.
2. media : génération vidéo/image, avatar, lipsync, montage, voix, création.
3. lisa : potentiel de sujet concret pour une vidéo de Lisa.
4. biomedical : génomique, variants ADN, protéines, découverte/repositionnement
   de médicaments, neurodégénérescence/Parkinson (alpha-synucléine, LRRK2,
   GBA, SNCA, dopamine), analyse de littérature/PaperQA, cohortes ou données
   ouvertes (GP2, AMP-PD, PPMI, Fox Insight).

"a_tester" vaut true uniquement pour code_buddy, media ou biomedical si la
piste est assez concrète et accessible pour une expérimentation. Une annonce
non vérifiée ou un produit fermé sans accès testable vaut false. Reste prudent
en biomédical : aucun avis médical, résultats à valider professionnellement,
données de santé sous RGPD et accords d'accès.

Réponds UNIQUEMENT avec un objet JSON strict, sans markdown :
{{
  "items": [
    {{
      "name": "nom",
      "family": "famille stable",
      "kind": "outil|modèle|recherche|jeu de données|méthode|annonce",
      "description": "ce que c'est et ce que cela fait",
      "use_cases": ["usage concret"],
      "evidence": "court extrait ou paraphrase strictement ancrée au transcript",
      "code_buddy": {{"score": 0, "justification": "...", "a_tester": false}},
      "media": {{"score": 0, "justification": "...", "a_tester": false}},
      "lisa": {{"score": 0, "justification": "..."}},
      "biomedical": {{"score": 0, "justification": "...", "a_tester": false}}
    }}
  ]
}}

TRANSCRIPT :
{transcript}
"""


def extract_json(text: str) -> dict[str, Any]:
    candidate = JSON_FENCE.sub('', text.strip()).strip()
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError as initial_error:
        # Gemini ajoute occasionnellement une virgule avant ``}`` ou ``]``.
        # Cette réparation bornée ne complète ni ne réécrit le fond.
        repaired = re.sub(r',\s*([}\]])', r'\1', candidate)
        try:
            value = json.loads(repaired)
        except json.JSONDecodeError:
            start = repaired.find('{')
            if start < 0:
                raise ValueError(
                    "la réponse LLM ne contient pas d'objet JSON"
                ) from initial_error
            decoder = json.JSONDecoder()
            value, _ = decoder.raw_decode(repaired[start:])
    if not isinstance(value, dict):
        raise ValueError('la réponse LLM JSON doit être un objet')
    return value


def analyze_with_gemini(
    video: Video,
    transcript: str,
    model: str,
) -> dict[str, Any]:
    if not model.startswith('gemini-'):
        raise ValueError(
            'seuls les modèles Gemini gratuits via agy sont autorisés'
        )
    executable = shutil.which('agy')
    if not executable:
        raise RuntimeError('agy est introuvable dans PATH')

    def invoke(prompt: str) -> str:
        result = subprocess.run(
            [
                executable,
                '-p',
                prompt,
                '--model',
                model,
                '--effort',
                'low',
                '--print-timeout',
                '10m',
            ],
            capture_output=True,
            text=True,
            timeout=660,
            check=False,
        )
        if result.returncode:
            raise RuntimeError(
                f'agy/Gemini a échoué ({result.returncode}): '
                f'{result.stderr.strip()[-700:]}'
            )
        return result.stdout

    raw = invoke(analysis_prompt(video, transcript))
    try:
        return extract_json(raw)
    except (json.JSONDecodeError, ValueError) as initial_error:
        repaired = invoke(
            'Répare uniquement la syntaxe du JSON ci-dessous. Ne change, '
            "n'ajoute et ne supprime aucune information. Réponds uniquement "
            'avec le JSON strict valide, sans markdown.\n\n'
            + raw
        )
        try:
            return extract_json(repaired)
        except (json.JSONDecodeError, ValueError) as repair_error:
            raise ValueError(
                f'JSON Gemini invalide après une réparation gratuite : '
                f'{repair_error}'
            ) from initial_error


def score(value: Any) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        result = 0
    return max(0, min(10, result))


def axis(value: Any, *, testable: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    result = {
        'score': score(value.get('score')),
        'justification': str(value.get('justification', '')).strip()
        or 'Aucune justification fournie.',
    }
    if testable:
        result['a_tester'] = bool(value.get('a_tester', False))
    return result


def normalize_key(value: str) -> str:
    value = unicodedata.normalize('NFKD', value)
    value = ''.join(character for character in value if not unicodedata.combining(character))
    return re.sub(r'[^a-z0-9]+', '-', value.casefold()).strip('-')


def validate_analysis(value: dict[str, Any]) -> list[dict[str, Any]]:
    raw_items = value.get('items', [])
    if not isinstance(raw_items, list):
        raise ValueError('items doit être un tableau JSON')
    items = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get('name', '')).strip()
        family = str(raw.get('family', '')).strip() or name
        description = str(raw.get('description', '')).strip()
        key = normalize_key(family)
        if not name or not key or not description:
            continue
        use_cases = raw.get('use_cases', [])
        if not isinstance(use_cases, list):
            use_cases = [str(use_cases)]
        items.append(
            {
                'key': key,
                'name': name,
                'family': family,
                'kind': str(raw.get('kind', 'nouveauté')).strip(),
                'description': description,
                'use_cases': [
                    str(use_case).strip()
                    for use_case in use_cases
                    if str(use_case).strip()
                ],
                'evidence': str(raw.get('evidence', '')).strip(),
                'code_buddy': axis(raw.get('code_buddy'), testable=True),
                'media': axis(raw.get('media'), testable=True),
                'lisa': axis(raw.get('lisa'), testable=False),
                'biomedical': axis(raw.get('biomedical'), testable=True),
            }
        )
    return items


def merge_items(
    state: dict[str, Any],
    video: Video,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    new_items = []
    source = {
        'video_id': video.video_id,
        'title': video.title,
        'channel': video.channel_name,
        'published': video.published,
        'url': video.url,
    }
    for item in items:
        key = item['key']
        existing = state['items'].get(key)
        if existing:
            existing['last_seen'] = now_iso()
            existing['occurrences'] = int(existing.get('occurrences', 1)) + 1
            if not any(
                value.get('video_id') == video.video_id
                for value in existing.get('sources', [])
            ):
                existing.setdefault('sources', []).append(source)
            continue
        stored = {
            **item,
            'first_seen': now_iso(),
            'last_seen': now_iso(),
            'occurrences': 1,
            'sources': [source],
        }
        state['items'][key] = stored
        new_items.append(stored)
    return new_items


def format_axis(label: str, value: dict[str, Any]) -> str:
    marker = ' — **à tester**' if value.get('a_tester') else ''
    return (
        f'- {label} : **{value["score"]}/10**{marker} — '
        f'{value["justification"]}'
    )


def report_header() -> str:
    return (
        '# Veille IA — chaînes YouTube\n\n'
        'Rapport cumulatif dédupliqué. Une nouveauté déjà connue est comptée '
        "dans l'index mais n'est pas re-signalée ici.\n\n"
        f'> Prudence biomédicale — {MEDICAL_NOTICE}\n\n'
    )


def report_block(
    video: Video,
    new_items: list[dict[str, Any]],
    total_items: int,
    transcript_language: str,
) -> str:
    timestamp = datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z')
    lines = [
        f'## {timestamp} — {video.channel_name}',
        '',
        f'### [{video.title}]({video.url})',
        '',
        f'- Publication : {video.published or "date inconnue"}',
        f'- Transcript automatique : `{transcript_language}`',
        f'- Nouveautés extraites : {total_items} ; inédites : {len(new_items)}',
        '',
    ]
    if not new_items:
        lines.extend(
            [
                'Aucune nouveauté inédite à re-signaler après déduplication.',
                '',
            ]
        )
        return '\n'.join(lines)
    lines.extend(['### Nouveautés inédites', ''])
    for item in new_items:
        uses = (
            '; '.join(item['use_cases'])
            if item['use_cases']
            else 'usage à préciser'
        )
        lines.extend(
            [
                f'#### {item["name"]} — {item["kind"]}',
                '',
                item['description'],
                '',
                f'- Usages : {uses}',
                f'- Ancrage transcript : {item["evidence"] or "mention explicite"}',
                format_axis('Code Buddy', item['code_buddy']),
                format_axis('Pipeline vidéo/média', item['media']),
                format_axis('Sujet Lisa', item['lisa']),
                format_axis('Biomédical / recherche', item['biomedical']),
                '',
            ]
        )
    biomedical = [
        item for item in new_items if item['biomedical']['score'] >= 4
    ]
    lines.extend(['### Signal biomédical / recherche', ''])
    if biomedical:
        for item in biomedical:
            lines.append(
                f'- **{item["name"]}** ({item["biomedical"]["score"]}/10) — '
                f'{item["biomedical"]["justification"]}'
            )
    else:
        lines.append('- Aucun signal biomédical notable dans cette vidéo.')
    lines.extend(['', f'> {MEDICAL_NOTICE}', ''])
    return '\n'.join(lines)


def append_report(path: Path, block: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(report_header(), encoding='utf-8')
    with path.open('a', encoding='utf-8') as handle:
        handle.write(block.rstrip() + '\n\n')


def report_contains_video(path: Path, video_id: str) -> bool:
    if not path.exists():
        return False
    return video_id in path.read_text(encoding='utf-8')


def test_priority(item: dict[str, Any], axis_name: str) -> int:
    value = item.get(axis_name, {})
    return int(value.get('score', 0))


def queue_section(
    title: str,
    label: str,
    items: list[dict[str, Any]],
    axis_name: str,
) -> list[str]:
    lines = [f'## {title}', '']
    selected = [
        item for item in items if item.get(axis_name, {}).get('a_tester')
    ]
    selected.sort(
        key=lambda item: (
            -test_priority(item, axis_name),
            item['name'].casefold(),
        )
    )
    if not selected:
        return [*lines, '- Aucune piste classée à tester.', '']
    for item in selected:
        source = item['sources'][0]
        lines.extend(
            [
                f'### [ ] {item["name"]} — {label} '
                f'{item[axis_name]["score"]}/10',
                '',
                f'- Pourquoi : {item[axis_name]["justification"]}',
                f'- Fonction : {item["description"]}',
                f'- Premier signal : [{source["channel"]} — '
                f'{source["title"]}]({source["url"]})',
                f'- Tag : `{axis_name}`',
                '',
            ]
        )
    return lines


def write_test_queue(path: Path, state: dict[str, Any]) -> None:
    items = list(state['items'].values())
    lines = [
        '# A tester — veille IA',
        '',
        'File dédupliquée, triée par score décroissant dans chaque axe. '
        "Cocher une piste ne modifie pas l'index de veille.",
        '',
        f'> Prudence biomédicale — {MEDICAL_NOTICE}',
        '',
    ]
    lines.extend(
        queue_section('Code Buddy', 'Code Buddy', items, 'code_buddy')
    )
    lines.extend(
        queue_section(
            'Pipeline vidéo / média',
            'média',
            items,
            'media',
        )
    )
    lines.extend(
        queue_section(
            'Biomédical / recherche',
            'biomédical',
            items,
            'biomedical',
        )
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')
    os.replace(temporary, path)


def choose_videos(
    channels: tuple[Channel, ...],
    args: argparse.Namespace,
    state: dict[str, Any],
) -> list[Video]:
    if args.video_id:
        return [
            targeted_video(video_id, channels, args)
            for video_id in args.video_id
            if args.force or video_id not in state['seen_videos']
        ]
    threshold = datetime.now(timezone.utc) - timedelta(days=args.days)
    selected = []
    filter_value = (args.channel or '').casefold()
    for channel in channels:
        if not channel.enabled:
            continue
        if filter_value and filter_value not in {
            channel.name.casefold(),
            channel.channel_id.casefold(),
        }:
            continue
        unseen = []
        for video in fetch_channel_videos(channel):
            published = parse_date(video.published)
            if published and published < threshold:
                continue
            if video.video_id in state['seen_videos'] and not args.force:
                continue
            unseen.append(video)
        selected.extend(unseen[: args.max_videos])
    return selected


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--workdir', type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument('--days', type=int, default=DEFAULT_DAYS)
    parser.add_argument(
        '--max-videos',
        type=int,
        default=DEFAULT_MAX_VIDEOS,
        help='maximum de vidéos nouvelles par chaîne (défaut : 2)',
    )
    parser.add_argument(
        '--channel',
        help='limite la collecte à un nom ou channel_id exact',
    )
    parser.add_argument(
        '--video-id',
        action='append',
        default=[],
        help='analyse ciblée par ID YouTube, répétable et hors fenêtre RSS',
    )
    parser.add_argument(
        '--model',
        default=os.environ.get('VEILLE_YOUTUBE_MODEL', DEFAULT_MODEL),
    )
    parser.add_argument(
        '--cookies',
        type=Path,
        default=(
            Path(os.environ['VEILLE_YOUTUBE_COOKIES'])
            if os.environ.get('VEILLE_YOUTUBE_COOKIES')
            else None
        ),
    )
    parser.add_argument(
        '--cookies-from-browser',
        default=os.environ.get('VEILLE_YOUTUBE_COOKIES_FROM_BROWSER'),
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='retraite les vidéos déjà vues sans re-signaler les doublons',
    )
    parser.add_argument(
        '--list',
        action='store_true',
        help="liste les vidéos candidates sans transcript ni appel LLM",
    )
    args = parser.parse_args(argv)
    args.config = args.config.expanduser()
    args.workdir = args.workdir.expanduser()
    if args.cookies:
        args.cookies = args.cookies.expanduser()
    if args.days < 1 or args.max_videos < 1:
        parser.error('--days et --max-videos doivent être supérieurs à zéro')
    for video_id in args.video_id:
        if not VIDEO_ID.fullmatch(video_id):
            parser.error(f'ID YouTube invalide : {video_id!r}')
    if not args.model.startswith('gemini-'):
        parser.error('le modèle doit être un Gemini gratuit via agy')
    return args


def run(args: argparse.Namespace) -> int:
    channels = configured_channels(args.config)
    workdir = args.workdir
    workdir.mkdir(parents=True, exist_ok=True)
    state_path = workdir / 'index.json'
    journal_path = workdir / 'journal.jsonl'
    report_path = workdir / 'VEILLE-IA.md'
    queue_path = workdir / 'A-TESTER.md'
    lock_path = workdir / '.veille.lock'

    with lock_path.open('w', encoding='utf-8') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Une veille YouTube est déjà en cours.', file=sys.stderr)
            return 0
        state = load_state(state_path)
        videos = choose_videos(channels, args, state)
        if args.list:
            for video in videos:
                print(
                    f'{video.video_id}\t{video.published}\t'
                    f'{video.channel_name}\t{video.title}'
                )
            return 0
        if not videos:
            journal(journal_path, 'run_empty')
            print('Aucune nouvelle vidéo à analyser.')
            return 0

        failures = 0
        analyzed = 0
        for video in videos:
            print(
                f'[{video.channel_name}] {video.title} ({video.video_id})',
                flush=True,
            )
            journal(
                journal_path,
                'video_started',
                video_id=video.video_id,
                channel=video.channel_name,
                title=video.title,
            )
            try:
                transcript, language = download_transcript(video, args)
                analysis = analyze_with_gemini(
                    video,
                    transcript,
                    args.model,
                )
                items = validate_analysis(analysis)
                new_items = merge_items(state, video, items)
                if report_contains_video(report_path, video.video_id):
                    journal(
                        journal_path,
                        'report_skipped_existing_video',
                        video_id=video.video_id,
                    )
                else:
                    append_report(
                        report_path,
                        report_block(
                            video,
                            new_items,
                            len(items),
                            language,
                        ),
                    )
                state['seen_videos'][video.video_id] = {
                    'analyzed_at': now_iso(),
                    'channel': video.channel_name,
                    'title': video.title,
                    'published': video.published,
                    'url': video.url,
                    'transcript_language': language,
                    'item_keys': [item['key'] for item in items],
                }
                atomic_json(state_path, state)
                write_test_queue(queue_path, state)
                analyzed += 1
                journal(
                    journal_path,
                    'video_completed',
                    video_id=video.video_id,
                    extracted=len(items),
                    new=len(new_items),
                )
                print(
                    f'  -> {len(items)} nouveauté(s), '
                    f'{len(new_items)} inédite(s)',
                    flush=True,
                )
            except (
                json.JSONDecodeError,
                OSError,
                RuntimeError,
                subprocess.TimeoutExpired,
                ValueError,
            ) as error:
                failures += 1
                journal(
                    journal_path,
                    'video_failed',
                    video_id=video.video_id,
                    error=str(error),
                )
                print(
                    f'  ERREUR {video.video_id}: {error}',
                    file=sys.stderr,
                    flush=True,
                )
        journal(
            journal_path,
            'run_completed',
            analyzed=analyzed,
            failures=failures,
        )
        print(f'Rapport : {report_path}')
        print(f'File de tests : {queue_path}')
        return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    try:
        return run(parse_args(argv))
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Erreur: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
