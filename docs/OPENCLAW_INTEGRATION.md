# OpenClaw Integration Plan for Code Buddy

## Analysis of OpenClaw Features

OpenClaw is a sophisticated AI assistant with many advanced features. Below is a comparison and integration plan.

---

## Feature Comparison

| Feature | OpenClaw | Code Buddy | Action |
|---------|----------|------------|--------|
| Tool Policy System | Hierarchical profiles (minimal/coding/messaging/full) | Basic confirmation | **Enhance** |
| Bash Allowlist | Pattern matching with allow-once/allow-always | Basic approval | **Enhance** |
| Hybrid Search | Vector + BM25 with configurable weights | Basic vector search | **Enhance** |
| Multi-stage Compaction | Adaptive chunking, parallel summarization | Basic compaction | **Enhance** |
| Context Window Guard | Hard limits, warnings, source tracking | Basic limits | **Add** |
| Plugin System | Discovery, validation, lifecycle, SDK | Basic plugins | **Enhance** |
| TTS System | OpenAI, ElevenLabs, Edge TTS, directives | Basic TTS | **Enhance** |
| Browser Automation | Playwright, CDP, profiles, multi-tab | Basic Puppeteer | **Enhance** |
| Multi-Channel | WhatsApp, Telegram, Slack, Discord, Signal | None | **Add** |
| Voice/Wake Word | Always-on speech, wake detection | None | **Add** |
| Canvas/Visual Workspace | Agent-driven UI, A2UI | None | **Add** |
| Memory System | Vector DB, FTS5, sync, batching | SQLite + vectors | **Enhance** |
| Sandbox System | Docker, policies, isolation | None | **Add** |
| Subagent System | Registry, announcements, spawning | Basic subagents | **Enhance** |

---

## Implementation Phases

### Phase A: Enhanced Tool Policy System (Priority: HIGH)

**From OpenClaw:**
- Hierarchical tool groups (group:fs, group:runtime, group:web, etc.)
- Profile-based policies (minimal, coding, messaging, full)
- Plugin-aware allowlists
- Elevation modes (deny, allowlist, full)

**Files to create:**
```
src/security/tool-policy/
├── groups.ts          # Tool group definitions
├── profiles.ts        # Policy profiles
├── resolver.ts        # Policy resolution with cascading
└── index.ts
```

### Phase B: Enhanced Bash Allowlist (Priority: HIGH)

**From OpenClaw:**
- Pattern-based allowlist with glob support
- allow-once / allow-always / deny decisions
- Approval timeout (120s default)
- Usage recording for audit
- Safe bins detection

**Files to create:**
```
src/security/bash-allowlist/
├── patterns.ts        # Pattern matching
├── decisions.ts       # Decision types
├── storage.ts         # Persistence
├── audit.ts           # Usage logging
└── index.ts
```

### Phase C: Context Window Guard (Priority: HIGH)

**From OpenClaw:**
- Hard minimum tokens (16K)
- Warning threshold (32K)
- Source tracking (model, config, agent, default)
- Guard evaluation

**Files to create:**
```
src/context/guard/
├── thresholds.ts      # Token limits
├── evaluator.ts       # Guard logic
└── index.ts
```

### Phase D: Enhanced Plugin System (Priority: MEDIUM)

**From OpenClaw:**
- Plugin discovery across multiple directories
- Manifest validation (JSON schema)
- SDK aliasing for development
- Memory slot assignment
- Lifecycle management (enable/disable)
- Command registration

**Files to enhance:**
```
src/plugins/
├── discovery.ts       # Multi-path discovery
├── loader.ts          # Enhanced loading
├── validator.ts       # Schema validation
├── registry.ts        # Command registry
└── sdk/               # Plugin SDK
```

### Phase E: Enhanced TTS System (Priority: MEDIUM)

**From OpenClaw:**
- Multiple providers (OpenAI, ElevenLabs, Edge)
- Provider fallback
- Directive parsing `[[tts:voice=alloy]]`
- Auto modes (off, always, inbound, tagged)
- Telephony support (PCM output)
- Text summarization for long inputs

**Files to enhance:**
```
src/talk-mode/
├── providers/
│   ├── openai.ts
│   ├── elevenlabs.ts
│   └── edge.ts
├── directives.ts      # Parse [[tts:...]]
├── telephony.ts       # PCM output
└── index.ts
```

### Phase F: Sandbox System (Priority: MEDIUM)

**From OpenClaw:**
- Docker-based isolation
- Policy enforcement
- Browser sandbox
- Workspace mounting
- Container lifecycle

**Files to create:**
```
src/sandbox/
├── docker.ts          # Docker integration
├── policy.ts          # Sandbox policies
├── browser.ts         # Browser sandbox
├── workspace.ts       # Workspace mounting
└── index.ts
```

### Phase G: Multi-Channel Support (Priority: LOW)

**From OpenClaw:**
- WhatsApp integration
- Telegram bot
- Slack app
- Discord bot
- Signal integration

**Files to create:**
```
src/channels/
├── types.ts           # Common types
├── base.ts            # Base channel class
├── telegram/          # Telegram bot
├── discord/           # Discord bot
├── slack/             # Slack app
└── index.ts
```

### Phase H: Enhanced Browser Automation (Priority: LOW)

**From OpenClaw:**
- Playwright integration
- CDP management with retry
- Multi-profile support
- Page state tracking
- Network monitoring
- Role-based element location

**Files to enhance:**
```
src/browser/
├── playwright/
│   ├── session.ts     # Session management
│   ├── pages.ts       # Multi-page tracking
│   ├── network.ts     # Network monitoring
│   └── roles.ts       # Accessibility roles
└── index.ts
```

---

## Code Integration from OpenClaw (MIT License)

### Key Algorithms to Port

1. **Hybrid Search Merge**
```typescript
// From OpenClaw: src/memory/hybrid.ts
function mergeHybridResults(
  vectorResults: HybridVectorResult[],
  keywordResults: HybridKeywordResult[],
  vectorWeight: number,
  textWeight: number
): MergedResult[]
```

2. **Adaptive Chunk Ratio**
```typescript
// From OpenClaw: src/agents/compaction.ts
function computeAdaptiveChunkRatio(
  avgMessageTokens: number,
  contextWindowTokens: number,
  safetyMargin: number
): number
```

3. **Tool Group Expansion**
```typescript
// From OpenClaw: src/agents/tool-policy.ts
function expandToolGroups(
  tools: string[],
  groups: Record<string, string[]>
): string[]
```

4. **Plugin Discovery**
```typescript
// From OpenClaw: src/plugins/discovery.ts
function discoverOpenClawPlugins(
  config: PluginConfig,
  workspaceDir: string
): PluginDiscoveryResult
```

---

## Implementation Order

1. **Phase A + B**: Tool Policy + Bash Allowlist (security foundation)
2. **Phase C**: Context Window Guard (stability)
3. **Phase D**: Enhanced Plugin System (extensibility)
4. **Phase E**: Enhanced TTS (user experience)
5. **Phase F**: Sandbox System (security)
6. **Phase G**: Multi-Channel (reach)
7. **Phase H**: Browser Enhancement (automation)

---

## Estimated Impact

| Phase | Complexity | User Value | Priority |
|-------|------------|------------|----------|
| A | Medium | High | 1 |
| B | Medium | High | 1 |
| C | Low | High | 2 |
| D | High | Medium | 3 |
| E | Medium | Medium | 3 |
| F | High | Medium | 4 |
| G | High | High | 5 |
| H | Medium | Medium | 6 |
