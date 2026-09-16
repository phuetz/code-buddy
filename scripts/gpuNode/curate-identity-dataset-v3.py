#!/usr/bin/env python3
"""Curate identity-dataset v3 candidates with an ArcFace centroid gate.

The decision layer uses only Python's standard library and accepts injected
embeddings. InsightFace, OpenCV and ONNX Runtime are imported only for a real
curation run, never for ``--self-test``.

Rear-view slots can be excluded from ArcFace with ``--face-exempt-slots``.
This is necessary because the 2026-07-20 measurements showed that ArcFace
incorrectly rejected every back framing as identity drift when no face was
available. Exempt images always require human review and are never auto-kept.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import AbstractSet, Any, Iterable, Sequence


MIN_RETAINED = 30
MAX_RETAINED = 36
MAX_PER_SLOT = 2
DEPENDENCY_EXIT = 3
INSUFFICIENT_LOT_EXIT = 4
SUPPORTED_REFERENCE_SUFFIXES = {".jpeg", ".jpg", ".png", ".webp"}


class MissingDependencyError(RuntimeError):
    """Raised when the VisualGates runtime is incomplete."""


@dataclass(frozen=True)
class CandidateEmbedding:
    path: str
    slot: str
    sha256: str
    embedding: tuple[float, ...] | None


@dataclass(frozen=True)
class CandidateDecision:
    path: str
    slot: str
    sha256: str
    similarity: float | None
    verdict: str
    reason: str


@dataclass(frozen=True)
class DecisionThresholds:
    keep_min: float = 0.60
    keep_max: float = 0.80
    reject_below: float = 0.55
    dedup_above: float = 0.92


def vector_norm(vector: Sequence[float]) -> float:
    """Return a vector's Euclidean norm."""
    return math.sqrt(sum(float(value) * float(value) for value in vector))


def normalize(vector: Sequence[float]) -> tuple[float, ...]:
    """Return an L2-normalized immutable vector."""
    values = tuple(float(value) for value in vector)
    norm = vector_norm(values)
    if not values or not math.isfinite(norm) or norm <= 0:
        raise ValueError("Embeddings must be finite non-zero vectors")
    normalized = tuple(value / norm for value in values)
    if not all(math.isfinite(value) for value in normalized):
        raise ValueError("Embeddings must contain only finite values")
    return normalized


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    """Calculate cosine similarity after validating dimensions and norms."""
    if len(left) != len(right) or not left:
        raise ValueError("Embedding dimensions must match and be non-empty")
    normalized_left = normalize(left)
    normalized_right = normalize(right)
    return sum(a * b for a, b in zip(normalized_left, normalized_right))


def embedding_centroid(embeddings: Sequence[Sequence[float]]) -> tuple[float, ...]:
    """Average normalized embeddings, then normalize the resulting centroid."""
    if not embeddings:
        raise ValueError("At least one reference embedding is required")
    normalized = [normalize(embedding) for embedding in embeddings]
    dimension = len(normalized[0])
    if any(len(embedding) != dimension for embedding in normalized):
        raise ValueError("All reference embeddings must have the same dimension")
    mean = tuple(
        sum(embedding[index] for embedding in normalized) / len(normalized)
        for index in range(dimension)
    )
    return normalize(mean)


def leave_one_out_similarities(embeddings: Sequence[Sequence[float]]) -> list[float | None]:
    """Score every reference against the centroid of the other references."""
    if len(embeddings) < 2:
        return [None for _embedding in embeddings]
    return [
        cosine_similarity(embedding, embedding_centroid(embeddings[:index] + embeddings[index + 1 :]))
        for index, embedding in enumerate(embeddings)
    ]


def validate_thresholds(thresholds: DecisionThresholds) -> None:
    values = (
        thresholds.keep_min,
        thresholds.keep_max,
        thresholds.reject_below,
        thresholds.dedup_above,
    )
    if not all(math.isfinite(value) and -1.0 <= value <= 1.0 for value in values):
        raise ValueError("Similarity thresholds must be finite values between -1 and 1")
    if thresholds.keep_min > thresholds.keep_max:
        raise ValueError("keep_min must not exceed keep_max")
    if thresholds.reject_below > thresholds.keep_min:
        raise ValueError("reject_below must not exceed keep_min")


