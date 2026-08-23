#!/usr/bin/env python3
"""B-roll LOCAL $0 sans quota sur darkstar : texte → image (Krea 2 Turbo) → vidéo (WAN 2.2 i2v).
Remplace Grok Imagine quand le quota est grillé. Même format de jobs que grok_imagine.py.

Usage:
  python3 broll_local.py jobs.json            # jobs = [{"name":..., "prompt":..., "aspect_ratio":"16:9"}, ...]
  python3 broll_local.py --one <name> "<prompt>" [16:9|9:16]
Env: COMFYUI_URL (défaut http://darkstar:8188), BROLL_OUT (défaut ~/.codebuddy/personas/lisa/broll-local),
     BROLL_QUALITY=fast|full (fast = LoRA lightx2v 4 pas, défaut ; full = 20 pas cfg 3.5, ~10× plus lent)
Sortie: <BROLL_OUT>/<name>.mp4 (+ <name>.png keyframe). Reprend là où il en était (saute les mp4 existants).
"""
import json, sys, os, time, urllib.request, urllib.parse, mimetypes, uuid, zlib

HOST = os.environ.get("COMFYUI_URL", "http://darkstar:8188")
OUT = os.path.expanduser(os.environ.get("BROLL_OUT", "~/.codebuddy/personas/lisa/broll-local"))
os.makedirs(OUT, exist_ok=True)
NEG = ("blurry, distorted, low quality, low resolution, static, watermark, text, letters, logo, "
       "deformed, ugly, jpeg artifacts, oversaturated, face, person")
IMG_SUFFIX = ", cinematic still, photorealistic, highly detailed, dramatic lighting, no text, no watermark"
VID_SUFFIX = ", smooth slow cinematic camera motion, subtle natural movement, high quality"

SIZES = {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (960, 960)}
# BROLL_SIZE=832x480 (ou 640x360…) force la taille 16:9 — pour mesurer/accélérer sur une 3090
if os.environ.get("BROLL_SIZE"):
    _w, _h = (int(x) for x in os.environ["BROLL_SIZE"].lower().split("x"))
    SIZES = {"16:9": (_w, _h), "9:16": (_h, _w), "1:1": (min(_w, _h), min(_w, _h))}


def _post(path, payload, timeout=120):
    req = urllib.request.Request(f"{HOST}{path}", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def _get(path, timeout=60):
    return json.load(urllib.request.urlopen(f"{HOST}{path}", timeout=timeout))


def upload_image(path):
    boundary = "----brollboundary" + uuid.uuid4().hex[:8]
    fn = os.path.basename(path)
    data = open(path, "rb").read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{fn}\"\r\n"
            f"Content-Type: {mimetypes.guess_type(path)[0] or 'image/png'}\r\n\r\n").encode() \
           + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{HOST}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.load(urllib.request.urlopen(req, timeout=120))["name"]


def krea2_graph(prompt, w, h, seed):
    # Krea 2 Turbo : 8 pas euler/simple, cfg 1 + ConditioningZeroOut (workflow officiel, cf. best-of-n-keyframes.py)
    return {
        "4": {"class_type": "UNETLoader", "inputs": {"unet_name": "krea2_turbo_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "6": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_4b_fp8_scaled.safetensors", "type": "krea2", "device": "default"}},
        "7": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "8": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt + IMG_SUFFIX, "clip": ["6", 0]}},
        "10": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["8", 0]}},
        "3": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 8, "cfg": 1.0, "sampler_name": "euler",
                                                   "scheduler": "simple", "denoise": 1.0, "model": ["4", 0],
                                                   "positive": ["8", 0], "negative": ["10", 0], "latent_image": ["5", 0]}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["7", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "broll-kf", "images": ["11", 0]}},
    }


QUALITY = os.environ.get("BROLL_QUALITY", "fast")  # fast = LoRA lightx2v 4 pas (≈5-8× plus rapide) | full = 20 pas cfg 3.5


