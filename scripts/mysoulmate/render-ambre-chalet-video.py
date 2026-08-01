#!/usr/bin/env python3
"""Render AMBRE's first chalet film and write its auditable media sidecar."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FPS = 30
WIDTH = 1280
HEIGHT = 720
IDENTITY_THRESHOLD = 0.75
HOME = Path.home()
REPOSITORY = Path(__file__).resolve().parents[2]
SCENES = HOME / 'Videos/personas/ambre-scenes/automne-composites'
REPAIRS = HOME / 'Videos/personas/composites-identite-2026-08-01'
BROLL = HOME / '.codebuddy/media-video/broll'
MUSIC = (
    HOME
    / '.codebuddy/media-audio/music/warm'
    / 'ES_It Could Be Sweet (Instrumental Version) - Ludlow.mp3'
)
IDENTITY_REFERENCE = (
    HOME / '.codebuddy/personas/ambre/identity-kit/ambre-v3-preview.png'
)
DEFAULT_OUTPUT_DIR = HOME / '.codebuddy/media-video/ambre-chalet-automne'


@dataclass(frozen=True)
class Shot:
    shot_id: str
    arc: str
    shot_type: str
    scale: str
    source: Path
    duration: float
    source_start: float | None = None
    move: str | None = None
    crop: str | None = None
    repaired: bool = False


def persona(
    shot_id: str,
    arc: str,
    scale: str,
    source: Path,
    duration: float,
    move: str,
    repaired: bool = False,
) -> Shot:
    return Shot(
        shot_id,
        arc,
        'persona',
        scale,
        source,
        duration,
        move=move,
        repaired=repaired,
    )


def decor(
    shot_id: str,
    arc: str,
    scale: str,
    source_name: str,
    duration: float,
    source_start: float,
    crop: str | None = None,
) -> Shot:
    return Shot(
        shot_id,
        arc,
        'broll',
        scale,
        BROLL / source_name,
        duration,
        source_start=source_start,
        crop=crop,
    )


SHOTS = (
    decor('01', 'arriver', 'très large', 'b12.mp4', 2.7, 0.0, '1280:576:0:72'),
    decor('02', 'arriver', 'large', 'b094.mp4', 2.5, 0.2, '1280:560:0:80'),
    decor('03', 'arriver', 'gros plan', 'b11.mp4', 2.2, 0.2),
    persona('04', 'arriver', 'large', SCENES / 'ambre-007-chalet-large-doudoune.png', 2.6, 'in'),
    decor('05', 'arriver', 'gros plan', 'b15.mp4', 2.8, 0.0),
    persona('06', 'entrer', 'moyen', SCENES / 'ambre-001-chalet-exterieur-doudoune.png', 2.4, 'right'),
    decor('07', 'entrer', 'très large', 'b094.mp4', 2.4, 4.6, '1280:560:0:80'),
    persona('08', 'entrer', 'moyen', SCENES / 'ambre-002-chalet-exterieur-flanelle.png', 2.5, 'left'),
    decor('09', 'entrer', 'gros plan', 'b11.mp4', 2.2, 4.8),
    persona('10', 'entrer', 'moyen', REPAIRS / 'replays-v2/ambre-012-chalet-balcon-doudoune/composite.png', 2.5, 'in', True),
    decor('11', 's_installer', 'gros plan', 'b15.mp4', 2.3, 2.8),
    persona('12', 's_installer', 'moyen', SCENES / 'ambre-005-chalet-terrasse-doudoune.png', 2.5, 'right'),
    decor('13', 's_installer', 'large', 'b24.mp4', 2.6, 0.2),
    persona('14', 's_installer', 'moyen', SCENES / 'ambre-006-chalet-terrasse-bordeaux.png', 2.5, 'left'),
    decor('15', 's_installer', 'gros plan', 'b22.mp4', 2.3, 0.0),
    persona('16', 's_installer', 'moyen', SCENES / 'ambre-003-chalet-salon-pull-creme.png', 2.5, 'in'),
    decor('17', 's_installer', 'macro', 'b20.mp4', 2.2, 4.8),
    persona('18', 's_installer', 'moyen', SCENES / 'ambre-004-chalet-salon-flanelle.png', 2.5, 'right'),
    decor('19', 's_installer', 'gros plan', 'b18.mp4', 2.3, 0.4),
    persona('20', 's_installer', 'moyen', SCENES / 'ambre-011-chalet-interieur-flanelle.png', 2.5, 'left'),
    decor('21', 's_installer', 'macro', 'b20.mp4', 2.3, 0.0),
    persona('22', 'regarder_dehors', 'moyen', REPAIRS / 'live-008/composite.png', 2.5, 'in', True),
    decor('23', 'regarder_dehors', 'gros plan', 'b15.mp4', 2.3, 5.5),
    persona('24', 'regarder_dehors', 'moyen', SCENES / 'ambre-009-chalet-fenetre-flanelle.png', 2.6, 'right'),
    decor('25', 'regarder_dehors', 'macro', 'b27.mp4', 2.3, 0.0),
    persona('26', 'regarder_dehors', 'large', REPAIRS / 'replays-v2/ambre-010-chalet-aube-bordeaux/composite.png', 2.7, 'left', True),
    decor('27', 'repartir_avec_image', 'macro', 'b27.mp4', 2.3, 4.8),
    decor('28', 'repartir_avec_image', 'moyen', 'b22.mp4', 2.5, 4.8),
    decor('29', 'repartir_avec_image', 'large', 'b24.mp4', 2.6, 4.8),
    decor('30', 'repartir_avec_image', 'macro', 'b18.mp4', 2.3, 4.9),
    decor('31', 'repartir_avec_image', 'très large', 'b12.mp4', 2.9, 5.0, '1280:576:0:72'),
)


def run(command: list[str], *, capture: bool = False, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=check,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_plan(score_path: Path) -> dict[str, float]:
    if len(SHOTS) != 31:
        raise RuntimeError(f'Expected 31 shots, got {len(SHOTS)}')
    if any(left.scale == right.scale for left, right in zip(SHOTS, SHOTS[1:])):
        raise RuntimeError('Two consecutive shots use the same scale')
    for shot in SHOTS:
        if not shot.source.is_file():
            raise FileNotFoundError(shot.source)
    if not MUSIC.is_file() or not IDENTITY_REFERENCE.is_file():
        raise FileNotFoundError('Music or canonical identity reference is missing')

    scores_raw = json.loads(score_path.read_text(encoding='utf-8'))
    if len(scores_raw) != 12:
        raise RuntimeError(f'Expected 12 ArcFace scores, got {len(scores_raw)}')
    ids = [f'{index:03d}' for index in range(1, 13)]
    scores = {shot_id: float(result['arcface']) for shot_id, result in zip(ids, scores_raw)}
    failures = {shot_id: score for shot_id, score in scores.items() if score < IDENTITY_THRESHOLD}
    if failures:
        raise RuntimeError(f'ArcFace admission gate failed: {failures}')
    return scores


def still_filter(shot: Shot) -> str:
    frames = round(shot.duration * FPS)
    zoom = f'1+0.0007*on'
    if shot.move == 'left':
        x = f'(iw-iw/zoom)*(1-on/{max(frames - 1, 1)})'
    elif shot.move == 'right':
        x = f'(iw-iw/zoom)*(on/{max(frames - 1, 1)})'
    else:
        x = 'iw/2-(iw/zoom/2)'
    return (
        f"zoompan=z='{zoom}':x='{x}':y='ih/2-(ih/zoom/2)':"
        f'd=1:s={WIDTH}x{HEIGHT}:fps={FPS},setsar=1,format=yuv420p'
    )


def video_filter(shot: Shot) -> str:
    filters = []
    if shot.crop:
        filters.append(f'crop={shot.crop}')
    filters.extend(
        [
            f'scale={WIDTH}:{HEIGHT}:flags=lanczos',
            'setsar=1',
            f'fps={FPS}',
            'format=yuv420p',
        ]
    )
    return ','.join(filters)


def render_shot(shot: Shot, output: Path) -> None:
    frames = round(shot.duration * FPS)
    base = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    if shot.shot_type == 'persona':
        command = base + [
            '-loop',
            '1',
            '-framerate',
            str(FPS),
            '-i',
            str(shot.source),
            '-vf',
            still_filter(shot),
        ]
    else:
        command = base + [
            '-ss',
            str(shot.source_start),
            '-i',
            str(shot.source),
            '-vf',
            video_filter(shot),
        ]
    command.extend(
        [
            '-an',
            '-frames:v',
            str(frames),
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-crf',
            '16',
            '-profile:v',
            'high',
            '-pix_fmt',
            'yuv420p',
            str(output),
        ]
    )
    run(command)


def parse_loudnorm_json(stderr: str) -> dict[str, str]:
    matches = re.findall(r'\{\s*"input_i".*?\}', stderr, flags=re.DOTALL)
    if not matches:
        raise RuntimeError('Could not parse ffmpeg loudnorm measurement')
    return json.loads(matches[-1])


def music_filter(duration: float, measured: dict[str, str] | None = None) -> str:
    fade_out_start = duration - 2.2
    prefix = f'afade=t=in:st=0:d=0.8,afade=t=out:st={fade_out_start:.3f}:d=2.2'
    loudnorm = 'loudnorm=I=-14:TP=-1.5:LRA=11'
    if measured is None:
        return f'{prefix},{loudnorm}:print_format=json'
    return (
        f'{prefix},{loudnorm}:measured_I={measured["input_i"]}:'
        f'measured_TP={measured["input_tp"]}:measured_LRA={measured["input_lra"]}:'
        f'measured_thresh={measured["input_thresh"]}:offset={measured["target_offset"]}:'
        'linear=true:print_format=summary'
    )


def normalize_and_mux(video: Path, output: Path, duration: float) -> dict[str, str]:
    first_pass = run(
        [
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-stream_loop',
            '-1',
            '-i',
            str(MUSIC),
            '-t',
            f'{duration:.3f}',
            '-af',
            music_filter(duration),
            '-f',
            'null',
            '-',
        ],
        capture=True,
    )
    measured = parse_loudnorm_json(first_pass.stderr)
    run(
        [
            'ffmpeg',
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-stream_loop',
            '-1',
            '-i',
            str(MUSIC),
            '-i',
            str(video),
            '-filter:a',
            music_filter(duration, measured),
            '-map',
            '1:v:0',
            '-map',
            '0:a:0',
            '-t',
            f'{duration:.3f}',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '320k',
            '-ar',
            '48000',
            '-movflags',
            '+faststart',
            str(output),
        ]
    )
    return measured


def ffprobe(path: Path) -> dict[str, Any]:
    result = run(
        [
            'ffprobe',
            '-v',
            'error',
            '-show_entries',
            'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
            '-of',
            'json',
            str(path),
        ],
        capture=True,
    )
    return json.loads(result.stdout)


def measure_audio(path: Path) -> dict[str, float]:
    result = run(
        [
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-i',
            str(path),
            '-af',
            'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
            '-f',
            'null',
            '-',
        ],
        capture=True,
    )
    values = parse_loudnorm_json(result.stderr)
    return {
        'integratedLufs': float(values['input_i']),
        'truePeakDbtp': float(values['input_tp']),
        'loudnessRangeLu': float(values['input_lra']),
        'thresholdLufs': float(values['input_thresh']),
    }


def detect_black(path: Path, alert_dir: Path) -> list[dict[str, Any]]:
    result = run(
        [
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-i',
            str(path),
            '-vf',
            'blackdetect=d=0.08:pix_th=0.10:pic_th=0.98',
            '-an',
            '-f',
            'null',
            '-',
        ],
        capture=True,
    )
    pattern = re.compile(
        r'black_start:(?P<start>[0-9.]+) black_end:(?P<end>[0-9.]+) '
        r'black_duration:(?P<duration>[0-9.]+)'
    )
    alerts = []
    alert_dir.mkdir(parents=True, exist_ok=True)
    for index, match in enumerate(pattern.finditer(result.stderr), start=1):
        alert = {key: float(value) for key, value in match.groupdict().items()}
        frame = alert_dir / f'black-alert-{index:02d}.png'
        timestamp = (alert['start'] + alert['end']) / 2
        run(
            [
                'ffmpeg',
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-ss',
                f'{timestamp:.3f}',
                '-i',
                str(path),
                '-frames:v',
                '1',
                str(frame),
            ]
        )
        alert['inspectionFrame'] = str(frame)
        alerts.append(alert)
    return alerts


def extract_final_frames(video: Path, qc_dir: Path) -> list[dict[str, Any]]:
    frame_records = []
    elapsed = 0.0
    for shot in SHOTS:
        timestamp = elapsed + shot.duration / 2
        directory = qc_dir / 'final-frames' / shot.shot_type
        directory.mkdir(parents=True, exist_ok=True)
        frame = directory / f'shot-{shot.shot_id}-{shot.shot_type}.png'
        run(
            [
                'ffmpeg',
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-ss',
                f'{timestamp:.3f}',
                '-i',
                str(video),
                '-frames:v',
                '1',
                str(frame),
            ]
        )
        frame_records.append(
            {
                'shotId': shot.shot_id,
                'shotType': shot.shot_type,
                'timestampSeconds': round(timestamp, 3),
                'path': str(frame),
                'sha256': sha256(frame),
            }
        )
        elapsed += shot.duration
    return frame_records


def run_visual_gate(gate_python: Path, qc_dir: Path) -> dict[str, Any]:
    gate = REPOSITORY / 'scripts/influencer/visual-gate.py'
    summaries: dict[str, Any] = {}
    for shot_type in ('persona', 'broll'):
        frame_dir = qc_dir / 'final-frames' / shot_type
        journal = qc_dir / f'final-{shot_type}-gate.jsonl'
        command = [
            str(gate_python),
            str(gate),
            str(frame_dir),
            '--persona',
            'ambre',
            '--shot-type',
            shot_type,
            '--reference',
            str(IDENTITY_REFERENCE),
            '--force',
            '--gate',
            '--ollama-models',
            'gemma4:12b',
            '--journal',
            str(journal),
        ]
        result = run(command, capture=True, check=False)
        if result.returncode not in (0, 1):
            raise RuntimeError(
                f'Visual gate failed for {shot_type} with {result.returncode}: {result.stderr}'
            )
        verdicts: dict[str, int] = {'OK': 0, 'À REGARDER': 0, 'REJET': 0}
        records = []
        for sidecar in sorted(frame_dir.glob('*.png.qc.json')):
            record = json.loads(sidecar.read_text(encoding='utf-8'))
            verdict = str(record.get('verdict'))
            verdicts[verdict] = verdicts.get(verdict, 0) + 1
            records.append(
                {
                    'frame': sidecar.name.removesuffix('.qc.json'),
                    'verdict': verdict,
                    'arcface': record.get('deterministic', {}).get('identity_arcface'),
                    'findings': record.get('defauts', []),
                }
            )
        summaries[shot_type] = {
            'exitCode': result.returncode,
            'verdicts': verdicts,
            'journal': str(journal),
            'records': records,
        }
    return summaries


def build_shot_records() -> list[dict[str, Any]]:
    elapsed = 0.0
    records = []
    for shot in SHOTS:
        record = asdict(shot)
        record['source'] = str(shot.source)
        record['sourceSha256'] = sha256(shot.source)
        record['timelineStartSeconds'] = round(elapsed, 3)
        elapsed += shot.duration
        record['timelineEndSeconds'] = round(elapsed, 3)
        records.append(record)
    return records


def write_metadata(
    output: Path,
    scores: dict[str, float],
    first_pass: dict[str, str],
    frames: list[dict[str, Any]],
    gate_summary: dict[str, Any],
    black_alerts: list[dict[str, Any]],
) -> Path:
    probe = ffprobe(output)
    duration = float(probe['format']['duration'])
    persona_count = sum(shot.shot_type == 'persona' for shot in SHOTS)
    metadata = {
        'schemaVersion': 1,
        'kind': 'film',
        'provider': 'film',
        'model': 'ffmpeg-hard-cuts-ken-burns',
        'prompt': 'AMBRE — chalet d’automne : arriver, entrer, s’installer, regarder dehors, repartir avec l’image.',
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'containsSyntheticMedia': True,
        'syntheticContentDeclarationRequired': True,
        'narration': False,
        'titlesOrCards': False,
        'video': {
            'file': output.name,
            'sha256': sha256(output),
            'sizeBytes': int(probe['format']['size']),
            'durationSeconds': duration,
            'width': WIDTH,
            'height': HEIGHT,
            'fps': FPS,
            'shotCount': len(SHOTS),
            'averageShotDurationSeconds': duration / len(SHOTS),
            'personaShotCount': persona_count,
            'personaShotRatio': persona_count / len(SHOTS),
            'decorShotCount': len(SHOTS) - persona_count,
            'hardCutsOnly': True,
        },
        'audio': {
            'continuousMusic': True,
            'sourceFile': MUSIC.name,
            'sourcePath': str(MUSIC),
            'sourceSha256': sha256(MUSIC),
            'title': 'It Could Be Sweet',
            'artistTag': 'Ludlów',
            'library': 'Epidemic Sound',
            'licenseBasis': 'Licence multi-chaînes et publicité déclarée couverte par le propriétaire.',
            'licenseVerifiedExternally': False,
            'normalizationTargetLufs': -14.0,
            'normalizationTruePeakCeilingDbtp': -1.5,
            'firstPass': first_pass,
            'finalMeasurement': measure_audio(output),
        },
        'identityAdmission': {
            'scorer': 'scripts/darkstar/score-arcface-images.py',
            'reference': str(IDENTITY_REFERENCE),
            'referenceSha256': sha256(IDENTITY_REFERENCE),
            'target': IDENTITY_THRESHOLD,
            'scores': scores,
            'passed': all(score >= IDENTITY_THRESHOLD for score in scores.values()),
        },
        'brollAudit': {
            'libraryFileCount': 91,
            'selectedFiles': [
                'b11.mp4',
                'b12.mp4',
                'b15.mp4',
                'b18.mp4',
                'b20.mp4',
                'b22.mp4',
                'b24.mp4',
                'b27.mp4',
                'b094.mp4',
            ],
            'selectedFileCount': 9,
            'excludedFileCount': 82,
            'preMountSelectedCandidateCount': 10,
            'thematicExclusions': 78,
            'detailedExclusions': [
                {'file': 'b55.mp4', 'reason': 'Paysage arctique incohérent avec le chalet alpin.'},
                {'file': 'b56.mp4', 'reason': 'Champ de céréales sans continuité spatiale avec le chalet.'},
                {'file': 'b091.mp4', 'reason': 'Pseudo-texte génératif visible sur une vitrine.'},
                {
                    'file': 'b16.mp4',
                    'reason': 'Rejeté sur le premier rendu : netteté 5,7 après recadrage/agrandissement, seuil 10.',
                },
            ],
            'preMountGate': {'OK': 6, 'À REGARDER': 4, 'REJET': 0},
        },
        'shots': build_shot_records(),
        'qualityControl': {
            'blackdetect': {
                'filter': 'blackdetect=d=0.08:pix_th=0.10:pic_th=0.98',
                'alerts': black_alerts,
            },
            'extractedFinalFrames': frames,
            'visualGate': gate_summary,
        },
    }
    metadata_path = Path(f'{output}.meta.json')
    metadata_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )
    return metadata_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        '--scores',
        type=Path,
        default=DEFAULT_OUTPUT_DIR / 'qc/arcface/ambre-v3-preview.json',
    )
    parser.add_argument('--gate-python', type=Path)
    args = parser.parse_args()

    scores = validate_plan(args.scores)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / 'ambre-chalet-automne-v01.mp4'
    qc_dir = output_dir / 'qc'
    duration = sum(shot.duration for shot in SHOTS)

    with tempfile.TemporaryDirectory(prefix='ambre-chalet-render-', dir=output_dir) as temporary:
        work = Path(temporary)
        rendered_shots = []
        for shot in SHOTS:
            rendered = work / f'shot-{shot.shot_id}.mp4'
            render_shot(shot, rendered)
            rendered_shots.append(rendered)
        concat_manifest = work / 'concat.txt'
        concat_manifest.write_text(
            ''.join(f"file '{path}'\n" for path in rendered_shots),
            encoding='utf-8',
        )
        silent_master = work / 'silent-master.mp4'
        run(
            [
                'ffmpeg',
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-f',
                'concat',
                '-safe',
                '0',
                '-i',
                str(concat_manifest),
                '-c',
                'copy',
                str(silent_master),
            ]
        )
        first_pass = normalize_and_mux(silent_master, output, duration)

    black_alerts = detect_black(output, qc_dir / 'black-alerts')
    frames = extract_final_frames(output, qc_dir)
    gate_summary: dict[str, Any] = {'notRun': True}
    if args.gate_python is not None:
        gate_summary = run_visual_gate(args.gate_python, qc_dir)
    metadata = write_metadata(
        output,
        scores,
        first_pass,
        frames,
        gate_summary,
        black_alerts,
    )
    print(f'Rendered {output}')
    print(f'Metadata {metadata}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
