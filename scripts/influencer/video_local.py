#!/usr/bin/env python3
"""Pilote vidéo locale ComfyUI ($0) — MiniMax H3 (texte→vidéo et image→vidéo, son natif).

Complète `music_local.py` (audio) et `flux_image.py` (image) : le troisième moteur
local de darkstar, sans quota ni clé d'API.

Usage:
    python3 video_local.py jobs.json [--url http://darkstar:8190] [--out DIR]

Format d'un job:
    {
      "name": "broll-studio",
      "prompt": "…",
      "width": 1344, "height": 768,
      "length": 124,            # images à 24 fps, grille 17k+5 (124 ≈ 5 s)
      "steps": 20, "cfg": 4.0,
      "seed": 42,
      "first_frame": "/chemin/local.png"   # optionnel → image-to-video
    }

⚠️ `length` DOIT tomber sur la grille 17k+5 (5, 22, 39, …, 124, …) : le script
arrondit vers le haut et le signale.

⚠️ Un seul gros job vidéo à la fois sur darkstar : deux instances qui chargent
chacune leurs poids saturent les 64 Go de RAM et font tomber le serveur.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

TIMEOUT = 60

# Poids MiniMax H3 présents sur darkstar (inventaire 2026-09-01).
H3_UNET_I2V = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
H3_UNET_REF = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
H3_CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
H3_VAE_VIDEO = "minimax_h3_video_vae_fp16.safetensors"
H3_VAE_AUDIO = "minimax_h3_audio_vae_fp32.safetensors"

FRAME_GRID = 17  # le modèle attend 17k + 5 images


def snap_length(length: int) -> int:
    """Arrondit vers le haut sur la grille 17k+5 attendue par le modèle."""
    if length <= 5:
        return 5
    k = -(-(length - 5) // FRAME_GRID)  # ceil
    return FRAME_GRID * k + 5


def _post(url: str, path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        body = resp.read()
    return json.loads(body) if body else {}


def _get(url: str, path: str) -> dict:
    with urllib.request.urlopen(url + path, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


def free_memory(url: str) -> None:
    try:
        _post(url, "/free", {"unload_models": True, "free_memory": True})
        time.sleep(2)
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] /free a échoué: {exc}", file=sys.stderr)


def vram_free_gb(url: str) -> float:
    try:
        dev = _get(url, "/system_stats").get("devices", [{}])[0]
        return round(dev.get("vram_free", 0) / 1024**3, 2)
    except Exception:  # noqa: BLE001
        return -1.0


def upload_image(url: str, path: Path) -> str:
    """Téléverse une image dans l'input du serveur, renvoie son nom distant."""
    boundary = uuid.uuid4().hex
    remote_name = f"{uuid.uuid4().hex[:8]}-{path.name}"
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    parts = [
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{remote_name}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n".encode(),
        path.read_bytes(),
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
        f"--{boundary}--\r\n".encode(),
    ]
    req = urllib.request.Request(
        url + "/upload/image",
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())["name"]


def build_graph(job: dict, first_frame_remote: str | None) -> dict:
    length = snap_length(int(job.get("length", 124)))
    seed = int(job.get("seed", 0))
    graph: dict = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": H3_UNET_I2V, "weight_dtype": "default"}},
        "2": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {
                "model": ["1", 0],
                "shift_video": float(job.get("shift_video", 12.0)),
                "shift_audio": float(job.get("shift_audio", 3.0)),
            },
        },
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": H3_CLIP, "type": "minimax"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": H3_VAE_VIDEO}},
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": H3_VAE_AUDIO}},
        "6": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["3", 0],
                "vae": ["4", 0],
                "prompt": job["prompt"],
                "width": int(job.get("width", 1344)),
                "height": int(job.get("height", 768)),
                "length": length,
            },
        },
        "7": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["6", 0]}},
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["2", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["6", 1],
                "seed": seed,
                "steps": int(job.get("steps", 20)),
                "cfg": float(job.get("cfg", 4.0)),
                "sampler_name": job.get("sampler", "euler"),
                "scheduler": job.get("scheduler", "simple"),
                "denoise": 1.0,
            },
        },
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["4", 0]}},
        "10": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["8", 0], "vae": ["5", 0]}},
        "11": {
            "class_type": "CreateVideo",
            "inputs": {"images": ["9", 0], "fps": float(job.get("fps", 24)), "audio": ["10", 0]},
        },
        "12": {
            "class_type": "SaveVideo",
            "inputs": {"video": ["11", 0], "filename_prefix": "h3/" + job["name"], "format": "auto", "codec": "auto"},
        },
    }
    if first_frame_remote:
        graph["13"] = {"class_type": "LoadImage", "inputs": {"image": first_frame_remote}}
        graph["6"]["inputs"]["first_frame"] = ["13", 0]
    return graph


