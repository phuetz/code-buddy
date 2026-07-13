#!/usr/bin/env python3
"""Robot eyes — semantic vision sidecar (the eye that UNDERSTANDS, not just moves).

Owns one camera and feeds semantic state machines — each emits an event only on a
TRANSITION (never per-frame → no spam, the Vigil pattern):
  • person : person present/absent → person_entered / person_left (absence grace)
             backend: MediaPipe face detector, or optional YOLOv8 person detector
  • drowsy : MediaPipe eyeBlink blendshape closed ≥ N s → drowsy (Vigil)
A cheap motion gate (frame-diff) skips inference when nothing moves.

Events go to Code Buddy's sensory bridge (ws://127.0.0.1:8129) as SensoryEvents
AND to ~/.codebuddy/companion/events.jsonl (audit/stats). 100% local, $0.
"""
import json
import os
import sys
import time

import cv2
import numpy as np

from storage import append_rotating_jsonl, prune_frames

BRIDGE_URL = os.environ.get("BUDDY_SENSE_BRIDGE_URL", "ws://127.0.0.1:8129")
TOKEN = os.environ.get("BUDDY_SENSE_TOKEN", "")
CAMERA_INDEX = int(os.environ.get("BUDDY_SENSE_CAMERA_INDEX", "0"))
CAMERA_NAME = os.environ.get("BUDDY_VISION_CAMERA_NAME", "brio")
FRAME_DIR = os.path.expanduser(os.environ.get("BUDDY_SENSE_FRAME_DIR", "~/.codebuddy/companion"))
EVENTS_LOG = os.path.join(FRAME_DIR, "events.jsonl")
MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_landmarker.task")
FPS = float(os.environ.get("BUDDY_VISION_FPS", "4"))
MOTION_THRESH = float(os.environ.get("BUDDY_VISION_MOTION", "0.02"))
PERSON_BACKEND = os.environ.get("BUDDY_VISION_PERSON_BACKEND", "mediapipe").strip().lower()
YOLO_MODEL = os.environ.get("BUDDY_VISION_YOLO_MODEL", "").strip()
YOLO_CONF = float(os.environ.get("BUDDY_VISION_YOLO_CONF", "0.35"))
YOLO_IOU = float(os.environ.get("BUDDY_VISION_YOLO_IOU", "0.7"))
YOLO_DEVICE = os.environ.get("BUDDY_VISION_YOLO_DEVICE", "").strip()
YOLO_CLASSES = os.environ.get("BUDDY_VISION_YOLO_CLASSES", "0")
FRAME_TTL = float(os.environ.get("BUDDY_SENSE_FRAME_TTL", str(7 * 24 * 60 * 60)))
FRAME_KEEP = 500
os.makedirs(FRAME_DIR, exist_ok=True)


def now_ms() -> int:
    return int(time.time() * 1000)


class Bridge:
    """Reconnecting WebSocket client to the Code Buddy sensory bridge."""

    def __init__(self, url: str, token: str):
        self.url, self.token, self.ws = url, token, None
        self.websocket_missing = False

    def connect(self) -> None:
        if self.websocket_missing:
            return
        try:
            import websocket  # websocket-client
            # suppress_origin: the bridge rejects connections carrying an Origin
            # header (anti-CSWSH) — we must not send one.
            self.ws = websocket.create_connection(self.url, timeout=5, suppress_origin=True)
            print(f"[vision] bridge connected → {self.url}", flush=True)
        except ModuleNotFoundError:
            self.websocket_missing = True
            self.ws = None
            print("[vision] missing websocket-client — install it to emit events to Code Buddy", file=sys.stderr)
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
        append_rotating_jsonl(EVENTS_LOG, rec)
    except Exception:
        pass


def save_keyframe(frame) -> str | None:
    path = os.path.join(FRAME_DIR, f"cam-{now_ms()}.jpg")
    try:
        if not cv2.imwrite(path, frame):
            return None
    except Exception:
        return None
    try:
        prune_frames(FRAME_DIR, FRAME_KEEP, FRAME_TTL)
    except Exception:
        pass
    return path


class VisionSample:
    def __init__(self, present: bool, eye_closed=None, evidence=None):
        self.present = present
        self.eye_closed = eye_closed
        self.evidence = evidence or {}


class MediaPipeFaceDetector:
    """MediaPipe face presence + eye-blink evidence for person/drowsy detectors."""

    def __init__(self, model_path: str):
        if not os.path.exists(model_path):
            print(f"[vision] missing model {model_path} — download face_landmarker.task", file=sys.stderr)
            sys.exit(1)
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        self.mp = mp
        opts = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            output_face_blendshapes=True,
            num_faces=1,
            running_mode=mp_vision.RunningMode.IMAGE,
        )
        self.landmarker = mp_vision.FaceLandmarker.create_from_options(opts)

    def detect(self, frame) -> VisionSample:
        rgb = np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        result = self.landmarker.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb))
        face_present = len(result.face_landmarks) > 0
        eye_closed = None
        if face_present and result.face_blendshapes:
            bs = {c.category_name: c.score for c in result.face_blendshapes[0]}
            eye_closed = (bs.get("eyeBlinkLeft", 0.0) + bs.get("eyeBlinkRight", 0.0)) / 2.0
        evidence = {"detector": "mediapipe_face"}
        if eye_closed is not None:
            evidence["eyeClosed"] = round(float(eye_closed), 4)
        return VisionSample(face_present, eye_closed, evidence)


