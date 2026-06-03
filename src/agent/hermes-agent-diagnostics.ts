/**
 * Diagnostics for the native Hermes-inspired Code Buddy profile.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ToolFilterConfig } from '../utils/tool-filter.js';
import { getModelToolConfig } from '../config/model-tools.js';
import { MODEL_DEFAULTS, type ProviderKey } from '../config/model-defaults.js';
import { inferProvider } from '../config/resolve-model.js';
import { getSettingsManager } from '../utils/settings-manager.js';
import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  buildHermesToolsetDescriptor,
  normalizeDispatchProfile,
  type FleetDispatchProfile,
  type FleetDispatchProfileGuidance,
  type FleetHermesToolsetDescriptor,
} from '../fleet/dispatch-profile.js';
import {
  CustomAgentLoader,
  type CustomAgentConfig,
  type CustomAgentFile,
} from './custom/custom-agent-loader.js';
import { buildCustomAgentToolFilter } from './custom/custom-agent-tool-filter.js';
import { buildHermesAgentProfile } from './hermes-agent-profile.js';
import {
  buildHermesPortalStatus,
  type HermesPortalStatus,
} from './hermes-portal-status.js';
import {
  buildHermesRuntimeBackendsReadiness,
  type HermesRuntimeBackendsReadiness,
} from './hermes-runtime-backends.js';
import {
  buildHermesBrowserBackendsReadiness,
  type HermesBrowserBackendsReadiness,
} from './hermes-browser-backends.js';

export interface HermesPromptChecks {
  mentionsCodeBuddyRuntime: boolean;
  mentionsExternalRuntimeBoundary: boolean;
  mentionsDefaultToolset: boolean;
}

export interface HermesProviderStatus {
  provider: ProviderKey | 'unknown';
  label: string;
  configured: boolean;
  local: boolean;
  credentialSources: string[];
  modelEnv: string[];
  baseUrlEnv: string[];
  baseUrl: string | null;
  notes: string[];
  remediation: string[];
}

export interface HermesProviderReadiness {
  ok: boolean;
  activeModel: {
    model: string;
    provider: ProviderKey | 'unknown';
    source: string;
    matchedConfigPattern: string;
    contextWindow: number | null;
    maxOutputTokens: number | null;
    supportsToolCalls: boolean;
    supportsReasoning: boolean;
    supportsVision: boolean;
    patchFormat: string | null;
    promptProfile: string | null;
  };
  activeProvider: HermesProviderStatus;
  providers: HermesProviderStatus[];
  portal: HermesPortalStatus;
  issues: string[];
  recommendations: string[];
}

export interface HermesAgentDiagnostics {
  id: 'hermes';
  ok: boolean;
  dispatchProfile: FleetDispatchProfile;
  source: 'built-in' | 'user' | 'missing';
  userOverride: boolean;
  agentFound: boolean;
  agentPath: string | null;
  agentName: string | null;
  agentDescription: string | null;
  enabledTools: string[];
  disabledTools: string[];
  fleetDispatchProfile: FleetDispatchProfile | null;
  requireExplicitDispatchProfile: boolean;
  effectiveToolFilter: ToolFilterConfig;
  activeToolset: FleetHermesToolsetDescriptor;
  dispatchProfileGuidance: FleetDispatchProfileGuidance[];
  nativeSurfaceIds: string[];
  promptChecks: HermesPromptChecks;
  providerReadiness: HermesProviderReadiness;
  runtimeBackends: HermesRuntimeBackendsReadiness;
  browserBackends: HermesBrowserBackendsReadiness;
  issues: string[];
  recommendations: string[];
}

export interface HermesAgentDiagnosticsOptions {
  availableTools?: readonly string[];
  dispatchProfile?: FleetDispatchProfile | string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  loader?: CustomAgentLoader;
  model?: string;
  now?: () => Date;
  settingsModel?: string | null;
}

const EMPTY_FILTER: ToolFilterConfig = {
  enabledPatterns: [],
  disabledPatterns: [],
};

interface ProviderDefinition {
  provider: ProviderKey;
  label: string;
  credentialEnv: string[];
  modelEnv: string[];
  baseUrlEnv: string[];
  defaultBaseUrl?: string;
  local?: boolean;
  notes?: string[];
  remediation?: string[];
}

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    provider: 'xai',
    label: 'xAI / Grok',
    credentialEnv: ['GROK_API_KEY', 'XAI_API_KEY'],
    modelEnv: ['GROK_MODEL'],
    baseUrlEnv: ['GROK_BASE_URL'],
    remediation: ['Set GROK_API_KEY or XAI_API_KEY, or choose a configured provider/model.'],
  },
  {
    provider: 'openai',
    label: 'OpenAI / Codex-compatible',
    credentialEnv: ['OPENAI_API_KEY', 'CODEBUDDY_OPENAI_API_KEY', 'CHATGPT_ACCESS_TOKEN', 'CODEBUDDY_CHATGPT_ACCESS_TOKEN'],
    modelEnv: ['OPENAI_MODEL'],
    baseUrlEnv: ['OPENAI_BASE_URL', 'CODEBUDDY_OPENAI_BASE_URL'],
    remediation: ['Run buddy login for ChatGPT-backed routes or set OPENAI_API_KEY for API-backed routes.'],
  },
  {
    provider: 'anthropic',
    label: 'Anthropic / Claude',
    credentialEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    modelEnv: ['ANTHROPIC_MODEL', 'CLAUDE_MODEL'],
    baseUrlEnv: ['ANTHROPIC_BASE_URL'],
    remediation: ['Set ANTHROPIC_API_KEY or switch to another configured model.'],
  },
  {
    provider: 'google',
    label: 'Google / Gemini',
    credentialEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    modelEnv: ['GEMINI_MODEL'],
    baseUrlEnv: ['GEMINI_BASE_URL', 'GOOGLE_GENERATIVE_AI_BASE_URL'],
    remediation: ['Set GEMINI_API_KEY or switch to another configured model.'],
  },
  {
    provider: 'ollama',
    label: 'Ollama local',
    credentialEnv: [],
    modelEnv: ['OLLAMA_MODEL'],
    baseUrlEnv: ['OLLAMA_HOST'],
    defaultBaseUrl: 'http://localhost:11434',
    local: true,
    notes: ['Local provider; readiness means the endpoint is configured, not that a model pull was tested.'],
    remediation: ['Start Ollama and pull the selected model if local inference fails.'],
  },
  {
    provider: 'lmstudio',
    label: 'LM Studio local',
    credentialEnv: [],
    modelEnv: ['LMSTUDIO_MODEL', 'LM_STUDIO_MODEL'],
    baseUrlEnv: ['LMSTUDIO_BASE_URL', 'LM_STUDIO_BASE_URL', 'CODEBUDDY_LMSTUDIO_BASE_URL'],
    defaultBaseUrl: 'http://localhost:1234/v1',
    local: true,
    notes: ['Local OpenAI-compatible provider; readiness does not start LM Studio.'],
    remediation: ['Start the LM Studio local server if model calls fail.'],
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    credentialEnv: ['DEEPSEEK_API_KEY'],
    modelEnv: ['DEEPSEEK_MODEL'],
    baseUrlEnv: ['DEEPSEEK_BASE_URL'],
    remediation: ['Set DEEPSEEK_API_KEY or switch to another configured model.'],
  },
  {
    provider: 'mistral',
    label: 'Mistral / Devstral',
    credentialEnv: ['MISTRAL_API_KEY'],
    modelEnv: ['MISTRAL_MODEL'],
    baseUrlEnv: ['MISTRAL_BASE_URL'],
    remediation: ['Set MISTRAL_API_KEY or switch to another configured model.'],
  },
];

function getHermesAgentFile(loader: CustomAgentLoader): CustomAgentFile | undefined {
  return loader.loadAgents().find((agent) => agent.config.id === 'hermes');
}

function envValue(env: NodeJS.ProcessEnv, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function presentEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(env[key]?.trim()));
}

function hasTokenLikeJsonFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      tokens?: { access_token?: string };
      access_token?: string;
    };
    return Boolean(parsed.tokens?.access_token?.trim() || parsed.access_token?.trim());
  } catch {
    return false;
  }
}

function defaultHomeCredentialSource(fileName: string): string {
  return `~/.codebuddy/${fileName}`;
}

function normalizeProviderHint(value: string | null): ProviderKey | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'grok' || normalized === 'xai') return 'xai';
  if (normalized === 'openai' || normalized === 'codex' || normalized === 'chatgpt') return 'openai';
  if (normalized === 'anthropic' || normalized === 'claude') return 'anthropic';
  if (normalized === 'google' || normalized === 'gemini') return 'google';
  if (normalized === 'ollama') return 'ollama';
  if (normalized === 'lmstudio' || normalized === 'lm-studio' || normalized === 'lm_studio') return 'lmstudio';
  if (normalized === 'deepseek') return 'deepseek';
  if (normalized === 'mistral' || normalized === 'devstral') return 'mistral';
  return null;
}

function resolveSettingsModel(options: HermesAgentDiagnosticsOptions): { model: string | null; source: string } {
  if (options.settingsModel !== undefined) {
    return {
      model: options.settingsModel,
      source: options.settingsModel ? 'settingsModel option' : 'settingsModel option empty',
    };
  }

  try {
    return {
      model: getSettingsManager().getCurrentModel(),
      source: 'settings manager',
    };
  } catch {
    return {
      model: null,
      source: 'settings manager unavailable',
    };
  }
}

function resolveHermesModel(
  env: NodeJS.ProcessEnv,
  options: HermesAgentDiagnosticsOptions,
): { model: string; provider: ProviderKey | 'unknown'; source: string } {
  if (options.model?.trim()) {
    const model = options.model.trim();
    return { model, provider: inferProvider(model) ?? 'unknown', source: 'model option' };
  }

  const envModel = envValue(
    env,
    'CODEBUDDY_MODEL',
    'GROK_MODEL',
    'OPENAI_MODEL',
    'ANTHROPIC_MODEL',
    'CLAUDE_MODEL',
    'GEMINI_MODEL',
    'OLLAMA_MODEL',
    'LMSTUDIO_MODEL',
    'LM_STUDIO_MODEL',
    'DEEPSEEK_MODEL',
    'MISTRAL_MODEL',
  );
  if (envModel) {
    return { model: envModel, provider: inferProvider(envModel) ?? 'unknown', source: 'environment model' };
  }

  const providerHint = normalizeProviderHint(envValue(env, 'CODEBUDDY_PROVIDER', 'GROK_PROVIDER', 'AI_PROVIDER'));
  if (providerHint) {
    return {
      model: MODEL_DEFAULTS[providerHint],
      provider: providerHint,
      source: 'environment provider default',
    };
  }

  const settings = resolveSettingsModel(options);
  if (settings.model) {
    return {
      model: settings.model,
      provider: inferProvider(settings.model) ?? 'unknown',
      source: settings.source,
    };
  }

  return {
    model: MODEL_DEFAULTS.xai,
    provider: 'xai',
    source: 'fallback',
  };
}

function buildProviderStatuses(env: NodeJS.ProcessEnv, homeDir: string): HermesProviderStatus[] {
  return PROVIDER_DEFINITIONS.map((definition) => {
    const credentialSources = presentEnvKeys(env, definition.credentialEnv);
    if (definition.provider === 'openai') {
      const codexAuthPath = path.join(homeDir, '.codebuddy', 'codex-auth.json');
      if (hasTokenLikeJsonFile(codexAuthPath)) {
        credentialSources.push(defaultHomeCredentialSource('codex-auth.json'));
      }
    }
    const baseUrl = envValue(env, ...definition.baseUrlEnv) ?? definition.defaultBaseUrl ?? null;
    const configured = definition.local === true ? Boolean(baseUrl) : credentialSources.length > 0;
    return {
      provider: definition.provider,
      label: definition.label,
      configured,
      local: definition.local === true,
      credentialSources,
      modelEnv: presentEnvKeys(env, definition.modelEnv),
      baseUrlEnv: presentEnvKeys(env, definition.baseUrlEnv),
      baseUrl,
      notes: definition.notes ?? [],
      remediation: definition.remediation ?? [],
    };
  });
}

function unknownProviderStatus(provider: 'unknown'): HermesProviderStatus {
  return {
    provider,
    label: 'Unknown provider',
    configured: false,
    local: false,
    credentialSources: [],
    modelEnv: [],
    baseUrlEnv: [],
    baseUrl: null,
    notes: ['The active model name does not match a known Code Buddy provider prefix.'],
    remediation: ['Use a known model prefix or set CODEBUDDY_PROVIDER to a supported provider.'],
  };
}

export function buildHermesProviderReadiness(
  options: HermesAgentDiagnosticsOptions = {},
): HermesProviderReadiness {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const resolved = resolveHermesModel(env, options);
  const modelConfig = getModelToolConfig(resolved.model);
  const providers = buildProviderStatuses(env, homeDir);
  const activeProvider = resolved.provider === 'unknown'
    ? unknownProviderStatus('unknown')
    : providers.find((provider) => provider.provider === resolved.provider) ?? unknownProviderStatus('unknown');
  const portal = buildHermesPortalStatus({
    env,
    homeDir,
    now: options.now,
  });
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (resolved.provider === 'unknown') {
    issues.push(`Active model "${resolved.model}" does not map to a known provider.`);
  } else if (!activeProvider.configured) {
    issues.push(`Active provider ${activeProvider.label} has no detected credential or local endpoint.`);
  }

  if (modelConfig.supportsToolCalls === false) {
    issues.push(`Active model "${resolved.model}" is configured without structured tool-call support.`);
  }

  if ((modelConfig.contextWindow ?? 0) < 128000) {
    recommendations.push('Use a >=128K context model for Hermes-style long trajectories and rich tool catalogs.');
  }

  if (!portal.portal.credentialPresent || !portal.portal.toolGatewayConfigured) {
    recommendations.push('Run buddy hermes portal status --json to inspect Nous Portal credential and Tool Gateway setup.');
  }

  return {
    ok: issues.length === 0,
    activeModel: {
      model: resolved.model,
      provider: resolved.provider,
      source: resolved.source,
      matchedConfigPattern: modelConfig.model,
      contextWindow: modelConfig.contextWindow ?? null,
      maxOutputTokens: modelConfig.maxOutputTokens ?? null,
      supportsToolCalls: modelConfig.supportsToolCalls !== false,
      supportsReasoning: modelConfig.supportsReasoning === true,
      supportsVision: modelConfig.supportsVision === true,
      patchFormat: modelConfig.patchFormat ?? null,
      promptProfile: modelConfig.promptProfile ?? null,
    },
    activeProvider,
    providers,
    portal,
    issues,
    recommendations,
  };
}

function buildPromptChecks(
  agent: CustomAgentConfig | null,
): HermesPromptChecks {
  const prompt = agent?.systemPrompt ?? '';
  return {
    mentionsCodeBuddyRuntime: prompt.includes('Code Buddy'),
    mentionsExternalRuntimeBoundary: prompt.includes('external Hermes Python runtime'),
    mentionsDefaultToolset: prompt.includes('Default Fleet toolset:'),
  };
}

export function buildHermesAgentDiagnostics(
  options: HermesAgentDiagnosticsOptions = {},
): HermesAgentDiagnostics {
  const dispatchProfile = normalizeDispatchProfile(options.dispatchProfile ?? 'balanced');
  const loader = options.loader ?? new CustomAgentLoader();
  const agentFile = getHermesAgentFile(loader);
  const agent = agentFile?.config ?? null;
  const activeToolset = buildHermesToolsetDescriptor(dispatchProfile);
  const hermesProfile = buildHermesAgentProfile(dispatchProfile);
  const availableTools = options.availableTools ?? DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS;
  const effectiveToolFilter = agent
    ? buildCustomAgentToolFilter(
      { ...agent, fleetDispatchProfile: dispatchProfile },
      EMPTY_FILTER,
      availableTools,
    )
    : EMPTY_FILTER;
  const source = !agentFile
    ? 'missing'
    : agentFile.path === 'builtin:hermes'
      ? 'built-in'
      : 'user';
  const promptChecks = buildPromptChecks(agent);
  const providerReadiness = buildHermesProviderReadiness(options);
  const runtimeBackends = buildHermesRuntimeBackendsReadiness({
    env: options.env,
    homeDir: options.homeDir,
    now: options.now,
  });
  const browserBackends = buildHermesBrowserBackendsReadiness({
    env: options.env,
    now: options.now,
  });
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (!agent) {
    issues.push('Hermes custom agent profile was not found.');
  }

  if (agent && !promptChecks.mentionsCodeBuddyRuntime) {
    issues.push('Hermes system prompt does not mention the Code Buddy runtime.');
  }

  if (agent && !promptChecks.mentionsExternalRuntimeBoundary) {
    recommendations.push('Mention that Hermes is mapped onto Code Buddy, not run as the external Python runtime.');
  }

  if (agent && !promptChecks.mentionsDefaultToolset) {
    recommendations.push('Mention the default Fleet toolset in the prompt.');
  }

  if (agent && effectiveToolFilter.disabledPatterns.length === 0) {
    recommendations.push('Declare disabledTools for destructive operations such as git_push or delete_file.');
  }

  return {
    id: 'hermes',
    ok: issues.length === 0,
    dispatchProfile,
    source,
    userOverride: source === 'user',
    agentFound: Boolean(agent),
    agentPath: agentFile?.path ?? null,
    agentName: agent?.name ?? null,
    agentDescription: agent?.description ?? null,
    enabledTools: agent?.tools ?? [],
    disabledTools: agent?.disabledTools ?? [],
    fleetDispatchProfile: agent?.fleetDispatchProfile ?? null,
    requireExplicitDispatchProfile: agent?.requireExplicitDispatchProfile === true,
    effectiveToolFilter,
    activeToolset,
    dispatchProfileGuidance: hermesProfile.dispatchProfileGuidance.map((guidance) => ({
      ...guidance,
    })),
    nativeSurfaceIds: hermesProfile.nativeSurfaces.map((surface) => surface.id),
    promptChecks,
    providerReadiness,
    runtimeBackends,
    browserBackends,
    issues,
    recommendations,
  };
}
