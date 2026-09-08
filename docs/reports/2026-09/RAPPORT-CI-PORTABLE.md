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

### Lot 3 — fixtures Windows

Balayage conserve l'exigence exit 0, total strictement positif et réussites égales au total, sans imposer une seule commande. GK35 attend `connected` par `expect.poll` (5 s maximum, intervalle 20 ms) ; le listener tardif ne résout que pour `slow_fixture`, car le serveur rapide peut lui aussi dépasser les 400 ms d'initialisation. L'absence initiale des outils lents reste vérifiée avant l'attente.

Simulation contrôlée : cinq commandes dans le help et délai du serveur rapide porté à 600 ms. Anciennes assertions : **2 rouges / 19**, erreurs exactes `connecting` et `5/5` (brut relu). Assertions corrigées, mêmes conditions : **19/19 verts**. Fixtures finales rétablies (délai 0, help initial), également **19/19 verts** dans la première exécution. Lot 2 livré : `022fcac03`.

### Lot 4 — OOM macOS mesuré

Les deux traces du run fourni sont le même test rejoué : `tests/cli/gk29-headless-resume.test.ts`, première trace 8482–8586, seconde vers 9615–9695. La CLI enfant sort 134, GC vers 1963 Mo, pile `JsonStringifier`. Ce n'est pas un worker Vitest de 4 Gio qui atteint son plafond : le test lançait une CLI sans NODE_OPTIONS depuis le checkout entier ; ses snapshots capturaient ce checkout, comme l'autre test corrigé à la tranche précédente.

Reproduction Linux Node 24, HOME/TMPDIR isolés, `NODE_OPTIONS=--max-old-space-size=512`, `npx vitest run tests/cli/gk29-headless-resume.test.ts --logHeapUsage --cache=false --maxWorkers=1` via lm-resizer : **rouge**, CLI exit 134, GC à **508,5 Mo**, worker **11 Mo**, 8,94 s. Après correction : **vert** sous le même plafond. Relecture en `--reporter=verbose --stream` : **12 Mo** pour le worker, **22,93 s** ; ce chiffre n'est pas le pic mémoire de la CLI. Le test utilise désormais un workspace d'un fichier, distinct des snapshots, et vérifie le contenu de chaque snapshot après les trois tours.

`ci.yml` exporte désormais NODE_OPTIONS au niveau du job matriciel : **4096 MiB macOS/Windows, 8192 MiB Linux**, hérité par les CLI enfants. `vitest.config.ts` lit déjà `process.platform` et borne les forks ; commentaire clarifié. **Vitest installé 4.1.9** : `poolOptions.forks.execArgv` demandé correspond à **test.execArgv**, consommé par `project.config.execArgv` dans le runner (source locale inspectée). Pas de clé obsolète inactive ajoutée.

Probe local chargeant la configuration réelle avec plateformes simulées et démarrant un fork/une CLI : old-space 4096 sur darwin/win32, 8192 sur linux ; tas total V8 mesuré **4288 / 8384 MiB** (inclut la jeune génération). Les premiers probes ont échoué : chargement hors Vite sans `__dirname`, puis borne du tas total trop stricte de +100 MiB ; harnais rectifié, trois plateformes **exit 0**. Ce sont des simulations de configuration, pas des exécutions natives macOS/Windows.

### Vérifications et passation

Lot 3 livré : `6c6ce427e` ; lot 4 : commit portant cette section. Invocation finale ciblée des sept fichiers (bash-streaming, lane-ledger, opencode-guard, balayage-installation, gk35-stdio-timeout, gk29-headless-resume, donnees-personnelles), via lm-resizer, HOME/TMPDIR isolés, cache désactivé et un worker : **7 fichiers / 80 tests verts**. `npm run typecheck` : **exit 0**, trois projets. `npm run lint` : **exit 0**, 2488 warnings / 0 erreur, brut relu. `git diff --check`, `bash -n` et commitlint par message (copie CJS byte-identique de la configuration ESM historique) : verts. Hooks de commit désactivés uniquement lors des commits après contrôles explicites, pour éviter la suite entière interdite par la mission.

Aucun banc d'évaluation, aucun push, aucun service modifié. Index Git vide après les quatre commits. Les résultats Linux locaux ne prouvent pas le passage des runners natifs : relancer la CI et confirmer Build and Package reste ouvert. Les journaux et probes sont sous `_qa/ci-portable/`, non suivis. Code Explorer : 16 requêtes sans snapshot, analyse initiale sans résultat et trois reconstructions incrémentales bornées à 45 s (124) ; complément par recherches exactes, aucun graphe frais revendiqué.

