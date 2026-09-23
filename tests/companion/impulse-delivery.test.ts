import { describe, expect, it } from 'vitest';
import {
  formatImpulseForChannel,
  isImpulseDeliveryEnabled,
  pickDeliverableImpulse,
} from '../../src/companion/impulse-delivery.js';
import type { CompanionImpulse } from '../../src/companion/impulses.js';

function impulse(
  partial: Partial<CompanionImpulse> & Pick<CompanionImpulse, 'id' | 'priority'>,
): CompanionImpulse {
  return {
    kind: 'readiness',
    title: partial.title ?? partial.id,
    message: partial.message ?? partial.title ?? partial.id,
    evidence: [],
    tags: [],
    ...partial,
  };
}

describe('impulse delivery', () => {
  it('stays off by default', () => {
    expect(isImpulseDeliveryEnabled({})).toBe(false);
  });

  it('arms when proactive is already on', () => {
    expect(isImpulseDeliveryEnabled({ CODEBUDDY_COMPANION_PROACTIVE: 'true' })).toBe(true);
  });

  it('prefers a high-priority impulse that was not just sent', () => {
    const picked = pickDeliverableImpulse(
      [
        impulse({ id: 'old', priority: 'high' }),
        impulse({ id: 'next', priority: 'high' }),
        impulse({ id: 'low', priority: 'low' }),
      ],
      'old',
    );
    expect(picked?.id).toBe('next');
  });

  it('formats the spoken channel line from the message', () => {
    expect(
      formatImpulseForChannel(
        impulse({ id: 'x', priority: 'medium', title: 'Brief', message: 'Pense à souffler.' }),
      ),
    ).toBe('Pense à souffler.');
  });
});
