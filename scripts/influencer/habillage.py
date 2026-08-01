#!/usr/bin/env python3
"""Habillage lisible : mesurer le texte, l'ajuster à son cadre, refuser l'illisible.

Trois défauts se répètent dans les cartons vidéo et les miniatures, et ils se
répètent parce que personne ne les mesure :

1. **Le débordement** — on dessine un cadre à des coordonnées choisies à la
   main, puis on y pose un texte dont on n'a jamais mesuré la largeur. Le texte
   sort du cadre, ou le cadre reste vide et le texte se pose en travers de sa
   bordure.
2. **Le contraste insuffisant** — un texte blanc posé sur une capture d'écran
   claire. À l'œil du fabricant qui sait ce qui est écrit, ça se lit ; en
   lecture normale, non.
3. **Le chevauchement** — un mockup de téléphone, un logo ou un sous-titre
   incrusté qui recouvre le texte d'un autre élément.

Ce module rend les trois *mesurables*, donc opposables :

- ``ajuster_au_cadre`` refuse (exception) un texte qui ne rentre pas, au lieu
  de le laisser déborder ;
- ``analyser_zone`` mesure le contraste **réellement obtenu** sur l'image
  produite (ratio WCAG 2.1) et la platitude du fond derrière le texte ;
- ``chevauchements`` compare les zones déclarées deux à deux.

``exiger`` réunit les trois et **lève une exception**. Une fabrication qui
appelle ``exiger`` avant d'écrire son fichier ne peut plus livrer un carton
illisible : c'est le point du module.

Note sur le contraste mesuré : la zone de contrôle doit *serrer* le texte. Si
on lui donne une boîte qui englobe la moitié de l'image, elle y trouvera du
contraste — sans rapport avec la lisibilité du texte. Le fabricant déclare donc
la boîte de sa plaque de texte, pas le cadre entier.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
from PIL import Image, ImageFont


# Seuils par défaut. 4,5:1 est le seuil WCAG 2.1 AA pour le texte courant ;
# 3,0:1 celui du grand texte. Un carton d'attribution est du texte courant :
# il doit tenir le seuil le plus exigeant, c'est justement lui qui rend
# l'usage de courte citation défendable.
CONTRASTE_MIN = 4.5
CONTRASTE_MIN_GRAND_TEXTE = 3.0
# Au-delà de cet écart de luminance entre le 10e et le 90e centile des pixels
# de fond, le fond n'est pas une plaque : c'est une photo, un mockup ou une
# capture. Un texte posé dessus est illisible par endroits même si le contraste
# moyen semble bon.
ETALEMENT_FOND_MAX = 0.12


class HabillageError(Exception):
    """Un défaut d'habillage mesuré. Fait échouer la fabrication."""


@dataclass(frozen=True)
class Boite:
    """Rectangle en pixels, origine en haut à gauche."""

    x: int
    y: int
    largeur: int
    hauteur: int

    @property
    def droite(self) -> int:
        return self.x + self.largeur

    @property
    def bas(self) -> int:
        return self.y + self.hauteur

    def retreci(self, marge: int) -> 'Boite':
        return Boite(
            self.x + marge,
            self.y + marge,
            max(0, self.largeur - 2 * marge),
            max(0, self.hauteur - 2 * marge),
        )

    def contient(self, autre: 'Boite') -> bool:
        return (
            autre.x >= self.x
            and autre.y >= self.y
            and autre.droite <= self.droite
            and autre.bas <= self.bas
        )

    def intersection(self, autre: 'Boite') -> 'Boite | None':
        x = max(self.x, autre.x)
        y = max(self.y, autre.y)
        droite = min(self.droite, autre.droite)
        bas = min(self.bas, autre.bas)
        if droite <= x or bas <= y:
            return None
        return Boite(x, y, droite - x, bas - y)

    def aire(self) -> int:
        return self.largeur * self.hauteur

    def en_dict(self) -> dict[str, int]:
        return {
            'x': self.x,
            'y': self.y,
            'largeur': self.largeur,
            'hauteur': self.hauteur,
        }


def boite_depuis(valeur: Any) -> Boite:
    """Accepte {'x':…}, [x, y, l, h] ou une Boite."""
    if isinstance(valeur, Boite):
        return valeur
    if isinstance(valeur, dict):
        return Boite(
            int(valeur['x']),
            int(valeur['y']),
            int(valeur.get('largeur', valeur.get('w'))),
            int(valeur.get('hauteur', valeur.get('h'))),
        )
    x, y, largeur, hauteur = valeur
    return Boite(int(x), int(y), int(largeur), int(hauteur))


