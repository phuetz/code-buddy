# Rapport d'analyse et de remédiation : Fragilité de l'installation CI (`onnxruntime-node` / nuget.org)

**Date** : 18 septembre 2026  
**Worktree** : `worktree cb-onnx-2026-09-18` (branche `ci/fragilite-installation-2026-09-18`, base `origin/main`)  
**Statut** : Recommandation unique mise en œuvre et vérifiée avec succès

---

## 1. Constat d'abord

### 1.1 D'où vient cette dépendance (`@huggingface/transformers`) ?
La dépendance `@huggingface/transformers` a été introduite dans le commit `3c55da4651f` (*feat(platform): evolve Lisa multimodal companion and Cowork*, Patrice, 13 juillet 2026) au niveau des `dependencies` de premier rang dans `package.json` (`"@huggingface/transformers": "^4.2.0"`).

L'arbre de résolution (`package-lock.json`) tire :
```
@phuetz/code-buddy
└── @huggingface/transformers@4.2.0
    └── onnxruntime-node@1.24.3
```

### 1.2 Pourquoi `onnxruntime-node` contacte-t-il nuget.org ?
Le paquet `onnxruntime-node@1.24.3` possède un script post-installation (`"postinstall": "node ./script/install"`).  
L'analyse approfondie du code source Microsoft de ce script (`script/install.js` et `script/install-metadata.js`) révèle son fonctionnement exact :
- Les binaires **CPU** de l'ONNX Runtime (`libonnxruntime.so.1` et `onnxruntime_binding.node`) sont **déjà pré-packagés et intégrés** dans l'archive npm officielle (`bin/napi-v6/linux/x64/`).
- Cependant, sur la plateforme `linux/x64` exclusivement, `install-metadata.js` déclare un besoin par défaut :
  ```javascript
  requirements: {
    'linux/x64': ['cuda12'],
    'win32/x64': [],
    'darwin/x64': [],
    ...
  }
  ```
- Par conséquent, sur Linux x64 uniquement, le script tente systématiquement de télécharger une archive supplémentaire d'environ 200 Mo contenant les bibliothèques CUDA 12 / TensorRT (`Microsoft.ML.OnnxRuntime.Gpu.Linux`) depuis le feed NuGet :  
  `https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/1.24.3/...`
- **Conséquence directe** : Dès que `api.nuget.org` subit un ralentissement, un timeout TCP ou une indisponibilité temporaire (comme constaté cette nuit), `node ./script/install` échoue avec un code d'erreur non nul. Comme `@huggingface/transformers` était déclaré dans les `dependencies` obligatoires de la racine, `npm ci` s'interrompt immédiatement avec code 1, faisant échouer « Build and Package » ou l'audit de sécurité.

### 1.3 Qui l'utilise réellement dans le produit, et à quoi sert-elle ?
- **Dans le cœur du produit (`src/`)** : **AUCUN fichier** n'importe `@huggingface/transformers`.
- **Au moment de la construction (`npm run build`, `tsc`)** : **Personne ne s'en sert**. `tsc` compile uniquement `src/`.
- **Pendant les tests unitaires (`npm test`)** : **Aucun test** ne requiert `@huggingface/transformers`. Les tests de recherche sémantique et d'embeddings utilisent `@xenova/transformers@2.17.2` (qui est déjà dans `optionalDependencies` avec fallback pur JS/BM25).
- **Lors de l'empaquetage (`npm pack`)** : `node_modules` n'est pas empaqueté dans le tarball publié.
- **Seul consommateur réel** : Le script utilitaire `scripts/smart-turn-worker.mjs`. Ce worker Node persistant est un processus auxiliaire utilisé par le démon audio optionnel Lisa/Cowork (`buddy-sense/src/senses/live_audio.rs`) pour exécuter le modèle de détection de fin de parole Smart Turn v3.2 (`smart-turn-v3.2-cpu.onnx`).
- **Mode d'exécution de Smart Turn** : Ce script charge explicitement le modèle **sur CPU** :
  ```javascript
  const session = await ort.InferenceSession.create(modelPath, {
    executionMode: 'sequential',
    intraOpNumThreads: 2,
  });
  ```
  Il n'active **aucun provider CUDA/GPU**.
- **Environnement CI** : Les runners GitHub Actions (`ubuntu-latest`) sont des machines virtuelles dépourvues de GPU Nvidia.

**Conclusion du constat** : Le téléchargement de bibliothèques CUDA 12 depuis nuget.org est **100 % superflu en CI** (et pour le produit en général, qui fonctionne sur CPU).

---

## 2. Étude comparative des 4 options et recommandation unique

