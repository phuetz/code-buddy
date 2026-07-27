#!/usr/bin/env python3
"""Veille quotidienne des chaînes YouTube IA sans API payante.

Le script lit les flux RSS publics YouTube, télécharge les métadonnées et les
sous-titres automatiques avec yt-dlp, puis confie l'extraction structurée à
Gemini via ``agy``. Les vidéos et les outils déjà vus sont indexés afin que les
relances et le timer systemd soient idempotents.

Configuration facultative : ``~/.codebuddy/veille-chaines.yml``.
Sorties : ``~/.codebuddy/veille/VEILLE-IA.md`` et ``A-TESTER.md``.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Iterable
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET


DEFAULT_CONFIG = Path('~/.codebuddy/veille-chaines.yml').expanduser()
DEFAULT_WORKDIR = Path('~/.codebuddy/veille').expanduser()
DEFAULT_MODEL = 'gemini-3.6-flash-high'
USER_AGENT = 'CodeBuddyYouTubeWatch/1.0 (+https://github.com/Patrice-Code/code-buddy)'
ATOM_NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'yt': 'http://www.youtube.com/xml/schemas/2015',
}
VTT_TAG_RE = re.compile(r'<[^>]+>')
VTT_TIME_RE = re.compile(
    r'^(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+'
)
SPACE_RE = re.compile(r'\s+')
SCORE_FIELDS = ('code_buddy', 'media', 'lisa_topic')
RECOMMENDATIONS = {'a_tester', 'surveiller', 'ignorer'}


@dataclass(frozen=True)
class Channel:
    slug: str
    name: str
    channel_id: str
    language: str
    focus: str
    enabled: bool = True

    @property
    def feed_url(self) -> str:
        return (
            'https://www.youtube.com/feeds/videos.xml?channel_id='
            f'{self.channel_id}'
        )


@dataclass(frozen=True)
class Video:
    video_id: str
    title: str
    url: str
    published: str
    channel: Channel


# Ordre éditorial intentionnel : Vision IA reste toujours la première source.
DEFAULT_CHANNELS = (
    Channel(
        'vision-ia',
        'Vision IA',
        'UCyc03X3uRuxM9n7fyRH_gIw',
        'fr',
        'Récapitulatifs IA, modèles, recherche et outils créatifs',
    ),
    Channel(
        'parlons-ia-tech',
        'Parlons IA & Tech',
        'UCrRlS6QE1DsKnLDksvaBkKA',
        'fr',
        'Actualité IA hebdomadaire et nouveaux modèles',
    ),
    Channel(
        'ludo-salenne',
        'Ludo Salenne',
        'UCnnYqSNKKygemgmxC9PyLTw',
        'fr',
        'Outils IA, automatisation et usages concrets',
    ),
    Channel(
        'le-turing-lab',
        'Le Turing Lab',
        'UCbYzYnYEvYmMYjC2QV_QCOA',
        'fr',
        'Actualités, démonstrations et outils IA',
    ),
    Channel(
        'matt-wolfe',
        'Matt Wolfe',
        'UChpleBmo18P08aKCIgti38g',
        'en',
        'Revue hebdomadaire des outils IA, dont image et vidéo',
    ),
    Channel(
        'ai-explained',
        'AI Explained',
        'UCNJ1Ymd5yFuUPtn21xtRbbw',
        'en',
        'Analyse critique des modèles et publications majeures',
    ),
    Channel(
        'matthew-berman',
        'Matthew Berman',
        'UCawZsQWqfGSbCI5yjkdVkTA',
        'en',
        'LLM, modèles ouverts, agents et tests rapides',
    ),
    Channel(
        'two-minute-papers',
        'Two Minute Papers',
        'UCbfYPyITQ-7l4upoX8nvctg',
        'en',
        'Recherche IA, vision, génération et robotique',
    ),
)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f'.{path.name}.',
        suffix='.tmp',
        dir=path.parent,
    )
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(content)
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    atomic_write_text(
        path,
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
    )


def append_journal(path: Path, event: str, **values: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {'at': now_iso(), 'event': event, **values}
    with path.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + '\n')


def slugify(value: str) -> str:
    normalized = unicodedata.normalize('NFKD', value)
    ascii_value = normalized.encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]+', '-', ascii_value.lower()).strip('-')


def canonical_tool_key(value: str) -> str:
    normalized = unicodedata.normalize('NFKD', value)
    ascii_value = normalized.encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]+', '', ascii_value.lower())


def default_config_text(channels: Iterable[Channel] = DEFAULT_CHANNELS) -> str:
    lines = [
        '# Chaînes suivies par veille-youtube.py.',
        '# Vision IA doit rester en tête ; enabled: false désactive une source.',
        'channels:',
    ]
    for channel in channels:
        lines.extend([
            f'  - slug: {channel.slug}',
            f'    name: {channel.name}',
            f'    channel_id: {channel.channel_id}',
            f'    language: {channel.language}',
            f'    focus: {channel.focus}',
            f'    enabled: {str(channel.enabled).lower()}',
        ])
    return '\n'.join(lines) + '\n'


def parse_scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ''
    if value.lower() in {'true', 'false'}:
        return value.lower() == 'true'
    if (
        len(value) >= 2
        and value[0] == value[-1]
        and value[0] in {'"', "'"}
    ):
        return value[1:-1]
    return value


def parse_simple_yaml(text: str) -> dict[str, Any]:
    """Parse le sous-ensemble YAML documenté, sans dépendance obligatoire."""
    channels: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    in_channels = False
    for line_number, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.split('#', 1)[0].rstrip()
        if not line.strip():
            continue
        if line.strip() == 'channels:':
            in_channels = True
            continue
        if not in_channels:
            raise ValueError(
                f'ligne {line_number}: seule la clé channels est acceptée'
            )
        stripped = line.strip()
        if stripped.startswith('- '):
            if current is not None:
                channels.append(current)
            current = {}
            stripped = stripped[2:].strip()
        if current is None or ':' not in stripped:
            raise ValueError(f'ligne YAML invalide {line_number}: {raw_line!r}')
        key, value = stripped.split(':', 1)
        current[key.strip()] = parse_scalar(value)
    if current is not None:
        channels.append(current)
    return {'channels': channels}


def load_yaml(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding='utf-8')
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:
        value = parse_simple_yaml(text)
    else:
        value = yaml.safe_load(text)
    if not isinstance(value, dict):
        raise ValueError('le fichier YAML doit contenir un objet')
    return value


def load_channels(path: Path) -> tuple[Channel, ...]:
    if not path.exists():
        return DEFAULT_CHANNELS
    raw = load_yaml(path).get('channels')
    if not isinstance(raw, list) or not raw:
        raise ValueError('channels doit être une liste non vide')
    channels: list[Channel] = []
    for index, value in enumerate(raw):
        if not isinstance(value, dict):
            raise ValueError(f'channels[{index}] doit être un objet')
        try:
            name = str(value['name']).strip()
            channel_id = str(value['channel_id']).strip()
        except KeyError as error:
            raise ValueError(
                f'channels[{index}] ne contient pas {error.args[0]}'
            ) from error
        slug = str(value.get('slug') or slugify(name)).strip()
        language = str(value.get('language') or 'fr').strip().lower()
        focus = str(value.get('focus') or '').strip()
        enabled = value.get('enabled', True)
        if not isinstance(enabled, bool):
            raise ValueError(f'channels[{index}].enabled doit être booléen')
        if not name or not slug or not channel_id.startswith('UC'):
            raise ValueError(f'channels[{index}] est incomplet ou invalide')
        if language not in {'fr', 'en'}:
            raise ValueError(
                f'channels[{index}].language doit valoir fr ou en'
            )
        channels.append(
            Channel(slug, name, channel_id, language, focus, enabled)
        )
    if len({channel.slug for channel in channels}) != len(channels):
        raise ValueError('les slugs de chaînes doivent être uniques')
    if len({channel.channel_id for channel in channels}) != len(channels):
        raise ValueError('les channel_id doivent être uniques')
    return tuple(channels)


def fetch_url(url: str, timeout: int = 30) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def parse_youtube_feed(data: bytes, channel: Channel) -> list[Video]:
    root = ET.fromstring(data)
    videos: list[Video] = []
    for entry in root.findall('atom:entry', ATOM_NS):
        video_id = (entry.findtext('yt:videoId', '', ATOM_NS) or '').strip()
        title = (entry.findtext('atom:title', '', ATOM_NS) or '').strip()
        published = (
            entry.findtext('atom:published', '', ATOM_NS) or ''
        ).strip()
        link_element = entry.find('atom:link[@rel="alternate"]', ATOM_NS)
        url = (
            link_element.attrib.get('href', '')
            if link_element is not None
            else ''
        )
        if video_id and title:
            videos.append(
                Video(
                    video_id,
                    title,
                    url or f'https://www.youtube.com/watch?v={video_id}',
                    published,
                    channel,
                )
            )
    return videos


def fetch_channel_videos(channel: Channel) -> list[Video]:
    return parse_youtube_feed(fetch_url(channel.feed_url), channel)


def parse_published(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def clean_vtt(text: str) -> str:
    """Supprime balises/horodatages et dédoublonne les lignes roulantes."""
    cleaned: list[str] = []
    seen: set[str] = set()
    skip_note = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith(('NOTE', 'STYLE', 'REGION')):
            skip_note = True
            continue
        if not line:
            skip_note = False
            continue
        if skip_note:
            continue
        if (
            line == 'WEBVTT'
            or line.startswith(('Kind:', 'Language:'))
            or line.isdigit()
            or VTT_TIME_RE.match(line)
        ):
            continue
        line = html.unescape(VTT_TAG_RE.sub('', line))
        line = SPACE_RE.sub(' ', line).strip()
        dedupe_key = unicodedata.normalize('NFKC', line).casefold()
        if not line or dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        cleaned.append(line)
    return '\n'.join(cleaned)


def resolve_binary(env_name: str, default: str) -> str:
    configured = os.environ.get(env_name)
    if configured:
        if not Path(configured).expanduser().exists():
            raise RuntimeError(f'{env_name} pointe vers un fichier absent')
        return str(Path(configured).expanduser())
    binary = shutil.which(default)
    if not binary:
        raise RuntimeError(f'commande {default} introuvable dans PATH')
    return binary


def select_subtitle(paths: Iterable[Path], language: str) -> Path | None:
    candidates = list(paths)
    priorities = (f'.{language}.vtt', '.fr.vtt', '.en.vtt')
    for suffix in priorities:
        for path in candidates:
            if path.name.endswith(suffix):
                return path
    return candidates[0] if candidates else None


def acquire_video(
    video: Video,
    yt_dlp: str,
) -> tuple[dict[str, Any], str]:
    with tempfile.TemporaryDirectory(prefix='veille-youtube-') as directory:
        temp_dir = Path(directory)
        output = temp_dir / '%(id)s.%(ext)s'
        base_command = [
            yt_dlp,
            '--skip-download',
            '--no-playlist',
            '--ignore-no-formats-error',
            '--no-warnings',
        ]
        subtitle_options = [
            '--write-info-json',
            '--write-auto-subs',
            '--sub-langs',
            'fr,en',
            '--sub-format',
            'vtt',
            '-o',
            str(output),
        ]
        try:
            primary = subprocess.run(
                [*base_command, *subtitle_options, video.url],
                check=False,
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                f'yt-dlp a dépassé 3 minutes pour {video.video_id}'
            ) from error
        info_paths = list(temp_dir.glob(f'{video.video_id}.info.json'))
        subtitle_paths = list(temp_dir.glob(f'{video.video_id}*.vtt'))

        # YouTube peut imposer ponctuellement un contrôle anti-bot au client
        # web par défaut. Le client web_safari reste public et ne nécessite ni
        # cookie ni API ; il sert uniquement de repli à yt-dlp.
        if not info_paths:
            metadata_command = [
                *base_command,
                '--dump-single-json',
                '--extractor-args',
                'youtube:player_client=web_safari',
                video.url,
            ]
            try:
                metadata_result = subprocess.run(
                    metadata_command,
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=180,
                )
                metadata = json.loads(metadata_result.stdout)
            except (
                subprocess.CalledProcessError,
                subprocess.TimeoutExpired,
                json.JSONDecodeError,
            ) as error:
                details = (
                    getattr(error, 'stderr', '')
                    or getattr(error, 'stdout', '')
                    or primary.stderr
                    or primary.stdout
                    or ''
                ).strip()
                raise RuntimeError(
                    f'yt-dlp a échoué pour {video.video_id}: '
                    f'{details[-800:]}'
                ) from error
        else:
            metadata = json.loads(info_paths[0].read_text(encoding='utf-8'))

        if not subtitle_paths:
            fallback = subprocess.run(
                [
                    *base_command,
                    '--write-auto-subs',
                    '--sub-langs',
                    'fr,en',
                    '--sub-format',
                    'vtt',
                    '--extractor-args',
                    'youtube:player_client=web_safari',
                    '-o',
                    str(output),
                    video.url,
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=180,
            )
            subtitle_paths = list(temp_dir.glob(f'{video.video_id}*.vtt'))
            if not subtitle_paths:
                details = (
                    fallback.stderr
                    or fallback.stdout
                    or primary.stderr
                    or primary.stdout
                    or ''
                ).strip()
                raise RuntimeError(
                    f'aucun transcript automatique fr/en pour '
                    f'{video.video_id}: {details[-800:]}'
                )
        subtitle = select_subtitle(
            subtitle_paths,
            video.channel.language,
        )
        if subtitle is None:
            raise RuntimeError(
                f'aucun transcript automatique fr/en pour {video.video_id}'
            )
        transcript = clean_vtt(subtitle.read_text(encoding='utf-8'))
        if len(transcript) < 200:
            raise RuntimeError(
                f'transcript trop court pour {video.video_id} '
                f'({len(transcript)} caractères)'
            )
        return metadata, transcript


def analysis_prompt(
    video: Video,
    metadata: dict[str, Any],
    transcript: str,
) -> str:
    description = str(metadata.get('description') or '')[:16_000]
    transcript = transcript[:120_000]
    return f"""Tu assures une veille technique pour Code Buddy et deux chaînes
