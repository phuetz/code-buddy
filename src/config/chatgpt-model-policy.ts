import { MODEL_DEFAULTS } from './model-defaults.js';
/** Offline policy only; account catalogue metadata takes priority. */
export const CHATGPT_OAUTH_DEFAULT_MODEL = MODEL_DEFAULTS.chatgpt;
export const CHATGPT_OAUTH_API_ALIAS = 'gpt-5.6';
export const CHATGPT_OAUTH_API_ALIAS_TARGET = 'gpt-5.6-sol';
export const CHATGPT_OAUTH_SAFE_FALLBACK_MODEL = 'gpt-5.5';
export const CHATGPT_CODEX_CLIENT_VERSION = '0.159.0';
export const CHATGPT_ULTRA_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6.1-sol'];
export const CHATGPT_MAX_MODELS = ['gpt-5.6-luna', 'gpt-6-luna'];
