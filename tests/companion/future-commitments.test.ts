import { describe, expect, it } from 'vitest';
import { guardFutureCommitments } from '../../src/companion/future-commitments.js';

describe('future commitments in French', () => {
  it.each([
    'Je vais surveiller ce traitement.',
    'Je te préviens quand le build est terminé.',
    'Je te rappellerai ton train demain.',
    'Je vais te rappeler le train demain.',
    'Je te ferai un résumé plus tard.',
    'Je suivrai ce traitement et je te dirai quand il finit.',
    'Je garde un œil sur le build.',
    'Je vérifie demain et je reviens vers toi.',
    'Je te rappelle demain pour le train.',
    'Je vais m’en occuper plus tard.',
  ])('reformulates an unbacked promise: %s', (line) => {
    const result = guardFutureCommitments(line);
    expect(result.intervened).toBe(true);
    expect(result.text).not.toBe(line);
    expect(result.text).not.toMatch(/je (?:vais|te|suivrai|surveillerai|ferai)|je te dirai/i);
  });

  it('preserves an ordinary future and a negated promise', () => {
    for (const line of ['Je vais dormir.', 'Je ne vais pas surveiller ce traitement.', 'Tu me raconteras demain.']) {
      expect(guardFutureCommitments(line)).toEqual({ text: line, intervened: false });
    }
  });

  it('keeps other sentences and rejects a topic mismatch', () => {
    const result = guardFutureCommitments('Je suis là. Je te rappellerai le train demain. À bientôt.', [
      { kind: 'reminder', id: 'r-1', label: 'médicaments', mechanism: 'remind' },
    ]);
    expect(result.text).toContain('Je suis là.');
    expect(result.text).toContain('À bientôt.');
    expect(result.text).not.toContain('Je te rappellerai le train');
  });

  it('allows a matching registered reminder with a way to inspect and cancel it', () => {
    const result = guardFutureCommitments('Je te rappellerai le train demain.', [
      { kind: 'reminder', id: 'r-1', label: 'train', mechanism: 'remind' },
    ]);
    expect(result.intervened).toBe(false);
    expect(result.text).toContain('Je te rappellerai le train demain.');
    expect(result.text).toContain('r-1');
    expect(result.text).toMatch(/liste.*rappels/i);
    expect(result.text).toMatch(/supprimer.*rappel/i);
  });

  it('a reminder never authorizes a monitoring promise', () => {
    const result = guardFutureCommitments('Je vais surveiller ce traitement.', [
      { kind: 'reminder', id: 'r-1', label: 'traitement', mechanism: 'remind' },
    ]);
    expect(result.intervened).toBe(true);
  });

  it('does not let a supported reminder carry an unsupported second promise', () => {
    const result = guardFutureCommitments('Je te rappellerai le train et je surveillerai le traitement.', [
      { kind: 'reminder', id: 'r-1', label: 'train', mechanism: 'remind' },
    ]);
    expect(result.intervened).toBe(true);
    expect(result.text).not.toContain('surveillerai');
    expect(result.text).not.toContain('r-1');
  });
});
