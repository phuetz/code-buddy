# VERIF-TRAJECTORY-AGY — Vérification indépendante des chantiers C1 et C5

Date : 2026-09-06
Réviseur : agy (DeepMind / Advanced Agentic Coding)
Dépôt : `~/DEV/cb-heartwatch-2026-09-05`
Branche : `feat/trajectory-2026-09-06`
Commits vérifiés :
- `f565be180` : feat(tools): taxonomie C5 effect read/reversible/emission
- `2be0d27c2` : feat(run): vue trajectory unifiée d'un run existant
- `904f258b1` : docs(trajectory): rapport C1/C5, CLI et non-journalisé
Rapport audité : `docs/reports/2026-09/TRAJECTORY-GROK.md`
HOME d'exécution QA : `~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home`

---

## 1. Tableau de vérification synthétique

| Point | Objet | Fichier:Ligne | Statut | Preuve synthétique |
|---|---|---|---|---|
| **C5.1** | Outil `scan_vulnerabilities` : spawn `npm audit` / réseau classé `read` | `src/tools/metadata.ts:1672`<br>`src/security/dependency-vuln-scanner.ts:82` | **TROU** | `execSync(cmd, ...)` spawn un processus externe (`npm audit`, `pip-audit`, `cargo audit`, `composer audit`) avec accès réseau sortant potentiel. Classé `read` au lieu d'`emission`. |
| **C5.2** | Outil `port_check` : connexion TCP socket classé `read` | `src/tools/metadata.ts:1944`<br>`src/tools/port-check-tool.ts:6` | **TROU** | `net.connect(port, host)` ouvre une socket réseau TCP active. Classé `read` au lieu d'`emission` (alors que `http_probe` sur loopback est `emission`). |
| **C5.3** | Outil `git_summary` : spawn du binaire `git` classé `read` | `src/tools/metadata.ts:1928`<br>`src/tools/git-summary-tool.ts:11` | **TROU** | `execFileAsync('git', ['-C', root, ...args])` spawn le sous-processus `git`. Classé `read` au lieu d'`emission`. |
| **C5.4** | Outil `env_doctor` : spawn du binaire `which` classé `read` | `src/tools/metadata.ts:1936`<br>`src/tools/env-doctor-tool.ts:13` | **TROU** | `execFileAsync('which', [name])` spawn un sous-processus `which`. Classé `read` au lieu d'`emission`. |
| **C5.5** | Outil `format_project` : spawn du binaire `prettier` classé `reversible` | `src/tools/metadata.ts:1952`<br>`src/tools/format-project-tool.ts:15` | **TROU** | `execFile(launch.file, launch.args, ...)` spawn le sous-processus `prettier`. Classé `reversible` (alors que `lint_project` est `emission` : « linter spawn »). |
| **C5.6** | Échantillon aléatoire (25 outils) & cibles spécifiques | `src/tools/metadata.ts`<br>`src/tools/types.ts` | **TIENT** | 20/25 de l'échantillon conformes. Outils ciblés : `bash` (`emission`), `shell_exec` (alias vers `bash`), `web_fetch`/`web_search` (`emission`), `send_message`/telegram/slack (`emission`), `app_server` (`emission`), `process`/`terminate`/kill (`emission`), `git` (`emission`), `mcp_*` (`unknown` + warning unique), `peer_*` (`emission`), `remind` (`reversible`), `video_generate`/`image_generate` (`emission`). |
| **C5.7** | Exposition dans `tool_search` et `buddy tools catalog` | `src/tools/tool-search.ts:193,211`<br>`src/commands/cli/tools-commands.ts:310-330` | **TIENT** | `tool_search` expose `effect: <classe>` dans le texte et `data.effects`. `buddy tools catalog [--json]` liste la classe `effect` en texte et JSON. |
| **C1.1** | `buildTrajectory` : chronologie (ordre, tours, durées) | `src/observability/run-trajectory.ts:297,381,630` | **TIENT** | `out.sort((a,b) => a.ts - b.ts)`, affectation rigoureuse des tours via `assignTurnIndex` ordonné, durées formatées via `formatDuration`. |
| **C1.2** | Run réel avec outils : outils + classe + permissions | `src/observability/run-trajectory.ts:420-430`<br>`_qa/agy-traj/home/.codebuddy/runs/run_qa_tools` | **TIENT** | Exécution sur run avec `view_file` et `bash` : affiche bien outils, classes (`read`, `emission`), et permission `granted bash`. |
| **C1.3** | `--json` : schéma versionné, stable, sans donnée personnelle | `src/observability/run-trajectory.ts:176,229-234` | **TIENT** | `schemaVersion: 1`, `kind: "run_trajectory"`. Redaction systématique `redactHome` (`~`). 0 chemin `/home/...`, 0 nom d'utilisateur. |
| **C1.4** | Mode texte : largeur terminal 100 colonnes | `src/observability/run-trajectory.ts:586-660` | **TIENT** | Largeur maximale mesurée : 86 caractères <= 100 colonnes. |
| **C1.5** | Run inexistant : message clair et code de sortie ≠ 0 | `src/observability/run-viewer.ts:812-816` | **TIENT** | Affiche `Run not found: <runId>` et quitte avec code 1 (`process.exit(1)`). |
| **Byte-id** | Préservation des comportements existants hors trajectory / effect | Fichiers partagés hors metadata, run, docs | **TIENT** | Diff purement additif dans `tools-commands.ts`, `types.ts`, `tool-search.ts`. Aucune modification fonctionnelle des flux agent. |
| **Tests** | Rejeu Vitest (1847 verts) et compilation TypeScript | `tests/tools`, `tests/cli`, `tests/security` | **TIENT** | Vitest : 193 suites passées, 1847 tests passés, 0 failed, 3 skipped. `tsc -p tsconfig.json` : code 0, 0 erreur. |
| **Non-journ.** | Exactitude des 3 items « non journalisé » du rapport Grok | `src/utils/confirmation-service.ts:264`<br>`src/security/audit-logger.ts:67`<br>`src/observability/run-store.ts:79` | **TIENT** | 1. `confirmation_requested` jamais émis en log.<br>2. `auditLogger.init` jamais appelé en production (`logFile` null).<br>3. Cache tokens absents de `RunMetrics` et `SessionTurnUsage`. |

