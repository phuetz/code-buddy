#!/usr/bin/env python3
"""
Cowork voice → text bridge worker.

Reads JSON requests from stdin, writes JSON responses to stdout.

Request:  {"id": "<id>", "path": "/tmp/audio.webm", "language": "fr"}
Response: {"id": "<id>", "ok": true, "text": "...", "duration": 1.23}
       or {"id": "<id>", "ok": false, "error": "..."}

The model is loaded once at startup so per-request latency is just the
transcription itself (~0.3 s for a 5-second clip on int8 CPU).
"""
from __future__ import annotations

import json
import os
import sys
import time

try:
    from faster_whisper import WhisperModel
except Exception as exc:  # noqa: BLE001
    print(
        json.dumps({"id": "boot", "ok": False, "error": f"faster_whisper import failed: {exc}"}),
        flush=True,
    )
    sys.exit(1)


def main() -> None:
    model_size = os.environ.get("COWORK_WHISPER_MODEL", "base")
    compute_type = os.environ.get("COWORK_WHISPER_COMPUTE", "int8")
    device = os.environ.get("COWORK_WHISPER_DEVICE", "cpu")

    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
    except Exception as exc:  # noqa: BLE001
        print(
            json.dumps({"id": "boot", "ok": False, "error": f"model load failed: {exc}"}),
            flush=True,
        )
        sys.exit(1)

    # Signal readiness so the bridge can fail fast on boot errors.
    print(json.dumps({"id": "boot", "ok": True, "model": model_size, "device": device}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            print(json.dumps({"id": "?", "ok": False, "error": f"bad JSON: {exc}"}), flush=True)
            continue

        req_id = req.get("id", "?")
        path = req.get("path")
        language = req.get("language") or None

        if not isinstance(path, str) or not os.path.exists(path):
            print(
                json.dumps(
                    {"id": req_id, "ok": False, "error": f"audio path missing: {path}"}
                ),
                flush=True,
            )
            continue

        started = time.time()
        try:
            segments, _info = model.transcribe(
                path,
                language=language,
                vad_filter=True,
                beam_size=1,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            duration = round(time.time() - started, 3)
            print(
                json.dumps({"id": req_id, "ok": True, "text": text, "duration": duration}),
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001
            print(
                json.dumps({"id": req_id, "ok": False, "error": str(exc)}),
                flush=True,
            )


if __name__ == "__main__":
    main()
