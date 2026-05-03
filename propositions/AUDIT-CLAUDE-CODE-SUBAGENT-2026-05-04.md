# Audit comparatif Claude Code source — subagent system + plan mode + scheduling

> **Date** : 2026-05-04 (soir, après push Code Buddy `1.0.0-rc.3`)
> **Auditeur** : Claude Opus 4.7 (1M context) sur DARKSTAR via session interactive avec Patrice
> **Source auditée** : `D:\CascadeProjects\claude-code-source-code-main` (Claude Code décompilé, présent localement chez Patrice)
> **Repo cible** : `D:\CascadeProjects\grok-cli` (Code Buddy `1.0.0-rc.3`)

## Origine de cet audit

3ème itération du pattern audit-doc qui a marché 2 fois :
- `AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md` → 1 ship (V1.3 adaptive auto-compact)
- `AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md` → 3 ships (recos #1 + #2 + #3 toutes fermées en rc.2 + rc.3)

Patrice a révélé en session que la source Claude Code est disponible localement. C'est un **upgrade qualitatif** majeur sur les audits précédents — au lieu d'inférer le pattern depuis l'introspection (j'utilise Claude Code de l'intérieur), je peux lire le code exact.

L'audit cible **4 zones** où Claude Code a des patterns puissants que j'ai personnellement utilisés cette séance.

---

## Q1 — Plan Mode workflow phasé

| | Claude Code | Code Buddy `1.0.0-rc.3` |
|---|-------------|-------------------------|
| Mode entry | `EnterPlanMode` tool | `OperatingMode.PLAN_MODE` (`src/agent/operating-modes.ts:169-184`) |
| Mode exit | `ExitPlanMode` tool with `allowedPrompts` field | `submit-plan-tool.ts:36-38` persists to `.codebuddy/plans/current.md` |
| Read-only enforcement | Tool restrictions (`view_file`, `search`, `web_search`, `web_fetch` only) | Same: `[view_file, search, web_search, web_fetch]` |
| Workflow structure | **5 explicit phases** : Phase 1 Explore agents en parallèle → Phase 2 Plan agents → Phase 3 Review → Phase 4 Final plan → Phase 5 ExitPlanMode | Single permission state, no phased orchestrator |
| Plan file | `.claude/plans/<random-name>.md`, persistent, edited incrementally | `.codebuddy/plans/current.md`, single file |
| Re-entry handling | Detects existing plan, prompts continue/overwrite | (à confirmer en V1.x) |
| Pre-approval | `ExitPlanMode.allowedPrompts` field for action-class pre-approval | `allowedPrompts` field exists in `exit-plan-mode-tool.ts:43` ✅ |

**Différence-clé** : Code Buddy a la **mécanique** (read-only mode + plan file persistance + allowedPrompts) mais pas l'**orchestration phasée** qui rend Claude Code's plan mode si productif. La phase 1 (Explore en parallèle) est ce qui m'a permis de mapper rapidement Code Buddy pendant cette séance.

**Status** : ⚠️ **PARTIAL**. Mécanique complète, workflow incomplet.

---

## Q2 — Structured user questions

| | Claude Code | Code Buddy |
|---|-------------|-----------|
| Tool | `AskUserQuestion` | `src/tools/ask-user-question-tool.ts` |
| Question count | 1-4 questions | 1-4 questions ✅ |
| Per-question | `question`, `header` (≤12 chars), `multiSelect` | Same ✅ |
| Per-option | `label` (1-5 words), `description`, optional `preview` | Same ✅ |
| Auto "Other" | Yes (free-text fallback) | Yes ✅ |
| Provider | UI component | `ask-user-question-readline-provider.ts` (CLI) |

**Status** : ✅ **COMPLETE PARITY**. Aucun gap.

C'est le seul des 4 zones où Code Buddy est en parité totale. Pas par hasard — c'est la zone la plus facile à mapper 1:1 (UI component, pas de complexité architecturale).

---

## Q3 — Subagent specialization (LE GAP CENTRAL)

### Pattern Claude Code

Source : `D:\CascadeProjects\claude-code-source-code-main\src\tools\AgentTool\built-in\exploreAgent.ts` (84 lignes)

```typescript
export const EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'Explore',
  whenToUse:
    'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  // Ants get inherit; external users get haiku for speed
  model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku',
  // Explore is read-only — doesn't need commit/PR/lint rules from CLAUDE.md.
  omitClaudeMd: true,
  getSystemPrompt: () => getExploreSystemPrompt(),
}
```

System prompt (extrait — répété 5-6× le READ-ONLY message) :

```
You are a file search specialist for Claude Code...

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
[...]
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT
have access to file editing tools - attempting to edit files will fail.
[...]
NOTE: You are meant to be a fast agent that returns output as quickly as possible.
[...]
- Wherever possible you should try to spawn multiple parallel tool calls
```

**Trois mécanismes d'enforcement combinés** :
1. **Hard** : `disallowedTools` array filtré au moment du dispatch
2. **Soft fort** : system prompt répète "READ-ONLY MODE" + liste explicite des actions interdites
3. **Token economy** : `omitClaudeMd: true` économise prompt tokens (l'agent principal a déjà le contexte global)

`planAgent.ts` (`built-in/planAgent.ts:73-92`) suit exactement le même pattern, avec en plus une sortie structurée requise (`### Critical Files for Implementation` 3-5 paths).

### État Code Buddy

Code Buddy a 8 `SpecializedAgent` (`src/agent/specialized/agent-registry.ts:65-82`) : PDF, Excel, DataAnalysis, SQL, Archive, CodeGuardian, SecurityReview, SWE.

**Différence architecturale clé** :
- **Claude Code subagents** = sub-LLM **conversation agents** avec system prompt custom + restricted tools, dispatchés via `Agent` tool avec `subagent_type` field
- **Code Buddy `SpecializedAgent`** = task **executors fonctionnels** (PDF extract, Excel read, SQL query, etc.) — interface `execute(task: AgentTask): Promise<AgentResult>`, pas de conversation

Ces deux concepts ne sont **pas isomorphes**. Code Buddy a probablement le concept "sub-LLM conversation agent" ailleurs (mémoire mentionne `sessions_*` tools, WorkflowOrchestrator, Multi-agent V0.4) mais pas avec le pattern `disallowedTools` + system prompt strict.

**Gap clé** : pas de `Explore`-équivalent read-only avec enforcement par-agent.

**Status** : ⚠️ **PARTIAL**. Domain-specific agents OK, conversational subagents avec restricted tools manquants.

---

## Q4 — Background scheduling primitives

| | Claude Code | Code Buddy |
|---|-------------|-----------|
| Recurring jobs | `CronCreate / CronDelete / CronList` tools | `src/scheduler/cron-scheduler.ts` (très complet : at/every/cron, status, backoff, retry) ✅ |
| Self-pacing | `ScheduleWakeup` (delaySeconds + reason + prompt) for `/loop dynamic` | ❌ **MISSING** |
| Notifications | `PushNotification` tool | `terminal-notifications.ts` + Channel plugin system (delivery: 'channel'/'webhook'/'none') |
| Stream events | `Monitor` tool | HealthMonitor with EventEmitter (`daemon/health-monitor.ts:62-91`), partial |
| Remote triggers | `RemoteTrigger` | (à confirmer) |

**Différence-clé** : Cron est très bien couvert par Code Buddy. Le vrai gap est `ScheduleWakeup` — la primitive qui permet à Claude de **se planifier dans le futur** dans le cadre d'un `/loop` autonome (cas d'usage : "réveille-toi dans 20 min pour vérifier la build").

**Status** : ⚠️ **PARTIAL**. Cron OK, self-pacing manquant.

---

## Synthèse

| Zone | Status | Gap |
|------|--------|-----|
| Plan Mode workflow phasé | ⚠️ PARTIAL | Pas de 5-phase orchestrator (juste read-only mode) |
| Structured user questions | ✅ COMPLETE | Aucun gap |
| Subagent specialization | ⚠️ PARTIAL | Pas de sub-LLM conversational agents avec `disallowedTools` |
| Background scheduling | ⚠️ PARTIAL | Pas de `ScheduleWakeup` self-pacing |

**Le gap le plus structurel** : Q3 (subagent specialization). Adresser ce gap permettrait simultanément :
- Implémenter `Explore`-équivalent (utile à toute la fleet pour audits rapides)
- Implémenter `Plan`-équivalent (utile pour planification phasée → débloque Q1)
- Pose la fondation pour `code-architect`, `code-explorer`, `code-reviewer` (pattern Claude Code)

---

## Roadmap d'adaptation à Code Buddy (proposition)

**3 phases distinctes**, implémentables indépendamment (chaque phase = 1 PR, 1 commit, 1 ship).

### Phase A (V1.x) — Interface `ConversationalSubagentDefinition`

**Scope** : ajouter une nouvelle interface distincte de `SpecializedAgent` pour les sub-LLM conversational agents.

**Fichier** : `src/agent/conversational/types.ts` (NEW)

```typescript
export interface ConversationalSubagentDefinition {
  /** Stable identifier — referenced by `Agent` tool's `subagent_type` field */
  agentType: string;
  /** Description for the dispatcher LLM (when to call this agent) */
  whenToUse: string;
  /** Tool names this agent CANNOT use (blacklist enforcement) */
  disallowedTools: string[];
  /** Optional: only allow these tools (whitelist; alternative to blacklist) */
  allowedTools?: string[];
  /** Model preference: 'inherit' from main agent, or specific model name */
  model?: string | 'inherit';
  /** Skip CLAUDE.md injection (token economy for read-only agents) */
  omitClaudeMd?: boolean;
  /** Build the system prompt for this subagent */
  getSystemPrompt(): string;
}
```

**Risque** : modéré (nouveau code, pas de breaking change sur les SpecializedAgents existants).

**LOC estimés** : ~80 (interface + 1 helper de validation + tests).

### Phase B (V1.x) — Enforcement layer

**Scope** : quand le main agent dispatch un sub-agent (via `sessions_spawn` ou équivalent), filter outgoing tool list par `disallowedTools` du subagent.

**Fichiers à toucher** :
- `src/agent/sessions-tools.ts` ou équivalent (point de dispatch)
- Possibly `src/agent/conversational/dispatcher.ts` (NEW thin layer)

**Risque** : haut. Touche le dispatch sub-agent qui est cœur multi-agent V0.4. Tests existants peuvent casser.

**LOC estimés** : ~120 + tests robustes.

**Stratégie** : opt-in flag pendant 1-2 semaines de stabilisation, puis default-on.

### Phase C (V1.x) — Premier subagent : `ExploreAgent`

**Scope** : créer `ExploreAgent` first user de l'interface Phase A.

**Fichier** : `src/agent/conversational/built-in/explore-agent.ts` (NEW)

**Système prompt** : adapté du Claude Code source (références `D:\CascadeProjects\claude-code-source-code-main\src\tools\AgentTool\built-in\exploreAgent.ts:13-57`). Adaptations :
- Remplacer `BashTool` → `bash` (Code Buddy naming)
- Remplacer `GlobTool` → `search` ou `view_files`
- Remplacer `GrepTool` → `search` (Code Buddy a un seul outil de recherche unifié)
- Ajouter mention `apply_patch` dans les forbidden actions

**`disallowedTools`** : `['edit', 'apply_patch', 'create_file', 'write_file', 'delete_file', 'bash_run']` (à confirmer avec les noms exacts Code Buddy).

**Risque** : faible (pure ajout, n'impacte rien si Phase B est opt-in).

**LOC estimés** : ~150 (agent definition + system prompt + tests).

### Ordre d'exécution recommandé

A → C → B :
- Phase A pose l'interface (sans usage)
- Phase C ajoute le premier user (avec soft enforcement via system prompt)
- Phase B ajoute hard enforcement (peut être différé indéfiniment si soft suffit en pratique)

Cet ordre minimise le risque : si Phase B est trop coûteux, A+C sont déjà utiles standalone.

---

## Compromis et risques

| Phase | Risque principal | Mitigation |
|-------|------------------|------------|
| A | Conflit avec SpecializedAgent existant | Nouveau dossier `conversational/`, pas de modification de l'existant |
| B | Casser tests dispatch sub-agent (V0.4) | Opt-in flag, observation 1 semaine, then default-on |
| C | Soft enforcement insuffisant (LLM ignore le prompt) | Acceptable trade-off pour V1, hard enforcement attend Phase B |

---

## Pour les autres Claudes du fleet

- Source Claude Code disponible localement chez Patrice à `D:\CascadeProjects\claude-code-source-code-main`. Pas de copier-coller — étude inspirationnelle seulement.
- 3-phase roadmap = travail sur 3 PRs distinctes. Chacun peut prendre une phase.
- Les fichiers exacts à étudier :
  - `src/tools/AgentTool/built-in/exploreAgent.ts` (84 lignes)
  - `src/tools/AgentTool/built-in/planAgent.ts` (92 lignes)
  - `src/utils/planModeV2.ts` (le 5-phase workflow)
- Les fichiers Code Buddy à connaître :
  - `src/agent/specialized/types.ts:84-200` (SpecializedAgent base class)
  - `src/agent/specialized/agent-registry.ts:65-82` (registration pattern)
  - `src/agent/operating-modes.ts:169-184` (current PLAN_MODE definition)
  - `src/tools/exit-plan-mode-tool.ts:43` (`allowedPrompts` already exists ✅)

## Conclusion

L'écart Claude Code ↔ Code Buddy sur les subagents conversationnels est **réel mais adressable**. Le pattern Claude Code est **élégamment simple** (interface 7 champs + array blacklist + system prompt) et la roadmap proposée le décompose en 3 phases manageables.

Cohérent avec le pattern audit-doc qui a déjà permis 4 ships (compaction + 3 recos Gemini CLI). À la fleet de décider qui prend la première phase — la difficulté augmente A < C < B.

---

*Audit Claude Opus 4.7 sur DARKSTAR — 2026-05-04, ~3% du budget hebdo restant à 19% au moment de l'audit. Doc-only ship pour permettre l'itération asynchrone par d'autres Claudes.*
