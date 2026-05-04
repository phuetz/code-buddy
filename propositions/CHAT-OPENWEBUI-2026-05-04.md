# Chat gitnexus-rs vs Open WebUI — analyse 3 options

> Demande de Patrice nuit 03→04 mai 2026 : « tu pourrais réécrire le module
> de chat de gitnexus-rs et partir de Open WebUI ? ».
> Document complémentaire à
> [`AMELIORATION-CHAT-GITNEXUS-2026-04-29.md`](AMELIORATION-CHAT-GITNEXUS-2026-04-29.md).

## TL;DR

**Recommandation : NE PAS partir d'Open WebUI.** Trois raisons concrètes :

1. **License** OWUI = BSD-3 modifiée fair-source. Interdit de retirer le branding sauf <50 users sur 30j ou enterprise license. Bloquant pour la commercialisation agile-up.
2. **Stack incompatible** (Python+Svelte vs Rust+React) → "s'inspirer" = porter des patterns à la main, pas réutiliser du code.
3. **Anti-pattern explicite** dans la roadmap déjà validée (`AMELIORATION-CHAT-GITNEXUS-2026-04-29.md`) : « ne PAS réécrire chat.rs from scratch — perdrait la logique métier (Gemini auto-inject, fallback graph-only, 5 modes spécialisés) ».

**Plan retenu** : continuer Vague A/B existante + **2 emprunts ciblés** d'OWUI (UX streaming fine-grained + packaging `gitnexus-mcp` standalone visant Claude Code / Cursor / Cline plutôt qu'OWUI). Estimé +3–5 j/h en plus de la roadmap déjà engagée.

---

## §1 — Carte du chat gitnexus-rs actuel

Pour qu'on parte du même point factuel.

**Stack** : Rust (Tauri v2) + React 19 + Zustand + TanStack Query + Tailwind v4.

**Backend Rust** (~5000+ lignes) :
- `crates/gitnexus-desktop/src/commands/chat.rs` (~3300 L) — agent loop, multi-provider, streaming SSE, tool execution
- `crates/gitnexus-desktop/src/commands/chat_planner.rs` (~600 L) — classification keyword-based (5 types), prefetch heuristique
- `crates/gitnexus-desktop/src/commands/chat_executor.rs` (~500 L) — DAG plan executor pour deep_research

**Frontend React** (~1500+ lignes) :
- `ui/src/components/chat/{ChatPanel, ChatInput, ChatMessage, ChatMarkdown}.tsx` + une dizaine d'autres (ChatSearch, ChatSuggestions, ChatToolsPanel, ChatContextBar, ChatSettings, ChatHistorySidebar, ChatMode)
- `ui/src/stores/chat-store.ts` + `chat-session-store.ts` — Zustand persist localStorage
- Hook : `ui/src/hooks/use-chat-stream.ts`

**5 modes opérationnels** :
1. `qa` — Q&A streaming agentic
2. `deep_research` — plan-based DAG executor
3. `feature_dev` — code generation artifact
4. `code_review` — review artifact
5. `simplify` — refactoring proposals

**LLM** : multi-provider OpenAI-compatible (OpenAI, Anthropic, Gemini, Ollama). Config via `~/.gitnexus/chat-config.json`. API keys hydratées depuis env.

**Tool calling** : 10 outils chat (search_code, read_file, get_impact, etc.) + 27 outils MCP exposés via `crates/gitnexus-mcp/src/backend/local.rs` (3412 L) :

`list_repos`, `query`, `context`, `impact`, `detect_changes`, `rename`, `cypher`, `search_code`, `read_file`, `find_cycles`, `find_similar_code`, `hotspots`, `coupling`, `ownership`, `coverage`, `diagram`, `report`, `business`, `analyze_execution_trace`, `get_complexity`, `list_todos`, `list_endpoints`, `list_db_tables`, `list_env_vars`, `get_endpoint_handler`, `get_insights`, `save_memory`.

**Capabilities présentes** : streaming SSE coarse-grained, citations `ChatSource[]`, memory Global+Project, fork/pin sessions, hybrid RAG (BM25+embeddings, mergé `166ca44`), markdown Shiki + Mermaid lazy load, callouts, smart inline code clickable.

**Capabilities absentes** : attachments (file upload), voix (STT/TTS), sub-agents (Phase F deferred), édition de code (read-only by design — promesse différenciante explicite).

**Ce n'est pas un MVP, c'est un produit déjà chargé.** Toute "réécriture from scratch" perd cette accumulation.

---

## §2 — Open WebUI — snapshot honnête

**Stack** : Python (FastAPI inféré) + Svelte/JS/TS — **0 % de réutilisation directe possible** dans gitnexus.

**Maturité** : 135k ⭐ GitHub, 19.3k forks, production-ready (Redis horizontal scaling, Kubernetes, SCIM 2.0/LDAP, OpenTelemetry observabilité).

