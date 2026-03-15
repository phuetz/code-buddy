# Subsystems (continued)

This section details the specialized tool modules and the complex dependency graph governing system interactions. Developers should review these components when extending agent capabilities, modifying cross-module communication patterns, or integrating new external services.

## src/tools (10 modules)

The `src/tools` directory houses modular extensions that provide specific capabilities to the agent. These modules are registered via the central registry to ensure compatibility with the core execution loop. The system relies on `initializeToolRegistry()` to bootstrap the environment, while `getMCPManager()` handles the lifecycle of Model Context Protocol (MCP) servers.

> **Key concept:** The tool registry acts as a unified interface, abstracting the underlying implementation details of MCP servers, plugins, and marketplace tools into a standardized format consumable by the agent.

To integrate new capabilities, developers must utilize `initializeMCPServers()` to establish connections and `convertMCPToolToCodeBuddyTool()` or `convertPluginToolToCodeBuddyTool()` to normalize external tool definitions into the internal schema.

- **src/tools/archive-tool** (rank: 0.002, 21 functions)
- **src/tools/audio-tool** (rank: 0.002, 12 functions)
- **src/tools/clipboard-tool** (rank: 0.002, 6 functions)
- **src/tools/diagram-tool** (rank: 0.002, 11 functions)
- **src/tools/document-tool** (rank: 0.002, 19 functions)
- **src/tools/export-tool** (rank: 0.002, 14 functions)
- **src/tools/pdf-tool** (rank: 0.002, 11 functions)
- **src/tools/qr-tool** (rank: 0.002, 14 functions)
- **src/tools/video-tool** (rank: 0.002, 15 functions)
- **src/tools/registry/multimodal-tools** (rank: 0.002, 59 functions)

While the tool modules provide specific functionality, the broader system relies on a complex web of dependencies to manage state, execution, and CLI interactions.

## Community Interactions

The following diagram illustrates the architectural coupling between core subsystems. Understanding these relationships is critical for avoiding circular dependencies and ensuring stable deployments when modifying cross-cutting concerns like middleware or execution handlers.

```mermaid
graph LR
  subgraph C15["src (32 modules)"]
    N0["agent/codebuddy-agent"]
    N1["middleware/auto-repair-middleware"]
    N2["middleware/context-warning"]
    N3["middleware/cost-limit"]
    N4["middleware/index"]
    N5["middleware/quality-gate-middleware"]
    more_15["+26 more"]
  end
  subgraph C185["src (28 modules)"]
    N6["cli/approvals-command"]
    N7["cli/device-commands"]
    N8["cli/node-commands"]
    N9["cli/secrets-command"]
    N10["commands/execpolicy"]
    N11["commands/knowledge"]
    more_185["+22 more"]
  end
  subgraph C19["src (23 modules)"]
    N12["execution/agent-executor"]
    N13["agent/operating-modes"]
    N14["handlers/missing-handlers"]
    N15["config/model-tools"]
    N16["context/jit-context"]
    N17["context/precompaction-flush"]
    more_19["+17 more"]
  end
  subgraph C53["src (22 modules)"]
    N18["multi-agent/multi-agent-system"]
    N19["tools/process-tool"]
    N20["registry/attention-tools"]
    N21["registry/bash-tools"]
    N22["registry/browser-tools"]
    N23["registry/control-tools"]
    more_53["+16 more"]
  end
  subgraph C58["src (19 modules)"]
    N24["observer/index"]
    N25["observer/trigger-registry"]
    more_58["+17 more"]
  end
  C147 -->|"6 imports"| C146
  C185 -->|"5 imports"| C58
  C185 -->|"3 imports"| C15
  C185 -->|"3 imports"| C176
  C102 -->|"3 imports"| C229
  C58 -->|"2 imports"| C15
  C147 -->|"2 imports"| C15
  C185 -->|"2 imports"| C222
  C185 -->|"2 imports"| C17
  C185 -->|"2 imports"| C24
```

---

**See also:** [Architecture](./2-architecture.md) · [Subsystems](./3-subsystems.md) · [Tool System](./5-tools.md) · [Context & Memory](./7-context-memory.md)