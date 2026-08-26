#!/usr/bin/env python3
"""Assemble une vidéo longue Lisa 16:9 depuis un workdir résumable."""

import argparse
import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from video_delivery_qc import (  # noqa: E402
    DeliveryQCError,
    assert_no_production_markers,
    master_video_audio,
    write_qc_sidecar,
)

WIDTH = 1920
HEIGHT = 1080
FPS = 30
CROSSFADE = 0.35
MUSIC_ROOT = Path('~/.codebuddy/media-audio/music').expanduser()
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.mkv', '.webm', '.m4v'}
PHASE_TITLES = {
    'hook': 'La promesse',
    'cta_abo': 'Avant de commencer',
    'contexte': 'Le contexte',
    'decryptage': 'Le décryptage',
    'demos': 'Les démos',
    'nuance': 'Mon avis nuancé',
    'outro': 'À retenir',
}
AVATAR_HEADLINES = {
    '01-hook-avatar': 'META AI : DU CHAT À L’ACTION',
    '11-nuance-avatar': 'LE PARADIGME CHANGE — PAS SANS LIMITES',
    '13-outro-avatar': 'QUELLE TÂCHE DÉLÉGUERAIS-TU ?',
}
FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
LOUDNORM_TARGET = 'I=-14:TP=-1.5:LRA=11'


class AssemblyError(RuntimeError):
    """Erreur explicite du pipeline d'assemblage."""


def run(command: Sequence[str], capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(command),
            check=True,
            capture_output=capture,
            text=True,
        )
    except FileNotFoundError as exc:
        raise AssemblyError(f'commande introuvable: {command[0]}') from exc
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or '').strip()
        if details:
            details = f'\n{details[-2000:]}'
        raise AssemblyError(
            f'échec de {command[0]} (code {exc.returncode}){details}') from exc