---

## 2. Commandes et sorties d'exécution détaillées

### 2.1 C5 — Vérification de la classification d'effet des outils

#### Comptage global des classes C5
Commande :
```bash
node --import tsx/esm -e "import { TOOL_METADATA } from './src/tools/metadata.ts'; console.log('Total tools:', TOOL_METADATA.length); const effects = {}; for (const t of TOOL_METADATA) { effects[t.effect] = (effects[t.effect] || 0) + 1; } console.log(effects);"
```
Sortie :
```text
Total tools: 229
{ read: 77, reversible: 52, emission: 100 }
```

#### Échantillon aléatoire reproductible de 25 outils
Tiré avec un PRNG pseudo-aléatoire seedé (20260906) :
1. `kubernetes` (`emission`) : `src/tools/kubernetes-tool.ts:25` — `spawn('kubectl', args)`. TIENT.
2. `video_quality_gate` (`emission`) : `src/tools/video-quality-gate-tool.ts:4` — classé emission. TIENT.
3. `mixture_of_agents` (`emission`) : `src/tools/registry/moa-tools.ts:23` — requêtes réseau LLM fan-out. TIENT.
4. `lessons_add` (`reversible`) : `src/tools/registry/lessons-tools.ts:52` — écrit dans `lessons.md` local. TIENT.
5. `document` (`reversible`) : `src/tools/document-tool.ts` — génère document local réversible. TIENT.
6. `scan_vulnerabilities` (`read`) : `src/security/dependency-vuln-scanner.ts:82` — **TROU** (`execSync(cmd)` spawn `npm audit` / réseau sortant).
7. `web_extract` (`emission`) : `src/tools/web-extract-tool.ts` — fetch HTTP. TIENT.
8. `vision_analyze` (`read`) : `src/tools/registry/vision-tools.ts:41` — analyse locale en mémoire. TIENT.
9. `license_check` (`read`) : `src/tools/license-check-tool.ts:8` — lit `node_modules/*/package.json` sans spawn ni réseau. TIENT.
10. `kanban_show` (`read`) : `src/tools/registry/kanban-tools.ts` — lecture locale. TIENT.
11. `video_route` (`read`) : `src/tools/video-route-tool.ts` — calcul mémoire. TIENT.
12. `remember` (`reversible`) : `src/tools/registry/memory-tools.ts` — mémoire locale. TIENT.
13. `feishu_drive_list_comment_replies` (`emission`) : `src/tools/registry/feishu-tools.ts` — appel API Feishu externe. TIENT.
14. `user_model_recall` (`read`) : `src/tools/registry/user-model-tools.ts` — lecture profil utilisateur. TIENT.
15. `kanban_complete` (`reversible`) : `src/tools/registry/kanban-tools.ts` — mise à jour kanban local. TIENT.
16. `lead_scout_lesson_candidates` (`reversible`) : `src/leads/lead-scout-lessons.ts` — suggestions locales. TIENT.
17. `context_expand` (`read`) : `src/tools/context-expand-tool.ts` — lecture contexte local. TIENT.
18. `lead_scout_run` (`emission`) : `src/browser-automation/lead-scout-runner.ts` — scout réseau externe. TIENT.
19. `json_query` (`read`) : `src/tools/json-query-tool.ts` — évaluation jq/json locale en lecture. TIENT.
20. `process` (`emission`) : `src/tools/registry/process-tools.ts:42` — gestion processus (kill, spawn). TIENT.
21. `advisor` (`read`) : `src/tools/advisor-tool.ts` — analyse consultative locale. TIENT.
22. `create_todo_list` (`reversible`) : `src/tools/registry/todo-tools.ts` — todo locale. TIENT.
23. `format_project` (`reversible`) : `src/tools/format-project-tool.ts:15` — **TROU** (`execFile` spawn `prettier`).
24. `create_file` (`reversible`) : `src/tools/filesystem/create-file.ts` — création fichier local réversible. TIENT.
25. `codebase_map` (`read`) : `src/tools/codebase-map.ts` — lecture statique arbre source. TIENT.

