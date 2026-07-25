"""Local, opt-in face identity matching for the semantic vision sidecar.

The vector matching helpers in this module are deliberately independent from
InsightFace so they can be tested without a model or its native dependencies.
InsightFace is imported only when ``InsightFaceIdentityRecognizer`` first needs
to extract an embedding.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import os
import sys
from typing import Iterable, Mapping, Sequence

EMBEDDING_DIMENSION = 512
DEFAULT_IDENTITIES_PATH = os.path.expanduser(
    "~/.codebuddy/vision-identities/embeddings.json"
)
DEFAULT_THRESHOLD = 0.45

_insightface_warning_logged = False


@dataclass(frozen=True)
class IdentityMatch:
    name: str
    similarity: float


def _finite_vector(
    value: object,
    dimension: int | None = EMBEDDING_DIMENSION,
) -> tuple[float, ...]:
    if not isinstance(value, (list, tuple)):
        raise ValueError("embedding must be an array")
    vector = tuple(float(item) for item in value)
    if dimension is not None and len(vector) != dimension:
        raise ValueError(
            f"embedding must contain {dimension} values, got {len(vector)}"
        )
    if not vector or not all(math.isfinite(item) for item in vector):
        raise ValueError("embedding must contain finite numeric values")
    return vector


def normalize_embedding(
    embedding: Sequence[float],
    dimension: int | None = EMBEDDING_DIMENSION,
) -> list[float]:
    """Return a unit-length copy of an embedding."""
    vector = _finite_vector(embedding, dimension)
    norm = math.sqrt(sum(item * item for item in vector))
    if norm <= 0:
        raise ValueError("embedding norm must be positive")
    return [item / norm for item in vector]


def cosine_similarity(
    left: Sequence[float],
    right: Sequence[float],
) -> float:
    """Pure cosine similarity in [-1, 1]."""
    left_vector = _finite_vector(left, dimension=None)
    right_vector = _finite_vector(right, dimension=None)
    if len(left_vector) != len(right_vector):
        raise ValueError("embeddings must have the same dimension")
    left_norm = math.sqrt(sum(item * item for item in left_vector))
    right_norm = math.sqrt(sum(item * item for item in right_vector))
    if left_norm <= 0 or right_norm <= 0:
        raise ValueError("embedding norm must be positive")
    similarity = sum(
        left_item * right_item
        for left_item, right_item in zip(left_vector, right_vector)
    ) / (left_norm * right_norm)
    return min(1.0, max(-1.0, similarity))


def parse_embedding_store(
    value: object,
    dimension: int = EMBEDDING_DIMENSION,
) -> dict[str, list[list[float]]]:
    """Validate the on-disk ``{name: [embeddings...]}`` format."""
    if not isinstance(value, dict):
        raise ValueError("embedding store must be a JSON object")
    parsed: dict[str, list[list[float]]] = {}
    for raw_name, raw_embeddings in value.items():
        if not isinstance(raw_name, str):
            raise ValueError("identity names must be strings")
        name = raw_name.strip()
        if not name or name != raw_name or len(name) > 100:
            raise ValueError("identity names must be non-empty, trimmed, and <= 100 chars")
        if any(
            ord(character) < 32
            or 127 <= ord(character) <= 159
            or character in ("\u2028", "\u2029")
            for character in name
        ):
            raise ValueError(f"identity name {name!r} contains control characters")
        if not isinstance(raw_embeddings, list) or not raw_embeddings:
            raise ValueError(f"identity {name!r} must contain at least one embedding")
        parsed[name] = [
            normalize_embedding(embedding, dimension)
            for embedding in raw_embeddings
        ]
    return parsed


def load_embedding_store(
    path: str = DEFAULT_IDENTITIES_PATH,
    dimension: int = EMBEDDING_DIMENSION,
) -> dict[str, list[list[float]]]:
    """Load and validate enrolled identities; a missing file means no identities."""
    expanded = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(expanded):
        return {}
    with open(expanded, encoding="utf-8") as handle:
        return parse_embedding_store(json.load(handle), dimension)


def match_identity(
    embedding: Sequence[float],
    enrolled: Mapping[str, Iterable[Sequence[float]]],
    threshold: float = DEFAULT_THRESHOLD,
) -> IdentityMatch | None:
    """Return the best enrolled sample when its cosine score reaches threshold."""
    if not math.isfinite(threshold) or threshold < -1 or threshold > 1:
        raise ValueError("identity threshold must be between -1 and 1")
    best: IdentityMatch | None = None
    for name in sorted(enrolled):
        for candidate in enrolled[name]:
            similarity = cosine_similarity(embedding, candidate)
            if best is None or similarity > best.similarity:
                best = IdentityMatch(name=name, similarity=similarity)
    if best is None or best.similarity < threshold:
        return None
    return best


def stable_identity_match(
    attempts: Sequence[IdentityMatch | None],
    required_frames: int = 2,
) -> IdentityMatch | None:
    """Return a match only when the latest N frames agree on one identity."""
    if required_frames < 1:
        raise ValueError("required_frames must be positive")
    if len(attempts) < required_frames:
        return None
    recent = attempts[-required_frames:]
    if any(item is None for item in recent):
        return None
    matches = [item for item in recent if item is not None]
    if len({item.name.casefold() for item in matches}) != 1:
        return None
    return IdentityMatch(
        name=matches[-1].name,
        similarity=sum(item.similarity for item in matches) / len(matches),
    )


def configured_threshold(raw: str | None = None) -> float:
    value = (
        raw
        if raw is not None
        else os.environ.get(
            "BUDDY_VISION_IDENTIFY_THRESHOLD",
            str(DEFAULT_THRESHOLD),
        )
    )
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        return DEFAULT_THRESHOLD
    return threshold if math.isfinite(threshold) and -1 <= threshold <= 1 else DEFAULT_THRESHOLD


def _warn_insightface_once(message: str) -> None:
    global _insightface_warning_logged
    if _insightface_warning_logged:
        return
    _insightface_warning_logged = True
    print(f"[vision] identity disabled: {message}", file=sys.stderr, flush=True)


class InsightFaceEmbedder:
    """Lazy buffalo_l embedding extractor. Unavailable dependencies fail open."""

    def __init__(self):
        self._app = None
        self.disabled = False

    def _load(self) -> bool:
        if self.disabled:
            return False
        if self._app is not None:
            return True
        try:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(
                name="buffalo_l",
                providers=["CPUExecutionProvider"],
            )
            app.prepare(ctx_id=-1, det_size=(640, 640))
            self._app = app
            return True
        except Exception as exc:
            self.disabled = True
            _warn_insightface_once(
                f"InsightFace buffalo_l unavailable ({exc}); "
                "install insightface + onnxruntime to enable it"
            )
            return False

    def extract_faces(self, image) -> list[list[float]]:
        """Extract normalized 512D embeddings for every face in an image."""
        if image is None or not self._load():
            return []
        try:
            faces = self._app.get(image)
        except Exception:
            return []
        embeddings: list[list[float]] = []
        for face in faces:
            raw = getattr(face, "normed_embedding", None)
            if raw is None:
                raw = getattr(face, "embedding", None)
            if raw is None:
                continue
            try:
                embeddings.append(normalize_embedding(raw.tolist()))
            except (AttributeError, TypeError, ValueError):
                continue
        return embeddings


def crop_normalized_box(frame, box: Mapping[str, float], padding: float = 0.25):
    """Crop a padded normalized detector box, returning ``None`` if invalid."""
    if frame is None or not hasattr(frame, "shape") or len(frame.shape) < 2:
        return None
    height, width = frame.shape[:2]
    try:
        x = float(box["x"])
        y = float(box["y"])
        box_width = float(box["width"])
        box_height = float(box["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if (
        not all(math.isfinite(item) for item in (x, y, box_width, box_height))
        or box_width <= 0
        or box_height <= 0
    ):
        return None
    pad_x = box_width * max(0.0, padding)
    pad_y = box_height * max(0.0, padding)
    left = max(0, int((x - pad_x) * width))
    top = max(0, int((y - pad_y) * height))
    right = min(width, int(math.ceil((x + box_width + pad_x) * width)))
    bottom = min(height, int(math.ceil((y + box_height + pad_y) * height)))
    if right <= left or bottom <= top:
        return None
    return frame[top:bottom, left:right]


class InsightFaceIdentityRecognizer:
    """Compare faces in detector crops against the local enrollment store."""

    def __init__(
        self,
        identities_path: str = DEFAULT_IDENTITIES_PATH,
        threshold: float | None = None,
        embedder: InsightFaceEmbedder | None = None,
    ):
        self.threshold = configured_threshold() if threshold is None else threshold
        self.embedder = embedder or InsightFaceEmbedder()
        try:
            self.enrolled = load_embedding_store(identities_path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            self.enrolled = {}
            print(
                f"[vision] identity enrollment ignored: {exc}",
                file=sys.stderr,
                flush=True,
            )

    @property
    def enabled(self) -> bool:
        return bool(self.enrolled) and not self.embedder.disabled

    def prepare(self) -> bool:
        """Load buffalo_l only on the explicit identity path."""
        return bool(self.enrolled) and self.embedder._load()

    def identify(self, frame, boxes: Iterable[Mapping[str, float]]) -> IdentityMatch | None:
        best: IdentityMatch | None = None
        for box in boxes:
            crop = crop_normalized_box(frame, box)
            for embedding in self.embedder.extract_faces(crop):
                match = match_identity(embedding, self.enrolled, self.threshold)
                if match is not None and (best is None or match.similarity > best.similarity):
                    best = match
        return best
