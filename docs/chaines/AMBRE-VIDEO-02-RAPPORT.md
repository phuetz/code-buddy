# AMBRE — rapport de la vidéo 02, Japon

Rendu le 1er août 2026 sur la branche `feat/mysoulmate-media-pipeline`, en
reprenant le moteur de montage et les seuils documentés pour la vidéo 01.

## Résultat

Le master final est :

```text
/home/patrice/.codebuddy/media-video/ambre-japon/ambre-japon-v01.mp4
```

Son sidecar auditable est placé à côté :

```text
/home/patrice/.codebuddy/media-video/ambre-japon/ambre-japon-v01.mp4.meta.json
```

SHA-256 du master :
`2c3dfde03eea10ac5db512c6deaa07e64118c1f945a99605e07f121bc3dba457`.
Le fichier mesure 142 485 616 octets. Il ne contient ni narration, ni titre,
ni carton. La déclaration de contenu synthétique reste obligatoire à la
publication.

## Arc narratif

**Éclosion → géométrie → pluie → dissolution → retour à la lumière.**
Le pétale devient tracé puis eau avant que le jardin ne retrouve le soleil ;
Ambre relie ces états du lieu sans revendiquer un voyage, une rencontre ou une
expérience vécue.

Ce parcours sensoriel ne reprend donc pas la logique spatiale « arriver,
entrer, s’installer » du chalet. Les coupes sont rapides, mais les pétales,
l’eau, la pluie, les travellings et les mouvements Ken Burns restent lents à
l’intérieur de chaque plan.

## Re-scoring canonique des dix composites

Les dix fichiers `ambre-013` à `ambre-022` ont été recalculés avec
`scripts/gpuNode/score-arcface-images.py` contre une seule image du kit
canonique, jamais contre un composite ni une image de garde-robe :

```text
/home/patrice/.codebuddy/personas/ambre/identity-kit/ambre-v3-preview.png
```

SHA-256 de la référence :
`092b88b98b68f46e383316bf6c5aa80cefefeef6069c792bb5965a938fd858bf`.
Les résultats bruts sont conservés hors dépôt dans
`qc/arcface/originaux-ambre-v3-preview.json` à côté du master.

| ID | ArcFace V3 canonique | Seuil 0,75 |
|---:|---:|:---|
| 013 | 0,812585 | passe |
| 014 | 0,584060 | rejette |
| 015 | 0,755388 | passe |
| 016 | 0,883945 | passe |
| 017 | 0,295366 | rejette |
| 018 | 0,799019 | passe |
| 019 | 0,466843 | rejette |
| 020 | 0,507694 | rejette |
| 021 | 0,818563 | passe |
| 022 | 0,608653 | rejette |

Le nouveau calcul donne donc **5 originaux admis sur 10**, et non les anciens
verdicts 4 OK, 3 MINEUR, 3 REJET. Les anciens sidecars ne servent pas de preuve
d’admission : certains mesuraient l’image contre une référence de tenue.

### Vérification des réparations nocturnes

Les variantes trouvées dans
`~/Videos/personas/composites-identite-2026-08-01/` ont été recalculées contre
la même V3 canonique :

| ID | Original | Réparation retenue | Gain | Verdict |
|---:|---:|---:|---:|:---|
| 017 | 0,295366 | 0,951884 (`replays-v3`) | +0,656518 | passe |
| 019 | 0,466843 | 0,761397 (`replays`) | +0,294554 | passe |
| 020 | 0,507694 | 0,753092 (`replays`) | +0,245399 | passe |

Le total atteint ainsi **exactement 8 sources sur 10 au-dessus de 0,75**. La
condition « moins de 8 » n’étant plus vraie, aucune nouvelle génération n’a été
lancée et aucun des deux services ComfyUI de gpuNode n’a été touché.

Les réparations 019 et 020 ont été admises dans le vivier, mais écartées du
master : dans un premier rendu non livré, leur petite marge se réduisait après
compression à 0,735 et 0,733. Le montage final emploie les six sources les plus
robustes (013, 015, 016, 017 réparée, 018 et 021), recadrées différemment pour
13 apparitions d’Ambre. Toutes les images Ambre réellement extraites du master
final repassent 0,75.

## Décors et sélection

La bibliothèque dédiée contient 27 variantes vidéo japonaises issues des six
familles sakura, temple, pluie et eau sous
`~/.codebuddy/media-video/ambre-automne/`. Dix-neuf candidates ont été
inspectées à 0,5 s, 2,5 s et 5,5 s ; 18 fichiers distincts ont été retenus :

```text
ambre-007, 008, 009, 010, 029, 030, 031, 032, 053,
054, 055, 077, 078, 079, 099, 100, 101 et 102
```

La porte locale pré-montage donne 5 `OK`, 13 `À REGARDER`, 0 `REJET`. Les 13
alertes ont été ouvertes : l’OCR confondait branches, gravier et eau avec du
pseudo-texte ; les trois contours signalés étaient des lignes réelles du
jardin. Neuf variantes ont été écartées pour redondance ou force visuelle
inférieure, dont `ambre-076` après son contrôle trois images.

## Musique et traçabilité

