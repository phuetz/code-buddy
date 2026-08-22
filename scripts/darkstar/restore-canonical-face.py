#!/usr/bin/env python3
"""Restore canonical face pixels after a generative character insertion.

The generator output is only used as the destination and as a lighting guide.
Face geometry comes from ``--source``.  A similarity transform (one scale, one
rotation and a translation) deliberately forbids the anisotropic deformation
that caused stretched faces in the former full-frame Qwen workflow.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Sequence

import cv2
import insightface
import numpy as np


def largest_face(analyzer: Any, image: np.ndarray, label: str) -> Any:
    faces = list(analyzer.get(image))
    if not faces:
        raise RuntimeError(f'No face detected in {label}')
    return max(
        faces,
        key=lambda face: float(
            (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1])
        ),
    )


def normalized(vector: Sequence[float]) -> np.ndarray:
    value = np.asarray(vector, dtype=np.float64)
    norm = float(np.linalg.norm(value))
    return value / norm if norm > 0 else np.zeros_like(value)


def similarity(left: Any, right: Any) -> float:
    return float(np.dot(normalized(left.normed_embedding), normalized(right.normed_embedding)))


def face_mask(shape: tuple[int, ...], bbox: Sequence[float]) -> np.ndarray:
    height, width = shape[:2]
    left, top, right, bottom = (float(value) for value in bbox)
    face_width = right - left
    face_height = bottom - top
    center = (
        round((left + right) / 2),
        round((top + bottom) / 2 + face_height * 0.015),
    )
    axes = (
        max(1, round(face_width * 0.47)),
        max(1, round(face_height * 0.50)),
    )
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1, cv2.LINE_AA)
    return mask


def robust_percentiles(image: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    pixels = image[mask > 0].astype(np.float32)
    if len(pixels) < 64:
        raise RuntimeError('Face relighting mask is too small')
    return (
        np.percentile(pixels, 20, axis=0),
        np.percentile(pixels, 80, axis=0),
    )


def relight_face(
    source: np.ndarray,
    destination: np.ndarray,
    mask: np.ndarray,
) -> tuple[np.ndarray, dict[str, list[float]]]:
    source_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    destination_lab = cv2.cvtColor(destination, cv2.COLOR_BGR2LAB).astype(np.float32)
    source_low, source_high = robust_percentiles(source_lab, mask)
    target_low, target_high = robust_percentiles(destination_lab, mask)
    source_span = np.maximum(source_high - source_low, 8.0)
    gains = np.clip((target_high - target_low) / source_span, [0.72, 0.85, 0.85], [1.38, 1.15, 1.15])
    offsets = target_low - source_low * gains
    # Chroma follows the scene gently; luminance carries most of the relight.
    offsets[1:] = np.clip(offsets[1:], -12.0, 12.0)
    transformed = source_lab * gains + offsets
    # A lighting guide rendered with the wrong identity can contain strong
    # profile shadows.  Keep the correction deliberately conservative so the
    # canonical face never becomes a dark or saturated sticker.
    transformed = source_lab * 0.65 + transformed * 0.35
    transformed = np.clip(transformed, 0, 255).astype(np.uint8)
    return cv2.cvtColor(transformed, cv2.COLOR_LAB2BGR), {
        'lab_gain': [float(value) for value in gains],
        'lab_offset': [float(value) for value in offsets],
    }


def restore(
    source: np.ndarray,
    composite: np.ndarray,
    analyzer: Any,
    *,
    relight: bool,
    target_bbox_hint: Sequence[float] | None = None,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    source_face = largest_face(analyzer, source, 'canonical source')
    target_faces = list(analyzer.get(composite))
    target_face = max(
        target_faces,
        key=lambda face: float(
            (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1])
        ),
    ) if target_faces else None
    source_points = np.asarray(source_face.kps, dtype=np.float32)
    if target_bbox_hint is not None:
        # An explicitly measured bbox is authoritative.  This is useful for a
        # tiny or geometrically corrupt draft face: its landmarks must not
        # drive the canonical placement merely because detection succeeded.
        target_bbox = [float(value) for value in target_bbox_hint]
        source_bbox = [float(value) for value in source_face.bbox]
        source_height = source_bbox[3] - source_bbox[1]
        target_height = target_bbox[3] - target_bbox[1]
        scale_hint = target_height / source_height
        source_center = ((source_bbox[0] + source_bbox[2]) / 2, (source_bbox[1] + source_bbox[3]) / 2)
        target_center = ((target_bbox[0] + target_bbox[2]) / 2, (target_bbox[1] + target_bbox[3]) / 2)
        matrix = np.asarray([
            [scale_hint, 0.0, target_center[0] - source_center[0] * scale_hint],
            [0.0, scale_hint, target_center[1] - source_center[1] * scale_hint],
        ], dtype=np.float64)
        target_width = max(1.0, target_bbox[2] - target_bbox[0])
        reprojection_rmse = None
        normalized_rmse = None
    elif target_face is not None:
        target_bbox = [float(value) for value in target_face.bbox]
        target_points = np.asarray(target_face.kps, dtype=np.float32)
        matrix, _inliers = cv2.estimateAffinePartial2D(
            source_points,
            target_points,
            method=cv2.LMEDS,
        )
        if matrix is None:
            raise RuntimeError('Could not estimate a geometry-preserving face alignment')
        projected = cv2.transform(source_points[None, :, :], matrix)[0]
        target_width = max(1.0, target_bbox[2] - target_bbox[0])
        reprojection_rmse: float | None = float(
            np.sqrt(np.mean(np.sum((projected - target_points) ** 2, axis=1)))
        )
        normalized_rmse: float | None = reprojection_rmse / target_width
    else:
        raise RuntimeError(
            'No face detected in generated composite; provide --target-bbox from an independent measurement'
        )
    scale = math.hypot(float(matrix[0, 0]), float(matrix[1, 0]))
    rotation = math.degrees(math.atan2(float(matrix[1, 0]), float(matrix[0, 0])))
    if not 0.03 <= scale <= 3.0:
        raise RuntimeError(f'Unsafe face alignment scale: {scale:.4f}')
    if normalized_rmse is not None and normalized_rmse > 0.28:
        raise RuntimeError(
            f'Face pose is incompatible with canonical recomposition: normalized RMSE {normalized_rmse:.4f}'
        )

    output_size = (composite.shape[1], composite.shape[0])
    warped_source = cv2.warpAffine(
        source,
        matrix,
        output_size,
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT_101,
    )
    canonical_mask = face_mask(source.shape, source_face.bbox)
    warped_mask = cv2.warpAffine(
        canonical_mask,
        matrix,
        output_size,
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    lighting: dict[str, list[float]] | None = None
    restored_face = warped_source
    if relight:
        restored_face, lighting = relight_face(warped_source, composite, warped_mask)

    feather = max(3, round(target_width * 0.055))
    if feather % 2 == 0:
        feather += 1
    alpha = cv2.GaussianBlur(warped_mask, (0, 0), feather / 3.0).astype(np.float32) / 255.0
    edit_mask = np.clip((1.0 - alpha) * 255.0, 0, 255).astype(np.uint8)
    alpha = alpha[:, :, None]
    output = np.clip(
        restored_face.astype(np.float32) * alpha
        + composite.astype(np.float32) * (1.0 - alpha),
        0,
        255,
    ).astype(np.uint8)
    output_face = largest_face(analyzer, output, 'protected composite')
    return output, edit_mask, {
        'method': 'canonical-pixels/similarity-transform/feathered-mask',
        'relighted': relight,
        'source_bbox': [float(value) for value in source_face.bbox],
        'target_bbox_before': target_bbox,
        'target_bbox_after': [float(value) for value in output_face.bbox],
        'similarity_transform': [[float(value) for value in row] for row in matrix],
        'uniform_scale': scale,
        'rotation_degrees': rotation,
        'landmark_reprojection_rmse': reprojection_rmse,
        'normalized_landmark_rmse': normalized_rmse,
        'arcface_before_to_source': similarity(source_face, target_face) if target_face is not None else None,
        'arcface_after_to_source': similarity(source_face, output_face),
        'feather_pixels': feather,
        **({'relighting': lighting} if lighting is not None else {}),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--composite', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--edit-mask', type=Path)
    parser.add_argument(
        '--target-bbox',
        help='fallback face bbox left,top,right,bottom from an independent detector',
    )
    parser.add_argument('--no-relight', action='store_true')
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    composite = cv2.imread(str(args.composite), cv2.IMREAD_COLOR)
    if source is None:
        raise RuntimeError(f'Could not read canonical source: {args.source}')
    if composite is None:
        raise RuntimeError(f'Could not read composite: {args.composite}')
    analyzer = insightface.app.FaceAnalysis(
        name='buffalo_l',
        root=str(Path.home() / '.insightface'),
        providers=['CPUExecutionProvider'],
    )
    analyzer.prepare(ctx_id=-1, det_size=(640, 640))
    target_bbox_hint = None
    if args.target_bbox:
        target_bbox_hint = tuple(float(value) for value in args.target_bbox.split(','))
        if len(target_bbox_hint) != 4 or target_bbox_hint[2] <= target_bbox_hint[0] or target_bbox_hint[3] <= target_bbox_hint[1]:
            raise RuntimeError('--target-bbox must contain four ordered numbers: left,top,right,bottom')
    output, edit_mask, report = restore(
        source,
        composite,
        analyzer,
        relight=not args.no_relight,
        target_bbox_hint=target_bbox_hint,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(args.output), output):
        raise RuntimeError(f'Could not write protected composite: {args.output}')
    if args.edit_mask is not None:
        args.edit_mask.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(args.edit_mask), edit_mask):
            raise RuntimeError(f'Could not write face edit mask: {args.edit_mask}')
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
