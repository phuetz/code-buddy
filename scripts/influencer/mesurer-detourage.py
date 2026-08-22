#!/usr/bin/env python3
"""Mesure la dureté du détourage sur le contour d'une personne composée.

    python3 scripts/influencer/mesurer-detourage.py image.png [autres...]
    python3 scripts/influencer/mesurer-detourage.py --mattes DIR image.png ...

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

## ⚠ Mesurer à la résolution native, jamais sur un agrandissement

La largeur est comptée en pixels : elle suit donc l'échelle. Un recadrage à 320 %
du plan v01-28 — celui dont le détourage se voit à l'œil — passe de 2,00 px
« suspect » à 8,00 px « naturel ». **Un agrandissement maquille le défaut.**
Conséquence directe : si un jour les rendus passent de 720p à 1080p, les seuils
ci-dessus doivent être remontés d'autant (×1,5), sans quoi tout paraîtra sain.

## Seconde colonne : le liseré clair — et pourquoi la première ne le voyait pas

Le 1er août 2026, le propriétaire a vu à l'œil un **liseré pâle autour de la
chevelure** sur des composites que la colonne « largeur » notait 4 à 8 px, donc
« naturel ». Ce n'est pas un angle mort ordinaire : **un liseré ÉLARGIT la bande
de transition**, il pousse donc la première mesure dans le bon sens. La porte
n'était pas seulement aveugle à ce défaut, elle était trompée par lui.

La seconde colonne compte, le long du contour de la chevelure, la **part des
traversées présentant un pic de luminance plus clair à la fois que le fond et
que le cheveu**. On ne prend ni moyenne ni médiane : un liseré est LOCALISÉ (il
n'apparaît que là où le cheveu rencontre une zone claire) et une médiane sur
tout le contour le dilue à néant — mesuré : 2 à 6 sur des images où le défaut
est visible.

Trois choix comptent, chacun payé par un échec :

1. **Le contour vient d'un masque de personne** (`yolov8n-seg`), pas d'une
   fenêtre supposée autour de la tête. Une première version cherchait le bord
   par simple gradient dans une bande autour du cadre de tête : ses traversées
   les plus fortes tombaient sur une **arête du visage**, sur un **montant de
   fenêtre** et sur des **feuilles d'automne**. Elle notait 52 une image sans
   aucun composite.
2. **On s'arrête à la ligne d'épaules**, détectée comme la croissance la plus
   brutale de la largeur du masque : au-delà, on mesure un col ou un manteau.
3. **On exige un vrai contraste fond/cheveu** (≥ 20 niveaux) : sans contraste,
   un « pic » ne veut rien dire.

## ⚠ Cette colonne ne distingue PAS un contre-jour d'un résidu de recomposition

Elle mesure un liseré clair, pas sa cause. Mesuré le 1er août 2026 :

| image                                    | liseré | nature                       |
|------------------------------------------|--------|------------------------------|
| `ambre-promenade.jpg`                    |  0,0 % | bord propre                  |
| `ambre-cafe-frontal.jpg`                 |  4,4 % | bord propre                  |
| `ambre-027-salon-automne-velours.png`    | 24,8 % | composite                    |
| `ambre-030-salon-dore-flanelle.png`      | 36,3 % | composite                    |
| `ambre-028-salon-pluie-flanelle.png`     | 38,4 % | composite                    |
| `ambre-rooftop-frontal.jpg`              | 54,1 % | **contre-jour, PAS un composite** |
| `ambre-033-marche-automne-velours.png`   | 66,4 % | composite                    |
| `ambre-038-marche-citrouilles.png`       | 70,1 % | composite                    |
| `ambre-yacht-frontal.jpg`                | 84,4 % | **contre-jour, PAS un composite** |

Deux portraits **non composites** pris à contre-jour sortent aussi haut que les
composites, et plus haut que la plupart. Une note élevée est donc une
**convocation de l'œil**, jamais un rejet automatique.

Le test « liseré des deux côtés ⇒ matting, d'un seul côté ⇒ éclairage » a été
essayé et **ne tranche pas non plus** sur ce matériel : `ambre-yacht` est
symétrique (71 % / 75 %) alors qu'elle n'a aucun composite, et
`ambre-027` est aussi dissymétrique (37 % / 12 %) que `ambre-rooftop`
(55 % / 19 %).

## ⚠ Un « 0 % » n'existe pas : soit c'est mesuré, soit c'est « — »

Le pic est défini comme « plus clair que le fond ET que le cheveu ». Contre un
fond déjà proche du blanc, il n'y a plus de place au-dessus : la mesure ne peut
pas voir le défaut, elle peut seulement rendre zéro.

C'est arrivé sur le cas de contrôle lui-même. `ambre-024-face-protected-direct.png`
sortait **0,0 %**, ce qui semblait la disculper — mais **98,1 % de ses traversées
ont un fond au-dessus de 200** (fenêtre en plein soleil). En écartant ces
traversées il n'en reste que 20, et la part y monte à 50 %. Vingt relevés ne
sont pas une mesure.

D'où deux garde-fous : `PLAFOND_MESURABLE` écarte les traversées sur fond
surexposé, `TRAVERSEES_MINIMUM` refuse de noter en dessous de 40 relevés. Cette
image sort désormais **« — non mesurable »**, ce qui est la vérité.

Corollaire : **la séparation « 024 propre / composites atteints » qui semblait
nette n'existait pas.** Elle venait d'un fond brûlé, pas d'un bord sain.

## Lever le doute : `--mattes DIR`

Ce qui sépare le mieux les deux causes, c'est **où se trouve le pic dans
l'alpha** :

- un **contre-jour** éclaire du cheveu opaque : le pic est à alpha ≈ 0,9-1 ;
- un **résidu de recomposition** vit dans les pixels semi-transparents.

Alpha médian du pic, mesuré : `ambre-rooftop` 0,98 et `ambre-yacht` 0,86 (les
deux contre-jours) contre 0,25 pour `ambre-031-foret` et 0,69 pour
`ambre-025-grenier`. La séparation est réelle mais **incomplète** :
`ambre-029-grenier` sort à 0,92, indistinguable d'un contre-jour.

Avec `--mattes DIR`, le script cherche `<nom-du-fichier>-alpha.png` dans DIR et
ne mesure que la **bande semi-transparente** (0,10 < alpha < 0,90). Les mattes
se produisent avec BiRefNet `Matting-HR` (nœuds `ComfyUI_BiRefNet_ll` du
ComfyUI de darkstar). C'est dans ce mode que se lit l'effet de
`reparer-lisere-chevelure.py`, qui ne touche que cette bande :

| image                        | avant  | après  |     Δ | nature          |
|------------------------------|--------|--------|-------|-----------------|
| `ambre-027-salon-automne`    | 18,3 % | 11,1 % | −39 % | composite       |
| `ambre-028-salon-pluie`      | 29,9 % | 19,9 % | −33 % | composite       |
| `ambre-030-salon-dore`       | 40,4 % | 30,1 % | −25 % | composite       |
| `ambre-033-marche-automne`   | 55,5 % | 42,4 % | −24 % | composite       |
| `ambre-038-marche-citrouil…` | 85,7 % | 57,0 % | −33 % | composite       |
| `ambre-rooftop-frontal`      | 43,1 % | 36,1 % | −16 % | **contre-jour** |
| `ambre-yacht-frontal`        | 72,6 % | 67,0 % |  −8 % | **contre-jour** |

Les composites perdent 24 à 39 % de leurs traversées à pic, les deux
contre-jours 8 et 16 %. Le sens est le bon ; **l'écart n'est pas assez large
pour trancher une image isolée.**
"""