# --------------------------------------------------------------------------
# Contraste WCAG 2.1
# --------------------------------------------------------------------------

def _canal_lineaire(canal: np.ndarray | float) -> np.ndarray | float:
    canal = np.asarray(canal, dtype=np.float64)
    return np.where(canal <= 0.04045, canal / 12.92, ((canal + 0.055) / 1.055) ** 2.4)


def luminance_relative(couleur: Sequence[float] | str) -> float:
    """Luminance relative WCAG d'une couleur RVB (0-255 ou '#rrggbb')."""
    rgb = _rgb(couleur)
    lin = _canal_lineaire(np.array(rgb, dtype=np.float64) / 255.0)
    return float(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2])


def _rgb(couleur: Sequence[float] | str) -> tuple[int, int, int]:
    if isinstance(couleur, str):
        texte = couleur.lstrip('#')
        if len(texte) == 3:
            texte = ''.join(c * 2 for c in texte)
        if len(texte) != 6:
            raise ValueError(f'couleur illisible : {couleur!r}')
        return (int(texte[0:2], 16), int(texte[2:4], 16), int(texte[4:6], 16))
    r, v, b = couleur[0], couleur[1], couleur[2]
    return (int(r), int(v), int(b))


def contraste(couleur_a: Sequence[float] | str, couleur_b: Sequence[float] | str) -> float:
    """Ratio de contraste WCAG 2.1 entre deux couleurs (1,0 à 21,0)."""
    return _ratio(luminance_relative(couleur_a), luminance_relative(couleur_b))


def _ratio(luminance_a: float, luminance_b: float) -> float:
    clair, sombre = max(luminance_a, luminance_b), min(luminance_a, luminance_b)
    return (clair + 0.05) / (sombre + 0.05)


# --------------------------------------------------------------------------
# Mesure et ajustement du texte
# --------------------------------------------------------------------------

_POLICES: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def police(chemin: str | Path, taille: int) -> ImageFont.FreeTypeFont:
    cle = (str(chemin), int(taille))
    if cle not in _POLICES:
        _POLICES[cle] = ImageFont.truetype(str(chemin), int(taille))
    return _POLICES[cle]


def mesurer_ligne(texte: str, chemin_police: str | Path, taille: int) -> Boite:
    """Boîte d'encre d'une ligne, relative à son origine de dessin."""
    fonte = police(chemin_police, taille)
    gauche, haut, droite, bas = fonte.getbbox(texte)
    return Boite(int(gauche), int(haut), int(droite - gauche), int(bas - haut))


def decouper(
    texte: str,
    chemin_police: str | Path,
    taille: int,
    largeur_max: int,
) -> list[str]:
    """Découpe gloutonne en lignes qui tiennent dans ``largeur_max``.

    Un mot plus large que ``largeur_max`` est laissé seul sur sa ligne : c'est
    au contrôle de largeur de le refuser, pas au découpage de le tronquer
    silencieusement — c'est exactement le défaut qu'on corrige.
    """
    lignes: list[str] = []
    for paragraphe in texte.split('\n'):
        mots = paragraphe.split()
        if not mots:
            lignes.append('')
            continue
        courante = mots[0]
        for mot in mots[1:]:
            essai = f'{courante} {mot}'
            if mesurer_ligne(essai, chemin_police, taille).largeur <= largeur_max:
                courante = essai
            else:
                lignes.append(courante)
                courante = mot
        lignes.append(courante)
    return lignes


def mesurer_bloc(
    lignes: Sequence[str],
    chemin_police: str | Path,
    taille: int,
    interligne: float = 1.2,
) -> tuple[int, int]:
    """(largeur, hauteur) d'encre d'un bloc de lignes."""
    if not lignes:
        return (0, 0)
    largeur = max(mesurer_ligne(ligne, chemin_police, taille).largeur for ligne in lignes)
    pas = int(round(taille * interligne))
    hauteur_derniere = mesurer_ligne(lignes[-1] or 'Hg', chemin_police, taille).hauteur
    return (int(largeur), int(pas * (len(lignes) - 1) + hauteur_derniere))


