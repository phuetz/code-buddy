#!/usr/bin/env python3
"""Pipeline food Ambre par pays (méthodo VALIDÉE 18/08 : plat en CONTEXTE local + ambiance, HD).
Pour chaque pays : narration qwen -> voix Ambre (ElevenLabs) -> photos Pexels HD contextuelles
(1 ambiance + 3 plats) -> montage Ken Burns + titres + musique.
Usage: python3 food_pays.py jobs_food.json
jobs = [{"pays":"Japon","art":"au","plats":["Sushi","Ramen","Tempura"],
         "amb":"Japan restaurant lantern street","q":["sushi restaurant japan","ramen bowl japan","tempura dish japan"]}]
"""
import os, sys, json, re, time, subprocess, urllib.request, urllib.parse, tempfile

KEY = os.environ["PEXELS_API_KEY"]; EKEY = os.environ["ELEVENLABS_API_KEY"]; VOICE = "UaGvaD7NWzU5mJNoUqoY"
UA = "Mozilla/5.0 (AmbreBot)"
OUT = os.path.expanduser("~/.codebuddy/personas/ambre/talk-videos/food")
NARRD = os.path.expanduser("~/.codebuddy/personas/ambre/narrations-food")
MUSIC = os.path.expanduser("~/.codebuddy/media-audio/music/elegant/ES_Somewhat Elegant - Dye O.mp3")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
os.makedirs(OUT, exist_ok=True); os.makedirs(NARRD, exist_ok=True)

def qwen(prompt):
    body = json.dumps({"model": "qwen3.8:27b", "prompt": prompt, "stream": False, "think": False,
                       "options": {"temperature": 0.6, "num_ctx": 4096}}).encode()
    for host in ("http://gpuNode:11434", "http://127.0.0.1:11434"):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(host + "/api/generate", data=body,
                headers={"Content-Type": "application/json"}), timeout=180).read()).get("response", "")
            return re.sub(r"<think>.*?</think>", "", r, flags=re.DOTALL).strip()
        except Exception:
            continue
    return ""

