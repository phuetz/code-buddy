#!/usr/bin/env python3
"""Pilote batch Grok Imagine (xAI) — images + vidéos 1080p par API, token SuperGrok (auto-refresh).
Usage: python3 grok_imagine.py jobs.json
jobs.json = [
  {"name":"grece-santorin","mode":"video","ref_pexels":"Santorini Greece sunset","prompt":"slow aerial push-in ...","duration":6,"aspect_ratio":"16:9","resolution":"1080p"},
  {"name":"affiche","mode":"image","prompt":"cinematic poster ..."}
]
- mode "video": image->video si ref_pexels/ref_url fourni, sinon text->video. async + polling.
- mode "image": /v1/images/generations.
Sortie: ~/.codebuddy/personas/ambre/grok-imagine/<name>.(mp4|jpg)  + sauvegarde /data.
Robuste (pas de navigateur/CDP) — refresh OAuth sur 401/403.
"""
import json, os, sys, time, base64, subprocess, urllib.request, urllib.parse, urllib.error

AUTH = os.path.expanduser("~/.codebuddy/xai-auth.json")
CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
OUT = os.path.expanduser(os.environ.get("GROK_IMAGINE_OUT", "~/.codebuddy/personas/ambre/grok-imagine"))  # surcharge par env (lots Lisa)
BACKUP = "/data/backups/media/grok-imagine"
os.makedirs(OUT, exist_ok=True)

def load(): return json.load(open(AUTH))
def token(): return load()["tokens"].get("access_token", "")

def refresh():
    d = load()
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "client_id": CLIENT_ID,
                                   "refresh_token": d["tokens"]["refresh_token"]}).encode()
    ep = d.get("discovery", {}).get("token_endpoint", "https://auth.x.ai/oauth2/token")
    r = json.load(urllib.request.urlopen(urllib.request.Request(
        ep, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}), timeout=30))
    d["tokens"]["access_token"] = r["access_token"]
    if r.get("refresh_token"): d["tokens"]["refresh_token"] = r["refresh_token"]
    json.dump(d, open(AUTH, "w"), indent=2)
    print("  (token rafraîchi)", flush=True)

def api(method, path, body=None, _retry=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request("https://api.x.ai" + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token(),
                                          "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=80))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) and _retry:
            refresh(); return api(method, path, body, _retry=False)
        return {"_http": e.code, "_body": e.read().decode()[:300]}
    except Exception as e:
        return {"_err": str(e)}

def pexels_url(query):
    key = os.environ.get("PEXELS_API_KEY", "")
    if not key: return None
    u = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode(
        {"query": query, "per_page": 5, "orientation": "landscape"})
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(
            u, headers={"Authorization": key, "User-Agent": "Mozilla/5.0"}), timeout=30))
        p = d["photos"][0]
        return p["src"].get("original") or p["src"].get("large2x")
    except Exception as e:
        print("  pexels err", e); return None

def gen_image(job):
    r = api("POST", "/v1/images/generations",
            {"model": job.get("model", "grok-imagine-image"), "prompt": job["prompt"], "n": 1})
    if isinstance(r, dict) and r.get("data"):
        it = r["data"][0]; dest = os.path.join(OUT, job["name"] + ".jpg")
        if it.get("url"):
            open(dest, "wb").write(urllib.request.urlopen(urllib.request.Request(
                it["url"], headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read())
        elif it.get("b64_json"):
            open(dest, "wb").write(base64.b64decode(it["b64_json"]))
        else:
            return None
        return dest
    print(f"  [{job['name']}] image ->", json.dumps(r)[:160]); return None

def gen_video(job):
    body = {"model": "grok-imagine-video-1.5", "prompt": job["prompt"],
            "duration": job.get("duration", 6),
            "aspect_ratio": job.get("aspect_ratio", "16:9"),
            "resolution": job.get("resolution", "1080p")}
    ref = job.get("ref_url") or (pexels_url(job["ref_pexels"]) if job.get("ref_pexels") else None)
    if ref: body["image"] = {"url": ref}
    r = api("POST", "/v1/videos/generations", body)
    rid = r.get("request_id") if isinstance(r, dict) else None
    if not rid:
        print(f"  [{job['name']}] video ->", json.dumps(r)[:180]); return None
    for _ in range(40):
        time.sleep(9)
        s = api("GET", f"/v1/videos/{rid}")
        st = s.get("status") if isinstance(s, dict) else None
        if st == "done":
            url = s["video"]["url"]; dest = os.path.join(OUT, job["name"] + ".mp4")
            open(dest, "wb").write(urllib.request.urlopen(urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0"}), timeout=180).read())
            return dest
        if st in ("failed", "expired"):
            print(f"  [{job['name']}] {st}:", json.dumps(s)[:160]); return None
    print(f"  [{job['name']}] timeout polling"); return None

def probe(path):
    return subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
                           "-show_entries", "format=duration", "-of", "default=nw=1", path],
                          capture_output=True, text=True).stdout.replace("\n", " ").strip()

def main():
    jobs = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else json.load(sys.stdin)
    done = []
    for j in jobs:
        name = j["name"]; ext = "jpg" if j.get("mode") == "image" else "mp4"
        dest = os.path.join(OUT, f"{name}.{ext}")
        if os.path.exists(dest) and os.path.getsize(dest) > 50000:
            print(f"[{name}] déjà fait, skip", flush=True); done.append(dest); continue
        print(f"[{name}] {j.get('mode','video')} {j.get('resolution','1080p')} ref={j.get('ref_pexels') or j.get('ref_url') or '-'} ...", flush=True)
        r = gen_image(j) if j.get("mode") == "image" else gen_video(j)
        if r:
            print(f"  -> {r} ({os.path.getsize(r)//1024} Ko) {probe(r)}", flush=True)
            open(os.path.join(OUT, f"{name}.txt"), "w").write(j["prompt"])
            done.append(r)
        else:
            print(f"[{name}] ÉCHEC", flush=True)
    # sauvegarde /data
    if done:
        os.makedirs(BACKUP, exist_ok=True)
        subprocess.run(["rsync", "-a", OUT + "/", BACKUP + "/"], check=False)
    print(f"\n=== TERMINÉ : {len(done)}/{len(jobs)} ===")
    for d in done: print(" ", d)

if __name__ == "__main__":
    main()
