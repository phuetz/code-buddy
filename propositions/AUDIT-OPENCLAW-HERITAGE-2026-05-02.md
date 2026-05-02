# Audit — Briques OpenClaw heritage inertes dans Code Buddy

> **Auteur** : Claude Opus 4.7 (1M context), MINISTAR / grok-cli, 2026-05-02 ~08h
> **Méthode** : grep automatisé sur 51 fichiers TS dans `src/openclaw/`, `src/collaboration/`, `src/channels/`, `src/agent/multi-agent/`, `src/daemon/`, `src/skills/` + 6 fichiers liés via `src/openclaw/index.ts` barrel.
> **Contexte** : 3ème exercice consécutif après V4.4 plan-mode (réveillé via bridge OperatingModeManager) et `/heartbeat` slash command (réveillé via wirage user-facing). Patrice a explicitement orienté l'effort vers "faire fonctionner ce qui a été hérité d'OpenClaw".
> **Statut** : audit pur, **read-only**. Aucune modification de code, aucun claim de tâche. Le rapport propose des cibles claimables — l'activation effective sera un exercice séparé.

---

## TL;DR — La trouvaille

**`initializeNativeEngineModules()`** dans `src/openclaw/index.ts` est le bootstrap des **6 modules enterprise OpenClaw**. Elle n'est **jamais appelée** ailleurs dans `src/`. Conséquence : les 6 modules sont théoriquement dormants en runtime.

```
src/openclaw/index.ts:174  export function initializeNativeEngineModules(...)
git grep -l "initializeNativeEngineModules" src/  →  src/openclaw/index.ts (seul match)
```

Modules concernés :
1. `ToolPolicyEngine` (`src/security/tool-policy.ts`) — politiques tools hiérarchiques
2. `ToolLifecycleHooks` (`src/hooks/tool-lifecycle-hooks.ts`) — hooks before/after tool calls
3. `SmartCompactionEngine` (`src/context/smart-compaction.ts`) — compaction provider-aware
4. `RetryFallbackEngine` (`src/agent/execution/retry-fallback.ts`) — rotation provider sur erreurs
5. `SemanticMemorySearch` (`src/memory/semantic-memory-search.ts`) — search 2-step + retrieve
6. `PluginConflictDetector` (`src/plugins/conflict-detection.ts`) — allowlist + métadonnées plugins

**Caveat important** : certains de ces modules ont peut-être des chemins d'activation parallèles (ex: `PolicyManager` dans `src/security/tool-policy/` est différent et ACTIF). À vérifier brique par brique avant activation. Mais le pattern barrel-jamais-appelé est suffisamment révélateur pour mériter investigation.

---

## Top 5 réveils prioritaires (ratio valeur / effort)

| # | Brique | Effort | Valeur fleet | Valeur user | Risque | Note |
|---|---|---|---|---|---|---|
| **1** | **TeamSessionManager** + `getTeamSessionManager` (`src/collaboration/team-session.ts`) | ~1-2h | **fort** | moyen | faible (isolé) | Collab WebSocket real-time. Fleet en a besoin pour passer du polling git au push notif. Aucun caller hors fichier source. |
| **2** | **DailyResetManager** + `getDailyResetManager` (`src/daemon/daily-reset.ts`) | ~30 min | **fort** | faible | faible | Cron daily ops. Utile pour rotation logs heartbeat, archive worklog, refresh state du fleet. Seul caller = barrel `src/daemon/index.ts`. |
| **3** | **`initializeNativeEngineModules()` appel au boot** (`src/openclaw/index.ts` → wirage dans `codebuddy-agent.ts`) | ~30-60 min | moyen | **fort** | **moyen** (6 modules touchés) | Réveille les 6 modules enterprise d'un coup. Audit caller-by-caller requis avant pour éviter conflit avec systèmes parallèles (`PolicyManager` vs `ToolPolicyEngine`). |
| **4** | **MultiAgentSystem** + `getMultiAgentSystem` (`src/agent/multi-agent/multi-agent-system.ts`) | ~2-4h | **fort** | moyen | moyen | Orchestration multi-agent in-process. Différent du fleet inter-host. Permettrait à un Code Buddy de spawn N agents internes coordonnés (architect/coder/reviewer/tester déjà définis dans `multi-agent/agents/*`). |
| **5** | **CollaborativeSessionManager** + `getCollaborationManager` (`src/collaboration/collaborative-mode.ts`) | ~1-2h | moyen | **fort** | faible | Mode collaboratif (peut-être pair-programming, multi-curseur ?). À investiguer pour vérifier le scope. |

---

## Tableau complet — vraies briques INERT (hors faux positifs)

Filtrage : exclues les classes dont le getter singleton est ACTIVE ailleurs (ex: `HeartbeatEngine` est INERT comme classe mais réveillé ce matin via `getHeartbeatEngine`). Reste **~30 briques INERT vraies** à valeur hétérogène :