Garde personnel après rédaction finale : **40/40 verts**.

Outillage : **16 appels Code Explorer (context/impact/query), 33 commandes via lm-resizer, 698617 octets économisés**. Compteurs propres à cette mission, échecs inclus ; 32 métadonnées JSON et une exécution `--stream` sans réduction, hooks automatiques exclus. Volumes de sortie, pas des tokens facturés.

## Tranche 4 — scripts Bash, chemins et affichage (08/09)

Branche `fix/ci-portable-macos-windows-2026-09-08`, base `4885eb1cc`, run fourni `34200577158`. Livré par le commit portant cette section : `fix(ci): make remaining shell and desktop fixtures platform-aware`. Aucun push, aucun banc d’évaluation, aucun service modifié. HOME isolé `_qa/ci-portable/home`, répertoires temporaires sous `_qa/ci-portable/tmp` ; les fixtures ledger restent dans le sous-répertoire de test du dépôt.

### Diagnostic des journaux et corrections

Les deux exécutions du shard Windows rapportent les mêmes familles. La seconde compte **21 échecs** : 12 ledger, 2 conversation cues, 3 BashTool, 1 RAG, 1 StrategyStore, 1 shared-photos, 1 LongCat. Le journal macOS ne présente qu’un test rouge, GK21, rejoué deux fois.

- **Bash / ledger** : `spawnBashScript` passe explicitement par Bash, normalise le chemin du script et les arguments absolus Windows. Probe d’un Bash exécutable avant les suites Windows, skip expliqué s’il manque. PATH construit avec `path.delimiter`, doublon Path/PATH retiré, chemins d’environnement consommés par Bash normalisés. Le script avec espaces et antislashs est exécuté réellement, avec un argument littéral contenant une substitution shell qui ne doit pas être évaluée.
- **Limite de sécurité du ledger** : `lane-ledger.mjs` vérifie réellement les modes des deux clés et refuse tout mode différent de 0600. Windows retourne 0666 ; corriger le lancement Bash ne suffit donc pas. **Onze scénarios de journal signé/fusion sont explicitement sautés sous Windows**, avec leur raison POSIX. La garde de production reste intacte. La délégation sans ledger s’exécute sous Git Bash ; un test Windows supplémentaire exige le refus structuré `chain_broken` des clés incompatibles. Le support ACL du ledger Windows reste hors tranche.
- **Frontière Node → Bash** : les sorties `latest`/`realpath` de `lane-files.mjs` sont converties par `toBashPath` sous Windows (`D:\…` → `/d/…`, UNC conservé). Sans cela, le préfixe du clone Bash ne correspond pas au rapport natif et l’extraction du chemin relatif échoue. SHA-256 inchangé, noms POSIX avec antislash conservés. Sept cas synthétiques couvrent lecteurs, espaces, UNC, absence de rapport et préfixe de confinement.
- **Conversation cues** : contrairement au résumé initial, les lignes 40/120 échouent sur les séparateurs des chemins audio ; les expressions acceptent les deux séparateurs, tout en conservant le chemin et le fichier attendus.
- **BashTool** : les trois attentes fautives de shell se trouvent dans `tests/unit/bash-tool.test.ts`. Elles vérifient l’exécutable ET le préfixe d’arguments de `getShellConfiguration()`, sans réduire l’assertion à un joker. Le cas spawn est exécuté avec `process.platform` simulé Linux/macOS/Windows et restauré dans `finally`.
- **RAG, ligne 479** : chemins attendus `/test/index/*.json` contre chemins reçus avec antislashs ; utilisation de `node:path.join`, mêmes trois fichiers et contrôles de contenu conservés. Ni casse ni fins de ligne en cause.
- **GK21 macOS** : le backend macOS ignore DISPLAY/WAYLAND_DISPLAY. Le helper `forceLinuxWithoutDisplay` sélectionne explicitement Linux et retire ces variables, puis restaure exactement l’état précédent. Le test de non-capture reste exécuté sur toutes les plateformes, sans skip macOS. Trois simulations vérifient également restauration du backend et des variables initialement présentes.
- **Permissions / signaux** : seuls les contrôles de bits POSIX des photos et de StrategyStore sont conditionnés hors Windows ; stockage et contenu restent vérifiés. Le test thermique LongCat utilise `os.killpg` et SIGKILL, comme le test SIGTERM déjà exclu : skip Windows expliqué. Aucun affaiblissement de l’arrêt thermique de production.

