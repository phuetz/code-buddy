#!/usr/bin/env python3
"""Fabrique une piste de sous-titres SRT dont le texte vient du SCRIPT, pas d'une ré-écoute.

Pourquoi cet outil existe. YouTube génère sa propre transcription automatique sur chaque
vidéo publiée, et son modèle francise les noms du domaine : DeepSeek devient « Deeppsych »,
Qwen « Quen », Kimi K3 « Kimi 4.3 », Lisa « Liya ». Cette transcription sert à l'indexation
de la recherche : une chaîne dont l'algorithme croit qu'elle parle de « Deeppsych » ne
remonte sur aucune requête « DeepSeek ». Déposer notre propre piste la remplace.

Le texte vient du script narré ; les instants viennent d'une transcription whisper reportée
sur ce texte par `align_to_script` (wrap-short.py). Aucun mot n'est deviné.

Usage :
    srt_from_script.py --audio CLIP.mp4 --script texte.txt --out CLIP.fr.srt
    srt_from_script.py --words mots.json --script texte.txt --out sortie.srt --duree 1088
"""
import argparse, importlib.util, json, os, re, sys
from pathlib import Path

_ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(_ICI))
_spec = importlib.util.spec_from_file_location('wrap_short', _ICI / 'wrap-short.py')
ws = importlib.util.module_from_spec(_spec)
sys.modules['wrap_short'] = ws
_spec.loader.exec_module(ws)

# Usages du sous-titrage : deux lignes au plus, 42 caractères par ligne, 1,2 s au minimum.
# Au-delà de 42, le lecteur de YouTube replie le texte où il veut — parfois au milieu d'un
# nom (« Claude Opus » / « 4.6 »). On préfère choisir nous-mêmes le point de coupure.
LARGEUR_LIGNE = 42
MAX_LIGNES = 2
MIN_DUREE = 1.2
MIN_MOTS = 3
INSECABLE = ' '


def plier(texte, largeur=LARGEUR_LIGNE):
    """Replie un carton sur au plus deux lignes, à la coupure la plus équilibrée.

    Ne coupe jamais à l'intérieur d'un mot ni sur une espace insécable — c'est elle qui
    tient « mot : » et « mot » » ensemble, et qui empêche un nom composé de se scinder.
    """
    if len(texte) <= largeur:
        return texte
    mots = texte.split(' ')
    if len(mots) < 2:
        return texte
    milieu = len(texte) / 2
    meilleur, ecart_min = None, None
    position = 0
    for i, mot in enumerate(mots[:-1]):
        position += len(mot) + 1
        gauche, droite = position - 1, len(texte) - position
        if max(gauche, droite) > largeur:
            continue
        ecart = abs(position - milieu)
        if ecart_min is None or ecart < ecart_min:
            meilleur, ecart_min = i, ecart
    if meilleur is None:  # aucune coupure ne tient dans la largeur : on équilibre au mieux
        position = 0
        for i, mot in enumerate(mots[:-1]):
            position += len(mot) + 1
            ecart = abs(position - milieu)
            if ecart_min is None or ecart < ecart_min:
                meilleur, ecart_min = i, ecart
    return ' '.join(mots[:meilleur + 1]) + '\n' + ' '.join(mots[meilleur + 1:])


# 2 × 42 = 84, mais un carton de 84 caractères ne se plie en 42/42 que si la coupure tombe
# pile sur une espace. On garde deux caractères de marge pour que le repli trouve toujours
# un point équilibré sous la largeur de ligne.
MAX_CARACTERES = LARGEUR_LIGNE * MAX_LIGNES - 4


# Unités qui ne se séparent jamais du nombre qui les précède : « 2 700 » seul en fin de
# carton, puis « milliards » au carton suivant, casse la lecture d'un chiffre — et le chiffre
# est souvent l'argument de la vidéo.
_MAGNITUDES = re.compile(
    r'^(?:milliards?|millions?|milliers?|mille|cents?|centimes?|dollars?|euros?|%|'
    r'[kKMGTP]?[oO]|[kKMGT]?octets?|tokens?|secondes?|minutes?|heures?|jours?|semaines?|mois|ans?)\b',
    re.I)


def _coupure_interdite(precedent, suivant):
    """La frontière entre ces deux mots casserait-elle une unité de sens ?"""
    if ws.sticky_with_next(precedent, suivant):
        return True
    fin_chiffre = re.search(r'\d[\s\u00a0]*$', precedent['w'].rstrip('.,;:'))
    return bool(fin_chiffre and _MAGNITUDES.match(suivant['w']))


