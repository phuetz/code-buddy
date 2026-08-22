/**
 * Canonical content-sensitivity tier for the whole media production fleet.
 *
 * A single source of truth so routers, planners and companion selfies all agree
 * on what "safe / sensual / explicit" means. `safe` is advertiser-safe public
 * material; anything else is private and must stay on controlled infrastructure.
 *
 * @module media/content-tier
 */

/** Ordered from public-safe to fully private. */
export const CONTENT_TIERS = ['safe', 'sensual', 'explicit'] as const;

export type ContentTier = (typeof CONTENT_TIERS)[number];

/** Narrow an untrusted value to a {@link ContentTier}. */
export function isContentTier(value: unknown): value is ContentTier {
  return typeof value === 'string' && (CONTENT_TIERS as readonly string[]).includes(value);
}

/**
 * True for any tier that must never leave controlled local infrastructure
 * (i.e. everything except advertiser-safe `safe`).
 *
 * This expects an already-narrowed {@link ContentTier}: it does NOT narrow or
 * fail-closed on untrusted input at runtime (any non-`safe` string would still
 * type-error at the call site, and an unchecked cast would be treated as
 * private only incidentally). Validate unknown values with {@link isContentTier}
 * before calling.
 */
export function isPrivateTier(tier: ContentTier): boolean {
  return tier !== 'safe';
}
