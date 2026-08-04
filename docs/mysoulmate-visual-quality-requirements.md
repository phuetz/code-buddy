# Cahier des charges visuel MySoulmate

**Version** : 1.0  
**Date** : 2026-07-20  
**Statut** : exigences normatives pour les images et vidéos verticales Lisa

Ce document définit la qualité minimale de livraison du pipeline MySoulmate. Une
sortie qui ne respecte pas toutes les exigences bloquantes est un candidat à
refaire, jamais un livrable dégradé à accepter.

## Ambition et référence visuelle

La chaîne publique [vietsy66 Shorts](https://www.youtube.com/@vietsy66/shorts)
sert de référence de niveau pour le rendu fashion vertical : sujet presque plein
pied, lumière douce, arrière-plan lisible et stable, gestes simples, caméra fixe
ou en suivi lent, continuité du visage, de la silhouette et de la tenue.

Cette référence fournit uniquement une **grammaire visuelle** : cadrage, rythme,
familles de poses, mouvement et niveau de finition. Ses pixels, personnages,
visages, identités, vêtements distinctifs et plans ne doivent pas être copiés,
aspirés dans un dataset, ni utilisés pour entraîner un LoRA MySoulmate. Toutes
les images, scènes et chorégraphies livrées pour Lisa doivent être originales.

## Principe de qualité sans concession

- L'identité, l'anatomie, la stabilité temporelle, la continuité de tenue et la
  cohérence du décor sont des gates indépendants et bloquants.
- Une excellente note moyenne ne compense jamais l'échec d'un gate bloquant.
- Le pipeline régénère un candidat défaillant autant de fois que nécessaire,
  par lots bornés et traçables, jusqu'à validation ou arrêt opérateur motivé.
- Il n'existe aucun fallback automatique vers une résolution, une identité, une
  anatomie ou une stabilité inférieure pour déclarer un lot terminé.
- Les reprises doivent modifier le seed, le conditionnement, la pose ou le
  modèle en fonction du défaut observé ; répéter à l'identique n'est pas une
  stratégie de correction.
- Les limites thermiques, de sécurité et de coût restent absolues. Leur atteinte
  suspend la reprise sans promouvoir le candidat incomplet.

## Profils de livraison vidéo

| Propriété | Exigence |
|---|---|
| Orientation | verticale |
| Résolution master | `1080×1920` (9:16) ou `1288×1920` quand ce profil de référence est explicitement retenu |
| Source | génération native au profil vertical sélectionné ; aucun simple upscale d'une source 480p ne constitue un master |
| Cadence | 30 FPS constants |
| Durée cible | environ 12 secondes par Short |
| Encodage master | H.264 ou codec supérieur validé, sans artefacts visibles ; cible 12–20 Mb/s avant upload |
| Publication | privée et soumise à revue humaine tant que le pilote n'est pas validé |

Un upscale peut faire partie d'une restauration supervisée, mais il ne peut pas
inventer le détail manquant ni masquer une source insuffisante. La revue qualité
s'effectue sur le master encodé et sur des images extraites, pas uniquement sur
les frames de départ.

## Gates bloquants

### Identité

- Lisa reste immédiatement reconnaissable sur chaque frame utile.
- Le visage, l'âge apparent, la morphologie et les proportions restent stables.
- Aucune dérive vers l'identité ou les traits d'une personne de référence.
- Un LoRA d'identité reste séparé des LoRA ou contrôles de pose, de tenue et de
  décor afin de limiter l'enchevêtrement des attributs.

### Anatomie et mouvement

- Mains, doigts, bras, jambes, pieds et articulations sont complets et cohérents.
- Aucun membre fusionné, surnuméraire, escamoté ou déformé.
- Le poids du corps, les appuis, la marche, les rotations et le mouvement du
  tissu respectent une cinématique plausible.
- Aucun saut de pose, glissement de pied, accélération artificielle ou mouvement
  mécanique non intentionnel.

### Stabilité temporelle

- Pas de scintillement du visage, de la peau, des cheveux, du vêtement ou du
  décor à vitesse normale et en inspection frame par frame.
- Les textures, bijoux et accessoires ne changent pas entre les frames.
- Le mouvement de caméra est volontaire, lent et continu ; pas de pompage de
  focale, de cadrage ou d'exposition.

### Tenue et niveau de contenu

- La tenue conserve coupe, couleur, texture et niveau de couverture pendant le
  plan entier.
- Le tier `sensual` désigne une adulte, dans une mise en scène glamour et
  élégante, avec parties intimes entièrement couvertes et sans contenu explicite.
- Les variantes sensuelles peuvent accentuer la posture, le regard, le stylisme
  et l'ambiance, jamais recourir à la nudité ou à une sexualisation juvénile.
- Une demande explicite suit un circuit séparé et ne doit jamais être déduite du
  tier `sensual`.

### Décor, lumière et cadrage

- Le décor, les objets structurants, les ombres et la perspective restent
  cohérents pendant le plan.
- Aucun objet ne disparaît, ne traverse le sujet ou ne change de forme.
- La lumière valorise le visage et la tenue sans peau plastique, hautes lumières
  brûlées ni bruit chromatique excessif.
- Le cadrage montre la posture voulue ; mains ou pieds ne sont coupés que si le
  plan le prévoit explicitement.
- Pas de flou, compression, halos d'upscale ou détail factice perceptible sur le
  master final.

## Bibliothèque originale de poses et de scènes fashion

Le pipeline doit décliner des chorégraphies simples, lisibles et originales. Les
familles initiales sont :

| Identifiant de travail | Action originale attendue |
|---|---|
| `hair-touch-and-step` | pas lent, main dans les cheveux, regard caméra puis trois-quarts |
| `three-quarter-hip-shift` | transfert de poids naturel et pose trois-quarts |
| `over-shoulder-turn` | demi-tour contrôlé puis regard par-dessus l'épaule |
| `dress-twirl` | rotation courte avec mouvement réaliste du tissu |
| `slow-runway-walk` | marche fashion lente, appuis et balancement cohérents |
| `staircase-walk-away` | montée d'escalier, vue dos couverte, regard arrière bref |
| `balustrade-pose` | appui léger, changement de hanche puis reprise de marche |
| `bag-carry-city-walk` | marche urbaine avec sac stable et interaction naturelle |

Chaque scène combine au plus quelques actions compatibles afin de préserver la
stabilité. Les poses peuvent être guidées par squelette, profondeur ou autre
contrôle structurel original. Une vidéo tierce peut inspirer la catégorie du
mouvement, jamais servir de copie pixel à pixel ou de conditionnement d'identité.

## Dataset et entraînement LoRA

- Le dataset d'identité Lisa contient uniquement des sources autorisées et
  traçables ; aucun pixel de la chaîne de référence n'y entre.
- La sélection vise la diversité contrôlée : portraits, trois-quarts, plein
  pied, profil, dos avec regard arrière, marche et mouvement de tissu.
- Les vêtements, décors, focales et lumières varient pour éviter de figer
  l'identité dans un style unique.
- Une première production de 50 à 80 candidats peut être nécessaire pour ne
  promouvoir que 40 à 60 images irréprochables.
- Toute image floue, dupliquée, mal légendée, anatomiquement douteuse ou dont la
  provenance est incomplète est rejetée avant entraînement.
- Le manifeste approuvé et les empreintes des sources lient le dataset à
  l'entraînement ; remplacer un octet invalide l'approbation correspondante.

## Boucle de génération et de reprise

1. Générer un petit lot de candidats avec seeds et paramètres enregistrés.
2. Exécuter les contrôles automatiques d'identité, anatomie, netteté, stabilité,
   tenue, décor et propriétés du master.
3. Rejeter tout candidat qui échoue à un seul gate bloquant.
4. Classer le défaut et modifier le paramètre causal avant la reprise.
5. Soumettre les survivants à une revue humaine frame par frame.
6. Produire un reçu lié aux SHA-256 des images, clips et du master.
7. Reprendre un nouveau lot si aucun candidat n'est validé ; ne jamais promouvoir
   la meilleure sortie d'un lot mauvais par défaut.

Les reprises sont bornées dans chaque job pour éviter boucle infinie, surchauffe
ou dépense incontrôlée. L'objectif global reste néanmoins la validation pleine :
un job épuisé crée un diagnostic et un nouveau lot corrigé, pas une concession.

## Pilote obligatoire avant production en lot

La production de catalogue reste bloquée tant que ces livrables pilotes ne sont
pas tous approuvés :

1. une image Lisa tier `sensual`, couverte, validant identité et anatomie ;
2. un clip d'environ 12 secondes « robe noire, demi-tour et regard arrière » ;
3. un clip d'environ 12 secondes « robe florale, mouvement du tissu et escalier » ;
4. les masters verticaux au profil retenu, 30 FPS, avec rapport automatique et
   revue humaine frame par frame ;
5. un reçu d'approbation lié aux empreintes de tous les assets.

Le passage au lot est autorisé seulement si les deux clips réussissent chacun
tous les gates. Une modification du LoRA d'identité, du moteur vidéo, du profil
de résolution ou des règles de contrôle invalide le pilote et impose une nouvelle
validation ciblée.

## Critère de terminaison

Un rendu est terminé uniquement lorsque le master conforme, ses sidecars, ses
empreintes, les résultats de gates et l'approbation humaine sont présents. Un
fichier généré, un score moyen élevé ou la fin d'un nombre maximal de retries ne
constituent pas à eux seuls une livraison.
