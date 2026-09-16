# RAPPORT INCONNU1 — Un inconnu installe Code Buddy depuis la branche

- Date : 2026-09-04
- Lane : INCONNU1 (Fable 5.1)
- Dépôt de test : `~/DEV/cb-inconnu1-2026-09-04` (clone dédié, jamais `~/code-buddy`)
- Branche clonée : `codex/audit-systeme-nerveux-2026-09-01`
- Branche de travail : `fix/inconnu1-2026-09-04`
- Méthode : suivre UNIQUEMENT `README.md` et `docs/getting-started.md`, sans connaissance préalable du code.
- HOME temporaire : `~/DEV/cb-inconnu1-2026-09-04/_qa/inconnu1/home` (gitignoré via `.git/info/exclude`)
- Modèle Ollama utilisé : `qwen3:4b-instruct` (2.5 Go), vérifié libre avec `ollama ps` avant chaque lancement. Aucun gros modèle chargé en parallèle.

## Note de méthode : `npm link`

`README.md:85` et `docs/getting-started.md:28` proposent `npm link` pour exposer
`buddy` globalement. Sur cette machine, `~/.local/bin/buddy` (un autre outil,
sans rapport avec ce clone) précède déjà le répertoire bin npm global dans le
`PATH` : un `npm link` depuis ce clone aurait créé un symlink invisible
(masqué par l'entrée `PATH` existante), donnant l'illusion de tester ce clone
alors que `buddy` aurait continué à résoudre vers l'autre installation. Pour
ne pas polluer un état partagé de la machine avec d'autres chantiers en
cours, j'ai utilisé le repli explicitement documenté par
`docs/getting-started.md:28` : `node dist/index.js` directement. Un inconnu
sur une machine vierge n'aurait pas ce problème.

## Tableau étape | attendu (doc:ligne) | observé | verdict

| Étape | Attendu (doc:ligne) | Observé | Verdict |
|---|---|---|---|
| `npm install` | README.md:80-86 « Three commands » | 5m04s, `added 1848 packages`, seulement des avertissements `ERESOLVE` (peer deps `react-native`/`react`) et des dépréciations transitives ; 0 erreur fatale. | VRAI |
| `npm run build` | README.md:85 | `tsc && copy-bundled-skills && write-runtime-manifest`, 19,9 s, exit 0, 8 packages de skills copiés. | VRAI |
| `npm run typecheck` | mission (absent du README/getting-started — script npm réel non cité dans les deux pages) | `tsc --noEmit` + `tsc --project tsconfig.gpuNode-identity.json`, 15,9 s, exit 0. | ABSENT (fonctionne, mais ni README ni getting-started ne mentionnent ce script) |
| `buddy doctor` | getting-started.md:73 « tells you in one line whether you're ready to chat » | Une ligne claire : `⚠️ Not ready to chat yet — Ollama is running (22 models) but not selected — run buddy onboard, or --fix to select gemma4-moe-rag:latest ($0)` + 2 avertissements optionnels (sox, ICM) + ChatGPT non connecté. Résumé : 22 passed, 2 warnings, 0 errors. | VRAI |
| `buddy doctor --fix` | getting-started.md:74 « auto-configures a running Ollama for you » | A sélectionné et écrit `gemma4-moe-rag:latest` (15 Go) dans `user-settings.json`. Fonctionne comme annoncé, mais choisit un modèle volumineux plutôt que le plus petit modèle disponible (`qwen3:4b-instruct`, 2,5 Go) sans le signaler — surprenant pour un premier pas « $0, léger ». | VRAI (imprécis sur le choix de taille, non documenté comme un critère) |
| Headless `-o/--output-last-message` + `--output-schema` (HEADLESS1) | getting-started.md section « Headless Mode » (198-217, avant correctif) — flags absents | Réels et fonctionnels en pratique : JSON conforme → exit 0, fichier écrit atomiquement par `-o` ; JSON non conforme → exit 1 avec message `Output schema validation failed: … is not valid JSON`. Testé en vrai sur Ollama `qwen3:4b-instruct`, `$0`. | ABSENT (corrigé dans ce chantier — voir Réparations) |
| Headless `--permission-mode dontAsk` + `bash` réel (HEADLESS2) | getting-started.md « Headless Mode » + description générale de l'exécution autonome | Sur dépôt jouet : `echo done > done.txt && cat done.txt` puis `npm test` exécutés sans aucune confirmation interactive ; fichier réellement créé, `npm test` a réellement lancé `node test.js` et affiché `TEST PASSED`. | VRAI |
| Petit modèle et tâches multi-étapes | README.md:120 « Not ready » — « Loop needs a model that actually calls tools. A tiny model can stall » | Confirmé en pratique bien au-delà de `loop` : sur une tâche « crée un fichier via create_file puis vérifie », `qwen3:4b-instruct` a systématiquement d'abord appelé `view_file`/`search` (vérification avant création), a mal reproduit un heredoc multi-lignes (`}`→`)` halluciné), et a fini par répondre "I detected an attempt to override my instructions" sur un prompt légitime. Seules des commandes `bash` strictement mono-ligne, sans guillemets imbriqués, aboutissent de façon fiable. | VRAI (l'avertissement du README est confirmé, et plus large que le seul `loop`) |
| `/batch` sur deux fichiers (DELEG1) | Ni README.md ni getting-started.md ne mentionnent `/batch` | Fonctionne : 2 fichiers demandés (`file-one.txt`, `file-two.txt`) créés avec le bon contenu. Le planificateur `/batch` a ajouté de lui-même 3 unités supplémentaires (deux « verify », un « ensure-directory ») non demandées, rapportées comme `[FAIL] … No files changed` alors qu'il s'agit de vérifications réussies sans écriture — le résumé « 3 failed » peut induire en erreur un inconnu qui ne voulait que les 2 tâches demandées. | ABSENT (doc), fonctionnalité VRAIE mais rapport IMPRÉCIS |
| `buddy improve status` (IMPROVE1) | Ni README.md ni getting-started.md ne mentionnent `buddy improve` | `Autonomy: propose-only`, `Capability coverage: 0/3`, `Archive: 0 validated…` — cohérent avec CLAUDE.md (opt-in, off par défaut, lecture seule sans `CODEBUDDY_SELF_IMPROVE`). | ABSENT (doc) |
| `buddy server` + curl `/v1/chat/completions` (SERV1) | README.md:58-64 « Two peers on one machine » montre comment démarrer le serveur, mais ne montre pas comment appeler l'API REST ni comment s'authentifier | Serveur démarré (port 3721, libre, hors 3000/3001/8188/8189/9222). Avec `JWT_SECRET` seul : `curl` sans jeton → `401 UNAUTHORIZED` (attendu, mais aucun moyen documenté d'obtenir un jeton valide). `--no-auth` (flag réel de `buddy server --help`, non documenté dans README/getting-started avant ce chantier) permet un `curl` local fonctionnel : réponse OpenAI-compatible réelle (`{"choices":[{"message":{"content":"PONG2"}...}]}`) via Ollama, `$0`. | ABSENT (corrigé dans ce chantier — voir Réparations) |
| `buddy cost --latency` (TTFT1) | getting-started.md:117 tableau des utilitaires | Tableau réel avec 37 tours mesurés, `ollama qwen3:4b-instruct`, TTFT p50 3406 ms / p95 9407 ms, TTFM p50 3797 ms / p95 12253 ms, 108 855 tokens cumulés — cohérent avec les appels headless de cette session. | VRAI |

## Réparations effectuées

1. **`docs(getting-started): documenter -o/--output-schema et server --no-auth`**
   (branche `fix/inconnu1-2026-09-04`, commit `01a039f43`) :
   - Ajout de `-o/--output-last-message` et `--output-schema` dans la section
     « Headless Mode » de `docs/getting-started.md`, avec un exemple d'usage
     et le comportement de sortie (exit 1 si le JSON final ne respecte pas le
     schéma).
   - Ajout d'une nouvelle sous-section « Calling the OpenAI-compatible REST
     API (curl, local, $0) » dans la section Fleet de
     `docs/getting-started.md`, documentant `buddy server --no-auth` (usage
     loopback uniquement, prouvé en vrai) et un exemple `curl` complet contre
     `/v1/chat/completions`.
   - Test ajouté : `tests/docs/getting-started-headless-server-flags.test.ts`
     (4 tests) — vérifie que la doc mentionne ces flags ET qu'ils existent
     réellement dans `buddy --help` / `buddy server --help`, pour empêcher
     toute dérive future.

Aucune fonctionnalité n'a été réécrite : les deux problèmes trouvés (HEADLESS1
et SERV1) étaient des trous de documentation, pas des défauts de code — les
flags fonctionnaient déjà correctement une fois découverts.

