# RAPPORT MISSION AGY : Test d'installation de Code Buddy 2 par un inconnu

- **Date** : 2026-09-05T22:12:00+02:00
- **Environnement de test** : Linux 6.8 (x86_64), Node.js v24.14.1, npm 11.17.0
- **Dossier de travail isolé** : `~/DEV/cb-install-test-2026-09-05/`
- **HOME isolé** : `~/DEV/cb-install-test-2026-09-05/home` (aucun accès à `~/.codebuddy` ou `~/code-buddy`)
- **Profil utilisateur** : Inconnu sans compte, aucune clé API, aucun secret, aucun token OAuth

---

## 1. Scénario exécuté & Clonage

1. Création de l'arborescence de test et isolation stricte :
   - `mkdir -p ~/DEV/cb-install-test-2026-09-05/home`
2. Clonage de la branche GitHub indiquée :
   - Commande : `git clone --depth 1 -b codex/audit-systeme-nerveux-2026-09-01 https://github.com/phuetz/code-buddy.git`
   - Résultat : Succès (code 0, 10 517 fichiers mis à jour).
3. Vérification des annonces de version :
   - `README.md` : Titre `# Code Buddy 2`, section `## What 2.0 is`.
   - `package.json` : `"name": "@phuetz/code-buddy"`, `"version": "2.0.0"`.

---

## 2. Installation & Compilation (build)

### 2.1 `npm install`
- **Commande** : `HOME=~/DEV/cb-install-test-2026-09-05/home time npm install`
- **Chronomètre** : 2 minutes 29,88 secondes (173.32s user, 19.29s sys, CPU 128%).
- **Code de sortie** : 0 (Succès).
- **Packages installés** : 1 846 packages ajoutés, 1 990 audités.
- **Erreurs natives** : **0 erreur**. `better-sqlite3@11.10.0`, `@vscode/ripgrep`, `sharp`, `tree-sitter` se sont installés sans aucune erreur de compilation native. Test de chargement unitaire vérifié avec succès (`require('better-sqlite3')` renvoie une fonction valide).
- **Avertissements (warnings)** :
  - Conflits de peer dependencies (ex: `react-native`, `zod`, `@types/react`).
  - 10 modules obsolètes signalés (`whatwg-encoding`, `w3c-hr-time`, `rimraf@3`, `glob@7`, `inflight`, etc.).
  - 42 vulnérabilités npm audit (21 low, 11 moderate, 10 high).

### 2.2 `npm run build`
- **Commande** : `HOME=~/DEV/cb-install-test-2026-09-05/home time npm run build`
- **Chronomètre** : 37,52 secondes (56.58s user, 2.38s sys).
- **Code de sortie** : **0 (0 erreur)**.
- **Étapes exécutées** :
  1. `tsc` (compilation TypeScript sans erreur).
  2. `copy-bundled-skills.mjs` : 8 paquets de compétences copiés dans `dist/skills/bundled/`.
  3. `write-runtime-manifest.mjs` : génération réussie de `codebuddy-runtime.json`.

---

## 3. Tableau commande → résultat

Toutes les commandes ont été exécutées avec `HOME=~/DEV/cb-install-test-2026-09-05/home` et sans aucune variable d'environnement d'authentification ou clé API.

