# Propositions d'amélioration — Chat GitNexus desktop

> **Version :** 1.0 — 29/04/2026
> **Auteur :** Claude Opus 4.7 (1M ctx) sur demande de Patrice Huetz
> **Périmètre :** Chat desktop de `gitnexus-rs` (interface principale d'usage par Patrice, daily driver)
> **Méthode :** Audit Explore agent (~45 fichiers / ~3500 lignes lus) + lecture mémoires projet + comparaison concurrence (Cursor, Claude Code, Cline)
> **Statut :** Document d'orientation à valider par Patrice. Pas une roadmap engagée.

---

## Sommaire

1. [Synthèse exécutive](#1-synthèse-exécutive) — 1 page scannable
2. [État des lieux factuel](#2-état-des-lieux-factuel) — ce qu'est le chat aujourd'hui
3. [Propositions par vague](#3-propositions-par-vague) — 11 propositions classées
4. [Prioritisation argumentée](#4-prioritisation-argumentée) — ordre de bataille recommandé
5. [Estimations cumulées](#5-estimations-cumulées) — 50-65 j/h sur 3 mois
6. [Risques + dépendances](#6-risques--dépendances) — anti-patterns à éviter
7. [Mise en œuvre suggérée](#7-mise-en-œuvre-suggérée) — briefs courts par proposition

---

## 1. Synthèse exécutive

Le chat desktop de gitnexus-rs est aujourd'hui un **outil agentic mature** : 5 modes, 10 tools, agent loop 2-8 itérations selon classification keyword, sessions persistées avec fork/pin/retry, syntax highlighting Shiki + Mermaid + GFM, persistent memory (global + per-project).

Mais il a **3 dettes de conception** qui freinent son évolution :

1. **Heuristiques hardcodées** — la classification de question (Lookup/Impact/Functional/Algorithm/Architecture) impose des tools à pré-fetcher et un budget d'itérations rigide. Le LLM ne choisit pas ses outils, il subit les nôtres.
2. **Pas de sub-agents** — Phase F reportée, ~3-5 j estimés. Le chat principal ne peut pas déléguer une recherche profonde à un sous-agent autonome dans son contexte propre. Conséquence : les questions architecture explosent l'historique de la session principale.
3. **Branche `feat/semantic-search` en attente** — 19 commits prêts, bench Alise = 67 % strictly improved, mais pas mergée. Le chat reste sur BM25 only, sans hybrid + reranker LLM.

**Roadmap proposée en 3 vagues** :

| Vague | Horizon | Effort | Livrable |
|---|---|---|---|
| **A** Quick unblocks + polish | 1 semaine | 5 j/h | semantic search dispo, memory propre, config UI complète |
| **B** Capabilités majeures | 2-3 semaines | 12-15 j/h | sub-agents (Phase F), LLM-driven tool selection, streaming |
| **C** Discriminants commerciaux | 1-2 mois | 25-35 j/h | continuous docs, refactoring graph-aware, dead code reports |

**Recommandation forte** : **commencer par Vague A**. Coût faible (5 j/h), résultats immédiatement visibles, débloque une branche qui végète depuis 1 semaine. Puis prioriser **B1+B2** (sub-agents + LLM-driven tools) qui sont le **discriminant face à la concurrence** Cursor / Claude Code / Cline.

---

## 2. État des lieux factuel

### 2.1 Architecture backend Rust

| Fichier | Volume | Rôle |
|---|---|---|
| `crates/gitnexus-desktop/src/commands/chat.rs` | ~3300 lignes | Orchestration agent loop, system prompt, tool definitions |
| `crates/gitnexus-desktop/src/commands/chat_executor.rs` | ~500 lignes | Plan executor (DAG steps avec dépendances) |
| `crates/gitnexus-desktop/src/commands/chat_planner.rs` | ~600 lignes | Analyse de requête, classification keyword-based |
| `crates/gitnexus-desktop/src/types.rs` | ~200 lignes | `ChatConfig`, `ChatRequest`, `ChatResponse`, `ResearchPlan` |

**Pipeline observé** :
```
Question → classify_question() → search_relevant_context() (FTS BM25)
  → build_sources() → build_system_prompt()
  → LLM streaming completion (max 8 iterations selon type)
  → tool execution loop (10 tools)
  → final answer + sources
```

**Classification keyword-based** (5 types) :
- `Lookup` (« où est », « où se trouve ») → 2 itérations
- `Impact` (« dépendance », « blast radius ») → 3 itérations
- `Functional` (« comment fonctionne ») → 5 itérations
- `Algorithm` (« comment calculé », « algorithme ») → 8 itérations
- `Architecture` (« vue d'ensemble », « overview ») → 8 itérations

**System prompt ~2800 caractères** comprenant :
- Identity + nom du repo
- Règle obligatoire : flowchart Mermaid pour questions Algorithme/Calcul
- Schema du graphe (node types, relationships)
- Modules fonctionnels (top 10 par taille)
- Business processes (top 5)
- Persistent memory (facts globaux + per-project)
- Prefetched results (heuristique pré-exécutée)
- Enriched module docs (LLM-generated)
- Code context (top 10 sources avec callers/callees/snippets)

**10 tools exposés à l'agent** :

| # | Tool | Rôle |
|---|---|---|
| 1 | `search_code(query)` | FTS + graph traversal → symbols + snippets |
| 2 | `read_file(path, start_line?, end_line?)` | Lecture source (max 50 lignes) |
| 3 | `get_impact(target, direction, max_depth)` | BFS upstream/downstream |
| 4 | `get_symbol_context(symbol)` | 360° (callers, callees, imports, module) |
| 5 | `execute_cypher(query)` | Read-only Cypher (MATCH/CALL only) |
| 6 | `search_processes(query)` | Business process flows |
| 7 | `get_process_flow(keyword)` | Process metadata |
| 8 | `get_diagram(target, type)` | Mermaid auto-généré |
| 9 | `read_method(symbol)` | Méthode complète (250 lignes max) |
| 10 | `save_memory(fact, scope)` | Persist fact globally / per-project |

**Configuration LLM** : stockée à `~/.gitnexus/chat-config.json`. Supporte OpenAI, Anthropic, OpenRouter, Gemini, Ollama. Options exposées : `provider`, `base_url`, `model`, `max_tokens`, `reasoning_effort` (Gemini). API key hydratée depuis env si absente du fichier. Fallback : si LLM indisponible, retourne `build_graph_only_response()`.

**Anti-pattern détecté** — Gemini 2.5-flash annonce intent (« je vais rechercher ») sans émettre de tool_call structuré → fallback auto-execute `search_code` sur la question user pour forcer le progrès (chat.rs:1020-1086).

### 2.2 Architecture frontend React 19

| Fichier | Volume | Rôle |
|---|---|---|
| `crates/gitnexus-desktop/ui/src/components/chat/ChatPanel.tsx` | ~600 lignes | Container principal, modes |
| `crates/gitnexus-desktop/ui/src/components/chat/ChatMessage.tsx` | ~300 lignes | Rendu message + artifacts |
| `crates/gitnexus-desktop/ui/src/components/chat/ChatMarkdown.tsx` | ~500 lignes | Syntax highlighting + Mermaid |
| `crates/gitnexus-desktop/ui/src/stores/chat-session-store.ts` | ~300 lignes | Zustand session/message state, fork/pin/retry |
| `crates/gitnexus-desktop/ui/src/hooks/use-chat-stream.ts` | ~150 lignes | Event listeners SSE chunks + tool events |

**5 modes (exclusifs)** :
- `qa` — simple Q&A (chat_ask streaming agentic)
- `deep_research` — plan-based executor (chat_execute_plan → DAG steps)
- `feature_dev` — code generation artifact
- `code_review` — review artifact
- `simplify` — refactoring proposals

**Rendering** : `react-markdown` + `remark-gfm` + Shiki (~40 langues) + Mermaid lazy load + callouts (`[!TIP]`, `[!WARNING]`, `[!DANGER]`) + smart inline code (clickable backticks → file preview / symbol nav).

**Session persistence** : Zustand + persist middleware (localStorage). Sessions par-repo : `ChatSession { id, repo, title, updatedAt, messages[], parentId?, branchFromMessageId? }`.

**Capabilités UI** :
- Tool execution events → `activeTools` array + `toolHistory` Redux-like
- Retry button sur tool failure
- Context filters (Ctrl+P file, Ctrl+Shift+O symbol, Ctrl+Shift+M module)
- Fork session (clone messages jusqu'à un point)
- Pin message (sidebar "Pinned" filter)

### 2.3 Avantages discriminants vs concurrence

| Critère | GitNexus | Cursor | Claude Code | Cline |
|---|---|---|---|---|
| **Knowledge base** | Code graph parsé + RAG | Repo files + embeddings | Repo files + embeddings | Repo files |
| **Determinism** | OUI (graph-based, reproductible) | Non (LLM-only) | Non | Non |
| **Impact analysis** | OUI (blast radius, coupling) | Non | Non | Non |
| **Session forking** | OUI (most advanced) | Non | Per-workspace | Non |
| **Business process awareness** | OUI (graph intègre workflows) | Non | Non | Non |
| **Code modification** | Non (read-only by design) | OUI | OUI (MCP) | OUI |
| **Sub-agents** | Non (Phase F deferred) | OUI | OUI | Non |
| **Streaming UX** | Coarse-grained (blocs) | Fine-grained (line-by-line) | Fine-grained | Fine-grained |
| **IDE integration** | Desktop only | OUI | OUI | OUI |

### 2.4 Limites observées + TODOs

- ❌ Aucune modification de code (par design — promesse "graphe = source de vérité, read-only safe")
- ❌ Aucun sub-agent isolé (Phase F deferred, 3-5 j estimés cf next-steps.md)
- ❌ Aucune "working memory" entre requêtes (session memory existe, mais zéro reuse implicite de contexte)
- ❌ Aucune détection erreur LLM (tool_call parsing assume JSON valide)
- ❌ Aucun rate-limiting / timeout sur tool execution
- ❌ Config LLM n'expose pas `temperature` ni `top_p`
- ❌ Pas de streaming des résultats tools (tool_result = blocs complets)
- ⚠️ Hybrid search implémenté mais branche `feat/semantic-search` pas mergée (master HEAD = `a256fe2`)
- ⚠️ Test flaky `truncated_body_fails_load` (Windows SystemTime 16ms resolution)
- ⚠️ Memory facts s'accumulent indéfiniment (chat.rs:89-100) → bloat futur du system prompt

---

## 3. Propositions par vague

### Vague A — Quick unblocks + polish (1 semaine)

| ID | Proposition | Effort | Impact | Justification |
|---|---|:-:|:-:|---|
| **A1** | **Merger `feat/semantic-search` sur master** | S | HIGH | Branche prête depuis 1 semaine (cf brief nuit 25 avril `nuit_25avril_gitnexus.md`). Hybrid BM25 + ONNX embeddings + RRF fusion + reranker LLM. Bench Alise = 67 % strictly improved. UI flag `--hybrid` à exposer dans le ChatPanel. **Coût d'attente** : chaque jour sans merge = lag commercial vs Cursor/Claude. |
| **A2** | **Memory cleanup (TTL + dedup fuzzy)** | S | MED | Memory facts s'accumulent indéfiniment (`chat.rs:89-100`). Sur repo 5 ans → bloat sévère du system prompt. Proposer : TTL configurable (90j default), dedup hash similarité (SimHash ou MinHash), garbage collection au démarrage. |
| **A3** | **Config UI : temperature, top_p, reasoning_effort** | S | LOW | Aujourd'hui hardcodé dans `ChatConfig::default()` (max_tokens=4096, temperature implicite). Ajouter sliders dans l'écran Settings du desktop. Permet fine-tune par cas d'usage : low temp pour analyse stricte, high temp pour exploration. |
| **A4** | **Fix test flaky `truncated_body_fails_load`** | S | LOW | Windows SystemTime 16 ms resolution → flaky CI. Remplacer `as_nanos()` par `tempfile::TempDir::new()` (déjà disponible via la crate `tempfile` v3+). Trivial mais nettoie le radar CI. |
| **A5** | **Tool result streaming (search_code progressif)** | M | MED | Aujourd'hui `search_code` retourne 20 symbols d'un coup. Streamer par batch de 5 (déjà des chunk events côté Tauri). UX immédiatement plus vivante. Bonus : permet à l'utilisateur d'arrêter une recherche qui dérive sans tout perdre. |

**Total Vague A** : ≈5 j/h. Base de production stabilisée, branche débloquée, dette de configuration purgée.

### Vague B — Capabilités majeures (2-3 semaines)

| ID | Proposition | Effort | Impact | Justification |
|---|---|:-:|:-:|---|
| **B1** | **Phase F — sous-agents isolés** | L | VERY_HIGH | 3-5 j estimés (memory `project_audit_2026_04`). Permet au chat principal de **déléguer** à un sous-agent autonome qui fait son propre tool loop dans son contexte propre, et retourne juste un résumé. **Game-changer** pour les questions architecture qui demandent de traverser 5+ niveaux. Pattern Cursor/Claude Code, mais ici **graphe-aware** (le sub-agent connaît le schema GitNexus, pas un RAG flat). |
| **B2** | **LLM-driven tool selection** *(remplace les heuristiques hardcodées)* | M | HIGH | Aujourd'hui `prefetch_for_type` impose les tools selon classification keyword. Remplacer par : laisser le LLM décider quels tools il veut appeler en premier. Réduit les cycles inutiles + permet questions non-anticipées (ex: « hotspots git de ce module » → auto-call `analyze_hotspots` qui n'est pas pré-fetché actuellement). Synergie avec B1 (les sub-agents s'auto-déterminent). |
| **B3** | **Live artifact streaming (feature-dev par phases)** | M | HIGH | Backend a déjà `feature-dev-phase` event. Frontend `liveArtifact` state prêt. Manque juste le câblage : Explorer → Planner → Implementer → Reviewer s'affichent **progressivement**, pas d'un coup. Effet UX immédiat ("on voit Claude réfléchir"). |
| **B4** | **Cross-message conversation context** | M | MED | Aujourd'hui chaque message est indépendant (« explain more » sans contexte = échec). Ajouter une **conversation memory** implicite : le dernier symbol/file/method discuté reste référençable jusqu'au prochain reset. Exemples : « and the callers? » → reuse last symbol. |
| **B5** | **Error handling robuste + retry** | M | MED | Tool errors (malformed JSON, timeout) → silent fail aujourd'hui. Ajouter retry exponentiel (3 tentatives) + toast user-facing + log persistant par session pour debugging post-hoc. Critique pour Gemini qui malforme parfois ses tool_calls. |

**Total Vague B** : ≈12-15 j/h. **Saut qualitatif majeur** vers chat agentic mature. C'est la vague qui creuse l'écart vs concurrence.

### Vague C — Discriminants commerciaux (1-2 mois)

| ID | Proposition | Effort | Impact | Justification |
|---|---|:-:|:-:|---|
| **C1** | **Long-form technical docs (continuous documentation mode)** | M | HIGH | **Synergie directe** avec la méthodologie Doc Q/R livrée 28/04. Mode chat dédié `documentation` qui produit progressivement une doc technique (markdown source + PDF avec cover qualité conseil) par questions itératives. **Déterminant commercial** : c'est ce que la prestation agile-up.com vend déjà — l'industrialiser dans le chat élimine le coût marginal de production. |
| **C2** | **Graph-aware refactoring suggestions** | M | HIGH | Le graphe sait qui appelle qui. Permet de calculer **précisément** ce qu'un refactoring casserait (vs guesser comme Cursor). Mode `refactor` : prend un symbol en entrée, propose 3 refactorings rangés par blast radius minimisé (renommage / extraction / déplacement). Chaque proposition affiche les fichiers/symbols impactés concrètement. |
| **C3** | **Dead code + complexity reports actionnables** | M | HIGH | GitNexus a déjà `is_dead_candidate` au niveau Method. Manque le mode UI qui produit un rapport actionnable : « 47 méthodes mortes (entry points exclus), 12 fichiers > 500 LOC à refactor, 8 cycles de dépendances ». **Pour Alise = livrable client direct** (audit gratuit en démo, payant en prestation). |
| **C4** | **IDE plugin VS Code** | L | HIGH | Hover cards avec impact + context directement dans l'éditeur. 7-10 j. Long mais crée un **canal d'usage permanent** (chaque dev qui ouvre un fichier = exposition GitNexus). Discriminant commercial fort à terme. |
| **C5** | **Cross-repo impact (multi-repo)** | L | MED | Lib partagée utilisée par 3 projets → trace l'impact partout. Cas d'usage : refactoring transversal. Coût élevé (sémantique multi-repo non triviale, gestion des versions, indexation cross-repo). À chiffrer plus précisément avant engagement. |

**Total Vague C** : ≈25-35 j/h. **Positionnement commercial** consolidé. Cette vague est le terrain où GitNexus gagne ou perd contre Cursor + Claude Code.

### Annexe — Polish & quality of life (S à M, à intercaler)

- **A6** : Diff entre branches de session (fork A vs fork B) — UX exploratoire
- **A7** : Export chat session as markdown + PDF (réutilise la méthodologie Doc Q/R) — synergie C1
- **A8** : Keybindings IDE-style (Ctrl+K, Ctrl+L, etc.) — power user
- **A9** : Voice input (Whisper local sur DARKSTAR) — synergie Lisa, robot 10 ans
- **A10** : Chat shortcuts (`/explain`, `/impact`, `/cypher`) — power user

---

## 4. Prioritisation argumentée

### Pourquoi commencer par Vague A

1. **Coût faible** — 5 j/h, résultats visibles immédiatement.
2. **Débloque `feat/semantic-search`** — branche prête, bench Alise validé. Garder ça en attente est gâché.
3. **Memory cleanup et config UI** — ce sont des « pollutions » qui s'aggravent avec le temps. Plus on attend, plus c'est compliqué.
4. **Tool result streaming** — UX win très visible, low-risk technique.

### Pourquoi B1 + B2 doivent venir avant B3-B5

- **Discriminants vs concurrence** : sub-agents graphe-aware + LLM-driven tools = ce qui fait que GitNexus n'est pas un ChatGPT-with-RAG.
- **Synergie** : B1 et B2 se renforcent mutuellement (les sub-agents bénéficient automatiquement du LLM-driven tool selection).
- **Impact sur les questions architecture** : c'est le terrain de jeu commercial (ce qu'agile-up.com vend en audit).

### Pourquoi C1 doit venir avant C2 et C3

- **Synergie immédiate avec la méthodologie Doc Q/R** livrée 28/04.
- **Industrialisation** de la prestation existante = ROI direct (chaque audit livré sans coût de production).
- **C2 et C3** sont des bonus techniques mais ne s'auto-vendent pas tant que C1 n'a pas créé le canal.

### Pourquoi PAS le « code edit mode » à la Cursor

L'audit Explore l'a souligné : implémenter le code-edit mode casserait la **promesse différenciante** de GitNexus (graphe = source de vérité, read-only safe). C'est la pile Cursor/Claude qui assume code edit. Pour GitNexus, mieux vaut un mode **« refactoring suggestions »** (C2) qui propose mais ne touche pas, en synergie avec un export vers Cursor/Claude/IDE pour l'application.

---

## 5. Estimations cumulées

| Horizon | Effort | Livrable cumulé |
|---|---|---|
| **Semaine 1** (A1-A5) | 5 j/h | Chat stabilisé, semantic search dispo, memory propre, config UI complète, tool streaming |
| **Semaines 2-4** (B1+B2) | 8-10 j/h | + Sub-agents Phase F + LLM-driven tools = chat agentic mature |
| **Semaines 5-6** (B3-B5) | 5-7 j/h | + Streaming artifacts + context cross-message + error handling robuste |
| **Semaines 7-12** (C1-C3) | 15-20 j/h | + Continuous docs + refactoring graph-aware + dead code reports |
| **Semaines 13+** (C4-C5) | 15+ j/h | + VS Code plugin + multi-repo |

**Total roadmap complète** : ~50-65 j/h sur 3 mois, livrable progressif. **Patrice peut s'arrêter à n'importe quelle vague** — chaque vague est autonome et apporte de la valeur indépendante. La Vague A seule transforme déjà l'expérience de chat.

### Coût LLM additionnel estimé

- Vague A : ~0 (pas de change agent loop)
- Vague B1 (sub-agents) : ~3-5x le coût actuel par question architecture (sub-agents multiplient les calls). À monitorer en bench.
- Vague B2 (LLM-driven tools) : -10 à -20 % de cycles inutiles. Nul-sum sur le coût.
- Vague C : variable selon adoption, mais l'industrialisation de C1 amortit largement le coût en prestation économisée.

---

## 6. Risques + dépendances

### Dépendances entre propositions

- **B1 dépend de A1** : les sous-agents partagent l'index hybrid (semantic search). Sans A1, B1 reste sur BM25 only et perd 30-40 % de pertinence sur le contenu métier.
- **C1 dépend de B3** : artifact streaming nécessaire pour le rendu progressif des docs continues.
- **C2 dépend de B2** : le refactoring graph-aware utilise le même mécanisme de tool selection que les questions architecture.

### Risques opérationnels

| Risque | Mitigation |
|---|---|
| **LLM provider drift** | L'agent loop assume API stable Anthropic/OpenAI/Gemini. Tester périodiquement (intégration tests sur les 3 providers) après chaque vague. |
| **Coût LLM Vague B** | Sub-agents multiplient les calls. Monitorer le budget mensuel avant déploiement en production. Si dérive, throttler le nombre de sub-agents simultanés. |
| **Scope creep Vague C** | La Vague C est ambitieuse. Prioriser strictement C1 OU C3 selon la stratégie commerciale (consulting C1 / produit C3). Pas les deux en parallèle. |
| **Test flaky qui revient** | A4 fixe `truncated_body_fails_load`. Si d'autres flakies apparaissent, instaurer un sprint dédié plutôt que des fixes one-off. |
| **Phase F génère des coûts cachés** | Les sous-agents écrivent dans la BDD du graphe (memory), peuvent saturer si pas de quota. Ajouter un quota par session (ex: max 10 sub-agents par message principal). |

### Anti-patterns à éviter explicitement

1. **Implémenter le « code edit mode »** : casserait la promesse différenciante read-only safe. Préférer l'export vers Cursor/Claude.
2. **Réécrire chat.rs from scratch** : les 3300 lignes contiennent beaucoup de logique métier éprouvée (Gemini auto-inject, fallback graph-only). Refactoring incrémental, jamais big-bang.
3. **Ajouter un 6e mode** sans retirer un autre : la liste des modes (qa/deep_research/feature_dev/code_review/simplify) est déjà chargée. C1 (continuous docs) est un mode justifié, pas C2 (refactoring) qui peut être un sous-mode de feature_dev.
4. **Memory facts globaux** : éviter d'accumuler des facts sur le robot ou la vie privée de Patrice dans le memory store global du chat — ces facts vivent dans `~/.claude/projects/.../memory/`, pas dans la persistent memory du chat.

---

## 7. Mise en œuvre suggérée

### Pattern « brief court par proposition »

Pour chaque proposition de la Vague A (et plus tard B et C), créer un fichier brief court (~50-100 lignes) dans `claude-et-patrice/propositions/briefs/` avec :

- **Fichiers à modifier** (paths exacts dans le repo)
- **Étapes d'implémentation** numérotées
- **Tests à ajouter** (chemin, cases couverts)
- **Critères de validation** (build clean, tests verts, comportement attendu vérifiable)
- **Garde-fous** (ce qu'il ne faut PAS toucher)

Cette structure permet à un autre Claude (session parallèle ou Codex/Gemini en rotation) de prendre une proposition et la livrer **sans avoir besoin de toute la session de réflexion** qui a généré le présent document. C'est ce qui a marché pour la nuit 25 avril (`nuit_25avril_gitnexus.md` → semantic search préparé proprement par un autre Claude pendant que Patrice dormait).

### Briefs à rédiger (Palier optionnel ≈30 min × 5 = 2,5 h)

1. `briefs/A1-merge-semantic-search.md` — checkout, validation, merge, push
2. `briefs/A2-memory-cleanup.md` — TTL + SimHash + GC startup
3. `briefs/A3-config-ui-temperature.md` — sliders Settings, validation, defaults
4. `briefs/A4-fix-flaky-test.md` — substitution tempfile, vérif CI Windows
5. `briefs/A5-tool-streaming.md` — chunk events search_code par batch de 5

À faire en session diurne quand Patrice valide cette roadmap.

### Suivi

- Indexer dans `etat_projets.md` (section "Roadmap chat gitnexus-rs") avec lien vers ce document.
- Logger les livraisons dans `journal/ministar-gitnexus-rs.md` à mesure qu'elles s'exécutent.
- Memory `project_audit_2026_04` à mettre à jour après Vague A (statut Phase F passé de "deferred 3-5j" à "B1 priorisée semaine X").

---

*Document généré le 29/04/2026 par Claude Opus 4.7 (1M ctx) sur demande de Patrice Huetz, à partir d'un audit Explore agent (~45 fichiers / ~3500 lignes) et de l'état du repo `gitnexus-rs` à la branche `feat/enrichment-config-exposure` (master HEAD = `a256fe2`).*
*Status : à valider par Patrice. Aucune implémentation engagée tant que la roadmap n'est pas validée par vague.*
