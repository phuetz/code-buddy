#!/usr/bin/env python3
"""Mesure la dureté du détourage sur le contour d'une personne composée.

    python3 scripts/influencer/mesurer-detourage.py image.png [autres...]
    python3 scripts/influencer/mesurer-detourage.py \
        --face-bbox 811,205,963,408 image.png

## Pourquoi cet outil existe

Le 1er août 2026, deux vidéos Ambre ont passé toutes les portes existantes —
identité ArcFace jusqu'à 0,97, loudness à la cible, aucune alerte de noir — et
le propriétaire a vu en trois secondes ce qu'aucune mesure ne voyait : **les
cheveux sont découpés**.

La raison est structurelle : **la porte d'identité mesure le VISAGE, pas le
BORD.** Un composite peut préserver parfaitement l'identité et trahir sa nature
par une silhouette au rasoir.

## Ce qui distingue un vrai cheveu d'un cheveu détouré

Sur une photographie, la chevelure ne se termine pas : elle se dissout. Des
centaines de mèches semi-transparentes créent une bande de transition de
plusieurs pixels entre le sujet et le fond. Un masque binaire, lui, produit une
frontière de un à deux pixels.

Cet outil mesure donc **la largeur de la bande de transition** le long du contour
supérieur du sujet — là où les cheveux rencontrent le fond. Il ne juge pas la
beauté : il compte des pixels.

## Lecture

- **largeur ≥ 6 px** : cible naturelle atteinte (portraits source : 7 px) ;
- **4 à 6 px** : transition présente, mais encore sous la cible ;
- **2 à 4 px** : suspect, détourage adouci ;
- **< 2 px** : découpe franche, le composite se voit.

La mesure est indicative et ne remplace pas un œil. Elle sert à ATTRAPER ce qu'un
œil fatigué laisse passer sur la centième vidéo, pas à autoriser une publication.
Sur un composite en décor, ``--face-bbox`` est important : sans cette ROI, le
plus fort contour du tiers central peut être un toit ou un horizon plutôt que les
cheveux. La boîte est celle du visage, sous la forme gauche,haut,droite,bas ; la
zone de chevelure est déduite autour et au-dessus.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import cast

import numpy as np
from PIL import Image


FaceBbox = tuple[float, float, float, float]


def analyser_face_bbox(valeur: str) -> FaceBbox:
    """Valide une boîte gauche,haut,droite,bas fournie sur la CLI."""
    try:
        nombres = tuple(float(element) for element in valeur.split(","))
    except ValueError as erreur:
        raise argparse.ArgumentTypeError(
            "--face-bbox attend gauche,haut,droite,bas"
        ) from erreur
    if (
        len(nombres) != 4
        or any(not np.isfinite(nombre) or nombre < 0 for nombre in nombres)
        or nombres[2] <= nombres[0]
        or nombres[3] <= nombres[1]
    ):
        raise argparse.ArgumentTypeError(
            "--face-bbox attend quatre nombres positifs et ordonnés"
        )
    return cast(FaceBbox, nombres)


def analyser_minimum(valeur: str) -> float:
    """Valide le seuil de sortie de la porte."""
    try:
        minimum = float(valeur)
    except ValueError as erreur:
        raise argparse.ArgumentTypeError("--minimum attend un nombre positif") from erreur
    if not np.isfinite(minimum) or minimum < 0:
        raise argparse.ArgumentTypeError("--minimum attend un nombre positif")
    return minimum


def zone_cheveux(
    largeur: int,
    hauteur: int,
    face_bbox: FaceBbox | None,
) -> tuple[int, int, int, int]:
    """Retourne la ROI (x0, y0, x1, y1) qui contient le sommet des cheveux."""
    if face_bbox is None:
        return int(largeur * 0.33), 0, int(largeur * 0.67), int(hauteur * 0.55)
    gauche, haut, droite, bas = face_bbox
    largeur_visage = droite - gauche
    hauteur_visage = bas - haut
    x0 = max(0, int(np.floor(gauche - 0.55 * largeur_visage)))
    x1 = min(largeur, int(np.ceil(droite + 0.55 * largeur_visage)))
    y0 = max(0, int(np.floor(haut - 0.60 * hauteur_visage)))
    y1 = min(hauteur, int(np.ceil(haut + 0.30 * hauteur_visage)))
    return x0, y0, x1, y1


def largeur_transition(
    chemin: Path,
    colonnes: int = 240,
    face_bbox: FaceBbox | None = None,
) -> tuple[float, int]:
    """Largeur moyenne, en pixels, de la transition au sommet du sujet.

    On balaie des colonnes verticales et, dans chacune, on cherche la première
    descente franche de luminosité en venant du haut : c'est le passage du fond
    (souvent clair : ciel, feuillage) à la chevelure. On mesure alors combien de
    pixels sépare 10 % et 90 % de cette descente.
    """
    image = np.asarray(Image.open(chemin).convert("L"), dtype=np.float32)
    hauteur, largeur = image.shape
    # Sans boîte de visage, on conserve strictement la zone historique. Avec
    # boîte, on exclut les contours concurrents du décor et le bas du corps.
    x0, y0, x1, y1 = zone_cheveux(largeur, hauteur, face_bbox)
    if x1 <= x0 or y1 - y0 < 12:
        return float("nan"), 0

    mesures: list[float] = []
    pas = max(1, (x1 - x0) // colonnes)
    for x in range(x0, x1, pas):
        col = image[y0:y1, x]
        if col.size < 12:
            continue
        # Descente la plus marquée : le fond est plus clair que la chevelure.
        deltas = np.diff(col)
        i = int(np.argmin(deltas))
        if deltas[i] > -12:          # pas de contour franc dans cette colonne
            continue
        haut, bas = col[max(0, i - 8)], col[min(col.size - 1, i + 8)]
        amplitude = haut - bas
        if amplitude < 25:           # contraste trop faible pour conclure
            continue
        seuil_haut, seuil_bas = bas + 0.9 * amplitude, bas + 0.1 * amplitude
        debut = fin = None
        for j in range(max(0, i - 8), min(col.size, i + 9)):
            if debut is None and col[j] <= seuil_haut:
                debut = j
            if col[j] <= seuil_bas:
                fin = j
                break
        if debut is not None and fin is not None and fin >= debut:
            mesures.append(float(fin - debut + 1))

    if not mesures:
        return float("nan"), 0
    return float(np.median(mesures)), len(mesures)


def verdict(largeur: float) -> str:
    if largeur != largeur:  # NaN
        return "indéterminé — aucun contour franc trouvé"
    if largeur >= 6:
        return "naturel — cible cheveux atteinte"
    if largeur >= 4:
        return "transition présente — sous la cible de 6 px"
    if largeur >= 2:
        return "suspect — détourage adouci"
    return "DÉCOUPE FRANCHE — le composite se voit"


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--face-bbox",
        type=analyser_face_bbox,
        help="boîte du visage gauche,haut,droite,bas pour isoler les cheveux",
    )
    analyseur.add_argument(
        "--minimum",
        type=analyser_minimum,
        default=2.0,
        help="largeur minimale pour le code de sortie (2 historique ; 6 cible cheveux)",
    )
    analyseur.add_argument("images", nargs="+", type=Path)
    arguments = analyseur.parse_args()

    print(f"{'image':44} {'largeur':>8}  {'colonnes':>8}  verdict")
    pire = 99.0
    for chemin in arguments.images:
        if not chemin.is_file():
            print(f"{str(chemin)[:44]:44}      —          —  fichier introuvable")
            continue
        largeur, n = largeur_transition(chemin, face_bbox=arguments.face_bbox)
        print(f"{chemin.name[:44]:44} {largeur:8.2f}  {n:8}  {verdict(largeur)}")
        if largeur == largeur:
            pire = min(pire, largeur)
    # Le seuil historique reste 2 pour compatibilité. Les audits capillaires
    # passent explicitement --minimum 6 afin d'en faire une porte de cible.
    return 1 if pire < arguments.minimum else 0


if __name__ == "__main__":
    sys.exit(main())
