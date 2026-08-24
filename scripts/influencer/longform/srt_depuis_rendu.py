#!/usr/bin/env python3
"""Fabrique la piste SRT d'une vidéo longue À PARTIR des sous-titres réellement gravés.

Pourquoi partir du rendu plutôt que de réaligner le script : les cartons `.ass` produits
par l'assembleur sont, mot pour mot et à la milliseconde, ce que le spectateur voit à
l'écran. En les reprenant, la piste déposée sur YouTube ne peut pas diverger de l'image —
et comme le rendu tire déjà son texte du script, aucun mot n'a été deviné en chemin.

Le karaoké écrit un événement PAR MOT, tous porteurs de la même carte : on regroupe les
événements consécutifs qui affichent le même texte, et le carton hérite du début du
premier et de la fin du dernier.

Usage :
    srt_depuis_rendu.py <dossier-work-du-rendu> --out piste.fr.srt
"""
import argparse
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI.parent))
_spec = importlib.util.spec_from_file_location('srt_from_script', ICI.parent / 'srt_from_script.py')
srt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(srt)

_TAGS = re.compile(r'\{[^}]*\}')
_TEMPS = re.compile(r'^(\d+):(\d\d):(\d\d)\.(\d\d)$')


def _secondes(t):
    m = _TEMPS.match(t.strip())
    if not m:
        return None
    h, mn, s, cs = (int(x) for x in m.groups())
    return h * 3600 + mn * 60 + s + cs / 100


def cartons_du_segment(ass):
    """Les cartons affichés par un segment : (début, fin, texte), karaoké dégroupé."""
    sortie = []
    for ligne in ass.read_text(encoding='utf-8').splitlines():
        if not ligne.startswith('Dialogue:'):
            continue
        champs = ligne.split(':', 1)[1].split(',', 9)
        if len(champs) < 10 or champs[3].strip() != 'Sub':
            continue
        t0, t1 = _secondes(champs[1]), _secondes(champs[2])
        texte = _TAGS.sub('', champs[9]).replace('\\N', ' ').strip()
        if t0 is None or t1 is None or not texte:
            continue
        if sortie and sortie[-1][2] == texte and t0 - sortie[-1][1] < 0.35:
            sortie[-1] = (sortie[-1][0], t1, texte)  # même carte, mot suivant surligné
        else:
            sortie.append((t0, t1, texte))
    return sortie


def duree(chemin):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'csv=p=0', str(chemin)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('work', type=Path, help='dossier work/ du rendu (contient concat-audio.txt)')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    work = a.work.expanduser().resolve()
    concat = work / 'concat-audio.txt'
    if not concat.exists():
        sys.exit(f'{concat} introuvable — est-ce bien le dossier work/ d’un rendu ?')

    cartons, offset = [], 0.0
    for ligne in concat.read_text(encoding='utf-8').splitlines():
        if "'" not in ligne:
            continue
        audio = Path(ligne.split("'")[1])
        ass = audio.parent / 'subs.ass'
        if ass.exists():
            for t0, t1, texte in cartons_du_segment(ass):
                cartons.append((t0 + offset, t1 + offset, texte))
        offset += duree(audio)

    if not cartons:
        sys.exit('aucun carton trouvé : ce montage a-t-il bien des sous-titres ?')

    blocs = []
    for i, (t0, t1, texte) in enumerate(cartons, 1):
        if t1 - t0 < srt.MIN_DUREE:
            limite = cartons[i][0] if i < len(cartons) else offset
            t1 = min(limite, t0 + srt.MIN_DUREE)
        blocs.append(f'{i}\n{srt.horodate(t0)} --> {srt.horodate(max(t1, t0 + 0.2))}\n'
                     f'{srt.plier(texte)}\n')

    Path(a.out).expanduser().write_text('\n'.join(blocs), encoding='utf-8')
    print(f'{a.out} — {len(blocs)} sous-titres, montage de {offset:.2f} s')


if __name__ == '__main__':
    main()
