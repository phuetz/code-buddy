#!/usr/bin/env python3
"""Retire le liseré pâle du bord de chevelure d'un composite, sans le régénérer.

    python3 scripts/influencer/reparer-lisere-chevelure.py \
        --mattes DIR --sortie DIR image.png [autres...]

## Ce que l'outil corrige, et ce qu'il ne touche pas

Sur le bord d'une chevelure, l'image vaut `C = a·F + (1-a)·B` : une fraction `a`
de cheveu `F` mélangée au fond `B`. Quand une personne est recomposée dans un
autre décor sans que la COULEUR DE PREMIER PLAN soit ré-estimée, le `F` de ces
pixels garde la trace du fond d'ORIGINE — souvent clair. Recomposé sur le
nouveau décor, ce résidu se voit comme un liseré pâle. C'est le défaut que
Patrice a vu à l'œil le 1er août 2026 sur les composites d'Ambre, alors que
toutes les portes automatiques les déclaraient bons.

La réparation est en trois temps :

1. **estimer `F`** par fusion de flous (Blur-Fusion, Photoroom) : la couleur de
   premier plan est prolongée depuis l'intérieur de la chevelure, si bien que la
   contamination claire n'y survit pas ;
2. **reconstruire le fond réel** `B` de la scène en le prolongeant vers
   l'intérieur depuis les pixels d'alpha inférieur à 0,50 (`cv2.inpaint`) —
   partout ailleurs `B` reste STRICTEMENT l'image d'origine, y compris sur le
   bord extérieur du liseré (voir `reconstruire_le_fond`, ce seuil a été payé) ;
3. **recomposer** `a·F + (1-a)·B`.

## ⚠ Un contre-jour ne doit PAS être corrigé — et ne l'est pas

Un liseré clair peut être physiquement juste : c'est le rim light d'une source
placée derrière le sujet. Le corriger abîmerait l'image.

L'outil est immunisé par construction : **il ne modifie que les pixels d'alpha
fractionnaire**. Un contre-jour éclaire du cheveu OPAQUE (alpha ≈ 1), qui est
recopié à l'identique — la garantie est vérifiée en fin de traitement, et le
traitement échoue si un seul pixel d'alpha plein ou nul a bougé.

Mesuré le 1er août 2026 avec `mesurer-detourage.py --mattes` (part des
traversées à pic, dans la bande semi-transparente) :

| image                        | avant  | après  |     Δ | nature          |
|------------------------------|--------|--------|-------|-----------------|
| `ambre-027-salon-automne`    | 18,3 % | 11,1 % | −39 % | composite       |
| `ambre-028-salon-pluie`      | 29,9 % | 19,9 % | −33 % | composite       |
| `ambre-030-salon-dore`       | 40,4 % | 30,1 % | −25 % | composite       |
| `ambre-033-marche-automne`   | 55,5 % | 42,4 % | −24 % | composite       |
| `ambre-038-marche-citrouil…` | 85,7 % | 57,0 % | −33 % | composite       |
| `ambre-rooftop-frontal`      | 43,1 % | 36,1 % | −16 % | **contre-jour** |
| `ambre-yacht-frontal`        | 72,6 % | 67,0 % |  −8 % | **contre-jour** |

Les composites perdent 24 à 39 % de leurs traversées à pic ; les deux portraits
à contre-jour, 8 et 16 %. Le sens est le bon, l'écart n'est pas spectaculaire :
**la réparation atténue, elle n'efface pas.** À l'œil, sur des recadrages ×8, le
gain est réel mais discret — et le liseré que l'on voit du côté éclairé, lui,
reste : il vit sur du cheveu opaque, donc l'outil n'y touche pas, à dessein.

La largeur de transition n'a été dégradée sur aucune image : 5→5, 7→8, 7→7,
6,5→7, 4→4 px, toutes « naturel ».

## Le matte

`--mattes DIR` doit contenir `<nom-du-fichier>-alpha.png`, produit par BiRefNet
`Matting-HR` (nœuds `ComfyUI_BiRefNet_ll` du ComfyUI de gpuNode). Sans matte
fiable il n'y a pas de réparation possible : l'outil refuse plutôt que de
deviner.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:  # pragma: no cover - dépendance optionnelle
    cv2 = None

# Deux rayons, comme la référence Photoroom : un grand pour propager la couleur
# de premier plan depuis l'intérieur, un petit pour recoller au bord réel.
RAYON_LARGE = 90
RAYON_FIN = 6
# Au-dessous, l'alpha est tenu pour nul ; au-dessus, pour plein. Ces deux zones
# sont recopiées telles quelles : c'est ce qui protège un contre-jour.
ALPHA_NUL = 0.001
ALPHA_PLEIN = 0.999
# Au-dessous de ce seuil d'alpha, le pixel garde SA propre valeur comme fond :
# voir reconstruire_le_fond() pour la mesure qui a imposé 0,50 plutôt que 0,02.
SEUIL_FOND = 0.50


def _fusion_de_flous(image, alpha, rayon):
    """Une passe de l'estimateur Blur-Fusion : rend (premier plan, fond flou)."""
    a = alpha[:, :, None]
    alpha_floue = cv2.blur(alpha, (rayon, rayon))[:, :, None]
    premier_plan_flou = cv2.blur(image * a, (rayon, rayon)) / (alpha_floue + 1e-5)
    fond_flou = cv2.blur(image * (1 - a), (rayon, rayon)) / ((1 - alpha_floue) + 1e-5)
    estime = premier_plan_flou + a * (
        image - a * premier_plan_flou - (1 - a) * fond_flou)
    return np.clip(estime, 0.0, 1.0), fond_flou


