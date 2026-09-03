#!/usr/bin/env python3
"""Pilote batch Grok Imagine (xAI), image et vidéo.

Usage: python3 grok_imagine.py jobs.json

Les vidéos acceptent ``image_path`` (encodé localement en data URI), ``ref_url``
ou ``ref_pexels``. La sortie est pilotée par ``GROK_IMAGINE_OUT``. Une sauvegarde
n'est faite que si ``GROK_IMAGINE_BACKUP`` est explicitement défini.

Le pilote saute tout résultat existant de plus de 50 Ko et arrête le lot au
premier 403 contenant ``personal-team-blocked:spending-limit``.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


API_ROOT = "https://api.x.ai"
AUTH = Path(os.path.expanduser("~/.codebuddy/xai-auth.json"))
CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
MIN_COMPLETE_BYTES = 50_000
QUOTA_SENTINEL = "personal-team-blocked:spending-limit"
SAFE_HEADER_MARKERS = ("rate", "limit", "quota", "remaining", "retry-after")


class ApiFailure(RuntimeError):
    """Erreur API épurée de toute donnée de compte ou URL signée."""

    def __init__(self, status: int | None, message: str):
        super().__init__(message)
        self.status = status


class QuotaExhausted(ApiFailure):
    """Le quota SuperGrok utilisable par cette identité est épuisé."""


def load_auth() -> dict[str, Any]:
    with AUTH.open(encoding="utf-8") as handle:
        return json.load(handle)


def token() -> str:
    return str(load_auth()["tokens"].get("access_token", ""))


def refresh() -> None:
    data = load_auth()
    body = urllib.parse.urlencode(
        {
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": data["tokens"]["refresh_token"],
        }
    ).encode()
    endpoint = data.get("discovery", {}).get(
        "token_endpoint", "https://auth.x.ai/oauth2/token"
    )
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        refreshed = json.load(response)
    data["tokens"]["access_token"] = refreshed["access_token"]
    if refreshed.get("refresh_token"):
        data["tokens"]["refresh_token"] = refreshed["refresh_token"]
    with AUTH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    print("  (jeton rafraîchi)", flush=True)


def safe_quota_headers(headers: Any) -> dict[str, str]:
    if headers is None:
        return {}
    return {
        key.lower(): str(value)
        for key, value in headers.items()
        if any(marker in key.lower() for marker in SAFE_HEADER_MARKERS)
    }


def safe_error_message(payload: Any, fallback: str) -> str:
    error = payload.get("error", payload) if isinstance(payload, dict) else payload
    if isinstance(error, dict):
        for key in ("message", "code", "type"):
            value = error.get(key)
            if value:
                return str(value)[:300]
    if isinstance(error, str):
        return error[:300]
    return fallback[:300]


def event_path(path: str) -> str:
    if path.startswith("/v1/videos/") and path != "/v1/videos/generations":
        return "/v1/videos/{request_id}"
    return path


def append_log(record: dict[str, Any]) -> None:
    log_path = os.environ.get("GROK_IMAGINE_LOG", "").strip()
    if not log_path:
        return
    destination = Path(os.path.expanduser(log_path))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def api(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    retry: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    started = time.monotonic()
    encoded = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        API_ROOT + path,
        data=encoded,
        method=method,
        headers={
            "Authorization": "Bearer " + token(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=80) as response:
            payload = json.load(response)
            meta = {
                "method": method,
                "path": event_path(path),
                "http": response.status,
                "elapsed_s": round(time.monotonic() - started, 3),
                "quota_headers": safe_quota_headers(response.headers),
            }
            append_log({"kind": "api", **meta})
            return payload, meta
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}
        message = safe_error_message(payload, raw or f"HTTP {error.code}")
        meta = {
            "method": method,
            "path": event_path(path),
            "http": error.code,
            "elapsed_s": round(time.monotonic() - started, 3),
            "quota_headers": safe_quota_headers(error.headers),
            "error": message,
        }
        append_log({"kind": "api", **meta})
        if error.code == 403 and QUOTA_SENTINEL in raw.lower():
            raise QuotaExhausted(error.code, QUOTA_SENTINEL) from None
        refresh_enabled = os.environ.get("GROK_IMAGINE_REFRESH", "1") != "0"
        if error.code in (401, 403) and retry and refresh_enabled:
            refresh()
            return api(method, path, body, retry=False)
        raise ApiFailure(error.code, message) from None
    except Exception as error:
        meta = {
            "method": method,
            "path": event_path(path),
            "http": None,
            "elapsed_s": round(time.monotonic() - started, 3),
            "quota_headers": {},
            "error": type(error).__name__,
        }
        append_log({"kind": "api", **meta})
        if isinstance(error, ApiFailure):
            raise
        raise ApiFailure(None, type(error).__name__) from error


def pexels_url(query: str) -> str | None:
    key = os.environ.get("PEXELS_API_KEY", "")
    if not key:
        return None
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode(
        {"query": query, "per_page": 5, "orientation": "landscape"}
    )
    try:
        request = urllib.request.Request(
            url, headers={"Authorization": key, "User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        photo = payload["photos"][0]
        return photo["src"].get("original") or photo["src"].get("large2x")
    except Exception as error:
        print("  source Pexels indisponible:", type(error).__name__, flush=True)
        return None


def local_image_data_url(path: str, base_dir: Path) -> str:
    source = Path(os.path.expanduser(path))
    if not source.is_absolute():
        source = base_dir / source
    if not source.is_file():
        raise ApiFailure(None, f"image_path introuvable: {path}")
    mime_type = mimetypes.guess_type(source.name)[0] or "image/jpeg"
    encoded = base64.b64encode(source.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def download(url: str, destination: Path) -> None:
    partial = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        partial.write_bytes(response.read())
    partial.replace(destination)


def gen_image(job: dict[str, Any], output: Path) -> Path:
    body: dict[str, Any] = {
        "model": job.get("model", "grok-imagine-image"),
        "prompt": job["prompt"],
        "n": int(job.get("n", 1)),
    }
    for key in ("aspect_ratio", "resolution", "quality", "response_format"):
        if key in job:
            body[key] = job[key]
    response, _ = api("POST", "/v1/images/generations", body)
    if not response.get("data"):
        raise ApiFailure(None, "réponse image sans data")
    item = response["data"][0]
    destination = output / f"{job['name']}.jpg"
    if item.get("url"):
        download(item["url"], destination)
    elif item.get("b64_json"):
        destination.write_bytes(base64.b64decode(item["b64_json"]))
    else:
        raise ApiFailure(None, "réponse image sans contenu")
    return destination


def gen_video(job: dict[str, Any], output: Path, base_dir: Path) -> Path:
    body: dict[str, Any] = {
        "model": job.get("model", "grok-imagine-video-1.5"),
        "prompt": job["prompt"],
        "duration": int(job.get("duration", 6)),
        "aspect_ratio": job.get("aspect_ratio", "16:9"),
        "resolution": job.get("resolution", "1080p"),
    }
    if job.get("image_path"):
        body["image"] = {"url": local_image_data_url(job["image_path"], base_dir)}
    else:
        reference = job.get("ref_url") or (
            pexels_url(job["ref_pexels"]) if job.get("ref_pexels") else None
        )
        if reference:
            body["image"] = {"url": reference}
    if job.get("reference_audios"):
        body["reference_audios"] = job["reference_audios"]

    response, _ = api("POST", "/v1/videos/generations", body)
    request_id = response.get("request_id")
    if not request_id:
        raise ApiFailure(None, "réponse vidéo sans request_id")

    attempts = int(os.environ.get("GROK_IMAGINE_POLL_ATTEMPTS", "120"))
    interval = float(os.environ.get("GROK_IMAGINE_POLL_INTERVAL", "5"))
    for _ in range(attempts):
        time.sleep(interval)
        status, _ = api("GET", f"/v1/videos/{request_id}")
        state = status.get("status")
        if state == "done":
            video_url = status.get("video", {}).get("url")
            if not video_url:
                raise ApiFailure(None, "statut done sans URL vidéo")
            destination = output / f"{job['name']}.mp4"
            download(video_url, destination)
            return destination
        if state in ("failed", "expired"):
            raise ApiFailure(None, f"génération vidéo {state}")
    raise ApiFailure(None, "timeout polling vidéo")


def probe(path: Path) -> dict[str, Any]:
    process = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        check=False,
        text=True,
    )
    if process.returncode != 0:
        return {"error": "ffprobe", "returncode": process.returncode}
    payload = json.loads(process.stdout)
    stream = (payload.get("streams") or [{}])[0]
    return {
        "duration": float(payload.get("format", {}).get("duration", 0)),
        "width": stream.get("width"),
        "height": stream.get("height"),
    }


def main() -> int:
    jobs_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
    if jobs_path:
        with jobs_path.open(encoding="utf-8") as handle:
            jobs = json.load(handle)
        base_dir = jobs_path.parent
    else:
        jobs = json.load(sys.stdin)
        base_dir = Path.cwd()

    output = Path(
        os.path.expanduser(
            os.environ.get(
                "GROK_IMAGINE_OUT", "~/.codebuddy/personas/ambre/grok-imagine"
            )
        )
    )
    output.mkdir(parents=True, exist_ok=True)
    completed: list[Path] = []
    stopped_for_quota = False

    for job in jobs:
        started = time.monotonic()
        name = job["name"]
        extension = "jpg" if job.get("mode") == "image" else "mp4"
        destination = output / f"{name}.{extension}"
        if destination.exists() and destination.stat().st_size > MIN_COMPLETE_BYTES:
            print(f"[{name}] déjà fait (>50 Ko), skip", flush=True)
            append_log(
                {
                    "kind": "job",
                    "name": name,
                    "status": "skipped_existing",
                    "file": str(destination),
                    "bytes": destination.stat().st_size,
                    "probe": probe(destination) if extension == "mp4" else None,
                    "elapsed_s": 0,
                }
            )
            completed.append(destination)
            continue

        reference = job.get("image_path") or job.get("ref_url") or job.get("ref_pexels")
        print(
            f"[{name}] {job.get('mode', 'video')} {job.get('resolution', '1080p')} "
            f"ref={'i2v' if reference else 't2v'} ...",
            flush=True,
        )
        try:
            result = (
                gen_image(job, output)
                if job.get("mode") == "image"
                else gen_video(job, output, base_dir)
            )
        except QuotaExhausted:
            elapsed = round(time.monotonic() - started, 3)
            print(f"[{name}] ARRÊT QUOTA: {QUOTA_SENTINEL}", flush=True)
            append_log(
                {
                    "kind": "job",
                    "name": name,
                    "status": "stopped_quota",
                    "elapsed_s": elapsed,
                    "error": QUOTA_SENTINEL,
                }
            )
            stopped_for_quota = True
            break
        except ApiFailure as error:
            elapsed = round(time.monotonic() - started, 3)
            print(f"[{name}] ÉCHEC HTTP={error.status}: {error}", flush=True)
            append_log(
                {
                    "kind": "job",
                    "name": name,
                    "status": "failed",
                    "elapsed_s": elapsed,
                    "http": error.status,
                    "error": str(error),
                }
            )
            continue

        elapsed = round(time.monotonic() - started, 3)
        result_probe = probe(result) if result.suffix == ".mp4" else None
        (output / f"{name}.txt").write_text(job["prompt"] + "\n", encoding="utf-8")
        print(
            f"  -> {result} ({result.stat().st_size // 1024} Ko) "
            f"{json.dumps(result_probe, ensure_ascii=False)}",
            flush=True,
        )
        append_log(
            {
                "kind": "job",
                "name": name,
                "status": "done",
                "file": str(result),
                "bytes": result.stat().st_size,
                "probe": result_probe,
                "elapsed_s": elapsed,
            }
        )
        completed.append(result)

    backup = os.environ.get("GROK_IMAGINE_BACKUP", "").strip()
    if completed and backup:
        backup_path = Path(os.path.expanduser(backup))
        backup_path.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["rsync", "-a", str(output) + "/", str(backup_path) + "/"],
            check=False,
        )

    state = "ARRÊT QUOTA" if stopped_for_quota else "TERMINÉ"
    print(f"\n=== {state} : {len(completed)}/{len(jobs)} ===")
    for path in completed:
        print(" ", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
