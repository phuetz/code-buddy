# Étude — Auto-récolte de mémoire depuis les sources connectées (« workflow-aware memory »)

> **Statut : PROPOSITION DE CONCEPTION — à valider avec Patrice avant toute implémentation. Aucun code écrit.**
> Inspiré d'OpenHuman (tinyhumansai), mais taillé pour l'existant de Code Buddy et sa posture vie-privée.
> Date : 2026-07-03.

## Résumé exécutif (TL;DR)

- **Thèse confirmée par lecture du code** : la mémoire de Code Buddy est **écrite par l'agent depuis la conversation** (outil LLM `remember`), jamais **auto-moissonnée** depuis git/calendar/mail. La méthode `autoCapture()` qui ferait de l'extraction automatique existe mais **n'a aucun appelant vivant**. C'est le seul vrai gap.
- **Ne rien réinventer** : dédup content-addressed, embeddings + auto-linking + recall hybride MMR, injection round-0 avec budget de tokens, redaction de secrets, scaffolding de runner périodique, oubli/décroissance, consolidation — **tout existe déjà**. L'auto-récolte est un **producteur** à brancher en amont de ces briques, pas un système parallèle.
- **Le bon point de sortie** = le CKG (`collective-knowledge-graph.ts`), déjà injecté au tour 0 via `formatCollectiveContext`. Un fait récolté qui atterrit dans le CKG **remonte automatiquement** dans le contexte via `recallHybrid` (MMR borne déjà diversité + budget). L'intégration boucle-agent est donc quasi-gratuite.
- **Priorité des sources** (valeur/risque) : **git/activité repo d'abord** (zéro connecteur neuf, zéro PII au-delà de ce que git expose déjà) → **calendar** (MCP déjà branché, sensibilité moyenne) → **mail** (barre vie-privée la plus haute, métadonnées seules par défaut).
- **MVP** = un `harvest-runner.ts` calqué sur `reminder-runner.ts`, git-only, curseur = dernier SHA, ingest dans le CKG. Testable no-mocks **sur le repo code-buddy lui-même**.

---

## 1. Les mécanismes d'OpenHuman à retenir

Source : `github.com/tinyhumansai/openhuman` (README + gitbook). Ce qu'il faut garder, ce qu'il faut adapter.

| Mécanisme OpenHuman | Description concrète | Verdict pour Code Buddy |
|---|---|---|
| **Memory Tree** | Données connectées → chunks Markdown **≤3k tokens**, scorés, pliés en arbres de résumé hiérarchiques, stockés dans SQLite (`memory_tree/chunks.db`) : chunks, scores, résumés, index d'entités, jobs, hotness — le tout dans **une transaction** (pas de lignes orphelines). | **À adapter, pas copier.** Code Buddy n'a pas de « tree » SQLite, mais le CKG (JSONL) + `EnhancedMemory` (SQLite+embeddings) + consolidation (`.codebuddy/memory/`) couvrent l'essentiel. On récolte vers ces stores. |
| **IDs content-addressed** | « Chunk IDs are content-addressed, so re-running ingest on identical input never produces duplicates. » | **Déjà présent.** Le CKG déduplique par `contentHash` : même id + même hash → renforce (`mentions++`), même id + texte différent → supersede. **Ne pas refaire de dédup.** |
| **Scoring 2 étages** | (1) « cheap fast-score » à l'ingest **sans appel LLM** → admis/rejeté ; (2) « deep score + entity extraction » **async** plus tard. | **À reprendre tel quel.** MVP = fast-score déterministe (heuristique de saillance) pour filtrer le bruit ; « deep » = l'`ingest()` du CKG (embeddings + auto-linking) déjà fait le lien d'entités. |
| **Trois arbres de résumé** | Sur le même flux de feuilles : **par source** (buffer L0 → seal L1 → cascade), **par entité** (« topic tree » matérialisé paresseusement par hotness), **global** (1 nœud par jour UTC). | **Reporter (tranche étendue).** Overkill pour le MVP. La consolidation (`memory-consolidation.ts`) et le dreaming (`dreaming.ts`) offrent déjà un résumé progressif ; on s'en sert si besoin d'agrégation. |
| **Auto-fetch** | Boucle **20 min**, 118+ connecteurs OAuth **opt-in par source** (via Composio), incrémental (curseurs/ETags). | **À reprendre : le cœur du gap.** Un runner périodique + curseurs par source. Chez Code Buddy : intervalle configurable, curseurs persistés localement. |
| **Canonicalisation Obsidian** | Les mêmes chunks atterrissent en `.md` browsables (`wiki/`), avec **provenance** (lien vers le chunk). | **Partiellement couvert.** `CODEBUDDY_MEMORY.md` et `.codebuddy/memory/MEMORY.md` sont déjà des `.md` browsables. Un « vault de récolte » browsable est une **tranche étendue** (nice-to-have de provenance). |
| **SuperContext** | Au 1er tour, un `context_scout` **read-only** balaye arbre + fichiers + données → **bundle borné** préfixé au message avant que le modèle ne lise. | **Déjà présent, sous un autre nom.** `injectInitialContext` (round-0) dans `context-pipeline.ts` fait exactement ça, gated par niveau de complexité, avec budget. **Ne pas construire un SuperContext parallèle** ; brancher la récolte sur ce canal. |
| **Backend-médié** | Le core OpenHuman **n'appelle jamais les APIs tierces directement** : tout passe par le backend OpenHuman (tokens jamais en clair, l'agent ne voit que les résultats). | **Divergence de posture assumée.** Code Buddy est **local-first** : les connecteurs sont des **MCP locaux** que *l'utilisateur* a déjà autorisés. Pas de backend intermédiaire — mais donc la lecture distante (Google) se fait via le MCP local, pas exfiltrée vers un tiers Code Buddy. À expliciter dans la section vie-privée. |
| **TokenJuice** | Compression de la sortie d'outils verbeux avant qu'elle n'entre en contexte. | **Analogue existant** : troncatures bornées (`READ_TRUNCATE_BYTES`), `formatCollectiveContext(maxChars=600)`, best-fit packing des lessons. On réutilise. |