def decouper(mots, max_car=MAX_CARACTERES, max_dur=3.5):
    """Groupe les mots en cartons : bornés en caractères ET en durée.

    On ne coupe sur un point que si le carton en cours est déjà lisible : la narration de
    Lisa enchaîne des phrases très courtes (« Ouvert. », « Pas dans votre salon. ») qui
    durent parfois 50 ms, et couper sur chacune produirait des cartons illisibles.

    Quand la longueur force une coupure, on recule d'un mot plutôt que de séparer un nombre
    de son unité.
    """
    groupes, courant = [], []

    def fermer(suivant):
        """Clôt le carton courant, en reculant si la coupure casserait une unité de sens.

        `suivant` est le mot qui commencera le carton d'après : c'est lui qui dit si la
        frontière est acceptable (« 2 700 » ne doit pas rester seul avant « milliards »).
        """
        nonlocal courant
        report = []
        while len(courant) >= 2:
            apres = report[0] if report else suivant
            if apres is None or not _coupure_interdite(courant[-1], apres):
                break
            report.insert(0, courant.pop())
        groupes.append(courant)
        courant = report

    for i, mot in enumerate(mots):
        suivant = mots[i + 1] if i + 1 < len(mots) else None
        projete = len(' '.join(m['w'] for m in courant + [mot]))
        if courant and projete > max_car:
            fermer(mot)
        courant.append(mot)
        duree = courant[-1]['t1'] - courant[0]['t0']
        lisible = duree >= MIN_DUREE and len(courant) >= MIN_MOTS
        fin_phrase = mot['w'].rstrip().endswith(('.', '!', '?', '…', ':'))
        if duree >= max_dur or (fin_phrase and lisible):
            fermer(suivant)
    if courant:
        groupes.append(courant)
    return groupes


def bornes(groupes, fin_totale):
    """Durées d'affichage : un carton trop bref emprunte au silence qui le suit, jamais au suivant."""
    out = []
    for i, groupe in enumerate(groupes):
        t0, t1 = groupe[0]['t0'], groupe[-1]['t1']
        limite = groupes[i + 1][0]['t0'] if i + 1 < len(groupes) else fin_totale
        if t1 - t0 < MIN_DUREE:
            t1 = min(limite, t0 + MIN_DUREE)
        out.append((max(t0, 0.0), max(t1, t0 + 0.2)))
    return out


def horodate(t):
    h, reste = divmod(max(0.0, t), 3600)
    m, s = divmod(reste, 60)
    return f'{int(h):02d}:{int(m):02d}:{s:06.3f}'.replace('.', ',')


def rendre_srt(mots_alignes, fin_totale):
    groupes = decouper(mots_alignes)
    blocs = []
    for i, (groupe, (t0, t1)) in enumerate(zip(groupes, bornes(groupes, fin_totale)), 1):
        texte = plier(' '.join(m['w'] for m in groupe))
        blocs.append(f'{i}\n{horodate(t0)} --> {horodate(t1)}\n{texte}\n')
    return '\n'.join(blocs)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument('--audio', help='média à transcrire pour obtenir les instants')
    source.add_argument('--words', help='mots whisper déjà en cache (JSON t0/t1/w)')
    ap.add_argument('--script', required=True, help='fichier texte du script narré')
    ap.add_argument('--out', required=True)
    ap.add_argument('--duree', type=float, help='durée du média (défaut : dernier instant)')
    a = ap.parse_args()

    if a.audio:
        mots = ws.transcribe(os.path.expanduser(a.audio))
    else:
        mots = json.loads(Path(os.path.expanduser(a.words)).read_text(encoding='utf-8'))
    if not mots:
        sys.exit('transcription vide : aucun instant à reporter')

    script = Path(os.path.expanduser(a.script)).read_text(encoding='utf-8')
    alignes, rapport = ws.align_to_script(mots, script)
    if not rapport['suffisant']:
        sys.exit(f"ancrage trop faible ({rapport['taux_ancrage'] * 100:.0f}%) : "
                 'le script ne correspond pas à cette prise.')
    fin = a.duree if a.duree else max(m['t1'] for m in mots)
    Path(os.path.expanduser(a.out)).write_text(rendre_srt(alignes, fin), encoding='utf-8')
    print(f"{a.out} — {rapport['mots_script']} mots du script, "
          f"{rapport['taux_ancrage'] * 100:.0f}% d'ancrage")


if __name__ == '__main__':
    main()
