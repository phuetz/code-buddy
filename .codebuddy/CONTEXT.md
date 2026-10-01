# @phuetz/code-buddy — Project Context

This file is automatically loaded by Code Buddy to provide project context.

## Project Overview

Source-available multi-provider AI coding agent for the terminal. Supports Grok, Claude, ChatGPT, Gemini, Ollama and LM Studio with repository tools, multi-channel messaging, skills system, and OpenClaw-inspired architecture.

- **Languages:** TypeScript, JavaScript
- **Framework:** Ink (terminal UI)
- **Module system:** ESM
- **Package manager:** npm
- **Test framework:** Vitest
- **Node.js:** >=18.0.0
- **License:** MIT
- **CI:** GitHub Actions
- **Containerized:** Docker
- **Databases:** SQLite

## Key Dependencies

- `axios`
- `chalk`
- `commander`
- `express`
- `ink`
- `openai`
- `react`
- `zod`
- `@phuetz/ai-providers`
- `better-sqlite3`

## Architecture

| Directory | Role |
|-----------|------|
| `src/` | Source code |
| `tests/` | Tests |
| `docs/` | Documentation |

**Entry points:** `dist/index.js`

## Build & Development

```bash
npm run build    # Build
npm run test     # Test
npm run lint     # Lint
npm run format   # Format
```

**Other scripts:** `npm run typecheck`, `npm run validate`

> **Pre-commit check:** Run `npm run validate` before committing to catch lint/type/test errors early.

## Testing

- **Framework:** Vitest
- **Run:** `npm run test`
- **Location:** `tests/`

## Conventions

- **Linter:** eslint
- **Naming:** camelCase (JS/TS)
- **Imports:** ESM (`import`/`export`), `.js` extensions required

## Project Cartography

**Scale:** 1.5K source files, 771 test files (2.3K total)
**Lines of code (est.):** TypeScript ~758.6K, JavaScript ~319

**Architecture style:** agentic pipeline (97 modules, max depth 4)

| Module | Directory | Files |
|--------|-----------|-------|
| Agent core | `src/agent/` | 177 |
| Tool implementations | `src/tools/` | 152 |
| Utilities | `src/utils/` | 101 |
| Command handlers | `src/commands/` | 100 |
| UI layer | `src/ui/` | 71 |
| Context management | `src/context/` | 62 |
| Messaging channels | `src/channels/` | 61 |
| Security | `src/security/` | 50 |
| Configuration | `src/config/` | 30 |
| codebuddy | `src/codebuddy/` | 29 |
| Integrations | `src/integrations/` | 29 |
| Knowledge base | `src/knowledge/` | 28 |
| HTTP server | `src/server/` | 28 |
| Plugin system | `src/plugins/` | 26 |
| Hooks | `src/hooks/` | 24 |
| Memory system | `src/memory/` | 18 |
| renderers | `src/renderers/` | 18 |
| docs | `src/docs/` | 17 |
| MCP integration | `src/mcp/` | 16 |
| Skills system | `src/skills/` | 15 |

**Most imported modules:**
- `src/utils/logger` (imported by 481 files)
- `src/types` (imported by 155 files)
- `src/codebuddy/client` (imported by 66 files)
- `src/services/vfs/unified-vfs-router` (imported by 45 files)
- `src/agent/codebuddy-agent` (imported by 41 files)
- `src/tools/registry/types` (imported by 38 files)
- `src/knowledge/knowledge-graph` (imported by 33 files)
- `src/commands/handlers/branch-handlers` (imported by 27 files)
- `src/channels/core` (imported by 24 files)
- `src/codebuddy/tool-definitions/types` (imported by 23 files)

**Design patterns:** 67 singletons, 13 registries, 5 facades, 24 middlewares, 285 event emitters

**API surface:** 140 REST routes, 18 WebSocket events

**Circular dependency risks (3):**
- `src/knowledge/knowledge-graph` <-> `src/knowledge/graph-embeddings`
- `src/knowledge/knowledge-graph` <-> `src/knowledge/graph-pagerank`
- `src/events/typed-emitter` <-> `src/events/filtered-emitter`

## Component Map