## Préexistant, non réparé (hors mandat « ne pas réécrire de fonctionnalité »)

- Le rapport de `/batch` compte les unités de vérification sans écriture
  comme « FAIL », ce qui peut alarmer un inconnu à tort sur une tâche par
  ailleurs réussie. Changer ce comportement serait modifier la logique de
  `/batch`, hors mandat de ce chantier documentaire.
- `buddy doctor --fix` choisit le premier modèle Ollama détecté sans
  préférence de taille ; documenté ici, non modifié.
- `/batch` et `buddy improve` ne sont mentionnés dans aucune des deux pages
  suivies ; ils fonctionnent (testés en vrai) mais un inconnu strict README +
  getting-started ne les découvrirait pas. Laissé en l'état : ajouter une
  documentation complète de ces sous-systèmes dépasse la réparation d'un
  blocage et relève d'un chantier éditorial dédié.

## Vérifications finales

- `npx vitest run tests/cli tests/docs tests/security` → **68 fichiers / 1063 tests, tous verts**.
- `npx vitest run tests/security/donnees-personnelles.test.ts` → 7/7 verts (inclus dans le total ci-dessus).
- `npx tsc --noEmit -p .` → exit 0.
- `git diff --check` → exit 0.
- Aucun processus laissé en arrière-plan (serveurs QA arrêtés) ; `ollama ps`
  vérifié vide avant chaque lancement de modèle, un seul petit modèle chargé
  à la fois.