def decide_candidates(
    candidates: Sequence[CandidateEmbedding],
    reference_embeddings: Sequence[Sequence[float]],
    thresholds: DecisionThresholds = DecisionThresholds(),
    min_retained: int = MIN_RETAINED,
    max_retained: int = MAX_RETAINED,
    max_per_slot: int = MAX_PER_SLOT,
    face_exempt_slots: AbstractSet[str] = frozenset(),
) -> list[CandidateDecision]:
    """Pure centroid scoring, range filtering, deduplication and slot selection."""
    validate_thresholds(thresholds)
    if (
        min_retained < 0
        or max_retained < min_retained
        or max_per_slot not in (1, 2)
    ):
        raise ValueError("Retention limits are invalid")
    centroid = embedding_centroid(reference_embeddings)
    scored: dict[str, tuple[CandidateEmbedding, float | None]] = {}
    decisions: dict[str, CandidateDecision] = {}
    seen_paths: set[str] = set()
    for candidate in candidates:
        if candidate.path in seen_paths:
            raise ValueError(f"Duplicate candidate path: {candidate.path}")
        seen_paths.add(candidate.path)
        if candidate.slot in face_exempt_slots:
            scored[candidate.path] = (candidate, None)
            decisions[candidate.path] = CandidateDecision(
                candidate.path,
                candidate.slot,
                candidate.sha256,
                None,
                "human-review",
                "no-face-framing",
            )
            continue
        similarity = (
            cosine_similarity(candidate.embedding, centroid)
            if candidate.embedding is not None
            else None
        )
        scored[candidate.path] = (candidate, similarity)
        if similarity is None:
            decisions[candidate.path] = CandidateDecision(
                candidate.path, candidate.slot, candidate.sha256, None, "reject", "no-face"
            )
        elif similarity < thresholds.reject_below:
            decisions[candidate.path] = CandidateDecision(
                candidate.path, candidate.slot, candidate.sha256, similarity, "reject", "identity-drift"
            )
        elif similarity < thresholds.keep_min:
            decisions[candidate.path] = CandidateDecision(
                candidate.path, candidate.slot, candidate.sha256, similarity, "reject", "below-keep-range"
            )
        elif similarity > thresholds.keep_max:
            decisions[candidate.path] = CandidateDecision(
                candidate.path, candidate.slot, candidate.sha256, similarity, "reject", "above-keep-range"
            )

    eligible_by_slot: dict[str, list[tuple[CandidateEmbedding, float]]] = {}
    for candidate, similarity in scored.values():
        if candidate.path in decisions or similarity is None:
            continue
        eligible_by_slot.setdefault(candidate.slot, []).append((candidate, similarity))
    for values in eligible_by_slot.values():
        values.sort(key=lambda item: (-item[1], item[0].path))

    selected: list[tuple[CandidateEmbedding, float]] = []
    selected_per_slot: dict[str, int] = {}

    def duplicate_of_selected(candidate: CandidateEmbedding) -> bool:
        if candidate.embedding is None:
            return False
        return any(
            selected_candidate.embedding is not None
            and cosine_similarity(candidate.embedding, selected_candidate.embedding) > thresholds.dedup_above
            for selected_candidate, _similarity in selected
        )

    def select(candidate: CandidateEmbedding, similarity: float) -> None:
        selected.append((candidate, similarity))
        selected_per_slot[candidate.slot] = selected_per_slot.get(candidate.slot, 0) + 1
        decisions[candidate.path] = CandidateDecision(
            candidate.path, candidate.slot, candidate.sha256, similarity, "keep", "selected"
        )

    # Coverage pass: the best viable candidate from each slot, with the globally
    # strongest slot heads considered first so a weaker quasi-duplicate loses.
    slot_groups = sorted(
        eligible_by_slot.items(),
        key=lambda item: (-item[1][0][1], item[0]),
    )
    for _slot, values in slot_groups:
        if len(selected) >= max_retained:
            break
        for candidate, similarity in values:
            if duplicate_of_selected(candidate):
                decisions[candidate.path] = CandidateDecision(
                    candidate.path,
                    candidate.slot,
                    candidate.sha256,
                    similarity,
                    "reject",
                    "quasi-duplicate",
                )
                continue
            select(candidate, similarity)
            break

    # Fill only when coverage alone cannot reach the minimum target. Never keep
    # more than two images per slot, and never relax the identity thresholds.
    remaining = sorted(
        (
            (candidate, similarity)
            for values in eligible_by_slot.values()
            for candidate, similarity in values
            if candidate.path not in decisions
        ),
        key=lambda item: (-item[1], item[0].slot, item[0].path),
    )
    for candidate, similarity in remaining:
        if len(selected) >= min_retained or len(selected) >= max_retained:
            break
        if selected_per_slot.get(candidate.slot, 0) >= max_per_slot:
            continue
        if duplicate_of_selected(candidate):
            decisions[candidate.path] = CandidateDecision(
                candidate.path,
                candidate.slot,
                candidate.sha256,
                similarity,
                "reject",
                "quasi-duplicate",
            )
            continue
        select(candidate, similarity)

    for candidate, similarity in scored.values():
        if candidate.path in decisions or similarity is None:
            continue
        if duplicate_of_selected(candidate):
            reason = "quasi-duplicate"
        elif selected_per_slot.get(candidate.slot, 0) >= max_per_slot:
            reason = "slot-cap"
        elif len(selected) >= min_retained:
            reason = "target-reached"
        else:
            reason = "lot-insufficient"
        decisions[candidate.path] = CandidateDecision(
            candidate.path, candidate.slot, candidate.sha256, similarity, "reject", reason
        )

    return sorted(decisions.values(), key=lambda decision: (decision.slot, decision.path))


