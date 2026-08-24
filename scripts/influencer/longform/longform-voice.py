#!/usr/bin/env python3
"""Synthétise la voix Lisa section par section avec ElevenLabs."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


VOICE_ID = '3fxbs2pB9bs8S6Z1N38A'
MODEL_ID = 'eleven_multilingual_v2'
OUTPUT_FORMAT = 'mp3_44100_192'
MEDIA_ENV = Path('~/.codebuddy/media.env').expanduser()
USAGE_PATH = Path('~/.codebuddy/elevenlabs-voice-usage.json').expanduser()
# Garde-fou de dépense, pas une limite du fournisseur : il évite de brûler un quota
# ElevenLabs par une boucle de rendu. `CODEBUDDY_ELEVENLABS_MONTHLY_CAP` le relève quand
# une régénération le justifie — même variable que la voix du robot.
MONTHLY_CAP = int(os.environ.get('CODEBUDDY_ELEVENLABS_MONTHLY_CAP', 200_000))

# Débit de parole visé, en mots par minute. Repères en français : 140-160 pour une
# narration posée, 165-180 pour une présentatrice dynamique, essoufflant au-delà de 190.
# Les Shorts de Lisa sont à 174 : c'est la voix que Patrice a validée, et la référence.
#
# Une longue avait été générée à `speed: 1.2` pour tenir une durée cible : 204 mots/min
# à l'oreille, « elle parle beaucoup plus vite, du coup c'est moins bien ». Personne ne
# l'a vu avant l'écoute, parce que rien ne mesurait le débit. Maintenant si.
DEBIT_MIN, DEBIT_MAX = 160, 185


def load_env_value(path: Path, key: str) -> str:
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as exc:
        raise RuntimeError(f'impossible de lire {path}: {exc}') from exc
    prefix = f'{key}='
    for line in lines:
        if line.startswith(prefix):
            value = line[len(prefix):].strip()
            if value:
                return value
    raise RuntimeError(f'{key} absent ou vide dans {path}')


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def current_month() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m')


def load_usage() -> dict[str, Any]:
    try:
        usage = json.loads(USAGE_PATH.read_text(encoding='utf-8'))
    except FileNotFoundError:
        usage = {
            'version': 1,
            'month': current_month(),
            'characters': 0,
            'warned': False,
        }
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f'compteur ElevenLabs illisible: {USAGE_PATH}') from exc
    if usage.get('month') != current_month():
        usage = {
            'version': 1,
            'month': current_month(),
            'characters': 0,
            'warned': False,
        }
    characters = usage.get('characters')
    if not isinstance(characters, int) or characters < 0:
        raise RuntimeError('compteur ElevenLabs invalide')
    return usage


def reserve_usage(usage: dict[str, Any], text: str) -> None:
    requested = len(text)
    before = int(usage['characters'])
    if before + requested > MONTHLY_CAP:
        raise RuntimeError(
            f'plafond ElevenLabs refusé avant appel: '
            f'{before} + {requested} > {MONTHLY_CAP}'
        )


def settle_usage(usage: dict[str, Any], text: str) -> None:
    usage['characters'] = int(usage['characters']) + len(text)
    usage['updatedAt'] = datetime.now(timezone.utc).isoformat().replace(
        '+00:00', 'Z')
    usage['warned'] = int(usage['characters']) >= int(MONTHLY_CAP * 0.8)
    atomic_write_json(USAGE_PATH, usage)


def media_duration(path: Path) -> float:
    try:
        result = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        duration = float(result.stdout.strip())
    except FileNotFoundError as exc:
        raise RuntimeError('commande ffprobe introuvable') from exc
    except (subprocess.CalledProcessError, ValueError) as exc:
        raise RuntimeError(f'durée audio illisible: {path}') from exc
    if duration <= 0:
        raise RuntimeError(f'durée audio invalide: {path}')
    return duration


def tts_payload(text: str, speed: float) -> bytes:
    return json.dumps({
        'text': text,
        'model_id': MODEL_ID,
        'voice_settings': {
            'stability': 0.45,
            'similarity_boost': 0.85,
            'style': 0.5,
            'speed': speed,
            'use_speaker_boost': True,
        },
    }, ensure_ascii=False).encode('utf-8')


def synthesize(
    text: str,
    destination: Path,
    api_key: str,
    speed: float,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        (
            f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}'
            f'?output_format={OUTPUT_FORMAT}'
        ),
        data=tts_payload(text, speed),
        headers={
            'xi-api-key': api_key,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
        },
        method='POST',
    )
    fd, tmp_name = tempfile.mkstemp(
        prefix=f'.{destination.name}.', suffix='.part',
        dir=destination.parent)
    os.close(fd)
    try:
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                with open(tmp_name, 'wb') as handle:
                    while chunk := response.read(1024 * 1024):
                        handle.write(chunk)
        except urllib.error.HTTPError as exc:
            details = exc.read().decode('utf-8', errors='replace')[:500]
            raise RuntimeError(
                f'ElevenLabs HTTP {exc.code}: {details}') from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f'ElevenLabs inaccessible: {exc.reason}') from exc
        if os.path.getsize(tmp_name) == 0:
            raise RuntimeError('ElevenLabs a renvoyé un fichier vide')
        os.replace(tmp_name, destination)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def validate_sections(plan: dict[str, Any]) -> list[dict[str, Any]]:
    sections = plan.get('sections')
    if not isinstance(sections, list) or not sections:
        raise ValueError('plan.json: sections doit être une liste non vide')
    seen: set[str] = set()
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise ValueError(f'plan.json: sections[{index}] doit être un objet')
        section_id = section.get('id')
        text = section.get('texte')
        if not isinstance(section_id, str) or not section_id:
            raise ValueError(f'plan.json: sections[{index}].id invalide')
        if section_id in seen:
            raise ValueError(f'plan.json: id dupliqué {section_id!r}')
        seen.add(section_id)
        if not isinstance(text, str) or not text.strip():
            raise ValueError(
                f'plan.json: texte vide pour la section {section_id!r}')
    return sections


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Synthétise les MP3 Lisa et mesure leur durée réelle.')
    parser.add_argument('--workdir', required=True, help='workdir avec plan.json')
    parser.add_argument('--speed', type=float, default=None,
                        help='vitesse ElevenLabs par défaut (0.7–1.2) ; sinon 0.93 avatar / 0.85 voix off ; '
                             'une section peut porter sa propre clé "speed"')
    parser.add_argument('--only', default='', help='ids de sections à synthétiser seuls (csv)')
    args = parser.parse_args()
    only = {x for x in args.only.split(',') if x}

    workdir = Path(args.workdir).expanduser().resolve()
    plan_path = workdir / 'plan.json'
    try:
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
        sections = validate_sections(plan)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        sys.exit(str(exc))

    voice_dir = workdir / 'voice'
    voice_dir.mkdir(parents=True, exist_ok=True)
    total = 0.0
    api_key: str | None = None
    try:
        usage = load_usage()
        network_characters = 0
        for section in sections:
            if only and section['id'] not in only:
                continue
            audio_path = voice_dir / f'{section["id"]}.mp3'
            if audio_path.exists():
                print(f'SKIP audio existant: {audio_path}')
            else:
                text = section['texte'].strip()
                reserve_usage(usage, text)
                if api_key is None:
                    api_key = load_env_value(
                        MEDIA_ENV, 'ELEVENLABS_API_KEY')
                print(f'ElevenLabs: {section["id"]}…')
                default_speed = args.speed if args.speed is not None else (
                    0.93 if section.get('mode') == 'avatar' else 0.85)
                speed = float(section.get('speed', default_speed))
                synthesize(
                    text,
                    audio_path,
                    api_key,
                    speed,
                )
                settle_usage(usage, text)
                network_characters += len(text)
                print(f'OK {audio_path}')
            duration = media_duration(audio_path)
            section['duree_reelle_s'] = round(duration, 3)
            mots = len(str(text).split())
            if duration > 0 and mots >= 20:
                debit = mots / duration * 60
                section['debit_mots_min'] = round(debit)
                if not DEBIT_MIN <= debit <= DEBIT_MAX:
                    sens = 'trop vite' if debit > DEBIT_MAX else 'trop lentement'
                    print(f'  ⚠ {debit:.0f} mots/min — {sens} (viser {DEBIT_MIN}-{DEBIT_MAX}, '
                          f'les Shorts sont à 174). Vitesse demandée : {speed}.', file=sys.stderr)
            total += duration
            print(f'  durée réelle: {duration:.3f}s')
    except RuntimeError as exc:
        sys.exit(str(exc))

    plan['duree_reelle_totale_s'] = round(total, 3)
    plan['elevenlabs'] = {
        'month': usage['month'],
        'characters_after': usage['characters'],
        'monthly_cap': MONTHLY_CAP,
        'network_characters_this_run': network_characters,
    }
    atomic_write_json(plan_path, plan)
    print(f'OK durées réelles écrites dans {plan_path} ({total:.3f}s)')


if __name__ == '__main__':
    main()