- Aucun push, aucune API payante, aucun service systemd. `~/code-buddy` et le
  vrai `~/.codebuddy` n'ont pas été touchés (HOME temporaire pour tous les
  appels `buddy`).

## Bilan (10 lignes max)

Parcours complet README + getting-started rejoué à l'aveugle sur un clone
dédié : `npm install/build/typecheck` propres (0 erreur), `buddy
doctor`/`--fix` honnêtes et fonctionnels. Deux trous de documentation réels
trouvés et corrigés avec test : `-o/--output-schema` (HEADLESS1) et `buddy
server --no-auth` pour `/v1/chat/completions` (SERV1) n'étaient documentés
nulle part alors qu'ils marchent, prouvé en vrai sur Ollama
`qwen3:4b-instruct`, `$0`. `bash` headless en `--permission-mode dontAsk`
exécute réellement des commandes et un vrai `npm test` (HEADLESS2, confirmé).
`/batch` (DELEG1) crée bien les deux fichiers demandés mais son résumé
« 3 failed » sur des vérifications réussies est trompeur — signalé, non
corrigé (hors mandat). `buddy improve status` et `buddy cost --latency`
fonctionnent tel qu'annoncé (ou absents de la doc pour le premier). Preuves :
68 fichiers/1063 tests verts, `tsc` 0, `git diff --check` 0. Rapport complet :
`~/DEV/cb-inconnu1-2026-09-04/docs/reports/2026-09/RAPPORT-INCONNU1.md`.
