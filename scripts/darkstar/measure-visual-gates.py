#!/usr/bin/env python3
"""Measure visual-quality signals without deciding whether a clip passes.

Usage:
    python measure-visual-gates.py --clip C:\\renders\\short.mp4 \
        --reference-dir C:\\datasets\\lisa-approved --output report.json \
        --sample-fps 6 --loop-check --profile native-fashion-v1

    python measure-visual-gates.py --frames-dir C:\\renders\\frames \
        --reference-dir C:\\datasets\\lisa-approved --output report.json

Setup (Python 3.10+; use a dedicated virtual environment):
    pip install opencv-python numpy insightface onnxruntime-gpu mediapipe
    ffprobe must also be available in PATH when --clip is used.

The JSON report contains raw, deterministic measurements only. Thresholds and
pass/fail decisions belong to the TypeScript consumer. A measurement failure
exits with status 2 and a dependency failure with status 3; no partial report
is written.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence


DEPENDENCY_EXIT = 3
MEASUREMENT_EXIT = 2
IDENTITY_INFORMATIONAL_THRESHOLD = 0.35
LOW_VISIBILITY_THRESHOLD = 0.5
TELEPORTATION_DELTA_THRESHOLD = 0.25
LOW_SHARPNESS_INFORMATIONAL_THRESHOLD = 100.0
NEAR_BLACK_LUMA_THRESHOLD = 10.0
SUPPORTED_IMAGE_SUFFIXES = {".bmp", ".jpeg", ".jpg", ".png", ".webp"}


class MissingDependencyError(RuntimeError):
    """Raised when a required runtime dependency is unavailable."""


@dataclass(frozen=True)
class RuntimeDependencies:
    np: Any
    cv2: Any
    insightface: Any
    mediapipe: Any


@dataclass(frozen=True)
class FrameSet:
    sampled_frames: Any
    sampled_indices: Any
    sampled_timestamps: Any
    analysis_gray_frames: Any
    source_fps: float
    width: int
    height: int
    first_frame: Any
    last_frame: Any


def load_runtime_dependencies(require_ffprobe: bool) -> RuntimeDependencies:
    """Import all Python dependencies before any source data is processed."""
    missing: list[str] = []
    modules: dict[str, Any] = {}
    for package, module_name in (
        ("numpy", "numpy"),
        ("opencv-python", "cv2"),
        ("insightface", "insightface"),
        ("onnxruntime-gpu", "onnxruntime"),
        ("mediapipe", "mediapipe"),
    ):
        try:
            modules[module_name] = __import__(module_name)
        except (ImportError, OSError):
            missing.append(package)
    if require_ffprobe and shutil.which("ffprobe") is None:
        missing.append("ffprobe (executable required in PATH)")
    if missing:
        raise MissingDependencyError(
            "Missing required dependency/dependencies: " + ", ".join(missing)
            + ". See the Setup section in this script's docstring."
        )
    return RuntimeDependencies(
        np=modules["numpy"],
        cv2=modules["cv2"],
        insightface=modules["insightface"],
        mediapipe=modules["mediapipe"],
    )


def normalized_rows(values: Any, np: Any) -> Any:
    """Return row-wise L2-normalized vectors, preserving zero rows."""
    matrix = np.asarray(values, dtype=np.float64)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return np.divide(matrix, norms, out=np.zeros_like(matrix), where=norms > 0)


def measure_identity(
    frame_embeddings: Any,
    reference_embeddings: Any,
    detected_faces: Any,
    frame_indices: Any,
    timestamps: Any,
    np: Any,
) -> dict[str, Any]:
    """Compare detected frame embeddings with the normalized reference centroid."""
    detected = np.asarray(detected_faces, dtype=bool)
    indices = np.asarray(frame_indices, dtype=np.int64)
    times = np.asarray(timestamps, dtype=np.float64)
    references = np.asarray(reference_embeddings, dtype=np.float64)
    embeddings = np.asarray(frame_embeddings, dtype=np.float64)
    if references.ndim != 2 or references.shape[0] == 0:
        raise ValueError("At least one valid reference face embedding is required")
    if embeddings.ndim != 2 or embeddings.shape[0] != detected.shape[0]:
        raise ValueError("Frame embeddings and face detections must have matching rows")
    if indices.shape != detected.shape or times.shape != detected.shape:
        raise ValueError("Identity frame metadata must match sampled frames")

    centroid = normalized_rows(references, np).mean(axis=0, keepdims=True)
    centroid = normalized_rows(centroid, np)[0]
    valid_positions = np.flatnonzero(detected)
    similarities = normalized_rows(embeddings[valid_positions], np) @ centroid if valid_positions.size else np.array([])
    no_face = [
        {"frameIndex": int(indices[pos]), "timestampSeconds": float(times[pos])}
        for pos in np.flatnonzero(~detected)
    ]
    low_frames = [
        {
            "frameIndex": int(indices[pos]),
            "timestampSeconds": float(times[pos]),
            "similarity": float(similarity),
        }
        for pos, similarity in zip(valid_positions.tolist(), similarities.tolist())
        if similarity < IDENTITY_INFORMATIONAL_THRESHOLD
    ]
    return {
        "evaluatedFrameCount": int(detected.shape[0]),
        "detectedFaceCount": int(valid_positions.size),
        "minSimilarity": float(np.min(similarities)) if similarities.size else 0.0,
        "meanSimilarity": float(np.mean(similarities)) if similarities.size else 0.0,
        "stdDevSimilarity": float(np.std(similarities)) if similarities.size else 0.0,
        "lowSimilarityFrames": low_frames,
        "noFace": no_face,
    }


def count_extended_fingers(hand_landmarks: Any, handedness: str, np: Any) -> int:
    """Estimate a deterministic 0..5 extended-finger count from 21 hand landmarks."""
    points = np.asarray(hand_landmarks, dtype=np.float64)
    if points.shape != (21, 3):
        return -1
    count = sum(bool(points[tip, 1] < points[pip, 1]) for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)))
    thumb_extended = points[4, 0] < points[3, 0] if handedness.lower() == "right" else points[4, 0] > points[3, 0]
    return int(count + thumb_extended)


def measure_anatomy(
    pose_positions: Any,
    pose_visibility: Any,
    hand_finger_counts: Any,
    frame_indices: Any,
    timestamps: Any,
    np: Any,
) -> dict[str, Any]:
    """Summarize low visibility, implausible hands and inter-frame limb jumps."""
    positions = np.asarray(pose_positions, dtype=np.float64)
    visibility = np.asarray(pose_visibility, dtype=np.float64)
    fingers = np.asarray(hand_finger_counts, dtype=np.int64)
    indices = np.asarray(frame_indices, dtype=np.int64)
    times = np.asarray(timestamps, dtype=np.float64)
    if positions.ndim != 3 or positions.shape[2] != 2 or visibility.shape != positions.shape[:2]:
        raise ValueError("Pose positions and visibility arrays have incompatible shapes")
    if fingers.shape != (positions.shape[0], 2) or indices.shape[0] != positions.shape[0]:
        raise ValueError("Anatomy metadata must match sampled frames")

    low_visibility = visibility < LOW_VISIBILITY_THRESHOLD
    teleport_frames: list[dict[str, Any]] = []
    for current in range(1, positions.shape[0]):
        jointly_visible = (~np.isnan(positions[current]).any(axis=1)) & (~np.isnan(positions[current - 1]).any(axis=1))
        jointly_visible &= visibility[current] >= LOW_VISIBILITY_THRESHOLD
        jointly_visible &= visibility[current - 1] >= LOW_VISIBILITY_THRESHOLD
        deltas = np.linalg.norm(positions[current] - positions[current - 1], axis=1)
        teleported = np.flatnonzero(jointly_visible & (deltas > TELEPORTATION_DELTA_THRESHOLD))
        if teleported.size:
            teleport_frames.append({
                "frameIndex": int(indices[current]),
                "timestampSeconds": float(times[current]),
                "landmarkIndices": [int(value) for value in teleported.tolist()],
                "maxNormalizedDelta": float(np.max(deltas[teleported])),
            })

    suspicious: list[dict[str, Any]] = []
    teleport_indices = {item["frameIndex"] for item in teleport_frames}
    for pos in range(positions.shape[0]):
        bad_hands = [int(value) for value in fingers[pos].tolist() if value != -1 and not 0 <= value <= 5]
        low_count = int(np.count_nonzero(low_visibility[pos]))
        if low_count or bad_hands or int(indices[pos]) in teleport_indices:
            suspicious.append({
                "frameIndex": int(indices[pos]),
                "timestampSeconds": float(times[pos]),
                "lowVisibilityLandmarkCount": low_count,
                "detectedHandFingerCounts": [int(value) for value in fingers[pos].tolist() if value >= 0],
                "implausibleFingerCounts": bad_hands,
                "teleportation": int(indices[pos]) in teleport_indices,
            })
    return {
        "evaluatedFrameCount": int(positions.shape[0]),
        "suspectFrameCount": len(suspicious),
        "suspiciousFrames": suspicious,
        "teleportationFrames": teleport_frames,
    }


def measure_temporal_stability(gray_frames: Any, np: Any, cv2: Any) -> dict[str, Any]:
    """Measure full-sequence luminance flicker, exposure jitter and gradient warp."""
    frames = np.asarray(gray_frames, dtype=np.float32)
    if frames.ndim != 3 or frames.shape[0] == 0:
        raise ValueError("Temporal stability requires a non-empty [frame,height,width] array")
    means = frames.mean(axis=(1, 2))
    if frames.shape[0] == 1:
        global_diffs = np.zeros(1, dtype=np.float32)
        third_diffs = np.zeros((1, 3), dtype=np.float32)
        gradient_diffs = np.zeros(1, dtype=np.float32)
        pair_count = 0
    else:
        absolute = np.abs(frames[1:] - frames[:-1])
        global_diffs = absolute.mean(axis=(1, 2))
        thirds = np.array_split(absolute, 3, axis=1)
        third_diffs = np.stack([third.mean(axis=(1, 2)) for third in thirds], axis=1)
        gradients = []
        for frame in frames:
            grad_x = cv2.Sobel(frame, cv2.CV_32F, 1, 0, ksize=3)
            grad_y = cv2.Sobel(frame, cv2.CV_32F, 0, 1, ksize=3)
            gradients.append(cv2.magnitude(grad_x, grad_y))
        gradient_stack = np.stack(gradients)
        gradient_diffs = np.abs(gradient_stack[1:] - gradient_stack[:-1]).mean(axis=(1, 2))
        pair_count = frames.shape[0] - 1
    thirds_mean = third_diffs.mean(axis=0)
    return {
        "framePairCount": int(pair_count),
        "globalFlickerMean": float(global_diffs.mean()),
        "thirdsFlickerMean": {
            "top": float(thirds_mean[0]),
            "middle": float(thirds_mean[1]),
            "bottom": float(thirds_mean[2]),
        },
        "exposureJitterVariance": float(np.var(means)),
        "localWarpGradientMean": float(gradient_diffs.mean()),
    }


def measure_sharpness(
    sampled_frames: Any,
    frame_indices: Any,
    timestamps: Any,
    np: Any,
    cv2: Any,
) -> dict[str, Any]:
    """Calculate per-sample Laplacian variance and retain informational lows."""
    frames = np.asarray(sampled_frames)
    indices = np.asarray(frame_indices, dtype=np.int64)
    times = np.asarray(timestamps, dtype=np.float64)
    values = np.array([
        cv2.Laplacian(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        for frame in frames
    ], dtype=np.float64)
    low_frames = [
        {"frameIndex": int(index), "timestampSeconds": float(timestamp), "laplacianVariance": float(value)}
        for index, timestamp, value in zip(indices.tolist(), times.tolist(), values.tolist())
        if value < LOW_SHARPNESS_INFORMATIONAL_THRESHOLD
    ]
    return {
        "evaluatedFrameCount": int(values.size),
        "minLaplacianVariance": float(values.min()) if values.size else 0.0,
        "meanLaplacianVariance": float(values.mean()) if values.size else 0.0,
        "lowSharpnessFrames": low_frames,
    }


def measure_loop(first_frame: Any, last_frame: Any, np: Any, cv2: Any) -> dict[str, float]:
    """Compare loop endpoints with normalized absolute difference and histograms."""
    first_array = np.asarray(first_frame)
    last_array = np.asarray(last_frame)
    first = cv2.cvtColor(first_array, cv2.COLOR_BGR2GRAY) if first_array.ndim == 3 else first_array
    last = cv2.cvtColor(last_array, cv2.COLOR_BGR2GRAY) if last_array.ndim == 3 else last_array
    if first.shape != last.shape:
        last = cv2.resize(last, (first.shape[1], first.shape[0]), interpolation=cv2.INTER_AREA)
    normalized_difference = float(np.abs(first.astype(np.float32) - last.astype(np.float32)).mean() / 255.0)
    first_hist = cv2.calcHist([first], [0], None, [256], [0, 256])
    last_hist = cv2.calcHist([last], [0], None, [256], [0, 256])
    cv2.normalize(first_hist, first_hist)
    cv2.normalize(last_hist, last_hist)
    return {
        "normalizedAbsoluteDifference": normalized_difference,
        "histogramCorrelation": float(cv2.compareHist(first_hist, last_hist, cv2.HISTCMP_CORREL)),
    }


def sample_positions(frame_count: int, source_fps: float, sample_fps: float, np: Any) -> set[int]:
    """Choose deterministic source-frame positions at no more than sample_fps."""
    if frame_count <= 0 or source_fps <= 0 or sample_fps <= 0:
        raise ValueError("Frame count and FPS values must be positive")
    step = max(source_fps / sample_fps, 1.0)
    positions = np.arange(0.0, frame_count, step, dtype=np.float64).astype(np.int64)
    return {int(value) for value in np.unique(positions).tolist()}


def resized_gray(frame: Any, cv2: Any, analysis_width: int = 320) -> Any:
    """Create a bounded-size grayscale frame for all-frame temporal analysis."""
    height, width = frame.shape[:2]
    target_width = min(width, analysis_width)
    target_height = max(1, round(height * target_width / width))
    resized = cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)


def read_clip_frames(clip_path: Path, sample_fps: float, deps: RuntimeDependencies) -> FrameSet:
    """Decode every clip frame for temporal signals and retain sampled full frames."""
    capture = deps.cv2.VideoCapture(str(clip_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video clip: {clip_path}")
    source_fps = float(capture.get(deps.cv2.CAP_PROP_FPS))
    declared_count = int(capture.get(deps.cv2.CAP_PROP_FRAME_COUNT))
    width = int(capture.get(deps.cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(deps.cv2.CAP_PROP_FRAME_HEIGHT))
    selected = sample_positions(max(declared_count, 1), source_fps, sample_fps, deps.np)
    samples: list[Any] = []
    indices: list[int] = []
    grays: list[Any] = []
    first_frame: Any | None = None
    last_frame: Any | None = None
    frame_index = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if first_frame is None:
                first_frame = frame.copy()
            last_frame = frame.copy()
            grays.append(resized_gray(frame, deps.cv2))
            if frame_index in selected:
                samples.append(frame.copy())
                indices.append(frame_index)
            frame_index += 1
    finally:
        capture.release()
    if not grays or not samples or first_frame is None or last_frame is None:
        raise RuntimeError(f"No decodable frames found in clip: {clip_path}")
    return FrameSet(
        sampled_frames=deps.np.stack(samples),
        sampled_indices=deps.np.asarray(indices, dtype=deps.np.int64),
        sampled_timestamps=deps.np.asarray(indices, dtype=deps.np.float64) / source_fps,
        analysis_gray_frames=deps.np.stack(grays),
        source_fps=source_fps,
        width=width,
        height=height,
        first_frame=first_frame,
        last_frame=last_frame,
    )


def read_frame_directory(frames_dir: Path, sample_fps: float, deps: RuntimeDependencies) -> FrameSet:
    """Read an ordered image sequence; each input image is treated as one sample."""
    paths = sorted(path for path in frames_dir.iterdir() if path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES)
    frames = [deps.cv2.imread(str(path), deps.cv2.IMREAD_COLOR) for path in paths]
    if not frames or any(frame is None for frame in frames):
        raise RuntimeError(f"No complete decodable image sequence found in: {frames_dir}")
    first_shape = frames[0].shape
    if any(frame.shape != first_shape for frame in frames):
        raise RuntimeError("All --frames-dir images must have identical dimensions")
    indices = deps.np.arange(len(frames), dtype=deps.np.int64)
    return FrameSet(
        sampled_frames=deps.np.stack(frames),
        sampled_indices=indices,
        sampled_timestamps=indices.astype(deps.np.float64) / sample_fps,
        analysis_gray_frames=deps.np.stack([resized_gray(frame, deps.cv2) for frame in frames]),
        source_fps=sample_fps,
        width=int(first_shape[1]),
        height=int(first_shape[0]),
        first_frame=frames[0],
        last_frame=frames[-1],
    )


def image_paths(directory: Path) -> list[Path]:
    return sorted(path for path in directory.iterdir() if path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES)


def largest_face_embedding(faces: Sequence[Any], np: Any) -> Any | None:
    if not faces:
        return None
    face = max(faces, key=lambda item: float((item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1])))
    embedding = getattr(face, "normed_embedding", None)
    return None if embedding is None else np.asarray(embedding, dtype=np.float64)


def infer_face_embeddings(
    frames: Any,
    reference_dir: Path,
    deps: RuntimeDependencies,
) -> tuple[Any, Any, Any]:
    """Run buffalo_l and return aligned embeddings plus a detection mask."""
    analyzer = deps.insightface.app.FaceAnalysis(
        name="buffalo_l",
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )
    analyzer.prepare(ctx_id=0, det_size=(640, 640))
    references: list[Any] = []
    for reference_path in image_paths(reference_dir):
        image = deps.cv2.imread(str(reference_path), deps.cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Could not decode identity reference: {reference_path}")
        embedding = largest_face_embedding(analyzer.get(image), deps.np)
        if embedding is None:
            raise RuntimeError(f"No face detected in approved identity reference: {reference_path}")
        references.append(embedding)
    if not references:
        raise RuntimeError(f"No approved identity reference images found in: {reference_dir}")

    detected: list[bool] = []
    frame_embeddings: list[Any] = []
    embedding_size = int(references[0].shape[0])
    for frame in frames:
        embedding = largest_face_embedding(analyzer.get(frame), deps.np)
        detected.append(embedding is not None)
        frame_embeddings.append(embedding if embedding is not None else deps.np.zeros(embedding_size))
    return deps.np.stack(frame_embeddings), deps.np.stack(references), deps.np.asarray(detected, dtype=bool)


def infer_pose_and_hands(frames: Any, deps: RuntimeDependencies) -> tuple[Any, Any, Any]:
    """Run MediaPipe Pose and Hands, returning arrays consumed by the pure metric."""
    try:
        pose_api = deps.mediapipe.solutions.pose
        hands_api = deps.mediapipe.solutions.hands
    except AttributeError as error:
        raise MissingDependencyError(
            "MediaPipe solutions API is unavailable. Install compatible versions with "
            "`pip install mediapipe==0.10.14 'protobuf<5'`."
        ) from error
    pose_positions: list[Any] = []
    pose_visibility: list[Any] = []
    hand_counts: list[list[int]] = []
    with pose_api.Pose(static_image_mode=True, model_complexity=2) as pose, hands_api.Hands(
        static_image_mode=True,
        max_num_hands=2,
        model_complexity=1,
    ) as hands:
        for frame in frames:
            rgb = deps.cv2.cvtColor(frame, deps.cv2.COLOR_BGR2RGB)
            pose_result = pose.process(rgb)
            if pose_result.pose_landmarks:
                landmarks = pose_result.pose_landmarks.landmark
                pose_positions.append(deps.np.asarray([[item.x, item.y] for item in landmarks], dtype=deps.np.float64))
                pose_visibility.append(deps.np.asarray([item.visibility for item in landmarks], dtype=deps.np.float64))
            else:
                pose_positions.append(deps.np.full((33, 2), deps.np.nan))
                pose_visibility.append(deps.np.zeros(33))

            counts = [-1, -1]
            if hands_result := hands.process(rgb):
                multi_landmarks = hands_result.multi_hand_landmarks or []
                multi_handedness = hands_result.multi_handedness or []
                for index, landmarks in enumerate(multi_landmarks[:2]):
                    handedness = multi_handedness[index].classification[0].label if index < len(multi_handedness) else "Right"
                    points = deps.np.asarray([[item.x, item.y, item.z] for item in landmarks.landmark])
                    counts[index] = count_extended_fingers(points, handedness, deps.np)
            hand_counts.append(counts)
    return (
        deps.np.stack(pose_positions),
        deps.np.stack(pose_visibility),
        deps.np.asarray(hand_counts, dtype=deps.np.int64),
    )


def ffprobe_properties(clip_path: Path) -> dict[str, Any]:
    """Read master container/stream properties with ffprobe."""
    completed = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,bit_rate",
            "-of", "json", str(clip_path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    parsed = json.loads(completed.stdout)
    streams = parsed.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if not isinstance(video, dict):
        raise RuntimeError("ffprobe found no video stream")
    numerator, denominator = (float(value) for value in str(video.get("avg_frame_rate", "0/1")).split("/", 1))
    bitrate = video.get("bit_rate") or parsed.get("format", {}).get("bit_rate") or 0
    return {
        "width": int(video.get("width", 0)),
        "height": int(video.get("height", 0)),
        "fps": numerator / denominator if denominator else 0.0,
        "durationSeconds": float(parsed.get("format", {}).get("duration", 0.0)),
        "videoBitrateKbps": float(bitrate) / 1000.0,
        "videoCodec": str(video.get("codec_name", "unknown")),
        "audioCodec": str(audio.get("codec_name", "none")) if audio else "none",
        "hasAudio": audio is not None,
    }


def master_properties_for_frames(frame_set: FrameSet) -> dict[str, Any]:
    """Emit deliberately non-deliverable container properties for an image sequence."""
    return {
        "width": frame_set.width,
        "height": frame_set.height,
        "fps": frame_set.source_fps,
        "durationSeconds": frame_set.analysis_gray_frames.shape[0] / frame_set.source_fps,
        "videoBitrateKbps": 0.0,
        "videoCodec": "image-sequence",
        "audioCodec": "none",
        "hasAudio": False,
    }


def file_sha256(filename: Path) -> str:
    digest = hashlib.sha256()
    with filename.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--clip", type=Path, help="MP4 clip to measure")
    source.add_argument("--frames-dir", type=Path, help="Directory of ordered decoded frames")
    parser.add_argument("--reference-dir", type=Path, required=True, help="Approved identity reference images")
    parser.add_argument("--output", type=Path, default=Path("report.json"), help="Destination JSON report")
    parser.add_argument("--sample-fps", type=float, default=6.0, help="Sampling FPS for identity/anatomy/sharpness")
    parser.add_argument("--loop-check", action="store_true", help="Measure first/last similarity for loopable Shorts")
    parser.add_argument(
        "--profile",
        choices=("native-fashion-v1", "legacy-localized-v1"),
        default="native-fashion-v1",
        help="Informational profile copied into the report",
    )
    args = parser.parse_args(argv)
    if not math.isfinite(args.sample_fps) or args.sample_fps <= 0:
        parser.error("--sample-fps must be a positive finite number")
    return args


def validate_inputs(args: argparse.Namespace) -> None:
    source = args.clip if args.clip is not None else args.frames_dir
    if source is None or (args.clip is not None and not source.is_file()) or (args.frames_dir is not None and not source.is_dir()):
        raise RuntimeError(f"Input source does not exist or has the wrong type: {source}")
    if not args.reference_dir.is_dir():
        raise RuntimeError(f"Reference directory does not exist: {args.reference_dir}")
    if args.output.exists():
        raise RuntimeError(f"Output already exists; refusing to overwrite: {args.output}")


def build_report(args: argparse.Namespace, deps: RuntimeDependencies) -> dict[str, Any]:
    validate_inputs(args)
    frame_set = (
        read_clip_frames(args.clip, args.sample_fps, deps)
        if args.clip is not None
        else read_frame_directory(args.frames_dir, args.sample_fps, deps)
    )
    embeddings, references, detected = infer_face_embeddings(
        frame_set.sampled_frames,
        args.reference_dir,
        deps,
    )
    pose_positions, pose_visibility, hand_counts = infer_pose_and_hands(frame_set.sampled_frames, deps)
    master = ffprobe_properties(args.clip) if args.clip is not None else master_properties_for_frames(frame_set)
    master["nearBlackFrameRatio"] = float(
        deps.np.mean(frame_set.analysis_gray_frames.mean(axis=(1, 2)) <= NEAR_BLACK_LUMA_THRESHOLD)
    )
    loop = (
        measure_loop(frame_set.first_frame, frame_set.last_frame, deps.np, deps.cv2)
        if args.loop_check
        else None
    )
    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "clipSha256": file_sha256(args.clip) if args.clip is not None else None,
        "profile": args.profile,
        "sampleFps": float(args.sample_fps),
        "metrics": {
            "identity": measure_identity(
                embeddings,
                references,
                detected,
                frame_set.sampled_indices,
                frame_set.sampled_timestamps,
                deps.np,
            ),
            "anatomy": measure_anatomy(
                pose_positions,
                pose_visibility,
                hand_counts,
                frame_set.sampled_indices,
                frame_set.sampled_timestamps,
                deps.np,
            ),
            "temporalStability": measure_temporal_stability(
                frame_set.analysis_gray_frames,
                deps.np,
                deps.cv2,
            ),
            "sharpness": measure_sharpness(
                frame_set.sampled_frames,
                frame_set.sampled_indices,
                frame_set.sampled_timestamps,
                deps.np,
                deps.cv2,
            ),
            "masterProperties": master,
            "loop": loop,
        },
    }


def write_report_atomic(output: Path, report: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os_getpid()}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(report, handle, indent=2, sort_keys=True, allow_nan=False)
            handle.write("\n")
        temporary.replace(output)
    finally:
        if temporary.exists():
            temporary.unlink()


def os_getpid() -> int:
    """Small seam kept separate to make atomic-path construction testable."""
    import os

    return os.getpid()


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = parse_args(argv if argv is not None else sys.argv[1:])
        deps = load_runtime_dependencies(require_ffprobe=args.clip is not None)
        report = build_report(args, deps)
        write_report_atomic(args.output.resolve(), report)
        return 0
    except MissingDependencyError as error:
        print(f"Dependency error: {error}", file=sys.stderr)
        return DEPENDENCY_EXIT
    except Exception as error:  # The CLI must fail loudly and never leave a partial report.
        print(f"Visual gate measurement failed: {error}", file=sys.stderr)
        return MEASUREMENT_EXIT


if __name__ == "__main__":
    raise SystemExit(main())
