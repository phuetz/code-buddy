#!/usr/bin/env python3
"""Robot eyes — semantic vision sidecar (the eye that UNDERSTANDS, not just moves).

Owns one camera, runs a single MediaPipe FaceLandmarker per frame and feeds TWO
state machines — each emits an event only on a TRANSITION (never per-frame → no
spam, the Vigil pattern):
  • person : face present/absent → person_entered / person_left (absence grace)
  • drowsy : eyeBlink blendshape closed ≥ N s → drowsy (Vigil "guardian angel")
A cheap motion gate (frame-diff) skips inference when nothing moves.

Events go to Code Buddy's sensory bridge (ws://127.0.0.1:8129) as SensoryEvents
AND to ~/.codebuddy/companion/events.jsonl (audit/stats). 100% local, $0.
"""
import json
import os
import sys
import time

import cv2
import mediapipe as mp
import numpy as np
import websocket  # websocket-client
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

BRIDGE_URL = os.environ.get("BUDDY_SENSE_BRIDGE_URL", "ws://127.0.0.1:8129")
TOKEN = os.environ.get("BUDDY_SENSE_TOKEN", "")
CAMERA_INDEX = int(os.environ.get("BUDDY_SENSE_CAMERA_INDEX", "0"))
CAMERA_NAME = os.environ.get("BUDDY_VISION_CAMERA_NAME", "brio")
FRAME_DIR = os.path.expanduser(os.environ.get("BUDDY_SENSE_FRAME_DIR", "~/.codebuddy/companion"))
EVENTS_LOG = os.path.join(FRAME_DIR, "events.jsonl")
MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_landmarker.task")
FPS = float(os.environ.get("BUDDY_VISION_FPS", "4"))
MOTION_THRESH = float(os.environ.get("BUDDY_VISION_MOTION", "0.02"))
os.makedirs(FRAME_DIR, exist_ok=True)


def now_ms() -> int:
    return int(time.time() * 1000)


class Bridge:
    """Reconnecting WebSocket client to the Code Buddy sensory bridge."""

    def __init__(self, url: str, token: str):
        self.url, self.token, self.ws = url, token, None

    def connect(self) -> None:
        try:
            # suppress_origin: the bridge rejects connections carrying an Origin
            # header (anti-CSWSH) — we must not send one.
            self.ws = websocket.create_connection(self.url, timeout=5, suppress_origin=True)
            print(f"[vision] bridge connected → {self.url}", flush=True)
        except Exception:
            self.ws = None

    def emit(self, kind: str, salience: int, payload: dict) -> None:
        frame = {"modality": "vision", "kind": kind, "ts_ms": now_ms(), "salience": salience, "payload": payload}
        if self.token:
            frame["token"] = self.token
        msg = json.dumps(frame)
        for _ in range(2):
            if self.ws is None:
                self.connect()
            try:
                self.ws.send(msg)
                return
            except Exception:
                self.ws = None


def log_event(rec: dict) -> None:
    try:
        with open(EVENTS_LOG, "a") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass


def save_keyframe(frame) -> str | None:
    path = os.path.join(FRAME_DIR, f"cam-{now_ms()}.jpg")
    try:
        cv2.imwrite(path, frame)
        return path
    except Exception:
        return None


class PersonState:
    """Face present/absent → person_entered / person_left (absence grace period)."""

    def __init__(self):
        self.present = False
        self.absent = 0
        self.grace = int(os.environ.get("BUDDY_VISION_PERSON_GRACE", "8"))

    def update(self, face_present: bool):
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
    """Vigil pattern: eyes closed (eyeBlink blendshape ≥ thresh) for `secs` → drowsy.
    Re-arms when the eyes reopen (hysteresis). `eye_closed` is 0..1 or None (no face)."""

    def __init__(self):
        self.thresh = float(os.environ.get("BUDDY_VISION_BLINK", "0.5"))
        self.secs = float(os.environ.get("BUDDY_VISION_DROWSY_SECS", "2.0"))
        self.closed_since = None
        self.drowsy = False

    def update(self, eye_closed):
        if eye_closed is None:
            self.closed_since = None
            self.drowsy = False
            return None
        if eye_closed >= self.thresh:
            if self.closed_since is None:
                self.closed_since = time.time()
            elif not self.drowsy and (time.time() - self.closed_since) >= self.secs:
                self.drowsy = True
                return ("drowsy", 230)
        else:
            self.closed_since = None
            self.drowsy = False
        return None


def motion_score(prev, gray) -> float:
    if prev is None or prev.shape != gray.shape:
        return 0.0
    return float(np.mean(cv2.absdiff(prev, gray))) / 255.0


def main() -> None:
    if not os.path.exists(MODEL):
        print(f"[vision] missing model {MODEL} — download face_landmarker.task", file=sys.stderr)
        sys.exit(1)
    bridge = Bridge(BRIDGE_URL, TOKEN)
    bridge.connect()
    enabled = os.environ.get("BUDDY_VISION_DETECTORS", "person,drowsy").split(",")
    person = PersonState() if "person" in enabled else None
    drowsy = DrowsyState() if "drowsy" in enabled else None

    opts = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=MODEL),
        output_face_blendshapes=True,
        num_faces=1,
        running_mode=mp_vision.RunningMode.IMAGE,
    )
    landmarker = mp_vision.FaceLandmarker.create_from_options(opts)

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"[vision] cannot open camera index {CAMERA_INDEX}", file=sys.stderr)
        sys.exit(1)
    print(f"[vision] watching camera {CAMERA_INDEX} ({CAMERA_NAME}); detectors={enabled}", flush=True)

    prev_gray = None
    interval = 1.0 / max(FPS, 0.5)
    while True:
        t0 = time.time()
        ok, frame = cap.read()
        if not ok:
            time.sleep(0.5)
            continue
        gray = cv2.cvtColor(cv2.resize(frame, (160, 120)), cv2.COLOR_BGR2GRAY)
        moved = motion_score(prev_gray, gray) >= MOTION_THRESH
        prev_gray = gray
        # Cheap gate: run inference on motion, or while a person is present (to
        # catch drowsiness even when they're sitting still).
        if moved or (person and person.present):
            rgb = np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
            face_present = len(result.face_landmarks) > 0
            eye_closed = None
            if face_present and result.face_blendshapes:
                bs = {c.category_name: c.score for c in result.face_blendshapes[0]}
                eye_closed = (bs.get("eyeBlinkLeft", 0.0) + bs.get("eyeBlinkRight", 0.0)) / 2.0

            transitions = []
            if person:
                t = person.update(face_present)
                if t:
                    transitions.append(t)
            if drowsy:
                t = drowsy.update(eye_closed if face_present else None)
                if t:
                    transitions.append(t)
            for kind, salience in transitions:
                keyframe = save_keyframe(frame)
                payload = {"camera": CAMERA_NAME, "imagePath": keyframe}
                bridge.emit(kind, salience, payload)
                log_event({"ts_ms": now_ms(), "kind": kind, **payload})
                print(f"[vision] event {kind} → bridge", flush=True)
        dt = time.time() - t0
        if dt < interval:
            time.sleep(interval - dt)


if __name__ == "__main__":
    main()
