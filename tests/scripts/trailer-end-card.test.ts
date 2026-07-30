import { describe, expect, it } from 'vitest';

import {
  buildTrailerEndCardSpec,
  contrastRatio,
  END_CARD_MIN_CONTRAST,
} from '../../scripts/trailers/trailer-end-card.js';
import type { CommercialGateReceipt } from '../../scripts/trailers/trailer-commercial-gate.js';

const commercial: CommercialGateReceipt = {
  schemaVersion: 1,
  titleId: 'roman',
  title: 'Le Roman',
  manuscriptStatus: 'approved',
  expectedChapters: 40,
  presentChapters: 40,
  complete: true,
  approvedContentSha256: 'a'.repeat(64),
  measuredContentSha256: 'a'.repeat(64),
  cta: 'Lire maintenant',
  url: 'https://example.test/roman',
  status: 'approved-for-trailer-render',
};

describe('trailer end card', () => {
  it('is complete, mobile-safe, readable for four seconds, and non-overlapping', () => {
    const spec = buildTrailerEndCardSpec(commercial);
    expect(spec.durationSeconds).toBeGreaterThanOrEqual(4);
    expect(spec.boxes.map((box) => box.id)).toEqual([
      'title',
      'author',
      'status',
      'cta',
      'url',
    ]);
    for (const box of spec.boxes) {
      expect(box.x).toBeGreaterThanOrEqual(spec.safeMarginX);
      expect(box.y).toBeGreaterThanOrEqual(spec.safeMarginY);
      expect(box.x + box.width).toBeLessThanOrEqual(spec.width - spec.safeMarginX);
      expect(box.y + box.height).toBeLessThanOrEqual(spec.height - spec.safeMarginY);
      expect(contrastRatio(box.color, spec.background)).toBeGreaterThanOrEqual(
        END_CARD_MIN_CONTRAST,
      );
    }
    for (const [index, left] of spec.boxes.entries()) {
      for (const right of spec.boxes.slice(index + 1)) {
        const overlap = !(
          left.x + left.width <= right.x ||
          right.x + right.width <= left.x ||
          left.y + left.height <= right.y ||
          right.y + right.height <= left.y
        );
        expect(overlap, `${left.id}/${right.id}`).toBe(false);
      }
    }
  });
});
