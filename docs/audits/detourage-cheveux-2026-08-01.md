# Audit du détourage des cheveux — 2026-08-01

## Verdict

Le défaut structurel est corrigé dans la chaîne d'insertion : la sortie Qwen
passe désormais obligatoirement par un alpha BiRefNet continu, puis par
`BlurFusionForegroundEstimation`, avant recomposition sur la plaque intacte.
Le bord sujet n'est ni seuillé ni flouté. Le commit de code est `e3195054`.

Le résultat n'est toutefois pas déclaré entièrement résolu : sur les 22 plans,
la médiane mesurée passe de **5 à 6 px**, mais seulement **14/22** atteignent la
cible de 6 px. La porte visuelle passe de **6 OK / 16 À REGARDER / 0 REJET** à
**10 OK / 12 À REGARDER / 0 REJET**. Les sommets parfaitement lisses produits
par Qwen restent lisses : un matting peut préserver des mèches présentes, pas
en inventer honnêtement.

## Diagnostic exact

La prémisse « le masque sujet devient binaire à tel endroit » ne correspond pas
au chemin versionné sur ce HEAD. Le défaut y est plus en amont : **aucun masque
sujet n'existait dans la composition Qwen par défaut**.

- `scripts/darkstar/workflows/insert-qwen-edit.json:136` décode directement le
  latent Qwen ; `scripts/darkstar/workflows/insert-qwen-edit.json:149` envoie ce
  décodage directement à `SaveImage`. La silhouette dure est donc déjà cuite
  dans les pixels du composite.
- `src/tools/video/character-in-location.ts:192` charge bien un masque, mais son
  titre et son usage à `src/tools/video/character-in-location.ts:197` montrent
  qu'il s'agit du **Face Edit Mask**. Il protège le visage pendant
  l'échantillonnage et la recomposition (`:202` et `:217`) ; il ne détoure pas
  la personne.
- Ce masque facial part d'une ellipse 0/255 dans
  `scripts/darkstar/restore-canonical-face.py:45` et `:58`, puis est adouci à
  `scripts/darkstar/restore-canonical-face.py:185`. Il ne contient aucune
  information de chevelure.
- Le contrat `--relight` exigeait historiquement un ancien
  `RembgByBiRefNet`, mais son export opérateur
  `insert-qwen-edit-relight.json` n'est pas présent dans le dépôt. Son éventuel
  seuillage exact ne peut donc pas être attribué à une ligne versionnée.

Le gate d'identité n'avait aucune chance d'attraper ce défaut : il opère sur le
visage, alors que le défaut est au bord de la chevelure.

## Chaîne corrigée

La configuration est fixée dans `src/tools/video/character-in-location.ts:50` :
`Matting-HR`, calcul 2048×2048 en float32, `mask_threshold: 0`. Le graphe construit
à `src/tools/video/character-in-location.ts:250` exécute :

1. chargement du composite généré et de la plaque sans sujet ;
2. `AutoDownloadBiRefNetModel(Matting-HR)` (`:264`) ;
3. `RembgByBiRefNetAdvanced` sans seuillage (`:273`) ;
4. `BlurFusionForegroundEstimation` sur le masque continu (`:289`) ;
5. extraction du RGB estimé avec `SplitImageWithAlpha` (`:301`) ; son socket
   MASK est volontairement ignoré car Comfy y expose `1 - alpha` ;
6. recomposition sur la plaque intacte avec le masque continu non inversé de
   l'estimation de premier plan (`:308`) ;
7. restauration des pixels exacts uniquement dans le cœur opaque : seuil 0,5,
   puis érosion de 16 px (`:320` et `:328`). Ce masque binaire intérieur ne
   touche jamais la transition capillaire.

La troisième soumission est obligatoire dans la CLI à
`scripts/darkstar/insert-character-in-location.ts:659`–`675`; sa sortie remplace
désormais le composite Qwen brut à `:677`. Le rejeu isolé, avec contrôles de
fichiers et refus d'écraser une entrée, est à
`scripts/darkstar/insert-character-in-location.ts:479`. Le manifeste des 12
plans chalet et 10 plans Japon est à
`scripts/darkstar/replay-hair-matte-composites.ts:22`.

