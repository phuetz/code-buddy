/**
 * Politique par domaine. Elle ne peut que restreindre la configuration :
 * une clause plus ouverte est ignorée et signalée, jamais appliquée.
 * Les domaines suivent les overlays d'OpenClaw : canaux, MCP, bac à sable,
 * approbations d'exécution, et la passerelle (exposition et authentification).
 */

export const SANDBOX_RANK = { off: 0, 'non-main': 1, all: 2 } as const;
export const APPROVAL_RANK = { off: 0, ask: 1, always: 2 } as const;
export const GROUP_RANK = { open: 0, allowlist: 1 } as const;
export const DM_RANK = { open: 0, allowlist: 1, disabled: 2 } as const;
export const BIND_RANK = { lan: 0, loopback: 1 } as const;
export const AUTH_RANK = { none: 0, token: 1 } as const;

export type SandboxMode = keyof typeof SANDBOX_RANK;
export type ApprovalMode = keyof typeof APPROVAL_RANK;
export type GroupPolicy = keyof typeof GROUP_RANK;
export type DmPolicy = keyof typeof DM_RANK;
export type GatewayBind = keyof typeof BIND_RANK;
export type AuthMode = keyof typeof AUTH_RANK;
export type SandboxBackend = 'docker' | 'bwrap' | 'landlock' | 'seatbelt' | 'ssh';

const BACKENDS = new Set<SandboxBackend>(['docker', 'bwrap', 'landlock', 'seatbelt', 'ssh']);
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,32}$/;

export interface ChannelPosture {
  enabled: boolean;
  group_policy: GroupPolicy;
  dm_policy: DmPolicy;
}

export interface DomainPosture {
  gateway: { bind: GatewayBind; auth_mode: AuthMode };
  channels: Record<string, ChannelPosture>;
  mcp: { allow_write: boolean; enabled_servers: string[] };
  sandbox: { mode: SandboxMode; backend?: SandboxBackend };
  exec: { approvals: ApprovalMode; allow_commands: string[]; deny_commands: string[] };
}

export interface DomainPolicy {
  channels?: {
    enabled?: string[];
    group_policy?: GroupPolicy;
    dm_policy?: DmPolicy;
  };
  mcp?: {
    enabled_servers?: string[];
    allow_write?: boolean;
  };
  sandbox?: {
    mode?: SandboxMode;
    allowed_backends?: SandboxBackend[];
  };
  exec?: {
    approvals?: ApprovalMode;
    allow_commands?: string[];
    deny_commands?: string[];
  };
  gateway?: {
    bind?: GatewayBind;
    auth_mode?: AuthMode;
  };
}

export interface PolicyRepair {
  key: string;
  /** `null` retire la clé. Toute autre valeur est écrite telle quelle. */
  value: unknown;
}

export type PolicyFindingKind = 'config-exceeds-policy' | 'policy-widens' | 'policy-invalid';

export interface PolicyFinding {
  id: string;
  domain: 'channels' | 'mcp' | 'sandbox' | 'exec' | 'gateway';
  kind: PolicyFindingKind;
  message: string;
  repair?: PolicyRepair;
}

