# Code Quality Metrics

[Architecture](./2-architecture.md) type: **plugin-based**

## [Layers](./2-architecture.md#layers)

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

## [Entry Points](./2-architecture.md#entry-points)

- `src/advanced/session-replay`
- `src/agent/agent-loader`
- `src/agent/architect-mode`
- `src/agent/background-tasks`
- `src/agent/cache-trace`

## [Layer Diagram](./2-architecture.md#layer-diagram)

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

**Code Quality Metrics** covers:
1. **Layers**
2. **Entry Points**
3. **Layer Diagram**


---

**See also:** [Architecture](./2-architecture.md)


---
[← Previous: Unified vfs router](./22-unified-vfs-router.md) | [Next: Security →](./24-security.md)
