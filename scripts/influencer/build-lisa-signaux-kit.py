#!/usr/bin/env python3
"""Construit le kit de publication LISA IA « 5 signaux » v4.

Le master, son SRT et la plaque d'image générée sont vérifiés par empreinte. Les
textes sont écrits localement et les trois miniatures passent par le contrôleur
d'habillage commun avant d'être déclarées livrables.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


MASTER = Path(
    '/home/patrice/Videos/publication-2026-07-30/lisa-vision-ia/'
    'lisa-vision-ia-5-signaux-v4.mp4'
)
MASTER_SHA256 = '888dc692477ebcb03799b2ac51ea6031b6aa62dced2365b14a3945ffffc0d9c6'
SRT = MASTER.with_name('lisa-vision-ia-5-signaux-v4.fr.srt')
PLAQUE_IMAGEGEN = MASTER.parent / 'work/v4/lisa-thumbnail-plate-imagegen.png'
PLAQUE_SHA256 = 'de1bc7e9a0127b95ded8bf1b090aef006af1236f0c4b22a0561fbccb6055c15e'
IDENTITE = Path.home() / '.codebuddy/media-video/identite-chaines'
ARCFACE_PYTHON = Path.home() / '.venvs/tri-outils-qc/bin/python'
SEUIL_IDENTITE = 0.75

IMAGEGEN_PROMPT = """Use case: ads-marketing
Asset type: background plate for a 16:9 YouTube thumbnail for the French channel LISA IA
Primary request: create a polished editorial technology portrait using the reference woman as Lisa, preserving her recognizable face, hair color, age and realistic appearance.
Input images: Image 1 is the strict identity reference for Lisa.
Scene/backdrop: elegant dark navy and cyan AI newsroom, subtle abstract data streams and softly glowing interface shapes, no recognizable company logos.
Subject: Lisa shown from mid-torso upward on the RIGHT 40% of the frame, facing slightly toward the empty left side, confident thoughtful expression, modern dark navy blazer over a simple light top.
Style/medium: premium photorealistic editorial photography, crisp professional YouTube thumbnail quality.
Composition/framing: exact 16:9 landscape, generous clean negative space across the LEFT 55% for large headline typography; face and hair fully inside safe margins; simple silhouette that remains clear at phone size.
Lighting/mood: cool cyan rim light with soft warm skin tones, high contrast but natural skin texture, analytical and trustworthy rather than sensational.
Color palette: deep navy, cyan, restrained warm skin tones.
Constraints: preserve Lisa's identity closely; no text, no letters, no numbers, no logos, no watermark, no duplicate person, no extra face, no distorted hands, no cropped head."""

TITRES_RECOMMANDES = [
    'Krea, Qwen, Grok, Kimi : 5 signaux IA à retenir',
    '5 signaux IA qui redessinent les modèles et les agents',
    'Modèles ouverts, agents, sécurité : 5 signaux IA',
    'Pourquoi l’IA change d’échelle en 2026',
    'Krea 2, Qwen 3.7, Grok 4.5, Kimi K3 en 9 minutes',
]

TITRES = f"""# Propositions de titre

Tous les titres ci-dessous font moins de 60 caractères.

## Recommandation

### 1. {TITRES_RECOMMANDES[0]}

**Recommandé.** Le titre nomme les quatre familles recherchées et annonce une
sélection éditoriale, sans prétendre établir un classement absolu.

## Autres options

### 2. {TITRES_RECOMMANDES[1]}

Met l'accent sur le passage des modèles isolés vers des systèmes agentiques.

### 3. {TITRES_RECOMMANDES[2]}

Rend visibles les trois axes de la vidéo et sa partie sécurité.

### 4. {TITRES_RECOMMANDES[3]}

Le plus accessible pour un public non spécialiste, mais moins précis en
recherche YouTube.

### 5. {TITRES_RECOMMANDES[4]}

Promesse de durée concrète et noms complets, au prix d'un titre plus dense.
"""

CHAPITRES = """00:00 Les modèles changent de catégorie
00:35 Le plan
01:05 1. Krea 2 ouvre deux chemins
01:51 Ce que « ouvert » veut dire ici
02:43 2. Qwen 3.7 Max devient une plateforme
03:25 Un million de tokens n’est pas un million de preuves
04:12 3. Grok 4.5 : vitesse, code et agents
04:49 Pourquoi il n’existe pas de numéro un absolu
05:44 4. Kimi K3 raconte l’avenir par son architecture
06:32 Des poids ouverts, mais une machine immense
07:14 5. Quand l’agent dépasse le scénario
08:13 Le fil rouge
"""

