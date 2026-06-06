export type HermesParityStatus = 'covered' | 'covered-partial' | 'partial' | 'gap';

export interface HermesParityFeature {
  id: string;
  area: string;
  officialSurface: string;
  codeBuddyEvidence: string[];
  status: HermesParityStatus;
  verificationCommands: string[];
  notes: string;
  nextWork?: string;
}

export interface HermesParityManifest {
  kind: 'hermes_official_parity_manifest';
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  officialSource: {
    repository: string;
    docs: string;
    inspectedCommit: string;
    latestTagObserved: string;
    auditDocument: string;
  };
  summary: {
    total: number;
    covered: number;
    coveredPartial: number;
    partial: number;
    gaps: number;
  };
  features: HermesParityFeature[];
}

export interface HermesParityTodoItem {
  area: string;
  id: string;
  nextWork: string;
  officialSurface: string;
  priority: number;
  status: Extract<HermesParityStatus, 'partial' | 'gap'>;
  verificationCommand: string;
}

export interface HermesParityTodoManifest {
  kind: 'hermes_parity_todo';
  schemaVersion: 1;
  generatedAt: string;
  command: string;
  officialSource: HermesParityManifest['officialSource'];
  summary: HermesParityManifest['summary'] & {
    activeTodoCount: number;
    deferredCount: number;
    hiddenTodoCount: number;
    includedDeferred: boolean;
    selectedTodoCount: number;
    shownTodoCount: number;
    todoLimit: number;
  };
  todos: HermesParityTodoItem[];
  deferred: HermesParityTodoItem[];
  notes: string[];
}

export const HERMES_PARITY_PRIORITY_FEATURE_IDS = [
  'closed-learning-loop',
  'skills',
  'runtime-backends',
  'browser-automation',
  'messaging-gateway',
  'mcp-acp',
  'openclaw-migration',
  'research-trajectories',
] as const;

