# Architecture

<details>
<summary>Relevant source files</summary>

- `src/utils/logger.ts`
- `src/types.ts`
- `src/codebuddy/client.ts`
- `src/knowledge/knowledge-graph.ts`
- `src/services/vfs/unified-vfs-router.ts`
- `src/codebuddy/tool-definitions/types.ts`
- `src/agent/codebuddy-agent.ts`
- `src/channels.ts`

</details>

Architecture type: **plugin-based**

## Layers

| Layer | Modules |
|-------|---------|
| `src/agent` | 149 |
| `src/tools` | See the tool registry; no inventory total claimed |
| `src/commands` | 90 |
| `src/utils` | 73 |
| `src/context` | 53 |
| `src/channels` | 49 |
| `src/ui` | 49 |
| `src/security` | 44 |
| `src/knowledge` | 28 |
| `src/server` | 28 |
| `src/codebuddy` | 26 |
| `src/config` | 26 |
| `src/plugins` | 23 |
| `src/hooks` | 20 |
| `src/integrations` | 20 |

## Entry Points

- `src/advanced/session-replay`
- `src/agent/agent-loader`
- `src/agent/architect-mode`
- `src/agent/background-tasks`
- `src/agent/cache-trace`

## Layer Diagram

```mermaid
graph TD
  "agent"["agent (149)"]
  "tools"["tool registry"]
  "commands"["commands (90)"]
  "utils"["utils (73)"]
  "context"["context (53)"]
  "channels"["channels (49)"]
  "ui"["ui (49)"]
  "security"["security (44)"]
  "agent" --> "tools"
  "tools" --> "commands"
  "commands" --> "utils"
  "utils" --> "context"
  "context" --> "channels"
  "channels" --> "ui"
  "ui" --> "security"
```

## Summary

**Architecture** covers:
1. **Layers**
2. **Entry Points**
3. **Layer Diagram**


---

**See also:** [Overview](./1-overview.md)


**Referenced by:** [Overview](./1-overview.md) · [Code Quality Metrics](./23-metrics.md)


---
[← Previous: Key Concepts](./1-2-key-concepts.md) | [Next: Commands + utils →](./3-commands-utils.md)