La règle réutilisable est posée dans `tests/setup/platform-fixtures.ts` et documentée dans `CLAUDE.md` § Testing Gotchas : Bash explicite, absence de display forcée, chemins/shell résolus, permissions et signaux bornés à la plateforme qui les implémente. Pas de mock global de child_process ni de skip global des tests scripts/desktop.

### Preuves rouge → vert et vérifications

1. Ligne de base Linux : huit fichiers, **264/264 verts** ; les rouges natifs sont établis par les journaux fournis, pas prétendument reproduits sous Linux.
2. Ancienne attente `bash -c` rétablie temporairement avec les trois plateformes simulées : **1 rouge Windows / 2 verts**. Attente corrigée : trois plateformes vertes. Brut relu, journal local `ci4-red-shell.log`.
3. Ancienne sortie Node native sans conversion : **4 rouges / 7** sur chemins Windows et confinement ; conversion rétablie : **7/7 verts**. Brut relu, journal local `ci4-red-paths.log`.
4. Commande finale via lm-resizer : `npx vitest run tests/scripts/lane-ledger.test.ts tests/scripts/lane-shell-path.test.ts tests/scripts/platform-fixtures.test.ts tests/sensory/conversation-cues.test.ts tests/unit/codebase-rag.test.ts tests/unit/bash-tool.test.ts tests/tools/gk21-computer-control-headless-display.test.ts tests/agent/self-improvement/strategy-store-runtime.test.ts tests/companion/shared-photos.test.ts tests/gpu-worker/longcat-runner.test.ts tests/security/donnees-personnelles.test.ts --maxWorkers=1` : **11 fichiers verts, 317 tests verts, 1 skip** (test réservé au mode natif Windows).
5. `npm run typecheck` : **exit 0**, trois projets. `npm run lint` : **exit 0**, brut relu, **2488 warnings / 0 erreur** ; ESLint ciblé après les derniers ajustements : exit 0. `git diff --check` et commitlint : verts. Configuration commitlint ESM historique copiée byte-identique en CJS dans QA ; hooks désactivés lors du seul commit après ces contrôles explicites.
6. Garde personnel : **40/40 verts** dans la commande finale, rejoué après rédaction du rapport. Aucun journal brut ni environnement personnel ajouté à Git.

**Limites** : toutes les familles rouges visibles des deux shards sont traitées ; aucun passage natif Windows/macOS n’est revendiqué. Relancer la CI, puis traiter les éventuels shards suivants encore masqués. Le ledger signé reste indisponible sur Windows tant qu’une vérification ACL sûre n’existe pas. Ubuntu et Build and Package étaient déjà verts dans le run fourni et n’ont pas été relancés ici.

Code Explorer : requêtes sans snapshot malgré l’analyse initiale (arrêtée après plusieurs minutes) et trois reconstructions incrémentales bornées à 45 s (exit 124). Recherches exactes et inspection ciblée en complément ; aucun index frais revendiqué. Index Git vide après le commit, zones libérées.

Outillage : **18 appels Code Explorer (context/impact/query), 16 commandes via lm-resizer, 356208 octets économisés**. Volumes de sortie, pas des tokens facturés ; métadonnées de cette tranche seules dans `_qa/ci-portable/ci4-tooling.jsonl`, échecs inclus, hooks exclus.


## Tranche 5

Base `99206a45b`, branche `fix/ci-portable-macos-windows-2026-09-08`.
Un seul commit de tranche, aucun push. HOME et répertoire temporaire isolés
sous `_qa/ci-portable/`. Aucun service modifié.

### Ubuntu : reproduction et cause

Les fichiers `persistence-integration.test.ts` et `bash-streaming.test.ts`
ont chacun été exécutés **20 fois avant correction**, sans échec naturel.
Journaux : `_qa/ci-portable/before-<fichier>-<1..20>.log`.
Le journal Ubuntu fourni reste la preuve de l'échec sous charge du runner.