def file_sha256(filename: Path) -> str:
    digest = hashlib.sha256()
    with filename.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_regular_file(filename: Path, label: str) -> None:
    info = filename.lstat()
    if filename.is_symlink() or not filename.is_file() or info.st_size <= 0:
        raise RuntimeError(f"{label} must be a non-empty regular non-symlink file: {filename}")


def reference_image_paths(directory: Path) -> list[Path]:
    paths = sorted(
        path
        for path in directory.rglob("*")
        if path.suffix.lower() in SUPPORTED_REFERENCE_SUFFIXES
    )
    for filename in paths:
        safe_regular_file(filename, "Original reference")
    if not paths:
        raise RuntimeError(f"No original reference images found in: {directory}")
    return paths


def load_candidate_records(directory: Path) -> list[tuple[Path, str, str]]:
    records: list[tuple[Path, str, str]] = []
    for image_path in sorted(directory.rglob("*.png")):
        safe_regular_file(image_path, "Candidate")
        sidecar_path = image_path.with_suffix(".json")
        safe_regular_file(sidecar_path, "Candidate sidecar")
        try:
            sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Invalid candidate sidecar {sidecar_path}: {error}") from error
        slot = sidecar.get("slot") if isinstance(sidecar, dict) else None
        provenance = sidecar.get("provenance") if isinstance(sidecar, dict) else None
        digest = file_sha256(image_path)
        if (
            not isinstance(slot, dict)
            or not isinstance(slot.get("slotId"), str)
            or not isinstance(provenance, dict)
            or provenance.get("generator") != "krea2-identity-edit-v3"
            or provenance.get("referenceKind") != "original"
            or sidecar.get("sha256") != digest
        ):
            raise RuntimeError(f"Candidate provenance/hash is invalid: {sidecar_path}")
        records.append((image_path, slot["slotId"], digest))
    if not records:
        raise RuntimeError(f"No v3 candidate PNG files found in: {directory}")
    return records


