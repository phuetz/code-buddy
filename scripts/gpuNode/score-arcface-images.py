#!/usr/bin/env python3
"""Score still images against one identity reference with buffalo_l ArcFace."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import insightface
import numpy as np


def largest_face(app: object, image_path: Path) -> object | None:
    image = cv2.imread(str(image_path))
    if image is None:
        raise RuntimeError(f"Could not read image: {image_path}")
    faces = app.get(image)
    if not faces:
        return None
    return max(
        faces,
        key=lambda face: float(
            (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1])
        ),
    )


def normalized(embedding: np.ndarray) -> np.ndarray:
    vector = np.asarray(embedding, dtype=np.float64)
    norm = np.linalg.norm(vector)
    return vector / norm if norm > 0 else np.zeros_like(vector)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("images", nargs="+", type=Path)
    args = parser.parse_args()

    app = insightface.app.FaceAnalysis(
        name="buffalo_l",
        root=str(Path.home() / ".insightface"),
        providers=["CPUExecutionProvider"],
    )
    app.prepare(ctx_id=-1, det_size=(640, 640))
    reference_face = largest_face(app, args.reference)
    if reference_face is None:
        raise RuntimeError(f"No reference face detected: {args.reference}")
    reference = normalized(reference_face.normed_embedding)

    results = []
    for image_path in args.images:
        face = largest_face(app, image_path)
        results.append(
            {
                "path": str(image_path.resolve()),
                "detected": face is not None,
                "arcface": (
                    float(np.dot(normalized(face.normed_embedding), reference))
                    if face is not None
                    else None
                ),
            }
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