La piste continue retenue est :

```text
ES_Somewhat Elegant - Dye O.mp3
```

Les tags donnent le titre `Somewhat Elegant` et l’artiste `Dye O`. Le fichier,
classé `elegant` dans la bibliothèque locale Epidemic Sound, a pour SHA-256
`f302e0de5b5f7dd23efe6bf46175fabbf63236b08c6f8695ff1fe0587d1c15aa`.
La base de droits reste la couverture multi-chaînes et publicité déclarée dans
la mission ; aucun reçu ni état de compte n’a été consulté séparément.

## Mesures du rendu final

Toutes les valeurs ci-dessous viennent du MP4 final.

| Mesure | Résultat | Cible |
|:---|---:|:---|
| Durée | 76,200 s | 75–90 s |
| Nombre de plans | 31 | — |
| Coupes détectées sur le master | 30 | 30 pour 31 plans |
| Durée moyenne | 2,458 s | ≈ 2,4 s |
| Plans avec Ambre | 13 / 31 = 41,94 % | ≈ 40 % |
| Plans de décor | 18 / 31 = 58,06 % | ≈ 60 % |
| Loudness intégré | −14,06 LUFS | −14 LUFS |
| Pic vrai | −1,85 dBTP | sous −1 dBTP |
| Plage de loudness | 8,0 LU | — |
| Audio | AAC stéréo, 48 kHz, 76,200 s | musique continue |
| Vidéo | H.264, 1280×720, 30 i/s, 76,200 s | — |

La détection de scène FFmpeg à 0,22 retrouve exactement les 30 coupes. Le seuil
0,18 de la vidéo 01 produisait ici des faux positifs sur les pluies de pétales ;
il n’a donc pas été présenté comme une mesure valide.

Le plan embarqué dans le sidecar confirme qu’aucun couple consécutif n’a la
même échelle. La variation `1 − SSIM`, mesurée entre deux images intérieures de
chaque plan à 0,25 s de ses bords, va de 0,438913 à 0,692406 : aucun plan n’est
fixe. Les 18 sources vidéo conservent leur mouvement interne et les 13 plans
Ambre ont un zoom ou panoramique lent.

Le dernier plan est `ambre-099`, une allée de sakura en mouvement vers une
porte prise dans le soleil. Il constitue la résolution lumineuse de l’arc et
n’est ni un portrait limite, ni un plan technique faible.

## Noir et porte visuelle finale

`blackdetect=d=0.08:pix_th=0.10:pic_th=0.98` ne remonte **aucune alerte**. Il
n’existe donc aucune plage noire ni image d’alerte à inspecter. Le contrôle a
porté sur les 76,2 secondes du master final.

Une image médiane a été extraite de chacun des 31 plans du MP4, puis passée dans
`scripts/influencer/visual-gate.py` :

| Lot final | OK | À REGARDER | REJET |
|:---|---:|---:|---:|
| 13 images avec Ambre | 5 | 8 | 0 |
| 18 images de décor | 5 | 13 | 0 |
| Total | 10 | 21 | 0 |

Les scores ArcFace des 13 images Ambre après compression et montage vont de
0,750370 à 0,949115. Le second contrôle vision local (`gemma4:12b`) juge les 13
images Ambre `OK` sur le vêtement, les mains, le corps, le visage, les artefacts
et le texte parasite.

Les **21 alertes `À REGARDER` ont toutes été ouvertes** sur la planche finale à
512 px, puis les contours ambigus ont été vus en pleine résolution. Elles
correspondent aux branches, pétales, stries du gravier, pierres, reflets d’eau,
lanternes et lignes architecturales réelles. Aucun texte lisible, logo, défaut
anatomique bloquant ou établissement identifiable n’a été observé. La seconde
opinion vision n’a pas tourné sur les 18 décors (`llm_vision: null`) ; leur
validation repose sur la porte déterministe et cette inspection humaine.

## Garde-fous éditoriaux

Le film ne contient aucune affirmation à la première personne, aucun avis sur
un établissement et aucune rencontre. Les temples et jardins ne sont pas
nommés : Ambre interprète visuellement un Japon floral générique sans prétendre
documenter un lieu réel précis.

## Ce qui n’a pas pu être vérifié

- L’écoute subjective de la musique et du rythme sur un système audio humain
  n’a pas été réalisée ; le choix repose sur le classement `elegant`, les tags
  et les mesures du fichier.
- Le master n’a pas été regardé en continu et en temps réel par une personne ;
  les contrôles portent sur les mesures complètes, les 31 images médianes, les
  planches chronologique et d’alertes, et les images pleine résolution utiles.
- Le reçu/licence Epidemic Sound et l’état de l’abonnement n’ont pas été
  ouverts ; la traçabilité du fichier est complète, mais la couverture
  juridique repose sur l’information fournie dans la mission.
- Aucune publication YouTube ni déclaration de contenu synthétique n’a été
  effectuée.

Le code reproductible est
`scripts/mysoulmate/render-ambre-japon-video.py`. Tous les médias, scores,
planches et sidecars QC restent hors dépôt dans
`~/.codebuddy/media-video/ambre-japon/`.
