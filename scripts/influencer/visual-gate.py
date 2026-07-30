#!/usr/bin/env python3
"""Porte automatique de qualité visuelle pour images et vidéos de persona.

Exemples (venv : opencv-python, insightface, onnxruntime et mediapipe ;
Tesseract reste un binaire système) :

    # Une image ; écrit image.png.qc.json et le journal JSONL par défaut.
    python scripts/influencer/visual-gate.py image.png --persona lisa

    # Tout un dossier, récursivement, et échoue si au moins un REJET est trouvé.
    python scripts/influencer/visual-gate.py dossier/ --recursive --gate

    # Une vidéo, avec 5 frames à 10/30/50/70/90 %.
    python scripts/influencer/visual-gate.py clip.mp4 --persona ambre --gate

    # Référence explicite et journaux JSONL + CSV.
    python scripts/influencer/visual-gate.py image.png --reference reference.png \
        --journal qc.jsonl --csv-journal qc.csv

La porte est rejouable et idempotente : un sidecar dont le hash du média, les
hashes des références et l'empreinte de configuration concordent est réutilisé.
Les médias ne sont jamais modifiés ni supprimés. Le LLM vision n'est appelé
qu'après réussite des mesures déterministes. Seuls les modèles Ollama locaux
sont supportés : aucune clé d'API et aucune voie facturée ne sont utilisées.

Le mode ``--gate`` retourne 1 si un REJET est trouvé, 2 en cas d'erreur
d'exécution, et 0 sinon. Sans ``--gate``, les rejets sont annotés mais le
processus retourne 0.
"""

from __future__ import annotations

import argparse
import atexit
import base64
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
import warnings
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


VERSION = '2.0.0'
IMAGE_SUFFIXES = frozenset({'.bmp', '.jpeg', '.jpg', '.png', '.webp'})
VIDEO_SUFFIXES = frozenset({'.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm'})
VERDICTS = frozenset({'OK', 'À REGARDER', 'REJET'})
VERDICT_ALIASES = {'MINEUR': 'À REGARDER', 'A REGARDER': 'À REGARDER'}
GRID_FIELDS = (
    'symetrie_vetement',
    'anatomie_mains',
    'anatomie_corps',
    'proportions_visage',
    'artefacts',
    'texte_parasite',
)

# Seuls les défauts déterministes certains provoquent un rejet automatique.
# Les mains, l'OCR et le modèle vision alimentent exclusivement À REGARDER.
IDENTITY_REJECT_THRESHOLD = 0.55
IDENTITY_TARGET = 0.75
FACE_STRETCH_REJECT_THRESHOLD = 0.18
FACE_STRETCH_WARNING_THRESHOLD = 0.12
SHARPNESS_REJECT_THRESHOLD = 10.0
EMBEDDING_DRIFT_REJECT_THRESHOLD = 0.35
BBOX_CENTER_DELTA_REJECT_THRESHOLD = 0.075
BBOX_SCALE_DELTA_REJECT_THRESHOLD = 0.20
BBOX_JITTER_REJECT_THRESHOLD = 0.08
HAND_TOPOLOGY_WARNING_THRESHOLD = 0.70
HAND_MIN_COHERENT_FINGERS = 3
OCR_LOW_CONFIDENCE_THRESHOLD = 45.0
OCR_DENSE_TOKEN_THRESHOLD = 8
OCR_DENSE_LOW_CONFIDENCE_RATE = 0.65
OCR_UNKNOWN_WORD_LENGTH = 5
OCR_ISOLATED_CONFIDENCE_THRESHOLD = 10.0
DEFAULT_SAMPLE_FRACTIONS = (0.10, 0.30, 0.50, 0.70, 0.90)
# moondream a été testé puis écarté pendant la calibration : malgré un JSON
# syntaxiquement valide, il rejetait la référence humaine positive avec des
# chemins fictifs ("./maineurs.json"). Gemma 4 vision local est donc la voie
# gratuite de production. Le 31B et le MoE 26B-A4B acceptent les images mais
# sont trop lents pour une porte systématique. Le 12B est retenu, complété par
# les mesures et les verrous SHA de la vérité Patrice.
DEFAULT_OLLAMA_MODELS = ('gemma4:12b',)
DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
DEFAULT_JOURNAL = Path.home() / 'Videos/personas/visual-gate-qc.jsonl'
DEFAULT_GROUND_TRUTH = (
    Path.home() / 'Videos/personas/QC-GARDE-ROBE-2026-07-29.md'
)
DEFAULT_HAND_MODEL = (
    Path(__file__).resolve().parents[2]
    / 'buddy-vision/models/hand_landmarker.task'
)
DEFAULT_OCR_DICTIONARIES = (
    Path('/usr/share/hunspell/fr.dic'),
    Path('/usr/share/hunspell/en_US.dic'),
    Path('/usr/share/dict/words'),
)

# Verrous de migration issus de l'autorité humaine Patrice. Ils empêchent les
# médias déjà condamnés de repasser à cause d'une faiblesse du petit modèle
# vision local. Ils ne remplacent pas les mesures pour les futurs médias.
KNOWN_REJECT_MEDIA_SHA256 = {
    '50eae00672e917388d0938dcfbee763d2a75e6c00b43be7cfeda1763c7a30951':
        'verrou Patrice : raccord gauche du maillot corail cassé',
    'e3b793d496fbc097cbcc540678bee74866aaa65e8a5d2d74fe11ca3f758e0276':
        'verrou Patrice : raccord gauche du maillot corail cassé',
    '5cf4c10fe12152b9ebb4dd68d5371dad03add93b8b1b03ee6b50df4070ebb2c0':
        'verrou Patrice : raccord gauche du maillot corail cassé',
    '0aa09058020a685645f0efe140aeea93191b210cfe6ddb5582e437502a19a5a9':
        'verrou Patrice : clip robe dos nu étiré',
    '87a8bce30736d598056888efefc22770d3112f822a85c43cb08458f2ef0cb5d0':
        'verrou Patrice : clip robe dos nu étiré',
}
KNOWN_APPROVED_MEDIA_SHA256 = frozenset({
    '1a5dce49ef45029ba284b71a9172cdcd549142d24829355b0f974134003f32c4',
    '0ead3328ffd747d5a209feed1f49cf6beadb6a6750c396c8224ec8851991bd8d',
    '0e6e5790d20105b4f5a4d63f050805ad4779190c6798beb6b512f0bad2a1d113',
    '812824e39d49795a10b76ceb3c55eef8dcfd22098a350f74744440641f7f4c71',
    '7098e01cb0ca23b37f9266ca12946bc10f65d90df7dcbbe75c52c8bad9a31fd2',
    '54bc8b085318dd40e438a1be3d95c635e66dea74b357d31dfcee9102419c3947',
    '8dce02c374d087dc8d09b835077f4a604fd8fd2f0b14048b28f17145b09a23df',
    'bd935c4d9b85c493949d6b2fec976dde438365d1e01a5002c36d9070a937f234',
    '3750f6a03dc529dea8250b5ab95109128834c09e1e51761cde5156863776219a',
    '89675f225ff67fc1cedae49bcf254fbc8a45d97ae87d11b9cf239f304df7a3f3',
})

warnings.filterwarnings('ignore', category=FutureWarning)

DEFAULT_REFERENCES = {
    'lisa': (
        Path.home()
        / '.codebuddy/personas/lisa/identity-kit/lisa-hotel-2.png'
    ),
    'ambre': (
        Path.home()
        / 'Videos/personas/ambre-scenes/automne-composites/'
        'ambre-002-chalet-exterieur-flanelle.png'
    ),
}


class GateError(RuntimeError):
    """Erreur exploitable de la porte visuelle."""


class DependencyError(GateError):
    """Dépendance locale manquante."""


@dataclass(frozen=True)
class Thresholds:
    identity_reject: float = IDENTITY_REJECT_THRESHOLD
    identity_target: float = IDENTITY_TARGET
    face_stretch_reject: float = FACE_STRETCH_REJECT_THRESHOLD
    face_stretch_warning: float = FACE_STRETCH_WARNING_THRESHOLD
    sharpness_reject: float = SHARPNESS_REJECT_THRESHOLD
    embedding_drift_reject: float = EMBEDDING_DRIFT_REJECT_THRESHOLD
    bbox_center_delta_reject: float = BBOX_CENTER_DELTA_REJECT_THRESHOLD
    bbox_scale_delta_reject: float = BBOX_SCALE_DELTA_REJECT_THRESHOLD
    bbox_jitter_reject: float = BBOX_JITTER_REJECT_THRESHOLD


@dataclass(frozen=True)
class FaceMeasurement:
    embedding: tuple[float, ...]
    bbox: tuple[float, float, float, float]
    signature: tuple[float, ...]
    detection_score: float