**Facade architecture:**
- `AgentContextFacade` — `src/agent/facades/agent-context-facade.ts`
- `InfrastructureFacade` — `src/agent/facades/infrastructure-facade.ts`
- `ModelRoutingFacade` — `src/agent/facades/model-routing-facade.ts`
- `ReasoningFacade` — `src/agent/reasoning/reasoning-facade.ts`
- `SessionFacade` — `src/agent/facades/session-facade.ts`

**Middleware pipeline:**

| Priority | Middleware | File |
|----------|-----------|------|
| 10 | TurnLimitMiddleware | `src/agent/middleware/turn-limit.ts` |
| 20 | CostLimitMiddleware | `src/agent/middleware/cost-limit.ts` |
| 30 | ContextWarningMiddleware | `src/agent/middleware/context-warning.ts` |
| 35 | LearningFirstMiddleware | `src/agent/middleware/learning-first-middleware.ts` |
| 42 | ReasoningMiddleware | `src/agent/middleware/reasoning-middleware.ts` |
| 45 | WorkflowGuardMiddleware | `src/agent/middleware/workflow-guard.ts` |
| 50 | AutoObservationMiddleware | `src/agent/middleware/auto-observation.ts` |
| 50 | ToolFilterMiddleware | `src/agent/middleware/tool-filter-middleware.ts` |
| 150 | AutoRepairMiddleware | `src/agent/middleware/auto-repair-middleware.ts` |
| 155 | VerificationEnforcementMiddleware | `src/agent/middleware/verification-enforcement.ts` |
| 200 | QualityGateMiddleware | `src/agent/middleware/quality-gate-middleware.ts` |
| — | auth | `src/server/middleware/auth.ts` |
| — | ApiServerError | `src/server/middleware/error-handler.ts` |
| — | logging | `src/server/middleware/logging.ts` |
| — | rate-limit | `src/server/middleware/rate-limit.ts` |
| — | security-headers | `src/server/middleware/security-headers.ts` |

**Specialized agents (13):**
- `ArchiveAgent` — `src/agent/specialized/archive-agent.ts`
- `CodeGuardianAgent` — `src/agent/specialized/code-guardian/agent.ts`
- `CoderAgent` — `src/agent/multi-agent/agents/coder-agent.ts`
- `DataAnalysisAgent` — `src/agent/specialized/data-analysis-agent.ts`
- `ExcelAgent` — `src/agent/specialized/excel-agent.ts`
- `OrchestratorAgent` — `src/agent/multi-agent/agents/orchestrator-agent.ts`
- `PDFAgent` — `src/agent/specialized/pdf-agent.ts`
- `ReviewerAgent` — `src/agent/multi-agent/agents/reviewer-agent.ts`
- `SecurityReviewAgent` — `src/agent/specialized/security-review/agent.ts`
- `SQLAgent` — `src/agent/specialized/sql-agent.ts`
- `SWEAgent` — `src/agent/specialized/swe-agent.ts`
- `SWESpecializedAgent` — `src/agent/specialized/swe-agent-adapter.ts`
- `TesterAgent` — `src/agent/multi-agent/agents/tester-agent.ts`

**Tool classes (52):**
- `ApplyPatchTool` — `src/tools/apply-patch.ts`
- `ArchiveTool` — `src/tools/archive-tool.ts`
- `AskHumanTool` — `src/tools/ask-human-tool.ts`
- `AudioTool` — `src/tools/audio-tool.ts`
- `BashTool` — `src/tools/bash/bash-tool.ts`
- `BrowserTool` — `src/tools/browser/playwright-tool.ts`
- `ClipboardTool` — `src/tools/clipboard-tool.ts`
- `CodeExecTool` — `src/tools/code-exec-tool.ts`
- `CodeReviewTool` — `src/tools/code-review.ts`
- `ComputerControlTool` — `src/tools/computer-control-tool.ts`
- `ConfirmationTool` — `src/tools/confirmation-tool.ts`
- `CreateSkillTool` — `src/tools/create-skill-tool.ts`
- `DeployTool` — `src/tools/deploy-tool.ts`
- `DeviceTool` — `src/tools/device-tool.ts`
- `DiagramTool` — `src/tools/diagram-tool.ts`
- `DockerTool` — `src/tools/docker-tool.ts`
- `DocsSearchTool` — `src/tools/docs-search-tool.ts`
- `DocumentTool` — `src/tools/document-tool.ts`
- `EnvTool` — `src/tools/env-tool.ts`
- `ExportTool` — `src/tools/export-tool.ts`
- + 32 more in `src/tools/`

