#!/usr/bin/env python3
"""Veille YouTube IA gratuite pour Code Buddy, les médias et la recherche.

Le collecteur lit les flux RSS publics des chaînes ou l'inventaire historique
Vision IA, télécharge uniquement les sous-titres avec yt-dlp, puis confie leur
analyse à Gemini via ``agy`` ou à Ollama local. Aucune API YouTube ni API LLM
payante n'est utilisée.

Sorties par défaut :
  ~/.codebuddy/veille/VEILLE-IA.md
  ~/.codebuddy/veille/BASE-CONNAISSANCES-VISIONAI.md
  ~/.codebuddy/veille/CATALOGUE-OUTILS.md
  ~/.codebuddy/veille/A-TESTER.md
  ~/.codebuddy/veille/index.json
  ~/.codebuddy/veille/journal.jsonl

La configuration facultative ``~/.codebuddy/veille-chaines.yml`` remplace la
liste intégrée. Voir ``veille-chaines.example.yml``.
"""

from __future__ import annotations

import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
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
DEFAULT_OLLAMA_MODEL = 'qwen3:4b-instruct'
DEFAULT_DAYS = 14
DEFAULT_MAX_VIDEOS = 2
MAX_TRANSCRIPT_CHARS = 120_000
VISION_IA_CHANNEL_ID = 'UCyc03X3uRuxM9n7fyRH_gIw'
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
    duration: int | None = None
    view_count: int | None = None
    upload_date: str = ''


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
        duration=int(metadata['duration']) if metadata.get('duration') else None,
        view_count=(
            int(metadata['view_count'])
            if metadata.get('view_count') is not None
            else None
        ),
        upload_date=upload_date,
    )


def video_from_metadata(metadata: dict[str, Any]) -> Video | None:
    video_id = str(metadata.get('id', '')).strip()
    channel_id = str(metadata.get('channel_id', '')).strip()
    if not VIDEO_ID.fullmatch(video_id):
        return None
    upload_date = str(metadata.get('upload_date', '')).strip()
    published = ''
    timestamp = metadata.get('timestamp')
    if isinstance(timestamp, (int, float)):
        published = datetime.fromtimestamp(
            timestamp, tz=timezone.utc
        ).isoformat()
    elif re.fullmatch(r'\d{8}', upload_date):
        published = (
            f'{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}'
            'T00:00:00+00:00'
        )
    duration = metadata.get('duration')
    views = metadata.get('view_count')
    return Video(
        video_id=video_id,
        channel_name=str(metadata.get('channel', 'Vision IA')).strip()
        or 'Vision IA',
        channel_id=channel_id or VISION_IA_CHANNEL_ID,
        title=str(metadata.get('title', video_id)).strip() or video_id,
        published=published,
        url=f'https://www.youtube.com/watch?v={video_id}',
        description=str(metadata.get('description', '') or ''),
        duration=int(duration) if isinstance(duration, (int, float)) else None,
        view_count=int(views) if isinstance(views, (int, float)) else None,
        upload_date=upload_date,
    )


def inventory_record(video: Video) -> dict[str, Any]:
    return {
        'video_id': video.video_id,
        'channel_name': video.channel_name,
        'channel_id': video.channel_id,
        'title': video.title,
        'published': video.published,
        'upload_date': video.upload_date,
        'duration': video.duration,
        'view_count': video.view_count,
        'url': video.url,
        'description': video.description,
    }


def video_from_inventory(value: dict[str, Any]) -> Video | None:
    video_id = str(value.get('video_id', '')).strip()
    if not VIDEO_ID.fullmatch(video_id):
        return None
    duration = value.get('duration')
    views = value.get('view_count')
    return Video(
        video_id=video_id,
        channel_name=str(value.get('channel_name', 'Vision IA')),
        channel_id=str(value.get('channel_id', VISION_IA_CHANNEL_ID)),
        title=str(value.get('title', video_id)),
        published=str(value.get('published', '')),
        url=str(value.get('url', f'https://www.youtube.com/watch?v={video_id}')),
        description=str(value.get('description', '')),
        duration=int(duration) if isinstance(duration, (int, float)) else None,
        view_count=int(views) if isinstance(views, (int, float)) else None,
        upload_date=str(value.get('upload_date', '')),
    )


def load_inventory(path: Path) -> list[Video]:
    if not path.exists():
        return []
    value = json.loads(path.read_text(encoding='utf-8'))
    records = value.get('videos', []) if isinstance(value, dict) else []
    if not isinstance(records, list):
        raise ValueError("l'inventaire doit contenir un tableau videos")
    videos = [
        video
        for record in records
        if isinstance(record, dict)
        for video in [video_from_inventory(record)]
        if video is not None
    ]
    return videos


def write_inventory(path: Path, videos: list[Video]) -> None:
    ordered = sorted(
        {video.video_id: video for video in videos}.values(),
        key=lambda video: (video.published, video.video_id),
        reverse=True,
    )
    atomic_json(
        path,
        {
            'version': 1,
            'channel_id': VISION_IA_CHANNEL_ID,
            'channel_name': 'Vision IA',
            'uploads_playlist_id': f'UU{VISION_IA_CHANNEL_ID[2:]}',
            'updated_at': now_iso(),
            'count': len(ordered),
            'videos': [inventory_record(video) for video in ordered],
        },
    )


