import { loadCoreModule } from '../utils/core-loader';

export type HermesRuntimeBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';

export interface HermesRuntimeBackendReviewItem {
  command: string | null;
  configured: boolean;
  credentialSources: string[];
  id: string;
  installed: boolean;
  label: string;
  notes: string[];
  officialSurface: string;
  remediation: string[];
  runnable: boolean;
  smokeCommand: string | null;
  status: HermesRuntimeBackendStatus;
  version: string | null;
}

export interface HermesRuntimeBackendsReview {
  arch: string;
  availableCount: number;
  backends: HermesRuntimeBackendReviewItem[];
  command: string;
  configuredRemoteCount: number;
  generatedAt: string;
  issues: string[];
  ok: boolean;
  platform: string;
  recommendations: string[];
  routePlan?: HermesRuntimeBackendRoutePlan;
  runnableCount: number;
}

export interface HermesRuntimeBackendRoutePlan {
  fallbackBackendIds: string[];
  mode: 'hybrid';
  primaryBackendId: string | null;
  reason: string;
  smokeCommand: string | null;
}

export interface HermesRuntimeBackendSmokeResult {
  args: string[];
  backendId: string;
  command: string | null;
  durationMs: number;
  exitCode: number | null;
  finishedAt: string;
  label: string | null;
  ok: boolean;
  output: string;
  signal: string | null;
  startedAt: string;
  status: 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';
  stderr: string;
  stdout: string;
}

interface HermesRuntimeBackendsReadiness {
  arch: string;
  availableCount: number;
  backends: HermesRuntimeBackendReviewItem[];
  configuredRemoteCount: number;
  generatedAt: string;
  issues: string[];
  ok: boolean;
  platform: string;
  recommendations: string[];
  routePlan?: HermesRuntimeBackendRoutePlan;
  runnableCount: number;
}

interface HermesAgentDiagnostics {
  runtimeBackends: HermesRuntimeBackendsReadiness;
}

interface HermesAgentDiagnosticsModule {
  buildHermesAgentDiagnostics: () => HermesAgentDiagnostics;
}

interface HermesRuntimeBackendsModule {
  runHermesRuntimeBackendSmoke: (options: {
    allowDockerSmoke?: boolean;
    allowRemoteSmoke?: boolean;
    backendId: string;
  }) => HermesRuntimeBackendSmokeResult;
}

export async function getHermesRuntimeBackendsForReview(): Promise<HermesRuntimeBackendsReview | null> {
  const mod = await loadCoreModule<HermesAgentDiagnosticsModule>('agent/hermes-agent-diagnostics.js');
  if (!mod?.buildHermesAgentDiagnostics) return null;

  const readiness = mod.buildHermesAgentDiagnostics().runtimeBackends;
  return {
    arch: readiness.arch,
    availableCount: readiness.availableCount,
    backends: readiness.backends.map((backend) => ({
      command: backend.command,
      configured: backend.configured,
      credentialSources: backend.credentialSources,
      id: backend.id,
      installed: backend.installed,
      label: backend.label,
      notes: backend.notes,
      officialSurface: backend.officialSurface,
      remediation: backend.remediation,
      runnable: backend.runnable,
      smokeCommand: backend.smokeCommand,
      status: backend.status,
      version: backend.version,
    })),
    command: 'buddy hermes doctor balanced --json',
    configuredRemoteCount: readiness.configuredRemoteCount,
    generatedAt: readiness.generatedAt,
    issues: readiness.issues,
    ok: readiness.ok,
    platform: readiness.platform,
    recommendations: readiness.recommendations,
    routePlan: readiness.routePlan,
    runnableCount: readiness.runnableCount,
  };
}

export async function runHermesRuntimeBackendSmokeForReview(
  backendId: string,
  options: {
    allowDockerSmoke?: boolean;
    allowRemoteSmoke?: boolean;
  } = {},
): Promise<HermesRuntimeBackendSmokeResult> {
  const id = backendId.trim();
  if (!id) {
    throw new Error('backendId is required to run a Hermes runtime smoke.');
  }

  const mod = await loadCoreModule<HermesRuntimeBackendsModule>('agent/hermes-runtime-backends.js');
  if (!mod?.runHermesRuntimeBackendSmoke) {
    throw new Error('Core Hermes runtime smoke module is unavailable.');
  }

  return mod.runHermesRuntimeBackendSmoke({
    allowDockerSmoke: options.allowDockerSmoke,
    allowRemoteSmoke: options.allowRemoteSmoke,
    backendId: id,
  });
}
