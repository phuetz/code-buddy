import {
  GOLDEN_WORKFLOW_EVAL_FIXTURES,
  GOLDEN_WORKFLOW_EVAL_SCHEMA_VERSION,
} from './golden-workflow-evals.js';
import {
  POLICY_EVALS,
  POLICY_EVAL_SCHEMA_VERSION,
} from './policy-evals.js';
import {
  buildRunRecallPack,
  RUN_RECALL_PACK_SCHEMA_VERSION,
} from './run-recall-pack.js';
import {
  buildRunTrajectoryBatchExport,
  RUN_TRAJECTORY_BATCH_SCHEMA_VERSION,
} from './run-trajectory-batch.js';
import {
  buildRunTrajectoryExport,
  RUN_TRAJECTORY_EXPORT_SCHEMA_VERSION,
} from './run-trajectory-export.js';
import { RunStore } from './run-store.js';

export type HermesTrajectoryCapabilityStatus = 'available' | 'partial' | 'missing';

export interface HermesTrajectoryCompatibilityCapability {
  id: string;
  label: string;
  officialSurface: string;
  status: HermesTrajectoryCapabilityStatus;
  evidence: string[];
  commands: string[];
  notes: string[];
}

export interface HermesTrajectoryCompatibilityReport {
  kind: 'hermes_trajectory_compatibility_report';
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  officialSurface: string;
  summary: {
    total: number;
    availableCount: number;
    partialCount: number;
    missingCount: number;
    goldenFixtureCount: number;
    policyEvalCount: number;
  };
  schemaVersions: {
    trajectoryBatch: number;
    goldenWorkflowEval: number;
    policyEval: number;
    recallPack: number;
    trajectoryExport: number;
  };
  capabilities: HermesTrajectoryCompatibilityCapability[];
  probe?: HermesTrajectoryCompatibilityProbe;
  recommendations: string[];
}

export interface HermesTrajectoryCompatibilityProbe {
  recallPack?: {
    count: number;
    lessonCount: number;
    memoryCount: number;
    query: string;
    runCount: number;
    sessionCount: number;
  };
  trajectoryBatch?: {
    compressedBytes: number;
    runCount: number;
    sourceRunIds: string[];
    truncated: boolean;
  };
  trajectoryExport?: {
    artifactContentIncluded?: boolean;
    artifactCount?: number;
    eventCount?: number;
    found: boolean;
    redactionCount?: number;
    runId: string;
    status?: string;
    toolCallCount?: number;
    toolResultCount?: number;
  };
}

export interface BuildHermesTrajectoryCompatibilityReportOptions {
  includeArtifactContent?: boolean;
  maxArtifactBytes?: number;
  query?: string;
  runId?: string;
  store?: RunStore;
}

const OFFICIAL_SURFACE = 'Hermes batch trajectory generation and trajectory compression for training/research';

