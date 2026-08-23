#!/usr/bin/env python3
"""Pilote WAN 2.2 image-to-video LOCAL via ComfyUI darkstar ($0, sans quota).
Usage: python3 wan_local.py <image.jpg> "<prompt>" <name> [width] [height] [length]
Upload l'image -> workflow WAN 2.2 i2v (2-stage high/low noise) -> poll -> télécharge le mp4.
Sortie: ~/.codebuddy/personas/ambre/wan-local/<name>.mp4
"""
import json, sys, os, time, urllib.request, urllib.parse, mimetypes

HOST = os.environ.get("COMFYUI_URL", "http://darkstar:8188")
OUT = os.path.expanduser("~/.codebuddy/personas/ambre/wan-local")
os.makedirs(OUT, exist_ok=True)
NEG = "blurry, distorted, low quality, low resolution, static, watermark, text, deformed, ugly, jpeg artifacts, oversaturated"

def upload_image(path):
    boundary = "----wanboundary1234"
    fn = os.path.basename(path)
    data = open(path, "rb").read()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{fn}\"\r\n"
        f"Content-Type: {mimetypes.guess_type(path)[0] or 'image/jpeg'}\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{HOST}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    r = json.load(urllib.request.urlopen(req, timeout=60))
    return r["name"]

def build_workflow(img_name, prompt, w, h, length, seed):
    return {
        "10": {"class_type": "UNETLoader", "inputs": {"unet_name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "11": {"class_type": "UNETLoader", "inputs": {"unet_name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", "weight_dtype": "default"}},
        "12": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["10", 0], "shift": 8.0}},
        "13": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["11", 0], "shift": 8.0}},
        "20": {"class_type": "CLIPLoader", "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan"}},
        "21": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["20", 0], "text": prompt}},
        "22": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["20", 0], "text": NEG}},
        "30": {"class_type": "VAELoader", "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
        "40": {"class_type": "LoadImage", "inputs": {"image": img_name}},
        "50": {"class_type": "WanImageToVideo", "inputs": {"positive": ["21", 0], "negative": ["22", 0], "vae": ["30", 0], "width": w, "height": h, "length": length, "batch_size": 1, "start_image": ["40", 0]}},
        "60": {"class_type": "KSamplerAdvanced", "inputs": {"model": ["12", 0], "add_noise": "enable", "noise_seed": seed, "steps": 20, "cfg": 3.5, "sampler_name": "euler", "scheduler": "simple", "positive": ["50", 0], "negative": ["50", 1], "latent_image": ["50", 2], "start_at_step": 0, "end_at_step": 10, "return_with_leftover_noise": "enable"}},
        "61": {"class_type": "KSamplerAdvanced", "inputs": {"model": ["13", 0], "add_noise": "disable", "noise_seed": seed, "steps": 20, "cfg": 3.5, "sampler_name": "euler", "scheduler": "simple", "positive": ["50", 0], "negative": ["50", 1], "latent_image": ["60", 0], "start_at_step": 10, "end_at_step": 20, "return_with_leftover_noise": "disable"}},
        "70": {"class_type": "VAEDecode", "inputs": {"samples": ["61", 0], "vae": ["30", 0]}},
        "80": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["70", 0], "frame_rate": 16, "loop_count": 0, "filename_prefix": "wanlocal", "format": "video/h264-mp4", "pingpong": False, "save_output": True}},
    }

def main():
    img, prompt, name = sys.argv[1], sys.argv[2], sys.argv[3]
    w = int(sys.argv[4]) if len(sys.argv) > 4 else 1280
    h = int(sys.argv[5]) if len(sys.argv) > 5 else 720
    length = int(sys.argv[6]) if len(sys.argv) > 6 else 49
    seed = 12345
    print(f"upload {img} -> {HOST}", flush=True)
    img_name = upload_image(img)
    wf = build_workflow(img_name, prompt, w, h, length, seed)
    req = urllib.request.Request(f"{HOST}/prompt", data=json.dumps({"prompt": wf}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        print("ERREUR /prompt:", e.read().decode()[:500]); return
    pid = r["prompt_id"]
    print(f"prompt_id={pid} | génération WAN 2.2 {w}x{h} {length}f...", flush=True)
    t0 = time.time()
    while time.time() - t0 < 1800:
        time.sleep(10)
        try:
            hist = json.load(urllib.request.urlopen(f"{HOST}/history/{pid}", timeout=30))
        except Exception:
            continue
        if pid in hist:
            outs = hist[pid].get("outputs", {})
            for node_out in outs.values():
                vids = node_out.get("gifs") or node_out.get("videos") or []
                for v in vids:
                    fn, sub, typ = v["filename"], v.get("subfolder", ""), v.get("type", "output")
                    url = f"{HOST}/view?" + urllib.parse.urlencode({"filename": fn, "subfolder": sub, "type": typ})
                    dest = os.path.join(OUT, f"{name}.mp4")
                    open(dest, "wb").write(urllib.request.urlopen(url, timeout=120).read())
                    print(f"✅ WAN LOCAL: {dest} ({os.path.getsize(dest)//1024} Ko) en {int(time.time()-t0)}s", flush=True)
                    return
            st = hist[pid].get("status", {})
            if st.get("status_str") == "error":
                print("ÉCHEC génération:", json.dumps(st)[:400]); return
        # progression
        try:
            q = json.load(urllib.request.urlopen(f"{HOST}/queue", timeout=10))
            print(f"  ...{int(time.time()-t0)}s (running={len(q.get('queue_running',[]))})", flush=True)
        except Exception:
            pass
    print("timeout 30min")

if __name__ == "__main__":
    main()
