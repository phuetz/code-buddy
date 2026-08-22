#!/usr/bin/env python3
"""Batch vidéo/image via l'API ElevenLabs « Image & Video » (plan Pro) — Veo 3.1 (fast/standard), Seedance 2.x (si le
support a activé ByteDance), etc. Découvert le 22/08/2026 : les crédits ElevenLabs (mêmes que la voix) paient aussi la
vidéo ; ~400 k crédits expiraient le 27/08 → ce script les convertit en B-roll.

Usage : elevenlabs_video.py jobs.json [--out DIR] [--budget N] [--dry-run] [--parallel K]
jobs.json = [{"name":"L1-price-meter","prompt":"…","model":"veo-3.1-fast-generate-001","duration":8,
              "resolution":"720p","aspect_ratio":"16:9","audio":true, "image_ref":"/chemin/optionnel.jpg"}, …]
- model : veo-3.1-fast-generate-001 (défaut) | veo-3.1-generate-001 | bytedance-seedance-v2.5 | bytedance-seedance-v2 …
- duration : Veo = 4/6/8 ; resolution : 720p/1080p/4K (coût ↑) ; aspect_ratio : 16:9 | 9:16.
- image_ref : image de référence envoyée en inline_base64 (Veo ≤ 3, Seedance ≤ 30).
- --budget N : arrêt quand (crédits consommés pendant ce run) ≥ N (mesuré via /v1/user/subscription avant/après).
- Reprise : un job dont le mp4 existe déjà est sauté. Journal : DIR/_journal.jsonl (coût réel par clip, durée, statut).
Clé : ELEVENLABS_API_KEY dans ~/.codebuddy/media.env (ou l'env). Coût mesuré le 22/08 : Veo fast 8 s 720p 16:9 = 7 272 cr.
"""
import base64, json, mimetypes, os, re, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

API = "https://api.elevenlabs.io/v1"


def load_key():
    k = os.environ.get("ELEVENLABS_API_KEY", "")
    if not k:
        for f in (os.path.expanduser("~/.codebuddy/media.env"), os.path.expanduser("~/.codebuddy/lisa.env")):
            try:
                for line in open(f, encoding="utf-8"):
                    m = re.match(r"^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
                    if m:
                        return m.group(1)
            except FileNotFoundError:
                pass
    return k


def req(method, path, key, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method,
                               headers={"xi-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.load(resp)


def credits_used(key):
    return req("GET", "/user/subscription", key)["character_count"]


def inline_image(path):
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    return {"type": "inline_base64", "content": base64.b64encode(open(path, "rb").read()).decode(), "mime_type": mime}


def find_url(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ("content_url", "url") and isinstance(v, str) and v.startswith("http"):
                return v
            r = find_url(v)
            if r:
                return r
    if isinstance(o, list):
        for v in o:
            r = find_url(v)
            if r:
                return r
    return None


def run_job(job, key, out_dir, dry):
    name = job["name"]
    out = os.path.join(out_dir, name + ".mp4")
    if os.path.exists(out) and os.path.getsize(out) > 100_000:
        return {"name": name, "skipped": True, "out": out}
    body = {
        "model_id": job.get("model", "veo-3.1-fast-generate-001"),
        "prompt": job["prompt"],
        "duration_secs": int(job.get("duration", 8)),
        "resolution": job.get("resolution", "720p"),
        "aspect_ratio": job.get("aspect_ratio", "16:9"),
        "generate_audio": bool(job.get("audio", True)),
    }
    if job.get("image_ref") and os.path.exists(os.path.expanduser(job["image_ref"])):
        body["images"] = [inline_image(os.path.expanduser(job["image_ref"]))]
    if dry:
        return {"name": name, "dryRun": True, "body": {k: v for k, v in body.items() if k != "images"}}
    t0 = time.time()
    try:
        r = req("POST", "/flows/video", key, body)
    except urllib.error.HTTPError as e:
        return {"name": name, "error": f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"}
    gid = r.get("id")
    status = r.get("status")
    while status not in ("completed", "failed") and time.time() - t0 < 900:
        time.sleep(10)
        try:
            s = req("GET", f"/flows/video/{gid}", key)
            status = s.get("status")
        except urllib.error.HTTPError as e:
            return {"name": name, "id": gid, "error": f"poll HTTP {e.code}"}
    if status != "completed":
        return {"name": name, "id": gid, "error": f"status={status}", "detail": json.dumps(s)[:300]}
    url = find_url(s)
    if not url:
        return {"name": name, "id": gid, "error": "no content_url", "detail": json.dumps(s)[:300]}
    urllib.request.urlretrieve(url, out)
    return {"name": name, "id": gid, "out": out, "seconds": round(time.time() - t0), "model": body["model_id"],
            "duration": body["duration_secs"], "resolution": body["resolution"], "aspect_ratio": body["aspect_ratio"]}


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    jobs = json.load(open(sys.argv[1]))
    out_dir = os.path.expanduser(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else os.path.dirname(os.path.abspath(sys.argv[1]))
    budget = int(sys.argv[sys.argv.index("--budget") + 1]) if "--budget" in sys.argv else None
    parallel = int(sys.argv[sys.argv.index("--parallel") + 1]) if "--parallel" in sys.argv else 3
    dry = "--dry-run" in sys.argv
    os.makedirs(out_dir, exist_ok=True)
    key = load_key()
    if not key:
        print("ELEVENLABS_API_KEY introuvable"); sys.exit(2)
    start = None if dry else credits_used(key)
    print(f"{len(jobs)} jobs → {out_dir} | crédits utilisés au départ : {start} | budget run : {budget or '∞'}{' | DRY-RUN' if dry else ''}")
    journal = open(os.path.join(out_dir, "_journal.jsonl"), "a")
    results = []
    # lots de `parallel` jobs : on mesure les crédits entre lots pour respecter le budget
    for i in range(0, len(jobs), parallel):
        if budget is not None and not dry:
            spent = credits_used(key) - start
            if spent >= budget:
                print(f"⏹ budget atteint ({spent} ≥ {budget}) — arrêt avant le job {i}"); break
        chunk = jobs[i:i + parallel]
        with ThreadPoolExecutor(max_workers=parallel) as ex:
            futs = {ex.submit(run_job, j, key, out_dir, dry): j for j in chunk}
            for f in as_completed(futs):
                r = f.result()
                results.append(r)
                if not dry:
                    r["credits_used_total"] = credits_used(key)
                    journal.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), **r}, ensure_ascii=False) + "\n"); journal.flush()
                tag = "✅" if r.get("out") and not r.get("skipped") else ("↷" if r.get("skipped") else ("·" if r.get("dryRun") else "❌"))
                print(f"  {tag} {r['name']} {r.get('error', '')} {r.get('seconds', '')}s".rstrip())
    if not dry:
        end = credits_used(key)
        print(f"crédits consommés par ce run : {end - start} (total utilisé {end})")
    json.dump(results, open(os.path.join(out_dir, "_results.json"), "w"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