const FEATURES: HermesParityFeature[] = [
  {
    id: 'agent-identity',
    area: 'Agent identity',
    officialSurface: 'Hermes product agent with its own Python runtime',
    codeBuddyEvidence: [
      'src/agent/hermes-agent-profile.ts',
      'src/agent/hermes-agent-diagnostics.ts',
      'src/commands/cli/hermes-commands.ts',
      'src/agent/custom/custom-agent-loader.ts',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/agent/custom-agent-loader-hermes.test.ts tests/agent/hermes-agent-diagnostics.test.ts tests/commands/hermes-commands.test.ts --run',
      'npx tsx src/index.ts hermes profile review --json',
      'npx tsx src/index.ts hermes identity status safe --json',
    ],
    notes: 'Code Buddy now exposes a native TypeScript/Fleet runtime mapping in profile, diagnostics, and identity status; it does not vendor or run upstream Hermes Python.',
    nextWork: 'Re-check upstream runtime claims when the official Hermes release window changes; do not claim drop-in Python runtime equivalence.',
  },
  {
    id: 'cli-tui',
    area: 'CLI/TUI',
    officialSurface: 'Terminal TUI plus hermes chat/model/tools/prompt-size style commands',
    codeBuddyEvidence: [
      'src/index.ts',
      'src/commands/cli/hermes-commands.ts',
      'docs/commands.md',
      'cowork/src/main/tools/hermes-doctor-bridge.ts',
      'cowork/src/renderer/components/hermes-doctor-strip.tsx',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npx tsx src/index.ts hermes doctor safe --json',
      'npx tsx src/index.ts hermes model status --json',
      'npx tsx src/index.ts hermes toolsets safe --json',
      'npx tsx src/index.ts hermes prompt-size safe --json',
      '(cd cowork && npm test -- --run tests/hermes-doctor-bridge.test.ts tests/hermes-doctor-strip.test.ts)',
    ],
    notes: 'Code Buddy has native CLI/slash surfaces, Hermes diagnostics (now also surfaced as an aggregate read-only doctor strip in Cowork), dedicated toolset inspection, prompt-size reporting, and a compact Hermes model status command for active provider/model setup. It is not a drop-in upstream TUI clone.',
    nextWork: 'Keep command naming aligned with product-value Hermes surfaces instead of chasing cosmetic upstream parity.',
  },
  {
    id: 'prompt-size',
    area: 'Prompt-size diagnostic',
    officialSurface: 'hermes prompt-size offline byte breakdown for system prompt and tool schemas',
    codeBuddyEvidence: ['src/commands/cli/hermes-commands.ts', 'tests/commands/hermes-commands.test.ts'],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/commands/hermes-commands.test.ts --run',
      'npx tsx src/index.ts hermes prompt-size safe --json',
    ],
    notes: 'Runs offline and reports native Hermes prompt/profile/toolset/plan, local skills/memory footprint metadata, accepted user-model context size, and filtered tool schemas.',
  },
  {
    id: 'providers-models',
    area: 'Providers/models',
    officialSurface: 'Nous Portal, OpenRouter, OpenAI/Codex, Copilot, Anthropic, Gemini, Hugging Face, local/custom, and others',
    codeBuddyEvidence: [
      'src/codebuddy/client.ts',
      'src/codebuddy/providers/',
      'src/config/model-tools.ts',
      'src/agent/hermes-agent-diagnostics.ts',
      'src/agent/hermes-portal-status.ts',
      'cowork/src/main/tools/hermes-provider-readiness-bridge.ts',
      'cowork/src/renderer/components/hermes-provider-readiness-strip.tsx',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/agent/hermes-agent-diagnostics.test.ts tests/commands/hermes-commands.test.ts --run',
      'cd cowork && npm test -- --run tests/hermes-provider-readiness-bridge.test.ts tests/hermes-provider-readiness-bridge-real.test.ts tests/hermes-provider-readiness-strip.test.ts',
      'npm test -- tests/codebuddy/client-stream-retry.test.ts tests/codebuddy/client-gemini-vision.test.ts --run',
      'npx tsx src/index.ts hermes providers status --json',
      'npx tsx src/index.ts hermes doctor balanced --json',
      'npx tsx src/index.ts hermes portal status --json',
    ],
    notes: 'Provider coverage is broad and buddy hermes providers status, buddy hermes doctor, plus Cowork now report active model source, inferred provider, detected env/OAuth credential sources without secret values, model capabilities, context/output limits, and Nous Portal readiness. Exact upstream setup UX and full provider list still differ.',
    nextWork: 'Decide whether exact upstream provider setup wizards and live Nous Portal OAuth/proxying are product goals.',
  },
  {
    id: 'toolsets',
    area: 'Toolsets',
    officialSurface: 'Core/composite/platform/dynamic toolsets and per-platform hermes-* toolsets',
    codeBuddyEvidence: [
      'src/fleet/dispatch-profile.ts',
      'src/utils/tool-filter.ts',
      'src/commands/cli/hermes-commands.ts',
      'src/agent/hermes-toolset-catalog.ts',
      'tests/fleet/dispatch-profile.test.ts',
      'tests/agent/hermes-toolset-catalog.test.ts',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/fleet/dispatch-profile.test.ts tests/agent/hermes-toolset-catalog.test.ts --run',
      'npx tsx src/index.ts hermes toolsets review --json',
      'npx tsx src/index.ts hermes doctor review --json',
      'npx tsx src/index.ts hermes tools --json',
    ],
    notes: 'Fleet dispatch profiles enforce useful Hermes-style filters, and `buddy hermes toolsets` now exposes an explicit official toolset catalog (`src/agent/hermes-toolset-catalog.ts`): 33 official toolsets grouped core/composite/platform/dynamic, each with a machine-readable readiness check (present/partial/absent + missing tools) sourced from the tool parity manifest — 32 present, 0 partial, 1 honest absent (`rl`, the upstream RL harness, has no Code Buddy prompt-tool surface; tracked at 0/0, not force-fitted). Readiness reuses buildHermesToolParityManifest (no duplication).',
    nextWork: 'Keep the official toolset catalog and per-tool readiness current as upstream Hermes adds/renames toolsets; revisit `rl` only if an RL training surface becomes product-relevant.',
  },
  {
    id: 'built-in-tools',
    area: 'Built-in tools',
    officialSurface: 'Browser, file, terminal/process, web, Home Assistant, Spotify, Kanban, execute_code, cronjob, session_search, skills, media, messaging, MOA, MCP',
    codeBuddyEvidence: [
      'src/codebuddy/tool-definitions/',
      'src/tools/',
      'src/tools/metadata.ts',
      'src/channels/send-message.ts',
      'src/tools/discord-platform-tool.ts',
      'src/tools/homeassistant-tool.ts',
      'src/tools/mixture-of-agents-tool.ts',
      'src/tools/spotify-tool.ts',
      'src/tools/x-search-tool.ts',
      'src/tools/feishu-tool.ts',
      'src/tools/yuanbao-tool.ts',
      'src/tools/execute-code-runner.ts',
      'src/tools/text-to-speech-tool.ts',
      'src/tools/media-generation-tool.ts',
      'src/tools/video-analysis-tool.ts',
      'src/tools/vision/vision-analysis.ts',
      'src/agent/hermes-tool-parity-manifest.ts',
      'src/agent/hermes-tool-parity-local.ts',
      'cowork/src/main/tools/hermes-tool-catalog-bridge.ts',
      'cowork/src/renderer/components/hermes-tool-catalog-strip.tsx',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npx tsx src/index.ts tools profile hermes-balanced --json',
      'npx tsx src/index.ts hermes tools --json',
      'npm test -- tests/agent/hermes-tool-parity-local.test.ts --run',
      'npm test -- tests/tools/execute-code-real.test.ts tests/tools/send-message-real.test.ts tests/tools/discord-tool-real.test.ts tests/tools/homeassistant-tool-real.test.ts tests/tools/mixture-of-agents-real.test.ts tests/tools/spotify-tool-real.test.ts tests/tools/x-search-tool-real.test.ts tests/tools/feishu-tool-real.test.ts tests/tools/yuanbao-tool-real.test.ts tests/tools/kanban-real.test.ts tests/tools/vision-analyze-real.test.ts tests/tools/text-to-speech-real.test.ts tests/tools/media-generation-real.test.ts --run',
    ],
    notes: 'Code Buddy now has a second-level official tool parity manifest and the current measured tool-level state is 65 exact, 6 native-equivalent, 0 partial, and 0 gaps. Broader product differences such as gateway lifecycle, managed browser backends, provider setup, and remote runtimes remain tracked by their dedicated feature rows instead of this built-in tools row.',
    nextWork: 'Keep the official tool parity manifest current when upstream Hermes adds or changes tools.',
  },
  {
    id: 'messaging-gateway',
    area: 'Messaging gateway',
    officialSurface: 'Single gateway process across Telegram, Discord, Slack, WhatsApp, Signal, SMS, Email, Home Assistant, Matrix, Teams, LINE, ntfy, and more',
    codeBuddyEvidence: [
      'src/channels/',
      'src/channels/send-message.ts',
      'src/tools/discord-platform-tool.ts',
      'docs/channels.md',
      'src/commands/cli/hermes-commands.ts',
      'src/server/channel-a2a-bridge.ts',
      'cowork/src/main/tools/channel-gateway-readiness-bridge.ts',
      'cowork/src/renderer/components/hermes-messaging-gateway-strip.tsx',
      'cowork/src/renderer/components/ChannelsPanel.tsx',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/tools/send-message-real.test.ts tests/tools/discord-tool-real.test.ts --run',
      'cd cowork && npm test -- --run tests/channel-gateway-readiness-bridge.test.ts tests/hermes-messaging-gateway-strip.test.tsx',
      'rg --files src/channels',
      'npx tsx src/index.ts hermes messaging status --json',
      'npx tsx src/index.ts channels status --json',
    ],
    notes: 'Channel coverage is broad, gateway readiness is machine-readable through dedicated Hermes CLI status plus Cowork, send_message exists with dry-run outbox plus approval-gated live delivery, and the exact discord tool covers upstream core REST actions. The official Hermes platform list, gateway lifecycle, admin actions, and slash parity are still not identical.',
    nextWork: 'Add per-platform slash parity checks and lifecycle controls only after the operator workflow requires them.',
  },
  {
    id: 'browser-automation',
    area: 'Browser automation',
    officialSurface: 'Browserbase, Browser Use, Firecrawl, Camofox/Camoufox, local CDP, hybrid routing, dialog handling, session recording',
    codeBuddyEvidence: [
      'src/browser-automation/',
      'src/tools/browser/',
      'src/tools/registry/vision-tools.ts',
      'src/agent/hermes-browser-backends.ts',
      'cowork/src/main/tools/hermes-browser-backends-bridge.ts',
      'cowork/src/renderer/components/hermes-browser-backends-strip.tsx',
      'docs/browser-automation-security-audit.md',
    ],
    status: 'partial',
    verificationCommands: [
      'npx tsx src/index.ts hermes browser status --json',
      'npx tsx src/index.ts hermes browser-smoke local-playwright --json',
      'npm test -- tests/agent/hermes-browser-backends-smoke-real.test.ts --run',
      'cd cowork && npm test -- --run tests/hermes-browser-backends-bridge.test.ts tests/hermes-browser-backends-strip.test.ts',
      'npx tsx src/index.ts tools browser-operator draft "open example.com" --json',
      'npm test -- tests/tools/vision-analyze-real.test.ts --run',
    ],
    notes: 'Strong local browser work exists, including exact browser_vision and browser_dialog prompt-tool surfaces plus machine-readable backend readiness for local Playwright, CDP, Browserbase/Stagehand, Browser Use gateway, Firecrawl, Camofox, and session recording. A real local Playwright smoke launches Chromium, verifies page content, and writes a trace.zip recording artifact; a real remote CDP smoke attaches to a live Chrome DevTools endpoint without leaking the endpoint. Complete backend parity for Camofox, Browser Use gateway mode, managed replay, and hybrid routing is still not proven.',
    nextWork: 'Wire first-class managed backend runners and hybrid browser routing before claiming full Hermes browser backend parity.',
  },
  {
    id: 'nous-portal',
    area: 'Nous Portal Tool Gateway',
    officialSurface: 'OAuth setup, hermes portal status, gateway-routed Firecrawl/FAL/OpenAI TTS/Browser Use',
    codeBuddyEvidence: [
      'src/agent/hermes-portal-status.ts',
      'src/agent/tool-gateway-router.ts',
      'src/tools/firecrawl-tool.ts',
      'src/tools/media-generation-tool.ts',
      'src/commands/cli/hermes-commands.ts',
      'cowork/src/main/tools/hermes-portal-bridge.ts',
      'cowork/src/renderer/components/hermes-portal-strip.tsx',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/tools/tool-gateway-routing-real.test.ts --run',
      'npm test -- tests/commands/hermes-commands.test.ts --run',
      'npx tsx src/index.ts hermes portal status --json',
      '(cd cowork && npm test -- --run tests/hermes-portal-bridge.test.ts tests/hermes-portal-strip.test.ts)',
    ],
    notes:
      'Beyond the readiness surface, Code Buddy now performs real token/self-hosted Tool Gateway routing: ' +
      'when CODEBUDDY_NOUS_TOOL_GATEWAY_URL (or TOOL_GATEWAY_DOMAIN) + user token are configured and the tool is ' +
      'in NOUS_MANAGED_TOOLS, web search/extraction (Firecrawl) and image/video generation calls are routed through ' +
      'the gateway with the gateway token instead of the direct provider (src/agent/tool-gateway-router.ts). ' +
      'The Nous-managed OAuth device-code flow and a Nous-hosted proxy runtime are intentionally not implemented (undocumented upstream).',
    nextWork:
      'Add live OAuth/device-code login and a managed Browser Use cloud runtime only after a product decision and the ' +
      'official contract are available; remote TTS routing waits on a remote TTS tool.',
  },
  {
    id: 'memory-providers',
    area: 'Memory',
    officialSurface: 'Built-in memory plus Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory',
    codeBuddyEvidence: [
      'src/memory/',
      'src/memory/adapters/network-memory-adapters.ts',
      'src/memory/adapters/cli-memory-adapters.ts',
      'src/agent/hermes-memory-providers.ts',
      'src/commands/cli/hermes-commands.ts',
      'src/agent/lessons-tracker.ts',
      'src/memory/user-model.ts',
      'docs/hermes-memory-providers-selfhost.md',
      'cowork/src/main/tools/hermes-memory-providers-bridge.ts',
      'cowork/src/renderer/components/hermes-memory-providers-strip.tsx',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npx tsx src/index.ts hermes memory status --json',
      'npx tsx src/index.ts hermes memory probe honcho --json',
      'npx tsx src/index.ts hermes memory probe mem0 --json',
      'npm test -- tests/agent/hermes-memory-providers.test.ts tests/memory/memory-provider.test.ts tests/memory/network-memory-adapters-real.test.ts --run',
      '(cd cowork && npm test -- tests/hermes-memory-providers-bridge.test.ts tests/hermes-memory-providers-bridge-real.test.ts tests/hermes-memory-providers-strip.test.ts --run)',
      'npm test -- tests/memory tests/agent/lesson-candidate-queue.test.ts --run',
      'npx tsx src/index.ts user-model show --json',
    ],
    notes: '6 of 8 official providers are adapted with real upstream contracts (paths/bodies from real plugins/SDKs): Mem0 (self-host REST + cloud), Honcho (v3), OpenViking (/api/v1), RetainDB (cloud), Supermemory (v3 cloud), ByteRover (brv CLI). All register and fall back to local until configured. `buddy hermes memory probe <id>` runs a live write->read round-trip (the discriminating test beyond shape tests); Cowork now exposes this same probe as a per-provider button in the Hermes memory strip. TWO providers are now LIVE-VALIDATED end-to-end on a self-hosted Ollama box (ministar): Honcho (async deriver) and Mem0. Validating Mem0 surfaced and fixed a real adapter bug: `remember` wrote to user_id `<id>:project` but `search`/`recall` read from bare `<id>`, so every project-scoped recall silently missed what was stored — shape tests passed regardless; only the live probe caught it (fix + regression test in network-memory-adapters[-real].ts). The 3 non-probeable adapters (Supermemory, RetainDB, OpenViking) were code-audited for the same partition-key asymmetry and are symmetric (write and read resolve to the same containerTag / project+user_id / tenant headers). Hindsight + Holographic are deliberately OUT of native-TS scope (in-process Python, no network/CLI boundary → parity-by-label). Self-host guide: docs/hermes-memory-providers-selfhost.md.',
    nextWork: 'LIVE-VALIDATED on ministar (probe PASS, remote=true, no local fallback): Honcho + Mem0 (Mem0 needs a FAST non-thinking extraction LLM, e.g. qwen2.5:7b-instruct, and pgvector dims matched to the embedder, 768 for nomic-embed-text). Remaining are dependency-gated, not code gaps: ByteRover requires a ByteRover account (brv login; NOT free/local-first despite older docs); OpenViking self-hosts but needs a VLM model + writable conf mount (same LLM-backed-extraction class as the already-validated Mem0/Honcho); Supermemory/RetainDB are cloud (need a paid account). Hindsight/Holographic stay upstream-only by design.',
  },
  {
    id: 'skills',
    area: 'Skills',
    officialSurface: 'Agentskills.io-compatible skills, hub/taps, URL install, trust/update lifecycle, curator, agent-managed skills',
    codeBuddyEvidence: [
      'src/skills/',
      'src/agent/research-script-skill-candidate.ts',
      'src/agent/hermes-skill-package-summary.ts',
      'src/tools/registry/skills-inspection-tools.ts',
      'src/commands/skills-cli/index.ts',
      'cowork/src/main/tools/skill-candidate-review-bridge.ts',
      'cowork/src/main/tools/skill-package-manager-bridge.ts',
      'cowork/src/renderer/components/skill-candidate-review-queue-strip.tsx',
      'cowork/src/renderer/components/skill-package-manager-strip.tsx',
      'cowork/src/renderer/components/skills-manager-page.tsx',
      'docs/hermes-agent-status.md',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npx tsx src/index.ts hermes skills status --json',
      'npx tsx src/index.ts skills list --json',
      'npx tsx src/index.ts skills doctor --json',
      'npx tsx src/index.ts skills tap list --json',
      'npx tsx src/index.ts skills update-preview <name> --json',
      'npx tsx src/index.ts skills reset <name> --approved-by <reviewer> --json',
      'npm test -- tests/agent/research-script-skill-candidate.test.ts --run',
      'npm test -- tests/agent/hermes-skill-package-summary-real.test.ts --run',
      'npm test -- tests/tools/skills-inspection-real.test.ts --run',
      '(cd cowork && npm test -- tests/skill-candidate-review-bridge.test.ts tests/skill-candidate-review-queue-strip.test.ts --run)',
      '(cd cowork && npm test -- tests/skill-package-manager-bridge.test.ts tests/skill-package-manager-strip.test.ts tests/skills-manager-page.test.tsx --run)',
      'npm test -- tests/skills/hub.test.ts tests/commands/skills-command-real.test.ts --run',
    ],
    notes: 'Native skill coverage is good and the exact skill_manage prompt-tool action surface now covers official create(content), edit(content), patch(old_string/new_string/file_path/replace_all), write_file, and remove_file semantics with Code Buddy review gates. `buddy hermes skills status --json` now exposes read-only SkillsHub health, missing-file/integrity status, rollback availability, and next review/repair commands from the real workspace lockfile without printing SKILL.md body previews. Candidate review plus Cowork also surface installed package state, current SKILL.md previews, candidate install-state comparisons, bounded unified and expanded side-by-side candidate diffs, reviewer-gated candidate install/overwrite, and reviewer-gated enable/disable/deprecate/rollback/reset/delete/update/patch from the real SkillsHub lockfile. Repository tap/trust management persists owner/repo taps with path and trust metadata through buddy skills tap list/add/remove/trust/refresh, direct .well-known skill catalogs are cached through buddy skills well-known <url>, remote update diff previews are available through buddy skills update-preview plus skill_manage action=preview_update, and Code Buddy reset restores tampered or missing installed skills from real hub/cache content after reviewer approval. Reset is a Code Buddy repair extension because official Hermes skill_manage does not expose a reset action. Cowork now also ships a full-page Skills Manager (cowork/src/renderer/components/skills-manager-page.tsx) reachable via Cmd/Ctrl+Shift+L and the command palette: it aggregates the installed-skill list (status/integrity + inline SKILL.md preview + all lifecycle actions) and the candidate review queue (side-by-side diffs + reviewer-gated install/overwrite) in one page over the existing IPC bridges, for daily skill operations beyond the compact cockpit strips.',
    nextWork: 'Optional polish: live-refresh the manager list after a lifecycle action (currently a manual Refresh) via an onLifecycleComplete callback.',
  },
  {
    id: 'closed-learning-loop',
    area: 'Closed learning loop',
    officialSurface: 'Memory nudges, autonomous skill creation, self-improving skills, session search, Honcho modeling',
    codeBuddyEvidence: [
      'src/agent/lesson-candidate-queue.ts',
      'src/agent/learning-agent.ts',
      'src/agent/hermes-learning-loop-status.ts',
      'src/memory/user-model.ts',
      'src/commands/user-model.ts',
      'src/observability/run-store.ts',
      'src/agent/research-script-skill-candidate.ts',
      'src/agent/learning-background-writes.ts',
      'src/agent/learning/background-review-agent.ts',
      'src/agent/learning/skill-background-writes.ts',
      'tests/commands/user-model-command-real.test.ts',
      'tests/agent/learning-background-writes.test.ts',
      'tests/agent/learning/background-review-live.test.ts',
      'tests/agent/learning/background-review-agent.test.ts',
      'tests/agent/learning/skill-background-writes.test.ts',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/agent/lesson-candidate-queue.test.ts tests/memory/user-model.test.ts --run',
      'npm test -- tests/agent/learning-background-writes.test.ts --run',
      'npm test -- tests/agent/learning/background-review-live.test.ts tests/agent/learning/background-review-agent.test.ts tests/agent/learning/skill-background-writes.test.ts --run',
      'npm test -- tests/agent/execution/context-pipeline-user-model.test.ts tests/commands/hermes-commands.test.ts --run',
      'npm test -- tests/agent/learning-agent-real.test.ts --run',
      'npx tsx src/index.ts hermes learning status --json',
    ],
    notes: 'Comparable direction with stricter review gates. Accepted user-model observations are injected per turn and counted by prompt-size diagnostics; reusable skill outcomes now keep scored recommendation history with reasons and next actions, and approved skill_manage mutations record rollback snapshot ids in Learning Agent telemetry. `buddy hermes learning status --json` now summarizes real local runs, trajectory event counts, retrospectives, lesson candidates, user-model observations, skill scoring, pattern library state, review gates, an aggregated review queue, and one prioritized next action without printing private model content. It chooses the next retrospective from the densest unfinished actionable trajectory and ignores low-signal memory-only runs that cannot produce lessons or skills. By default Honcho-style LLM inference and credential-free deterministic local inference both propose pending observations only (everything review-gated). Behavioural parity with Hermes\' direct background loop is now reachable via guarded opt-ins: accepted observations can auto-write through LocalUserModel.accept(), and interactive post-session background review can use the real headless tool registry for memory plus a deliberately narrowed skill_manage mutation surface. Autonomous review memories default to project scope; skill writes require CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS, block destructive/lifecycle actions, and append a rollback plan to the skill-write audit. OFF by default preserves the safe review-gated path byte-for-byte. Proven by round-trip tests plus a live headless-registry probe that writes project memory in a virgin workspace.',
    nextWork: 'Optional polish: run a full TUI/Cowork background-review probe with a real local model and capture screenshots for the public docs.',
  },
  {
    id: 'cron-scheduling',
    area: 'Cron/scheduling',
    officialSurface: 'Natural-language cronjob tool; create/list/update/pause/resume/run/remove; delivery; no-agent script-only jobs; chained and skill-backed jobs',
    codeBuddyEvidence: [
      'src/commands/cron-cli/index.ts',
      'src/scheduler/cron-scheduler.ts',
      'src/daemon/cron-agent-bridge.ts',
      'src/tools/cronjob-tool.ts',
      'src/tools/registry/cronjob-tools.ts',
      'src/scheduler/script-runner.ts',
      'tests/commands/cron-cli.test.ts',
      'tests/commands/cron-cli-persist.test.ts',
      'tests/scheduler/cron-chained-jobs.test.ts',
      'tests/daemon/cron-no-agent-jobs.test.ts',
      'tests/tools/cronjob-tool-real.test.ts',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/commands/cron-cli.test.ts tests/commands/cron-cli-persist.test.ts --run',
      'npm test -- tests/scheduler/cron-chained-jobs.test.ts tests/daemon/cron-no-agent-jobs.test.ts tests/scheduler/script-runner.test.ts --run',
      'npm test -- tests/tools/cronjob-tool-real.test.ts --run',
      'npx tsx src/index.ts cron list --json',
    ],
    notes: 'Direct CLI lifecycle parity covers add/list/show/update/pause/resume/run/remove, and the agent-facing cronjob prompt tool covers list/show/create/pause/resume/run/remove over the persisted CronScheduler store. The three upstream cron workflow types are now implemented end-to-end and user-creatable via both the cronjob tool and `buddy cron add/update`: (1) script-only NO-AGENT jobs (bounded shell runner, shell:false + executable allowlist + timeout, no agent/provider call), (2) skill-backed jobs (resolved via SkillRegistry/SkillExecutor), (3) chained jobs (`then` fires the next job on success, depth-capped against cycles). Real isolated-store + persistence + simulated-execution test coverage.',
    nextWork: 'Engine + author surface for script-only/skill-backed/chained jobs are done and tested. Remaining for full parity: cross-job data passing in chains and richer NL scheduling phrasing, only if upstream workflow details remain product-relevant.',
  },
  {
    id: 'delegation-parallelism',
    area: 'Delegation/parallelism',
    officialSurface: 'delegate_task, isolated subagents, execute_code scripts calling tools by RPC',
    codeBuddyEvidence: ['src/fleet/', 'src/tools/peer-chain-tool.ts', 'src/agent/autonomous/agentic-coding-runner.ts', 'src/tools/execute-code-runner.ts', 'src/tools/execute-code-rpc-invoker.ts', 'tests/tools/execute-code-tool-rpc.test.ts'],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/fleet --run',
      'npm test -- tests/tools/execute-code-real.test.ts tests/tools/execute-code-tool-rpc.test.ts --run',
    ],
    notes: 'Delegation is strong through Fleet and subagents, and execute_code now closes the upstream "scripts calling tools by RPC" surface: generated code can invoke Code Buddy tools over a file-framed runner<->subprocess RPC channel. Safe by construction — OFF by default (CODEBUDDY_EXECUTE_CODE_TOOL_RPC), allowlist + registry fleetSafe gate (read-only tools only) + per-run call bound + per-call timeout, and fail-closed (a clean structured denial when disabled, never a hang). Proven end-to-end: off-by-default refusal AND real on-flag round-trip (a tool-read result surfaces in the script stdout, js + python).',
    nextWork: 'Optional: widen the RPC allowlist beyond read-only tools only behind an explicit per-tool opt-in, if a concrete workflow justifies it.',
  },
  {
    id: 'runtime-backends',
    area: 'Runs anywhere',
    officialSurface: 'Local, Docker, SSH, Singularity, Modal, Daytona terminal backends with hibernate/wake semantics',
    codeBuddyEvidence: [
      'src/agent/hermes-runtime-backends.ts',
      'src/security/',
      'src/sandbox/',
      'src/agent/research-script-job-runner.ts',
      'src/server/',
      'src/commands/cli/hermes-commands.ts',
      'cowork/src/main/tools/hermes-runtime-backends-bridge.ts',
      'cowork/src/renderer/components/hermes-runtime-backends-strip.tsx',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/agent/hermes-runtime-backends-smoke-real.test.ts tests/agent/hermes-agent-diagnostics.test.ts tests/commands/hermes-commands.test.ts --run',
      'cd cowork && npm test -- --run tests/hermes-runtime-backends-bridge.test.ts tests/hermes-runtime-backends-bridge-real.test.ts tests/hermes-runtime-backends-strip.test.ts',
      'npx tsx src/index.ts hermes doctor balanced --json',
      'npx tsx src/index.ts hermes runtime status --json',
      'npx tsx src/index.ts hermes runtime-smoke auto --json',
      'npx tsx src/index.ts hermes runtime-smoke local --json',
      'npx tsx src/index.ts hermes runtime-smoke docker --allow-docker --json',
      'rg -n "Docker|SSH|Daytona|Modal|Singularity|SandboxBackend" src tests docs',
    ],
    notes: 'Local/desktop/server/fleet/sandbox/device work exists, and Hermes doctor plus Cowork now report real non-destructive probes plus a safe local-first auto route for local Node, OS sandbox, Docker, WSL, SSH, Singularity/Apptainer, Modal, Daytona, and Vercel Sandbox. CLI and Cowork can run local Node, auto, WSL, OS sandbox, Docker, Singularity/Apptainer, and configured remote backend smokes through real subprocesses; Docker and remote providers require explicit opt-in. The full official managed backend lifecycle is not present.',
    nextWork: 'Add managed hibernate/wake lifecycle semantics for remote backends only if that upstream Hermes behavior remains product-relevant.',
  },
  {
    id: 'mobile-supervision',
    area: 'Mobile supervision',
    officialSurface: 'Mobile-safe remote supervision, pairing, snapshots, artifact/recall reads, and draft follow-up review',
    codeBuddyEvidence: [
      'src/server/routes/mobile.ts',
      'src/observability/mobile-supervision-snapshot.ts',
      'src/observability/mobile-supervision-gateway-contract.ts',
      'src/observability/mobile-supervision-approval-queue.ts',
      'src/commands/cli/hermes-commands.ts',
      'cowork/src/main/tools/hermes-mobile-supervision-bridge.ts',
      'cowork/src/renderer/components/hermes-mobile-supervision-strip.tsx',
      'tests/server/mobile.test.ts',
      'tests/observability/mobile-supervision-gateway-contract.test.ts',
      'tests/observability/mobile-supervision-approval-queue.test.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/commands/hermes-commands.test.ts tests/agent/hermes-cli-status-real.test.ts --run',
      'npm test -- tests/observability/mobile-supervision-snapshot.test.ts tests/observability/mobile-supervision-gateway-contract.test.ts tests/observability/mobile-supervision-gateway-listener-shell.test.ts tests/observability/mobile-supervision-approval-queue.test.ts tests/server/mobile.test.ts --run',
      'cd cowork && npm test -- --run tests/hermes-mobile-supervision-bridge.test.ts tests/hermes-mobile-supervision-bridge-real.test.ts tests/hermes-mobile-supervision-strip.test.ts',
      'npx tsx src/index.ts hermes mobile status "mobile supervision" --json',
    ],
    notes: 'Code Buddy has local `/api/mobile` server routes, review-only snapshots, recall/artifact reads, pairing, draft-only follow-up prompts, and a dedicated Hermes mobile status command exposing route mount, auth policy, approval queue, blocked operations, and safe next commands without printing pairing codes. Polished off-device TLS/client UX and any auto-dispatch remain intentionally absent.',
    nextWork: 'Build a first-class mobile client and off-device TLS packaging only after the local operator workflow is stable.',
  },
  {
    id: 'research-trajectories',
    area: 'Research trajectories',
    officialSurface: 'Batch trajectory generation and trajectory compression for training/research',
    codeBuddyEvidence: [
      'src/observability/hermes-trajectory-compatibility.ts',
      'src/observability/run-trajectory-export.ts',
      'src/observability/run-trajectory-batch.ts',
      'src/observability/run-recall-pack.ts',
      'src/agent/learning-agent.ts',
      'src/commands/run-cli/index.ts',
      'tests/observability/hermes-trajectory-compatibility.test.ts',
      'tests/observability/run-trajectory-batch.test.ts',
      'tests/observability/run-trajectory-export.test.ts',
      'tests/observability/run-recall-pack.test.ts',
      'cowork/src/main/tools/hermes-trajectories-bridge.ts',
      'cowork/src/renderer/components/hermes-trajectories-strip.tsx',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/observability/run-trajectory-batch.test.ts tests/observability/hermes-trajectory-compatibility.test.ts tests/observability/golden-workflow-evals.test.ts tests/observability/policy-evals.test.ts --run',
      'npm test -- tests/commands/hermes-commands.test.ts --run',
      'npx tsx src/index.ts run trajectory-batch <query> --json',
      'npx tsx src/index.ts hermes trajectories status --json',
      '(cd cowork && npm test -- --run tests/hermes-trajectories-bridge.test.ts tests/hermes-trajectories-strip.test.ts)',
    ],
    notes: 'Trajectory export, batch redacted trajectory collection, compressed agent context, recall packs, Learning Agent retrospectives, golden evals, policy evals, and a Hermes-scoped compatibility report are real. Cowork now surfaces the compatibility report read-only in the Fleet Command Center. Exact upstream training-data pipeline semantics may still differ, but the core research-trajectory batch/compression surface is implemented natively.',
    nextWork: 'Audit upstream training-pipeline semantics again before claiming exact parity; the read-only Cowork surface does not yet trigger batch export.',
  },
  {
    id: 'kanban',
    area: 'Kanban',
    officialSurface: 'hermes kanban and kanban_* coordination tools',
    codeBuddyEvidence: [
      'src/kanban/kanban-store.ts',
      'src/codebuddy/tool-definitions/kanban-tools.ts',
      'src/tools/registry/kanban-tools.ts',
      'src/commands/cli/hermes-commands.ts',
      'tests/tools/kanban-real.test.ts',
      'tests/tools/kanban-operations.test.ts',
      'src/kanban/kanban-board-registry.ts',
      'tests/tools/kanban-board-registry.test.ts',
      'cowork/src/main/tools/hermes-kanban-bridge.ts',
      'cowork/src/renderer/components/KanbanPanel.tsx',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/tools/kanban-real.test.ts tests/tools/kanban-operations.test.ts tests/tools/kanban-board-registry.test.ts --run',
      'npx tsx src/index.ts hermes kanban boards list --json',
      'npx tsx src/index.ts hermes kanban stats --json',
      'npx tsx src/index.ts hermes tools --json',
      '(cd cowork && npm test -- --run tests/hermes-kanban-bridge.test.ts tests/kanban-panel.test.ts)',
    ],
    notes: 'Code Buddy exposes the official kanban_show/list/create/complete/block/comment/link/unblock/heartbeat tool names plus assign, unlink, archive (archived lifecycle state hidden from default lists), and stats (per-status/priority/assignee counts). Following the upstream Kanban reference it now also supports MULTI-BOARD: isolated per-project boards via buddy hermes kanban boards create/switch/list/rm, a --board flag, CODEBUDDY_KANBAN_BOARD env, and a persisted active-board pointer (default → legacy single-board path for backward compat). All of this is reachable from both the CLI and the Cowork CRUD panel (with a board switcher) against the same board files. The goal-mode dispatcher loop and tenant namespaces remain out of scope.',
    nextWork: 'The autonomous dispatcher/goal-mode worker loop and tenant-isolated specialist fleets stay out of scope (they are an orchestration runtime, not a board surface); revisit only if Code Buddy grows a kanban-driven worker pool.',
  },
  {
    id: 'mcp-acp',
    area: 'MCP/ACP',
    officialSurface: 'MCP config/catalog/server mode and ACP server/editor integration',
    codeBuddyEvidence: [
      'src/agent/hermes-protocol-gateways.ts',
      'src/mcp/',
      'src/server/routes/a2a-protocol.ts',
      'src/server/routes/acp.ts',
      'src/server/channel-a2a-bridge.ts',
      'src/protocols/acp/acp-stdio-server.ts',
      'src/protocols/acp/acp-agentic-runner.ts',
      'src/commands/cli/acp-command.ts',
      'tests/agent/hermes-protocol-gateways.test.ts',
      'tests/mcp/mcp-stdio-real-fixture.test.ts',
      'tests/protocols/acp-stdio-server-real.test.ts',
      'tests/protocols/acp/acp-agentic-turn.test.ts',
      'tests/server/',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/protocols/acp/acp-agentic-turn.test.ts tests/protocols/acp-stdio-server-real.test.ts --run',
      'npm test -- tests/agent/hermes-protocol-gateways.test.ts tests/mcp/mcp-stdio-real-fixture.test.ts tests/server/a2a-protocol.test.ts tests/server/acp-routes.test.ts --run',
      'npx tsx src/index.ts hermes protocols status --json',
      'npx tsx src/index.ts hermes protocols-smoke local --json',
    ],
    notes:
      'MCP client/server, A2A HTTP, ACP HTTP, channel-to-A2A bridge, and a Hermes-scoped readiness/smoke surface are present. ' +
      '`buddy acp` implements the Agent Client Protocol over newline-delimited JSON-RPC on stdio ' +
      '(initialize / session.new / session.list / session.load / session.prompt / session.cancel), and now runs FULL agentic ' +
      'tool-using turns (src/protocols/acp/acp-agentic-runner.ts): a bounded tool loop with a read-only toolset streams ACP ' +
      'tool_call / tool_call_update updates, routes file reads through the client `fs/read_text_file` primitive when advertised, and gates ' +
      'them via `session/request_permission`. Proven by a real protocol round-trip integration test that simulates the editor ' +
      '(content served only over fs/read_text_file appears in the next LLM turn — load-bearing proof the client round-trip feeds the loop), ' +
      'not a shape check. Not yet validated against a live editor GUI (e.g. Zed); agentic turns are read-only (no fs/write_text_file edits yet).',
    nextWork:
      'Validate the agentic ACP turn against a live editor GUI (Zed) with a real provider; add agentic edits via fs/write_text_file ' +
      '(reusing the same permission gating), then durable cross-process session storage and MCP passthrough.',
  },
  {
    id: 'openclaw-migration',
    area: 'OpenClaw migration',
    officialSurface: 'hermes claw migrate with 30+ migration categories',
    codeBuddyEvidence: [
      'src/agent/hermes-claw-migrate.ts',
      'src/commands/cli/hermes-commands.ts',
      'tests/agent/hermes-claw-migrate-real.test.ts',
      'cowork/src/main/tools/hermes-claw-migrate-bridge.ts',
      'cowork/src/renderer/components/ClawMigrationDialog.tsx',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/agent/hermes-claw-migrate-real.test.ts tests/agent/hermes-claw-agent-settings.test.ts --run',
      'npx tsx src/index.ts hermes claw status --json',
      'rg -n "claw migrate|OpenClaw|openclaw" src tests docs',
      '(cd cowork && npm test -- --run tests/hermes-claw-migrate-bridge.test.ts tests/claw-migration-dialog.test.ts)',
    ],
    notes:
      '`buddy hermes claw migrate` is implemented against the documented OpenClaw layout ' +
      '(`~/.openclaw`/`~/.clawdbot`/`~/.moltbot` + `clawdbot.json`) and now recognizes 34 distinct ' +
      'categories (up from 23). It imports identity files (SOUL/USER/AGENTS), MEMORY.md, the default ' +
      'model, MCP servers, and skills to real consumer-backed destinations; the other 26 categories ' +
      '(incl. cron, hooks, webhooks, toolsets, profiles, bundles, pairing, runtimes, portal, kanban, ' +
      'learning-loop) are archived for manual review (credential-bearing archives written 0600). ' +
      'Dry-run by default, deterministic, secret-safe; fixture-tested, with no real OpenClaw install validated. ' +
      'Cowork now exposes a confirm-gated migration dialog (dry-run preview on open; apply only after explicit confirm). ' +
      'Agent-behavior defaults are now DIRECTLY IMPORTED (not archived), matching upstream: agents.defaults.timeoutSeconds ' +
      '-> maxToolRounds (/10), compaction.mode -> autoCompact, approvals.exec.mode -> permissions (conservative enum map), ' +
      'theme -> theme — each mapped only onto a confirmed CodeBuddySettings consumer (mapClawAgentBehavior); unmapped ' +
      'fields stay archived for review and existing user settings are not clobbered without --overwrite.',
    nextWork:
      'Upstream itself archives cron/kanban/plugins/hooks (manual recreation), so remaining archived categories without a ' +
      'safe 1:1 settings consumer stay archived by design; promote more only when an OpenClaw shape is verified against a live install.',
  },
];