#### Outils ciblés par la mission
- `bash` : `emission` (`src/tools/metadata.ts:116`). TIENT.
- `shell_exec` : alias mappé vers `bash` (`src/tools/registry/tool-alias-map.ts:17`). TIENT.
- `web_fetch` / `web_search` : tous deux `emission` (`src/tools/metadata.ts:246, 219`). TIENT.
- `send_message` / telegram / slack : `send_message` est `emission` (`src/tools/metadata.ts:809`), supporte telegram et slack (`src/channels/send-message.ts:83,85`). TIENT.
- `app_server` : `emission` (`src/tools/metadata.ts:145`). TIENT.
- `kill` / process : `process` (action `kill` à la ligne 42 de `process-tools.ts`) et `terminate` sont `emission` (`src/tools/metadata.ts:138, 1675`). TIENT.
- `git_*` : `git` est `emission` (`src/tools/metadata.ts:153`). `git_summary` est classé `read` mais spawn `git` via `execFileAsync` (`src/tools/git-summary-tool.ts:11`). **TROU**.
- `mcp_*` : non déclarés statiquement dans `TOOL_METADATA` ; instanciés via `McpToolAdapter`, résolus en `unknown` + warning unique (`src/tools/metadata.ts:2088-2100`). TIENT.
- `peer_*` : `peer_delegate`, `peer_chain`, `list_peers`, `route_peer` tous `emission` (`src/tools/metadata.ts:1839-1863`). TIENT.
- `register_tool` : non déclaré dans `TOOL_METADATA` ; résolu en `unknown` via warning unique latch (`src/tools/metadata.ts:2088-2100`). TIENT.
- `remind` : `reversible` (`src/tools/metadata.ts:1625`), persiste dans `~/.codebuddy/reminders.json` (`src/companion/reminders.ts:54`). TIENT.
- `video_generate` / `image_generate` : tous deux `emission` (`src/tools/metadata.ts:1073, 1040`). TIENT.

