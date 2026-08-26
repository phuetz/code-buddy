/**
 * prompt-enhance-model — real test (no mocks): vagueness detection + enrichment.
 */
import { describe, expect, it } from 'vitest';
import { isVague, enhancePrompt } from '../src/renderer/components/studio/prompt-enhance-model';

describe('isVague', () => {
  it('flags short or featureless prompts', () => {
    expect(isVague('une app')).toBe(true);
    expect(isVague('quelque chose de beau et moderne stp')).toBe(true); // no feature
    expect(isVague('une todo app en react avec thème sombre et filtres')).toBe(false);
  });
});

describe('enhancePrompt', () => {
  it('suggests stack, style and features for a bare prompt', () => {
    const { suggestions, enriched } = enhancePrompt('un truc');
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(enriched.toLowerCase()).toContain('react');
    expect(enriched.toLowerCase()).toContain('responsive');
  });

  it('does not re-add what is already present', () => {
    const { enriched } = enhancePrompt('une todo app en React avec thème sombre');
    // stack + style + feature all present → nothing appended
    expect(enriched).toBe('une todo app en React avec thème sombre');
  });

  it('returns default guidance for an empty prompt', () => {
    const r = enhancePrompt('   ');
    expect(r.enriched).toBe('');
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it('acknowledges an already-precise prompt', () => {
    const { suggestions } = enhancePrompt('un dashboard React avec des graphiques et un thème sombre');
    expect(suggestions.some((s) => /already precise/.test(s))).toBe(true);
  });
});