Contrôle du masque sur le prototype 001 : 256 niveaux distincts, 20,15 % de
pixels intermédiaires dans l'image de masque et seulement 336 pixels exactement
à 255. Il s'agit bien d'un alpha continu, pas d'un masque binaire flouté.
`GrowMaskWithBlur`, `FeatherMask` et `MaskBlur+` ne sont pas utilisés sur le
bord sujet.

## Méthode de mesure

Le mode historique de `mesurer-detourage.py` cherchait le plus fort gradient du
tiers central. Sur les plaques vides, il mesurait déjà de 3 à 7 px : toit,
horizon et branches pouvaient donc être pris pour des cheveux. L'option
`--face-bbox` ajoutée à `scripts/influencer/mesurer-detourage.py:90` restreint
la mesure à une ROI dérivée de la boîte ArcFace. La cible de 6 px est exposée à
`:159`; `--minimum 6` permet de l'utiliser comme porte sans modifier le code de
sortie historique par défaut.

Cette ROI réduit les faux positifs sans les supprimer tous : sur le plan 010,
le toit traverse encore la zone capillaire. Les nombres ci-dessous doivent donc
rester subordonnés à la porte visuelle et à la planche-contact.

## Rejeu des 22 plans

Les entrées sont exactement celles déclarées dans le manifeste de rejeu. Pour
008, 010, 012, 017, 019 et 020, la version déjà réparée pour l'identité a été
retenue afin de ne pas réintroduire l'ancien visage. Le référentiel
`~/.codebuddy/personas/ambre/**` n'a été utilisé qu'en lecture.

| Plan | Transition avant → après | ArcFace avant → après | Porte visuelle avant → après |
|---|---:|---:|---|
| 001 | 5,0 → 6,0 px | 0,8948 → 0,8951 | OK → OK |
| 002 | 5,0 → 7,0 px | 0,9192 → 0,9178 | OK → OK |
| 003 | 4,0 → 7,5 px | 0,8962 → 0,8953 | À REGARDER → À REGARDER |
| 004 | 2,0 → 7,5 px | 0,8593 → 0,8623 | À REGARDER → À REGARDER |
| 005 | 6,0 → 7,0 px | 0,8747 → 0,8748 | OK → À REGARDER |
| 006 | 7,0 → 7,0 px | 0,8176 → 0,8176 | OK → OK |
| 007 | 5,0 → 6,0 px | 0,9293 → 0,9309 | OK → OK |
| 008 | 6,0 → 6,0 px | 0,8556 → 0,8574 | À REGARDER → À REGARDER |
| 009 | 7,0 → 7,0 px | 0,9267 → 0,9298 | OK → OK |
| 010 | 3,0 → 2,0 px | 0,9710 → 0,9722 | À REGARDER → OK |
| 011 | 4,0 → 3,0 px | 0,8834 → 0,8854 | À REGARDER → À REGARDER |
| 012 | 4,0 → 4,0 px | 0,8912 → 0,8930 | À REGARDER → À REGARDER |
| 013 | 6,0 → 5,5 px | 0,8126 → 0,8136 | À REGARDER → À REGARDER |
| 014 | 3,0 → 7,5 px | 0,5841 → 0,5751 | À REGARDER → À REGARDER |
| 015 | 5,0 → 4,0 px | 0,7554 → 0,7578 | À REGARDER → OK |
| 016 | 4,0 → 4,0 px | 0,8839 → 0,8834 | À REGARDER → OK |
| 017 | 5,0 → 6,0 px | 0,9519 → 0,9519 | À REGARDER → OK |
| 018 | 5,0 → 6,0 px | 0,7990 → 0,8045 | À REGARDER → À REGARDER |
| 019 | 8,0 → 4,0 px | 0,7614 → 0,7552 | À REGARDER → À REGARDER |
| 020 | 3,0 → 6,0 px | 0,7531 → 0,7565 | À REGARDER → À REGARDER |
| 021 | 5,0 → 5,0 px | 0,8186 → 0,8182 | À REGARDER → OK |
| 022 | 7,0 → 6,0 px | 0,6087 → 0,6108 | À REGARDER → À REGARDER |

Synthèse :

- chalet : médiane 5,0 → 6,5 px, cible atteinte sur 9/12 ;
- Japon : médiane 5,0 → 5,75 px, cible atteinte sur 5/10 ;
- ensemble : médiane 5,0 → 6,0 px, cible atteinte sur 14/22 ;
- ArcFace : médiane 0,8670 → 0,8685, aucun passage sous un seuil de porte et
  aucun changement de classe identité ;
