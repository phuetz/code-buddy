#!/usr/bin/env python3
"""Télécharge les clips du projet Flow ouvert (UI agent 2026) en les nommant par leur prompt.

Pour chaque carte vidéo (bouton « play_circle » de la vue Vidéos) : clic play (DOM) → lit le
<video>.currentSrc → lit le prompt affiché dans le panneau de détail → retrouve l'id du job dont
le prompt commence pareil → fetch CDP vers <outdir>/<id>.mp4 (saute si déjà présent).

Usage : python3 flow-fetch-cards.py prompts1.json [prompts2.json ...] [--outdir DIR] [--dry]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
__file__ = str(SCRIPT_DIR / 'flow-veo-mission.py')  # cdp-lib relatif
exec((SCRIPT_DIR / 'flow-veo-mission.py').read_text().split('def run(')[0])  # noqa: S102

DISPATCH = ("for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']){"
            "b.dispatchEvent(t.startsWith('pointer')?new PointerEvent(t,{bubbles:true,pointerType:'mouse',button:0})"
            ":new MouseEvent(t,{bubbles:true,button:0}));}")


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('prompts', nargs='+', type=Path)
    ap.add_argument('--outdir', type=Path, default=Path('~/.codebuddy/media-video/flow-crame').expanduser())
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()
    jobs = []
    for p in args.prompts:
        jobs += json.loads(p.read_text(encoding='utf-8'))
    flow = Flow()  # noqa: F821
    flow.js("(()=>{let b=[...document.querySelectorAll('button')].find(e=>/Afficher les vidéos/.test(e.innerText));if(b){%s}return 1})()" % DISPATCH)
    time.sleep(1.5)
    n = int(flow.js("[...document.querySelectorAll('button,[role=button]')].filter(e=>e.getBoundingClientRect().width>0&&/play_circle/.test(e.innerText||'')).length") or 0)
    print(f'{n} carte(s) lisible(s)', flush=True)
    # 1) matérialiser tous les <video> (clic play sur chaque carte), puis lire l'ordre DOM
    for i in range(n):
        flow.js("(()=>{let bs=[...document.querySelectorAll('button,[role=button]')].filter(e=>e.getBoundingClientRect().width>0&&/play_circle/.test(e.innerText||''));let b=bs[%d];if(b){%s}return 1})()" % (i, DISPATCH))
        time.sleep(1.2)
        flow.press_escape()
    vids = json.loads(flow.js("JSON.stringify([...document.querySelectorAll('video')].map(v=>v.currentSrc||v.src||'').filter(Boolean))") or '[]')
    body = flow.js('document.body.innerText') or ''
    # Panneaux de détail empilés à droite, même ordre que les cartes et que les <video> :
    # « delete / Placer dans la corbeille / <prompt…> / redo / Réutiliser le prompt textuel »
    panels = [p.replace('\n', ' ').strip() for p in re.findall(r'Placer dans la corbeille\n(.+?)\nredo\n', body, flags=re.S)]
    print(f'{len(vids)} <video>, {len(panels)} panneau(x)', flush=True)
    if len(vids) != len(panels):
        print('⚠️ ordre non garanti (comptes différents) — je nomme par index si pas de correspondance', flush=True)
    for i, src in enumerate(vids):
        panel_prompt = panels[i] if i < len(panels) else ''
        np_ = norm(panel_prompt)[:60]
        match = next((j for j in jobs if np_ and norm(j['prompt']).startswith(np_[:40])), None)
        name = match['id'] if match else f'card-{i}'
        out = args.outdir / f'{name}.mp4'
        print(f'[{i}] {name} <- …{src[-40:]} | prompt={panel_prompt[:50]!r}', flush=True)
        if args.dry:
            continue
        if out.exists() and out.stat().st_size > 100_000:
            print('    déjà présent, saut', flush=True)
            continue
        try:
            flow.fetch_video(src, out)
            print(f'    ✅ {out} ({out.stat().st_size // 1024} Ko)', flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f'    ❌ fetch KO : {exc}', flush=True)
    flow.press_escape()


if __name__ == '__main__':
    main()
