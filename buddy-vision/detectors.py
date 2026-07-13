"""Pure state machines and parsing helpers for the semantic vision sidecar.

This module deliberately has no OpenCV or MediaPipe dependency so its detector
logic can be exercised without camera hardware or native vision packages.
"""

import os
import sys
import time
from collections.abc import Callable


class PersonState:
    """Face present/absent -> person_entered / person_left (absence grace)."""

    def __init__(self, grace: int | None = None):
        self.present = False
        self.absent = 0
        self.grace = grace if grace is not None else int(os.environ.get("BUDDY_VISION_PERSON_GRACE", "8"))

    def update(self, face_present: bool) -> tuple[str, int] | None:
        if face_present:
            self.absent = 0
            if not self.present:
                self.present = True
                return ("person_entered", 200)
        elif self.present:
            self.absent += 1
            if self.absent >= self.grace:
                self.present = False
                return ("person_left", 120)
        return None


class DrowsyState:
    """Emit drowsy once after closed eyes persist, then re-arm on reopening."""

    def __init__(
        self,
        thresh: float | None = None,
        secs: float | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.thresh = thresh if thresh is not None else float(os.environ.get("BUDDY_VISION_BLINK", "0.5"))
        self.secs = secs if secs is not None else float(os.environ.get("BUDDY_VISION_DROWSY_SECS", "2.0"))
        self.clock = clock
        self.closed_since: float | None = None
        self.drowsy = False

    def update(self, eye_closed: float | None) -> tuple[str, int] | None:
        if eye_closed is None:
            self.closed_since = None
            self.drowsy = False
            return None
        if eye_closed >= self.thresh:
            if self.closed_since is None:
                self.closed_since = self.clock()
            elif not self.drowsy and (self.clock() - self.closed_since) >= self.secs:
                self.drowsy = True
                return ("drowsy", 230)
        else:
            self.closed_since = None
            self.drowsy = False
        return None


def parse_yolo_classes(value: str) -> list[int]:
    """Parse comma-separated COCO class ids, defaulting to person (class 0)."""

    classes = []
    for raw in value.split(","):
        token = raw.strip()
        if not token:
            continue
        if not token.isdigit():
            print(f"[vision] ignoring non-numeric YOLO class '{token}' (use COCO ids; person=0)", file=sys.stderr)
            continue
        classes.append(int(token))
    return classes or [0]
