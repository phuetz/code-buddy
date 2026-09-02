# AMBRE — rapport V02 de la vidéo 01, chalet d’automne

Rendu et revu le 1er août 2026 sur la branche
`feat/mysoulmate-media-pipeline`.

## Résultat

Le master livré est :

```text
/home/patrice/.codebuddy/media-video/ambre-chalet-automne/ambre-chalet-automne-v02.mp4
```

Son sidecar reproductible est :

```text
/home/patrice/.codebuddy/media-video/ambre-chalet-automne/ambre-chalet-automne-v02.mp4.meta.json
```

Le master mesure 34 709 653 octets. Son SHA-256 est
`d6bc37510e4118e71640c2a71a3042f71a0345227298406ab7dfe4b9e32b6ca5`.
Le SHA-256 du sidecar final est
`92edde943e9c6322b327a7f55ae9a699d68f58c5738a9af37f117fb6199dd13d`.
Il ne contient ni narration, ni titre, ni carton. La déclaration de contenu
synthétique reste obligatoire à la publication.

La V02 corrige les deux défauts éliminatoires de la V01 : aucun B-roll hors du
chalet et de sa journée d’automne ne subsiste, et les douze plans avec Ambre
mesurent au moins 4 px de transition de chevelure sur les images extraites du
master. Ce verdict vient après inspection de la planche-contact et des 31
images en pleine définition, pas seulement après lecture des portes.

## Pourquoi le filtre de la V01 n’a pas fonctionné

Le filtre décrit dans le rapport V01 n’était pas un filtre exécutable. Le
script contenait directement une liste `SHOTS` avec neuf noms de B-roll, tandis
que le rapport affirmait après coup que 82 fichiers avaient été écartés. Il
n’existait :

- ni critère de continuité écrit dans le code ;
- ni décision conservée pour chacun des 91 fichiers ;
- ni vérification que l’inventaire et l’audit couvraient exactement la même
  bibliothèque ;
- ni garde interdisant à `SHOTS` de reprendre un fichier rejeté.

Les portes réellement exécutées vérifiaient l’existence des sources,
l’identité, le rythme, le noir, l’audio et quelques défauts visuels locaux.
Elles ne pouvaient pas décider qu’un TGV dans des vignes, une ruelle nocturne,
un sommet enneigé ou une plume sur parchemin ne se trouvaient pas au chalet.
Le rapport et le montage avaient donc deux sources de vérité divergentes.

La V02 encode les 91 décisions dans le script. Le rendu échoue si un fichier de
la bibliothèque manque à l’audit, si l’audit contient un intrus, ou si le
montage emploie un B-roll autre que les trois admis et retenus. Le même contrôle
couvre les 30 plaques de décor associées aux composites d’automne.

## Critère B-roll arrêté avant sélection

Avant de réexaminer les fichiers et avant d’arrêter le montage, le critère
suivant a été figé dans le présent rapport puis dans le script :

> Un extrait B-roll est admis seulement si tout élément visible pourrait avoir
> été filmé dans le chalet ou ses abords alpins immédiats, pendant le même
> automne humide et dans la continuité lumineuse d’une seule journée. Une simple
> proximité d’ambiance ne suffit pas : ville, transport, autre saison, autre
> climat, objet narratif étranger au séjour et doublon sans fonction nouvelle
> sont exclus.

L’admission porte sur l’extrait effectivement monté, regardé à plusieurs
instants, pas sur le nom du fichier, sa beauté isolée ou une mesure
automatique. Un plan ambigu est écarté.

## Réexamen des 91 B-roll

Chaque vidéo a été inspectée à 0,5 s, 2,5 s et 5,5 s. Les 91 bandes de trois
images et les dix planches d’inventaire sont conservées hors dépôt dans :

```text
/home/patrice/.codebuddy/media-video/ambre-chalet-automne/qc-v02/broll-library/
```

Quatre fichiers seulement passent le critère sémantique :