export interface DomainAssessment {
  effective: DomainPosture;
  findings: PolicyFinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function safeIds(values: readonly string[]): string[] {
  return uniqueSorted(values.filter((value) => ID_PATTERN.test(value)));
}

export function emptyPosture(): DomainPosture {
  return {
    gateway: { bind: 'loopback', auth_mode: 'token' },
    channels: {},
    mcp: { allow_write: true, enabled_servers: [] },
    sandbox: { mode: 'off' },
    exec: { approvals: 'ask', allow_commands: [], deny_commands: [] },
  };
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * La politique gagne seulement si elle est strictement plus fermée.
 * L'inversion de cette comparaison réouvrirait en silence : c'est le point
 * que le mutant retire.
 */
export function pickStricter<T extends string>(
  configValue: T,
  policyValue: T | undefined,
  rank: Record<T, number>,
): { value: T; relation: 'same' | 'tighter' | 'wider' } {
  if (policyValue === undefined) return { value: configValue, relation: 'same' };
  const policyWins = rank[policyValue] > rank[configValue];
  if (policyWins) return { value: policyValue, relation: 'tighter' };
  if (rank[policyValue] < rank[configValue]) return { value: configValue, relation: 'wider' };
  return { value: configValue, relation: 'same' };
}

function pushEnumFinding(
  findings: PolicyFinding[],
  input: {
    id: string;
    domain: PolicyFinding['domain'];
    relation: 'same' | 'tighter' | 'wider';
    configValue: string;
    policyValue: string | undefined;
    repairKey: string;
    label: string;
  },
): void {
  if (input.relation === 'same' || input.policyValue === undefined) return;
  if (input.relation === 'tighter') {
    findings.push({
      id: input.id,
      domain: input.domain,
      kind: 'config-exceeds-policy',
      message: `${input.label} : la configuration autorise « ${input.configValue} », la politique impose « ${input.policyValue} ».`,
      repair: { key: input.repairKey, value: input.policyValue },
    });
    return;
  }
  findings.push({
    id: input.id,
    domain: input.domain,
    kind: 'policy-widens',
    message: `${input.label} : la politique « ${input.policyValue} » élargirait « ${input.configValue} ». Clause ignorée.`,
  });
}

function ceiling(
  configItems: readonly string[],
  policyItems: readonly string[] | undefined,
): { kept: string[]; removed: string[]; refused: string[] } {
  const config = safeIds(configItems);
  if (!policyItems) return { kept: config, removed: [], refused: [] };
  const policy = safeIds(policyItems);
  const policySet = new Set(policy);
  const configSet = new Set(config);
  return {
    kept: config.filter((item) => policySet.has(item)),
    removed: config.filter((item) => !policySet.has(item)),
    refused: policy.filter((item) => !configSet.has(item)),
  };
}

export function postureFromDocument(document: Record<string, unknown> | null | undefined): DomainPosture {
  const posture = emptyPosture();
  if (!isRecord(document)) return posture;

  const gateway = isRecord(document.gateway) ? document.gateway : undefined;
  if (gateway) {
    const bind = asEnum(gateway.bind, ['loopback', 'lan'] as const);
    const auth = asEnum(gateway.auth_mode, ['token', 'none'] as const);
    if (bind) posture.gateway.bind = bind;
    if (auth) posture.gateway.auth_mode = auth;
  }

  const channels = isRecord(document.channels) ? document.channels : undefined;
  if (channels) {
    for (const id of Object.keys(channels)) {
      if (!ID_PATTERN.test(id) || !Object.hasOwn(channels, id)) continue;
      const raw = channels[id];
      if (!isRecord(raw)) continue;
      posture.channels[id] = {
        enabled: raw.enabled === true,
        group_policy: asEnum(raw.group_policy, ['open', 'allowlist'] as const) ?? 'open',
        dm_policy: asEnum(raw.dm_policy, ['open', 'allowlist', 'disabled'] as const) ?? 'open',
      };
    }
  }

  const mcp = isRecord(document.mcp) ? document.mcp : undefined;
  if (mcp) {
    const allowWrite = asBoolean(mcp.allow_write);
    if (allowWrite !== undefined) posture.mcp.allow_write = allowWrite;
    const servers = asStringList(mcp.enabled_servers);
    if (servers) posture.mcp.enabled_servers = safeIds(servers);
  }

  const sandbox = isRecord(document.sandbox) ? document.sandbox : undefined;
  if (sandbox) {
    const mode = asEnum(sandbox.mode, ['off', 'non-main', 'all'] as const);
    const backend = asEnum(sandbox.backend, [...BACKENDS] as SandboxBackend[]);
    if (mode) posture.sandbox.mode = mode;
    if (backend) posture.sandbox.backend = backend;
  }

  const exec = isRecord(document.exec) ? document.exec : undefined;
  if (exec) {
    const approvals = asEnum(exec.approvals, ['off', 'ask', 'always'] as const);
    if (approvals) posture.exec.approvals = approvals;
    const allow = asStringList(exec.allow_commands);
    const deny = asStringList(exec.deny_commands);
    if (allow) posture.exec.allow_commands = uniqueSorted(allow.filter((item) => item.length > 0 && item.length <= 80));
    if (deny) posture.exec.deny_commands = uniqueSorted(deny.filter((item) => item.length > 0 && item.length <= 80));
  }

  return posture;
}

function invalid(findings: PolicyFinding[], domain: PolicyFinding['domain'], id: string, message: string): void {
  findings.push({ id, domain, kind: 'policy-invalid', message });
}

export function parseDomainPolicy(raw: unknown): { policy: DomainPolicy | null; findings: PolicyFinding[] } {
  if (raw === undefined || raw === null) return { policy: null, findings: [] };
  const findings: PolicyFinding[] = [];
  if (!isRecord(raw)) {
    invalid(findings, 'gateway', 'domains.invalid', 'La politique de domaine n\'est pas un objet. Elle est ignorée.');
    return { policy: null, findings };
  }

  const policy: DomainPolicy = {};
  for (const key of Object.keys(raw)) {
    if (!['channels', 'mcp', 'sandbox', 'exec', 'gateway'].includes(key)) {
      invalid(findings, 'gateway', `domains.unknown.${key}`, `Domaine « ${key} » inconnu. Il est ignoré.`);
    }
  }

  const channels = raw.channels;
  if (channels !== undefined) {
    if (!isRecord(channels)) {
      invalid(findings, 'channels', 'channels.invalid', 'La politique des canaux n\'est pas un objet. Elle est ignorée.');
    } else {
      const enabled = asStringList(channels.enabled);
      const group = asEnum(channels.group_policy, ['open', 'allowlist'] as const);
      const dm = asEnum(channels.dm_policy, ['open', 'allowlist', 'disabled'] as const);
      if (channels.enabled !== undefined && !enabled) {
        invalid(findings, 'channels', 'channels.enabled.invalid', 'channels.enabled doit être une liste de noms. Clause ignorée.');
      }
      if (channels.group_policy !== undefined && !group) {
        invalid(findings, 'channels', 'channels.group_policy.invalid', 'channels.group_policy n\'est pas une valeur connue. Clause ignorée.');
      }
      if (channels.dm_policy !== undefined && !dm) {
        invalid(findings, 'channels', 'channels.dm_policy.invalid', 'channels.dm_policy n\'est pas une valeur connue. Clause ignorée.');
      }
      policy.channels = {
        ...(enabled ? { enabled: safeIds(enabled) } : {}),
        ...(group ? { group_policy: group } : {}),
        ...(dm ? { dm_policy: dm } : {}),
      };
    }
  }

  const mcp = raw.mcp;
  if (mcp !== undefined) {
    if (!isRecord(mcp)) {
      invalid(findings, 'mcp', 'mcp.invalid', 'La politique MCP n\'est pas un objet. Elle est ignorée.');
    } else {
      const servers = asStringList(mcp.enabled_servers);
      const allowWrite = asBoolean(mcp.allow_write);
      if (mcp.enabled_servers !== undefined && !servers) {
        invalid(findings, 'mcp', 'mcp.enabled_servers.invalid', 'mcp.enabled_servers doit être une liste de noms. Clause ignorée.');
      }
      if (mcp.allow_write !== undefined && allowWrite === undefined) {
        invalid(findings, 'mcp', 'mcp.allow_write.invalid', 'mcp.allow_write doit être un booléen. Clause ignorée.');
      }
      policy.mcp = {
        ...(servers ? { enabled_servers: safeIds(servers) } : {}),
        ...(allowWrite !== undefined ? { allow_write: allowWrite } : {}),
      };
    }
  }

  const sandbox = raw.sandbox;
  if (sandbox !== undefined) {
    if (!isRecord(sandbox)) {
      invalid(findings, 'sandbox', 'sandbox.invalid', 'La politique du bac à sable n\'est pas un objet. Elle est ignorée.');
    } else {
      const mode = asEnum(sandbox.mode, ['off', 'non-main', 'all'] as const);
      const backends = asStringList(sandbox.allowed_backends);
      if (sandbox.mode !== undefined && !mode) {
        invalid(findings, 'sandbox', 'sandbox.mode.invalid', 'sandbox.mode n\'est pas une valeur connue. Clause ignorée.');
      }
      if (sandbox.allowed_backends !== undefined && !backends) {
        invalid(findings, 'sandbox', 'sandbox.allowed_backends.invalid', 'sandbox.allowed_backends doit être une liste. Clause ignorée.');
      }
      const allowed = backends
        ? uniqueSorted(backends.filter((item): item is SandboxBackend => BACKENDS.has(item as SandboxBackend)))
        : undefined;
      if (backends?.some((item) => !BACKENDS.has(item as SandboxBackend))) {
        invalid(findings, 'sandbox', 'sandbox.allowed_backends.unknown', 'Un moteur de bac à sable inconnu a été retiré de la politique.');
      }
      policy.sandbox = {
        ...(mode ? { mode } : {}),
        ...(allowed ? { allowed_backends: allowed as SandboxBackend[] } : {}),
      };
    }
  }

  const exec = raw.exec;
  if (exec !== undefined) {
    if (!isRecord(exec)) {
      invalid(findings, 'exec', 'exec.invalid', 'La politique d\'approbation n\'est pas un objet. Elle est ignorée.');
    } else {
      const approvals = asEnum(exec.approvals, ['off', 'ask', 'always'] as const);
      const allow = asStringList(exec.allow_commands);
      const deny = asStringList(exec.deny_commands);
      if (exec.approvals !== undefined && !approvals) {
        invalid(findings, 'exec', 'exec.approvals.invalid', 'exec.approvals n\'est pas une valeur connue. Clause ignorée.');
      }
      policy.exec = {
        ...(approvals ? { approvals } : {}),
        ...(allow ? { allow_commands: uniqueSorted(allow) } : {}),
        ...(deny ? { deny_commands: uniqueSorted(deny) } : {}),
      };
    }
  }

  const gateway = raw.gateway;
  if (gateway !== undefined) {
    if (!isRecord(gateway)) {
      invalid(findings, 'gateway', 'gateway.invalid', 'La politique de passerelle n\'est pas un objet. Elle est ignorée.');
    } else {
      const bind = asEnum(gateway.bind, ['loopback', 'lan'] as const);
      const auth = asEnum(gateway.auth_mode, ['token', 'none'] as const);
      if (gateway.bind !== undefined && !bind) {
        invalid(findings, 'gateway', 'gateway.bind.invalid', 'gateway.bind n\'est pas une valeur connue. Clause ignorée.');
      }
      if (gateway.auth_mode !== undefined && !auth) {
        invalid(findings, 'gateway', 'gateway.auth_mode.invalid', 'gateway.auth_mode n\'est pas une valeur connue. Clause ignorée.');
      }
      policy.gateway = {
        ...(bind ? { bind } : {}),
        ...(auth ? { auth_mode: auth } : {}),
      };
    }
  }

  return { policy, findings };
}

export function domainPolicyFromManagedFile(parsed: unknown): { policy: DomainPolicy | null; findings: PolicyFinding[] } {
  if (!isRecord(parsed) || !Object.hasOwn(parsed, 'domains')) return { policy: null, findings: [] };
  return parseDomainPolicy(parsed.domains);
}

function clonePosture(posture: DomainPosture): DomainPosture {
  const sandbox: DomainPosture['sandbox'] = { mode: posture.sandbox.mode };
  if (posture.sandbox.backend) sandbox.backend = posture.sandbox.backend;
  return {
    gateway: { ...posture.gateway },
    channels: Object.fromEntries(Object.entries(posture.channels).map(([id, value]) => [id, { ...value }])),
    mcp: { allow_write: posture.mcp.allow_write, enabled_servers: [...posture.mcp.enabled_servers] },
    sandbox,
    exec: {
      approvals: posture.exec.approvals,
      allow_commands: [...posture.exec.allow_commands],
      deny_commands: [...posture.exec.deny_commands],
    },
  };
}

function listFindings(
  findings: PolicyFinding[],
  domain: PolicyFinding['domain'],
  prefix: string,
  label: string,
  removed: readonly string[],
  refused: readonly string[],
  repairKey: string,
  kept: readonly string[],
): void {
  if (removed.length > 0) {
    findings.push({
      id: `${prefix}.exceeds`,
      domain,
      kind: 'config-exceeds-policy',
      message: `${label} : la configuration autorise ${removed.join(', ')}. La politique retire ces entrées.`,
      repair: { key: repairKey, value: [...kept] },
    });
  }
  for (const item of refused) {
    findings.push({
      id: `${prefix}.widens.${item}`,
      domain,
      kind: 'policy-widens',
      message: `${label} : la politique citerait « ${item} », que la configuration n'autorise pas. Clause ignorée.`,
    });
  }
}

export function applyDomainPolicy(posture: DomainPosture, policy: DomainPolicy | null | undefined): DomainAssessment {
  const effective = clonePosture(posture);
  const findings: PolicyFinding[] = [];
  if (!policy) return { effective, findings };

  const gatewayBind = pickStricter(posture.gateway.bind, policy.gateway?.bind, BIND_RANK);
  effective.gateway.bind = gatewayBind.value;
  pushEnumFinding(findings, {
    id: 'gateway.bind',
    domain: 'gateway',
    relation: gatewayBind.relation,
    configValue: posture.gateway.bind,
    policyValue: policy.gateway?.bind,
    repairKey: 'gateway.bind',
    label: 'Passerelle',
  });
  const gatewayAuth = pickStricter(posture.gateway.auth_mode, policy.gateway?.auth_mode, AUTH_RANK);
  effective.gateway.auth_mode = gatewayAuth.value;
  pushEnumFinding(findings, {
    id: 'gateway.auth_mode',
    domain: 'gateway',
    relation: gatewayAuth.relation,
    configValue: posture.gateway.auth_mode,
    policyValue: policy.gateway?.auth_mode,
    repairKey: 'gateway.auth_mode',
    label: 'Authentification de la passerelle',
  });

  for (const id of Object.keys(posture.channels).sort()) {
    if (!ID_PATTERN.test(id)) continue;
    const current = posture.channels[id];
    if (!current) continue;
    const next: ChannelPosture = { ...current };
    if (policy.channels?.enabled) {
      const allowed = new Set(safeIds(policy.channels.enabled));
      if (current.enabled && !allowed.has(id)) {
        next.enabled = false;
        findings.push({
          id: `channels.${id}.enabled.exceeds`,
          domain: 'channels',
          kind: 'config-exceeds-policy',
          message: `Canal « ${id} » activé alors que la politique ne l'autorise pas.`,
          repair: { key: `channels.${id}.enabled`, value: false },
        });
      }
    }
    const group = pickStricter(current.group_policy, policy.channels?.group_policy, GROUP_RANK);
    next.group_policy = group.value;
    pushEnumFinding(findings, {
      id: `channels.${id}.group_policy`,
      domain: 'channels',
      relation: group.relation,
      configValue: current.group_policy,
      policyValue: policy.channels?.group_policy,
      repairKey: `channels.${id}.group_policy`,
      label: `Groupes du canal ${id}`,
    });
    const dm = pickStricter(current.dm_policy, policy.channels?.dm_policy, DM_RANK);
    next.dm_policy = dm.value;
    pushEnumFinding(findings, {
      id: `channels.${id}.dm_policy`,
      domain: 'channels',
      relation: dm.relation,
      configValue: current.dm_policy,
      policyValue: policy.channels?.dm_policy,
      repairKey: `channels.${id}.dm_policy`,
      label: `Messages privés du canal ${id}`,
    });
    effective.channels[id] = next;
  }
  if (policy.channels?.enabled) {
    for (const id of safeIds(policy.channels.enabled)) {
      if (posture.channels[id]?.enabled === true) continue;
      findings.push({
        id: `channels.${id}.enabled.widens`,
        domain: 'channels',
        kind: 'policy-widens',
        message: `La politique citerait le canal « ${id} », que la configuration n'active pas. Clause ignorée.`,
      });
    }
  }

  if (policy.mcp?.allow_write === false && posture.mcp.allow_write) {
    effective.mcp.allow_write = false;
    findings.push({
      id: 'mcp.allow_write.exceeds',
      domain: 'mcp',
      kind: 'config-exceeds-policy',
      message: 'La configuration autorise l\'écriture MCP. La politique la retire.',
      repair: { key: 'mcp.allow_write', value: false },
    });
  } else if (policy.mcp?.allow_write === true && !posture.mcp.allow_write) {
    findings.push({
      id: 'mcp.allow_write.widens',
      domain: 'mcp',
      kind: 'policy-widens',
      message: 'La politique autoriserait l\'écriture MCP déjà refusée. Clause ignorée.',
    });
  }

  const servers = ceiling(posture.mcp.enabled_servers, policy.mcp?.enabled_servers);
  effective.mcp.enabled_servers = servers.kept;
  listFindings(
    findings,
    'mcp',
    'mcp.enabled_servers',
    'Serveurs MCP',
    servers.removed,
    servers.refused,
    'mcp.enabled_servers',
    servers.kept,
  );

  const mode = pickStricter(posture.sandbox.mode, policy.sandbox?.mode, SANDBOX_RANK);
  effective.sandbox.mode = mode.value;
  pushEnumFinding(findings, {
    id: 'sandbox.mode',
    domain: 'sandbox',
    relation: mode.relation,
    configValue: posture.sandbox.mode,
    policyValue: policy.sandbox?.mode,
    repairKey: 'sandbox.mode',
    label: 'Bac à sable',
  });

  if (policy.sandbox?.allowed_backends && posture.sandbox.backend) {
    const allowed = new Set(policy.sandbox.allowed_backends);
    if (!allowed.has(posture.sandbox.backend)) {
      delete effective.sandbox.backend;
      findings.push({
        id: 'sandbox.backend.exceeds',
        domain: 'sandbox',
        kind: 'config-exceeds-policy',
        message: `Le moteur « ${posture.sandbox.backend} » n'est pas dans la liste de la politique. Il est retiré, sans en choisir un autre.`,
        repair: { key: 'sandbox.backend', value: null },
      });
    }
  }

  const approvals = pickStricter(posture.exec.approvals, policy.exec?.approvals, APPROVAL_RANK);
  effective.exec.approvals = approvals.value;
  pushEnumFinding(findings, {
    id: 'exec.approvals',
    domain: 'exec',
    relation: approvals.relation,
    configValue: posture.exec.approvals,
    policyValue: policy.exec?.approvals,
    repairKey: 'exec.approvals',
    label: 'Approbations d\'exécution',
  });

  const denyUnion = uniqueSorted([
    ...posture.exec.deny_commands,
    ...(policy.exec?.deny_commands ?? []),
  ]);
  const addedDenies = denyUnion.filter((item) => !posture.exec.deny_commands.includes(item));
  effective.exec.deny_commands = denyUnion;
  if (addedDenies.length > 0) {
    findings.push({
      id: 'exec.deny_commands.exceeds',
      domain: 'exec',
      kind: 'config-exceeds-policy',
      message: `La politique ajoute des refus d'exécution : ${addedDenies.join(', ')}.`,
      repair: { key: 'exec.deny_commands', value: denyUnion },
    });
  }

  const allow = ceiling(posture.exec.allow_commands, policy.exec?.allow_commands);
  const denied = new Set(denyUnion);
  const keptAllow = allow.kept.filter((item) => !denied.has(item));
  const removedAllow = uniqueSorted([
    ...allow.removed,
    ...allow.kept.filter((item) => denied.has(item)),
  ]);
  effective.exec.allow_commands = keptAllow;
  listFindings(
    findings,
    'exec',
    'exec.allow_commands',
    'Commandes pré-autorisées',
    removedAllow,
    allow.refused,
    'exec.allow_commands',
    keptAllow,
  );

  findings.sort((left, right) => left.id.localeCompare(right.id));
  return { effective, findings };
}

export function commandMatchesDeny(command: string, denies: readonly unknown[]): boolean {
  return denies.some((denied) => typeof denied === 'string' && denied.length > 0 && command.includes(denied));
}
