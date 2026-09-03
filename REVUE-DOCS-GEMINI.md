# Revue Gemini G9 : La documentation de Code Buddy dit-elle vrai ?

**Date :** 2026-09-03  
**Branche :** `revue/g9-docs-2026-09-03`  
**Dépôt :** Clone `~/DEV/cb-succes-companion-2026-09-02`  
**Statut :** Revue terminée — Dépôt original `~/code-buddy` strictement intouché, aucune écriture hors du clone, aucune donnée personnelle, aucun service systemd modifié.

---

## 1. Périmètre de la revue

Documents audités en intégralité dans le cadre de la mission :
- [x] `README.md` (tour d'horizon, fonctionnalités, providers, outils, commandes)
- [x] `CLAUDE.md` (tableau complet des variables d'environnement, sections architecture et commandes)
- [x] `docs/getting-started.md` (commandes essentielles, utilitaires intégrés, flux et options)
- [x] `docs/fleet-guide.md` (architecture Fleet, slash commands `/fleet`, RPC, variables d'environnement, autonomie)
- [x] `docs/install.md` (scripts d'installation, variables Node/npm, configuration Docker et ports)
- [x] `docs/cb2/README.md` + l'ensemble des 11 fiches :
  - `docs/cb2/shadow-workspace.md`
  - `docs/cb2/time-travel.md`
  - `docs/cb2/intent-ledger.md`
  - `docs/cb2/ckg-federation.md`
  - `docs/cb2/self-benchmark.md`
  - `docs/cb2/context-zoom.md`
  - `docs/cb2/generative-ui.md`
  - `docs/cb2/perceptive-pair.md`
  - `docs/cb2/skill-exchange.md`
  - `docs/cb2/multi-repo.md`
  - `docs/cb2/web-scrape.md`
- [x] `docs/code-explorer-integration.md` (intégration GitNexus / Code Explorer MCP, autoindex, préfixes)
- [x] `docs/hermes-openclaw-parity.md` (audit de parité Hermes/OpenClaw, commandes de parité, flux de migration)
- [x] `buddy --help` (CLI réel compilé dans `dist/index.js`)

---

## 2. Journal des opérations et commandes exécutées

1. **Création initiale du rapport :**  
   Fichier `REVUE-DOCS-GEMINI.md` initialisé avant toute inspection de code source.
2. **Configuration environnement :**  
   Lien symbolique `node_modules -> ~/code-buddy/node_modules` (pratique standard des clones du projet).
3. **Build de référence :**  
   `npm run build` exécuté avec succès (exit 0) générant `dist/index.js` et les dépendances nécessaires.
4. **Lecture exhaustive du périmètre :**  
   Lecture complète via `view_file` de tous les documents listés ci-dessus.
5. **Inspection du code source :**  
   Vérification systématique par grep et lecture ciblée des déclarations TypeScript et Python (`src/`, `buddy-vision/`, `buddy-memory/`, `install.sh`).
6. **Rédaction et exécution du test de preuve ROUGE :**  
   Création de `tests/docs/revue-gemini-docs.test.ts` matérialisant sous forme d'assertions les promesses de la documentation.  
   Commande : `./node_modules/.bin/vitest run tests/docs/revue-gemini-docs.test.ts` (15 échecs nets / 15 tests, prouvant les fausses déclarations).
7. **Contrôle qualité :**  
   - `npm run typecheck` : 0 erreur (VERT).
   - `npm run lint` : 0 erreur (VERT, warnings préexistants uniquement).
   - Tests ciblés existants : `tests/docs/cowork-public-docs-privacy.test.ts` (13/13 VERT), `tests/docs/public-screenshots.test.ts` (5/5 VERT).
8. **Commits conventionnels par lot :**  
   - Commit 1 : `test(docs): prove documentation discrepancies on CLI defaults, commands, and env vars`
   - Commit 2 : `docs(revue): complete Gemini G9 documentation audit report`

---

## 3. Grille exhaustive d'évaluation des affirmations

### A. Variables d'environnement de `CLAUDE.md`

| # | Affirmation vérifiable | Emplacement (Doc) | Source réelle (fichier:ligne) | Statut / Verdict | Analyse & Proposition de correctif |
|---|------------------------|-------------------|-------------------------------|------------------|------------------------------------|
| 1 | `GROK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` : clés pour providers LLM | `CLAUDE.md:235` | `src/providers/provider-manager.ts:264`, `src/config/env-schema.ts:448` | **VRAI** | Conforme au code. Note : `GOOGLE_API_KEY` est également supporté en alias direct pour Gemini. |
| 2 | `GROK_BASE_URL` / `GROK_MODEL` : override URL et modèle par défaut pour Grok | `CLAUDE.md:236` | `src/codebuddy/providers/provider-openai-compat.ts:28` | **VRAI** | Conforme, pris en compte lors de l'initialisation du client Grok. |
| 3 | `CODEBUDDY_LLM_EXTRA_HEADERS` : JSON headers envoyés à chaque requête LLM | `CLAUDE.md:237` | `src/codebuddy/providers/provider-openai-compat.ts:32` | **VRAI** | Parse le JSON depuis l'environnement et l'injecte dans les requêtes. |
| 4 | `CODEBUDDY_SLACK_BLOCK_KIT` : rendu Block Kit pour Slack | `CLAUDE.md:238` | `src/channels/slack/client.ts:89` | **VRAI** | Condition `process.env.CODEBUDDY_SLACK_BLOCK_KIT === 'true'` active le formatage Block Kit. |
| 5 | `CODEBUDDY_MAX_TOKENS` : surcharge de la limite de tokens de réponse | `CLAUDE.md:239` | `src/codebuddy/client.ts:40`, `src/config/env-schema.ts:136` | **VRAI** | Pris en compte comme Number pour dimensionner les tokens de sortie. |
| 6 | `CODEBUDDY_AUTOCOMPACT_PCT` : seuil d'auto-compactage en % du contexte | `CLAUDE.md:240` | `src/context/context-manager-v2.ts:182`, `src/context/auto-compact-threshold.ts:12` | **VRAI** | Surcharge le pourcentage par défaut (~85%) de compactage contextuel. |
| 7 | `MORPH_API_KEY` : clé pour fast apply via Morph | `CLAUDE.md:241` | `src/config/env-schema.ts:120`, `src/tools/apply-patch.ts:45` | **VRAI** | Active le moteur Morph quand présent. |
| 8 | `YOLO_MODE` / `MAX_COST` : pleine autonomie ($10 défaut, $100 YOLO) | `CLAUDE.md:242` | `src/agent/codebuddy-agent.ts:131, 145`, `src/commands/handlers/missing-handlers.ts:925` | **IMPRÉCIS** | Les budgets ($10 défaut, $100 YOLO) sont exacts. Cependant, définir `YOLO_MODE=true` seul dans l'environnement ne suffit pas à passer `CodeBuddyAgent` en YOLO (un warning invite à faire `/yolo on` ou `--yolo`). **Correctif doc :** préciser qu'un flag CLI `--yolo` ou la commande slash `/yolo on` est requis pour armer l'agent. |
| 9 | `JWT_SECRET` : secret d'authentification pour le serveur | `CLAUDE.md:243` | `src/server/auth/jwt-service.ts:25`, `src/server/index.ts:120` | **VRAI** | Secret requis pour signer/vérifier les tokens API en production. |
| 10 | `OLLAMA_HOST` / `VLLM_BASE_URL` : hôtes locaux Ollama / vLLM | `CLAUDE.md:244` | `src/fleet/peer-chat-client-factory.ts:15`, `src/providers/ollama-provider.ts:32` | **VRAI** | Auto-détecté en priorité 2 dans Fleet et utilisé pour les requêtes locales. |
| 11 | `CODEBUDDY_BROWSER_DEV_ORIGINS` : origines permises pour le pont navigateur | `CLAUDE.md:245` | `src/security/dev-origins.ts:15` | **VRAI** | Liste CSV d'origines de développement autorisées. |
| 12 | `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` : racine obligatoire pour `peer.tool.invoke` | `CLAUDE.md:246` | `src/fleet/peer-tool-bridge.ts:67, 83` | **VRAI** | Comportement fail-closed rigoureux : si absent, toute invocation distante renvoie `PEER_WORKSPACE_NOT_CONFIGURED`. |
| 13 | `CODEBUDDY_PEER_TOOL_ALLOWLIST` : surcharge CSV de la liste d'outils autorisés | `CLAUDE.md:247` | `src/fleet/permissions.ts:3, 9` | **VRAI** | Valeur par défaut : `view_file,list_directory,search`. Surchargeable par CSV. |
| 14 | `CODEBUDDY_PEER_SESSION_IDLE_MS` / `CODEBUDDY_PEER_MAX_DEPTH` / `CODEBUDDY_PEER_ROLE` : limites Fleet | `CLAUDE.md:248` | `src/fleet/peer-session-bridge.ts:270` (défaut 30 min), `src/server/websocket/peer-rpc.ts:110` (défaut 3), `src/server/websocket/peer-rpc.ts:120` (défaut `main`) | **VRAI** | Conforme point par point au code. |
| 15 | `CODEBUDDY_FLEET_MAX_CONCURRENCY` : capacité du pair Fleet pour métrique d'utilisation | `CLAUDE.md:249` | `src/fleet/fleet-load.ts:55`, `src/daemon/autonomous-loop.ts:258` | **VRAI** | Utilisé dans le calcul de charge et le refus de tâche si saturé. |
| 16 | `CODEBUDDY_COUNCIL_ROUTING` : arbitrage du conseil des modèles (opt-in) | `CLAUDE.md:250` | `src/agent/facades/model-routing-facade.ts:155` | **VRAI** | Strictement opt-in (`process.env.CODEBUDDY_COUNCIL_ROUTING === 'true'`). |
| 17 | `CODEBUDDY_COUNCIL_TIMEOUT_MS` / `_EXPLORE` / `_POOL` : réglages du conseil | `CLAUDE.md:251` | `src/council/council-engine.ts:59` (défaut 45000), `src/council/council-engine.ts:64` (défaut 0.1), `src/providers/active-llm-model-pool.ts:106` (défaut `full`) | **VRAI** | Conforme au code. |
| 18 | `FINNHUB_API_KEY` et URLs de base boursières (`CODEBUDDY_YAHOO_FINANCE_BASE`, etc.) | `CLAUDE.md:253` | `src/tools/stock-quote.ts:491-497` | **VRAI** | Toutes les variables d'URL de base boursières existent et sont lues dans le constructeur. |
| 19 | `SEARXNG_URL` : URL d'instance SearXNG pour recherche locale | `CLAUDE.md:254` | `src/tools/web-search.ts:296` | **VRAI** | Normalisée et insérée en tête de chaîne de recherche quand configurée. |
| 20 | `CODEBUDDY_SPEECH_ENGINE` / `CODEBUDDY_SPEECH_FALLBACK` : moteurs STT | `CLAUDE.md:256` | `src/sensory/speech-engine-config.ts:43-48`, `src/sensory/speech-reaction.ts:526` | **VRAI** | Moteurs : `sherpa-rs`, `parakeet`, `faster-whisper` (défaut), `auto`. Fallback actif sauf si `false`. |
| 21 | `CODEBUDDY_SPEECH_STT_BIN` / `BUDDY_SENSE_STT_MODEL_DIR` / `BUDDY_SENSE_STT_THREADS` : surcharge binaire STT, dossier Parakeet et threads | `CLAUDE.md:257` | `src/sensory/speech-reaction.ts:537, 557`, `src/sensory/speech-engine-config.ts:110-112` | **FAUX / OBSOLÈTE** | `CODEBUDDY_SPEECH_STT_BIN` est bien lu. Mais le code TypeScript ne lit **JAMAIS** `BUDDY_SENSE_STT_MODEL_DIR` ni `BUDDY_SENSE_STT_THREADS` de l'environnement utilisateur ! Il lit `CODEBUDDY_PARAKEET_MODEL_DIR` (ou `CODEBUDDY_SHERPA_ONNX_MODEL_DIR`) pour le dossier, et `CODEBUDDY_SPEECH_STT_THREADS` (ou `CODEBUDDY_SPEECH_THREADS`) pour les threads, puis transmet ces valeurs comme variables d'environnement au sous-processus `buddy-sense stt`. **Prouvé ROUGE par test.** **Correctif doc :** remplacer `BUDDY_SENSE_STT_MODEL_DIR` par `CODEBUDDY_PARAKEET_MODEL_DIR` et `BUDDY_SENSE_STT_THREADS` par `CODEBUDDY_SPEECH_STT_THREADS`. |
| 22 | `CODEBUDDY_SENSORY_SPEAK_ROUTE_TTL_MS` : TTL cache de routage vocal (défaut 60000) | `CLAUDE.md:263` | `src/sensory/voice-loop.ts:1062-1064` | **VRAI** | Défaut 60_000 ms respecté. |
| 23 | `CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE` : posture ACT voix (défaut `plan`) | `CLAUDE.md:265` | `src/sensory/voice-loop.ts:429`, `src/companion/assistant-config.ts:253, 936` | **OBSOLÈTE** | Le code actuel a pour défaut `'default'` (posture gardée asynchrone). La posture `'plan'` était un ancien défaut historique qui est même automatiquement migré vers `'default'` par `assistant-config.ts`. `README.md:475` donne la bonne valeur, mais le tableau de `CLAUDE.md` est obsolète. **Prouvé ROUGE par test.** **Correctif doc :** corriger le défaut en `default` dans `CLAUDE.md`. |
| 24 | `CODEBUDDY_ROBOT_NAME` / `CODEBUDDY_USER_NAME` : noms de l'assistant et de l'utilisateur | `CLAUDE.md:268, 269` | `src/sensory/respond-decider.ts:114, 584`, `src/sensory/speech-reaction.ts:184` | **VRAI** | Utilisés pour la détection d'adresse et l'injection de personnalité. |
| 25 | `CODEBUDDY_SENSORY_GREET_LLM` / `_TIMEOUT_MS` : accueil caméra LLM (défaut 4000 ms) | `CLAUDE.md:270` | `src/sensory/arrival-opener.ts:229` | **VRAI** | Variable exacte : `CODEBUDDY_SENSORY_GREET_LLM_TIMEOUT_MS`, défaut 4000 ms. |
| 26 | `CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS` : fenêtre d'attention continue (défaut 30000) | `CLAUDE.md:271` | `src/sensory/respond-decider.ts:511`, `src/companion/assistant-config.ts:436` | **FAUX / OBSOLÈTE** | Le code réel applique un défaut de `120000` ms (2 minutes) et non `30000` ms (30 s). **Prouvé ROUGE par test.** **Correctif doc :** corriger la valeur par défaut à 120000 ms. |
| 27 | `CODEBUDDY_SENSORY_AEC_TRUST` : confiance en l'AEC matériel (défaut false) | `CLAUDE.md:273` | `src/sensory/voice-activity.ts:19` | **VRAI** | Défaut false respecté. |
| 28 | `BUDDY_VISION_PERSON_LOST_SECS` / `CODEBUDDY_SENSORY_REGREET_MIN_MS` : hystérésis présence (20 s / 300000 ms) | `CLAUDE.md:274` | `buddy-vision/watch.py:307`, `src/sensory/semantic-vision-reaction.ts:67` | **VRAI** | Valeurs exactes (20 secondes dans l'œil, 300 000 ms dans le cerveau). |
| 29 | `BUDDY_VISION_MIN_LUMA` / `CODEBUDDY_VISION_MAX_ANALYSES_PER_MIN` : seuil luma 12 et max 4 analyses/min | `CLAUDE.md:275` | `buddy-vision/watch.py:39`, `src/sensory/vision-reaction.ts:25, 183` | **VRAI** | Valeurs exactes (12 pour le floor luma, 4 analyses/min max pour le VLM). |
| 30 | `CODEBUDDY_REMINDER_ACK_WINDOW_MS` : fenêtre d'acquittement rappel (défaut 300000 ms) | `CLAUDE.md:279` | `src/companion/reminders.ts:328` | **VRAI** | Défaut 300_000 ms (5 min). |
| 31 | `CODEBUDDY_COMPANION_PROACTIVE` / `_MIN_GAP_MS` : moteur proactif et plancher conducteur | `CLAUDE.md:281` | `src/companion/orchestrator.ts:34` | **IMPRÉCIS / FAUX** | La variable lue par le code pour le plancher est `CODEBUDDY_COMPANION_MIN_GAP_MS` et non `CODEBUDDY_COMPANION_PROACTIVE_MIN_GAP_MS`. La notation abrégée `_MIN_GAP_MS` sous `CODEBUDDY_COMPANION_PROACTIVE` induit en erreur car le préfixe n'est pas conservé. **Correctif doc :** nommer explicitement `CODEBUDDY_COMPANION_MIN_GAP_MS`. |
| 32 | `CODEBUDDY_EPISODE_JOURNAL` / `_EPISODE_EVERY` : journal épisodique (défaut 40 battements) | `CLAUDE.md:282` | `src/server/index.ts:1907-1908` | **VRAI** | Variable réelle : `CODEBUDDY_EPISODE_EVERY`, défaut 40. |
| 33 | `CODEBUDDY_MEMORY_FORGET` / `_BASE_DAYS` / `_THRESHOLD` / `_MIN_AGE_DAYS` : courbe d'oubli Ebbinghaus | `CLAUDE.md:283` | `src/memory/memory-forgetting.ts:59-62` | **VRAI** | Défauts : 14 jours, 0.05, 7 jours. Conforme. |
| 34 | `CODEBUDDY_REMINDER_RENAG_MS` / `_RENAG_MAX` : renag rappels (défaut 60000 ms / 2) | `CLAUDE.md:285` | `src/companion/reminder-runner.ts:51, 56` | **VRAI** | Défauts : 60_000 ms et 2. Conforme. |
| 35 | `CODEBUDDY_REMINDER_TICK_MS` : intervalle de scrutation rappels (défaut 60000 ms) | `CLAUDE.md:286` | `src/companion/reminder-runner.ts:203` | **VRAI** | Défaut 60_000 ms. Conforme. |
| 36 | `CODEBUDDY_SENSORY_RULES_FILE` / `CODEBUDDY_RULE_RUNS_FILE` : fichiers de règles sensorielles | `CLAUDE.md:287` | `src/sensory/sensory-rules-engine.ts:39, 42` | **VRAI** | Conforme au code. |
| 37 | `CODEBUDDY_TTS_VOICE` / `CODEBUDDY_TTS_PIPER_MODEL` : modèle vocal Piper ou ElevenLabs | `CLAUDE.md:288` | `src/companion/companion-mode.ts:787`, `src/sensory/voice-loop.ts:452` | **VRAI** | Reconnus tous les deux. |
| 38 | `CODEBUDDY_ELEVENLABS_MODEL` / `_STABILITY` / `_SIMILARITY` / `_STYLE` / `_SPEAKER_BOOST` / `_SPEED` / `_MONTHLY_CAP` | `CLAUDE.md:289-291` | `src/voice/elevenlabs-voice.ts:67-74, 228, 408` | **VRAI** | Bornes et défauts conformes (`eleven_flash_v2_5`, cap 200 000). |
| 39 | `OMNIPARSER_API_URL` / `OMNIPARSER_API_KEY` : serveur OmniParser (défaut `http://localhost:8000`) | `CLAUDE.md:292` | `src/desktop-automation/omniparser-runner.ts:63-65` | **VRAI** | Conforme. |
| 40 | `CODEBUDDY_DIFF_REVIEW` / `_REVISE` / `_REVISE_ROUNDS` : porte de révision de diff (défaut 2 rounds) | `CLAUDE.md:293` | `src/review/write-gate.ts:54-56` | **VRAI** | Défaut 2 rounds respecté. |
| 41 | `CODEBUDDY_COLLECTIVE_MEMORY` : activation CKG en contexte et Deep Research | `CLAUDE.md:294` | `src/agent/deep-research-ckg.ts:351`, `src/server/routes/memory.ts` | **VRAI** | Conforme. |
| 42 | `CODEBUDDY_CKG_ENGINE` / `CODEBUDDY_BUDDY_MEMORY_BIN` : pont moteur Rust buddy-memory | `CLAUDE.md:295, 296` | `src/memory/collective-knowledge-graph.ts:300`, `src/memory/buddy-memory-client.ts:38` | **VRAI** | Conforme. |
| 43 | `BUDDY_MEMORY_EMBED_MODEL` / `BUDDY_MEMORY_EMBED_TOKEN_TYPE` : embedding pour recall CKG | `CLAUDE.md:297` | `buddy-memory/src/store.rs:638, 648` | **VRAI** | Lus et gérés directement par le binaire Rust `buddy-memory`. |

---

### B. Options CLI et Comportements d'exécution (`CLAUDE.md`, `README.md`, `getting-started.md`)

| # | Affirmation vérifiable | Emplacement (Doc) | Source réelle (fichier:ligne) | Statut / Verdict | Analyse & Proposition de correctif |
|---|------------------------|-------------------|-------------------------------|------------------|------------------------------------|
| 44 | Limite d'appels d'outils : max 50 en standard, 400 en YOLO | `CLAUDE.md:50`, `docs/getting-started.md:298` | `src/index.ts:1373, 1456, 1470`, `src/agent/codebuddy-agent.ts:141` | **FAUX / OBSOLÈTE** | Commander déclare l'option `--max-tool-rounds <rounds>` avec un défaut de `"400"` (`src/index.ts:1373`). Lors d'une invocation CLI normale, `options.maxToolRounds` vaut `"400"` et est passé à `CodeBuddyAgent`, écrasant le fallback interne de 50. Tout lancement CLI standard a donc une limite de 400 rounds, et non 50 ! **Prouvé ROUGE par test.** **Correctif doc :** documenter que le CLI applique par défaut 400 rounds, ou corriger la valeur par défaut de l'option Commander à 50. |
| 45 | Option CLI `--continue` pour reprendre la dernière session | `docs/getting-started.md:234` | `src/index.ts:1419` | **VRAI** | Option root `--continue` présente et fonctionnelle. |
| 46 | Option CLI `--resume <sessionId>` pour reprendre une session | `docs/getting-started.md:237` | `src/index.ts:1423` | **VRAI** | Option root présente et fonctionnelle. |
| 47 | Option CLI `--search-sessions <query>` pour chercher des sessions | `docs/getting-started.md:240` | `src/index.ts:1427` | **VRAI** | Option root présente. |
| 48 | Option CLI `--max-price <dollars>` pour limiter le coût | `docs/getting-started.md:243` | `src/index.ts:1431` | **VRAI** | Option root présente. |
| 49 | Option CLI `--vim` pour activer les keybindings Vim | `docs/getting-started.md:99` | `src/index.ts:1435` | **VRAI** | Présente dans Commander et fonctionnelle. |
| 50 | Option CLI `--setup` pour lancer l'assistant de configuration | `docs/getting-started.md:100, 258` | `src/index.ts:1439` | **VRAI** | Option root `--setup` présente. |
| 51 | Option CLI `--init` pour initialiser la configuration locale | `docs/getting-started.md:102` | `src/index.ts:1443` | **VRAI** | Option root `--init` présente. |
| 52 | `CODEBUDDY_LLM_FAILOVER=1` : bascule automatique de LLM en cas d'erreur | `README.md:259` | `src/index.ts:168` | **VRAI** | Conforme au code. |
| 53 | `CODEBUDDY_STREAM_RETRY=1` : retentatives exponentielles du streaming (4 max) | `docs/getting-started.md:480` | `src/codebuddy/client.ts:32` | **VRAI** | Conforme au code. |
| 54 | `CODEBUDDY_MAX_CONTEXT` surcharge la taille de contexte pour tous les consommateurs | `CLAUDE.md:77` | `src/config/model-tools.ts:1174` | **VRAI** | Conforme au code. |
| 55 | `CODEBUDDY_SESSION_PAUSE_HOURS` (12 h) suggère une pause | `CLAUDE.md:87` | `src/agent/middleware/session-duration.ts:33` | **VRAI** | Conforme au code (défaut 12 h). |
| 56 | `CODEBUDDY_SELF_IMPROVE` (opt-in `true` propose, `auto-apply` applique) | `CLAUDE.md:109` | `src/agent/self-improvement/engine.ts:39` | **VRAI** | Conforme au code. |
| 57 | `BUDDY_EAR_DEVICE=auto` sélectionne automatiquement le micro webcam/USB via ALSA | `README.md:475` | `buddy-vision/ear.py:43` | **VRAI** | Conforme au code Python. |

---

### C. Commandes et Sous-commandes CLI documentées

| # | Affirmation vérifiable | Emplacement (Doc) | Source réelle (fichier:ligne) | Statut / Verdict | Analyse & Proposition de correctif |
|---|------------------------|-------------------|-------------------------------|------------------|------------------------------------|
| 58 | `buddy fleet tasks add "<title>" --goal-mode` | `docs/fleet-guide.md:850`, `hermes-openclaw-parity.md:134` | `src/commands/cli/fleet-commands.ts`, `src/commands/cli/native-engine-commands.ts:1171` | **FAUX** | La sous-commande `tasks` n'existe **PAS** sous `buddy fleet` (`error: unknown command 'tasks'`). Elle se trouve sous `buddy autonomy tasks` (ou son alias `buddy colab tasks`). **Prouvé ROUGE par test.** **Correctif doc :** remplacer `buddy fleet tasks add` par `buddy autonomy tasks add`. |
| 59 | `buddy dev explain <file>` : trace pas à pas du fonctionnement d'une commande | `docs/getting-started.md:118` | `src/commands/dev/index.ts:420-422` | **FAUX** | `buddy dev explain` ne prend **AUCUN** argument `<file>` et ne fait pas de trace de commande : il rafraîchit le profil du dépôt courant et demande à l'agent d'en résumer conventions, structure et chemins critiques. **Prouvé par inspection.** **Correctif doc :** documenter `buddy dev explain` sans paramètre comme résumé d'architecture du dépôt. |
| 60 | `buddy explain <file>` : visite architecturale d'un fichier quelconque | `docs/getting-started.md:117` | `src/commands/explain.ts:16` | **FAUX / IMPRÉCIS** | `buddy explain` prend un `[chemin]` (dossier du dépôt, défaut `.`) pour produire une analyse complète d'un dépôt inconnu en Markdown/HTML, et non l'analyse d'un fichier unitaire. **Correctif doc :** documenter `buddy explain [dossier]` pour l'analyse d'un dépôt. |
| 61 | `buddy import` : importe la mémoire et l'historique depuis Claude Code | `docs/getting-started.md:116` | `src/commands/import.ts:1-60` | **FAUX** | `buddy import` n'importe pas d'historique ou de mémoire : il découvre et importe les règles concurrentes (`.cursorrules`, `.windsurfrules`, `.clinerules`) et les configurations de serveurs MCP (`.cursor/mcp.json`, etc.). **Correctif doc :** corriger le tableau pour indiquer l'import de règles et serveurs MCP concurrents. |
| 62 | `buddy nodes list\|status\|approve\|reject` | `CLAUDE.md:334` | `src/commands/cli/native-engine-commands.ts` (`nodes`) | **FAUX** | Les sous-commandes réelles sont `list`, `pair`, `approve`, `describe`, `remove`, `invoke`, `pending`. Ni `status` ni `reject` n'existent sous `buddy nodes` (`error: unknown command 'reject'`). **Prouvé ROUGE par test.** **Correctif doc :** documenter `buddy nodes list\|pair\|approve\|describe\|remove\|invoke\|pending`. |
| 63 | `buddy todo [list\|add\|complete]` | `CLAUDE.md:333` | `src/commands/todo.ts` | **FAUX** | La sous-commande pour marquer une tâche comme faite est `done <id>`, et non `complete` (`error: unknown command 'complete'`). **Prouvé ROUGE par test.** **Correctif doc :** remplacer `complete` par `done`. |
| 64 | `buddy secrets list\|set\|delete` | `CLAUDE.md:335` | `src/commands/cli/secrets-command.ts` | **FAUX** | La sous-commande de suppression est `remove <name>`, et non `delete` (`error: unknown command 'delete'`). **Prouvé ROUGE par test.** **Correctif doc :** remplacer `delete` par `remove`. |
| 65 | `buddy approvals list\|revoke\|grant` | `CLAUDE.md:336` | `src/commands/approvals.ts` | **FAUX** | Les sous-commandes sont `list`, `approve <id>`, `deny <id>`, `policy`. Ni `revoke` ni `grant` n'existent (`error: unknown command 'revoke'`). **Prouvé ROUGE par test.** **Correctif doc :** documenter `buddy approvals list\|approve\|deny\|policy`. |
| 66 | `buddy tunnel [start\|stop\|status]` | `CLAUDE.md:343` | `src/index.ts`, `src/commands/tunnel.ts` | **FAUX** | Seule la sous-commande `start` existe sous `buddy tunnel`. `stop` et `status` n'existent pas (`error: unknown command 'stop'`). **Prouvé ROUGE par test.** **Correctif doc :** documenter uniquement `buddy tunnel start`. |
| 67 | `buddy completions [install\|uninstall]` | `CLAUDE.md:345` | `src/commands/completions.ts` | **FAUX** | L'argument shell accepte `bash`, `zsh`, `fish`, `powershell`, ou `install`. `uninstall` est rejeté comme non supporté (`Unsupported shell: uninstall`). **Prouvé ROUGE par test.** **Correctif doc :** retirer `uninstall` de la documentation. |
| 68 | `buddy lsp [start\|status\|stop]` | `CLAUDE.md:344` | `src/index.ts`, `src/commands/lsp.ts` | **FAUX** | Les sous-commandes réelles sont `status` et `diagnostics <file>`. `start` et `stop` n'existent pas (`error: unknown command 'start'`). **Prouvé ROUGE par test.** **Correctif doc :** documenter `buddy lsp status` et `buddy lsp diagnostics <file>`. |
| 69 | `buddy deploy [init\|preview\|apply]` | `CLAUDE.md:345` | `src/index.ts`, `src/commands/deploy.ts` | **FAUX** | Les sous-commandes sont `platforms`, `init <platform>`, `nix`. `preview` et `apply` n'existent pas (`error: unknown command 'preview'`). **Prouvé ROUGE par test.** **Correctif doc :** documenter `buddy deploy platforms\|init\|nix`. |
| 70 | `buddy execpolicy [check\|list\|clear]` | `CLAUDE.md:333` | `src/commands/execpolicy.ts` | **FAUX** | Les sous-commandes réelles sont `check`, `check-argv`, `list`, `list-prefix`, `add-prefix`, `show-dangerous`, `dashboard`. `clear` n'existe pas (`error: unknown command 'clear'`). **Prouvé ROUGE par test.** **Correctif doc :** retirer `clear` de la documentation. |
| 71 | `buddy proxy [start\|stop\|status\|logs]` | `CLAUDE.md:344` | `src/index.ts` | **FAUX** | `buddy proxy` est une commande directe avec options (`--port`, `--host`, etc.), non un gestionnaire à sous-commandes `start/stop/status/logs`. **Correctif doc :** documenter `buddy proxy [options]`. |
| 72 | `buddy cloud [status\|sync]` | `CLAUDE.md:345` | `src/commands/cloud.ts` | **FAUX** | Les sous-commandes sont `submit`, `status`, `list`, `cancel`, `logs`, `delete`. `sync` n'existe pas. **Correctif doc :** documenter `buddy cloud submit\|status\|list\|cancel\|logs\|delete`. |
| 73 | `buddy bundles list\|pack\|unpack\|verify` | `CLAUDE.md:338` | `src/commands/bundles.ts` | **FAUX** | Les sous-commandes sont `list`, `create`, `show`, `remove`. `pack`, `unpack` et `verify` n'existent pas. **Correctif doc :** documenter `buddy bundles list\|create\|show\|remove`. |
| 74 | `buddy desktop [start\|install]` | `CLAUDE.md:347` | `src/index.ts` | **FAUX** | `buddy desktop` est un simple alias direct de `buddy gui` avec options `--dev` et `--detach`. **Correctif doc :** documenter `buddy desktop [options]`. |
| 75 | `buddy mcp serve` (ou `buddy mcp-server`) | `README.md:446, 463` | `src/commands/mcp.ts:16`, `src/mcp/mcp-server.ts:1` | **VRAI** | Les deux formes existent (la commande `mcp-server` servant d'alias rétrocompatible). |
| 76 | `buddy film generate\|assemble\|status <name>` | `CLAUDE.md:337` | `src/commands/film.ts` | **VRAI** | Conforme au code. |
| 77 | `buddy session list\|search\|resume\|last` | `CLAUDE.md:332`, `docs/getting-started.md:220` | `src/commands/session.ts` | **VRAI** | Conforme au code. |
| 78 | `buddy backup create\|verify\|list\|restore` | `CLAUDE.md:339` | `src/commands/backup.ts` | **VRAI** | Conforme au code. |
| 79 | `buddy doctor [--fix]` | `CLAUDE.md:330` | `src/commands/doctor.ts` | **VRAI** | Conforme au code. |

---

### D. Innovations CB2 (`docs/cb2/README.md` et fiches)

| # | Affirmation vérifiable | Emplacement (Doc) | Source réelle (fichier:ligne) | Statut / Verdict | Analyse & Proposition de correctif |
|---|------------------------|-------------------|-------------------------------|------------------|------------------------------------|
| 80 | `CODEBUDDY_SHADOW_WORKSPACE=true`, `buddy shadow status\|run`, timeout 120000 ms | `docs/cb2/README.md:13`, `shadow-workspace.md` | `src/speculative/shadow-workspace.ts:63, 119` | **VRAI** | Variable et commandes conformes, timeout 120000 ms. |
| 81 | `CODEBUDDY_TIMELINE=true`, `buddy replay <sessionId> [--at N] [--fork id]` | `docs/cb2/README.md:14`, `time-travel.md` | `src/agent/codebuddy-agent.ts:274`, `src/commands/replay.ts` | **VRAI** | Variable et options `--at`, `--fork` conformes. |
| 82 | `CODEBUDDY_INTENTS=true`, `buddy intents new\|list\|show\|check\|done\|drift\|archive`, timeout 120000 ms | `docs/cb2/README.md:15`, `intent-ledger.md` | `src/commands/intents.ts:16`, `src/intents/intent-checker.ts:50` | **VRAI** | Variable et toutes les sous-commandes conformes. |
| 83 | `CODEBUDDY_CKG_SYNC=true`, types `lesson,fact`, max 1000, `buddy research sync <peer>` | `docs/cb2/README.md:16`, `ckg-federation.md` | `src/fleet/peer-ckg-bridge.ts:301, 309, 350`, `src/commands/research/index.ts` | **VRAI** | Conforme au code. |
| 84 | `CODEBUDDY_SELF_BENCH=true`, `buddy improve bench`, seuil drop 0.15, timeout 60000 ms | `docs/cb2/README.md:17`, `self-benchmark.md` | `src/agent/self-improvement/continuous-benchmark.ts:138, 393, 398` | **VRAI** | Conforme au code. |
| 85 | `CODEBUDDY_CONTEXT_ZOOM=true`, max MB 200 | `docs/cb2/README.md:18`, `context-zoom.md` | `src/context/segment-archive.ts:44, 226` | **VRAI** | Outil `context_expand` et limite 200 MB conformes. |
| 86 | `CODEBUDDY_WIDGETS_AUTO=true` (+ `CODEBUDDY_WIDGETS=true`), `buddy widgets stats` | `docs/cb2/README.md:19`, `generative-ui.md` | `src/widgets/auto-widget.ts:43`, `src/commands/widgets.ts` | **VRAI** | Conforme au code. |
| 87 | `CODEBUDDY_WIDGETS_AUTOGEN` (défaut off) autorise la génération LLM | `docs/cb2/README.md:19`, `generative-ui.md:17` | `src/widgets/widget-engine.ts:163` | **OBSOLÈTE / FAUX** | La variable `CODEBUDDY_WIDGETS_AUTOGEN` n'existe nulle part dans le code TypeScript. Le moteur de widgets conditionne la génération uniquement à `CODEBUDDY_WIDGETS === 'true'`. **Prouvé ROUGE par test.** **Correctif doc :** retirer `CODEBUDDY_WIDGETS_AUTOGEN` de la documentation. |
| 88 | `CODEBUDDY_SENSORY_ERRORWATCH=true` (+ `CODEBUDDY_SENSORY`), debounce 120000 ms, max 4/h | `docs/cb2/README.md:20`, `perceptive-pair.md` | `src/sensory/error-watch-reaction.ts:258, 268, 273` | **VRAI** | Conforme au code. |
| 89 | `CODEBUDDY_SKILL_EXCHANGE=true`, `buddy skills exchange export\|verify\|install\|keys` | `docs/cb2/README.md:21`, `skill-exchange.md` | `src/skills/skill-exchange.ts:27`, `src/commands/skills-exchange.ts` | **VRAI** | Variable et sous-commandes conformes. |
| 90 | `CODEBUDDY_WORKSPACE=true`, `buddy ws list\|add\|rm\|search`, timeout 30000 ms, max 512 KB | `docs/cb2/README.md:22`, `multi-repo.md` | `src/workspace/workspace-config.ts:200`, `src/tools/workspace-tools.ts:138, 313` | **VRAI** | Variable et commandes conformes. |
| 91 | `buddy scrape --setup\|--check\|--browsers`, `CODEBUDDY_SCRAPLING_TIMEOUT_MS` (60000 ms) | `docs/cb2/web-scrape.md:13, 60` | `src/commands/scrape.ts`, `src/tools/web-scrape-tool.ts:311` | **VRAI** | Options et timeout par défaut conformes. |

---

### E. Fleet Guide, Installation, Code Explorer & Hermes

| # | Affirmation vérifiable | Emplacement (Doc) | Source réelle (fichier:ligne) | Statut / Verdict | Analyse & Proposition de correctif |
|---|------------------------|-------------------|-------------------------------|------------------|------------------------------------|
| 92 | Commandes slash `/fleet listen`, `stop`, `status`, `history`, `describe`, `send`, `tool`, `route` | `docs/fleet-guide.md:670-682` | `src/commands/handlers/fleet-handler.ts:75-120` | **VRAI** | Toutes les actions de commande slash existent et fonctionnent comme documenté. |
| 93 | Auto-détection des providers Fleet (Ollama → OAuth → Gemini CLI → Grok → Claude → Gemini → GPT) | `docs/fleet-guide.md:527-545` | `src/fleet/peer-chat-client-factory.ts:15-25` | **VRAI** | Ordre de priorité scrupuleusement respecté dans l'implémentation. |
| 94 | Ports et variables Docker (`3000:3000`, `ghcr.io/codebuddy/codebuddy:latest`) | `docs/install.md:85-115` | `src/server/index.ts:12` | **VRAI** | Port par défaut du serveur est bien 3000. |
| 95 | Variables du script `install.sh` : `CODEBUDDY_NODE_VERSION` (défaut 20.18.1), `CODEBUDDY_MIN_NODE_MAJOR` (20), `CODEBUDDY_HOME` | `docs/install.md:48-53` | `install.sh:27-28`, `src/utils/codebuddy-home.ts:46` | **VRAI** | Conforme au script bash `install.sh`. |
| 96 | Code Explorer : `CODEBUDDY_DISABLE_MCP=false` pour activer MCP en mode headless `-p` | `docs/code-explorer-integration.md:61` | `src/index.ts:400` | **VRAI** | Le code initialise `CODEBUDDY_DISABLE_MCP = 'true'` par défaut en mode headless si non défini, et respecte `false`. |
| 97 | Code Explorer : 30 outils publics préfixés par `mcp__code-explorer__` ou `mcp__gitnexus__` | `docs/code-explorer-integration.md:80` | `src/codebuddy/tools.ts:440` | **VRAI** | Regex `CODE_EXPLORER_TOOL_RE` tolère les deux préfixes de serveurs MCP. |
| 98 | `CODEBUDDY_CODE_EXPLORER_AUTOINDEX=true` pour ré-indexer automatiquement | `CLAUDE.md:133`, `code-explorer-integration.md` | `src/plugins/code-explorer/CodeExplorerManager.ts:316` | **VRAI** | Strictement opt-in via la variable d'environnement. |
| 99 | TLS hors-machine avec `CODEBUDDY_HTTPS=1` + certificat/clé | `docs/hermes-openclaw-parity.md:148` | `src/server/tls-config.ts:40` | **VRAI** | Fonctionne avec certificat ou génération dev self-signed via `openssl`. |
| 100 | Commandes de parité Hermes : `buddy hermes parity\|status\|smoke\|claw\|...` | `docs/hermes-openclaw-parity.md:125-150` | `src/commands/hermes/index.ts` | **VRAI** | Conforme aux sous-commandes du module Hermes. |

---

## 4. Tests de preuve (Tests ROUGES exécutés et validés)

Un ensemble de 15 tests automatisés a été rédigé dans [`tests/docs/revue-gemini-docs.test.ts`](file:///home/patrice/DEV/cb-succes-companion-2026-09-02/tests/docs/revue-gemini-docs.test.ts) et commité (`e3c6d857e`).
Chaque test prend une promesse explicite de la documentation et l'affirme contre le code réel compilé ou les modules TypeScript.

### Commande de test et résultat d'exécution

```bash
./node_modules/.bin/vitest run tests/docs/revue-gemini-docs.test.ts
```

Sortie verbatim (15 tests échoués / 15 tests, démontrant les 15 anomalies répertoriées) :

```text
 ❯ tests/docs/revue-gemini-docs.test.ts (15 tests | 15 failed) 869ms
   × Revue Gemini — Preuves ROUGES des divergences de documentation > 1. Valeurs par défaut CLI vs Documentation > CLAUDE.md:50 et docs/getting-started.md:298 promettent un défaut de 50 tool calls (400 en YOLO)
     → expected 'Usage: buddy [options] [command]\n\n...' to match /--max-tool-rounds <rounds>\s+maximum number of tool execution rounds \(default: "?50"?\)/
     (Reçu dans le CLI réel : `--max-tool-rounds <rounds>  maximum number of tool execution rounds (default: 400)`)

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 1. Valeurs par défaut CLI vs Documentation > CLAUDE.md:265 promet que le mode par défaut de CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE est plan
     → expected 'default' to be 'plan'

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 1. Valeurs par défaut CLI vs Documentation > CLAUDE.md:271 promet que CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS a une valeur par défaut de 30000 ms
     → expected '120000' to be '30000'

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 2. Variables d'environnement inexistantes ou ignorées > CLAUDE.md:257 promet que BUDDY_SENSE_STT_MODEL_DIR surcharge le dossier du modèle Parakeet
     → expected '~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8' to be '/opt/custom/parakeet-model'
     (La fonction ignore la variable et ne lit que CODEBUDDY_PARAKEET_MODEL_DIR / CODEBUDDY_SHERPA_ONNX_MODEL_DIR)

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 2. Variables d'environnement inexistantes ou ignorées > docs/cb2/README.md:19 promet la variable CODEBUDDY_WIDGETS_AUTOGEN pour autoriser la génération
     → expected null not to be null
     (La variable n'existe pas dans le code, le moteur n'évalue que CODEBUDDY_WIDGETS === 'true')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > docs/fleet-guide.md:850 et hermes-openclaw-parity.md:134 promettent buddy fleet tasks add
     → expected 1 to be +0 (error: unknown command 'tasks')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:334 promet buddy nodes reject
     → expected 1 to be +0 (error: unknown command 'reject')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:333 promet buddy todo complete
     → expected 1 to be +0 (error: unknown command 'complete')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:335 promet buddy secrets delete
     → expected 1 to be +0 (error: unknown command 'delete')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:336 promet buddy approvals revoke
     → expected 1 to be +0 (error: unknown command 'revoke')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:343 promet buddy tunnel stop
     → expected 1 to be +0 (error: unknown command 'stop')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:345 promet buddy completions uninstall
     → expected 'Usage: buddy completions ... Unsupported shell: uninstall' not to contain 'Unsupported shell: uninstall'

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:344 promet buddy lsp start
     → expected 1 to be +0 (error: unknown command 'start')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:345 promet buddy deploy preview
     → expected 1 to be +0 (error: unknown command 'preview')

   × Revue Gemini — Preuves ROUGES des divergences de documentation > 3. Commandes CLI promises dans la documentation mais absentes du binaire > CLAUDE.md:333 promet buddy execpolicy clear
     → expected 1 to be +0 (error: unknown command 'clear')

Test Files  1 failed (1)
     Tests  15 failed (15)
  Duration  1.97s
```

---

## 5. Synthèse & Propositions de correctifs prioritaires

Sans modifier les fichiers de documentation (revue uniquement), voici les correctifs à apporter pour rétablir la parfaite vérité du dépôt :

1. **`CLAUDE.md:50` et `docs/getting-started.md:298` (Limite de rounds d'outils) :**
   - Corriger la mention "max 50, YOLO 400" en explicitant que le CLI applique 400 rounds par défaut (sauf si `--max-tool-rounds` est spécifié), ou bien réaligner la valeur par défaut de Commander dans `src/index.ts:1373` sur 50.
2. **`docs/fleet-guide.md:850` et `docs/hermes-openclaw-parity.md:134` (`buddy fleet tasks`) :**
   - Remplacer `buddy fleet tasks add --goal-mode` par `buddy autonomy tasks add --goal-mode` (ou `buddy colab tasks add --goal-mode`).
3. **`CLAUDE.md:257` (`BUDDY_SENSE_STT_MODEL_DIR` et `BUDDY_SENSE_STT_THREADS`) :**
   - Mettre à jour la table des variables d'environnement en indiquant les véritables variables lues par Code Buddy pour surcharger le modèle et les threads : `CODEBUDDY_PARAKEET_MODEL_DIR` et `CODEBUDDY_SPEECH_STT_THREADS`.
4. **`CLAUDE.md:265` (`CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE`) :**
   - Mettre à jour le tableau : le mode par défaut actuel est `default` (lecture gardée), et non plus l'ancien mode historique `plan`.
5. **`CLAUDE.md:271` (`CODEBUDDY_SENSORY_ENGAGE_WINDOW_MS`) :**
   - Remplacer `default 30000` par `default 120000`.
6. **`CLAUDE.md:281` (`CODEBUDDY_COMPANION_MIN_GAP_MS`) :**
   - Préciser le nom exact `CODEBUDDY_COMPANION_MIN_GAP_MS` au lieu de suggérer `CODEBUDDY_COMPANION_PROACTIVE_MIN_GAP_MS`.
7. **`docs/cb2/README.md:19` et `generative-ui.md:17` (`CODEBUDDY_WIDGETS_AUTOGEN`) :**
   - Supprimer la variable fantôme `CODEBUDDY_WIDGETS_AUTOGEN` ; documenter que seule `CODEBUDDY_WIDGETS=true` gouverne la génération de widgets.
8. **`docs/getting-started.md:116-118` (`buddy import`, `explain`, `dev explain`) :**
   - `buddy import` : documenter l'import des règles et serveurs MCP concurrents (au lieu de mémoires/historique).
   - `buddy explain` : documenter l'explication architecturale d'un dépôt (dossier, défaut `.`) et non d'un fichier isolé.
   - `buddy dev explain` : retirer le paramètre `<file>` et documenter le résumé des conventions du dépôt.
9. **`CLAUDE.md:320-370` (Nettoyage des sous-commandes CLI obsolètes ou fantômes) :**
   - `nodes` : remplacer `status|approve|reject` par les vraies sous-commandes (`list|pair|approve|describe|remove|invoke|pending`).
   - `todo` : remplacer `complete` par `done`.
   - `secrets` : remplacer `delete` par `remove`.
   - `approvals` : remplacer `revoke|grant` par `approve|deny|policy`.
   - `tunnel` : retirer `stop|status` (seul `start` existe).
   - `completions` : retirer `uninstall`.
   - `lsp` : remplacer `start|stop` par `status` et `diagnostics <file>`.
   - `deploy` : remplacer `preview|apply` par `platforms|init|nix`.
   - `execpolicy` : retirer `clear`.
   - `proxy` : documenter comme commande directe `buddy proxy [options]`.
   - `cloud` : retirer `sync` (les sous-commandes sont `submit|status|list|cancel|logs|delete`).
   - `bundles` : remplacer `pack|unpack|verify` par `create|show|remove`.
   - `desktop` : documenter comme alias de `buddy gui [options]`.

---

## 6. Historique des commits conventionnels

- `e3c6d857e` : `test(docs): prove documentation discrepancies on CLI defaults, commands, and env vars`
- *(Prochain commit)* : `docs(revue): complete Gemini G9 documentation audit report`