**Ce qu'on garde, en une phrase** : *le runner d'auto-fetch incrémental (curseurs), le fast-score déterministe à l'ingest, la dédup content-addressed, et le pré-assemblage round-0 borné* — sauf que **3 de ces 4 briques existent déjà** chez Code Buddy. Seul le **runner d'auto-fetch** manque vraiment.

---

## 2. État de la mémoire Code Buddy (avec chemins exacts)

Ce que Code Buddy a **déjà**. Chaque brique est un composant sur lequel se greffer.

### 2.1 Mémoire persistante — `src/memory/persistent-memory.ts`
- Classe `PersistentMemoryManager extends EventEmitter`. Entrées `Memory { key, value, category, createdAt, updatedAt, lastAccessedAt?, accessCount, tags? }`.
- Catégories : `project | preferences | decisions | patterns | context | custom`.
- Fichiers : projet `.codebuddy/CODEBUDDY_MEMORY.md`, user `~/.codebuddy/memory.md` (multi-bot : `~/.codebuddy/bots/<botId>/…`). Format markdown browsable, sections par catégorie, méta en commentaire `<!-- meta: accessed=N created=… -->`.
- API : `remember()`, `replace()`, `recall()` (renforçant), `get()` (non-renforçant), `getRelevantMemories(query, limit)` (scoring overlap de mots + boost `accessCount`), `forget()`, `listArchived()`, `restoreFromArchive()`, `getRecentMemories()` (alimente `/memory recent`), `getContextForPrompt()`/`getHermesSnapshotForPrompt()` (injection prompt bornée).
- Garde-fous à l'écriture : `assertMemoryWriteSafe` (anti-injection/exfiltration), `assertScopeWithinLimit` (budget caractères).
- **Auto-writeback réel** = l'outil LLM `remember` (`src/tools/registry/memory-tools.ts` : `RememberTool`, `ReplaceMemoryTool`, `MemoryProposeTool`, `RecallTool`, `ForgetTool`), aussi exposé MCP (`src/mcp/mcp-memory-tools.ts`). Autres écrivains : `src/sensory/episodic-journal.ts` (`episode:recent`), `src/sensory/dreaming.ts` (`dream:recent`), `src/memory/memory-candidate-queue.ts` (file review-gated), `src/server/routes/memory.ts` (REST).

### 2.2 Oubli Ebbinghaus — `src/memory/memory-forgetting.ts`
- Rétention `retentionOf(ageDays, accessCount) = exp(−ageDays / stabilityDays)`, `stabilityDays = base·(1+accessCount)` (le rappel renforce). Défauts : `baseStabilityDays=14`, `retentionThreshold=0.05`, `minAgeDays=7`. Overrides `CODEBUDDY_MEMORY_FORGET_*`.
- Jamais oubliés : catégories `preferences`/`decisions`, tag `pinned`.
- `applyForgetting(scope)` **archive dans `*.archive.md` AVANT** suppression (fail-closed : archive inécrivable ⇒ rien supprimé). Déclenché par `dreaming.ts runForgettingPass()`, gaté `CODEBUDDY_MEMORY_FORGET=true`.

### 2.3 Consolidation — `src/memory/memory-consolidation.ts`
- Système **séparé** du `PersistentMemoryManager` (dossier `.codebuddy/memory/`). Phase 1 `extractMemoriesFromMessages` (scan des messages user contre `MEMORY_SIGNALS`), phase 2 `consolidateMemories` → `MEMORY.md` (dédup ligne + overlap >60%, verrou `.lock`), `memory_summary.md` (≤2000 chars), `rollout_summaries/<slug>.md` (purge >30). `loadMemorySummary()` pour injection.