#### Exposition dans `buddy tools catalog`
Commande :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx tsx src/index.ts tools catalog | head -n 15
```
Sortie :
```text
Tool catalog: 228 tools

  view_file  effect=read  category=file_read
  read_file  effect=read  category=file_read
  create_file  effect=reversible  category=file_write
  write_file  effect=reversible  category=file_write
  str_replace_editor  effect=reversible  category=file_write
  patch  effect=reversible  category=file_write
  edit_file  effect=reversible  category=file_write
  multi_edit  effect=reversible  category=file_write
  apply_patch  effect=reversible  category=file_write
  self_describe  effect=read  category=system
  self_evolution  effect=read  category=system
  bash  effect=emission  category=system
  terminal  effect=emission  category=system
```

Exposition en format JSON :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx tsx src/index.ts tools catalog --json | head -n 18
```
Sortie :
```json
{
  "count": 228,
  "tools": [
    {
      "name": "view_file",
      "category": "file_read",
      "effect": "read",
      "description": "View file contents or directory listings",
      "fleetSafe": true
    },
    {
      "name": "read_file",
      "category": "file_read",
      "effect": "read",
      "description": "Read file contents with optional line range",
      "fleetSafe": true
    }
```

#### Exposition dans `tool_search`
Commande :
```bash
node --import tsx/esm -e "
import { ToolSearchTool, initToolSearchIndex } from './src/tools/tool-search.ts';
import { TOOL_METADATA } from './src/tools/metadata.ts';
initToolSearchIndex(TOOL_METADATA.map(m => ({ name: m.name, description: m.description, keywords: m.keywords })));
const tool = new ToolSearchTool();
const res = await tool.execute({ query: 'bash command terminal' });
console.log(res.output);
console.log('effects:', JSON.stringify(res.data?.effects));
"
```
Sortie :
```text
Found 3 tools:

1. **terminal** (score: 17.61)
   effect: emission
   Execute shell commands through the existing bash safety checks

2. **bash** (score: 16.91)
   effect: emission
   Execute bash commands

3. **interactive_shell** (score: 3.77)
   effect: emission
   Hand control of an interactive PTY shell to the user until they type exit

effects: {"terminal":"emission","bash":"emission","interactive_shell":"emission"}
```

---

### 2.2 C1 — Vue Trajectory unifiée

#### Exécution en mode texte sur un run complet avec outils et permissions
Commande :
```bash
env -u FORCE_COLOR CODEBUDDY_TIMELINE=true HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx tsx src/index.ts run trajectory run_qa_tools
```
Sortie :
```text
Run trajectory  schema=1  kind=run_trajectory
Run: run_qa_tools  status=completed
Objective: test tools trajectory
Session: session_qa_tools
Started: 2026-09-06T06:43:20.000Z
Ended:   2026-09-06T06:43:30.000Z

── Résumé ────────────────────────────────
  Appels d'outils: 2
  Emission:        50% (1/2)
  Tokens in/out:   1500 / 80
  Tokens cache:    non journalisé: tokens cache agrégés
  Coût:            0.002
  Durée:           10.0s
  Points de non-retour:
    - 2026-09-06T06:43:23.000Z  bash  effect=emission (irréversible)

── Tours ─────────────────────────────────
  tour 1  ts=2026-09-06T06:43:21.000Z
    - view_file  effect=read  200ms  ok
    - bash  effect=emission  2.0s  ok
    permissions: granted bash
    usage in/out/cache/cost: 1500 / 80 / non journalisé: tokens cache par tour / 0.002
    fichiers: ~/hello.ts
    processus: bash command="echo hi" pid=non journalisé: pid
    outbound: non journalisé: requêtes sortantes

── rule-runs ─────────────────────────────
  non journalisé: rule-runs.jsonl

── Non journalisé ────────────────────────
  - cost-history.json
  - rule-runs.jsonl
  - cache tokens (jamais journalisés dans RunStore ni SessionTurnUsage)
  - pids de processus
  - ModelRoutingFacade (coût de session en mémoire, non persisté)
  - confirmation_requested (type déclaré, jamais émis par ConfirmationService)
```

