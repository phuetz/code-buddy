#!/usr/bin/env python3
"""Pipeline best-of-N keyframes Lisa -> i2v H3 (identite ancree + mesure ArcFace).

Loi mesuree le 11/08 : le LoRA H3 seul plafonne a 0,36 ArcFace. Le levier
d'identite est la KEYFRAME krea2 (0,576) dont le score se PROPAGE en i2v
(0,48-0,50 stable sur 5 s). Ce pipeline exploite ca :

  1. Genere N keyframes krea2 (seeds distinctes) via l'API ComfyUI.
  2. Score ArcFace chaque keyframe vs la reference -> garde LA MEILLEURE
     (des 0,65+ existent dans la distribution krea2).
  3. i2v H3 (MiniMaxH3ImageToVideo, first_frame=meilleure keyframe) + LoRA
     stabilisateur optionnel (le nouveau lisa_h3_v1).
  4. Extrait 3 frames de la video + score ArcFace -> rapport JSON.

N'utilise le GPU QUE via ComfyUI. A lancer quand le serveur H3 tourne et
qu'aucun autre job GPU (ex: entrainement LoRA) n'est en cours.

Le script lui-meme n'a besoin que de la stdlib (urllib/json/subprocess).
Le scoring ArcFace est delegue a score-arcface-images.py (insightface).
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

# --------------------------------------------------------------------------- #
# API ComfyUI (HTTP)
# --------------------------------------------------------------------------- #

def _post_json(base: str, path: str, payload: dict, timeout: int = 300) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_json(base: str, path: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(base.rstrip("/") + path, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def comfy_submit(base: str, graph: dict, client_id: str) -> str:
    out = _post_json(base, "/prompt", {"prompt": graph, "client_id": client_id})
    pid = out.get("prompt_id")
    if not pid:
        raise RuntimeError(f"ComfyUI a rejete le workflow: {json.dumps(out)[:400]}")
    return pid


def comfy_wait(base: str, prompt_id: str, timeout_s: int = 1800, poll_s: float = 3.0) -> dict:
    """Attend la fin du prompt, renvoie l'entree /history correspondante."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            hist = _get_json(base, f"/history/{prompt_id}")
        except urllib.error.URLError:
            time.sleep(poll_s)
            continue
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("completed") or status.get("status_str") == "success" or entry.get("outputs"):
                return entry
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI erreur: {json.dumps(status)[:400]}")
        time.sleep(poll_s)
    raise TimeoutError(f"Timeout en attente du prompt {prompt_id}")


def _iter_output_files(entry: dict):
    """Rend (filename, subfolder, type) pour chaque fichier produit."""
    for node_out in entry.get("outputs", {}).values():
        for value in node_out.values():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict) and "filename" in item:
                        yield item["filename"], item.get("subfolder", ""), item.get("type", "output")


def comfy_fetch(base: str, filename: str, subfolder: str, ftype: str, dest: Path, timeout: int = 300) -> Path:
    q = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": ftype})
    req = urllib.request.Request(base.rstrip("/") + "/view?" + q, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        dest.write_bytes(resp.read())
    return dest


def comfy_upload_image(base: str, image_path: Path, timeout: int = 120) -> str:
    """Upload une image dans le dossier input de ComfyUI. Renvoie le nom servi."""
    boundary = "----codebuddy" + uuid.uuid4().hex
    ctype = mimetypes.guess_type(image_path.name)[0] or "image/png"
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'.encode()
    body += f"Content-Type: {ctype}\r\n\r\n".encode()
    body += image_path.read_bytes()
    body += f"\r\n--{boundary}\r\n".encode()
    body += 'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'.encode()
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        base.rstrip("/") + "/upload/image",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        out = json.loads(resp.read().decode("utf-8"))
    name = out.get("name", image_path.name)
    sub = out.get("subfolder", "")
    return f"{sub}/{name}" if sub else name


# --------------------------------------------------------------------------- #
# Graphes (reproduits fidelement depuis media-generation-tool.ts)
# --------------------------------------------------------------------------- #

def build_krea2_graph(prompt, unet, te, vae, w, h, seed, lora_name, lora_strength):
    g = {
        "4": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "6": {"class_type": "CLIPLoader", "inputs": {"clip_name": te, "type": "krea2", "device": "default"}},
        "7": {"class_type": "VAELoader", "inputs": {"vae_name": vae}},
        "8": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["6", 0]}},
        "10": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["8", 0]}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["7", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "lisa-kf", "images": ["11", 0]}},
    }
    model_ref = ["4", 0]
    if lora_name:
        g["12"] = {"class_type": "LoraLoaderModelOnly",
                   "inputs": {"lora_name": lora_name, "strength_model": lora_strength, "model": ["4", 0]}}
        model_ref = ["12", 0]
    # Krea 2 Turbo : 8 pas euler/simple, cfg 1 + ConditioningZeroOut (workflow officiel)
    g["3"] = {"class_type": "KSampler", "inputs": {
        "seed": seed, "steps": 8, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
        "denoise": 1.0, "model": model_ref, "positive": ["8", 0], "negative": ["10", 0],
        "latent_image": ["5", 0]}}
    return g


