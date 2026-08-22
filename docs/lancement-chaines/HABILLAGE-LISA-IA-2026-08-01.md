# LISA IA — les défauts d'habillage levés

**Date : samedi 1er août 2026.** Suite de
[`ETAT-2026-08-01.md`](ETAT-2026-08-01.md), dont ce document reprend les
défauts §1.4 (cartons d'attribution, miniatures) et §1.5 (habillage de
« 5 signaux »).

Ce document est un **compte rendu de correction**. Rien n'a été publié, aucun
compte créé, aucun crédit Flow / HeyGen / ElevenLabs dépensé. Les masters
d'origine sont intacts : les versions corrigées portent un nouveau nom.

> **Rapport historique.** La correction « 5 signaux » v3 décrite ici a ensuite
> été refusée parce que son pied de page masquait 52 repères SRT pendant
> 109,167 s. Elle est remplacée par la v4. Pour le verdict courant, voir
> [`CORRECTION-LISA-5-SIGNAUX-V4-2026-08-01.md`](CORRECTION-LISA-5-SIGNAUX-V4-2026-08-01.md).

---

## Ce qui a changé, en une page

| Défaut | Avant (mesuré) | Après (mesuré) | Fichier produit dans cette passe |
|---|---|---|---|
| 3 cartons d'attribution Meta illisibles | contraste **1,00:1** ; fond sous le texte étalé de 0,23 à **1,00** | **19,0:1** ; étalement **0,001** | `meta-ai-agentique-master-v2.mp4` |
| 3 miniatures dont le texte déborde | ink hors cadre de **+17 / +13 / +23 px** | **0 px** hors cadre, contraste 4,9 → 19,3:1 | `miniature-0{1,2,3}-*.jpg` |
| Titre coupé par le bord droit (« 5 signaux ») | **3** titres coupés (1 956, 1 774, 1 751 px pour 1 620 utiles) | passés à la ligne, dans le cadre | `lisa-vision-ia-5-signaux-v3.mp4` |
| Puce « Source » sur le logo LISA IA | recouvrement **sur toute la vidéo** | plaque unique logo + source, 0 px² de recouvrement | idem |
| Sous-titre incrusté sur le pied de page | recouvrement | pied remonté à y=820, hors boîte du sous-titre | idem |

### Où regarder

Tout est dans **`~/Videos/preuves-habillage-lisa-2026-08-01/`**, étiqueté par
nom de fichier (`montage -label '%f'` — le tri par nom seul fait attribuer une
image au mauvais plan) :

| Fichier | Ce qu'il montre |
|---|---|
| `1-cartons-attribution-meta-avant-apres.jpg` | les trois cartons, avant / après |
| `2-miniatures-avant-apres.jpg` | les trois miniatures en pleine taille |
| `3-miniatures-vignette-320px-avant-apres.jpg` | **les six réduites à 320 px** — la taille où elles seront réellement choisies |
| `4-signaux-titres-avant-apres.jpg` | les trois titres coupés, avant / après |
| `5-signaux-logo-et-source-avant-apres.jpg` | la puce « Source » sur le logo, avant / après |
| `6-…` et `7-…` (txt) | les journaux du rouge puis du vert (§4) |
| `8-`, `9-`, `10-` (json) | les mesures brutes, zone par zone |

Fichiers livrés :

| Média | Chemin |
|---|---|
| Master Meta corrigé | `~/.codebuddy/longform/meta-ai-agit-a-votre-place/meta-ai-agentique-master-v2.mp4` |
| Miniatures corrigées | `…/meta-ai-agit-a-votre-place/publication/miniature-0{1,2,3}-*.jpg` |
| Master « 5 signaux » corrigé dans cette passe, **refusé ensuite** | `~/Videos/publication-2026-07-30/lisa-vision-ia/lisa-vision-ia-5-signaux-v3.mp4` |
| Master de livraison actuel | `~/Videos/publication-2026-07-30/lisa-vision-ia/lisa-vision-ia-5-signaux-v4.mp4` |

Les masters d'origine (`…-master-v1.mp4`, `…-5-signaux-v2.mp4`) n'ont pas été
touchés.

---

## 1. Les trois cartons d'attribution (le plus grave)

### Ce que j'ai vérifié moi-même avant de corriger

Le rapport situait les cartons « ≈ 07:24, 08:27, 09:28 ». Je ne l'ai pas cru
sur parole : j'ai balayé la luminance d'une bande de gauche du master à 5 i/s
et cherché les plages où apparaît le pillarbox gris des captures portrait.
Trois plages de ~8 s ressortent — **444,0→452,8 · 507,2→515,4 · 568,2→576,2** —
et deux plages de 3,8 s qui sont du B-roll clair, pas des captures.