const CAPABILITIES: HermesTrajectoryCompatibilityCapability[] = [
  {
    id: 'trajectory-export',
    label: 'Redacted trajectory export',
    officialSurface: 'Export a complete, review-safe trajectory for audit and evals',
    status: 'available',
    evidence: [
      'src/observability/run-trajectory-export.ts',
      'src/commands/run-cli/index.ts',
      'tests/observability/run-trajectory-export.test.ts',
    ],
    commands: [
      'buddy run trajectory-export <run-id> --json',
      'buddy hermes trajectories status --run-id <run-id> --json',
    ],
    notes: [
      'Exports prompts, selected context, tool calls/results, artifacts, final answer, metrics, and raw event sequence.',
      'Secrets are redacted before the trajectory leaves the store.',
    ],
  },
  {
    id: 'recall-pack',
    label: 'Compressed recall pack',
    officialSurface: 'Compress prior trajectories into cited context for future agents',
    status: 'available',
    evidence: [
      'src/observability/run-recall-pack.ts',
      'src/commands/run-cli/index.ts',
      'tests/observability/run-recall-pack.test.ts',
    ],
    commands: [
      'buddy run recall-pack <query> --json',
      'buddy hermes trajectories status <query> --json',
    ],
    notes: [
      'Builds a compact prompt context from matching run summaries, events, artifacts, lessons, memories, and sessions.',
    ],
  },
  {
    id: 'learning-retrospective',
    label: 'Learning Agent retrospective',
    officialSurface: 'Analyze completed trajectories and extract reusable lessons or skill candidates',
    status: 'available',
    evidence: [
      'src/agent/learning-agent.ts',
      'src/observability/run-store.ts',
      'tests/agent/learning-agent.test.ts',
    ],
    commands: [
      'buddy run retrospective <run-id> --json',
    ],
    notes: [
      'Runs after completed RunStore sessions and can also be invoked explicitly for a stored run.',
    ],
  },
  {
    id: 'golden-workflow-evals',
    label: 'Golden workflow evals',
    officialSurface: 'Evaluate stored trajectories against repeatable workflow fixtures',
    status: 'available',
    evidence: [
      'src/observability/golden-workflow-evals.ts',
      'tests/observability/golden-workflow-evals.test.ts',
    ],
    commands: [
      'buddy run golden-evals --json',
      'buddy run golden-evals <fixture-id> <run-id> --json',
    ],
    notes: [
      'Provides stable fixtures for lead-discovery, recall-handoff, and other workflow behaviors.',
    ],
  },
  {
    id: 'policy-evals',
    label: 'Trajectory policy evals',
    officialSurface: 'Evaluate trajectory behavior against safety and process policies',
    status: 'available',
    evidence: [
      'src/observability/policy-evals.ts',
      'tests/observability/policy-evals.test.ts',
    ],
    commands: [
      'buddy run policy-evals --json',
      'buddy run policy-evals <policy-id> <run-id> --json',
    ],
    notes: [
      'Checks behavior-level policies such as public-source evidence and tool-filter blocking.',
    ],
  },
  {
    id: 'batch-trajectory-generation',
    label: 'Batch trajectory generation',
    officialSurface: 'Generate or collect batches of trajectories for research runs',
    status: 'available',
    evidence: [
      'src/observability/run-store.ts',
      'src/observability/run-trajectory-batch.ts',
      'src/commands/run-cli/index.ts',
    ],
    commands: [
      'buddy run trajectory-batch <query> --json',
      'buddy run trajectory-batch --run-id <run-id> --json',
    ],
    notes: [
      'Collects matching stored runs into a review-safe batch of redacted trajectories.',
    ],
  },
  {
    id: 'trajectory-compression',
    label: 'Trajectory compression',
    officialSurface: 'Compress stored trajectories into training/research-ready bundles',
    status: 'available',
    evidence: [
      'src/observability/run-recall-pack.ts',
      'src/observability/run-trajectory-batch.ts',
      'src/observability/run-trajectory-export.ts',
    ],
    commands: [
      'buddy run recall-pack <query> --json',
      'buddy run trajectory-batch <query> --json',
      'buddy hermes trajectories status <query> --json',
    ],
    notes: [
      'Recall packs and trajectory batches now emit bounded agent-ready compressed context from redacted run evidence.',
    ],
  },
];

export function buildHermesTrajectoryCompatibilityReport(
  options: BuildHermesTrajectoryCompatibilityReportOptions = {},
): HermesTrajectoryCompatibilityReport {
  const store = options.store ?? RunStore.getInstance();
  const capabilities = CAPABILITIES.map((capability) => ({ ...capability }));
  const summary = summarizeCapabilities(capabilities);
  const probe = buildProbe(options, store);

  return {
    kind: 'hermes_trajectory_compatibility_report',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: summary.missingCount === 0,
    officialSurface: OFFICIAL_SURFACE,
    summary: {
      ...summary,
      goldenFixtureCount: GOLDEN_WORKFLOW_EVAL_FIXTURES.length,
      policyEvalCount: POLICY_EVALS.length,
    },
    schemaVersions: {
      trajectoryBatch: RUN_TRAJECTORY_BATCH_SCHEMA_VERSION,
      goldenWorkflowEval: GOLDEN_WORKFLOW_EVAL_SCHEMA_VERSION,
      policyEval: POLICY_EVAL_SCHEMA_VERSION,
      recallPack: RUN_RECALL_PACK_SCHEMA_VERSION,
      trajectoryExport: RUN_TRAJECTORY_EXPORT_SCHEMA_VERSION,
    },
    capabilities,
    probe,
    recommendations: buildRecommendations(summary),
  };
}