- porte visuelle complète Gemma Vision locale : 6 → 10 OK, aucun REJET.

## Artefacts hors dépôt

Aucune image n'est commitée. Les livrables binaires et les preuves sont ici :

- sorties finales :
  `/home/patrice/Videos/personas/composites-cheveux-2026-08-01/replays-v3/` ;
- planche-contact 22 gros plans avant/après :
  `/home/patrice/Videos/personas/composites-cheveux-2026-08-01/planche-contact-cheveux-avant-apres.jpg` ;
- résultats structurés :
  `/home/patrice/Videos/personas/composites-cheveux-2026-08-01/evaluation/resultats-finaux-v3.json` ;
- sortie des 22 invocations de la porte 6 px :
  `/home/patrice/Videos/personas/composites-cheveux-2026-08-01/evaluation/mesurer-detourage-final-v3.txt` ;
- ArcFace avant/après : `evaluation/arcface-avant.json` et
  `evaluation/arcface-apres-v3.json` sous la même racine.

## Vérifications

- `python3 -m pytest tests/scripts/influencer/ -q` : **115 réussis, 1 ignoré**.
  La référence de mission indiquait 114 réussis ; le HEAD courant en collecte
  115, sans ajout de test Python dans ce correctif.
- Vitest ciblé insertion/matting : **13 réussis**.
- `npm run typecheck` : réussi.
- ESLint ciblé sur les fichiers TypeScript modifiés : réussi.
- `mesurer-detourage.py --face-bbox ... --minimum 6` : rejoué séparément sur
  les 22 sorties ; 14 réussites, échecs explicites 010, 011, 012, 013, 015,
  016, 019 et 021.
- Porte visuelle complète avec `gemma4:12b`, sans `--no-llm` : avant
  6 OK / 16 À REGARDER / 0 REJET ; après 10 / 12 / 0.

Les deux ComfyUI permanents ont été identifiés avant usage :
`D:\DEV\ComfyUI\main.py --listen 0.0.0.0 --port 8188` et équivalent 8189.
Les files ont été contrôlées avant chaque lot. Seule l'API `/free` a été appelée
sur des files vides ; aucun processus n'a été tué ou relancé.

## Ce qui reste imparfait ou non vérifié

1. **Huit plans restent sous 6 px.** Les checkpoints `Matting`, `General-HR` et
   `Portrait` ont été comparés à `Matting-HR` sur le cas dur 010 ; aucun ne crée
   de mèche ou n'améliore le chiffre. Un flou aurait fait monter la mesure sans
   améliorer l'image et a donc été refusé.
2. **Le sommet reste trop régulier sur plusieurs plans**, notamment 010–012,
   015–016, 019 et 021. Le halo sombre est réduit, mais l'information de mèches
   absente du rendu Qwen ne peut pas être reconstruite par le matting seul.
3. **L'identité ne change pas de classe de porte**, mais le score brut baisse de
   0,0090 sur 014 et de 0,0062 sur 019. Ces écarts viennent avec un léger
   recalage de la boîte détectée quand le fond autour de la tête change. Une
   exigence strictement monotone sur chaque nombre ArcFace n'est donc pas
   satisfaite, même si aucun seuil n'est franchi.
4. Le plan 005 passe de OK à À REGARDER à cause d'une alerte de contour
   résiduel. Aucun plan n'est rejeté, mais il doit être revu au zoom.
5. Le rejeu porte sur la **passe finale de matting** des 22 composites approuvés,
   pas sur une régénération Qwen complète des 22 scènes. L'intégration de la
   troisième passe est testée et le même graphe a été exécuté en direct, mais
   un nouveau rendu Qwen aurait changé pose, visage et décor et aurait invalidé
   la comparaison contrôlée.
6. Le verdict humain du propriétaire reste à rendre sur la planche-contact. La
   porte Gemma et la mesure ne le remplacent pas.
7. L'export opérateur `insert-qwen-edit-relight.json` absent n'a pas pu être
   inspecté ; le diagnostic ligne par ligne couvre le chemin par défaut présent
   et exécuté dans ce dépôt.
