#!/usr/bin/env python3
"""Pipeline long format « Lisa présentatrice » avec lipsync HeyGen.

Le script consomme le ``*.script.md`` long format déjà utilisé par Lisa. Quand
un ``work/plan.json`` voisin existe, il est préféré car il contient les ids,
durées, sources et phases éditoriales. Les voix existantes sous ``work/voice``
sont toujours réutilisées ; aucune synthèse ElevenLabs n'est lancée ici.

Exemples :

    # Inventaire non facturé du compte HeyGen
    python3 scripts/influencer/lisa-presentatrice.py inventaire \
      --sortie /tmp/heygen-inventaire.json

    # Prévisualiser le découpage sans appel facturé
    python3 scripts/influencer/lisa-presentatrice.py plan \
      video.script.md --limite-sections 2 --sortie /tmp/lisa-plan

    # Produire les deux premières sections
    python3 scripts/influencer/lisa-presentatrice.py produire \
      video.script.md --limite-sections 2 --sortie /tmp/lisa-demo

Principes :
- accroche, plan, transitions numérotées et conclusion : Lisa face caméra ;
- les faits détaillés : plans de coupe, avec la même voix en continu ;
- les sections face caméra consécutives partagent un seul rendu HeyGen ;
- le budget est réservé avant chaque génération, puis mesuré avant/après ;
- les scènes validées sont seulement lues. Tous les dérivés vont dans ``sortie``.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from typing import Any, Sequence
import urllib.error
import urllib.parse
import urllib.request
import uuid

from video_delivery_qc import (
    DeliveryQCError,
    assert_no_production_markers,
    master_video_audio,
    write_qc_sidecar,
)

ROOT = Path(__file__).resolve().parents[2]
MEDIA_ENV = Path('~/.codebuddy/media.env').expanduser()
ELEVEN_USAGE = Path('~/.codebuddy/elevenlabs-voice-usage.json').expanduser()
ELEVEN_MONTHLY_CAP = 200_000
LISA_VOICE_ID = '3fxbs2pB9bs8S6Z1N38A'
DEFAULT_AVATAR_ID = '4507aec10b6f4cdbab4262180308bb69'
DEFAULT_AVATAR_PREVIEW_TOKEN = 'ca66500fbb7f4abf8a43e5d413753cc5'
DEFAULT_MUSIC = (
    Path('~/.codebuddy/media-audio/music/elegant').expanduser()
    / 'ES_Somewhat Elegant - Dye O.mp3'
)
VALIDATED_SCENES = (
    Path('~/Videos/personas/lisa-scenes/reportage-japon').expanduser()
)
TECH_COMPOSITES = (
    Path('~/Videos/personas/lisa-scenes/tech-composites').expanduser()
)
TALKING_PHOTOS = (
    Path('~/.codebuddy/personas/lisa/talking-photos.json').expanduser()
)
VISUAL_GATE = ROOT / 'scripts/influencer/visual-gate.py'
HEYGEN_BASE = 'https://api.heygen.com'
SECTION_CROSSFADE = 0.25
DEFAULT_ESTIMATED_CALL_CREDITS = 20
DEFAULT_MIN_PRESENTER_SECONDS = 4.0
DEFAULT_MAX_PRESENTER_SECONDS = 8.0
DEFAULT_IDENTITY_TARGET = 0.75
VIDEO_WIDTH = 1920
VIDEO_HEIGHT = 1080
VIDEO_FPS = 30
IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp'}
VIDEO_SUFFIXES = {'.mp4', '.mov', '.mkv', '.webm'}


class PipelineError(RuntimeError):
    """Erreur explicite et sûre du pipeline."""


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    temporary.replace(path)


def now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def run(command: Sequence[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(command),
            check=True,
            text=True,
            capture_output=capture,
        )
    except FileNotFoundError as error:
        raise PipelineError(f'commande introuvable : {command[0]}') from error
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or '').strip()[-1200:]
        raise PipelineError(
            f'échec commande {command[0]} ({error.returncode})'
            + (f' : {details}' if details else '')
        ) from error


def media_duration(path: Path) -> float:
    result = run(
        [
            'ffprobe',
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            str(path),
        ],
        capture=True,
    )
    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise PipelineError(f'durée illisible : {path}') from error
    if duration <= 0:
        raise PipelineError(f'durée invalide : {path}')
    return duration


def media_matches(path: Path, expected: float, tolerance: float = 0.6) -> bool:
    if not path.exists() or path.stat().st_size < 1024:
        return False
    try:
        return abs(media_duration(path) - expected) <= tolerance
    except PipelineError:
        return False


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as error:
        raise PipelineError(f'configuration illisible : {path}') from error
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip()
    return values


def require_voice_budget_state() -> dict[str, Any]:
    """Lit le compteur avant toute résolution de voix, même en pur cache."""
    try:
        usage = json.loads(ELEVEN_USAGE.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(
            f'compteur ElevenLabs absent ou illisible : {ELEVEN_USAGE}'
        ) from error
    characters = usage.get('characters')
    if not isinstance(characters, int) or characters < 0:
        raise PipelineError('compteur ElevenLabs invalide')
    if characters > ELEVEN_MONTHLY_CAP:
        raise PipelineError(
            f'plafond ElevenLabs déjà dépassé : {characters}/{ELEVEN_MONTHLY_CAP}'
        )
    return {
        'month': usage.get('month'),
        'characters': characters,
        'cap': ELEVEN_MONTHLY_CAP,
        'network_characters': 0,
    }


def slugify(value: str) -> str:
    normalized = value.lower()
    normalized = re.sub(r'[^a-z0-9à-ÿ]+', '-', normalized)
    return normalized.strip('-') or 'section'


def parse_markdown_sections(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding='utf-8')
    matches = list(re.finditer(r'^##\s+(.+?)\s*$', text, re.MULTILINE))
    sections: list[dict[str, Any]] = []
    for index, match in enumerate(matches, start=1):
        end = matches[index].start() if index < len(matches) else len(text)
        body = text[match.end():end].strip()
        body = re.sub(r'\n{2,}', '\n\n', body)
        if not body:
            continue
        title = match.group(1).strip()
        sections.append(
            {
                'id': f'{index:02d}-{slugify(title)}',
                'phase': '',
                'titre': title,
                'texte': body.replace('\n', ' ').strip(),
                'source_id': 'synthese',
            }
        )
    if not sections:
        raise PipelineError(f'aucune section ## trouvée dans {path}')
    return sections


def find_plan_json(script_path: Path) -> Path | None:
    candidates = (
        script_path.parent / 'work' / 'plan.json',
        script_path.parent / 'plan.json',
    )
    return next((candidate for candidate in candidates if candidate.exists()), None)


def load_sections(script_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    plan_path = find_plan_json(script_path)
    if plan_path is None:
        return parse_markdown_sections(script_path), {'sources': {}}
    try:
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(f'plan illisible : {plan_path}') from error
    raw_sections = plan.get('sections')
    if not isinstance(raw_sections, list) or not raw_sections:
        raise PipelineError(f'plan sans sections : {plan_path}')
    sections: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_sections:
        if not isinstance(raw, dict):
            raise PipelineError('section de plan invalide')
        section_id = raw.get('id')
        text = raw.get('texte')
        if not isinstance(section_id, str) or not section_id or section_id in seen:
            raise PipelineError(f'id de section invalide ou dupliqué : {section_id!r}')
        if not isinstance(text, str) or not text.strip():
            raise PipelineError(f'texte vide : {section_id}')
        seen.add(section_id)
        sections.append(dict(raw))
    return sections, plan


def classify_section(section: dict[str, Any], index: int, total: int) -> dict[str, str]:
    phase = str(section.get('phase', '')).lower()
    title = str(section.get('titre', '')).lower()
    text = str(section.get('texte', '')).lower()
    if index == 0 or phase in {'hook', 'accroche'}:
        return {'mode': 'presenter', 'raison': 'accroche face caméra'}
    if phase == 'plan' or title in {'le plan', 'plan'}:
        return {'mode': 'presenter', 'raison': 'annonce du plan face caméra'}
    if (
        index == total - 1
        or phase in {'outro', 'conclusion'}
        or 'conclusion' in title
        or 'fil rouge' in title
    ):
        return {'mode': 'presenter', 'raison': 'conclusion face caméra'}
    if (
        re.match(r'^\s*\d+[.)]', str(section.get('titre', '')))
        or re.match(
            r'^(premier|deuxième|troisième|quatrième|cinquième)\s+signal',
            text,
        )
    ):
        return {
            'mode': 'hybride',
            'raison': 'transition face caméra puis faits en plans de coupe',
        }
    return {'mode': 'broll', 'raison': 'faits détaillés en plans de coupe'}


def enrich_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        item = dict(section)
        item.update(classify_section(section, index, len(sections)))
        enriched.append(item)
    return enriched


def resolve_voice_dir(script_path: Path, explicit: Path | None) -> Path:
    if explicit:
        return explicit.expanduser().resolve()
    candidates = (
        script_path.parent / 'work' / 'voice',
        script_path.parent / 'voice',
    )
    directory = next((candidate for candidate in candidates if candidate.is_dir()), None)
    if directory is None:
        raise PipelineError(
            'dossier de voix introuvable ; fournir --dossier-voix. '
            'Ce pipeline ne lance jamais une synthèse implicitement.'
        )
    return directory


def attach_audio(
    sections: list[dict[str, Any]],
    voice_dir: Path,
) -> None:
    for section in sections:
        candidates = (
            voice_dir / f'{section["id"]}.mp3',
            voice_dir / f'{section["id"]}.wav',
        )
        audio = next((candidate for candidate in candidates if candidate.exists()), None)
        if audio is None:
            raise PipelineError(
                f'voix manquante pour {section["id"]}; '
                'aucune synthèse ElevenLabs automatique'
            )
        section['audio_path'] = str(audio.resolve())
        section['audio_duration'] = media_duration(audio)


def section_timeline(sections: list[dict[str, Any]]) -> list[dict[str, float]]:
    timeline: list[dict[str, float]] = []
    cursor = 0.0
    for index, section in enumerate(sections):
        duration = float(section['audio_duration'])
        displayed = duration
        if index < len(sections) - 1:
            displayed -= SECTION_CROSSFADE
        timeline.append(
            {
                'start': cursor,
                'end': cursor + displayed,
                'duration': displayed,
                'source_duration': duration,
            }
        )
        cursor += displayed
    return timeline


def concat_audio(paths: list[Path], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if len(paths) == 1:
        run(
            [
                'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                '-i', str(paths[0]), '-c:a', 'libmp3lame', '-b:a', '192k',
                '-ar', '48000', str(destination),
            ]
        )
        return
    inputs: list[str] = []
    for path in paths:
        inputs.extend(['-i', str(path)])
    current = '[0:a]'
    filters: list[str] = []
    for index in range(1, len(paths)):
        output = f'[a{index}]'
        filters.append(
            f'{current}[{index}:a]acrossfade=d={SECTION_CROSSFADE}:'
            f'c1=tri:c2=tri{output}'
        )
        current = output
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            *inputs,
            '-filter_complex', ';'.join(filters),
            '-map', current,
            '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000',
            str(destination),
        ]
    )


def group_presenter_runs(sections: list[dict[str, Any]]) -> list[list[int]]:
    groups: list[list[int]] = []
    current: list[int] = []
    for index, section in enumerate(sections):
        if section['mode'] in {'presenter', 'hybride'}:
            current.append(index)
        elif current:
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def subtitle_chunks(text: str, max_words: int = 11) -> list[str]:
    chunks: list[str] = []
    for sentence in re.split(r'(?<=[.!?])\s+', text.strip()):
        words = sentence.split()
        while len(words) > max_words:
            split_at = max_words
            for candidate in range(max_words - 1, max(4, max_words - 5), -1):
                if words[candidate - 1].endswith((',', ';', ':')):
                    split_at = candidate
                    break
            chunks.append(' '.join(words[:split_at]))
            words = words[split_at:]
        if words:
            chunks.append(' '.join(words))
    return chunks


def srt_time(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, rem = divmod(milliseconds, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f'{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}'


def ass_time(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours, rem = divmod(centiseconds, 360_000)
    minutes, rem = divmod(rem, 6000)
    secs, cs = divmod(rem, 100)
    return f'{hours}:{minutes:02d}:{secs:02d}.{cs:02d}'


def make_subtitles(
    sections: list[dict[str, Any]],
    timeline: list[dict[str, float]],
    sources: dict[str, Any],
    srt_path: Path,
    ass_path: Path,
) -> None:
    srt_lines: list[str] = []
    events: list[str] = []
    cue = 1
    for section, timing in zip(sections, timeline):
        chunks = subtitle_chunks(str(section['texte']))
        weights = [max(1, len(chunk.replace(' ', ''))) for chunk in chunks]
        total_weight = sum(weights)
        cursor = timing['start'] + 0.08
        usable = max(0.5, timing['duration'] - 0.16)
        for index, (chunk, weight) in enumerate(zip(chunks, weights)):
            chunk_duration = usable * weight / total_weight
            end = (
                timing['end'] - 0.08
                if index == len(chunks) - 1
                else cursor + chunk_duration
            )
            srt_lines.extend(
                [
                    str(cue),
                    f'{srt_time(cursor)} --> {srt_time(end)}',
                    chunk,
                    '',
                ]
            )
            safe_chunk = chunk.replace('{', '').replace('}', '')
            events.append(
                f'Dialogue: 0,{ass_time(cursor)},{ass_time(end)},'
                f'Sub,,0,0,0,,{safe_chunk}'
            )
            cursor = end
            cue += 1
        source = sources.get(section.get('source_id'), {})
        label = str(source.get('label', 'Synthèse éditoriale'))
        source_text = f'Source : {label}'.replace('{', '').replace('}', '')
        events.append(
            f'Dialogue: 1,{ass_time(timing["start"] + 0.15)},'
            f'{ass_time(timing["end"] - 0.15)},Source,,0,0,0,,{source_text}'
        )
    total = timeline[-1]['end']
    events.extend(
        [
            'Dialogue: 2,0:00:00.20,0:00:06.00,Virtual,,0,0,0,,'
            'LISA IA • CRÉATRICE VIRTUELLE',
            f'Dialogue: 2,{ass_time(max(0, total - 5))},{ass_time(total)},'
            'Virtual,,0,0,0,,LISA IA • CRÉATRICE VIRTUELLE',
        ]
    )
    srt_path.write_text('\n'.join(srt_lines), encoding='utf-8')
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H00101824,&H8A071018,-1,0,0,0,100,100,0,0,3,3,0,2,220,220,62,1
Style: Source,DejaVu Sans,24,&H00D8E4F0,&H00D8E4F0,&H00101824,&H76071018,0,0,0,0,100,100,0,0,3,2,0,7,46,46,36,1
Style: Virtual,DejaVu Sans,26,&H00A9E1FF,&H00A9E1FF,&H00101824,&H76071018,-1,0,0,0,100,100,0,0,3,2,0,9,46,46,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ass_path.write_text(header + '\n'.join(events) + '\n', encoding='utf-8')


class HeyGen:
    def __init__(self, api_key: str, ledger_path: Path, cap: int, estimated: int):
        if not api_key:
            raise PipelineError('HEYGEN_API_KEY absente')
        self.api_key = api_key
        self.ledger_path = ledger_path
        self.cap = cap
        self.estimated = estimated
        self.ledger = self._load_ledger()

    def _load_ledger(self) -> dict[str, Any]:
        if self.ledger_path.exists():
            try:
                value = json.loads(self.ledger_path.read_text(encoding='utf-8'))
            except (OSError, json.JSONDecodeError) as error:
                raise PipelineError(f'journal HeyGen illisible : {self.ledger_path}') from error
            if not isinstance(value, dict):
                raise PipelineError('journal HeyGen invalide')
            return value
        return {
            'version': 1,
            'created_at': now_iso(),
            'cap_credits': self.cap,
            'estimated_credits_per_generation': self.estimated,
            'calls': [],
            'generations': [],
        }

    def save(self) -> None:
        self.ledger['updated_at'] = now_iso()
        atomic_json(self.ledger_path, self.ledger)

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        body: bytes | None = None,
        content_type: str | None = None,
        timeout: int = 60,
    ) -> dict[str, Any]:
        url = HEYGEN_BASE + path
        encoded = body
        headers = {'x-api-key': self.api_key}
        if payload is not None:
            encoded = json.dumps(payload).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        elif content_type:
            headers['Content-Type'] = content_type
        request = urllib.request.Request(
            url,
            data=encoded,
            headers=headers,
            method=method,
        )
        started = now_iso()
        status = 0
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        except urllib.error.URLError as error:
            self._log_call(method, path, started, 0, False)
            raise PipelineError(f'HeyGen inaccessible : {error.reason}') from error
        try:
            value = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            value = {'raw': raw.decode('utf-8', errors='replace')[:500]}
        ok = 200 <= status < 300
        self._log_call(method, path, started, status, ok)
        if not ok:
            error = value.get('error') if isinstance(value, dict) else None
            message = error.get('message') if isinstance(error, dict) else value
            raise PipelineError(f'HeyGen HTTP {status} sur {path} : {message}')
        if not isinstance(value, dict):
            raise PipelineError(f'réponse HeyGen invalide sur {path}')
        return value

    def _log_call(
        self,
        method: str,
        path: str,
        started: str,
        status: int,
        ok: bool,
    ) -> None:
        self.ledger['calls'].append(
            {
                'at': started,
                'method': method,
                'endpoint': path.split('?', 1)[0],
                'status': status,
                'ok': ok,
            }
        )
        self.save()

    def quota(self) -> int:
        last_error: PipelineError | None = None
        value: dict[str, Any] | None = None
        for attempt in range(5):
            try:
                value = self.request('GET', '/v2/user/remaining_quota')
                break
            except PipelineError as error:
                last_error = error
                if attempt == 4:
                    raise
                time.sleep(2 + attempt * 2)
        if value is None:
            raise last_error or PipelineError('solde HeyGen indisponible')
        details = value.get('data', {}).get('details', {})
        plan_credit = details.get('plan_credit')
        if not isinstance(plan_credit, (int, float)):
            raise PipelineError('HeyGen ne retourne pas plan_credit')
        return int(plan_credit)

    def spent(self) -> int:
        total = 0
        for item in self.ledger.get('generations', []):
            actual = item.get('actual_credits')
            if isinstance(actual, int) and actual >= 0:
                total += actual
            elif item.get('status') in {'reserved', 'submitted', 'processing'}:
                total += int(item.get('reserved_credits', self.estimated))
        return total

    def reserve(self, name: str) -> tuple[dict[str, Any], int]:
        before = self.quota()
        if self.estimated <= 0:
            raise PipelineError('réserve HeyGen invalide')
        if self.spent() + self.estimated > self.cap:
            raise PipelineError(
                f'plafond HeyGen refusé avant appel : {self.spent()} + '
                f'{self.estimated} > {self.cap}'
            )
        if before < self.estimated:
            raise PipelineError(
                f'crédits HeyGen insuffisants : {before} < réserve {self.estimated}'
            )
        item = {
            'name': name,
            'status': 'reserved',
            'reserved_at': now_iso(),
            'reserved_credits': self.estimated,
            'before_plan_credits': before,
            'actual_credits': None,
        }
        self.ledger['generations'].append(item)
        self.save()
        return item, before

    def settle(self, item: dict[str, Any], status: str) -> int:
        after = self.quota()
        before = int(item['before_plan_credits'])
        actual = max(0, before - after)
        item.update(
            {
                'status': status,
                'settled_at': now_iso(),
                'after_plan_credits': after,
                'actual_credits': actual,
            }
        )
        self.save()
        if self.spent() > self.cap:
            raise PipelineError(
                f'plafond HeyGen dépassé après mesure : {self.spent()} > {self.cap}; '
                'aucun autre appel ne sera lancé'
            )
        return actual

    def upload_asset(self, path: Path) -> str:
        boundary = f'----LisaPresenter{uuid.uuid4().hex}'
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        prefix = (
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
            f'Content-Type: {mime}\r\n\r\n'
        ).encode('utf-8')
        suffix = f'\r\n--{boundary}--\r\n'.encode('utf-8')
        body = prefix + path.read_bytes() + suffix
        value = self.request(
            'POST',
            '/v3/assets',
            body=body,
            content_type=f'multipart/form-data; boundary={boundary}',
            timeout=120,
        )
        asset_id = value.get('data', {}).get('asset_id')
        if not isinstance(asset_id, str) or not asset_id:
            raise PipelineError('asset_id HeyGen absent')
        return asset_id

    def generate(
        self,
        audio_path: Path,
        destination: Path,
        *,
        avatar_id: str,
        title: str,
        poll_seconds: int,
    ) -> dict[str, Any]:
        destination.parent.mkdir(parents=True, exist_ok=True)
        asset_id = self.upload_asset(audio_path)
        item, _ = self.reserve(title)
        try:
            value = self.request(
                'POST',
                '/v3/videos',
                payload={
                    'type': 'avatar',
                    'avatar_id': avatar_id,
                    'title': title,
                    'resolution': '1080p',
                    'aspect_ratio': '16:9',
                    'fit': 'contain',
                    'audio_asset_id': asset_id,
                    'output_format': 'mp4',
                    'engine': {'type': 'avatar_iv'},
                    'expressiveness': 'low',
                },
                timeout=120,
            )
        except PipelineError:
            self.settle(item, 'failed')
            raise
        data = value.get('data', {})
        video_id = data.get('id') or data.get('video_id')
        if not isinstance(video_id, str) or not video_id:
            self.settle(item, 'failed')
            raise PipelineError('video_id HeyGen absent')
        item.update({'status': 'submitted', 'video_id': video_id})
        self.save()
        deadline = time.monotonic() + poll_seconds
        last_status = 'submitted'
        while time.monotonic() < deadline:
            details = self.request('GET', f'/v3/videos/{video_id}', timeout=30)
            video = details.get('data', {})
            status = str(video.get('status', '')).lower()
            last_status = status or last_status
            item['status'] = last_status
            self.save()
            if status == 'completed':
                video_url = video.get('video_url')
                if not isinstance(video_url, str) or not video_url:
                    self.settle(item, 'failed')
                    raise PipelineError('URL vidéo HeyGen absente')
                download(video_url, destination)
                actual = self.settle(item, 'completed')
                return {
                    'video_id': video_id,
                    'actual_credits': actual,
                    'duration': video.get('duration'),
                }
            if status == 'failed':
                self.settle(item, 'failed')
                raise PipelineError(f'génération HeyGen échouée : {video.get("failure")}')
            time.sleep(12)
        self.settle(item, 'timeout')
        raise PipelineError(f'timeout HeyGen après {poll_seconds}s ({last_status})')

    def generate_ui(
        self,
        audio_path: Path,
        destination: Path,
        *,
        avatar_id: str,
        title: str,
        poll_seconds: int,
        avatar_preview_token: str = DEFAULT_AVATAR_PREVIEW_TOKEN,
    ) -> dict[str, Any]:
        """Génère via Avatar Shots, qui consomme les crédits du plan mensuel."""
        helper_path = ROOT / 'scripts/influencer/heygen-batch.py'
        spec = importlib.util.spec_from_file_location('lisa_heygen_batch', helper_path)
        if spec is None or spec.loader is None:
            raise PipelineError(f'aide HeyGen impossible à charger : {helper_path}')
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        client = helper.connect()
        select_talking_photo_ui(client, avatar_id)
        ensure_ui_landscape(client)
        visible_images_raw = client.ev(
            "JSON.stringify([...document.querySelectorAll('img')]"
            ".map(i=>i.currentSrc||i.src).filter(Boolean))"
        ) or '[]'
        try:
            visible_images = json.loads(visible_images_raw)
        except json.JSONDecodeError as error:
            raise PipelineError('préflight avatar UI HeyGen illisible') from error
        selected_state = client.ev(
            "localStorage.getItem('pacific/GLOBAL_AVATAR_STATE')"
        ) or ''
        preview_visible = any(
            avatar_preview_token in str(value)
            for value in visible_images
        )
        if not preview_visible and avatar_id not in selected_state:
            raise PipelineError(
                'le look Lisa canonique n’est pas sélectionné dans Avatar Shots ; '
                'arrêt avant dépense'
            )
        icons = client.ev(
            "JSON.stringify([...document.querySelectorAll('use')]"
            ".map(u=>u.getAttribute('href')).filter(Boolean))"
        ) or '[]'
        if '#landscape-phone' not in json.loads(icons):
            raise PipelineError(
                'le format paysage n’est pas sélectionné dans Avatar Shots ; '
                'arrêt avant dépense'
            )

        def sources() -> list[str]:
            raw = client.ev(
                "JSON.stringify([...document.querySelectorAll('video')]"
                ".map(v=>v.currentSrc||v.src).filter(Boolean))"
            ) or '[]'
            return [str(value) for value in json.loads(raw)]

        before_sources = {
            urllib.parse.urlsplit(value)._replace(query='', fragment='').geturl()
            for value in sources()
        }
        item, _ = self.reserve(title)
        try:
            submitted = helper.submit(str(audio_path), slugify(title)[-48:])
            if not submitted:
                self.settle(item, 'failed')
                raise PipelineError('HeyGen UI n’a pas confirmé le lancement')
        except (AssertionError, SystemExit, OSError) as error:
            self.settle(item, 'failed')
            raise PipelineError(f'échec soumission HeyGen UI : {error}') from error
        item['status'] = 'submitted'
        self.save()

        deadline = time.monotonic() + poll_seconds
        new_source: str | None = None
        while time.monotonic() < deadline:
            client = helper.connect()
            current_sources = sources()
            for value in current_sources:
                canonical = (
                    urllib.parse.urlsplit(value)
                    ._replace(query='', fragment='')
                    .geturl()
                )
                if canonical not in before_sources:
                    new_source = value
                    break
            if new_source:
                break
            body = helper.body_text(client)
            if re.search(r'failed|generation failed|try again', body, re.I):
                self.settle(item, 'failed')
                raise PipelineError('HeyGen UI signale un échec de génération')
            item['status'] = (
                'processing'
                if re.search(r'is generating|generating', body, re.I)
                else 'waiting'
            )
            self.save()
            time.sleep(12)
        if not new_source:
            self.settle(item, 'timeout')
            raise PipelineError(f'timeout HeyGen UI après {poll_seconds}s')

        client.s.settimeout(240)
        expression = f"""(async()=>{{
          const response=await fetch({json.dumps(new_source)});
          if (!response.ok) throw new Error('HTTP '+response.status);
          const bytes=new Uint8Array(await response.arrayBuffer());
          let binary='';
          for (let i=0;i<bytes.length;i+=32768)
            binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));
          return btoa(binary);
        }})()"""
        fetched = client.cmd(
            'Runtime.evaluate',
            {
                'expression': expression,
                'awaitPromise': True,
                'returnByValue': True,
            },
            to=240,
        )
        encoded = (
            (fetched or {})
            .get('result', {})
            .get('result', {})
            .get('value')
        )
        if not isinstance(encoded, str) or not encoded:
            self.settle(item, 'download_failed')
            raise PipelineError('téléchargement du rendu HeyGen UI impossible')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(base64.b64decode(encoded))
        if destination.stat().st_size < 1024:
            self.settle(item, 'download_failed')
            raise PipelineError('rendu HeyGen UI vide')
        actual = self.settle(item, 'completed')
        item['source_kind'] = 'avatar-shots-plan'
        self.save()
        return {
            'video_id': None,
            'actual_credits': actual,
            'duration': media_duration(destination),
        }


def talking_photo(avatar_id: str) -> dict[str, Any]:
    try:
        registry = json.loads(TALKING_PHOTOS.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(
            f'registre de talking photos illisible : {TALKING_PHOTOS}'
        ) from error
    for item in registry.get('talking_photos', []):
        if not isinstance(item, dict):
            continue
        identifier = item.get('talking_photo_id') or item.get('avatar_id')
        if identifier == avatar_id:
            return item
    raise PipelineError(f'talking photo Lisa inconnue : {avatar_id}')


def select_talking_photo_ui(client: Any, avatar_id: str) -> None:
    def close_dialog() -> None:
        for _ in range(3):
            closed = client.ev(
                """(()=>{
                  const dialog=document.querySelector('[role="dialog"]');
                  const button=dialog&&[...dialog.querySelectorAll('button')]
                    .find(e=>(e.innerText||'').trim()==='Close');
                  if(!button)return false;
                  button.click();
                  return true;
                })()"""
            )
            if not closed:
                return
            time.sleep(0.5)

    page_url = 'https://app.heygen.com/avatar/avatar-shots'
    if client.ev('location.href') != page_url:
        client.cmd('Page.navigate', {'url': page_url})
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        ready = client.ev(
            """Boolean([...document.querySelectorAll('img')]
              .filter(i=>!i.closest('[role="dialog"]'))
              .some(i=>(i.currentSrc||i.src)
                .includes("""
            + json.dumps(avatar_id)
            + ')))'
        )
        if ready:
            close_dialog()
            return

        # État normal : un présentateur est déjà chargé.
        client.ev(
            """(()=>{
              const element=[...document.querySelectorAll('button,[role="button"]')]
                .find(e=>(e.innerText||'').trim()==='Switch look');
              if(!element)return false;
              element.click();
              return true;
            })()"""
        )

        # Après certains rechargements HeyGen perd le présentateur courant.
        # Ouvrir alors Choose Avatar, puis le groupe Lisa récemment utilisé.
        client.ev(
            """(()=>{
              if(document.querySelector('[role="dialog"]'))return false;
              const use=document.querySelector('use[href="#add-avatar"]');
              const element=use&&use.closest('[role="button"]');
              if(!element)return false;
              element.click();
              return true;
            })()"""
        )
        client.ev(
            """(()=>{
              const tab=[...document.querySelectorAll('[role="dialog"] [role="tab"]')]
                .find(e=>(e.innerText||'').trim()==='Recently Used');
              if(!tab || tab.getAttribute('aria-selected')==='true')return false;
              tab.click();
              return true;
            })()"""
        )
        client.ev(
            """(()=>{
              const label=[...document.querySelectorAll('[role="dialog"] *')]
                .find(e=>(e.innerText||'').trim()==='lisa-tokyo-salon');
              if(!label)return false;
              let element=label;
              while(element && element!==document.body) {
                if(element.matches('[role="button"]')
                    || (element.className||'').includes('tw-cursor-pointer'))break;
                element=element.parentElement;
              }
              (element||label).click();
              return true;
            })()"""
        )

        # Le sélecteur rend d'abord des squelettes ; les talking photos peuvent
        # mettre une quarantaine de secondes à apparaître.
        selected = client.ev(
            f"""(()=>{{
              const image=[...document.querySelectorAll('[role="dialog"] img')]
                .find(i=>(i.currentSrc||i.src).includes({json.dumps(avatar_id)}));
              if(!image)return false;
              let element=image;
              while(element && element!==document.body) {{
                if((element.className||'').includes('tw-cursor-pointer'))break;
                element=element.parentElement;
              }}
              (element||image).click();
              return true;
            }})()"""
        )
        if selected:
            break
        time.sleep(2)
    else:
        raise PipelineError(
            f'look Lisa {avatar_id} introuvable dans Switch look'
        )

    verify_deadline = time.monotonic() + 15
    while time.monotonic() < verify_deadline:
        visible = client.ev(
            """JSON.stringify([...document.querySelectorAll('img')]
              .filter(i=>{
                const r=i.getBoundingClientRect();
                return r.width>50 && r.height>50 && !i.closest('[role="dialog"]');
              }).map(i=>i.currentSrc||i.src).filter(Boolean))"""
        ) or '[]'
        if any(avatar_id in str(value) for value in json.loads(visible)):
            close_dialog()
            return
        time.sleep(1)
    raise PipelineError(
        f'aperçu HeyGen différent du look Lisa demandé ({avatar_id})'
    )


def dispatch_click(client: Any, x: float, y: float) -> None:
    for event_type in ('mousePressed', 'mouseReleased'):
        client.cmd(
            'Input.dispatchMouseEvent',
            {
                'type': event_type,
                'x': x,
                'y': y,
                'button': 'left',
                'clickCount': 1,
            },
        )


def ensure_ui_landscape(client: Any) -> None:
    deadline = time.monotonic() + 30
    raw = None
    while time.monotonic() < deadline:
        if client.ev(
            "Boolean(document.querySelector('use[href=\"#landscape-phone\"]'))"
        ):
            return
        raw = client.ev(
            """(()=>{
              const use=document.querySelector('use[href="#portrait-phone"]');
              const element=use&&use.closest('[aria-haspopup="menu"]');
              if(!element)return null;
              const rect=element.getBoundingClientRect();
              return JSON.stringify({x:rect.x+rect.width/2,y:rect.y+rect.height/2});
            })()"""
        )
        if raw:
            break
        time.sleep(1)
    if not raw:
        raise PipelineError('sélecteur portrait/paysage HeyGen introuvable')
    point = json.loads(raw)
    dispatch_click(client, float(point['x']), float(point['y']))
    raw = None
    option_deadline = time.monotonic() + 10
    while time.monotonic() < option_deadline:
        raw = client.ev(
            """(()=>{
              const item=[...document.querySelectorAll('[role="menuitem"]')]
                .find(e=>(e.innerText||'').trim()==='Landscape');
              if(!item)return null;
              const rect=item.getBoundingClientRect();
              return JSON.stringify({x:rect.x+rect.width/2,y:rect.y+rect.height/2});
            })()"""
        )
        if raw:
            break
        time.sleep(0.5)
    if not raw:
        raise PipelineError('option Landscape HeyGen introuvable')
    point = json.loads(raw)
    dispatch_click(client, float(point['x']), float(point['y']))
    verify_deadline = time.monotonic() + 10
    while time.monotonic() < verify_deadline:
        if client.ev(
            "Boolean(document.querySelector('use[href=\"#landscape-phone\"]'))"
        ):
            return
        time.sleep(0.5)
    raise PipelineError('HeyGen n’a pas conservé le format paysage')


def identity_reference(avatar_id: str, explicit: Path | None) -> Path:
    if explicit is not None:
        reference = explicit.expanduser().resolve()
    else:
        raw = talking_photo(avatar_id).get('prepared_path')
        if not isinstance(raw, str) or not raw:
            raise PipelineError(
                f'image source absente du registre pour {avatar_id}'
            )
        reference = Path(raw).expanduser().resolve()
    if not reference.is_file():
        raise PipelineError(f'référence identité introuvable : {reference}')
    return reference


def validate_presenter_runs(
    sections: list[dict[str, Any]],
    runs: list[list[int]],
    minimum: float,
    maximum: float,
) -> None:
    if minimum <= 0 or maximum < minimum:
        raise PipelineError('bornes de prises face caméra invalides')
    for run_index, indices in enumerate(runs, start=1):
        duration = sum(
            float(sections[index]['audio_duration'])
            for index in indices
        )
        duration -= SECTION_CROSSFADE * max(0, len(indices) - 1)
        if duration < minimum or duration > maximum:
            ids = ', '.join(str(sections[index]['id']) for index in indices)
            raise PipelineError(
                f'prise face caméra {run_index} hors contrainte '
                f'{minimum:g}–{maximum:g} s : {duration:.3f} s ({ids})'
            )


def identity_quality(
    video: Path,
    reference: Path,
    output: Path,
    target: float,
) -> dict[str, Any]:
    journal = output / 'arcface-segments.jsonl'
    csv_journal = output / 'arcface-segments.csv'
    command = [
        'uv',
        'run',
        '--python',
        '3.11',
        '--with',
        'numpy<2',
        '--with',
        'insightface==0.7.3',
        '--with',
        'opencv-python-headless',
        '--with',
        'scipy',
        '--with',
        'scikit-image',
        '--with',
        'scikit-learn',
        '--with',
        'onnxruntime',
        'python',
        str(VISUAL_GATE),
        str(video),
        '--persona',
        'lisa',
        '--reference',
        str(reference),
        '--frames',
        '5',
        '--force',
        '--no-llm',
        '--journal',
        str(journal),
        '--csv-journal',
        str(csv_journal),
    ]
    run(command)
    sidecar = video.with_suffix(video.suffix + '.qc.json')
    try:
        report = json.loads(sidecar.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        raise PipelineError(f'rapport ArcFace illisible : {sidecar}') from error
    scores = [
        frame.get('deterministic', {}).get('identity_arcface')
        for frame in report.get('frames', [])
    ]
    values = [
        float(score)
        for score in scores
        if isinstance(score, (int, float))
    ]
    minimum = min(values) if values else None
    mean = sum(values) / len(values) if values else None
    deterministic_verdict = str(report.get('verdict', '')).upper()
    accepted = (
        minimum is not None
        and minimum >= target
        and deterministic_verdict != 'REJET'
    )
    summary = {
        'video': str(video),
        'reference': str(reference),
        'samples': len(values),
        'scores': [round(value, 6) for value in values],
        'mean': round(mean, 6) if mean is not None else None,
        'minimum': round(minimum, 6) if minimum is not None else None,
        'target': target,
        'visual_gate_verdict': report.get('verdict'),
        'accepted': accepted,
        'action': 'face_camera' if accepted else 'replaced_by_broll',
        'sidecar': str(sidecar),
    }
    return summary


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={'User-Agent': 'LisaPresenter/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            with destination.open('wb') as handle:
                shutil.copyfileobj(response, handle)
    except (urllib.error.URLError, OSError) as error:
        raise PipelineError(f'téléchargement HeyGen impossible : {error}') from error
    if destination.stat().st_size < 1024:
        raise PipelineError(f'vidéo HeyGen vide : {destination}')


def inventory(heygen: HeyGen) -> dict[str, Any]:
    quota = heygen.quota()
    groups = heygen.request('GET', '/v3/avatars?ownership=private&limit=50')
    looks = heygen.request(
        'GET',
        '/v3/avatars/looks?ownership=private&limit=50',
    )
    voices = heygen.request('GET', '/v3/voices?type=private&limit=50')
    look_items = []
    for item in looks.get('data', []):
        if not isinstance(item, dict):
            continue
        look_items.append(
            {
                'id': item.get('id'),
                'name': item.get('name'),
                'group_id': item.get('group_id'),
                'avatar_type': item.get('avatar_type'),
                'status': item.get('status'),
                'preferred_orientation': item.get('preferred_orientation'),
                'supported_api_engines': item.get('supported_api_engines'),
                'selected_for_lisa': item.get('id') == DEFAULT_AVATAR_ID,
            }
        )
    return {
        'inventoried_at': now_iso(),
        'plan_credits': quota,
        'avatar_groups': [
            {
                key: item.get(key)
                for key in ('id', 'name', 'looks_count', 'status', 'consent_status')
            }
            for item in groups.get('data', [])
            if isinstance(item, dict)
        ],
        'avatar_looks': look_items,
        'private_voices': voices.get('data', []),
        'external_voice': f'elevenlabs:{LISA_VOICE_ID}',
        'selected_avatar_id': DEFAULT_AVATAR_ID,
    }


def discover_visuals(script_path: Path, section: dict[str, Any]) -> list[Path]:
    found: list[Path] = []
    work = script_path.parent / 'work'
    source_card = work / 'source-cards' / f'{section["id"]}.png'
    if source_card.exists():
        found.append(source_card)
    explicit = work / 'visuals' / str(section['id'])
    if explicit.is_dir():
        found.extend(
            sorted(
                path for path in explicit.iterdir()
                if path.suffix.lower() in IMAGE_SUFFIXES | VIDEO_SUFFIXES
            )
        )
    preferred_scenes = (
        VALIDATED_SCENES / 'scene-06-hall-conference.png',
        VALIDATED_SCENES / 'scene-09-centre-congres-europe.png',
        VALIDATED_SCENES / 'scene-04-cafe-tech-col-roule.png',
    )
    found.extend(path for path in preferred_scenes if path.exists())
    tech = TECH_COMPOSITES / 'lisa-015-vertical-newsroom-tech.png'
    if tech.exists():
        found.append(tech)
    unique: list[Path] = []
    seen: set[Path] = set()
    for path in found:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(resolved)
    return unique


def render_image_video(image: Path, duration: float, output: Path, seed: int) -> None:
    zoom = (
        "'min(zoom+0.00035,1.06)'"
        if seed % 2 == 0
        else "'max(zoom-0.0003,1.0)'"
    )
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-loop', '1', '-i', str(image), '-t', f'{duration:.3f}',
            '-vf',
            (
                f'scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=increase,'
                f'crop={VIDEO_WIDTH}:{VIDEO_HEIGHT},'
                f'zoompan=z={zoom}:d=1:s={VIDEO_WIDTH}x{VIDEO_HEIGHT}:fps={VIDEO_FPS},'
                'setsar=1,format=yuv420p'
            ),
            '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
            '-r', str(VIDEO_FPS), '-pix_fmt', 'yuv420p', str(output),
        ]
    )


def normalize_avatar_slice(
    source: Path,
    start: float,
    duration: float,
    output: Path,
) -> None:
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-ss', f'{start:.3f}', '-i', str(source), '-t', f'{duration:.3f}',
            '-filter_complex',
            (
                f'[0:v]split=2[background][portrait];'
                f'[background]scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:'
                f'force_original_aspect_ratio=increase,'
                f'crop={VIDEO_WIDTH}:{VIDEO_HEIGHT},boxblur=28:2[blurred];'
                f'[portrait]scale=-2:{VIDEO_HEIGHT}[foreground];'
                f'[blurred][foreground]overlay=(W-w)/2:0,'
                f'fps={VIDEO_FPS},setsar=1,format=yuv420p[out]'
            ),
            '-map', '[out]',
            '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
            '-r', str(VIDEO_FPS), '-pix_fmt', 'yuv420p', str(output),
        ]
    )


def concat_video(paths: list[Path], destination: Path) -> None:
    concat_file = destination.with_suffix('.concat.txt')
    concat_file.write_text(
        ''.join(f"file '{path.as_posix().replace(chr(39), chr(39) * 2)}'\n" for path in paths),
        encoding='utf-8',
    )
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'concat', '-safe', '0', '-i', str(concat_file),
            '-an', '-c:v', 'copy', str(destination),
        ]
    )


def overlay_cutaways(
    base: Path,
    duration: float,
    assets: list[Path],
    output: Path,
    work: Path,
) -> list[dict[str, Any]]:
    intervals = planned_cutaway_intervals(duration, assets)
    if not intervals:
        shutil.copy2(base, output)
        return []
    inputs: list[str] = ['-i', str(base)]
    filters: list[str] = []
    previous = '[0:v]'
    report: list[dict[str, Any]] = []
    for index, (slot_start, slot_end, asset) in enumerate(intervals, start=1):
        clip = work / f'cutaway-{index:02d}.mp4'
        render_image_video(asset, slot_end - slot_start, clip, index)
        inputs.extend(['-i', str(clip)])
        alpha_duration = min(0.22, (slot_end - slot_start) / 4)
        overlay = f'[ov{index}]'
        output_label = f'[v{index}]'
        fades: list[str] = []
        if index == 1:
            fades.append(
                f'fade=t=in:st=0:d={alpha_duration:.3f}:alpha=1'
            )
        if index == len(intervals):
            fades.append(
                f'fade=t=out:st={(slot_end-slot_start-alpha_duration):.3f}:'
                f'd={alpha_duration:.3f}:alpha=1'
            )
        fade_filter = ''.join(f',{fade}' for fade in fades)
        filters.append(
            f'[{index}:v]format=yuva420p{fade_filter},'
            f'setpts=PTS-STARTPTS+{slot_start:.3f}/TB{overlay}'
        )
        filters.append(
            f'{previous}{overlay}overlay=0:0:eof_action=pass:shortest=0{output_label}'
        )
        previous = output_label
        report.append(
            {
                'start': round(slot_start, 3),
                'end': round(slot_end, 3),
                'asset': str(asset),
            }
        )
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            *inputs, '-filter_complex', ';'.join(filters),
            '-map', previous, '-t', f'{duration:.3f}',
            '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
            '-r', str(VIDEO_FPS), '-pix_fmt', 'yuv420p', str(output),
        ]
    )
    return report


def planned_cutaway_intervals(
    duration: float,
    assets: list[Path],
) -> list[tuple[float, float, Path]]:
    if duration < 15 or not assets:
        return []
    start = min(8.0, duration * 0.25)
    end = max(start, duration - 3.2)
    if end - start < 3:
        return []
    intervals: list[tuple[float, float, Path]] = []
    cursor = start
    index = 0
    while cursor < end - 0.05:
        slot_end = min(end, cursor + 5.0)
        intervals.append((cursor, slot_end, assets[index % len(assets)]))
        cursor = slot_end
        index += 1
    return intervals


def visual_gate_shot_plan(
    sections: list[dict[str, Any]],
    timeline: list[dict[str, float]],
    cutaways: dict[str, Any],
) -> list[dict[str, Any]]:
    """Produit les intervalles exacts compris par visual-gate.py."""
    plan: list[dict[str, Any]] = []

    def append(start: float, end: float, shot_type: str) -> None:
        if end <= start:
            return
        if plan and plan[-1]['shot_type'] == shot_type:
            plan[-1]['end'] = round(end, 6)
            return
        plan.append({
            'start': round(start, 6),
            'end': round(end, 6),
            'shot_type': shot_type,
        })

    for section, timing in zip(sections, timeline):
        absolute_start = float(timing['start'])
        absolute_end = float(timing['end'])
        if section['mode'] == 'broll':
            append(absolute_start, absolute_end, 'broll')
            continue
        intervals = cutaways.get(section['id'], [])
        if not isinstance(intervals, list):
            intervals = []
        cursor = 0.0
        for interval in intervals:
            local_start = float(interval['start'])
            local_end = float(interval['end'])
            append(absolute_start + cursor, absolute_start + local_start, 'persona')
            append(absolute_start + local_start, absolute_start + local_end, 'broll')
            cursor = local_end
        append(absolute_start + cursor, absolute_end, 'persona')
    return plan


def add_branding_and_subtitles(source: Path, ass: Path, output: Path) -> None:
    ass_escaped = str(ass).replace('\\', r'\\').replace(':', r'\:').replace("'", r"\'")
    filter_graph = (
        "drawbox=x=42:y=34:w=220:h=64:color=0x081522@0.82:t=fill,"
        "drawbox=x=42:y=34:w=8:h=64:color=0x49c6e5@1:t=fill,"
        "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:"
        "text='LISA IA':fontcolor=white:fontsize=31:x=70:y=49,"
        f"ass='{ass_escaped}'"
    )
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-i', str(source), '-vf', filter_graph,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-c:a', 'copy', '-movflags', '+faststart', str(output),
        ]
    )


def mux_narration(video: Path, narration: Path, output: Path) -> None:
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-i', str(video), '-i', str(narration),
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
            '-shortest', '-movflags', '+faststart', str(output),
        ]
    )


def add_music(source: Path, music: Path, output: Path) -> None:
    if not music.exists():
        raise PipelineError(f'musique introuvable : {music}')
    duration = media_duration(source)
    fade_out = max(0.0, duration - 1.4)
    filters = (
        f'[1:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,'
        f'afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out:.3f}:d=1.2,'
        'volume=0.13[music];'
        '[music][0:a]sidechaincompress=threshold=0.025:ratio=10:'
        'attack=5:release=280[duck];'
        '[0:a][duck]amix=inputs=2:normalize=0,'
        'loudnorm=I=-14:TP=-1.5:LRA=11[master]'
    )
    run(
        [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-i', str(source), '-stream_loop', '-1', '-i', str(music),
            '-filter_complex', filters,
            '-map', '0:v:0', '-map', '[master]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
            '-t', f'{duration:.3f}', '-movflags', '+faststart', str(output),
        ]
    )


def prepare(
    script_path: Path,
    output: Path,
    voice_dir: Path | None,
    limit: int | None,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, float]], dict[str, Any]]:
    script_path = script_path.expanduser().resolve()
    if not script_path.exists():
        raise PipelineError(f'script introuvable : {script_path}')
    output.mkdir(parents=True, exist_ok=True)
    voice_usage = require_voice_budget_state()
    sections, source_plan = load_sections(script_path)
    sections = enrich_sections(sections)
    assert_no_production_markers(
        {
            'sections': [
                {
                    key: section.get(key)
                    for key in ('titre', 'texte', 'headline', 'caption')
                    if section.get(key) is not None
                }
                for section in sections
            ],
            'sources': source_plan.get('sources', {}),
        },
        'contenu Lisa destiné au rendu',
    )
    if limit is not None:
        if limit <= 0:
            raise PipelineError('--limite-sections doit être positif')
        sections = sections[:limit]
    resolved_voice_dir = resolve_voice_dir(script_path, voice_dir)
    attach_audio(sections, resolved_voice_dir)
    timeline = section_timeline(sections)
    shot_plan = {
        'version': 1,
        'script': str(script_path),
        'created_at': now_iso(),
        'rule': (
            'accroches, transitions et conclusion face caméra ; '
            'faits détaillés en plans de coupe avec voix continue'
        ),
        'sections': [
            {
                'id': section['id'],
                'titre': section.get('titre'),
                'phase': section.get('phase'),
                'mode': section['mode'],
                'raison': section['raison'],
                'audio': section['audio_path'],
                **timeline[index],
            }
            for index, section in enumerate(sections)
        ],
        'presenter_runs': group_presenter_runs(sections),
        'elevenlabs': voice_usage,
    }
    atomic_json(output / 'shot-plan.json', shot_plan)
    make_subtitles(
        sections,
        timeline,
        source_plan.get('sources', {}),
        output / 'sous-titres.fr.srt',
        output / 'sous-titres.fr.ass',
    )
    return sections, source_plan, timeline, shot_plan


def produce(args: argparse.Namespace) -> dict[str, Any]:
    script_path = args.script.expanduser().resolve()
    output = args.sortie.expanduser().resolve()
    sections, source_plan, timeline, shot_plan = prepare(
        script_path,
        output,
        args.dossier_voix,
        args.limite_sections,
    )
    env = load_env(MEDIA_ENV)
    heygen = HeyGen(
        env.get('HEYGEN_API_KEY', ''),
        output / 'heygen-credits.json',
        args.plafond_credits,
        args.reserve_par_appel,
    )
    runs = group_presenter_runs(sections)
    if not runs:
        raise PipelineError('aucune section face caméra dans la sélection')
    validate_presenter_runs(
        sections,
        runs,
        args.prise_min,
        args.prise_max,
    )
    reference = identity_reference(args.avatar_id, args.reference_identite)
    avatar_dir = output / 'avatar'
    audio_dir = output / 'audio'
    render_dir = output / 'render'
    avatar_dir.mkdir(exist_ok=True)
    audio_dir.mkdir(exist_ok=True)
    render_dir.mkdir(exist_ok=True)
    generated: list[dict[str, Any]] = []
    for run_index, indices in enumerate(runs, start=1):
        audio = audio_dir / f'heygen-run-{run_index:02d}.mp3'
        concat_audio(
            [Path(sections[index]['audio_path']) for index in indices],
            audio,
        )
        video = avatar_dir / f'heygen-run-{run_index:02d}.mp4'
        if video.exists():
            result = {'reused': True, 'actual_credits': 0}
        else:
            title = f'lisa-presentatrice-{output.name}-run-{run_index:02d}'
            if args.backend == 'ui':
                result = heygen.generate_ui(
                    audio,
                    video,
                    avatar_id=args.avatar_id,
                    title=title,
                    poll_seconds=args.attente_max,
                    avatar_preview_token=args.ui_avatar_preview_token,
                )
            else:
                result = heygen.generate(
                    audio,
                    video,
                    avatar_id=args.avatar_id,
                    title=title,
                    poll_seconds=args.attente_max,
                )
        identity = identity_quality(
            video,
            reference,
            output,
            args.seuil_identite,
        )
        if identity['accepted']:
            run_start = timeline[indices[0]]['start']
            for index in indices:
                sections[index]['avatar_run'] = str(video)
                sections[index]['avatar_offset'] = (
                    timeline[index]['start'] - run_start
                )
        generated.append(
            {
                'indices': indices,
                'audio': str(audio),
                'video': str(video),
                'identity': identity,
                **result,
            }
        )

    narration = audio_dir / 'narration.mp3'
    concat_audio([Path(section['audio_path']) for section in sections], narration)

    section_videos: list[Path] = []
    cutaway_report: dict[str, Any] = {}
    for index, (section, timing) in enumerate(zip(sections, timeline)):
        section_work = render_dir / section['id']
        section_work.mkdir(parents=True, exist_ok=True)
        base = section_work / 'base.mp4'
        duration = timing['duration']
        if not media_matches(base, duration):
            if section.get('avatar_run'):
                normalize_avatar_slice(
                    Path(section['avatar_run']),
                    float(section['avatar_offset']),
                    duration,
                    base,
                )
            else:
                visuals = discover_visuals(script_path, section)
                if not visuals:
                    raise PipelineError(f'aucun plan de coupe pour {section["id"]}')
                render_image_video(visuals[0], duration, base, index)
        final_section = section_work / 'section.mp4'
        section_assets = discover_visuals(script_path, section)
        if not args.force_local and media_matches(final_section, duration):
            cutaway_report[section['id']] = [
                {
                    'start': round(start, 3),
                    'end': round(end, 3),
                    'asset': str(asset),
                }
                for start, end, asset in planned_cutaway_intervals(
                    duration,
                    section_assets,
                )
            ]
        elif section['mode'] in {'presenter', 'hybride'}:
            cutaway_report[section['id']] = overlay_cutaways(
                base,
                duration,
                section_assets,
                final_section,
                section_work,
            )
        else:
            shutil.copy2(base, final_section)
        section_videos.append(final_section)

    video_only = render_dir / 'video.mp4'
    total_duration = timeline[-1]['end']
    if args.force_local or not media_matches(video_only, total_duration):
        concat_video(section_videos, video_only)
    with_voice = render_dir / 'avec-voix.mp4'
    if args.force_local or not media_matches(with_voice, total_duration):
        mux_narration(video_only, narration, with_voice)
    dressed = render_dir / 'habillage.mp4'
    if args.force_local or not media_matches(dressed, total_duration):
        add_branding_and_subtitles(
            with_voice,
            output / 'sous-titres.fr.ass',
            dressed,
        )
    final_video = output / 'lisa-presentatrice-demo.mp4'
    if args.force_local or not media_matches(final_video, total_duration):
        add_music(dressed, args.musique.expanduser().resolve(), final_video)
    measurement = master_video_audio(final_video)
    audio_qc = write_qc_sidecar(final_video, measurement)
    identity_shot_plan = output / 'visual-shot-plan.json'
    atomic_json(
        identity_shot_plan,
        visual_gate_shot_plan(sections, timeline, cutaway_report),
    )
    manifest = {
        'version': 1,
        'created_at': now_iso(),
        'script': str(script_path),
        'video': str(final_video),
        'duration_seconds': round(media_duration(final_video), 3),
        'avatar_id': args.avatar_id,
        'identity_reference': str(reference),
        'identity_target': args.seuil_identite,
        'presenter_take_seconds': {
            'minimum': args.prise_min,
            'maximum': args.prise_max,
        },
        'heygen': {
            'backend': args.backend,
            'generated_runs': generated,
            'credit_ledger': str(output / 'heygen-credits.json'),
            'actual_credits': heygen.spent(),
            'cap_credits': args.plafond_credits,
        },
        'elevenlabs': shot_plan['elevenlabs'],
        'cutaways': cutaway_report,
        'sources_untouched': [
            str(VALIDATED_SCENES),
            str(TECH_COMPOSITES),
        ],
        'published': False,
        'delivery_qc': str(audio_qc),
        'visual_shot_plan': str(identity_shot_plan),
    }
    atomic_json(output / 'production-manifest.json', manifest)
    return manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='commande', required=True)

    inventory_parser = commands.add_parser('inventaire')
    inventory_parser.add_argument('--sortie', required=True, type=Path)

    plan_parser = commands.add_parser('plan')
    plan_parser.add_argument('script', type=Path)
    plan_parser.add_argument('--sortie', required=True, type=Path)
    plan_parser.add_argument('--dossier-voix', type=Path)
    plan_parser.add_argument('--limite-sections', type=int)

    production = commands.add_parser('produire')
    production.add_argument('script', type=Path)
    production.add_argument('--sortie', required=True, type=Path)
    production.add_argument('--dossier-voix', type=Path)
    production.add_argument('--limite-sections', type=int)
    production.add_argument('--avatar-id', default=DEFAULT_AVATAR_ID)
    production.add_argument(
        '--ui-avatar-preview-token',
        default=DEFAULT_AVATAR_PREVIEW_TOKEN,
        help=(
            'fragment stable de preview_image_url utilisé pour vérifier le '
            'look sélectionné avant une génération UI'
        ),
    )
    production.add_argument(
        '--backend',
        choices=('ui', 'api'),
        default='ui',
        help='ui consomme le plan mensuel ; api utilise le portefeuille API',
    )
    production.add_argument('--plafond-credits', type=int, default=100)
    production.add_argument(
        '--reserve-par-appel',
        type=int,
        default=DEFAULT_ESTIMATED_CALL_CREDITS,
    )
    production.add_argument('--attente-max', type=int, default=1800)
    production.add_argument('--musique', type=Path, default=DEFAULT_MUSIC)
    production.add_argument(
        '--force-local',
        action='store_true',
        help='reconstruit le montage local sans régénérer les segments HeyGen',
    )
    production.add_argument(
        '--prise-min',
        type=float,
        default=DEFAULT_MIN_PRESENTER_SECONDS,
    )
    production.add_argument(
        '--prise-max',
        type=float,
        default=DEFAULT_MAX_PRESENTER_SECONDS,
    )
    production.add_argument(
        '--seuil-identite',
        type=float,
        default=DEFAULT_IDENTITY_TARGET,
    )
    production.add_argument('--reference-identite', type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.commande == 'inventaire':
            env = load_env(MEDIA_ENV)
            destination = args.sortie.expanduser().resolve()
            heygen = HeyGen(
                env.get('HEYGEN_API_KEY', ''),
                destination.with_suffix('.credits.json'),
                100,
                DEFAULT_ESTIMATED_CALL_CREDITS,
            )
            report = inventory(heygen)
            atomic_json(destination, report)
            print(destination)
        elif args.commande == 'plan':
            prepare(
                args.script,
                args.sortie.expanduser().resolve(),
                args.dossier_voix,
                args.limite_sections,
            )
            print(args.sortie.expanduser().resolve() / 'shot-plan.json')
        elif args.commande == 'produire':
            manifest = produce(args)
            print(manifest['video'])
            print(f'Crédits HeyGen mesurés : {manifest["heygen"]["actual_credits"]}')
        return 0
    except (PipelineError, DeliveryQCError) as error:
        print(f'ERREUR : {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
