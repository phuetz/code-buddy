# Audit Code Buddy — backlog Codex (2026-07-15)

Audit conduit sur la branche `feat/code-explorer-freshness-and-sim-perception`.
Vérifications mécaniques : `lint` (0 erreur, 2461 warnings), `typecheck` racine (0), `check:circular`
(6 cycles connus acceptés), `npm audit` (1 high, 8 moderate, 21 low), typecheck Cowork (**53 erreurs**).

> **Hors périmètre Codex — déjà traité par Patrice** : le grésillement de la boucle audio
> (régression du commit `3c55da46`, 2026-07-13) est **déjà corrigé dans le working tree** de Patrice
> (`voice-loop.ts` / `tts-volume.ts` / `audio-player.ts` / echo-cancel). Ne pas y toucher :
> il reste seulement à commiter + redémarrer `lisa-telegram`. Voir la section « Boucle audio » plus bas.

Chaque tâche est autonome et vérifiable. Convention du repo : ESM (`.js` dans les imports même en `.ts`),
`logger` et non `console`, TS strict, Conventional Commits. Vérifier avec
`npm run validate` (lint + typecheck + test) ou un filtre de test ciblé.

---

## P0 — Sécurité (haute valeur, fail-closed)

### SEC-1 [HAUTE] — Endpoints admin inline sans `requireScope`
- **Fichier** : `src/server/index.ts` (~L400, 427, 453, 487, 546–577, 604, 662, 704, 735–800)
- **Problème** : une trentaine d'endpoints déclarés *inline* dans `index.ts` n'appliquent aucun
  `requireScope`, contrairement aux routeurs modulaires (`sessions.ts`/`memory.ts`/`tools.ts`). Un token
  émis avec le seul scope `chat` peut donc : créer + déclencher un webhook (`POST /api/webhooks`,
  `POST /api/webhooks/:id/trigger`) → dispatch d'un message agent ; déclencher un job cron
  (`POST /api/cron/jobs/:id/trigger`) ; réveiller l'agent (`/api/heartbeat/tick|start|stop`) ; réécrire
  la persona (`PUT /api/identity/:name`, jusqu'à 64 Ko) ; lire/écrire `/api/auth-profiles`.
- **Fix** : ajouter le `requireScope('admin')` (ou le scope adéquat : `sessions`, `memory`…) sur chaque
  endpoint inline à effet de bord. Reproduire le motif déjà utilisé dans les routeurs modulaires.
- **Vérif** : test qui émet un token scope=`chat` et attend `403` sur chacun de ces endpoints.

### SEC-2 [MOYENNE] — Path traversal sur `runId` (API mobile)
- **Fichier** : `src/server/routes/mobile.ts:436`
- **Problème** : `runId` est injecté brut dans `path.join(runStore.getRunsDir(), String(runId))` sans
  contrôle `..`. Un device appairé envoie `runId=../../../<cible>` → `runDir` sort de `runsDir`, et le
  `isPathInsideDirectory` en aval s'évalue alors contre `<cible>/artifacts` → lecture de tout fichier
  sous un dossier `artifacts` arbitraire.
- **Fix** : rejeter tout `runId` contenant `/`, `\` ou `..` (allowlist `^[a-zA-Z0-9._-]+$`) **avant** le
  `path.join`, ou re-vérifier que `runDir` résolu reste sous `runsDir`.
- **Vérif** : test `runId='../../etc'` → `400`.

### SEC-3 [MOYENNE] — Code d'appairage mobile brute-forçable
- **Fichier** : `src/server/routes/mobile.ts:327–352`
- **Problème** : code à 6 chiffres (10^6), TTL 5 min, **non tourné sur échec**. Seul frein = le limiteur
  `/api/` (100/min) clé par IP, lui-même contournable (SEC-4). Force brute en ligne → token mobile.
- **Fix** : rotation du code après N échecs, + limiteur strict par device sur `/pair` (ex. 5 essais /
  fenêtre), + délai exponentiel.
- **Vérif** : test — 6 codes faux invalident/rotent le code courant.

### SEC-4 [MOYENNE] — Bypass rate-limit via `X-Forwarded-For`
- **Fichier** : `src/server/index.ts:206` (`app.set('trust proxy', 1)`) + `src/server/middleware/rate-limit.ts:102`
- **Problème** : `trust proxy=1` sans proxy réel devant → `req.ip` vient d'un XFF fourni par le client ;
  le limiteur clé les requêtes non authentifiées par `req.ip` → rotation XFF = buckets illimités.
- **Fix** : ne faire confiance au XFF que si `trustedProxies` est explicitement configuré ; sinon clé de
  rate-limit = adresse socket réelle (`req.socket.remoteAddress`).
- **Vérif** : test — 200 requêtes avec XFF tournant depuis la même socket → `429` déclenché.

### SEC-5 [BASSE] — `DEFAULT_SERVER_CONFIG` code mort dangereux
- **Fichier** : `src/server/types.ts:98–114`
- **Problème** : `corsOrigins:'*'` + `jwtSecret: process.env.JWT_SECRET || 'change-me-in-production'`.
  Jamais référencé au runtime aujourd'hui, mais mine latente (CORS wildcard + clé JWT prévisible si un
  futur code l'instancie).
- **Fix** : supprimer l'objet, ou brancher `jwtSecret` sur `getJwtSecret()` et retirer le `'*'`.

### SEC-6 [BASSE] — `isPeerScopeAllowed` fail-open
- **Fichier** : `src/fleet/permissions.ts:13`
- **Problème** : `scopes === undefined` → défaut `['*']` (tout autorisé). Non atteignable aujourd'hui,
  footgun futur.
- **Fix** : défaut `[]` (deny). **Vérif** : test `isPeerScopeAllowed('peer:invoke', undefined) === false`.

---

## P1 — Dérive de câblage (« enregistré / jamais consommé »)

### WIRE-1 [HAUTE] — `fleet:activity` émis, zéro consommateur
- **Émis** : `src/fleet/peer-tool-bridge.ts:463`, `src/tools/route-peer-tool.ts:233`
- **Typé** : `src/events/types.ts:785` (`FleetActivityEvent`), dans `AllEvents`/`ApplicationEvents`.
- **Problème** : événement **typé de première classe** du bus global émis à chaque invocation d'outil de
  pair, mais **aucun `.on('fleet:activity')`** dans tout `src/` → chaîne d'observabilité/UI fleet morte.
- **Fix** : soit câbler le consommateur prévu (indicateur d'activité fleet / télémétrie), soit retirer
  l'émission + le type si la feature est abandonnée. Décision produit à trancher — proposer les deux.

### WIRE-2 [MOYENNE] — 5 commandes slash mortes
- **Fichier** : `src/commands/slash/builtin-commands.ts` (L234 `/redo`, L241 `/timeline`, L806
  `/knowledge-graph`, L900 `/approvals`, L920 `/batch-review`)
- **Problème** : déclarées `isBuiltin` avec un jeton `__X__` mais **aucune entrée** dans la `handlerMap`
  de `EnhancedCommandHandler` → `handleCommand` renvoie `{ handled:false }` et l'UI affiche
  « registered but has no conversation-loop handler yet ». Visibles en autocomplétion/aide donc trompeuses.
  (Régression du nettoyage déjà fait le 2026-02-22 pour `/queue,/subagents,/reset,/verbose`.)
- **Fix** : soit implémenter le handler, soit retirer la déclaration builtin (comme le nettoyage 02-22).
- **Vérif** : test qui asserte que toute commande `isBuiltin` a un handler dans `handlerMap`.

### WIRE-3 [BASSE] — 10 entrées `TOOL_METADATA` orphelines + dispatch mort
- **Fichier** : `src/tools/metadata.ts` ; branche morte `src/agent/tool-handler.ts:1262` (`apply_patch`)
- **Problème** : `apply_patch, csv_analyze, deploy, design_system, docs_search, knowledge_graph,
  memory_propose, replace_memory, screen_memory, terminate` ont une metadata mais ne sont ni exposés au
  LLM ni dispatchés. `apply_patch` garde en plus une branche de dispatch dédiée = code mort.
- **Fix** : retirer les entrées vestigiales + la branche `apply_patch` morte (vérifier qu'aucun alias ne
  la référence avant suppression).

### WIRE-4 [BASSE] — `compaction:started/completed` jamais émis
- **Fichier** : `src/context/compaction/types.ts:157,160`
- **Problème** : le moteur émet `compaction:start`/`compaction:complete` (sans `-ed`) ; les variantes
  typées `-ed` ne sont ni émises ni écoutées → piège de nommage pour tout futur abonné.
- **Fix** : supprimer les types `-ed` inutilisés (ou aligner le moteur sur un seul nom).

---

## P1 — Typecheck Cowork (bloque un build strict)

### CW-1 [MOYENNE] — 53 erreurs `tsc` sous le tsconfig Cowork
- **Commande** : `cd cowork && npx tsc --noEmit` → 53 erreurs.
- **Détail** : ~50 sont des déclarations mortes (`error TS6133/6138/6196`) concentrées dans
  `src/channels/*` (slack/teams/matrix/discord/webchat/google-chat/signal/telegram, +
  `mcp/transports.ts`, `skills/parser.ts`, `tools/vision/ocr-tool.ts`…). **1 vraie erreur de type** :
  `src/plugins/sandbox-worker.ts:245` — `Argument of type 'unknown' is not assignable to parameter of
  type 'Error'` (à corriger réellement, pas juste supprimer).
- **Fix** : retirer les variables/imports/types morts ; pour `sandbox-worker.ts:245`, narrower le
  `unknown` (`err instanceof Error ? err : new Error(String(err))`).
- **Vérif** : `cd cowork && npx tsc --noEmit` → 0 erreur.

---

## P2 — Dette de code (ratio valeur/effort)

### DEBT-1 [MOYENNE] — Forks copiés-collés `src/` ↔ `cowork/src/`
- **Cibles** : `logger.ts` (86 lignes identiques, déjà en dérive), `mcp-oauth.ts` (48 lignes identiques).
- **Fix** : extraire un module partagé (package interne ou import relatif) et supprimer le fork.
- **Vérif** : `npm run validate` racine + `cd cowork && npm test`.

### DEBT-2 [MOYENNE] — Réimplémentations divergentes du même concept
- **Cibles** : `retry.ts`, `fleet/result-aggregator.ts`, `optimization/model-routing.ts` — même nom des
  deux côtés, comportements qui divergent (risque de bugs incohérents entre les deux apps).
- **Fix** : converger vers une seule implémentation (celle la plus complète), adapter les appelants.

### DEBT-3 [BASSE] — Modules morts jamais câblés (~39)
- **Cibles vérifiées à 0 référence** (commencer par celles-ci) : `tools/test-generator.ts`,
  `tools/code-quality-scorer.ts`, `tools/dead-code-detector.ts`, `tools/report-generator.ts`,
  `tools/doc-generator.ts`, `tools/unified-diff-editor.ts`, `tools/semantic-diff.ts`,
  `tools/fetch-tool.ts`, `tools/sql-tool.ts`, `tools/confirmation-tool.ts`, `tools/code-formatter.ts`.
  (`utils/` en a ~16 aussi — re-vérifier chacun avant suppression, **`profiler.ts` = faux positif, garder**.)
- **Fix** : supprimer après un `grep -rn "from.*<nom>" src/` de contrôle (attention aux imports
  dynamiques du registry).

### DEBT-4 [BASSE] — `catch {}` muets sans commentaire (~40)
- **Cible** : `src/tools/computer-control-tool.ts` (~15 : L1568, 1587, 1607, 3404, 3519, 3626, 3755, 3778,
  3836, 3852, 3858, 3985, 4008, 4031, 4065…).
- **Fix** : au minimum `logger.debug(...)` + un commentaire « best-effort » justifiant l'avalage.
  (Ne PAS toucher `code-exec-tool.ts:322–325,411` — neutralisation sandbox intentionnelle.)

### DEBT-5 [BASSE] — Vraies fuites `console.*` (~77)
- **Cibles** : `desktop/installer.ts` (13), `providers/xai-oauth.ts` (5), `providers/codex-oauth.ts` (3),
  `utils/debug-logger.ts` (5), `app/application-factory.ts` (5, dont une clé API), `utils/qr-pairing.ts`
  (5), `versioning/migration-manager.ts` (4).
- **Fix** : remplacer par `logger.*`. **Ignorer** les ~2000 occurrences de `commands/`/`cli/` (sortie CLI
  stdout légitime) et les stdout de protocole marqués intentional (MCP/JSON-RPC).

---

## P2 — Santé des tests

### TEST-1 [MOYENNE] — E2E du composeur de message Cowork désactivé
- **Fichier** : `cowork/e2e/message-composer-ui.spec.ts:4` et `:37` (toute la suite `MessageComposer E2E`,
  désactivée sans condition — commentaire « can't easily mock the IPC here »).
- **Problème** : le **chemin d'entrée utilisateur principal** de Cowork n'a aucune couverture E2E.
- **Fix** : fournir le helper IPC manquant (mock du bridge) et réactiver les 2 tests.

### TEST-2 [MOYENNE] — VAD / STT local non testés
- **Fichiers** : `src/voice/voice-activity.ts`, `src/voice/local-whisper.ts` — 0 test.
- **Problème** : début du pipeline voix→cognition ; une régression y casse silencieusement l'entrée micro.
- **Fix** : tests unitaires sur les frontières (détection d'activité sur buffers PCM synthétiques ;
  parsing de sortie Whisper) avec des fixtures, sans binaire réel.

### TEST-3 [BASSE] — Entrées de décision du council non testées
- **Fichiers** : `src/council/with-timeout.ts`, `signals.ts`, `peers.ts` (logique conditionnelle dense).
- **Fix** : tests unitaires (scoring de signaux, sélection de pairs, garde de timeout).

### TEST-4 [BASSE] — Transport LLM du write-gate non testé
- **Fichier** : `src/review/llm-client.ts` (chemin safety qui autorise l'écriture de fichiers).
- **Fix** : test du parsing de réponse (échec de parse → gate fail-closed, pas ouverte).

### TEST-5 [BASSE] — Hygiène de la suite
- Renommer les tests `-real` qui mockent leur sujet en `-wiring`/`-smoke` :
  `tests/server/chat-route-real-http.test.ts:9`, `tests/agent/hermes-browser-backends-smoke-real.test.ts:34–65`.
- Migrer les gros dormeurs (`rest-server`, `matrix`, `http-server`, `response-cache`) vers
  `vi.useFakeTimers()` (528 sleeps réels, 13 ≥ 500 ms — flake horloge).
- Supprimer les 33 `expect(true).toBe(true)` (surtout `diff-viewer.test.ts` L825/833/841/849 et
  `confirmation-service.test.ts` L86/220/225/230/235/242).

---

## P3 — Mécanique

### MECH-1 [BASSE] — Vulnérabilités deps
- `npm audit` : 1 high (`undici` — dép bundlée de `npm`), moderate `js-yaml` (dép de `@istanbuljs`).
  Toutes deux transitives/dev. `npm audit fix` (non-breaking) puis re-vérifier `npm run build`.

### MECH-2 [BASSE] — Directives `eslint-disable` inutiles (4)
- `scripts/murmure-stt-probe.mjs:171`, `src/codebuddy/stream-retry.ts:134`,
  `src/voice/perceived-latency-benchmark.ts:269`, `tests/providers/codex-oauth.test.ts:38`.
- **Fix** : les retirer (ESLint les signale déjà comme « unused directive »).

---

## Boucle audio (grésillement) — DÉJÀ CORRIGÉ par Patrice, ne pas donner à Codex

**Cause racine** (commit `3c55da46`, 2026-07-13 18:30, « il y a 2 jours ») :
1. `DEFAULT_STREAM_GAIN_DB = 8` → chaque phrase streamée (Pocket/Voicebox) boostée +8 dB (×2,51) puis
   passée dans un soft-limiter `tanh` par échantillon → compression/soft-clip d'un signal déjà fort =
   **grésillement**. C'est la cause audible dominante sur cette machine.
2. `pw-play -` dans les candidats stdin → lit le flux 24 kHz mono comme du **48 kHz stéréo brut** (header
   WAV joué comme audio). Latent ici (`aplay` est présent et prioritaire), mais vrai footgun.
3. Aggravant : le service `codebuddy-pocket-tts` tourne avec `--quantize` (source déjà plus rêche).

**Correctif déjà écrit dans le working tree** (`tts-volume.ts`, `voice-loop.ts`, `audio-player.ts`,
`90-codebuddy-echo-cancel.conf`) : gain streaming → unité (0 dB) + limiteur non appliqué aux facteurs
non-amplifiants ; lecteurs stdin `ffplay`→`aplay` (WAV-aware), `pw-play` exclu ; `pw-play` fichier avec
`--latency=100ms` ; echo-cancel `node.latency` 512→960/48000. **Tests verts (48/48).**

**Reste à faire (déploiement, pas du code)** :
- Commiter le working tree (`fix(voice): …`).
- `systemctl --user restart lisa-telegram` — il a démarré à 20h17, **avant** le rebuild dist de 20h36,
  donc il exécute encore le code à +8 dB. (echo-cancel non responsable : 0 xrun au journal sur 3 jours.)
- A/B tester `codebuddy-pocket-tts` **sans** `--quantize` pour isoler la part « source rêche ».
