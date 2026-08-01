#!/usr/bin/env python3
"""Reprise locale et non destructive des vidéos de la nuit du 31 juillet.

Le script ne publie rien et ne contacte aucun fournisseur. Il rend de nouveaux
masters, mesure le fichier final, puis archive l'ancien seulement après succès.
"""

from __future__ import annotations

from dataclasses import asdict
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
VIDEOS = Path('~/Videos').expanduser()
INFLUENCER = ROOT / 'scripts/influencer'
sys.path.insert(0, str(INFLUENCER))
from video_delivery_qc import (  # noqa: E402
    assert_delivery_loudness,
    master_video_audio,
    measure_loudness,
    write_qc_sidecar,
)

LISA_SCRIPT = INFLUENCER / 'lisa-presentatrice.py'
LISA_SPEC = importlib.util.spec_from_file_location(
    'lisa_presentatrice_recovery',
    LISA_SCRIPT,
)
assert LISA_SPEC is not None and LISA_SPEC.loader is not None
LISA = importlib.util.module_from_spec(LISA_SPEC)
sys.modules[LISA_SPEC.name] = LISA
LISA_SPEC.loader.exec_module(LISA)

DATE = '2026-07-31'
STAMP = '20260731'
FONT = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
FONT_BOLD = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
FONT_SERIF = Path('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf')
MUSIC_WARM = (
    Path('~/.codebuddy/media-audio/music/warm').expanduser()
    / 'ES_It Could Be Sweet (Instrumental Version) - Ludlow.mp3'
)
REPORT_PATH = VIDEOS / f'REPRISE-VIDEOS-{DATE}.json'

RESERVE_TITLES = {
    '01-modeles-ouverts': (
        'Les modèles ouverts changent de cap',
        'Comprendre, adapter, vérifier',
    ),
    '02-prix-intelligence': (
        'Le vrai prix d’un million de tokens',
        'Mesurez le coût par tâche',
    ),
    '03-benchmarks-agents': (
        'Un agent fiable réussit trois fois',
        'Testez la répétabilité, pas le podium',
    ),
    '04-securite-autonomie': (
        'Quand l’autonomie dépasse le cadre',
        'Le contrôle doit rester extérieur',
    ),
}

AMBRE_SOURCE = VIDEOS / 'personas/ambre-scenes/tenues'
AMBRE_CLIPS = {
    'azur': AMBRE_SOURCE / 'ambre-kimono-azur-une-piece-rerendu-20260730.mp4',
    'pareo': AMBRE_SOURCE / 'ambre-jupe-pareo-bandeau-rerendu-20260730.mp4',
    'corail': AMBRE_SOURCE / 'ambre-maillot-une-piece-corail-rerendu-20260730.mp4',
    'sable': AMBRE_SOURCE / 'ambre-combishort-lin-sable-rerendu-20260730.mp4',
    'crochet': AMBRE_SOURCE / 'ambre-robe-plage-crochet-ecru-rerendu-20260730.mp4',
    'flamme': AMBRE_SOURCE / 'ambre-robe-longue-fluide-dos-nu-rerendu-20260730.mp4',
    'blanc': AMBRE_SOURCE / 'ambre-une-piece-blanc-pareo-imprime-rerendu-20260730.mp4',
    'chemise': AMBRE_SOURCE / 'ambre-chemise-lin-chapeau-rerendu-20260730.mp4',
}
AMBRE_CONFIGS = [
    {
        'slug': 'ambre-01-un-ete-couleur-azur',
        'title': ('UN ÉTÉ', 'COULEUR D’AZUR'),
        'clips': ['azur', 'blanc', 'crochet', 'pareo'],
    },
    {
        'slug': 'ambre-02-quand-le-soleil-devient-corail',
        'title': ('QUAND LE SOLEIL', 'DEVIENT CORAIL'),
        'clips': ['corail', 'flamme', 'sable', 'chemise'],
    },
    {
        'slug': 'ambre-03-sept-silhouettes-un-horizon',
        'title': ('SEPT SILHOUETTES', 'UN HORIZON'),
        'clips': ['azur', 'pareo', 'corail', 'sable', 'crochet', 'flamme', 'blanc'],
    },
]

COMPLETE_TRAILER_DIRS = (
    'babel-trailer',
    'kepler-trailer',
    'royaume-latent-trailer',
    'gardiens-du-seuil-trailer',
)