| Fichier | Inspection | Décision finale | Motif |
|:---|:---:|:---|:---|
| `b15.mp4` | 0,5 / 2,5 / 5,5 s | retenu, plans 19 et 23 | pluie sur vitre et feu intérieur, raccord direct |
| `b16.mp4` | 0,5 / 2,5 / 5,5 s | écarté du master | bougie plausible, mais noir dominant et netteté mesurée à 5,7 après recadrage |
| `b22.mp4` | 0,5 / 2,5 / 5,5 s | retenu, plan 17 | feu de cheminée en mouvement |
| `b62.mp4` | 0,5 / 2,5 / 5,5 s | retenu, plan 14 | allumette et petit bois dans la cheminée |

Les 87 rejets sont enregistrés individuellement dans le sidecar avec les trois
temps inspectés. La liste exhaustive, regroupée uniquement pour rendre ce
rapport lisible, est la suivante :

- **Lieu, saison, climat ou lumière incompatibles — 38 :** `b04`, `b05`,
  `b06`, `b07`, `b08`, `b09`, `b10`, `b11`, `b12`, `b13`, `b14`, `b24`,
  `b32`, `b33`, `b37`, `b38`, `b39`, `b40`, `b41`, `b42`, `b43`, `b44`,
  `b53`, `b55`, `b56`, `b58`, `b59`, `b070`, `b086`, `b087`, `b088`,
  `b089`, `b090`, `b091`, `b092`, `b093`, `b094`, `b104`.
- **Objet narratif étranger au séjour — 12 :** `b18`, `b19`, `b20`, `b21`,
  `b23`, `b27`, `b28`, `b29`, `b52`, `b60`, `b61`, `b076`.
- **Univers scientifique, technologique, financier, industriel ou
  institutionnel — 37 :** `b26`, `b31`, `b45`, `b47`, `b48`, `b49`, `b50`,
  `b063`, `b064`, `b065`, `b066`, `b067`, `b068`, `b069`, `b071`, `b072`,
  `b073`, `b074`, `b075`, `b077`, `b078`, `b079`, `b080`, `b081`, `b082`,
  `b083`, `b084`, `b085`, `b095`, `b096`, `b097`, `b098`, `b099`, `b100`,
  `b101`, `b102`, `b103`.

Le contrôle plus strict de la V02 rejette sept des neuf fichiers montés en V01,
et non seulement les exemples signalés :

| B-roll V01 | Ce qui est visible | V02 |
|:---|:---|:---|
| `b11` | ruelle pavée urbaine à la nuit tombante | écarté |
| `b12` | sommet et pentes enneigés | écarté |
| `b15` | pluie et feu derrière une vitre | retenu |
| `b18` | main écrivant à la plume sur parchemin | écarté |
| `b20` | vieux livre relié isolé | écarté |
| `b22` | feu de cheminée | retenu |
| `b24` | forêt verte et fougères, sans raccord d’automne | écarté |
| `b27` | seconde prise d’un vieux livre relié | écarté |
| `b094` | TGV dans des vignes vertes | écarté |

## Plaques exactes du décor

La bibliothèque B-roll générique ne suffisait pas à construire 19 plans sans
répéter le feu. Les 30 plaques sans Ambre qui ont servi à produire les
composites d’automne ont donc également été ouvertes et inspectées sur quatre
planches. Elles se trouvent en lecture seule sous
`automne-composites/_plates/`; les planches d’audit sont dans
`qc-v02/source-plates/`.

Neuf plaques passent et sont toutes utilisées : `ambre-013`, `ambre-018`,
`ambre-020`, `ambre-022`, `ambre-035`, `ambre-036`, `ambre-043`, `ambre-048` et
`ambre-082`. Elles montrent le marché humide, la terrasse rousse, le sous-bois
d’automne et les salons exacts derrière Ambre.

Les 21 autres sont écartées :

- **hiver ou neige — 8 :** `ambre-001`, `ambre-004`, `ambre-019`, `ambre-023`,
  `ambre-025`, `ambre-042`, `ambre-047`, `ambre-073` ;
- **Japon ou floraison printanière — 8 :** `ambre-007`, `ambre-008`,
  `ambre-009`, `ambre-029`, `ambre-030`, `ambre-053`, `ambre-054`, `ambre-076` ;
- **continuité architecturale, lumineuse ou narrative insuffisante — 5 :**
  `ambre-002`, `ambre-015`, `ambre-016`, `ambre-021`, `ambre-038`.

