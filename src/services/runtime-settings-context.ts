import { getThemeManager } from '../themes/theme-manager.js';
import { getFleetRegistry } from '../fleet/fleet-registry.js';
import { getPermissionModeManager } from '../security/permission-modes.js';
import { CODE_EXEC_OFF_NOTICE, CODE_EXEC_PREFER_HINT, resolveCodeExecPolicy } from '../config/code-exec-policy.js';

export interface RuntimeSettingsEvidence {
  surface?: string;
  model?: string;
  provider?: string;
  maxToolRounds?: number;
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value) ? value : undefined;
}

/** P5: effective code_exec policy and its short model-facing guidance. */
function programmaticToolCallingSnapshot(model: string | undefined) {
  const resolved = resolveCodeExecPolicy(identifier(model));
  return {
    tool: 'code_exec',
    policy: resolved.policy,
    source: resolved.source,
    ...(resolved.policy === 'prefer' ? { guidance: CODE_EXEC_PREFER_HINT } : {}),
    ...(resolved.policy === 'off' ? { guidance: CODE_EXEC_OFF_NOTICE } : {}),
  };
}

/** Explicit allowlist: never serialize configuration objects, env, endpoints or credentials. */
export function getRuntimeSettingsSnapshot(evidence: RuntimeSettingsEvidence = {}) {
  const cli = evidence.surface === 'cli';
  const manager = cli ? getThemeManager() : undefined;
  return {
    surface: identifier(evidence.surface) ?? 'unknown',
    model: identifier(evidence.model) ?? 'unknown',
    provider: identifier(evidence.provider) ?? 'unknown',
    ...(Number.isSafeInteger(evidence.maxToolRounds) && evidence.maxToolRounds! > 0
      ? { maxToolRounds: evidence.maxToolRounds } : {}),
    programmaticToolCalling: programmaticToolCallingSnapshot(evidence.model),
    ...(cli ? { permissionMode: getPermissionModeManager().getMode() } : {}),
    ...(manager ? {
      theme: {
        active: identifier(manager.getCurrentTheme().id) ?? 'custom',
        available: manager.getAvailableThemes().map(theme => identifier(theme.id)).filter(Boolean),
        customOverrides: manager.getOverrideKeys(),
        lastPreferenceSave: manager.getPreferenceSaveStatus(),
        changeCommand: '/theme <id>',
        statusCommand: '/theme status',
      },
    } : { theme: null }),
    ...(cli ? { fleet: {
      supported: true,
      configuredConnections: getFleetRegistry().list().length,
      statusTool: 'list_peers',
      statusArguments: { includeCapabilities: true },
      delegationTool: 'peer_delegate',
      routingTool: 'route_peer',
      connectionCommand: '/fleet listen <ws-url> --name <id>',
      scope: 'Configured connections only; an empty registry does not prove no other Buddy is running on the network. Do not claim local-only capability. Probe list_peers before asserting availability.',
    } } : {}),
    guidance: 'Live settings at observation time. Unknown values are not inferred from saved preferences. A null theme means no CLI theme is attested for this surface. Theme changes require /theme <id>; editing a config file alone does not apply a live change.',
  };
}

export function formatRuntimeSettingsContext(evidence: RuntimeSettingsEvidence): string {
  return '<runtime_settings ephemeral="true">\n' +
    JSON.stringify(getRuntimeSettingsSnapshot(evidence)) + '\n</runtime_settings>';
}

/** Ensure operational questions can reach the existing tools even with RAG selection. */
export function runtimeInspectionTools(query: string): string[] {
  const text = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(fleet|flotte|peers?|autres? (?:code[ -]?)?budd(?:y|ies)|other (?:code[ -]?)?budd(?:y|ies)|instances? (?:actives?|buddy)|buddy.*ensemble)\b/.test(text)) {
    return ['list_peers', 'route_peer', 'peer_delegate'];
  }
  if (/\b(theme|parametres?|parametrage|settings|configuration actuelle|current configuration)\b/.test(text)) {
    return ['self_describe'];
  }
  return [];
}