| Option | Description | Avantages | Inconvénients / Faiblesses | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **1. Rendre facultative (`optionalDependencies`)** | Basculer `@huggingface/transformers` dans `optionalDependencies` et dégrader proprement à l'exécution. | Aligné avec l'architecture de Code Buddy (18 paquets natifs/lourds déjà en `optionalDependencies`). Si l'installation échoue, npm n'interrompt pas `npm ci`. | Par défaut, `npm ci` installe **quand même** les `optionalDependencies`. Quand nuget.org répond, la CI continue de télécharger ~200 Mo inutiles (gaspillage de bande passante et de temps). Si nuget.org échoue, npm **supprime** `onnxruntime-node` des `node_modules`, désactivant Smart Turn alors que les binaires CPU étaient prêts et utilisables ! | Moins bonne |
| **2. Empêcher son script d'installation en CI** *(Recommandée)* | Configurer `ONNXRUNTIME_NODE_INSTALL: skip` dans les workflows CI. | **Zéro appel réseau vers nuget.org**. Élimine 100 % de l'aléa CI. Accélère la CI Linux (~58 s au lieu de 2 min). **Conserve 100 % des capacités du produit** : le binaire CPU natif (`libonnxruntime.so.1`) reste en place et Smart Turn fonctionne sans aucune dégradation. | Doit être déclaré dans les workflows exécutant `npm ci`. | **RECOMMANDÉE** |
| **3. Mettre en cache le téléchargement dans le workflow** | Ajouter un cache GitHub Actions sur le dossier de cache nuget/onnx. | Évite le re-téléchargement si le cache est chaud. | Très fragile : tout cache miss (première exécution, rotation hebdo des caches GitHub, nouvelles branches) subit à nouveau l'échec réseau. Gaspille le quota de cache CI (200 Mo) pour un binaire GPU inutilisé. | Moins bonne |
| **4. Retirer la dépendance** | Supprimer complètement `@huggingface/transformers`. | Élimine radicalement le paquet et son script. | **Casse une fonctionnalité du produit** : supprime Smart Turn v3.2 du démon audio Lisa/Cowork. Vioberait la consigne « si le chemin choisi enlève une fonctionnalité, ne le fais pas ». | Moins bonne |

### Pourquoi l'Option 2 est la seule recommandée
L'Option 2 est la seule qui :
1. **Éradique immédiatement la cause racine de l'échec CI** : aucun paquet n'est plus téléchargé depuis `api.nuget.org`.
2. **Ne retire absolument aucune fonctionnalité** : les binaires d'inférence CPU d'`onnxruntime-node` étant déjà intégrés dans le paquet npm d'origine, Smart Turn v3.2 continue de fonctionner à 100 % localement et en production.
3. **Est une fonctionnalité officielle prévue par Microsoft** : `parseInstallFlag()` dans `onnxruntime-node/script/install-utils.js` lit directement `process.env.ONNXRUNTIME_NODE_INSTALL`. Avec la valeur `skip`, le script d'installation s'arrête immédiatement (`process.exit(0)`) en 0 ms sans aucune sortie d'erreur.

---

## 3. Mise en œuvre

La recommandation a été mise en œuvre sans modifier le périmètre fonctionnel du produit :

