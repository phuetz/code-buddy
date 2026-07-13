import json
import os
import tempfile
import unittest
from pathlib import Path

from storage import append_rotating_jsonl, prune_frames


class PruneFramesTest(unittest.TestCase):
    def create_frame(self, directory: Path, name: str, modified: float) -> Path:
        path = directory / name
        path.write_bytes(b"jpeg")
        os.utime(path, (modified, modified))
        return path

    def test_removes_expired_frames_but_not_unrelated_files(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            expired = self.create_frame(directory, "cam-old.jpg", 100.0)
            current = self.create_frame(directory, "cam-current.jpg", 950.0)
            unrelated = self.create_frame(directory, "portrait.jpg", 100.0)

            removed = prune_frames(directory, keep=500, ttl=200.0, now=1_000.0)

            self.assertEqual(removed, [expired])
            self.assertFalse(expired.exists())
            self.assertTrue(current.exists())
            self.assertTrue(unrelated.exists())

    def test_keeps_only_the_newest_frames(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            frames = [self.create_frame(directory, f"cam-{index}.jpg", 900.0 + index) for index in range(5)]

            removed = prune_frames(directory, keep=2, ttl=1_000.0, now=1_000.0)

            self.assertEqual(set(removed), set(frames[:3]))
            self.assertEqual(
                {path.name for path in directory.glob("cam-*.jpg")},
                {"cam-3.jpg", "cam-4.jpg"},
            )


class RotatingJsonlTest(unittest.TestCase):
    def test_rotates_oversized_log_before_appending(self):
        with tempfile.TemporaryDirectory() as directory_name:
            log = Path(directory_name) / "events.jsonl"
            original = b"x" * (512 * 1024 + 1)
            log.write_bytes(original)

            append_rotating_jsonl(log, {"kind": "person_entered"})

            self.assertEqual(Path(f"{log}.1").read_bytes(), original)
            self.assertEqual(json.loads(log.read_text(encoding="utf-8")), {"kind": "person_entered"})

    def test_appends_without_rotation_below_limit(self):
        with tempfile.TemporaryDirectory() as directory_name:
            log = Path(directory_name) / "events.jsonl"

            append_rotating_jsonl(log, {"kind": "person_entered"}, max_bytes=512 * 1024)
            append_rotating_jsonl(log, {"kind": "person_left"}, max_bytes=512 * 1024)

            records = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(records, [{"kind": "person_entered"}, {"kind": "person_left"}])
            self.assertFalse(Path(f"{log}.1").exists())


if __name__ == "__main__":
    unittest.main()