def estimer_premier_plan(image, alpha):
    """Couleur de premier plan décontaminée (Blur-Fusion à deux niveaux)."""
    grossier, fond_flou = _fusion_de_flous(image, alpha, RAYON_LARGE)
    a = alpha[:, :, None]
    alpha_floue = cv2.blur(alpha, (RAYON_FIN, RAYON_FIN))[:, :, None]
    pp = cv2.blur(grossier * a, (RAYON_FIN, RAYON_FIN)) / (alpha_floue + 1e-5)
    fd = cv2.blur(fond_flou * (1 - a), (RAYON_FIN, RAYON_FIN)) / (
        (1 - alpha_floue) + 1e-5)
    return np.clip(pp + a * (image - a * pp - (1 - a) * fd), 0.0, 1.0)


def reconstruire_le_fond(image, alpha, seuil=SEUIL_FOND, rayon=6):
    """Fond de la scène prolongé sous le sujet.

    Hors du masque, `cv2.inpaint` laisse les pixels intacts : la recomposition
    redonne donc exactement l'image d'origine là où alpha vaut zéro.

    Le seuil vaut 0,50 et non 0,02, et cela a été payé. Avec 0,02, tout le bord
    extérieur était reconstruit par extrapolation : sur les pixels à alpha < 0,15
    — donc quasi purement du décor — le fond bougeait en moyenne de 11 à 15
    niveaux, jusqu'à 76 au centile 99. Cela se voyait : une bande blanchâtre
    apparaissait le long de la chevelure d'`ambre-030`. Avec 0,50, ces mêmes
    pixels gardent leur propre valeur et ne bougent plus que de 1,8 à 3,2
    niveaux (p99 : 11 à 23). La correction du liseré est plus faible — 30,7 % →
    22,8 % au lieu de 17,9 % sur `ambre-030` — mais elle n'abîme pas le décor.
    **Une correction plus forte qui déplace le fond n'est pas une réparation.**
    """
    masque = cv2.dilate((alpha > seuil).astype(np.uint8),
                        np.ones((3, 3), np.uint8), iterations=1)
    octets = (image * 255.0).astype(np.uint8)
    return cv2.inpaint(octets, masque, rayon, cv2.INPAINT_TELEA
                       ).astype(np.float32) / 255.0


def reparer(chemin: Path, chemin_matte: Path, sortie: Path) -> dict:
    if cv2 is None:
        raise RuntimeError("opencv-python est requis (~/vision_tests/venv)")
    image = np.asarray(Image.open(chemin).convert("RGB"), dtype=np.float32) / 255.0
    alpha = np.asarray(Image.open(chemin_matte).convert("L"),
                       dtype=np.float32) / 255.0
    if alpha.shape != image.shape[:2]:
        raise RuntimeError(f"matte {alpha.shape} ≠ image {image.shape[:2]}")

    a = alpha[:, :, None]
    resultat = a * estimer_premier_plan(image, alpha) \
        + (1 - a) * reconstruire_le_fond(image, alpha)

    plein, nul = alpha >= ALPHA_PLEIN, alpha <= ALPHA_NUL
    resultat[plein] = image[plein]
    resultat[nul] = image[nul]
    octets = np.clip(resultat * 255.0 + 0.5, 0, 255).astype(np.uint8)

    # Garantie vérifiée, pas seulement annoncée : hors bande, rien n'a bougé.
    origine = np.clip(image * 255.0 + 0.5, 0, 255).astype(np.uint8)
    intacts = plein | nul
    if not np.array_equal(octets[intacts], origine[intacts]):
        raise RuntimeError("des pixels d'alpha plein ou nul ont été modifiés")

    sortie.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(octets).save(sortie)
    bande = int((~intacts).sum())
    return {"sortie": sortie, "pixels_bande": bande,
            "part_bande": 100.0 * bande / alpha.size}


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument("images", nargs="+", type=Path)
    analyseur.add_argument("--mattes", type=Path, required=True)
    analyseur.add_argument("--sortie", type=Path, required=True)
    arguments = analyseur.parse_args()

    manquants = 0
    for chemin in arguments.images:
        matte = arguments.mattes / f"{chemin.stem}-alpha.png"
        if not matte.is_file():
            print(f"{chemin.name[:44]:44}  matte absent : {matte}")
            manquants += 1
            continue
        bilan = reparer(chemin, matte, arguments.sortie / chemin.name)
        print(f"{chemin.name[:44]:44}  bande retouchée = "
              f"{bilan['pixels_bande']:7d} px ({bilan['part_bande']:.2f} % de l'image)")
    return 1 if manquants else 0


if __name__ == "__main__":
    sys.exit(main())
