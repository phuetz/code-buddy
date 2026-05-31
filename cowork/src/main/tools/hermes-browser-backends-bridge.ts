import { loadCoreModule } from '../utils/core-loader';

export type HermesBrowserBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';

export interface HermesBrowserBackendReviewItem {
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
  status: HermesBrowserBackendStatus;
  version: string | null;
}

export interface HermesBrowserBackendsReview {
  backends: HermesBrowserBackendReviewItem[];
  command: string;
  generatedAt: string;
  issues: string[];
  localRunnableCount: number;
  managedConfiguredCount: number;
  ok: boolean;
  platform: string;
  recommendations: string[];
}

export interface HermesBrowserBackendSmokeResult {
  backendId: string;
  command: string | null;
  durationMs: number;
  finishedAt: string;
  label: string | null;
  ok: boolean;
  output: string;
  startedAt: string;
  status: 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';
  stderr: string;
  stdout: string;
}

interface HermesBrowserBackendsReadiness {
  backends: HermesBrowserBackendReviewItem[];
  generatedAt: string;
  issues: string[];
  localRunnableCount: number;
  managedConfiguredCount: number;
  ok: boolean;
  platform: string;
  recommendations: string[];
}

interface HermesAgentDiagnostics {
  browserBackends: HermesBrowserBackendsReadiness;
}

interface HermesAgentDiagnosticsModule {
  buildHermesAgentDiagnostics: () => HermesAgentDiagnostics;
}

interface HermesBrowserBackendsModule {
  runHermesBrowserBackendSmoke: (options: {
    backendId: string;
  }) => Promise<HermesBrowserBackendSmokeResult>;
}

export async function getHermesBrowserBackendsForReview(): Promise<HermesBrowserBackendsReview | null> {
  const mod = await loadCoreModule<HermesAgentDiagnosticsModule>('agent/hermes-agent-diagnostics.js');
  if (!mod?.buildHermesAgentDiagnostics) return null;

  const readiness = mod.buildHermesAgentDiagnostics().browserBackends;
  return {
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
    command: 'buddy hermes browser status --json',
    generatedAt: readiness.generatedAt,
    issues: readiness.issues,
    localRunnableCount: readiness.localRunnableCount,
    managedConfiguredCount: readiness.managedConfiguredCount,
    ok: readiness.ok,
    platform: readiness.platform,
    recommendations: readiness.recommendations,
  };
}

export async function runHermesBrowserBackendSmokeForReview(
  backendId: string,
): Promise<HermesBrowserBackendSmokeResult> {
  const id = backendId.trim();
  if (!id) {
    throw new Error('backendId is required to run a Hermes browser smoke.');
  }

  const mod = await loadCoreModule<HermesBrowserBackendsModule>('agent/hermes-browser-backends.js');
  if (!mod?.runHermesBrowserBackendSmoke) {
    throw new Error('Core Hermes browser smoke module is unavailable.');
  }

  return mod.runHermesBrowserBackendSmoke({ backendId: id });
}