export function buildHermesParityManifest(generatedAt: string = new Date().toISOString()): HermesParityManifest {
  const summary = FEATURES.reduce(
    (acc, feature) => {
      acc.total += 1;
      if (feature.status === 'covered') acc.covered += 1;
      else if (feature.status === 'covered-partial') acc.coveredPartial += 1;
      else if (feature.status === 'partial') acc.partial += 1;
      else if (feature.status === 'gap') acc.gaps += 1;
      return acc;
    },
    { total: 0, covered: 0, coveredPartial: 0, partial: 0, gaps: 0 },
  );

  return {
    kind: 'hermes_official_parity_manifest',
    schemaVersion: 1,
    generatedAt,
    command: 'buddy hermes parity --json',
    officialSource: {
      repository: 'https://github.com/NousResearch/hermes-agent',
      docs: 'https://hermes-agent.nousresearch.com/docs/',
      inspectedCommit: '5921d667',
      latestTagObserved: 'v2026.5.29.2',
      auditDocument: 'docs/hermes-agent-official-parity-audit-2026-05-30.md',
    },
    summary,
    features: FEATURES.map((feature) => ({ ...feature })),
  };
}

function isActiveTodoFeature(
  feature: HermesParityFeature,
): feature is HermesParityFeature & { status: Extract<HermesParityStatus, 'partial' | 'gap'> } {
  return feature.status === 'partial' || feature.status === 'gap';
}

