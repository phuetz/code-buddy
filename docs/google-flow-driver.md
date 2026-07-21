# Piloter Google Flow depuis un navigateur déjà connecté

Le driver génère les clips d'un handoff local avec Google Flow/Veo 3.1 en
s'attachant à un Chrome ouvert par l'opérateur. Il ne lance pas Chrome, ne se
connecte pas à Google, ne lit ni n'écrit les cookies et ne publie rien.

## 1. Préparer Chrome

Fermez d'abord les autres processus qui utilisent le profil choisi, puis
lancez Chrome avec une interface CDP limitée au loopback et avec le profil où
Patrice est déjà connecté à Google AI Ultra. Exemple Linux :

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/chemin/absolu/vers/le-profil-chrome-deja-connecte
```

Sur macOS ou Windows, utilisez l'exécutable Chrome de la plateforme avec les
mêmes trois options. Le chemin du profil reste fourni et contrôlé manuellement
par l'opérateur ; ne le placez pas dans le dépôt.

Le port CDP ne doit pas être exposé sur le réseau. Le driver refuse les URL CDP
non loopback et les URL contenant des identifiants.

## 2. Vérifier Flow manuellement

Dans ce Chrome, ouvrez <https://labs.google/flow> et laissez la redirection
vers l'interface Flow se terminer. Vérifiez :

- que la session Google AI Ultra est déjà connectée ;
- que le solde de crédits affiché couvre le lot entier ;
- que Veo 3.1 Fast ou Quality et le format requis sont disponibles.

Si Google présente un écran de connexion, connectez-vous vous-même dans le
navigateur avant de lancer le driver. Le driver échoue avec
`connecte-toi d'abord dans le navigateur` et ne tente jamais de remplir cet
écran.

## 3. Valider sans dépenser

Exécutez d'abord un dry-run. Il attache le navigateur, vérifie le solde et les
sélecteurs, puis configure le modèle, le format et les images de chaque job,
sans cliquer sur Generate, sans télécharger et sans importer.

```bash
npx tsx scripts/trailers/run-flow-generation.ts \
  --handoff /chemin/absolu/vers/google-flow-handoff.json \
  --results /chemin/absolu/vers/flow-results \
  --cdp http://127.0.0.1:9222 \
  --model fast \
  --max-credits 100 \
  --aspect 16:9 \
  --dry-run
```

`--model` accepte `fast` (10 crédits par clip, valeur par défaut) ou `quality`
(100 crédits par clip). `--aspect` accepte `9:16` ou `16:9` et reprend le
format uniforme du handoff lorsqu'il est omis. `--max-credits` est obligatoire
et constitue une borne dure : aucune nouvelle génération n'est soumise si son
coût ferait dépasser cette valeur. Le solde affiché doit aussi couvrir
l'estimation du lot entier avant toute soumission.

## 4. Générer et importer

Après un dry-run réussi, relancez exactement la même commande sans
`--dry-run`. Chaque résultat est enregistré sous
`<results>/<jobId>.mp4`. Le journal
`<results>/flow-run-<date>.jsonl` contient, pour chaque clip, l'identifiant du
job, le SHA-256 du prompt, les crédits avant/après, le chemin et le SHA-256 du
MP4.

Quand tous les jobs sont présents, le runner appelle automatiquement l'import
fail-closed existant. Par défaut, ses fichiers normalisés et son reçu sont
placés dans le dossier `imported` voisin du handoff. L'import revérifie le jeu
exact de MP4, leur format, leur résolution et leur audio, puis les laisse en
`pending-human-review`. Il ne publie rien.

Si le runner a été interrompu après les téléchargements mais avant l'import,
relancez explicitement l'import existant une fois que le dossier contient
exactement un MP4 par job :

```bash
npx tsx scripts/mysoulmate/import-google-flow-results.ts \
  --handoff /chemin/absolu/vers/google-flow-handoff.json \
  --results-dir /chemin/absolu/vers/flow-results \
  --output-dir /chemin/absolu/vers/imported
```

## Maintenance et garde-fous

L'interface Google change sans préavis. Tous les sélecteurs sont regroupés
dans `FLOW_SELECTORS`, en tête de
`src/tools/video/google-flow-driver.ts`. Après toute mise à jour, exécutez le
dry-run avant une génération payante.

Ne contournez jamais les trois invariants du driver : navigateur déjà connecté
par l'opérateur, budget toujours borné, aucune publication. Une erreur UI, un
quota, un sélecteur absent, un résultat existant ou un jeu incomplet provoque
un arrêt explicite ; l'import reste fail-closed.
