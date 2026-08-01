#!/usr/bin/env python3
"""Mesure la dureté du détourage sur le contour d'une personne composée.

    python3 scripts/influencer/mesurer-detourage.py image.png [autres...]

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

- **largeur ≥ 4 px** : transition naturelle, mèches présentes ;
- **2 à 4 px** : suspect, détourage adouci ;
- **< 2 px** : découpe franche, le composite se voit.

La mesure est indicative et ne remplace pas un œil. Elle sert à ATTRAPER ce qu'un
œil fatigué laisse passer sur la centième vidéo, pas à autoriser une publication.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def largeur_transition(chemin: Path, colonnes: int = 240) -> tuple[float, int]:
    """Largeur moyenne, en pixels, de la transition au sommet du sujet.

    On balaie des colonnes verticales et, dans chacune, on cherche la première
    descente franche de luminosité en venant du haut : c'est le passage du fond
    (souvent clair : ciel, feuillage) à la chevelure. On mesure alors combien de
    pixels sépare 10 % et 90 % de cette descente.
    """
    image = np.asarray(Image.open(chemin).convert("L"), dtype=np.float32)
    hauteur, largeur = image.shape
    # On se limite au tiers central horizontal et à la moitié haute : c'est là que
    # se trouve la tête sur un portrait cadré.
    x0, x1 = int(largeur * 0.33), int(largeur * 0.67)
    y1 = int(hauteur * 0.55)

    mesures: list[float] = []
    pas = max(1, (x1 - x0) // colonnes)
    for x in range(x0, x1, pas):
        col = image[:y1, x]
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
    if largeur >= 4:
        return "naturel"
    if largeur >= 2:
        return "suspect — détourage adouci"
    return "DÉCOUPE FRANCHE — le composite se voit"


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("images", nargs="+", type=Path)
    arguments = analyseur.parse_args()

    print(f"{'image':44} {'largeur':>8}  {'colonnes':>8}  verdict")
    pire = 99.0
    for chemin in arguments.images:
        if not chemin.is_file():
            print(f"{str(chemin)[:44]:44}      —          —  fichier introuvable")
            continue
        largeur, n = largeur_transition(chemin)
        print(f"{chemin.name[:44]:44} {largeur:8.2f}  {n:8}  {verdict(largeur)}")
        if largeur == largeur:
            pire = min(pire, largeur)
    # Sortie non nulle si au moins une image montre une découpe franche : l'outil
    # est utilisable comme porte.
    return 1 if pire < 2 else 0


if __name__ == "__main__":
    sys.exit(main())
