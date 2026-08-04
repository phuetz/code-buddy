#!/usr/bin/env python3
"""Miniatures YouTube 1280×720 dont le texte tient dans son cadre, par construction.

Le défaut corrigé
-----------------
Les trois miniatures de « Meta AI ne répond plus » ont été composées avec des
coordonnées écrites à la main : un rectangle dessiné à un endroit, un
``-annotate +x+y`` à un autre, sans que personne ne mesure la largeur du texte
rendu. Résultat : le rectangle violet de ``miniature-01-promesse.jpg`` est
**vide** et « ELLE AGIT » se pose en travers de sa bordure basse, en débordant
des deux côtés. Même défaut sur les deux autres.

La cause n'est pas l'inattention : c'est que ``-annotate`` place une **ligne de
base**, pas un bloc, et que rien dans la chaîne ne relisait le résultat.

La règle ici
------------
On ne place jamais un texte. On place un **cadre**, et le texte est ajusté
dedans (``habillage.ajuster_au_cadre``) : le corps est réduit jusqu'à ce que le
bloc mesuré tienne, et si même le corps minimal déborde, la fabrication
**échoue** au lieu de livrer. Le cadre est ensuite dessiné *autour du bloc
mesuré*, donc il ne peut pas être vide.

Après composition, ``habillage.exiger`` remesure sur l'image produite :
contraste WCAG sous les glyphes, fond uniforme, aucun bloc qui en recouvre un
autre, chaque bloc dans son cadre.

Enfin, la lisibilité en vignette de téléphone est **mesurée** et non jugée : la
hauteur de capitale du plus petit bloc est convertie à 320 px de large et
comparée à ``--capitale-min-vignette`` (9 px par défaut ; en dessous, le texte
n'est plus lu, il est deviné).

Usage
-----
    python3 miniature-youtube.py specification.json
    python3 miniature-youtube.py specification.json --planche sortie.jpg
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from typing import Any

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

LARGEUR = 1280
HAUTEUR = 720
LARGEUR_VIGNETTE = 320
CAPITALE_MIN_VIGNETTE = 9.0

FONT_DEFAUT = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'


def _rayon(cadre: Boite, demande: Any) -> int:
    if demande is None:
        return 0
    return int(demande)


def composer(specification: dict[str, Any], base: Path) -> tuple[Image.Image, list, list]:
    """Compose la miniature. Renvoie (image, blocs mesurables, obstacles)."""
    largeur = int(specification.get('largeur', LARGEUR))
    hauteur = int(specification.get('hauteur', HAUTEUR))
    image = Image.new('RGB', (largeur, hauteur), specification.get('fond', '#080a12'))
    dessin = ImageDraw.Draw(image, 'RGBA')

    for forme in specification.get('formes', []):
        _dessiner_forme(image, dessin, forme, base)

    for photo in specification.get('photos', []):
        _coller_photo(image, photo, base)

    blocs = []
    for brut in specification.get('textes', []):
        blocs.append(_dessiner_texte(image, dessin, brut, specification))

    obstacles = [
        (str(o['nom']), habillage.boite_depuis(o['boite']))
        for o in specification.get('obstacles', [])
    ]
    return image, blocs, obstacles


def _dessiner_forme(image: Image.Image, dessin: ImageDraw.ImageDraw, forme: dict, base: Path) -> None:
    genre = forme.get('type', 'rectangle')
    couleur = forme.get('couleur')
    contour = forme.get('contour')
    epaisseur = int(forme.get('epaisseur', 0))
    if genre == 'ellipse':
        boite = habillage.boite_depuis(forme['boite'])
        dessin.ellipse(
            [boite.x, boite.y, boite.droite, boite.bas],
            fill=couleur, outline=contour, width=epaisseur,
        )
    elif genre == 'ligne':
        dessin.line(
            [tuple(p) for p in forme['points']],
            fill=couleur, width=epaisseur or 4, joint='curve',
        )
    elif genre == 'polygone':
        dessin.polygon(
            [tuple(p) for p in forme['points']],
            fill=couleur, outline=contour,
        )
    else:
        boite = habillage.boite_depuis(forme['boite'])
        rayon = _rayon(boite, forme.get('rayon'))
        if rayon:
            dessin.rounded_rectangle(
                [boite.x, boite.y, boite.droite, boite.bas], radius=rayon,
                fill=couleur, outline=contour, width=epaisseur,
            )
        else:
            dessin.rectangle(
                [boite.x, boite.y, boite.droite, boite.bas],
                fill=couleur, outline=contour, width=epaisseur,
            )


def _coller_photo(image: Image.Image, photo: dict, base: Path) -> None:
    chemin = base / photo['fichier'] if not Path(photo['fichier']).is_absolute() \
        else Path(photo['fichier'])
    boite = habillage.boite_depuis(photo['boite'])
    source = Image.open(chemin).convert('RGBA')
    rapport = max(boite.largeur / source.width, boite.hauteur / source.height)
    source = source.resize(
        (max(1, round(source.width * rapport)), max(1, round(source.height * rapport))),
        Image.LANCZOS,
    )
    gauche = (source.width - boite.largeur) // 2
    haut = int(photo.get('cadrage_y', 0))
    source = source.crop((gauche, haut, gauche + boite.largeur, haut + boite.hauteur))
    fondu = int(photo.get('fondu_gauche', 0))
    if fondu > 0:
        masque = Image.new('L', (boite.largeur, boite.hauteur), 255)
        pixels = masque.load()
        for x in range(min(fondu, boite.largeur)):
            valeur = int(255 * x / fondu)
            for y in range(boite.hauteur):
                pixels[x, y] = valeur
        source.putalpha(masque)
    image.paste(source, (boite.x, boite.y), source)


def _dessiner_texte(
    image: Image.Image,
    dessin: ImageDraw.ImageDraw,
    brut: dict,
    specification: dict,
):
    """Ajuste le texte à son cadre, dessine le cadre autour du bloc, puis le texte."""
    cadre = habillage.boite_depuis(brut['cadre'])
    chemin_police = brut.get('police', specification.get('police', FONT_DEFAUT))
    ajustement = habillage.ajuster_au_cadre(
        str(brut['texte']),
        chemin_police,
        cadre,
        int(brut.get('taille_max', 96)),
        taille_min=int(brut.get('taille_min', 28)),
        marge=int(brut.get('marge', 18)),
        interligne=float(brut.get('interligne', 1.15)),
        lignes_max=brut.get('lignes_max'),
        nom=str(brut['nom']),
    )
    ancrage = brut.get('ancrage', 'centre')
    encre = ajustement.boite_encre(ancrage)

    plaque = brut.get('plaque')
    if plaque:
        marge_x = int(plaque.get('marge_x', 22))
        marge_y = int(plaque.get('marge_y', 14))
        # La plaque est dessinée AUTOUR du bloc mesuré : elle ne peut pas être
        # vide, et le texte ne peut pas déborder de sa bordure.
        boite_plaque = Boite(
            encre.x - marge_x, encre.y - marge_y,
            encre.largeur + 2 * marge_x, encre.hauteur + 2 * marge_y,
        )
        rayon = int(plaque.get('rayon', 0))
        arguments = {
            'fill': plaque.get('couleur'),
            'outline': plaque.get('contour'),
            'width': int(plaque.get('epaisseur', 0)),
        }
        if rayon:
            dessin.rounded_rectangle(
                [boite_plaque.x, boite_plaque.y, boite_plaque.droite, boite_plaque.bas],
                radius=rayon, **arguments,
            )
        else:
            dessin.rectangle(
                [boite_plaque.x, boite_plaque.y, boite_plaque.droite, boite_plaque.bas],
                **arguments,
            )

    couleur = brut.get('couleur', '#ffffff')
    fonte = habillage.police(chemin_police, ajustement.taille)
    pas = int(round(ajustement.taille * ajustement.interligne))
    decalage = fonte.getbbox(ajustement.lignes[0] or 'Hg')[1]
    for index, ligne in enumerate(ajustement.lignes):
        largeur_ligne = habillage.mesurer_ligne(ligne, chemin_police, ajustement.taille).largeur
        if ancrage.endswith('droite'):
            x = encre.droite - largeur_ligne
        elif ancrage.endswith('gauche'):
            x = encre.x
        else:
            x = encre.x + (encre.largeur - largeur_ligne) // 2
        dessin.text(
            (x, encre.y + index * pas - decalage), ligne, font=fonte, fill=couleur,
        )

    return habillage.Bloc.depuis_ajustement(
        str(brut['nom']),
        ajustement,
        chemin_police,
        couleur,
        ancrage=ancrage,
        contraste_min=float(brut.get('contraste_min', habillage.CONTRASTE_MIN)),
        etalement_max=float(brut.get('etalement_max', habillage.ETALEMENT_FOND_MAX)),
        cadre=cadre,
    )


def controle_vignette(blocs, essentiels: set[str], largeur: int, minimum: float) -> list[str]:
    """Le texte porteur reste-t-il lu, et pas deviné, à 320 px de large ?

    La règle ne vise pas toute la typographie : une pastille de rubrique a le
    droit d'être petite. Elle vise les blocs déclarés ``"vignette": true``,
    ceux qui doivent porter le message dans la liste de suggestions d'un
    téléphone. Il en faut au moins un — sinon le contrôle serait vide, et un
    contrôle qui ne trouve rien ne prouve rien.
    """
    if not essentiels:
        return [
            'aucun bloc déclaré « vignette » : la lisibilité en vignette de '
            'téléphone ne serait contrôlée sur rien'
        ]
    facteur = LARGEUR_VIGNETTE / largeur
    manquements = []
    for bloc in blocs:
        if bloc.nom not in essentiels:
            continue
        capitale = habillage.mesurer_ligne('H', bloc.chemin_police, bloc.taille).hauteur
        reduite = capitale * facteur
        if reduite < minimum:
            manquements.append(
                f'{bloc.nom} : hauteur de capitale {reduite:.1f} px à '
                f'{LARGEUR_VIGNETTE} px de large (< {minimum:.1f}) — illisible '
                f'sur une vignette de téléphone'
            )
    return manquements


def planche_vignettes(images: list[Path], destination: Path) -> None:
    """Planche de contrôle à taille réelle de vignette, étiquetée par nom de fichier.

    ``-label '%f'`` : le tri par nom fait attribuer les images au mauvais plan
    si on ne les étiquette pas — l'étiquette est le nom du fichier lui-même.
    """
    # ``-label`` est un *réglage* : il doit précéder les images auxquelles il
    # s'applique, sinon la planche sort muette — et une planche muette fait
    # attribuer une image au mauvais plan.
    commande = [
        'montage', '-background', '#10131d', '-fill', 'white',
        '-pointsize', '15', '-label', '%f',
    ]
    for image in images:
        commande += [str(image)]
    commande += [
        '-resize', f'{LARGEUR_VIGNETTE}x',
        '-tile', f'{len(images)}x1', '-geometry', '+12+12',
        '-quality', '92', str(destination),
    ]
    subprocess.run(commande, check=True)


def fabriquer(chemin_specification: Path, planche: Path | None) -> list[dict]:
    donnees = json.loads(chemin_specification.read_text(encoding='utf-8'))
    base = chemin_specification.parent
    minimum = float(donnees.get('capitale_min_vignette', CAPITALE_MIN_VIGNETTE))
    produites: list[Path] = []
    rapports: list[dict] = []
    for specification in donnees['miniatures']:
        destination = Path(specification['destination'])
        if not destination.is_absolute():
            destination = (base / destination).resolve()
        image, blocs, obstacles = composer(specification, base)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, quality=int(specification.get('qualite', 92)))

        essentiels = {
            str(t['nom']) for t in specification.get('textes', []) if t.get('vignette')
        }
        manquements = controle_vignette(
            blocs, essentiels, image.width, minimum
        )
        if manquements:
            raise HabillageError(
                '\n'.join([
                    f'habillage refusé — {destination.name} :',
                    *(f'  - {m}' for m in manquements),
                ])
            )
        habillage.exiger(
            destination, blocs, obstacles=obstacles, contexte=destination.name
        )
        rapports.append(habillage.rapport(destination, blocs, obstacles=obstacles))
        produites.append(destination)
        print(f'OK {destination}')

    if planche and produites:
        planche_vignettes(produites, planche)
        print(f'OK planche vignette {LARGEUR_VIGNETTE} px : {planche}')
    return rapports


def main() -> None:
    parseur = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parseur.add_argument('specification', type=Path)
    parseur.add_argument('--planche', type=Path, default=None)
    parseur.add_argument('--rapport', type=Path, default=None)
    args = parseur.parse_args()
    try:
        rapports = fabriquer(args.specification, args.planche)
    except HabillageError as erreur:
        print(f'ÉCHEC {erreur}', file=sys.stderr)
        raise SystemExit(2)
    if args.rapport:
        args.rapport.write_text(
            json.dumps(rapports, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        print(f'OK mesures : {args.rapport}')


if __name__ == '__main__':
    main()