class RecoveryError(RuntimeError):
    """Erreur explicite de reprise locale."""


def run(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            text=True,
            capture_output=capture,
        )
    except subprocess.CalledProcessError as error:
        details = (error.stderr or error.stdout or '').strip()[-1600:]
        raise RecoveryError(
            f'échec de {command[0]} ({error.returncode})'
            + (f' : {details}' if details else '')
        ) from error


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def duration(path: Path) -> float:
    result = run(
        [
            'ffprobe',
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'csv=p=0',
            str(path),
        ],
        capture=True,
    )
    return float(result.stdout.strip())


def archive(path: Path, directory: Path) -> Path:
    if not path.exists():
        raise RecoveryError(f'original à archiver introuvable : {path}')
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / path.name
    if destination.exists():
        if sha256(destination) != sha256(path):
            raise RecoveryError(f'collision d’archive : {destination}')
        path.unlink()
        return destination
    path.replace(destination)
    return destination


def measurement(path: Path) -> dict[str, float]:
    return asdict(measure_loudness(path))


def finalize_audio(path: Path, before: dict[str, float] | None = None) -> dict[str, Any]:
    source_before = before or measurement(path)
    after_value = master_video_audio(path)
    assert_delivery_loudness(path, after_value)
    sidecar = write_qc_sidecar(path, after_value)
    return {
        'before': source_before,
        'after': asdict(after_value),
        'sidecar': str(sidecar),
    }


def wrap_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    width: int,
) -> list[str]:
    lines: list[str] = []
    current = ''
    for word in text.split():
        candidate = f'{current} {word}'.strip()
        if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def first_complete_sentences(text: str, limit: int = 230) -> str:
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    selected: list[str] = []
    for sentence in sentences:
        candidate = ' '.join([*selected, sentence])
        if selected and len(candidate) > limit:
            break
        selected.append(sentence)
        if len(candidate) >= limit * 0.62:
            break
    return ' '.join(selected) if selected else text.strip()


def reserve_card(
    destination: Path,
    section: dict[str, Any],
    source: dict[str, Any],
    scene: Path,
) -> None:
    image = Image.open(scene).convert('RGB').resize((1920, 1080))
    image = ImageEnhance.Brightness(image).enhance(0.28)
    image = image.filter(ImageFilter.GaussianBlur(4))
    draw = ImageDraw.Draw(image, 'RGBA')
    draw.rounded_rectangle(
        (105, 90, 1815, 990),
        radius=34,
        fill=(5, 15, 28, 226),
        outline=(84, 214, 255, 255),
        width=4,
    )
    draw.rectangle((105, 90, 121, 990), fill=(84, 214, 255, 255))
    tag = ImageFont.truetype(str(FONT_BOLD), 29)
    title_font = ImageFont.truetype(str(FONT_BOLD), 61)
    body_font = ImageFont.truetype(str(FONT), 36)
    source_font = ImageFont.truetype(str(FONT), 25)
    draw.text((165, 140), 'LISA IA  •  DÉCRYPTAGE DOCUMENTÉ', font=tag, fill='#54D6FF')
    y = 220
    title_lines = wrap_lines(draw, str(section['titre']), title_font, 1500)
    for line in title_lines[:3]:
        draw.text((165, y), line, font=title_font, fill='white')
        y += 76
    y += 34
    draw.text((165, y), 'À RETENIR', font=tag, fill='#54D6FF')
    y += 58
    summary = first_complete_sentences(str(section['texte']))
    body_lines = wrap_lines(draw, summary, body_font, 1490)
    for line in body_lines[:5]:
        draw.text((165, y), line, font=body_font, fill=(226, 235, 244))
        y += 50
    label = str(source.get('label', 'Synthèse éditoriale Lisa'))
    draw.rounded_rectangle((145, 845, 1775, 945), radius=16, fill=(14, 32, 52, 242))
    draw.text((175, 875), f'Source : {label}', font=source_font, fill='white')
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, quality=95)