DESCRIPTION = f"""Cette vidéo met en scène Lisa, créatrice virtuelle, et des visuels éditoriaux générés avec l’IA. Elle ne relate ni voyage ni test personnel réellement vécu.

Krea 2 ouvre ses poids. Qwen 3.7 Max s’installe dans les outils agentiques. Grok 4.5 mise sur la vitesse et le code. Kimi K3 publie une architecture frontière à poids ouverts. Enfin, un incident OpenAI–Hugging Face rappelle pourquoi l’autonomie doit rester contenue et traçable.

Lisa sépare les faits documentés, les chiffres publiés par les fournisseurs et l’analyse que l’on peut raisonnablement en tirer. Il ne s’agit pas d’un classement universel des modèles.

CHAPITRES
{CHAPITRES.rstrip()}

SOURCES CITÉES
Krea — Krea 2 Open-Source
https://www.krea.ai/krea-2-open-source

Krea — Community License v1
https://www.krea.ai/krea-2-licensing

Alibaba Cloud — modèles, génération de texte et prix
https://www.alibabacloud.com/help/en/model-studio/models
https://www.alibabacloud.com/help/en/model-studio/text-generation
https://www.alibabacloud.com/help/en/model-studio/model-pricing

Qwen Code — passage à qwen3.7-max
https://github.com/QwenLM/qwen-code/issues/6977

SpaceXAI — Grok 4.5
https://x.ai/news/grok-4-5
https://docs.x.ai/developers/models/grok-4.5

Kimi Team — Kimi K3
https://arxiv.org/abs/2607.24653

OpenAI — incident d’évaluation avec Hugging Face
https://openai.com/index/hugging-face-model-evaluation-security-incident/

RETROUVER LISA
La chaîne : [[URL_CHAINE_LISA]]
Les autres vidéos : [[URL_AUTRES_VIDEOS_LISA]]

Quel signal vous paraît le plus structurant : l’ouverture, les agents ou la sécurité ?

#IntelligenceArtificielle #ActualitéIA #LisaIA
"""

TAGS = [
    'intelligence artificielle',
    'actualité IA',
    'LISA IA',
    'Krea 2',
    'Qwen 3.7',
    'Grok 4.5',
    'Kimi K3',
    'modèles ouverts',
    'open weights',
    'agents IA',
    'sécurité IA',
    'Hugging Face',
    'OpenAI',
    'modèles de langage',
    'IA générative',
]

CHECKLIST = """# À vérifier avant publication

- [ ] Utiliser exclusivement `lisa-vision-ia-5-signaux-v4.mp4`, jamais le v3 refusé.
- [ ] Choisir le titre et l’une des trois miniatures après lecture à 320 px sur téléphone.
- [ ] Regarder et écouter le master en continu, de préférence d’abord en non répertorié.
- [ ] Dans YouTube Studio, régler « contenu modifié ou synthétique » sur **Oui**.
- [ ] Téléverser `sous-titres-fr.srt`, déclarer la langue française et vérifier les accents.
- [ ] Remplacer les deux marqueurs `[[...]]`, puis rechercher `[[` avant validation.
- [ ] Ouvrir chaque lien de source depuis la description finale.
- [ ] Vérifier le compte YouTube pour autoriser la miniature personnalisée.
- [ ] Confirmer qu’aucune musique tierce n’a été ajoutée après ce master.
- [ ] Valider le format éditorial LISA IA avant de choisir cette vidéo comme première édition.

## Contrôles déjà faits

Le master mesure 542,467 s, 16 274 images, −14,01 LUFS et −1,40 dBTP. Les 168
sous-titres, les douze cartons et les 24 zones d’habillage passent le contrôle
du composite final. Ces mesures ne remplacent pas la relecture humaine.
"""


def sha256(chemin: Path) -> str:
    hachage = hashlib.sha256()
    with chemin.open('rb') as fichier:
        for bloc in iter(lambda: fichier.read(1024 * 1024), b''):
            hachage.update(bloc)
    return hachage.hexdigest()


def verifier(chemin: Path, attendu: str, nom: str) -> None:
    if not chemin.is_file():
        raise FileNotFoundError(chemin)
    obtenu = sha256(chemin)
    if obtenu != attendu:
        raise RuntimeError(f'{nom} inattendu : {obtenu}, attendu {attendu}')


def executer(commande: list[str]) -> None:
    resultat = subprocess.run(commande, capture_output=True, text=True)
    if resultat.returncode != 0:
        detail = resultat.stderr.strip() or resultat.stdout.strip()
        raise RuntimeError(f"échec de {' '.join(commande[:3])}…\n{detail[-1600:]}")


