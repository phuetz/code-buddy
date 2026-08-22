# AMBRE — rapport de la vidéo 01, chalet d’automne

Rendu le 1er août 2026 selon
[`AMBRE-PREMIERE-VIDEO.md`](AMBRE-PREMIERE-VIDEO.md), sur la branche
`feat/mysoulmate-media-pipeline`.

## Résultat

Le master final est :

```text
/home/patrice/.codebuddy/media-video/ambre-chalet-automne/ambre-chalet-automne-v01.mp4
```

Son sidecar est placé à côté :

```text
/home/patrice/.codebuddy/media-video/ambre-chalet-automne/ambre-chalet-automne-v01.mp4.meta.json
```

SHA-256 du master :
`6de2285bfe9893ba8a1a39ef814f50bff80a76ecfd61c846e99c4e929619acaa`.
Le fichier mesure 53 723 603 octets. Il ne contient ni narration, ni titre, ni
carton. La déclaration de contenu synthétique reste obligatoire à la
publication.

## Re-scoring des douze plans du chalet

Le re-scoring a été exécuté avant montage avec
`scripts/darkstar/score-arcface-images.py`. Le script n’accepte qu’un fichier de
référence, pas un dossier. La référence utilisée est donc l’image canonique V3
du kit, et jamais un composite généré :

```text
/home/patrice/.codebuddy/personas/ambre/identity-kit/ambre-v3-preview.png
```

Son SHA-256 est
`092b88b98b68f46e383316bf6c5aa80cefefeef6069c792bb5965a938fd858bf`.
Les mesures brutes sont conservées hors dépôt dans
`qc/arcface/ambre-v3-preview.json` à côté du master.

| ID | Source évaluée | ArcFace | Verdict |
|---:|:---|---:|:---|
| 001 | original `ambre-001-chalet-exterieur-doudoune.png` | 0,894818 | passe |
| 002 | original `ambre-002-chalet-exterieur-flanelle.png` | 0,919244 | passe |
| 003 | original `ambre-003-chalet-salon-pull-creme.png` | 0,896209 | passe |
| 004 | original `ambre-004-chalet-salon-flanelle.png` | 0,859346 | passe |
| 005 | original `ambre-005-chalet-terrasse-doudoune.png` | 0,874717 | passe |
| 006 | original `ambre-006-chalet-terrasse-bordeaux.png` | 0,817581 | passe |
| 007 | original `ambre-007-chalet-large-doudoune.png` | 0,929256 | passe |
| 008 | réparé `live-008/composite.png` | 0,855580 | passe |
| 009 | original `ambre-009-chalet-fenetre-flanelle.png` | 0,926729 | passe |
| 010 | réparé `replays-v2/ambre-010…/composite.png` | 0,971014 | passe |
| 011 | original `ambre-011-chalet-interieur-flanelle.png` | 0,883423 | passe |
| 012 | réparé `replays-v2/ambre-012…/composite.png` | 0,891220 | passe |

Les douze passent la cible 0,75 ; aucun plan Ambre n’a donc été écarté. Le plus
bas est `006` à 0,817581.

Une mesure complémentaire contre les cinq autres portraits présents dans le
répertoire canonique a révélé une incohérence du kit : ces anciennes références
donnent typiquement 0,22 à 0,63 sur les mêmes plans, alors que la V3 donne 0,82 à
0,97. Les six matrices sont conservées dans `qc/arcface/`. Il ne serait pas
valide de choisir, plan par plan, le meilleur score. Le montage utilise donc une
seule référence V3 déclarée et hachée pour tous les plans.

## B-roll contrôlé et sélectionné

Les 91 fichiers ont d’abord été inventoriés sur une image extraite à deux
secondes. Treize candidats compatibles avec le chalet ont ensuite été regardés
à 0,5 s, 2,5 s et 5,5 s, avec contrôle de durée, bandes noires et gel d’image.
Un échantillon des dix candidats pré-montage a également passé la porte locale :
6 `OK`, 4 `À REGARDER`, 0 `REJET`. Les quatre alertes étaient des lignes réelles
dans la pluie, un livre, le foyer et les troncs.

Le master final utilise neuf fichiers : `b11`, `b12`, `b15`, `b18`, `b20`,
`b22`, `b24`, `b27` et `b094`. **82 B-roll ont été écartés** :

- 78 étaient hors sujet dès l’inventaire (ville, finance, médical, IA, etc.) ;
- `b55` montrait un paysage arctique sans continuité avec le chalet ;
- `b56` montrait un champ de céréales sans continuité spatiale ;
- `b091` portait du pseudo-texte visible sur une vitrine ;
- `b16`, pourtant accepté avant montage, a été rejeté sur le premier rendu : le
  recadrage/agrandissement de la bougie produisait une netteté de 5,7, sous le
  seuil 10. Le plan 17 a été remplacé et la porte rejouée sans modifier le
  seuil.