function isDeferredHermesTodo(feature: HermesParityFeature): boolean {
  return feature.id === 'openclaw-migration';
}

function orderHermesTodoFeatures(features: Array<HermesParityFeature & { status: 'partial' | 'gap' }>) {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const priorityIds = new Set<string>(HERMES_PARITY_PRIORITY_FEATURE_IDS);
  return [
    ...HERMES_PARITY_PRIORITY_FEATURE_IDS
      .map((id) => byId.get(id))
      .filter((feature): feature is HermesParityFeature & { status: 'partial' | 'gap' } => Boolean(feature)),
    ...features.filter((feature) => !priorityIds.has(feature.id)),
  ];
}

function toHermesTodoItem(
  feature: HermesParityFeature & { status: 'partial' | 'gap' },
  priority: number,
): HermesParityTodoItem {
  return {
    area: feature.area,
    id: feature.id,
    nextWork: feature.nextWork ?? feature.notes,
    officialSurface: feature.officialSurface,
    priority,
    status: feature.status,
    verificationCommand: feature.verificationCommands[0] ?? 'n/a',
  };
}

export function buildHermesParityTodo(options: {
  generatedAt?: string;
  includeDeferred?: boolean;
  limit?: number;
} = {}): HermesParityTodoManifest {
  const manifest = buildHermesParityManifest(options.generatedAt);
  const limit = Math.max(1, options.limit ?? 7);
  const allTodos = orderHermesTodoFeatures(manifest.features.filter(isActiveTodoFeature));
  const deferredFeatures = allTodos.filter(isDeferredHermesTodo);
  const activeFeatures = allTodos.filter((feature) => !isDeferredHermesTodo(feature));
  const todoFeatures = options.includeDeferred ? [...activeFeatures, ...deferredFeatures] : activeFeatures;
  const todos = todoFeatures
    .slice(0, limit)
    .map((feature, index) => toHermesTodoItem(feature, index + 1));
  const deferred = deferredFeatures.map((feature, index) => toHermesTodoItem(feature, index + 1));
  const shownTodoCount = todos.length;
  const selectedTodoCount = todoFeatures.length;

  return {
    kind: 'hermes_parity_todo',
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    command: 'buddy hermes todo --json',
    officialSource: manifest.officialSource,
    summary: {
      ...manifest.summary,
      activeTodoCount: activeFeatures.length,
      deferredCount: deferredFeatures.length,
      hiddenTodoCount: Math.max(0, selectedTodoCount - shownTodoCount),
      includedDeferred: options.includeDeferred === true,
      selectedTodoCount,
      shownTodoCount,
      todoLimit: limit,
    },
    todos,
    deferred,
    notes: [
      'Derived from the same official Hermes feature parity manifest as `buddy hermes parity --json`.',
      'OpenClaw migration is deferred for full-parity completion (an initial `claw migrate` is implemented); the deferred remainder is appended only after active work when --include-deferred is passed.',
      'Each todo keeps one real verification command so the next agent can prove progress without relying on mocks.',
    ],
  };
}

