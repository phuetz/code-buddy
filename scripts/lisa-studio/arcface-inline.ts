export const PYTHON_JSON_MARKER = 'LISA_STUDIO_JSON=';

export const SCORE_KEYFRAMES_PYTHON = String.raw`
# lisa-studio-task: score-keyframes
import json
import sys
from pathlib import Path

import cv2
import insightface
import numpy as np

MARKER = "LISA_STUDIO_JSON="


def normalized(embedding):
    vector = np.asarray(embedding, dtype=np.float64)
    norm = np.linalg.norm(vector)
    return vector / norm if norm > 0 else np.zeros_like(vector)


def largest_face_embedding(analyzer, image_path):
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Impossible de décoder l'image: {image_path}")
    faces = analyzer.get(image)
    if not faces:
        return None
    face = max(
        faces,
        key=lambda item: float(
            (item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1])
        ),
    )
    embedding = getattr(face, "normed_embedding", None)
    return None if embedding is None else normalized(embedding)


def main():
    payload = json.loads(sys.argv[1])
    reference_path = Path(payload["reference"])
    candidate_paths = [Path(value) for value in payload["candidates"]]

    analyzer = insightface.app.FaceAnalysis(
        name="buffalo_l",
        root=str(Path.home() / ".insightface"),
        providers=["CPUExecutionProvider"],
    )
    analyzer.prepare(ctx_id=-1, det_size=(640, 640))

    reference = largest_face_embedding(analyzer, reference_path)
    if reference is None:
        raise RuntimeError(f"Aucun visage détecté dans la référence: {reference_path}")

    scores = []
    for candidate_path in candidate_paths:
        embedding = largest_face_embedding(analyzer, candidate_path)
        scores.append({
            "path": str(candidate_path.resolve()),
            "detected": embedding is not None,
            "arcface": (
                float(np.dot(embedding, reference)) if embedding is not None else None
            ),
        })

    print(MARKER + json.dumps({"scores": scores}, ensure_ascii=False))


if __name__ == "__main__":
    main()
`;

export const SCORE_VIDEO_PYTHON = String.raw`
# lisa-studio-task: score-video
import json
import sys
from pathlib import Path

import cv2
import insightface
import numpy as np

MARKER = "LISA_STUDIO_JSON="


def normalized(embedding):
    vector = np.asarray(embedding, dtype=np.float64)
    norm = np.linalg.norm(vector)
    return vector / norm if norm > 0 else np.zeros_like(vector)


def largest_face_embedding(analyzer, image, label):
    if image is None:
        raise RuntimeError(f"Frame vidéo indécodable: {label}")
    faces = analyzer.get(image)
    if not faces:
        raise RuntimeError(f"Aucun visage détecté dans la frame vidéo: {label}")
    face = max(
        faces,
        key=lambda item: float(
            (item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1])
        ),
    )
    embedding = getattr(face, "normed_embedding", None)
    if embedding is None:
        raise RuntimeError(f"Embedding ArcFace absent pour: {label}")
    return normalized(embedding)


def main():
    payload = json.loads(sys.argv[1])
    reference_path = Path(payload["reference"])
    video_path = Path(payload["video"])

    analyzer = insightface.app.FaceAnalysis(
        name="buffalo_l",
        root=str(Path.home() / ".insightface"),
        providers=["CPUExecutionProvider"],
    )
    analyzer.prepare(ctx_id=-1, det_size=(640, 640))

    reference_image = cv2.imread(str(reference_path), cv2.IMREAD_COLOR)
    reference = largest_face_embedding(analyzer, reference_image, str(reference_path))

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Impossible d'ouvrir le clip: {video_path}")
    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        if frame_count < 3 or not np.isfinite(fps) or fps <= 0:
            raise RuntimeError(
                f"Clip invalide pour le QC: {frame_count} frames à {fps} fps"
            )

        positions = [
            ("debut", 0),
            ("milieu", frame_count // 2),
            ("fin", frame_count - 1),
        ]
        scores = []
        for position, frame_index in positions:
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = capture.read()
            if not ok:
                raise RuntimeError(
                    f"Impossible de décoder la frame {position} (index {frame_index})"
                )
            embedding = largest_face_embedding(
                analyzer,
                frame,
                f"{position} (index {frame_index})",
            )
            scores.append({
                "position": position,
                "frameIndex": frame_index,
                "timestampSeconds": float(frame_index / fps),
                "arcface": float(np.dot(embedding, reference)),
            })
    finally:
        capture.release()

    print(MARKER + json.dumps({
        "frameCount": frame_count,
        "fps": fps,
        "durationSeconds": float(frame_count / fps),
        "scores": scores,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
`;
