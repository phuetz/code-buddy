import { loadCoreModule } from '../utils/core-loader';

export type HermesProtocolGatewayStatus = 'available' | 'partial' | 'missing';

export interface HermesProtocolGatewayCapability {
  commands: string[];
  endpoints: string[];
  evidence: string[];
  id: string;
  label: string;
  notes: string[];
  officialSurface: string;
  status: HermesProtocolGatewayStatus;
}

export interface HermesProtocolGatewayReadiness {
  capabilities: HermesProtocolGatewayCapability[];
  generatedAt: string;
  kind: 'hermes_protocol_gateway_readiness';
  officialSurface: string;
  ok: boolean;
  recommendations: string[];
  schemaVersion: 1;
  smokeCommand: string;
  summary: {
    availableCount: number;
    missingCount: number;
    partialCount: number;
    total: number;
  };
}

export interface HermesProtocolGatewaySmokeResult {
  durationMs: number;
  generatedAt: string;
  httpRoutes: {
    a2aAgentName?: string;
    acpSessionCount?: number;
    baseUrl?: string;
    error?: string;
    ok: boolean;
    routes: Array<{
      ok: boolean;
      path: string;
      status: number;
    }>;
  };
  kind: 'hermes_protocol_gateway_smoke';
  mcpStdio: {
    echoText?: string;
    error?: string;
    ok: boolean;
    serverName: string;
    toolCount: number;
    transport?: string;
  };
  ok: boolean;
  schemaVersion: 1;
}

interface HermesProtocolGatewaysModule {
  buildHermesProtocolGatewayReadiness: () => HermesProtocolGatewayReadiness;
  runHermesProtocolGatewaySmoke: () => Promise<HermesProtocolGatewaySmokeResult>;
}

export async function getHermesProtocolGatewaysForReview(): Promise<HermesProtocolGatewayReadiness | null> {
  const mod = await loadCoreModule<HermesProtocolGatewaysModule>('agent/hermes-protocol-gateways.js');
  if (!mod?.buildHermesProtocolGatewayReadiness) return null;

  const readiness = mod.buildHermesProtocolGatewayReadiness();
  return {
    capabilities: readiness.capabilities.map((capability) => ({
      commands: capability.commands,
      endpoints: capability.endpoints,
      evidence: capability.evidence,
      id: capability.id,
      label: capability.label,
      notes: capability.notes,
      officialSurface: capability.officialSurface,
      status: capability.status,
    })),
    generatedAt: readiness.generatedAt,
    kind: readiness.kind,
    officialSurface: readiness.officialSurface,
    ok: readiness.ok,
    recommendations: readiness.recommendations,
    schemaVersion: readiness.schemaVersion,
    smokeCommand: readiness.smokeCommand,
    summary: readiness.summary,
  };
}

export async function runHermesProtocolGatewaysSmokeForReview(): Promise<HermesProtocolGatewaySmokeResult> {
  const mod = await loadCoreModule<HermesProtocolGatewaysModule>('agent/hermes-protocol-gateways.js');
  if (!mod?.runHermesProtocolGatewaySmoke) {
    throw new Error('Core Hermes protocol gateway smoke module is unavailable.');
  }

  return mod.runHermesProtocolGatewaySmoke();
}