Deux essais de décor ont été calculés sur GPU node, sans interrompre ni tuer de
processus. L’un contenait Ambre et n’était donc pas un B-roll ; l’autre était
une variante trop lisse et redondante du salon déjà disponible. Aucun média
nouvellement généré n’est monté dans le master : les plaques exactes donnent un
meilleur raccord.

Le master emploie ainsi 12 sources de décor uniques : neuf plaques exactes et
les trois vidéos `b15`, `b22`, `b62`.

## Composites Ambre et détourage avant montage

Les douze composites hivernaux de la V01 ont tous été retirés. La V02 repart
des originaux d’automne qui dépassent déjà le seuil et des réparations du
1er août lorsqu’elles sont meilleures. Six images sources sont utilisées, deux
fois chacune avec des échelles différentes :

| Source unique | État | Plans | Transition source | ArcFace V3 | Décision |
|:---|:---|:---|---:|---:|:---|
| `ambre-033-marche-automne-velours.png` | original | 02, 30 | 6 px | 0,785855 | retenu |
| `jugement-037-038/ambre-038-marche-citrouilles-velours.png` | réparé | 04, 28 | 4 px | 0,865227 | retenu au seuil |
| `ambre-027-salon-automne-velours.png` | original | 07, 09 | 4 px | 0,781092 | retenu au seuil |
| `ambre-024-face-protected-direct.png` | réparation locale protégée | 11, 13 | 5 px | 0,941932 | retenu |
| `ambre-028-salon-pluie-flanelle.png` | original | 20, 22 | 5 px | 0,889259 | retenu |
| `replays-v3/ambre-030-salon-dore-flanelle/composite.png` | réparé | 16, 31 | 6 px | 0,964593 | retenu |

La réparation locale de `ambre-024` a été faite par transformation de
similarité et masque progressif à partir de l’image canonique de tenue. Le
référentiel sous `~/.codebuddy/personas/**` n’a jamais été modifié. L’original
avait un ArcFace de 0,606140 ; la réparation atteint 0,941932 et 5 px.

Les essais rejetés montrent pourquoi le seuil ne suffit pas :

| Essai | Transition | Inspection humaine | Décision |
|:---|---:|:---|:---|
| réparation existante `ambre-023` | 6 px | bande frontale et ligne de cheveux artificielles | écartée malgré ArcFace 0,866915 |
| replay Qwen `ambre-024-a` | 6 px | visage dans le visage et halo | écarté |
| replay Qwen `ambre-024-b` | 5 px | bosse de cheveux et visage collé | écarté |
| réparation cheveux `ambre-025` | 2 px | bord encore dur | écartée sous le seuil |
| réparation cheveux `ambre-029` | 3 px | bord encore dur | écartée sous le seuil |
| réparation cheveux `ambre-031` | 3 px | bord encore dur | écartée sous le seuil |

Lors des rendus intermédiaires, les plans 04 et 11 sont descendus respectivement
à 3 px et 2 px après recadrage. Le rendu a été arrêté, les cadrages ont été
changés, puis toutes les mesures ont été refaites. Aucun plan sous 4 px n’est
conservé par exception.

## Montage retenu et lecture de la planche-contact

La planche finale est :

```text
/home/patrice/.codebuddy/media-video/ambre-chalet-automne/qc-v02/contact/final-v02-31.jpg
```

Son SHA-256 est
`56f039e116197866946fc3aba4c9601147336b281fb57f6af69c6f65eed3f685`.
Elle comporte 31 vignettes étiquetées par numéro, arc, type et échelle. Je l’ai
d’abord regardée dans son ensemble pour les ruptures, puis chaque extraction
1280×720 a été ouverte séparément. Voici ce qui est réellement visible, plan
par plan :

