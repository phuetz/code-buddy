#!/usr/bin/env python3
"""Short vertical NARRÉ 9:16 avec SOUS-TITRES synchronisés (codes viraux 2026 :
hook 1s, 4-beats, captions car 85% sans son, loop, 20-25s).
Usage: make_short_narre.py <voix.mp3> <narration.txt> <hook> <out.mp4> <plan1> [plan2 ...]
Les plans (16:9) sont recadrés en 9:16 et enchaînés ; le 1er plan est répété en fin (LOOP).
"""
import os, sys, re, subprocess, tempfile, json

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MUSIC = os.path.expanduser("~/.codebuddy/media-audio/music/elegant/ES_Somewhat Elegant - Dye O.mp3")

def esc(s):  # échappement drawtext
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")

MAX_CHARS = 22  # largeur max d'une caption (fontsize 58 sur 1080 px ≈ 24 car.) — jamais de débordement

def segments(text):
    # découpe en segments courts sur ponctuation, puis plafonne chaque segment à MAX_CHARS
    parts = re.split(r'(?<=[.!?,:;])\s+', text.strip())
    segs = []
    for p in parts:
        p = p.strip().rstrip('.').strip()
        if not p: continue
        words = p.split(); cur = []
        for w in words:
            if cur and len(" ".join(cur + [w])) > MAX_CHARS:
                segs.append(" ".join(cur)); cur = [w]
            else:
                cur.append(w)
        if cur: segs.append(" ".join(cur))
    # recoller un segment d'un seul mot très court au précédent si ça tient
    out = []
    for s in segs:
        if out and len(s) <= 4 and len(out[-1]) + 1 + len(s) <= MAX_CHARS:
            out[-1] = out[-1] + " " + s
        else:
            out.append(s)
    return [s for s in out if s]

def main():
    voix, narrtxt, hook, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    plans = sys.argv[5:]
    dur = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",voix],capture_output=True,text=True).stdout.strip())
    text = open(narrtxt, encoding="utf-8").read().strip()
    segs = segments(text)
    total_words = sum(len(s.split()) for s in segs) or 1
    # timings proportionnels au nombre de mots
    t = 0.0; timed = []
    for s in segs:
        d = dur * len(s.split()) / total_words
        timed.append((s, t, t + d)); t += d
    W = tempfile.mkdtemp()
    # plans 9:16 : recadrer + enchaîner ; ajouter le 1er plan en fin pour le LOOP
    seq = plans + [plans[0]]
    n = len(seq); per = dur / (n - 0.0)  # couvrir toute la durée
    per = max(3.0, dur / len(seq))
    clips = []
    for i, p in enumerate(seq):
        c = f"{W}/c{i}.mp4"
        subprocess.run(["ffmpeg","-v","error","-stream_loop","-1","-i",p,"-t",f"{per:.2f}",
            "-vf","crop=ih*9/16:ih,scale=1080:1920,fps=25,setsar=1","-an","-c:v","libx264","-pix_fmt","yuv420p",c,"-y"],check=False)
        clips.append(c)
    lst = f"{W}/l.txt"; open(lst,"w").write("\n".join(f"file '{c}'" for c in clips))
    broll = f"{W}/b.mp4"; subprocess.run(["ffmpeg","-v","error","-f","concat","-safe","0","-i",lst,"-c","copy",broll,"-y"],check=False)
    # filtergraph : hook (haut, 0-3s) + captions synchronisées (bas)
    df = f"drawbox=y=1350:w=1080:h=340:color=black@0.42:t=fill"
    df += f",drawtext=fontfile={FONT}:text='{esc(hook)}':fontsize=76:fontcolor=white:borderw=5:bordercolor=black:x=(w-tw)/2:y=170:enable='lt(t,3)'"
    for s, a, b in timed:
        df += (f",drawtext=fontfile={FONT}:text='{esc(s)}':fontsize=58:fontcolor=white:borderw=4:bordercolor=black:"
               f"x=(w-tw)/2:y=1420:line_spacing=12:enable='between(t,{a:.2f},{b:.2f})'")
    fc = f"[0:v]{df}[v];[2:a]volume=0.08[m];[1:a][m]amix=inputs=2:duration=first[a]"
    subprocess.run(["ffmpeg","-v","error","-i",broll,"-i",voix,"-stream_loop","-1","-i",MUSIC,
        "-filter_complex",fc,"-map","[v]","-map","[a]","-t",f"{dur:.2f}",
        "-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-ar","44100",out,"-y"],check=False)
    subprocess.run(["rm","-rf",W])
    ok = os.path.exists(out) and os.path.getsize(out) > 300000
    print(f"{'✅' if ok else '❌'} {out} ({os.path.getsize(out)//1024 if ok else 0} Ko, {dur:.1f}s, {len(segs)} captions)")

if __name__ == "__main__":
    main()