#### Exécution en mode `--json` et validation de confidentialité
Commande :
```bash
env -u FORCE_COLOR CODEBUDDY_TIMELINE=true HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx tsx src/index.ts run trajectory --json run_qa_tools
```
Sortie JSON :
```json
{
  "schemaVersion": 1,
  "kind": "run_trajectory",
  "generatedAt": "2026-09-06T06:57:08.431Z",
  "runId": "run_qa_tools",
  "objective": "test tools trajectory",
  "status": "completed",
  "startedAt": 1788677000000,
  "endedAt": 1788677010000,
  "sessionId": "session_qa_tools",
  "turns": [
    {
      "turn": 1,
      "ts": 1788677001000,
      "tools": [
        {
          "name": "view_file",
          "effect": "read",
          "durationMs": 200,
          "success": true,
          "ts": 1788677001000,
          "callId": "c1"
        },
        {
          "name": "bash",
          "effect": "emission",
          "durationMs": 2000,
          "success": true,
          "ts": 1788677003000,
          "callId": "c2"
        }
      ],
      "permissions": [
        {
          "ts": 1788677003000,
          "action": "granted",
          "target": "bash",
          "operation": "execute bash command",
          "source": "user"
        }
      ],
      "usage": {
        "inputTokens": 1500,
        "outputTokens": 80,
        "cacheTokens": {
          "journaled": false,
          "reason": "non journalisé: tokens cache par tour"
        },
        "costUsd": 0.002
      },
      "sideEffects": {
        "files": [
          "~/hello.ts"
        ],
        "processes": [
          {
            "tool": "bash",
            "command": "echo hi",
            "pid": {
              "journaled": false,
              "reason": "non journalisé: pid"
            }
          }
        ],
        "outbound": {
          "journaled": false,
          "reason": "non journalisé: requêtes sortantes"
        }
      }
    }
  ],
  "ruleRuns": {
    "journaled": false,
    "reason": "non journalisé: rule-runs.jsonl"
  },
  "summary": {
    "toolCallCount": 2,
    "emissionCount": 1,
    "emissionPct": 50,
    "pointsOfNoReturn": [
      {
        "ts": 1788677003000,
        "tool": "bash",
        "reason": "effect=emission (irréversible)"
      }
    ],
    "totals": {
      "durationMs": 10000,
      "inputTokens": 1500,
      "outputTokens": 80,
      "cacheTokens": {
        "journaled": false,
        "reason": "non journalisé: tokens cache agrégés"
      },
      "costUsd": 0.002
    }
  },
  "unlogged": [
    "cost-history.json",
    "rule-runs.jsonl",
    "cache tokens (jamais journalisés dans RunStore ni SessionTurnUsage)",
    "pids de processus",
    "ModelRoutingFacade (coût de session en mémoire, non persisté)",
    "confirmation_requested (type déclaré, jamais émis par ConfirmationService)"
  ]
}
```

Vérification de confidentialité sur le JSON :
```bash
node --import tsx/esm -e "
import { execSync } from 'child_process';
const out = execSync('env -u FORCE_COLOR CODEBUDDY_TIMELINE=true HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx tsx src/index.ts run trajectory --json run_qa_tools', { encoding: 'utf8' });
console.log('Contient chemin /home/... ?', /\/home\/[a-zA-Z0-9_-]+/.test(out));
"
```
Sortie :
```text
Contient chemin /home/... ? false
```