### 3.1 Déclaration de la variable d'environnement dans tous les workflows GitHub Actions
Ajout de `ONNXRUNTIME_NODE_INSTALL: skip` au niveau racine `env:` dans l'ensemble des workflows exécutant `npm ci` :
- [`.github/workflows/ci.yml`](file://worktree cb-onnx-2026-09-18/.github/workflows/ci.yml) (protège les 3 jobs : `test`, `security`, `build-matrix`)
- [`.github/workflows/security.yml`](file://worktree cb-onnx-2026-09-18/.github/workflows/security.yml) (protège le job `security_scan`)
- [`.github/workflows/release.yml`](file://worktree cb-onnx-2026-09-18/.github/workflows/release.yml)
- [`.github/workflows/release-cowork.yml`](file://worktree cb-onnx-2026-09-18/.github/workflows/release-cowork.yml)
- [`.github/workflows/release-semantic.yml`](file://worktree cb-onnx-2026-09-18/.github/workflows/release-semantic.yml)
- [`.github/workflows/sonar.yml`](file://worktree cb-onnx-2026-09-18/.github/workflows/sonar.yml)

### 3.2 Sécurisation de `scripts/smart-turn-worker.mjs`
Mise à jour de [`scripts/smart-turn-worker.mjs`](file://worktree cb-onnx-2026-09-18/scripts/smart-turn-worker.mjs) avec un import dynamique sécurisé :
- Si `@huggingface/transformers` ou `onnxruntime-node` venait à manquer sur un système hôte, le script émet immédiatement sur `stdout` le message de protocole JSON :
  ```json
  {"error":"Smart Turn dependencies unavailable: ..."}
  ```
  et termine avec exit code 1.
- **Bénéfice** : Cela permet au démon `buddy-sense` (`live_audio.rs`) de détecter l'indisponibilité en moins de 10 millisecondes et de dégrader immédiatement vers l'endpointing VAD classique, sans bloquer le thread pendant le timeout de 15 secondes.

---

## 4. Vérifications réelles effectuées

Toutes les vérifications suivantes ont été exécutées localement sur la machine Linux :

### 4.1 Test d'étanchéité réseau (coupure délibérée vers `api.nuget.org`)
- **Protocole** : Configuration d'un proxy mort (`127.0.0.1:9`) pour toutes les requêtes réseau sauf `registry.npmjs.org` et `github.com`.
- **Validation du blocage** : `curl https://api.nuget.org/` échoue immédiatement avec `Failed to connect to 127.0.0.1 port 9 (Couldn't connect to server)`.
- **Exécution de `npm ci`** : `ONNXRUNTIME_NODE_INSTALL=skip npm ci` a installé 1 851 paquets en **58 secondes** (contre plus de 2 minutes auparavant) avec code de retour **0**. Aucune requête vers nuget.org n'a été émise.

### 4.2 Contrôle de présence des binaires CPU
Vérification des fichiers installés dans `node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/` :
- `libonnxruntime.so.1` (35 164 376 octets) : présent et intact.
- `onnxruntime_binding.node` (384 040 octets) : présent et intact.

### 4.3 Inférence réelle de bout en bout avec Smart Turn v3.2
- Le modèle réel `<domicile>/.codebuddy/turn-detection/smart-turn-v3.2-cpu.onnx` (8,6 Mo) a été chargé par `scripts/smart-turn-worker.mjs`.
- Injection d'un échantillon audio PCM 16 kHz mono (1 seconde).
- **Résultat** :
  ```json
  {"ready":true,"model":"<domicile>/.codebuddy/turn-detection/smart-turn-v3.2-cpu.onnx"}
  {"id":"req-1","complete":true,"probability":0.9870367050170898,"durationMs":90}
  ```
  Inférence CPU réussie en **90 ms**, code de retour **0**. La bibliothèque fonctionne parfaitement sans le paquet NuGet.

### 4.4 Validations de construction, sécurité et tests
- **`npm run build`** (`tsc`, bundled skills, mobile PWA assets, runtime manifest) : **Exit code 0**.
- **`npm pack --dry-run`** (`prepack`, `strip-sourcemaps`, tarball packaging) : **Exit code 0** (5 258 fichiers, archive de 8,6 Mo).
- **`node scripts/ci-audit-gate.mjs`** : **PASS** (0 critique, 10 hauts documentés et acceptés, 0 haut non documenté).
- **`tests/config/npm-allow-scripts.test.ts`** : **1/1 test passé**.
- **`tests/security/npm-pack-contents.test.ts`** : **10/10 tests passés**.
- **`tests/unit/embedding-provider.test.ts`** : **67/67 tests passés**.
- **`tests/sensory/speech-reaction.test.ts`** : **55/55 tests passés**.
- **`tests/sensory/conversation-conv2.test.ts`** : **2/2 tests passés**.
- **`npm run lint`** : **0 erreur** (2 496 avertissements historiques).
- **`npm run typecheck`** : **Exit code 0** sur les 3 cibles (`tsc --noEmit`, `gpuNode-identity`, `companion-core`).

---

## 5. Ce qui n'a pas pu être vérifié depuis cette machine

En toute franchise et par transparence :
1. **Exécution sur un véritable runner GitHub Actions** : Seule l'ouverture d'une Pull Request déclenchera les VM distantes de GitHub Actions. Les tests locaux reproduisent fidèlement l'environnement Linux x64, mais ne remplacent pas le run officiel de la plateforme.
2. **Comportement sur les runners Windows et macOS de la CI** : Bien que l'analyse du code source Microsoft confirme que `install-metadata.js` a un tableau `requirements` vide pour `win32` et `darwin` (aucun téléchargement NuGet n'y est tenté même sans flag), nous n'avons pas pu exécuter de VM Windows ou macOS depuis cet environnement Linux.
3. **Capture micro en direct de `buddy-sense`** : Le test d'inférence Smart Turn a été validé avec un fichier PCM synthétique conforme au protocole ; la chaîne matérielle complète (microphone réel PulseAudio/PipeWire -> ear Rust -> worker Node) n'a pas été exécutée avec un flux audio vivant.
