/**
 * Honest one-line provider failure for Lisa on channels.
 *
 * Replaces « je n'ai pas réussi à formuler une réponse fiable » with the
 * real reason (quota until <time>, model missing, too slow).
 *
 * Failover hook: generation already goes through CodeBuddyClient.chat
 * (`COMPANION_CHANNEL_FAILOVER_SEAM`). When feat/provider-fallback-2026-09-06
 * merges, that client retries first; this module only speaks if nothing
 * recovered. Do not duplicate the fallback chain here.
 */

import { classifyProviderError } from '../codebuddy/provider-error-classifier.js';
import { COMPANION_CHANNEL_FAILOVER_SEAM } from './companion-channel-turn.js';

export { COMPANION_CHANNEL_FAILOVER_SEAM };

export type ChannelProviderFailureKind =
  | 'quota'
  | 'credits'
  | 'model_unavailable'
  | 'timeout'
  | 'unreachable'
  | 'unknown';

export interface ChannelProviderFailure {
  kind: ChannelProviderFailureKind;
  resetsAt?: Date;
  raw: string;
}

function getMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err ?? '');
}

function parseResetsAt(message: string, nowMs: number): Date | undefined {
  const seconds = message.match(/resets_in_seconds"?\s*[:=]\s*"?(\d+)/i);
  if (seconds?.[1]) {
    return new Date(nowMs + Number(seconds[1]) * 1000);
  }
  const resetsAt = message.match(/resets_at"?\s*[:=]\s*"?(\d{10,13})/i);
  if (resetsAt?.[1]) {
    const n = Number(resetsAt[1]);
    return new Date(n > 1e12 ? n : n * 1000);
  }
  return undefined;
}

function formatUntil(when: Date, nowMs: number): string {
  const deltaMs = when.getTime() - nowMs;
  const time = when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (deltaMs > 18 * 60 * 60 * 1000) {
    const day = when.toLocaleDateString('fr-FR', { weekday: 'long' });
    return `${day} ${time}`;
  }
  return time;
}

export function classifyChannelProviderFailure(
  err: unknown,
  nowMs: number = Date.now(),
): ChannelProviderFailure {
  const raw = getMessage(err);
  const lower = raw.toLowerCase();
  const classified = classifyProviderError(err, nowMs);
  const resetsAt = parseResetsAt(raw, nowMs);

  if (
    lower.includes('usage_limit_reached') ||
    classified.reason === 'quota_exhausted' ||
    (classified.status === 429 && lower.includes('limit'))
  ) {
    return { kind: 'quota', raw, ...(resetsAt ? { resetsAt } : {}) };
  }
  if (
    lower.includes('out_of_credits') ||
    lower.includes('insufficient_quota') ||
    (classified.status === 403 && (lower.includes('credit') || lower.includes('quota')))
  ) {
    return { kind: 'credits', raw };
  }
  if (
    classified.reason === 'model_not_found' ||
    lower.includes('model not found') ||
    lower.includes('model_not_found') ||
    (classified.status === 404 && lower.includes('model'))
  ) {
    return { kind: 'model_unavailable', raw };
  }
  if (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    (err && typeof err === 'object' && (err as { name?: string }).name === 'ChannelTurnTimeoutError')
  ) {
    return { kind: 'timeout', raw };
  }
  if (classified.reason === 'network' || classified.reason === 'unreachable') {
    return { kind: 'unreachable', raw };
  }
  if (classified.reason === 'quota_exhausted') {
    return { kind: 'quota', raw, ...(resetsAt ? { resetsAt } : {}) };
  }
  return { kind: 'unknown', raw };
}

export function formatCompanionProviderFailure(
  failure: ChannelProviderFailure,
  options: { nowMs?: number; copine?: boolean } = {},
): string {
  const nowMs = options.nowMs ?? Date.now();
  const copine = options.copine !== false;
  switch (failure.kind) {
    case 'quota': {
      const until = failure.resetsAt ? formatUntil(failure.resetsAt, nowMs) : undefined;
      if (until) {
        return copine
          ? `Mon quota de ce côté est atteint jusqu'à ${until} — je te le dis plutôt que d'inventer.`
          : `Quota atteint jusqu'à ${until}.`;
      }
      return copine
        ? 'Mon quota de ce côté est atteint pour le moment — je te le dis plutôt que d\'inventer.'
        : 'Quota du fournisseur atteint pour le moment.';
    }
    case 'credits':
      return copine
        ? 'Plus de crédits de ce côté, je ne peux pas te répondre par là pour l\'instant.'
        : 'Crédits du fournisseur épuisés.';
    case 'model_unavailable':
      return copine
        ? 'Ce modèle n\'est pas disponible ici — il faudrait en pointer un que ce fournisseur sert vraiment.'
        : 'Modèle indisponible chez ce fournisseur.';
    case 'timeout':
      return copine
        ? 'C\'était trop long de mon côté. Renvoie-moi ta phrase, je repars plus léger.'
        : 'La génération a dépassé le délai.';
    case 'unreachable':
      return copine
        ? 'Je n\'arrive pas à joindre le modèle local pour le moment.'
        : 'Fournisseur injoignable.';
    default:
      return copine
        ? 'Je n\'ai pas réussi à formuler une réponse fiable. Dis-moi simplement quelle partie tu veux que je reprenne.'
        : 'Je n\'ai pas réussi à formuler une réponse fiable.';
  }
}

export function speakChannelProviderFailure(
  err: unknown,
  options: { nowMs?: number; copine?: boolean } = {},
): string {
  return formatCompanionProviderFailure(
    classifyChannelProviderFailure(err, options.nowMs),
    options,
  );
}
