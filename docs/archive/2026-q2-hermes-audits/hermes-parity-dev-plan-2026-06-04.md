# Hermes Agent — écosystème, écarts & plan de développement

Date : 2026-06-04 · Machine : Ministar Linux (Ryzen AI 9 HX 470, Ollama Vulkan local)
Auteur : session Code Buddy `codex/hermes-final-polish`

> Objectif de session : **atteindre le même niveau que Hermes Agent**. Ce doc
> documente l'écosystème upstream à partir des **docs officielles NousResearch**
> (pas seulement de l'audit local), confronte au manifest de parité Code Buddy,
> et propose un plan de dev priorisé et honnête.
>
> Source de vérité machine-checkable : `buddy hermes parity --json`
> (20 lignes). Audit narratif : `docs/hermes-agent-official-parity-audit-2026-05-30.md`.

---

## 1. L'écosystème Hermes Agent (upstream)

**Hermes Agent** (NousResearch) — « the self-improving AI agent ». MIT, Python
3.11+ (84 %) + TypeScript (12 %), package manager `uv`, install one-liner
(`scripts/install.sh`). Cœur = `run_agent.py` (`AIAgent` synchrone) partagé par
**tous** les points d'entrée.

### Points d'entrée (5)
| Entrée | Fichier | Rôle |
|---|---|---|
| CLI/TUI | `cli.py` (`HermesCLI`) | terminal interactif |
| Gateway | `gateway/run.py` | process long, **20 adaptateurs** de messagerie, scheduler cron (tick 60 s), livraison voix |
| ACP | `acp_adapter/` | intégration éditeur VS Code / Zed / JetBrains via stdio JSON-RPC |
| Batch Runner | `batch_runner.py` | génération de trajectoires / bulk |
| API Server | — | endpoint REST programmatique |

### Sous-systèmes
Prompt Builder (tiers ordonnés), Provider Resolution (18+ providers →
api_mode/api_key/base_url), Context Compressor (résumé au seuil), Session Storage
(**SQLite + FTS5**, lineage des compressions), Plugin Manager (3 sources :
user/project/pip entry-points → memory providers + context engines), Cron
Scheduler (tâches JSON, schedule NL ou cron), Messaging Gateway (routing session,
autorisation user, slash dispatch, hooks lifecycle).

### Registre d'outils
**70+ outils / ~28 toolsets**, auto-enregistrés à l'import. Terminal = **6
backends** (local, Docker, SSH, Daytona, Modal, Singularity). Browser = **10+
outils** (Browserbase, Browser Use cloud, CDP local, Chromium).

### Les 5 différenciateurs annoncés
1. **Boucle auto-apprenante** — mémoire curatée + nudges, **création autonome de
   skills** après tâches complexes, skills qui s'améliorent à l'usage.
2. **Apprentissage persistant** — sessions résumées par LLM → recall cross-session.
3. **Runs anywhere** — local/Docker/SSH/Singularity/Modal/Daytona, « coûte presque
   rien à l'idle » (hibernate/wake).
4. **Platform-agnostic** — n'importe quel modèle, switch sans code (`hermes model`).
5. **Omnichannel** — 1 process gateway, continuité de conversation cross-plateforme.

### Surface CLI upstream (≈50 commandes top-level)
`chat, model, fallback, gateway, proxy, lsp, setup, whatsapp, slack, auth, send,
secrets, migrate, portal, status, cron, kanban, webhook, hooks, doctor, security
audit, dump, prompt-size, debug, backup, checkpoints, import, logs, config,
pairing, skills, bundles, curator, memory, acp, mcp, plugins, tools, computer-use,
sessions, insights, claw, dashboard, profile, completion, version, update, uninstall.`

### Surface outils upstream (exacte, par toolset)
browser (`browser_back/click/console/get_images/navigate/press/scroll/snapshot/
type/vision/cdp/dialog`), clarify, code_execution (`execute_code`), cronjob,
delegation (`delegate_task`), feishu_doc/feishu_drive, file (`patch/read_file/
search_files/write_file`), homeassistant (`ha_*`), computer_use, image_gen, kanban
(`kanban_*`), memory, messaging (`send_message`), moa (`mixture_of_agents`),
session_search, skills (`skill_manage/skill_view/skills_list`), terminal
(`terminal/process`), todo, vision (`vision_analyze`), video (`video_analyze`),
video_gen (`video_generate`), web (`web_search/web_extract`), x_search, tts
(`text_to_speech`), discord/discord_admin, spotify (`spotify_*`), yuanbao (`yb_*`),
MCP (`mcp_<server>_*`).

---

## 2. État Code Buddy (manifest live, 2026-06-04)

`buddy hermes parity --json` → **total 20 · covered 0 · covered-partial 15 ·
partial 5 · gap 0** (au démarrage de cette session : covered-partial 8 / partial 12).

> **Session 2026-06-04/05 — 7 lignes déplacées `partial → covered-partial`** :
> memory-providers (Honcho+Mem0 live-validés + bug d'adapter fixé), cron-scheduling
> (script/skill/chained jobs, moteur+auteur), toolsets (catalogue 33 + readiness),
> mcp-acp (tours agentic tool-using + round-trip simulé), delegation-parallelism
> (RPC code→outils opt-in, fail-closed), skills (manager full-page Cowork),
> closed-learning-loop (écritures background opt-in, OFF par défaut, seuil de
> confiance + telemetry + rollback).
> **+2 renforcées** : cli-tui (4 commandes : insights/bundles/lsp/proxy),
> openclaw-migration (23→35 catégories, reste partial). Tout validé : typecheck
> repo-wide 0 erreur, 16 fichiers de tests / 202 tests ciblés verts (+ cowork 61).
> **5 partials restants = TOUS hard-gated externe** : messaging-gateway (tokens),
> browser-automation (comptes Browserbase/Browser Use), runtime-backends (comptes
> Modal/Daytona), mobile-supervision (device), openclaw-migration (vrai install).
> Plus aucune ligne implémentable+validable en-repo : les 3 décisions produit/sécu
> (skills, delegation, closed-learning-loop) ont été tranchées et livrées.

Au **niveau outils** (manifest de 2e niveau, `buddy hermes tools --json`) :
**65 exacts · 6 équivalents-natifs · 0 partiel · 0 gap**. La surface outil est
donc quasi à parité ; les écarts vivent au niveau **produit/runtime**, pas outil.

`covered-partial` (8) : agent-identity, cli-tui, prompt-size, providers-models,
built-in-tools, nous-portal, research-trajectories, kanban.
`partial` (12) : toolsets, messaging-gateway, browser-automation, **memory-providers**,
skills, closed-learning-loop, cron-scheduling, delegation-parallelism,
runtime-backends, mobile-supervision, mcp-acp, openclaw-migration.

> ⚠️ Le `status` est **codé en dur** dans `src/agent/hermes-parity-manifest.ts`.
> Règle : une ligne ne passe `partial → covered` **que si une probe/preuve réelle
> passe**. Anti-faux-PASS déjà en place (commit `035ae6c7`).

---

## 3. Analyse des écarts — 3 tiers

### Tier A — réalisable MAINTENANT sur Ministar, sans dépendance payante
- **memory-providers** *(en cours)*. Honcho déjà live-validé. Reste à valider en
  live sur cette machine : **Mem0** (serveur up sur :18888 ; blocage = extraction
  LLM **synchrone** trop lente → lui donner un LLM rapide), **ByteRover** (`brv`
  CLI, local-first), **OpenViking** (serveur :1933 à monter). Cloud
  (Supermemory/RetainDB) = comptes payants ; Hindsight/Holographic = upstream-only
  by design. **Cible : 6/8 live-validés ⇒ ligne `covered-partial` honnête.**

### Tier B — fermable EN REPO sans dépendance externe payante
**Audit grounded (agent Explore, 2026-06-04, preuves fichier:ligne) :**

| Surface upstream | État Code Buddy | Preuve / action |
|---|---|---|
| `webhook` | ✅ PRÉSENT | `buddy webhook list/add/remove` (`utility-commands.ts:112`) — rien à faire |
| `pairing` | ✅ PRÉSENT | `buddy pairing status/approve/revoke` (`commands/pairing.ts:18`) — rien à faire |
| `lsp` | 🟡 PARTIEL | client+outils LSP existent (`src/lsp/`, `src/tools/lsp-*`) mais **non exposés** en CLI → ajouter `src/commands/cli/lsp-command.ts` |
| `insights` | 🟡 PARTIEL | analytics existent (`/cost`, `/tool-analytics`, `src/analytics/*`) mais pas de CLI unifiée → `buddy insights` (surface du existant, faible risque) |
| `proxy` | 🟡 PARTIEL | route `/api/chat/completions` OK (`server/routes/chat.ts:549`) mais pas de cmd CLI `proxy` |
| `secrets` | 🟡 PARTIEL | `buddy secrets …` vault local AES-256-GCM ; **manque** manager externe (Bitwarden/Vault) — dépendance externe |
| `bundles` | 🔴 ABSENT | aucune trace → nouvelle commande (grouper skills sous 1 slash) |

Closures pures-repo, sans dépendance : **`insights`** (surface l'existant — meilleur
ratio valeur/risque), **`bundles`** (nouvelle feature), **`lsp` CLI**, **`proxy` CLI**.
`secrets`-externe dépend d'un binaire tiers (Bitwarden CLI) → plutôt Tier C.
- **mcp-acp (partial)** : câbler les tours ACP **agentic** complets (tool-using)
  via primitives fs/* + session/request_permission, valider contre un éditeur live,
  puis stockage durable de session + passthrough MCP.
- **toolsets (partial)** : garder le catalogue officiel à jour + déplacer les
  surfaces produit restantes en status/readiness explicites.

### Tier C — gated par dépendance externe / payante / décision produit (documenter, ne pas forcer)
- **runtime-backends** : lifecycle hibernate/wake managé pour Docker/SSH/**Modal/
  Daytona/Singularity** (Modal/Daytona = comptes cloud).
- **browser-automation** : runners managés **Browserbase/Browser Use** + routing
  hybride (comptes cloud).
- **messaging-gateway** : liste complète des 20 plateformes + lifecycle + slash
  parity (besoin de tokens/comptes par plateforme).
- **closed-learning-loop** : Hermes écrit des skills en background **direct** ;
  Code Buddy garde des **review gates** (décision produit — à conserver).
- **delegation-parallelism** : autoriser le code généré à rappeler des outils par
  RPC (décision sécurité — garder désactivé jusqu'à approbation explicite).
- **mobile-supervision** : client mobile first-class + packaging TLS off-device.
- **openclaw-migration** : 35 catégories reconnues; imports directs vers identité,
  mémoire, modèle, MCP, skills, commandes slash `.codebuddy/commands/*.md` et
  réglages agent mappables. Reste à valider contre un vrai install OpenClaw.
- Mémoire cloud (**Supermemory/RetainDB**) : comptes payants.

---

## 4. Plan de développement (vagues)

### Vague 1 — Memory providers (Tier A) — *active*
1. Confirmer baseline **Honcho** PASS (container up :8000).
2. **ByteRover** : `npm i -g byterover-cli` → `CODEBUDDY_MEMORY_PROVIDER=byterover`
   → `buddy hermes memory probe byterover` → PASS.
3. **Mem0** : `MEM0_BASE_URL=http://localhost:18888`, donner un LLM d'extraction
   **rapide** (pull `qwen3:4b` ou pointer le serveur sur GPT-5.5 via `buddy
   server`), `CODEBUDDY_MEMORY_HTTP_TIMEOUT_MS` généreux → probe PASS.
4. **OpenViking** : monter le serveur AGPL :1933 → `OPENVIKING_ENDPOINT` → probe.
   Si stand-up trop lourd, documenter honnêtement.
5. MAJ honnête de la ligne `memory-providers` (status + notes + nextWork) dans
   `hermes-parity-manifest.ts` + `docs/hermes-memory-providers-selfhost.md`, puis
   tests ciblés de la ligne (`tests/agent/hermes-memory-providers.test.ts`,
   `tests/memory/*`). **Validation = probes réelles, pas auto-déclaration.**

### Vague 2 — Audit + closure Tier B (en repo) — ✅ closures CLI livrées 2026-06-04
Audit grounded fait (cf. Tier B ci-dessus). **4 commandes CLI livrées** (chacune
réutilise l'infra existante, tests ciblés verts, enregistrées dans `src/index.ts`,
typecheck complet 0 erreur, lint propre) :
- ✅ **`buddy insights [summary|cost|tools] [--json]`** — agrège cost-tracker +
  tool-analytics + RunStore (`src/commands/cli/insights-command.ts`, 6 tests).
- ✅ **`buddy bundles list|create|show|remove [--json]`** — groupe des skills,
  persisté `~/.codebuddy/bundles.json`, valide les IDs via SkillsHub
  (`bundles-command.ts`, 6 tests). Comble la seule surface upstream ABSENTE.
- ✅ **`buddy lsp status|diagnostics <file> [--json]`** — expose le client LSP
  interne existant (`lsp-command.ts`, 8 tests).
- ✅ **`buddy proxy [--port|--host|--no-auth|--json]`** — proxy OpenAI-compatible
  réutilisant `startServer()` (WS/channels off) (`proxy-command.ts`, 6 tests).

Renforce la ligne manifest `cli-tui` (déjà `covered-partial`). Restant Tier B :
- **mcp-acp** : tours ACP agentic complets + session durable, valider contre un
  éditeur (VS Code/Zed) en local.
- `secrets`-externe (Bitwarden/Vault) : dépend d'un binaire tiers → Tier C.

### Vague 3 — Tier C : décisions produit (ne pas coder en aveugle)
- Présenter à Patrice les arbitrages : runtimes managés (Modal/Daytona),
  browser cloud (Browserbase/Browser Use), plateformes messaging supplémentaires,
  background skill-writes direct vs review gates, RPC code→outils.
- Chaque item gated reste `partial` avec **une ligne de raison** dans le manifest.

---

## 5. Définition de « atteint le niveau de Hermes » (pour cette session)

Le 20/20 `covered` littéral est **impossible par design** (cloud payant, installs
externes, items upstream-only Python, décisions produit « garder désactivé »).
Done réaliste :

> **Tout item validable sur cette machine sans dépendance payante/externe est
> réellement validé (probe qui passe), sa ligne honnêtement mise à jour ; le reste
> reste `partial` avec une raison d'une ligne.**

Concrètement : Vague 1 (memory) bouclée et live-validée ; Vague 2 auditée et les
gaps faciles fermés ; Vague 3 documentée comme arbitrages produit à valider avec
Patrice.

---

## Sources (docs officielles, 2026-06-04)
- Repo : <https://github.com/NousResearch/hermes-agent>
- Docs : <https://hermes-agent.nousresearch.com/docs/>
- Architecture : <https://hermes-agent.nousresearch.com/docs/developer-guide/architecture>
- Features : <https://hermes-agent.nousresearch.com/docs/user-guide/features/overview>
- CLI : <https://hermes-agent.nousresearch.com/docs/reference/cli-commands>
- Tools : <https://hermes-agent.nousresearch.com/docs/reference/tools-reference>
- Messaging : <https://hermes-agent.nousresearch.com/docs/user-guide/messaging/>