**Channel adapters (20):**
- `DiscordChannel` — `src/channels/discord/client.ts`
- `FeishuAdapter` — `src/channels/feishu/index.ts`
- `GoogleChatChannel` — `src/channels/google-chat/index.ts`
- `IMessageAdapter` — `src/channels/imessage/index.ts`
- `IRCAdapter` — `src/channels/irc/index.ts`
- `LINEAdapter` — `src/channels/line/index.ts`
- `MatrixChannel` — `src/channels/matrix/index.ts`
- `MattermostAdapter` — `src/channels/mattermost/index.ts`
- `NextcloudTalkAdapter` — `src/channels/nextcloud-talk/index.ts`
- `NostrAdapter` — `src/channels/nostr/index.ts`
- `SignalChannel` — `src/channels/signal/index.ts`
- `SlackChannel` — `src/channels/slack/client.ts`
- `SynologyChatAdapter` — `src/channels/synology-chat/index.ts`
- `TeamsChannel` — `src/channels/teams/index.ts`
- `TelegramChannel` — `src/channels/telegram/client.ts`
- `TwilioVoiceAdapter` — `src/channels/twilio-voice/index.ts`
- `TwitchAdapter` — `src/channels/niche-channels.ts`
- `WebChatChannel` — `src/channels/webchat/index.ts`
- `WhatsAppChannel` — `src/channels/whatsapp/index.ts`
- `ZaloAdapter` — `src/channels/zalo/index.ts`

**Key exports per module:**
- **advanced**: `ConversationBranchManager`, `SelectiveRollbackManager`, `SpecializedAgentManager`, `SessionReplayManager`, `ProjectStyleLearner`
- **agent**: `VerificationEnforcementMiddleware`, `ToolExecutionOrchestrator`, `AutoObservationMiddleware`, `ContextWarningMiddleware`, `AdvancedParallelExecutor`
- **analytics**: `PersistentAnalytics`, `BudgetAlertManager`, `AnalyticsDashboard`, `PrometheusExporter`, `MetricsDashboard`
- **api**: `WebhookManager`, `RestApiServer`, `getWebhookManager`, `startApiServer`, `stopApiServer`
- **app**: `setupSignalHandlers`, `ensureUserSettings`, `loadEnvironment`, `validateConfig`, `saveSettings`
- **auth**: `ModelProfileManager`, `AuthProfileManager`, `OAuthManager`, `resetModelProfileManager`, `resetAuthProfileManager`
- **automation**: `GmailTrigger`, `AuthMonitor`, `PollManager`, `resetGmailTrigger`, `getGmailTrigger`
- **browser**: `BrowserController`, `EmbeddedBrowser`, `PageController`, `CDPConnection`, `resetEmbeddedBrowser`
- **browser-automation**: `BrowserProfileManager`, `RouteInterceptor`, `BrowserManager`, `BrowserTool`, `discoverChromeEndpoint`
- **cache**: `SearchResultsCache`, `AdvancedLRUCache`, `FileContentCache`, `LLMResponseCache`, `EmbeddingCache`
- **canvas**: `VisualWorkspaceManager`, `CanvasRenderer`, `CanvasManager`, `A2UI_VERSION`, `CanvasServer`
- **channels**: `GroupSecurityManager`, `NextcloudTalkAdapter`, `NextcloudTalkChannel`, `TelegramProFormatter`, `MessagePreprocessor`

## Data Flow

```
{ User Input | Channel Message | HTTP/WS Request } → Middleware Pipeline → Agent Loop → Tool Execution → Response
```

**Key connection points:**
- **Entry:** `dist/index.js`
- **Agent core:** `src/agent/codebuddy-agent` (hub for 41 modules)
- **UI layer:** `src/ui/context/theme-context` (used by 18 modules)
- **Type system:** `src/types` (shared by 155 modules)

## Existing Documentation

- `CLAUDE.md` exists with detailed project instructions (loaded separately by the runtime)

## Important Notes

<!-- Add project-specific notes, gotchas, and patterns here -->