**Forces qu'on n'a pas** :
- 10+ providers LLM
- 9 vector databases RAG (Weaviate, Pinecone, Milvus, Chroma…)
- 15+ web search providers
- Image generation (DALL-E, Gemini, ComfyUI)
- Voix (STT/TTS multi-provider)
- Pipelines Plugin Framework (fonctions Python custom, rate limiting)
- RBAC mature

**MCP support natif** : **NON CONFIRMÉ**. La page docs MCP retourne 404, le README ne mentionne pas Model Context Protocol. OWUI parle de « function calling » (au sens OpenAI) mais pas de protocole MCP. Avant tout commitment sur l'option C, il faudrait poser la question dans `open-webui/open-webui` Discussions.

**License** : BSD 3-Clause **modifiée**. Clause additionnelle interdit aux licensees de modifier, retirer, masquer ou remplacer le branding « Open WebUI » dans la majorité des déploiements.

Exceptions :
- Déploiement < 50 users sur 30 jours
- Permission écrite explicite de l'éditeur
- Enterprise license payante

**Implication directe pour agile-up** : tout client commercial > 50 users nécessite une enterprise license OU un white-label accord. Le BSD-3 stock (sans cette clause) aurait été permissif ; le passage en fair-source change la donne.

---

## §3 — Les 3 options réévaluées

### Option A — Emprunter UX/composants OWUI dans React

**Description** : copier les patterns d'interface de OWUI (slot modèle visible en permanence, palette de prompts, modal de sources RAG, conversation tree avec branching, streaming fine-grained line-by-line) et les porter en React 19. Refresh visuel.

| Critère | Verdict |
|---|---|
| Coût | 3–5 j/h |
| Bénéfice | UX plus moderne, perception streaming améliorée, palette prompts utile |
| Risque | Shallow win — ne déplace pas les vraies aiguilles (memory TTL, sub-agents, LLM-driven tool selection identifiés en Vague A/B) |
| Licence | OK — pas de copyright sur l'UX, on s'inspire des idées |
| Valeur unique gitnexus | Neutre |

**Verdict** : viable mais à intégrer **dans Vague A** comme polish, pas comme un projet séparé. Coût marginal +1–2 j/h sur la Vague A si on cible les 3 patterns à plus haute valeur (streaming fine-grained, slot modèle, palette prompts).

### Option B — Refactoriser le chat desktop en client MCP générique

**Description** : abstraire `LocalBackend` derrière un trait `MCPBackend`, permettre de consommer N serveurs MCP simultanément (gitnexus-mcp local + Anthropic MCP + Memory MCP + serveurs tiers), pas juste un backend in-process.

| Critère | Verdict |
|---|---|
| Coût | 8–12 j/h |
| Bénéfice | Souplesse archi forte — chat sans lock-in local, devient orchestrateur multi-MCP avec graphe local privilégié |
| Risque | Surface API plus grande, complexité distribuée, latency network. **Peut violer l'anti-pattern « ne pas réécrire chat.rs from scratch »** — mitigeable en gardant `LocalBackend` comme `MCPBackend` par défaut, refactor incremental plutôt que rewrite. |
| Licence | Aucune (on reste maître du code) |
| Valeur unique gitnexus | **Renforce** — devient un orchestrateur multi-MCP avec graphe local privilégié ; aligne avec Phase F (sub-agents) Vague B |

**Verdict** : intéressant structurellement, mais lourd. À coupler avec Phase F sub-agents (déjà dans Vague B) plutôt qu'à faire en parallèle. Reformulation : **B' = "abstraire LocalBackend en trait MCPBackend dans le cadre de Phase F, sans réécrire chat.rs"**. Coût alors absorbé dans les 3–5 j de Phase F.

### Option C — gitnexus-mcp standalone consommé par OWUI

**Description originale** : packager `gitnexus-mcp` comme MCP server stdio standalone, branchable sur OWUI via son intégration MCP.

| Critère | Verdict |
|---|---|
| Coût | 2–3 j/h packaging |
| Bénéfice | Zéro code OWUI à écrire, gain « gratuit » de tout l'UX OWUI |
| Risque MAJEUR | **Dépend de OWUI ayant MCP support natif — non confirmé.** Si absent, l'option est invalide. |
| Licence | **Bloquant pour clients agile-up** : si Patrice livre OWUI à un client commercial > 50 users, doit respecter la fair-source license (branding obligatoire ou enterprise license payante) |
| Valeur unique gitnexus | Préservée côté `gitnexus-mcp`, perdue côté UX (chez OWUI) |

**Verdict** : à **reformuler**. Le bon move n'est pas « pour OWUI » mais **« pour les clients MCP confirmés et permissifs »** : Claude Code, Cursor, Cline, Continue, Zed. Tous ont MCP support natif, tous sont sous des licences qui n'imposent pas de branding au consommateur.

