#!/usr/bin/env python3
"""Construit le kit de publication du film AMBRE « chalet d’automne ».

Le master reste la source de vérité : le script vérifie son SHA-256, extrait
les trois portraits retenus, délègue les miniatures au contrôleur d’habillage
commun, puis écrit les textes, la checklist et un manifeste reproductible.

    python3 scripts/influencer/build-ambre-chalet-kit.py
    python3 scripts/influencer/build-ambre-chalet-kit.py --sortie /tmp/kit
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


MASTER_SHA256 = 'd6bc37510e4118e71640c2a71a3042f71a0345227298406ab7dfe4b9e32b6ca5'
MASTER_RELATIF = Path(
    '.codebuddy/media-video/ambre-chalet-automne/ambre-chalet-automne-v02.mp4'
)
IDENTITE_RELATIVE = Path('.codebuddy/media-video/identite-chaines')

PLANS = {
    '16': 38.20,
    '22': 52.75,
    '31': 74.60,
}

TITRES = """# Propositions de titre

## Recommandation

### 1. Un chalet d’automne, entre pluie et feu | AMBRE

**49 caractères — recommandé.** Le lieu, la saison et les deux matières du
film sont immédiatement lisibles. La promesse est sensorielle et exacte : elle
n’invente ni voyage vécu, ni histoire absente du montage.

## Autres options

### 2. Le silence d’un chalet sous la pluie — AMBRE

**46 caractères.** Met la pluie et le calme au premier plan. Plus contemplatif,
mais il cache le feu et la chaleur qui donnent au film son contraste.

### 3. 76 secondes dans un chalet d’automne

**38 caractères.** Promesse très concrète et faible coût de clic. Le titre
vend une parenthèse courte sans faire passer Ambre pour une voyageuse réelle.

### 4. Pluie, feu et bois chaud : un automne au chalet

**50 caractères.** Le plus matière et décoration. Il décrit fidèlement les
images, au prix d’un titre un peu plus catalogue.

### 5. L’automne au chalet, sans dire un mot | AMBRE

**47 caractères.** Rend le choix d’un film sans narration explicite. À retenir
si ce silence devient une signature éditoriale de la chaîne.
"""

DESCRIPTION = """Cette vidéo met en scène une créatrice virtuelle et des décors générés ou composés avec l’IA. Elle ne relate pas un voyage réel.

Un marché mouillé, un chalet de bois, la pluie sur les vitres et le feu qui prend : 76 secondes pour traverser une journée d’automne avec Ambre, sans narration ni dialogue.

Ambre est une persona synthétique. Le film est une création visuelle, pas un témoignage ni le récit d’un séjour réellement vécu.

MUSIQUE
« It Could Be Sweet » (Instrumental Version) — Ludlów
Epidemic Sound

RETROUVER AMBRE
La chaîne : [[URL_CHAINE_AMBRE]]
Les autres vidéos : [[URL_AUTRES_VIDEOS_AMBRE]]

Quel détail vous retient le plus : la pluie, le feu ou les couleurs du marché ?

#Automne #Chalet #Ambre
"""

TAGS = [
    'chalet automne',
    'ambiance automne',
    'film automne',
    'pluie au chalet',
    'feu de cheminée',
    'cosy autumn',
    'ambiance cosy',
    'slow living',
    'cinematic autumn',
    'chalet de montagne',
    'décoration chalet',
    'créatrice virtuelle',
    'influenceuse virtuelle',
    'art généré par IA',
    'AMBRE',
]

CHECKLIST = """# À vérifier avant publication

- [ ] Choisir le titre et l’une des trois miniatures après lecture sur téléphone.
- [ ] Regarder le master en continu sur téléphone et l’écouter sur enceintes.
- [ ] Dans YouTube Studio, régler « contenu modifié ou synthétique » sur **Oui**.
- [ ] Remplacer les deux marqueurs `[[...]]`, puis vérifier qu’il n’en reste aucun.
- [ ] Vérifier le compte YouTube pour autoriser la miniature personnalisée.
- [ ] Rattacher cette chaîne à l’abonnement Epidemic Sound avant la mise en ligne.
- [ ] Retrouver et archiver le reçu ou l’attestation couvrant « It Could Be Sweet ».
- [ ] Confirmer le titre exact de la piste et l’artiste dans l’interface Epidemic.
- [ ] Ne publier qu’après validation humaine du master, de la miniature et du son.

