/**
 * Runtime provider catalog.
 *
 * Hermes resolves providers as runtime data (`provider`, `api_mode`,
 * `base_url`, `api_key`, `source`) before the agent loop starts. Code Buddy's
 * main runtime still consumes the simpler `(apiKey, model, baseURL)` tuple, so
 * this catalog is the shared bridge between provider UX and that client.
 */

export type ProviderApiMode =
  | 'openai-compatible'
  | 'gemini-native'
  | 'chatgpt-responses'
  | 'azure-openai'
  | 'aws-bedrock'
  | 'copilot-chat';

export type ProviderAuthMode =
  | 'api-key'
  | 'oauth'
  | 'local'
  | 'none';

export type RuntimeProviderId =
  | 'chatgpt'
  | 'agy-cli'
  | 'ollama'
  | 'lemonade'
  | 'ollama-cloud'
  | 'lmstudio'
  | 'grok'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'openrouter'
  | 'novita'
  | 'zai'
  | 'kimi-coding'
  | 'kimi-coding-cn'
  | 'arcee'
  | 'gmi'
  | 'minimax'
  | 'minimax-cn'
  | 'alibaba'
  | 'alibaba-coding-plan'
  | 'kilocode'
  | 'xiaomi'
  | 'tencent-tokenhub'
  | 'opencode-zen'
  | 'opencode-go'
  | 'deepseek'
  | 'huggingface'
  | 'nvidia'
  | 'omniroute'
  | 'ai21'
  | 'ant-ling'
  | 'cerebras'
  | 'cohere'
  | 'deepinfra'
  | 'featherless-ai'
  | 'friendliai'
  | 'hyperbolic'
  | 'inception'
  | 'inference-net'
  | 'internlm'
  | 'liquid'
  | 'longcat'
  | 'modelscope'
  | 'nscale'
  | 'openadapter'
  | 'pioneer'
  | 'reka'
  | 'sambanova'
  | 'sarvam'
  | 'scaleway'
  | 'tokenrouter'
  | 'typhoon'
  | 'zenmux'
  | 'stepfun'
  | 'vllm'
  | 'custom'
  | 'azure'
  | 'bedrock'
  | 'copilot';

export type ProviderRuntimeSupport = 'direct' | 'plugin-native';

export interface RuntimeProviderCatalogEntry {
  id: RuntimeProviderId;
  aliases?: string[];
  label: string;
  freeTier?: string;
  authMode: ProviderAuthMode;
  apiMode: ProviderApiMode;
  runtimeSupport: ProviderRuntimeSupport;
  priority: number;
  apiKeyEnvKeys: string[];
  baseUrlEnvKeys: string[];
  modelEnvKeys: string[];
  defaultBaseURL: string;
  defaultModel: string;
  apiKeyPlaceholder?: string;
  models: string[];
  notes?: string;
}

export interface ResolvedRuntimeProvider {
  provider: RuntimeProviderId;
  label: string;
  apiMode: ProviderApiMode;
  authMode: ProviderAuthMode;
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  source: 'oauth' | 'environment' | 'override';
}

export interface ResolvedPluginRuntimeProvider {
  provider: RuntimeProviderId;
  label: string;
  apiMode: ProviderApiMode;
  authMode: ProviderAuthMode;
  runtimeSupport: 'plugin-native';
  pluginId: string;
  configured: boolean;
  credentialSources: string[];
  baseURL?: string;
  defaultModel: string;
  notes?: string;
}

type EnvLike = Record<string, string | undefined>;

export interface ProviderCatalogResolveOptions {
  env?: EnvLike;
  providerOverride?: string | null;
  hasChatGptOAuth?: boolean;
  requireConfigured?: boolean;
}

