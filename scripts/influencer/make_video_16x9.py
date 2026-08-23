#!/usr/bin/env python3
"""Vidéo NARRÉE 16:9 (1920×1080) avec captions synchronisées — pendant paysage de make_short_narre.py.
Pour une présentation produit : plans = captures écran (mp4/gif, gardés tels quels, letterbox) ou B-roll 16:9,
voix + captions bas d'écran + titre (hook) les 3 premières secondes + musique douce.

Usage: make_video_16x9.py <voix.mp3> <narration.txt> <titre> <out.mp4> <plan1> [plan2 ...]
  - un plan = fichier vidéo/gif/png ; préfixe "N:" = durée forcée en secondes (ex: "12:docs/assets/x.mp4")
  - sans préfixe, les plans se partagent la durée restante de la voix (≥ 3 s chacun), bouclés si trop courts.
Env: VIDEO_MUSIC (mp3, défaut Somewhat Elegant), VIDEO_FONT, VIDEO_NO_MUSIC=1.
"""
import os, sys, re, subprocess, tempfile

FONT = os.environ.get("VIDEO_FONT", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
MUSIC = os.environ.get("VIDEO_MUSIC", os.path.expanduser("~/.codebuddy/media-audio/music/elegant/ES_Somewhat Elegant - Dye O.mp3"))
W, H = 1920, 1080
MAX_CHARS = 46  # largeur max d'une caption (fontsize 54 sur 1920 px)


def esc(s):
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def segments(text):
    parts = re.split(r'(?<=[.!?,:;])\s+', text.strip())
    segs = []
    for p in parts:
        p = p.strip().rstrip('.').strip()
        if not p:
            continue
        cur = []
        for w in p.split():
            if cur and len(" ".join(cur + [w])) > MAX_CHARS:
                segs.append(" ".join(cur)); cur = [w]
            else:
                cur.append(w)
        if cur:
            segs.append(" ".join(cur))
    out = []
    for s in segs:
        if out and len(s) <= 4 and len(out[-1]) + 1 + len(s) <= MAX_CHARS:
            out[-1] += " " + s
        else:
            out.append(s)
    return [s for s in out if s]


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def main():
    voix, narrtxt, titre, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    raw_plans = sys.argv[5:]
    dur = duration(voix)
    text = open(narrtxt, encoding="utf-8").read().strip()
    segs = segments(text)
    total_words = sum(len(s.split()) for s in segs) or 1
    t = 0.0; timed = []
    for s in segs:
        d = dur * len(s.split()) / total_words
        timed.append((s, t, t + d)); t += d
    # durées des plans : forcées (N:path) ou partagées
    plans = []
    for p in raw_plans:
        m = re.match(r'^(\d+(?:\.\d+)?):(.+)$', p)
        plans.append((float(m.group(1)) if m else None, m.group(2) if m else p))
    forced = sum(d for d, _ in plans if d)
    free = [i for i, (d, _) in enumerate(plans) if d is None]
    per = max(3.0, (dur - forced) / len(free)) if free else 0
    W_ = tempfile.mkdtemp()
    clips = []
    for i, (d, p) in enumerate(plans):
        d = d or per
        c = f"{W_}/c{i}.mp4"
        is_img = p.lower().endswith((".png", ".jpg", ".jpeg"))
        vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=25,setsar=1,format=yuv420p"
        if is_img:
            # Ken Burns léger sur image fixe
            vf = f"scale=2400:-1,zoompan=z='min(zoom+0.0008,1.08)':d={int(d*25)}:s={W}x{H}:fps=25,setsar=1,format=yuv420p"
            cmd = ["ffmpeg", "-v", "error", "-loop", "1", "-i", p, "-t", f"{d:.2f}", "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", c, "-y"]
        else:
            cmd = ["ffmpeg", "-v", "error", "-stream_loop", "-1", "-i", p, "-t", f"{d:.2f}", "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", c, "-y"]
        subprocess.run(cmd, check=False)
        clips.append(c)
    lst = f"{W_}/l.txt"; open(lst, "w").write("\n".join(f"file '{c}'" for c in clips))
    broll = f"{W_}/b.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", broll, "-y"], check=False)
    df = f"drawbox=y={H-190}:w={W}:h=150:color=black@0.45:t=fill"
    df += f",drawtext=fontfile={FONT}:text='{esc(titre)}':fontsize=64:fontcolor=white:borderw=5:bordercolor=black:x=(w-tw)/2:y=90:enable='lt(t,3.5)'"
    for s, a, b in timed:
        df += (f",drawtext=fontfile={FONT}:text='{esc(s)}':fontsize=54:fontcolor=white:borderw=4:bordercolor=black:"
               f"x=(w-tw)/2:y={H-150}:enable='between(t,{a:.2f},{b:.2f})'")
    if os.environ.get("VIDEO_NO_MUSIC") or not os.path.exists(MUSIC):
        fc = f"[0:v]{df}[v];[1:a]anull[a]"
        inputs = ["-i", broll, "-i", voix]
    else:
        fc = f"[0:v]{df}[v];[2:a]volume=0.07[m];[1:a][m]amix=inputs=2:duration=first[a]"
        inputs = ["-i", broll, "-i", voix, "-stream_loop", "-1", "-i", MUSIC]
    subprocess.run(["ffmpeg", "-v", "error", *inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-t", f"{dur:.2f}",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", out, "-y"], check=False)
    subprocess.run(["rm", "-rf", W_])
    ok = os.path.exists(out) and os.path.getsize(out) > 300000
    print(f"{'✅' if ok else '❌'} {out} ({os.path.getsize(out)//1024 if ok else 0} Ko, {dur:.1f}s, {len(segs)} captions, {len(plans)} plans)")


if __name__ == "__main__":
    main()