def build_h3_i2v_graph(prompt, first_frame_name, unet, te, video_vae, w, h, length, seed, steps,
                       lora_name, lora_strength):
    g = {"1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}}}
    model_src = ["1", 0]
    if lora_name:
        g["14"] = {"class_type": "LoraLoaderModelOnly",
                   "inputs": {"lora_name": lora_name, "strength_model": lora_strength, "model": ["1", 0]}}
        model_src = ["14", 0]
    g.update({
        "2": {"class_type": "MiniMaxH3SigmaShift", "inputs": {"model": model_src, "shift_video": 12.0, "shift_audio": 3.0}},
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": te, "type": "minimax", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": video_vae}},
        "6": {"class_type": "LoadImage", "inputs": {"image": first_frame_name}},
        "7": {"class_type": "MiniMaxH3ImageToVideo", "inputs": {
            "clip": ["3", 0], "vae": ["4", 0], "prompt": prompt,
            "width": w, "height": h, "length": length, "first_frame": ["6", 0]}},
        "8": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["7", 0]}},
        "9": {"class_type": "KSampler", "inputs": {
            "model": ["2", 0], "positive": ["7", 0], "negative": ["8", 0], "latent_image": ["7", 1],
            "seed": seed, "steps": steps, "cfg": 4.0, "sampler_name": "euler", "scheduler": "simple",
            "denoise": 1.0}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["4", 0]}},
        "12": {"class_type": "CreateVideo", "inputs": {"images": ["10", 0], "fps": 24.0, "bit_depth": 8}},
        "13": {"class_type": "SaveVideo", "inputs": {
            "video": ["12", 0], "filename_prefix": "lisa-bestof-i2v", "format": "auto", "codec": "auto"}},
    })
    return g


# --------------------------------------------------------------------------- #
# ArcFace + extraction frames
# --------------------------------------------------------------------------- #

def score_arcface(arcface_python: str, scorer: Path, reference: Path, images: list[Path], out_json: Path) -> list[dict]:
    cmd = [arcface_python, str(scorer), "--reference", str(reference), "--output", str(out_json)]
    cmd += [str(p) for p in images]
    subprocess.run(cmd, check=True)
    return json.loads(out_json.read_text(encoding="utf-8"))


def extract_frames(video: Path, out_dir: Path, positions=(0.05, 0.5, 0.95)) -> list[Path]:
    """Extrait des frames a des positions relatives (fraction de la duree)."""
    dur = _video_duration(video)
    frames = []
    for i, pos in enumerate(positions):
        t = max(0.0, dur * pos)
        dest = out_dir / f"frame_{i}_{pos:.2f}.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.3f}",
                        "-i", str(video), "-frames:v", "1", str(dest)], check=True)
        if dest.exists():
            frames.append(dest)
    return frames