### 2.4 CKG (Collective Knowledge Graph) — `src/memory/collective-knowledge-graph.ts`
- Classe `CollectiveKnowledgeGraph`. **Ledger append-only JSONL** `<home>/collective/ckg-ledger.jsonl` (`appendFileSync` O_APPEND, reconstruit en mémoire par `load()`). Événements `entity | relation | retraction`.
- Entrée `CkgRememberInput { text, type?, name?, relations?, agentId?, source?, confidence? }`. Id façon Code-Explorer `Type:collective:name` (dédup par name dérivé du texte).
- `remember()` (redaction de secrets `scanForSecrets`/`redactSecrets`, jamais throw), **`ingest()`** (stocke en `'discovery'` + **auto-lie** aux voisins sémantiques via embeddings multilingues, arêtes `related_to`/`supports`/`contradicts`), `recall()` (keyword × salience × corroboration, synchrone), **`recallHybrid()`** (voir 2.5), `retract()` (tombstone réversible), `formatCollectiveContext(query, maxChars=600)` (bloc `<collective_knowledge>` pour le prompt).
- Bi-temporel : même hash → renforce ; texte différent → supersede. Embeddings dédiés `Xenova/paraphrase-multilingual-MiniLM-L12-v2`.
- **Câblage réel** : `src/research/auto-ingest.ts`, `src/commands/research/knowledge-ingest.ts` (CLI `buddy research`), et surtout **`src/agent/execution/context-pipeline.ts` (`formatCollectiveContext` injecté au prompt, gated `CODEBUDDY_COLLECTIVE_MEMORY==='true'`)**.
- ⚠️ **Correction vs doc interne** : `CODEBUDDY_CKG_ENGINE=rust` **n'existe pas dans le code**. Le CKG est 100% TS/JSONL. Le dossier `buddy-memory/` ne contient que `target/` (binaire compilé, **pas de source, non suivi par git**) — c'est un **stub non câblé** (statut confirmé par `src/tools/self-describe.ts` : « stub — pas de source dans ce checkout »). **Ne pas s'appuyer dessus pour ce design.**

### 2.5 Recherche hybride MMR — `src/memory/hybrid-mmr.ts`
- `fuseHybrid()` = Reciprocal Rank Fusion pondéré (lexical + sémantique, `semanticWeight=0.7`, `rrfK=60`) sur les **rangs**, `× prior`. `mmrSelect()` = sélection gloutonne `argmax λ·rel − (1−λ)·max_sim` (diversité cosinus, `lambda=0.7`). `hybridMmrRank()` = les deux.
- Consommateur : `CollectiveKnowledgeGraph.recallHybrid()` (embed requête + candidats, cache par `contentHash`, **dégrade vers keyword si embeddings échouent**, `prior = (0.7 + 0.3·salience)·corroborationBoost`).
- Autre pile hybride distincte (SQLite `EnhancedMemory`) : `src/memory/hybrid-search.ts`, `src/memory/semantic-memory-search.ts` — servent `AgentContextFacade`, à ne pas confondre avec le CKG.

### 2.6 Injection par tour (le « SuperContext » existant) — `src/agent/execution/context-pipeline.ts`
- `injectInitialContext()` (**round 0 uniquement**) pousse des messages `system` gated par `deps.ctxLevel` : workspace, lessons, user-model, **knowledge-graph, collective KG** (`formatCollectiveContext`), decision, ICM, code graph, docs, todo. Chaque provider en `try/catch` + `withTimeout(promise, 3000, fallback)`.
- `injectNextRoundContext()` (rounds ≥1) : ré-injecte lessons + user-model + todo ; KG gated `complex`. Câblage : `agent-executor.ts` (`if toolRounds===0 …`).
- Gating : `src/agent/execution/query-classifier.ts` (`trivial|simple|complex`, table `INJECTION_LEVELS`, économise ~15-20K tokens sur trivial).
- `<lessons_context>` : `src/agent/lessons-tracker.ts buildContextBlock()`, budget **2000 chars**, ranking BM25, best-fit packing `RULE→PATTERN→CONTEXT→INSIGHT`, cache 5s. `<todo_context>` : `src/agent/todo-tracker.ts buildContextSuffix()`.
- `AgentContextFacade` (`src/agent/facades/agent-context-facade.ts`) : gère `EnhancedMemory` (SQLite+embeddings) cross-session (`getMemoryContext(query)`), **n'injecte PAS** le per-turn (c'est le pipeline).
- **Aucun symbole `SuperContext`.** Point de greffe d'un pré-assemblage = ajouter un bloc gated dans `injectInitialContext`, ou (mieux) laisser le CKG le porter.