export function renderHermesTrajectoryCompatibilityReport(
  report: HermesTrajectoryCompatibilityReport,
): string {
  const lines = [
    'Hermes trajectory compatibility:',
    `Status: ${report.ok ? 'ok' : 'needs attention'}`,
    `Surface: ${report.officialSurface}`,
    `Capabilities: ${report.summary.availableCount} available, ${report.summary.partialCount} partial, ${report.summary.missingCount} missing`,
    `Fixtures: ${report.summary.goldenFixtureCount} golden workflow evals, ${report.summary.policyEvalCount} policy evals`,
    '',
    'Capabilities:',
  ];

  for (const capability of report.capabilities) {
    lines.push(`- ${capability.status.padEnd(9)} ${capability.id}: ${capability.label}`);
    if (capability.commands.length === 0) {
      lines.push('  Commands: n/a');
    } else if (capability.commands.length === 1) {
      lines.push(`  Command: ${capability.commands[0]}`);
    } else {
      lines.push('  Commands:');
      for (const command of capability.commands) {
        lines.push(`    - ${command}`);
      }
    }
    lines.push(`  Evidence: ${capability.evidence.length} file/test reference(s)`);
  }

  if (report.probe?.trajectoryExport) {
    const probe = report.probe.trajectoryExport;
    lines.push(
      '',
      'Run probe:',
      `- ${probe.runId}: ${probe.found ? 'found' : 'not found'}`,
    );
    if (probe.found) {
      lines.push(
        `  Events: ${probe.eventCount ?? 0}; tools: ${probe.toolCallCount ?? 0}/${probe.toolResultCount ?? 0}; artifacts: ${probe.artifactCount ?? 0}; redactions: ${probe.redactionCount ?? 0}`,
      );
    }
  }

  if (report.probe?.recallPack) {
    const probe = report.probe.recallPack;
    lines.push(
      '',
      'Recall probe:',
      `- "${probe.query}": ${probe.count} matches across ${probe.runCount} run(s)`,
    );
  }

  if (report.probe?.trajectoryBatch) {
    const probe = report.probe.trajectoryBatch;
    lines.push(
      '',
      'Batch probe:',
      `- ${probe.runCount} run(s), ${probe.compressedBytes} compressed bytes, truncated=${probe.truncated}`,
    );
  }

  if (report.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  return lines.join('\n');
}

function summarizeCapabilities(capabilities: HermesTrajectoryCompatibilityCapability[]): {
  availableCount: number;
  missingCount: number;
  partialCount: number;
  total: number;
} {
  return {
    total: capabilities.length,
    availableCount: capabilities.filter((capability) => capability.status === 'available').length,
    partialCount: capabilities.filter((capability) => capability.status === 'partial').length,
    missingCount: capabilities.filter((capability) => capability.status === 'missing').length,
  };
}

function buildProbe(
  options: BuildHermesTrajectoryCompatibilityReportOptions,
  store: RunStore,
): HermesTrajectoryCompatibilityProbe | undefined {
  const probe: HermesTrajectoryCompatibilityProbe = {};

  if (options.runId?.trim()) {
    const runId = options.runId.trim();
    const exported = buildRunTrajectoryExport(runId, {
      includeArtifactContent: options.includeArtifactContent,
      maxArtifactBytes: options.maxArtifactBytes,
      store,
    });

    probe.trajectoryExport = exported
      ? {
          artifactContentIncluded: exported.privacy.artifactContentIncluded,
          artifactCount: exported.artifacts.length,
          eventCount: exported.events.length,
          found: true,
          redactionCount: exported.privacy.redactionCount,
          runId,
          status: exported.run.status,
          toolCallCount: exported.toolCalls.length,
          toolResultCount: exported.toolResults.length,
        }
      : {
          found: false,
          runId,
        };
  }

  if (options.query?.trim()) {
    const query = options.query.trim();
    const recallPack = buildRunRecallPack(query, {
      includeLessons: false,
      includeMemories: false,
      includeSessions: false,
      store,
    });
    probe.recallPack = {
      count: recallPack.count,
      lessonCount: recallPack.lessonCount,
      memoryCount: recallPack.memoryCount,
      query: recallPack.query,
      runCount: recallPack.runCount,
      sessionCount: recallPack.sessionCount,
    };
    const batch = buildRunTrajectoryBatchExport({
      includeArtifactContent: options.includeArtifactContent,
      maxArtifactBytes: options.maxArtifactBytes,
      query,
      store,
    });
    probe.trajectoryBatch = {
      compressedBytes: batch.compressed.text.length,
      runCount: batch.summary.runCount,
      sourceRunIds: batch.compressed.sourceRunIds,
      truncated: batch.compressed.truncated,
    };
  }

  return probe.trajectoryExport || probe.recallPack || probe.trajectoryBatch ? probe : undefined;
}

function buildRecommendations(summary: {
  missingCount: number;
  partialCount: number;
}): string[] {
  const recommendations: string[] = [];
  if (summary.partialCount > 0) {
    recommendations.push(
      'Investigate any partial trajectory primitive before claiming full Hermes research parity.',
    );
  }
  if (summary.missingCount > 0) {
    recommendations.push('Implement missing trajectory primitives before claiming full Hermes research parity.');
  }
  recommendations.push('Use --run-id with a real stored run to prove redacted export metrics on demand.');
  return recommendations;
}
