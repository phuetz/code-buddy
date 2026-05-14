import type { AgentConfig } from './types.js';
import type { MultiAgentRoleProviderConfig, MultiAgentSystemConfig } from '../../config/toml-config.js';
import {
  CHATGPT_OAUTH_SENTINEL,
  CHATGPT_RESPONSES_BASE_URL,
} from '../../codebuddy/client.js';
import {
  getDefaultModelForProvider,
  inferProviderFromBaseURL,
  type DetectedProvider,
} from '../../utils/provider-detector.js';
import { logger } from '../../utils/logger.js';

type WorkflowRole = 'orchestrator' | 'coder' | 'reviewer' | 'tester';
type ProviderName = Exclude<DetectedProvider['provider'], 'unknown'>;

export type MultiAgentProviderOverrides = Partial<Record<WorkflowRole, Partial<AgentConfig>>>;

const WORKFLOW_ROLES: WorkflowRole[] = ['orchestrator', 'coder', 'reviewer', 'tester'];

function normalizeProvider(provider?: MultiAgentRoleProviderConfig['provider']): ProviderName | undefined {
  if (!provider) return undefined;
  if (provider === 'google') return 'gemini';
  if (provider === 'claude') return 'anthropic';
  if (provider === 'xai') return 'grok';
  return provider;
}

function defaultBaseURLForProvider(provider: ProviderName): string | undefined {
  switch (provider) {
    case 'chatgpt':
      return CHATGPT_RESPONSES_BASE_URL;
    case 'openai':
      return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    case 'anthropic':
      return process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta';
    case 'ollama': {
      let host = process.env.OLLAMA_HOST || 'http://localhost:11434';
      if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
      return host.endsWith('/v1') ? host : host.replace(/\/+$/, '') + '/v1';
    }
    case 'grok':
      return process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
  }
}

function defaultApiKeyForProvider(
  provider: ProviderName,
  apiKeyEnv?: string,
): string | undefined {
  if (apiKeyEnv) return process.env[apiKeyEnv];

  switch (provider) {
    case 'chatgpt':
      return CHATGPT_OAUTH_SENTINEL;
    case 'ollama':
      return 'ollama';
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'gemini':
      return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    case 'grok':
      return process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  }
}

function buildRoleOverride(
  role: WorkflowRole,
  config: MultiAgentRoleProviderConfig,
): Partial<AgentConfig> | undefined {
  const inferred = inferProviderFromBaseURL(config.base_url) ?? undefined;
  const provider = normalizeProvider(config.provider) ?? (inferred && inferred !== 'unknown' ? inferred : undefined);

  if (!provider) {
    return config.model ? { model: config.model } : undefined;
  }

  const apiKey = defaultApiKeyForProvider(provider, config.api_key_env);
  if (!apiKey) {
    logger.warn('Skipping multi-agent role provider override: missing API key env', {
      role,
      provider,
      api_key_env: config.api_key_env,
    });
    return config.model ? { model: config.model } : undefined;
  }

  const baseURL = config.base_url || defaultBaseURLForProvider(provider);
  const model = config.model || getDefaultModelForProvider(provider);

  return {
    model,
    providerOverride: {
      apiKey,
      baseURL,
      model,
    },
  };
}

export function buildMultiAgentProviderOverrides(
  config?: MultiAgentSystemConfig,
): MultiAgentProviderOverrides | undefined {
  const roleConfigs = config?.agents;
  if (!roleConfigs) return undefined;

  const overrides: MultiAgentProviderOverrides = {};
  for (const role of WORKFLOW_ROLES) {
    const roleConfig = roleConfigs[role];
    if (!roleConfig) continue;

    const override = buildRoleOverride(role, roleConfig);
    if (override) {
      overrides[role] = override;
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