class YoloPersonDetector:
    """YOLOv8 person detector. Intended for robust full-body presence sensing."""

    def __init__(self, model_path: str):
        if not model_path:
            print("[vision] BUDDY_VISION_PERSON_BACKEND=yolo requires BUDDY_VISION_YOLO_MODEL or ~/vision_tests/yolov8n.onnx", file=sys.stderr)
            sys.exit(1)
        try:
            from ultralytics import YOLO
        except Exception as exc:
            print(f"[vision] ultralytics unavailable for YOLO backend: {exc}", file=sys.stderr)
            print("[vision] install with: BUDDY_VISION_INSTALL_YOLO=1 ./setup.sh", file=sys.stderr)
            sys.exit(1)
        self.model_path = model_path
        self.model = YOLO(model_path, task="detect")
        self.classes = parse_yolo_classes(YOLO_CLASSES)

    def detect(self, frame) -> VisionSample:
        kwargs = {
            "source": frame,
            "classes": self.classes,
            "conf": YOLO_CONF,
            "iou": YOLO_IOU,
            "verbose": False,
        }
        if YOLO_DEVICE:
            kwargs["device"] = YOLO_DEVICE
        result = self.model.predict(**kwargs)[0]
        best = None
        if result.boxes is not None:
            for item in result.boxes:
                conf = float(item.conf[0].item())
                if best is None or conf > best["confidence"]:
                    xyxy = [float(v) for v in item.xyxy[0].tolist()]
                    best = {
                        "confidence": conf,
                        "box": {
                            "x1": round(xyxy[0], 2),
                            "y1": round(xyxy[1], 2),
                            "x2": round(xyxy[2], 2),
                            "y2": round(xyxy[3], 2),
                        },
                    }
        evidence = {
            "detector": "yolov8",
            "model": self.model_path,
            "confidence": round(best["confidence"], 4) if best else 0.0,
        }
        if best:
            evidence["box"] = best["box"]
        return VisionSample(best is not None, None, evidence)


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


def parse_enabled_detectors() -> set[str]:
    return {
        item.strip().lower()
        for item in os.environ.get("BUDDY_VISION_DETECTORS", "person,drowsy").split(",")
        if item.strip()
    }


def parse_yolo_classes(value: str) -> list[int]:
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


def resolve_yolo_model() -> str:
    if YOLO_MODEL:
        return os.path.abspath(os.path.expanduser(YOLO_MODEL))
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.expanduser("~/vision_tests/yolov8n.onnx"),
        os.path.expanduser("~/vision_tests/yolov8n.pt"),
        os.path.join(here, "models", "yolov8n.onnx"),
        os.path.join(here, "models", "yolov8n.pt"),
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return ""


def create_detectors(enabled: set[str]):
    person_enabled = "person" in enabled
    drowsy_enabled = "drowsy" in enabled
    if not person_enabled and not drowsy_enabled:
        print(f"[vision] no supported detectors enabled: {sorted(enabled)}", file=sys.stderr)
        sys.exit(1)

    backend = PERSON_BACKEND
    if backend in ("face", "mediapipe_face"):
        backend = "mediapipe"
    if backend not in ("mediapipe", "yolo"):
        print(f"[vision] invalid BUDDY_VISION_PERSON_BACKEND={PERSON_BACKEND}; use mediapipe or yolo", file=sys.stderr)
        sys.exit(1)

    face_detector = None
    person_detector = None
    if drowsy_enabled or (person_enabled and backend == "mediapipe"):
        face_detector = MediaPipeFaceDetector(MODEL)
    if person_enabled:
        person_detector = YoloPersonDetector(resolve_yolo_model()) if backend == "yolo" else face_detector
    return backend, person_detector, face_detector


def main() -> None:
    bridge = Bridge(BRIDGE_URL, TOKEN)
    bridge.connect()
    enabled = parse_enabled_detectors()
    person = PersonState() if "person" in enabled else None
    drowsy = DrowsyState() if "drowsy" in enabled else None
    backend, person_detector, face_detector = create_detectors(enabled)

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"[vision] cannot open camera index {CAMERA_INDEX}", file=sys.stderr)
        sys.exit(1)
    print(f"[vision] watching camera {CAMERA_INDEX} ({CAMERA_NAME}); detectors={sorted(enabled)} person_backend={backend}", flush=True)

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
            face_sample = face_detector.detect(frame) if face_detector else None
            if person_detector is None:
                person_sample = VisionSample(False)
            elif person_detector is face_detector:
                person_sample = face_sample or VisionSample(False)
            else:
                person_sample = person_detector.detect(frame)

            transitions = []
            if person:
                t = person.update(person_sample.present)
                if t:
                    transitions.append((t[0], t[1], person_sample.evidence))
            if drowsy:
                eye_closed = face_sample.eye_closed if face_sample and face_sample.present else None
                t = drowsy.update(eye_closed)
                if t:
                    transitions.append((t[0], t[1], face_sample.evidence if face_sample else {"detector": "mediapipe_face"}))
            for kind, salience, evidence in transitions:
                keyframe = save_keyframe(frame)
                payload = {"camera": CAMERA_NAME, "imagePath": keyframe, **evidence}
                bridge.emit(kind, salience, payload)
                log_event({"ts_ms": now_ms(), "kind": kind, **payload})
                print(f"[vision] event {kind} → bridge", flush=True)
        dt = time.time() - t0
        if dt < interval:
            time.sleep(interval - dt)


if __name__ == "__main__":
    main()
