/**
 * CreationsView tabs — smoke-guard the promoted deliverables home: the seven
 * functional studios are all present, uniquely identified, deck-first, and
 * each carries a lazy component (a renamed/removed panel fails the import).
 */
import { describe, expect, it } from 'vitest';
import { CREATIONS_TABS } from './CreationsView.js';

describe('CREATIONS_TABS', () => {
  it('exposes the seven functional studios, deck first', () => {
    expect(CREATIONS_TABS.map((t) => t.id)).toEqual(['deck', 'sheet', 'doc', 'pod', 'image', 'video', 'drive']);
  });

  it('has unique ids and non-empty French labels', () => {
    const ids = CREATIONS_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of CREATIONS_TABS) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.component).toBeTruthy();
      expect(t.icon).toBeTruthy();
    }
  });
});