def import_inventory_jsonl(raw_path: Path, inventory_path: Path) -> list[Video]:
    videos = []
    for number, line in enumerate(
        raw_path.read_text(encoding='utf-8').splitlines(), 1
    ):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(
                f'JSONL inventaire invalide ligne {number}: {error}'
            ) from error
        if isinstance(value, dict):
            video = video_from_metadata(value)
            if video is not None:
                videos.append(video)
    if not videos:
        raise ValueError(f'aucune vidéo valide dans {raw_path}')
    write_inventory(inventory_path, videos)
    return videos


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
    transcript_dir = args.workdir / 'transcripts'
    transcript_dir.mkdir(parents=True, exist_ok=True)
    transcript_path = transcript_dir / f'{video.video_id}.txt'
    metadata_path = transcript_dir / f'{video.video_id}.json'
    if transcript_path.exists() and transcript_path.stat().st_size >= 80:
        language = 'cache'
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
                language = str(metadata.get('language', language))
            except (OSError, json.JSONDecodeError):
                pass
        return transcript_path.read_text(encoding='utf-8'), language

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
        temporary = transcript_path.with_suffix('.txt.tmp')
        temporary.write_text(transcript, encoding='utf-8')
        os.replace(temporary, transcript_path)
        atomic_json(
            metadata_path,
            {
                'video_id': video.video_id,
                'language': language,
                'source': preferred.name,
                'downloaded_at': now_iso(),
                'characters': len(transcript),
            },
        )
        return transcript, language


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
dans "name" et une famille assez précise dans "family" pour dédupliquer les
variantes orthographiques sans fusionner deux versions techniquement distinctes
(exemples : "Wan 2.2 Bernini", "LongCat-Video", "PaperQA"). "publisher" est
l'éditeur explicitement donné ou déductible sans ambiguïté du nom. "link" reste
vide si aucune URL n'est citée dans la description ou le transcript.

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
  "main_subject": "sujet principal en une phrase",
  "summary": "synthèse factuelle en 2 à 4 phrases",
  "editorial": {{
    "hook": "mécanique d'accroche observée",
    "structure": ["séquence 1", "séquence 2"],
    "cta": "appel à l'action ou vide",
    "format": "décryptage|récapitulatif hebdomadaire|tutoriel|autre"
  }},
  "items": [
    {{
      "name": "nom",
      "family": "famille stable",
      "publisher": "éditeur ou inconnu",
      "link": "URL citée ou chaîne vide",
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
{transcript[:MAX_TRANSCRIPT_CHARS]}
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


def analyze_with_ollama(
    video: Video,
    transcript: str,
    model: str,
) -> dict[str, Any]:
    endpoint = os.environ.get(
        'OLLAMA_HOST', 'http://127.0.0.1:11434'
    ).rstrip('/') + '/api/generate'
    payload = {
        'model': model,
        'prompt': analysis_prompt(video, transcript),
        'stream': False,
        'format': 'json',
        'keep_alive': '30m',
        'options': {
            'temperature': 0,
            'num_ctx': 65536,
            'num_predict': 8192,
        },
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=660) as response:
            envelope = json.loads(response.read().decode('utf-8'))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError(f'Ollama a échoué avec {model}: {error}') from error
    raw = str(envelope.get('response', '')).strip()
    if not raw:
        raise ValueError(f'Ollama {model} a renvoyé une réponse vide')
    return extract_json(raw)


def transcript_sample(transcript: str, budget: int = 3_000) -> str:
    if len(transcript) <= budget:
        return transcript
    third = budget // 3
    middle = len(transcript) // 2
    return '\n[...]\n'.join(
        [
            transcript[:third],
            transcript[middle - third // 2 : middle + third // 2],
            transcript[-third:],
        ]
    )


def compact_batch_prompt(
    batch: list[tuple[Video, str]],
) -> str:
    sources = []
    for video, transcript in batch:
        sources.append(
            {
                'id': video.video_id,
                'title': video.title,
                'date': video.published,
                'description': video.description[:1_500],
                'transcript_sample': transcript_sample(transcript),
            }
        )
    return """Analyse séparément chaque vidéo Vision IA. N'invente rien.
Pour chaque vidéo, donne le sujet, le format (D=décryptage, H=hebdo,
T=tutoriel, A=autre) et les outils/modèles/recherches/jeux de données/méthodes
techniques nommés dans l'extrait (12 maximum, versions distinctes). Chaque item
est [nom exact, éditeur ou "inconnu", fonction en 12 mots max, type].
Les titres des chapitres de la description sont des mentions valides. EXCLUS
Vision IA, sa formation, sa newsletter, YouTube et les appels à s'abonner.
JSON strict ULTRA COMPACT uniquement, aucune autre clé ni prose :
{"v":[{"id":"ID vidéo","s":"sujet","f":"D","i":[["nom","éditeur","fonction","type"]]}]}

VIDÉOS :
""" + json.dumps(sources, ensure_ascii=False)


def expand_compact_analysis(value: dict[str, Any]) -> dict[str, dict[str, Any]]:
    compact_videos = value.get('v', [])
    if isinstance(compact_videos, list) and compact_videos:
        expanded: dict[str, dict[str, Any]] = {}
        format_names = {
            'D': 'décryptage',
            'H': 'récapitulatif hebdomadaire',
            'T': 'tutoriel',
            'A': 'autre',
        }
        for raw_video in compact_videos:
            if isinstance(raw_video, dict):
                video_id = str(raw_video.get('id', ''))
                if not VIDEO_ID.fullmatch(video_id):
                    continue
                subject = str(
                    raw_video.get('s', raw_video.get('sujet', ''))
                )
                format_code = str(raw_video.get('f', 'A'))
                raw_items = raw_video.get('i', [])
                if not isinstance(raw_items, list):
                    raw_items = []
            elif isinstance(raw_video, list) and len(raw_video) >= 4:
                video_id = str(raw_video[0])
                if not VIDEO_ID.fullmatch(video_id):
                    continue
                subject = str(raw_video[1])
                format_code = str(raw_video[2])
                raw_items = (
                    raw_video[3] if isinstance(raw_video[3], list) else []
                )
            else:
                continue
            items = []
            for raw in raw_items:
                if not isinstance(raw, list) or len(raw) < 3:
                    continue
                name = str(raw[0]).strip()
                publisher = str(raw[1]).strip() or 'inconnu'
                description = str(raw[2]).strip()
                kind = str(raw[3]).strip() if len(raw) > 3 else 'nouveauté'
                if not name or not description:
                    continue
                axes = heuristic_axes(
                    f'{name} {publisher} {description} {kind}'
                )
                items.append(
                    {
                        'name': name,
                        'family': name,
                        'publisher': publisher,
                        'link': '',
                        'kind': kind,
                        'description': description,
                        'use_cases': [],
                        'evidence': f'Mention dans la vidéo {video_id}.',
                        **axes,
                    }
                )
            expanded[video_id] = {
                'main_subject': subject,
                'summary': subject,
                'editorial': {
                    'format': format_names.get(format_code, 'autre'),
                    'hook': '',
                    'structure': [],
                    'cta': '',
                },
                'items': items,
            }
        return expanded

    raw_videos = value.get('videos', [])
    if not isinstance(raw_videos, list):
        raise ValueError('la réponse batch doit contenir videos[]')
    expanded: dict[str, dict[str, Any]] = {}

    def compact_axis(raw: Any, *, testable: bool) -> dict[str, Any]:
        if not isinstance(raw, list):
            raw = []
        result = {
            'score': score(raw[0] if len(raw) > 0 else 0),
            'justification': str(
                raw[1] if len(raw) > 1 else 'Non précisé.'
            ),
        }
        if testable:
            result['a_tester'] = bool(raw[2] if len(raw) > 2 else False)
        return result

    for raw_video in raw_videos:
        if not isinstance(raw_video, dict):
            continue
        video_id = str(raw_video.get('id', ''))
        if not VIDEO_ID.fullmatch(video_id):
            continue
        raw_items = raw_video.get('items', [])
        items = []
        if isinstance(raw_items, list):
            for raw in raw_items:
                if not isinstance(raw, dict):
                    continue
                items.append(
                    {
                        'name': raw.get('name', ''),
                        'family': raw.get('family', raw.get('name', '')),
                        'publisher': raw.get('publisher', 'inconnu'),
                        'link': raw.get('link', ''),
                        'kind': raw.get('kind', 'nouveauté'),
                        'description': raw.get('description', ''),
                        'use_cases': [],
                        'evidence': raw.get('evidence', ''),
                        'code_buddy': compact_axis(
                            raw.get('cb'), testable=True
                        ),
                        'media': compact_axis(
                            raw.get('media'), testable=True
                        ),
                        'biomedical': compact_axis(
                            raw.get('bio'), testable=True
                        ),
                        'lisa': compact_axis(
                            raw.get('lisa'), testable=False
                        ),
                    }
                )
        expanded[video_id] = {
            'main_subject': str(raw_video.get('subject', '')),
            'summary': str(raw_video.get('summary', '')),
            'editorial': {
                'format': str(raw_video.get('format', 'autre')),
                'hook': str(raw_video.get('hook', '')),
                'structure': raw_video.get('structure', []),
                'cta': str(raw_video.get('cta', '')),
            },
            'items': items,
        }
    return expanded


def heuristic_axes(text: str) -> dict[str, Any]:
    normalized = unicodedata.normalize('NFKD', text).casefold()
    groups = {
        'code_buddy': (
            'llm', 'model', 'modèle', 'agent', 'code', 'mcp', 'rag',
            'embedding', 'reasoning', 'api', 'benchmark', 'voix', 'vision',
        ),
        'media': (
            'vidéo', 'video', 'image', 'avatar', 'lipsync', 'lip sync',
            'montage', 'voix', 'audio', 'génér', '3d', 'animation',
        ),
        'biomedical': (
            'bio', 'médic', 'protein', 'protéin', 'génom', 'genom',
            'adn', 'drug', 'médicament', 'parkinson', 'scientif',
            'recherche', 'donnée', 'dataset',
        ),
    }
    scores: dict[str, int] = {}
    for axis_name, words in groups.items():
        hits = sum(word in normalized for word in words)
        scores[axis_name] = min(10, 2 + hits * 2) if hits else 0
    lisa_score = min(
        10,
        5
        + (2 if max(scores.values(), default=0) >= 6 else 0)
        + (1 if any(word in normalized for word in ('nouveau', 'premier', 'gratuit', 'open')) else 0),
    )
    result: dict[str, Any] = {}
    labels = {
        'code_buddy': 'Intégration potentielle à évaluer pour Code Buddy.',
        'media': 'Usage potentiel à mesurer dans le pipeline média.',
        'biomedical': 'Signal de recherche à vérifier sur sources primaires.',
    }
    for axis_name, axis_score in scores.items():
        result[axis_name] = {
            'score': axis_score,
            'justification': labels[axis_name],
            'a_tester': axis_score >= 6,
        }
    result['lisa'] = {
        'score': lisa_score,
        'justification': 'Sujet explicable par une démonstration ou un décryptage.',
    }
    return result


def analyze_batch_with_ollama(
    batch: list[tuple[Video, str]],
    model: str,
) -> dict[str, dict[str, Any]]:
    endpoint = os.environ.get(
        'OLLAMA_HOST', 'http://127.0.0.1:11434'
    ).rstrip('/') + '/api/generate'
    payload = {
        'model': model,
        'prompt': compact_batch_prompt(batch),
        'stream': False,
        'format': 'json',
        'keep_alive': '30m',
        'options': {
            'temperature': 0,
            'num_ctx': 65536,
            'num_predict': 16384,
        },
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=1200) as response:
            envelope = json.loads(response.read().decode('utf-8'))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError(f'Ollama batch a échoué avec {model}: {error}') from error
    return expand_compact_analysis(
        extract_json(str(envelope.get('response', '')))
    )


def analyze_video(
    video: Video,
    transcript: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    if args.engine == 'agy':
        return analyze_with_gemini(video, transcript, args.model)
    if args.engine == 'ollama':
        return analyze_with_ollama(video, transcript, args.ollama_model)
    if shutil.which('agy'):
        try:
            return analyze_with_gemini(video, transcript, args.model)
        except (OSError, RuntimeError, subprocess.TimeoutExpired, ValueError):
            journal(
                args.workdir / 'journal.jsonl',
                'engine_fallback',
                video_id=video.video_id,
                source='agy',
                target='ollama',
            )
    return analyze_with_ollama(video, transcript, args.ollama_model)


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
    items_by_key: dict[str, dict[str, Any]] = {}
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get('name', '')).strip()
        family = str(raw.get('family', '')).strip() or name
        description = str(raw.get('description', '')).strip()
        publisher = str(raw.get('publisher', 'inconnu')).strip() or 'inconnu'
        key = normalize_key(family)
        if (
            not name
            or not key
            or not description
            or is_promotional_item(name, publisher)
        ):
            continue
        use_cases = raw.get('use_cases', [])
        if not isinstance(use_cases, list):
            use_cases = [str(use_cases)]
        candidate = {
            'key': key,
            'name': name,
            'family': family,
            'publisher': publisher,
            'link': str(raw.get('link', '')).strip(),
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
        existing = items_by_key.get(key)
        if existing is None:
            items_by_key[key] = candidate
            continue
        for axis_name in ('code_buddy', 'media', 'lisa', 'biomedical'):
            if candidate[axis_name]['score'] > existing[axis_name]['score']:
                existing[axis_name] = candidate[axis_name]
        existing['use_cases'] = list(
            dict.fromkeys([*existing['use_cases'], *candidate['use_cases']])
        )
    return list(items_by_key.values())


def is_promotional_item(name: str, publisher: str) -> bool:
    normalized = f'{name} {publisher}'.casefold()
    return (
        'vision ia' in normalized
        and any(
            word in normalized
            for word in ('formation', 'programme', 'newsletter', 'communauté')
        )
    )


def validate_editorial(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    structure = value.get('structure', [])
    if not isinstance(structure, list):
        structure = [str(structure)]
    return {
        'hook': str(value.get('hook', '')).strip(),
        'structure': [
            str(part).strip() for part in structure if str(part).strip()
        ],
        'cta': str(value.get('cta', '')).strip(),
        'format': str(value.get('format', 'autre')).strip() or 'autre',
    }


def normalized_analysis(
    value: dict[str, Any],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        'main_subject': str(value.get('main_subject', '')).strip(),
        'summary': str(value.get('summary', '')).strip(),
        'editorial': validate_editorial(value.get('editorial')),
        'items': items,
    }


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
            is_new_source = not any(
                value.get('video_id') == video.video_id
                for value in existing.get('sources', [])
            )
            if is_new_source:
                existing.setdefault('sources', []).append(source)
                existing['occurrences'] = int(
                    existing.get('occurrences', 1)
                ) + 1
            if (
                str(existing.get('publisher', 'inconnu')) == 'inconnu'
                and item.get('publisher')
            ):
                existing['publisher'] = item['publisher']
            if not existing.get('link') and item.get('link'):
                existing['link'] = item['link']
            for axis_name in (
                'code_buddy',
                'media',
                'lisa',
                'biomedical',
            ):
                current_axis = existing.get(axis_name, {})
                if (
                    item[axis_name]['score']
                    > int(current_axis.get('score', 0))
                ):
                    existing[axis_name] = item[axis_name]
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
    items = [
        item
        for item in state['items'].values()
        if (
            catalogue_status(item)[0] == 'à tester'
            and not is_promotional_item(
                str(item.get('name', '')),
                str(item.get('publisher', '')),
            )
        )
    ]
    items.sort(
        key=lambda item: (
            -expected_gain(item),
            item.get('name', '').casefold(),
        )
    )
    lines = [
        '# À tester — Vision IA',
        '',
        'File dédupliquée, triée par gain attendu global. Les outils déjà '
        'utilisés, écartés ou seulement à surveiller restent dans le catalogue.',
        '',
        f'> Prudence biomédicale — {MEDICAL_NOTICE}',
        '',
    ]
    if not items:
        lines.extend(['- Aucune piste classée à tester.', ''])
    for position, item in enumerate(items, 1):
        source = sorted(
            item.get('sources', []),
            key=lambda value: value.get('published', ''),
        )[0]
        dominant = max(
            ('code_buddy', 'media', 'biomedical', 'lisa'),
            key=lambda axis_name: int(
                item.get(axis_name, {}).get('score', 0)
            ),
        )
        reason = item.get(dominant, {}).get('justification', '')
        lines.extend(
            [
                f'## {position}. [ ] {item["name"]} — gain '
                f'{expected_gain(item)}/100',
                '',
                f'- Axe dominant : `{dominant}` '
                f'({item.get(dominant, {}).get("score", 0)}/10)',
                f'- Pourquoi : {reason or item.get("description", "")}',
                f'- Expérience : valider accès/licence, lancer un cas réel '
                f'court, mesurer qualité, coût, latence et reproductibilité.',
                f'- Premier signal : [{source.get("title", "Vision IA")}]'
                f'({source.get("url", "")})',
                '',
            ]
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')
    os.replace(temporary, path)


KNOWN_USED = (
    'longcat',
    'wan 2.2',
    'krea',
    'comfyui',
    'cerebras',
    'groq',
)


def catalogue_status(item: dict[str, Any]) -> tuple[str, str]:
    haystack = ' '.join(
        [
            str(item.get('key', '')),
            str(item.get('name', '')),
            str(item.get('family', '')),
        ]
    ).casefold()
    if 'bernini' in haystack:
        return (
            'écarté',
            'Test local : identité ArcFace 0,269, sous le seuil requis 0,55.',
        )
    if any(name in haystack for name in KNOWN_USED):
        return ('déjà utilisé chez nous', 'Présent dans le pipeline actuel.')
    if any(
        item.get(axis_name, {}).get('a_tester')
        for axis_name in ('code_buddy', 'media', 'biomedical')
    ):
        return ('à tester', 'Expérimentation concrète proposée par la veille.')
    return ('à surveiller', 'Signal utile, mais test immédiat non justifié.')


def expected_gain(item: dict[str, Any]) -> int:
    scores = sorted(
        [
            int(item.get(axis_name, {}).get('score', 0))
            for axis_name in ('code_buddy', 'media', 'biomedical', 'lisa')
        ],
        reverse=True,
    )
    test_bonus = 10 if any(
        item.get(axis_name, {}).get('a_tester')
        for axis_name in ('code_buddy', 'media', 'biomedical')
    ) else 0
    return min(100, scores[0] * 6 + scores[1] * 3 + test_bonus)


def markdown_cell(value: Any, limit: int = 180) -> str:
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + '…'
    return text.replace('|', r'\|').replace('\n', ' ')


def first_source(item: dict[str, Any]) -> dict[str, Any]:
    sources = item.get('sources', [])
    if not sources:
        return {}
    return sorted(
        sources,
        key=lambda value: (
            value.get('published') or '9999',
            value.get('video_id', ''),
        ),
    )[0]


def write_catalogue(path: Path, state: dict[str, Any]) -> None:
    items = [
        item
        for item in state['items'].values()
        if not is_promotional_item(
            str(item.get('name', '')),
            str(item.get('publisher', '')),
        )
    ]
    items.sort(
        key=lambda item: (
            first_source(item).get('published', ''),
            item.get('name', '').casefold(),
        )
    )
    lines = [
        '# Catalogue des outils et modèles — Vision IA',
        '',
        f'{len(items)} entrées dédupliquées. Les scores vont de 0 à 10 : '
        'CB = Code Buddy, média = pipeline média, bio = biomédical/recherche, '
        'Lisa = potentiel de sujet.',
        '',
        '| Outil / modèle | Éditeur | Fonction | Lien cité | '
        'CB | Média | Bio | Lisa | Première mention | Statut |',
        '|---|---|---|---|---:|---:|---:|---:|---|---|',
    ]
    for item in items:
        source = first_source(item)
        source_date = str(source.get('published', ''))[:10] or 'inconnue'
        source_link = (
            f'[{source_date}]({source.get("url")})'
            if source.get('url')
            else source_date
        )
        cited_link = str(item.get('link', '')).strip()
        link_cell = f'[source]({cited_link})' if cited_link else '—'
        status, note = catalogue_status(item)
        lines.append(
            '| '
            + ' | '.join(
                [
                    f'**{markdown_cell(item.get("name"))}**',
                    markdown_cell(item.get('publisher', 'inconnu'), 80),
                    markdown_cell(item.get('description'), 220),
                    link_cell,
                    str(item.get('code_buddy', {}).get('score', 0)),
                    str(item.get('media', {}).get('score', 0)),
                    str(item.get('biomedical', {}).get('score', 0)),
                    str(item.get('lisa', {}).get('score', 0)),
                    source_link,
                    f'**{status}** — {markdown_cell(note, 120)}',
                ]
            )
            + ' |'
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.md.tmp')
    temporary.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def read_cached_analysis(workdir: Path, video_id: str) -> dict[str, Any]:
    path = workdir / 'analyses' / f'{video_id}.json'
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def write_knowledge_base(
    path: Path,
    inventory: list[Video],
    state: dict[str, Any],
    workdir: Path,
) -> None:
    ordered = sorted(
        inventory,
        key=lambda video: (video.published, video.video_id),
        reverse=True,
    )
    analyzed_count = sum(
        video.video_id in state.get('seen_videos', {}) for video in ordered
    )
    lines = [
        '# Base de connaissances — chaîne Vision IA',
        '',
        f'- Chaîne : `Vision IA` (`{VISION_IA_CHANNEL_ID}`)',
        f'- Playlist uploads : `UU{VISION_IA_CHANNEL_ID[2:]}`',
        f'- Inventaire : **{len(ordered)} vidéos**',
        f'- Fiches analysées : **{analyzed_count}**',
        f'- Mise à jour : {now_iso()}',
        '',
        'Les transcripts nettoyés sont conservés dans `transcripts/` et les '
        'analyses JSON dans `analyses/`. Une fiche « en attente » signale une '
        'vidéo inventoriée que le rattrapage n’a pas encore analysée.',
        '',
        '## Inventaire chronologique',
        '',
        '| Date | Titre | Durée | Vues relevées | ID | État |',
        '|---|---|---:|---:|---|---|',
    ]
    for video in ordered:
        duration = (
            f'{video.duration // 60}:{video.duration % 60:02d}'
            if video.duration is not None
            else '—'
        )
        views = (
            f'{video.view_count:,}'.replace(',', ' ')
            if video.view_count is not None
            else '—'
        )
        state_label = (
            'analysée'
            if video.video_id in state.get('seen_videos', {})
            else 'en attente'
        )
        lines.append(
            f'| {video.published[:10] or "—"} | '
            f'[{markdown_cell(video.title, 140)}]({video.url}) | '
            f'{duration} | {views} | `{video.video_id}` | {state_label} |'
        )
    lines.extend(['', '## Fiches par vidéo', ''])
    for video in ordered:
        seen = state.get('seen_videos', {}).get(video.video_id)
        if not seen:
            continue
        analysis = read_cached_analysis(workdir, video.video_id)
        main_subject = (
            analysis.get('main_subject')
            or seen.get('main_subject')
            or video.title
        )
        summary = analysis.get('summary') or seen.get('summary') or ''
        item_keys = seen.get('item_keys', [])
        items = [
            state.get('items', {}).get(key)
            for key in item_keys
            if state.get('items', {}).get(key)
        ]
        lines.extend(
            [
                f'### {video.published[:10] or "date inconnue"} — '
                f'[{video.title}]({video.url})',
                '',
                f'- ID : `{video.video_id}`',
                f'- Durée : {video.duration or "inconnue"} s ; vues relevées : '
                f'{video.view_count if video.view_count is not None else "inconnues"}',
                f'- Sujet principal : {main_subject}',
                f'- Synthèse : {summary or "voir les nouveautés ci-dessous"}',
                f'- Transcript : `transcripts/{video.video_id}.txt`',
                '',
                '**Outils, modèles et nouveautés**',
                '',
            ]
        )
        if not items:
            lines.extend(['- Aucun item structuré extrait.', ''])
            continue
        for item in items:
            status, _ = catalogue_status(item)
            lines.append(
                f'- **{item.get("name")}** ({item.get("publisher", "inconnu")}) '
                f'— {item.get("description", "")} '
                f'[CB {item.get("code_buddy", {}).get("score", 0)}/10 · '
                f'média {item.get("media", {}).get("score", 0)}/10 · '
                f'bio {item.get("biomedical", {}).get("score", 0)}/10 · '
                f'Lisa {item.get("lisa", {}).get("score", 0)}/10 · {status}]'
            )
        lines.append('')
    temporary = path.with_suffix('.md.tmp')
    temporary.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')
    os.replace(temporary, path)


def choose_videos(
    channels: tuple[Channel, ...],
    args: argparse.Namespace,
    state: dict[str, Any],
    inventory: list[Video],
) -> list[Video]:
    if args.video_id:
        return [
            targeted_video(video_id, channels, args)
            for video_id in args.video_id
            if args.force or video_id not in state['seen_videos']
        ]
    if args.backfill:
        selected = [
            video
            for video in inventory
            if (
                video.channel_id == VISION_IA_CHANNEL_ID
                and (args.force or video.video_id not in state['seen_videos'])
            )
        ]
        selected.sort(
            key=lambda video: (video.published, video.video_id),
            reverse=True,
        )
        return selected[: args.max_videos]
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
        '--engine',
        choices=('auto', 'agy', 'ollama'),
        default=os.environ.get('VEILLE_YOUTUBE_ENGINE', 'auto'),
        help='moteur LLM gratuit (auto préfère agy puis Ollama)',
    )
    parser.add_argument(
        '--ollama-model',
        default=os.environ.get(
            'VEILLE_YOUTUBE_OLLAMA_MODEL', DEFAULT_OLLAMA_MODEL
        ),
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=1,
        help='vidéos par appel Ollama historique (1 = analyse détaillée)',
    )
    parser.add_argument(
        '--backfill',
        action='store_true',
        help="traite l'inventaire historique Vision IA, plus récent d'abord",
    )
    parser.add_argument(
        '--inventory-jsonl',
        type=Path,
        help='importe le JSONL complet produit par yt-dlp',
    )
    parser.add_argument(
        '--transcripts-only',
        action='store_true',
        help='remplit uniquement le cache de transcripts, sans LLM',
    )
    parser.add_argument(
        '--workers',
        type=int,
        default=4,
        help='téléchargements parallèles avec --transcripts-only (défaut : 4)',
    )
    parser.add_argument(
        '--rebuild-outputs',
        action='store_true',
        help='régénère base, catalogue et file de tests depuis les caches',
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
    if args.inventory_jsonl:
        args.inventory_jsonl = args.inventory_jsonl.expanduser()
    if (
        args.days < 1
        or args.max_videos < 1
        or args.workers < 1
        or args.batch_size < 1
    ):
        parser.error(
            '--days, --max-videos, --workers et --batch-size doivent être '
            'supérieurs à zéro'
        )
    for video_id in args.video_id:
        if not VIDEO_ID.fullmatch(video_id):
            parser.error(f'ID YouTube invalide : {video_id!r}')
    if args.engine in {'auto', 'agy'} and not args.model.startswith('gemini-'):
        parser.error('le modèle doit être un Gemini gratuit via agy')
    return args


def run_batch_backfill(
    videos: list[Video],
    inventory: list[Video],
    state: dict[str, Any],
    args: argparse.Namespace,
) -> tuple[int, int]:
    workdir = args.workdir
    state_path = workdir / 'index.json'
    journal_path = workdir / 'journal.jsonl'
    analyses_dir = workdir / 'analyses'
    queue_path = workdir / 'A-TESTER.md'
    catalogue_path = workdir / 'CATALOGUE-OUTILS.md'
    knowledge_path = workdir / 'BASE-CONNAISSANCES-VISIONAI.md'
    analyzed = 0
    failures = 0
    for offset in range(0, len(videos), args.batch_size):
        chunk = videos[offset : offset + args.batch_size]
        inputs: list[tuple[Video, str]] = []
        languages: dict[str, str] = {}
        for video in chunk:
            try:
                transcript, language = download_transcript(video, args)
                inputs.append((video, transcript))
                languages[video.video_id] = language
            except (
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
        if not inputs:
            continue
        try:
            results = analyze_batch_with_ollama(
                inputs, args.ollama_model
            )
        except (OSError, RuntimeError, ValueError) as error:
            failures += len(inputs)
            for video, _ in inputs:
                journal(
                    journal_path,
                    'video_failed',
                    video_id=video.video_id,
                    error=f'échec batch: {error}',
                )
            print(f'ERREUR batch: {error}', file=sys.stderr, flush=True)
            continue
        for video, _ in inputs:
            analysis = results.get(video.video_id)
            if not analysis:
                failures += 1
                journal(
                    journal_path,
                    'video_failed',
                    video_id=video.video_id,
                    error='vidéo absente de la réponse Ollama batch',
                )
                continue
            items = validate_analysis(analysis)
            normalized = normalized_analysis(analysis, items)
            atomic_json(
                analyses_dir / f'{video.video_id}.json',
                {
                    'version': 1,
                    'video': inventory_record(video),
                    'engine': 'ollama-batch',
                    'model': args.ollama_model,
                    'analysis_level': 'historical-sampled-transcript',
                    'analyzed_at': now_iso(),
                    **normalized,
                },
            )
            new_items = merge_items(state, video, items)
            state['seen_videos'][video.video_id] = {
                'analyzed_at': now_iso(),
                'channel': video.channel_name,
                'title': video.title,
                'published': video.published,
                'url': video.url,
                'duration': video.duration,
                'view_count': video.view_count,
                'transcript_language': languages[video.video_id],
                'analysis_level': 'historical-sampled-transcript',
                'item_keys': [item['key'] for item in items],
                'main_subject': normalized['main_subject'],
                'summary': normalized['summary'],
                'editorial': normalized['editorial'],
            }
            analyzed += 1
            journal(
                journal_path,
                'video_completed',
                video_id=video.video_id,
                extracted=len(items),
                new=len(new_items),
                mode='ollama-batch',
            )
        atomic_json(state_path, state)
        write_test_queue(queue_path, state)
        write_catalogue(catalogue_path, state)
        write_knowledge_base(knowledge_path, inventory, state, workdir)
        print(
            f'Lot {min(offset + len(chunk), len(videos))}/{len(videos)} '
            f'— {analyzed} analysée(s), {failures} échec(s)',
            flush=True,
        )
    return analyzed, failures


def run(args: argparse.Namespace) -> int:
    channels = configured_channels(args.config)
    workdir = args.workdir
    workdir.mkdir(parents=True, exist_ok=True)
    state_path = workdir / 'index.json'
    journal_path = workdir / 'journal.jsonl'
    report_path = workdir / 'VEILLE-IA.md'
    queue_path = workdir / 'A-TESTER.md'
    inventory_path = workdir / 'inventaire-vision-ia.json'
    knowledge_path = workdir / 'BASE-CONNAISSANCES-VISIONAI.md'
    catalogue_path = workdir / 'CATALOGUE-OUTILS.md'
    analyses_dir = workdir / 'analyses'
    analyses_dir.mkdir(parents=True, exist_ok=True)
    lock_path = workdir / '.veille.lock'

    with lock_path.open('w', encoding='utf-8') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Une veille YouTube est déjà en cours.', file=sys.stderr)
            return 0
        state = load_state(state_path)
        raw_inventory = (
            args.inventory_jsonl
            or workdir / 'raw' / 'vision-ia-videos.jsonl'
        )
        if raw_inventory.exists() and (
            args.inventory_jsonl or not inventory_path.exists()
        ):
            inventory = import_inventory_jsonl(
                raw_inventory, inventory_path
            )
            journal(
                journal_path,
                'inventory_imported',
                count=len(inventory),
                source=str(raw_inventory),
            )
        else:
            inventory = load_inventory(inventory_path)

        if args.backfill and not inventory:
            raise RuntimeError(
                'inventaire Vision IA absent : fournis --inventory-jsonl '
                'après la collecte yt-dlp'
            )

        if args.transcripts_only:
            candidates = (
                inventory
                if args.backfill
                else choose_videos(channels, args, state, inventory)
            )
            candidates = [
                video
                for video in candidates
                if (
                    args.force
                    or not (
                        workdir / 'transcripts' / f'{video.video_id}.txt'
                    ).exists()
                )
            ][: args.max_videos]
            if not candidates:
                print('Tous les transcripts demandés sont déjà en cache.')
                return 0
            failures = 0
            completed = 0
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {
                    executor.submit(download_transcript, video, args): video
                    for video in candidates
                }
                for future in as_completed(futures):
                    video = futures[future]
                    try:
                        transcript, language = future.result()
                        completed += 1
                        journal(
                            journal_path,
                            'transcript_cached',
                            video_id=video.video_id,
                            language=language,
                            characters=len(transcript),
                        )
                        print(
                            f'[{completed}/{len(candidates)}] '
                            f'{video.video_id} transcript en cache',
                            flush=True,
                        )
                    except (
                        OSError,
                        RuntimeError,
                        subprocess.TimeoutExpired,
                        ValueError,
                    ) as error:
                        failures += 1
                        journal(
                            journal_path,
                            'transcript_failed',
                            video_id=video.video_id,
                            error=str(error),
                        )
                        print(
                            f'ERREUR transcript {video.video_id}: {error}',
                            file=sys.stderr,
                            flush=True,
                        )
            journal(
                journal_path,
                'transcripts_run_completed',
                completed=completed,
                failures=failures,
            )
            return 1 if failures else 0

        videos = choose_videos(channels, args, state, inventory)
        if args.list:
            for video in videos:
                print(
                    f'{video.video_id}\t{video.published}\t'
                    f'{video.channel_name}\t{video.title}'
                )
            return 0
        if not videos:
            journal(journal_path, 'run_empty')
            if args.rebuild_outputs or inventory:
                write_test_queue(queue_path, state)
                write_catalogue(catalogue_path, state)
                write_knowledge_base(
                    knowledge_path, inventory, state, workdir
                )
            print('Aucune nouvelle vidéo à analyser.')
            return 0

        by_id = {video.video_id: video for video in inventory}
        by_id.update({video.video_id: video for video in videos})
        inventory = list(by_id.values())
        write_inventory(inventory_path, inventory)

        if args.backfill and args.batch_size > 1:
            if args.engine not in {'auto', 'ollama'}:
                raise RuntimeError(
                    '--batch-size > 1 exige --engine ollama ou auto'
                )
            analyzed, failures = run_batch_backfill(
                videos, inventory, state, args
            )
            journal(
                journal_path,
                'run_completed',
                analyzed=analyzed,
                failures=failures,
                mode='ollama-batch',
            )
            print(f'Base : {knowledge_path}')
            print(f'Catalogue : {catalogue_path}')
            print(f'File de tests : {queue_path}')
            return 1 if failures else 0

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
                analysis_path = analyses_dir / f'{video.video_id}.json'
                if analysis_path.exists() and not args.force:
                    analysis = json.loads(
                        analysis_path.read_text(encoding='utf-8')
                    )
                    journal(
                        journal_path,
                        'analysis_cache_hit',
                        video_id=video.video_id,
                    )
                else:
                    analysis = analyze_video(video, transcript, args)
                items = validate_analysis(analysis)
                normalized = normalized_analysis(analysis, items)
                atomic_json(
                    analysis_path,
                    {
                        'version': 1,
                        'video': inventory_record(video),
                        'engine': args.engine,
                        'model': (
                            args.ollama_model
                            if args.engine == 'ollama'
                            or (
                                args.engine == 'auto'
                                and not shutil.which('agy')
                            )
                            else args.model
                        ),
                        'analyzed_at': now_iso(),
                        **normalized,
                    },
                )
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
                    'main_subject': normalized['main_subject'],
                    'summary': normalized['summary'],
                    'editorial': normalized['editorial'],
                }
                atomic_json(state_path, state)
                write_test_queue(queue_path, state)
                write_catalogue(catalogue_path, state)
                write_knowledge_base(
                    knowledge_path, inventory, state, workdir
                )
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
        print(f'Base : {knowledge_path}')
        print(f'Catalogue : {catalogue_path}')
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