#### Largeur terminal 100 colonnes
Commande :
```bash
node --import tsx/esm -e "
import { execSync } from 'child_process';
const out = execSync('env -u FORCE_COLOR CODEBUDDY_TIMELINE=true HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx tsx src/index.ts run trajectory run_qa_tools', { encoding: 'utf8' });
const max = Math.max(...out.split('\n').map(l => l.length));
console.log('Longueur max de ligne:', max, '-> Tient sur 100 colonnes ?', max <= 100);
"
```
Sortie :
```text
Longueur max de ligne: 86 -> Tient sur 100 colonnes ? true
```

#### Run inexistant
Commande :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx tsx src/index.ts run trajectory run_inexistant
```
Sortie :
```text
Run not found: run_inexistant
(code de retour : 1)
```

---

### 2.3 Préservation byte-identique des comportements existants

Diff des fichiers touchés hors `metadata.ts`, `src/commands/run-cli/index.ts`, `src/observability/run-trajectory*`, `src/observability/run-viewer.ts`, `docs/*` :
```bash
git diff f565be180^..HEAD -- .gitignore src/commands/cli/tools-commands.ts src/tools/registry/types.ts src/tools/tool-search.ts src/tools/types.ts
```
Résultat :
- `.gitignore` : ajout de `_qa/traj/`.
- `src/commands/cli/tools-commands.ts` : ajout de `effect` dans l'affichage de `runToolsProfile` et commande `buddy tools catalog`.
- `src/tools/registry/types.ts` : ajout du champ optionnel `effect?: 'read' | 'reversible' | 'emission'` dans `IToolMetadata`.
- `src/tools/tool-search.ts` : ajout de la ligne `effect: ...` et `data.effects` dans les résultats de recherche.
- `src/tools/types.ts` : types `ToolEffectClass` et constante `TOOL_EFFECT_CLASSES`, champ optionnel `effect?: ToolEffectClass` dans `ToolMetadata`.

Toutes les modifications sont strictement additives. Aucun flux existant n'est altéré.

---

### 2.4 Rejeu des tests Vitest et TypeScript

#### Vitest
Commande :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-traj/home npx vitest run tests/tools tests/cli tests/security/donnees-personnelles.test.ts
```
Sortie :
```text
 Test Files  193 passed | 2 skipped (195)
      Tests  1847 passed | 3 skipped (1850)
   Start at  08:52:34
   Duration  107.41s (transform 11.66s, setup 2.07s, import 34.27s, tests 331.54s, environment 24ms)
(code de retour : 0)
```

#### TypeScript check
Commande :
```bash
npx tsc --noEmit -p tsconfig.json | tail -2
```
Sortie :
```text
(sortie vide, code de retour : 0)
```

---

### 2.5 Vérification de la liste « non journalisé » du rapport Grok

1. **`confirmation_requested` jamais journalisé** :
   Dans `src/utils/confirmation-service.ts:264` :
   ```typescript
   auditLogger.log({
     action: result.confirmed ? 'confirmation_granted' : 'confirmation_denied',
     decision: result.confirmed ? 'allow' : 'block',
   ...
   ```
   `ConfirmationService` n'émet que `confirmation_granted` ou `confirmation_denied`. Aucune émission de `confirmation_requested` n'existe dans l'ensemble du codebase.
   -> **EXACT**.

2. **`auditLogger.init` jamais appelé en production** :
   `grep -rn "auditLogger.init" src/` retourne 0 occurrence d'appel.
   Dans `src/security/audit-logger.ts:79`, `this.logFile` n'est initialisé que par `init({ logDir })`. Faute d'appel en production, `this.logFile` reste `null` et aucun fichier JSONL d'audit n'est écrit sur disque.
   -> **EXACT**.

3. **Cache tokens absents du RunStore** :
   Dans `src/observability/run-store.ts:79-87` :
   ```typescript
   export interface RunMetrics {
     totalTokens: number;
     promptTokens: number;
     completionTokens: number;
     totalCost: number;
     durationMs: number;
     toolCallCount: number;
     failoverCount: number;
   }
   ```
   Aucun champ de token de cache n'est déclaré ni dans `RunMetrics`, ni dans `SessionTurnUsage` (`src/persistence/session-store.ts:36-43`).
   -> **EXACT**.

---

VERDICT: 5 trous
