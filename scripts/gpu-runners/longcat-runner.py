#!/usr/bin/env python3
"""Validated Code Buddy adapter for isolated LongCat Avatar 1.5 inference."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
from typing import Any


RUNNER_VERSION = "2"
UPSTREAM_COMMIT = "6b3f4b8582a8bc3f20f795735f5383716c4ba794"
AVATAR_REVISION = "92016c71d5d318d0f5d84e4db30015a571484ab6"
BASE_REVISION = "03b55529b1d1d4045f5fbe14d65c8c6e8116b278"
TURN_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
ALLOWED_AUDIO_SUFFIXES = {".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"}
ALLOWED_IMAGE_SUFFIXES = {".jpeg", ".jpg", ".png", ".webp"}


class RunnerError(RuntimeError):
    pass


def progress(value: float, message: str) -> None:
    print(f"CODEBUDDY_PROGRESS {value:.2f} {message}", flush=True)


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RunnerError(f"{label} must be an object")
    return value


def require_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RunnerError(f"{label} is required")
    result = value.strip()
    if len(result) > maximum:
        raise RunnerError(f"{label} is too long")
    if any(ord(character) <= 31 or ord(character) == 127 for character in result):
        raise RunnerError(f"{label} contains control characters")
    return result


def to_wsl_path(value: str) -> Path:
    if value.startswith("/"):
        return Path(value).resolve(strict=True)
    if not re.match(r"^[A-Za-z]:[\\/]", value):
        raise RunnerError(f"Expected an absolute Windows or WSL path: {value}")
    converted = subprocess.run(
        ["wslpath", "-u", value],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    return Path(converted).resolve(strict=True)


def require_media(path: Path, suffixes: set[str], label: str) -> None:
    if not path.is_file():
        raise RunnerError(f"{label} is not a file: {path}")
    if path.suffix.lower() not in suffixes:
        raise RunnerError(f"{label} has an unsupported extension: {path.suffix}")
    size = path.stat().st_size
    if size <= 0 or size > 512 * 1024 * 1024:
        raise RunnerError(f"{label} size is outside the 1 byte–512 MiB limit")


def probe_duration(audio_path: Path) -> float:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    duration = float(completed.stdout.strip())
    if not 0.1 <= duration <= 30 * 60:
        raise RunnerError("audio duration must be between 0.1 seconds and 30 minutes")
    return duration


def read_gpu_temperature() -> int:
    """Read the physical GPU selected for this one-process LongCat runner."""
    visible = os.environ.get("CUDA_VISIBLE_DEVICES", "0").split(",", maxsplit=1)[0].strip()
    if not visible:
        visible = "0"
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                f"--id={visible}",
                "--query-gpu=temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return int(completed.stdout.strip().splitlines()[0])
    except (FileNotFoundError, IndexError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise RunnerError("LongCat thermal guard cannot read the selected GPU temperature") from error


def configured_thermal_limit() -> int:
    raw = os.environ.get("CODEBUDDY_GPU_MAX_TEMP_C", "88").strip()
    try:
        limit = int(raw)
    except ValueError as error:
        raise RunnerError("CODEBUDDY_GPU_MAX_TEMP_C must be an integer") from error
    if not 70 <= limit <= 92:
        raise RunnerError("CODEBUDDY_GPU_MAX_TEMP_C must be between 70 and 92")
    return limit


def stream_inference(
    command: list[str],
    *,
    temperature_reader: Any = read_gpu_temperature,
    thermal_limit_c: int | None = None,
    thermal_poll_seconds: float = 3.0,
) -> None:
    limit = configured_thermal_limit() if thermal_limit_c is None else thermal_limit_c
    initial_temperature = temperature_reader()
    if initial_temperature >= limit:
        raise RunnerError(
            f"LongCat thermal guard refused startup: GPU is {initial_temperature} C (limit {limit} C)"
        )
    child = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
    )
    assert child.stdout is not None
    cancellation_reason: str | None = None
    forced_kill: threading.Timer | None = None
    stop_watchdog = threading.Event()
    cancellation_lock = threading.Lock()

    def kill_process_group(sig: signal.Signals) -> None:
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass

    def request_stop(reason: str, forwarded: signal.Signals = signal.SIGTERM) -> None:
        nonlocal cancellation_reason, forced_kill
        with cancellation_lock:
            if cancellation_reason is not None:
                return
            cancellation_reason = reason
            kill_process_group(forwarded)
            forced_kill = threading.Timer(10.0, kill_process_group, args=(signal.SIGKILL,))
            forced_kill.daemon = True
            forced_kill.start()

    def forward_signal(signum: int, _frame: Any) -> None:
        request_stop("LongCat inference was cancelled", signal.Signals(signum))

    def watch_temperature() -> None:
        consecutive_hot_samples = 0
        while not stop_watchdog.wait(thermal_poll_seconds):
            try:
                temperature = temperature_reader()
            except Exception as error:  # noqa: BLE001 - hardware safety boundary
                request_stop(f"LongCat thermal guard failed closed: {error}")
                return
            if temperature >= limit:
                consecutive_hot_samples += 1
                print(
                    f"LONGCAT_THERMAL GPU {temperature} C, limit {limit} C "
                    f"({consecutive_hot_samples}/2)",
                    file=sys.stderr,
                    flush=True,
                )
                if consecutive_hot_samples >= 2:
                    request_stop(
                        f"LongCat thermal guard stopped inference at {temperature} C "
                        f"(limit {limit} C)"
                    )
                    return
            else:
                consecutive_hot_samples = 0

    previous_sigterm = signal.signal(signal.SIGTERM, forward_signal)
    previous_sigint = signal.signal(signal.SIGINT, forward_signal)
    watchdog = threading.Thread(target=watch_temperature, name="longcat-thermal-guard", daemon=True)
    watchdog.start()
    phase_progress = {
        "LONGCAT_PHASE text": (0.12, "encoding prompt"),
        "LONGCAT_PHASE audio": (0.28, "encoding audio"),
        "LONGCAT_PHASE model": (0.45, "loading INT8 avatar model"),
        "LONGCAT_PHASE optimize": (0.55, "optimizing INT8 kernels"),
        "LONGCAT_PHASE compile": (0.65, "compiling avatar model"),
        "LONGCAT_PHASE render": (0.72, "rendering avatar video"),
        "LONGCAT_PHASE encode": (0.94, "encoding MP4"),
    }
    try:
        for line in child.stdout:
            print(line, end="", flush=True)
            stripped = line.strip()
            if stripped in phase_progress:
                value, message = phase_progress[stripped]
                progress(value, message)
        return_code = child.wait()
    finally:
        stop_watchdog.set()
        watchdog.join(timeout=max(thermal_poll_seconds * 2, 1.0))
        if forced_kill is not None:
            forced_kill.cancel()
        signal.signal(signal.SIGTERM, previous_sigterm)
        signal.signal(signal.SIGINT, previous_sigint)
    if cancellation_reason is not None:
        raise RunnerError(cancellation_reason)
    if return_code != 0:
        raise RunnerError(f"LongCat inference exited with code {return_code}")


def verify_upstream(repo: Path) -> None:
    try:
        head = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        ).stdout.strip()
        if head != UPSTREAM_COMMIT:
            raise RunnerError(f"LongCat upstream commit is {head}, expected {UPSTREAM_COMMIT}")
        status = subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "status",
                "--porcelain=v1",
                "--untracked-files=all",
                "--",
                "longcat_video",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        ).stdout
        if status.strip():
            raise RunnerError("LongCat source differs from the pinned commit")
    except subprocess.TimeoutExpired as error:
        raise RunnerError("timed out while verifying the LongCat source") from error
    except FileNotFoundError as error:
        raise RunnerError("git is required to verify the LongCat source") from error
    except subprocess.CalledProcessError as error:
        raise RunnerError("failed to verify the LongCat source repository") from error


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    if len(sys.argv) != 2:
        raise RunnerError("exactly one request path is required")
    request_path = Path(sys.argv[1]).resolve(strict=True)
    request = require_object(json.loads(request_path.read_text(encoding="utf-8")), "request")
    if request.get("kind") != "avatar_video_render":
        raise RunnerError("request kind must be avatar_video_render")
    job_id = require_text(request.get("id"), "id", 128)
    payload = require_object(request.get("payload"), "payload")
    turn_id = require_text(payload.get("turnId"), "turnId", 128)
    if not TURN_ID_PATTERN.fullmatch(turn_id):
        raise RunnerError("turnId contains unsupported characters")
    if payload.get("resolution") != "480p":
        raise RunnerError("only the measured 480p profile is enabled")
    prompt_text = require_text(payload.get("prompt"), "prompt", 8_000)
    audio_path = to_wsl_path(require_text(payload.get("audioPath"), "audioPath", 4_096))
    image_path = to_wsl_path(
        require_text(payload.get("referenceImagePath"), "referenceImagePath", 4_096)
    )
    require_media(audio_path, ALLOWED_AUDIO_SUFFIXES, "audioPath")
    require_media(image_path, ALLOWED_IMAGE_SUFFIXES, "referenceImagePath")

    result_env = os.environ.get("CODEBUDDY_GPU_JOB_RESULT")
    if not result_env:
        raise RunnerError("CODEBUDDY_GPU_JOB_RESULT is required")
    result_path = Path(result_env).resolve()
    if result_path.parent != request_path.parent:
        raise RunnerError("result path must share the worker job directory")

    longcat_repo = Path(
        os.environ.get(
            "CODEBUDDY_LONGCAT_REPO",
            str(Path.home() / ".local" / "share" / "codebuddy" / "LongCat-Video"),
        )
    )
    weights_root = Path(
        os.environ.get(
            "CODEBUDDY_LONGCAT_WEIGHTS_ROOT",
            "/mnt/d/DEV/LongCat-Video/weights",
        )
    )
    avatar_checkpoint = weights_root / "LongCat-Video-Avatar-1.5"
    readiness_path = weights_root / "codebuddy-longcat-avatar-1.5.json"
    inference_script = Path(__file__).with_name("longcat-lowmem-inference.py")
    torchrun = Path(sys.executable).with_name("torchrun")
    for required in (
        longcat_repo / "longcat_video",
        avatar_checkpoint / "base_model_int8" / "quantized_model.safetensors.index.json",
        weights_root / "LongCat-Video" / "text_encoder" / "model.safetensors.index.json",
        inference_script,
        torchrun,
        readiness_path,
    ):
        if not required.exists():
            raise RunnerError(f"required LongCat component is unavailable: {required}")
    verify_upstream(longcat_repo)
    readiness = require_object(
        json.loads(readiness_path.read_text(encoding="utf-8")), "checkpoint readiness manifest"
    )
    if (
        readiness.get("avatarRevision") != AVATAR_REVISION
        or readiness.get("baseRevision") != BASE_REVISION
        or readiness.get("selectedBytes") != 44_747_926_126
    ):
        raise RunnerError("LongCat checkpoint readiness manifest does not match the pinned set")

    duration_seconds = probe_duration(audio_path)
    output_dir = request_path.parent / "artifacts"
    output_dir.mkdir(mode=0o700, exist_ok=True)
    input_path = request_path.parent / "longcat-input.json"
    atomic_json(
        input_path,
        {
            "prompt": prompt_text,
            "cond_image": str(image_path),
            "cond_audio": {"person1": str(audio_path)},
        },
    )

    progress(0.05, "validated LongCat request")
    started = time.monotonic()
    stream_inference(
        [
            str(torchrun),
            "--standalone",
            "--nnodes=1",
            "--nproc-per-node=1",
            str(inference_script),
            "--input-json",
            str(input_path),
            "--output-dir",
            str(output_dir),
            "--checkpoint-dir",
            str(avatar_checkpoint),
        ]
    )
    video_path = output_dir / "avatar.mp4"
    if not video_path.is_file() or video_path.stat().st_size <= 0:
        raise RunnerError("LongCat completed without a non-empty avatar.mp4")
    elapsed_seconds = time.monotonic() - started
    rendered_duration = min(duration_seconds, 93 / 25)
    output = {
        "jobId": job_id,
        "turnId": turn_id,
        "videoPath": str(video_path),
        "sourceAudioDurationSeconds": round(duration_seconds, 3),
        "durationSeconds": round(rendered_duration, 3),
        "audioTruncated": duration_seconds > rendered_duration + 0.01,
        "renderingSeconds": round(elapsed_seconds, 3),
        "resolution": "480p",
        "frames": 93,
        "fps": 25,
        "runnerVersion": RUNNER_VERSION,
        "upstreamCommit": UPSTREAM_COMMIT,
    }
    channel_target = payload.get("channelTarget")
    if isinstance(channel_target, dict):
        output["channelTarget"] = channel_target
    atomic_json(result_path, output)
    progress(0.99, "finalizing avatar manifest")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - bounded runner boundary
        print(f"LongCat runner error: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from None
