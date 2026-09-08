# CI portable — 2026-09-08

Mission ASTRA : quatre tranches PTY, balayage, chemins Windows et mémoire macOS.
Rapport créé avant inspection du code. Branche `fix/ci-portable-macos-windows-2026-09-08`, base attendue `25b909a26`.
Vérifications et compteurs d’outillage : à compléter. Aucun push.

## Tranche 1 — PTY

Base Linux : 8/8. Régression ajoutée : 5 rouges (création PTY et perte cwd/LANG), puis 13/13 verts.
Repli uniquement si `spawn` échoue avant retour du shell : pas de réexécution après démarrage.
Module absent injecté par `null`, panne native par mock `posix_spawnp failed` ; mêmes variables filtrées et overrides sûrs.
PowerShell : opérateur `&` pour les chemins cités, nettoyage ANSI dans les assertions ; NODE_PATH exige aussi `child ok`.
Seule absence de Python autorise `it.skipIf`, avec motif dans le titre ; aucun skip dû au PTY.
`npm run typecheck` et `npm run lint` : exit 0 (warnings existants). Garde personnel : 40/40.
Code Explorer : index initial toujours en cours lors des premières requêtes ; celles-ci ont échoué faute de snapshot, complétées par recherche exacte.

## Tranche 2 — balayage

Commit PTY : `281fa0e17`.
Base sous HOME/TMPDIR QA : 14/15 ; reproduction enrichie : 3 rouges sur 17, puis 18/18 verts.
Causes prouvées : fixture CommonJS `.js` sous un dépôt ESM, espaces BSD dans `wc`, comparaison CRLF/LF.
Correction : fixture `.cjs`, regex tolérant les espaces, normalisation CRLF des références dans le script (lecture et régénération).
Git Bash résolu explicitement, chemins transmis avec `/`, suppression avec retries bornés pour les verrous Windows.
Le probe de timeout vise un chemin absent explicite : Windows peut trouver System32 même avec PATH vide.
Aucun inventaire de commandes réduit ; faux `wc` dans PATH de test pour reproduire macOS.
ESLint ciblé et `bash -n scripts/balayage-installation.sh` : exit 0.
Le code 3 distant n'est pas reproduit tel quel : sans journal détaillé du runner, aucune attribution à un binaire manquant n'est affirmée.

## Tranche 3 — chemins Windows

Commit balayage : `85444fca0`.
Checkpoint : base 66/66 ; `CI_PORTABLE_WIN32_PATHS=1` + vrai `path.win32` reproduit deux rouges ; 66/66 après correction, Linux également 66/66.
Le mock `path` avait des exports nommés artificiels et un export par défaut natif divergent. Les deux utilisent désormais la même implémentation ; chemins attendus construits avec join/resolve.
Onboarding : base 18/18 ; `CI_PORTABLE_WIN32_HOME=1` simule homedir via USERPROFILE et reproduit ENOENT ; 18/18 après isolation/restauration de HOME ET USERPROFILE, également 18/18 sans simulation.
La première simulation par espion de l'export par défaut ne touchait pas l'import namespace : remplacée par un mock des deux exports avant de conclure.
Le nettoyage onboarding avait déjà des retries ; aucune panne EBUSY/EPERM native n'est prétendue reproduite.

## Tranche 4 — mémoire macOS et vérifications finales