## Point non automatisable

Le sidecar identifie la piste, son empreinte et la bibliothèque, mais porte
`licenseVerifiedExternally: false`. La présence du fichier audio local ne
prouve donc ni l’achat, ni le rattachement de la chaîne au bon abonnement.
"""


def sha256(chemin: Path) -> str:
    hachage = hashlib.sha256()
    with chemin.open('rb') as fichier:
        for bloc in iter(lambda: fichier.read(1024 * 1024), b''):
            hachage.update(bloc)
    return hachage.hexdigest()


def executer(commande: list[str]) -> None:
    resultat = subprocess.run(commande, capture_output=True, text=True)
    if resultat.returncode != 0:
        erreur = resultat.stderr.strip() or resultat.stdout.strip()
        raise RuntimeError(f"échec de {' '.join(commande[:3])}…\n{erreur[-1200:]}")


def extraire_plans(master: Path, dossier: Path) -> dict[str, Path]:
    dossier.mkdir(parents=True, exist_ok=True)
    chemins: dict[str, Path] = {}
    for plan, seconde in PLANS.items():
        destination = dossier / f'plan-{plan}.png'
        executer([
            'ffmpeg', '-nostdin', '-loglevel', 'error', '-ss', f'{seconde:.2f}',
            '-i', str(master), '-frames:v', '1', '-y', str(destination),
        ])
        chemins[plan] = destination
    return chemins


def texte(
    nom: str,
    valeur: str,
    cadre: list[int],
    couleur: str,
    taille_max: int,
) -> dict[str, object]:
    return {
        'nom': nom,
        'texte': valeur,
        'cadre': cadre,
        'taille_max': taille_max,
        'taille_min': 42,
        'marge': 10,
        'lignes_max': 1,
        'vignette': True,
        'couleur': couleur,
        'contraste_min': 4.5,
        'plaque': {
            'couleur': '#17120d',
            'contour': couleur,
            'epaisseur': 4,
            'rayon': 16,
            'marge_x': 24,
            'marge_y': 17,
        },
    }


def miniature(
    destination: Path,
    image: Path,
    premiere: str,
    seconde: str,
    accent: str,
) -> dict[str, object]:
    return {
        'destination': str(destination),
        'fond': '#17120d',
        'police': '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf',
        'formes': [
            {'type': 'ellipse', 'boite': [-260, -90, 820, 900], 'couleur': '#211913'},
            {'type': 'ellipse', 'boite': [60, 500, 300, 300], 'couleur': '#2d2118'},
        ],
        'photos': [{
            'fichier': str(image),
            'boite': [560, 0, 720, 720],
            'cadrage_y': 0,
            'fondu_gauche': 230,
        }],
        'textes': [
            {
                'nom': 'rubrique',
                'texte': 'AMBRE',
                'cadre': [48, 36, 250, 70],
                'taille_max': 38,
                'taille_min': 24,
                'marge': 6,
                'lignes_max': 1,
                'couleur': '#f5ece1',
                'plaque': {
                    'couleur': '#6d4325',
                    'rayon': 18,
                    'marge_x': 24,
                    'marge_y': 10,
                },
            },
            texte('ligne-1', premiere, [40, 170, 560, 140], '#f5ece1', 82),
            texte('ligne-2', seconde, [40, 338, 560, 150], accent, 92),
        ],
        'obstacles': [],
    }


def ecrire_specification(sortie: Path, plans: dict[str, Path]) -> Path:
    specification = {
        'capitale_min_vignette': 9.0,
        'miniatures': [
            miniature(
                sortie / 'miniature-01-automne-chalet.jpg', plans['31'],
                'UN AUTOMNE', 'AU CHALET', '#d9a76c',
            ),
            miniature(
                sortie / 'miniature-02-pluie-feu.jpg', plans['22'],
                'PLUIE, FEU', 'BOIS CHAUD', '#e7b867',
            ),
            miniature(
                sortie / 'miniature-03-76-secondes.jpg', plans['16'],
                '76 SECONDES', 'HORS DU TEMPS', '#d9a76c',
            ),
        ],
    }
    chemin = sortie / 'miniatures.json'
    chemin.write_text(
        json.dumps(specification, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    return chemin


def ecrire_textes(sortie: Path) -> None:
    (sortie / 'titres.md').write_text(TITRES, encoding='utf-8')
    (sortie / 'description.txt').write_text(DESCRIPTION, encoding='utf-8')
    (sortie / 'tags.txt').write_text(', '.join(TAGS) + '\n', encoding='utf-8')
    (sortie / 'A-VERIFIER-AVANT-PUBLICATION.md').write_text(
        CHECKLIST, encoding='utf-8'
    )


def copier_identite(sortie: Path, racine_identite: Path) -> list[Path]:
    resultats: list[Path] = []
    for nom in ('ambre-avatar-800.png', 'ambre-banniere-2560x1440.png'):
        source = racine_identite / nom
        if not source.is_file():
            raise FileNotFoundError(
                f'{source} absent — relancer scripts/influencer/build-channel-art.py'
            )
        destination = sortie / nom
        shutil.copy2(source, destination)
        resultats.append(destination)
    return resultats


def main() -> int:
    analyseur = argparse.ArgumentParser(description=__doc__)
    analyseur.add_argument('--master', type=Path, default=Path.home() / MASTER_RELATIF)
    analyseur.add_argument(
        '--sortie', type=Path,
        default=Path.home() / MASTER_RELATIF.parent / 'kit-publication',
    )
    arguments = analyseur.parse_args()
    master = arguments.master.resolve()
    sortie = arguments.sortie.resolve()
    if not master.is_file():
        raise FileNotFoundError(master)
    empreinte = sha256(master)
    if empreinte != MASTER_SHA256:
        raise RuntimeError(
            f'master inattendu : SHA-256 {empreinte}, attendu {MASTER_SHA256}. '
            'Les timecodes de miniature ne sont plus opposables.'
        )

    sortie.mkdir(parents=True, exist_ok=True)
    plans = extraire_plans(master, sortie / '_travail' / 'plans')
    specification = ecrire_specification(sortie, plans)
    ecrire_textes(sortie)

    racine_depot = Path(__file__).resolve().parents[2]
    script_miniatures = (
        racine_depot / 'scripts/influencer/longform/miniature-youtube.py'
    )
    executer([
        sys.executable, str(script_miniatures), str(specification),
        '--planche', str(sortie / 'planche-comparaison-320px.jpg'),
        '--rapport', str(sortie / 'mesures-miniatures.json'),
    ])
    identite = copier_identite(sortie, Path.home() / IDENTITE_RELATIVE)

    artefacts = [
        sortie / 'titres.md',
        sortie / 'description.txt',
        sortie / 'tags.txt',
        sortie / 'A-VERIFIER-AVANT-PUBLICATION.md',
        sortie / 'miniature-01-automne-chalet.jpg',
        sortie / 'miniature-02-pluie-feu.jpg',
        sortie / 'miniature-03-76-secondes.jpg',
        sortie / 'planche-comparaison-320px.jpg',
        sortie / 'mesures-miniatures.json',
        *identite,
    ]
    manifeste = {
        'schemaVersion': 1,
        'master': str(master),
        'masterSha256': empreinte,
        'sourceFramesSeconds': PLANS,
        'syntheticContentDeclarationRequired': True,
        'chaptersIncluded': False,
        'chaptersReason': 'film muet de 76,2 s : des chapitres fragmenteraient la lecture',
        'musicLicenseVerifiedExternally': False,
        'tagsCount': len(TAGS),
        'artifacts': {
            chemin.name: {'sha256': sha256(chemin), 'bytes': chemin.stat().st_size}
            for chemin in artefacts
        },
    }
    (sortie / 'manifest.json').write_text(
        json.dumps(manifeste, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'Kit construit : {sortie}')
    print(f'{len(artefacts) + 1} livrables, {len(TAGS)} tags, 3 miniatures contrôlées')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
