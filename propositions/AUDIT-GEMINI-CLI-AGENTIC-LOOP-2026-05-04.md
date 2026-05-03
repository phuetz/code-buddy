# Audit comparatif boucle agentique — Gemini CLI source vs Code Buddy

> **Date** : 2026-05-04 (nuit, après push Code Buddy `1.0.0-rc.1`)
> **Auditeur** : Claude Opus 4.7 sur MINISTAR via session Code Buddy (Explore agent dispatcher)
> **Repo audité** : https://github.com/google-gemini/gemini-cli (Apache-2.0, ~103k stars, last push 2026-05-02)
> **Code Buddy source** : `D:/CascadeProjects/grok-cli/src/agent/execution/`

## Origine de cet audit

Patrice a révélé pendant la séance du 03/05 que **la boucle agentique de Code Buddy a été initialement mise en place par Gemini** (probablement gemini-cli direct ou Patrice utilisant Gemini comme générateur). Cet audit vise donc à voir comment *notre cousin* gemini-cli a évolué depuis qu'on s'en est inspiré, et identifier les patterns réciproques (ce qu'ils ont mieux que nous, ce qu'on a mieux qu'eux, ce qui reste partagé en ADN).

C'est aussi le 2e audit comparatif source de la séance, après celui sur Claude Code source (compaction). Pattern qui marche : étudier 1 zone précise dans 1 repo de référence, sortir 2-3 fixes narrow.

---

## Q1 — Structure de la boucle principale

| | Gemini CLI | Code Buddy |
|---|------------|-----------|
| Forme | `async *stream()` dans `AgentSession` + `async * sendMessageStream()` dans `GeminiChat` | `async *runTurnLoop()` dans `agent-executor.ts` |
| Architecture | 2 niveaux : `AgentSession.stream()` wraps un `AgentProtocol` (délégation) ; `GeminiChat` gère orchestration via `sendPromise` queue | Single source of truth : `runTurnLoop` génère tous les events ; `processUserMessageStream` = thin `yield*` wrapper ; `processUserMessage` = thin sequential collector |
| Sequencing | Queue Promise (`sendPromise`) garantit que les messages précédents terminent avant les nouveaux | Async generator naturel : un appel = un cycle complet, pas de queue externe |
| Per-turn injections | Pas de logique d'injection contextuelle proactive visible | `<lessons_context>` + KG + `<todo_context>` réinjectés à chaque round > 0 (décision #4 fusion task #5) |

**Différence-clé** : Gemini CLI utilise **délégation protocole + queue Promise** ; Code Buddy a **unifié streaming et sequential dans une async generator unique** (fusion task #5, 2026-04-26) avec **injections contextuelles proactives par tour**. L'ADN partagé : pattern async generator + accumulation events. Code Buddy l'a substantiellement étendu.

## Q2 — Streaming

| | Gemini CLI | Code Buddy |
|---|------------|-----------|
| Event types | `AgentEvent` polymorphe (Content, Thought, ToolCallRequest, Finished, NetworkRetryAttempt) | `ExecutorEvent` polymorphe (content, tool_calls, tool_stream, token_count, reasoning, steer, ask_user, done) |
| Backpressure | Queue accumulation (`currentEvents` array), pas de gestion explicite de slow consumer | `AbortController` checkpoints à 8 endroits dans la boucle, compatible `signal.aborted` ; pas de queue cap |
| Cancel mid-stream | Supporté via `signal: AbortSignal` paramètre (mais détail non vu) | Checkpoints d'abort fins (toutes les ~50-100 LOC) |
| Mode dual | Pas de fallback sequential explicite | Streaming-only events (`ask_user`, `tool_stream`, `token_count`, `reasoning`, `steer`) **silencieusement droppés** en sequential |

**Différence-clé** : Code Buddy a **checkpoints d'abort plus fins** ; Gemini CLI a **queue accumulation invisible** sans interruption fine. Côté events visibles : Code Buddy a un fallback explicite mais qui drop info (gap UX en sequential mode).

## Q3 — Tool execution + permissions

| | Gemini CLI | Code Buddy |
|---|------------|-----------|
| Permission gating | Hook `fireBeforeToolSelectionEvent()` — downstream peut modifier tool list ; pas de gating au registre | Hooks `PreToolUse` / `PostToolUse` via `runPreToolUseHook()`, blocage inline si `!allowed` |
| Tool invocation | **Déléguée au protocole** : function calls extraites en `handlePendingFunctionCall()` (Turn.ts) puis yielded comme `ToolCallRequest` events | **Inline** : dual mode streaming (`executeToolStreaming`) + lane-based (`executeToolViaLane`) ; mode `singleToolMode` re-enqueue les autres |
| Parallelisation | Délégué au protocole | **Forcé single-tool en streaming** : si LLM retourne plusieurs `tool_calls`, seul le premier exécute, le reste re-enqueued |
| Error handling | Multi-layer retry : connection + **mid-stream avec `MID_STREAM_RETRY_OPTIONS`** (4 attempts max, 1s init, exponential backoff) ; consolidation via `finalFunctionCallsMap` | Compaction proactive avant tool exec si `shouldCompactBeforeToolExec()` ; observation variator sur output ; disk-backed tool result (Manus AI #19) ; semantic truncation > 20K chars |

**Différence-clé** : Gemini CLI **délègue + retry mid-stream sophistiqué** ; Code Buddy **gère l'exécution inline + compaction proactive** mais **n'a pas de retry mid-stream équivalent** (gap notable). Inversement Gemini CLI n'a pas de compaction proactive avant tool exec.

## Q4 — Context management dans la boucle

| | Gemini CLI | Code Buddy |
|---|------------|-----------|
| History | Distinction explicit "comprehensive" (tous turns) vs "curated" (valid turns only) via `extractCuratedHistory()` | `prepareMessages()` à 3 call sites avec transcript repair |
| Pré-API | `scrubHistory()` supprime propriétés internes (`callIndex` etc.) | Output sanitizer (strips `<think>`, `<|im_start|>`, etc.) côté output, pas input |
| Token tracking | `lastPromptTokenCount` mis à jour depuis chunk metadata ; **pas de compaction proactive visible** | Pre-counting + middleware peut trigger `action: 'compact'` |
| Auto-compact in loop | **Aucune logique visible** | `shouldCompactBeforeToolExec()` proactif + reactive post-warning + middleware-driven |
| Pre-compaction flush | N/A | `getPrecompactionFlusher()` consume messages avant compaction (Native Engine pattern) |
| Query-aware injection | N/A | `classifyQuery()` + `ctxLevel` 3 niveaux ; sauve 15-20K tokens pour trivial messages |
| Thought signatures | `ensureActiveLoopHasThoughtSignatures()` ajoute synthetic signatures pour passer validation API | N/A (pas de validation API similaire) |

**Différence-clé** : Code Buddy est **substantiellement plus sophistiqué en gestion contexte** (proactive multi-stratégies + query-aware) ; Gemini CLI a **curation + scrubbing réactifs** seulement.

---

## Files clés cités

**Gemini CLI** (URLs GitHub blob direct) :
- `packages/core/src/agent/agent-session.ts` (L1-150) — async generator `stream()` wrapper + AgentProtocol delegation
- `packages/core/src/core/geminiChat.ts` (L~700) — `sendMessageStream()` orchestration + retry logic + `MID_STREAM_RETRY_OPTIONS`
- `packages/core/src/core/turn.ts` (L~500) — async generator `run()` + `handlePendingFunctionCall()`

**Code Buddy** :
- `D:/CascadeProjects/grok-cli/src/agent/execution/agent-executor.ts:554-1020` — `runTurnLoop()` boucle unifiée
- `D:/CascadeProjects/grok-cli/src/context/context-manager-v3.ts` — compaction + token tracking
- `D:/CascadeProjects/grok-cli/src/agent/execution/context-pipeline.ts` — injection contexte + JIT discovery

---

## 3 améliorations actionnables narrow pour Code Buddy

### 1. **Mid-stream retry avec exponential backoff** [M] — *gap qu'on a vraiment*

**Pourquoi** : Gemini CLI a `MID_STREAM_RETRY_OPTIONS` (4 attempts max, 1s init, exponential backoff) pour les coupures réseau pendant le stream LLM. Code Buddy a `ReconnectionManager` (utilisé pour FleetListener Phase (d).6) mais PAS pour les appels LLM streaming. Si une connexion API LLM coupe au milieu d'un stream, Code Buddy throw l'erreur user-facing au lieu de retry transparent.

**Comment** : Étendre `CodeBuddyClient.chatStream()` (`src/codebuddy/client.ts`) avec une option `streamRetry?: { maxAttempts, initialDelayMs, maxDelayMs }`. Réutiliser `ReconnectionManager` qui est déjà dans `src/channels/`. Préserver les chunks déjà reçus, retry uniquement la suite du stream après le dernier chunk OK.

### 2. **Streaming-only events visibility en sequential** [S] — *fix défensif simple*

**Pourquoi** : `ask_user`, `tool_stream`, `token_count`, `reasoning`, `steer` sont silencieusement droppés en sequential mode (par design). Mais des callers sequential (genre tests, batch processing) peuvent vouloir y accéder pour audit/debug. Aujourd'hui c'est "on les perd, point".

**Comment** : Ajouter à `processUserMessage()` un paramètre `options?: { collectStreamingEvents?: boolean }`. Si true, accumuler les events streaming-only dans un `collectedStreamingEvents: ExecutorEvent[]` retourné dans le résultat. Default false (backward compat). ~30 LOC + 4 tests.

### 3. **History curation explicite (comprehensive vs curated)** [M] — *amélioration archi*

**Pourquoi** : Gemini CLI a une distinction propre entre l'historique "complet" (incluant les invalid/orphan turns) et "curated" (cleaned). Code Buddy fait du transcript-repair par module séparé. Avoir cette distinction explicite côté API simplifie les use cases : debug = comprehensive, send to LLM = curated.

**Comment** : Dans `MessageHistoryManager` (facade T6 backlog), exposer `getComprehensiveHistory()` vs `getCuratedHistory()`. Le 2e applique transcript-repair + sanitization. Aligne avec ce que Gemini CLI fait. Permet aussi de simplifier le wirage `prepareMessages()` qui aujourd'hui mélange les deux.

---

## Conclusion

L'ADN partagé Gemini ↔ Code Buddy est visible dans le pattern **async generator + accumulation events**. Mais Code Buddy a **considérablement étendu** ce socle :
- Plus sophistiqué en context management (3 stratégies de compaction proactive vs zéro)
- Plus sophistiqué en transcript repair (orphan tool result rescue)
- Per-turn injections contextuelles (lessons, todo, KG)
- Output sanitizer (strips model leakage tokens)

Gemini CLI est plus sophistiqué dans :
- **Mid-stream retry sur les LLM calls** (Code Buddy n'a pas ça → reco #1)
- Curation history explicite (reco #3)
- Thought signatures pour validation API (Code Buddy n'en a pas besoin car format agnostique)

**Pas un repo plus mature dans l'absolu** — chaque a sa spécialité. Code Buddy a évolué dans une direction "multi-IA fleet hub + advanced context" ; Gemini CLI dans une direction "Google API integration + protocol delegation".

## Notes pour les autres Claudes du fleet

- gemini-cli source disponible sur https://github.com/google-gemini/gemini-cli (Apache-2.0)
- Patrice ne fait PAS de copier-coller — étude inspirationnelle seulement
- Cette boucle agentique n'est PAS le bottleneck immédiat de Code Buddy ; les 3 améliorations sont **incrémentales** (retry, UX, archi)
- Le ship "Code Buddy 1.0.0-rc.1" tient sans ces fixes — ils sont V1.x post-release

Si on attaque, ordre suggéré : **#2 (S, défensif) → #1 (M, vrai gap) → #3 (M, archi)**.

---

*Audit Claude Opus 4.7 sur MINISTAR — 2026-05-04, ~700 mots de rapport rendu par Explore agent + 200 mots de wrapping pour archive fleet.*
