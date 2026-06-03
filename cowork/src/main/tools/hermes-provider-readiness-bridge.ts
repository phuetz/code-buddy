import { loadCoreModule } from '../utils/core-loader';

export interface HermesProviderReadinessReview {
  command: string;
  ok: boolean;
  activeModel: {
    model: string;
    provider: string;
    source: string;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    supportsToolCalls: boolean;
    supportsReasoning: boolean;
    supportsVision: boolean;
  };
  activeProvider: {
    label: string;
    configured: boolean;
    credentialSources: string[];
    local: boolean;
    baseUrl: string | null;
    setupCommands: string[];
  };
  portal: {
    credentialPresent: boolean;
    credentialSources: string[];
    toolGatewayConfigured: boolean;
    managedByNousCount: number;
    directFallbackCount: number;
  };
  providerCount: number;
  configuredProviderCount: number;
  issues: string[];
  recommendations: string[];
}

interface HermesProviderReadiness {
  ok: boolean;
  activeModel: HermesProviderReadinessReview['activeModel'];
  activeProvider: HermesProviderReadinessReview['activeProvider'];
  providers: Array<{ configured: boolean }>;
  portal: {
    portal: {
      credentialPresent: boolean;
      credentialSources: string[];
      toolGatewayConfigured: boolean;
    };
    toolGateway: {
      configuredCount?: number;
      directFallbackCount?: number;
      managedByNousCount: number;
    };
  };
  issues: string[];
  recommendations: string[];
}

interface HermesAgentDiagnostics {
  providerReadiness: HermesProviderReadiness;
}

interface HermesAgentDiagnosticsModule {
  buildHermesAgentDiagnostics: () => HermesAgentDiagnostics;
}

export async function getHermesProviderReadinessForReview(): Promise<HermesProviderReadinessReview | null> {
  const mod = await loadCoreModule<HermesAgentDiagnosticsModule>('agent/hermes-agent-diagnostics.js');
  if (!mod?.buildHermesAgentDiagnostics) return null;

  const readiness = mod.buildHermesAgentDiagnostics().providerReadiness;
  const managedByNousCount = readiness.portal.toolGateway.managedByNousCount;
  const configuredToolCount = readiness.portal.toolGateway.configuredCount;
  const directFallbackCount =
    readiness.portal.toolGateway.directFallbackCount ??
    (typeof configuredToolCount === 'number'
      ? Math.max(0, configuredToolCount - managedByNousCount)
      : 0);

  return {
    command: 'buddy hermes providers status --json',
    ok: readiness.ok,
    activeModel: {
      model: readiness.activeModel.model,
      provider: readiness.activeModel.provider,
      source: readiness.activeModel.source,
      contextWindow: readiness.activeModel.contextWindow,
      maxOutputTokens: readiness.activeModel.maxOutputTokens,
      supportsToolCalls: readiness.activeModel.supportsToolCalls,
      supportsReasoning: readiness.activeModel.supportsReasoning,
      supportsVision: readiness.activeModel.supportsVision,
    },
    activeProvider: {
      label: readiness.activeProvider.label,
      configured: readiness.activeProvider.configured,
      credentialSources: readiness.activeProvider.credentialSources,
      local: readiness.activeProvider.local,
      baseUrl: readiness.activeProvider.baseUrl,
      setupCommands: readiness.activeProvider.setupCommands ?? [],
    },
    portal: {
      credentialPresent: readiness.portal.portal.credentialPresent,
      credentialSources: readiness.portal.portal.credentialSources,
      toolGatewayConfigured: readiness.portal.portal.toolGatewayConfigured,
      managedByNousCount,
      directFallbackCount,
    },
    providerCount: readiness.providers.length,
    configuredProviderCount: readiness.providers.filter((provider) => provider.configured).length,
    issues: readiness.issues,
    recommendations: readiness.recommendations,
  };
}
