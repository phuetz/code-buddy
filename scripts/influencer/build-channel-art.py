#!/usr/bin/env python3
"""Fabrique les visuels d'identité des chaînes YouTube (avatar + bannière).

    python3 scripts/influencer/build-channel-art.py [--sortie DOSSIER]

Pourquoi ce script existe : la création d'une chaîne demande un avatar et une
bannière AVANT toute publication, et YouTube impose des contraintes précises que
l'on rate systématiquement à la main :

- **Avatar** : 800 x 800, affiché à 98 px et RECADRÉ EN CERCLE. Tout ce qui
  touche les coins disparaît.
- **Bannière** : 2560 x 1440, mais seule la zone centrale de **1546 x 423** est
  visible sur mobile. Un texte placé hors de cette zone est invisible pour la
  majorité du public.

Les deux positionnements sont ceux validés le 28/07/2026 :
- **Ambre** — « Le vestiaire des destinations », registre film de marque de luxe.
- **Lisa IA** — tech et IA, registre analyse ; la chaîne s'appelle LISA IA, JAMAIS
  « Vision IA », qui est une chaîne tierce servant seulement de modèle de format.

Rien n'est inventé ici : les portraits viennent des images de persona déjà
validées, et les textes des positionnements arrêtés par le propriétaire.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

AVATAR = 800
BANNIERE = (2560, 1440)
ZONE_SURE = (1546, 423)  # visible sur TOUS les appareils, centrée


@dataclass(frozen=True)
class Chaine:
    cle: str
    nom: str
    signature: str
    portrait: Path
    fond: str
    encre: str
    accent: str
    # Centre du visage dans le portrait source, en pixels, et taille du carré à extraire.
    visage_x: int
    visage_y: int
    visage_cote: int


CHAINES = (
    Chaine(
        cle="ambre",
        nom="AMBRE",
        signature="Les destinations, habillées par Ambre.",
        portrait=Path(
            "/home/patrice/Videos/personas/garde-robe-reparee/ambre-trench-camel.png"
        ),
        fond="#17120d",
        encre="#f5ece1",
        accent="#c8a06a",
        visage_x=540,
        visage_y=640,
        visage_cote=950,
    ),
    Chaine(
        cle="lisa",
        nom="LISA IA",
        signature="Comprendre ce que l'IA change, sans le vendre.",
        portrait=Path(
            "/home/patrice/.codebuddy/personas/lisa/wardrobe/lisa-blazer.png"
        ),
        fond="#0b1020",
        encre="#eef2ff",
        accent="#5e87ff",
        visage_x=540,
        visage_y=600,
        visage_cote=950,
    ),
)


def executer(commande: list[str]) -> None:
    resultat = subprocess.run(commande, capture_output=True, text=True)
    if resultat.returncode != 0:
        raise RuntimeError(
            f"échec de : {' '.join(commande[:3])}…\n{resultat.stderr.strip()[:400]}"
        )


def fabriquer_avatar(chaine: Chaine, sortie: Path) -> Path:
    """Carré centré sur le visage. On garde du souffle : YouTube rogne en cercle."""
    demi = chaine.visage_cote // 2
    gauche = max(0, chaine.visage_x - demi)
    haut = max(0, chaine.visage_y - demi)
    destination = sortie / f"{chaine.cle}-avatar-800.png"
    executer([
        "convert", str(chaine.portrait),
        "-crop", f"{chaine.visage_cote}x{chaine.visage_cote}+{gauche}+{haut}",
        "+repage",
        "-resize", f"{AVATAR}x{AVATAR}",
        "-quality", "95",
        str(destination),
    ])
    return destination


GRAS = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
NORMAL = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def fabriquer_banniere(chaine: Chaine, sortie: Path) -> Path:
    """Portrait à droite fondu dans le fond, texte dans la zone sûre à gauche.

    Écrit en PIL et non en ImageMagick : la version `convert` composait un fond
    blanc et perdait le portrait sans rien signaler. Ici chaque étape est
    vérifiable.
    """
    from PIL import Image, ImageDraw, ImageFont

    largeur, hauteur = BANNIERE
    zone_l, zone_h = ZONE_SURE
    zone_x = (largeur - zone_l) // 2
    zone_y = (hauteur - zone_h) // 2

    toile = Image.new("RGB", (largeur, hauteur), chaine.fond)

    # Le portrait occupe la moitié droite, cadré sur le buste.
    portrait = Image.open(chaine.portrait).convert("RGB")
    facteur = hauteur / portrait.height
    portrait = portrait.resize(
        (round(portrait.width * facteur), hauteur), Image.LANCZOS
    )
    portrait_l = portrait.width

    # Dégradé d'opacité : invisible à gauche, plein à droite. Sans lui, le
    # portrait se découpe en rectangle et la bannière fait montage amateur.
    masque = Image.new("L", (portrait_l, hauteur))
    dessin_masque = ImageDraw.Draw(masque)
    for x in range(portrait_l):
        t = x / max(1, portrait_l - 1)
        dessin_masque.line([(x, 0), (x, hauteur)], fill=int(255 * min(1.0, t * 1.9)))

    toile.paste(portrait, (largeur - portrait_l, 0), masque)

    dessin = ImageDraw.Draw(toile)
    police_nom = ImageFont.truetype(GRAS, 150)
    police_signature = ImageFont.truetype(NORMAL, 46)

    dessin.text((zone_x + 40, zone_y + 60), chaine.nom, font=police_nom, fill=chaine.encre)
    dessin.rectangle(
        [zone_x + 44, zone_y + 250, zone_x + 164, zone_y + 256], fill=chaine.accent
    )
    dessin.text(
        (zone_x + 40, zone_y + 296),
        chaine.signature,
        font=police_signature,
        fill=chaine.encre,
    )

    destination = sortie / f"{chaine.cle}-banniere-2560x1440.png"
    toile.save(destination)
    return destination


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument(
        "--sortie",
        type=Path,
        default=Path.home() / ".codebuddy" / "media-video" / "identite-chaines",
        help="dossier où déposer les visuels",
    )
    arguments = analyseur.parse_args()
    arguments.sortie.mkdir(parents=True, exist_ok=True)

    manquants = [c.nom for c in CHAINES if not c.portrait.is_file()]
    if manquants:
        print(f"Portraits introuvables pour : {', '.join(manquants)}", file=sys.stderr)
        return 1

    for chaine in CHAINES:
        avatar = fabriquer_avatar(chaine, arguments.sortie)
        banniere = fabriquer_banniere(chaine, arguments.sortie)
        print(f"{chaine.nom}")
        print(f"  avatar    {avatar}")
        print(f"  bannière  {banniere}")

    print(
        "\nÀ contrôler à l'œil avant publication : le visage doit tenir dans le "
        "cercle de l'avatar, et le texte de la bannière rester dans la zone de "
        f"{ZONE_SURE[0]}x{ZONE_SURE[1]} px visible sur mobile."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