Une reproduction contrôlée a ensuite retenu la première écriture et laissé
la seconde avancer : `keeps the latest snapshot when an earlier write is delayed`
échoue sur le code initial avec **expected 1 to be 5** (exit 1).
Ce test injecte l'ordonnancement au niveau de l'écriture atomique ; il ne prétend
pas reproduire spontanément la charge Ubuntu. Preuve brute :
`_qa/ci-portable/home/lm-resizer/tee/1788857748_npx_vitest_run_tests_agent_multi-agent_persisten.log`.

La sauvegarde atomique empêche un JSON partiel, mais n'ordonne pas deux sauvegardes.
`saveMetrics` capture maintenant le snapshot avant tout `await`, puis sérialise
les écritures par chemin dans le processus. Le coordinateur émet `metrics:saved`
après sa sauvegarde ; les deux tests de debounce attendent cet événement avant
la lecture. Chaque test reçoit son propre `mkdtemp`, et le nettoyage attend les
coordinateurs avant de supprimer le répertoire. Les vérifications de `dispose`
avancent une horloge simulée au-delà du debounce, au lieu d'attendre 50/60 ms.
La file ne fournit pas de verrou entre processus ; cette tranche traite les
écritures concurrentes d'un processus et l'isolation des tests.

### Prévention des motifs voisins

