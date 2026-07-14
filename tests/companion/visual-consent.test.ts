import { describe, expect, it, vi } from 'vitest';

import {
  VisualConsentGate,
  isVisualConsentConfirmation,
  isVisualConsentDecline,
} from '../../src/companion/visual-consent.js';

describe('two-turn visual consent', () => {
  it('preserves the original visual target after a natural confirmation', () => {
    const gate = new VisualConsentGate(() => 1_000);
    gate.request('Regarde mon tournevis rouge.');

    expect(gate.consume('Oui, vas-y.')).toEqual({
      decision: 'confirmed',
      utterance: 'Regarde mon tournevis rouge.',
    });
    expect(gate.consume('oui')).toEqual({ decision: 'none' });
  });

  it('recognizes ordinary confirmations and prioritizes an explicit refusal', () => {
    for (const reply of ['oui', "d'accord", 'bien sûr', 'vas-y', 'tu peux', 'ouvre-la']) {
      expect(isVisualConsentConfirmation(reply), reply).toBe(true);
    }
    for (const reply of ['non', "n'ouvre pas", 'pas maintenant', 'oui, finalement non']) {
      expect(isVisualConsentDecline(reply), reply).toBe(true);
      expect(isVisualConsentConfirmation(reply), reply).toBe(false);
    }
  });

  it('expires safely and does not treat a later yes as camera permission', () => {
    let now = 10_000;
    const gate = new VisualConsentGate(() => now, 5_000);
    gate.request('Regarde ma plante.');
    now += 5_001;

    expect(gate.consume('oui')).toEqual({ decision: 'expired' });
    expect(gate.consume('oui')).toEqual({ decision: 'none' });
  });

  it('physically clears the in-memory request when the timer expires', () => {
    vi.useFakeTimers();
    try {
      const gate = new VisualConsentGate(() => Date.now(), 1_000);
      gate.request('Regarde ma plante.');
      vi.advanceTimersByTime(1_000);

      expect(gate.consume('oui')).toEqual({ decision: 'none' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes an unrelated next turn so consent cannot drift across topics', () => {
    const gate = new VisualConsentGate(() => 1_000);
    gate.request('Regarde mon livre.');

    expect(gate.consume('Quelle heure est-il ?')).toEqual({ decision: 'unrelated' });
    expect(gate.consume('oui')).toEqual({ decision: 'none' });
  });

  it('can revoke a pending request when the permission question was not spoken', () => {
    const gate = new VisualConsentGate(() => 1_000);
    gate.request('Regarde mon livre.');
    gate.cancel();

    expect(gate.consume('oui')).toEqual({ decision: 'none' });
  });

  it('does not let an older interrupted turn revoke a newer request', () => {
    const gate = new VisualConsentGate(() => 1_000);
    const oldRequest = gate.request('Regarde mon livre.');
    gate.request('Regarde ma plante.');
    gate.cancel(oldRequest!);

    expect(gate.consume('oui')).toEqual({
      decision: 'confirmed',
      utterance: 'Regarde ma plante.',
    });
  });

  it('bounds the in-memory request even before it reaches the camera analyzer', () => {
    const gate = new VisualConsentGate(() => 1_000);
    gate.request(`Regarde ${'cet objet '.repeat(200)}`);

    const result = gate.consume('oui');
    expect(result.decision).toBe('confirmed');
    if (result.decision !== 'confirmed') throw new Error('expected a confirmed visual request');
    expect(result.utterance.length).toBeLessThanOrEqual(600);
  });
});
