# Workflow supervision and AgentBase

Cowork now closes two operational gaps without introducing a second agent
runtime or pretending that an account is connected when only a catalog entry
exists.

## Workflow supervision

Open **Settings → Workflows**, then use the route-shaped supervision button on
a saved workflow.

The **Dry-run** path calls the same `compileVisualToCore()` function used by a
real run. It does not execute tools. The result shows the compiled task and
branch structure, approval nodes, potentially external tools, the immutable
definition hash, and compiler errors. Loops and batches show their body once
because their real iteration count depends on runtime input.

Every real run is written to `<Cowork userData>/workflows/runs.json` before
execution starts. A record contains a redacted definition snapshot, redacted
initial context, lifecycle events, result, duration and a deterministic failure
diagnostic. An interrupted process therefore leaves a visible failed/incomplete
record rather than losing the attempt.

History persistence is resource-bounded: individual strings, arrays, object
depth and the total store are capped. Oversized tool output is marked as
truncated instead of freezing Electron with embedded files or base64 payloads;
a truncated definition or input is never replayed. Visual loop
`maxIterations` is compiled into the production `Orchestrator` and enforced in
the range 1–100 — it is no longer a decorative label.

The supervision panel can:

- replay the stored definition and input snapshot through the normal compiler
  and `Orchestrator`;
- compare status, definition hash, duration, completed steps and changed error
  between two runs;
- guide the operator toward the editor, connector authentication or permission
  settings for common compilation, OAuth, timeout, network, unavailable-tool
  and policy failures.

Diagnostics are advice only. They never modify a workflow, grant a permission,
reconnect an account or retry an external action automatically.

Replay never weakens consent: each mutating, shell or externally visible tool
requests a fresh `forcePrompt` confirmation immediately before execution, even
if the graph already contains an approval node and even if the original run was
approved. Unknown tool semantics fail closed. A stored snapshot containing a
`[REDACTED…]` value is not executed with that placeholder: replay stops with a
`secret_input` diagnostic and asks for a new reviewed run with fresh credentials.

## AgentBase

**Settings → Connectors** starts with an AgentBase control center. It aggregates
the MCP configuration store, live MCP manager status, discovered live tools and
the curated MCP marketplace into one contract.

The distinction is explicit:

- `configured` means a server really exists in the local MCP configuration;
- `connected`, `failed`, `connecting` and `disabled` come from the live manager;
- `available` means only that an entry exists in the bundled catalog. It is not
  presented as an authenticated cloud integration.

AgentBase détecte également les fichiers `.codebuddy/mcp.json` du Projet actif
et du profil utilisateur. Cette découverte reste en lecture seule : le renderer
ne reçoit que le nom, la commande, les clés d'environnement et un identifiant
lié à l'empreinte de l'entrée, jamais les valeurs. Un import relit et revalide le
fichier côté processus principal, refuse les liens symboliques, les dossiers de
travail hors racine et les transports réseau nécessitant OAuth/en-têtes, puis
crée toujours le connecteur **désactivé**. Les références `${VAR}` et les clés
sensibles sont héritées de l'environnement au lancement mais ne sont pas copiées
dans `electron-store`. L'utilisateur doit encore relire puis activer le serveur
dans les réglages MCP : ouvrir un Projet ne lance donc jamais sa commande.

Authentication state crosses IPC as metadata only: OAuth/session or secret
presence, never tokens, headers or values. Connector permissions are stored in
`<Cowork userData>/agentbase/permissions.json` with private file permissions.
Read capabilities are enabled initially; write and unknown/external actions are
fail-closed until explicitly enabled.

Enabling a capability is not consent to execute it. Every write or external MCP
tool invocation requests a fresh Cowork confirmation with `forcePrompt`, so the
embedded engine's ordinary local auto-approval flag cannot bypass the decision.
Unknown tool semantics are classified as external. Invocations, denials,
permission changes and confirmation requests are appended to
`<Cowork userData>/agentbase/audit.jsonl`; argument values and secrets are not
recorded. Before any write/external invocation, the confirmation request and
authorization are durably appended and `fsync`-ed with mode `0600`; if that
pre-audit cannot be written, the action fails closed before the connector is
called.

The legacy MCP playground invocation IPC now routes through this AgentBase gate,
which prevents an alternative unconfirmed path around the policy.
The native MCP tools supplied directly to the Cowork coding agent use the same
gate as well; the LLM cannot bypass permissions by invoking its pi-coding-agent
custom tool surface. Policy is re-read for every decision so cached sessions
observe changes made in Settings immediately.

The audit is tailed with a bounded read and rotates at 5 MiB, retaining five
private archives. Rotation or pre-audit failure blocks an external action before
the connector is called.

## Verification

Focused checks:

```bash
cd cowork
npm test -- tests/workflow-supervisor.test.ts tests/agentbase-bridge.test.ts \
  tests/workflow-supervision-panel.test.tsx tests/agentbase-panel.test.tsx
npm run typecheck
```
