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

## Production hybride MySoulmate et YouTube

La production commerciale n'utilise pas un moteur unique :

- LongCat sur Darkstar anime les avatars parlants et synchronise chaque langue ;
- ComfyUI sur Darkstar produit le volume, avec Minstar comme secours ;
- Google Flow/Veo est réservé aux plans publics `safe` sans parole : variations,
  plans cinématiques et quelques plans premium ;
- les médias `sensual` et `explicit` restent sur l'infrastructure contrôlée par le
  projet et ne sont jamais envoyés dans le pipeline YouTube/Flow.

Le routage est défini par `src/tools/video/hybrid-video-router.ts`. Le paquet
Flow est un handoff assisté par navigateur : il ne tente pas de transformer les
crédits de l'abonnement Google AI Ultra en crédits API, ne se connecte pas au
compte et ne publie rien automatiquement.

Depuis le dépôt MySoulmate, préparer un seul Short en simulation :

```bash
npx tsx /home/patrice/code-buddy/scripts/mysoulmate/export-google-flow-batch.ts \
  --model fast \
  --remaining-credits 25000 \
  --max-credits 100
```

Ajouter `--write` écrit uniquement le manifeste local sous
`youtube-shorts-workspace/google-flow/`. `--all` doit rester explicite ; sans ce
flag, le premier Short seulement est préparé. Chaque image est confinée dans
`companion-image-cache`, relue sans suivre de lien symbolique et comparée au
SHA-256 du plan. Les plans visuels identiques partagés par plusieurs langues sont
dédupliqués avant l'estimation.

Le handoff Flow V2 est lié au SHA-256 canonique du plan V3 et porte sa propre
empreinte. Après une génération effectuée manuellement dans Flow, placer
exactement un fichier `<job-id>.mp4` par job dans un répertoire local, puis
importer sans connexion ni appel fournisseur :

```bash
npx tsx scripts/mysoulmate/import-google-flow-results.ts \
  --handoff youtube-shorts-workspace/google-flow/<batch>.json \
  --results-dir /chemin/absolu/resultats-flow \
  --output-dir /chemin/absolu/imports-flow
```

L'import relit les fichiers avec `NOFOLLOW`, vérifie ratio et durée via
`ffprobe`, supprime toute piste audio avec `ffmpeg`, reprobe le résultat puis
écrit un reçu immuable `pending-human-review`. La revue exige l'empreinte du
reçu affiché et tous les contrôles explicites :

```bash
npx tsx scripts/mysoulmate/review-google-flow-results.ts \
  --receipt /chemin/imports-flow/<batch>/receipt.json \
  --receipt-sha <sha256-du-recu> \
  --reviewer Patrice --reason "Contrôle image par image" \
  --checks identity,anatomy,motion,cleanEnd,noSpeech,noTextOrLogo,safeContent
```

Cette approbation autorise seulement le montage local. Elle ne soumet aucun job,
ne consomme aucun crédit et ne publie rien.

Le rendu LongCat commercial possède un preflight sans génération :

```bash
npx tsx /home/patrice/code-buddy/scripts/mysoulmate/render-youtube-short-batch.ts \
  --plan /home/patrice/DEV/MySoulmate/youtube-shorts-workspace/plan.json \
  --all --preflight
```

Il valide la durée finale après fondus, les sources et leurs empreintes, les
profils vocaux localisés et leur provenance, puis la capacité du worker. Le
registre reste local dans `~/.codebuddy/voice-rights-registry.json`. Le fichier
[`specs/voice/voice-rights-registry.example.json`](specs/voice/voice-rights-registry.example.json)
est volontairement non approuvé : chaque profil doit être relié à une preuve de
licence réellement revue avant d'obtenir le statut et le scope commerciaux.

Après rendu, le gate technique vérifie le master vertical, les trois clips, les
droits, les codecs, l'audio, les images noires, le VTT et tous les SHA-256. La
revue humaine puis le bundle privé sont deux commandes séparées :

```bash
npx tsx scripts/mysoulmate/review-youtube-master.ts technical --video /chemin/master.mp4
npx tsx scripts/mysoulmate/review-youtube-master.ts review \
  --video /chemin/master.mp4 --reviewer Patrice --reason "Master vérifié" \
  --checks voice,lipSync,identity,anatomy,captions,disclosure,editorial
npx tsx scripts/mysoulmate/review-youtube-master.ts bundle \
  --video /chemin/master.mp4 --review-receipt /chemin/master.mp4.review.<sha>.json \
  --output-dir /chemin/bundles-prives
```

Le bundle porte toujours `visibility: private` et `autoPublish: false`. Il ne
contient aucun client OAuth ni action d'upload.

Grille Google AI Ultra constatée le 18 juillet 2026 : Lite 5 crédits, Fast 10,
Quality 100, et mise à l'échelle 4K +50 par génération. Quality accepte seulement
8 secondes. Les limites peuvent changer : l'interface Flow reste la source de
vérité avant validation humaine du lot.

Référence officielle :
[gérer les crédits Google Flow](https://support.google.com/flow/answer/16526234?hl=fr).
