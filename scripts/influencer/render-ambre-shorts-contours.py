#!/usr/bin/env python3
"""Remonte les trois Shorts Ambre depuis les clips sans contours fantômes."""

from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path('/home/patrice/Videos/publication-2026-07-30/shorts-ambre')
SOURCE = Path('/home/patrice/Videos/personas/ambre-scenes/tenues')
THUMBNAILS = ROOT.parent / 'miniatures'
FONT_SANS = '/usr/share/fonts/truetype/noto/NotoSansDisplay-Regular.ttf'
FONT_SERIF = '/usr/share/fonts/truetype/noto/NotoSerifDisplay-Regular.ttf'
SUFFIX = 'v3-contours-20260731'

CLIPS = {
    'azur': SOURCE / 'ambre-kimono-azur-une-piece-contours-20260731.mp4',
    'pareo': SOURCE / 'ambre-jupe-pareo-bandeau-contours-20260731.mp4',
    'corail': SOURCE / 'ambre-maillot-une-piece-corail-contours-20260731.mp4',
    'sable': SOURCE / 'ambre-combishort-lin-sable-contours-20260731.mp4',
    'crochet': SOURCE / 'ambre-robe-plage-crochet-ecru-contours-20260731.mp4',
    'flamme': SOURCE / 'ambre-robe-longue-fluide-dos-nu-contours-20260731.mp4',
    'blanc': SOURCE / 'ambre-une-piece-blanc-pareo-imprime-contours-20260731.mp4',
}

SHORTS = [
    {
        'name': 'ambre-01-un-ete-couleur-azur',
        'title': 'Un été couleur d’azur',
        'clips': ['azur', 'blanc', 'crochet', 'sable', 'pareo', 'azur'],
        'thumbnail_clip': 'azur',
        'clip_duration': 10.633,
        'crossfade': 0.65,
    },
    {
        'name': 'ambre-02-quand-le-soleil-devient-corail',
        'title': 'Quand le soleil devient corail',
        'clips': ['corail', 'flamme', 'sable', 'pareo', 'blanc', 'corail'],
        'thumbnail_clip': 'corail',
        'clip_duration': 10.633,
        'crossfade': 0.65,
    },
    {
        'name': 'ambre-03-sept-silhouettes-un-horizon',
        'title': 'Sept silhouettes, un horizon',
        'clips': ['azur', 'pareo', 'corail', 'sable', 'crochet', 'flamme', 'blanc'],
        'thumbnail_clip': 'flamme',
        'clip_duration': 8.5,
        'crossfade': 0.60,
    },
]


def escape_drawtext(text: str) -> str:
    return (
        text.replace('\\', r'\\')
        .replace("'", r"\'")
        .replace(':', r'\:')
        .replace('%', r'\%')
    )


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def gradient_filter(duration: float, label: str = 'gradient') -> str:
    return (
        f'gradients=s=1080x640:r=30:d={duration:.3f}:'
        'c0=#08131f@0.0:c1=#08131f@0.88:'
        'x0=0:y0=0:x1=0:y1=640,format=rgba,'
        'fade=t=in:st=0:d=0.45:alpha=1,'
        f'fade=t=out:st={max(0.0, duration - 0.75):.3f}:d=0.75:alpha=1'
        f'[{label}]'
    )


def title_filter(source: str, title: str, duration: float) -> str:
    escaped_title = escape_drawtext(title)
    return (
        f'{source}'
        f'drawtext=fontfile={FONT_SANS}:'
        "text='LE VESTIAIRE · DES DESTINATIONS':"
        'fontcolor=#eadfcf:fontsize=24:x=76:y=1506:'
        f"enable='between(t,0,{duration:.3f})',"
        f'drawtext=fontfile={FONT_SERIF}:'
        f"text='{escaped_title}':"
        'fontcolor=white:fontsize=58:x=76:y=1560:'
        'shadowcolor=#000000@0.55:shadowx=2:shadowy=3:'
        f"enable='between(t,0,{duration:.3f})',"
        'drawbox=x=76:y=1654:w=145:h=3:color=#e9c68b@0.95:t=fill:'
        f"enable='between(t,0,{duration:.3f})'"
    )


def consecutive_ssim(source: Path, timestamp: float) -> float:
    import cv2
    from skimage.metrics import structural_similarity

    capture = cv2.VideoCapture(str(source))
    frames = []
    for moment in (timestamp, timestamp + 1.0 / 30.0):
        capture.set(cv2.CAP_PROP_POS_MSEC, moment * 1000.0)
        ok, frame = capture.read()
        if not ok:
            capture.release()
            return -1.0
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
    capture.release()
    return float(structural_similarity(frames[0], frames[1]))


