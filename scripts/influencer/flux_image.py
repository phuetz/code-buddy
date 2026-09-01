#!/usr/bin/env python3
"""Génération d'images locale $0 via Flux dev fp8 (ComfyUI).

Pipeline validé le 2026-08-29 sur darkstar (2x RTX 3090). Le VAE Flux doit être
un miroir NON-gated (Black Forest Labs a fermé FLUX.1-schnell) — voir
`flux_ae_real.safetensors` (335 Mo, depuis huggingface.co/ffxvs/vae-flux).

Usage:
    COMFYUI_URL=http://<hote>:8188 python3 flux_image.py jobs.json [--out DIR]

jobs.json = [{"name","prompt","width"?,"height"?,"seed"?,"steps"?}]
Idempotent : saute un plan si son PNG existe déjà (>50 Ko).
"""
import argparse, json, os, sys, time, urllib.request, urllib.parse

BASE = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
CKPT = os.environ.get("FLUX_CKPT", "flux1-dev-fp8.safetensors")
CLIP_L = os.environ.get("FLUX_CLIP_L", "clip_l.safetensors")
T5 = os.environ.get("FLUX_T5", "t5xxl_fp8_e4m3fn.safetensors")
VAE = os.environ.get("FLUX_VAE", "flux_ae_real.safetensors")


def graph(job):
    w = int(job.get("width", 1280)); h = int(job.get("height", 720))
    seed = int(job.get("seed", 42)); steps = int(job.get("steps", 20))
    return {"prompt": {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "1b": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": CLIP_L, "clip_name2": T5, "type": "flux"}},
        "1c": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1b", 0], "text": job["prompt"]}},
        "3": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["2", 0], "guidance": float(job.get("guidance", 3.5))}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1b", 0], "text": ""}},
        "5": {"class_type": "EmptySD3LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "6": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "seed": seed, "steps": steps, "cfg": 1.0,
              "sampler_name": "euler", "scheduler": "simple", "positive": ["3", 0], "negative": ["4", 0],
              "latent_image": ["5", 0], "denoise": 1.0}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1c", 0]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0], "filename_prefix": job["name"]}},
    }}


def run_job(job, out_dir):
    dest = os.path.join(out_dir, job["name"] + ".png")
    if os.path.exists(dest) and os.path.getsize(dest) > 50 * 1024:
        print("skip (existe):", dest); return dest
    req = urllib.request.Request(BASE + "/prompt", data=json.dumps(graph(job)).encode(),
                                 headers={"Content-Type": "application/json"})
    pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    print("POST", job["name"], pid, flush=True)
    for _ in range(90):
        time.sleep(4)
        h = json.load(urllib.request.urlopen(BASE + "/history/" + pid, timeout=15))
        if pid not in h:
            continue
        st = h[pid].get("status", {})
        if st.get("status_str") == "error":
            for m in st.get("messages", []):
                if m[0] == "execution_error":
                    print("  ERR node", m[1].get("node_id"), str(m[1].get("exception_message"))[:140])
            return None
        for o in h[pid].get("outputs", {}).values():
            for im in o.get("images", []):
                u = BASE + "/view?" + urllib.parse.urlencode(
                    {"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                open(dest, "wb").write(urllib.request.urlopen(u, timeout=120).read())
                print("  OK", dest, os.path.getsize(dest) // 1024, "Ko", flush=True)
                return dest
    print("  timeout", job["name"]); return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jobs")
    ap.add_argument("--out", default=os.path.expanduser("~/flux-out"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    jobs = json.load(open(a.jobs))
    ok = 0
    for j in jobs:
        if run_job(j, a.out):
            ok += 1
    print(f"\n=== {ok}/{len(jobs)} images générées dans {a.out} ===")
    sys.exit(0 if ok == len(jobs) else 1)


if __name__ == "__main__":
    main()
