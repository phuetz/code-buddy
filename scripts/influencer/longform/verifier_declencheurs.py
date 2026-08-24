#!/usr/bin/env python3
"""Vérifie que chaque déclencheur d'un JSON d'ordre retrouve bien son mot.

Pourquoi cet outil existe. Les cartes chiffrées, les extraits du hook et les cut-away
B-roll se placent sur un MOT du transcript (« la carte apparaît sur *2700* »). Quand un
déclencheur ne se retrouve pas, l'assembleur ne s'arrête pas : il retombe sur un instant
de repli et le montage part de travers, avec un simple avertissement dans le flot du
rendu. Mesuré le 24/08 : recoller les apostrophes a fait disparaître le jeton « Aujourd »
(devenu « Aujourd'hui »), et le hook de la vidéo pilote commençait à 0,0 s.

À lancer AVANT un rendu, surtout après avoir touché au découpage des mots ou au script.

Usage :
    verifier_declencheurs.py <dossier-projet> [ordre.json]
Sortie : une ligne par déclencheur, et un code de sortie non nul s'il en manque un.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ICI))
_spec = importlib.util.spec_from_file_location('wrap_short', ICI / 'wrap-short.py')
ws = importlib.util.module_from_spec(_spec)
sys.modules['wrap_short'] = ws
_spec.loader.exec_module(ws)


def mots_du_segment(projet, ordre, segs, sid):
    """Les mots tels que l'assembleur les verra : corrigés, puis alignés sur le script."""
    cache = projet / 'work/words' / f'{sid}.json'
    if not cache.exists():
        return None
    mots = ws.apply_fixes(json.loads(cache.read_text(encoding='utf-8')),
                          segs.get(sid, {}).get('fix', []))
    dossier = ordre.get('script_dir')
    if dossier:
        script = Path(dossier).expanduser() / f'{sid}.txt'
        if script.exists():
            mots, _ = ws.align_to_script(mots, script.read_text(encoding='utf-8'))
    return mots


def se_retrouve(mots, spec):
    """Même règle de recherche que `find_word` de l'assembleur, suites de mots comprises."""
    spec = str(spec).strip()
    if spec.startswith('@') or re.fullmatch(r'\d+\.\d+', spec):
        return True  # instant absolu : rien à retrouver
    m = re.match(r'^(.*?)(?:\+(\d+))?$', spec)
    cibles = ws.norm(m.group(1)).split()
    occurrence = int(m.group(2) or 1)
    vus = 0
    for i in range(len(mots)):
        if [ws.norm(x['w']) for x in mots[i:i + len(cibles)]] == cibles:
            vus += 1
            if vus == occurrence:
                return True
    return False


def declencheurs(ordre, segs):
    """Tous les endroits du JSON d'ordre qui désignent un mot."""
    trouves = []
    hook = ordre.get('hook') or {}
    for fait in hook.get('faits', []) or []:
        trouves += [(fait['segment'], fait['de'], 'hook/fait/début'),
                    (fait['segment'], fait['a'], 'hook/fait/fin')]
    citation = hook.get('citation')
    if citation:
        trouves += [(citation['segment'], citation['de'], 'hook/citation/début'),
                    (citation['segment'], citation['a'], 'hook/citation/fin')]
    for sid, seg in segs.items():
        for carte in seg.get('cartes', []) or []:
            if isinstance(carte, dict) and carte.get('at') is not None:
                trouves.append((sid, carte['at'], f"carte « {str(carte.get('valeur', ''))[:24]} »"))
        for cut in seg.get('cut', []) or []:
            if isinstance(cut, str) and '@' in cut:
                trouves.append((sid, cut.split('@', 1)[1].rsplit(':', 1)[0], 'cut-away'))
    return trouves


def main():
    projet = Path(sys.argv[1]).expanduser().resolve()
    nom = sys.argv[2] if len(sys.argv) > 2 else 'ordre.json'
    ordre = json.loads((projet / nom).read_text(encoding='utf-8'))
    segs = {s['id']: s for s in ordre['segments']}

    cache, manquants = {}, []
    liste = declencheurs(ordre, segs)
    for sid, spec, quoi in liste:
        if sid not in cache:
            cache[sid] = mots_du_segment(projet, ordre, segs, sid)
        mots = cache[sid]
        if mots is None:
            print(f'?  {sid:5} {quoi:26} « {spec} »  (pas de transcription en cache)')
            continue
        if se_retrouve(mots, spec):
            print(f'OK {sid:5} {quoi:26} « {spec} »')
        else:
            manquants.append((sid, spec, quoi))
            print(f'KO {sid:5} {quoi:26} « {spec} »  ← INTROUVABLE, le montage retombera sur son repli')

    print(f'\n{len(liste)} déclencheurs, {len(manquants)} introuvable(s)')
    return 1 if manquants else 0


if __name__ == '__main__':
    sys.exit(main())
