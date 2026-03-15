# @phuetz/code-buddy v0.5.0

> Open-source multi-provider AI coding agent for the terminal. Supports Grok, Claude, ChatGPT, Gemini, Ollama and LM Studio with 52+ [tools](./6-tools.md), multi-channel messaging, skills system, and OpenClaw-inspired [architecture](./2-architecture.md).

| Metric | Value |
|--------|-------|
| [Modules](./3-channels-agent.md#modules) | 1083 |
| Classes | 0 |
| [Functions](./18-dm-pairing.md#functions) | 14351 |
| Relationships | 49 278 |

## Core Modules

| Module | PageRank | Functions |
|--------|----------|-----------|
| `src/channels/dm-pairing` | 0.019 | 19 |
| `src/codebuddy/[client](./19-client.md)` | 0.017 | 22 |
| `src/agent/codebuddy-agent` | 0.013 | 65 |
| `src/optimization/cache-breakpoints` | 0.010 | 3 |
| `src/agent/extended-thinking` | 0.010 | 8 |
| `src/memory/enhanced-memory` | 0.009 | 28 |
| `src/persistence/session-store` | 0.008 | 44 |
| `src/channels/index` | 0.007 | 0 |
| `src/agent/repo-profiling/cartography` | 0.007 | 11 |
| `src/nodes/device-node` | 0.006 | 21 |
| `src/knowledge/community-detection` | 0.006 | 5 |
| `src/codebuddy/tools` | 0.006 | 12 |
| `src/tools/screenshot-tool` | 0.006 | 20 |
| `src/agent/repo-profiler` | 0.005 | 13 |
| `src/deploy/cloud-configs` | 0.005 | 10 |

## Technology Stack

- Language: typescript
- Framework: express
- Dependencies: 35

## Getting Started

```bash
npm install
npm run build
npm run dev
npm start
```

---

**See also:** [Getting Started](./1-1-getting-started.md) · [Architecture](./2-architecture.md)