def make_reserve_revision(episode: Path) -> dict[str, Any]:
    slug = episode.name
    revision = episode / f'revision-{STAMP}'
    work = revision / 'work'
    work.mkdir(parents=True, exist_ok=True)
    plan = json.loads((episode / 'work/plan.json').read_text(encoding='utf-8'))
    hook_title, conclusion_title = RESERVE_TITLES[slug]
    plan['sections'][0]['titre'] = hook_title
    plan['sections'][-1]['titre'] = conclusion_title
    (work / 'plan.json').write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    script = revision / 'episode.script.md'
    script.write_text(
        '\n'.join(
            [
                f'# {hook_title}',
                '',
                *[
                    part
                    for section in plan['sections']
                    for part in (
                        f'## {section["titre"]}',
                        '',
                        str(section['texte']),
                        '',
                    )
                ],
            ]
        ),
        encoding='utf-8',
    )
    voice_link = work / 'voice'
    if not voice_link.exists():
        voice_link.symlink_to(episode / 'work/voice', target_is_directory=True)
    scene = (
        VIDEOS
        / 'personas/lisa-scenes/reportage-japon'
        / 'scene-04-cafe-tech-col-roule.png'
    )
    for section in plan['sections']:
        source = plan.get('sources', {}).get(section.get('source_id'), {})
        reserve_card(
            work / 'source-cards' / f'{section["id"]}.png',
            section,
            source,
            scene,
        )
    avatar = revision / 'avatar'
    avatar.mkdir(exist_ok=True)
    for source in sorted((episode / 'avatar').glob('heygen-run-*.mp4')):
        target = avatar / source.name
        if not target.exists():
            shutil.copy2(source, target)
    command = [
        sys.executable,
        str(LISA_SCRIPT),
        'produire',
        str(script),
        '--sortie',
        str(revision),
        '--dossier-voix',
        str(episode / 'work/voice'),
        '--force-local',
    ]
    run(command)
    generated = revision / 'lisa-presentatrice-demo.mp4'
    final = episode / f'{slug}--fr--master--r2--{DATE}.mp4'
    if final.exists():
        final.unlink()
    generated.replace(final)
    final_measurement = assert_delivery_loudness(final)
    write_qc_sidecar(final, final_measurement)
    archived = archive(
        episode / f'{slug}.mp4',
        episode / f'archive-pre-reprise-{STAMP}',
    )
    return {
        'kind': 'reserve-lisa',
        'source': str(archived),
        'output': str(final),
        'sha256': sha256(final),
        'duration_seconds': duration(final),
        'subtitles': subtitle_report(revision / 'sous-titres.fr.srt', duration(final)),
        'audio': asdict(final_measurement),
        'production_markers': [],
        'cards': len(plan['sections']),
    }


def subtitle_report(path: Path, video_duration: float) -> dict[str, Any]:
    pattern = re.compile(
        r'(?m)^(\d+)\n'
        r'(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n'
        r'(.+?)(?=\n\n|\Z)',
        re.DOTALL,
    )

    def seconds(value: str) -> float:
        hours, minutes, tail = value.split(':')
        second, milliseconds = tail.split(',')
        return (
            int(hours) * 3600
            + int(minutes) * 60
            + int(second)
            + int(milliseconds) / 1000
        )

    cues = []
    for match in pattern.finditer(path.read_text(encoding='utf-8').strip()):
        cues.append(
            {
                'start': seconds(match.group(2)),
                'end': seconds(match.group(3)),
                'text': ' '.join(match.group(4).splitlines()),
            }
        )
    overlaps = sum(
        current['end'] > following['start']
        for current, following in zip(cues, cues[1:])
    )
    short = sum(cue['end'] - cue['start'] < 0.69 for cue in cues)
    return {
        'path': str(path),
        'cues': len(cues),
        'overlaps': overlaps,
        'cues_under_0_7_seconds': short,
        'last_end_seconds': cues[-1]['end'],
        'video_duration_seconds': video_duration,
        'ends_before_video': cues[-1]['end'] <= video_duration - 0.10,
    }


