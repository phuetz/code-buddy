import type { ModelRouterConfig, TaskType } from '../utils/model-router.js';

/** Versioned data only. USD per million uncached text tokens, standard API tier.
 * checkedAt is the date the quoted source was reviewed; legacy rows are unverified estimates.
 * Cache, batch, long context, region and subscriptions need separate accounting.
 * scope states when a verified base rate applies; unverified rows retain project estimates.
 */
export const MODEL_PRICE_DATA: Record<string, { inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number; source: string; checkedAt: string; verified: boolean; scope?: string }> = {
  'grok-4.6': { inputPerMillion: 2, outputPerMillion: 6, source: 'https://docs.x.ai/developers/pricing', checkedAt: '2026-09-29', verified: true, scope: 'global, prompt < 200k' },
  'grok-4': { inputPerMillion: 3, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-3': { inputPerMillion: 3, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-3-fast': { inputPerMillion: 0.6, outputPerMillion: 4, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-3-mini': { inputPerMillion: 0.3, outputPerMillion: 0.5, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-code-fast': { inputPerMillion: 0.2, outputPerMillion: 1.5, source: 'https://x.ai/news/grok-code-fast-1', checkedAt: '2026-09-29', verified: true },
  'grok-2': { inputPerMillion: 2, outputPerMillion: 10, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-2-mini': { inputPerMillion: 0.2, outputPerMillion: 1, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gpt-6.1-sol': { inputPerMillion: 2, outputPerMillion: 10, cachedInputPerMillion: 0.1, source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol', checkedAt: '2026-09-30', verified: true, scope: 'standard, prompt <= 272K; longer prompts have higher rates' },
  'gpt-5.6-sol': { inputPerMillion: 5, outputPerMillion: 30, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gpt-5.6-luna': { inputPerMillion: 1, outputPerMillion: 6, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gpt-5.6': { inputPerMillion: 5, outputPerMillion: 30, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10, source: 'https://developers.openai.com/api/docs/models/gpt-5', checkedAt: '2026-09-29', verified: true },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8, source: 'https://developers.openai.com/api/docs/models/gpt-4.1', checkedAt: '2026-09-29', verified: true },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10, cachedInputPerMillion: 1.25, source: 'https://developers.openai.com/api/docs/models/gpt-4o', checkedAt: '2026-09-29', verified: true },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, cachedInputPerMillion: 0.075, source: 'https://developers.openai.com/api/docs/models/gpt-4o-mini', checkedAt: '2026-09-29', verified: true },
  'gpt-4-turbo': { inputPerMillion: 10, outputPerMillion: 30, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gpt-4': { inputPerMillion: 30, outputPerMillion: 60, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gpt-3.5-turbo': { inputPerMillion: 0.5, outputPerMillion: 1.5, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-opus-4': { inputPerMillion: 15, outputPerMillion: 75, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-sonnet-4': { inputPerMillion: 3, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-haiku-4': { inputPerMillion: 0.8, outputPerMillion: 4, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-3-opus': { inputPerMillion: 15, outputPerMillion: 75, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-3-sonnet': { inputPerMillion: 3, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-3.5-sonnet': { inputPerMillion: 3, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10, source: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-09-29', verified: true, scope: 'standard paid, prompt <= 200k' },
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5, source: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-09-29', verified: true },
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4, source: 'https://ai.google.dev/gemini-api/docs/pricing', checkedAt: '2026-09-29', verified: true },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'local': { inputPerMillion: 0, outputPerMillion: 0, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'ollama': { inputPerMillion: 0, outputPerMillion: 0, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'lmstudio': { inputPerMillion: 0, outputPerMillion: 0, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-4-1-fast': { inputPerMillion: 0.2, outputPerMillion: 0.5, source: 'https://x.ai/news/grok-4-1-fast', checkedAt: '2026-09-29', verified: true, scope: 'global, standard tokens' },
  'grok-4-fast': { inputPerMillion: 0.2, outputPerMillion: 0.5, source: 'https://x.ai/news/grok-4-fast', checkedAt: '2026-09-29', verified: true, scope: 'global, prompt < 128k' },
  'grok-code-fast-1': { inputPerMillion: 0.2, outputPerMillion: 1.5, source: 'https://x.ai/news/grok-code-fast-1', checkedAt: '2026-09-29', verified: true },
  'grok-3-latest': { inputPerMillion: 3, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-2-latest': { inputPerMillion: 2, outputPerMillion: 10, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-4-latest': { inputPerMillion: 3, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'mistral-medium-latest': { inputPerMillion: 1.5, outputPerMillion: 7.5, source: 'https://docs.mistral.ai/inference/pricing', checkedAt: '2026-09-29', verified: true },
  'mistral-medium': { inputPerMillion: 1.5, outputPerMillion: 7.5, source: 'https://docs.mistral.ai/inference/pricing', checkedAt: '2026-09-29', verified: true },
  'mistral-large-latest': { inputPerMillion: 0.5, outputPerMillion: 1.5, source: 'https://docs.mistral.ai/inference/pricing', checkedAt: '2026-09-29', verified: true, scope: 'Mistral Large 3; moving latest alias' },
  'mistral-large': { inputPerMillion: 0.5, outputPerMillion: 1.5, source: 'https://docs.mistral.ai/inference/pricing', checkedAt: '2026-09-29', verified: false, scope: 'current family estimate; unversioned slug identity unconfirmed' },
  'mistral-small-latest': { inputPerMillion: 0.15, outputPerMillion: 0.6, source: 'https://docs.mistral.ai/inference/pricing', checkedAt: '2026-09-29', verified: true, scope: 'Mistral Small 4; moving latest alias' },
  'mistral-small': { inputPerMillion: 0.15, outputPerMillion: 0.6, source: 'https://docs.mistral.ai/inference/pricing', checkedAt: '2026-09-29', verified: false, scope: 'current family estimate; unversioned slug identity unconfirmed' },
  'mixtral-8x7b-latest': { inputPerMillion: 0.5, outputPerMillion: 2, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'mixtral-8x7b': { inputPerMillion: 0.5, outputPerMillion: 2, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-3-reasoning': { inputPerMillion: 5, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-2-vision': { inputPerMillion: 2, outputPerMillion: 10, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'grok-beta': { inputPerMillion: 5, outputPerMillion: 15, source: 'repository estimate at 3c1289862', checkedAt: '2026-09-29', verified: false },
  'claude-opus-4-6': { inputPerMillion: 5, outputPerMillion: 25, source: 'https://docs.anthropic.com/en/docs/about-claude/pricing', checkedAt: '2026-09-29', verified: true },
  'claude-opus-4-5': { inputPerMillion: 5, outputPerMillion: 25, source: 'https://platform.claude.com/docs/en/models/opus-4-5/overview', checkedAt: '2026-09-29', verified: true },
  'claude-sonnet-4-5-20250929': { inputPerMillion: 3, outputPerMillion: 15, source: 'https://docs.anthropic.com/en/docs/about-claude/pricing', checkedAt: '2026-09-29', verified: true },
  'claude-haiku-4-5-20251001': { inputPerMillion: 1, outputPerMillion: 5, source: 'https://docs.anthropic.com/en/docs/about-claude/pricing', checkedAt: '2026-09-29', verified: true },
};

export const UNKNOWN_MODEL_PRICE = { inputPerMillion: 3, outputPerMillion: 15 };

export const MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  gpt4: 'gpt-4o',
  'gpt-5.6': 'gpt-5.6-sol',
  gemini: 'gemini-2.5-flash',
  grok: 'grok-code-fast-1',
  flash: 'gemini-2.5-flash',
  mini: 'gpt-4o-mini',
};

export const TOML_DEFAULT_ACTIVE_MODEL = 'grok-code-fast';
export const TOML_MODEL_DATA: Record<string, { provider: string; model_id: string; max_context_tokens: number; description: string }> = {
  'grok-4-fast': { provider: 'xai', model_id: 'grok-4-1-fast', max_context_tokens: 2000000, description: 'Grok 4.1 Fast (2M context)' },
  'grok-4': { provider: 'xai', model_id: 'grok-4-latest', max_context_tokens: 256000, description: 'Grok 4 (256K context)' },
  'grok-code-fast': { provider: 'xai', model_id: 'grok-code-fast-1', max_context_tokens: 256000, description: 'Fast Grok model optimized for code' },
  'grok-3': { provider: 'xai', model_id: 'grok-3-latest', max_context_tokens: 131072, description: 'Full Grok 3 model' },
  'claude-opus': { provider: 'anthropic', model_id: 'claude-opus-4-6', max_context_tokens: 200000, description: 'Claude Opus 4.6 (128K output)' },
  'claude-sonnet': { provider: 'anthropic', model_id: 'claude-sonnet-4-5-20250929', max_context_tokens: 200000, description: 'Claude Sonnet 4.5 (64K output)' },
  'claude-haiku': { provider: 'anthropic', model_id: 'claude-haiku-4-5-20251001', max_context_tokens: 200000, description: 'Claude Haiku 4.5 (64K output, fastest)' },
  'gpt-5.6-sol': { provider: 'openai', model_id: 'gpt-5.6-sol', max_context_tokens: 1050000, description: 'GPT-5.6 Sol (1.05M context, 128K output, vision, max reasoning)' },
  'gpt-5': { provider: 'openai', model_id: 'gpt-5', max_context_tokens: 400000, description: 'GPT-5 (400K context, 128K output)' },
  'gpt-4o': { provider: 'openai', model_id: 'gpt-4o', max_context_tokens: 128000, description: 'GPT-4o' },
  'gemini-2.5': { provider: 'google', model_id: 'gemini-2.5-flash', max_context_tokens: 1000000, description: 'Gemini 2.5 Flash (1M context, 65K output)' },
  'gemini-2': { provider: 'google', model_id: 'gemini-2.0-flash', max_context_tokens: 1000000, description: 'Gemini 2.0 Flash (1M context)' },
};

export const ROUTER_MODEL_DATA: Record<string, { name: string; contextWindow: number; speed: 'fast' | 'medium' | 'slow'; capabilities: TaskType[] }> = {
  'grok-3-latest': { name: 'Grok 3', contextWindow: 131072, speed: 'medium', capabilities: ['planning', 'review', 'complex', 'docs', 'chat'] },
  'grok-3-fast': { name: 'Grok 3 Fast', contextWindow: 131072, speed: 'fast', capabilities: ['coding', 'search', 'debug', 'chat'] },
  'grok-code-fast-1': { name: 'Grok Code Fast', contextWindow: 65536, speed: 'fast', capabilities: ['coding', 'search', 'debug'] },
  'grok-2-latest': { name: 'Grok 2', contextWindow: 131072, speed: 'medium', capabilities: ['coding', 'chat', 'docs'] },
};

export const ROUTER_DEFAULT_DATA: ModelRouterConfig = {
  defaultModel: 'grok-code-fast-1',
  taskModels: {
    search: 'grok-code-fast-1', planning: 'grok-3-latest', coding: 'grok-code-fast-1',
    review: 'grok-3-latest', debug: 'grok-code-fast-1', docs: 'grok-3-latest',
    chat: 'grok-3-fast', complex: 'grok-3-latest',
  },
  autoSwitch: true, preferSpeed: false,
  fallbackChain: ['grok-3-fast', 'grok-2-latest', 'grok-code-fast-1'],
  enableFallback: true,
};

export const OPTIMIZATION_MODEL_DATA: Record<string, { tier: 'mini' | 'standard' | 'reasoning' | 'vision'; maxTokens: number; supportsVision: boolean; supportsToolUse: boolean; reasoning: 'basic' | 'standard' | 'extended' }> = {
  'grok-3-mini': { tier: 'mini', maxTokens: 8192, supportsVision: false, supportsToolUse: true, reasoning: 'basic' },
  'grok-3': { tier: 'standard', maxTokens: 32768, supportsVision: false, supportsToolUse: true, reasoning: 'standard' },
  'grok-3-reasoning': { tier: 'reasoning', maxTokens: 65536, supportsVision: false, supportsToolUse: true, reasoning: 'extended' },
  'grok-2-vision': { tier: 'vision', maxTokens: 8192, supportsVision: true, supportsToolUse: true, reasoning: 'standard' },
};

/** Billing classification for the cost tracker; identities live with the price data. */
export const SUBSCRIPTION_MODEL_IDS = {
  exact: ['gpt-5.2', 'gpt-5.5', 'codex-1', 'gpt-5.6-sol', 'gpt-5.6', 'codex'],
  prefixes: ['gpt-5.5-', 'gpt-5.6-', 'codex-mini', 'codex-'],
  contains: ['-codex'],
};

export const LOCAL_NO_COST_MODEL_IDS = {
  exact: ['ollama', 'lmstudio', 'local-model', 'mistral', 'mixtral'],
  prefixes: ['ollama/', 'llama', 'qwen', 'gemma', 'phi', 'codellama', 'deepseek', 'command-r', 'mistral:', 'mixtral:'],
};