### 2.7 Runners périodiques (modèles à réutiliser)
- **Reminders** : `src/companion/reminder-runner.ts` — `runReminderTick(now, deps)` (UNE passe, **never-throws**, deps injectables), `wireReminderRunner(deps)` (`setInterval` `CODEBUDDY_REMINDER_TICK_MS` défaut 60s, `timer.unref()`, teardown retourné, restaure l'état au boot). Store JSON `src/companion/reminders.ts` (`~/.codebuddy/reminders.json` atomique via `rename` + JSONL append-only). **Indépendant du serveur.**
- **Heartbeat** : `src/sensory/heartbeat-scheduler.ts` — `HeartbeatTask { name, everyBeats, handler }`, fire quand `beat % everyBeats === 0`, garde `beatInFlight`.
- **Dreaming / journal épisodique** : `src/sensory/dreaming.ts`, `src/sensory/episodic-journal.ts` — cœur pur + wrapper never-throws, écrivent en mémoire persistante.
- **Pattern commun** : cœur pur testable + wrapper best-effort (try/catch → `logger.warn`) ; deps injectables ; cadence par env ; opt-in default-OFF (`!== 'true'` → early return) ; `timer.unref()` ; persistance JSON/JSONL atomique sous `~/.codebuddy/`.

### 2.8 Connecteurs déjà branchés
- **MCP** : registre `src/mcp/connectors.ts` (`ConnectorRegistry`, serveurs pré-configurés `google-calendar`/Gmail/Drive en `npx`). Appel **programmatique** (hors LLM) : `McpManager.callTool(toolName, args)` (`src/tools/mcp/mcp-manager.ts`) et `MCPManager.callTool` (`src/mcp/client.ts`). Usages directs existants : `web-search.ts`, `scripting/codebuddy-bindings.ts`, `plugins/code-explorer/…`.
- **Le modèle le plus proche d'un récolteur** : `src/memory/icm-bridge.ts` — `ICMBridge` détecte la dispo via `getConnectedServers()`, appelle `create_memory`/`search_memory`/`get_recent_memories` sur le serveur MCP `icm`, **et est déjà consommé round-0** par `injectInitialContext` (l'`icmBridgeProvider`). C'est le patron exact d'un pont MCP → mémoire.
- **Activité git déjà minée** : `src/analytics/codebase-heatmap.ts` (`execSync` `git log --numstat --name-only`, churn/authors par fichier), `src/intelligence/proactive-suggestions.ts` (uncommitted, jours depuis dernier commit). Plus `simple-git`/`git log` dans `git/worktree-sessions.ts`, `integrations/github-integration.ts`, `checkpoints/ghost-snapshot.ts`, `tools/changelog-generator.ts`.
- **Fleet** : `src/fleet/peer-tool-bridge.ts` expose des tools **read-only** aux peers (`view_file`/`list_directory`/`search`, `fleetSafe`, fail-closed sans workspace root). **Mauvais axe pour la récolte** (c'est du peer-to-peer, pas de l'ingestion de sources personnelles) — à ne pas confondre.

### 2.9 Garde-fous vie-privée réutilisables
- `src/fleet/privacy-lint.ts` : `scanForSecrets(prompt)` (JWT, AWS key, SSN, IBAN, téléphone E.164, carte Luhn), `redactSecrets()` → `[REDACTED:<kind>]`, `redactPreview()`.
- `src/security/secrets-detector.ts` : `scanFileForSecrets()`, `scanForSecrets()` récursif, `redactSecret()` (4 chars + `***`), tool `scan_secrets`. **Jamais le secret en clair en sortie.**
- `src/security/skill-scanner.ts` : `scanSkillFirewall()` (eval/child_process/rm-rf/fetch → verdict bloquant).
- Postures : **opt-in default-OFF** (`!== 'true'`), **fail-closed** (root/scope absent ⇒ aucune action), **jamais secret/PII en clair**, **read-only-by-default** (fleet), **loopback par défaut** (`src/server/index.ts` réécrit `0.0.0.0`→`127.0.0.1`, WARNING si bind non-loopback), **never-throws** pour tout best-effort.

---

## 3. Le gap réel

**Confirmé par lecture du code, sans nuance importante :**

> La mémoire de Code Buddy est **entièrement pilotée par l'agent en réaction à la conversation**. L'agent décide d'appeler l'outil `remember` (ou `memory_propose`), et c'est la seule voie d'écriture « intelligente ». Les runners sensory (`dreaming`, `episodic-journal`) consolident ce qui a **déjà été perçu/dit**. **Aucun composant ne va, de sa propre initiative et périodiquement, LIRE une source externe (git, calendar, mail) pour en extraire des faits et les plier dans la mémoire.**

Preuves :
1. `autoCapture(message, response)` dans `persistent-memory.ts` — la seule méthode qui ressemble à une extraction automatique — **n'a aucun appelant vivant** (grep sur `src/` : zéro `.autoCapture(` hors du fichier).
2. Les seuls « moissonneurs » périodiques (`dreaming`, `episodic-journal`) travaillent sur le **buffer sensoriel / le dialogue entendu**, pas sur des sources de travail (repos, agenda, boîte mail).
3. `codebase-heatmap.ts` lit bien `git log`, mais **pour un rapport à la demande**, pas pour alimenter la mémoire long-terme.
4. Le CKG a un `ingest()` parfait pour recevoir des faits récoltés, mais ses seuls producteurs actuels sont `buddy research` (web) et l'auto-amélioration — **jamais une source personnelle de l'utilisateur**.

**Nuance honnête** : ce n'est PAS un gap de *stockage/recall/injection* (tout ça existe et est mûr). C'est un gap de **producteur amont** : il manque le « bras » qui va chercher, et le curseur qui évite de retravailler l'identique. C'est un **manque étroit et bien défini**, ce qui est une bonne nouvelle pour le coût d'implémentation.

---

## 4. Design incrémental greffé sur l'existant

**Principe directeur** : l'auto-récolte est un **producteur** (`Harvester`) + un **runner** (`harvest-runner`), qui **écrivent dans le CKG existant** (et éventuellement la mémoire persistante). **Aucun store neuf, aucun retrieval neuf, aucune injection neuve.**

### 4.1 Vue d'ensemble du flux

