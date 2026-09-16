#!/usr/bin/env python3
"""Pilote musique locale ComfyUI ($0) — MiniMax Music 3 et ACE-Step.

Soumet un graphe API à une instance ComfyUI, attend le rendu, télécharge l'audio.
Aucune dépendance hors stdlib (comme grok_imagine.py).

Usage:
    python3 music_local.py jobs.json [--url http://gpuNode:8190] [--out DIR]

Format d'un job:
    {
      "name": "if-you-stay-quiet-mm3",
      "engine": "minimax" | "acestep",
      "caption": "style, BPM, instruments...",   # 'tags' pour acestep
      "lyrics": "[Verse]\n...",
      "seconds": 60,
      "seed": 1234,
      "steps": 50, "cfg": 5.0,                   # acestep
      "cfg_scale": 1.5, "top_k": 50,             # minimax
      "precision": "fp16" | "int8"               # minimax
    }

Idempotent : un job dont le fichier de sortie existe déjà (>50 Ko) est ignoré.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TIMEOUT = 30

# Poids MiniMax Music 3 disponibles sur gpuNode (cf. inventaire 2026-09-01).
MINIMAX_WEIGHTS = {
    "fp16": {
        "unet": "minimax_music3_dit_fp16.safetensors",
        "clip": "minimax_music3_text_encoder_pruned_bf16.safetensors",
    },
    "fp32": {
        "unet": "minimax_music3_dit_fp32.safetensors",
        "clip": "minimax_music3_text_encoder_bf16.safetensors",
    },
    "int8": {
        "unet": "minimax_music3_dit_int8_convrot.safetensors",
        "clip": "minimax_music3_text_encoder_pruned_int8_convrot.safetensors",
    },
}
MINIMAX_VAE = "minimax_music3_dav.safetensors"
ACESTEP_CKPT = "all_in_one\\ace_step_v1_3.5b.safetensors"


def _post(url: str, path: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url + path, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        body = resp.read()
    return json.loads(body) if body else {}


def _get(url: str, path: str) -> dict:
    with urllib.request.urlopen(url + path, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


def free_memory(url: str) -> None:
    """Libère la VRAM avant de soumettre — un modèle résident fait OOM le job suivant."""
    try:
        _post(url, "/free", {"unload_models": True, "free_memory": True})
        time.sleep(2)
    except Exception as exc:  # noqa: BLE001 - diagnostic seulement
        print(f"  [warn] /free a échoué: {exc}", file=sys.stderr)


def vram_free_gb(url: str) -> float:
    try:
        stats = _get(url, "/system_stats")
        dev = stats.get("devices", [{}])[0]
        return round(dev.get("vram_free", 0) / 1024**3, 2)
    except Exception:  # noqa: BLE001
        return -1.0


def build_minimax_graph(job: dict) -> dict:
    precision = job.get("precision", "fp16")
    weights = MINIMAX_WEIGHTS[precision]
    seconds = float(job.get("seconds", 60))
    seed = int(job.get("seed", 0))
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": weights["unet"], "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": weights["clip"], "type": "minimax"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": MINIMAX_VAE}},
        "4": {
            "class_type": "MiniMaxMusic3TextEncode",
            "inputs": {
                "clip": ["2", 0],
                "caption": job.get("caption", ""),
                "lyrics": job.get("lyrics", ""),
                "seed": seed,
                "max_duration": seconds,
                "cfg_scale": float(job.get("cfg_scale", 1.5)),
                "top_k": int(job.get("top_k", 50)),
            },
        },
        "5": {
            "class_type": "MiniMaxMusic3TextEncode",
            "inputs": {
                "clip": ["2", 0],
                "caption": job.get("negative", ""),
                "lyrics": "",
                "seed": seed,
                "max_duration": seconds,
                "cfg_scale": float(job.get("cfg_scale", 1.5)),
                "top_k": int(job.get("top_k", 50)),
            },
        },
        "6": {
            "class_type": "EmptyMiniMaxMusic3LatentAudio",
            "inputs": {"seconds": seconds, "batch_size": 1},
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": seed,
                "steps": int(job.get("steps", 30)),
                "cfg": float(job.get("cfg", 3.0)),
                "sampler_name": job.get("sampler", "euler"),
                "scheduler": job.get("scheduler", "simple"),
                "denoise": 1.0,
            },
        },
        "8": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["8", 0], "filename_prefix": "music/" + job["name"]},
        },
    }


def build_acestep_graph(job: dict) -> dict:
    seconds = float(job.get("seconds", 60))
    seed = int(job.get("seed", 0))
    tags = job.get("tags", job.get("caption", ""))
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ACESTEP_CKPT}},
        "2": {
            "class_type": "TextEncodeAceStepAudio",
            "inputs": {
                "clip": ["1", 1],
                "tags": tags,
                "lyrics": job.get("lyrics", ""),
                "lyrics_strength": float(job.get("lyrics_strength", 1.0)),
            },
        },
        "3": {
            "class_type": "TextEncodeAceStepAudio",
            "inputs": {
                "clip": ["1", 1],
                "tags": job.get("negative", ""),
                "lyrics": "",
                "lyrics_strength": 1.0,
            },
        },
        "4": {
            "class_type": "EmptyAceStepLatentAudio",
            "inputs": {"seconds": seconds, "batch_size": 1},
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
                "seed": seed,
                "steps": int(job.get("steps", 50)),
                "cfg": float(job.get("cfg", 5.0)),
                "sampler_name": job.get("sampler", "euler"),
                "scheduler": job.get("scheduler", "simple"),
                "denoise": 1.0,
            },
        },
        "6": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["6", 0], "filename_prefix": "music/" + job["name"]},
        },
    }


BUILDERS = {"minimax": build_minimax_graph, "acestep": build_acestep_graph}


def run_job(url: str, job: dict, out_dir: Path, poll: int, budget_s: int) -> dict:
    name = job["name"]
    engine = job.get("engine", "minimax")
    existing = sorted(out_dir.glob(f"{name}*"))
    if any(p.stat().st_size > 50_000 for p in existing):
        print(f"[skip] {name} — déjà présent")
        return {"name": name, "status": "skipped", "files": [str(p) for p in existing]}

    graph = BUILDERS[engine](job)
    free_memory(url)
    print(f"[{engine}] {name} — VRAM libre {vram_free_gb(url)} Go, soumission…")
    started = time.time()
    resp = _post(url, "/prompt", {"prompt": graph})
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
            if status.get("status_str") == "error" or not status.get("completed", True):
                return {
                    "name": name,
                    "status": "error",
                    "elapsed_s": round(elapsed),
                    "detail": status,
                }
            files: list[str] = []
            for node_out in entry.get("outputs", {}).values():
                for audio in node_out.get("audio", []):
                    q = urllib.parse.urlencode(
                        {
                            "filename": audio["filename"],
                            "subfolder": audio.get("subfolder", ""),
                            "type": audio.get("type", "output"),
                        }
                    )
                    dest = out_dir / audio["filename"]
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with urllib.request.urlopen(url + "/view?" + q, timeout=120) as r:
                        dest.write_bytes(r.read())
                    files.append(str(dest))
                    print(f"  ✓ {dest} ({dest.stat().st_size // 1024} Ko)")
            return {
                "name": name,
                "status": "done" if files else "empty",
                "elapsed_s": round(elapsed),
                "files": files,
            }
        # Toujours en file ou en cours ?
        try:
            queue = _get(url, "/queue")
            known = any(
                pid in json.dumps(item)
                for item in queue.get("queue_running", []) + queue.get("queue_pending", [])
            )
            if not known and elapsed > 60:
                # Disparu de la queue sans entrée d'historique = crash dur du worker.
                return {"name": name, "status": "crashed", "elapsed_s": round(elapsed)}
        except Exception:  # noqa: BLE001
            pass
        if elapsed - last_note > 60:
            print(f"  … {round(elapsed)}s")
            last_note = elapsed
        time.sleep(poll)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("jobs", help="fichier JSON de jobs")
    ap.add_argument("--url", default="http://gpuNode:8190")
    ap.add_argument("--out", default=str(Path.home() / ".codebuddy/media-generation/music"))
    ap.add_argument("--poll", type=int, default=10)
    ap.add_argument("--budget", type=int, default=1800, help="budget par job en secondes")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = json.loads(Path(args.jobs).read_text())
    results = []
    for job in jobs:
        try:
            res = run_job(args.url.rstrip("/"), job, out_dir, args.poll, args.budget)
        except Exception as exc:  # noqa: BLE001 - un job ne doit pas tuer le lot
            res = {"name": job.get("name", "?"), "status": "exception", "error": str(exc)}
        print(f"  → {res['status']}" + (f" en {res.get('elapsed_s')}s" if res.get("elapsed_s") else ""))
        results.append(res)

    report = out_dir / f"report-{time.strftime('%Y%m%d-%H%M%S')}.json"
    report.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\nRapport : {report}")
    ok = sum(1 for r in results if r["status"] in ("done", "skipped"))
    print(f"{ok}/{len(results)} jobs aboutis")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