from __future__ import annotations

import argparse
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image


MODELE_YOLO = Path.home() / "vision_tests" / "yolov8n.pt"
# Le masque de silhouette sert UNIQUEMENT à la colonne « liseré » : la colonne
# « largeur » reste inchangée et n'a besoin que du détecteur de boîtes.
MODELE_YOLO_SEG = Path.home() / "vision_tests" / "yolov8n-seg.pt"
# Un pic « plus clair que le fond » n'a plus de sens quand le fond est déjà
# proche du blanc : il n'y a plus de place au-dessus. Une traversée dont le fond
# ou le cheveu dépasse ce niveau est ÉCARTÉE plutôt que notée zéro. Cela a été
# imposé par un contre-exemple : `ambre-024-face-protected-direct.png` sortait
# 0,0 %, ce qui semblait la disculper — mais 98,1 % de ses traversées ont un
# fond au-dessus de 200 (fenêtre en plein soleil). La mesure ne la disculpait
# pas : elle ne pouvait pas la voir. Un « 0 » non mesurable est un mensonge.
PLAFOND_MESURABLE = 220.0
# En dessous de ce nombre de traversées exploitables, on refuse de noter.
TRAVERSEES_MINIMUM = 40
# Une détection faible est le plus souvent un objet du décor : nos vrais plans
# d'Ambre sortent entre 0,88 et 0,93.
CONFIANCE_MIN = 0.60
# Fraction de la hauteur d'image en dessous de laquelle un sujet est trop petit
# pour qu'une chevelure soit mesurable.
HAUTEUR_SUJET_MIN = 0.35