@dataclass(frozen=True)
class Ajustement:
    """Résultat d'un ajustement : ce qu'on peut dessiner sans déborder."""

    lignes: list[str]
    taille: int
    largeur: int
    hauteur: int
    cadre: Boite
    marge: int
    interligne: float

    @property
    def utile(self) -> Boite:
        return self.cadre.retreci(self.marge)

    def origine(self, ancrage: str = 'centre') -> tuple[int, int]:
        """Coin haut-gauche du bloc dans le cadre, selon l'ancrage."""
        utile = self.utile
        if ancrage in ('gauche', 'haut-gauche', 'bas-gauche'):
            x = utile.x
        elif ancrage in ('droite', 'haut-droite', 'bas-droite'):
            x = utile.droite - self.largeur
        else:
            x = utile.x + (utile.largeur - self.largeur) // 2
        if ancrage.startswith('haut'):
            y = utile.y
        elif ancrage.startswith('bas'):
            y = utile.bas - self.hauteur
        else:
            y = utile.y + (utile.hauteur - self.hauteur) // 2
        return (int(x), int(y))

    def boite_encre(self, ancrage: str = 'centre') -> Boite:
        x, y = self.origine(ancrage)
        return Boite(x, y, self.largeur, self.hauteur)


def ajuster_au_cadre(
    texte: str,
    chemin_police: str | Path,
    cadre: Boite,
    taille_max: int,
    *,
    taille_min: int = 18,
    marge: int = 0,
    interligne: float = 1.2,
    lignes_max: int | None = None,
    nom: str = 'texte',
) -> Ajustement:
    """Le plus grand corps qui fasse tenir ``texte`` dans ``cadre``.

    Lève ``HabillageError`` si même ``taille_min`` déborde : à ce stade il n'y
    a pas de rendu acceptable, et laisser passer produirait exactement le
    défaut qu'on corrige (« ELLE AGIT » en travers de sa bordure).
    """
    utile = cadre.retreci(marge)
    if utile.largeur <= 0 or utile.hauteur <= 0:
        raise HabillageError(
            f'{nom} : le cadre {cadre.en_dict()} est trop petit pour la marge {marge}'
        )
    for taille in range(int(taille_max), int(taille_min) - 1, -1):
        lignes = decouper(texte, chemin_police, taille, utile.largeur)
        if lignes_max is not None and len(lignes) > lignes_max:
            continue
        largeur, hauteur = mesurer_bloc(lignes, chemin_police, taille, interligne)
        if largeur <= utile.largeur and hauteur <= utile.hauteur:
            return Ajustement(
                lignes=lignes,
                taille=taille,
                largeur=largeur,
                hauteur=hauteur,
                cadre=cadre,
                marge=marge,
                interligne=interligne,
            )
    lignes = decouper(texte, chemin_police, taille_min, utile.largeur)
    largeur, hauteur = mesurer_bloc(lignes, chemin_police, taille_min, interligne)
    raise HabillageError(
        f'{nom} : « {texte[:60]} » ne tient pas dans {utile.en_dict()} '
        f'même à {taille_min} pt (mesuré {largeur}×{hauteur} px, '
        f'{len(lignes)} ligne(s)). Élargir le cadre ou raccourcir le texte.'
    )


# --------------------------------------------------------------------------
# Contrôles sur l'image produite
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Lisibilite:
    """Ce qu'on mesure sous les glyphes réellement dessinés."""

    contraste: float
    luminance_encre: float
    luminance_fond_pire: float
    luminance_fond_mediane: float
    etalement_fond: float
    boite_encre: Boite
    pixels_encre: int

    def en_dict(self) -> dict[str, Any]:
        return {
            'contraste': round(self.contraste, 2),
            'luminance_encre': round(self.luminance_encre, 4),
            'luminance_fond_pire': round(self.luminance_fond_pire, 4),
            'luminance_fond_mediane': round(self.luminance_fond_mediane, 4),
            'etalement_fond': round(self.etalement_fond, 4),
            'boite_encre': self.boite_encre.en_dict(),
            'pixels_encre': self.pixels_encre,
        }


@dataclass(frozen=True)
class Bloc:
    """Un bloc de texte tel qu'il est dessiné sur l'image."""

    nom: str
    lignes: list[str]
    chemin_police: str
    taille: int
    origine: tuple[int, int]
    couleur: str = '#ffffff'
    interligne: float = 1.2
    cadre: Boite | None = None
    contraste_min: float = CONTRASTE_MIN
    etalement_max: float = ETALEMENT_FOND_MAX

    @classmethod
    def depuis_ajustement(
        cls,
        nom: str,
        ajustement: Ajustement,
        chemin_police: str | Path,
        couleur: str,
        *,
        ancrage: str = 'centre',
        contraste_min: float = CONTRASTE_MIN,
        etalement_max: float = ETALEMENT_FOND_MAX,
        cadre: Boite | None = None,
    ) -> 'Bloc':
        return cls(
            nom=nom,
            lignes=list(ajustement.lignes),
            chemin_police=str(chemin_police),
            taille=ajustement.taille,
            origine=ajustement.origine(ancrage),
            couleur=couleur,
            interligne=ajustement.interligne,
            cadre=cadre if cadre is not None else ajustement.cadre,
            contraste_min=contraste_min,
            etalement_max=etalement_max,
        )


