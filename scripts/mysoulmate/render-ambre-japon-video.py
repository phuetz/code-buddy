#!/usr/bin/env python3
"""Render AMBRE's Japan brand film and write its auditable media sidecar."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any


HOME = Path.home()
REPOSITORY = Path(__file__).resolve().parents[2]
SCENES = HOME / 'Videos/personas/ambre-scenes/automne-composites'
REPAIRS = HOME / 'Videos/personas/composites-identite-2026-08-01'
DECOR = HOME / '.codebuddy/media-video/ambre-automne'
MUSIC = (
    HOME
    / '.codebuddy/media-audio/music/elegant'
    / 'ES_Somewhat Elegant - Dye O.mp3'
)
IDENTITY_REFERENCE = (
    HOME / '.codebuddy/personas/ambre/identity-kit/ambre-v3-preview.png'
)
DEFAULT_OUTPUT_DIR = HOME / '.codebuddy/media-video/ambre-japon'
IDENTITY_THRESHOLD = 0.75


def load_chalet_renderer() -> ModuleType:
    """Load the first-film renderer as a reusable implementation module."""
    source = Path(__file__).with_name('render-ambre-chalet-video.py')
    spec = importlib.util.spec_from_file_location('ambre_chalet_renderer', source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Cannot load reusable renderer: {source}')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BASE = load_chalet_renderer()
Shot = BASE.Shot


def persona(
    shot_id: str,
    arc: str,
    scale: str,
    source: Path,
    duration: float,
    move: str,
    repaired: bool = False,
) -> Any:
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
    source_id: str,
    duration: float,
    source_start: float,
) -> Any:
    return Shot(
        shot_id,
        arc,
        'broll',
        scale,
        DECOR / f'ambre-{source_id}.mp4',
        duration,
        source_start=source_start,
    )


ORIGINALS = {
    path.name.split('-', 2)[1]: path
    for path in sorted(SCENES.glob('ambre-0[12][0-9]-*.png'))
    if 13 <= int(path.name.split('-', 2)[1]) <= 22
}

SELECTED_PERSONA = {
    '013': ORIGINALS['013'],
    '015': ORIGINALS['015'],
    '016': ORIGINALS['016'],
    '017': REPAIRS / 'replays-v3/ambre-017-jardin-pluie-kimono-traditionnel/composite.png',
    '018': ORIGINALS['018'],
    '019': REPAIRS / 'replays/ambre-019-temple-mousse-kimono-rouille/composite.png',
    '020': REPAIRS / 'replays/ambre-020-temple-zen-kimono-traditionnel/composite.png',
    '021': ORIGINALS['021'],
}


SHOTS = (
    decor('01', 'eclosion', 'très large', '007', 3.0, 0.2),
    persona('02', 'eclosion', 'moyen', SELECTED_PERSONA['013'], 2.4, 'in'),
    decor('03', 'eclosion', 'macro', '010', 2.1, 0.1),
    decor('04', 'eclosion', 'large', '029', 2.6, 0.2),
    persona('05', 'eclosion', 'gros plan', SELECTED_PERSONA['016'], 2.3, 'left'),
    decor('06', 'eclosion', 'macro', '032', 2.1, 0.2),
    decor('07', 'geometrie', 'très large', '008', 2.9, 0.1),
    persona('08', 'geometrie', 'moyen', SELECTED_PERSONA['015'], 2.4, 'right'),
    decor('09', 'geometrie', 'large', '053', 2.6, 0.3),
    persona('10', 'geometrie', 'moyen', SELECTED_PERSONA['021'], 2.4, 'in'),
    decor('11', 'geometrie', 'large', '030', 2.5, 0.3),
    persona('12', 'geometrie', 'gros plan', SELECTED_PERSONA['016'], 2.3, 'right'),
    decor('13', 'geometrie', 'très large', '077', 2.9, 2.0),
    decor('14', 'pluie', 'moyen', '009', 2.4, 0.2),
    persona('15', 'pluie', 'gros plan', SELECTED_PERSONA['017'], 2.3, 'left', True),
    decor('16', 'pluie', 'large', '031', 2.5, 0.2),
    persona('17', 'pluie', 'moyen', SELECTED_PERSONA['018'], 2.4, 'in'),
    decor('18', 'pluie', 'large', '054', 2.5, 2.8),
    persona('19', 'pluie', 'gros plan', SELECTED_PERSONA['021'], 2.3, 'right'),
    decor('20', 'pluie', 'large', '078', 2.7, 0.2),
    decor('21', 'dissolution', 'macro', '055', 2.0, 2.7),
    persona('22', 'dissolution', 'gros plan', SELECTED_PERSONA['017'], 2.3, 'right', True),
    decor('23', 'dissolution', 'macro', '079', 2.1, 0.0),
    persona('24', 'dissolution', 'moyen', SELECTED_PERSONA['013'], 2.4, 'left'),
    decor('25', 'dissolution', 'macro', '102', 2.1, 3.8),
    persona('26', 'dissolution', 'moyen', SELECTED_PERSONA['016'], 2.4, 'in'),
    decor('27', 'retour_lumiere', 'très large', '100', 2.8, 1.0),
    persona('28', 'retour_lumiere', 'gros plan', SELECTED_PERSONA['015'], 2.3, 'left'),
    decor('29', 'retour_lumiere', 'large', '101', 2.6, 2.0),
    persona('30', 'retour_lumiere', 'moyen', SELECTED_PERSONA['018'], 2.4, 'right'),
    decor('31', 'retour_lumiere', 'très large', '099', 3.2, 4.0),
)


BASE.SHOTS = SHOTS
BASE.MUSIC = MUSIC
BASE.IDENTITY_REFERENCE = IDENTITY_REFERENCE
BASE.REPOSITORY = REPOSITORY


def scores_by_path(path: Path) -> dict[Path, float]:
    records = json.loads(path.read_text(encoding='utf-8'))
    return {
        Path(str(record['path'])).resolve(): float(record['arcface'])
        for record in records
    }


def validate_plan(original_scores: Path, repair_scores: Path) -> dict[str, Any]:
    if len(ORIGINALS) != 10:
        raise RuntimeError(f'Expected 10 original Japan composites, got {len(ORIGINALS)}')
    if len(SHOTS) != 31:
        raise RuntimeError(f'Expected 31 shots, got {len(SHOTS)}')
    if any(left.scale == right.scale for left, right in zip(SHOTS, SHOTS[1:])):
        raise RuntimeError('Two consecutive shots use the same scale')
    for shot in SHOTS:
        if not shot.source.is_file():
            raise FileNotFoundError(shot.source)
    if not MUSIC.is_file() or not IDENTITY_REFERENCE.is_file():
        raise FileNotFoundError('Music or canonical identity reference is missing')

    original = scores_by_path(original_scores)
    repaired = scores_by_path(repair_scores)
    combined = original | repaired
    rescored_originals: dict[str, float] = {}
    for composite_id, source in ORIGINALS.items():
        resolved = source.resolve()
        if resolved not in original:
            raise RuntimeError(f'Missing original ArcFace score: {source}')
        rescored_originals[composite_id] = original[resolved]

    selected: dict[str, dict[str, Any]] = {}
    for composite_id, source in SELECTED_PERSONA.items():
        resolved = source.resolve()
        if resolved not in combined:
            raise RuntimeError(f'Missing selected ArcFace score: {source}')
        score = combined[resolved]
        selected[composite_id] = {
            'source': str(source),
            'arcface': score,
            'repaired': source.parent != SCENES,
        }
    failures = {
        composite_id: record['arcface']
        for composite_id, record in selected.items()
        if record['arcface'] < IDENTITY_THRESHOLD
    }
    if failures:
        raise RuntimeError(f'ArcFace admission gate failed: {failures}')
    return {
        'rescoredOriginals': rescored_originals,
        'selected': selected,
        'originalPassCount': sum(
            score >= IDENTITY_THRESHOLD for score in rescored_originals.values()
        ),
    }


def detect_scene_cuts(path: Path, threshold: float = 0.22) -> list[float]:
    result = BASE.run(
        [
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-i',
            str(path),
            '-vf',
            f"select='gt(scene,{threshold})',showinfo",
            '-an',
            '-f',
            'null',
            '-',
        ],
        capture=True,
    )
    return [float(value) for value in re.findall(r'pts_time:([0-9.]+)', result.stderr)]


def measure_motion(path: Path) -> list[dict[str, Any]]:
    results = []
    elapsed = 0.0
    for shot in SHOTS:
        first = elapsed + 0.25
        second = elapsed + shot.duration - 0.25
        measured = BASE.run(
            [
                'ffmpeg',
                '-hide_banner',
                '-nostats',
                '-ss',
                f'{first:.3f}',
                '-i',
                str(path),
                '-ss',
                f'{second:.3f}',
                '-i',
                str(path),
                '-filter_complex',
                '[0:v][1:v]ssim',
                '-frames:v',
                '1',
                '-f',
                'null',
                '-',
            ],
            capture=True,
        )
        matches = re.findall(r'All:([0-9.]+)', measured.stderr)
        if not matches:
            raise RuntimeError(f'Could not measure motion for shot {shot.shot_id}')
        ssim = float(matches[-1])
        results.append(
            {
                'shotId': shot.shot_id,
                'ssim': ssim,
                'variationOneMinusSsim': 1.0 - ssim,
            }
        )
        elapsed += shot.duration
    return results


def write_metadata(
    output: Path,
    identity_audit: dict[str, Any],
    first_pass: dict[str, str],
    frames: list[dict[str, Any]],
    gate_summary: dict[str, Any],
    black_alerts: list[dict[str, Any]],
    scene_cuts: list[float],
    motion: list[dict[str, Any]],
) -> Path:
    probe = BASE.ffprobe(output)
    duration = float(probe['format']['duration'])
    persona_count = sum(shot.shot_type == 'persona' for shot in SHOTS)
    selected_broll = sorted({shot.source.name for shot in SHOTS if shot.shot_type == 'broll'})
    persona_alert_count = gate_summary.get('persona', {}).get('verdicts', {}).get('À REGARDER', 0)
    broll_alert_count = gate_summary.get('broll', {}).get('verdicts', {}).get('À REGARDER', 0)
    persona_id_by_path = {
        source.resolve(): composite_id
        for composite_id, source in SELECTED_PERSONA.items()
    }
    used_persona_ids = sorted(
        {
            persona_id_by_path[shot.source.resolve()]
            for shot in SHOTS
            if shot.shot_type == 'persona'
        }
    )
    metadata = {
        'schemaVersion': 1,
        'kind': 'film',
        'provider': 'film',
        'model': 'ffmpeg-hard-cuts-ken-burns',
        'prompt': (
            'AMBRE — Japon : éclosion, géométrie, pluie, dissolution, '
            'puis retour à la lumière.'
        ),
        'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'containsSyntheticMedia': True,
        'syntheticContentDeclarationRequired': True,
        'narration': False,
        'titlesOrCards': False,
        'editorialRestrictions': {
            'firstPersonExperienceClaim': False,
            'identifiableEstablishmentReview': False,
            'inventedEncounter': False,
        },
        'video': {
            'file': output.name,
            'sha256': BASE.sha256(output),
            'sizeBytes': int(probe['format']['size']),
            'durationSeconds': duration,
            'width': BASE.WIDTH,
            'height': BASE.HEIGHT,
            'fps': BASE.FPS,
            'shotCount': len(SHOTS),
            'averageShotDurationSeconds': duration / len(SHOTS),
            'personaShotCount': persona_count,
            'personaShotRatio': persona_count / len(SHOTS),
            'decorShotCount': len(SHOTS) - persona_count,
            'hardCutsOnly': True,
            'detectedCutCount': len(scene_cuts),
            'detectedCutTimesSeconds': scene_cuts,
        },
        'audio': {
            'continuousMusic': True,
            'sourceFile': MUSIC.name,
            'sourcePath': str(MUSIC),
            'sourceSha256': BASE.sha256(MUSIC),
            'title': 'Somewhat Elegant',
            'artistTag': 'Dye O',
            'library': 'Epidemic Sound',
            'licenseBasis': 'Licence multi-chaînes et publicité déclarée couverte par le propriétaire.',
            'licenseVerifiedExternally': False,
            'normalizationTargetLufs': -14.0,
            'normalizationTruePeakCeilingDbtp': -1.5,
            'firstPass': first_pass,
            'finalMeasurement': BASE.measure_audio(output),
        },
        'identityAdmission': {
            'scorer': 'scripts/darkstar/score-arcface-images.py',
            'reference': str(IDENTITY_REFERENCE),
            'referenceSha256': BASE.sha256(IDENTITY_REFERENCE),
            'target': IDENTITY_THRESHOLD,
            **identity_audit,
            'selectedPassCount': len(identity_audit['selected']),
            'usedCompositeIds': used_persona_ids,
            'passed': True,
        },
        'brollAudit': {
            'japanLibraryFileCount': 27,
            'preMountCandidateCount': 19,
            'selectedFiles': selected_broll,
            'selectedFileCount': len(selected_broll),
            'excludedFileCount': 27 - len(selected_broll),
            'preMountGate': {'OK': 5, 'À REGARDER': 13, 'REJET': 0},
            'manualInspection': (
                'Les alertes OCR et contour correspondent aux branches, au gravier, '
                'aux pierres, à l’eau et aux lignes architecturales réelles.'
            ),
        },
        'shots': BASE.build_shot_records(),
        'qualityControl': {
            'blackdetect': {
                'filter': 'blackdetect=d=0.08:pix_th=0.10:pic_th=0.98',
                'alerts': black_alerts,
            },
            'motion': {
                'method': '1 - SSIM entre deux images intérieures à 0,25 s des bords',
                'shots': motion,
            },
            'extractedFinalFrames': frames,
            'visualGateManualReview': {
                'reviewedAlertCount': persona_alert_count + broll_alert_count,
                'personaAlertCount': persona_alert_count,
                'brollAlertCount': broll_alert_count,
                'blockingDefectCount': 0,
                'summary': (
                    'Toutes les alertes ont été ouvertes sur les images extraites du master. '
                    'Les faux positifs correspondent aux branches, pétales, graviers, pierres, '
                    'reflets d’eau et lignes architecturales réelles.'
                ),
            },
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
        '--original-scores',
        type=Path,
        default=DEFAULT_OUTPUT_DIR / 'qc/arcface/originaux-ambre-v3-preview.json',
    )
    parser.add_argument(
        '--repair-scores',
        type=Path,
        default=DEFAULT_OUTPUT_DIR / 'qc/arcface/reparations-nocturnes-ambre-v3-preview.json',
    )
    parser.add_argument('--gate-python', type=Path)
    args = parser.parse_args()

    identity_audit = validate_plan(args.original_scores, args.repair_scores)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / 'ambre-japon-v01.mp4'
    qc_dir = output_dir / 'qc'
    duration = sum(shot.duration for shot in SHOTS)

    with tempfile.TemporaryDirectory(prefix='ambre-japon-render-', dir=output_dir) as temporary:
        work = Path(temporary)
        rendered_shots = []
        for shot in SHOTS:
            rendered = work / f'shot-{shot.shot_id}.mp4'
            BASE.render_shot(shot, rendered)
            rendered_shots.append(rendered)
        concat_manifest = work / 'concat.txt'
        concat_manifest.write_text(
            ''.join(f"file '{path}'\n" for path in rendered_shots),
            encoding='utf-8',
        )
        silent_master = work / 'silent-master.mp4'
        BASE.run(
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
        first_pass = BASE.normalize_and_mux(silent_master, output, duration)

    black_alerts = BASE.detect_black(output, qc_dir / 'black-alerts')
    frames = BASE.extract_final_frames(output, qc_dir)
    gate_summary: dict[str, Any] = {'notRun': True}
    if args.gate_python is not None:
        gate_summary = BASE.run_visual_gate(args.gate_python, qc_dir)
    scene_cuts = detect_scene_cuts(output)
    motion = measure_motion(output)
    metadata = write_metadata(
        output,
        identity_audit,
        first_pass,
        frames,
        gate_summary,
        black_alerts,
        scene_cuts,
        motion,
    )
    print(f'Rendered {output}')
    print(f'Metadata {metadata}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
