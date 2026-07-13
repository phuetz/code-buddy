# Audit Atelier Flow — 2026-07-11

## Référentiel

L'audit compare Atelier Flow aux surfaces officiellement documentées de Google
Flow en juillet 2026 : génération et édition d'images, ingrédients, personnages,
Frames to Video, édition vidéo, Scenebuilder, projets, collections, Agent et
Tools.

Sources primaires :

- https://support.google.com/flow/answer/16729550
- https://support.google.com/flow/answer/16353334
- https://support.google.com/flow/answer/16352836
- https://support.google.com/flow/answer/16935308
- https://support.google.com/flow/answer/17104535
- https://blog.google/innovation-and-ai/models-and-research/google-labs/flow-updates-february-2026/

## État après correction

| Capacité | État Code Buddy | Preuve / limite |
|---|---|---|
| Image et vidéo dans un workspace | Livré | Bascule sans quitter Atelier Flow |
| Ingrédients nommés et `@` | Livré | Import, recherche, sélection et suppression |
| Références réellement envoyées à la vidéo | Livré | Trois images max, validation 15 Mo, data URLs |
| Première image vidéo | Livré | `imageUrl` natif du moteur vidéo |
| Dernière image vidéo | Partiel | Contrainte de prompt ; backend actuel sans champ natif |
| Variantes parallèles | Livré | `Promise.all`, 1/2 vidéo et 1/2/4 image |
| Scenebuilder | Livré | Plans, sélection, variantes, ajout et extension |
| Caméra et audio | Livré | Contrat prompt + paramètres moteur vidéo |
| Projet restaurable | Livré | Snapshot local versionné, autosauvegarde 250 ms |
| Export | Livré | Plan sélectionné ou tous les médias générés |
| Matrice de compatibilité | Livré | Le panneau annonce les références natives ou simulées |
| Édition image non destructive | À faire | Historique de versions, crop, masque/lasso et dessin |
| Références binaires pour l'image | À faire | `generateImage` ne prend encore que le texte |
| Video-to-video / suppression d'objet | À faire | Requiert un endpoint d'édition fournisseur |
| Personnage multi-références + voix | À faire | Modèle de personnage et voice binding dédiés |
| Collections d’assets | Partiel | Filtres personnages/objets/lieux/styles ; imbrication à faire |
| Plusieurs projets | Livré | Catalogue migrable, renommage et changement instantané |
| Montage exporté en un fichier | Livré | `assembleFilm`, transitions dissolve et nouveau plan final |
| Historique non destructif | Livré | Variantes et extensions conservent leur parent de scène |
| Agent créatif et routage automatique | À faire | Le compilateur est déterministe, pas agentique |
| Outils média générés | À faire | À intégrer au système Skills/Tools avec permissions |

## Priorité recommandée

1. Étendre `ImageGenerateInput` avec images et masque, puis ajouter une pile de
   versions non destructive.
2. Créer un type `Character` regroupant 1–2 images, description et voix Pocket
   TTS personnalisée.
3. Ajouter des collections imbriquées au catalogue de projets.
4. Ajouter un Agent créatif qui route selon la matrice de capacités et affiche
   le coût estimé avant toute génération payante.