def _video_duration(video: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(video)],
                         capture_output=True, text=True, check=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 5.0


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(description="Best-of-N keyframes Lisa -> i2v H3 + ArcFace")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8190", help="serveur i2v H3")
    ap.add_argument("--kf-comfy-url", default="", help="serveur keyframes krea2 (defaut = --comfy-url ; mettre :8188 si krea2 n'est que sur le ComfyUI prod)")
    ap.add_argument("--n", type=int, default=6, help="nombre de keyframes candidates")
    ap.add_argument("--seed-base", type=int, default=1000)
    ap.add_argument("--outdir", type=Path, default=Path("D:/DEV/lisa-bestof") if sys.platform == "win32" else Path.home() / "lisa-bestof")
    ap.add_argument("--reference", type=Path, required=True, help="lisa-h3-source.png (identite canonique)")
    ap.add_argument("--arcface-python", default="python", help="python avec insightface+cv2")
    ap.add_argument("--scorer", type=Path, default=Path(__file__).with_name("score-arcface-images.py"))
    # keyframe krea2
    ap.add_argument("--kf-prompt", default="lisa, a beautiful woman, dark brown wavy hair, burgundy turtleneck, soft studio lighting, looking at camera, photorealistic portrait, sharp focus, 85mm")
    ap.add_argument("--kf-unet", default="krea2_turbo_fp8_scaled.safetensors")
    ap.add_argument("--kf-te", default="qwen3vl_4b_fp8_scaled.safetensors")
    ap.add_argument("--kf-vae", default="qwen_image_vae.safetensors")
    ap.add_argument("--kf-lora", default="lisa-krea2.safetensors")
    ap.add_argument("--kf-lora-strength", type=float, default=1.0)
    ap.add_argument("--kf-width", type=int, default=832)
    ap.add_argument("--kf-height", type=int, default=1216)
    # i2v H3
    ap.add_argument("--i2v-prompt", default="a woman in a burgundy turtleneck, subtle natural head movement, soft smile, cinematic lighting, static camera")
    ap.add_argument("--i2v-unet", default="minimax_h3_fl2va_pruned_int8_convrot.safetensors")
    ap.add_argument("--i2v-te", default="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors")
    ap.add_argument("--i2v-vae", default="minimax_h3_video_vae_fp16.safetensors")
    ap.add_argument("--i2v-width", type=int, default=768)
    ap.add_argument("--i2v-height", type=int, default=1344)
    ap.add_argument("--i2v-length", type=int, default=124, help="~5 s @24fps (grille 17k+5)")
    ap.add_argument("--i2v-steps", type=int, default=20)
    ap.add_argument("--i2v-seed", type=int, default=42)
    ap.add_argument("--stabilizer-lora", default="", help="LoRA H3 stabilisateur (ex lisa_h3_v1.safetensors), vide=aucun")
    ap.add_argument("--stabilizer-strength", type=float, default=0.8)
    ap.add_argument("--skip-i2v", action="store_true", help="s'arreter apres la meilleure keyframe")
    args = ap.parse_args()

    base = args.comfy_url
    kf_base = args.kf_comfy_url.strip() or base
    outdir = args.outdir
    outdir.mkdir(parents=True, exist_ok=True)
    client_id = uuid.uuid4().hex
    report = {"comfy_url": base, "n": args.n, "keyframes": [], "reference": str(args.reference)}

    # --- Etape 1 : generer N keyframes krea2 ------------------------------- #
    print(f"[1/4] Generation de {args.n} keyframes krea2 (seeds {args.seed_base}+)...", flush=True)
    kf_paths: list[Path] = []
    for i in range(args.n):
        seed = args.seed_base + i
        graph = build_krea2_graph(args.kf_prompt, args.kf_unet, args.kf_te, args.kf_vae,
                                  args.kf_width, args.kf_height, seed, args.kf_lora, args.kf_lora_strength)
        pid = comfy_submit(kf_base, graph, client_id)
        entry = comfy_wait(kf_base, pid)
        got = False
        for fn, sub, ftype in _iter_output_files(entry):
            if fn.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                dest = outdir / f"keyframe_{i:02d}_seed{seed}.png"
                comfy_fetch(kf_base, fn, sub, ftype, dest)
                kf_paths.append(dest)
                got = True
                print(f"    keyframe {i} (seed {seed}) -> {dest.name}", flush=True)
                break
        if not got:
            print(f"    [!] keyframe {i} (seed {seed}) : aucune image produite", flush=True)

    if not kf_paths:
        print("Aucune keyframe generee. Serveur H3 lance ? modeles krea2 presents ?", file=sys.stderr)
        return 2

    # --- Etape 2 : score ArcFace des keyframes ----------------------------- #
    print(f"[2/4] Scoring ArcFace de {len(kf_paths)} keyframes vs {args.reference.name}...", flush=True)
    kf_scores = score_arcface(args.arcface_python, args.scorer, args.reference, kf_paths, outdir / "keyframes-arcface.json")
    for r in kf_scores:
        r["name"] = Path(r["path"]).name
    kf_scores.sort(key=lambda r: (r.get("arcface") or -1.0), reverse=True)
    report["keyframes"] = kf_scores
    for r in kf_scores:
        print(f"    {r['name']:32s} ArcFace={r.get('arcface')}", flush=True)
    best = kf_scores[0]
    best_path = Path(best["path"])
    report["best_keyframe"] = {"name": best_path.name, "arcface": best.get("arcface")}
    print(f"  => MEILLEURE keyframe : {best_path.name} (ArcFace={best.get('arcface')}, seuil 0,55)", flush=True)

    if args.skip_i2v:
        (outdir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[skip-i2v] Rapport: {outdir / 'report.json'}", flush=True)
        return 0

    # --- Etape 3 : i2v H3 avec la meilleure keyframe ----------------------- #
    print("[3/4] i2v H3 (MiniMaxH3ImageToVideo, first_frame)...", flush=True)
    served = comfy_upload_image(base, best_path)
    print(f"    keyframe uploadee -> {served}", flush=True)
    stab = args.stabilizer_lora.strip()
    graph = build_h3_i2v_graph(args.i2v_prompt, served, args.i2v_unet, args.i2v_te, args.i2v_vae,
                               args.i2v_width, args.i2v_height, args.i2v_length, args.i2v_seed,
                               args.i2v_steps, stab or None, args.stabilizer_strength)
    pid = comfy_submit(base, graph, client_id)
    entry = comfy_wait(base, pid, timeout_s=3600)
    video_path = None
    for fn, sub, ftype in _iter_output_files(entry):
        if fn.lower().endswith((".mp4", ".webm", ".mkv", ".mov")):
            video_path = comfy_fetch(base, fn, sub, ftype, outdir / "lisa-bestof-i2v.mp4")
            break
    if video_path is None:
        print("i2v n'a pas produit de video. Voir /history.", file=sys.stderr)
        report["i2v"] = {"error": "no video output"}
        (outdir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        return 3
    print(f"    video -> {video_path}", flush=True)
    report["i2v"] = {"video": str(video_path), "stabilizer_lora": stab or None}

    # --- Etape 4 : valider l'identite de la video -------------------------- #
    print("[4/4] Extraction frames + ArcFace video...", flush=True)
    frames = extract_frames(video_path, outdir)
    if frames:
        vid_scores = score_arcface(args.arcface_python, args.scorer, args.reference, frames, outdir / "video-arcface.json")
        for r in vid_scores:
            r["name"] = Path(r["path"]).name
            print(f"    {r['name']:24s} ArcFace={r.get('arcface')}", flush=True)
        report["i2v"]["frame_scores"] = vid_scores
        vals = [r["arcface"] for r in vid_scores if r.get("arcface") is not None]
        if vals:
            report["i2v"]["arcface_min"] = min(vals)
            report["i2v"]["arcface_mean"] = sum(vals) / len(vals)

    (outdir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nRapport complet : {outdir / 'report.json'}", flush=True)
    kf_a = report["best_keyframe"]["arcface"]
    vid_a = report["i2v"].get("arcface_mean")
    print(f"Bilan identite : keyframe={kf_a} -> i2v(moy)={vid_a} (loi de propagation)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