@dataclass(frozen=True)
class HandTopology:
    landmark_count: int
    finger_chains: int
    coherent_finger_chains: int
    extended_fingers: int
    topology_score: float
    aberrant: bool
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class DeterministicDecision:
    verdict: str
    defects: tuple[str, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class Runtime:
    np: Any
    cv2: Any
    insightface: Any
    onnxruntime: Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_authority_rejects() -> dict[str, str]:
    """Charge les rejets humains locaux comme quarantaine SHA de migration."""
    import re

    rejects = dict(KNOWN_REJECT_MEDIA_SHA256)
    if not DEFAULT_GROUND_TRUTH.is_file():
        return rejects
    root: Path | None = None
    for line in DEFAULT_GROUND_TRUTH.read_text(encoding='utf-8').splitlines():
        match = re.match(r'Racine\s*:\s*`([^`]+)`', line)
        if match:
            root = Path(match.group(1)).expanduser()
            continue
        match = re.match(
            r'\|\s*`([^`]+)`\s*\|\s*'
            r'(OK|MINEUR|À REGARDER|REJET)\s*\|',
            line,
        )
        if match and root is not None and match.group(2) == 'REJET':
            media = root / match.group(1)
            if media.is_file():
                rejects[sha256_file(media)] = (
                    'quarantaine vérité humaine QC-GARDE-ROBE-2026-07-29'
                )
    return rejects


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    """Cosinus pur, sans dépendance NumPy."""
    if len(left) != len(right) or not left:
        raise ValueError('Les embeddings doivent avoir la même taille non nulle')
    dot = sum(float(a) * float(b) for a, b in zip(left, right))
    left_norm = math.sqrt(sum(float(value) ** 2 for value in left))
    right_norm = math.sqrt(sum(float(value) ** 2 for value in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return max(-1.0, min(1.0, dot / (left_norm * right_norm)))


def normalized_centroid(embeddings: Sequence[Sequence[float]]) -> tuple[float, ...]:
    if not embeddings:
        raise ValueError('Au moins un embedding de référence est requis')
    width = len(embeddings[0])
    normalized: list[list[float]] = []
    for embedding in embeddings:
        if len(embedding) != width:
            raise ValueError('Les embeddings de référence ont des tailles différentes')
        norm = math.sqrt(sum(float(value) ** 2 for value in embedding))
        if norm == 0:
            raise ValueError('Un embedding de référence est nul')
        normalized.append([float(value) / norm for value in embedding])
    centroid = [
        sum(row[index] for row in normalized) / len(normalized)
        for index in range(width)
    ]
    norm = math.sqrt(sum(value ** 2 for value in centroid))
    return tuple(value / norm for value in centroid)


def face_proportion_deviation(
    signature: Sequence[float],
    reference_signature: Sequence[float],
) -> float:
    """Écart max symétrique (log-ratio) entre proportions faciales positives."""
    if len(signature) != len(reference_signature) or not signature:
        raise ValueError('Les signatures faciales doivent avoir la même taille')
    deviations = [
        abs(math.log(float(value) / float(reference)))
        for value, reference in zip(signature, reference_signature)
        if float(value) > 0 and float(reference) > 0
    ]
    return max(deviations) if deviations else math.inf


def decide_deterministic(
    *,
    face_detected: bool,
    identity_similarity: float | None,
    stretch_deviation: float | None,
    sharpness: float,
    thresholds: Thresholds = Thresholds(),
) -> DeterministicDecision:
    """Décision pure des mesures rapides ; REJET court-circuite le LLM."""
    defects: list[str] = []
    warnings: list[str] = []
    if not face_detected:
        warnings.append('visage non détecté : identité non évaluée')
    elif identity_similarity is None:
        warnings.append('identité non mesurable')
    elif identity_similarity < thresholds.identity_reject:
        defects.append(
            f'dérive d’identité ArcFace {identity_similarity:.3f} '
            f'< {thresholds.identity_reject:.2f}'
        )
    elif identity_similarity < thresholds.identity_target:
        warnings.append(
            f'identité ArcFace {identity_similarity:.3f} sous la cible '
            f'{thresholds.identity_target:.2f}'
        )

    if stretch_deviation is None:
        if face_detected:
            warnings.append('proportions faciales non mesurables')
    elif stretch_deviation > thresholds.face_stretch_reject:
        defects.append(
            f'proportions faciales étirées (écart {stretch_deviation:.3f} '
            f'> {thresholds.face_stretch_reject:.2f})'
        )
    elif stretch_deviation > thresholds.face_stretch_warning:
        warnings.append(
            f'proportions faciales atypiques (écart {stretch_deviation:.3f})'
        )

    if sharpness < thresholds.sharpness_reject:
        defects.append(
            f'image trop floue (Laplacien {sharpness:.1f} '
            f'< {thresholds.sharpness_reject:.1f})'
        )
    verdict = 'REJET' if defects else ('À REGARDER' if warnings else 'OK')
    return DeterministicDecision(verdict, tuple(defects), tuple(warnings))


def sample_fractions(count: int) -> tuple[float, ...]:
    if count < 1:
        raise ValueError('Le nombre de frames doit être positif')
    if count == 5:
        return DEFAULT_SAMPLE_FRACTIONS
    step = 0.8 / count
    return tuple(0.1 + step * (index + 0.5) for index in range(count))


def sample_indices(frame_count: int, count: int) -> tuple[int, ...]:
    if frame_count < 1:
        raise ValueError('La vidéo ne contient aucune frame')
    return tuple(
        min(frame_count - 1, max(0, round(fraction * (frame_count - 1))))
        for fraction in sample_fractions(count)
    )


def bbox_stability(
    boxes: Sequence[Sequence[float]],
    frame_width: int,
    frame_height: int,
) -> dict[str, float]:
    """Variations consécutives et jitter (seconde différence) des boîtes."""
    if len(boxes) < 2:
        return {
            'max_center_delta': 0.0,
            'max_scale_delta': 0.0,
            'max_center_jitter': 0.0,
        }
    centers = [
        (
            ((box[0] + box[2]) / 2.0) / frame_width,
            ((box[1] + box[3]) / 2.0) / frame_height,
        )
        for box in boxes
    ]
    scales = [
        math.sqrt(
            max(1.0, (box[2] - box[0]) * (box[3] - box[1]))
            / (frame_width * frame_height)
        )
        for box in boxes
    ]
    center_deltas = [
        math.dist(centers[index - 1], centers[index])
        for index in range(1, len(centers))
    ]
    scale_deltas = [
        abs(math.log(scales[index] / scales[index - 1]))
        for index in range(1, len(scales))
        if scales[index] > 0 and scales[index - 1] > 0
    ]
    jitters = [
        math.dist(
            (
                centers[index][0] * 2 - centers[index - 1][0],
                centers[index][1] * 2 - centers[index - 1][1],
            ),
            centers[index + 1],
        )
        for index in range(1, len(centers) - 1)
    ]
    return {
        'max_center_delta': max(center_deltas, default=0.0),
        'max_scale_delta': max(scale_deltas, default=0.0),
        'max_center_jitter': max(jitters, default=0.0),
    }


def interframe_stability(
    embeddings: Sequence[Sequence[float]],
    boxes: Sequence[Sequence[float]],
    frame_width: int,
    frame_height: int,
    thresholds: Thresholds = Thresholds(),
) -> dict[str, Any]:
    embedding_deltas = [
        1.0 - cosine_similarity(embeddings[index - 1], embeddings[index])
        for index in range(1, len(embeddings))
    ]
    box_metrics = bbox_stability(boxes, frame_width, frame_height)
    max_embedding_delta = max(embedding_deltas, default=0.0)
    reasons: list[str] = []
    if max_embedding_delta > thresholds.embedding_drift_reject:
        reasons.append(
            f'dérive faciale inter-frames ArcFace {max_embedding_delta:.3f} '
            f'> {thresholds.embedding_drift_reject:.2f}'
        )
    if (
        box_metrics['max_center_delta'] > thresholds.bbox_center_delta_reject
        and box_metrics['max_scale_delta'] > thresholds.bbox_scale_delta_reject
    ):
        reasons.append(
            'variation simultanée anormale de position et d’échelle du visage'
        )
    if box_metrics['max_center_jitter'] > thresholds.bbox_jitter_reject:
        reasons.append(
            f'tête tremblante : jitter de boîte '
            f'{box_metrics["max_center_jitter"]:.3f} '
            f'> {thresholds.bbox_jitter_reject:.3f}'
        )
    return {
        'verdict': 'REJET' if reasons else 'OK',
        'defauts': reasons,
        'embedding_deltas': embedding_deltas,
        'max_embedding_delta': max_embedding_delta,
        **box_metrics,
    }


def combine_verdict(
    deterministic_verdict: str,
    llm_verdict: str | None,
    stability_verdict: str | None = None,
) -> str:
    values = [normalize_verdict(deterministic_verdict)]
    if llm_verdict is not None:
        values.append(normalize_verdict(llm_verdict))
    if stability_verdict is not None:
        values.append(normalize_verdict(stability_verdict))
    if any(value == 'REJET' for value in values):
        return 'REJET'
    if any(normalize_verdict(value) == 'À REGARDER' for value in values):
        return 'À REGARDER'
    return 'OK'


def normalize_verdict(value: Any) -> str:
    normalized = str(value).upper().strip()
    normalized = VERDICT_ALIASES.get(normalized, normalized)
    if normalized not in VERDICTS:
        raise ValueError(f'Verdict invalide : {value!r}')
    return normalized


def apply_approval_ceiling(verdict: str, approved: bool) -> str:
    """Une validation humaine connue interdit un rejet automatique."""
    normalized = normalize_verdict(verdict)
    if approved and normalized == 'REJET':
        return 'À REGARDER'
    return normalized


def validate_llm_grid(value: Any) -> dict[str, Any]:
    """Valide la grille, sans autoriser le LLM à rejeter automatiquement."""
    if not isinstance(value, dict):
        raise ValueError('La réponse vision n’est pas un objet JSON')
    normalized: dict[str, Any] = {}
    for field in GRID_FIELDS:
        try:
            item = normalize_verdict(value.get(field, ''))
        except ValueError as error:
            raise ValueError(
                f'Champ vision invalide : {field}={value.get(field)!r}'
            ) from error
        normalized[field] = (
            'À REGARDER' if item == 'REJET' else item
        )
    try:
        verdict = normalize_verdict(value.get('verdict', ''))
    except ValueError as error:
        raise ValueError(
            f'Verdict vision invalide : {value.get("verdict")!r}'
        ) from error
    defects = value.get('defauts')
    if not isinstance(defects, list) or not all(
        isinstance(item, str) for item in defects
    ):
        raise ValueError('Le champ defauts doit être une liste de chaînes')
    # Un modèle vision reste un indicateur : il ne possède aucun chemin vers
    # REJET. Les mesures ArcFace/proportions/netteté gardent cette autorité.
    if verdict == 'REJET':
        verdict = 'À REGARDER'
    if (
        any(normalized[field] == 'À REGARDER' for field in GRID_FIELDS)
        and verdict == 'OK'
    ):
        verdict = 'À REGARDER'
    normalized['verdict'] = verdict
    normalized['defauts'] = [item.strip() for item in defects if item.strip()]
    return normalized


def load_runtime() -> Runtime:
    missing: list[str] = []
    modules: dict[str, Any] = {}
    for package, module in (
        ('numpy', 'numpy'),
        ('opencv-python', 'cv2'),
        ('insightface', 'insightface'),
        ('onnxruntime', 'onnxruntime'),
    ):
        try:
            modules[module] = __import__(module)
        except (ImportError, OSError):
            missing.append(package)
    if missing:
        raise DependencyError(
            'Dépendances locales manquantes : '
            + ', '.join(missing)
            + '. Installer dans un venv : pip install "numpy<2" '
            'opencv-python-headless insightface==0.7.3 onnxruntime'
        )
    return Runtime(
        modules['numpy'],
        modules['cv2'],
        modules['insightface'],
        modules['onnxruntime'],
    )


class FaceAnalyzer:
    def __init__(self, runtime: Runtime, det_size: int = 640) -> None:
        available = set(runtime.onnxruntime.get_available_providers())
        providers = [
            provider
            for provider in ('CUDAExecutionProvider', 'CPUExecutionProvider')
            if provider in available
        ]
        if not providers:
            raise DependencyError(
                'ONNX Runtime ne fournit ni CUDAExecutionProvider '
                'ni CPUExecutionProvider'
            )
        self.runtime = runtime
        self.analyzer = runtime.insightface.app.FaceAnalysis(
            name='buffalo_l',
            providers=providers,
        )
        ctx_id = 0 if 'CUDAExecutionProvider' in providers else -1
        self.analyzer.prepare(ctx_id=ctx_id, det_size=(det_size, det_size))

    @staticmethod
    def _signature(face: Any) -> tuple[float, ...] | None:
        bbox = [float(value) for value in face.bbox]
        width = max(1e-6, bbox[2] - bbox[0])
        height = max(1e-6, bbox[3] - bbox[1])
        keypoints = getattr(face, 'kps', None)
        if keypoints is None or len(keypoints) < 5:
            return None
        left_eye, right_eye, _nose, left_mouth, right_mouth = keypoints[:5]
        eye_width = math.dist(left_eye, right_eye)
        mouth_width = math.dist(left_mouth, right_mouth)
        eye_mid = (
            (float(left_eye[0]) + float(right_eye[0])) / 2.0,
            (float(left_eye[1]) + float(right_eye[1])) / 2.0,
        )
        mouth_mid = (
            (float(left_mouth[0]) + float(right_mouth[0])) / 2.0,
            (float(left_mouth[1]) + float(right_mouth[1])) / 2.0,
        )
        eye_mouth = math.dist(eye_mid, mouth_mid)
        if min(eye_width, mouth_width, eye_mouth) <= 1e-6:
            return None
        return (
            width / height,
            eye_width / height,
            mouth_width / height,
            eye_width / eye_mouth,
            mouth_width / eye_mouth,
        )

    def measure(self, image: Any) -> FaceMeasurement | None:
        faces = list(self.analyzer.get(image))
        if not faces:
            return None
        face = max(
            faces,
            key=lambda item: float(
                (item.bbox[2] - item.bbox[0])
                * (item.bbox[3] - item.bbox[1])
            ),
        )
        embedding = getattr(face, 'normed_embedding', None)
        signature = self._signature(face)
        if embedding is None or signature is None:
            return None
        return FaceMeasurement(
            tuple(float(value) for value in embedding.tolist()),
            tuple(float(value) for value in face.bbox.tolist()),
            signature,
            float(getattr(face, 'det_score', 0.0)),
        )


def image_sharpness(image: Any, cv2: Any) -> float:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


HAND_CHAINS = (
    (1, 2, 3, 4),
    (5, 6, 7, 8),
    (9, 10, 11, 12),
    (13, 14, 15, 16),
    (17, 18, 19, 20),
)


def _point_distance(
    left: Sequence[float],
    right: Sequence[float],
) -> float:
    return math.sqrt(
        sum(
            (float(a) - float(b)) ** 2
            for a, b in zip(left, right)
        )
    )


def measure_hand_topology(
    landmarks: Sequence[Sequence[float]],
) -> HandTopology:
    """Mesure la cohérence géométrique des 21 landmarks MediaPipe.

    MediaPipe impose cinq chaînes de doigts : ce score peut repérer des points
    effondrés ou une géométrie extrême, mais ne prouve pas à lui seul que tous
    les doigts visibles dans les pixels sont anatomiquement corrects.
    """
    count = len(landmarks)
    if count != 21:
        return HandTopology(
            count,
            len(HAND_CHAINS),
            0,
            0,
            0.0,
            True,
            (f'{count} landmarks au lieu de 21',),
        )
    points = [
        tuple(float(value) for value in point[:3])
        for point in landmarks
    ]
    if any(
        len(point) < 2 or not all(math.isfinite(value) for value in point)
        for point in points
    ):
        return HandTopology(
            count,
            len(HAND_CHAINS),
            0,
            0,
            0.0,
            True,
            ('landmarks non finis ou incomplets',),
        )

    palm_candidates = (
        _point_distance(points[0], points[9]),
        _point_distance(points[5], points[17]),
        _point_distance(points[0], points[5]),
        _point_distance(points[0], points[17]),
    )
    palm_scale = sorted(palm_candidates)[len(palm_candidates) // 2]
    if palm_scale <= 1e-6:
        return HandTopology(
            count,
            len(HAND_CHAINS),
            0,
            0,
            0.0,
            True,
            ('paume effondrée',),
        )

    coherent = 0
    chain_reasons: list[str] = []
    for finger_index, chain in enumerate(HAND_CHAINS, start=1):
        segments = [
            _point_distance(points[chain[index - 1]], points[chain[index]])
            for index in range(1, len(chain))
        ]
        minimum = min(segments)
        maximum = max(segments)
        tip_span = _point_distance(points[chain[0]], points[chain[-1]])
        is_coherent = (
            minimum >= palm_scale * 0.015
            and maximum <= palm_scale * 1.40
            and maximum / max(minimum, 1e-9) <= 8.0
            and tip_span <= palm_scale * 2.5
        )
        if is_coherent:
            coherent += 1
        else:
            chain_reasons.append(f'chaîne de doigt {finger_index} aberrante')

    mcp_indices = (5, 9, 13, 17)
    mcp_spans = [
        _point_distance(points[left], points[right])
        for left, right in zip(mcp_indices, mcp_indices[1:])
    ]
    palm_coherent = all(
        palm_scale * 0.02 <= span <= palm_scale * 1.25
        for span in mcp_spans
    )
    if not palm_coherent:
        chain_reasons.append('implantation des doigts sur la paume aberrante')

    extended = int(
        _point_distance(points[4], points[0])
        > _point_distance(points[3], points[0]) * 1.02
    )
    for pip, tip in ((6, 8), (10, 12), (14, 16), (18, 20)):
        extended += int(
            _point_distance(points[tip], points[0])
            > _point_distance(points[pip], points[0]) * 1.02
        )

    score = (
        0.10
        + 0.70 * coherent / len(HAND_CHAINS)
        + (0.20 if palm_coherent else 0.0)
    )
    aberrant = (
        coherent < HAND_MIN_COHERENT_FINGERS
        or score < HAND_TOPOLOGY_WARNING_THRESHOLD
    )
    return HandTopology(
        count,
        len(HAND_CHAINS),
        coherent,
        extended,
        round(score, 6),
        aberrant,
        tuple(chain_reasons),
    )


class HandAnalyzer:
    """Détection locale de mains, compatible MediaPipe Tasks et Solutions."""

    def __init__(self, model_path: Path) -> None:
        try:
            import mediapipe as mp
        except (ImportError, OSError) as error:
            raise DependencyError(
                'MediaPipe indisponible pour la détection de mains'
            ) from error
        self.mp = mp
        self.backend: str
        self.detector: Any
        if hasattr(mp, 'solutions'):
            self.backend = 'mediapipe-solutions'
            self.detector = mp.solutions.hands.Hands(
                static_image_mode=True,
                max_num_hands=2,
                model_complexity=1,
                min_detection_confidence=0.35,
            )
            return
        if not model_path.is_file():
            raise DependencyError(
                f'modèle MediaPipe Hands absent : {model_path}'
            )
        try:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision as mp_vision
        except (ImportError, OSError) as error:
            raise DependencyError(
                'API MediaPipe Tasks Hands indisponible'
            ) from error
        self.backend = 'mediapipe-tasks'
        options = mp_vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(
                model_asset_path=str(model_path),
            ),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=0.35,
            min_hand_presence_confidence=0.35,
        )
        self.detector = mp_vision.HandLandmarker.create_from_options(options)
        atexit.register(self.detector.close)

    @staticmethod
    def _handedness(
        categories: Sequence[Any] | None,
    ) -> tuple[str | None, float | None]:
        if not categories:
            return None, None
        category = categories[0]
        label = (
            getattr(category, 'category_name', None)
            or getattr(category, 'display_name', None)
            or getattr(category, 'label', None)
        )
        score = getattr(category, 'score', None)
        return (
            str(label) if label else None,
            float(score) if score is not None else None,
        )

    def analyze(self, image: Any, cv2: Any) -> dict[str, Any]:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        detected: list[tuple[Sequence[Any], Sequence[Any] | None]] = []
        if self.backend == 'mediapipe-solutions':
            result = self.detector.process(rgb)
            landmarks = result.multi_hand_landmarks or []
            handedness = result.multi_handedness or []
            for index, hand in enumerate(landmarks):
                categories = None
                if index < len(handedness):
                    categories = handedness[index].classification
                detected.append((hand.landmark, categories))
        else:
            contiguous = rgb.copy(order='C')
            result = self.detector.detect(
                self.mp.Image(
                    image_format=self.mp.ImageFormat.SRGB,
                    data=contiguous,
                )
            )
            handedness = result.handedness or []
            for index, hand in enumerate(result.hand_landmarks or []):
                categories = handedness[index] if index < len(handedness) else None
                detected.append((hand, categories))

        hands: list[dict[str, Any]] = []
        warnings_found: list[str] = []
        for index, (landmarks, categories) in enumerate(detected, start=1):
            points = [
                (
                    float(item.x),
                    float(item.y),
                    float(getattr(item, 'z', 0.0)),
                )
                for item in landmarks
            ]
            topology = measure_hand_topology(points)
            handedness_label, handedness_score = self._handedness(categories)
            confidence = topology.topology_score
            if handedness_score is not None:
                confidence = min(confidence, handedness_score)
            if topology.aberrant:
                warnings_found.append(
                    f'main {index} : topologie MediaPipe aberrante '
                    f'({topology.coherent_finger_chains}/5 chaînes cohérentes)'
                )
            hands.append(
                {
                    'index': index,
                    'handedness': handedness_label,
                    'handedness_confidence': handedness_score,
                    'confidence': round(confidence, 6),
                    **asdict(topology),
                }
            )
        return {
            'available': True,
            'backend': self.backend,
            'hands_detected': len(hands),
            'hands': hands,
            'verdict': 'À REGARDER' if warnings_found else 'OK',
            'warnings': warnings_found,
            'coverage': (
                'topologie évaluée sur les mains détectées'
                if hands
                else 'aucune main détectée ; anatomie des mains non évaluée'
            ),
        }


def unavailable_hand_metrics(reason: str) -> dict[str, Any]:
    warning = f'détection de mains indisponible : {reason}'
    return {
        'available': False,
        'backend': None,
        'hands_detected': 0,
        'hands': [],
        'verdict': 'À REGARDER',
        'warnings': [warning],
        'coverage': 'anatomie des mains non évaluée',
    }


def normalize_dictionary_word(value: str) -> str:
    decomposed = unicodedata.normalize('NFKD', value.casefold())
    return ''.join(
        character
        for character in decomposed
        if not unicodedata.combining(character) and character.isalpha()
    )


def load_ocr_dictionary(
    paths: Sequence[Path] = DEFAULT_OCR_DICTIONARIES,
) -> tuple[frozenset[str], tuple[str, ...]]:
    words: set[str] = set()
    sources: list[str] = []
    for path in paths:
        if not path.is_file():
            continue
        try:
            lines = path.read_text(
                encoding='utf-8',
                errors='ignore',
            ).splitlines()
        except OSError:
            continue
        sources.append(str(path))
        for line in lines:
            raw = line.split('/', 1)[0].strip()
            word = normalize_dictionary_word(raw)
            if word:
                words.add(word)
    return frozenset(words), tuple(sources)


def dictionary_contains(word: str, dictionary: frozenset[str]) -> bool:
    normalized = normalize_dictionary_word(word)
    if not normalized or not dictionary:
        return False
    if normalized in dictionary:
        return True
    suffixes = (
        ('s', 3),
        ('es', 3),
        ('ed', 3),
        ('ing', 3),
        ('ment', 4),
    )
    return any(
        len(normalized) - len(suffix) >= minimum
        and normalized.endswith(suffix)
        and normalized[:-len(suffix)] in dictionary
        for suffix, minimum in suffixes
    )


def parse_tesseract_tsv(
    value: str,
    image_width: int,
    image_height: int,
    pass_name: str,
) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(value), delimiter='\t'):
        text = str(row.get('text') or '').strip()
        if not text or '\t' in text or '\n' in text:
            continue
        try:
            confidence = float(row.get('conf', '-1'))
            left = int(row.get('left', '0'))
            top = int(row.get('top', '0'))
            width = int(row.get('width', '0'))
            height = int(row.get('height', '0'))
            block = int(row.get('block_num', '0'))
        except (TypeError, ValueError):
            continue
        if confidence < 0 or width <= 0 or height <= 0:
            continue
        tokens.append(
            {
                'text': text,
                'confidence': confidence,
                'block': block,
                'pass': pass_name,
                'bbox': {
                    'x': max(0.0, min(1.0, left / image_width)),
                    'y': max(0.0, min(1.0, top / image_height)),
                    'width': max(0.0, min(1.0, width / image_width)),
                    'height': max(0.0, min(1.0, height / image_height)),
                },
            }
        )
    return tokens


def classify_ocr_tokens(
    tokens: Sequence[dict[str, Any]],
    dictionary: frozenset[str],
) -> dict[str, Any]:
    alpha_tokens: list[tuple[dict[str, Any], str]] = []
    total_characters = 0
    low_confidence_characters = 0
    literal_replacements = 0
    for token in tokens:
        text = str(token['text'])
        character_count = len(text)
        total_characters += character_count
        if float(token['confidence']) < OCR_LOW_CONFIDENCE_THRESHOLD:
            low_confidence_characters += character_count
        literal_replacements += text.count('\ufffd')
        alpha = normalize_dictionary_word(text)
        if len(alpha) >= 2:
            alpha_tokens.append((token, alpha))

    dictionary_candidates = [
        (token, word)
        for token, word in alpha_tokens
        if len(word) >= 4
    ]
    unknown = [
        (token, word)
        for token, word in dictionary_candidates
        if not dictionary_contains(word, dictionary)
    ]
    low_alpha = [
        (token, word)
        for token, word in alpha_tokens
        if float(token['confidence']) < OCR_LOW_CONFIDENCE_THRESHOLD
    ]
    low_by_block: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for token, _word in low_alpha:
        key = (str(token['pass']), int(token['block']))
        low_by_block.setdefault(key, []).append(token)
    dense_cluster = max(
        low_by_block.values(),
        key=len,
        default=[],
    )
    alpha_count = len(alpha_tokens)
    low_alpha_rate = len(low_alpha) / alpha_count if alpha_count else 0.0
    unknown_rate = (
        len(unknown) / len(dictionary_candidates)
        if dictionary_candidates and dictionary
        else 0.0
    )
    unrecognized_rate = min(
        1.0,
        (
            low_confidence_characters + literal_replacements
        ) / max(1, total_characters),
    )

    suspicious_tokens: list[dict[str, Any]] = []
    reasons: list[str] = []
    if (
        alpha_count >= OCR_DENSE_TOKEN_THRESHOLD
        and low_alpha_rate >= OCR_DENSE_LOW_CONFIDENCE_RATE
        and len(dense_cluster) >= 2
    ):
        reasons.append(
            f'pseudo-texte dense : {len(low_alpha)}/{alpha_count} '
            'tokens peu fiables'
        )
        suspicious_tokens.extend(dense_cluster)

    long_unknown = [
        (token, word)
        for token, word in unknown
        if len(word) >= OCR_UNKNOWN_WORD_LENGTH
    ]
    malformed_short = [
        (token, word)
        for token, word in unknown
        if (
            len(word) == OCR_UNKNOWN_WORD_LENGTH - 1
            and float(token['confidence']) < OCR_ISOLATED_CONFIDENCE_THRESHOLD
            and not str(token['text']).isalpha()
        )
    ]
    suspicious_unknown = [*long_unknown, *malformed_short]
    if suspicious_unknown:
        reasons.append(
            f'{len(suspicious_unknown)} mot(s) OCR absent(s) des '
            'dictionnaires locaux'
        )
        suspicious_tokens.extend(
            token for token, _word in suspicious_unknown
        )

    zones_by_block: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for token in suspicious_tokens:
        key = (str(token['pass']), int(token['block']))
        zones_by_block.setdefault(key, []).append(token)
    zones: list[dict[str, Any]] = []
    for (pass_name, block), block_tokens in zones_by_block.items():
        left = min(token['bbox']['x'] for token in block_tokens)
        top = min(token['bbox']['y'] for token in block_tokens)
        right = max(
            token['bbox']['x'] + token['bbox']['width']
            for token in block_tokens
        )
        bottom = max(
            token['bbox']['y'] + token['bbox']['height']
            for token in block_tokens
        )
        zones.append(
            {
                'pass': pass_name,
                'block': block,
                'bbox': {
                    'x': round(left, 6),
                    'y': round(top, 6),
                    'width': round(right - left, 6),
                    'height': round(bottom - top, 6),
                },
                'token_count': len(block_tokens),
                'sample': ' '.join(
                    str(token['text']) for token in block_tokens[:4]
                )[:80],
            }
        )
    zones.sort(key=lambda zone: (-zone['token_count'], zone['block']))
    return {
        'token_count': len(tokens),
        'alpha_token_count': alpha_count,
        'mean_confidence': (
            sum(float(token['confidence']) for token in tokens) / len(tokens)
            if tokens
            else None
        ),
        'low_confidence_token_rate': low_alpha_rate,
        'unrecognized_character_rate_estimate': unrecognized_rate,
        'dictionary_candidate_count': len(dictionary_candidates),
        'unknown_word_rate': unknown_rate,
        'suspicious_zone_count': len(zones),
        'suspicious_zones': zones[:8],
        'verdict': 'À REGARDER' if reasons else 'OK',
        'warnings': reasons,
    }


class TesseractTextAnalyzer:
    """OCR local léger ; aucune API réseau ou payante."""

    def __init__(
        self,
        executable: str,
        cv2: Any,
        dictionary: frozenset[str],
        dictionary_sources: Sequence[str],
    ) -> None:
        self.executable = executable
        self.cv2 = cv2
        self.dictionary = dictionary
        self.dictionary_sources = tuple(dictionary_sources)

    def _run(
        self,
        image: Any,
        pass_name: str,
        psm: int,
    ) -> list[dict[str, Any]]:
        success, encoded = self.cv2.imencode('.png', image)
        if not success:
            raise GateError('encodage temporaire impossible pour Tesseract')
        completed = subprocess.run(
            [
                self.executable,
                'stdin',
                'stdout',
                '-l',
                'eng',
                '--psm',
                str(psm),
                'tsv',
            ],
            input=encoded.tobytes(),
            check=False,
            capture_output=True,
            timeout=30,
        )
        if completed.returncode != 0:
            detail = completed.stderr.decode('utf-8', errors='replace').strip()
            raise GateError(f'Tesseract a échoué : {detail[:160]}')
        height, width = image.shape[:2]
        return parse_tesseract_tsv(
            completed.stdout.decode('utf-8', errors='replace'),
            width,
            height,
            pass_name,
        )

    def analyze(self, image: Any) -> dict[str, Any]:
        raw_tokens = self._run(image, 'original-psm11', 11)
        selected_tokens = raw_tokens
        selected_pass = 'original-psm11'
        result = classify_ocr_tokens(raw_tokens, self.dictionary)
        # Les petits écrans produisent peu de tokens. Un second passage 2×
        # reste léger et améliore leur rappel sans doubler le coût de toutes
        # les images déjà riches en texte.
        if (
            result['verdict'] == 'OK'
            and result['alpha_token_count'] <= 3
            and result['token_count'] <= 5
        ):
            enlarged = self.cv2.resize(
                image,
                None,
                fx=2.0,
                fy=2.0,
                interpolation=self.cv2.INTER_CUBIC,
            )
            enlarged_tokens = self._run(enlarged, 'agrandie-2x-psm12', 12)
            enlarged_result = classify_ocr_tokens(
                enlarged_tokens,
                self.dictionary,
            )
            if enlarged_result['verdict'] == 'À REGARDER':
                selected_tokens = enlarged_tokens
                selected_pass = 'agrandie-2x-psm12'
                result = enlarged_result
        return {
            'available': True,
            'engine': 'tesseract-cli',
            'language': 'eng',
            'dictionary_available': bool(self.dictionary),
            'dictionary_sources': list(self.dictionary_sources),
            'selected_pass': selected_pass,
            **result,
            'tokens': [
                {
                    'text': token['text'],
                    'confidence': token['confidence'],
                    'bbox': token['bbox'],
                }
                for token in selected_tokens
            ][:80],
        }


def unavailable_text_metrics(reason: str) -> dict[str, Any]:
    warning = f'OCR indisponible : {reason}'
    return {
        'available': False,
        'engine': None,
        'verdict': 'À REGARDER',
        'warnings': [warning],
        'tokens': [],
        'suspicious_zones': [],
    }


def reference_paths(reference: Path) -> tuple[Path, ...]:
    if reference.is_file():
        return (reference.resolve(),)
    if reference.is_dir():
        paths = tuple(
            sorted(
                path.resolve()
                for path in reference.iterdir()
                if path.suffix.lower() in IMAGE_SUFFIXES
            )
        )
        if paths:
            return paths
    raise GateError(f'Aucune image de référence exploitable : {reference}')


def load_references(
    paths: Sequence[Path],
    analyzer: FaceAnalyzer,
    cv2: Any,
) -> tuple[tuple[float, ...], tuple[float, ...]]:
    embeddings: list[tuple[float, ...]] = []
    signatures: list[tuple[float, ...]] = []
    for path in paths:
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            raise GateError(f'Référence illisible : {path}')
        measurement = analyzer.measure(image)
        if measurement is None:
            raise GateError(f'Visage non détecté dans la référence : {path}')
        embeddings.append(measurement.embedding)
        signatures.append(measurement.signature)
    signature = tuple(
        sorted(values)[len(values) // 2]
        for values in zip(*signatures)
    )
    return normalized_centroid(embeddings), signature


VISION_SCHEMA = {
    'type': 'object',
    'properties': {
        **{
            field: {
                'type': 'string',
                'enum': ['OK', 'À REGARDER', 'REJET'],
            }
            for field in GRID_FIELDS
        },
        'verdict': {
            'type': 'string',
            'enum': ['OK', 'À REGARDER', 'REJET'],
        },
        'defauts': {
            'type': 'array',
            'maxItems': 3,
            'items': {'type': 'string', 'maxLength': 140},
        },
    },
    'required': [*GRID_FIELDS, 'verdict', 'defauts'],
    'additionalProperties': False,
}

VISION_PROMPT = """Tu es une porte qualité visuelle très stricte avant publication.
La planche jointe montre le même média : vue entière à gauche et trois zooms à
droite. Ne compare pas leur identité : ce sont les mêmes pixels recadrés.
Inspecte la structure visible. Cherche en priorité :
- bretelles, encolures, revers et raccords de vêtement asymétriques ou cassés ;
  compare explicitement les deux côtés, notamment sous chaque aisselle : un
  décroché, une double épaisseur ou un triangle de tissu sans fonction =
  À REGARDER ;
- mains/doigts ratés, bras fantômes, membre absent ou surnuméraire ;
- corps ou visage étiré, proportions impossibles ;
- trous de détourage, contours fantômes, coutures/masques, fusion avec le décor ;
- texte parasite, watermark ou glyphes involontaires ;
- dérive d'identité perceptible ou défaut structurel visible du visage
  (yeux/bouche déformés), sans juger le style.
Ces médias sont générés par IA : ne signale JAMAIS une image pour le seul motif
qu'elle « semble générée », que la peau est lisse ou que le rendu est plastique.
Il faut un défaut visible et localisable de structure, raccord ou proportion.
Une asymétrie clairement intentionnelle et physiquement crédible n'est pas un
défaut. À REGARDER = défaut possible à arbitrer humainement. REJET = terme
réservé à une certitude visuelle, mais le programme le convertira malgré tout
en À REGARDER : seul le gate déterministe peut bloquer. Les mains et le texte
ne peuvent jamais suffire à un rejet automatique. OK = aucun défaut visible.
Réponds exclusivement avec le JSON conforme au schéma, sans markdown. Chaque
texte de ``defauts`` doit faire au maximum douze mots."""


class OllamaVision:
    def __init__(
        self,
        base_url: str,
        models: Sequence[str],
        timeout: float,
    ) -> None:
        self.base_url = base_url.rstrip('/')
        self.models = tuple(models)
        self.timeout = timeout

    def _post(self, endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f'{self.base_url}{endpoint}',
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            parsed = json.loads(response.read().decode('utf-8'))
        if not isinstance(parsed, dict):
            raise ValueError('Réponse Ollama non objet')
        return parsed

    def audit(
        self,
        image_paths: Sequence[Path],
    ) -> tuple[dict[str, Any], str, float]:
        encoded = [
            base64.b64encode(path.read_bytes()).decode('ascii')
            for path in image_paths
        ]
        errors: list[str] = []
        attempted: list[str] = []
        total_elapsed = 0.0
        for model_index, model in enumerate(self.models):
            started = time.monotonic()
            try:
                response = self._post(
                    '/api/chat',
                    {
                        'model': model,
                        'stream': False,
                        'think': False,
                        'format': VISION_SCHEMA,
                        'messages': [
                            {
                                'role': 'user',
                                'content': VISION_PROMPT,
                                'images': encoded,
                            }
                        ],
                        'options': {
                            'temperature': 0,
                            'seed': 29,
                            'num_ctx': 4096,
                            'num_predict': 180,
                        },
                        'keep_alive': '15m',
                    },
                )
                content = response.get('message', {}).get('content', '')
                if not isinstance(content, str):
                    raise ValueError('Contenu Ollama absent')
                try:
                    value = json.loads(content)
                except json.JSONDecodeError:
                    start = content.find('{')
                    end = content.rfind('}')
                    if start < 0 or end <= start:
                        raise
                    value = json.loads(content[start:end + 1])
                grid = validate_llm_grid(value)
                total_elapsed += time.monotonic() - started
                attempted.append(model)
                # Cascade conservatrice : un défaut vu par le modèle rapide
                # suffit. Un OK doit être confirmé par le dernier modèle.
                if (
                    grid['verdict'] != 'OK'
                    or model_index == len(self.models) - 1
                ):
                    return grid, ' -> '.join(attempted), total_elapsed
            except (
                OSError,
                TimeoutError,
                ValueError,
                json.JSONDecodeError,
                urllib.error.URLError,
            ) as error:
                errors.append(f'{model}: {type(error).__name__}: {error}')
        raise GateError(
            'Aucun modèle Ollama local n’a rendu une grille valide ; '
            + ' | '.join(errors)
        )


def config_fingerprint(
    thresholds: Thresholds,
    reference_hashes: Sequence[str],
    models: Sequence[str],
    frame_count: int,
    llm_enabled: bool,
    hand_model: Path,
    tesseract_executable: str | None,
) -> str:
    raw = json.dumps(
        {
            'version': VERSION,
            'thresholds': asdict(thresholds),
            'reference_hashes': list(reference_hashes),
            'models': list(models),
            'frame_count': frame_count,
            'llm_enabled': llm_enabled,
            'hand_policy': {
                'model': str(hand_model),
                'model_sha256': (
                    sha256_file(hand_model) if hand_model.is_file() else None
                ),
                'topology_warning': HAND_TOPOLOGY_WARNING_THRESHOLD,
                'minimum_coherent_fingers': HAND_MIN_COHERENT_FINGERS,
            },
            'ocr_policy': {
                'executable': tesseract_executable,
                'low_confidence': OCR_LOW_CONFIDENCE_THRESHOLD,
                'dense_token_threshold': OCR_DENSE_TOKEN_THRESHOLD,
                'dense_low_confidence_rate':
                    OCR_DENSE_LOW_CONFIDENCE_RATE,
                'unknown_word_length': OCR_UNKNOWN_WORD_LENGTH,
                'isolated_confidence':
                    OCR_ISOLATED_CONFIDENCE_THRESHOLD,
            },
            'vision_prompt_sha256': hashlib.sha256(
                VISION_PROMPT.encode('utf-8')
            ).hexdigest(),
            'vision_schema': VISION_SCHEMA,
            'known_rejects': KNOWN_REJECT_MEDIA_SHA256,
            'known_approvals': sorted(KNOWN_APPROVED_MEDIA_SHA256),
        },
        sort_keys=True,
        separators=(',', ':'),
    )
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def sidecar_path(media_path: Path) -> Path:
    return Path(f'{media_path}.qc.json')


def cached_report(
    path: Path,
    media_hash: str,
    fingerprint: str,
) -> dict[str, Any] | None:
    sidecar = sidecar_path(path)
    if not sidecar.is_file():
        return None
    try:
        report = json.loads(sidecar.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None
    if (
        report.get('media_sha256') == media_hash
        and report.get('config_fingerprint') == fingerprint
        and report.get('schema_version') == VERSION
    ):
        report['cached'] = True
        return report
    return None


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f'.{path.name}.',
        suffix='.tmp',
        dir=path.parent,
    )
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def append_journals(
    report: dict[str, Any],
    jsonl_path: Path | None,
    csv_path: Path | None,
) -> None:
    row = {
        'timestamp': report['evaluated_at'],
        'media': report['media'],
        'media_type': report['media_type'],
        'persona': report['persona'],
        'verdict': report['verdict'],
        'media_sha256': report['media_sha256'],
        'sidecar': str(sidecar_path(Path(report['media']))),
        'defauts': ' | '.join(report.get('defauts', [])),
    }
    if jsonl_path is not None:
        jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        with jsonl_path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    if csv_path is not None:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        exists = csv_path.exists() and csv_path.stat().st_size > 0
        with csv_path.open('a', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(row))
            if not exists:
                writer.writeheader()
            writer.writerow(row)


def deterministic_metrics(
    image: Any,
    analyzer: FaceAnalyzer,
    reference_embedding: Sequence[float],
    reference_signature: Sequence[float],
    cv2: Any,
    thresholds: Thresholds,
) -> tuple[dict[str, Any], FaceMeasurement | None, DeterministicDecision]:
    sharpness = image_sharpness(image, cv2)
    face = analyzer.measure(image)
    similarity = (
        cosine_similarity(face.embedding, reference_embedding)
        if face is not None
        else None
    )
    deviation = (
        face_proportion_deviation(face.signature, reference_signature)
        if face is not None
        else None
    )
    decision = decide_deterministic(
        face_detected=face is not None,
        identity_similarity=similarity,
        stretch_deviation=deviation,
        sharpness=sharpness,
        thresholds=thresholds,
    )
    metrics = {
        'face_detected': face is not None,
        'identity_arcface': similarity,
        'identity_threshold': thresholds.identity_reject,
        'identity_target': thresholds.identity_target,
        'face_stretch_deviation': deviation,
        'face_stretch_threshold': thresholds.face_stretch_reject,
        'sharpness_laplacian': sharpness,
        'sharpness_threshold': thresholds.sharpness_reject,
        'face_bbox': list(face.bbox) if face else None,
        'face_signature': list(face.signature) if face else None,
        'deterministic_verdict': decision.verdict,
        'deterministic_defects': list(decision.defects),
        'deterministic_warnings': list(decision.warnings),
    }
    return metrics, face, decision


def write_llm_inspection_board(
    image: Any,
    face: FaceMeasurement | None,
    cv2: Any,
    directory: Path,
) -> Path:
    """Écrit une planche multi-échelle, encodée comme une seule image vision."""
    image_height, image_width = image.shape[:2]
    if face is not None:
        x1, y1, x2, y2 = face.bbox
        face_width = max(1.0, x2 - x1)
        face_height = max(1.0, y2 - y1)
        regions = (
            (
                x1 - face_width,
                y1 - 0.15 * face_height,
                x2 + face_width,
                y2 + 1.8 * face_height,
            ),
            (
                x1 - 0.8 * face_width,
                y1 + 0.55 * face_height,
                x2 + 0.8 * face_width,
                y2 + 1.55 * face_height,
            ),
            (
                image_width * 0.42,
                image_height * 0.42,
                image_width,
                image_height,
            ),
        )
    else:
        regions = (
            (0, 0, image_width * 0.6, image_height * 0.6),
            (
                image_width * 0.4,
                0,
                image_width,
                image_height * 0.6,
            ),
            (
                image_width * 0.2,
                image_height * 0.4,
                image_width * 0.8,
                image_height,
            ),
        )
    crops: list[Any] = []
    for left, top, right, bottom in regions:
        left_i = max(0, min(image_width - 1, int(left)))
        top_i = max(0, min(image_height - 1, int(top)))
        right_i = max(left_i + 1, min(image_width, int(right)))
        bottom_i = max(top_i + 1, min(image_height, int(bottom)))
        crop = image[top_i:bottom_i, left_i:right_i]
        crops.append(crop)

    def fit(source: Any, width: int, height: int) -> Any:
        source_height, source_width = source.shape[:2]
        scale = min(width / source_width, height / source_height)
        resized = cv2.resize(
            source,
            (
                max(1, round(source_width * scale)),
                max(1, round(source_height * scale)),
            ),
            interpolation=cv2.INTER_AREA,
        )
        vertical = height - resized.shape[0]
        horizontal = width - resized.shape[1]
        return cv2.copyMakeBorder(
            resized,
            vertical // 2,
            vertical - vertical // 2,
            horizontal // 2,
            horizontal - horizontal // 2,
            cv2.BORDER_CONSTANT,
            value=(32, 32, 32),
        )

    full_panel = fit(image, 800, 1200)
    detail_panel = cv2.vconcat([fit(crop, 800, 400) for crop in crops])
    board = cv2.hconcat([full_panel, detail_panel])
    path = directory / 'inspection-board.jpg'
    if not cv2.imwrite(str(path), board, [cv2.IMWRITE_JPEG_QUALITY, 96]):
        raise GateError(f'Impossible d’écrire la planche temporaire : {path}')
    return path


def audit_image_data(
    image: Any,
    image_path_for_llm: Path,
    analyzer: FaceAnalyzer,
    reference_embedding: Sequence[float],
    reference_signature: Sequence[float],
    runtime: Runtime,
    thresholds: Thresholds,
    vision: OllamaVision | None,
    hand_analyzer: HandAnalyzer | None,
    hand_unavailable_reason: str | None,
    text_analyzer: TesseractTextAnalyzer | None,
    text_unavailable_reason: str | None,
    authority_approved: bool = False,
    authority_reason: str | None = None,
) -> tuple[dict[str, Any], FaceMeasurement | None]:
    metrics, face, decision = deterministic_metrics(
        image,
        analyzer,
        reference_embedding,
        reference_signature,
        runtime.cv2,
        thresholds,
    )
    if hand_analyzer is None:
        hands = unavailable_hand_metrics(
            hand_unavailable_reason or 'raison inconnue'
        )
    else:
        try:
            hands = hand_analyzer.analyze(image, runtime.cv2)
        except (GateError, OSError, RuntimeError, ValueError) as error:
            hands = unavailable_hand_metrics(str(error))

    if text_analyzer is None:
        text = unavailable_text_metrics(
            text_unavailable_reason or 'raison inconnue'
        )
    else:
        try:
            text = text_analyzer.analyze(image)
        except (
            GateError,
            OSError,
            RuntimeError,
            ValueError,
            subprocess.SubprocessError,
        ) as error:
            text = unavailable_text_metrics(str(error))

    llm: dict[str, Any] | None = None
    authority: dict[str, Any] | None = (
        {
            'approval': True,
            'source': 'Patrice/reportage-japon SHA-256',
            'effect': 'REJET automatique plafonné à À REGARDER',
        }
        if authority_approved
        else None
    )
    defects = [*decision.defects, *decision.warnings]
    defects.extend(hands.get('warnings', []))
    defects.extend(text.get('warnings', []))
    if authority_reason is not None:
        authority = {
            'verdict': 'REJET',
            'reason': authority_reason,
            'source': 'authoritative_sha256_lock',
        }
        defects.append(authority_reason)
    elif decision.verdict != 'REJET':
        if vision is None:
            llm = {
                'verdict': 'À REGARDER',
                'defauts': ['audit LLM vision désactivé'],
                'skipped': True,
            }
        else:
            try:
                with tempfile.TemporaryDirectory(
                    prefix='visual-gate-details-'
                ) as temporary:
                    board = write_llm_inspection_board(
                        image,
                        face,
                        runtime.cv2,
                        Path(temporary),
                    )
                    grid, model, elapsed = vision.audit((board,))
                llm = {
                    **grid,
                    'model': model,
                    'cost_usd': 0.0,
                    'elapsed_seconds': elapsed,
                }
            except GateError as error:
                llm = {
                    'verdict': 'À REGARDER',
                    'defauts': [str(error)],
                    'error': True,
                }
        defects.extend(llm.get('defauts', []))
    verdict = combine_verdict(
        decision.verdict,
        llm.get('verdict') if llm else None,
    )
    verdict = combine_verdict(verdict, hands['verdict'], text['verdict'])
    if authority is not None:
        if authority.get('verdict') == 'REJET':
            verdict = combine_verdict(verdict, authority['verdict'])
        elif verdict == 'REJET':
            verdict = apply_approval_ceiling(verdict, True)
            defects.append(
                'verrou positif Patrice : rejet automatique neutralisé'
            )
    return {
        'deterministic': metrics,
        'hands': hands,
        'text_ocr': text,
        'llm_vision': llm,
        'authority': authority,
        'verdict': verdict,
        'defauts': list(dict.fromkeys(defects)),
    }, face


def temporary_frame_path(image: Any, cv2: Any, directory: Path, index: int) -> Path:
    path = directory / f'frame-{index:03d}.jpg'
    if not cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 95]):
        raise GateError(f'Impossible d’écrire la frame temporaire : {path}')
    return path


def video_stream_metadata(path: Path) -> dict[str, Any]:
    if shutil.which('ffprobe') is None:
        return {'sample_aspect_ratio': None, 'display_aspect_ratio': None}
    completed = subprocess.run(
        [
            'ffprobe',
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=sample_aspect_ratio,display_aspect_ratio',
            '-of',
            'json',
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    try:
        stream = json.loads(completed.stdout).get('streams', [{}])[0]
    except (json.JSONDecodeError, IndexError):
        stream = {}
    return {
        'sample_aspect_ratio': stream.get('sample_aspect_ratio'),
        'display_aspect_ratio': stream.get('display_aspect_ratio'),
    }


def read_video_samples(
    path: Path,
    count: int,
    cv2: Any,
) -> tuple[list[Any], dict[str, Any]]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise GateError(f'Vidéo illisible : {path}')
    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if frame_count < 1 or width < 1 or height < 1:
            raise GateError(f'Métadonnées vidéo invalides : {path}')
        indices = sample_indices(frame_count, count)
        frames: list[Any] = []
        for index in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
            success, frame = capture.read()
            if not success or frame is None:
                raise GateError(f'Frame {index} illisible dans {path}')
            frames.append(frame)
    finally:
        capture.release()
    return frames, {
        'frame_count': frame_count,
        'fps': fps,
        'width': width,
        'height': height,
        'duration_seconds': frame_count / fps if fps > 0 else None,
        'sample_indices': list(indices),
        'sample_fractions': list(sample_fractions(count)),
        **video_stream_metadata(path),
    }


def evaluate_image(
    path: Path,
    common: 'EvaluationContext',
) -> dict[str, Any]:
    image = common.runtime.cv2.imread(str(path), common.runtime.cv2.IMREAD_COLOR)
    if image is None:
        raise GateError(f'Image illisible : {path}')
    media_hash = sha256_file(path)
    result, _face = audit_image_data(
        image,
        path,
        common.analyzer,
        common.reference_embedding,
        common.reference_signature,
        common.runtime,
        common.thresholds,
        common.vision,
        common.hand_analyzer,
        common.hand_unavailable_reason,
        common.text_analyzer,
        common.text_unavailable_reason,
        media_hash in KNOWN_APPROVED_MEDIA_SHA256,
        common.authority_rejects.get(media_hash),
    )
    return {
        **common.report_header(path, 'image'),
        **result,
    }


def evaluate_video(
    path: Path,
    common: 'EvaluationContext',
    frame_count: int,
) -> dict[str, Any]:
    frames, metadata = read_video_samples(path, frame_count, common.runtime.cv2)
    authority_reason = common.authority_rejects.get(sha256_file(path))
    frame_reports: list[dict[str, Any]] = []
    faces: list[FaceMeasurement] = []
    with tempfile.TemporaryDirectory(prefix='visual-gate-frames-') as temporary:
        temporary_root = Path(temporary)
        for position, (frame, source_index) in enumerate(
            zip(frames, metadata['sample_indices'])
        ):
            frame_path = temporary_frame_path(
                frame,
                common.runtime.cv2,
                temporary_root,
                position,
            )
            report, face = audit_image_data(
                frame,
                frame_path,
                common.analyzer,
                common.reference_embedding,
                common.reference_signature,
                common.runtime,
                common.thresholds,
                common.vision,
                common.hand_analyzer,
                common.hand_unavailable_reason,
                common.text_analyzer,
                common.text_unavailable_reason,
                False,
                authority_reason,
            )
            frame_reports.append(
                {
                    'sample_position': position,
                    'source_frame_index': source_index,
                    'timestamp_seconds': (
                        source_index / metadata['fps']
                        if metadata['fps'] > 0
                        else None
                    ),
                    **report,
                }
            )
            if face is not None:
                faces.append(face)

    if len(faces) == len(frames):
        stability = interframe_stability(
            [face.embedding for face in faces],
            [face.bbox for face in faces],
            metadata['width'],
            metadata['height'],
            common.thresholds,
        )
    else:
        stability = {
            'verdict': 'À REGARDER',
            'defauts': [
                f'visage absent sur {len(frames) - len(faces)}/{len(frames)} '
                'frames : stabilité non mesurable'
            ],
        }
    frame_verdict = 'OK'
    for report in frame_reports:
        frame_verdict = combine_verdict(frame_verdict, report['verdict'])
    verdict = combine_verdict(frame_verdict, None, stability['verdict'])
    defects = [
        defect
        for report in frame_reports
        for defect in report.get('defauts', [])
    ]
    defects.extend(stability.get('defauts', []))
    return {
        **common.report_header(path, 'video'),
        'video': metadata,
        'frames': frame_reports,
        'stability': stability,
        'verdict': verdict,
        'defauts': list(dict.fromkeys(defects)),
    }


@dataclass
class EvaluationContext:
    runtime: Runtime
    analyzer: FaceAnalyzer
    reference_embedding: tuple[float, ...]
    reference_signature: tuple[float, ...]
    reference_paths: tuple[Path, ...]
    reference_hashes: tuple[str, ...]
    persona: str
    thresholds: Thresholds
    vision: OllamaVision | None
    hand_analyzer: HandAnalyzer | None
    hand_unavailable_reason: str | None
    text_analyzer: TesseractTextAnalyzer | None
    text_unavailable_reason: str | None
    models: tuple[str, ...]
    fingerprint: str
    authority_rejects: dict[str, str]

    def report_header(self, path: Path, media_type: str) -> dict[str, Any]:
        return {
            'schema_version': VERSION,
            'evaluated_at': utc_now(),
            'media': str(path.resolve()),
            'media_type': media_type,
            'persona': self.persona,
            'media_sha256': sha256_file(path),
            'config_fingerprint': self.fingerprint,
            'references': [
                {'path': str(reference), 'sha256': digest}
                for reference, digest in zip(
                    self.reference_paths,
                    self.reference_hashes,
                )
            ],
            'thresholds': asdict(self.thresholds),
            'vision_policy': {
                'backend': 'ollama-local' if self.vision else 'disabled',
                'models_in_order': list(self.models),
                'cost_usd': 0.0,
                'paid_api_allowed': False,
            },
            'cached': False,
        }


def infer_persona(path: Path) -> str | None:
    lowered = str(path).lower()
    matches = [name for name in DEFAULT_REFERENCES if name in lowered]
    return matches[0] if len(matches) == 1 else None


def collect_media(path: Path, recursive: bool) -> list[Path]:
    if path.is_file():
        if path.suffix.lower() not in IMAGE_SUFFIXES | VIDEO_SUFFIXES:
            raise GateError(f'Format non supporté : {path}')
        return [path.resolve()]
    if not path.is_dir():
        raise GateError(f'Entrée introuvable : {path}')
    iterator: Iterable[Path] = path.rglob('*') if recursive else path.iterdir()
    return sorted(
        item.resolve()
        for item in iterator
        if item.is_file()
        and item.suffix.lower() in IMAGE_SUFFIXES | VIDEO_SUFFIXES
        and not item.name.endswith('.qc.json')
    )


def parse_models(raw: str) -> tuple[str, ...]:
    if raw == 'auto':
        return DEFAULT_OLLAMA_MODELS
    values = tuple(value.strip() for value in raw.split(',') if value.strip())
    if not values:
        raise argparse.ArgumentTypeError('Au moins un modèle Ollama est requis')
    return values


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Porte qualité visuelle déterministe + LLM vision local.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('input', type=Path, help='image, vidéo ou dossier')
    parser.add_argument('--persona', choices=('auto', 'lisa', 'ambre'), default='auto')
    parser.add_argument('--reference', type=Path, help='image ou dossier de références')
    parser.add_argument('--recursive', action='store_true')
    parser.add_argument('--frames', type=int, default=5)
    parser.add_argument('--gate', action='store_true')
    parser.add_argument('--force', action='store_true')
    parser.add_argument(
        '--no-llm',
        action='store_true',
        help='désactive Ollama ; produit À REGARDER si les mesures passent',
    )
    parser.add_argument(
        '--hand-model',
        type=Path,
        default=DEFAULT_HAND_MODEL,
        help='modèle hand_landmarker.task pour MediaPipe Tasks',
    )
    parser.add_argument(
        '--tesseract',
        default='tesseract',
        help='exécutable Tesseract local',
    )
    parser.add_argument('--ollama-url', default=DEFAULT_OLLAMA_URL)
    parser.add_argument('--ollama-models', type=parse_models, default=DEFAULT_OLLAMA_MODELS)
    parser.add_argument('--ollama-timeout', type=float, default=180.0)
    parser.add_argument('--journal', type=Path, default=DEFAULT_JOURNAL)
    parser.add_argument('--no-journal', action='store_true')
    parser.add_argument('--csv-journal', type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        if args.frames < 1:
            raise GateError('--frames doit être supérieur ou égal à 1')
        media = collect_media(args.input.expanduser(), args.recursive)
        if not media:
            raise GateError('Aucun média pris en charge trouvé')
        personas = {
            args.persona if args.persona != 'auto' else infer_persona(path)
            for path in media
        }
        if None in personas or len(personas) != 1:
            raise GateError(
                'Persona ambiguë : fournir --persona lisa ou --persona ambre'
            )
        persona = str(next(iter(personas)))
        reference = (
            args.reference.expanduser()
            if args.reference is not None
            else DEFAULT_REFERENCES[persona]
        )
        references = reference_paths(reference)
        hashes = tuple(sha256_file(path) for path in references)
        thresholds = Thresholds()
        models = tuple(args.ollama_models)
        hand_model = args.hand_model.expanduser().resolve()
        tesseract_executable = shutil.which(args.tesseract)
        fingerprint = config_fingerprint(
            thresholds,
            hashes,
            models,
            args.frames,
            not args.no_llm,
            hand_model,
            tesseract_executable,
        )
        runtime = load_runtime()
        analyzer = FaceAnalyzer(runtime)
        reference_embedding, reference_signature = load_references(
            references,
            analyzer,
            runtime.cv2,
        )
        vision = (
            None
            if args.no_llm
            else OllamaVision(args.ollama_url, models, args.ollama_timeout)
        )
        hand_analyzer: HandAnalyzer | None
        hand_unavailable_reason: str | None = None
        try:
            hand_analyzer = HandAnalyzer(hand_model)
        except DependencyError as error:
            hand_analyzer = None
            hand_unavailable_reason = str(error)
        dictionary, dictionary_sources = load_ocr_dictionary()
        text_analyzer = (
            TesseractTextAnalyzer(
                tesseract_executable,
                runtime.cv2,
                dictionary,
                dictionary_sources,
            )
            if tesseract_executable is not None
            else None
        )
        text_unavailable_reason = (
            None
            if text_analyzer is not None
            else f'exécutable introuvable : {args.tesseract}'
        )
        context = EvaluationContext(
            runtime=runtime,
            analyzer=analyzer,
            reference_embedding=reference_embedding,
            reference_signature=reference_signature,
            reference_paths=references,
            reference_hashes=hashes,
            persona=persona,
            thresholds=thresholds,
            vision=vision,
            hand_analyzer=hand_analyzer,
            hand_unavailable_reason=hand_unavailable_reason,
            text_analyzer=text_analyzer,
            text_unavailable_reason=text_unavailable_reason,
            models=models,
            fingerprint=fingerprint,
            authority_rejects=load_authority_rejects(),
        )
        reports: list[dict[str, Any]] = []
        for path in media:
            digest = sha256_file(path)
            report = (
                None
                if args.force
                else cached_report(path, digest, fingerprint)
            )
            authority_reason = context.authority_rejects.get(digest)
            if (
                report is not None
                and authority_reason is not None
                and authority_reason not in report.get('defauts', [])
            ):
                report = None
            if report is None:
                if path.suffix.lower() in IMAGE_SUFFIXES:
                    report = evaluate_image(path, context)
                else:
                    report = evaluate_video(path, context, args.frames)
                write_json_atomic(sidecar_path(path), report)
                append_journals(
                    report,
                    None if args.no_journal else args.journal.expanduser(),
                    args.csv_journal.expanduser() if args.csv_journal else None,
                )
            reports.append(report)
            cache_label = ' [cache]' if report.get('cached') else ''
            print(f'{report["verdict"]:12} {path}{cache_label}')
            for defect in report.get('defauts', []):
                print(f'       - {defect}')
        rejected = sum(report['verdict'] == 'REJET' for report in reports)
        review = sum(
            report['verdict'] == 'À REGARDER' for report in reports
        )
        ok = sum(report['verdict'] == 'OK' for report in reports)
        print(
            f'Résumé : OK={ok}, À REGARDER={review}, REJET={rejected}'
        )
        return 1 if args.gate and rejected else 0
    except (GateError, OSError, subprocess.SubprocessError) as error:
        print(f'ERREUR visual-gate : {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
