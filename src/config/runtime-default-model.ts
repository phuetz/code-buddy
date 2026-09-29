import { codeBuddyEnv } from './legacy-env.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';
import { FALLBACK_MODEL } from './model-defaults.js';

/** Secondary clients use the active provider when their caller did not pass a model. */
export function runtimeDefaultModel(): string {
  return codeBuddyEnv('MODEL') || detectProviderFromEnv()?.defaultModel || FALLBACK_MODEL;
}