def load_arcface_runtime() -> tuple[Any, Any, Any]:
    missing: list[str] = []
    modules: dict[str, Any] = {}
    for package, module_name in (
        ("opencv-python", "cv2"),
        ("insightface", "insightface"),
        ("onnxruntime-gpu", "onnxruntime"),
    ):
        try:
            modules[module_name] = __import__(module_name)
        except (ImportError, OSError):
            missing.append(package)
    if missing:
        raise MissingDependencyError(
            "Missing VisualGates dependency/dependencies: " + ", ".join(missing)
        )
    return modules["cv2"], modules["insightface"], modules["onnxruntime"]


def largest_embedding(faces: Iterable[Any]) -> tuple[float, ...] | None:
    face_list = list(faces)
    if not face_list:
        return None
    face = max(
        face_list,
        key=lambda item: float(
            (item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1])
        ),
    )
    embedding = getattr(face, "normed_embedding", None)
    if embedding is None:
        return None
    return tuple(float(value) for value in embedding.tolist())


def extract_embeddings(
    paths: Sequence[Path],
    require_face: bool,
) -> list[tuple[float, ...] | None]:
    cv2, insightface, onnxruntime = load_arcface_runtime()
    available = set(onnxruntime.get_available_providers())
    providers = [
        provider
        for provider in ("CUDAExecutionProvider", "CPUExecutionProvider")
        if provider in available
    ]
    if not providers:
        raise MissingDependencyError("ONNX Runtime exposes neither CUDA nor CPU execution provider")
    analyzer = insightface.app.FaceAnalysis(name="buffalo_l", providers=providers)
    analyzer.prepare(ctx_id=0 if "CUDAExecutionProvider" in providers else -1, det_size=(640, 640))
    embeddings: list[tuple[float, ...] | None] = []
    for filename in paths:
        image = cv2.imread(str(filename), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Could not decode image: {filename}")
        embedding = largest_embedding(analyzer.get(image))
        if require_face and embedding is None:
            raise RuntimeError(f"No face detected in original reference: {filename}")
        embeddings.append(embedding)
    return embeddings


def parse_range(raw: str) -> tuple[float, float]:
    values = raw.split(":", 1)
    if len(values) != 2:
        raise argparse.ArgumentTypeError("range must use MIN:MAX")
    try:
        return float(values[0]), float(values[1])
    except ValueError as error:
        raise argparse.ArgumentTypeError("range bounds must be numbers") from error


def parse_csv_slots(raw: str) -> frozenset[str]:
    """Parse a non-empty, duplicate-free CSV of slot identifiers."""
    slots = [value.strip() for value in raw.split(",") if value.strip()]
    if not slots:
        raise argparse.ArgumentTypeError("slot list must contain at least one identifier")
    if len(set(slots)) != len(slots):
        raise argparse.ArgumentTypeError("slot list must not contain duplicates")
    return frozenset(slots)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", type=Path, help="v3 candidate root")
    parser.add_argument("--reference-dir", type=Path, help="original reference images")
    parser.add_argument("--out-manifest", type=Path, help="destination curation manifest")
    parser.add_argument("--keep-range", type=parse_range, default=(0.60, 0.80))
    parser.add_argument("--reject-below", type=float, default=0.55)
    parser.add_argument("--dedup-above", type=float, default=0.92)
    parser.add_argument(
        "--face-exempt-slots",
        type=parse_csv_slots,
        default=frozenset(),
        help="comma-separated rear-view slot ids that bypass ArcFace and require human review",
    )
    parser.add_argument("--self-test", action="store_true", help="run pure synthetic checks without ML dependencies")
    args = parser.parse_args(argv)
    if not args.self_test:
        missing = [
            flag
            for flag, value in (
                ("--candidates", args.candidates),
                ("--reference-dir", args.reference_dir),
                ("--out-manifest", args.out_manifest),
            )
            if value is None
        ]
        if missing:
            parser.error("required unless --self-test: " + ", ".join(missing))
    return args


def manifest_entry(decision: CandidateDecision, candidates_root: Path) -> dict[str, Any]:
    return {
        "path": str(Path(decision.path).relative_to(candidates_root)),
        "slot": decision.slot,
        "similarity": round(decision.similarity, 6) if decision.similarity is not None else None,
        "verdict": decision.verdict,
        "reason": decision.reason,
        "sha256": decision.sha256,
    }


def write_manifest_atomic(filename: Path, value: dict[str, Any]) -> None:
    filename.parent.mkdir(parents=True, exist_ok=True)
    temporary = filename.with_name(f".{filename.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, sort_keys=False, allow_nan=False)
            handle.write("\n")
        temporary.replace(filename)
    finally:
        if temporary.exists():
            temporary.unlink()


def run_self_test() -> None:
    reference_embeddings = [(1.0, 0.0), (1.0, 0.0)]
    candidates = [
        CandidateEmbedding("a-best.png", "slot-a", "a" * 64, (0.75, math.sqrt(1 - 0.75**2))),
        CandidateEmbedding("a-duplicate.png", "slot-a", "b" * 64, (0.74, math.sqrt(1 - 0.74**2))),
        CandidateEmbedding("b-keep.png", "slot-b", "c" * 64, (0.65, -math.sqrt(1 - 0.65**2))),
        CandidateEmbedding("c-drift.png", "slot-c", "d" * 64, (0.50, math.sqrt(1 - 0.50**2))),
        CandidateEmbedding("d-margin.png", "slot-d", "e" * 64, (0.58, math.sqrt(1 - 0.58**2))),
        CandidateEmbedding("e-high.png", "slot-e", "f" * 64, (0.90, math.sqrt(1 - 0.90**2))),
        CandidateEmbedding("f-no-face.png", "slot-f", "0" * 64, None),
        CandidateEmbedding("rear-view.png", "slot-back", "9" * 64, (1.0, 0.0)),
    ]
    decisions = {
        decision.path: decision
        for decision in decide_candidates(
            candidates,
            reference_embeddings,
            min_retained=2,
            face_exempt_slots=frozenset({"slot-back"}),
        )
    }
    expected = {
        "a-best.png": ("keep", "selected"),
        "a-duplicate.png": ("reject", "quasi-duplicate"),
        "b-keep.png": ("keep", "selected"),
        "c-drift.png": ("reject", "identity-drift"),
        "d-margin.png": ("reject", "below-keep-range"),
        "e-high.png": ("reject", "above-keep-range"),
        "f-no-face.png": ("reject", "no-face"),
        "rear-view.png": ("human-review", "no-face-framing"),
    }
    actual = {
        path: (decision.verdict, decision.reason)
        for path, decision in decisions.items()
    }
    if actual != expected:
        raise AssertionError(f"Unexpected synthetic decisions: {actual}")
    if decisions["rear-view.png"].similarity is not None:
        raise AssertionError("Face-exempt rear view must not receive an ArcFace similarity")
    loo = leave_one_out_similarities(reference_embeddings)
    if loo != [1.0, 1.0]:
        raise AssertionError(f"Unexpected leave-one-out similarities: {loo}")
    quota_candidates = [
        CandidateEmbedding("g-one.png", "slot-g", "1" * 64, (0.70, math.sqrt(1 - 0.70**2))),
        CandidateEmbedding("g-two.png", "slot-g", "2" * 64, (0.70, -math.sqrt(1 - 0.70**2))),
        CandidateEmbedding("g-three.png", "slot-g", "3" * 64, (0.60, math.sqrt(1 - 0.60**2))),
    ]
    quota_decisions = decide_candidates(
        quota_candidates,
        reference_embeddings,
        min_retained=3,
    )
    if sum(decision.verdict == "keep" for decision in quota_decisions) != 2:
        raise AssertionError("Per-slot selection exceeded or failed to reach the two-image cap")


def run_curation(args: argparse.Namespace) -> int:
    candidates_root = args.candidates.resolve()
    references_root = args.reference_dir.resolve()
    if not candidates_root.is_dir():
        raise RuntimeError(f"Candidate directory does not exist: {candidates_root}")
    if not references_root.is_dir():
        raise RuntimeError(f"Original reference directory does not exist: {references_root}")
    keep_min, keep_max = args.keep_range
    thresholds = DecisionThresholds(
        keep_min=keep_min,
        keep_max=keep_max,
        reject_below=args.reject_below,
        dedup_above=args.dedup_above,
    )
    validate_thresholds(thresholds)

    reference_paths = reference_image_paths(references_root)
    candidate_records = load_candidate_records(candidates_root)
    reference_values = extract_embeddings(reference_paths, require_face=True)
    reference_embeddings = [embedding for embedding in reference_values if embedding is not None]
    face_exempt_slots = args.face_exempt_slots
    arcface_candidate_paths = [
        record[0] for record in candidate_records if record[1] not in face_exempt_slots
    ]
    candidate_values = (
        extract_embeddings(arcface_candidate_paths, require_face=False)
        if arcface_candidate_paths
        else []
    )
    embeddings_by_path = dict(zip(arcface_candidate_paths, candidate_values))
    candidates = [
        CandidateEmbedding(
            str(record[0]),
            record[1],
            record[2],
            embeddings_by_path.get(record[0]),
        )
        for record in candidate_records
    ]
    decisions = decide_candidates(
        candidates,
        reference_embeddings,
        thresholds,
        face_exempt_slots=face_exempt_slots,
    )
    retained = sum(decision.verdict == "keep" for decision in decisions)
    human_review = [
        decision for decision in decisions if decision.verdict == "human-review"
    ]
    rejected = sum(decision.verdict == "reject" for decision in decisions)
    loo = leave_one_out_similarities(reference_embeddings)
    manifest = {
        "schemaVersion": 1,
        "generator": "arcface-centroid-curation-v3",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "candidateRoot": str(candidates_root),
        "referenceRoot": str(references_root),
        "referenceCount": len(reference_embeddings),
        "referenceLeaveOneOutSimilarities": [
            round(value, 6) if value is not None else None for value in loo
        ],
        "thresholds": {
            "keepRange": [thresholds.keep_min, thresholds.keep_max],
            "rejectBelow": thresholds.reject_below,
            "dedupAbove": thresholds.dedup_above,
            "maxPerSlot": MAX_PER_SLOT,
            "targetRange": [MIN_RETAINED, MAX_RETAINED],
        },
        "retainedCount": retained,
        "humanReviewCount": len(human_review),
        "humanReviewImages": [
            manifest_entry(decision, candidates_root) for decision in human_review
        ],
        "rejectedCount": rejected,
        "sufficient": MIN_RETAINED <= retained <= MAX_RETAINED,
        "images": [manifest_entry(decision, candidates_root) for decision in decisions],
    }
    write_manifest_atomic(args.out_manifest.resolve(), manifest)
    print(
        f"Curation summary: kept={retained}, human-review={len(human_review)}, rejected={rejected}"
    )
    if human_review:
        print("Human-review no-face framings:")
        for decision in human_review:
            print(f"- {decision.slot}: {Path(decision.path).relative_to(candidates_root)}")
    if retained < MIN_RETAINED:
        print(
            f"Insufficient curated lot: retained {retained} < {MIN_RETAINED}; regenerate candidates without relaxing thresholds",
            file=sys.stderr,
        )
        return INSUFFICIENT_LOT_EXIT
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = parse_args(argv if argv is not None else sys.argv[1:])
        if args.self_test:
            run_self_test()
            print("identity dataset v3 curation self-test: OK")
            return 0
        return run_curation(args)
    except MissingDependencyError as error:
        print(f"Dependency error: {error}", file=sys.stderr)
        return DEPENDENCY_EXIT
    except Exception as error:
        print(f"Identity dataset v3 curation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
