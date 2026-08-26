#!/usr/bin/env python3
"""Vérifie que chaque déclencheur d'un JSON d'ordre retrouve bien son mot.

Pourquoi cet outil existe. Les cartes chiffrées, les extraits du hook et les cut-away
B-roll se placent sur un MOT du transcript (« la carte apparaît sur *2700* »). Le
préflight intégré à l'assembleur refuse désormais un déclencheur introuvable ; cet outil
permet d'exécuter la même vérification seule. Mesuré le 24/08 : recoller les apostrophes
a fait disparaître le jeton « Aujourd » (devenu « Aujourd'hui »), et le hook de la vidéo
pilote commençait à 0,0 s.

À lancer AVANT un rendu, surtout après avoir touché au découpage des mots ou au script.

Usage :
    verifier_declencheurs.py <dossier-projet> [ordre.json]
Sortie : une ligne par déclencheur, et un code de sortie non nul s'il en manque un.
"""
import importlib.util
import json
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ICI))
_spec = importlib.util.spec_from_file_location('wrap_short', ICI / 'wrap-short.py')
ws = importlib.util.module_from_spec(_spec)
sys.modules['wrap_short'] = ws
_spec.loader.exec_module(ws)

_news_spec = importlib.util.spec_from_file_location(
    'assemble_news_long_for_verifier', Path(__file__).resolve().parent / 'assemble_news_long.py'
)
news = importlib.util.module_from_spec(_news_spec)
sys.modules['assemble_news_long_for_verifier'] = news
_news_spec.loader.exec_module(news)


def mots_du_segment(projet, ordre, segs, sid):
    """Les mots tels que l'assembleur les verra : corrigés, puis alignés sur le script."""
    cache = projet / 'work/words' / f'{sid}.json'
    if not cache.exists():
        raise RuntimeError(f'{sid}: transcription absente ({cache}) — déclencheurs non vérifiés')
    mots = ws.apply_fixes(json.loads(cache.read_text(encoding='utf-8')),
                          segs.get(sid, {}).get('fix', []))
    dossier = ordre.get('script_dir')
    if dossier:
        script = Path(dossier).expanduser() / f'{sid}.txt'
        if not script.exists():
            raise RuntimeError(f'{sid}: script déclaré mais introuvable ({script})')
        mots, rapport = ws.align_to_script(mots, script.read_text(encoding='utf-8'))
        if not rapport['suffisant']:
            raise RuntimeError(
                f"{sid}: ancrage insuffisant ({rapport['taux_ancrage'] * 100:.0f} %)"
            )
    return mots


def se_retrouve(mots, spec):
    """Même règle de recherche que `find_word` de l'assembleur, suites de mots comprises."""
    return news.find_word(mots, str(spec)) is not None


def declencheurs(ordre, segs):
    """Tous les endroits du JSON d'ordre qui désignent un mot."""
    trouves = news.trigger_references(ordre)
    for sid, seg in segs.items():
        for cut in seg.get('cut', []) or []:
            if isinstance(cut, str) and '@' in cut:
                trouves.append((sid, cut.split('@', 1)[1].rsplit(':', 1)[0], 'cut-away'))
    return trouves


def main():
    projet = Path(sys.argv[1]).expanduser().resolve()
    nom = sys.argv[2] if len(sys.argv) > 2 else 'ordre.json'
    ordre = json.loads((projet / nom).read_text(encoding='utf-8'))
    segs = {s['id']: s for s in ordre['segments']}

    cache, manquants, non_verifies = {}, [], []
    liste = declencheurs(ordre, segs)
    for sid, spec, quoi in liste:
        if sid not in cache:
            try:
                cache[sid] = mots_du_segment(projet, ordre, segs, sid)
            except (OSError, RuntimeError, ValueError) as exc:
                cache[sid] = exc
        mots = cache[sid]
        if isinstance(mots, Exception):
            non_verifies.append((sid, spec, quoi))
            print(f'KO {sid:5} {quoi:26} « {spec} »  ← NON VÉRIFIÉ: {mots}')
            continue
        if se_retrouve(mots, spec):
            print(f'OK {sid:5} {quoi:26} « {spec} »')
        else:
            manquants.append((sid, spec, quoi))
            print(f'KO {sid:5} {quoi:26} « {spec} »  ← INTROUVABLE, rendu refusé')

    print(f'\n{len(liste)} déclencheurs, {len(manquants)} introuvable(s), '
          f'{len(non_verifies)} non vérifié(s)')
    return 1 if manquants or non_verifies else 0


if __name__ == '__main__':
    sys.exit(main())
