import {
  buildMobileSupervisionSnapshot,
  MOBILE_SUPERVISION_ALLOWED_ACTIONS,
  MOBILE_SUPERVISION_BLOCKED_ACTIONS,
  evaluateMobileSupervisionAction,
  type BuildMobileSupervisionSnapshotOptions,
  type MobileSupervisionActionDecision,
  type MobileSupervisionAllowedAction,
  type MobileSupervisionBlockedAction,
  type MobileSupervisionSnapshot,
} from './mobile-supervision-snapshot.js';

export const MOBILE_SUPERVISION_GATEWAY_CONTRACT_SCHEMA_VERSION = 1;

export type MobileSupervisionGatewayMethod = 'GET' | 'POST';
export type MobileSupervisionGatewaySideEffect = 'none' | 'draft_only';

export interface BuildMobileSupervisionGatewayContractOptions extends BuildMobileSupervisionSnapshotOptions {
  basePath?: string;
  includeSnapshot?: boolean;
}

export interface MobileSupervisionGatewayAuth {
  required: true;
  scheme: 'bearer_or_pairing_code';
  scopes: string[];
  ttlSeconds: number;
}

export interface MobileSupervisionGatewayEndpoint {
  action: MobileSupervisionAllowedAction;
  auth: MobileSupervisionGatewayAuth;
  description: string;
  id: string;
  localApprovalRequired: boolean;
  method: MobileSupervisionGatewayMethod;
  path: string;
  policy: MobileSupervisionActionDecision;
  sideEffects: MobileSupervisionGatewaySideEffect;
}

export interface MobileSupervisionGatewayBlockedOperation {
  action: MobileSupervisionBlockedAction;
  policy: MobileSupervisionActionDecision;
}

export interface MobileSupervisionGatewayContract {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'contract_only';
  basePath: string;
  query: string;
  auth: MobileSupervisionGatewayAuth;
  transport: {
    exposure: 'local_first';
    offDeviceTlsRequired: true;
    remoteExecution: 'disabled';
  };
  endpoints: MobileSupervisionGatewayEndpoint[];
  blockedOperations: MobileSupervisionGatewayBlockedOperation[];
  snapshot?: MobileSupervisionSnapshot;
}

export async function buildMobileSupervisionGatewayContract(
  query: string,
  options: BuildMobileSupervisionGatewayContractOptions = {},
): Promise<MobileSupervisionGatewayContract> {
  // A contract-only preview must not query run/session databases. Besides
  // unnecessary I/O, loading a host-native SQLite store in Electron can abort
  // the process before a rejected promise can be caught by the IPC bridge.
  const snapshot = options.includeSnapshot === false
    ? undefined
    : await buildMobileSupervisionSnapshot(query, options);
  const policy: Pick<MobileSupervisionSnapshot, 'allowedActions' | 'blockedActions' | 'safety'> = snapshot ?? {
    allowedActions: [...MOBILE_SUPERVISION_ALLOWED_ACTIONS],
    blockedActions: [...MOBILE_SUPERVISION_BLOCKED_ACTIONS],
    safety: {
      autoDispatch: false, localApprovalRequired: true, outreachDisabled: true,
      remoteExecutionDisabled: true, redaction: 'secrets-redacted',
    },
  };
  const basePath = normalizeBasePath(options.basePath);
  const auth = buildGatewayAuth();
  const endpoints = buildGatewayEndpoints(policy, basePath, auth);

  return {
    schemaVersion: MOBILE_SUPERVISION_GATEWAY_CONTRACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'contract_only',
    basePath,
    query: snapshot?.query ?? query.trim(),
    auth,
    transport: {
      exposure: 'local_first',
      offDeviceTlsRequired: true,
      remoteExecution: 'disabled',
    },
    endpoints,
    blockedOperations: policy.blockedActions.map(action => ({
      action,
      policy: evaluateMobileSupervisionAction(policy, action),
    })),
    snapshot,
  };
}

export function renderMobileSupervisionGatewayContract(
  contract: MobileSupervisionGatewayContract,
): string {
  const lines: string[] = [
    'Mobile supervision gateway contract',
    `Mode: ${contract.mode}`,
    `Base path: ${contract.basePath}`,
    `Query: ${contract.query || '(empty)'}`,
    `Transport: ${contract.transport.exposure}, remote execution ${contract.transport.remoteExecution}, TLS required off-device`,
    `Auth: ${contract.auth.scheme}, scopes=${contract.auth.scopes.join(', ')}, ttl=${contract.auth.ttlSeconds}s`,
    '',
    'Endpoints:',
  ];

  for (const endpoint of contract.endpoints) {
    lines.push(`- ${endpoint.method} ${endpoint.path} -> ${endpoint.action}`);
    lines.push(`  ${endpoint.description}`);
    lines.push(`  sideEffects=${endpoint.sideEffects}; localApprovalRequired=${endpoint.localApprovalRequired}`);
  }

  lines.push('', 'Blocked operations:');
  for (const operation of contract.blockedOperations) {
    lines.push(`- ${operation.action}: ${operation.policy.reason}`);
  }

  return lines.join('\n');
}

function buildGatewayAuth(): MobileSupervisionGatewayAuth {
  return {
    required: true,
    scheme: 'bearer_or_pairing_code',
    scopes: ['mobile:read', 'mobile:draft'],
    ttlSeconds: 900,
  };
}

function buildGatewayEndpoints(
  snapshot: Pick<MobileSupervisionSnapshot, 'allowedActions' | 'blockedActions' | 'safety'>,
  basePath: string,
  auth: MobileSupervisionGatewayAuth,
): MobileSupervisionGatewayEndpoint[] {
  return [
    {
      action: 'view_run_summary',
      auth,
      description: 'Return the redacted review-only run snapshot for the current query.',
      id: 'mobile.snapshot.read',
      localApprovalRequired: false,
      method: 'GET',
      path: `${basePath}/snapshot`,
      policy: evaluateMobileSupervisionAction(snapshot, 'view_run_summary'),
      sideEffects: 'none',
    },
    {
      action: 'open_artifact',
      auth,
      description: 'Return metadata or a local deep-link for an artifact path already present in the snapshot.',
      id: 'mobile.artifact.open',
      localApprovalRequired: false,
      method: 'GET',
      path: `${basePath}/runs/:runId/artifacts/:artifactPath`,
      policy: evaluateMobileSupervisionAction(snapshot, 'open_artifact'),
      sideEffects: 'none',
    },
    {
      action: 'copy_recall_pack',
      auth,
      description: 'Return the redacted recall-pack prompt context for copy/share by the operator.',
      id: 'mobile.recall.copy',
      localApprovalRequired: false,
      method: 'GET',
      path: `${basePath}/recall-pack`,
      policy: evaluateMobileSupervisionAction(snapshot, 'copy_recall_pack'),
      sideEffects: 'none',
    },
    {
      action: 'draft_followup_prompt',
      auth,
      description: 'Create a draft prompt only; it must not dispatch, execute tools, mutate files, or send messages.',
      id: 'mobile.followup.draft',
      localApprovalRequired: true,
      method: 'POST',
      path: `${basePath}/followup-draft`,
      policy: evaluateMobileSupervisionAction(snapshot, 'draft_followup_prompt'),
      sideEffects: 'draft_only',
    },
  ];
}

function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = basePath?.trim() || '/api/mobile';
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+$/g, '');
}
