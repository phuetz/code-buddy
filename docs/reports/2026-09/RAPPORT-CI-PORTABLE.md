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
