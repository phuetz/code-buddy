"""Bounded local storage helpers for the semantic vision sidecar."""

import json
import os
import time
from pathlib import Path


def prune_frames(
    directory: str | os.PathLike[str],
    keep: int,
    ttl: float,
    *,
    now: float | None = None,
) -> list[Path]:
    """Delete expired ``cam-*.jpg`` files and cap retained frames by recency.

    ``ttl`` is expressed in seconds. The returned paths are the files removed,
    which keeps the filesystem policy straightforward to verify in tests.
    """

    root = Path(directory)
    if not root.is_dir():
        return []

    cutoff = (time.time() if now is None else now) - max(ttl, 0.0)
    frames: list[tuple[float, Path]] = []
    for path in root.glob("cam-*.jpg"):
        try:
            if path.is_file():
                frames.append((path.stat().st_mtime, path))
        except FileNotFoundError:
            continue

    frames.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    removed: list[Path] = []
    for index, (modified, path) in enumerate(frames):
        if index < max(keep, 0) and modified >= cutoff:
            continue
        try:
            path.unlink()
            removed.append(path)
        except FileNotFoundError:
            continue
    return removed


def append_rotating_jsonl(
    path: str | os.PathLike[str],
    record: dict,
    max_bytes: int = 512 * 1024,
) -> None:
    """Rotate one backup when ``path`` exceeds ``max_bytes``, then append."""

    target = Path(path)
    try:
        if target.stat().st_size > max_bytes:
            os.replace(target, Path(f"{target}.1"))
    except FileNotFoundError:
        pass

    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