def stable_thumbnail_time(source: Path) -> tuple[float, float]:
    # Les candidats sont tous loin des fondus du montage. Le double contrôle
    # consécutif écarte aussi une frame instable produite par le clip.
    candidates = (1.5, 2.0, 2.5, 3.0, 3.5, 4.0)
    scores = [
        (consecutive_ssim(source, timestamp), timestamp)
        for timestamp in candidates
    ]
    score, timestamp = max(scores)
    if score < 0.90:
        raise RuntimeError(
            f'Aucune frame consécutive assez stable dans {source}: {score:.6f}'
        )
    return timestamp, score


def render_video(config: dict[str, object]) -> Path:
    name = str(config['name'])
    source_master = ROOT / f'{name}.mp4'
    destination = ROOT / f'{name}-{SUFFIX}.mp4'
    partial = ROOT / f'.{name}-{SUFFIX}.partial.mp4'
    if destination.exists():
        raise FileExistsError(f'La sortie existe déjà : {destination}')
    if not source_master.is_file():
        raise FileNotFoundError(source_master)

    clip_keys = [str(key) for key in config['clips']]
    inputs = [CLIPS[key] for key in clip_keys]
    for source in inputs:
        if not source.is_file():
            raise FileNotFoundError(source)

    command = ['ffmpeg', '-y', '-hide_banner', '-v', 'warning']
    for source in inputs:
        command.extend(['-i', str(source)])
    command.extend(['-i', str(source_master)])

    clip_duration = float(config['clip_duration'])
    crossfade = float(config['crossfade'])
    filters: list[str] = []
    for index in range(len(inputs)):
        filters.append(
            f'[{index}:v]trim=start=0:duration={clip_duration:.3f},'
            f'setpts=PTS-STARTPTS,fps=30,setsar=1,format=yuv420p[v{index}]'
        )
    previous = '[v0]'
    offset = 0.0
    for index in range(1, len(inputs)):
        offset += clip_duration - crossfade
        label = f'x{index}'
        filters.append(
            f'{previous}[v{index}]xfade=transition=fade:'
            f'duration={crossfade:.3f}:offset={offset:.3f}[{label}]'
        )
        previous = f'[{label}]'

    total = clip_duration * len(inputs) - crossfade * (len(inputs) - 1)
    title_duration = min(6.0, total)
    filters.append(gradient_filter(title_duration))
    filters.append(
        f'{previous}[gradient]overlay=x=0:y=1280:eof_action=pass:shortest=0[graded]'
    )
    filters.append(
        title_filter('[graded]', str(config['title']), title_duration)
        + ',fade=t=in:st=0:d=0.45,'
        f'fade=t=out:st={max(0.0, total - 1.0):.3f}:d=1.0[vout]'
    )
    if partial.exists():
        partial.unlink()
    command.extend([
        '-filter_complex', ';'.join(filters),
        '-map', '[vout]',
        '-map', f'{len(inputs)}:a:0',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '19',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-c:a', 'copy',
        '-t', f'{total:.3f}',
        '-movflags', '+faststart',
        str(partial),
    ])
    print(f'Rendu vidéo : {destination.name}', flush=True)
    run(command)
    partial.replace(destination)
    return destination


def render_thumbnail(config: dict[str, object]) -> dict[str, object]:
    name = str(config['name'])
    destination = THUMBNAILS / f'{name}-{SUFFIX}.jpg'
    if destination.exists():
        raise FileExistsError(f'La sortie existe déjà : {destination}')
    source = CLIPS[str(config['thumbnail_clip'])]
    timestamp, stability = stable_thumbnail_time(source)
    filters = [
        gradient_filter(1.0),
        '[0:v][gradient]overlay=x=0:y=1280[graded]',
        title_filter('[graded]', str(config['title']), 1.0) + '[thumb]',
    ]
    print(
        f'Miniature : {destination.name} '
        f'({timestamp:.3f}s, SSIM={stability:.6f})',
        flush=True,
    )
    run([
        'ffmpeg', '-y', '-hide_banner', '-v', 'warning',
        '-ss', f'{timestamp:.6f}',
        '-i', str(source),
        '-filter_complex', ';'.join(filters),
        '-map', '[thumb]',
        '-frames:v', '1',
        '-update', '1',
        '-q:v', '2',
        str(destination),
    ])
    return {
        'path': str(destination),
        'sourceClip': str(source),
        'timestampSeconds': timestamp,
        'consecutiveFrameSsim': stability,
        'outsideCrossfade': True,
    }


def main() -> None:
    THUMBNAILS.mkdir(parents=True, exist_ok=True)
    records = []
    for config in SHORTS:
        video = render_video(config)
        thumbnail = render_thumbnail(config)
        records.append({
            'short': str(video),
            'thumbnail': thumbnail,
            'clips': [str(CLIPS[str(key)]) for key in config['clips']],
        })
    manifest = {
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'records': records,
        'published': False,
    }
    (ROOT / f'manifest-{SUFFIX}.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


if __name__ == '__main__':
    main()