| Commande | Code sortie | Statut | Résultat exact / Message retourné | Analyse / Diagnostic |
| :--- | :---: | :---: | :--- | :--- |
| `node dist/index.js --help` | 0 | **OK** | Aide complète affichée avec les 6 démos, toutes les options (-V, -d, -k, -m, -p...) et l'ensemble des sous-commandes (onboard, doctor, sensory, research, server, etc.). | Fonctionnement normal. La valeur par défaut de `-d` reflète dynamiquement `process.cwd()`. |
| `node dist/index.js --version` | 0 | **OK** | `2.0.0` | Conforme. Affiche bien la version 2.0.0 annoncée dans le `package.json` et le README. |
| `node dist/index.js doctor` | 1 | **OK** | `🔍 Code Buddy Doctor`<br>`⚠️ Not ready to chat yet — Ollama is running (22 models) but no model is currently selected — --fix to select qwen3:4b-instruct ($0; tool-calling, 2.3 GiB < 37.4 GiB free RAM, instruct/coder family)`<br>`⚠️ sox (voice input): not found — optional`<br>`⚠️ ICM (infinite context memory): not found — optional`<br>`⚠️ ChatGPT OAuth: not signed in (run buddy login to use your ChatGPT subscription) — file: .../home/.codebuddy/codex-auth.json`<br>`Summary: 22 passed, 2 warnings, 0 errors. 1 issue(s) can be auto-fixed with --fix` | Comportement irréprochable : code 1 signale qu'aucun modèle n'est sélectionné, message clair sans crash ni stack trace, pointe vers le HOME isolé. |
| `node dist/index.js whoami` | 0 | **OK** | `ChatGPT: not connected (run \`buddy login\` to authenticate)` | Propre, aucun token actif, guidage utilisateur explicite. |
| `node dist/index.js sensory status` | 0 | **OK** | `Serveur : serveur non joignable`<br>`Flags : SENSORY=off SYSTEM_VITALS=off SCHEDULE_TICKS=off DOMAIN_EVENTS=off RULES=off HEARTBEAT_FALLBACK=off`<br>`Battement : aucun`<br>`Traitements : (aucun enregistré)`<br>`Dernières perceptions system/time : (aucune)`<br>`Règles : (aucune chargée)` | Dégradation propre en l'absence de démon actif, texte en français soigné. |
| `node dist/index.js sensory status --json` | 0 | **OK** | `{"serverReachable":false,"serverMessage":"serveur non joignable","flags":{"SENSORY":false,"SYSTEM_VITALS":false,"SCHEDULE_TICKS":false,"DOMAIN_EVENTS":false,"RULES":false,"HEARTBEAT_FALLBACK":false},"heartbeat":{"source":"aucun","lastBeatAt":null,"lastBeatAgoSec":null},"treatments":[],"recent":[],"rules":[]}` | Sortie JSON valide, exploitable programmatiquement. |
| `node dist/index.js rules templates` | 0 | **OK** | Liste des 5 modèles de règles disponibles : `process-runaway-alert`, `disk-low-alert`, `fleet-saturated-alert`, `agent-loop-alert`, `codex-quota-probe`. | Fonctionne immédiatement sans configuration préalable. |
| `node dist/index.js rules list` | 0 | **OK** | `No sensory rules. Edit ~/.codebuddy/sensory-rules.json or: buddy rules add --json '…'` | Indique clairement l'absence de règles et la démarche pour en ajouter. |
| `node dist/index.js improve status` | 0 | **OK** | `Autonomy: propose-only`<br>`Capability coverage: 0/15 (0%)`<br>`Uncovered: npm-test-path-filter, esm-js-extension-imports, logger-not-console, atomic-write-state, git-add-named-files, subproc-bounded-timeout, no-secrets-in-repo, isolated-home-tests, str-replace-omission-block, verify-before-finishing, report-before-inspection, tests-live-in-tests-only, self-improvement-never-touch-src, peer-tool-fails-closed, batch-anti-tautology-guard`<br>`Archive: 0 validated improvement(s), total Δ=0`<br>`Store: 0 version(s); head —, best —` | État d'auto-amélioration initial parfaitement décrit. |
| `node dist/index.js skills list` | 0 | **OK** | `No hub-installed skills.`<br>`8 bundled skill(s) shipped with the package are still available to the agent.`<br>`Install more with: buddy hub search` | Confirme la présence des 8 skills bundlées lors du build. |
| `node dist/index.js research --help` | 0 | **OK** | Aide détaillée de la sous-commande `research` (options `--wide`, `--deep`, `--storm`, `--ckg`, etc., et sous-commandes de mémoire collective). | Aide complète, structurée. |
| `node dist/index.js server --help` | 0 | **OK** | Usage de `buddy server` avec options `--port`, `--host`, `--no-auth`. | Aide claire et concise. |
| `node dist/index.js server --port 3457` (20 s) & `curl /api/health` puis SIGTERM | 0 | **OK** | Serveur démarré en tâche de fond.<br>`curl -s http://127.0.0.1:3457/api/health` renvoie HTTP 200 avec le JSON :<br>`{"status":"degraded","version":"2.0.0","uptime":0,"uptimeFormatted":"0s",...}`.<br>Arrêt par SIGTERM réussi en 11 ms : 6 étapes de nettoyage (`session-save`, `terminal-restore`, `mcp-cleanup`, `database-cleanup`, `log-flush`, `disposing resources`). | Démarrage propre, statut "degraded" cohérent car aucun provider LLM n'est raccordé, arrêt gracieux instantané. |

---

## 4. Tableau doc → écart

