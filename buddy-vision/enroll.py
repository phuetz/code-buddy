#!/usr/bin/env python3
"""Enroll local face embeddings for buddy-vision identity recognition."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile
import time

import cv2

from identity import (
    DEFAULT_IDENTITIES_PATH,
    InsightFaceEmbedder,
    load_embedding_store,
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def valid_name(raw: str) -> str:
    name = raw.strip()
    has_control = any(
        ord(character) < 32
        or 127 <= ord(character) <= 159
        or character in ("\u2028", "\u2029")
        for character in name
    )
    if not name or len(name) > 100 or has_control:
        raise ValueError("--name must be non-empty, contain no controls, and be <= 100 chars")
    return name


def write_embedding_store(path: str, store: dict[str, list[list[float]]]) -> None:
    target = os.path.abspath(os.path.expanduser(path))
    directory = os.path.dirname(target)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    descriptor, temporary = tempfile.mkstemp(
        prefix=".embeddings-",
        suffix=".json",
        dir=directory,
        text=True,
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(store, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def image_inputs(directory: str):
    root = Path(directory).expanduser()
    if not root.is_dir():
        raise ValueError(f"--images is not a directory: {root}")
    for path in sorted(root.iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            yield path, cv2.imread(str(path))


def camera_inputs(index: int, frames: int, delay: float):
    capture = cv2.VideoCapture(index)
    if not capture.isOpened():
        raise RuntimeError(f"cannot open camera index {index}")
    try:
        for number in range(1, frames + 1):
            ok, frame = capture.read()
            yield f"camera:{number}", frame if ok else None
            if delay > 0:
                time.sleep(delay)
    finally:
        capture.release()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract buffalo_l embeddings and keep them locally."
    )
    parser.add_argument("--name", required=True, help="identity name")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--images", help="directory of enrollment images")
    source.add_argument("--camera", type=int, help="camera index to capture")
    parser.add_argument(
        "--frames",
        type=int,
        default=20,
        help="camera frames to capture (default: 20)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.25,
        help="seconds between camera captures (default: 0.25)",
    )
    parser.add_argument(
        "--store",
        default=DEFAULT_IDENTITIES_PATH,
        help=f"embedding store (default: {DEFAULT_IDENTITIES_PATH})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        name = valid_name(args.name)
        if args.frames < 1:
            raise ValueError("--frames must be positive")
        inputs = (
            image_inputs(args.images)
            if args.images
            else camera_inputs(args.camera, args.frames, max(0.0, args.delay))
        )
        embedder = InsightFaceEmbedder()
        accepted: list[list[float]] = []
        no_face = 0
        multiple_faces = 0
        unreadable = 0
        processed = 0
        for label, image in inputs:
            processed += 1
            if image is None:
                unreadable += 1
                print(f"[enroll] rejected {label}: unreadable frame")
                continue
            faces = embedder.extract_faces(image)
            if embedder.disabled:
                print("[enroll] InsightFace is unavailable; nothing was written")
                return 2
            if len(faces) == 0:
                no_face += 1
                print(f"[enroll] rejected {label}: no face")
            elif len(faces) > 1:
                multiple_faces += 1
                print(f"[enroll] rejected {label}: {len(faces)} faces (need exactly one)")
            else:
                accepted.append(faces[0])
                print(f"[enroll] accepted {label}: one face")
        rejected = no_face + multiple_faces + unreadable
        print(
            f"[enroll] quality: processed={processed} accepted={len(accepted)} "
            f"rejected={rejected} no_face={no_face} "
            f"multiple_faces={multiple_faces} unreadable={unreadable}"
        )
        if not accepted:
            print("[enroll] no usable embedding; existing store was not changed")
            return 1
        store = load_embedding_store(args.store)
        store.setdefault(name, []).extend(accepted)
        write_embedding_store(args.store, store)
        print(
            f"[enroll] saved {len(accepted)} embedding(s) for {name!r}; "
            f"total={len(store[name])} → {os.path.expanduser(args.store)}"
        )
        print("[enroll] no source image was copied or stored")
        return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"[enroll] error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