def atomic_ffmpeg(command: list[str], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_name(f'.{destination.stem}.part{destination.suffix}')
    try:
        run([*command, str(temp_path)])
        os.replace(temp_path, destination)
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


def media_duration(path: Path) -> float:
    result = run([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(path),
    ], capture=True)
    try:
        duration = float(result.stdout.strip())
    except ValueError as exc:
        raise AssemblyError(f'durée illisible: {path}') from exc
    if duration <= 0:
        raise AssemblyError(f'durée invalide: {path}')
    return duration


def video_dimensions(path: Path) -> tuple[int, int]:
    result = run([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json', str(path),
    ], capture=True)
    try:
        streams = json.loads(result.stdout)['streams']
        width = int(streams[0]['width'])
        height = int(streams[0]['height'])
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise AssemblyError(f'dimensions vidéo illisibles: {path}') from exc
    if width <= 0 or height <= 0:
        raise AssemblyError(f'dimensions vidéo invalides: {path}')
    return width, height


def read_plan(path: Path) -> dict[str, Any]:
    try:
        plan = json.loads(path.read_text(encoding='utf-8'))
    except OSError as exc:
        raise AssemblyError(f'impossible de lire {path}: {exc}') from exc
    except json.JSONDecodeError as exc:
        raise AssemblyError(f'JSON invalide dans {path}: {exc}') from exc
    sections = plan.get('sections')
    if not isinstance(sections, list) or not sections:
        raise AssemblyError('plan.json: sections doit être une liste non vide')
    seen: set[str] = set()
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise AssemblyError(f'sections[{index}]: objet attendu')
        section_id = section.get('id')
        if not isinstance(section_id, str) or not re.fullmatch(
                r'[A-Za-z0-9][A-Za-z0-9_-]*', section_id):
            raise AssemblyError(f'sections[{index}].id invalide')
        if section_id in seen:
            raise AssemblyError(f'id dupliqué: {section_id}')
        seen.add(section_id)
        if section.get('mode') not in {'avatar', 'voiceover'}:
            raise AssemblyError(f'{section_id}: mode avatar/voiceover attendu')
    return plan


def section_duration(section: dict[str, Any], audio_path: Path) -> float:
    measured = media_duration(audio_path)
    stored = section.get('duree_reelle_s')
    if isinstance(stored, (int, float)) and abs(float(stored) - measured) > 0.15:
        print(
            f'AVERTISSEMENT {section["id"]}: plan={stored:.3f}s, '
            f'ffprobe={measured:.3f}s; ffprobe fait foi',
            file=sys.stderr,
        )
    return measured


def drawtext_escape(value: str) -> str:
    return (
        value.replace('\\', r'\\')
        .replace("'", r"\'")
        .replace(':', r'\:')
        .replace('%', r'\%')
    )


def card_filter(section: dict[str, Any], avatar_missing: bool) -> str:
    phase = str(section.get('phase', ''))
    title = PHASE_TITLES.get(phase, phase.replace('_', ' ').title())
    kicker = 'AVATAR À FOURNIR' if avatar_missing else 'LISA • DÉCRYPTAGE'
    safe_title = drawtext_escape(title)
    safe_kicker = drawtext_escape(kicker)
    return (
        f"format=yuv420p,"
        f"drawbox=x=0:y=0:w=iw:h=ih:color=#0b1020:t=fill,"
        f"drawbox=x=150:y=260:w=10:h=310:color=#9b87f5:t=fill,"
        f"drawtext=fontfile={FONT_BOLD}:text='{safe_kicker}':"
        f"fontcolor=#b9aaff:fontsize=38:x=190:y=290,"
        f"drawtext=fontfile={FONT_BOLD}:text='{safe_title}':"
        f"fontcolor=white:fontsize=78:x=190:y=385,"
        f"drawtext=fontfile={FONT_REGULAR}:text='Lisa • vidéo longue':"
        f"fontcolor=#bdc5d8:fontsize=34:x=190:y=505,"
        f"drawbox=x=0:y=h-14:w=iw:h=14:color=#9b87f5:t=fill,"
        f"fps={FPS},setsar=1"
    )


def render_card(
    section: dict[str, Any],
    duration: float,
    destination: Path,
    avatar_missing: bool,
) -> None:
    if destination.exists():
        print(f'SKIP carte existante: {destination}')
        return
    atomic_ffmpeg([
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-f', 'lavfi', '-i',
        f'color=c=#0b1020:s={WIDTH}x{HEIGHT}:r={FPS}:d={duration:.6f}',
        '-vf', card_filter(section, avatar_missing),
        '-t', f'{duration:.6f}',
        '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
        '-pix_fmt', 'yuv420p', '-r', str(FPS), '-movflags', '+faststart',
    ], destination)


def render_avatar(
    section: dict[str, Any],
    source: Path,
    duration: float,
    destination: Path,
) -> None:
    if destination.exists():
        print(f'SKIP avatar rendu existant: {destination}')
        return
    source_width, source_height = video_dimensions(source)
    command = [
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-stream_loop', '-1', '-i', str(source),
    ]
    if source_height > source_width:
        headline = drawtext_escape(
            AVATAR_HEADLINES.get(
                section['id'],
                PHASE_TITLES.get(str(section.get('phase', '')), 'LISA'),
            )
        )
        headline_size = 40 if section['id'] == '11-nuance-avatar' else 50
        portrait_filter = (
            f'[0:v]split=2[bg][fg];'
            f'[bg]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,'
            f'crop={WIDTH}:{HEIGHT},boxblur=32:12,'
            f'eq=brightness=-0.28:saturation=0.75[bg2];'
            f'[fg]scale=-2:{HEIGHT}[fg2];'
            f'[bg2]drawbox=x=0:y=0:w=1180:h=ih:'
            f'color=#0b1020@0.88:t=fill[panel];'
            f'[panel][fg2]overlay=x=W-w-70:y=0,'
            f"drawtext=fontfile={FONT_BOLD}:text='LISA • TECH & IA':"
            f'fontcolor=#b9aaff:fontsize=34:x=110:y=340,'
            f"drawtext=fontfile={FONT_BOLD}:text='{headline}':"
            f'fontcolor=white:fontsize={headline_size}:x=110:y=425,'
            f"drawtext=fontfile={FONT_REGULAR}:"
            f"text='Décryptage documenté • opinion assumée':"
            f'fontcolor=#bdc5d8:fontsize=28:x=110:y=515,'
            f'drawbox=x=110:y=575:w=330:h=8:color=#9b87f5:t=fill,'
            f'fps={FPS},setsar=1,format=yuv420p[v]'
        )
        command.extend([
            '-filter_complex', portrait_filter, '-map', '[v]',
        ])
    else:
        video_filter = (
            f'scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,'
            f'crop={WIDTH}:{HEIGHT},setsar=1,fps={FPS},format=yuv420p'
        )
        command.extend(['-vf', video_filter])
    command.extend([
        '-t', f'{duration:.6f}', '-an',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
        '-pix_fmt', 'yuv420p', '-r', str(FPS), '-movflags', '+faststart',
    ])
    atomic_ffmpeg(command, destination)


def list_visuals(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        (
            path for path in directory.iterdir()
            if path.is_file()
            and path.suffix.lower() in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
        ),
        key=lambda path: path.name.lower(),
    )


def visual_slot_count(duration: float) -> int:
    if duration <= 10:
        return 1
    return max(1, round(duration / 9))


def render_image_slot(source: Path, duration: float, destination: Path) -> None:
    if destination.exists():
        print(f'SKIP plan image existant: {destination}')
        return
    frames = max(1, math.ceil(duration * FPS))
    video_filter = (
        f'scale=2200:1238:force_original_aspect_ratio=increase,'
        f'crop=2200:1238,'
        f'zoompan=z=min(zoom+0.00028\\,1.08):'
        f'x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):'
        f'd=1:s={WIDTH}x{HEIGHT}:fps={FPS},'
        f'trim=end_frame={frames},setsar=1,format=yuv420p'
    )
    atomic_ffmpeg([
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-loop', '1', '-framerate', str(FPS), '-i', str(source),
        '-vf', video_filter, '-t', f'{duration:.6f}', '-an',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
        '-pix_fmt', 'yuv420p', '-r', str(FPS), '-movflags', '+faststart',
    ], destination)


def render_video_slot(source: Path, duration: float, destination: Path) -> None:
    if destination.exists():
        print(f'SKIP plan vidéo existant: {destination}')
        return
    video_filter = (
        f'scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,'
        f'crop={WIDTH}:{HEIGHT},setsar=1,fps={FPS},format=yuv420p'
    )
    atomic_ffmpeg([
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-stream_loop', '-1', '-i', str(source),
        '-vf', video_filter, '-t', f'{duration:.6f}', '-an',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
        '-pix_fmt', 'yuv420p', '-r', str(FPS), '-movflags', '+faststart',
    ], destination)


def xfade_videos(
    inputs: list[Path],
    durations: list[float],
    destination: Path,
    crossfade: float = CROSSFADE,
) -> None:
    if destination.exists():
        print(f'SKIP montage vidéo existant: {destination}')
        return
    if len(inputs) != len(durations) or not inputs:
        raise AssemblyError('xfade_videos: entrées/durées incohérentes')
    command = ['ffmpeg', '-y', '-hide_banner', '-v', 'error']
    for source in inputs:
        command.extend(['-i', str(source)])
    if len(inputs) == 1:
        filters = [f'[0:v]setpts=PTS-STARTPTS[vout]']
    else:
        filters = []
        previous = '[0:v]'
        offset = 0.0
        for index in range(1, len(inputs)):
            offset += durations[index - 1] - crossfade
            output_label = f'v{index}'
            filters.append(
                f'{previous}[{index}:v]xfade=transition=fade:'
                f'duration={crossfade:.6f}:offset={offset:.6f}'
                f'[{output_label}]')
            previous = f'[{output_label}]'
        filters.append(f'{previous}null[vout]')
    command.extend([
        '-filter_complex', ';'.join(filters), '-map', '[vout]', '-an',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
        '-pix_fmt', 'yuv420p', '-r', str(FPS), '-movflags', '+faststart',
    ])
    atomic_ffmpeg(command, destination)


def render_voiceover_section(
    section: dict[str, Any],
    duration: float,
    visuals: list[Path],
    render_root: Path,
    destination: Path,
) -> None:
    if not visuals:
        raise AssemblyError(
            f'{section["id"]}: aucun visuel — carte de repli refusée'
        )
    if destination.exists():
        print(f'SKIP section existante: {destination}')
        return

    count = visual_slot_count(duration)
    base_duration = duration / count
    slot_dir = render_root / 'slots' / section['id']
    slot_paths: list[Path] = []
    slot_durations: list[float] = []
    for index in range(count):
        content_duration = base_duration
        render_duration = (
            content_duration + CROSSFADE if index < count - 1
            else content_duration
        )
        source = visuals[index % len(visuals)]
        slot_path = slot_dir / f'{index:03d}.mp4'
        if source.suffix.lower() in IMAGE_EXTENSIONS:
            render_image_slot(source, render_duration, slot_path)
        else:
            render_video_slot(source, render_duration, slot_path)
        slot_paths.append(slot_path)
        slot_durations.append(render_duration)
    xfade_videos(slot_paths, slot_durations, destination)


def resolve_music(mood: str, explicit: str | None) -> Path:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise AssemblyError(f'musique introuvable: {path}')
        return path
    mood_dir = MUSIC_ROOT / mood
    if not mood_dir.is_dir():
        raise AssemblyError(f'dossier musical introuvable: {mood_dir}')
    tracks = sorted(
        path for path in mood_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {'.mp3', '.wav', '.m4a'}
    )
    if not tracks:
        raise AssemblyError(f'aucune musique dans {mood_dir}')
    return tracks[0]


def render_narration(
    audio_paths: list[Path],
    starts: list[float],
    total_duration: float,
    destination: Path,
) -> None:
    if destination.exists():
        print(f'SKIP narration existante: {destination}')
        return
    command = ['ffmpeg', '-y', '-hide_banner', '-v', 'error']
    filters: list[str] = []
    labels: list[str] = []
    for index, (audio_path, start) in enumerate(zip(audio_paths, starts)):
        command.extend(['-i', str(audio_path)])
        delay_ms = round(start * 1000)
        label = f'a{index}'
        filters.append(
            f'[{index}:a]aresample=48000,'
            f'aformat=sample_fmts=fltp:sample_rates=48000:'
            f'channel_layouts=stereo,adelay={delay_ms}|{delay_ms}'
            f'[{label}]')
        labels.append(f'[{label}]')
    filters.append(
        f'{"".join(labels)}amix=inputs={len(labels)}:normalize=0:'
        f'dropout_transition=0,atrim=0:{total_duration:.6f},'
        f'asetpts=PTS-STARTPTS[narration]')
    command.extend([
        '-filter_complex', ';'.join(filters), '-map', '[narration]',
        '-t', f'{total_duration:.6f}', '-c:a', 'pcm_s24le', '-ar', '48000',
    ])
    atomic_ffmpeg(command, destination)


def mix_music(
    narration: Path,
    music: Path,
    duration: float,
    destination: Path,
) -> None:
    if destination.exists():
        print(f'SKIP mix existant: {destination}')
        return
    fade_out_start = max(0.0, duration - 1.5)
    filters = (
        f'[0:a]aresample=48000,'
        f'aformat=sample_fmts=fltp:sample_rates=48000:'
        f'channel_layouts=stereo,asplit=2[narr_sc][narr_mix];'
        f'[1:a]atrim=0:{duration:.6f},asetpts=PTS-STARTPTS,'
        f'aresample=48000,'
        f'aformat=sample_fmts=fltp:sample_rates=48000:'
        f'channel_layouts=stereo,volume=0.20,'
        f'afade=t=in:st=0:d=0.8,'
        f'afade=t=out:st={fade_out_start:.6f}:d=1.5[music];'
        f'[music][narr_sc]sidechaincompress=threshold=0.03:ratio=8:'
        f'attack=5:release=250[ducked];'
        f'[narr_mix][ducked]amix=inputs=2:normalize=0:dropout_transition=0,'
        f'atrim=0:{duration:.6f}[mix]'
    )
    atomic_ffmpeg([
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-i', str(narration), '-stream_loop', '-1', '-i', str(music),
        '-filter_complex', filters, '-map', '[mix]',
        '-t', f'{duration:.6f}', '-c:a', 'pcm_s24le', '-ar', '48000',
    ], destination)


def loudnorm_measure(source: Path) -> dict[str, str]:
    result = run([
        'ffmpeg', '-hide_banner', '-v', 'info', '-i', str(source),
        '-af', f'loudnorm={LOUDNORM_TARGET}:print_format=json',
        '-f', 'null', '-',
    ], capture=True)
    matches = re.findall(
        r'\{\s*"input_i".*?\}', result.stderr, flags=re.DOTALL)
    if not matches:
        raise AssemblyError('mesures loudnorm passe 1 introuvables')
    try:
        measured = json.loads(matches[-1])
    except json.JSONDecodeError as exc:
        raise AssemblyError(f'mesures loudnorm invalides: {exc}') from exc
    required = {
        'input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset',
    }
    if not required.issubset(measured):
        raise AssemblyError('mesures loudnorm passe 1 incomplètes')
    return measured


def master_audio(source: Path, destination: Path) -> None:
    if destination.exists():
        print(f'SKIP master audio existant: {destination}')
        return
    print('Loudnorm passe 1/2…')
    measured = loudnorm_measure(source)
    second_pass = (
        f'loudnorm={LOUDNORM_TARGET}:'
        f'measured_I={measured["input_i"]}:'
        f'measured_TP={measured["input_tp"]}:'
        f'measured_LRA={measured["input_lra"]}:'
        f'measured_thresh={measured["input_thresh"]}:'
        f'offset={measured["target_offset"]}:'
        f'linear=true:print_format=summary'
    )
    print('Loudnorm passe 2/2…')
    atomic_ffmpeg([
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-i', str(source), '-af', second_pass,
        '-c:a', 'pcm_s24le', '-ar', '48000',
    ], destination)


def timeline(durations: list[float]) -> tuple[list[float], float]:
    starts: list[float] = []
    current = 0.0
    for index, duration in enumerate(durations):
        starts.append(current)
        current += duration
        if index < len(durations) - 1:
            current -= CROSSFADE
    return starts, current


def chapter_time(seconds: float) -> str:
    rounded = max(0, round(seconds))
    hours, remainder = divmod(rounded, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f'{hours:02d}:{minutes:02d}:{secs:02d}'
    return f'{minutes:02d}:{secs:02d}'


def write_chapters(
    path: Path,
    sections: list[dict[str, Any]],
    starts: list[float],
) -> None:
    lines: list[str] = []
    previous_phase: str | None = None
    for section, start in zip(sections, starts):
        phase = str(section.get('phase', ''))
        if phase == previous_phase:
            continue
        title = str(
            section.get('titre')
            or PHASE_TITLES.get(phase)
            or phase.replace('_', ' ').title()
            or section['id']
        )
        lines.append(f'{chapter_time(start)} {title}')
        previous_phase = phase
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def final_mux(video: Path, audio: Path, duration: float, destination: Path) -> None:
    if destination.exists():
        raise AssemblyError(
            f'sortie existante: {destination} — faux succès refusé'
        )
    atomic_ffmpeg([
        'ffmpeg', '-y', '-hide_banner', '-v', 'error',
        '-i', str(video), '-i', str(audio),
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
        '-t', f'{duration:.6f}', '-movflags', '+faststart',
    ], destination)


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Assemble un workdir Lisa en MP4 YouTube 1920×1080.')
    parser.add_argument('--workdir', required=True, help='workdir de production')
    parser.add_argument('--out', required=True, help='fichier MP4 final')
    parser.add_argument(
        '--mood', default='elegant',
        help='sous-dossier de ~/.codebuddy/media-audio/music (défaut: elegant)')
    parser.add_argument(
        '--music', help='fichier musical explicite, prioritaire sur --mood')
    args = parser.parse_args()

    workdir = Path(args.workdir).expanduser().resolve()
    output = Path(args.out).expanduser().resolve()
    render_root = workdir / 'render'
    section_root = render_root / 'sections'
    section_root.mkdir(parents=True, exist_ok=True)

    try:
        plan = read_plan(workdir / 'plan.json')
        assert_no_production_markers(
            {
                'sections': [
                    {
                        key: section.get(key)
                        for key in ('titre', 'texte', 'headline', 'caption')
                        if section.get(key) is not None
                    }
                    for section in plan.get('sections', [])
                    if isinstance(section, dict)
                ]
            },
            'contenu visible Lisa long format',
        )
        sections: list[dict[str, Any]] = plan['sections']
        audio_paths: list[Path] = []
        durations: list[float] = []

        for section in sections:
            section_id = section['id']
            audio_path = workdir / 'voice' / f'{section_id}.mp3'
            if not audio_path.is_file():
                raise AssemblyError(f'voix manquante: {audio_path}')
            duration = section_duration(section, audio_path)
            audio_paths.append(audio_path)
            durations.append(duration)

        starts, total_duration = timeline(durations)
        chapters_path = workdir / 'chapters.txt'
        if output.exists():
            raise AssemblyError(
                f'sortie existante: {output} — faux succès refusé; '
                'utilisez un nouveau --out ou archivez explicitement le master précédent'
            )
        write_chapters(chapters_path, sections, starts)

        section_videos: list[Path] = []
        for section, duration in zip(sections, durations):
            section_id = section['id']
            destination = section_root / f'{section_id}.mp4'

            if section['mode'] == 'avatar':
                avatar_path = workdir / 'avatar' / f'{section_id}.mp4'
                if avatar_path.is_file():
                    render_avatar(
                        section, avatar_path, duration, destination)
                else:
                    raise AssemblyError(
                        f'{section_id}: avatar absent ({avatar_path}) — placeholder refusé'
                    )
            else:
                visuals = list_visuals(workdir / 'visuals' / section_id)
                render_voiceover_section(
                    section, duration, visuals, render_root, destination)

            section_videos.append(destination)

        joined_video = render_root / 'video.mp4'
        xfade_videos(
            section_videos, durations, joined_video, crossfade=CROSSFADE)
        narration = render_root / 'narration.wav'
        render_narration(
            audio_paths, starts, total_duration, narration)
        music = resolve_music(args.mood, args.music)
        print(f'Musique: {music}')
        mix = render_root / 'mix.wav'
        mix_music(narration, music, total_duration, mix)
        mastered = render_root / 'mastered.wav'
        master_audio(mix, mastered)
        final_mux(joined_video, mastered, total_duration, output)
        measurement = master_video_audio(output)
        write_qc_sidecar(output, measurement)
    except (AssemblyError, DeliveryQCError) as exc:
        sys.exit(str(exc))

    print(
        f'OK {output} — {WIDTH}×{HEIGHT} {FPS} fps, '
        f'{total_duration:.3f}s, H.264 + AAC')
    print(f'OK {chapters_path}')


if __name__ == '__main__':
    main()
