/**
 * Provider validation library
 *
 * Shared key/endpoint validation used by the onboarding wizard
 * (`src/wizard/onboarding.ts`). Each provider config defines the env key, base
 * URL, and a GET validation endpoint that is probed to confirm the key works
 * AND to list the provider's available models — the same mechanism Hermes uses
 * during `hermes setup` so onboarding fails fast on a bad key instead of
 * persisting it and breaking the first chat.
 */

// ============================================================================
// Types
// ============================================================================

export interface ProviderOnboardingConfig {
  /** Unique provider identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Environment variable for the API key */
  envKey: string;
  /** Base URL for the provider API */
  baseUrl: string;
  /** GET endpoint to validate the key (relative to baseUrl) */
  validateEndpoint: string;
  /** Optional public catalog, fetched only after authentication succeeds. */
  modelsEndpoint?: string;
  /** User-facing instructions for obtaining an API key */
  instructions: string;
}

export interface ProviderValidationResult {
  valid: boolean;
  models?: string[];
  error?: string;
}

// ============================================================================
// Provider Configs
// ============================================================================

export const PROVIDER_CONFIGS: ProviderOnboardingConfig[] = [
  {
    id: 'grok',
    name: 'Grok (xAI)',
    envKey: 'GROK_API_KEY',
    baseUrl: 'https://api.x.ai',
    validateEndpoint: '/v1/models',
    instructions: 'Get your API key from https://console.x.ai',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com',
    validateEndpoint: '/v1/models',
    instructions: 'Get your API key from https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com',
    validateEndpoint: '/v1/models',
    instructions: 'Get your API key from https://console.anthropic.com',
  },
  {
    id: 'google',
    name: 'Google (Gemini)',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com',
    validateEndpoint: '/v1beta/models',
    instructions: 'Get your API key from https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    envKey: 'OLLAMA_HOST',
    baseUrl: 'http://localhost:11434',
    validateEndpoint: '/api/tags',
    instructions: 'Install Ollama from https://ollama.ai and run `ollama serve`',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api',
    // /models is public and cannot establish whether a key is valid.
    // https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
    validateEndpoint: '/v1/key',
    modelsEndpoint: '/v1/models',
    instructions: 'Get your API key from https://openrouter.ai/keys',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    envKey: 'LMSTUDIO_HOST',
    baseUrl: 'http://localhost:1234',
    validateEndpoint: '/v1/models',
    instructions: 'Install LM Studio from https://lmstudio.ai and start the server',
  },
];

/**
 * Map an onboarding-wizard provider id (`src/wizard/onboarding.ts`
 * PROVIDER_GUIDES) to its validation config. The wizard uses friendlier ids
 * (`claude`, `gemini`) than the catalog (`anthropic`, `google`), so alias them.
 * OAuth/unsupported wizard ids (`chatgpt`) return undefined — they don't carry
 * an API key to validate against a `/models` endpoint.
 */
const GUIDE_ID_TO_CONFIG_ID: Record<string, string> = {
  grok: 'grok',
  openai: 'openai',
  claude: 'anthropic',
  anthropic: 'anthropic',
  gemini: 'google',
  google: 'google',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  openrouter: 'openrouter',
};

export function getValidationConfigForGuide(
  guideId: string
): ProviderOnboardingConfig | undefined {
  const configId = GUIDE_ID_TO_CONFIG_ID[guideId];
  return configId ? getProviderConfig(configId) : undefined;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a provider API key by making a test request to the validation endpoint.
 * Returns the validation result including available models on success.
 */
export async function validateProviderKey(
  config: ProviderOnboardingConfig,
  apiKey: string
): Promise<ProviderValidationResult> {
  const url = `${config.baseUrl}${config.validateEndpoint}`;

  // Build headers — some providers use different auth schemes
  const headers: Record<string, string> = {};

  if (config.id === 'google') {
    // Gemini uses query param auth, not header
  } else if (config.id === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (config.id === 'ollama' || config.id === 'lmstudio') {
    // Local providers typically don't need auth
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Gemini uses query parameter for the API key
  const finalUrl = config.id === 'google' ? `${url}?key=${apiKey}` : url;

  let response: Response;
  try {
    response = await fetch(finalUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('timeout') || message.includes('aborted')) {
      return { valid: false, error: `Connection timed out: ${config.baseUrl}` };
    }
    return {
      valid: false,
      error: `Failed to connect to ${config.name}: ${message}`,
    };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    // Classify clear auth failures uniformly — providers are inconsistent:
    // OpenAI/Anthropic return 401/403, but xAI returns 400 "Incorrect API key
    // provided". Without this, a plainly-bad key looks like a network blip and
    // the wizard would offer to save it anyway.
    const looksLikeBadKey =
      response.status === 401 ||
      response.status === 403 ||
      (response.status === 400 &&
        /incorrect api key|invalid api key|invalid.*key|unauthor|api key/i.test(errorText));
    if (looksLikeBadKey) {
      return { valid: false, error: 'Invalid API key (authentication failed)' };
    }
    return {
      valid: false,
      error: `API error (${response.status}): ${errorText.slice(0, 200)}`,
    };
  }

  if (config.id === 'openrouter') {
    let body: unknown;
    try { body = await response.json(); } catch { /* invalid response below */ }
    if (!isRecord(body) || !isRecord(body.data) || typeof body.data.label !== 'string') {
      return { valid: false, error: `Invalid authentication response from ${config.name}` };
    }
    // The key is authenticated even if the optional model catalog is unavailable.
    if (!config.modelsEndpoint) return { valid: true };
    try {
      const catalog = await fetch(`${config.baseUrl}${config.modelsEndpoint}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!catalog.ok) return { valid: true };
      const models = await extractModels(config, catalog);
      return models === null ? { valid: true } : { valid: true, models };
    } catch {
      return { valid: true };
    }
  }

  const models = await extractModels(config, response);
  if (models === null) {
    return { valid: false, error: `Invalid model-list response from ${config.name}` };
  }

  return { valid: true, models };
}

/**
 * Parse the model list from a provider's validation response.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function extractModels(
  config: ProviderOnboardingConfig,
  response: Response
): Promise<string[] | null> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body)) return null;
    const usesNames = config.id === 'ollama' || config.id === 'google';
    const rows = usesNames ? body.models : body.data;
    const field = usesNames ? 'name' : 'id';
    if (!Array.isArray(rows)) return null;
    const models: string[] = [];
    for (const row of rows) {
      if (!isRecord(row)) return null;
      const value = row[field];
      if (typeof value !== 'string' || !value.trim()) return null;
      models.push(config.id === 'google' ? value.replace(/^models\//, '') : value);
    }
    return models;
  } catch {
    return null;
  }
}

/**
 * Get a provider config by ID.
 */
export function getProviderConfig(
  providerId: string
): ProviderOnboardingConfig | undefined {
  return PROVIDER_CONFIGS.find((c) => c.id === providerId);
}