def _luminance_image(image: Image.Image) -> np.ndarray:
    tableau = np.asarray(image.convert('RGB'), dtype=np.float64) / 255.0
    lin = _canal_lineaire(tableau)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def masque_glyphes(bloc: Bloc, taille_image: tuple[int, int]) -> np.ndarray:
    """Masque booléen des pixels d'encre du bloc, à sa position de dessin."""
    from PIL import ImageDraw

    calque = Image.new('L', taille_image, 0)
    dessin = ImageDraw.Draw(calque)
    fonte = police(bloc.chemin_police, bloc.taille)
    pas = int(round(bloc.taille * bloc.interligne))
    x, y = bloc.origine
    # ``getbbox`` renvoie l'encre relative à l'ancre « la » : on annule le
    # décalage vertical pour que ``origine`` désigne bien le haut de l'encre.
    decalage = fonte.getbbox(bloc.lignes[0] or 'Hg')[1] if bloc.lignes else 0
    for index, ligne in enumerate(bloc.lignes):
        if ligne:
            dessin.text((x, y + index * pas - decalage), ligne, font=fonte, fill=255)
    return np.asarray(calque) > 96


def _dilater(masque: np.ndarray, rayon: int) -> np.ndarray:
    resultat = masque.copy()
    for _ in range(rayon):
        voisin = resultat.copy()
        voisin[1:, :] |= resultat[:-1, :]
        voisin[:-1, :] |= resultat[1:, :]
        voisin[:, 1:] |= resultat[:, :-1]
        voisin[:, :-1] |= resultat[:, 1:]
        resultat = voisin
    return resultat


def mesurer_lisibilite(
    image: str | Path | Image.Image,
    bloc: Bloc,
    *,
    rayon_fond: int = 6,
) -> Lisibilite:
    """Contraste réellement obtenu **sous les glyphes** du bloc.

    On ne devine pas où est le texte : on redessine ses glyphes, on prend
    l'anneau de pixels qui les entoure comme fond local, et on retient le
    **pire** fond — celui dont la luminance est la plus proche de l'encre.
    C'est la bonne règle : un carton n'est lisible que s'il l'est sur toute sa
    longueur. Un texte blanc dont un tiers passe sur un mockup blanc échoue
    ici, même si les deux autres tiers sont sur du gris foncé.
    """
    source = image if isinstance(image, Image.Image) else Image.open(image)
    source = source.convert('RGB')
    masque = masque_glyphes(bloc, source.size)
    if not masque.any():
        raise HabillageError(f'{bloc.nom} : aucun glyphe dessiné (texte vide ?)')
    lum = _luminance_image(source)
    encre = luminance_relative(bloc.couleur)

    anneau = _dilater(masque, rayon_fond) & ~_dilater(masque, 1)
    if not anneau.any():
        anneau = _dilater(masque, rayon_fond) & ~masque
    fonds = lum[anneau]
    # Pire fond = celui qui contraste le moins avec l'encre. On prend un
    # centile (et non le max) pour ne pas se faire piéger par quelques pixels
    # d'anti-crénelage isolés.
    ecarts = np.abs(fonds - encre)
    seuil = np.percentile(ecarts, 5)
    proches = fonds[ecarts <= seuil]
    pire = float(np.median(proches)) if proches.size else float(np.median(fonds))

    ys, xs = np.nonzero(masque)
    boite_encre = Boite(
        int(xs.min()), int(ys.min()),
        int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1),
    )
    return Lisibilite(
        contraste=_ratio(encre, pire),
        luminance_encre=encre,
        luminance_fond_pire=pire,
        luminance_fond_mediane=float(np.median(fonds)),
        etalement_fond=float(np.percentile(fonds, 95) - np.percentile(fonds, 5)),
        boite_encre=boite_encre,
        pixels_encre=int(masque.sum()),
    )


def chevauchements(
    zones: Iterable[tuple[str, Boite]],
) -> list[tuple[str, str, Boite]]:
    """Toutes les paires de zones qui se recouvrent."""
    liste = list(zones)
    trouves: list[tuple[str, str, Boite]] = []
    for i, (nom_a, boite_a) in enumerate(liste):
        for nom_b, boite_b in liste[i + 1:]:
            commun = boite_a.intersection(boite_b)
            if commun is not None:
                trouves.append((nom_a, nom_b, commun))
    return trouves