def wan_graph(img_name, prompt, w, h, length, seed):
    # WAN 2.2 i2v 14B fp8, 2 étages high/low noise (cf. wan_local.py)
    fast = QUALITY != "full"
    steps, cfg, split, shift = (4, 1.0, 2, 5.0) if fast else (20, 3.5, 10, 8.0)
    g = {
        "10": {"class_type": "UNETLoader", "inputs": {"unet_name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "11": {"class_type": "UNETLoader", "inputs": {"unet_name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "12": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["10", 0], "shift": 8.0}},
        "13": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["11", 0], "shift": 8.0}},
        "20": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan"}},
        "21": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["20", 0], "text": prompt + VID_SUFFIX}},
        "22": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["20", 0], "text": NEG}},
        "30": {"class_type": "VAELoader", "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
        "40": {"class_type": "LoadImage", "inputs": {"image": img_name}},
        "50": {"class_type": "WanImageToVideo", "inputs": {"positive": ["21", 0], "negative": ["22", 0], "vae": ["30", 0],
                                                            "width": w, "height": h, "length": length, "batch_size": 1,
                                                            "start_image": ["40", 0]}},
        "60": {"class_type": "KSamplerAdvanced", "inputs": {"model": ["12", 0], "add_noise": "enable", "noise_seed": seed,
                                                            "steps": 20, "cfg": 3.5, "sampler_name": "euler", "scheduler": "simple",
                                                            "positive": ["50", 0], "negative": ["50", 1], "latent_image": ["50", 2],
                                                            "start_at_step": 0, "end_at_step": 10, "return_with_leftover_noise": "enable"}},
        "61": {"class_type": "KSamplerAdvanced", "inputs": {"model": ["13", 0], "add_noise": "disable", "noise_seed": seed,
                                                            "steps": 20, "cfg": 3.5, "sampler_name": "euler", "scheduler": "simple",
                                                            "positive": ["50", 0], "negative": ["50", 1], "latent_image": ["60", 0],
                                                            "start_at_step": 10, "end_at_step": 20, "return_with_leftover_noise": "disable"}},
        "70": {"class_type": "VAEDecode", "inputs": {"samples": ["61", 0], "vae": ["30", 0]}},
        "80": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["70", 0], "frame_rate": 16, "loop_count": 0,
                                                            "filename_prefix": "broll", "format": "video/h264-mp4",
                                                            "pingpong": False, "save_output": True}},
    }
    if fast:
        g["14"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", "strength_model": 1.0, "model": ["10", 0]}}
        g["15"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", "strength_model": 1.0, "model": ["11", 0]}}
        g["12"]["inputs"]["model"] = ["14", 0]
        g["13"]["inputs"]["model"] = ["15", 0]
    for n in ("12", "13"):
        g[n]["inputs"]["shift"] = shift
    for n in ("60", "61"):
        g[n]["inputs"]["steps"] = steps
        g[n]["inputs"]["cfg"] = cfg
    g["60"]["inputs"]["end_at_step"] = split
    g["61"]["inputs"]["start_at_step"] = split
    return g


def run_graph(graph, timeout=2400, label=""):
    pid = _post("/prompt", {"prompt": graph, "client_id": "broll-local"})["prompt_id"]
    t0 = time.time()
    last = 0
    while time.time() - t0 < timeout:
        time.sleep(5)
        try:
            hist = _get(f"/history/{pid}", 30)
        except Exception:
            continue
        if pid in hist:
            st = hist[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI error {label}: {json.dumps(st)[:600]}")
            return hist[pid].get("outputs", {}), int(time.time() - t0)
        if time.time() - last > 60:
            last = time.time()
            print(f"  ...{label} {int(time.time()-t0)}s", flush=True)
    raise TimeoutError(f"timeout {label}")


def fetch(fileinfo, dest):
    url = f"{HOST}/view?" + urllib.parse.urlencode({"filename": fileinfo["filename"],
                                                   "subfolder": fileinfo.get("subfolder", ""),
                                                   "type": fileinfo.get("type", "output")})
    open(dest, "wb").write(urllib.request.urlopen(url, timeout=300).read())
    return dest


def make_clip(name, prompt, ratio="16:9", length=int(os.environ.get("BROLL_LENGTH", "81")), seed=None):
    w, h = SIZES.get(ratio, SIZES["16:9"])
    seed = seed if seed is not None else (zlib.crc32(name.encode()) % 2_000_000_000)
    dest_mp4 = os.path.join(OUT, f"{name}.mp4")
    dest_png = os.path.join(OUT, f"{name}.png")
    if os.path.exists(dest_mp4) and os.path.getsize(dest_mp4) > 0:
        print(f"⏭  {name}: déjà fait", flush=True); return dest_mp4
    t0 = time.time()
    if not os.path.exists(dest_png):
        print(f"🖼  {name}: keyframe Krea2 {w}x{h}…", flush=True)
        outs, dt = run_graph(krea2_graph(prompt, w, h, seed), label=f"{name}/krea2")
        imgs = [i for o in outs.values() for i in o.get("images", [])]
        if not imgs: raise RuntimeError(f"{name}: aucune image produite")
        fetch(imgs[0], dest_png)
        print(f"   keyframe ok en {dt}s", flush=True)
    img_name = upload_image(dest_png)
    print(f"🎞  {name}: WAN 2.2 i2v {w}x{h} {length}f ({length/16:.1f}s) mode={QUALITY}…", flush=True)
    outs, dt = run_graph(wan_graph(img_name, prompt, w, h, length, seed), label=f"{name}/wan")
    vids = [v for o in outs.values() for v in (o.get("gifs") or o.get("videos") or [])]
    if not vids: raise RuntimeError(f"{name}: aucune vidéo produite")
    fetch(vids[0], dest_mp4)
    print(f"✅ {name}: {dest_mp4} ({os.path.getsize(dest_mp4)//1024} Ko) total {int(time.time()-t0)}s", flush=True)
    return dest_mp4


def main():
    if len(sys.argv) >= 4 and sys.argv[1] == "--one":
        name, prompt = sys.argv[2], sys.argv[3]
        ratio = sys.argv[4] if len(sys.argv) > 4 else "16:9"
        make_clip(name, prompt, ratio); return
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    ok = fail = 0
    for j in jobs:
        try:
            make_clip(j["name"], j["prompt"], j.get("aspect_ratio", "16:9"), int(j.get("length", 81)))
            ok += 1
        except Exception as e:
            fail += 1
            print(f"❌ {j.get('name')}: {e}", flush=True)
    print(f"— fin : {ok} ok, {fail} échecs → {OUT}", flush=True)


if __name__ == "__main__":
    main()