Les trois cartons portaient un texte **blanc**. Mesure sous les glyphes
(on redessine les glyphes, on prend l'anneau qui les entoure comme fond local,
on retient le **pire** fond) :

| Segment | Contraste rendu | Étalement du fond |
|---|---|---|
| 448 s | **1,00:1** | **1,00** (le mockup de téléphone traverse le texte) |
| 511 s | **1,00:1** | 0,23 |
| 572 s | **1,00:1** | 0,23 |

1,00:1, c'est du blanc sur blanc. Le seuil WCAG 2.1 AA pour du texte courant
est 4,5:1.

### Un défaut que le rapport n'avait pas vu

Les trois plages viennent de **deux** fichiers seulement. `visuals/10-demo-
recherche-slides-vo/` contient 7 visuels pour 10 emplacements : l'assembleur
recycle la liste, et `meta-officiel-research-16x9.mp4` revient en 10ᵉ position.
Les segments 2 et 3 sont donc **le même plan**, monté deux fois à 60 s
d'écart. Ce n'est pas un défaut d'habillage, mais c'est bon à savoir avant de
relire la vidéo.

### La correction

Une bande opaque de 84 px est réservée en bas de cadre (`#0d1018`, filet
d'accent `#4aa3ff`), le texte centré dedans. Attribution précisée au passage :

> CAPTURE OFFICIELLE META • BRIEFING QUOTIDIEN • 24 JUILLET 2026
> CAPTURE OFFICIELLE META • RECHERCHE ET SLIDES • 24 JUILLET 2026

Résultat mesuré aux trois segments : **19,0:1**, étalement du fond **0,001**,
encre entièrement dans le cadre réservé.

### Pourquoi une passe complète et non un recollage

Le premier essai ne ré-encodait que les ~27 s de cartons et recollait le reste
en copie de flux — la voie la moins coûteuse, et celle qui laisse intact ce qui
a déjà été contrôlé. **Elle casse le master.** Mesuré par intercorrélation
audio v1/v2 : +21 ms de dérive à 100 s, +240 ms à 460 s, **+677 ms à 600 s**
(la vidéo gagnait 6 images, l'audio 0,51 s). L'avatar HeyGen parle justement
après les trois cartons : 677 ms d'écart, c'est une bouche désynchronisée.

Abandonné. Une passe unique, audio copié tel quel :

| Contrôle | v1 | v2 |
|---|---|---|
| Durée | 675,300 s | 675,300 s |
| Images | 20 259 | 20 259 |
| Dérive audio (intercorrélation à 100 / 460 / 520 / 600 / 660 s) | — | **0,0 ms partout**, pic 1,000 |

Le fichier grossit (614 → 721 Mo) : c'est le prix du ré-encodage à CRF 16, choisi
pour ne pas dégrader les 99,6 % de la vidéo qui n'avaient rien à corriger.

---

## 2. Les trois miniatures

La cause est la même sur les trois, et ce n'est pas de l'inattention :
`-annotate +x+y` place une **ligne de base**, pas un bloc, et les cadres
avaient été dessinés à des coordonnées choisies indépendamment du texte. Mesure
de l'encre réelle sur les fichiers d'origine :

| Miniature | Encre | Cadre dessiné | Verdict |
|---|---|---|---|
| 01 « ELLE AGIT » | y 256→318 | y 143→**301** | **17 px sous la bordure** |
| 02 « TU LUI DONNES » | x 53→**619** | x 35→**606** | **13 px à droite** |
| 03 « ELLE PARLAIT. » | y 131→**176** | y 25→**153** | **23 px sous la bordure** |

La règle est inversée dans le nouveau fabricant : **la plaque est dessinée
autour du bloc mesuré**. Elle ne peut donc pas être vide, et le texte ne peut
pas déborder de sa bordure — c'est la même contrainte, prise par l'autre bout.
La bande verticale nette à la jonction panneau/photo a disparu aussi : le fondu
de la photo se fait désormais sur un fond de la même couleur.

Mesures obtenues (aucun manquement) :

| Miniature | Bloc | Corps | Contraste |
|---|---|---|---|
| 01 | ELLE AGIT / POUR TOI | 96 / 100 pt | 18,04 / 12,87:1 |
| 02 | TU LUI DONNES / LES CLÉS ? | 68 / 98 pt | 19,34 / 13,86:1 |
| 03 | ELLE PARLAIT. / ELLE AGIT. | 76 / 102 pt | 16,78 / 12,64:1 |

**Lisibilité en vignette.** Elle n'est pas jugée à l'œil : la hauteur de
capitale du bloc porteur est convertie à 320 px de large et comparée à un
plancher de 9 px. Les six blocs porteurs sont entre 17 et 26 px. La planche
`3-…-vignette-320px-…` montre les six miniatures à cette taille exacte.

---

## 3. « 5 signaux » — titre coupé, puce sur le logo

### Trois titres coupés, pas un

Le rapport en signalait un (03:30). En mesurant les douze titres à 66 pt contre
les 1 620 px utiles de la carte :

| Section | Largeur du titre | Verdict |
|---|---|---|
| `06-qwen-nuance` | 1 956 px | **coupé** |
| `09-kimi` | 1 774 px | **coupé** |
| `10-kimi-ouvert` | 1 751 px | **coupé** |
| `08-grok-benchmarks` | 1 688 px | 82 px de marge — passe, de justesse |

Les trois coupés sont corrigés : le titre passe à la ligne et tient dans son
cadre.

### La puce « Source » recouvrait le logo pendant neuf minutes

Le bandeau « LISA IA » incrusté au montage occupe x 44→264, y 33→95 (mesuré au
pixel sur le master). La puce `Source` était calée en `Alignment 7, MarginL 46,
MarginV 36` : elle tombait dessus. Pas une image sur douze — **toutes**, du
début à la fin.

Réparation : une **plaque unique** en haut à gauche qui porte le logo ET la
source côte à côte, séparés d'un filet. Elle recouvre entièrement la zone
abîmée (elle démarre plus à gauche et finit plus à droite que l'ancienne) et
supprime le problème au lieu de le déplacer.

### Un troisième défaut sur la même image

Le pied de page « Lisa est une créatrice virtuelle • édition documentée » était
à y≈925, c'est-à-dire **dans** la boîte du sous-titre incrusté (sommet vers
y=894). Remonté à y=820, et la boîte du sous-titre est désormais déclarée comme
obstacle : le contrôle refuse toute carte qui y écrirait.

### Comment la réparation a été faite

L'étape d'assemblage du master v2 n'existe **sous forme de script nulle part
sur le disque** — je l'ai cherchée. Refabriquer la vidéo à l'aveugle risquait
d'abîmer plus que de réparer. La bande de titre et celle du pied sont donc
**repeintes** avec le dégradé réellement présent : il est vertical et uniforme
horizontalement (vérifié — même RVB à x=60, 800, 1500 et 1890 sur chaque
ligne), on échantillonne donc une colonne que rien n'occupe et on la répand.
La retouche est invisible, ce qu'un aplat choisi à la main n'aurait pas été.

Les cartes sont statiques (écart maximal de 6 niveaux entre deux images
espacées de 6 s) : une plaque fixe ne « glisse » pas sur l'image.

### Ce que ça donne, mesuré

**39 zones de texte** contrôlées sur le master produit (12 plaques logo+source,
12 pieds de page, 3 titres refaits) :

| Contrôle | Résultat |
|---|---|
| Contraste le plus bas des 39 zones | **6,75:1** (seuil 4,5:1) |
| Contraste le plus haut | 17,63:1 |
| Étalement du fond le plus élevé | 0,004 (seuil 0,12) |
| Durée v2 → v3 | 542,467 s → **542,467 s** |
| Images v2 → v3 | 16 274 → **16 274** |
| Dérive audio (60 / 210 / 350 / 500 s) | **0,0 ms partout**, pic 1,000 |

---

## 4. La règle de fabrication, et la preuve qu'elle mord

Corriger les fichiers ne sert à rien si le prochain rendu réintroduit le
défaut. Trois scripts sont livrés dans le dépôt (commit `af19dbf9`) :

| Fichier | Rôle |
|---|---|
| `scripts/influencer/habillage.py` | mesure : ajustement au cadre, contraste WCAG sous les glyphes, chevauchements |
| `scripts/influencer/longform/carton-attribution.py` | fabrique et répare les cartons d'attribution |
| `scripts/influencer/longform/miniature-youtube.py` | fabrique les miniatures 1280×720 |
| `tests/scripts/influencer/test_habillage.py` | 10 tests, dont 5 qui vérifient un **refus** |

Et deux scripts de production corrigés sur place (hors dépôt, ils vivent à côté
des médias) : `…/lisa-vision-ia/work/render-assets.py` (ajuste le titre à son
cadre, déclare la boîte du sous-titre) et `…/work/make-subs.py` (déclare la
zone du bandeau, refuse un placement qui la recouvre).

### Le rouge, puis le vert

Un contrôle qui ne trouve rien ne prouve rien. Les défauts ont donc été remis
délibérément :

```
ESSAI 1 — on rallonge « ELLE AGIT » au-delà de son cadre
ÉCHEC accroche : « ELLE AGIT VRAIMENT TOUTE SEULE POUR TOI » ne tient pas dans
{'x': 50, 'y': 160, 'largeur': 540, 'hauteur': 134} même à 44 pt
(mesuré 529×85 px, 2 ligne(s)).                                  code de sortie : 2

ESSAI 2 — on rétrécit « POUR TOI » sous le seuil vignette
ÉCHEC benefice : hauteur de capitale 5.5 px à 320 px de large (< 9.0)
       — illisible sur une vignette de téléphone                 code de sortie : 2

ESSAI 3 — on repose « ELLE AGIT » en blanc sur fond clair
ÉCHEC accroche : contraste rendu 1.11:1 < 4.5:1 exigé
       (encre L=1.000 sur pire fond L=0.896)                     code de sortie : 2

RESTAURATION                                                     code de sortie : 0
```

Et sur le fabricant de cartons, en repeignant la bande en blanc dans le script
lui-même :

```
ESSAI 1 — attribution trop longue pour la bande réservée
ÉCHEC carton d'attribution : … ne tient pas … même à 22 pt      code de sortie : 2

ESSAI 2 — BANDE_FOND = '#f4f4f4'
ÉCHEC carton d'attribution : contraste rendu 1.10:1 < 4.5:1     code de sortie : 2

RESTAURATION — BANDE_FOND = '#0d1018'                            code de sortie : 0
```

Journaux complets : `6-preuve-le-controle-echoue-miniatures.txt` et
`7-preuve-le-controle-echoue-carton.txt` dans le dossier de preuves.

Le contrôle du placement sait aussi refuser. Remettre `SOURCE_MARGE_L = 46`
dans `make-subs.py`, c'est-à-dire replacer la puce exactement où elle était :

```
ESSAI — on remet la puce « Source » à sa place d'origine (MarginL 46)
habillage refusé :
  - puce Source « Source : Synthèse éditoriale » recouvre bandeau LISA IA
    sur 7752 px² ({'x': 44, 'y': 34, 'largeur': 228, 'hauteur': 34})
  … (les douze sections)                                         code de sortie : 1

RESTAURATION — MarginL 300                                       code de sortie : 0
```

Journal : `11-preuve-le-controle-echoue-sous-titres.txt`.

---

## 5. Ce que je n'ai pas pu garantir

- **Je n'ai pas regardé les masters corrigés en continu.** J'ai contrôlé des
  images extraites aux endroits corrigés et aux bornes des segments. Une
  relecture humaine de bout en bout reste à faire (c'est le B6 du dossier du
  1er août, qui n'avait déjà pas été fait).
- **Je n'ai pas écouté la bande son.** Elle est copiée au bit près sur le
  master Meta (`-c:a copy`) et la synchronisation est mesurée à 0,0 ms, mais
  mesurer n'est pas entendre.
- **La perte de qualité du ré-encodage n'est pas mesurée** (pas de PSNR/SSIM
  entre v1 et v2). Le CRF 16 est un choix prudent, pas une preuve.
- **Le bas du mockup de téléphone est rogné d'environ 35 px** par la bande
  d'attribution, sur les trois segments Meta. C'est un choix : la bande est
  opaque et pleine largeur pour que le texte ne puisse plus être traversé. La
  zone perdue ne contient que le bord bas de l'interface.
- **Les 12 cartes source de « 5 signaux » ont été régénérées**, mais elles ne
  sont pas ce qui est monté dans le master : le master a été réparé par
  recouvrement. Si la vidéo est un jour refabriquée depuis les cartes, elle
  partira des bonnes.
- **Je n'ai pas relu les 9 autres titres** de « 5 signaux » à l'image, seulement
  mesuré leur largeur. `08-grok-benchmarks` passe à 82 px près : c'est peu.
- **Aucune vérification faite sur AMBRE** : une autre passe y travaillait en
  parallèle, je n'ai touché ni à ses images ni à `mesurer-detourage.py`.

---

## La question que je ne peux pas trancher

**Le carton d'attribution doit-il nommer l'URL de la source, ou la date
suffit-elle ?**

J'ai écrit « CAPTURE OFFICIELLE META • RECHERCHE ET SLIDES • 24 JUILLET 2026 ».
L'URL complète (`about.fb.com/news/2026/07/meta-ai-muse-spark-doesnt-just-
think-it-acts/`) est dans la description, et elle ne tient pas sur la bande sans
descendre le corps à un niveau où le carton redevient difficile à lire à 360p —
c'est-à-dire retomber dans le défaut par l'autre bout. Mettre l'éditeur et la
date à l'écran, la référence complète en description, est l'usage courant ; je
ne sais pas si c'est le niveau d'exigence que tu veux tenir sur une chaîne qui
commente une entreprise de cette taille. C'est un arbitrage entre le risque
juridique et la lisibilité, et il t'appartient.
