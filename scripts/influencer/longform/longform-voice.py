#!/usr/bin/env python3
"""Synthétise la voix Lisa section par section avec ElevenLabs."""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


VOICE_ID = '3fxbs2pB9bs8S6Z1N38A'
MODEL_ID = 'eleven_multilingual_v2'
OUTPUT_FORMAT = 'mp3_44100_192'
MEDIA_ENV = Path('~/.codebuddy/media.env').expanduser()


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
    args = parser.parse_args()

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
        for section in sections:
            audio_path = voice_dir / f'{section["id"]}.mp3'
            if audio_path.exists():
                print(f'SKIP audio existant: {audio_path}')
            else:
                if api_key is None:
                    api_key = load_env_value(
                        MEDIA_ENV, 'ELEVENLABS_API_KEY')
                print(f'ElevenLabs: {section["id"]}…')
                speed = 0.93 if section.get('mode') == 'avatar' else 0.85
                synthesize(
                    section['texte'].strip(),
                    audio_path,
                    api_key,
                    speed,
                )
                print(f'OK {audio_path}')
            duration = media_duration(audio_path)
            section['duree_reelle_s'] = round(duration, 3)
            total += duration
            print(f'  durée réelle: {duration:.3f}s')
    except RuntimeError as exc:
        sys.exit(str(exc))

    plan['duree_reelle_totale_s'] = round(total, 3)
    atomic_write_json(plan_path, plan)
    print(f'OK durées réelles écrites dans {plan_path} ({total:.3f}s)')


if __name__ == '__main__':
    main()
