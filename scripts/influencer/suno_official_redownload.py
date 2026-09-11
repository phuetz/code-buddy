#!/usr/bin/env python3
"""Téléchargement OFFICIEL (quota Suno « Downloads ») des prises déjà générées.

Ne génère rien, ne capture pas le flux MSE : pour chaque sidecar `<name>-<take>.json`
d'un dossier (clip_id), ouvre la page du titre et déclenche Download (WAV > MP3 > M4A)
via `official_download` de suno_batch. S'arrête quand le quota lu sur le compte
tombe à `--reserve` ou après `--limit` fichiers. Journal JSONL dans le dossier de sortie.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import suno_batch as sb  # noqa: E402

Q = "button,[role=menuitem],[role=menuitemradio],[role=option],div[role=button],a"


def official_download_song_page(c) -> bool:
    """Séquence vérifiée le 11/09/2026 sur la page /song/<id> : Play → More (playbar) →
    Download → WAV (le compte livre du MP3) → Unlock & Download (un <button>, cherché
    dans une liste large de sélecteurs)."""
    sb.play_song(c)
    time.sleep(2)
    more = sb.click_pred(c, """(()=>{const share=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')==='Playbar: Share'); if(!share) return null; const sr=share.getBoundingClientRect(); return [...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')==='More menu contents' && Math.abs(b.getBoundingClientRect().y-sr.y)<24 && b.getBoundingClientRect().x>sr.x)})()""")
    if not more:
        return False
    time.sleep(1.2)
    dl = sb.click_pred(c, f"[...document.querySelectorAll('{Q}')].find(b=>{{const t=((b.getAttribute('aria-label')||'')+' '+(b.innerText||'')).trim();return /^Download(\\s+Download)?$/i.test(t) && b.getBoundingClientRect().width>80;}})")
    if not dl:
        return False
    time.sleep(1.5)
    sb.click_pred(c, f"[...document.querySelectorAll('{Q}')].find(b=>(b.innerText||'').trim()==='WAV' && b.getBoundingClientRect().width>80)")
    time.sleep(0.8)
    el = sb.ev(c, f"""(()=>{{const b=[...document.querySelectorAll('{Q}')].find(b=>/unlock/i.test(b.innerText||'')); if(!b) return null; const r=b.getBoundingClientRect(); return {{t:(b.innerText||'').trim().slice(0,40), x:r.x+r.width/2, y:r.y+r.height/2}}}})()""")
    if not el or sb.is_forbidden_commerce_text(el.get('t')):
        return False
    sb.trusted_click(c, el['x'], el['y'])
    time.sleep(1.0)
    return True


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--src', required=True, help='dossier des sidecars <name>-<take>.json')
    p.add_argument('--outdir', required=True)
    p.add_argument('--limit', type=int, default=20)
    p.add_argument('--reserve', type=int, default=0, help='quota à conserver')
    p.add_argument('--only', default='', help='préfixe de nom (ex. jade-)')
    args = p.parse_args(argv)
    src, outdir = Path(args.src).expanduser(), Path(args.outdir).expanduser()
    outdir.mkdir(parents=True, exist_ok=True)
    journal = outdir / 'official-journal.jsonl'
    c = sb.conn()
    quota = sb.read_download_quota(c)
    print(f'quota téléchargements restant : {quota}', flush=True)
    sidecars = sorted(q for q in src.glob('*.json') if q.name.startswith(args.only))
    done = 0
    try:
        for sc in sidecars:
            if done >= args.limit:
                break
            meta = json.loads(sc.read_text(encoding='utf-8'))
            cid, stem = meta.get('clip_id'), sc.stem
            if not cid:
                continue
            if any(f.suffix.lower() in sb.AUDIO_EXT and f.stat().st_size > 200_000
                   for f in outdir.glob(f'{stem}.*')):
                print(f'[déjà] {stem}', flush=True)
                continue
            if quota is not None and quota <= args.reserve:
                print(f'=== quota atteint ({quota}), arrêt ===', flush=True)
                break
            print(f'[officiel] {stem} {cid}', flush=True)
            sb.set_download_dir(c, outdir)
            before = sb.snapshot_audio(outdir)
            sb.goto(c, f'https://suno.com/song/{cid}')
            sb.wait_url(c, cid, 20)
            sb.reload_fresh(c, cid, 25)
            time.sleep(1.5)
            sb.dismiss_overlays(c)
            ok = official_download_song_page(c)
            got = None
            if ok:
                t0 = time.time()
                while time.time() - t0 < 300 and not got:
                    got = sb.wait_new_audio(outdir, before, timeout_s=15)
            sb.esc(c, 2)
            if got:
                final = outdir / f'{stem}{got.suffix.lower()}'
                if got != final:
                    got.replace(final)
                dur = sb.ffprobe_duration(final) or 0
                done += 1
                q2 = sb.read_download_quota(c)
                sb.journal_write(journal, 'official_done', name=stem, clip_id=cid,
                                 file=str(final), bytes=final.stat().st_size,
                                 duration=dur, quota_before=quota, quota_after=q2)
                quota = q2 if q2 is not None else quota
                print(f'    -> {final.name} {final.stat().st_size} o, {dur:.1f}s, quota {quota}', flush=True)
            else:
                sb.journal_write(journal, 'official_fail', name=stem, clip_id=cid)
                print('    KO', flush=True)
            time.sleep(2)
    finally:
        sb.restore_download_dir(c)
    print(f'=== {done} téléchargement(s) officiel(s), quota restant {quota} ===', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
