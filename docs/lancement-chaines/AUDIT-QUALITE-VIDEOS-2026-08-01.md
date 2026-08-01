# Audit qualité des masters vidéo — 1er août 2026

## Verdict exécutif

Sept masters candidats ont été décodés, mesurés et contrôlés à l'image.

- **Six masters passent le contrôle technique.** Ils restent soumis aux choix
  éditoriaux et aux gestes humains de publication déjà documentés.
- **Un master échoue :**
  `lisa-vision-ia-5-signaux-v3.mp4`. Sa retouche d'habillage efface une grande
  partie des sous-titres pendant les douze cartons d'ouverture de chapitre.
  **Ne pas publier ce fichier.**
- Les trois Shorts AMBRE passent individuellement, identité comprise, mais ne
  doivent pas être programmés comme trois créations différentes : ils montrent
  les mêmes sept tenues, le même décor et la même pose, dans un ordre différent.

Cet audit porte sur la qualité de livraison du média : intégrité vidéo/audio,
lisibilité, identité visuelle, continuité et défauts de montage. Il ne constitue
pas une vérification factuelle des scripts ni une autorisation de publication.

## Périmètre et méthode

Les anciennes versions (`v1`, `v2` lorsqu'une `v3` existe), les essais et le
dossier proscrit `.ecarte-france-travail` sont exclus. Les sept candidats sont :

1. AMBRE — chalet d'automne v02 ;
2. AMBRE — Japon v01 ;
3. AMBRE — les trois Shorts v4 du 31 juillet ;
4. LISA IA — Meta AI, master v2 ;
5. LISA IA — « 5 signaux », master v3.

Contrôles refaits depuis les masters, sans se fier aux anciens verdicts JSON :

- sondage et décodage avec `ffprobe`/`ffmpeg` ;
- durée, cadence, nombre d'images, format de pixel et écart audio/vidéo ;
- loudness EBU R128, true peak, plage dynamique ;
- détection de noir, gel et silence, puis qualification visuelle de chaque
  alerte ;
- planches-contact neuves et agrandissements ciblés des transitions, titres,
  pieds de page et fins de vidéo ;
- contrôle à 320 px des titres de Short ;
- pour les Shorts, 21 images issues des sept sources de tenues comparées à la
  référence canonique AMBRE avec ArcFace.

## Résultats techniques

| Master | Durée et format | Débit global | Loudness / pic | Verdict |
|---|---:|---:|---:|---|
| AMBRE chalet v02 | 76,200 s · 1280×720 · 30 i/s | 3,64 Mb/s | −14,07 LUFS · −1,40 dBTP | **Passe** |
| AMBRE Japon v01 | 76,200 s · 1280×720 · 30 i/s | 14,96 Mb/s | −14,06 LUFS · −1,85 dBTP | **Passe** |
| AMBRE Short 01 v4 | 60,533 s · 1080×1920 · 30 i/s | 6,23 Mb/s | −14,11 LUFS · −1,06 dBTP | **Passe** |
| AMBRE Short 02 v4 | 60,533 s · 1080×1920 · 30 i/s | 6,01 Mb/s | −14,11 LUFS · −1,06 dBTP | **Passe** |
| AMBRE Short 03 v4 | 55,900 s · 1080×1920 · 30 i/s | 6,21 Mb/s | −14,02 LUFS · −1,44 dBTP | **Passe** |
| LISA Meta AI v2 | 675,300 s · 1920×1080 · 30 i/s | 8,54 Mb/s | −14,05 LUFS · −1,38 dBTP | **Passe** |
| LISA « 5 signaux » v3 | 542,467 s · 1920×1080 · 30 i/s | 1,08 Mb/s | −14,01 LUFS · −1,40 dBTP | **Échec visuel** |

Tous les fichiers sont en H.264 High, `yuv420p`, avec audio AAC stéréo à
48 kHz. L'écart de fin audio/vidéo est nul sur les cinq vidéos AMBRE et reste
inférieur à 67 ms sur les deux longs formats LISA.

Il n'y a ni noir accidentel ni silence anormal :

- les cinq vidéos AMBRE ne déclenchent aucune alerte noir, gel ou silence ;
- le noir de 1,2 s à 01:59,9 dans Meta AI est le reveal volontaire des logos
  Meta et Meta AI sur fond noir ; les trois alertes suivantes font 0,17 s ou
  moins et correspondent à des transitions ;
- le silence de 4,06 s à la fin de « 5 signaux » accompagne son carton final ;
- les nombreuses alertes de gel de « 5 signaux » sont des diapositives
  statiques, pas un blocage du flux.

Le débit de 1,08 Mb/s de « 5 signaux » est faible pour du 1080p, mais reste
visuellement acceptable sur ses écrans majoritairement statiques. Il ne faut
pas lui ajouter un nouveau ré-encodage avec perte sans mesure comparative.

## Contrôle visuel par master

### AMBRE — chalet d'automne v02

**Passe.** L'image est propre et cohérente, le détourage ne montre ni halo
visible ni double visage, et les raccords de palette fonctionnent. Les reprises
du marché et de la même image d'Ambre sont perceptibles mais peuvent se lire
comme des rappels narratifs. Le changement de pièce au plan 15 et la rupture
plus froide de la séquence de pluie restent des réserves de continuité, pas des
défauts de livraison.

### AMBRE — Japon v01

**Passe techniquement.** Le visage et la chevelure restent cohérents, les
décors sont homogènes et aucun artefact bloquant n'apparaît. La tenue inspirée
du kimono demeure un choix éditorial à valider par la propriétaire de la
chaîne. Un visionnage humain continu reste recommandé avant publication.

### AMBRE — Shorts 01, 02 et 03 v4

**Passe individuellement ; réserve forte sur la série.** Les titres principaux
restent lisibles à 320 px, les masters sont nets et les sept tenues conservent
l'identité d'Ambre. Les 21 images testées ont toutes été détectées par ArcFace :
scores de **0,864 à 0,932**, au-dessus du seuil de 0,75.

En revanche, les trois Shorts réordonnent les mêmes sept plans sur le même fond
avec la même pose. Les publier rapprochés donnerait l'impression de remettre en
ligne le même film. Le petit surtitre « Le vestiaire des destinations » est
fin à 320 px, mais le titre principal reste lisible ; c'est une faiblesse
mobile mineure, non éliminatoire.

### LISA IA — Meta AI, master v2

**Passe.** Les cartons d'attribution corrigés sont lisibles et les miniatures
ne font pas partie du master audité. La transition autour de 06:48 montre une
double exposition pendant environ une seconde entre Lisa et le panorama de
Paris ; elle est un peu marquée, mais reste clairement une transition et non
un défaut de visage. Le passage noir de 01:59,9 est un carton de marque
volontaire, pas une image manquante.

### LISA IA — « 5 signaux », master v3

**Échec bloquant.** Les trois titres longs sont désormais dans le cadre et la
plaque `LISA IA | Source` est lisible. Mais la réparation du pied de page a été
posée **par-dessus des sous-titres déjà incrustés**. Pendant chaque première
diapositive de chapitre, seule une tranche des lettres du sous-titre reste
visible en bas de l'image.

Le défaut touche les douze intervalles suivants :

| Chapitre | Intervalle touché | Repères SRT intersectés |
|---|---:|---:|
| 01 — accroche | 00:00,000 → 00:08,917 | 1–3 |
| 02 — plan | 00:35,314 → 00:45,431 | 10–14 |
| 03 — Krea, faits | 01:05,276 → 01:14,426 | 20–24 |
| 04 — Krea, impact | 01:50,742 → 01:59,425 | 36–39 |
| 05 — Qwen | 02:42,568 → 02:51,151 | 52–55 |
| 06 — nuance Qwen | 03:25,154 → 03:34,704 | 66–69 |
| 07 — Grok, faits | 04:12,492 → 04:21,709 | 81–85 |
| 08 — benchmarks Grok | 04:48,958 → 04:58,108 | 93–96 |
| 09 — Kimi | 05:43,544 → 05:53,327 | 109–113 |
| 10 — Kimi ouvert | 06:32,082 → 06:40,465 | 125–128 |
| 11 — sécurité | 07:13,708 → 07:22,225 | 138–141 |
| 12 — conclusion | 08:12,878 → 08:21,995 | 154–158 |

Cela représente **109,167 s de cartons** et **52 repères sur les 168** du SRT.

La cause est reproductible dans
`~/Videos/publication-2026-07-30/lisa-vision-ia/work/reparer-habillage.py` :

- `BANDE_PIED = Boite(0, 800, 1920, 200)` repeint les lignes y=800 à 999 ;
- la zone du sous-titre est pourtant déclarée à
  `Boite(300, 890, 1320, 130)` ;
- la bande est appliquée au master v2 après que les sous-titres ont déjà été
  gravés ; elle détruit donc leur partie située entre y=890 et y=999.

Le contrôle annoncé de 39 zones mesurait seulement les nouveaux logos, sources,
pieds et titres. Il n'observait pas le sous-titre final et a donc produit un
faux positif de livraison.

## Décision de publication

| Actif | Décision qualité |
|---|---|
| AMBRE chalet v02 | **Bon pour validation humaine** |
| AMBRE Japon v01 | **Bon techniquement**, décision kimono et visionnage continu requis |
| AMBRE Short 01 v4 | **Bon**, à publier seul en premier |
| AMBRE Shorts 02 et 03 v4 | **Bons techniquement**, à espacer et reconsidérer selon le retour du 01 |
| LISA Meta AI v2 | **Bon pour validation humaine** |
| LISA « 5 signaux » v3 | **Refusé — ne pas publier** |

## Correction requise pour « 5 signaux »

La correction idéale repart d'un master intermédiaire antérieur à l'incrustation
des sous-titres et place le rendu ASS **après** toutes les plaques de réparation
dans la chaîne de filtres. Si seul le v2 déjà sous-titré est réutilisé, il faut
reconstruire entièrement la zone des sous-titres sur les douze cartons avant de
réincruster uniquement les repères concernés ; les fragments encore visibles ne
doivent pas être doublés. Un simple nouveau ré-encodage du v3 ne restaure pas
les pixels déjà détruits.

Avant de déclarer le prochain master livrable :

1. contrôler les douze intervalles ci-dessus sur le fichier final ;
2. vérifier les 168 repères SRT, notamment leur visibilité complète sur les
   cartons ;
3. refaire durée, nombre d'images, loudness, true peak et synchronisation ;
4. ajouter au contrôle d'habillage une mesure du **composite final**, pas
   seulement des blocs nouvellement dessinés.

## Limites de l'audit

Les bandes son n'ont pas été écoutées de bout en bout au casque. Les contrôles
audio sont des mesures complètes du flux et des inspections ciblées. Les faits,
marques, licences musicales, métadonnées YouTube et déclarations de contenu
synthétique restent soumis aux validations éditoriales et humaines décrites
dans l'état de lancement.
