#!/usr/bin/env python3
"""Fabrique une miniature YouTube 1280×720 sur la grammaire d'Ambre.

Le modèle est `thumbnails/v2/thumb-retraite-v3.png`, la seule du kit qui marche :
visage détouré à droite regardant l'objectif, deux ou trois mots à gauche en très
gros, jaune et blanc sur fond sombre, badge en étoile quand il y a un chiffre.

Ce qui compte, et pourquoi :

- **Moins de quatre mots.** La miniature est lue à la taille d'un timbre sur un
  téléphone. Une phrase y devient une tache grise.
- **Un visage qui regarde.** C'est le seul élément qu'un œil trouve avant de lire.
- **Du contraste, pas de la finesse.** Le fond est assombri sous le texte : sans
  cela, un ciel clair avale du blanc et un mur ocre avale du jaune.
- **Le fond vient d'un plan NET de la vidéo**, jamais d'un fondu — le montage
  d'Ambre enchaîne en fondus longs, donc une image prise au hasard est floue.

    miniature.py --fond image.jpg --portrait ambre.png \
                 --ligne1 PARTEZ --ligne2 "EN 2026" [--badge "TOP 10"] --out t.png
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

L, H = 1280, 720
JAUNE, BLANC, NOIR = '#FFD400', '#FFFFFF', '#000000'


def outil(nom: str) -> str:
    chemin = shutil.which(nom)
    if not chemin:
        sys.exit(f"ERREUR: {nom} absent — installer ImageMagick")
    return chemin


def police() -> str:
    """Une graisse la plus lourde possible : c'est elle qui tient à petite taille."""
    for candidate in ('Anton', 'Impact', 'DejaVu-Sans-Bold', 'Liberation-Sans-Bold'):
        res = subprocess.run([outil('convert'), '-list', 'font'],
                             capture_output=True, text=True)
        if candidate.lower() in res.stdout.lower():
            return candidate
    return 'DejaVu-Sans-Bold'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fond', type=Path, required=True)
    ap.add_argument('--portrait', type=Path, required=True, help='PNG à fond transparent')
    ap.add_argument('--ligne1', required=True)
    ap.add_argument('--ligne2', default='')
    ap.add_argument('--badge', default='', help='ex. "TOP 10" — étoile rouge en haut à gauche')
    ap.add_argument('--recadre-haut', type=float, default=0.0, metavar='PART',
                    help="ne garder que cette part haute du fond (0.55 = 55%%) — "
                         "ecarte la vignette d'Ambre deja incrustee dans ses videos")
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()

    c = outil('convert')
    for f in (a.fond, a.portrait):
        if not f.exists():
            sys.exit(f'ERREUR: {f} introuvable')
    # Les videos d'Ambre portent DEJA sa vignette incrustee en bas a droite : une image
    # prise telle quelle donnerait deux Ambre dans la meme miniature. --recadre-haut ne
    # garde que la partie superieure de la source, ou l'incrustation n'est pas.
    if a.recadre_haut:
        import tempfile
        larg, haut = subprocess.run([outil('identify'), '-format', '%w %h', str(a.fond)],
                                    capture_output=True, text=True).stdout.split()
        garde = int(int(haut) * a.recadre_haut)
        tmp = Path(tempfile.mkdtemp()) / 'fond.png'
        subprocess.run([c, str(a.fond), '-crop', f'{larg}x{garde}+0+0', '+repage', str(tmp)],
                       check=True)
        a.fond = tmp
    mots = len(f'{a.ligne1} {a.ligne2}'.split())
    if mots > 4:
        sys.exit(f'ERREUR: {mots} mots — la miniature en supporte 4 au plus, elle est lue en vignette')

    f = police()
    a.out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [c, str(a.fond),
           '-resize', f'{L}x{H}^', '-gravity', 'center', '-extent', f'{L}x{H}',
           # assombrir la moitié gauche : le texte doit tenir sur n'importe quel décor
           # Le voile couvre TOUTE la largeur et s'eteint vers la droite : arrete a
           # mi-image, il laissait une couture verticale nette en plein cadre.
           '(', '-size', f'{H}x{L}', 'gradient:#000000D9-#00000000', '-rotate', '270', ')',
           '-gravity', 'west', '-composite',
           # le portrait à droite, en pleine hauteur
           '(', str(a.portrait), '-resize', f'x{H}', ')', '-gravity', 'east', '-composite']

    # texte : contour noir épais, sinon il disparaît sur un fond clair
    y1 = -60 if a.ligne2 else -20
    cmd += ['-font', f, '-gravity', 'west',
            '-pointsize', '132', '-fill', JAUNE, '-stroke', NOIR, '-strokewidth', '14',
            '-annotate', f'+60{y1:+d}', a.ligne1,
            '-stroke', 'none', '-fill', JAUNE, '-annotate', f'+60{y1:+d}', a.ligne1]
    if a.ligne2:
        cmd += ['-pointsize', '120', '-fill', BLANC, '-stroke', NOIR, '-strokewidth', '14',
                '-annotate', '+60+80', a.ligne2,
                '-stroke', 'none', '-fill', BLANC, '-annotate', '+60+80', a.ligne2]
    if a.badge:
        h1, _, h2 = a.badge.partition(' ')
        import math
        pts = []
        for k in range(24):
            r = 128 if k % 2 == 0 else 96
            ang = math.pi * k / 12 - math.pi / 2
            pts.append(f'{130 + r * math.cos(ang):.0f},{130 + r * math.sin(ang):.0f}')
        cmd += ['(', '-size', '260x260', 'xc:none', '-fill', '#E01B1B',
                '-stroke', BLANC, '-strokewidth', '6',
                '-draw', 'polygon ' + ' '.join(pts), '-stroke', 'none',
                '-font', f, '-gravity', 'center', '-pointsize', '74', '-fill', BLANC,
                '-annotate', '+0-34', h1,
                '-pointsize', '86', '-fill', JAUNE, '-annotate', '+0+36', h2, ')',
                '-gravity', 'northwest', '-geometry', '+40+30', '-composite']

    cmd += ['-quality', '92', str(a.out)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f'ERREUR ImageMagick: {res.stderr.strip()[:300]}')
    print(f'{a.out} · {a.out.stat().st_size // 1024} Ko')
    return 0


if __name__ == '__main__':
    sys.exit(main())