def eleven(text, path):
    r = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}",
        data=json.dumps({"text": text, "model_id": "eleven_multilingual_v2",
                         "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.2}}).encode(),
        headers={"xi-api-key": EKEY, "Content-Type": "application/json"})
    open(path, "wb").write(urllib.request.urlopen(r, timeout=120).read())

def pexels_hd(query, dest):
    u = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({"query": query, "per_page": 5, "orientation": "landscape"})
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": KEY, "User-Agent": UA}), timeout=30))
        p = d["photos"][0]; src = p["src"].get("large2x") or p["src"].get("original")  # HD
        open(dest, "wb").write(urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": UA}), timeout=60).read())
        return True
    except Exception as e:
        print("  pexels err", query, e); return False

def kb(img, dur, out):
    subprocess.run(["ffmpeg", "-v", "error", "-i", img, "-vf",
        f"scale=2400:1350:force_original_aspect_ratio=increase,crop=2400:1350,zoompan=z='min(zoom+0.0006,1.12)':d={int(dur*25)}:s=1920x1080:fps=25",
        "-t", str(dur), "-c:v", "libx264", "-pix_fmt", "yuv420p", out, "-y"], check=False)

def produce(job):
    pays = job["pays"]; art = job.get("art", "en"); plats = job["plats"]; slug = re.sub(r'[^a-z0-9]+', '-', pays.lower()).strip('-')
    out = f"{OUT}/food-{slug}.mp4"
    if os.path.exists(out) and os.path.getsize(out) > 500000:
        print(f"[{pays}] déjà fait"); return out
    # 1) narration
    prompt = (f"Tu es Ambre, présentatrice voyage. Écris la narration PARLÉE (≈90 mots, ~35s) d'un short "
              f"« 3 plats à goûter {art} {pays} » : {plats[0]}, {plats[1]}, {plats[2]}. Accroche avec le nom du pays, "
              f"puis 2 phrases sensorielles et factuelles par plat, puis une chute qui donne envie de voyager. "
              f"UNIQUEMENT le texte parlé (aucun titre/liste/emoji/didascalie), français impeccable, jamais « j'ai goûté ».")
    txt = qwen(prompt)
    txt = re.sub(r'[#*]', '', txt).strip()
    if len(txt) < 120:
        print(f"[{pays}] narration trop courte"); return None
    npath = f"{NARRD}/{slug}.mp3"
    try: eleven(txt, npath)
    except Exception as e: print(f"[{pays}] voix err {e}"); return None
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", npath], capture_output=True, text=True).stdout.strip())
    # 2) photos HD : ambiance + 3 plats
    W = tempfile.mkdtemp(prefix=f"food-{slug}-")
    imgs = []
    if pexels_hd(job["amb"], f"{W}/amb.jpg"): imgs.append(("amb", f"{W}/amb.jpg"))
    for i, q in enumerate(job["q"][:3]):
        if pexels_hd(q, f"{W}/p{i}.jpg"): imgs.append((f"p{i}", f"{W}/p{i}.jpg"))
    if len(imgs) < 3:
        print(f"[{pays}] pas assez de photos"); return None
    # 3) montage : intro ambiance (4s) + 3 plats répartis sur le reste
    nplats = len(imgs) - 1  # hors ambiance
    per = (dur - 4) / nplats
    clips = []
    kb(imgs[0][1], 4, f"{W}/c_amb.mp4"); clips.append(f"{W}/c_amb.mp4")
    for i in range(1, len(imgs)):
        c = f"{W}/c{i}.mp4"; kb(imgs[i][1], per + 0.4, c); clips.append(c)
    lst = f"{W}/l.txt"; open(lst, "w").write("\n".join(f"file '{c}'" for c in clips))
    broll = f"{W}/b.mp4"; subprocess.run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", broll, "-y"], check=False)
    # titres
    tf = lambda n, s: (open(f"{W}/{n}.txt", "w").write(s), f"{W}/{n}.txt")[1]
    t0 = tf("t0", f"3 PLATS À GOÛTER {art.upper()} {pays.upper()}")
    tt = [tf(f"t{i+1}", f"{i+1}. {plats[i].upper()}") for i in range(3)]
    # fenêtres titres plats : après l'intro
    b1, b2, b3 = 4, 4 + per, 4 + 2 * per
    dt = f"drawtext=fontfile={FONT}:textfile={t0}:fontsize=70:fontcolor=white:borderw=4:bordercolor=black:x=(w-tw)/2:y=(h-th)/2:enable='lt(t,4)'"
    dt += f",drawtext=fontfile={FONT}:textfile={tt[0]}:fontsize=84:fontcolor=0xfbbf24:borderw=5:bordercolor=black:x=60:y=h-150:enable='between(t,{b1},{b2})'"
    dt += f",drawtext=fontfile={FONT}:textfile={tt[1]}:fontsize=84:fontcolor=0xfbbf24:borderw=5:bordercolor=black:x=60:y=h-150:enable='between(t,{b2},{b3})'"
    dt += f",drawtext=fontfile={FONT}:textfile={tt[2]}:fontsize=84:fontcolor=0xfbbf24:borderw=5:bordercolor=black:x=60:y=h-150:enable='gt(t,{b3})'"
    fc = f"[0:v]{dt}[v];[2:a]volume=0.10[m];[1:a][m]amix=inputs=2:duration=first[a]"
    subprocess.run(["ffmpeg", "-v", "error", "-i", broll, "-i", npath, "-stream_loop", "-1", "-i", MUSIC,
        "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", str(dur),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", out, "-y"], check=False)
    subprocess.run(["rm", "-rf", W])
    ok = os.path.exists(out) and os.path.getsize(out) > 500000
    print(f"[{pays}] {'✅' if ok else '❌'} {os.path.getsize(out)//1024 if ok else 0} Ko")
    return out if ok else None

def main():
    jobs = json.load(open(sys.argv[1]))
    done = []
    for j in jobs:
        r = produce(j)
        if r: done.append(r)
    print(f"\n=== FOOD PAYS : {len(done)}/{len(jobs)} ===")
    for d in done: print(" ", d)

if __name__ == "__main__":
    main()