def longform() -> dict[str, Any]:
    directory = VIDEOS / 'publication-2026-07-30/lisa-vision-ia'
    work = directory / 'work'
    revision = directory / f'revision-{STAMP}'
    revision.mkdir(parents=True, exist_ok=True)
    plan = json.loads((work / 'plan.json').read_text(encoding='utf-8'))
    timeline = []
    cursor = 0.0
    for index, section in enumerate(plan['sections']):
        section_duration = float(section['duree_reelle_s'])
        timeline.append(
            {
                'start': cursor,
                'end': cursor + section_duration,
                'duration': section_duration,
            }
        )
        cursor += section_duration
        if index < len(plan['sections']) - 1:
            cursor -= 0.35
    srt = revision / 'lisa-ia-5-signaux.fr.srt'
    ass = revision / 'lisa-ia-5-signaux.fr.ass'
    LISA.make_subtitles(plan['sections'], timeline, plan['sources'], srt, ass)
    video_only = work / 'render/video.mp4'
    audio = work / 'render/mastered.wav'
    main_duration = duration(video_only)
    output = directory / f'lisa-ia-5-signaux--fr--master--r2--{DATE}.mp4'
    ass_escaped = str(ass).replace('\\', r'\\').replace(':', r'\:').replace("'", r"\'")
    filters = (
        "[0:v]drawbox=x=42:y=34:w=220:h=64:color=0x081522@0.82:t=fill,"
        "drawbox=x=42:y=34:w=8:h=64:color=0x49c6e5@1:t=fill,"
        f"drawtext=fontfile={FONT_BOLD}:text='LISA IA':"
        "fontcolor=white:fontsize=31:x=70:y=49,"
        f"ass='{ass_escaped}'[main];"
        f"[2:v]drawtext=fontfile={FONT_BOLD}:text='LISA IA':"
        "fontcolor=0x54D6FF:fontsize=46:x=(w-text_w)/2:y=185,"
        f"drawtext=fontfile={FONT_BOLD}:text='5 SIGNAUX QUI CHANGENT L’IA':"
        "fontcolor=white:fontsize=64:x=(w-text_w)/2:y=330,"
        f"drawtext=fontfile={FONT}:text='Décryptage documenté • sources en description':"
        "fontcolor=0xD8E4F0:fontsize=34:x=(w-text_w)/2:y=475,"
        f"drawtext=fontfile={FONT_BOLD}:text='ABONNEZ-VOUS POUR LA PROCHAINE ÉDITION':"
        "fontcolor=0xFFD166:fontsize=38:x=(w-text_w)/2:y=650,"
        f"drawtext=fontfile={FONT}:text='Création gérée par Agile Up':"
        "fontcolor=0xAAB8C8:fontsize=28:x=(w-text_w)/2:y=845[card];"
        '[main][card]concat=n=2:v=1:a=0[v];'
        f'[1:a]apad=pad_dur=4.0,atrim=0:{main_duration + 4:.3f}[a]'
    )
    run(
        [
            'ffmpeg',
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            str(video_only),
            '-i',
            str(audio),
            '-f',
            'lavfi',
            '-i',
            'color=c=0x07111E:s=1920x1080:r=30:d=4',
            '-filter_complex',
            filters,
            '-map',
            '[v]',
            '-map',
            '[a]',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '18',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '256k',
            '-movflags',
            '+faststart',
            str(output),
        ]
    )
    audio_receipt = finalize_audio(output)
    old_metadata = directory / 'lisa-vision-ia-5-signaux-2026-07-30.metadata.md'
    new_metadata = directory / f'lisa-ia-5-signaux--fr--master--r2--{DATE}.metadata.md'
    metadata = old_metadata.read_text(encoding='utf-8')
    metadata = metadata.replace(
        '# Métadonnées — Lisa Lisa IA 01',
        '# Métadonnées — Lisa IA — édition 01',
    ).replace(
        'lisa-vision-ia-ce-qui-change-vraiment.jpg',
        'lisa-ia-ce-qui-change-vraiment.jpg',
    )
    new_metadata.write_text(metadata, encoding='utf-8')
    shutil.copy2(
        directory / 'lisa-vision-ia-5-signaux-2026-07-30.chapitres.txt',
        directory / f'lisa-ia-5-signaux--fr--master--r2--{DATE}.chapitres.txt',
    )
    archive_dir = directory / f'archive-pre-reprise-{STAMP}'
    archived = []
    for old in (
        directory / 'lisa-vision-ia-5-signaux-2026-07-30.mp4',
        directory / 'lisa-vision-ia-5-signaux-2026-07-30.fr.srt',
        old_metadata,
        directory / 'lisa-vision-ia-5-signaux-2026-07-30.chapitres.txt',
    ):
        archived.append(str(archive(old, archive_dir)))
    return {
        'kind': 'lisa-long',
        'archived': archived,
        'output': str(output),
        'sha256': sha256(output),
        'duration_seconds': duration(output),
        'subtitles': subtitle_report(srt, duration(output)),
        'audio': audio_receipt,
        'end_card_seconds': 4.0,
        'naming': output.name,
        'metadata': str(new_metadata),
    }