```
                       [ harvest-runner.ts ]  ← setInterval, opt-in, never-throws (modèle reminder-runner)
                              │  runHarvestTick(now, deps)
        ┌─────────────────────┼─────────────────────┐
   git source            calendar source         mail source        ← Harvester par source (opt-in indépendant)
   (execSync git log)    (McpManager.callTool)   (McpManager.callTool)
        │                     │                        │
        │  curseur=SHA        │ curseur=syncToken      │ curseur=historyId   ← cursors.json (évite le re-travail)
        ▼                     ▼                        ▼
        └──────────► normalize → HarvestItem[] ────────┘
                              │
                    fast-score (déterministe, sans LLM) → admis / rejeté   ← anti-bruit (mécanisme OpenHuman)
                              │
                    scanForSecrets + redactSecrets                          ← vie privée (réutilise privacy-lint)
                              │
                    ckg.ingest({ text, type, source:'harvest:git', … })    ← STORE EXISTANT (dédup contentHash + auto-link)
                              │
                    (option) mm.remember(key, value, {category, tags})      ← si fait « utilisateur » browsable
                              │
        ═══════════════ plus tard, boucle agent ═══════════════
                              │
   context-pipeline.injectInitialContext → formatCollectiveContext(query)  ← DÉJÀ CÂBLÉ (round-0, MMR, budget 600 chars)
                              │
                    le fait récolté remonte tout seul dans le contexte
```

### 4.2 Sources & canaux (par priorité valeur/risque)

| Source | Canal | Curseur | Valeur | Risque vie-privée | Tranche |
|---|---|---|---|---|---|
| **Activité git / repos** | `execSync git log` (déjà dans `codebase-heatmap.ts`) — **zéro connecteur neuf** | dernier SHA récolté par repo | Haute : « sur quoi j'ai travaillé récemment » remonte round-0 | **Basse** : commits déjà locaux/publics (auteurs, messages) | **MVP** |
| **Calendar** | MCP `google-calendar` (`connectors.ts`) via `McpManager.callTool` — patron `ICMBridge` | `syncToken` Google | Haute : agenda/échéances, se marie avec les reminders existants | Moyenne : événements = données perso | 1 |
| **Mail** | MCP Gmail via `McpManager.callTool` | `historyId` Gmail | Moyenne : contexte de fils, décisions par écrit | **Haute** : contenu sensible | 2 (métadonnées seules par défaut) |
| **Drive/Docs** | MCP Drive | `changes` pageToken | Basse/Moyenne | Haute | Ultérieur |

