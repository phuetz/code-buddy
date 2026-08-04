#!/usr/bin/env python3
"""Cartons d'attribution lisibles pour les médias de tiers montés en citation.

Pourquoi ce script existe
-------------------------
Quand on monte une capture officielle (Meta, un éditeur, une salle de presse)
dans une vidéo, c'est la **mention d'attribution à l'écran** qui rend l'usage de
courte citation défendable. Un carton illisible ne vaut pas mieux qu'une
absence d'attribution : ce n'est pas un défaut esthétique, c'est le défaut qui
retire sa défense à la citation.

Le master ``meta-ai-agentique-master-v1.mp4`` portait trois cartons illisibles :
deux écrits en blanc sur le fond blanc de la capture, le troisième dont le tiers
central était masqué par le mockup de téléphone. Aucun script ne les fabriquait,
donc rien ne pouvait les refuser.

Ce que fait ce script
---------------------
``construire``  : source portrait (image ou vidéo) → 16:9 pillarboxé avec une
                  **bande d'attribution opaque réservée en bas de cadre**. La
                  source est mise à l'échelle *au-dessus* de la bande : plus
                  aucun élément ne peut recouvrir le texte, par construction.
``reparer``     : re-pose des cartons d'un master déjà monté, en **une passe**,
                  la piste audio copiée telle quelle.

Pourquoi une passe et non un découpage-recollage
------------------------------------------------
La première version de ``reparer`` ne ré-encodait que les ~27 s de cartons et
recollait le reste en copie de flux. Mesuré : la vidéo gagnait 6 images et
l'audio 0,51 s, soit **+677 ms de décalage cumulé** en fin de master
(intercorrélation v1/v2 : +21 ms à 100 s, +240 ms à 460 s, +677 ms à 600 s).
Un tel écart casse la synchronisation labiale de l'avatar, qui parle justement
après les trois cartons. Le découpage-recollage économisait dix minutes de
calcul et cassait le master : il a été abandonné. Une passe unique conserve la
durée, le nombre d'images et l'audio au bit près — ce qui est vérifié ici.

Dans les deux cas, une image du résultat est mesurée par ``habillage.exiger``
avant livraison : contraste WCAG sous les glyphes, uniformité du fond, tenue
dans le cadre. Un carton illisible fait **échouer** la fabrication.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw


def _charger_habillage():
    chemin = Path(__file__).resolve().parent.parent / 'habillage.py'
    spec = importlib.util.spec_from_file_location('habillage', chemin)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules['habillage'] = module
    spec.loader.exec_module(module)
    return module


habillage = _charger_habillage()
Boite = habillage.Boite
HabillageError = habillage.HabillageError


FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

# Géométrie de la bande d'attribution, en 1920×1080.
LARGEUR = 1920
HAUTEUR = 1080
BANDE_HAUTEUR = 84
BANDE_FOND = '#0d1018'
BANDE_ACCENT = '#4aa3ff'
BANDE_ACCENT_EPAISSEUR = 4
TEXTE_COULEUR = '#ffffff'
TEXTE_MARGE_X = 120
TAILLE_MAX = 40
TAILLE_MIN = 22
# Le côté du cadre où l'on tolère du fond non plat : nulle part. La bande est
# un aplat, l'étalement mesuré doit rester au niveau du bruit d'encodage.
ETALEMENT_MAX = 0.05


def bande(hauteur_image: int = HAUTEUR, hauteur_bande: int = BANDE_HAUTEUR) -> Boite:
    return Boite(0, hauteur_image - hauteur_bande, LARGEUR, hauteur_bande)


def cadre_texte(hauteur_image: int = HAUTEUR, hauteur_bande: int = BANDE_HAUTEUR) -> Boite:
    b = bande(hauteur_image, hauteur_bande)
    return Boite(
        TEXTE_MARGE_X,
        b.y + BANDE_ACCENT_EPAISSEUR + 8,
        LARGEUR - 2 * TEXTE_MARGE_X,
        b.hauteur - BANDE_ACCENT_EPAISSEUR - 16,
    )


def ajuster(texte: str, hauteur_image: int = HAUTEUR) -> object:
    """Ajuste l'attribution au cadre réservé. Lève si elle n'y tient pas."""
    return habillage.ajuster_au_cadre(
        texte,
        FONT_BOLD,
        cadre_texte(hauteur_image),
        TAILLE_MAX,
        taille_min=TAILLE_MIN,
        lignes_max=1,
        nom="carton d'attribution",
    )


def dessiner_bande(image: Image.Image, texte: str) -> object:
    """Dessine la bande opaque + l'attribution. Renvoie le ``Bloc`` mesurable."""
    ajustement = ajuster(texte, image.height)
    b = bande(image.height)
    dessin = ImageDraw.Draw(image)
    dessin.rectangle([b.x, b.y, b.droite - 1, b.bas - 1], fill=BANDE_FOND)
    dessin.rectangle(
        [b.x, b.y, b.droite - 1, b.y + BANDE_ACCENT_EPAISSEUR - 1],
        fill=BANDE_ACCENT,
    )
    bloc = habillage.Bloc.depuis_ajustement(
        "carton d'attribution",
        ajustement,
        FONT_BOLD,
        TEXTE_COULEUR,
        ancrage='centre',
        etalement_max=ETALEMENT_MAX,
        cadre=cadre_texte(image.height),
    )
    fonte = habillage.police(FONT_BOLD, bloc.taille)
    decalage = fonte.getbbox(bloc.lignes[0])[1]
    dessin.text(
        (bloc.origine[0], bloc.origine[1] - decalage),
        bloc.lignes[0],
        font=fonte,
        fill=TEXTE_COULEUR,
    )
    return bloc