### Multi-agent in-process (5 briques)
- `MultiAgentSystem` + `getMultiAgentSystem` (caller barrel only) — **valeur fleet/user fort**
- `EnhancedCoordinator` + `getEnhancedCoordinator` — coordination enrichie multi-agent
- `SessionRegistry` (le `getSessionRegistry` a 1 caller interne) — registry sessions
- `SessionToolExecutor` + `getSessionToolExecutor` (1 caller interne) — exécution tools par session
- `getBuiltinRoleNames` — utilitaire roles
- `CoderAgent`, `OrchestratorAgent`, `ReviewerAgent`, `TesterAgent` — 4 agents spécialisés (importables, attendent juste d'être instanciés via MultiAgentSystem)

### Collaboration / multi-user (3 briques)
- `TeamSessionManager` + `getTeamSessionManager` (0 caller) — **top 1**
- `CollaborativeSessionManager` + `getCollaborationManager` (caller barrel only) — **top 5**
- `AIColabManager` (la classe est INERT mais `getAIColabManager` ACTIVE — faux positif partiel)

### Channels avancés (probablement intentionnels — opt-in)
- `TwitchAdapter`, `TlonAdapter` — channels niche, non câblés par défaut (normal)
- `WebhookServer` + `getWebhookServer` — pas de caller, pourrait être utile au fleet (entrées GitHub/Slack/etc.)
- `OfflineQueue` — queue messages offline
- `MessagePreprocessor` — pre-processing channels
- `SendPolicyEngine` — politiques d'envoi
- `StreamingChunker`, `getChannelPolicy` — streaming chunks
- `DMPolicyEngine` + `getDMPolicyEngine` — politiques DM
- `SessionIsolator` — isolation sessions (NO_USER_PATH 1 caller)
- `SlackBlockBuilder` — builder Slack blocks
- `TelegramProFormatter` — formatter Telegram pro
- `ProFeatures` (Slack/Telegram/Discord pro features) — opt-in

### Daemon (4 briques)
- `DailyResetManager` + `getDailyResetManager` (caller barrel only) — **top 2**
- `DaemonLifecycle` + `getDaemonLifecycle` (caller barrel only) — lifecycle daemon
- `ServiceInstaller` (la classe est INERT mais `getServiceInstaller` ACTIVE — faux positif)
- `HealthMonitor` (NO_USER_PATH 1 caller) — monitoring santé

### Skills (système) (~5 INERT mais probables faux positifs)
- `SkillExecutor`, `SkillBudgetCalculator`, `SkillLoader`, `SkillRegistry` (présent en double), `SkillVariableResolver`, `getBinaryPath`, `getCurrentPlatform` — probablement actifs via `SkillsHub`/`SkillManager` singletons ACTIFS. À vérifier brique par brique.

### Enterprise modules (6 briques — barrel non bootstrapé)
- `ToolPolicyEngine` + `getToolPolicyEngine` (1 caller interne)
- `ToolLifecycleHooks` + `getToolLifecycleHooks` (caller barrel)
- `SmartCompactionEngine` + `getSmartCompactionEngine` (2 callers internes)
- `RetryFallbackEngine` + `getRetryFallbackEngine` (1 caller interne)
- `SemanticMemorySearch` + `getSemanticMemorySearch` (2 callers internes)
- `PluginConflictDetector` + `getPluginConflictDetector` (1 caller interne)

→ Activation groupée via wirage de `initializeNativeEngineModules()` au boot = **top 3**.

---

## Faux positifs (à NE PAS toucher — déjà actifs indirectement)

13 classes marquées INERT mais leur getter singleton est ACTIVE :

| Classe | Getter actif | Statut réel |
|---|---|---|
| `HeartbeatEngine` | `getHeartbeatEngine` (4 user callers) | **ACTIVE** depuis ce matin (commit `e0afe34`) |
| `AIColabManager` | `getAIColabManager` (1) | ACTIVE |
| `TeamManager` | `getTeamManager` (1) | ACTIVE |
| `DMPairingManager` | `getDMPairing` (2) | ACTIVE |
| `GroupSecurityManager` | `getGroupSecurity` (2) | ACTIVE |
| `IdentityLinker` | `getIdentityLinker` (1) | ACTIVE |
| `PeerRouter` | `getPeerRouter` (1) | ACTIVE |
| `CronAgentBridge` | `getCronAgentBridge` (1) | ACTIVE |
| `DaemonManager` | `getDaemonManager` (2) | ACTIVE |
| `ServiceInstaller` | `getServiceInstaller` (1) | ACTIVE |
| `SkillsHub` | `getSkillsHub` (2) | ACTIVE |
| `SkillRegistry` | `getSkillRegistry` (1) | ACTIVE |
| `SkillManager` | `getSkillManager` (1) | ACTIVE |

---

## Limitations méthodologiques (à considérer avant claim)

1. **Faux positifs grep** : `git grep` ne suit pas les imports dynamiques (`await import('...')`) au-delà du nom de fichier. Une brique appelée via dynamic import peut apparaître INERT.
2. **Dispatch via barrel** : certaines briques sont `export *` depuis un index, donc le grep sur leur nom peut rater des callers qui les importent depuis le barrel.
3. **Tests pas comptés** : volontaire (j'exclus `*.test.ts`), mais une brique avec uniquement des callers tests peut sembler inerte alors qu'elle est testée.
4. **Plugins/MCP externes** : tools MCP ou plugins tierce partie peuvent appeler les briques via reflection — invisible au grep.
5. **OpenClaw provenance incertaine** : sans archive de l'OpenClaw upstream à comparer, "héritage OpenClaw" est une heuristique (pattern singleton + barrel + naming enterprise). Certaines briques peuvent être originales Code Buddy, pas hérité.

→ **Pour chaque brique avant activation** : reproduire manuellement l'audit (multi-grep variants, fouille des dynamic imports, vérif des tests).

---

## Recommandations (priorisées par ratio valeur/effort)

### Quick wins (effort < 1h, valeur fleet immédiate)

1. **DailyResetManager** — wirage 30 min, débloque rotation auto des logs heartbeat/worklog du fleet. Seul caller actuel = barrel.
2. **WebhookServer** — wirage 30-60 min, ouvre intégrations GitHub/Slack/etc. push vers le fleet. Compense le polling git.

### Mid-term (1-3h, vraie valeur structurelle)

3. **TeamSessionManager** — collab WebSocket real-time. Permet aux Claudes de partager des événements live (pas juste async via repo).
4. **`initializeNativeEngineModules()` appel au boot** — réveille 6 modules enterprise en un wirage. Audit préalable des conflits avec systèmes parallèles requis.
5. **CollaborativeSessionManager** — mode collaboratif (à scoper — pair-programming ? multi-curseur ?).

### Long-term (4-12h, refacto profond)

6. **MultiAgentSystem** — orchestration multi-agent in-process. 4 agents spécialisés (CoderAgent/OrchestratorAgent/ReviewerAgent/TesterAgent) déjà définis. Actuellement instanciés que par `createAllToolsAsync` pour les tools, jamais comme système d'orchestration.

### Pas urgent (skip ou opt-in volontaire)

- Channels niche (Twitch, Tlon, pro features) : probablement intentionnellement inactifs.
- Skills sub-classes (executor/loader/budget/resolver) : probablement déjà actifs via SkillsHub singleton.

---

## Tâches claimables (pour `colab-tasks.json`)

À ajouter à la queue fleet si Patrice valide :

```json
{
  "id": "task-2026-05-02-wake-daily-reset",
  "title": "Wake DailyResetManager — câbler activation user-facing",
  "priority": "medium",
  "assignedAgent": "ministar/grok-cli",
  "filesToModify": [
    "src/agent/codebuddy-agent.ts",
    "src/config/toml-config.ts",
    "src/commands/handlers/" 
  ],
  "acceptanceCriteria": [
    "Slash /reset daily ou TOML [daily_reset]",
    "Boot wiring conditionnel",
    "Tests unitaires"
  ]
}
```

```json
{
  "id": "task-2026-05-02-wake-team-session",
  "title": "Wake TeamSessionManager — collab WebSocket real-time",
  "priority": "high",
  "assignedAgent": null,
  "filesToModify": [
    "src/agent/codebuddy-agent.ts",
    "src/server/index.ts (WebSocket route)",
    "src/commands/handlers/" 
  ],
  "acceptanceCriteria": [
    "Slash /team join|leave|status",
    "WebSocket endpoint /ws/team/:room",
    "Test end-to-end 2 sessions sync"
  ]
}
```

```json
{
  "id": "task-2026-05-02-bootstrap-enterprise-modules",
  "title": "Bootstrap initializeNativeEngineModules au boot Code Buddy",
  "priority": "high",
  "assignedAgent": null,
  "blockedBy": "Audit préalable des conflits PolicyManager vs ToolPolicyEngine",
  "filesToModify": [
    "src/agent/codebuddy-agent.ts",
    "src/config/toml-config.ts (sections [tool_policy], [smart_compaction], etc.)"
  ],
  "acceptanceCriteria": [
    "Au boot, si TOML opt-in, les 6 modules enterprise sont init",
    "Pas de régression sur PolicyManager existant",
    "Tests d'intégration"
  ]
}
```

---

## Pour Patrice

3 questions pour la suite :
1. Tu valides le rapport ? Raffinement à faire (scope plus serré, ajout de catégories) ?
2. Je claim une des 3 tâches proposées (DailyReset = quick win, recommandé pour démarrer) ?
3. Tu veux que je pousse aussi les 3 tâches en `colab-tasks.json` pour qu'elles soient claimables par d'autres Claudes ?

— Claude Opus 4.7 (1M context), MINISTAR / grok-cli, 2 mai 2026 ~08h15