def controler(
    image: str | Path | Image.Image,
    blocs: Sequence[Bloc],
    *,
    obstacles: Sequence[tuple[str, Boite]] = (),
) -> list[str]:
    """Renvoie la liste des manquements mesurés. Vide = conforme."""
    manquements: list[str] = []
    for bloc in blocs:
        mesure = mesurer_lisibilite(image, bloc)
        if bloc.cadre is not None and not bloc.cadre.contient(mesure.boite_encre):
            manquements.append(
                f'{bloc.nom} : le texte déborde de son cadre — encre '
                f'{mesure.boite_encre.en_dict()} hors de {bloc.cadre.en_dict()}'
            )
        if mesure.contraste < bloc.contraste_min:
            manquements.append(
                f'{bloc.nom} : contraste rendu {mesure.contraste:.2f}:1 '
                f'< {bloc.contraste_min:.1f}:1 exigé (encre L='
                f'{mesure.luminance_encre:.3f} sur pire fond L='
                f'{mesure.luminance_fond_pire:.3f})'
            )
        if mesure.etalement_fond > bloc.etalement_max:
            manquements.append(
                f'{bloc.nom} : fond non uniforme sous le texte (étalement '
                f'{mesure.etalement_fond:.3f} > {bloc.etalement_max:.3f}) — '
                f'le texte est posé sur une image, ou un élément le traverse'
            )
        for nom_obstacle, obstacle in obstacles:
            commun = mesure.boite_encre.intersection(obstacle)
            if commun is not None:
                manquements.append(
                    f'{bloc.nom} : recouvert par « {nom_obstacle} » sur '
                    f'{commun.aire()} px² ({commun.en_dict()})'
                )
    for nom_a, nom_b, commun in chevauchements(
        [(bloc.nom, mesurer_lisibilite(image, bloc).boite_encre) for bloc in blocs]
    ):
        manquements.append(
            f'chevauchement : « {nom_a} » et « {nom_b} » se recouvrent sur '
            f'{commun.aire()} px² ({commun.en_dict()})'
        )
    return manquements


def exiger(
    image: str | Path | Image.Image,
    blocs: Sequence[Bloc],
    *,
    obstacles: Sequence[tuple[str, Boite]] = (),
    contexte: str = '',
) -> None:
    """Contrôle et **lève** au premier lot de manquements. À appeler avant de livrer."""
    manquements = controler(image, blocs, obstacles=obstacles)
    if manquements:
        entete = f'habillage refusé{" — " + contexte if contexte else ""} :'
        raise HabillageError('\n'.join([entete, *(f'  - {m}' for m in manquements)]))


def rapport(
    image: str | Path,
    blocs: Sequence[Bloc],
    *,
    obstacles: Sequence[tuple[str, Boite]] = (),
) -> dict[str, Any]:
    """Mesures détaillées, pour journaliser ce qu'on a obtenu."""
    return {
        'image': str(image),
        'blocs': {
            bloc.nom: {
                'texte': ' / '.join(bloc.lignes),
                'taille': bloc.taille,
                'couleur': bloc.couleur,
                'cadre': bloc.cadre.en_dict() if bloc.cadre else None,
                'contraste_min': bloc.contraste_min,
                **mesurer_lisibilite(image, bloc).en_dict(),
            }
            for bloc in blocs
        },
        'manquements': controler(image, blocs, obstacles=obstacles),
    }


def bloc_depuis_json(brut: Any) -> Bloc:
    lignes = brut['lignes'] if isinstance(brut.get('lignes'), list) else \
        str(brut['texte']).split('\n')
    return Bloc(
        nom=str(brut['nom']),
        lignes=[str(ligne) for ligne in lignes],
        chemin_police=str(brut['police']),
        taille=int(brut['taille']),
        origine=(int(brut['origine'][0]), int(brut['origine'][1])),
        couleur=str(brut.get('couleur', '#ffffff')),
        interligne=float(brut.get('interligne', 1.2)),
        cadre=boite_depuis(brut['cadre']) if brut.get('cadre') else None,
        contraste_min=float(brut.get('contraste_min', CONTRASTE_MIN)),
        etalement_max=float(brut.get('etalement_max', ETALEMENT_FOND_MAX)),
    )


def charger_specification(
    chemin: str | Path,
) -> tuple[Path, list[Bloc], list[tuple[str, Boite]]]:
    donnees = json.loads(Path(chemin).read_text(encoding='utf-8'))
    blocs = [bloc_depuis_json(brut) for brut in donnees['blocs']]
    obstacles = [
        (str(o['nom']), boite_depuis(o['boite']))
        for o in donnees.get('obstacles', [])
    ]
    return (Path(donnees['image']), blocs, obstacles)
