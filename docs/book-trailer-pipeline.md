# Pipeline local de bande-annonce de livre

## État et garde-fous

Le pipeline transforme les chapitres Markdown d'un livre en plan cinématique, en paquet de travail Google Flow, puis en master local assemblé. Il ne contient aucun appel d'API Flow, aucune génération automatique et aucune publication. Le paquet Flow est destiné à une session opérateur dans l'interface web officielle. Tous les reçus restent privés et portent le statut `pending-human-review`.

Le planificateur ne peut utiliser que les extraits déterministes présents dans `excerpts.json`. Chaque shot narratif conserve le couple exact `file`/`locator` du manuscrit. Le hook est limité à trois secondes, le master validé à 60–90 secondes, le texte incrusté est interdit et les titres restent des overlays éditoriaux.

## 1. Extraire et planifier

```bash
npx tsx scripts/trailers/produce-book-trailer.ts \
  --stage plan \
  --book ~/DEV/livres/<livre> \
  --out /chemin/absolu/vers/<workspace>
```

Cette étape lit uniquement les fichiers Markdown du dossier, dans leur ordre naturel. Chaque chapitre est limité à 2 Mio. Elle utilise ensuite le provider LLM configuré pour produire un plan JSON, avec une seule tentative de réparation si le préflight strict échoue.

Sorties :

- `trailer-plan.json` : plan `CinematicTrailerPlan` validé ;
- `excerpts.json` : extraits autorisés, provenance exacte, dossier source et couverture locale éventuelle.

Relire le plan avant de poursuivre : arc dramatique, limite de spoiler, continuité des personnages, références de casting, overlays et estimation de durée. La commande refuse d'écraser les sorties ; `--force` doit être explicite pour les remplacer.

## 2. Préparer le paquet Google Flow

```bash
npx tsx scripts/trailers/produce-book-trailer.ts \
  --stage handoff \
  --workspace /chemin/absolu/vers/<workspace> \
  --model quality \
  --aspect 16:9 \
  --remaining-credits 25000
```

La valeur par défaut est `quality`, au format `16:9`. Le script crée un job de huit secondes par shot, hache chaque image source locale, estime le budget et signe le paquet avec un digest canonique SHA-256. Si le budget annoncé est insuffisant, il échoue sans écrire de paquet. Il ne se connecte pas à Flow et ne dépense aucun crédit.

Sortie : `flow-handoff.json`.

## Étapes opérateur dans Flow

1. Vérifier une dernière fois `trailer-plan.json` et le crédit estimé dans `flow-handoff.json`.
2. Ouvrir manuellement Google Flow avec le compte autorisé.
3. Pour chaque job, charger exactement `source.path`, copier le prompt, puis conserver les réglages du paquet : modèle, huit secondes, `16:9`, son ambiant uniquement et aucun lip-sync.
4. Examiner identité, anatomie, mouvement, absence de texte/logo et propreté de la dernière image. Ne pas publier.
5. Télécharger chaque résultat sous le nom exact `<job.id>.mp4` dans un dossier dédié. Ce dossier ne doit contenir aucun MP4 supplémentaire.

## 3. Importer et assembler

```bash
npx tsx scripts/trailers/produce-book-trailer.ts \
  --stage assemble \
  --workspace /chemin/absolu/vers/<workspace> \
  --results /chemin/absolu/vers/resultats-flow \
  --music /chemin/absolu/vers/musique.wav
```

`--music` est optionnel. L'import canonique vérifie le jeu exact de clips, leur durée et leur ratio, retire leur piste audio, puis les marque `pending-human-review`. Si `--results` contient déjà un reçu d'import canonique, celui-ci est réutilisé après vérification.

Le montage suit l'ordre du plan, applique des fondus d'environ 300 ms et active le ducking de la musique. Le master et son fichier `.meta.json` sont écrits dans la media library locale du workspace :

```text
<workspace>/.codebuddy/media-generation/films/book-trailer-master.mp4
<workspace>/.codebuddy/media-generation/films/book-trailer-master.mp4.meta.json
```

Autres sorties :

- `trailer-receipt.json` : SHA-256 du master et de chaque clip, statut `pending-human-review`, publication automatique interdite ;
- `trailer-overlay-todo.json` : timecodes et textes à poser lors de la finition. Le dépôt ne fournit pas actuellement de composant pour superposer du texte timé sur un film assemblé ; le pipeline ne réimplémente donc pas de moteur de titrage.

Le master doit être relu humainement après pose des overlays et mixage final. Aucune étape de ce pipeline n'autorise ou ne déclenche une publication.