@lru_cache(maxsize=1)
def _modele_charge():
    """Charge YOLO une seule fois : une vidéo fait des dizaines de plans."""
    from ultralytics import YOLO  # dépendance optionnelle : voir presence_du_sujet()

    return YOLO(str(MODELE_YOLO))


def cadre_de_la_tete(chemin: Path) -> tuple[int, int, int, int] | None:
    """Boîte de la tête du sujet, ou None si aucune personne. ImportError sans YOLO.

    Sert à DEUX choses, et la seconde est la plus importante :
    1. savoir s'il y a un sujet — sans quoi la mesure porte sur ce qui traîne ;
    2. placer la fenêtre de mesure sur la tête réellement présente, au lieu de la
       supposer au centre. Le 1er août 2026, la version sans ce cadre a noté
       « suspect — détourage adouci » un plan de forêt SANS PERSONNE : elle avait
       mesuré la découpe d'une branche sur le ciel. Utilisé comme porte, l'outil
       aurait fait rejeter un B-roll parfaitement sain.

    On détecte la PERSONNE, pas le visage. Une cascade Haar frontale a été
    essayée d'abord et donnait le même résultat que YOLO sur les six plans de
    contrôle — le choix ne vient donc PAS d'une erreur mesurée de sa part. Il
    vient de son domaine : une cascade frontale ne voit ni un dos ni un profil,
    alors qu'un plan de dos est précisément celui où une chevelure occupe le
    cadre. Détecter la personne couvre ces cas, et c'est déjà la voie de
    perception éprouvée du dépôt (`CODEBUDDY_YOLO_PYTHON`, `object_detect`).
    """
    modele = _modele_charge()
    resultats = modele.predict(str(chemin), classes=[0], conf=CONFIANCE_MIN,
                               device="cpu", verbose=False)
    boites = [b for r in resultats for b in r.boxes]
    if not boites:
        return None
    plus_grande = max(boites, key=lambda b: float(b.conf))
    x0, y0, x1, y1 = (float(v) for v in plus_grande.xyxy[0])
    # Un sujet lointain n'a pas de chevelure mesurable : sa tête fait quelques
    # pixels, et toute bordure y paraît franche. Le 1er août 2026, un étal de
    # marché détecté à 0,44 de confiance a été noté « suspect » à 3,00 px —
    # alors qu'Ambre, dans les plans voisins, sortait à 0,88 et 0,93.
    hauteur_image = float(resultats[0].orig_shape[0])
    if (y1 - y0) < HAUTEUR_SUJET_MIN * hauteur_image:
        return None
    # La tête occupe le haut de la boîte : on garde le quart supérieur, resserré
    # sur la moitié centrale en largeur (les bras élargissent la boîte, pas la
    # tête). C'est là que la chevelure rencontre le fond.
    largeur, hauteur = x1 - x0, y1 - y0
    tx = x0 + largeur * 0.25
    return (int(tx), int(y0), int(largeur * 0.5), int(hauteur * 0.25))


