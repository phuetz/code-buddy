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
    includedDeferred: boolean;
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
      'src/commands/cli/hermes-commands.ts',
      'src/agent/custom/custom-agent-loader.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/agent/custom-agent-loader-hermes.test.ts --run',
      'npx tsx src/index.ts hermes profile balanced --json',
    ],
    notes: 'Code Buddy maps Hermes ideas to native TypeScript/Fleet primitives; it does not vendor or run upstream Hermes Python.',
    nextWork: 'Keep native mapping explicit in user-facing diagnostics.',
  },
  {
    id: 'cli-tui',
    area: 'CLI/TUI',
    officialSurface: 'Terminal TUI plus hermes chat/model/tools/prompt-size style commands',
    codeBuddyEvidence: ['src/index.ts', 'src/commands/cli/hermes-commands.ts', 'docs/commands.md'],
    status: 'partial',
    verificationCommands: [
      'npx tsx src/index.ts hermes doctor safe --json',
      'npx tsx src/index.ts hermes toolsets safe --json',
      'npx tsx src/index.ts hermes prompt-size safe --json',
    ],
    notes: 'Code Buddy has native CLI/slash surfaces, Hermes diagnostics, dedicated toolset inspection, and prompt-size reporting, but not exact upstream command names or setup flows.',
    nextWork: 'Improve provider/model setup clarity where it remains product-relevant.',
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
      'tests/fleet/dispatch-profile.test.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/fleet/dispatch-profile.test.ts --run',
      'npx tsx src/index.ts hermes toolsets review --json',
      'npx tsx src/index.ts hermes doctor review --json',
      'npx tsx src/index.ts hermes tools --json',
    ],
    notes: 'Fleet dispatch profiles enforce useful Hermes-style filters, the dedicated `buddy hermes toolsets` catalog exposes all native profile/toolset policy decisions, and the official tool parity catalog is visible from both CLI and Cowork. The official per-platform toolset catalog is still not complete.',
    nextWork: 'Keep the official tool catalog current and move remaining partial product surfaces into explicit status/readiness checks.',
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
    notes: 'Strong local browser work exists, including exact browser_vision and browser_dialog prompt-tool surfaces plus machine-readable backend readiness for local Playwright, CDP, Browserbase/Stagehand, Browser Use gateway, Firecrawl, Camofox, and session recording. A real local Playwright smoke launches Chromium, verifies page content, and writes a trace.zip recording artifact. Complete backend parity for Camofox, Browser Use gateway mode, managed replay, and hybrid routing is still not proven.',
    nextWork: 'Wire first-class managed backend runners and hybrid browser routing before claiming full Hermes browser backend parity.',
  },
  {
    id: 'nous-portal',
    area: 'Nous Portal Tool Gateway',
    officialSurface: 'OAuth setup, hermes portal status, gateway-routed Firecrawl/FAL/OpenAI TTS/Browser Use',
    codeBuddyEvidence: [
      'src/agent/hermes-portal-status.ts',
      'src/commands/cli/hermes-commands.ts',
      'src/codebuddy/providers/',
      'src/tools/',
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/commands/hermes-commands.test.ts --run',
      'npx tsx src/index.ts hermes portal status --json',
      'npx tsx src/index.ts hermes portal tools --json',
    ],
    notes: 'Code Buddy now exposes a Hermes-compatible local readiness surface for Nous Portal auth, subscription links, Tool Gateway configuration, managed-vs-direct routing, and the official Firecrawl/FAL/TTS/Browser Use/Modal catalog without printing secret values. It does not yet implement the upstream OAuth device-code flow or an actual Nous-managed proxy runtime.',
    nextWork: 'Add live OAuth/device-code login and managed Tool Gateway proxy only after a product decision and credentials are available.',
  },
  {
    id: 'memory-providers',
    area: 'Memory',
    officialSurface: 'Built-in memory plus Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory',
    codeBuddyEvidence: [
      'src/memory/',
      'src/agent/hermes-memory-providers.ts',
      'src/commands/cli/hermes-commands.ts',
      'src/agent/lessons-tracker.ts',
      'src/memory/user-model.ts',
      'cowork/src/main/tools/hermes-memory-providers-bridge.ts',
      'cowork/src/renderer/components/hermes-memory-providers-strip.tsx',
    ],
    status: 'partial',
    verificationCommands: [
      'npx tsx src/index.ts hermes memory status --json',
      'npm test -- tests/agent/hermes-memory-providers.test.ts tests/memory/memory-provider.test.ts --run',
      '(cd cowork && npm test -- tests/hermes-memory-providers-bridge.test.ts tests/hermes-memory-providers-bridge-real.test.ts tests/hermes-memory-providers-strip.test.ts --run)',
      'npm test -- tests/memory tests/agent/lesson-candidate-queue.test.ts --run',
      'npx tsx src/index.ts user-model show --json',
    ],
    notes: 'Local memory, lessons, user model, and Mem0/Honcho/Supermemory adapters exist. `buddy hermes memory status --json` and Cowork Fleet now expose a secret-safe provider readiness matrix with active provider, credential source names, local-fallback adapters, and missing official adapters. The full official provider matrix is still partial because OpenViking, Hindsight, Holographic, RetainDB, and ByteRover adapters are not implemented.',
    nextWork: 'Add missing OpenViking/Hindsight/Holographic/RetainDB/ByteRover adapters only after product relevance and credentials/API contracts are confirmed.',
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
      'docs/hermes-agent-status.md',
    ],
    status: 'partial',
    verificationCommands: [
      'npx tsx src/index.ts skills list --json',
      'npx tsx src/index.ts skills doctor --json',
      'npx tsx src/index.ts skills tap list --json',
      'npx tsx src/index.ts skills update-preview <name> --json',
      'npx tsx src/index.ts skills reset <name> --approved-by <reviewer> --json',
      'npm test -- tests/agent/research-script-skill-candidate.test.ts --run',
      'npm test -- tests/agent/hermes-skill-package-summary-real.test.ts --run',
      'npm test -- tests/tools/skills-inspection-real.test.ts --run',
      '(cd cowork && npm test -- tests/skill-candidate-review-bridge.test.ts tests/skill-candidate-review-queue-strip.test.ts --run)',
      '(cd cowork && npm test -- tests/skill-package-manager-bridge.test.ts tests/skill-package-manager-strip.test.ts --run)',
      'npm test -- tests/skills/hub.test.ts tests/commands/skills-command-real.test.ts --run',
    ],
    notes: 'Native skill coverage is good and the exact skill_manage prompt-tool action surface now covers official create(content), edit(content), patch(old_string/new_string/file_path/replace_all), write_file, and remove_file semantics with Code Buddy review gates. Candidate review plus Cowork also surface installed package state, current SKILL.md previews, candidate install-state comparisons, bounded unified and expanded side-by-side candidate diffs, reviewer-gated candidate install/overwrite, and reviewer-gated enable/disable/deprecate/rollback/reset/delete/update/patch from the real SkillsHub lockfile. Repository tap/trust management persists owner/repo taps with path and trust metadata through buddy skills tap list/add/remove/trust/refresh, direct .well-known skill catalogs are cached through buddy skills well-known <url>, remote update diff previews are available through buddy skills update-preview plus skill_manage action=preview_update, and Code Buddy reset restores tampered or missing installed skills from real hub/cache content after reviewer approval. Reset is a Code Buddy repair extension because official Hermes skill_manage does not expose a reset action.',
    nextWork: 'Add an optional full-page Cowork manager only if the Fleet cockpit strips become too cramped for daily skill operations.',
  },
  {
    id: 'closed-learning-loop',
    area: 'Closed learning loop',
    officialSurface: 'Memory nudges, autonomous skill creation, self-improving skills, session search, Honcho modeling',
    codeBuddyEvidence: [
      'src/agent/lesson-candidate-queue.ts',
      'src/agent/learning-agent.ts',
      'src/memory/user-model.ts',
      'src/commands/user-model.ts',
      'src/observability/run-store.ts',
      'src/agent/research-script-skill-candidate.ts',
      'tests/commands/user-model-command-real.test.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/agent/lesson-candidate-queue.test.ts tests/memory/user-model.test.ts --run',
      'npm test -- tests/memory/user-model.test.ts tests/commands/user-model-command-real.test.ts --run',
      'npm test -- tests/agent/execution/context-pipeline-user-model.test.ts tests/commands/hermes-commands.test.ts --run',
      'npm test -- tests/agent/learning-agent-real.test.ts --run',
      'npm test -- tests/tools/skills-inspection-real.test.ts tests/agent/learning-agent-real.test.ts --run',
    ],
    notes: 'Comparable direction with stricter review gates. Accepted user-model observations are injected per turn and counted by prompt-size diagnostics; reusable skill outcomes now keep scored recommendation history with reasons and next actions, and approved skill_manage mutations record rollback snapshot ids in Learning Agent telemetry. Honcho-style LLM inference and credential-free deterministic local inference both propose pending observations only; a real CLI test proves session analysis writes candidates without silently accepting them.',
    nextWork: 'Add provider-backed Honcho-style remote inference only if credentials and operator workflow justify it; keep all inferred observations behind explicit review.',
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
      'tests/commands/cron-cli.test.ts',
      'tests/tools/cronjob-tool-real.test.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/commands/cron-cli.test.ts tests/scheduler/cron-scheduler-manual-run.test.ts --run',
      'npm test -- tests/tools/cronjob-tool-real.test.ts --run',
      'npx tsx src/index.ts cron list --json',
    ],
    notes: 'Direct CLI lifecycle parity covers add/list/show/update/pause/resume/run/remove, and the exact agent-facing cronjob prompt tool now covers list/show/create/pause/resume/run/remove over the persisted CronScheduler store with real isolated-store smoke coverage.',
    nextWork: 'Add chained jobs, skill-backed jobs, and script-only no-agent scheduling only if those upstream Hermes workflow details remain product-relevant.',
  },
  {
    id: 'delegation-parallelism',
    area: 'Delegation/parallelism',
    officialSurface: 'delegate_task, isolated subagents, execute_code scripts calling tools by RPC',
    codeBuddyEvidence: ['src/fleet/', 'src/tools/peer-chain-tool.ts', 'src/agent/autonomous/agentic-coding-runner.ts', 'src/tools/execute-code-runner.ts'],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/fleet --run',
      'npm test -- tests/tools/execute-code-real.test.ts --run',
    ],
    notes: 'Delegation is strong through Fleet and subagents; execute_code now provides a real local subprocess boundary with artifacts. Generated-code-to-tool RPC collapse remains a separate product/security decision.',
    nextWork: 'Decide only whether generated code should ever call Code Buddy tools by RPC; keep disabled until explicitly approved.',
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
      'npx tsx src/index.ts hermes runtime-smoke local --json',
      'rg -n "Docker|SSH|Daytona|Modal|Singularity|SandboxBackend" src tests docs',
    ],
    notes: 'Local/desktop/server/fleet/sandbox/device work exists, and Hermes doctor plus Cowork now report real non-destructive probes plus smoke commands for local Node, OS sandbox, Docker, WSL, SSH, Singularity/Apptainer, Modal, Daytona, and Vercel Sandbox. CLI and Cowork can run local Node and WSL backend smokes through real subprocesses when available. The full official managed backend lifecycle is not present.',
    nextWork: 'Add opt-in live smoke runners for configured Docker/remote backends before claiming managed backend parity.',
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
      'src/observability/run-recall-pack.ts',
      'src/agent/learning-agent.ts',
      'src/commands/run-cli/index.ts',
      'tests/observability/hermes-trajectory-compatibility.test.ts',
      'tests/observability/',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/observability/hermes-trajectory-compatibility.test.ts tests/observability/golden-workflow-evals.test.ts tests/observability/policy-evals.test.ts --run',
      'npm test -- tests/commands/hermes-commands.test.ts --run',
      'npx tsx src/index.ts hermes trajectories status --json',
    ],
    notes: 'Trajectory export, recall packs, Learning Agent retrospectives, golden evals, policy evals, and a Hermes-scoped compatibility report are real; upstream-style batch runner/compression parity is still not proven.',
    nextWork: 'Implement an upstream-style batch trajectory generator/compressor only after real operator demand justifies it.',
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
    ],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/tools/kanban-real.test.ts --run',
      'npx tsx src/index.ts hermes kanban list --json',
      'npx tsx src/index.ts hermes tools --json',
    ],
    notes: 'Code Buddy now exposes the official kanban_show/list/create/complete/block/comment/link/unblock/heartbeat tool names plus a persistent workspace board and buddy hermes kanban CLI. Upstream UI/lifecycle semantics may still differ.',
    nextWork: 'Dogfood the board in multi-agent sessions and add Cowork Kanban rendering if it becomes a daily control surface.',
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
      'tests/agent/hermes-protocol-gateways.test.ts',
      'tests/mcp/mcp-stdio-real-fixture.test.ts',
      'tests/server/',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/agent/hermes-protocol-gateways.test.ts tests/mcp/mcp-stdio-real-fixture.test.ts tests/server/a2a-protocol.test.ts tests/server/acp-routes.test.ts --run',
      'npx tsx src/index.ts hermes protocols status --json',
      'npx tsx src/index.ts hermes protocols-smoke local --json',
    ],
    notes: 'MCP client/server, A2A HTTP, ACP HTTP, channel-to-A2A bridge, and a Hermes-scoped readiness/smoke surface are present; exact upstream Hermes ACP editor packaging is still not claimed.',
    nextWork: 'Package and verify a real editor ACP workflow only after the protocol gateway surface becomes a daily operator target.',
  },
  {
    id: 'openclaw-migration',
    area: 'OpenClaw migration',
    officialSurface: 'hermes claw migrate with 30+ migration categories',
    codeBuddyEvidence: ['docs/', '.codebuddy/'],
    status: 'gap',
    verificationCommands: ['rg -n "claw migrate|OpenClaw|openclaw" src tests docs'],
    notes: 'No equivalent migration command was found.',
    nextWork: 'Do this at the end; the user explicitly deferred migration from OpenClaw until after the Hermes core is finished.',
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
  const activeFeatures = allTodos.filter((feature) => options.includeDeferred || !isDeferredHermesTodo(feature));
  const todos = activeFeatures
    .slice(0, limit)
    .map((feature, index) => toHermesTodoItem(feature, index + 1));
  const deferred = deferredFeatures.map((feature, index) => toHermesTodoItem(feature, index + 1));

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
      includedDeferred: options.includeDeferred === true,
    },
    todos,
    deferred,
    notes: [
      'Derived from the same official Hermes feature parity manifest as `buddy hermes parity --json`.',
      'OpenClaw migration is deferred by user decision and excluded from active todos unless --include-deferred is passed.',
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