def plaque_png(texte: str, destination: Path) -> object:
    """Fabrique la bande seule, sur fond transparent hors bande (pour overlay)."""
    image = Image.new('RGBA', (LARGEUR, HAUTEUR), (0, 0, 0, 0))
    opaque = Image.new('RGB', (LARGEUR, HAUTEUR), (0, 0, 0))
    bloc = dessiner_bande(opaque, texte)
    b = bande()
    image.paste(opaque.crop((b.x, b.y, b.droite, b.bas)), (b.x, b.y))
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination)
    return bloc


def _run(commande: list[str]) -> None:
    subprocess.run(commande, check=True)


def _sortie(commande: list[str]) -> str:
    return subprocess.run(
        commande, check=True, capture_output=True, text=True
    ).stdout.strip()


def duree(media: Path) -> float:
    return float(_sortie([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', str(media),
    ]))


def extraire_image(media: Path, instant: float, destination: Path) -> None:
    _run([
        'ffmpeg', '-loglevel', 'error', '-ss', f'{instant:.3f}', '-i', str(media),
        '-frames:v', '1', '-y', str(destination),
    ])


def controler_media(media: Path, instants: list[float], bloc: object, contexte: str) -> None:
    """Vérifie le carton sur des images extraites du média produit."""
    with tempfile.TemporaryDirectory() as tmp:
        for index, instant in enumerate(instants):
            image = Path(tmp) / f'controle-{index:02d}.png'
            extraire_image(media, instant, image)
            habillage.exiger(
                image, [bloc], contexte=f'{contexte} à {instant:.2f}s'
            )


# --------------------------------------------------------------------------
# construire : source portrait -> 16:9 attribué
# --------------------------------------------------------------------------

def construire(source: Path, destination: Path, texte: str, *, fond: str = '#a8adb5') -> object:
    """Pillarbox 16:9 avec bande d'attribution réservée sous la source."""
    b = bande()
    hauteur_utile = b.y
    est_video = source.suffix.lower() in {'.mp4', '.mov', '.mkv', '.webm', '.m4v'}
    with tempfile.TemporaryDirectory() as tmp:
        plaque = Path(tmp) / 'bande.png'
        bloc = plaque_png(texte, plaque)
        filtre = (
            f'[0:v]scale=-2:{hauteur_utile}:force_original_aspect_ratio=decrease,'
            f'pad={LARGEUR}:{HAUTEUR}:(ow-iw)/2:0:color={fond}[fond];'
            f'[fond][1:v]overlay=0:0[v]'
        )
        commande = ['ffmpeg', '-loglevel', 'error']
        if not est_video:
            commande += ['-loop', '1', '-t', '8']
        commande += ['-i', str(source), '-i', str(plaque),
                     '-filter_complex', filtre, '-map', '[v]']
        if est_video:
            commande += ['-map', '0:a?', '-c:a', 'copy']
        commande += ['-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
                     '-pix_fmt', 'yuv420p', '-y', str(destination)]
        destination.parent.mkdir(parents=True, exist_ok=True)
        _run(commande)
    total = duree(destination)
    controler_media(
        destination,
        [min(0.4, total / 3), total / 2, max(0.0, total - 0.4)],
        bloc,
        f'construction de {destination.name}',
    )
    return bloc


# --------------------------------------------------------------------------
# reparer : re-pose des cartons d'un master déjà monté, en une passe
# --------------------------------------------------------------------------

def images(media: Path) -> int:
    return int(_sortie([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
        '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1',
        str(media),
    ]))