Recherche Code Explorer tentée avant modification, complétée par `rg` exact
et inventaire des attentes suivies d'assertions de compte. L'heuristique globale
renvoie 45 candidats (dont tests d'horloges, de réseau et de débit) :
`_qa/ci-portable/delay-count-candidates.txt`. Ce nombre n'est pas un nombre de bugs.
Les quatre suites voisines corrigées sont :

| Fichier sous `tests/agent/multi-agent/` | Correction | Rejeu final |
| --- | --- | --- |
| `metrics-persistence.test.ts` | Répertoire unique par test, restauration de l'environnement | 20/20 verts |
| `metrics-ttl.test.ts` | Même isolation, suppression du chemin partagé entre `it` | 20/20 verts |
| `fleet-workflow-bridge.test.ts` | Suppression des délais 5/50 ms : diffusion désormais synchrone, promesse du workflow attendue | 20/20 verts |
| `workflow-orchestrator.test.ts` | Suppression du délai 10 ms après la promesse de fin | 20/20 verts |

### macOS et Windows

- `file-search-tool.test.ts` : comparaison des racines temporaires via
  `realpathSync` des deux côtés, y compris le chemin renvoyé par `process.cwd()`.
- `shell-parser-routing.test.ts` : le journal macOS montre 17/17 verts, puis
  un rejet attendu absent au rejeu pour `cmd /c pwsh`. Le code sélectionne
  explicitement le parseur PowerShell depuis le wrapper ; `zsh` n'intervient pas.
  Le test supposait PowerShell indisponible alors qu'il pouvait s'exécuter.
  Le PATH du test d'indisponibilité est maintenant explicitement vide puis
  restauré, sans mock du parseur ni affaiblissement de son refus de sécurité.
  La variation de délai du parseur natif est une explication compatible avec
  le journal, pas une mesure de durée fournie par celui-ci.
- `codebase-rag.test.ts` : le mock `path.join` fabrique des `/`, contrairement
  au chemin natif utilisé par l'écriture. Les attentes utilisent maintenant
  `vi.importActual('node:path')`, `join` et `normalize`, avec un chemin d'index
  construit par composants.

### Garde et vérifications

Trois lignes de règle ajoutées à `CLAUDE.md`, section Testing Gotchas.
`tests/hygiene/test-portability.test.ts` inspecte le code de test ajouté depuis
`HEAD^` (ou `CODEBUDDY_TEST_PORTABILITY_BASE`) et les tests non suivis : chemins
`/tmp/` littéraux et délai suivi d'assertion produisent un avertissement seulement.
Deux cas vérifient le détecteur et son exécution ; aucune règle bloquante ajoutée.

Premier lot ciblé : **8 fichiers, 133 tests verts**. Une tentative intermédiaire
de spy sur un export Node ESM a échoué ; remplacée par l'environnement explicite.
Le premier garde personnel a expiré à 20 s sous vérifications concurrentes ;
son seuil et ses assertions n'ont pas été modifiés. Rejeu isolé : **40/40 verts**,
plus **2/2** pour le garde de portabilité.

- `npx vitest run` des sept fichiers répétés : **20/20 exécutions vertes**, soit
  76 tests par exécution et 1 520 validations. Fichiers : les quatre suites du
  tableau, `persistence-integration.test.ts` (14 cas), `bash-streaming.test.ts`
  et `shell-parser-routing.test.ts`. Journaux `_qa/ci-portable/after-1.json`
  à `after-20.json`, tous `exit_code=0`.
- `TMPDIR` pointant vers `_qa/ci-portable/tmp-alias`, lien vers le tmp isolé :
  recherche de fichiers + RAG **62/62 verts** (`paths5.json`).
- `npm run typecheck` : **exit 0**, y compris GPU identity et companion-core.
- `npm run lint` : **exit 0**, 0 erreur, 2 488 avertissements du dépôt.
- `commitlint` sur le message de tranche : **exit 0**.
- CI native macOS/Windows et prochain run Ubuntu : non exécutés localement.
  Aucun banc d'évaluation ; seules les suites réelles demandées/voisines ont tourné.

Outillage : 16 appels Code Explorer (context/impact/query), 32 commandes via
lm-resizer, 366 601 octets économisés, ultime garde après staging inclus (42/42).
Ce sont des volumes de sortie, pas des tokens facturés. Les deux analyses
(initiale et `--incremental`) ont été arrêtées après plusieurs minutes sans
snapshot exploitable. Les 16 appels ont donc renvoyé explicitement « No graph
snapshot found » ; la lecture ciblée et les recherches exactes ont servi de
repli. Aucun graphe frais n'est revendiqué. Les diffs sensibles et les échecs
ont été relus en brut. Les JSON de mesure restent sous `_qa/ci-portable/`.

Commit de tranche : celui portant cette section, message
`fix(ci): serialize metrics saves and stabilize portable test fixtures`.
Index vide après ce commit ; aucun push.

## Tranche 6 — Windows shard 3 (08/09/2026)

Branche `fix/ci-portable-macos-windows-2026-09-08`, base `e5ecdf47d` (pilote macOS conservé). Un seul commit portant cette section : `fix(ci): correct Windows profile diagnostics and portable test fixtures`. Aucun push, aucun banc d’évaluation, aucun service modifié.

### Inventaire et distinction code / test

Le journal `_qa/ci-portable/ci-windows-run5.log` contient **dix fichiers rouges distincts**, pas onze : neuf à la première passe (lignes 9406–9656), dix à la seconde (10866–11135). Le onzième fichier traité, `tools-core`, provient du triplet local avant correction. Une fixture supplémentaire de manifeste a été corrigée après la vérification scripts. Aucun fichier rouge du journal n’est omis.

| Fichier sous `tests/` | Cause établie | Nature | Correctif et preuve |
| --- | --- | --- | --- |
| `bash-tool.test.ts` | `ls -la` imposé au shell Windows (journal 10866) | Test | `dir` sur Windows, `ls -la` ailleurs, assertion de succès maintenue sans skip. 19/19 localement ; exécution du shell Windows à confirmer en CI native. |
| `backup/gk16-backup.test.ts` | `chmod 0555` ne rend pas un dossier non inscriptible sous Windows (10885) | Test | Un fichier occupe le chemin de sortie : création impossible partout, erreur utilisateur et absence de crash toujours vérifiées. Sonde sans effet du chmod : 1 rouge → vert ; fichier 13/13. |
| `commands/backup-profile.test.ts` | Sortie attendue POSIX ; faux FS ignorant la lettre de lecteur ajoutée par `resolve` (10904, 10927) | Test | Attendu par `path.join`, clés et accès du faux FS normalisés par `path.resolve`. Sonde `path.win32` avec lecteur explicite : les 2 erreurs exactes reproduites → vert ; 27 verts, 1 skip préexistant. Les gardes de restauration du code restent intactes. |
| `companion/lisa-selfie-router.test.ts` | HOME isolé mais USERPROFILE du runner encore actif (10946) | Test | Les deux variables sont posées puis restaurées ; chemin QA natif attendu exactement. `homedir()` piloté par USERPROFILE : 1 rouge → vert ; 18/18. |
| `docs/readme-truth.test.ts` | Exécution directe du shim npm `.bin/tsx`, erreur de spawn masquée en `exit 1`, stderr vide (10981, 11000) | Test | Node explicite (`process.execPath`) + entrée JavaScript résolue par `createRequire(...).resolve('tsx/cli')`, HOME/USERPROFILE QA, message de spawn conservé. Shim réellement non exécutable sur Linux : les 2 tests et les 12 commandes échouent comme dans le journal, puis 4/4 verts sans rétablir le bit exécutable. Mode du fichier local restauré ensuite. |
| `providers/provider-health.test.ts` | Attente 0600 sur les modes synthétiques Windows 0666 (11043) | Test | Contenu JSON vérifié partout ; bits POSIX seulement hors Windows. Sonde stat 0666 : 438 contre 384 reproduit → vert ; 7/7. |
| `security/native-sandbox.test.ts` | `confineSpawn` résout cwd ; assertion comparée au littéral POSIX initial (11062) | Test | Comparaison avec `path.resolve(PROJECT)`, construction pure d’argv toujours exercée partout, sans skip. Sonde `path.win32.resolve` : 1 rouge exact → vert ; 13/13. |
| `skills/skill-importer.test.ts` | HOME seul : import et liste utilisent le vrai USERPROFILE, puis conflit avec l’import précédent (11074, 11093) | Test | HOME et USERPROFILE isolés et restaurés ensemble. Inspection de `skill-importer`, `skill-sources` et de la commande `imported` : chemins déjà construits par `path.join`, comparaison de destination par `path.resolve`, aucune correction de code nécessaire pour ces échecs. Sonde USERPROFILE : 2 rouges exacts → vert ; 19/19. |
| `unit/doctor-fix.test.ts` et `src/doctor/index.ts` | Le diagnostic interprète les modes Windows comme world-writable et propose un chmod trompeur (11115) | **Code** | Après le contrôle réel `accessSync(W_OK)`, Windows n’interprète plus les bits POSIX. Le test initial est conservé ; deux cas Linux/Windows ajoutés sur un profil 0777 : cas Windows rouge avant code → vert après. 21/21, aucun correctif proposé sur Windows ; avertissement POSIX préservé. |
| `companion/reminder-ack-persistence.test.ts` | Attente arbitraire de 40 ms avant de vider la mémoire (10962) | Test | Attente de `whenRemindersPersisted()` avant chaque simulation de crash. Injection d’une latence disque de 150 ms : deux pertes d’ack reproduites → 4/4 verts, y compris l’escalade après redémarrage. Aucun délai fixe dans le test final. |
| `unit/tools-core.test.ts` | Temporaires confinés au clone : deux `..` ne visent plus la racine système ; Git découvre le dépôt parent | Test, triplet local | Traversée relative explicite vers une cible protégée du HOME isolé ; `GIT_CEILING_DIRECTORIES` sur le parent physique des fixtures Git, restauré après chaque test. Les 3 erreurs du triplet avant sont corrigées : 133/133. |

**Vérification supplémentaire :** `tests/scripts/runtime-manifest.test.ts` supposait également qu’un temporaire n’appartenait à aucun dépôt Git. Sous TMPDIR QA, le manifeste obtenait `sourceDirty: false` au lieu de `null`. Plafond Git ajouté uniquement à l’environnement du processus enfant de cette fixture ; assertion exacte conservée. Première passe scripts : 1 rouge ; seconde : **23 fichiers verts, 199 tests verts, 1 skip préexistant**. Aucun correctif supplémentaire de production.

### Inspection du chemin help

`gui` et `install-gui` enregistrent leur aide dans Commander avant leurs actions ; les imports Electron sont dans ces actions et ne sont pas exécutés pour `--help`. `cost` passe par `addLazyCommand`, `doctor` par `loadUtilityCommands`, `improve` par `addLazyCommandGroup`. Inspection des modules chargés et reproduction du lanceur : aucun défaut Windows spécifique démontré dans ces imports. La sonde du shim reproduit aussi les sept autres commandes du journal, ainsi que l’aide racine. Aucune simulation globale de `child_process` n’a été ajoutée.

### Vérifications exécutées

Environnement local : Linux, Node **24.14.1**, Vitest **4.1.9** ; le journal fourni correspond à Windows/Node 22. HOME et USERPROFILE sous `_qa/ci-portable/home`, TMPDIR sous `_qa/ci-portable/tmp`. Les résultats locaux et les sondes pures ne constituent pas une exécution native Windows/Node 22.

- Avant : `npx vitest run tests/unit tests/commands tests/security` → **549 fichiers verts, 1 rouge ; 17 487 verts, 3 rouges, 4 skips**, exit 1. Les trois erreurs sont celles de `tools-core` décrites ci-dessus.
- Après, même triplet → **550 fichiers verts ; 17 492 tests verts, 4 skips**, exit 0. Gain de cinq tests verts : trois réparations et deux nouveaux cas doctor. Aucune régression du triplet.
- Chaque fichier du tableau rejoué séparément par `lm-resizer exec --raw-on-failure --json -- npx vitest run <fichier>` : **11 fichiers verts, 278 tests verts, 1 skip préexistant**. Journaux `t6-file-01.json` à `t6-file-11.json` sous `_qa/ci-portable/`.
- `npx vitest run tests/security/donnees-personnelles.test.ts tests/scripts tests/setup` → **23 fichiers verts, 199 tests verts, 1 skip**, exit 0. Le garde-fou données personnelles reste inchangé.
- `npm run typecheck` → **0**, y compris les projets gpuNode-identity et companion-core.
- ESLint de tous les fichiers TypeScript touchés → **0 erreur**, exit 0 ; 19 avertissements `any` préexistants dans backup-profile. `git diff --check` → 0.
- `npm run validate` demandé par AGENTS.md → **exit 1**, après lint global vert (0 erreur, 2488 warnings), typecheck vert et `check:pack` 10/10. Suite globale : **2090 fichiers verts, 14 rouges, 9 ignorés ; 38 004 tests verts, 29 rouges, 35 skips, 1 todo**. Aucun de ces 14 fichiers n’est modifié dans cette tranche ni inclus dans le triplet demandé. Seize erreurs de `revue-gemini-docs` signalent explicitement l’absence de `dist/index.js`. Les autres concernent `smart-preloader`, `research-script-job-runner`, `structural-gate`, `operational-self-model`, `gk29-intent-drift`, `watchdog-handlers`, `gk29-shadow-write-gate`, `shadow-workspace`, `tools/git-tool`, `lessons-tools`, `ls-tool`, `search-tools-context`, `self-describe` : les traces montrent notamment la découverte du dépôt/package parent depuis TMPDIR QA, des recherches dans une arborescence ignorée et un timeout TypeScript. Ces échecs restent ouverts ; absence de baseline **globale**, donc aucune affirmation de non-régression globale. Le triplet avant/après est, lui, intégralement vert après correction. Journal brut : `_qa/ci-portable/home/lm-resizer/tee/1788861410_npm_run_validate.log`.
- Commitlint : appel direct en échec sur `module.exports` dans la configuration `.js` d’un dépôt ESM ; copie CJS byte-identique sous QA puis `npx commitlint --config _qa/ci-portable/t6-commitlint.config.cjs --edit _qa/ci-portable/t6-commit-message.txt` → **0**, sans modifier les règles.

Les sondes et sorties sont conservées sous `_qa/ci-portable/t6-*` (non suivies). Les sorties brutes des échecs, le triplet après et le diff intégral `t6-review.diff` ont été relus ; aucun succès ne repose uniquement sur un diff résumé. L’injection de latence n’est qu’une sonde du défaut de fixture, pas un banc d’évaluation.

### Outillage et limites

Code Explorer a été interrogé avant modification : 13 paires context/impact, toutes sans snapshot. L’analyse initiale a été arrêtée après plus de huit minutes sans résultat ; deux reconstructions incrémentales complètes bornées à 60 s ont atteint la limite. Les relations ont donc été recherchées par `rg` exact et lecture ciblée ; aucun graphe frais n’est revendiqué.

Incident de harnais : `node_modules` était un lien préexistant vers la copie de travail interdite, découvert dans la trace d’un premier échec de configuration de sonde. Les premiers tests utilisaient donc indirectement ces dépendances partagées et le test README d’origine pouvait y écrire sa fixture. Le lien a été remplacé dans le clone par une copie locale, et les liens exécutables locaux ont été reconstruits depuis les manifestes des paquets. La copie a signalé un lien cyclique transitoire ; deux essais Vitest ont ensuite échoué avant chargement des tests car les lanceurs copiés avaient perdu leurs liens relatifs, puis ont été relancés après réparation. Aucun fichier source de l’autre copie n’a été édité ; toutes les vérifications finales utilisent les dépendances locales. Ces erreurs de harnais sont comptées dans l’outillage, distinctement des preuves rouges utiles.

Outillage : 26 appels Code Explorer (context/impact/query), 43 commandes via lm-resizer, 211 843 octets économisés (volumes de sortie, pas tokens facturés).

Passation : un commit, index vide après commit, aucun push. Restent ouverts : rejeu CI natif Windows/Node 22, 29 échecs de la suite globale supplémentaire, et indexation Code Explorer indisponible.
