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
  | 'ollama'
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
    defaultModel: 'gpt-5.5',
    apiKeyPlaceholder: 'oauth-chatgpt',
    models: ['gpt-5.5', 'gpt-5.1-codex', 'gpt-5-codex', 'codex-1'],
  },
  {
    id: 'ollama',
    label: 'Ollama',
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
    id: 'lmstudio',
    aliases: ['lm-studio', 'lm_studio'],
    label: 'LM Studio',
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
    models: ['local-model', 'qwen2.5-coder', 'llama-3.1-8b', 'mistral-7b'],
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
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
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
    defaultModel: 'openai/gpt-4o',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro'],
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
    id: 'deepseek',
    label: 'DeepSeek',
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 126,
    apiKeyEnvKeys: ['DEEPSEEK_API_KEY'],
    baseUrlEnvKeys: ['DEEPSEEK_BASE_URL'],
    modelEnvKeys: ['DEEPSEEK_MODEL'],
    defaultBaseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3.2'],
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
    authMode: 'api-key',
    apiMode: 'openai-compatible',
    runtimeSupport: 'direct',
    priority: 128,
    apiKeyEnvKeys: ['NVIDIA_API_KEY'],
    baseUrlEnvKeys: ['NVIDIA_BASE_URL', 'NVIDIA_NIM_BASE_URL'],
    modelEnvKeys: ['NVIDIA_MODEL', 'NVIDIA_NIM_MODEL'],
    defaultBaseURL: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'nvidia/llama-3.3-nemotron-super-49b-v1',
    models: ['nvidia/llama-3.3-nemotron-super-49b-v1', 'nvidia/llama-3.1-nemotron-ultra-253b-v1'],
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
    id: 'vllm',
    label: 'vLLM',
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

  const ordered = getDirectRuntimeProviderCatalog()
    .filter((entry) => entry.id !== 'chatgpt' && entry.id !== 'custom')
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

function normalizeProviderBaseURL(value: string, entry: RuntimeProviderCatalogEntry): string {
  let baseURL = value.trim();

  if ((entry.id === 'ollama' || entry.id === 'lmstudio' || entry.id === 'vllm') && !/^https?:\/\//i.test(baseURL)) {
    baseURL = `http://${baseURL}`;
  }

  if (entry.id === 'ollama' || entry.id === 'lmstudio' || entry.id === 'vllm') {
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
