# Atelier Flow — génération image et vidéo cohérente

Atelier Flow réunit les moteurs image et vidéo existants de Cowork dans un
workspace narratif unique. L'objectif n'est pas de copier un fournisseur, mais
d'ajouter la continuité créative qui manquait entre une génération et la
suivante.

## Workflow

1. Importer des images depuis la médiathèque ou le sélecteur natif.
2. Cliquer un ingrédient pour l'insérer dans le prompt sous la forme `@Nom`.
3. Choisir Texte, Ingrédients ou Images clés.
4. Définir ratio, variantes, durée, caméra, ambiance et voix.
5. Générer avec `media.generateImage` ou `film.produce`.
6. Comparer les variantes dans le Scenebuilder et étendre le plan retenu.
7. Monter les clips vidéo en un film unique ou basculer entre plusieurs projets.

Le compilateur de prompt ajoute les références visuelles, images de début/fin,
mouvement caméra, contrat audio et contraintes d'identité. Les variantes sont
lancées en parallèle et rattachées à la timeline, sans introduire un troisième
moteur média.

Les projets sont enregistrés dans un catalogue local versionné. Le montage final
délègue au cœur `assembleFilm` avec transitions dissolve et ajoute le résultat
comme plan vidéo exportable, sans écraser les clips sources.

Pour la vidéo cinématique, les ingrédients locaux sont validés dans le processus
principal (format image, 15 Mo maximum), transformés en références de données et
transmis à `video_generate`. Le moteur `film.produce` reste un fallback distinct
pour les présentations narrées lorsque le fournisseur vidéo est indisponible.

## Architecture

- `FlowIngredientRail.tsx` : bibliothèque filtrable et références `@`.
- `FlowInspector.tsx` : paramètres de génération et images clés.
- `FlowSceneTimeline.tsx` : plans, variantes et extension.
- `flow-studio-model.ts` : modèle pur et compilation du prompt.
- `VideoStudioView.tsx` : orchestration des bridges Electron existants.

La conception s'inspire des principes documentés publiquement par Google Flow :
ingrédients réutilisables, Frames to Video, variantes, extension et
Scenebuilder. Références :

- https://support.google.com/flow/answer/16353334
- https://support.google.com/flow/answer/16352836
- https://blog.google/innovation-and-ai/models-and-research/google-labs/flow-updates-february-2026/

Référence visuelle :
[`designs/code-buddy-flow-studio-concept.png`](designs/code-buddy-flow-studio-concept.png).

Audit de parité et backlog vérifié :
[`audits/flow-studio-audit-2026-07-11.md`](audits/flow-studio-audit-2026-07-11.md).