**Décision de canal** : git en direct (déjà présent, pas de MCP requis, testable offline) ; calendar/mail via **`McpManager.callTool` programmatique** en copiant le patron `ICMBridge` (détection de dispo via `getConnectedServers()`, jamais throw si le serveur MCP n'est pas connecté). **Pas le fleet** (mauvais axe). **Pas un nouveau connecteur** (réutilise `connectors.ts`).

### 4.3 Cadence (runner)

- **Modèle** : `reminder-runner.ts`. Un nouveau `src/companion/harvest-runner.ts` (ou `src/memory/harvest/…`) avec :
  - `runHarvestTick(now, deps): Promise<HarvestReport>` — cœur pur, deps injectables (`{ clock, ckg, memory, sources, cursorStore }`), **never-throws** (chaque source en try/catch → `logger.warn`).
  - `wireHarvestRunner(deps)` — `setInterval` sur `CODEBUDDY_HARVEST_TICK_MS` (**défaut 20 min**, alignés OpenHuman ; git peut tolérer plus court, mail plus long), `timer.unref()`, teardown retourné. Câblé une fois dans `buddy server` (comme `wireReminderRunner`), **indépendant du daemon sensory**.
- **Curseurs** — `~/.codebuddy/harvest/cursors.json` (atomique via `rename`, comme `reminders.json`) : `{ "git:<repoPath>": "<sha>", "calendar": "<syncToken>", "mail": "<historyId>" }`. **C'est ça qui évite de retravailler l'identique** au niveau *fetch*. La dédup au niveau *contenu* est ensuite garantie par le `contentHash` du CKG (ceinture + bretelles, comme OpenHuman : curseur ET content-addressed).
- **Backpressure** : un `harvest.lock` (flag `wx`, comme le `.lock` de la consolidation) pour ne pas chevaucher deux passes ; skip si une passe tourne encore.

### 4.4 Traitement (normalize → score → store)

1. **Normalisation** — chaque source produit des `HarvestItem { source, externalId, timestamp, text, entities?, salienceHint? }`. Exemples :
   - git : 1 commit → `text` = message + fichiers touchés + churn ; `externalId` = SHA ; entités = chemins/modules.
   - calendar : 1 événement → titre + date + participants (⚠️ redaction) ; `externalId` = eventId.
   - mail : 1 fil → **sujet + expéditeur + label** (PAS le corps par défaut) ; `externalId` = threadId.
2. **Fast-score déterministe (sans LLM)** — heuristique de saillance pour **admettre/rejeter** (mécanisme OpenHuman, mais 100% local) : longueur utile, présence d'entités connues, récence, source-weight. Rejette le bruit (merges auto, notifications, newsletters). **Seuil configurable** ; par défaut conservateur (admettre peu).
3. **Redaction** — `scanForSecrets` + `redactSecrets` (`privacy-lint.ts`) sur chaque `text` **avant** ingest. Le CKG `remember()`/`ingest()` re-redacte de toute façon (ceinture + bretelles). Un fichier/commit contenant un secret → item **droppé** (pas juste redacté), par prudence.
4. **Compression en chunks ≤ N tokens** — pour les sources verbeuses (fil mail), **MVP = extraction structurée déterministe** (pas de résumé LLM → coût nul, pas de fuite). Un résumé LLM (routé via le sélecteur latence `src/fleet/model-selector.ts`, ou local-only) est une **tranche étendue** optionnelle, jamais dans le MVP.
5. **Store** — `ckg.ingest({ text, type:'discovery', name, source:'harvest:<src>', confidence, autoLinkK })`. Le CKG **déduplique (contentHash), auto-lie sémantiquement, redacte, et est append-only + réversible (`retract`)**. Optionnellement, pour un fait « utilisateur » stable et browsable (ex. « échéance train le 12 »), aussi `mm.remember(key, value, { category:'context', tags:['harvested','source:calendar'] })` — mais **ne pas dupliquer** dans les deux à l'aveugle : préférer le CKG comme source de vérité, la mémoire persistante seulement pour ce qui doit être **browsable/éditable à la main** ou **piloter les reminders**.
6. **Dédup contre la mémoire existante** — avant `remember()`, un `getRelevantMemories(text)` (overlap) pour ne pas ré-écrire un fait que l'agent a déjà noté depuis la conversation. Côté CKG, la dédup par name/hash s'en charge nativement.

### 4.5 Intégration boucle agent / SuperContext (quasi-gratuite)

- **Ne rien construire.** Les faits récoltés atterrissent dans le CKG → `formatCollectiveContext(query, maxChars=600)` les fait remonter **round-0** dans `injectInitialContext` (gated `CODEBUDDY_COLLECTIVE_MEMORY==='true'`), **déjà rangés par `recallHybrid` (MMR = diversité + pertinence, budget borné)**. Le budget de tokens est **déjà respecté** (maxChars + MMR).
- Si on veut un bloc dédié « ce sur quoi tu travailles » distinct du CKG général, l'ajouter comme **un provider optionnel de plus dans `injectInitialContext`** (patron `try/catch` + `withTimeout`), gated par un flag `ctxLevel.harvest` + `CODEBUDDY_HARVEST_CONTEXT==='true'`, budget en chars comme les lessons (2000). Mais **le canal CKG suffit pour le MVP**.
- **Tag de provenance** : chaque fait récolté porte `source:'harvest:<src>'` → filtrable, auditable, purgeable, et distinguable des faits appris en conversation.

### 4.6 Vault browsable & provenance (analogue Obsidian — tranche étendue)

- Optionnel : miroir `.md` browsable des faits récoltés sous `.codebuddy/harvest/<source>/*.md` (ou une section dédiée de `CODEBUDDY_MEMORY.md`), avec lien de provenance (SHA/eventId/threadId). Code Buddy a déjà des `.md` mémoire browsables ; ceci ne fait qu'étendre la surface. **Pas nécessaire au MVP** (le CKG JSONL + `buddy` CLI d'inspection suffisent).

---

## 5. Vie privée (section critique)

**Posture** : alignée strictement sur l'existant Code Buddy (opt-in default-OFF, fail-closed, jamais de secret en sortie, local-first). **Plus stricte** qu'OpenHuman sur un point : pas de backend intermédiaire — la lecture distante passe par le **MCP local que l'utilisateur a lui-même autorisé**, l'écriture est **100% locale**.