YouTube : Lisa (actualité tech/IA) et Ambre (voyage). Analyse UNIQUEMENT les
métadonnées et le transcript fournis. Les sous-titres automatiques peuvent
déformer les noms propres : les chapitres de la description sont alors un
indice prioritaire. N'invente aucun outil absent de la source.

VIDÉO
- chaîne : {video.channel.name}
- titre : {metadata.get('title') or video.title}
- URL : {video.url}
- date : {metadata.get('upload_date') or video.published}

DESCRIPTION / CHAPITRES
{description}

TRANSCRIPT NETTOYÉ
{transcript}

Retourne seulement un objet JSON strict selon ce contrat :
{{
  "video_summary": "résumé factuel en français, 2 phrases maximum",
  "items": [
    {{
      "name": "nom exact et canonique de l'outil/modèle/nouveauté",
      "aliases": ["variantes réellement présentes dans la source"],
      "kind": "llm|embedding|rag|agent|mcp|vision|voice|video|image|editing|robotics|research|other",
      "what_it_does": "ce que c'est et ce que cela fait",
      "use_case": "usage concret",
      "code_buddy": {{
        "score": 0,
        "reason": "intégration possible ou raison de non-pertinence"
      }},
      "media": {{
        "score": 0,
        "reason": "utilité pour génération vidéo/avatar/lipsync/image/montage/voix"
      }},
      "lisa_topic": {{
        "score": 0,
        "reason": "potentiel de sujet et angle Lisa"
      }},
      "recommendation": "a_tester|surveiller|ignorer",
      "source_quote": "court fragment paraphrasé ou cité du transcript"
    }}
  ]
}}