def reparer(
    master: Path,
    destination: Path,
    segments: list[dict],
    *,
    travail: Path,
    crf: int = 16,
    preset: str = 'medium',
) -> list[dict]:
    """Repose les cartons listés sur le master, en une passe, audio copié.

    ``segments`` : [{'debut': 444.0, 'fin': 452.9, 'texte': '…'}, …]
    """
    travail.mkdir(parents=True, exist_ok=True)
    plages = sorted(
        (float(s['debut']), float(s['fin']), str(s['texte'])) for s in segments
    )
    for (a_debut, a_fin, _), (b_debut, *_) in zip(plages, plages[1:]):
        if a_fin > b_debut:
            raise HabillageError(
                f'segments qui se chevauchent : {a_fin:.3f} > {b_debut:.3f}'
            )

    entrees = ['-i', str(master)]
    filtres = []
    blocs = []
    precedent = '[0:v]'
    for index, (debut, fin, texte) in enumerate(plages):
        plaque = travail / f'bande-{index:02d}.png'
        blocs.append(plaque_png(texte, plaque))
        entrees += ['-i', str(plaque)]
        etiquette = f'v{index}'
        filtres.append(
            f"{precedent}[{index + 1}:v]overlay=0:0:"
            f"enable='between(t,{debut:.3f},{fin:.3f})'[{etiquette}]"
        )
        precedent = f'[{etiquette}]'

    destination.parent.mkdir(parents=True, exist_ok=True)
    _run([
        'ffmpeg', '-loglevel', 'error', *entrees,
        '-filter_complex', ';'.join(filtres),
        '-map', precedent, '-map', '0:a?',
        '-c:a', 'copy',
        '-c:v', 'libx264', '-crf', str(crf), '-preset', preset,
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-y', str(destination),
    ])

    # Une passe unique ne doit rien décaler : on le vérifie au lieu de l'espérer.
    ecart_duree = abs(duree(destination) - duree(master))
    if ecart_duree > 0.05:
        raise HabillageError(
            f'durée modifiée de {ecart_duree*1000:.0f} ms — le master serait désynchronisé'
        )
    images_master, images_sortie = images(master), images(destination)
    if images_master != images_sortie:
        raise HabillageError(
            f'{images_sortie} images en sortie contre {images_master} à l’entrée'
        )

    mesures = []
    for index, ((debut, fin, texte), bloc) in enumerate(zip(plages, blocs)):
        controler_media(
            destination,
            [debut + 0.5, (debut + fin) / 2, fin - 0.5],
            bloc,
            f'carton {index + 1} ({debut:.2f}→{fin:.2f}s)',
        )
        mesures.append({
            'segment': index + 1,
            'debut': debut,
            'fin': fin,
            'texte': texte,
            **habillage.mesurer_lisibilite(
                _image_temporaire(destination, (debut + fin) / 2, travail, index),
                bloc,
            ).en_dict(),
        })
    return mesures


def _image_temporaire(media: Path, instant: float, travail: Path, index: int) -> Path:
    chemin = travail / f'controle-{index:02d}.png'
    extraire_image(media, instant, chemin)
    return chemin


def main() -> None:
    parseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sous = parseur.add_subparsers(dest='commande', required=True)

    construire_p = sous.add_parser(
        'construire',
        help='source portrait -> 16:9 avec bande d’attribution lisible',
    )
    construire_p.add_argument('source', type=Path)
    construire_p.add_argument('destination', type=Path)
    construire_p.add_argument('--texte', required=True)
    construire_p.add_argument('--fond', default='#a8adb5')

    reparer_p = sous.add_parser(
        'reparer',
        help='repose les cartons d’un master en une passe (audio copié)',
    )
    reparer_p.add_argument('master', type=Path)
    reparer_p.add_argument('destination', type=Path)
    reparer_p.add_argument(
        '--segments', type=Path, required=True,
        help='JSON : [{"debut":444.0,"fin":452.9,"texte":"…"}, …]',
    )
    reparer_p.add_argument('--travail', type=Path, default=None)
    reparer_p.add_argument('--rapport', type=Path, default=None)

    args = parseur.parse_args()
    try:
        if args.commande == 'construire':
            construire(args.source, args.destination, args.texte, fond=args.fond)
            print(f'OK carton lisible : {args.destination}')
        else:
            segments = json.loads(args.segments.read_text(encoding='utf-8'))
            travail = args.travail or Path(tempfile.mkdtemp(prefix='carton-'))
            mesures = reparer(
                args.master, args.destination, segments, travail=travail
            )
            if args.rapport:
                args.rapport.write_text(
                    json.dumps(mesures, ensure_ascii=False, indent=2) + '\n',
                    encoding='utf-8',
                )
            if args.travail is None:
                shutil.rmtree(travail, ignore_errors=True)
            print(f'OK {len(mesures)} carton(s) re-rendus : {args.destination}')
    except HabillageError as erreur:
        print(f'ÉCHEC {erreur}', file=sys.stderr)
        raise SystemExit(2)


if __name__ == '__main__':
    main()