| Plan | Arc | Durée / échelle / mouvement | Ce que montre l’image du master | Décision à l’œil |
|---:|:---|:---|:---|:---|
| 01 | arriver | 2,8 s · très large · zoom | marché d’automne sur pavés mouillés, étals de fruits et citrouilles | garder : village voisin plausible, aucun transport ni autre saison |
| 02 | arriver | 2,5 s · moyen · pano D | Ambre en manteau brun et écharpe dans ce même marché | garder : décor et tenue raccordent au 01 |
| 03 | arriver | 2,2 s · gros plan · pano G | citrouilles, pommes, bois et flaques du même étal | garder : détail saisonnier, pas d’objet étranger |
| 04 | arriver | 2,5 s · rapproché · zoom | Ambre plus proche devant les citrouilles | garder : même marché ; cheveux non découpés à l’œil |
| 05 | arriver | 2,7 s · large · pano D | terrasse de pierre, plaids et feuilles rousses | garder : abords immédiats plausibles du chalet |
| 06 | arriver | 2,3 s · détail · pano G | chemin de sous-bois couvert de feuilles orange | garder : même automne, image d’approche |
| 07 | entrer | 2,5 s · moyen · pano G | Ambre en manteau dans le salon doré | garder : seuil narratif lisible et tenue continue |
| 08 | entrer | 2,8 s · très large · zoom | salon vide, canapé, baies et pluie éclairée | garder : décor exact des composites suivants |
| 09 | entrer | 2,3 s · gros plan · zoom | visage d’Ambre, manteau encore porté, baie derrière | garder : échelle alterne et bord des cheveux reste diffus |
| 10 | entrer | 2,1 s · macro · pano D | canapé, plaid, lumière et gouttes sur la baie | garder : détail du même salon, sans symbole ajouté |
| 11 | s’installer | 2,7 s · large · zoom | Ambre debout dans le salon, cadrage plus ample | garder : réparation directe invisible à cette échelle |
| 12 | s’installer | 2,6 s · très large · pano G | salon vide et arbres roux derrière la vitre | garder : respiration spatiale, même lumière |
| 13 | s’installer | 2,3 s · moyen · pano D | reprise plus proche d’Ambre dans le même instant | garder : pas de halo ni double visage |
| 14 | s’installer | 2,1 s · macro · mouvement natif | allumette qui embrase le petit bois, étincelles | garder : geste localisé dans la cheminée |
| 15 | s’installer | 2,6 s · large · zoom | second salon boisé avec foyer central allumé | garder : autre pièce plausible du même chalet ; aucun indice d’autre lieu |
| 16 | s’installer | 2,4 s · rapproché · pano G | Ambre en veste claire dans la chaleur du salon | garder : changement de tenue intérieur plausible, portrait net |
| 17 | s’installer | 2,2 s · gros plan · mouvement natif | bûches et braises en mouvement | garder : raccord direct avec 14–16 |
| 18 | s’installer | 2,6 s · large · pano D | salon doré vide, pluie et lampe basse | garder : plaque exacte du portrait 16 |
| 19 | s’installer | 2,3 s · macro · mouvement natif | gouttes sur vitre, feu flou derrière | garder : le passage de l’éclaircie à l’averse reste celui d’une journée |
| 20 | regarder dehors | 2,6 s · moyen · pano D | Ambre assise face à la baie sous la pluie | garder : action de l’arc immédiatement lisible |
| 21 | regarder dehors | 2,5 s · très large · zoom arrière | fauteuil, tasse et deux livres sur table devant la pluie | garder : accessoires ancrés dans le salon exact, pas un vieux livre symbolique isolé |
| 22 | regarder dehors | 2,3 s · rapproché · zoom | Ambre, veste claire, regard calme et gouttes derrière | garder : même place et même tenue que 20 |
| 23 | regarder dehors | 2,3 s · gros plan · mouvement natif | seconde coulée de pluie sur le feu flou | garder : variation animée, sans nouvel univers |
| 24 | regarder dehors | 2,4 s · large · pano G | salon pluvieux, baie, plaid et lampe | garder : remplace le second gros plan de livre d’une version intermédiaire |
| 25 | regarder dehors | 2,7 s · très large · zoom arrière | sous-bois roux et chemin dans la lumière | garder : devient ce qu’Ambre regarde et emporte |
| 26 | regarder dehors | 2,2 s · détail · pano D | gouttes sur la baie et lampe basse | garder : referme le temps intérieur |
| 27 | repartir avec l’image | 2,6 s · large · pano G | retour au marché mouillé | garder : reprise assumée comme souvenir, pas nouveau lieu |
| 28 | repartir avec l’image | 2,3 s · rapproché · zoom arrière | Ambre au marché, visage au centre | garder : raccord exact avec 27 |
| 29 | repartir avec l’image | 2,2 s · gros plan · pano D | reprise des citrouilles et pavés | garder : dernier éclat d’automne, répétition narrative consciente |
| 30 | repartir avec l’image | 2,4 s · moyen · pano G | Ambre en manteau au marché | garder : matérialise le départ et boucle l’arrivée |
| 31 | repartir avec l’image | 3,2 s · gros plan · zoom | portrait le plus fort d’Ambre dans la lumière du salon | garder : chute tenue plus longtemps, visage et regard dominent |

