/**
 * One discreet user-facing line per declared failover switch (and one on
 * return). Companion/Telegram inject it into the next spoken reply; the PWA
 * `status` payload peeks the same line. Silent when the flag is off.
 */
import { isDeclaredProviderFallbackEnabled } from './provider-failover-policy.js';

export const USER_FALLBACK_LINE = 'je passe sur mon cerveau local, réponses plus courtes';
export const USER_RETURN_LINE = 'je reviens sur le cerveau principal';

export type UserFacingFailoverKind = 'fallback' | 'return';

export interface UserFacingFailoverNotice {
  kind: UserFacingFailoverKind;
  text: string;
  seq: number;
}

let pending: UserFacingFailoverNotice | null = null;
let seq = 0;
const spokenSeqBySurface = new Map<string, number>();

export function recordUserFacingFailoverNotice(kind: UserFacingFailoverKind): void {
  if (!isDeclaredProviderFallbackEnabled()) return;
  seq += 1;
  pending = {
    kind,
    text: kind === 'fallback' ? USER_FALLBACK_LINE : USER_RETURN_LINE,
    seq,
  };
}

export function peekUserFacingFailoverNotice(): UserFacingFailoverNotice | null {
  if (!isDeclaredProviderFallbackEnabled()) return null;
  return pending;
}

export function consumeUserFacingFailoverNotice(surface = 'default'): string | null {
  if (!isDeclaredProviderFallbackEnabled() || !pending) return null;
  const last = spokenSeqBySurface.get(surface) ?? 0;
  if (pending.seq <= last) return null;
  spokenSeqBySurface.set(surface, pending.seq);
  return pending.text;
}

export function prependUserFacingFailoverNotice(text: string, surface = 'default'): string {
  const notice = consumeUserFacingFailoverNotice(surface);
  if (!notice) return text;
  if (!text.trim()) return notice;
  return `${notice}\n${text}`;
}

export function resetUserFacingFailoverNoticeForTests(): void {
  pending = null;
  seq = 0;
  spokenSeqBySurface.clear();
}
