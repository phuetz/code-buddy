export type SharedProviderType =
  | 'chatgpt'
  | 'openrouter'
  | 'anthropic'
  | 'custom'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'grok'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'vllm'
  | 'mistral';

export type SharedCustomProtocolType = 'anthropic' | 'openai' | 'gemini';

export interface SharedProviderPreset {
  name: string;
  baseUrl: string;
  models: Array<{ id: string; name: string }>;
  keyPlaceholder: string;
  keyHint: string;
}

export interface SharedProviderPresets {
  chatgpt: SharedProviderPreset;
  openrouter: SharedProviderPreset;
  anthropic: SharedProviderPreset;
  custom: SharedProviderPreset;
  openai: SharedProviderPreset;
  gemini: SharedProviderPreset;
  ollama: SharedProviderPreset;
  lmstudio: SharedProviderPreset;
  grok: SharedProviderPreset;
  groq: SharedProviderPreset;
  together: SharedProviderPreset;
  fireworks: SharedProviderPreset;
  vllm: SharedProviderPreset;
  mistral: SharedProviderPreset;
}

export interface ModelInputGuidance {
  placeholder: string;
  hint: string;
}

export const API_PROVIDER_PRESETS: SharedProviderPresets = {
  chatgpt: {
    name: 'ChatGPT',
    // Routed by CodeBuddyClient → ChatGptResponsesProvider when this
    // baseURL substring is detected. The OAuth token replaces the
    // API key (sentinel `oauth-chatgpt`).
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    models: [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol (default · 372K subscription)' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra (ChatGPT subscription)' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna (ChatGPT subscription)' },
      { id: 'gpt-5.5', name: 'GPT-5.5 (legacy fallback · 272K)' },
      { id: 'gpt-5.4', name: 'GPT-5.4 (legacy · 272K)' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini (legacy)' },
    ],
    keyPlaceholder: 'oauth-chatgpt',
    keyHint: 'OAuth sign-in; no API key is required.',
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'openrouter/free', name: 'Gratuit — routeur automatique (recommandé)' },
      { id: 'openai/gpt-oss-20b:free', name: 'Gratuit — GPT-OSS 20B (rapide + outils)' },
      { id: 'cohere/north-mini-code:free', name: 'Gratuit — North Mini Code (agent code)' },
      { id: 'qwen/qwen3-coder:free', name: 'Gratuit — Qwen3 Coder (gros dépôts)' },
      {
        id: 'qwen/qwen3-next-80b-a3b-instruct:free',
        name: 'Gratuit — Qwen3 Next 80B A3B (général)',
      },
      { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gratuit — Gemma 4 26B (vision)' },
      {
        id: 'nvidia/nemotron-3-super-120b-a12b:free',
        name: 'Gratuit — Nemotron 3 Super (raisonnement long)',
      },
      {
        id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        name: 'Gratuit — Nemotron 3 Ultra 550B (recherche profonde, lent)',
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Gratuit — Llama 3.3 70B (rédaction)',
      },
      {
        id: 'poolside/laguna-xs-2.1:free',
        name: 'Gratuit — Laguna XS 2.1 (coding expérimental)',
      },
      { id: 'anthropic/claude-opus-4-6', name: 'anthropic/claude-opus-4-6' },
      { id: 'anthropic/claude-sonnet-4-6', name: 'anthropic/claude-sonnet-4-6' },
      { id: 'anthropic/claude-haiku-4-5', name: 'anthropic/claude-haiku-4-5' },
      { id: 'openai/gpt-5.4', name: 'openai/gpt-5.4' },
      { id: 'openai/gpt-5.3-codex', name: 'openai/gpt-5.3-codex' },
      { id: 'google/gemini-3.1-pro-preview', name: 'google/gemini-3.1-pro-preview' },
      { id: 'google/gemini-3-flash-preview', name: 'google/gemini-3-flash-preview' },
      { id: 'google/gemini-2.5-flash', name: 'google/gemini-2.5-flash' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: 'Get it from openrouter.ai/keys.',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-opus-4-6', name: 'claude-opus-4-6' },
      { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
      { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
      { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' },
      { id: 'claude-3-7-sonnet-latest', name: 'claude-3-7-sonnet-latest' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'Get it from console.anthropic.com.',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.4', name: 'gpt-5.4' },
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol (1.05M · vision · tools · reasoning max; alias gpt-5.6)',
      },
      { id: 'gpt-5.4-pro', name: 'gpt-5.4-pro' },
      { id: 'gpt-5-mini', name: 'gpt-5-mini' },
      { id: 'gpt-5-nano', name: 'gpt-5-nano' },
      { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
      { id: 'o3', name: 'o3' },
      { id: 'gpt-4.1', name: 'gpt-4.1' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: 'Get it from platform.openai.com.',
  },
  gemini: {
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: [
      { id: 'gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview' },
      { id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' },
      { id: 'gemini-3.1-flash-lite-preview', name: 'gemini-3.1-flash-lite-preview' },
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite' },
    ],
    keyPlaceholder: 'AIza...',
    keyHint: 'Get it from aistudio.google.com.',
  },
  ollama: {
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'qwen3.5:0.8b', name: 'qwen3.5:0.8b' },
      { id: 'llama3.2:latest', name: 'llama3.2:latest' },
      { id: 'deepseek-r1:latest', name: 'deepseek-r1:latest' },
    ],
    keyPlaceholder: 'Optional',
    keyHint: 'Most Ollama servers can leave this empty. Add a key only if your proxy requires one.',
  },
  lmstudio: {
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    models: [
      { id: 'local-model', name: 'local-model' },
      { id: 'qwen2.5-coder', name: 'qwen2.5-coder' },
      { id: 'deepseek-coder', name: 'deepseek-coder' },
      { id: 'meta-llama-3.1-8b-instruct', name: 'meta-llama-3.1-8b-instruct' },
      { id: 'llama-3.1-8b', name: 'llama-3.1-8b' },
    ],
    keyPlaceholder: 'Optional',
    keyHint: 'LM Studio local servers usually do not need a key. Add one only if your proxy requires one.',
  },
  custom: {
    name: 'Custom endpoint',
    baseUrl: '',
    models: [
      { id: 'deepseek-chat', name: 'deepseek-chat' },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner' },
      { id: 'kimi-k2-thinking', name: 'kimi-k2-thinking' },
      { id: 'glm-5', name: 'glm-5' },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5' },
      { id: 'qwen-max', name: 'qwen-max' },
      { id: 'grok-code-fast-1', name: 'grok-code-fast-1' },
      { id: 'mistral-large-latest', name: 'mistral-large-latest' },
    ],
    keyPlaceholder: 'sk-xxx',
    keyHint: 'Enter the API key for this endpoint.',
  },
  grok: {
    name: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1',
    models: [
      { id: 'grok-3-latest', name: 'grok-3-latest' },
      { id: 'grok-3', name: 'grok-3' },
      { id: 'grok-3-mini', name: 'grok-3-mini' },
      { id: 'grok-code-fast-1', name: 'grok-code-fast-1' },
    ],
    keyPlaceholder: 'xai-...',
    keyHint: 'Get it from console.x.ai.',
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile' },
      { id: 'llama-3.1-8b-instant', name: 'llama-3.1-8b-instant' },
      { id: 'deepseek-r1-distill-llama-70b', name: 'deepseek-r1-distill-llama-70b' },
      { id: 'qwen-2.5-32b', name: 'qwen-2.5-32b' },
    ],
    keyPlaceholder: 'gsk_...',
    keyHint: 'Get it from console.groq.com/keys.',
  },
  together: {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'deepseek-ai/DeepSeek-R1' },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen/Qwen2.5-72B-Instruct-Turbo' },
    ],
    keyPlaceholder: '...',
    keyHint: 'Get it from api.together.xyz/settings/api-keys.',
  },
  fireworks: {
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'llama-v3p3-70b-instruct' },
      { id: 'accounts/fireworks/models/deepseek-r1', name: 'deepseek-r1' },
      { id: 'accounts/fireworks/models/qwen2p5-72b-instruct', name: 'qwen2p5-72b-instruct' },
    ],
    keyPlaceholder: 'fw_...',
    keyHint: 'Get it from fireworks.ai/account/api-keys.',
  },
  vllm: {
    name: 'vLLM (self-hosted)',
    baseUrl: 'http://localhost:8000/v1',
    models: [
      { id: 'model', name: 'model (set to your served model id)' },
    ],
    keyPlaceholder: 'Optional',
    keyHint: 'Self-hosted vLLM usually needs no key. Set the model id to the one your server serves.',
  },
  mistral: {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [
      { id: 'mistral-large-latest', name: 'mistral-large-latest' },
      { id: 'mistral-small-latest', name: 'mistral-small-latest' },
      { id: 'codestral-latest', name: 'codestral-latest' },
      { id: 'open-mistral-nemo', name: 'open-mistral-nemo' },
    ],
    keyPlaceholder: '...',
    keyHint: 'Get it from console.mistral.ai.',
  },
};

export const PI_AI_CURATED_PRESETS: Record<string, { piProvider: string; pick: string[] }> = {
  openrouter: {
    piProvider: 'openrouter',
    pick: [
      'anthropic/claude-opus-4-6',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-5.4',
      'openai/gpt-5.3-codex',
      'google/gemini-3.1-pro-preview',
      'google/gemini-3-flash-preview',
      'google/gemini-2.5-flash',
    ],
  },
  anthropic: {
    piProvider: 'anthropic',
    pick: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-3-7-sonnet-latest'],
  },
  openai: {
    piProvider: 'openai',
    pick: ['gpt-5.6-sol', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.3-codex', 'o3', 'gpt-4.1'],
  },
  gemini: {
    piProvider: 'google',
    pick: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  },
};

export function getModelInputGuidance(
  provider: SharedProviderType,
  customProtocol: SharedCustomProtocolType = 'anthropic'
): ModelInputGuidance {
  if (provider === 'openrouter') {
    return {
      placeholder: 'openai/gpt-5.4, anthropic/claude-sonnet-4-6, google/gemini-3-flash-preview',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom' && customProtocol === 'openai') {
    return {
      placeholder: 'deepseek-chat, deepseek-reasoner, qwen-max, gpt-4.1',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom' && customProtocol === 'gemini') {
    return {
      placeholder: 'gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'custom') {
    return {
      placeholder: 'glm-5, kimi-k2-thinking, claude-sonnet-4-6',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'openai') {
    return {
      placeholder: 'gpt-5.6-sol, gpt-5.4, gpt-5.3-codex, o3',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  if (provider === 'ollama') {
    return {
      placeholder: 'qwen3.5:0.8b, llama3.2:latest, deepseek-r1:latest',
      hint: 'Use the exact model ID returned by your Ollama server.',
    };
  }

  if (provider === 'lmstudio') {
    return {
      placeholder: 'local-model, qwen2.5-coder, deepseek-coder, llama-3.1-8b',
      hint: 'Use the exact model ID returned by your LM Studio server.',
    };
  }

  const openAiCompatPlaceholders: Partial<Record<SharedProviderType, string>> = {
    grok: 'grok-3-latest, grok-3, grok-3-mini',
    groq: 'llama-3.3-70b-versatile, deepseek-r1-distill-llama-70b',
    together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo, deepseek-ai/DeepSeek-R1',
    fireworks: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    vllm: 'model (your served model id)',
    mistral: 'mistral-large-latest, codestral-latest',
  };
  const compatPlaceholder = openAiCompatPlaceholders[provider];
  if (compatPlaceholder) {
    return {
      placeholder: compatPlaceholder,
      hint: 'Use the exact model ID served by this endpoint.',
    };
  }

  if (provider === 'gemini') {
    return {
      placeholder: 'gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash',
      hint: 'Use the exact model ID for the selected protocol or endpoint.',
    };
  }

  return {
    placeholder: 'claude-sonnet-4-6, claude-opus-4-6',
    hint: 'Use the exact model ID for the selected protocol or endpoint.',
  };
}