| Exigence | Mécanisme concret | Réutilise |
|---|---|---|
| **Opt-in explicite par source** | `CODEBUDDY_HARVEST=true` (maître, default OFF) **ET** un flag par source : `CODEBUDDY_HARVEST_GIT`, `_CALENDAR`, `_MAIL` (tous `!== 'true'` ⇒ early-return). Aucune source active par défaut. | Pattern `proactive-engine.ts`/`dreaming.ts` |
| **Fail-closed** | Pas de MCP connecté ⇒ source skippée (jamais d'erreur, jamais de fetch partiel). Pas de repo root ⇒ git skippé. Pas de `CODEBUDDY_HARVEST` ⇒ le runner ne se câble même pas. | `peer-tool-bridge.ts` (`PEER_WORKSPACE_NOT_CONFIGURED`), autonomy root |
| **Ne JAMAIS récolter** | (a) secrets → `scanForSecrets` **drop** l'item (pas de redaction « best effort », drop pur) ; (b) corps de mail par défaut (métadonnées seules) ; (c) repos/labels explicitement en denylist (`CODEBUDDY_HARVEST_DENY`, ex. repos privés clients, label Gmail « Confidential ») ; (d) PII détectée (SSN/IBAN/carte) → drop. | `privacy-lint.ts`, `secrets-detector.ts` |
| **Stockage local, pas d'exfiltration** | Tout écrit sous `~/.codebuddy/` (CKG ledger, cursors, vault). Aucun envoi réseau côté écriture. Le seul trafic réseau = les **lectures MCP** (Google), via le connecteur **déjà autorisé** par l'utilisateur — à documenter explicitement (ce n'est pas Code Buddy qui exfiltre, c'est l'utilisateur qui lit sa propre boîte via son propre token). | Loopback-only `server/index.ts` |
| **Consentement** | Premier lancement d'une source : `buddy harvest enable <source>` demande confirmation + affiche ce qui sera récolté et ce qui ne le sera jamais. Le flag env seul ne suffit pas pour mail (double opt-in : env + `buddy harvest consent mail`). | Modèle des modales keep/redact du privacy-lint |
| **Effacement / droit à l'oubli** | `buddy harvest purge [--source <s>]` : `ckg.retract()` (tombstone réversible) sur tous les faits `source:harvest:*`, `mm.forget()` sur les entrées taggées `harvested`, reset des curseurs. L'oubli Ebbinghaus (`CODEBUDDY_MEMORY_FORGET`) fait décroître naturellement les faits non-rappelés. | `ckg.retract`, `memory-forgetting.ts` |
| **Auditabilité** | Journal `~/.codebuddy/harvest/harvest-log.jsonl` (que récolté, quand, admis/droppé, jamais le contenu secret). Provenance `source:harvest:<src>:<externalId>` sur chaque fait. | JSONL append-only (reminders/dreaming) |
| **Redaction en sortie** | Aucun secret/PII n'entre dans le CKG (droppé en amont) ; `formatCollectiveContext` ne peut donc pas fuiter un secret dans le prompt. | `redactSecrets`, CKG built-in redaction |

**Règle d'or mail** : par défaut **métadonnées seulement** (sujet/expéditeur/label/date). Le corps n'est récolté que sous **triple garde** : `CODEBUDDY_HARVEST_MAIL=true` + `CODEBUDDY_HARVEST_MAIL_BODY=true` + `buddy harvest consent mail --body`. Et même alors, `scanForSecrets` drop tout fil contenant un secret.

---

## 6. Plan en tranches (MVP d'abord)

Chaque tranche est **livrable, testable no-mocks, et sans régression** (opt-in default-OFF ⇒ zéro changement de comportement tant que non activée).

### Tranche 0 — MVP : récolte git → CKG
- **Portée** : `harvest-runner.ts` (`runHarvestTick` + `wireHarvestRunner`), source `git` uniquement (`execSync git log --numstat` façon `codebase-heatmap.ts`), curseur SHA (`cursors.json`), fast-score déterministe, `scanForSecrets` drop, `ckg.ingest({ source:'harvest:git' })`. Câblage `buddy server` gated `CODEBUDDY_HARVEST=true` + `CODEBUDDY_HARVEST_GIT=true`. CLI minimale `buddy harvest status|run-once|purge`.
- **Test no-mocks** : lancer `runHarvestTick` sur le **repo code-buddy lui-même** ; vérifier que les commits récents deviennent des faits CKG, que relancer ne duplique pas (curseur + contentHash), qu'un commit factice contenant un faux secret est droppé, que `formatCollectiveContext('récent')` les fait remonter.
- **Valeur** : haute (contexte de travail récent round-0). **Risque** : bas (données git locales, aucun MCP, aucune PII nouvelle).

### Tranche 1 — Calendar via MCP
- **Portée** : source `calendar` (patron `ICMBridge` + `McpManager.callTool` sur `google-calendar`), curseur `syncToken`, redaction participants, `ckg.ingest` + option `mm.remember` pour les échéances (se marie aux reminders). Flag `_CALENDAR` + consentement.
- **Test no-mocks** : contre un calendrier de test réel (ou l'agenda de Patrice en opt-in) ; vérifier incrémental (syncToken), pas de re-fetch, remontée agenda.
- **Valeur** : haute (agenda + reminders). **Risque** : moyen (données perso, mais métadonnées d'événements).

### Tranche 2 — Mail (métadonnées) via MCP
- **Portée** : source `mail` (Gmail MCP), curseur `historyId`, **métadonnées seules** (sujet/expéditeur/label), triple opt-in, drop sur secret. `ckg.ingest`.
- **Test no-mocks** : boîte de test ; vérifier qu'aucun corps ne fuit, que les fils sensibles (label denylist) sont skippés, incrémental.
- **Valeur** : moyenne. **Risque** : haut → garde-fous maximaux.

### Tranche 3 — Fast-score enrichi + deep-score optionnel
- **Portée** : deep-score LLM async (routé latence/local-only) + extraction d'entités enrichie ; hotness d'entité (clustering léger) pour prioriser ce qui est récolté. Reste **optionnel** (le CKG auto-linke déjà).
- **Valeur** : moyenne (moins de bruit, meilleur ciblage). **Risque** : coût LLM → gardé opt-in.

### Tranche 4 — Vault browsable + provenance + consolidation
- **Portée** : miroir `.md` browsable `.codebuddy/harvest/`, liens de provenance, passe de consolidation (réutilise `memory-consolidation.ts`/dreaming) pour plier les faits récoltés en résumés (analogue des « summary trees » OpenHuman, si le volume le justifie).
- **Valeur** : moyenne (inspectabilité, moins d'entrées brutes). **Risque** : bas.

**Ordre non négociable** : git (0) avant tout MCP (1-2), car il valide toute la mécanique (runner, curseur, fast-score, ingest, remontée round-0) **sans aucun risque vie-privée ni dépendance MCP**.

---

## 7. Anti-redondance — ce que Code Buddy A DÉJÀ et qu'il ne faut PAS refaire

| Tentation | Déjà couvert par | Ne pas faire |
|---|---|---|
| Dédup content-addressed | CKG `contentHash` (renforce/supersede) | Un index de hash maison |
| Retrieval sémantique + diversité + budget | `hybrid-mmr.ts` + `recallHybrid` | Un ranker/MMR neuf |
| Injection round-0 bornée (« SuperContext ») | `context-pipeline.ts injectInitialContext` + `formatCollectiveContext` (600 chars, MMR) | Un « context_scout »/SuperContext parallèle |
| Redaction de secrets/PII | `privacy-lint.ts`, `secrets-detector.ts`, redaction CKG | Un scanner de secrets neuf |
| Scaffolding de runner périodique | `reminder-runner.ts` (`setInterval`/unref/never-throws/curseurs JSON atomiques) | Un scheduler neuf |
| Oubli / décroissance | `memory-forgetting.ts` (Ebbinghaus, archive avant delete) | Un TTL/GC maison |
| Consolidation / résumés progressifs | `memory-consolidation.ts`, `dreaming.ts` | Des « summary trees » SQLite from scratch |
| Appels MCP programmatiques aux connecteurs | `McpManager.callTool` + patron `ICMBridge` | Une couche de connecteurs neuve (surtout pas Composio) |
| Store `.md` browsable | `CODEBUDDY_MEMORY.md`, `.codebuddy/memory/` | Un vault Obsidian complet (au mieux un miroir léger, tranche 4) |
| Mining git | `codebase-heatmap.ts` (`git log --numstat`) | Réécrire le parsing git log |
| Graphe de connaissance + ledger réversible | CKG (`collective-knowledge-graph.ts`, JSONL append-only, `retract`) | Une base graphe neuve |

**Corollaire** : le code neuf réel se limite à ~ `harvest-runner.ts` + un `Harvester` par source + un `cursor-store.ts` + un `fast-score.ts` + le câblage CLI/serveur. **Tout le reste est de la composition de briques existantes.**

---

## 8. Risques & points de vigilance

1. **Trafic réseau des lectures MCP** — la récolte calendar/mail LIT chez Google via le MCP. Ce n'est pas une exfiltration (token de l'utilisateur, sa propre donnée), mais **à documenter clairement** dans le consentement. L'écriture reste 100% locale. Le MVP git n'a **aucun** trafic réseau.
2. **Bruit / gonflement du CKG** — sans fast-score strict, on inonde le ledger. Mitigation : seuil d'admission conservateur, source-weights, `retract`/oubli Ebbinghaus pour purger, journal d'audit admis/droppé.
3. **Scaling du ledger CKG** — `load()` rejoue tout le JSONL en mémoire (limitation connue, notée dans la mémoire projet : « reste scaling ANN/SQLite »). Une récolte continue accélère la croissance. Mitigation MVP : cadence modérée + fast-score ; à terme, la bascule CKG→SQLite/Rust (le stub `buddy-memory/`) devient plus pressante — **mais c'est un chantier CKG indépendant, pas un blocage de la récolte**.
4. **Coût LLM du deep-score** — gardé hors MVP (déterministe d'abord). Si activé : router latence/local-only, borné.
5. **Curseurs incohérents** — un `syncToken`/`historyId` expiré (Google) force un full-resync. Gérer le fallback (fenêtre temporelle bornée) sans re-récolter tout l'historique ; la dédup contentHash amortit un re-fetch accidentel.
6. **PII des auteurs git** — les emails d'auteurs de commits entrent dans les faits. Faible risque (déjà public dans git), mais prévoir de ne récolter que le message + fichiers, pas forcément l'email d'auteur.
7. **Confusion mémoire-conversation vs récolte** — un fait récolté ne doit pas écraser un fait plus riche noté par l'agent. Mitigation : tag `source:harvest:*` + `getRelevantMemories` pré-check + confiance récolte < confiance conversation.
8. **Divergence doc interne** — la doc/mémoire projet mentionne `CODEBUDDY_CKG_ENGINE=rust` et un sidecar Rust câblé : **c'est faux dans le code actuel** (stub). Ne pas concevoir la récolte en supposant le moteur Rust ; rester sur le CKG TS/JSONL.

---

## 9. Décision demandée à Patrice

- **Valider la thèse du gap** (mémoire agent-written, jamais auto-moissonnée) et le principe « producteur greffé sur le CKG, pas de système parallèle ».
- **Valider l'ordre des tranches** (git MVP d'abord, mail en dernier).
- **Trancher la posture mail** (métadonnées seules par défaut : OK ?).
- **Trancher le store canonique** : CKG seul comme source de vérité (recommandé), mémoire persistante uniquement pour le browsable/reminders.
- Go/No-go **Tranche 0 uniquement** pour commencer (petit, sûr, prouvable sur le repo lui-même).

*Aucune ligne de code écrite. Ce document est un plan à valider.*
