#!/usr/bin/env python3
"""Batch de shorts « split Ninon » (format VALIDÉ par Patrice le 22/08/2026) à partir de clips avatar HeyGen.

Pour chaque job : wrap-short.py --layout split (B-roll en haut, Lisa en bas, karaoké mot-à-mot, hook,
musique duckée, master -14 LUFS) avec une cadence de B-roll automatique (≈ toutes les `cadence` s,
Ninon mesurée 2,2 s ; défaut 3 s) en tournant sur la liste de B-roll du job — puis aperçu 540×960 et
planche contact 6 vignettes pour relecture.

Usage : split_batch.py jobs.json [--only L5,L6] [--dry-run]
jobs.json = {"music": "…mp3", "broll_root": "~/.codebuddy/media-video/flow-crame", "out_dir": "…", "cadence": 3,
             "jobs": [{"id": "L5", "src": "…/L5-kimi-k3.mp4", "hook": "Kimi K3 : …",
                       "fix": ["Kimi 4.3=Kimi K3"], "broll": ["lisa-neuralnet.mp4", "lisa-code.mp4", …],
                       "cadence": 3, "face_crop": "top:0.15,bottom:0.65", "out": "SHORT-SPLIT-L5-kimi-k3.mp4"}]}
`face_crop` (par job ou global) est passé tel quel à wrap-short `--face-crop` (défaut wrap-short : top:0.15,bottom:0.65 ;
un clip déjà zoomé comme veille-2026-08/v*.mp4 veut top:0.0,bottom:0.5).
Un B-roll peut être un chemin absolu ou relatif à broll_root ; une image (png/jpg) est acceptée par wrap-short.
Écrit un journal `<out_dir>/_split-batch.log` + `_split-batch-results.json`.
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
WRAP = os.path.join(HERE, 'wrap-short.py')


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    cfg = json.load(open(sys.argv[1]))
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    dry = '--dry-run' in sys.argv
    root = os.path.expanduser(cfg.get('broll_root', '~/.codebuddy/media-video/flow-crame'))
    out_dir = os.path.expanduser(cfg.get('out_dir', os.path.dirname(os.path.abspath(sys.argv[1]))))
    os.makedirs(out_dir, exist_ok=True)
    music = os.path.expanduser(cfg.get('music', '')) if cfg.get('music') else ''
    log = open(os.path.join(out_dir, '_split-batch.log'), 'a')
    results = []
    for job in cfg['jobs']:
        jid = job['id']
        if only and jid not in only:
            continue
        src = os.path.expanduser(job['src'])
        out = os.path.join(out_dir, job.get('out', f"SHORT-SPLIT-{jid}.mp4"))
        dur = duration(src)
        cadence = float(job.get('cadence', cfg.get('cadence', 3)))
        brolls = [b if os.path.isabs(os.path.expanduser(b)) else os.path.join(root, b) for b in job['broll']]
        brolls = [os.path.expanduser(b) for b in brolls]
        missing = [b for b in brolls if not os.path.exists(b)]
        if missing:
            print(f"⚠️ {jid}: B-roll introuvable {missing}"); results.append({'id': jid, 'error': f'broll manquant {missing}'}); continue
        cuts, t, i = [], 0.0, 0
        while t < dur - 1.0:
            cuts.append(f"{brolls[i % len(brolls)]}@{t:.1f}:{cadence}")
            t += cadence; i += 1
        cmd = [sys.executable, WRAP, src, out, '--hook', job.get('hook', ''), '--layout', 'split']
        for f in job.get('fix', []):
            cmd += ['--fix', f]
        face_crop = job.get('face_crop', cfg.get('face_crop'))
        if face_crop:  # ex. "top:0.0,bottom:0.5" pour un clip déjà zoomé (visage plus haut)
            cmd += ['--face-crop', face_crop]
        for c in cuts:
            cmd += ['--cut', c]
        if music and os.path.exists(music):
            cmd += ['--music', music]
        print(f"→ {jid} ({dur:.0f} s, {len(cuts)} plans B-roll, cadence {cadence}s){' · DRY-RUN' if dry else ''}")
        if dry:
            results.append({'id': jid, 'dryRun': True, 'cuts': len(cuts)}); continue
        t0 = time.time()
        r = subprocess.run(cmd, capture_output=True, text=True)
        ok = r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 200_000
        log.write(f"[{time.strftime('%H:%M:%S')}] {jid} rc={r.returncode} ok={ok} {time.time()-t0:.0f}s\n{r.stdout[-800:]}\n{r.stderr[-800:]}\n")
        log.flush()
        if ok:
            prev = out[:-4] + '-preview.mp4'
            subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", "scale=540:960", "-c:v", "libx264", "-crf", "28",
                            "-preset", "fast", "-c:a", "aac", "-b:a", "96k", prev, "-y"], check=False)
            planche = out[:-4] + '-planche.jpg'
            n = 6
            subprocess.run(["ffmpeg", "-v", "error", "-i", out, "-vf", f"fps={n}/{max(dur,1):.2f},scale=300:-1,tile={n}x1",
                            "-frames:v", "1", planche, "-y"], check=False)
            print(f"   ✅ {os.path.basename(out)} ({os.path.getsize(out)//1024} Ko, {time.time()-t0:.0f}s)")
        else:
            print(f"   ❌ {jid} rc={r.returncode} — voir _split-batch.log")
        results.append({'id': jid, 'ok': ok, 'out': out, 'seconds': round(time.time() - t0), 'cuts': len(cuts)})
    json.dump(results, open(os.path.join(out_dir, '_split-batch-results.json'), 'w'), indent=2, ensure_ascii=False)
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