Les trois scores sont des entiers de 0 à 10. Classe "a_tester" seulement une
piste concrète, accessible et suffisamment prometteuse pour justifier une
expérience Code Buddy ou média. Inclus les nouveaux modèles même s'ils sont
encore au stade recherche ; utilise alors "surveiller". Fusionne les mentions
répétées d'un même outil dans un seul item."""


def extract_json(raw: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', raw):
        try:
            value, _ = decoder.raw_decode(raw[match.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError('la réponse LLM ne contient aucun objet JSON valide')


def call_llm(prompt: str, agy: str, model: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [agy, '--model', model, '-p', prompt],
            check=True,
            capture_output=True,
            text=True,
            timeout=480,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError('agy a dépassé le délai de 8 minutes') from error
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or '').strip()
        raise RuntimeError(f'agy a échoué: {details[-1200:]}') from error
    return extract_json(result.stdout)


def normalize_score(value: Any, label: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f'{label}.score doit être un entier')
    try:
        score = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f'{label}.score doit être un entier') from error
    if not 0 <= score <= 10:
        raise ValueError(f'{label}.score doit être compris entre 0 et 10')
    return score


def normalize_analysis(value: dict[str, Any]) -> dict[str, Any]:
    summary = str(value.get('video_summary') or '').strip()
    raw_items = value.get('items')
    if not isinstance(raw_items, list):
        raise ValueError('items doit être une liste')
    items: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            raise ValueError(f'items[{index}] doit être un objet')
        name = str(raw.get('name') or '').strip()
        what_it_does = str(raw.get('what_it_does') or '').strip()
        if not name or not what_it_does:
            raise ValueError(f'items[{index}] doit avoir name et what_it_does')
        item: dict[str, Any] = {
            'name': name,
            'aliases': [
                str(alias).strip()
                for alias in raw.get('aliases', [])
                if str(alias).strip()
            ] if isinstance(raw.get('aliases', []), list) else [],
            'kind': str(raw.get('kind') or 'other').strip(),
            'what_it_does': what_it_does,
            'use_case': str(raw.get('use_case') or '').strip(),
            'source_quote': str(raw.get('source_quote') or '').strip()[:500],
        }
        for field in SCORE_FIELDS:
            axis = raw.get(field)
            if not isinstance(axis, dict):
                raise ValueError(f'items[{index}].{field} doit être un objet')
            item[field] = {
                'score': normalize_score(axis.get('score'), field),
                'reason': str(axis.get('reason') or '').strip(),
            }
        recommendation = slugify(str(raw.get('recommendation') or ''))
        recommendation = {
            'a-tester': 'a_tester',
            'tester': 'a_tester',
        }.get(recommendation, recommendation.replace('-', '_'))
        if recommendation not in RECOMMENDATIONS:
            raise ValueError(
                f'items[{index}].recommendation invalide: {recommendation!r}'
            )
        item['recommendation'] = recommendation
        items.append(item)
    return {'video_summary': summary, 'items': items}


def empty_state() -> dict[str, Any]:
    return {
        'version': 1,
        'created_at': now_iso(),
        'videos': {},
        'tools': {},
        'aliases': {},
        'reports': [],
    }


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return empty_state()
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('index de veille absent ou de version inconnue')
    for key, default in (
        ('videos', {}),
        ('tools', {}),
        ('aliases', {}),
        ('reports', []),
    ):
        value.setdefault(key, default)
    return value


def markdown_text(value: Any) -> str:
    return SPACE_RE.sub(' ', str(value or '')).strip().replace('|', '\\|')


def recommendation_label(value: str) -> str:
    return {
        'a_tester': 'À tester',
        'surveiller': 'À surveiller',
        'ignorer': 'Signal faible',
    }.get(value, value)


def merge_analysis(
    state: dict[str, Any],
    video: Video,
    metadata: dict[str, Any],
    analysis: dict[str, Any],
) -> tuple[list[str], list[str]]:
    new_keys: list[str] = []
    duplicate_names: list[str] = []
    aliases: dict[str, str] = state['aliases']
    tools: dict[str, dict[str, Any]] = state['tools']
    for item in analysis['items']:
        names = [item['name'], *item['aliases']]
        candidate_keys = [
            canonical_tool_key(name) for name in names if canonical_tool_key(name)
        ]
        existing_key = next(
            (aliases[key] for key in candidate_keys if key in aliases),
            None,
        )
        if existing_key and existing_key in tools:
            existing = tools[existing_key]
            sightings = existing.setdefault('sightings', [])
            if video.video_id not in sightings:
                sightings.append(video.video_id)
            duplicate_names.append(item['name'])
            for key in candidate_keys:
                aliases[key] = existing_key
            continue
        primary = candidate_keys[0] if candidate_keys else hashlib.sha256(
            item['name'].encode()
        ).hexdigest()[:16]
        suffix = 2
        base = primary
        while primary in tools:
            primary = f'{base}{suffix}'
            suffix += 1
        record = {
            **item,
            'first_seen_at': now_iso(),
            'source': {
                'video_id': video.video_id,
                'video_title': str(metadata.get('title') or video.title),
                'channel': video.channel.name,
                'published': (
                    str(metadata.get('upload_date') or video.published)
                ),
                'url': video.url,
            },
            'sightings': [video.video_id],
        }
        tools[primary] = record
        for key in candidate_keys:
            aliases[key] = primary
        aliases[primary] = primary
        new_keys.append(primary)
    return new_keys, duplicate_names


def render_watch_report(state: dict[str, Any]) -> str:
    lines = [
        '# Veille IA — chaînes YouTube',
        '',
        (
            'Rapport cumulatif généré automatiquement depuis les flux RSS, '
            'les métadonnées et les transcripts YouTube.'
        ),
        '',
    ]
    tools: dict[str, dict[str, Any]] = state['tools']
    for report in state['reports']:
        lines.extend([
            (
                f'## {markdown_text(report["analyzed_at"])} — '
                f'{markdown_text(report["channel"])} — '
                f'{markdown_text(report["title"])}'
            ),
            '',
            (
                f'**Source :** [{markdown_text(report["video_id"])}]'
                f'({report["url"]})'
            ),
            '',
        ])
        summary = markdown_text(report.get('summary'))
        if summary:
            lines.extend([summary, ''])
        new_keys = report.get('new_tool_keys', [])
        if not new_keys:
            lines.extend([
                '_Aucune piste inédite : les mentions avaient déjà été '
                'signalées ou la vidéo ne contenait pas de nouveauté '
                'exploitable._',
                '',
            ])
            continue
        lines.extend(['### Nouvelles pistes', ''])
        for key in new_keys:
            item = tools.get(key)
            if not item:
                continue
            lines.extend([
                (
                    f'#### {markdown_text(item["name"])} — '
                    f'{recommendation_label(item["recommendation"])}'
                ),
                '',
                f'- **Type :** `{markdown_text(item["kind"])}`',
                f'- **Ce que ça fait :** {markdown_text(item["what_it_does"])}',
                f'- **Usage :** {markdown_text(item["use_case"])}',
                (
                    f'- **Code Buddy — {item["code_buddy"]["score"]}/10 :** '
                    f'{markdown_text(item["code_buddy"]["reason"])}'
                ),
                (
                    f'- **Pipeline vidéo/média — '
                    f'{item["media"]["score"]}/10 :** '
                    f'{markdown_text(item["media"]["reason"])}'
                ),
                (
                    f'- **Sujet Lisa — {item["lisa_topic"]["score"]}/10 :** '
                    f'{markdown_text(item["lisa_topic"]["reason"])}'
                ),
            ])
            if item.get('source_quote'):
                lines.append(
                    f'- **Signal source :** '
                    f'{markdown_text(item["source_quote"])}'
                )
            lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def render_test_queue(state: dict[str, Any]) -> str:
    candidates = [
        item
        for item in state['tools'].values()
        if item.get('recommendation') == 'a_tester'
    ]
    candidates.sort(
        key=lambda item: (
            max(item['code_buddy']['score'], item['media']['score']),
            item['lisa_topic']['score'],
            item['first_seen_at'],
        ),
        reverse=True,
    )
    lines = [
        '# File d’expérimentation IA',
        '',
        f'_Mise à jour : {now_iso()} — {len(candidates)} piste(s) à tester._',
        '',
    ]
    if not candidates:
        lines.extend([
            'Aucune piste n’est encore classée « à tester ».',
            '',
        ])
    for item in candidates:
        source = item['source']
        reasons = []
        if item['code_buddy']['score'] >= item['media']['score']:
            reasons.append(item['code_buddy']['reason'])
        if item['media']['score'] > 0:
            reasons.append(item['media']['reason'])
        lines.extend([
            (
                f'## {markdown_text(item["name"])} — '
                f'CB {item["code_buddy"]["score"]}/10 · '
                f'Média {item["media"]["score"]}/10'
            ),
            '',
            f'- **Objectif :** {markdown_text(item["use_case"])}',
            f'- **Pourquoi tester :** {markdown_text(" ".join(reasons))}',
            (
                f'- **Signal initial :** {markdown_text(source["channel"])} — '
                f'[{markdown_text(source["video_title"])}]({source["url"]})'
            ),
            f'- **Ajoutée le :** {markdown_text(item["first_seen_at"])}',
            '',
        ])
    return '\n'.join(lines).rstrip() + '\n'


def write_outputs(workdir: Path, state: dict[str, Any]) -> None:
    atomic_write_text(
        workdir / 'VEILLE-IA.md',
        render_watch_report(state),
    )
    atomic_write_text(
        workdir / 'A-TESTER.md',
        render_test_queue(state),
    )


def match_channels(
    channels: tuple[Channel, ...],
    selectors: list[str],
) -> tuple[Channel, ...]:
    enabled = tuple(channel for channel in channels if channel.enabled)
    if not selectors:
        return enabled
    wanted = {selector.casefold() for selector in selectors}
    selected = tuple(
        channel
        for channel in enabled
        if (
            channel.slug.casefold() in wanted
            or channel.channel_id.casefold() in wanted
            or channel.name.casefold() in wanted
        )
    )
    missing = wanted - {
        value.casefold()
        for channel in selected
        for value in (channel.slug, channel.channel_id, channel.name)
    }
    if missing:
        raise ValueError(f'chaîne(s) inconnue(s) : {", ".join(sorted(missing))}')
    return selected


def select_feed_videos(
    channels: tuple[Channel, ...],
    state: dict[str, Any],
    max_videos: int,
    days: int,
    journal_path: Path,
) -> list[Video]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    selected: list[Video] = []
    for channel in channels:
        try:
            feed_videos = fetch_channel_videos(channel)
        except Exception as error:
            append_journal(
                journal_path,
                'feed_error',
                channel=channel.name,
                error=str(error),
            )
            print(f'ERREUR flux {channel.name}: {error}', file=sys.stderr)
            continue
        unseen = []
        for video in feed_videos:
            if video.video_id in state['videos']:
                continue
            published = parse_published(video.published)
            if published is not None and published < cutoff:
                continue
            unseen.append(video)
        # Le flux est antéchronologique. Limiter d'abord aux plus récentes,
        # puis analyser du plus ancien au plus récent pour un rapport lisible.
        selected.extend(reversed(unseen[:max_videos]))
    return selected


def explicit_videos(
    video_ids: list[str],
    channels: tuple[Channel, ...],
) -> list[Video]:
    fallback = channels[0] if channels else DEFAULT_CHANNELS[0]
    return [
        Video(
            video_id,
            f'Vidéo {video_id}',
            f'https://www.youtube.com/watch?v={video_id}',
            '',
            fallback,
        )
        for video_id in dict.fromkeys(video_ids)
    ]


def channel_from_metadata(
    video: Video,
    metadata: dict[str, Any],
    channels: tuple[Channel, ...],
) -> Video:
    channel_id = str(metadata.get('channel_id') or '')
    actual = next(
        (channel for channel in channels if channel.channel_id == channel_id),
        video.channel,
    )
    return Video(
        video.video_id,
        str(metadata.get('title') or video.title),
        video.url,
        str(metadata.get('upload_date') or video.published),
        actual,
    )


def process_video(
    video: Video,
    channels: tuple[Channel, ...],
    state: dict[str, Any],
    workdir: Path,
    yt_dlp: str,
    agy: str,
    model: str,
) -> None:
    journal_path = workdir / 'journal.jsonl'
    print(f'ANALYSE {video.channel.name} — {video.video_id} — {video.title}')
    metadata, transcript = acquire_video(video, yt_dlp)
    video = channel_from_metadata(video, metadata, channels)
    raw_analysis = call_llm(
        analysis_prompt(video, metadata, transcript),
        agy,
        model,
    )
    analysis = normalize_analysis(raw_analysis)
    new_keys, duplicate_names = merge_analysis(
        state,
        video,
        metadata,
        analysis,
    )
    analyzed_at = now_iso()
    state['videos'][video.video_id] = {
        'status': 'analyzed',
        'analyzed_at': analyzed_at,
        'channel': video.channel.name,
        'title': video.title,
        'url': video.url,
        'new_tool_keys': new_keys,
        'duplicate_names': duplicate_names,
        'transcript_sha256': hashlib.sha256(
            transcript.encode('utf-8')
        ).hexdigest(),
        'model': model,
    }
    state['reports'].append({
        'video_id': video.video_id,
        'title': video.title,
        'channel': video.channel.name,
        'url': video.url,
        'analyzed_at': analyzed_at,
        'summary': analysis['video_summary'],
        'new_tool_keys': new_keys,
    })
    atomic_write_json(workdir / 'index.json', state)
    write_outputs(workdir, state)
    append_journal(
        journal_path,
        'video_analyzed',
        video_id=video.video_id,
        channel=video.channel.name,
        new_tools=len(new_keys),
        duplicates=len(duplicate_names),
        model=model,
    )
    print(
        f'OK {video.video_id}: {len(new_keys)} nouvelle(s) piste(s), '
        f'{len(duplicate_names)} doublon(s)'
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--config',
        type=Path,
        default=DEFAULT_CONFIG,
        help=f'configuration YAML (défaut : {DEFAULT_CONFIG})',
    )
    parser.add_argument(
        '--workdir',
        type=Path,
        default=DEFAULT_WORKDIR,
        help=f'répertoire des rapports (défaut : {DEFAULT_WORKDIR})',
    )
    parser.add_argument(
        '--channel',
        action='append',
        default=[],
        help='slug, nom ou channel ID à traiter ; option répétable',
    )
    parser.add_argument(
        '--video-id',
        action='append',
        default=[],
        help='analyse ciblée hors RSS ; option répétable',
    )
    parser.add_argument(
        '--max-videos',
        type=int,
        default=1,
        help='maximum de nouvelles vidéos par chaîne et par passe (défaut : 1)',
    )
    parser.add_argument(
        '--days',
        type=int,
        default=14,
        help='fraîcheur maximale des vidéos RSS en jours (défaut : 14)',
    )
    parser.add_argument(
        '--model',
        default=os.environ.get('VEILLE_YOUTUBE_MODEL', DEFAULT_MODEL),
        help=f'modèle agy gratuit (défaut : {DEFAULT_MODEL})',
    )
    parser.add_argument(
        '--init-config',
        action='store_true',
        help='écrit la configuration par défaut sans écraser un fichier existant',
    )
    parser.add_argument(
        '--list-channels',
        action='store_true',
        help='affiche les chaînes configurées puis quitte',
    )
    parser.add_argument(
        '--status',
        action='store_true',
        help='affiche uniquement le statut local puis quitte',
    )
    args = parser.parse_args(argv)
    args.config = args.config.expanduser()
    args.workdir = args.workdir.expanduser()
    if args.max_videos < 1:
        parser.error('--max-videos doit être supérieur ou égal à 1')
    if args.days < 1:
        parser.error('--days doit être supérieur ou égal à 1')
    if not args.model.casefold().startswith('gemini-'):
        parser.error(
            '--model doit désigner un modèle Gemini fourni par agy ; '
            'les fournisseurs/API payants sont interdits'
        )
    return args


def print_status(workdir: Path, state: dict[str, Any]) -> None:
    tested = sum(
        1
        for item in state['tools'].values()
        if item.get('recommendation') == 'a_tester'
    )
    print(f'Répertoire : {workdir}')
    print(f'Vidéos analysées : {len(state["videos"])}')
    print(f'Outils/nouveautés uniques : {len(state["tools"])}')
    print(f'Pistes à tester : {tested}')
    print(f'Rapport : {workdir / "VEILLE-IA.md"}')
    print(f'File de tests : {workdir / "A-TESTER.md"}')


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.init_config:
        if args.config.exists():
            print(f'SKIP configuration existante : {args.config}')
        else:
            atomic_write_text(args.config, default_config_text())
            print(f'OK configuration créée : {args.config}')
        return 0
    try:
        channels = load_channels(args.config)
        selected_channels = match_channels(channels, args.channel)
    except (OSError, ValueError) as error:
        print(f'Configuration invalide : {error}', file=sys.stderr)
        return 2
    if args.list_channels:
        for index, channel in enumerate(channels, 1):
            status = 'active' if channel.enabled else 'désactivée'
            print(
                f'{index}. {channel.name} [{channel.slug}] '
                f'{channel.channel_id} — {channel.language} — {status}'
            )
        return 0

    args.workdir.mkdir(parents=True, exist_ok=True)
    lock_path = args.workdir / '.veille-youtube.lock'
    with lock_path.open('w', encoding='utf-8') as lock_handle:
        try:
            fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Une veille YouTube est déjà en cours ; arrêt idempotent.')
            return 0
        try:
            state = load_state(args.workdir / 'index.json')
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(f'Index invalide : {error}', file=sys.stderr)
            return 2
        write_outputs(args.workdir, state)
        if args.status:
            print_status(args.workdir, state)
            return 0
        try:
            yt_dlp = resolve_binary('YTDLP_BIN', 'yt-dlp')
            agy = resolve_binary('AGY_BIN', 'agy')
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            return 2
        journal_path = args.workdir / 'journal.jsonl'
        if args.video_id:
            candidates = explicit_videos(args.video_id, selected_channels)
        else:
            candidates = select_feed_videos(
                selected_channels,
                state,
                args.max_videos,
                args.days,
                journal_path,
            )
        candidates = [
            video
            for video in candidates
            if video.video_id not in state['videos']
        ]
        if not candidates:
            append_journal(journal_path, 'nothing_to_do')
            print('Aucune nouvelle vidéo à analyser.')
            print_status(args.workdir, state)
            return 0
        failures = 0
        for video in candidates:
            try:
                process_video(
                    video,
                    channels,
                    state,
                    args.workdir,
                    yt_dlp,
                    agy,
                    args.model,
                )
            except Exception as error:
                failures += 1
                append_journal(
                    journal_path,
                    'video_error',
                    video_id=video.video_id,
                    channel=video.channel.name,
                    error=str(error),
                )
                print(
                    f'ERREUR {video.video_id}: {error}',
                    file=sys.stderr,
                )
        write_outputs(args.workdir, state)
        print_status(args.workdir, state)
        return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