def presence_du_sujet(chemin: Path) -> bool | None:
    """True/False si on a pu vérifier, None si aucun détecteur n'est installé.

    On ne devine jamais : sans détecteur, l'outil le DIT au lieu de laisser
    croire que la présence a été contrôlée.
    """
    try:
        return cadre_de_la_tete(chemin) is not None
    except ImportError:
        return None


def largeur_transition(chemin: Path, colonnes: int = 240) -> tuple[float, int]:
    """Largeur moyenne, en pixels, de la transition au sommet du sujet.

    On balaie des colonnes verticales et, dans chacune, on cherche la première
    descente franche de luminosité en venant du haut : c'est le passage du fond
    (souvent clair : ciel, feuillage) à la chevelure. On mesure alors combien de
    pixels sépare 10 % et 90 % de cette descente.
    """
    image = np.asarray(Image.open(chemin).convert("L"), dtype=np.float32)
    hauteur, largeur = image.shape
    try:
        cadre = cadre_de_la_tete(chemin)
    except ImportError:
        cadre = None
    if cadre is not None:
        # Fenêtre calée sur la tête trouvée : les colonnes du visage, élargies de
        # moitié pour attraper les mèches latérales, et tout ce qui est au-dessus
        # du menton. Un sujet décentré était mal mesuré par le cadrage supposé.
        vx, vy, vw, vh = cadre
        x0 = max(0, vx - vw // 2)
        x1 = min(largeur, vx + vw + vw // 2)
        y1 = min(hauteur, vy + vh)
    else:
        # On se limite au tiers central horizontal et à la moitié haute : c'est là
        # que se trouve la tête sur un portrait cadré.
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


@lru_cache(maxsize=1)
def _modele_seg_charge():
    """Charge le modèle de segmentation, une seule fois."""
    from ultralytics import YOLO  # dépendance optionnelle, comme _modele_charge()

    if not MODELE_YOLO_SEG.is_file():
        raise FileNotFoundError(MODELE_YOLO_SEG)
    return YOLO(str(MODELE_YOLO_SEG))


def contour_de_chevelure(chemin: Path) -> list[tuple[int, int, int]] | None:
    """Bords gauche et droit de la silhouette, du sommet du crâne aux épaules.

    Rend une liste de `(y, x_gauche, x_droit)`, ou None sans sujet exploitable.

    La ligne d'épaules est prise là où la largeur du masque croît le plus vite :
    c'est le seul repère qui ne suppose ni cadrage ni pose. Au-dessous, on
    mesurerait un col roulé ou un revers de trench, pas une chevelure.
    """
    resultats = _modele_seg_charge().predict(
        str(chemin), classes=[0], conf=CONFIANCE_MIN, device="cpu",
        verbose=False, retina_masks=True)
    r = resultats[0]
    if r.masks is None or len(r.boxes) == 0:
        return None
    i = int(np.argmax(r.boxes.conf.cpu().numpy()))
    masque = r.masks.data[i].cpu().numpy() > 0.5
    lignes_pleines = np.where(masque.any(axis=1))[0]
    if len(lignes_pleines) < 60:
        return None
    bords: dict[int, tuple[int, int]] = {}
    for y in range(int(lignes_pleines[0]), int(lignes_pleines[-1]) + 1):
        xs = np.where(masque[y])[0]
        if len(xs):
            bords[y] = (int(xs[0]), int(xs[-1]))
    ys = sorted(bords)
    if len(ys) < 60:
        return None
    largeurs = np.array([bords[y][1] - bords[y][0] for y in ys], dtype=np.float32)
    noyau = max(3, len(ys) // 40)
    lisse = np.convolve(largeurs, np.ones(noyau) / noyau, mode="same")
    pente = np.gradient(lisse)
    debut, fin = int(0.12 * len(ys)), int(0.75 * len(ys))
    y_epaule = ys[debut + int(np.argmax(pente[debut:fin]))]
    haut = ys[0]
    return [(y, bords[y][0], bords[y][1]) for y in ys if haut + 2 < y < y_epaule]


def _matte(chemin: Path, dossier: Path | None) -> "np.ndarray | None":
    if dossier is None:
        return None
    fichier = dossier / f"{chemin.stem}-alpha.png"
    if not fichier.is_file():
        return None
    return np.asarray(Image.open(fichier).convert("L"), dtype=np.float32) / 255.0


def liseré_de_chevelure(chemin: Path, mattes: Path | None = None,
                        rayon: int = 7, seuil_pic: float = 8.0,
                        ) -> tuple[float, int]:
    """Part des traversées du contour capillaire montrant un pic clair, en %.

    Pour chaque ligne du contour et de chaque côté, on relève le fond (4 à 10 px
    dehors), le cheveu (4 à 10 px dedans) et le pixel le plus clair du bord. Le
    pic vaut `luminance_max − max(fond, cheveu)` : il n'est positif que si le
    bord est plus clair QUE LES DEUX, ce qui est la signature du liseré.

    Avec un matte, le pic n'est cherché que dans la bande semi-transparente
    (0,10 < alpha < 0,90) : c'est ce qui distingue un résidu de recomposition
    d'un contre-jour, lequel éclaire du cheveu opaque.

    Rend `(part_en_pourcent, nombre_de_traversées)`, `(nan, 0)` si rien de sûr.
    """
    lignes = contour_de_chevelure(chemin)
    if not lignes:
        return float("nan"), 0
    rgb = np.asarray(Image.open(chemin).convert("RGB"), dtype=np.float32)
    luminance = rgb.mean(axis=2)
    alpha = _matte(chemin, mattes)
    if alpha is not None and alpha.shape != luminance.shape:
        alpha = None
    hauteur, largeur = luminance.shape
    pics: list[float] = []
    for y, x_gauche, x_droit in lignes:
        for x0, vers_la_droite in ((x_gauche, True), (x_droit, False)):
            if alpha is not None:
                mesure = _pic_dans_la_bande(luminance, alpha, y, x0, vers_la_droite)
            else:
                mesure = _pic_au_gradient(luminance, y, x0, vers_la_droite,
                                          rayon, largeur)
            if mesure is not None:
                pics.append(mesure)
    if len(pics) < TRAVERSEES_MINIMUM:
        # Trop peu de traversées exploitables : on ne note pas. C'est le cas
        # d'une silhouette entièrement détourée sur un fond surexposé. Sur
        # `ambre-024-face-protected-direct.png`, il n'en restait que 20 : une
        # part calculée sur 20 relevés n'est pas une mesure, c'est une rumeur.
        return float("nan"), len(pics)
    tableau = np.asarray(pics, dtype=np.float32)
    return float(100.0 * (tableau >= seuil_pic).mean()), len(pics)


def _pic_au_gradient(luminance, y, x0, vers_la_droite, rayon, largeur):
    """Sans matte : le bord est le gradient le plus fort autour du masque."""
    a, b = x0 - rayon, x0 + rayon + 1
    if a < 12 or b > largeur - 12:
        return None
    i = int(np.argmax(np.abs(np.diff(luminance[y, a:b]))))
    xb = a + i + (1 if vers_la_droite else 0)
    if vers_la_droite:
        dehors, dedans = (xb - 10, xb - 4), (xb + 4, xb + 10)
    else:
        dehors, dedans = (xb + 4, xb + 10), (xb - 10, xb - 4)
    if dehors[0] < 0 or dedans[1] > largeur or dedans[0] < 0 or dehors[1] > largeur:
        return None
    fond = float(np.median(luminance[y, dehors[0]:dehors[1]]))
    cheveu = float(np.median(luminance[y, dedans[0]:dedans[1]]))
    if abs(fond - cheveu) < 20 or max(fond, cheveu) > PLAFOND_MESURABLE:
        return None
    pic = float(luminance[y, max(0, xb - 2):xb + 3].max())
    return pic - max(fond, cheveu)


def _pic_dans_la_bande(luminance, alpha, y, x0, vers_la_droite, portee: int = 24):
    """Avec matte : le pic n'est retenu que s'il vit dans le semi-transparent."""
    a, b = x0 - portee, x0 + portee + 1
    if a < 12 or b > luminance.shape[1] - 12:
        return None
    profil_a, profil_l = alpha[y, a:b], luminance[y, a:b]
    if not vers_la_droite:                       # oriente toujours dehors → dedans
        profil_a, profil_l = profil_a[::-1], profil_l[::-1]
    if profil_a[:6].mean() > 0.15 or profil_a[-6:].mean() < 0.85:
        return None
    dedans, dehors = profil_a >= 0.95, profil_a <= 0.05
    bande = (profil_a > 0.10) & (profil_a < 0.90)
    if bande.sum() < 1 or dedans.sum() < 4 or dehors.sum() < 4:
        return None
    cheveu = float(np.median(profil_l[dedans][:8]))
    fond = float(np.median(profil_l[dehors][-8:]))
    if abs(cheveu - fond) < 20 or max(cheveu, fond) > PLAFOND_MESURABLE:
        return None
    return float(profil_l[bande].max()) - max(cheveu, fond)


def verdict_liseré(part: float) -> str:
    """Le seuil convoque l'œil, il ne condamne pas — cf. le contre-exemple du
    contre-jour documenté en tête de fichier."""
    if part != part:
        return ""
    if part < 5:
        return "bord propre"
    return "LISERÉ — lever à l'œil (contre-jour ou résidu de recomposition)"


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
    analyseur.add_argument("--mattes", type=Path, default=None,
                           help="dossier contenant <nom>-alpha.png ; restreint la "
                                "mesure du liseré à la bande semi-transparente")
    arguments = analyseur.parse_args()

    print(f"{'image':44} {'largeur':>8}  {'colonnes':>8}  {'liseré':>7}  verdict")
    pire = 99.0
    sans_detecteur = False
    sans_segmentation = None
    for chemin in arguments.images:
        if not chemin.is_file():
            print(f"{str(chemin)[:44]:44}      —          —        —  fichier introuvable")
            continue
        sujet = presence_du_sujet(chemin)
        if sujet is False:
            # Aucune personne : la mesure porterait sur le décor. On ne note pas,
            # et surtout on ne fait PAS échouer la porte pour un B-roll sain.
            print(f"{chemin.name[:44]:44}        —         —        —  "
                  "non applicable — aucun sujet détecté")
            continue
        largeur, n = largeur_transition(chemin)
        note = verdict(largeur)
        calcule = True
        try:
            part, _ = liseré_de_chevelure(chemin, arguments.mattes)
        except ImportError:
            part, calcule = float("nan"), False
            sans_segmentation = "ultralytics absent de cet interpréteur"
        except FileNotFoundError:
            part, calcule = float("nan"), False
            sans_segmentation = f"{MODELE_YOLO_SEG} absent"
        colonne = "     —" if part != part else f"{part:6.1f}%"
        if not calcule:
            note = f"{note} · liseré NON CALCULÉ"
        elif part != part:
            note = f"{note} · liseré NON MESURABLE (fond trop clair ou contour trop court)"
        else:
            note_liseré = verdict_liseré(part)
            if note_liseré != "bord propre":
                note = f"{note} · {note_liseré}"
        if sujet is None:
            sans_detecteur = True
            note += "  [présence du sujet NON vérifiée]"
        print(f"{chemin.name[:44]:44} {largeur:8.2f}  {n:8}  {colonne:>7}  {note}")
        if largeur == largeur:
            pire = min(pire, largeur)
    if sans_segmentation:
        print(f"\n⚠ {sans_segmentation} : la colonne « liseré » n'a pas été calculée.\n"
              "  Un liseré ÉLARGIT la bande de transition — la colonne « largeur »\n"
              "  seule peut donc noter « naturel » une image défectueuse.")
    if sans_detecteur:
        print("\n⚠ ultralytics absent de cet interpréteur : impossible de "
              "vérifier qu'un sujet est présent.\n  Les largeurs ci-dessus peuvent "
              "avoir été mesurées sur le décor.\n  Relancer avec un python muni de "
              "YOLO, p. ex. ~/vision_tests/venv/bin/python.")
    # Sortie non nulle si au moins une image montre une découpe franche : l'outil
    # est utilisable comme porte.
    return 1 if pire < 2 else 0


if __name__ == "__main__":
    sys.exit(main())