def title_gradient_filters(start: float, end: float) -> list[str]:
    filters = []
    top = 1040
    height = 88
    for index in range(10):
        alpha = 0.06 + index * 0.075
        filters.append(
            f'drawbox=x=0:y={top + index * height}:w=1080:h={height}:'
            f'color=black@{alpha:.3f}:t=fill:enable=between(t\\,{start:.3f}\\,{end:.3f})'
        )
    return filters


def ambre() -> list[dict[str, Any]]:
    directory = VIDEOS / 'publication-2026-07-30/shorts-ambre'
    work = directory / f'revision-{STAMP}'
    work.mkdir(parents=True, exist_ok=True)
    results = []
    for config in AMBRE_CONFIGS:
        clips = [AMBRE_CLIPS[key] for key in config['clips']]
        for clip in clips:
            if not clip.is_file():
                raise RecoveryError(f'rush Ambre absent : {clip}')
        segment = 6.2
        crossfade = 0.40
        command = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error']
        for clip in clips:
            command.extend(['-ss', '1.0', '-i', str(clip)])
        command.extend(['-stream_loop', '-1', '-i', str(MUSIC_WARM)])
        filters: list[str] = []
        for index in range(len(clips)):
            filters.append(
                f'[{index}:v]trim=0:{segment:.3f},setpts=PTS-STARTPTS,'
                f'fps=30,setsar=1,format=yuv420p[v{index}]'
            )
        previous = '[v0]'
        offset = 0.0
        for index in range(1, len(clips)):
            offset += segment - crossfade
            filters.append(
                f'{previous}[v{index}]xfade=transition=fade:'
                f'duration={crossfade:.3f}:offset={offset:.3f}[x{index}]'
            )
            previous = f'[x{index}]'
        total = segment * len(clips) - crossfade * (len(clips) - 1)
        title_end = min(5.2, total - 4)
        title_filters = title_gradient_filters(0.2, title_end)
        title_filters.extend(
            [
                f"drawtext=fontfile={FONT}:text='LE VESTIAIRE DES DESTINATIONS':"
                "fontcolor=0xF2EEE7:fontsize=27:x=72:y=1390:"
                f"enable=between(t\\,0.35\\,{title_end:.3f})",
                f"drawtext=fontfile={FONT_SERIF}:text='{config['title'][0]}':"
                "fontcolor=white:fontsize=57:x=72:y=1450:"
                f"enable=between(t\\,0.35\\,{title_end:.3f})",
                f"drawtext=fontfile={FONT_SERIF}:text='{config['title'][1]}':"
                "fontcolor=white:fontsize=57:x=72:y=1525:"
                f"enable=between(t\\,0.35\\,{title_end:.3f})",
            ]
        )
        card_start = total - 3.6
        title_filters.extend(title_gradient_filters(card_start, total))
        title_filters.extend(
            [
                f"drawtext=fontfile={FONT_BOLD}:text='AMBRE':"
                "fontcolor=0xFFD5B8:fontsize=50:x=72:y=1440:"
                f"enable=between(t\\,{card_start:.3f}\\,{total:.3f})",
                f"drawtext=fontfile={FONT_SERIF}:text='LE VESTIAIRE DES DESTINATIONS':"
                "fontcolor=white:fontsize=39:x=72:y=1520:"
                f"enable=between(t\\,{card_start:.3f}\\,{total:.3f})",
                f"drawtext=fontfile={FONT}:text='Muse virtuelle • création gérée par Agile Up':"
                "fontcolor=0xE8DFD7:fontsize=26:x=72:y=1600:"
                f"enable=between(t\\,{card_start:.3f}\\,{total:.3f})",
                f'fade=t=in:st=0:d=0.35,fade=t=out:st={total - 0.8:.3f}:d=0.8',
            ]
        )
        filters.append(f'{previous}{",".join(title_filters)}[video]')
        music_index = len(clips)
        filters.append(
            f'[{music_index}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,'
            f'afade=t=in:st=0:d=0.5,afade=t=out:st={total - 1.0:.3f}:d=1.0,'
            'volume=0.30[audio]'
        )
        output = directory / f'{config["slug"]}--fr--master--r2--{DATE}.mp4'
        command.extend(
            [
                '-filter_complex',
                ';'.join(filters),
                '-map',
                '[video]',
                '-map',
                '[audio]',
                '-c:v',
                'libx264',
                '-preset',
                'medium',
                '-crf',
                '19',
                '-pix_fmt',
                'yuv420p',
                '-r',
                '30',
                '-c:a',
                'aac',
                '-b:a',
                '256k',
                '-t',
                f'{total:.3f}',
                '-movflags',
                '+faststart',
                str(output),
            ]
        )
        run(command)
        audio_receipt = finalize_audio(output)
        original = directory / f'{config["slug"]}.mp4'
        archived = archive(original, directory / f'archive-pre-reprise-{STAMP}')
        original_metadata = directory / f'{config["slug"]}.metadata.md'
        new_metadata = directory / f'{output.stem}.metadata.md'
        shutil.copy2(original_metadata, new_metadata)
        results.append(
            {
                'kind': 'short-ambre',
                'source': str(archived),
                'output': str(output),
                'sha256': sha256(output),
                'duration_seconds': duration(output),
                'audio': audio_receipt,
                'title_zone': 'bas avec dégradé',
                'end_card_seconds': 3.6,
                'rushes': [
                    {
                        'path': str(path),
                        'sha256': sha256(path),
                        'qc_sidecar': str(path.with_suffix('.mp4.qc.json')),
                    }
                    for path in clips
                ],
            }
        )
    return results