def run_job(url: str, job: dict, out_dir: Path, poll: int, budget_s: int) -> dict:
    name = job["name"]
    if any(p.stat().st_size > 50_000 for p in out_dir.glob(f"{name}*")):
        print(f"[skip] {name} — déjà présent")
        return {"name": name, "status": "skipped"}

    asked = int(job.get("length", 124))
    snapped = snap_length(asked)
    if snapped != asked:
        print(f"  [info] length {asked} → {snapped} (grille 17k+5)")

    first_remote = None
    if job.get("first_frame"):
        src = Path(job["first_frame"]).expanduser()
        if not src.is_file():
            return {"name": name, "status": "missing_first_frame", "path": str(src)}
        first_remote = upload_image(url, src)
        print(f"  [i2v] première image téléversée: {first_remote}")

    free_memory(url)
    mode = "i2v" if first_remote else "t2v"
    print(f"[h3/{mode}] {name} — VRAM libre {vram_free_gb(url)} Go, {snapped} images, soumission…")
    started = time.time()
    resp = _post(url, "/prompt", {"prompt": build_graph(job, first_remote)})
    pid = resp.get("prompt_id")
    if not pid:
        return {"name": name, "status": "rejected", "error": resp}

    last_note = 0.0
    while True:
        elapsed = time.time() - started
        if elapsed > budget_s:
            return {"name": name, "status": "timeout", "elapsed_s": round(elapsed)}
        try:
            hist = _get(url, f"/history/{pid}")
        except urllib.error.URLError as exc:
            print(f"  [warn] history injoignable: {exc}", file=sys.stderr)
            time.sleep(poll)
            continue
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                return {"name": name, "status": "error", "elapsed_s": round(elapsed), "detail": status}
            files: list[str] = []
            for node_out in entry.get("outputs", {}).values():
                for kind in ("videos", "images", "gifs"):
                    for item in node_out.get(kind, []):
                        q = urllib.parse.urlencode(
                            {
                                "filename": item["filename"],
                                "subfolder": item.get("subfolder", ""),
                                "type": item.get("type", "output"),
                            }
                        )
                        dest = out_dir / item["filename"]
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        with urllib.request.urlopen(url + "/view?" + q, timeout=300) as r:
                            dest.write_bytes(r.read())
                        files.append(str(dest))
                        print(f"  ✓ {dest} ({dest.stat().st_size // 1024} Ko)")
            return {
                "name": name,
                "status": "done" if files else "empty",
                "elapsed_s": round(elapsed),
                "files": files,
            }
        try:
            queue = _get(url, "/queue")
            known = any(
                pid in json.dumps(item)
                for item in queue.get("queue_running", []) + queue.get("queue_pending", [])
            )
            if not known and elapsed > 90:
                return {"name": name, "status": "crashed", "elapsed_s": round(elapsed)}
        except Exception:  # noqa: BLE001
            pass
        if elapsed - last_note > 60:
            print(f"  … {round(elapsed)}s")
            last_note = elapsed
        time.sleep(poll)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("jobs")
    ap.add_argument("--url", default="http://darkstar:8190")
    ap.add_argument("--out", default=str(Path.home() / ".codebuddy/media-generation/videos"))
    ap.add_argument("--poll", type=int, default=15)
    ap.add_argument("--budget", type=int, default=3600)
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for job in json.loads(Path(args.jobs).read_text()):
        try:
            res = run_job(args.url.rstrip("/"), job, out_dir, args.poll, args.budget)
        except Exception as exc:  # noqa: BLE001
            res = {"name": job.get("name", "?"), "status": "exception", "error": str(exc)}
        print(f"  → {res['status']}" + (f" en {res.get('elapsed_s')}s" if res.get("elapsed_s") else ""))
        results.append(res)

    report = out_dir / f"h3-report-{time.strftime('%Y%m%d-%H%M%S')}.json"
    report.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\nRapport : {report}")
    ok = sum(1 for r in results if r["status"] in ("done", "skipped"))
    print(f"{ok}/{len(results)} jobs aboutis")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