**Reformulation C'** : packager `gitnexus-mcp` comme **MCP server standalone** (binaire ou Docker), publier sur les registries MCP officiels (Anthropic, Smithery), documenter l'install pour Claude Code / Cursor / Cline. Coût 2–3 j/h, ouvre un canal commercial agile-up : *« ajoute gitnexus à ton outil IA préféré en une commande »*.

---

## §4 — Recommandation

**Ne pas partir d'Open WebUI.** Continuer la roadmap existante (`AMELIORATION-CHAT-GITNEXUS-2026-04-29.md` Vague A puis B), avec **deux ajouts inspirés** du recensement OWUI :

### Ajout 1 — Emprunts UX dans Vague A polish (+1–2 j/h)

À intégrer aux items A3 (config UI) et A5 (tool result streaming) déjà prévus :
- **Streaming fine-grained line-by-line** au lieu de coarse-grained par blocs (perception nettement améliorée)
- **Slot modèle visible** en permanence dans le ChatInput (changement à la volée, pas via Settings)
- **Palette de prompts** (Cmd+K) avec prompts pré-écrits par mode (qa/deep_research/feature_dev/code_review/simplify)

### Ajout 2 — Reformulation de l'option C : packaging `gitnexus-mcp` standalone (2–3 j/h, nouveau projet)

À ajouter à `etat_projets.md` comme nouveau chantier :
- Cible clients : Claude Code, Cursor, Cline, Continue, Zed (MCP support confirmé)
- Pas Open WebUI pour le moment (license + MCP non confirmé)
- Livrable : binaire `gitnexus-mcp` standalone + Dockerfile + entrée registry MCP + doc d'install
- Bonus commercial agile-up : *« ajoute le code intelligence gitnexus à ton IDE IA en une commande »*

### Refus argumenté des 3 options pures

| Option | Raison du refus |
|---|---|
| A pure (refonte UX cosmétique) | Shallow, ne déplace pas les aiguilles ; mais 3 patterns à intégrer dans Vague A polish |
| B pure (réécriture chat.rs) | Viole anti-pattern explicite ; intéressant uniquement comme refactor incremental dans Phase F |
| C pure (OWUI seul) | Licence fair-source bloquante pour agile-up + MCP support OWUI non confirmé ; reformulé en C' (packaging multi-clients MCP) |

---

## §5 — Si Patrice insiste pour OWUI quand même

Plan B documenté pour transparence :

1. **Enterprise license OWUI** — contacter l'éditeur pour prix et conditions de white-label. Économique seulement si une grosse prestation agile-up le justifie.
2. **Limitation à <50 users** — compatible avec petites prestations ponctuelles agile-up, pas scalable au-delà.
3. **Fork à la dernière version BSD-3 stock** (avant le passage fair-source) — risqué (perte de toutes les features post-fork) et coûteux à maintenir. Déconseillé.

---

## §6 — Vérifications restantes avant tout commitment

À faire avant d'engager une option ou son ajout :

- [ ] **Confirmer MCP support OWUI** : poser la question dans `open-webui/open-webui` GitHub Discussions ; chercher les issues mentionnant "Model Context Protocol" ou "MCP"
- [ ] **Lire l'enterprise license OWUI** : prix, conditions, perimeter
- [ ] **Tester `gitnexus-mcp` standalone avec Claude Code** : déjà supposé compatible (MCP protocol 2024-11-05 implémenté), à valider end-to-end
- [ ] **Lister les 5 modes** (qa / deep_research / feature_dev / code_review / simplify) et vérifier qu'aucune option n'en perdrait la spécialisation métier — ils encodent du savoir-faire non remplaçable par une UI générique
- [ ] **Confirmer que `feat/semantic-search` est déjà mergée** (oui — commit `166ca44` dans master) → l'item A1 de la roadmap chat est **caduque**, à retirer

---

## Footer

*Rédigé par Claude Opus 4.7 (1M context) — nuit 03→04 mai 2026, MINISTAR.*
*Demande déclenchée à ~02h, 15% des limites Claude restantes au démarrage de cette analyse, reset prévu ~04h45.*
*Phase 1 (Explore agent) + Phase 4 (rédaction) en mode plan validé.*

**Lectures complémentaires** :
- `propositions/AMELIORATION-CHAT-GITNEXUS-2026-04-29.md` — roadmap chat 3 vagues (référence)
- `propositions/MODERNIZATION-GITNEXUS-2026-05-04.md` — audit modernisation général gitnexus-rs (rédigé même session)
- Cargo.toml gitnexus workspace — pour confirmer license actuelle (TODO : vérifier qu'on est bien sous une license compatible avec l'option C' de packaging standalone)
