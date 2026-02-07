# Architecture Overview

## System Flow

```
User Input
    |
    v
ChatInterface (Ink/React)
    |
    v
CodeBuddyAgent
    |--- Skill Matching (SkillRegistry + UnifiedSkill)
    |--- Tool Selection (RAG + skill-augmented)
    |--- System Prompt Builder (+ skill context)
    |
    v
LLM Provider (Grok/Claude/ChatGPT/Gemini/Ollama/LM Studio)
    |
    v
Tool Calls ──> LaneQueue (serial by default, parallel for read-only)
    |                |
    v                v
Tool Execution   Agent Executor
    |
    v
Results back to LLM (agentic loop)
```

## Channel Message Processing

```
Inbound Message
    |
    v
Session Isolation ─── getSessionKey(message)
    |
    v
DM Pairing ────────── checkDMPairing(message) [approval gate]
    |
    v
Identity Links ────── getCanonicalIdentity(message) [cross-channel]
    |
    v
Peer Routing ──────── resolveRoute(message) [multi-agent dispatch]
    |
    v
Lane Queue ────────── enqueueMessage(sessionKey, handler) [serialization]
    |
    v
Agent Processing
```

## Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Agent Executor | `src/agent/execution/` | Core agentic loop with LaneQueue integration |
| Channels | `src/channels/` | Multi-channel messaging (Telegram, Discord, Slack) |
| Session Isolation | `src/channels/session-isolation.ts` | Per-session context isolation |
| DM Pairing | `src/channels/dm-pairing.ts` | Approval-based DM security |
| Peer Routing | `src/channels/peer-routing.ts` | Multi-agent message dispatch |
| Identity Links | `src/channels/identity-links.ts` | Cross-channel identity resolution |
| Lane Queue | `src/concurrency/lane-queue.ts` | Concurrency control (serial/parallel) |
| Skills (SKILL.md) | `src/skills/registry.ts` | Natural language skill definitions |
| Skills (Unified) | `src/skills/adapters/` | Bridges legacy JSON + SKILL.md systems |
| Pipeline | `src/workflows/pipeline.ts` | Pipe syntax workflow compositor |
| Sandbox | `src/sandbox/safe-eval.ts` | Safe expression evaluation via `vm` |
| Events | `src/events/` | Typed event bus with filtering |

## Phase 3 — Middleware & Streaming

```
Agent Turn
    |
    v
Middleware Pipeline (before hooks)
    |── CostLimitMiddleware     # Abort if session cost exceeded
    |── ContextWarningMiddleware # Warn at 80% context usage
    |── TurnLimitMiddleware     # Cap max tool rounds
    |
    v
Agent Executor (streaming + reasoning)
    |── Reasoning events       # Chain-of-thought streaming
    |── Tool streaming         # Real-time bash output via AsyncGenerator
    |
    v
Middleware Pipeline (after hooks)
```

## Phase 4 — Autonomy Layer

```
Daemon Manager
    |
    ├── DaemonLifecycle         # Ordered service start/stop, health polling
    │       - Server, Scheduler, Channels, Observer
    │
    ├── CronAgentBridge         # Scheduled jobs → CodeBuddyAgent instances
    │       - Message, Tool, Agent task types
    │       - Webhook/channel delivery
    │
    ├── HealthMonitor           # CPU/memory metrics, threshold alerts
    │
    └── Services:
            ├── API Server
            ├── CronScheduler
            ├── ChannelManager
            └── ObserverCoordinator (auto-registered if triggers exist)

Task Planning Flow:
    User Request → needsPlanning() → TaskPlanner.createPlan()
        → TaskGraph (DAG) → topologicalSort() → getReady()
        → DelegationEngine.matchSubagent() → parallel execution
        → ProgressTracker (ETA, completion %)

Orchestration Flow:
    User Request → needsOrchestration() → SupervisorAgent
        → Strategies: sequential | parallel | race | all
        → SharedContext (versioned, conflict detection)
        → SelfHealing (6 error patterns, exponential backoff)
        → CheckpointRollback (auto before risky ops, 7-day expiry)

Observer Flow:
    ScreenObserver (periodic capture, perceptual hash diff)
        → EventTriggerManager (file_change, screen_change, time, webhook)
        → TriggerRegistry (~/.codebuddy/triggers.json)
        → ObserverCoordinator (deduplication, cooldown)

Proactive Communication:
    ProactiveAgent → NotificationManager (rate limit, quiet hours)
        → ChannelManager.sendToUser() (priority queue)
        → ResponseWaiter (multi-channel, timeout)
```

## Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Agent Executor | `src/agent/execution/` | Core agentic loop with LaneQueue integration |
| Middleware | `src/agent/middleware/` | Composable before/after turn hooks |
| Planner | `src/agent/planner/` | DAG task decomposition, delegation, progress |
| Observer | `src/agent/observer/` | Screen capture, event triggers, registry |
| Proactive | `src/agent/proactive/` | Push notifications, response waiting |
| Orchestrator | `src/agent/orchestrator/` | Supervisor, shared context, self-healing, rollback |
| Profiles | `src/agent/profiles/` | Agent profiles, trust folders |
| Daemon | `src/daemon/` | Process lifecycle, cron bridge, health monitor |
| Channels | `src/channels/` | Multi-channel messaging (Telegram, Discord, Slack) |
| Session Isolation | `src/channels/session-isolation.ts` | Per-session context isolation |
| DM Pairing | `src/channels/dm-pairing.ts` | Approval-based DM security |
| Peer Routing | `src/channels/peer-routing.ts` | Multi-agent message dispatch |
| Identity Links | `src/channels/identity-links.ts` | Cross-channel identity resolution |
| Lane Queue | `src/concurrency/lane-queue.ts` | Concurrency control (serial/parallel) |
| Skills (SKILL.md) | `src/skills/registry.ts` | Natural language skill definitions |
| Skills (Unified) | `src/skills/adapters/` | Bridges legacy JSON + SKILL.md systems |
| Pipeline | `src/workflows/pipeline.ts` | Pipe syntax workflow compositor |
| Sandbox | `src/sandbox/safe-eval.ts` | Safe expression evaluation via `vm` |
| Events | `src/events/` | Typed event bus with filtering |

## Concurrency Model

**Default Serial, Explicit Parallel** (OpenClaw-inspired):
- Tool calls in the agent executor are serialized per lane by default
- Read-only tools (grep, glob, read_file, etc.) run in parallel
- Channel messages are serialized per session key
- Different sessions process in parallel
- Task planner executes independent DAG tasks in parallel batches
- Orchestrator supports 4 strategies: sequential, parallel, race, all