export const RUNTIME_PROVIDER_CATALOG: RuntimeProviderCatalogEntry[] = [
  {
    id: 'chatgpt',
    aliases: ['codex', 'openai-codex', 'chatgpt-oauth'],
    label: 'ChatGPT (OAuth)',
    authMode: 'oauth',
    apiMode: 'chatgpt-responses',
    runtimeSupport: 'direct',
    priority: 10,
    apiKeyEnvKeys: ['CODEBUDDY_CHATGPT_OAUTH'],
    baseUrlEnvKeys: [],
    modelEnvKeys: ['CHATGPT_MODEL'],
    defaultBaseURL: 'https://chatgpt.com/backend-api/codex',
    defaultModel: 'gpt-5.6-sol',
    apiKeyPlaceholder: 'oauth-chatgpt',
    models: [
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ],
  },
  {
    id: 'agy-cli',
    aliases: ['agy', 'antigravity'],
    label: 'Google Antigravity (subscription)',
    authMode: 'none',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 11,
    apiKeyEnvKeys: [],
    baseUrlEnvKeys: [],
    modelEnvKeys: ['AGY_MODEL'],
    defaultBaseURL: 'agy-cli://local',
    defaultModel: 'Gemini 3.1 Pro (High)',
    apiKeyPlaceholder: 'agy-cli',
    models: ['Gemini 3.1 Pro (High)'],
    notes: 'Subscription CLI bridge; availability and model names are discovered from `agy models`.',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    freeTier: 'local, $0',
    authMode: 'local',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 20,
    apiKeyEnvKeys: [],
    baseUrlEnvKeys: ['OLLAMA_HOST'],
    modelEnvKeys: ['GROK_MODEL', 'OLLAMA_MODEL'],
    defaultBaseURL: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    apiKeyPlaceholder: 'ollama',
    models: ['qwen2.5-coder:7b', 'llama3.2', 'mistral', 'devstral-small-2'],
  },
  {
    id: 'lemonade',
    aliases: ['lemond'],
    label: 'Lemonade Server',
    freeTier: 'local, $0',
    authMode: 'local',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 19,
    apiKeyEnvKeys: ['LEMONADE_API_KEY'],
    baseUrlEnvKeys: ['LEMONADE_HOST'],
    modelEnvKeys: ['LEMONADE_MODEL'],
    defaultBaseURL: 'http://127.0.0.1:13305/api/v1',
    defaultModel: 'Qwen3.6-35B-A3B-MTP-GGUF',
    apiKeyPlaceholder: 'lemonade',
    models: ['Qwen3.6-35B-A3B-MTP-GGUF'],
    notes: 'Local Ryzen AI runtime; installed models are discovered from /v1/models.',
  },
  {
    id: 'lmstudio',
    aliases: ['lm-studio', 'lm_studio'],
    label: 'LM Studio',
    freeTier: 'local, $0',
    authMode: 'local',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 21,
    apiKeyEnvKeys: ['LMSTUDIO_API_KEY', 'LM_STUDIO_API_KEY'],
    baseUrlEnvKeys: ['LMSTUDIO_HOST', 'LM_STUDIO_HOST', 'LMSTUDIO_BASE_URL', 'LM_STUDIO_BASE_URL'],
    modelEnvKeys: ['LMSTUDIO_MODEL', 'LM_STUDIO_MODEL'],
    defaultBaseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    apiKeyPlaceholder: 'lm-studio',
    models: ['local-model', 'qwen2.5-coder', 'meta-llama-3.1-8b-instruct', 'llama-3.1-8b', 'mistral-7b'],
  },
  {
    id: 'grok',
    aliases: ['xai'],
    label: 'Grok (xAI)',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 30,
    apiKeyEnvKeys: ['GROK_API_KEY', 'XAI_API_KEY'],
    baseUrlEnvKeys: ['GROK_BASE_URL', 'XAI_BASE_URL'],
    modelEnvKeys: ['GROK_MODEL', 'XAI_MODEL'],
    defaultBaseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-fast',
    models: ['grok-4-1-fast', 'grok-code-fast-1', 'grok-3-fast', 'grok-3-mini'],
  },
  {
    id: 'gemini',
    aliases: ['google'],
    label: 'Gemini (Google)',
    authMode: 'api-key',
    apiMode: 'gemini-native',
    runtimeSupport: 'direct',
    priority: 40,
    apiKeyEnvKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    baseUrlEnvKeys: ['GEMINI_BASE_URL', 'GOOGLE_AI_BASE_URL'],
    modelEnvKeys: ['GEMINI_MODEL', 'GOOGLE_MODEL'],
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'],
  },
  {
    id: 'openai',
    aliases: ['openai-api'],
    label: 'OpenAI',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 50,
    apiKeyEnvKeys: ['OPENAI_API_KEY'],
    baseUrlEnvKeys: ['OPENAI_BASE_URL'],
    modelEnvKeys: ['OPENAI_MODEL'],
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-5.6-sol', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
  },
  {
    id: 'anthropic',
    aliases: ['claude', 'claude-code'],
    label: 'Claude (Anthropic)',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 60,
    apiKeyEnvKeys: ['ANTHROPIC_API_KEY'],
    baseUrlEnvKeys: ['ANTHROPIC_BASE_URL'],
    modelEnvKeys: ['ANTHROPIC_MODEL', 'CLAUDE_MODEL'],
    defaultBaseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-sonnet-latest'],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 70,
    apiKeyEnvKeys: ['MISTRAL_API_KEY'],
    baseUrlEnvKeys: ['MISTRAL_BASE_URL'],
    modelEnvKeys: ['MISTRAL_MODEL'],
    defaultBaseURL: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest',
      'devstral-latest',
      'magistral-medium-latest',
      'ministral-8b-latest',
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 72,
    apiKeyEnvKeys: ['DEEPSEEK_API_KEY'],
    baseUrlEnvKeys: ['DEEPSEEK_BASE_URL'],
    modelEnvKeys: ['DEEPSEEK_MODEL'],
    defaultBaseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3.2'],
  },
  {
    id: 'groq',
    label: 'Groq',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 80,
    apiKeyEnvKeys: ['GROQ_API_KEY'],
    baseUrlEnvKeys: ['GROQ_BASE_URL'],
    modelEnvKeys: ['GROQ_MODEL'],
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  },
  {
    id: 'together',
    label: 'Together AI',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 90,
    apiKeyEnvKeys: ['TOGETHER_API_KEY'],
    baseUrlEnvKeys: ['TOGETHER_BASE_URL'],
    modelEnvKeys: ['TOGETHER_MODEL'],
    defaultBaseURL: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 100,
    apiKeyEnvKeys: ['FIREWORKS_API_KEY'],
    baseUrlEnvKeys: ['FIREWORKS_BASE_URL'],
    modelEnvKeys: ['FIREWORKS_MODEL'],
    defaultBaseURL: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    models: ['accounts/fireworks/models/llama-v3p1-70b-instruct', 'accounts/fireworks/models/qwen2p5-coder-32b-instruct'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 110,
    apiKeyEnvKeys: ['OPENROUTER_API_KEY'],
    baseUrlEnvKeys: ['OPENROUTER_BASE_URL'],
    modelEnvKeys: ['OPENROUTER_MODEL'],
    defaultBaseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    // Curated zero-cost council pool. Availability of a pinned :free endpoint
    // can fluctuate, so openrouter/free stays first as the resilient default.
    models: [
      'openrouter/free',
      'openai/gpt-oss-20b:free',
      'cohere/north-mini-code:free',
      'qwen/qwen3-coder:free',
      'qwen/qwen3-next-80b-a3b-instruct:free',
      'google/gemma-4-26b-a4b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'poolside/laguna-xs-2.1:free',
    ],
  },
  {
    id: 'novita',
    aliases: ['novita-ai'],
    label: 'NovitaAI',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 111,
    apiKeyEnvKeys: ['NOVITA_API_KEY'],
    baseUrlEnvKeys: ['NOVITA_BASE_URL'],
    modelEnvKeys: ['NOVITA_MODEL'],
    defaultBaseURL: 'https://api.novita.ai/openai/v1',
    defaultModel: 'moonshotai/kimi-k2.5',
    models: ['moonshotai/kimi-k2.5', 'deepseek/deepseek-v3.2', 'qwen/qwen3-coder-480b-a35b-instruct'],
  },
  {
    id: 'zai',
    aliases: ['glm', 'zai-coding', 'zhipu'],
    label: 'z.ai / GLM',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 112,
    apiKeyEnvKeys: ['GLM_API_KEY', 'ZAI_API_KEY'],
    baseUrlEnvKeys: ['GLM_BASE_URL', 'ZAI_BASE_URL'],
    modelEnvKeys: ['GLM_MODEL', 'ZAI_MODEL'],
    defaultBaseURL: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'glm-5',
    models: ['glm-5', 'glm-5-code', 'glm-4.7', 'glm-4.5-air'],
  },
  {
    id: 'kimi-coding',
    aliases: ['kimi', 'moonshot', 'moonshot-ai'],
    label: 'Kimi / Moonshot',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 113,
    apiKeyEnvKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    baseUrlEnvKeys: ['KIMI_BASE_URL', 'MOONSHOT_BASE_URL'],
    modelEnvKeys: ['KIMI_MODEL', 'MOONSHOT_MODEL'],
    defaultBaseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.5',
    models: ['kimi-k2.5', 'kimi-k2-thinking', 'kimi-latest'],
  },
  {
    id: 'kimi-coding-cn',
    aliases: ['kimi-cn', 'moonshot-cn'],
    label: 'Kimi / Moonshot China',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 114,
    apiKeyEnvKeys: ['KIMI_CN_API_KEY'],
    baseUrlEnvKeys: ['KIMI_CN_BASE_URL'],
    modelEnvKeys: ['KIMI_CN_MODEL'],
    defaultBaseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
    models: ['kimi-k2.5', 'kimi-k2-thinking', 'moonshot-v1-128k'],
  },
  {
    id: 'arcee',
    aliases: ['arcee-ai', 'arceeai'],
    label: 'Arcee AI',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 115,
    apiKeyEnvKeys: ['ARCEEAI_API_KEY', 'ARCEE_API_KEY'],
    baseUrlEnvKeys: ['ARCEEAI_BASE_URL', 'ARCEE_BASE_URL'],
    modelEnvKeys: ['ARCEEAI_MODEL', 'ARCEE_MODEL'],
    defaultBaseURL: 'https://api.arcee.ai/api/v1',
    defaultModel: 'trinity-large-thinking',
    models: ['trinity-large-thinking', 'trinity-mini', 'afm-4.5b'],
  },
  {
    id: 'gmi',
    aliases: ['gmi-cloud', 'gmicloud'],
    label: 'GMI Cloud',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 116,
    apiKeyEnvKeys: ['GMI_API_KEY'],
    baseUrlEnvKeys: ['GMI_BASE_URL'],
    modelEnvKeys: ['GMI_MODEL'],
    defaultBaseURL: 'https://api.gmi-serving.com/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    models: ['deepseek-ai/DeepSeek-V3.2', 'zai-org/GLM-5.1-FP8', 'google/gemini-3.1-flash-lite'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 117,
    apiKeyEnvKeys: ['MINIMAX_API_KEY'],
    baseUrlEnvKeys: ['MINIMAX_BASE_URL'],
    modelEnvKeys: ['MINIMAX_MODEL'],
    defaultBaseURL: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1'],
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax China',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 118,
    apiKeyEnvKeys: ['MINIMAX_CN_API_KEY'],
    baseUrlEnvKeys: ['MINIMAX_CN_BASE_URL'],
    modelEnvKeys: ['MINIMAX_CN_MODEL'],
    defaultBaseURL: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M2.7',
    models: ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1'],
  },
  {
    id: 'alibaba',
    aliases: ['qwen', 'dashscope'],
    label: 'Alibaba Cloud / DashScope',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 119,
    apiKeyEnvKeys: ['DASHSCOPE_API_KEY', 'ALIBABA_API_KEY'],
    baseUrlEnvKeys: ['DASHSCOPE_BASE_URL', 'ALIBABA_BASE_URL'],
    modelEnvKeys: ['DASHSCOPE_MODEL', 'ALIBABA_MODEL'],
    defaultBaseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.5-plus',
    models: ['qwen3.5-plus', 'qwen3-coder-plus', 'qwen-plus'],
  },
  {
    id: 'alibaba-coding-plan',
    aliases: ['alibaba-coding', 'qwen-coding'],
    label: 'Alibaba Coding Plan',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 120,
    apiKeyEnvKeys: ['ALIBABA_CODING_PLAN_API_KEY', 'DASHSCOPE_API_KEY'],
    baseUrlEnvKeys: ['ALIBABA_CODING_PLAN_BASE_URL', 'DASHSCOPE_CODING_BASE_URL'],
    modelEnvKeys: ['ALIBABA_CODING_PLAN_MODEL', 'DASHSCOPE_CODING_MODEL'],
    defaultBaseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-coder-plus',
    models: ['qwen3-coder-plus', 'qwen3-coder-flash'],
  },
  {
    id: 'kilocode',
    aliases: ['kilo-code', 'kilo'],
    label: 'Kilo Code Gateway',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 121,
    apiKeyEnvKeys: ['KILOCODE_API_KEY', 'KILO_API_KEY'],
    baseUrlEnvKeys: ['KILOCODE_BASE_URL', 'KILO_BASE_URL'],
    modelEnvKeys: ['KILOCODE_MODEL', 'KILO_MODEL'],
    defaultBaseURL: 'https://api.kilo.ai/api/gateway',
    defaultModel: 'kilocode-default',
    models: ['kilocode-default'],
  },
  {
    id: 'xiaomi',
    aliases: ['mimo', 'xiaomi-mimo'],
    label: 'Xiaomi MiMo',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 122,
    apiKeyEnvKeys: ['XIAOMI_API_KEY'],
    baseUrlEnvKeys: ['XIAOMI_BASE_URL'],
    modelEnvKeys: ['XIAOMI_MODEL'],
    defaultBaseURL: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2-pro',
    models: ['mimo-v2-pro', 'mimo-v2-flash'],
  },
  {
    id: 'tencent-tokenhub',
    aliases: ['tencent', 'tokenhub', 'tencentmaas'],
    label: 'Tencent TokenHub',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 123,
    apiKeyEnvKeys: ['TOKENHUB_API_KEY', 'TENCENT_TOKENHUB_API_KEY'],
    baseUrlEnvKeys: ['TOKENHUB_BASE_URL', 'TENCENT_TOKENHUB_BASE_URL'],
    modelEnvKeys: ['TOKENHUB_MODEL', 'TENCENT_TOKENHUB_MODEL'],
    defaultBaseURL: 'https://tokenhub.tencentmaas.com/v1',
    defaultModel: 'tencent-tokenhub/hy3-preview',
    models: ['tencent-tokenhub/hy3-preview'],
  },
  {
    id: 'opencode-zen',
    aliases: ['opencode', 'opencode-zen-api'],
    label: 'OpenCode Zen',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 124,
    apiKeyEnvKeys: ['OPENCODE_ZEN_API_KEY', 'OPENCODE_API_KEY'],
    baseUrlEnvKeys: ['OPENCODE_ZEN_BASE_URL', 'OPENCODE_BASE_URL'],
    modelEnvKeys: ['OPENCODE_ZEN_MODEL', 'OPENCODE_MODEL'],
    defaultBaseURL: 'https://opencode.ai/zen/v1',
    defaultModel: 'opencode/claude-sonnet-4-5',
    models: ['opencode/claude-sonnet-4-5', 'opencode/gpt-5.1', 'opencode/glm-5.1'],
  },
  {
    id: 'opencode-go',
    aliases: ['opencode-go-api'],
    label: 'OpenCode Go',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 125,
    apiKeyEnvKeys: ['OPENCODE_GO_API_KEY'],
    baseUrlEnvKeys: ['OPENCODE_GO_BASE_URL'],
    modelEnvKeys: ['OPENCODE_GO_MODEL'],
    defaultBaseURL: 'https://opencode.ai/zen/go/v1',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'glm-5.1'],
  },
  {
    id: 'huggingface',
    aliases: ['hf'],
    label: 'Hugging Face',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 127,
    apiKeyEnvKeys: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
    baseUrlEnvKeys: ['HF_BASE_URL', 'HUGGINGFACE_BASE_URL'],
    modelEnvKeys: ['HF_MODEL', 'HUGGINGFACE_MODEL'],
    defaultBaseURL: 'https://router.huggingface.co/v1',
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3-Coder-480B-A35B-Instruct'],
  },
  {
    id: 'nvidia',
    aliases: ['nvidia-nim', 'nim'],
    label: 'NVIDIA NIM',
    freeTier: 'free API key, ~40 RPM',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 128,
    apiKeyEnvKeys: ['NVIDIA_API_KEY'],
    baseUrlEnvKeys: ['NVIDIA_BASE_URL', 'NVIDIA_NIM_BASE_URL'],
    modelEnvKeys: ['NVIDIA_MODEL', 'NVIDIA_NIM_MODEL'],
    defaultBaseURL: 'https://integrate.api.nvidia.com/v1',
    // Modèles VÉRIFIÉS par sonde live le 22/08/2026 (scripts/providers/probe-nvidia-nim.py, rapport
    // docs/providers/nvidia-nim-probe-2026-08-22.md) : 8/28 candidats répondent. Le catalogue NVIDIA en
    // liste ~100 mais beaucoup sont en fin de vie (410 Gone : GLM 5.2, MiniMax M2.7, DeepSeek V4, Qwen 3.5,
    // Mistral Small 4/Large 3…) ou introuvables (404 : Kimi K2.6, Nemotron Ultra 253B). Kimi K3 = meilleur
    // compromis qualité (FR excellent, ~4 s) ; Nemotron 3 Nano/Super/Ultra = la famille récente (0,5-1,3 s).
    defaultModel: 'moonshotai/kimi-k3',
    models: [
      'moonshotai/kimi-k3',
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/nemotron-3-super-120b-a12b',
      'nvidia/nemotron-3-nano-30b-a3b',
      'nvidia/llama-3.3-nemotron-super-49b-v1',
      'stepfun-ai/step-3.7-flash',
      'openai/gpt-oss-20b',
      'meta/llama-3.3-70b-instruct',
      'mistralai/mistral-nemotron',
    ],
  },
  {
    id: 'ollama-cloud',
    aliases: ['ollama-com'],
    label: 'Ollama Cloud',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 129,
    apiKeyEnvKeys: ['OLLAMA_API_KEY'],
    baseUrlEnvKeys: ['OLLAMA_CLOUD_BASE_URL'],
    modelEnvKeys: ['OLLAMA_CLOUD_MODEL'],
    defaultBaseURL: 'https://ollama.com/v1',
    defaultModel: 'gpt-oss:120b',
    models: ['gpt-oss:120b', 'deepseek-v3.1:671b-cloud'],
  },
  {
    id: 'stepfun',
    aliases: ['step'],
    label: 'StepFun',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 130,
    apiKeyEnvKeys: ['STEPFUN_API_KEY', 'STEP_API_KEY'],
    baseUrlEnvKeys: ['STEPFUN_BASE_URL', 'STEP_BASE_URL'],
    modelEnvKeys: ['STEPFUN_MODEL', 'STEP_MODEL'],
    defaultBaseURL: 'https://api.stepfun.ai/v1',
    defaultModel: 'step-3.5-flash',
    models: ['step-3.5-flash', 'step-3.5-mini'],
  },
  {
    id: 'omniroute',
    aliases: ['omni-route', 'omni'],
    label: 'OmniRoute (local AI gateway)',
    freeTier: 'local gateway to 90+ free tiers',
    // OmniRoute (github.com/diegosouzapw/OmniRoute, MIT) = proxy LOCAL OpenAI-compatible qui
    // agrège 90+ fournisseurs à palier gratuit (NVIDIA NIM, Cerebras, GLM, DeepSeek, Pollinations…)
    // avec bascule automatique sur quota/erreur et compression de prompts (RTK+Caveman).
    // `npm install -g omniroute && omniroute serve` → http://localhost:20128/v1 (pas de clé requise
    // par défaut ; OMNIROUTE_API_KEY si l'utilisateur en a configuré une). Ajouté le 22/08/2026.
    authMode: 'local',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 23,
    apiKeyEnvKeys: ['OMNIROUTE_API_KEY'],
    baseUrlEnvKeys: ['OMNIROUTE_BASE_URL'],
    modelEnvKeys: ['OMNIROUTE_MODEL'],
    defaultBaseURL: 'http://localhost:20128/v1',
    // Les « auto/* » sont des combos routés par OmniRoute (scoring 14 facteurs + cascade
    // abonnement→clé→pas cher→gratuit). `auto/best-free` = la doctrine flotte $0 par défaut ;
    // le catalogue complet (115 ids le 22/08) s'obtient via GET /v1/models sur le serveur.
    defaultModel: 'auto/best-free',
    apiKeyPlaceholder: 'omniroute',
    models: ['auto/best-free', 'auto/coding:free', 'auto/best-coding', 'auto/best-reasoning', 'auto/best-fast', 'auto/cheap'],
  },
  // ── Fournisseurs à PALIER GRATUIT importés du catalogue OmniRoute (22/08/2026) ────────────
  // Générés par scripts/providers/import-omniroute-free-catalog.py --curated --ts (liste curée :
  // infra réputée, clé API, OpenAI-compatible, pas de scraper web/ToS). Priorité 300 = jamais
  // auto-sélectionnés devant les fournisseurs historiques ; actifs seulement si <ID>_API_KEY est posé.
  // Les paliers gratuits bougent : re-lancer le script et vérifier live avant de s'y fier.
  {
    id: 'ai21',
    label: 'AI21 Labs',
    freeTier: '$10 trial credits on signup (valid 3 months), no credit card required',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['AI21_API_KEY'],
    baseUrlEnvKeys: ['AI21_BASE_URL'],
    modelEnvKeys: ['AI21_MODEL'],
    defaultBaseURL: 'https://api.ai21.com/studio/v1',
    defaultModel: 'jamba-large',
    models: ['jamba-large', 'jamba-mini'],
  },
  {
    id: 'ant-ling',
    label: 'Ant Ling / Ring (inclusionAI)',
    freeTier: '500,000 free tokens/day (resets 02:00 UTC+8, no rollover)',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['ANT_LING_API_KEY'],
    baseUrlEnvKeys: ['ANT_LING_BASE_URL'],
    modelEnvKeys: ['ANT_LING_MODEL'],
    defaultBaseURL: 'https://api.ant-ling.com/v1',
    defaultModel: 'Ling-2.6-1T',
    models: ['Ling-2.6-1T', 'Ring-2.6-1T', 'Ling-2.6-flash'],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    freeTier: '1M tokens/day, 30K TPM, 5 RPM; no credit card',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['CEREBRAS_API_KEY'],
    baseUrlEnvKeys: ['CEREBRAS_BASE_URL'],
    modelEnvKeys: ['CEREBRAS_MODEL'],
    defaultBaseURL: 'https://api.cerebras.ai/v1',
    defaultModel: 'zai-glm-4.7',
    models: ['zai-glm-4.7', 'gemma-4-31b', 'gpt-oss-120b'],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    freeTier: '1,000 API calls/month; no credit card',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['COHERE_API_KEY'],
    baseUrlEnvKeys: ['COHERE_BASE_URL'],
    modelEnvKeys: ['COHERE_MODEL'],
    defaultBaseURL: 'https://api.cohere.com/compatibility/v1',
    defaultModel: 'command-a-reasoning-08-2025',
    models: ['command-a-reasoning-08-2025', 'command-a-vision-07-2025', 'command-a-03-2025', 'command-r7b-12-2024', 'command-r-plus-08-2024', 'command-r-08-2024'],
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    freeTier: 'free signup credits for API testing and model exploration',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['DEEPINFRA_API_KEY'],
    baseUrlEnvKeys: ['DEEPINFRA_BASE_URL'],
    modelEnvKeys: ['DEEPINFRA_MODEL'],
    defaultBaseURL: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'featherless-ai',
    label: 'Featherless AI',
    freeTier: 'free tier, no credit card required',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['FEATHERLESS_AI_API_KEY'],
    baseUrlEnvKeys: ['FEATHERLESS_AI_BASE_URL'],
    modelEnvKeys: ['FEATHERLESS_AI_MODEL'],
    defaultBaseURL: 'https://api.featherless.ai/v1',
    defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    models: ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
  },
  {
    id: 'friendliai',
    label: 'FriendliAI',
    freeTier: 'free serverless inference tier, no credit card required',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['FRIENDLIAI_API_KEY'],
    baseUrlEnvKeys: ['FRIENDLIAI_BASE_URL'],
    modelEnvKeys: ['FRIENDLIAI_MODEL'],
    defaultBaseURL: 'https://api.friendli.ai/serverless/v1',
    defaultModel: 'meta-llama-3.3-70b-instruct',
    models: ['meta-llama-3.3-70b-instruct', 'deepseek-r1'],
  },
  {
    id: 'hyperbolic',
    label: 'Hyperbolic',
    freeTier: '$1-5 trial credits on signup for serverless inference',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['HYPERBOLIC_API_KEY'],
    baseUrlEnvKeys: ['HYPERBOLIC_BASE_URL'],
    modelEnvKeys: ['HYPERBOLIC_MODEL'],
    defaultBaseURL: 'https://api.hyperbolic.xyz/v1',
    defaultModel: 'Qwen/QwQ-32B',
    models: ['Qwen/QwQ-32B', 'deepseek-ai/DeepSeek-R1', 'deepseek-ai/DeepSeek-V3', 'meta-llama/Llama-3.3-70B-Instruct', 'meta-llama/Llama-3.2-3B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
  },
  {
    id: 'inception',
    label: 'Inception',
    freeTier: '10M free tokens on signup, no credit card required',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['INCEPTION_API_KEY'],
    baseUrlEnvKeys: ['INCEPTION_BASE_URL'],
    modelEnvKeys: ['INCEPTION_MODEL'],
    defaultBaseURL: 'https://api.inceptionlabs.ai/v1',
    defaultModel: 'mercury-2',
    models: ['mercury-2'],
  },
  {
    id: 'inference-net',
    label: 'Inference.net',
    freeTier: '$25 signup credits plus research grants',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['INFERENCE_NET_API_KEY'],
    baseUrlEnvKeys: ['INFERENCE_NET_BASE_URL'],
    modelEnvKeys: ['INFERENCE_NET_MODEL'],
    defaultBaseURL: 'https://api.inference.net/v1',
    defaultModel: 'meta-llama/llama-3.2-3b-instruct',
    models: ['meta-llama/llama-3.2-3b-instruct', 'deepseek/deepseek-v3'],
  },
  {
    id: 'internlm',
    label: 'InternLM (Intern-S1)',
    freeTier: '~1M input / 3M output tokens monthly (~10 RPM)',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['INTERNLM_API_KEY'],
    baseUrlEnvKeys: ['INTERNLM_BASE_URL'],
    modelEnvKeys: ['INTERNLM_MODEL'],
    defaultBaseURL: 'https://chat.intern-ai.org.cn/api/v1',
    defaultModel: 'intern-s1-pro',
    models: ['intern-s1-pro', 'intern-s1', 'intern-s1-mini', 'internvl3.5-latest', 'intern-latest'],
  },
  {
    id: 'liquid',
    label: 'Liquid AI',
    freeTier: 'free LFM2.5-1.2B Thinking and Instruct models',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['LIQUID_API_KEY'],
    baseUrlEnvKeys: ['LIQUID_BASE_URL'],
    modelEnvKeys: ['LIQUID_MODEL'],
    defaultBaseURL: 'https://inference.liquid.ai/v1',
    defaultModel: 'liquid-lfm-40b',
    models: ['liquid-lfm-40b'],
  },
  {
    id: 'longcat',
    label: 'LongCat AI',
    freeTier: 'one-time 10M-token grant after signup and KYC verification',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['LONGCAT_API_KEY'],
    baseUrlEnvKeys: ['LONGCAT_BASE_URL'],
    modelEnvKeys: ['LONGCAT_MODEL'],
    defaultBaseURL: 'https://api.longcat.chat/openai/v1',
    defaultModel: 'LongCat-2.0',
    models: ['LongCat-2.0'],
  },
  {
    id: 'modelscope',
    label: 'ModelScope',
    freeTier: 'free API-Inference tier, Alibaba account required',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['MODELSCOPE_API_KEY'],
    baseUrlEnvKeys: ['MODELSCOPE_BASE_URL'],
    modelEnvKeys: ['MODELSCOPE_MODEL'],
    defaultBaseURL: 'https://api-inference.modelscope.cn/v1',
    defaultModel: 'Qwen/Qwen3-235B-A22B',
    models: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'nscale',
    label: 'nScale',
    freeTier: '$5 signup credits for inference testing',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['NSCALE_API_KEY'],
    baseUrlEnvKeys: ['NSCALE_BASE_URL'],
    modelEnvKeys: ['NSCALE_MODEL'],
    defaultBaseURL: 'https://inference.api.nscale.com/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3-235B-A22B'],
  },
  {
    id: 'openadapter',
    label: 'OpenAdapter',
    freeTier: '15+ open-source models with daily quota, no credit card',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['OPENADAPTER_API_KEY'],
    baseUrlEnvKeys: ['OPENADAPTER_BASE_URL'],
    modelEnvKeys: ['OPENADAPTER_MODEL'],
    defaultBaseURL: 'https://api.openadapter.in/v1',
    defaultModel: 'glm-4.7',
    models: ['glm-4.7'],
  },
  {
    id: 'pioneer',
    label: 'Pioneer AI',
    freeTier: '$75 usage credits, no credit card required',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['PIONEER_API_KEY'],
    baseUrlEnvKeys: ['PIONEER_BASE_URL'],
    modelEnvKeys: ['PIONEER_MODEL'],
    defaultBaseURL: 'https://api.pioneer.ai/v1',
    defaultModel: 'Qwen/Qwen3-32B',
    models: ['Qwen/Qwen3-32B', 'Qwen/Qwen3.6-27B', 'Qwen/Qwen3.5-9B', 'Qwen/Qwen3-8B', 'Qwen/Qwen3-4B-Base', 'Qwen/Qwen3-1.7B-Base'],
  },
  {
    id: 'reka',
    label: 'Reka',
    freeTier: '$10/month recurring API credits',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['REKA_API_KEY'],
    baseUrlEnvKeys: ['REKA_BASE_URL'],
    modelEnvKeys: ['REKA_MODEL'],
    defaultBaseURL: 'https://api.reka.ai/v1',
    defaultModel: 'reka-flash-3',
    models: ['reka-flash-3', 'reka-flash', 'reka-edge-2603'],
  },
  {
    id: 'sambanova',
    label: 'SambaNova',
    freeTier: '$5 signup credits (valid 30 days), no credit card required',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['SAMBANOVA_API_KEY'],
    baseUrlEnvKeys: ['SAMBANOVA_BASE_URL'],
    modelEnvKeys: ['SAMBANOVA_MODEL'],
    defaultBaseURL: 'https://api.sambanova.ai/v1',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1', 'Llama-4-Maverick-17B-128E-Instruct'],
  },
  {
    id: 'sarvam',
    label: 'Sarvam AI',
    freeTier: '₹1,000 signup credits, never expire',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['SARVAM_API_KEY'],
    baseUrlEnvKeys: ['SARVAM_BASE_URL'],
    modelEnvKeys: ['SARVAM_MODEL'],
    defaultBaseURL: 'https://api.sarvam.ai/v1',
    defaultModel: 'sarvam-105b',
    models: ['sarvam-105b', 'sarvam-30b'],
  },
  {
    id: 'scaleway',
    label: 'Scaleway AI',
    freeTier: '1M free tokens for new accounts',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['SCALEWAY_API_KEY'],
    baseUrlEnvKeys: ['SCALEWAY_BASE_URL'],
    modelEnvKeys: ['SCALEWAY_MODEL'],
    defaultBaseURL: 'https://api.scaleway.ai/v1',
    defaultModel: 'qwen3-235b-a22b-instruct-2507',
    models: ['qwen3-235b-a22b-instruct-2507', 'llama-3.1-70b-instruct', 'llama-3.1-8b-instruct', 'mistral-small-3.2-24b-instruct-2506', 'deepseek-v3-0324', 'gpt-oss-120b'],
  },
  {
    id: 'tokenrouter',
    label: 'TokenRouter',
    freeTier: 'free tier includes MiniMax 3',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['TOKENROUTER_API_KEY'],
    baseUrlEnvKeys: ['TOKENROUTER_BASE_URL'],
    modelEnvKeys: ['TOKENROUTER_MODEL'],
    defaultBaseURL: 'https://api.tokenrouter.com/v1',
    defaultModel: 'minimax-3',
    models: ['minimax-3', 'deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  {
    id: 'typhoon',
    label: 'Typhoon',
    freeTier: 'free API key, 5 req/s and 200 req/m',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['TYPHOON_API_KEY'],
    baseUrlEnvKeys: ['TYPHOON_BASE_URL'],
    modelEnvKeys: ['TYPHOON_MODEL'],
    defaultBaseURL: 'https://api.opentyphoon.ai/v1',
    defaultModel: 'typhoon-v2.5-30b-a3b-instruct',
    models: ['typhoon-v2.5-30b-a3b-instruct'],
  },
  {
    id: 'zenmux',
    label: 'ZenMux',
    freeTier: 'free Gemini 3 Flash, DeepSeek V3.2, Grok 4.1 Fast, Mistral Large, and more',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['ZENMUX_API_KEY'],
    baseUrlEnvKeys: ['ZENMUX_BASE_URL'],
    modelEnvKeys: ['ZENMUX_MODEL'],
    defaultBaseURL: 'https://zenmux.ai/api/v1',
    defaultModel: 'google/gemini-3.1-pro-preview',
    models: ['google/gemini-3.1-pro-preview', 'google/gemini-3-flash-preview', 'openai/gpt-5', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.5', 'deepseek/deepseek-chat'],
  },
  {
    id: 'vllm',
    label: 'vLLM',
    freeTier: 'local, $0',
    authMode: 'local',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 22,
    apiKeyEnvKeys: ['VLLM_API_KEY'],
    baseUrlEnvKeys: ['VLLM_BASE_URL'],
    modelEnvKeys: ['VLLM_MODEL'],
    defaultBaseURL: 'http://localhost:8000/v1',
    defaultModel: 'model',
    apiKeyPlaceholder: 'vllm',
    models: ['model'],
  },
  {
    id: 'custom',
    aliases: ['openai-compatible', 'custom-openai'],
    label: 'Custom OpenAI-compatible',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 300,
    apiKeyEnvKeys: ['CODEBUDDY_API_KEY', 'CUSTOM_PROVIDER_API_KEY'],
    baseUrlEnvKeys: ['CODEBUDDY_BASE_URL', 'CUSTOM_PROVIDER_BASE_URL'],
    modelEnvKeys: ['CODEBUDDY_MODEL', 'CUSTOM_PROVIDER_MODEL'],
    defaultBaseURL: 'http://localhost:8000/v1',
    defaultModel: 'model',
    models: ['model'],
  },
  {
    id: 'azure',
    aliases: ['azure-openai', 'azure_openai'],
    label: 'Azure OpenAI',
    authMode: 'api-key',
    apiMode: 'azure-openai',
    runtimeSupport: 'plugin-native',
    priority: 400,
    apiKeyEnvKeys: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_AD_TOKEN'],
    baseUrlEnvKeys: ['AZURE_OPENAI_ENDPOINT'],
    modelEnvKeys: ['AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_MODEL'],
    defaultBaseURL: 'https://<resource>.openai.azure.com',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4', 'gpt-35-turbo'],
    notes: 'Bundled plugin transport: src/plugins/bundled/azure-provider.ts',
  },
  {
    id: 'bedrock',
    aliases: ['aws-bedrock', 'amazon-bedrock'],
    label: 'AWS Bedrock',
    authMode: 'api-key',
    apiMode: 'aws-bedrock',
    runtimeSupport: 'plugin-native',
    priority: 401,
    apiKeyEnvKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE'],
    baseUrlEnvKeys: ['AWS_BEDROCK_REGION', 'AWS_REGION'],
    modelEnvKeys: ['AWS_BEDROCK_MODEL', 'BEDROCK_MODEL'],
    defaultBaseURL: 'https://bedrock-runtime.<region>.amazonaws.com',
    defaultModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    models: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-opus-20240229-v1:0',
      'meta.llama3-1-70b-instruct-v1:0',
      'mistral.mistral-large-2407-v1:0',
    ],
    notes: 'Bundled plugin transport: src/plugins/bundled/bedrock-provider.ts',
  },
  {
    id: 'copilot',
    aliases: ['github-copilot', 'github_copilot'],
    label: 'GitHub Copilot',
    authMode: 'oauth',
    apiMode: 'copilot-chat',
    runtimeSupport: 'plugin-native',
    priority: 402,
    apiKeyEnvKeys: ['GITHUB_COPILOT_TOKEN', 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
    baseUrlEnvKeys: [],
    modelEnvKeys: ['COPILOT_MODEL'],
    defaultBaseURL: 'https://api.githubcopilot.com',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4.1', 'claude-sonnet-4'],
    notes: 'Bundled plugin transport: src/plugins/bundled/copilot-provider.ts',
  },
];

export const PLUGIN_NATIVE_PROVIDER_IDS = ['azure', 'bedrock', 'copilot'] as const;

export function getRuntimeProviderCatalog(): RuntimeProviderCatalogEntry[] {
  return [...RUNTIME_PROVIDER_CATALOG];
}

export function getDirectRuntimeProviderCatalog(): RuntimeProviderCatalogEntry[] {
  return RUNTIME_PROVIDER_CATALOG.filter((entry) => entry.runtimeSupport === 'direct');
}

export function getPluginNativeRuntimeProviderCatalog(): RuntimeProviderCatalogEntry[] {
  return RUNTIME_PROVIDER_CATALOG.filter((entry) => entry.runtimeSupport === 'plugin-native');
}

export function findRuntimeProvider(idOrAlias: string | undefined | null): RuntimeProviderCatalogEntry | undefined {
  if (!idOrAlias) return undefined;
  const normalized = normalizeProviderId(idOrAlias);
  return RUNTIME_PROVIDER_CATALOG.find((entry) => {
    if (entry.id === normalized) return true;
    return entry.aliases?.some((alias) => normalizeProviderId(alias) === normalized) ?? false;
  });
}

export function resolveProviderFromCatalog(
  options: ProviderCatalogResolveOptions = {},
): ResolvedRuntimeProvider | null {
  const env = options.env ?? process.env;
  const override = normalizeProviderId(options.providerOverride ?? env.CODEBUDDY_PROVIDER);

  if (override) {
    const entry = findRuntimeProvider(override);
    if (!entry || entry.runtimeSupport !== 'direct') return null;
    return resolveEntry(entry, env, 'override', options);
  }

  if (options.hasChatGptOAuth) {
    const chatgpt = findRuntimeProvider('chatgpt');
    if (chatgpt) return resolveEntry(chatgpt, env, 'oauth', options);
  }

  // Imported free-tier providers (priority >= 300) are NEVER auto-selected: a stray COHERE_/CEREBRAS_/…
  // _API_KEY exported for another tool must not hijack detection away from a configured custom endpoint
  // or a historical provider. They stay fully usable when chosen explicitly (CODEBUDDY_PROVIDER, --profile,
  // `buddy provider use <id>`).
  const ordered = getDirectRuntimeProviderCatalog()
    .filter((entry) => entry.id !== 'chatgpt' && entry.id !== 'custom' && entry.priority < AUTO_DETECT_PRIORITY_CEILING)
    .sort((a, b) => a.priority - b.priority);

  for (const entry of ordered) {
    if (!isEntryConfigured(entry, env)) continue;
    return resolveEntry(entry, env, 'environment', options);
  }

  const custom = findRuntimeProvider('custom');
  if (custom && isEntryConfigured(custom, env)) {
    return resolveEntry(custom, env, 'environment', options);
  }

  return null;
}

export function resolvePluginRuntimeProvider(
  idOrAlias: string,
  env: EnvLike = process.env,
): ResolvedPluginRuntimeProvider | null {
  const entry = findRuntimeProvider(idOrAlias);
  if (!entry || entry.runtimeSupport !== 'plugin-native') return null;

  const baseURL = resolvePluginBaseURL(entry, env);
  const defaultModel = firstEnvValue(env, entry.modelEnvKeys) || entry.defaultModel;
  const credentialSources = [
    ...entry.apiKeyEnvKeys.filter((key) => hasAnyEnvValue(env, [key])),
    ...entry.baseUrlEnvKeys.filter((key) => hasAnyEnvValue(env, [key])),
  ];

  return {
    provider: entry.id,
    label: entry.label,
    apiMode: entry.apiMode,
    authMode: entry.authMode,
    runtimeSupport: 'plugin-native',
    pluginId: `bundled-${entry.id === 'azure' ? 'azure-openai' : entry.id}`,
    configured: isProviderConfigured(entry, env, false),
    credentialSources,
    ...(baseURL ? { baseURL } : {}),
    defaultModel,
    ...(entry.notes ? { notes: entry.notes } : {}),
  };
}

export function getProviderEnvSummary(entry: RuntimeProviderCatalogEntry): string {
  if (entry.id === 'chatgpt') return 'CODEBUDDY_CHATGPT_OAUTH';
  if (entry.authMode === 'local' && entry.baseUrlEnvKeys.length > 0) {
    return entry.baseUrlEnvKeys.join(' | ');
  }
  if (entry.apiKeyEnvKeys.length > 0) return entry.apiKeyEnvKeys.join(' | ');
  if (entry.baseUrlEnvKeys.length > 0) return entry.baseUrlEnvKeys.join(' | ');
  return 'none';
}

export function isProviderConfigured(
  entry: RuntimeProviderCatalogEntry,
  env: EnvLike = process.env,
  hasChatGptOAuth = false,
): boolean {
  if (entry.id === 'chatgpt') return hasChatGptOAuth;
  return isEntryConfigured(entry, env);
}

function resolveEntry(
  entry: RuntimeProviderCatalogEntry,
  env: EnvLike,
  source: ResolvedRuntimeProvider['source'],
  options: ProviderCatalogResolveOptions,
): ResolvedRuntimeProvider | null {
  if (entry.id === 'chatgpt' && !options.hasChatGptOAuth) {
    return null;
  }

  const apiKey = firstEnvValue(env, entry.apiKeyEnvKeys) || entry.apiKeyPlaceholder || '';
  const baseURL = normalizeProviderBaseURL(
    firstEnvValue(env, entry.baseUrlEnvKeys) || entry.defaultBaseURL,
    entry,
  );
  const defaultModel = firstEnvValue(env, entry.modelEnvKeys) || entry.defaultModel;

  if (options.requireConfigured && !apiKey && entry.authMode === 'api-key') {
    return null;
  }

  return {
    provider: entry.id,
    label: entry.label,
    apiMode: entry.apiMode,
    authMode: entry.authMode,
    apiKey,
    baseURL,
    defaultModel,
    source,
  };
}

function isEntryConfigured(entry: RuntimeProviderCatalogEntry, env: EnvLike): boolean {
  if (entry.runtimeSupport === 'plugin-native') {
    if (entry.id === 'azure') {
      return hasAnyEnvValue(env, ['AZURE_OPENAI_ENDPOINT'])
        && hasAnyEnvValue(env, ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_AD_TOKEN']);
    }
    if (entry.id === 'bedrock') {
      return hasAnyEnvValue(env, ['AWS_BEDROCK_REGION', 'AWS_REGION'])
        && hasAnyEnvValue(env, ['AWS_ACCESS_KEY_ID'])
        && hasAnyEnvValue(env, ['AWS_SECRET_ACCESS_KEY']);
    }
    if (entry.id === 'copilot') {
      return hasAnyEnvValue(env, ['GITHUB_COPILOT_TOKEN', 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']);
    }
  }

  if (entry.authMode === 'local') {
    return hasAnyEnvValue(env, entry.baseUrlEnvKeys);
  }

  if (entry.authMode === 'api-key') {
    return hasAnyEnvValue(env, entry.apiKeyEnvKeys);
  }

  return false;
}

function firstEnvValue(env: EnvLike, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function hasAnyEnvValue(env: EnvLike, keys: string[]): boolean {
  return firstEnvValue(env, keys) !== undefined;
}

function normalizeProviderId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/^bundled-/, '');
}

/** Entries at or above this priority (imported free tiers) are opt-in only: excluded from env auto-detection. */
export const AUTO_DETECT_PRIORITY_CEILING = 300;

function normalizeProviderBaseURL(value: string, entry: RuntimeProviderCatalogEntry): string {
  let baseURL = value.trim();

  // Local runtimes whose endpoint ends in /v1: accept HOST:PORT, add scheme + /v1 (lemonade keeps its /api/v1).
  const v1Local = entry.id === 'ollama' || entry.id === 'lmstudio' || entry.id === 'vllm' || entry.id === 'omniroute';
  if (v1Local && !/^https?:\/\//i.test(baseURL)) {
    baseURL = `http://${baseURL}`;
  }

  if (v1Local) {
    const withoutSlash = baseURL.replace(/\/+$/, '');
    if (/\/v1$/i.test(withoutSlash)) return withoutSlash;
    return `${withoutSlash}/v1`;
  }

  return baseURL.replace(/\/+$/, '');
}

function resolvePluginBaseURL(entry: RuntimeProviderCatalogEntry, env: EnvLike): string | undefined {
  if (entry.id === 'azure') {
    return firstEnvValue(env, ['AZURE_OPENAI_ENDPOINT'])?.replace(/\/+$/, '');
  }
  if (entry.id === 'bedrock') {
    const region = firstEnvValue(env, ['AWS_BEDROCK_REGION', 'AWS_REGION']);
    return region ? `https://bedrock-runtime.${region}.amazonaws.com` : undefined;
  }
  return entry.defaultBaseURL;
}
