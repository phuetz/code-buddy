#!/usr/bin/env python3
"""Fabrique la piste SRT d'une vidéo longue À PARTIR du script narré.

Pourquoi pas depuis une transcription : sur cet épisode, l'oreille automatique a
entendu « élevage de char pays » pour shar-pei, « clés d'AI » pour clés d'API,
« Ton GitHub » pour jeton GitHub, et a basculé en anglais au milieu des phrases
(« That demo je l'ai repéré the matin »). Déposée sur YouTube, cette piste
alimente l'indexation et la recherche : elle doit dire ce qui est dit.

Le script fournit les MOTS, l'alignement fournit le TEMPO. C'est le compagnon de
`srt_depuis_rendu.py`, qui part des cartons gravés — inutilisable quand l'épisode
est rendu sans karaoké (`subtitles: none`).

Usage :
    srt_depuis_script.py <dossier-de-l-episode> --out piste.fr.srt
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]
# wrap-short.py importe ses voisins par leur nom nu : sans ce chemin, l'import echoue.
sys.path.insert(0, str(RACINE))
_spec = importlib.util.spec_from_file_location('wrap_short', RACINE / 'wrap-short.py')
wrap_short = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wrap_short)


class SrtError(RuntimeError):
    """Refus explicite : mieux vaut aucune piste qu'une piste fausse."""


def horodate(secondes: float) -> str:
    if secondes < 0:
        raise SrtError(f'instant négatif: {secondes}')
    ms = int(round(secondes * 1000))
    h, reste = divmod(ms, 3_600_000)
    m, reste = divmod(reste, 60_000)
    s, ms = divmod(reste, 1000)
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


def duree(chemin: Path) -> float:
    import subprocess
    res = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(chemin)],
        capture_output=True, text=True)
    if res.returncode != 0:
        raise SrtError(f'durée illisible pour {chemin}: {res.stderr.strip()}')
    try:
        valeur = float(res.stdout.strip())
    except ValueError as exc:
        raise SrtError(f'durée invalide pour {chemin}: {res.stdout!r}') from exc
    if valeur <= 0:
        raise SrtError(f'durée nulle pour {chemin}')
    return valeur


def cartons_de_section(dossier: Path, sid: str) -> list[dict]:
    """Mots du script, datés par l'alignement, regroupés en cartons lisibles."""
    cache = dossier / 'work' / 'words' / f'{sid}.json'
    script = dossier / 'scripts' / f'{sid}.txt'
    voix = dossier / 'voice' / f'{sid}.mp3'
    for attendu in (cache, script, voix):
        if not attendu.exists():
            raise SrtError(f'{sid}: {attendu} manquant — piste refusée plutôt que devinée')
    # Le cache de mots doit dériver de CETTE voix, sinon les instants sont ceux d'un autre audio.
    if cache.stat().st_mtime < voix.stat().st_mtime:
        raise SrtError(
            f'{sid}: la transcription ({cache.name}) est plus ancienne que sa voix — '
            'relancer le rendu avant de fabriquer la piste')
    mots = json.loads(cache.read_text(encoding='utf-8'))
    alignes, rapport = wrap_short.align_to_script(mots, script.read_text(encoding='utf-8'))
    if not rapport['suffisant']:
        raise SrtError(f"{sid}: ancrage trop faible ({rapport['taux_ancrage'] * 100:.0f}%)")
    return wrap_short.cards(alignes, max_words=9, max_dur=4.0)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dossier', type=Path)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--ordre', type=Path, help='ordre.json (défaut: <dossier>/ordre.json)')
    args = ap.parse_args()

    dossier = args.dossier.expanduser().resolve()
    ordre = json.loads((args.ordre or dossier / 'ordre.json').read_text(encoding='utf-8'))

    lignes: list[str] = []
    numero = 0
    depart = 0.0
    for segment in ordre['segments']:
        sid = segment['id']
        for carton in cartons_de_section(dossier, sid):
            texte = carton['text'].strip()
            if not texte:
                continue
            numero += 1
            lignes += [str(numero),
                       f"{horodate(depart + carton['t0'])} --> {horodate(depart + carton['t1'])}",
                       texte, '']
        depart += duree(dossier / 'voice' / f'{sid}.mp3')

    args.out.write_text('\n'.join(lignes) + '\n', encoding='utf-8')
    print(f'{numero} cartons · {horodate(depart)} · {args.out}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SrtError as exc:
        print(f'ERREUR: {exc}', file=sys.stderr)
        sys.exit(1)