def book_shorts() -> list[dict[str, Any]]:
    directory = VIDEOS / 'shorts'
    configs = (
        (
            'babel',
            'L’ALGORITHME DE BABEL',
            'short-babel-1080x1920.mp4',
        ),
        (
            'kepler',
            'LES ÉCHOS DE KEPLER-442',
            'short-kepler-1080x1920.mp4',
        ),
    )
    results = []
    for slug, title, filename in configs:
        source = directory / filename
        source_duration = duration(source)
        start = max(0.0, source_duration - 4.5)
        output = directory / f'{slug}--fr--master--r2--{DATE}.mp4'
        vf = (
            f"drawbox=x=0:y=0:w=1080:h=1920:color=0x07111E@0.97:t=fill:"
            f"enable='gte(t,{start:.3f})',"
            f"drawtext=fontfile={FONT_BOLD}:text='{title}':"
            f"fontcolor=white:fontsize=57:x=(w-text_w)/2:y=650:"
            f"enable='gte(t,{start:.3f})',"
            f"drawtext=fontfile={FONT}:text='Roman de Patrice Huetz':"
            f"fontcolor=0xF5C451:fontsize=39:x=(w-text_w)/2:y=845:"
            f"enable='gte(t,{start:.3f})',"
            f"drawtext=fontfile={FONT_BOLD}:"
            f"text='MANUSCRIT COMPLET • RÉVISION ÉDITORIALE':"
            f"fontcolor=0xD8E4F0:fontsize=29:x=(w-text_w)/2:y=1000:"
            f"enable='gte(t,{start:.3f})',"
            f"drawtext=fontfile={FONT_BOLD}:text='SORTIE À VENIR':"
            f"fontcolor=white:fontsize=43:x=(w-text_w)/2:y=1155:"
            f"enable='gte(t,{start:.3f})',"
            f"drawtext=fontfile={FONT}:text='patricehuetz.fr':"
            f"fontcolor=0x9AD7FF:fontsize=32:x=(w-text_w)/2:y=1310:"
            f"enable='gte(t,{start:.3f})'"
        )
        run(
            [
                'ffmpeg',
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                str(source),
                '-vf',
                vf,
                '-c:v',
                'libx264',
                '-preset',
                'medium',
                '-crf',
                '19',
                '-c:a',
                'aac',
                '-b:a',
                '256k',
                '-movflags',
                '+faststart',
                str(output),
            ]
        )
        audio_receipt = finalize_audio(output)
        archived = archive(source, directory / f'archive-pre-reprise-{STAMP}')
        results.append(
            {
                'kind': 'short-roman',
                'title_id': slug,
                'source': str(archived),
                'output': str(output),
                'sha256': sha256(output),
                'audio': audio_receipt,
                'end_card_seconds': round(source_duration - start, 3),
                'commercial_status': 'manuscrit complet, révision majeure',
            }
        )
    return results


def physical_role(stem: str) -> str:
    if 'send-under30mb' in stem or '1600x900' in stem:
        return 'delivery'
    if 'directorscut' in stem or '-v2-' in f'-{stem}-':
        return 'alternate'
    return 'master'