def bloc(nom: str, texte: str, cadre: list[int], couleur: str, taille: int) -> dict:
    return {
        'nom': nom,
        'texte': texte,
        'cadre': cadre,
        'taille_max': taille,
        'taille_min': 42,
        'marge': 10,
        'lignes_max': 1,
        'vignette': True,
        'couleur': couleur,
        'contraste_min': 4.5,
        'plaque': {
            'couleur': '#07131f',
            'contour': couleur,
            'epaisseur': 4,
            'rayon': 14,
            'marge_x': 22,
            'marge_y': 15,
        },
    }


def miniature(
    destination: Path,
    plaque: Path,
    ligne_1: str,
    ligne_2: str,
    accent: str,
) -> dict:
    return {
        'destination': str(destination),
        'fond': '#07131f',
        'police': '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf',
        'photos': [{
            'fichier': str(plaque),
            'boite': [0, 0, 1280, 720],
            'cadrage_y': 0,
        }],
        'formes': [{
            'type': 'rectangle',
            'boite': [0, 0, 720, 720],
            'couleur': '#06101dcc',
        }],
        'textes': [
            {
                'nom': 'rubrique',
                'texte': 'LISA IA',
                'cadre': [48, 38, 230, 66],
                'taille_max': 34,
                'taille_min': 24,
                'marge': 5,
                'lignes_max': 1,
                'couleur': '#dff5ff',
                'plaque': {
                    'couleur': '#045578',
                    'rayon': 16,
                    'marge_x': 22,
                    'marge_y': 9,
                },
            },
            bloc('ligne-1', ligne_1, [44, 178, 620, 135], '#ffffff', 82),
            bloc('ligne-2', ligne_2, [44, 355, 620, 145], accent, 86),
        ],
        'obstacles': [{'nom': 'portrait de Lisa', 'boite': [760, 0, 520, 720]}],
    }