export function renderHermesParityManifestMarkdown(manifest: HermesParityManifest): string {
  const lines = [
    '# Hermes Official Parity Manifest',
    '',
    `- Schema version: \`${manifest.schemaVersion}\``,
    `- Generated: \`${manifest.generatedAt}\``,
    `- Command: \`${manifest.command}\``,
    `- Official repo: ${manifest.officialSource.repository}`,
    `- Official docs: ${manifest.officialSource.docs}`,
    `- Inspected commit: \`${manifest.officialSource.inspectedCommit}\``,
    `- Latest tag observed: \`${manifest.officialSource.latestTagObserved}\``,
    `- Audit document: \`${manifest.officialSource.auditDocument}\``,
    '',
    '## Summary',
    '',
    `- Total: ${manifest.summary.total}`,
    `- Covered: ${manifest.summary.covered}`,
    `- Covered/partial: ${manifest.summary.coveredPartial}`,
    `- Partial: ${manifest.summary.partial}`,
    `- Gaps: ${manifest.summary.gaps}`,
    '',
    '## Features',
    '',
  ];

  for (const feature of manifest.features) {
    lines.push(`### ${feature.area}`);
    lines.push('');
    lines.push(`- ID: \`${feature.id}\``);
    lines.push(`- Status: \`${feature.status}\``);
    lines.push(`- Official surface: ${feature.officialSurface}`);
    lines.push('- Code Buddy evidence:');
    for (const evidence of feature.codeBuddyEvidence) {
      lines.push(`  - \`${evidence}\``);
    }
    lines.push('- Verification commands:');
    for (const command of feature.verificationCommands) {
      lines.push(`  - \`${command}\``);
    }
    lines.push(`- Notes: ${feature.notes}`);
    if (feature.nextWork) {
      lines.push(`- Next work: ${feature.nextWork}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
