#!/usr/bin/env python3
"""Render AMBRE's first chalet film and write its auditable media sidecar."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
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
HAIR_TRANSITION_THRESHOLD_PX = 4.0
LOUDNESS_TOLERANCE_LU = 0.2
TRUE_PEAK_MAX_DBTP = -1.0
HOME = Path.home()
REPOSITORY = Path(__file__).resolve().parents[2]
SCENES = HOME / 'Videos/personas/ambre-scenes/automne-composites'
SCENE_PLATES = SCENES / '_plates'
REPAIRS = HOME / 'Videos/personas/composites-identite-2026-08-01'
BROLL = HOME / '.codebuddy/media-video/broll'
BROLL_ADMISSION_CRITERION = (
    'Un extrait B-roll est admis seulement si tout élément visible pourrait avoir été '
    'filmé dans le chalet ou ses abords alpins immédiats, pendant le même automne '
    'humide et dans la continuité lumineuse d’une seule journée. Une simple proximité '
    'd’ambiance ne suffit pas : ville, transport, autre saison, autre climat, objet '
    'narratif étranger au séjour et doublon sans fonction nouvelle sont exclus.'
)
MUSIC = (
    HOME
    / '.codebuddy/media-audio/music/warm'
    / 'ES_It Could Be Sweet (Instrumental Version) - Ludlow.mp3'
)
IDENTITY_REFERENCE = (
    HOME / '.codebuddy/personas/ambre/identity-kit/ambre-v3-preview.png'
)
DEFAULT_OUTPUT_DIR = HOME / '.codebuddy/media-video/ambre-chalet-automne'
VERSION = 'v02'
DIRECT_REPAIR_024 = (
    DEFAULT_OUTPUT_DIR / 'assets-v02/persona/ambre-024-face-protected-direct.png'
)

BROLL_INSPECTION_TIMESTAMPS_SECONDS = (0.5, 2.5, 5.5)
BROLL_SEMANTIC_ADMISSIONS = {
    'b15.mp4': 'Pluie sur la vitre avec feu intérieur : chalet, automne humide et lumière chaude raccord.',
    'b16.mp4': 'Bougie intérieure plausible au chalet ; admise sémantiquement mais non montée pour noir dominant et faible netteté.',
    'b22.mp4': 'Feu de cheminée en mouvement, raccord direct avec le salon du chalet.',
    'b62.mp4': 'Allumage du petit bois, geste plausible dans la cheminée du chalet.',
}
BROLL_RETAINED_FILES = {'b15.mp4', 'b22.mp4', 'b62.mp4'}
BROLL_REJECTION_GROUPS = {
    'hors_lieu_saison_ou_lumiere': {
        'reason': (
            'Lieu, saison, climat ou lumière incompatibles avec les abords alpins du chalet '
            'pendant cette journée d’automne humide.'
        ),
        'files': (
            'b04.mp4', 'b05.mp4', 'b06.mp4', 'b07.mp4', 'b08.mp4', 'b09.mp4',
            'b10.mp4', 'b11.mp4', 'b12.mp4', 'b13.mp4', 'b14.mp4', 'b24.mp4',
            'b32.mp4', 'b33.mp4', 'b37.mp4', 'b38.mp4', 'b39.mp4', 'b40.mp4',
            'b41.mp4', 'b42.mp4', 'b43.mp4', 'b44.mp4', 'b53.mp4', 'b55.mp4',
            'b56.mp4', 'b58.mp4', 'b59.mp4', 'b070.mp4', 'b086.mp4',
            'b087.mp4', 'b088.mp4', 'b089.mp4', 'b090.mp4', 'b091.mp4',
            'b092.mp4', 'b093.mp4', 'b094.mp4', 'b104.mp4',
        ),
    },
    'objet_narratif_etranger': {
        'reason': (
            'Objet ou symbole sans présence établie dans le séjour ; la proximité d’ambiance '
            'ne suffit pas à créer une continuité spatiale.'
        ),
        'files': (
            'b18.mp4', 'b19.mp4', 'b20.mp4', 'b21.mp4', 'b23.mp4', 'b27.mp4',
            'b28.mp4', 'b29.mp4', 'b52.mp4', 'b60.mp4', 'b61.mp4', 'b076.mp4',
        ),
    },
    'univers_scientifique_technologique_ou_institutionnel': {
        'reason': (
            'Univers scientifique, technologique, financier, industriel ou institutionnel '
            'sans rapport spatial avec le chalet.'
        ),
        'files': (
            'b26.mp4', 'b31.mp4', 'b45.mp4', 'b47.mp4', 'b48.mp4', 'b49.mp4',
            'b50.mp4', 'b063.mp4', 'b064.mp4', 'b065.mp4', 'b066.mp4',
            'b067.mp4', 'b068.mp4', 'b069.mp4', 'b071.mp4', 'b072.mp4',
            'b073.mp4', 'b074.mp4', 'b075.mp4', 'b077.mp4', 'b078.mp4',
            'b079.mp4', 'b080.mp4', 'b081.mp4', 'b082.mp4', 'b083.mp4',
            'b084.mp4', 'b085.mp4', 'b095.mp4', 'b096.mp4', 'b097.mp4',
            'b098.mp4', 'b099.mp4', 'b100.mp4', 'b101.mp4', 'b102.mp4',
            'b103.mp4',
        ),
    },
}

PLATE_ADMISSIONS = {
    'ambre-013.png': 'Salon chaud exact du composite 023.',
    'ambre-018.png': 'Sous-bois aux feuilles d’automne, plausible à pied depuis le chalet.',
    'ambre-020.png': 'Marché alpin d’automne exact du composite 033.',
    'ambre-022.png': 'Terrasse alpine aux feuilles rousses.',
    'ambre-035.png': 'Salon chaud exact du composite 027.',
    'ambre-036.png': 'Fenêtre sous la pluie exacte du composite 028.',
    'ambre-043.png': 'Marché humide exact du composite 038.',
    'ambre-048.png': 'Salon de chalet et cheminée, sans rupture de saison visible.',
    'ambre-082.png': 'Salon doré et pluvieux exact du composite 030.',
}
PLATE_REJECTION_GROUPS = {
    'hiver_neige': {
        'reason': 'Hiver ou neige visibles : saison incompatible.',
        'files': (
            'ambre-001.png', 'ambre-004.png', 'ambre-019.png', 'ambre-023.png',
            'ambre-025.png', 'ambre-042.png', 'ambre-047.png', 'ambre-073.png',
        ),
    },
    'japon_printemps': {
        'reason': 'Japon et floraison printanière : lieu et saison incompatibles.',
        'files': (
            'ambre-007.png', 'ambre-008.png', 'ambre-009.png', 'ambre-029.png',
            'ambre-030.png', 'ambre-053.png', 'ambre-054.png', 'ambre-076.png',
        ),
    },
    'continuite_insuffisante': {
        'reason': 'Architecture, lumière ou fonction sans continuité suffisante avec le récit retenu.',
        'files': (
            'ambre-002.png', 'ambre-015.png', 'ambre-016.png', 'ambre-021.png',
            'ambre-038.png',
        ),
    },
}


@dataclass(frozen=True)
class Shot:
    shot_id: str
    arc: str
    shot_type: str
    scale: str
    source: Path
    duration: float
    description: str
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
    description: str,
    crop: str | None = None,
    repaired: bool = False,
) -> Shot:
    return Shot(
        shot_id,
        arc,
        'persona',
        scale,
        source,
        duration,
        description,
        move=move,
        crop=crop,
        repaired=repaired,
    )


def plate(
    shot_id: str,
    arc: str,
    scale: str,
    source_name: str,
    duration: float,
    move: str,
    description: str,
    crop: str | None = None,
) -> Shot:
    return Shot(
        shot_id,
        arc,
        'broll',
        scale,
        SCENE_PLATES / source_name,
        duration,
        description,
        move=move,
        crop=crop,
    )


def decor(
    shot_id: str,
    arc: str,
    scale: str,
    source_name: str,
    duration: float,
    source_start: float,
    description: str,
    crop: str | None = None,
) -> Shot:
    return Shot(
        shot_id,
        arc,
        'broll',
        scale,
        BROLL / source_name,
        duration,
        description,
        source_start=source_start,
        crop=crop,
    )


SHOTS = (
    plate('01', 'arriver', 'très large', 'ambre-043.png', 2.8, 'in', 'Le marché alpin mouillé ouvre la journée.'),
    persona('02', 'arriver', 'moyen', SCENES / 'ambre-033-marche-automne-velours.png', 2.5, 'right', 'Ambre arrive au marché, manteau brun et écharpe.'),
    plate('03', 'arriver', 'gros plan', 'ambre-020.png', 2.2, 'left', 'Citrouilles et pavés humides situent l’automne.', '800:450:0:220'),
    persona('04', 'arriver', 'rapproché', REPAIRS / 'jugement-037-038/ambre-038-marche-citrouilles-velours.png', 2.5, 'in', 'Ambre au même marché, cadrage plus intime.', '960:540:160:40', True),
    plate('05', 'arriver', 'large', 'ambre-022.png', 2.7, 'right', 'La terrasse aux feuilles rousses annonce le chalet.'),
    plate('06', 'arriver', 'détail', 'ambre-018.png', 2.3, 'left', 'Le chemin de feuilles prolonge l’approche.', '960:540:160:80'),
    persona('07', 'entrer', 'moyen', SCENES / 'ambre-027-salon-automne-velours.png', 2.5, 'left', 'Ambre franchit le seuil, encore en manteau.'),
    plate('08', 'entrer', 'très large', 'ambre-013.png', 2.8, 'in', 'Le salon chaud est découvert sans personnage.'),
    persona('09', 'entrer', 'gros plan', SCENES / 'ambre-027-salon-automne-velours.png', 2.3, 'in', 'Un second cadrage resserre l’entrée dans le calme.', '960:540:280:60'),
    plate('10', 'entrer', 'macro', 'ambre-013.png', 2.1, 'right', 'Le rai de lumière et le textile font le raccord intérieur.', '800:450:0:160'),
    persona('11', 's_installer', 'large', DIRECT_REPAIR_024, 2.7, 'in', 'Ambre est entrée et reste un instant dans le salon.', '960:540:160:90', True),
    plate('12', 's_installer', 'très large', 'ambre-035.png', 2.6, 'left', 'Le salon d’automne respire autour d’elle.'),
    persona('13', 's_installer', 'moyen', DIRECT_REPAIR_024, 2.3, 'right', 'Reprise plus proche du même instant.', '800:450:240:120', True),
    decor('14', 's_installer', 'macro', 'b62.mp4', 2.1, 0.0, 'Une allumette embrase le petit bois.'),
    plate('15', 's_installer', 'large', 'ambre-048.png', 2.6, 'in', 'Le feu installe la pièce dans une chaleur stable.'),
    persona('16', 's_installer', 'rapproché', REPAIRS / 'replays-v3/ambre-030-salon-dore-flanelle/composite.png', 2.4, 'left', 'Ambre dans la lumière dorée, visage pleinement lisible.', repaired=True),
    decor('17', 's_installer', 'gros plan', 'b22.mp4', 2.2, 0.2, 'Les bûches prennent, mouvement natif du feu.'),
    plate('18', 's_installer', 'large', 'ambre-082.png', 2.6, 'right', 'Le salon doré établit la continuité avec Ambre.'),
    decor('19', 's_installer', 'macro', 'b15.mp4', 2.3, 0.0, 'La pluie glisse devant le feu intérieur.'),
    persona('20', 'regarder_dehors', 'moyen', SCENES / 'ambre-028-salon-pluie-flanelle.png', 2.6, 'right', 'Ambre s’assied face à la vitre sous la pluie.'),
    plate('21', 'regarder_dehors', 'très large', 'ambre-036.png', 2.5, 'out', 'La pièce vide laisse toute la place à la pluie.'),
    persona('22', 'regarder_dehors', 'rapproché', SCENES / 'ambre-028-salon-pluie-flanelle.png', 2.3, 'in', 'Le regard et les gouttes partagent le cadre.', '960:540:0:20'),
    decor('23', 'regarder_dehors', 'gros plan', 'b15.mp4', 2.3, 4.2, 'Une seconde coulée de pluie resserre le temps.'),
    plate('24', 'regarder_dehors', 'large', 'ambre-082.png', 2.4, 'left', 'Le salon pluvieux remplace le second gros plan sur les livres.', '960:540:320:80'),
    plate('25', 'regarder_dehors', 'très large', 'ambre-018.png', 2.7, 'out', 'Le sous-bois devient l’image regardée dehors.'),
    plate('26', 'regarder_dehors', 'détail', 'ambre-082.png', 2.2, 'right', 'Les gouttes et la lampe referment le temps intérieur.', '800:450:480:80'),
    plate('27', 'repartir_avec_image', 'large', 'ambre-043.png', 2.6, 'left', 'Le marché revient comme souvenir du départ.', '960:540:160:90'),
    persona('28', 'repartir_avec_image', 'rapproché', REPAIRS / 'jugement-037-038/ambre-038-marche-citrouilles-velours.png', 2.3, 'out', 'Le visage d’Ambre porte le souvenir du marché.', '960:540:160:40', True),
    plate('29', 'repartir_avec_image', 'gros plan', 'ambre-020.png', 2.2, 'right', 'Les citrouilles deviennent un dernier éclat de saison.', '800:450:0:210'),
    persona('30', 'repartir_avec_image', 'moyen', SCENES / 'ambre-033-marche-automne-velours.png', 2.4, 'left', 'Ambre se retourne une dernière fois au marché.', '960:540:160:60'),
    persona('31', 'repartir_avec_image', 'gros plan', REPAIRS / 'replays-v3/ambre-030-salon-dore-flanelle/composite.png', 3.2, 'in', 'Chute sur le portrait le plus fort : le chalet reste dans son regard.', '960:540:160:40', True),
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


def natural_media_key(name: str) -> tuple[int, str]:
    match = re.search(r'(\d+)', name)
    return (int(match.group(1)) if match else 0, name)


def broll_audit_records() -> list[dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for name, reason in BROLL_SEMANTIC_ADMISSIONS.items():
        records[name] = {
            'file': name,
            'semanticAdmission': True,
            'retainedInMaster': name in BROLL_RETAINED_FILES,
            'reasonCode': 'admis_meme_lieu_saison_journee',
            'reason': reason,
            'inspectedAtSeconds': list(BROLL_INSPECTION_TIMESTAMPS_SECONDS),
        }
    for reason_code, group in BROLL_REJECTION_GROUPS.items():
        for name in group['files']:
            if name in records:
                raise RuntimeError(f'Duplicate B-roll audit entry: {name}')
            records[name] = {
                'file': name,
                'semanticAdmission': False,
                'retainedInMaster': False,
                'reasonCode': reason_code,
                'reason': group['reason'],
                'inspectedAtSeconds': list(BROLL_INSPECTION_TIMESTAMPS_SECONDS),
            }
    return [records[name] for name in sorted(records, key=natural_media_key)]


def plate_audit_records() -> list[dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for name, reason in PLATE_ADMISSIONS.items():
        records[name] = {
            'file': name,
            'semanticAdmission': True,
            'retainedInMaster': True,
            'reasonCode': 'admis_meme_lieu_saison_journee',
            'reason': reason,
        }
    for reason_code, group in PLATE_REJECTION_GROUPS.items():
        for name in group['files']:
            if name in records:
                raise RuntimeError(f'Duplicate source-plate audit entry: {name}')
            records[name] = {
                'file': name,
                'semanticAdmission': False,
                'retainedInMaster': False,
                'reasonCode': reason_code,
                'reason': group['reason'],
            }
    return [records[name] for name in sorted(records, key=natural_media_key)]


def measure_hair_transition(path: Path) -> tuple[float, int]:
    tool_path = REPOSITORY / 'scripts/influencer/mesurer-detourage.py'
    spec = importlib.util.spec_from_file_location('mesurer_detourage', tool_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Cannot load hair-transition tool: {tool_path}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    width, sample_count = module.largeur_transition(path)
    return float(width), int(sample_count)


def validate_plan(
    score_path: Path,
) -> tuple[dict[str, float], dict[str, dict[str, Any]]]:
    if len(SHOTS) != 31:
        raise RuntimeError(f'Expected 31 shots, got {len(SHOTS)}')
    duration = sum(shot.duration for shot in SHOTS)
    if not 75.0 <= duration <= 90.0:
        raise RuntimeError(f'Duration must be 75–90 seconds, got {duration:.3f}')
    persona_shots = [shot for shot in SHOTS if shot.shot_type == 'persona']
    if len(persona_shots) != 12:
        raise RuntimeError(f'Expected 12 persona shots, got {len(persona_shots)}')
    expected_arcs = [
        'arriver',
        'entrer',
        's_installer',
        'regarder_dehors',
        'repartir_avec_image',
    ]
    actual_arcs = list(dict.fromkeys(shot.arc for shot in SHOTS))
    if actual_arcs != expected_arcs:
        raise RuntimeError(f'Narrative arc is out of order: {actual_arcs}')
    if any(left.scale == right.scale for left, right in zip(SHOTS, SHOTS[1:])):
        raise RuntimeError('Two consecutive shots use the same scale')
    for shot in SHOTS:
        if not shot.source.is_file():
            raise FileNotFoundError(shot.source)
        if shot.source.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'} and not shot.move:
            raise RuntimeError(f'Still shot {shot.shot_id} has no camera movement')
        if shot.source.suffix.lower() == '.mp4' and shot.source_start is None:
            raise RuntimeError(f'Video shot {shot.shot_id} has no source start')
    if not MUSIC.is_file() or not IDENTITY_REFERENCE.is_file():
        raise FileNotFoundError('Music or canonical identity reference is missing')

    library_files = {path.name for path in BROLL.glob('*.mp4')}
    audited_library_files = {record['file'] for record in broll_audit_records()}
    if library_files != audited_library_files:
        raise RuntimeError(
            'B-roll audit does not cover the library exactly: '
            f'missing={sorted(library_files - audited_library_files)}, '
            f'extra={sorted(audited_library_files - library_files)}'
        )
    plate_files = {path.name for path in SCENE_PLATES.glob('*.png')}
    audited_plate_files = {record['file'] for record in plate_audit_records()}
    if plate_files != audited_plate_files:
        raise RuntimeError(
            'Source-plate audit does not cover the plate library exactly: '
            f'missing={sorted(plate_files - audited_plate_files)}, '
            f'extra={sorted(audited_plate_files - plate_files)}'
        )
    retained_broll = {shot.source.name for shot in SHOTS if shot.source.parent == BROLL}
    if retained_broll != BROLL_RETAINED_FILES:
        raise RuntimeError(f'Unexpected retained B-roll library files: {sorted(retained_broll)}')
    retained_plates = {shot.source.name for shot in SHOTS if shot.source.parent == SCENE_PLATES}
    if retained_plates != set(PLATE_ADMISSIONS):
        raise RuntimeError(f'Unexpected retained source plates: {sorted(retained_plates)}')

    scores_raw = json.loads(score_path.read_text(encoding='utf-8'))
    score_by_path = {
        Path(result['path']).resolve(): float(result['arcface'])
        for result in scores_raw
        if result.get('detected', True)
    }
    missing_scores = {
        shot.source.resolve() for shot in persona_shots if shot.source.resolve() not in score_by_path
    }
    if missing_scores:
        raise RuntimeError(f'Missing ArcFace scores for: {sorted(map(str, missing_scores))}')
    scores = {
        shot.shot_id: score_by_path[shot.source.resolve()]
        for shot in persona_shots
    }
    failures = {shot_id: score for shot_id, score in scores.items() if score < IDENTITY_THRESHOLD}
    if failures:
        raise RuntimeError(f'ArcFace admission gate failed: {failures}')

    source_hair: dict[Path, tuple[float, int]] = {}
    hair_measurements: dict[str, dict[str, Any]] = {}
    for shot in persona_shots:
        source = shot.source.resolve()
        if source not in source_hair:
            source_hair[source] = measure_hair_transition(source)
        width, sample_count = source_hair[source]
        hair_measurements[shot.shot_id] = {
            'source': str(source),
            'transitionWidthPx': width,
            'sampledColumns': sample_count,
            'thresholdPx': HAIR_TRANSITION_THRESHOLD_PX,
            'passed': not math.isnan(width) and width >= HAIR_TRANSITION_THRESHOLD_PX,
        }
    hair_failures = {
        shot_id: measurement['transitionWidthPx']
        for shot_id, measurement in hair_measurements.items()
        if not measurement['passed']
    }
    if hair_failures:
        raise RuntimeError(f'Hair-transition admission gate failed: {hair_failures}')
    return scores, hair_measurements


def still_filter(shot: Shot) -> str:
    frames = round(shot.duration * FPS)
    zoom = 'max(1.001,1.065-0.0007*on)' if shot.move == 'out' else '1+0.0007*on'
    if shot.move == 'left':
        x = f'(iw-iw/zoom)*(1-on/{max(frames - 1, 1)})'
    elif shot.move == 'right':
        x = f'(iw-iw/zoom)*(on/{max(frames - 1, 1)})'
    else:
        x = 'iw/2-(iw/zoom/2)'
    filters = []
    if shot.crop:
        filters.append(f'crop={shot.crop}')
    filters.append(
        f"zoompan=z='{zoom}':x='{x}':y='ih/2-(ih/zoom/2)':"
        f'd=1:s={WIDTH}x{HEIGHT}:fps={FPS},setsar=1,format=yuv420p'
    )
    return ','.join(filters)


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
    if shot.source.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}:
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
        if shot.source_start is None:
            raise RuntimeError(f'Video shot {shot.shot_id} has no source start')
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
                'arc': shot.arc,
                'scale': shot.scale,
                'description': shot.description,
                'timestampSeconds': round(timestamp, 3),
                'path': str(frame),
                'sha256': sha256(frame),
            }
        )
        elapsed += shot.duration
    return frame_records


def build_contact_sheet(
    frames: list[dict[str, Any]],
    qc_dir: Path,
) -> dict[str, Any]:
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    columns = 5
    thumb_width, thumb_height = 320, 180
    label_height = 52
    rows = math.ceil(len(frames) / columns)
    canvas = Image.new(
        'RGB',
        (columns * thumb_width, rows * (thumb_height + label_height)),
        '#10151d',
    )
    font_path = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    font = ImageFont.truetype(str(font_path), 14) if font_path.is_file() else ImageFont.load_default()
    draw = ImageDraw.Draw(canvas)
    resampling = getattr(Image, 'Resampling', Image).LANCZOS
    for index, frame in enumerate(frames):
        column = index % columns
        row = index // columns
        x = column * thumb_width
        y = row * (thumb_height + label_height)
        with Image.open(frame['path']).convert('RGB') as image:
            thumbnail = ImageOps.fit(
                image,
                (thumb_width, thumb_height),
                method=resampling,
            )
        canvas.paste(thumbnail, (x, y))
        first_line = (
            f"{frame['shotId']} · {frame['arc'].replace('_', ' ')} · "
            f"{frame['shotType']}"
        )
        draw.text((x + 8, y + thumb_height + 5), first_line, fill='#f2f2f2', font=font)
        draw.text((x + 8, y + thumb_height + 27), frame['scale'], fill='#aeb9c8', font=font)

    contact_dir = qc_dir / 'contact'
    contact_dir.mkdir(parents=True, exist_ok=True)
    path = contact_dir / f'final-{VERSION}-31.jpg'
    canvas.save(path, quality=94, subsampling=0)
    return {
        'path': str(path),
        'sha256': sha256(path),
        'shotCount': len(frames),
        'columns': columns,
        'rows': rows,
        'labels': 'shot id, narrative arc, type and scale',
    }


def measure_master_hair(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    measurements = []
    for frame in frames:
        if frame['shotType'] != 'persona':
            continue
        width, sample_count = measure_hair_transition(Path(frame['path']))
        passed = not math.isnan(width) and width >= HAIR_TRANSITION_THRESHOLD_PX
        measurements.append(
            {
                'shotId': frame['shotId'],
                'frame': frame['path'],
                'frameSha256': frame['sha256'],
                'transitionWidthPx': width,
                'sampledColumns': sample_count,
                'thresholdPx': HAIR_TRANSITION_THRESHOLD_PX,
                'passed': passed,
            }
        )
    if len(measurements) < 6:
        raise RuntimeError(f'Expected at least six master hair measurements, got {len(measurements)}')
    failures = {
        measurement['shotId']: measurement['transitionWidthPx']
        for measurement in measurements
        if not measurement['passed']
    }
    if failures:
        raise RuntimeError(f'Master hair-transition gate failed: {failures}')
    return measurements


def detect_scene_changes(video: Path, threshold: float = 0.35) -> dict[str, Any]:
    scene_filter = f"select='gt(scene,{threshold})',showinfo"
    result = run(
        [
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-i',
            str(video),
            '-vf',
            scene_filter,
            '-an',
            '-f',
            'null',
            '-',
        ],
        capture=True,
    )
    timestamps = [
        float(value)
        for value in re.findall(r'pts_time:([0-9.]+)', result.stderr)
    ]
    planned_cut_count = len(SHOTS) - 1
    if len(timestamps) != planned_cut_count:
        raise RuntimeError(
            f'Scene-change gate failed: detected {len(timestamps)}, '
            f'planned {planned_cut_count}'
        )
    return {
        'filter': scene_filter,
        'threshold': threshold,
        'detectedChangeCount': len(timestamps),
        'timestampsSeconds': timestamps,
        'plannedHardCutCount': planned_cut_count,
        'passed': True,
    }


def measure_motion(video: Path) -> list[dict[str, Any]]:
    measurements = []
    elapsed = 0.0
    for shot in SHOTS:
        first = elapsed + 0.25
        second = elapsed + shot.duration - 0.25
        result = run(
            [
                'ffmpeg',
                '-hide_banner',
                '-nostats',
                '-ss',
                f'{first:.3f}',
                '-i',
                str(video),
                '-ss',
                f'{second:.3f}',
                '-i',
                str(video),
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
        matches = re.findall(r'All:([0-9.]+)', result.stderr)
        if not matches:
            raise RuntimeError(f'Could not measure motion for shot {shot.shot_id}')
        ssim = float(matches[-1])
        variation = 1.0 - ssim
        measurements.append(
            {
                'shotId': shot.shot_id,
                'ssim': ssim,
                'variationOneMinusSsim': variation,
                'passed': variation > 0.001,
            }
        )
        elapsed += shot.duration
    failures = {
        measurement['shotId']: measurement['variationOneMinusSsim']
        for measurement in measurements
        if not measurement['passed']
    }
    if failures:
        raise RuntimeError(f'Master motion gate failed: {failures}')
    return measurements


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
        expected_count = sum(shot.shot_type == shot_type for shot in SHOTS)
        if len(records) != expected_count:
            raise RuntimeError(
                f'Visual gate returned {len(records)} {shot_type} records, '
                f'expected {expected_count}'
            )
        if verdicts['REJET']:
            raise RuntimeError(
                f'Visual gate rejected {verdicts["REJET"]} {shot_type} frame(s)'
            )
        summaries[shot_type] = {
            'exitCode': result.returncode,
            'verdicts': verdicts,
            'journal': str(journal),
            'records': records,
        }
    return summaries


def build_shot_records(
    scores: dict[str, float],
    source_hair: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    elapsed = 0.0
    records = []
    for shot in SHOTS:
        record = asdict(shot)
        record['source'] = str(shot.source)
        record['sourceSha256'] = sha256(shot.source)
        if shot.shot_type == 'persona':
            record['sourceRole'] = 'persona-repaired' if shot.repaired else 'persona-original'
            record['identityArcFace'] = scores[shot.shot_id]
            record['sourceHairTransition'] = source_hair[shot.shot_id]
        elif shot.source.parent == SCENE_PLATES:
            record['sourceRole'] = 'character-free-source-plate'
        else:
            record['sourceRole'] = 'audited-library-video'
        record['motion'] = (
            f'ken-burns-{shot.move}'
            if shot.source.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}
            else 'native-source-motion'
        )
        record['timelineStartSeconds'] = round(elapsed, 3)
        elapsed += shot.duration
        record['timelineEndSeconds'] = round(elapsed, 3)
        records.append(record)
    return records


def write_metadata(
    output: Path,
    scores: dict[str, float],
    source_hair: dict[str, dict[str, Any]],
    first_pass: dict[str, str],
    frames: list[dict[str, Any]],
    master_hair: list[dict[str, Any]],
    contact_sheet: dict[str, Any],
    scene_changes: dict[str, Any],
    motion: list[dict[str, Any]],
    gate_summary: dict[str, Any],
    black_alerts: list[dict[str, Any]],
) -> Path:
    probe = ffprobe(output)
    duration = float(probe['format']['duration'])
    persona_count = sum(shot.shot_type == 'persona' for shot in SHOTS)
    audio_measurement = measure_audio(output)
    if abs(audio_measurement['integratedLufs'] + 14.0) > LOUDNESS_TOLERANCE_LU:
        raise RuntimeError(
            'Loudness gate failed: '
            f'{audio_measurement["integratedLufs"]:.2f} LUFS'
        )
    if audio_measurement['truePeakDbtp'] >= TRUE_PEAK_MAX_DBTP:
        raise RuntimeError(
            'True-peak gate failed: '
            f'{audio_measurement["truePeakDbtp"]:.2f} dBTP'
        )
    metadata = {
        'schemaVersion': 2,
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
            'finalMeasurement': audio_measurement,
        },
        'identityAdmission': {
            'scorer': 'scripts/gpuNode/score-arcface-images.py',
            'reference': str(IDENTITY_REFERENCE),
            'referenceSha256': sha256(IDENTITY_REFERENCE),
            'target': IDENTITY_THRESHOLD,
            'scores': scores,
            'passed': all(score >= IDENTITY_THRESHOLD for score in scores.values()),
        },
        'hairEdgeAdmission': {
            'measurementTool': 'scripts/influencer/mesurer-detourage.py',
            'sourceThresholdPx': HAIR_TRANSITION_THRESHOLD_PX,
            'sourcePlanMeasurements': source_hair,
            'sourcePlanCount': len(source_hair),
            'sourcePassed': all(item['passed'] for item in source_hair.values()),
            'masterFrameMeasurements': master_hair,
            'masterFrameCount': len(master_hair),
            'masterPassed': all(item['passed'] for item in master_hair),
        },
        'brollAudit': {
            'criterionWrittenBeforeSelection': True,
            'criterion': BROLL_ADMISSION_CRITERION,
            'inspectionMethod': 'Trois images par vidéo à 0,5 s, 2,5 s et 5,5 s, puis inspection de l’extrait réellement monté dans le master.',
            'libraryFileCount': len(broll_audit_records()),
            'librarySemanticAdmissionCount': sum(
                record['semanticAdmission'] for record in broll_audit_records()
            ),
            'librarySemanticRejectionCount': sum(
                not record['semanticAdmission'] for record in broll_audit_records()
            ),
            'libraryRetainedFileCount': len(BROLL_RETAINED_FILES),
            'libraryRetainedFiles': sorted(BROLL_RETAINED_FILES, key=natural_media_key),
            'admittedButNotRetained': ['b16.mp4'],
            'libraryRecords': broll_audit_records(),
            'sourcePlateFileCount': len(plate_audit_records()),
            'sourcePlateAdmissionCount': len(PLATE_ADMISSIONS),
            'sourcePlateRejectionCount': len(plate_audit_records()) - len(PLATE_ADMISSIONS),
            'sourcePlateRecords': plate_audit_records(),
            'finalBrollShotCount': len(SHOTS) - persona_count,
            'finalUniqueBrollSourceCount': len(
                {shot.source for shot in SHOTS if shot.shot_type == 'broll'}
            ),
            'generatedNewBrollAssets': False,
        },
        'shots': build_shot_records(scores, source_hair),
        'qualityControl': {
            'blackdetect': {
                'filter': 'blackdetect=d=0.08:pix_th=0.10:pic_th=0.98',
                'alerts': black_alerts,
            },
            'sceneChanges': scene_changes,
            'motion': {
                'method': '1 - SSIM entre deux images intérieures à 0,25 s des bords',
                'minimumVariation': min(
                    measurement['variationOneMinusSsim'] for measurement in motion
                ),
                'maximumVariation': max(
                    measurement['variationOneMinusSsim'] for measurement in motion
                ),
                'shots': motion,
                'passed': all(measurement['passed'] for measurement in motion),
            },
            'extractedFinalFrames': frames,
            'finalContactSheet': contact_sheet,
            'masterHairTransition': {
                'thresholdPx': HAIR_TRANSITION_THRESHOLD_PX,
                'measurements': master_hair,
                'passed': all(item['passed'] for item in master_hair),
            },
            'visualGate': gate_summary,
            'humanReview': {
                'automationCannotApprovePublication': True,
                'contactSheetReviewedPlanByPlanIn': 'docs/chaines/AMBRE-VIDEO-01-RAPPORT-V02.md',
            },
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
        default=DEFAULT_OUTPUT_DIR / 'qc-v02/arcface/ambre-v3-preview-v02.json',
    )
    parser.add_argument('--gate-python', type=Path)
    args = parser.parse_args()

    scores, source_hair = validate_plan(args.scores)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f'ambre-chalet-automne-{VERSION}.mp4'
    qc_dir = output_dir / f'qc-{VERSION}'
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
    master_hair = measure_master_hair(frames)
    contact_sheet = build_contact_sheet(frames, qc_dir)
    scene_changes = detect_scene_changes(output)
    motion = measure_motion(output)
    gate_summary: dict[str, Any] = {'notRun': True}
    if args.gate_python is not None:
        gate_summary = run_visual_gate(args.gate_python, qc_dir)
    metadata = write_metadata(
        output,
        scores,
        source_hair,
        first_pass,
        frames,
        master_hair,
        contact_sheet,
        scene_changes,
        motion,
        gate_summary,
        black_alerts,
    )
    print(f'Rendered {output}')
    print(f'Metadata {metadata}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
