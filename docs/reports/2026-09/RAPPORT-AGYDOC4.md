# RAPPORT-AGYDOC4 — Vérification de la véracité de CLAUDE.md

- **Date :** 2026-09-04
- **Mission :** AGYDOC4 (LECTURE SEULE, confrontation ligne par ligne)
- **Clone :** `~/DEV/cb-agydoc4-2026-09-04`
- **Périmètre audité :** Tableau Middleware, AgentRegistry/Verifier, Limites d'appels d'outils, Permission modes/dontAsk, Chemins de rapports post-RANG1, Tests et configuration Vitest.

---

## Tableau de confrontation ligne par ligne

| Affirmation | CLAUDE.md:ligne | Code fichier:ligne | Verdict | Phrase de remplacement exacte si FAUX / IMPRÉCIS |
| :--- | :--- | :--- | :--- | :--- |
| **Pipeline Middleware : tableau des 9 middlewares et priorités (10 à 200)** | L.83-93 | `src/agent/codebuddy-agent.ts:377-474`<br>`src/agent/middleware/*.ts` | **IMPRÉCIS** | Ajouter dans le tableau : `VerificationEnforcementMiddleware` (155), `VisualValidationMiddleware` (156) et `PlanCompletionAuditMiddleware` (157). |
| **AutoObservationMiddleware enregistré séparément ~ligne 1503** | L.91 | `src/agent/codebuddy-agent.ts:1980-1985` | **IMPRÉCIS** | `AutoObservationMiddleware` \| 50 \| Capture auto-observations (registered separately in `enableAutoObservation()`, line 1985) |
| **VerificationEnforcementMiddleware (155) câblé à codebuddy-agent.ts:~393** | L.95 | `src/agent/codebuddy-agent.ts:440-445` | **IMPRÉCIS** | `VerificationEnforcementMiddleware` (155) **is** wired (`codebuddy-agent.ts:441`) — it nudges "verify before finishing" once per task... |
| **« The table plus the separately-registered AutoObservationMiddleware is now the exhaustive wired set »** | L.95 | `src/agent/codebuddy-agent.ts:447-465` | **FAUX** | The full wired set in `codebuddy-agent.ts` also includes `VerificationEnforcementMiddleware` (155), `VisualValidationMiddleware` (156, Office docs snapshot nudge), `PlanCompletionAuditMiddleware` (157, Manus-inspired open plan checklist audit), and `AutoObservationMiddleware` (50, line 1985). |
| **QualityGateMiddleware auto-délègue à CodeGuardian et SecurityReview** | L.93 | `src/agent/middleware/quality-gate-middleware.ts:16-23, 372-411, 438-447`<br>`src/agent/delegation/thread-delegation.ts:1-120`<br>`src/agent/delegation/thread-task-runner.ts:46-65` | **VRAI** | *(Néant - Affirmation vraie. Le middleware délègue désormais via `ThreadTaskRunner` / `ThreadDelegation` avec budget borné, concurrence max 2, streaming d'événements multiplexés et extraction structurée).* |
| **VisualValidationMiddleware (156) et PlanCompletionAuditMiddleware (157)** | *(absent)* | `src/agent/codebuddy-agent.ts:447-465`<br>`src/agent/middleware/visual-validation-middleware.ts:18-21`<br>`src/agent/middleware/plan-completion-audit.ts:15-18` | **ABSENT** | \| `VisualValidationMiddleware` \| 156 \| Suggest snapshot/screenshot verification for saved Office docs (Win32) \|<br>\| `PlanCompletionAuditMiddleware` \| 157 \| Nudge once to audit open items in `PLAN.md` before concluding \| |
| **AgentRegistry : 9 agents intégrés dont Verifier (read/execute only, CONFIRMED/NEEDS REVIEW, executeOn('verifier', ...))** | L.40 | `src/agent/specialized/agent-registry.ts:83-93, 281-369`<br>`src/agent/specialized/verifier-agent.ts:1-21, 47-60, 226-234` | **VRAI** | *(Néant - Affirmation vraie. Les agents spécialisés sont situés dans `src/agent/specialized/` et `executeOn('verifier', ...)` passe par `ThreadTaskRunner` / `ThreadDelegation` avec budget max 12 tours, 1$ et 32k tokens).* |
| **Diagramme Architecture : « Tool calls (max 50, YOLO 400) »** | L.51 | `src/agent/codebuddy-agent.ts:142`<br>`src/agent/execution/agent-executor.ts:1350`<br>`src/index.ts:1418-1420` | **IMPRÉCIS** | `Tool rounds (max 50, YOLO 400)` *(Ce sont des tours d'exécution d'outils / turn rounds définis par `maxToolRounds` et `--max-tool-rounds`, chaque tour pouvant exécuter plusieurs tool calls en parallèle).* |
| **YOLO mode : 400 tool rounds, $100 cap** | L.329 | `src/agent/codebuddy-agent.ts:142, 145-152`<br>`src/utils/autonomy-manager.ts` | **VRAI** | *(Néant - Affirmation vraie).* |
| **Permission modes (default, plan, acceptEdits, dontAsk, bypassPermissions) et dontAsk** | L.331,<br>L.272 | `src/security/permission-modes.ts:18, 166-186, 237-242`<br>`src/sandbox/execpolicy.ts:197-239`<br>`src/tools/bash/bash-tool.ts:443-505` | **VRAI** | *(Néant - Affirmation vraie. En `dontAsk`, les outils destructeurs nécessitent confirmation ; les lectures `git -C <dir>` sont autorisées dans le bac à sable par `execpolicy.ts` suite à HEADLESS2).* |
| **Chemins cités vers les rapports de mission (RAPPORT-*.md, REPARATION-*.md)** | *(absent)* | `docs/reports/`<br>`docs/reports/2026-08/`<br>`docs/reports/2026-09/`<br>`docs/reports/RANG1-2026-09-03.md` | **IMPRÉCIS** | Mentionner dans la section de documentation que les bilans et rapports de missions sont archivés sous `docs/reports/<AAAA-MM>/` suite à RANG1. |
| **Lien relatif dreaming.svg : `[`dreaming.svg`](dreaming.svg)`** | L.160 | `buddy-sense/docs/dreaming.svg` | **FAUX** | `[`dreaming.svg`](buddy-sense/docs/dreaming.svg)` *(Le fichier `dreaming.svg` n'existe pas à la racine du dépôt mais dans `buddy-sense/docs/`).* |
| **Tests : « Tests live in tests/ only — no in-source src/**/*.test.ts files »** | L.29 | `vitest.config.ts:118`<br>`find src -name "*.test.ts"` (0 résultat) | **VRAI** | *(Néant - Affirmation vraie. `vitest.config.ts` inclut le motif `src/` mais aucun fichier de test n'est présent sous `src/`).* |
| **Vitest config : pool 'forks' et --max-old-space-size=8192** | L.29 | `vitest.config.ts:129, 141` | **IMPRÉCIS** | Vitest with `pool: 'forks'` and `--max-old-space-size=8192` (4096 on Windows). |
| **Vitest setup : shims globalThis.jest → vi & transform jest-compat** | L.29 | `vitest.setup.ts:9-33`<br>`vitest.config.ts:35-72` | **VRAI** | *(Néant - Affirmation vraie).* |

---

## Bilan synthétique

- **Comptage par verdict :**
  - **VRAI :** 7
  - **IMPRÉCIS :** 5
  - **FAUX :** 2
  - **ABSENT :** 1
  - **Total éléments confrontés :** 15

- **Le mensonge / l'inexactitude le plus coûteux :**
  L'affirmation en ligne 95 affirmant que le tableau (avec `AutoObservationMiddleware`) forme l'ensemble *exhaustif* des middlewares câblés (« *is now the exhaustive wired set* »).
  **Impact :** Cela masque complètement l'existence et l'exécution active de `PlanCompletionAuditMiddleware` (priorité 157, audit de clôture des plans Manus) et de `VisualValidationMiddleware` (priorité 156), tout en omettant `VerificationEnforcementMiddleware` (priorité 155) du tableau récapitulatif et en fournissant des numéros de lignes erronés (`~393` au lieu de `441`, et `~1503` au lieu de `1985`).