## Musique et traçabilité

La piste douce retenue est :

```text
ES_It Could Be Sweet (Instrumental Version) - Ludlow.mp3
```

Les tags du fichier indiquent le titre `It Could Be Sweet` et l’artiste
`Ludlów`. La source se trouve dans le dossier `warm` de la bibliothèque locale
Epidemic Sound. Le sidecar conserve son chemin et son SHA-256. La base de droits
est la couverture multi-chaînes et publicité fournie dans la mission ; aucun
reçu de licence ou état de compte Epidemic Sound n’a été consulté séparément.

## Mesures du rendu final

Toutes les valeurs ci-dessous viennent du MP4 final, pas des sources.

| Mesure | Résultat | Cible |
|:---|---:|:---|
| Durée | 76,300 s | 75–90 s |
| Nombre de plans | 31 | — |
| Coupes détectées sur le master | 30 | 30 pour 31 plans |
| Durée moyenne | 2,461 s | ≈ 2,4 s |
| Plans avec Ambre | 12 / 31 = 38,71 % | ≈ 40 % |
| Plans de décor | 19 / 31 = 61,29 % | ≈ 60 % |
| Loudness intégré | −14,07 LUFS | −14 LUFS |
| Pic vrai | −1,40 dBTP | sous −1 dBTP |
| Audio | AAC stéréo, 48 kHz | musique continue |
| Vidéo | H.264, 1280×720, 30 i/s | — |

L’alternance d’échelle est validée par le plan embarqué dans le sidecar : aucun
couple consécutif n’a la même échelle. La détection de scène FFmpeg à 0,18 a
retrouvé exactement 30 coupes.

Le mouvement a été vérifié entre deux images intérieures à chaque plan, à
0,25 s de ses bords. La variation `1 − SSIM` va de 0,209966 à 0,609703 sur les
31 plans : aucun plan n’est fixe. Les sources vidéo gardent leur mouvement
interne ; les douze images Ambre reçoivent un zoom/panoramique lent.

Le dernier plan est le panorama de montagne `b12`, retenu comme image forte de
chute. Le montage suit l’arc : arriver, entrer, s’installer, regarder dehors,
puis repartir avec l’image. Toutes les transitions sont des coupes franches.

## Noir et porte visuelle finale

`blackdetect=d=0.08:pix_th=0.10:pic_th=0.98` ne remonte **aucune alerte**. Il
n’y avait donc aucune plage noire à extraire ou inspecter. Les bandes noires de
`b12` et `b094` ont été retirées au montage.

Une image médiane a été extraite de chacun des 31 plans du master, puis passée
dans `scripts/influencer/visual-gate.py` :

| Lot final | OK | À REGARDER | REJET |
|:---|---:|---:|---:|
| 12 images avec Ambre | 5 | 7 | 0 |
| 19 images de décor | 9 | 10 | 0 |

Les scores ArcFace des douze images Ambre **après compression et montage** vont
de 0,820682 à 0,962924 : aucune dérive d’identité n’est introduite par le
master. Les 17 `À REGARDER` ont été réunis sur une planche à 600 px et inspectés
visuellement. Les alertes correspondent à des arêtes réelles (montagne,
boiseries, troncs) ou à des faux positifs OCR sur pluie, textile et pages ;
aucun défaut bloquant ni établissement identifiable n’a été observé. Le premier
master, qui contenait le rejet de netteté `b16`, n’est pas le livrable final.

## Ce qui n’a pas pu être vérifié

- L’écoute subjective de la piste et du rythme sur un système audio humain n’a
  pas été réalisée ; le choix musical repose sur le classement `warm`, le titre,
  les tags et les mesures du fichier.
- Le reçu/licence Epidemic Sound et l’état de l’abonnement n’ont pas été ouverts ;
  la traçabilité du fichier est complète, mais la couverture juridique repose
  sur l’information fournie dans la mission.
- Les sidecars de la porte finale ont `llm_vision: null` : la porte déterministe
  et la revue visuelle des alertes ont été faites, mais pas une seconde opinion
  par un autre modèle vision indépendant.
- Le kit canonique contient plusieurs portraits ArcFace mutuellement
  incohérents. La V3 est utilisée de façon constante, mais la désignation de
  l’unique référence active devrait être rendue explicite dans un manifeste du
  kit.
- Aucune publication YouTube, déclaration de contenu synthétique ou revue
  continue en temps réel des 76,3 secondes n’a été effectuée dans cette mission.
