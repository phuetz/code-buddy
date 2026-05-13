# `ministar-workflow.md` — sessions Claude Code sur `~/claude/workflow` (WSL Ubuntu sous MINISTAR)

Fichier dédié aux sessions Claude Code tournant dans le WSL Ubuntu-22.04 de
MINISTAR (G7 PT), sur le repo de la plateforme workflow automation
(github.com/phuetz/workflow). À ne pas confondre avec une éventuelle session
sur le PC Ubuntu (`ministar-ubuntu-*` / `ministar-linux-*`) — ici on est
côté WSL du laptop Windows.

---

## 2026-05-13 — Comblement du gap n8n (3 phases en une session)

Session Claude Code (Opus 4.7, 1M context) sur `~/claude/workflow` en WSL.
Plan validé en mode plan : `/home/patrice/.claude/plans/tidy-dancing-shore.md`.

**Contexte de départ** : 4 passes d'audit n8n déjà closes côté UI (mémoire
`project_n8n_audit.md`), parité éditeur auto-évaluée ~92 %. Audit frais à
3 axes (moteur / nœuds / UX) a révélé que la parité réelle était plutôt à
~72 % une fois qu'on distingue *classes orphelines* de *code wiré sur le
chemin de la requête*.

**Livré** :

- **Phase 1 — Moteur fiabilité** :
  - Persistance Wait/Pause en DB (`workflow_executions.waitTill`,
    `resumeToken`, `pausedContext`, `pausedWorkflow`)
  - Crash recovery via lease `lockedBy/lockExpiresAt` + scan boot dans
    `workflow-worker.ts` (RUNNING orphelin → `CRASHED` + Error Workflow ;
    WAITING mature → auto-resume)
  - `RetryManager` wiré dans `executionService.executeNode` (opt-in via
    `node.data.retry.enabled`, 5 stratégies : fixed/linear/exponential/
    fibonacci/custom)
  - `CircuitBreaker` wiré par nœud (key = `${workflowId}:${nodeId}`)
  - Endpoints `/api/executions/partial`, `/api/executions/pins/...` pour
    PartialExecutor + DataPinning durable

- **Phase 2 — Sécurité + triggers** :
  - `src/backend/services/codeSandbox.ts` — static analysis (13 patterns
    interdits : require, process, eval, Function, __proto__, etc.) +
    `vm.createContext` + frozen globals + timeout
  - `pollingScheduler.ts` orchestrateur + 3 pollers (Gmail historyId
    delta, RSS pubDate cursor, PostgreSQL watermark column avec validation
    SQL identifier stricte)
  - HTTP node déjà complet (auth, SSRF, pagination) — pas de duplication

- **Phase 3 — UX éditeur** :
  - `NodeDetailView.tsx` 3 panneaux (Input | Params | Output), modes
    JSON/Table/Schema, accessible via clic droit → "Open Detail View"
  - `NodePinButton.tsx` toggle on-hover par nœud, sync backend via
    `PinDataClient.ts`
  - `NodeReliabilitySettings.tsx` (onglet Settings du NodeConfigPanel)
    pour configurer retry + CB sans éditer du JSON
  - 3.2 (drag-to-express) et 3.3 (insert-on-edge) étaient déjà câblés

**Validation** :
- Typecheck : 0 erreur
- Lint : 0 erreur
- Tests : 9637 passing, 0 failing, 85 skipped (+15 nouveaux : 9 sandbox + 2
  cold-path resume + 2 retry/CB + 1 crash recovery + 1 cumul)
- Migration SQL : `prisma/migrations/20260513_add_wait_resume_polling_pin/migration.sql`
  (forward-only, à appliquer via `prisma migrate deploy` sur staging)

**Caveat connu** : la migration n'a PAS été appliquée localement (la DB
dev voulait un `migrate reset` destructif). Le code en runtime catch les
erreurs `column does not exist` et dégrade vers le cache mémoire — sûr
mais la durabilité crash-safe n'est active qu'après déploiement de la
migration.

**Sur notre application** : le moteur d'exécution est désormais aligné
avec la vision robot (`project_robot_vision.md`) — wait persisté, retry
par nœud, CB par nœud, crash recovery automatique. Le workflow peut
maintenant être un *langage exécutable* pour un agent autonome qui doit
survivre aux interruptions et reprendre.