La lecture d’ensemble montre une palette continue — bois, roux, ambre, pluie —
et une alternance nette entre lieux, visage et détails. La reprise des plans
01–04 en 27–30 est visible ; elle est volontaire et transforme l’arrivée en
souvenir du départ. Le dernier plan n’est plus un paysage générique : c’est le
portrait le plus solide d’Ambre.

## Mesure de détourage dans le master

`scripts/influencer/mesurer-detourage.py` est exécuté sur les sources avant le
montage, puis sur les douze images médianes extraites du MP4 final. Le seuil est
4 px et aucune dérogation n’est utilisée :

| Plan Ambre | Transition dans le master | Colonnes mesurées | Verdict |
|---:|---:|---:|:---|
| 02 | 6 px | 341 | passe |
| 04 | 4 px | 356 | passe au seuil |
| 07 | 5,5 px | 310 | passe |
| 09 | 5 px | 295 | passe |
| 11 | 5 px | 303 | passe |
| 13 | 5 px | 314 | passe |
| 16 | 7 px | 235 | passe |
| 20 | 5 px | 232 | passe |
| 22 | 5 px | 244 | passe |
| 28 | 4 px | 354 | passe au seuil |
| 30 | 8 px | 317 | passe |
| 31 | 8 px | 220 | passe |

Les douze images ont aussi été ouvertes en pleine définition. Les mèches ne
forment plus la silhouette uniformément dure et plus nette que le fond vue dans
la V01. Les plans 04 et 28 restent les plus proches de la limite et sont
signalés comme tels, même s’ils passent la mesure et l’inspection.

## Mesures du rendu final

Toutes les valeurs viennent du MP4 final produit par la version de code
commitée :

| Mesure | Résultat | Cible |
|:---|---:|:---|
| Durée | 76,200 s | 75–90 s |
| Nombre de plans | 31 | — |
| Durée moyenne | 2,458 s | ≈ 2,4 s |
| Plans avec Ambre | 12 / 31 = 38,71 % | ≈ 40 % |
| Plans de décor | 19 / 31 = 61,29 % | ≈ 60 % |
| Coupes franches détectées | 30 | 30 pour 31 plans |
| Loudness intégré | −14,07 LUFS | −14 LUFS |
| Pic vrai | −1,40 dBTP | sous −1 dBTP |
| LRA | 2,0 LU | — |
| Vidéo | H.264, 1280×720, 30 i/s | — |

La détection de scène utilise `select='gt(scene,0.35)'` et retrouve les 30
frontières prévues. À 0,25, les étincelles du plan 14 créaient des faux cuts
internes ; le manifeste temporel et l’inspection montrent qu’il n’y a bien que
les 30 coupes franches du montage.

Le mouvement est mesuré plan par plan entre deux images situées à 0,25 s des
bords. `1 − SSIM` va de 0,298752 à 0,728857 : les 31 plans bougent. Les plaques
ont un Ken Burns lent ; les trois vidéos gardent leur mouvement natif.

L’audio est normalisé en deux passes à −14 LUFS avec plafond demandé à
−1,5 dBTP. La mesure indépendante du master donne −14,07 LUFS et −1,40 dBTP,
donc le pic reste sous −1 dBTP.

## Noir et porte visuelle finale

`blackdetect=d=0.08:pix_th=0.10:pic_th=0.98` ne remonte **aucune alerte**. Il
n’existe donc aucune plage noire à extraire ou à inspecter ; le nombre
d’alertes inspectables est zéro.

Une image médiane de chacun des 31 plans du master a ensuite passé
`scripts/influencer/visual-gate.py` :

| Lot final | OK | À REGARDER | REJET |
|:---|---:|---:|---:|
| 12 images avec Ambre | 4 | 8 | 0 |
| 19 images de décor | 5 | 14 | 0 |

