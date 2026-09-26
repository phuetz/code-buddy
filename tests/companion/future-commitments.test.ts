import { describe, expect, it } from 'vitest';
import { futureCommitmentsEnabled, guardFutureCommitments } from '../../src/companion/future-commitments.js';

describe('future commitments in French', () => {
  it('guards by default unless explicitly disabled', () => {
    expect(futureCommitmentsEnabled({})).toBe(true);
    expect(futureCommitmentsEnabled({ CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'false' })).toBe(false);
  });

  it.each([
    "Je t'enverrai le message.", "Je vais t'envoyer un e-mail.",
    "J'enverrai le mail demain.", 'Je te le rappelle demain.',
    "Promis, je m'en occupe.", 'Je posterai ça sur le blog.',
    "Je publierai l'article.", "I'll email them tomorrow.",
    "C'est envoyé.", "Je t'ai envoyé le message.",
  ])('refuses an unproved emission or promise: %s', (line) => {
    const result = guardFutureCommitments(line);
    expect(result.intervened).toBe(true);
    expect(result.text).not.toBe(line);
  });

  it('does not let a proved reminder carry an email promise in the same sentence', () => {
    const result = guardFutureCommitments("Je te rappellerai les courses demain et j'enverrai le mail.", [
      { kind: 'reminder', id: 'r-1', label: 'courses', mechanism: 'remind' },
    ]);
    expect(result.intervened).toBe(true);
    expect(result.text).not.toMatch(/enverrai|mail/i);
  });

  it('accepts a short exact registered reminder label', () => {
    const result = guardFutureCommitments('Je te rappellerai le bus demain.', [
      { kind: 'reminder', id: 'r-2', label: 'bus', mechanism: 'remind' },
    ]);
    expect(result.intervened).toBe(false);
    expect(result.text).toContain('r-2');
  });
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
