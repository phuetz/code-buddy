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
      'npx tsx src/index.ts hermes prompt-size safe --json',
    ],
    notes: 'Code Buddy has native CLI/slash surfaces and Hermes diagnostics, but not exact upstream command names or setup flows.',
    nextWork: 'Improve provider/model setup clarity and exact toolset inspection.',
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
    codeBuddyEvidence: ['src/codebuddy/client.ts', 'src/codebuddy/providers/', 'src/config/model-tools.ts'],
    status: 'covered-partial',
    verificationCommands: [
      'npm test -- tests/codebuddy/client-stream-retry.test.ts tests/codebuddy/client-gemini-vision.test.ts --run',
      'npx tsx src/index.ts whoami',
    ],
    notes: 'Provider coverage is broad, but exact upstream provider list and setup UX differ.',
    nextWork: 'Expose clearer Hermes-oriented provider readiness diagnostics.',
  },
  {
    id: 'toolsets',
    area: 'Toolsets',
    officialSurface: 'Core/composite/platform/dynamic toolsets and per-platform hermes-* toolsets',
    codeBuddyEvidence: ['src/fleet/dispatch-profile.ts', 'src/utils/tool-filter.ts', 'tests/fleet/dispatch-profile.test.ts'],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/fleet/dispatch-profile.test.ts --run',
      'npx tsx src/index.ts hermes doctor review --json',
      'npx tsx src/index.ts hermes tools --json',
    ],
    notes: 'Fleet dispatch profiles enforce useful Hermes-style filters, and the official tool parity catalog is now visible from both CLI and Cowork. The official per-platform toolset catalog is still not complete.',
    nextWork: 'Close high-value exact tool gaps or explicitly mark optional platform toolsets out of scope.',
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
      'src/tools/execute-code-runner.ts',
      'src/tools/text-to-speech-tool.ts',
      'src/tools/vision/vision-analysis.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npx tsx src/index.ts tools profile hermes-balanced --json',
      'npm test -- tests/tools/execute-code-real.test.ts tests/tools/send-message-real.test.ts tests/tools/discord-tool-real.test.ts tests/tools/kanban-real.test.ts tests/tools/vision-analyze-real.test.ts tests/tools/text-to-speech-real.test.ts --run',
    ],
    notes: 'Code Buddy has many native tools and now exact Kanban, send_message, discord core, execute_code, vision_analyze, browser_vision, and text_to_speech tool names, but not all official third-party integrations.',
    nextWork: 'Track tool-level parity in a second-level manifest.',
  },
  {
    id: 'messaging-gateway',
    area: 'Messaging gateway',
    officialSurface: 'Single gateway process across Telegram, Discord, Slack, WhatsApp, Signal, SMS, Email, Home Assistant, Matrix, Teams, LINE, ntfy, and more',
    codeBuddyEvidence: ['src/channels/', 'src/channels/send-message.ts', 'src/tools/discord-platform-tool.ts', 'docs/channels.md', 'src/server/channel-a2a-bridge.ts'],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/tools/send-message-real.test.ts tests/tools/discord-tool-real.test.ts --run',
      'rg --files src/channels',
      'npx tsx src/index.ts channels status --json',
    ],
    notes: 'Channel coverage is broad, gateway readiness is machine-readable, send_message exists with dry-run outbox plus approval-gated live delivery, and the exact discord tool covers upstream core REST actions. The official Hermes platform list, gateway lifecycle, admin actions, and slash parity are still not identical.',
    nextWork: 'Add Cowork gateway readiness rendering and per-platform slash parity checks.',
  },
  {
    id: 'browser-automation',
    area: 'Browser automation',
    officialSurface: 'Browserbase, Browser Use, Firecrawl, Camofox/Camoufox, local CDP, hybrid routing, dialog handling, session recording',
    codeBuddyEvidence: ['src/browser-automation/', 'src/tools/browser/', 'src/tools/registry/vision-tools.ts', 'docs/browser-automation-security-audit.md'],
    status: 'partial',
    verificationCommands: [
      'npx tsx src/index.ts tools browser-operator draft "open example.com" --json',
      'npm test -- tests/tools/vision-analyze-real.test.ts --run',
    ],
    notes: 'Strong local browser work exists, including exact browser_vision and browser_dialog prompt-tool surfaces, but complete backend parity for Camofox, Browser Use gateway mode, hybrid routing, and session recording is not proven.',
    nextWork: 'Create backend-specific browser smoke tests and status output.',
  },
  {
    id: 'nous-portal',
    area: 'Nous Portal Tool Gateway',
    officialSurface: 'OAuth setup, hermes portal status, gateway-routed Firecrawl/FAL/OpenAI TTS/Browser Use',
    codeBuddyEvidence: ['src/codebuddy/providers/', 'src/tools/'],
    status: 'gap',
    verificationCommands: ['rg -n "Nous Portal|portal status|NOUS" src tests docs'],
    notes: 'No equivalent Nous Portal command surface was found; this is upstream subscription-specific.',
    nextWork: 'Treat as a product decision before implementation.',
  },
  {
    id: 'memory-providers',
    area: 'Memory',
    officialSurface: 'Built-in memory plus Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory',
    codeBuddyEvidence: ['src/memory/', 'src/agent/lessons-tracker.ts', 'src/memory/user-model.ts'],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/memory tests/agent/lesson-candidate-queue.test.ts --run',
      'npx tsx src/index.ts user-model show --json',
    ],
    notes: 'Local memory, lessons, user model, and some external adapters exist; the full official provider matrix does not.',
    nextWork: 'Update provider matrix and add provider readiness checks.',
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
      'npm test -- tests/agent/research-script-skill-candidate.test.ts --run',
      'npm test -- tests/agent/hermes-skill-package-summary-real.test.ts --run',
      'npm test -- tests/tools/skills-inspection-real.test.ts --run',
      '(cd cowork && npm test -- tests/skill-candidate-review-bridge.test.ts tests/skill-candidate-review-queue-strip.test.ts --run)',
      '(cd cowork && npm test -- tests/skill-package-manager-bridge.test.ts tests/skill-package-manager-strip.test.ts --run)',
    ],
    notes: 'Native skill coverage is good and both skill_manage candidate review plus Cowork now surface installed package state, current SKILL.md previews, candidate install-state comparisons, bounded candidate diff previews, reviewer-gated candidate install/overwrite, and reviewer-gated enable/disable/deprecate/rollback/delete/update/patch from the real SkillsHub lockfile, but exact Hermes hub/tap/update/reset/trust behavior is not proven identical.',
    nextWork: 'Add Cowork expanded side-by-side SKILL.md diff review and close high-value Hermes hub/tap/trust gaps.',
  },
  {
    id: 'closed-learning-loop',
    area: 'Closed learning loop',
    officialSurface: 'Memory nudges, autonomous skill creation, self-improving skills, session search, Honcho modeling',
    codeBuddyEvidence: [
      'src/agent/lesson-candidate-queue.ts',
      'src/memory/user-model.ts',
      'src/observability/run-store.ts',
      'src/agent/research-script-skill-candidate.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/agent/lesson-candidate-queue.test.ts tests/memory/user-model.test.ts --run',
      'npm test -- tests/agent/execution/context-pipeline-user-model.test.ts tests/commands/hermes-commands.test.ts --run',
      'npm test -- tests/agent/learning-agent-real.test.ts --run',
    ],
    notes: 'Comparable direction with stricter review gates. Accepted user-model observations are injected per turn and counted by prompt-size diagnostics; reusable skill outcomes now keep scored recommendation history with reasons and next actions. Honcho-style dialectic inference remains review-gated rather than auto-applied.',
    nextWork: 'Expose expanded SKILL.md diff review in Cowork and keep skill mutation outcomes tied to rollback history.',
  },
  {
    id: 'cron-scheduling',
    area: 'Cron/scheduling',
    officialSurface: 'Natural-language cronjob tool; create/list/update/pause/resume/run/remove; delivery; no-agent script-only jobs; chained and skill-backed jobs',
    codeBuddyEvidence: [
      'src/commands/cron-cli/index.ts',
      'src/scheduler/cron-scheduler.ts',
      'src/daemon/cron-agent-bridge.ts',
      'tests/commands/cron-cli.test.ts',
    ],
    status: 'partial',
    verificationCommands: [
      'npm test -- tests/commands/cron-cli.test.ts tests/scheduler/cron-scheduler-manual-run.test.ts --run',
      'npx tsx src/index.ts cron list --json',
    ],
    notes: 'Direct CLI lifecycle parity now covers add/list/show/update/pause/resume/run/remove, with isolated-store smoke coverage.',
    nextWork: 'Add exact agent-facing cronjob tool semantics plus chained/skill-backed job support if product-relevant.',
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
    codeBuddyEvidence: ['src/security/', 'src/tools/advanced/', 'src/server/'],
    status: 'partial',
    verificationCommands: ['rg -n "Docker|SSH|Daytona|Modal|Singularity|SandboxBackend" src tests docs'],
    notes: 'Local/desktop/server/fleet/sandbox/device work exists; the full official backend matrix is not present.',
    nextWork: 'Add backend inventory and smoke tests for configured backends.',
  },
  {
    id: 'research-trajectories',
    area: 'Research trajectories',
    officialSurface: 'Batch trajectory generation and trajectory compression for training/research',
    codeBuddyEvidence: ['src/observability/', 'tests/observability/'],
    status: 'partial',
    verificationCommands: ['npm test -- tests/observability/golden-workflow-evals.test.ts tests/observability/policy-evals.test.ts --run'],
    notes: 'Trajectory export, recall packs, golden evals, and policy evals are real; official batch runner/compression parity is not proven.',
    nextWork: 'Add a batch trajectory compression compatibility report.',
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
    codeBuddyEvidence: ['src/mcp/', 'src/server/', 'tests/server/'],
    status: 'partial',
    verificationCommands: ['rg -n "MCP|ACP|a2a" src tests docs'],
    notes: 'MCP and A2A/Fleet surfaces are present; exact hermes-acp parity is not established.',
    nextWork: 'Add a dedicated ACP parity check if editor integration becomes a target.',
  },
  {
    id: 'openclaw-migration',
    area: 'OpenClaw migration',
    officialSurface: 'hermes claw migrate with 30+ migration categories',
    codeBuddyEvidence: ['docs/', '.codebuddy/'],
    status: 'gap',
    verificationCommands: ['rg -n "claw migrate|OpenClaw|openclaw" src tests docs'],
    notes: 'No equivalent migration command was found.',
    nextWork: 'Treat as optional product decision.',
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
