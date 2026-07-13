/** Durable opt-in marker for a Cowork session that shares Lisa's personal thread. */
export const COMPANION_THREAD_TAG = 'companion';

const COMPANION_THREAD_TAGS = new Set([COMPANION_THREAD_TAG, 'lisa']);

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase();
}

export function isCompanionThreadTags(tags: readonly string[] | undefined): boolean {
  return Boolean(tags?.some((tag) => COMPANION_THREAD_TAGS.has(normalizeTag(tag))));
}

export function setCompanionThreadLinked(
  tags: readonly string[] | undefined,
  linked: boolean,
): string[] {
  const seen = new Set<string>();
  const preserved = (tags ?? []).flatMap((rawTag) => {
    const tag = rawTag.trim();
    const key = normalizeTag(tag);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [tag];
  });

  if (linked) {
    return isCompanionThreadTags(preserved)
      ? preserved
      : [...preserved, COMPANION_THREAD_TAG];
  }
  return preserved.filter((tag) => !COMPANION_THREAD_TAGS.has(normalizeTag(tag)));
}