Commit chemins : `d8a8107e9`. Tranche mémoire : commit portant cette section, sujet `fix(ci): cap macOS Vitest heaps and reuse sequential shards`.
`vitest.config.ts` : 4096 MiB sur darwin/win32, 8192 sur Linux ; le plafond ne constitue pas une limite RSS globale.
`ci.yml` : seules les conditions des étapes de tests et leurs commentaires changent pour ajouter macOS aux six shards existants. Matrice, retries Windows, continue-on-error et Ubuntu inchangés.
CLAUDE.md : ligne Testing Gotchas et correction du rappel existant.
Probe local de configuration : assertion macOS rouge (8192 reçu, 4096 attendu), puis darwin/win32/linux verts ; YAML parsé et six shards vérifiés.
Deux premiers essais du probe ont échoué dans le harnais (chargement Rollup après simulation d'OS, puis __dirname normalement fourni par Vite) ; ils ne constituent pas des régressions du produit.

### Commandes et résultats

Environnement des vérifications finales : HOME et TMPDIR sous `_qa/ci-portable/`, Node 24 Linux. Aucun runner macOS/Windows disponible, aucune suite entière, aucun banc d'évaluation, aucun push.

- `npx vitest run tests/security/interactive-bash-env-injection.test.ts --cache=false` : 13/13, dont module absent et posix_spawnp mocké, processus enfants réels.
- `npx vitest run tests/scripts/balayage-installation.test.ts` : 18/18, dont wc BSD factice et CRLF.
- `npx vitest run tests/wizard/onboarding.test.ts` : 18/18 ; idem avec `CI_PORTABLE_WIN32_HOME=1` et USERPROFILE QA.
- `npx vitest run tests/unit/persistent-checkpoint-manager.test.ts` : 66/66 ; idem avec `CI_PORTABLE_WIN32_PATHS=1`.
- `npx vitest run tests/security/donnees-personnelles.test.ts --cache=false` : 40/40.
- `npm run typecheck` : exit 0, y compris gpuNode identity et companion-core.
- `npm run lint` : exit 0, 0 erreur, 2488 warnings ; ESLint ciblé des tests modifiés : exit 0.
- `npx tsx _qa/ci-portable/check-memory.ts <darwin|win32|linux>` : trois succès ; `node _qa/ci-portable/check-workflow.mjs` : succès.
- `bash -n scripts/balayage-installation.sh`, `git diff --check`, commitlint : succès.

### Limites et outillage

Le rapport a été créé avant inspection du code. Le guide complémentaire a été trouvé à la racine du dépôt méthodologique, pas dans son sous-dossier methodologie.
Code Explorer : 12 requêtes context/impact tentées (InteractiveBashTool, PTYModule, balayage-installation, vitest.config, OnboardingWizard, PersistentCheckpointManager), toutes sans snapshot. Analyse initiale arrêtée après plus de 16 minutes ; reconstruction `analyze . --incremental --verbose` également tentée, puis arrêtée sans graphe exploitable. Le log final recense 6896 fichiers et atteint cpp_reconcile. Aucun index frais n'est revendiqué ; recherches exactes et revue du diff brut ont servi de complément.
Les compteurs ci-dessous couvrent les invocations lm-resizer explicites enregistrées dans les JSON QA ; ils excluent les réécritures automatiques non mesurées du hook. Les journaux bruts d'échec et le diff brut ont été relus ; les octets sont des volumes de sortie, pas des tokens.
Écart d'isolation : les deux premiers tests PTY utilisaient encore le tmpdir système, nettoyé par leurs hooks ; les suivants ont TMPDIR QA. Le node_modules du clone est un lien préexistant vers les dépendances partagées ; les derniers tests désactivent le cache Vitest. Aucun fichier source de la copie de travail interdite n'a été édité.
La CI distante verte et la disparition des OOM restent à confirmer sur les runners Node 20/22 après intégration autorisée ; le code 3 distant et les verrous Windows n'ont pas été reproduits nativement.

Outillage : 12 appels Code Explorer (context/impact/query, sans snapshot), 38 commandes explicites via lm-resizer, 701865 octets économisés.

Commitlint : les deux appels initiaux ont échoué au chargement de la configuration CommonJS `.js` dans le dépôt ESM. Copie byte-identique sous `_qa/ci-portable/commitlint.config.cjs` : validation des trois commits précédents et du message mémoire via `--config` toutes deux exit 0. Aucun changement de règles.

## Tranche 2 — reprise après les vrais runners (08/09)

Branche `fix/ci-portable-macos-windows-2026-09-08`, commit portant cette section.
Analyse des journaux fournis du run 34195382471, shard 1/6 ; aucun nouveau run distant lancé.

### Causes mesurées et corrections

- Environnement interactif : les différences réelles sont le cwd court/long Windows (lignes 7294–7295) et `/var` contre `/private/var` sur macOS (7724–7725), pas des variables supplémentaires. Comparaison des chemins physiques via `realpathSync.native`, sous-ensemble LANG présent et NODE_OPTIONS/NODE_PATH/PYTHONPATH absents ; noms normalisés sous Windows. Une jonction/liaison réelle exerce les deux replis, et `process.platform` mocké exerce la casse Windows. Le probe ne révèle que les variables concernées.
- Balayage : le seul cas rouge est celui dont la fixture quitte avant de produire le help si PATH diffère. Le script résout déjà Node et lance explicitement le point d’entrée ; les autres extractions sont vertes. La fixture compare désormais les chemins physiques et accepte la notation Git Bash `/c/…`. Aucun skip ajouté, aucune commande retirée. Cette attribution reste à confirmer nativement sur Windows.
- Doctor : l’erreur vient de `fileURLToPath` recevant une URL POSIX sous Windows, et non de `pathToFileURL`. La fixture fabrique désormais une URL native avec `pathToFileURL(resolve(...))`.
- macOS : le journal 7643–7704 rattache l’OOM au processus CLI du test de persistance (exit 134), avec GC vers 1968 Mo et pile `JsonStringifier`. `captureAndSaveTimelineSnapshot` lit le workspace et sérialise tous ses fichiers ; le test capturait le checkout entier, pas une fixture énorme déclarée. Il utilise maintenant un workspace d’un fichier, hors du répertoire des snapshots, et vérifie aussi le contenu des deux snapshots. Le journal seul ne donne pas le fichier individuel responsable du volume.
- `vitest.config.ts` utilise bien `execArgv` au niveau test pour Vitest 4 (4096 MiB darwin/win32). `ci.yml` séquence six shards ; aucun NODE_OPTIONS hérité n’impose ce plafond aux CLI lancées avec `spawn`. L’OOM observé n’est pas celui du worker. Les plafonds et la configuration CI restent inchangés ; pas d’augmentation mémoire pour masquer le volume de la fixture.

### Preuves locales

Toutes les commandes de test passent par `lm-resizer exec --json --raw-on-failure -- npx vitest run <fichier> --cache=false`, HOME et TMPDIR sous `_qa/ci-portable/`, un worker par invocation. Node 24 Linux ; dépendances partagées préexistantes, cache Vitest désactivé.

- Contrôle rouge avec l’ancienne comparaison cwd sur l’alias réel : 2 échecs ; correction rétablie : environnement 14/14, dont simulation de casse Windows.
- Balayage : 18/18 ; doctor SQLite : 5/5 ; headless : 7/7, y compris persistance session/run/timeline et contenu des snapshots.
- Garde `tests/security/donnees-personnelles.test.ts` : 40/40.
- `npm run typecheck` : exit 0, trois projets.
- Lint et vérifications de commit : résultats ci-dessous.

### Limites

Aucun runner Windows/macOS exécuté ici ; les shards 2–6 restent inconnus. La disparition de l’OOM est à confirmer sur le runner macOS Node 20. Aucun push, aucun service modifié. Index Git vide après le commit unique de cette reprise.
Code Explorer : requêtes sans snapshot, recherches exactes en complément. Analyse initiale et reconstruction après modifications tentées ; aucun graphe frais revendiqué. Une ultime reconstruction est bornée à 45 secondes pour ne pas laisser de processus actif à la passation.

`npm run lint` : exit 0, 0 erreur / 2488 warnings (journal brut relu). `git diff --check` : vert. Commitlint : premier appel sans stdin transmis par lm-resizer en échec ; second avec `--edit` et copie CJS byte-identique de la configuration : exit 0. Garde personnel relancé après rédaction : 40/40. Reconstruction Code Explorer finale : timeout 124, aucun snapshot.

Outillage : 11 appels Code Explorer (context/impact/query, sans snapshot), 13 commandes via lm-resizer, 348808 octets économisés. Compteurs propres à cette reprise ; les réécritures automatiques du hook sont exclues.

## Tranche 3 — run 34197704112 (08/09)

### Lot 1 — abandon Bash (priorité build)

Le rouge Ubuntu Node 22 fourni est le timeout explicite de 5 s. Le test attend maintenant le marqueur émis après lancement de `sleep`, déclenche abort puis consomme le générateur jusqu'à sa fin, pilotée par `close`. Timeout explicite 15 s ; délai de 50 ms et contrainte murale de 2 s supprimés. Plus de fichier hors workspace. Le groupe POSIX est déjà créé avec `detached` et tué par PID négatif dans le code existant.

Preuve locale : ancien cas 5/5 vert (flocon CI non reproduit). Première synchronisation rouge à 15 s car le sandbox bufferise ; fixture corrigée pour sélectionner le chemin direct approuvé avec le bridge existant, 5/5 vert. Le processus et ses descendants sont réels, seule la disponibilité sandbox est simulée dans ce cas. Typecheck exit 0.
Lint global exit 0 (2488 warnings préexistants), garde personnel 40/40 ; aucune suite entière.

### Lot 2 — ledger macOS et garde OpenCode

Le journal 8588–8686 contredit l'attribution initiale : un rapport `null` dans `deleguer.sh` (moteur **local**, pas OpenCode), puis quatre codes 3 dans **fusionner-lane.sh** (`EXIT_LEDGER`). `find -printf` GNU empêche la découverte ; `realpath -e` empêche la validation du rapport. `sha256sum` n'est pas une dépendance BSD garantie non plus. Le helper `lane-files.mjs` utilise les primitives Node déjà disponibles pour découverte, chemin physique et SHA-256 ; le contrôle de confinement et la vérification du hash restent actifs.

Simulation BSD par PATH de test : refus de `find -printf`, `realpath -e`, et absence de `sha256sum`. Avant : exactement **5 rouges / 12**, dont `report_invalid` exit 3 (journal brut relu). Après : **12/12 verts**. La garde OpenCode est traitée séparément : motif `[o]pencode` évitant l'auto-match de pgrep, exclusion du shell et de tous ses ancêtres par `ps -o ppid=` portable. Test simulant les candidats BSD : ancien filtre **1 rouge / 3**, correction **3/3 verts**, autre PID toujours bloquant. ESLint ciblé et `bash -n` : exit 0.

Lot 1 livré : `73f7148b0`. Code Explorer reste sans snapshot ; reconstruction initiale interrompue après plusieurs minutes sans résultat, reconstructions incrémentales bornées à 45 s (timeout 124). Aucun processus d'une autre lane arrêté.