def remaster_complete_trailers() -> dict[str, Any]:
    eligible = []
    remastered = []
    skipped = []
    for directory_name in COMPLETE_TRAILER_DIRS:
        directory = VIDEOS / directory_name
        title_id = directory_name.removesuffix('-trailer')
        for source in sorted(directory.glob('*.mp4')):
            before = measurement(source)
            item = {
                'path': str(source),
                'before': before,
                'sha256': sha256(source),
            }
            eligible.append(item)
            if (
                abs(before['integrated_lufs'] + 14.0) <= 1.0
                and before['true_peak_dbtp'] <= -1.0
            ):
                skipped.append({**item, 'reason': 'déjà conforme'})
                continue
            language = 'en' if '-EN-' in source.name else 'fr'
            role = physical_role(source.stem)
            output = directory / (
                f'{title_id}--{language}--{role}--r2--{source.stem}.mp4'
            )
            shutil.copy2(source, output)
            after = master_video_audio(output)
            assert_delivery_loudness(output, after)
            sidecar = write_qc_sidecar(output, after)
            archived = archive(source, directory / f'archive-pre-loudness-{STAMP}')
            remastered.append(
                {
                    **item,
                    'source': str(archived),
                    'output': str(output),
                    'output_sha256': sha256(output),
                    'after': asdict(after),
                    'sidecar': str(sidecar),
                }
            )
    return {
        'kind': 'loudness-complete-manuscripts',
        'eligible_files': len(eligible),
        'remastered_files': len(remastered),
        'already_conform': len(skipped),
        'remastered': remastered,
        'skipped': skipped,
    }


def fake_directorscut() -> dict[str, Any]:
    directory = VIDEOS / 'soeurs-trailer'
    master = directory / 'soeurs-1080p.mp4'
    duplicate = directory / 'soeurs-directorscut-1080p.mp4'
    master_hash = sha256(master)
    duplicate_hash = sha256(duplicate)
    if master_hash != duplicate_hash:
        raise RecoveryError('le directorscut des Sœurs n’est plus identique au master')
    archive_dir = directory / f'archive-faux-directorscut-{STAMP}'
    archived = archive(duplicate, archive_dir)
    readme = archive_dir / 'README.md'
    readme.write_text(
        '# Faux director’s cut archivé\n\n'
        f'- Original logique : `{master.name}`\n'
        f'- Copie archivée : `{archived.name}`\n'
        f'- SHA-256 commun : `{master_hash}`\n'
        '- Motif : copie bit à bit, aucune différence éditoriale ou physique.\n\n'
        '## Schéma de nommage retenu\n\n'
        '`<title-id>--<language>--<role>--r<revision>--<master-id>.mp4`\n\n'
        'Rôles autorisés : `master`, `delivery`, `alternate`. Le rôle '
        '`alternate` exige une différence documentée ; le mot '
        '`directorscut` ne constitue pas une différence.\n',
        encoding='utf-8',
    )
    return {
        'kind': 'fake-directorscut',
        'master': str(master),
        'archived': str(archived),
        'sha256': master_hash,
        'naming_documentation': str(readme),
    }


def save_report(items: list[Any]) -> None:
    REPORT_PATH.write_text(
        json.dumps(
            {
                'schema_version': 1,
                'date': DATE,
                'published': False,
                'external_generation_calls': 0,
                'items': items,
            },
            ensure_ascii=False,
            indent=2,
        )
        + '\n',
        encoding='utf-8',
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'action',
        choices=(
            'reserve',
            'longform',
            'ambre',
            'book-shorts',
            'loudness',
            'directorscut',
            'all',
        ),
    )
    args = parser.parse_args()
    previous: list[Any] = []
    if REPORT_PATH.exists():
        previous = json.loads(REPORT_PATH.read_text(encoding='utf-8')).get('items', [])
    produced: list[Any] = []
    if args.action in {'reserve', 'all'}:
        produced.extend(
            make_reserve_revision(VIDEOS / 'reserve-lisa' / slug)
            for slug in RESERVE_TITLES
        )
    if args.action in {'longform', 'all'}:
        produced.append(longform())
    if args.action in {'ambre', 'all'}:
        produced.extend(ambre())
    if args.action in {'book-shorts', 'all'}:
        produced.extend(book_shorts())
    if args.action in {'loudness', 'all'}:
        produced.append(remaster_complete_trailers())
    if args.action in {'directorscut', 'all'}:
        produced.append(fake_directorscut())
    save_report([*previous, *produced])
    print(REPORT_PATH)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