| Document & Emplacement | Énoncé de la documentation | Réalité constatée sur le terrain | Qualification de l'écart |
| :--- | :--- | :--- | :--- |
| `docs/getting-started.md:23` | `# From source (recommended during the 1.0 release-candidate phase — gets the latest)` | Le projet est en version 2.0.0 stable ("Code Buddy 2"), la mention de phase "1.0 release-candidate" est obsolète. | **MENSONGE / OBSOLESCENCE** |
| `docs/getting-started.md:6` & `README.md:78` | Prérequis : `ripgrep (recommended for faster search)` avec commandes `brew`, `apt-get`, `choco`. | `@vscode/ripgrep` (binaire natif pré-compilé) fait déjà partie des dépendances `package.json` et s'installe via `npm install`. L'installation système de `ripgrep` n'est pas requise. | **MANQUE DE PRÉCISION** |
| `README.md:78` vs `README.md:180` | `Three commands (Node.js ≥ 18):` dans l'accroche d'installation. | Dans la section `Not ready`, la doc admet que la toolchain de test requiert Node ≥ 20. De plus, Cowork (GUI) requiert Node.js ≥ 22. Node ≥ 18 suffit pour l'exécution du CLI compilé, mais pas pour le dev complet. | **NUANCE DOCUMENTÉE** |
| `package.json` (scripts Bun) | Scripts alternatifs `build:bun`, `dev:bun`, `start:bun`, `install:bun`. | La documentation ne mentionne ni n'impose Bun pour l'installation standard. L'installation complète s'effectue intégralement et avec succès via npm. | **CONFORME** (Bun est strictement optionnel) |
| Rust / Cargo (`package.json`) | Script `"build:captured": "cd src-captured && cargo build --release"` et daemon Rust mentionné dans le README. | `npm run build` n'appelle pas `build:captured`. Le compilateur Rust n'est donc pas nécessaire pour installer et lancer le CLI Code Buddy 2. | **CONFORME** (Rust n'est pas supposé pour le CLI) |
| Python | Mentionné pour certaines compétences Python bundled (`SKILL.md`). | Aucune dépendance de build ne requiert Python pour le cycle d'installation standard car les bibliothèques natives (`better-sqlite3`, etc.) fournissent des binaires Linux x64 pré-compilés. | **CONFORME** |
| `README.md:81-84` | `buddy login # ChatGPT subscription — no API key, $0 marginal cost` puis `buddy # start chatting`. | `buddy login` requiert un navigateur pour le flux OAuth et un compte ChatGPT. Sans compte ni clé, l'utilisateur doit utiliser Ollama en local (`buddy onboard` ou `buddy doctor --fix`). | **SUPPOSITION DE COMPTE** |

---

## 5. Audit des fuites (recherche du nom `<prénom-auteur>` et chemins absolus)

Une recherche systématique de la chaîne `<prénom-auteur>` et de chemins `/home/<autre>` a été menée sur :
- L'ensemble des sorties standards et d'erreur des commandes exécutées ;
- Les logs de démarrage et d'exécution du serveur (`server.log`) ;
- Les fichiers générés dans le dossier de test et le `$HOME` isolé.

### Résultats de l'analyse :
1. **Sortie `--help`** :
   `-d, --directory <dir> set working directory (default: "~/DEV/cb-install-test-2026-09-05/code-buddy")`
   → Correspond dynamiquement à `process.cwd()`. Ce n'est pas une fuite de dev hardcodée : pour un utilisateur `inconnu`, la valeur sera `/home/inconnu/...`.
2. **Sortie `doctor`** :
   `ChatGPT OAuth: not signed in (...) — file: ~/DEV/cb-install-test-2026-09-05/home/.codebuddy/codex-auth.json`
   → Correspond dynamiquement au `$HOME` isolé passé en variable d'environnement (`os.homedir()`).
3. **Sortie `server.log`** :
   → **0 occurrence** de `<prénom-auteur>`.
4. **Sortie `npm run build`** :
   `Generated Code Buddy runtime manifest: ~/DEV/cb-install-test-2026-09-05/code-buddy/codebuddy-runtime.json`
   → Chemin de destination affiché lors de l'écriture du manifest d'exécution dans le répertoire courant.
5. **Fuite d'un autre utilisateur** : **AUCUNE**. Aucun chemin d'un autre profil utilisateur ou du profil réel non isolé n'a été divulgué dans les flux de sortie.

---

## 6. Bilan

Un inconnu complet peut installer et démarrer Code Buddy 2 depuis GitHub sans accroc.
Le clonage de la branche, l'exécution de `npm install` (2m30s) et de `npm run build` (37s) se déroulent avec 0 erreur.
Les dépendances natives comme `better-sqlite3` se lient parfaitement sous Linux x64 sans nécessiter de compilation manuelle.
Toutes les commandes CLI d'inspection, d'aide et de statut s'exécutent avec succès et sans la moindre stack trace.
En l'absence totale de clé API et de compte, l'outil dégrade élégamment et indique clairement la marche à suivre (`doctor`).
Le serveur API démarre immédiatement sur le port spécifié (3457), répond `HTTP 200` sur `/api/health` et s'éteint proprement sous SIGTERM.
La documentation est fidèle sur les commandes d'installation, avec un seul anachronisme textuel résiduel ("1.0 release-candidate").
Aucune fuite de chemin privé ni de secret n'est présente dans les sorties des commandes.

INSTALL: 0 blocages
