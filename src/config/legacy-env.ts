import { logger } from '../utils/logger.js';

let warned = false;

/** Neutral names win. The old GROK_* names remain process-wide deprecated aliases. */
export function codeBuddyEnv(
  suffix: 'API_KEY' | 'BASE_URL' | 'MODEL',
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const primary = env[`CODEBUDDY_${suffix}`]?.trim();
  const legacy = env[`GROK_${suffix}`]?.trim();
  if (legacy && !warned) {
    warned = true;
    logger.warn('GROK_API_KEY, GROK_BASE_URL and GROK_MODEL are deprecated; use CODEBUDDY_API_KEY, CODEBUDDY_BASE_URL and CODEBUDDY_MODEL.');
  }
  return primary || legacy || undefined;
}

/** xAI-only credentials. A neutral key belongs to xAI only when explicitly routed there. */
export function xaiApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const legacy = env.GROK_API_KEY?.trim();
  if (legacy) codeBuddyEnv('API_KEY', env);
  const selected = ['xai', 'grok'].includes(env.CODEBUDDY_PROVIDER?.trim().toLowerCase() || '');
  return (selected ? env.CODEBUDDY_API_KEY?.trim() : undefined) || env.XAI_API_KEY?.trim() || legacy || undefined;
}

export function xaiBaseURL(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const legacy = env.GROK_BASE_URL?.trim();
  if (legacy) codeBuddyEnv('BASE_URL', env);
  const selected = ['xai', 'grok'].includes(env.CODEBUDDY_PROVIDER?.trim().toLowerCase() || '');
  return (selected ? env.CODEBUDDY_BASE_URL?.trim() : undefined) || env.XAI_BASE_URL?.trim() || legacy || undefined;
}

/** Login probes xAI inference with an xAI model, independent of a generic session model. */
export function xaiProbeModel(env: NodeJS.ProcessEnv = process.env): string {
  const legacy = env.GROK_MODEL?.trim();
  if (legacy) codeBuddyEnv('MODEL', env);
  return env.XAI_MODEL?.trim() || legacy || 'grok-3';
}