def ecrire_specification(sortie: Path, plaque: Path) -> Path:
    specifications = {
        'capitale_min_vignette': 9.0,
        'miniatures': [
            miniature(
                sortie / 'miniature-01-5-signaux.jpg', plaque,
                '5 SIGNAUX', 'À RETENIR', '#55d5ff',
            ),
            miniature(
                sortie / 'miniature-02-change-echelle.jpg', plaque,
                'L’IA CHANGE', 'D’ÉCHELLE', '#63e6be',
            ),
            miniature(
                sortie / 'miniature-03-risque.jpg', plaque,
                'PLUS OUVERTS', 'PLUS RISQUÉS ?', '#ffd166',
            ),
        ],
    }
    chemin = sortie / 'miniatures.json'
    chemin.write_text(
        json.dumps(specifications, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    return chemin


def ecrire_textes(sortie: Path) -> None:
    (sortie / 'titres.md').write_text(TITRES, encoding='utf-8')
    (sortie / 'description.txt').write_text(DESCRIPTION, encoding='utf-8')
    (sortie / 'tags.txt').write_text(', '.join(TAGS) + '\n', encoding='utf-8')
    (sortie / 'chapitres.txt').write_text(CHAPITRES, encoding='utf-8')
    (sortie / 'A-VERIFIER-AVANT-PUBLICATION.md').write_text(
        CHECKLIST, encoding='utf-8'
    )


def controler_identite(
    racine_depot: Path,
    sortie: Path,
    plaque: Path,
) -> tuple[Path, list[dict]]:
    if not ARCFACE_PYTHON.is_file():
        raise RuntimeError(
            f'contrôle d’identité indisponible : {ARCFACE_PYTHON} absent'
        )
    rapport = sortie / 'identite-miniatures.json'
    images = [
        plaque,
        sortie / 'miniature-01-5-signaux.jpg',
        sortie / 'miniature-02-change-echelle.jpg',
        sortie / 'miniature-03-risque.jpg',
    ]
    executer([
        str(ARCFACE_PYTHON),
        str(racine_depot / 'scripts/gpuNode/score-arcface-images.py'),
        '--reference', str(IDENTITE / 'lisa-avatar-800.png'),
        '--output', str(rapport),
        *(str(image) for image in images),
    ])
    mesures = json.loads(rapport.read_text(encoding='utf-8'))
    echecs = [
        mesure for mesure in mesures
        if not mesure.get('detected')
        or float(mesure.get('arcface') or 0) < SEUIL_IDENTITE
    ]
    if echecs:
        raise RuntimeError(
            'identité LISA refusée : ' + json.dumps(echecs, ensure_ascii=False)
        )
    return rapport, mesures


def main() -> int:
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument('--master', type=Path, default=MASTER)
    parseur.add_argument('--plaque', type=Path, default=PLAQUE_IMAGEGEN)
    parseur.add_argument(
        '--sortie', type=Path, default=MASTER.parent / 'kit-publication-v4'
    )
    args = parseur.parse_args()
    master = args.master.resolve()
    plaque = args.plaque.resolve()
    sortie = args.sortie.resolve()

    verifier(master, MASTER_SHA256, 'master v4')
    verifier(plaque, PLAQUE_SHA256, 'plaque ImageGen')
    if not SRT.is_file():
        raise FileNotFoundError(SRT)

    sortie.mkdir(parents=True, exist_ok=True)
    ecrire_textes(sortie)
    specification = ecrire_specification(sortie, plaque)

    racine_depot = Path(__file__).resolve().parents[2]
    executer([
        sys.executable,
        str(racine_depot / 'scripts/influencer/longform/miniature-youtube.py'),
        str(specification),
        '--planche', str(sortie / 'planche-comparaison-320px.jpg'),
        '--rapport', str(sortie / 'mesures-miniatures.json'),
    ])
    rapport_identite, mesures_identite = controler_identite(
        racine_depot, sortie, plaque
    )

    copies = {
        SRT: sortie / 'sous-titres-fr.srt',
        master.with_suffix(master.suffix + '.delivery-qc.json'):
            sortie / 'delivery-qc.json',
        IDENTITE / 'lisa-avatar-800.png': sortie / 'lisa-avatar-800.png',
        IDENTITE / 'lisa-banniere-2560x1440.png':
            sortie / 'lisa-banniere-2560x1440.png',
        plaque: sortie / '_travail/lisa-thumbnail-plate-imagegen.png',
    }
    for source, destination in copies.items():
        if not source.is_file():
            raise FileNotFoundError(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    provenance = sortie / '_travail/IMAGEGEN-PROVENANCE.md'
    provenance.write_text(
        '# Provenance de la plaque de miniature\n\n'
        'Mode : outil ImageGen intégré. Référence d’identité : '
        '`lisa-avatar-800.png`.\n\n## Prompt\n\n```text\n'
        + IMAGEGEN_PROMPT + '\n```\n',
        encoding='utf-8',
    )

    artefacts = [
        sortie / 'titres.md',
        sortie / 'description.txt',
        sortie / 'tags.txt',
        sortie / 'chapitres.txt',
        sortie / 'A-VERIFIER-AVANT-PUBLICATION.md',
        sortie / 'sous-titres-fr.srt',
        sortie / 'delivery-qc.json',
        sortie / 'miniature-01-5-signaux.jpg',
        sortie / 'miniature-02-change-echelle.jpg',
        sortie / 'miniature-03-risque.jpg',
        sortie / 'planche-comparaison-320px.jpg',
        sortie / 'mesures-miniatures.json',
        rapport_identite,
        sortie / 'lisa-avatar-800.png',
        sortie / 'lisa-banniere-2560x1440.png',
        sortie / '_travail/lisa-thumbnail-plate-imagegen.png',
        provenance,
    ]
    manifeste = {
        'schemaVersion': 1,
        'master': str(master),
        'masterSha256': sha256(master),
        'subtitleCues': 168,
        'syntheticContentDeclarationRequired': True,
        'chaptersIncluded': True,
        'tagsCount': len(TAGS),
        'thumbnailSource': {
            'mode': 'built-in-imagegen',
            'sha256': sha256(plaque),
            'identityReference': str(IDENTITE / 'lisa-avatar-800.png'),
        },
        'identity': {
            'backend': 'ArcFace buffalo_l',
            'threshold': SEUIL_IDENTITE,
            'minimum': min(float(mesure['arcface']) for mesure in mesures_identite),
            'maximum': max(float(mesure['arcface']) for mesure in mesures_identite),
            'allDetected': all(mesure['detected'] for mesure in mesures_identite),
        },
        'artifacts': {
            chemin.relative_to(sortie).as_posix(): {
                'sha256': sha256(chemin),
                'bytes': chemin.stat().st_size,
            }
            for chemin in artefacts
        },
    }
    (sortie / 'manifest.json').write_text(
        json.dumps(manifeste, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(f'Kit construit : {sortie}')
    print(f'{len(artefacts) + 1} livrables, {len(TAGS)} tags, 3 miniatures')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