Les 22 images `À REGARDER` ont toutes été ouvertes, et non validées en bloc.
Les pseudo-textes détectés sur 01–04 et 27–30 sont les petites ardoises et les
textures d’étals du marché ; aucun nom d’établissement ou logo lisible
n’apparaît. Sur 19, 21, 23 et 25, ils correspondent aux gouttes, feuilles et à
la petite tranche décorée d’un livre. Les alertes de contour sur les plans de
salon sont les montants rectilignes des baies, les lames de parquet et les
poutres. Sur les plans Ambre, la mesure dédiée du bord de chevelure et
l’ouverture en pleine définition ne montrent pas de matte dure. Aucune alerte
n’a révélé un élément situé ailleurs, une autre saison, un double visage ou un
défaut bloquant.

## Reproduction

Le rendu n’écrit jamais dans `~/.codebuddy/personas/**`. Si l’actif local du
plan 11/13 devait être reconstruit, la commande déterministe utilisée est :

```bash
/tmp/codebuddy-visual-gate-20260801/bin/python3 \
  scripts/gpuNode/restore-canonical-face.py \
  --source /home/patrice/.codebuddy/personas/ambre/wardrobe-automne/ambre-velours-cognac-echarpe.png \
  --composite /home/patrice/Videos/personas/ambre-scenes/automne-composites/ambre-024-salon-cocooning-velours.png \
  --output /home/patrice/.codebuddy/media-video/ambre-chalet-automne/assets-v02/persona/ambre-024-face-protected-direct.png \
  --report /home/patrice/.codebuddy/media-video/ambre-chalet-automne/assets-v02/persona/ambre-024-face-protected-direct.json \
  --edit-mask /home/patrice/.codebuddy/media-video/ambre-chalet-automne/assets-v02/persona/ambre-024-face-protected-direct-mask.png
```

Les six sources uniques sont ensuite scorées contre l’unique référence V3 avec
`scripts/gpuNode/score-arcface-images.py`; le JSON obtenu est conservé dans
`qc-v02/arcface/ambre-v3-preview-v02.json`. Le rendu complet et toutes ses
portes sont relancés par :

```bash
/tmp/codebuddy-visual-gate-20260801/bin/python3 \
  scripts/mysoulmate/render-ambre-chalet-video.py \
  --gate-python /tmp/codebuddy-visual-gate-20260801/bin/python3
```

Le script valide l’inventaire B-roll et plaques, l’arc, la durée, la proportion
d’Ambre, l’alternance d’échelles, le mouvement déclaré, ArcFace, le détourage
source, puis mesure sur le master le noir, les cuts, le mouvement réel, le
détourage, l’audio et la porte visuelle. Il régénère enfin les 31 extractions,
la planche-contact et le sidecar.

## Ce qui reste imparfait

- Dix-neuf plans reposent sur neuf plaques fixes animées par Ken Burns. Le
  mouvement est réel dans le master mais n’a pas la richesse d’une prise de vue
  native.
- Six images Ambre sont utilisées deux fois. Les cadres changent et la reprise
  du marché est narrative, mais un regard attentif verra la répétition.
- Les plans 04 et 28 sont exactement au seuil de 4 px ; ils sont acceptables à
  720p et inspectés, sans la marge des plans 30 et 31 à 8 px.
- Le plan 15 adopte une pièce plus boisée que le salon vitré. Il peut appartenir
  au même chalet de luxe et ne montre aucun indice contraire, mais le raccord
  architectural n’est pas littéral.
- De petites ardoises non lisibles au marché et la tranche décorée du livre au
  plan 21 gardent une apparence synthétique lorsqu’on les agrandit au pixel.
  Elles ne sont pas lisibles en lecture normale, mais elles sont consignées.
- La musique est tracée et mesurée, mais le reçu et l’état du compte Epidemic
  Sound n’ont pas été ouverts ; le sidecar marque
  `licenseVerifiedExternally: false`.
- La revue porte sur la planche et les images pleine définition du master. Elle
  ne constitue ni une publication YouTube, ni une validation juridique de la
  déclaration synthétique.

Aucun MP4, PNG, JPG, JSON de QC ou autre média n’est ajouté au dépôt public :
seuls le script reproductible et le présent rapport sont commités.
