/**
 * Crisis safety — the layer that spots acute distress / self-harm / suicidal ideation in what the
 * user says and steers Lisa toward a warm, resource-aware response.
 *
 * The two invariants that matter most:
 *   - genuine first-person ideation (FR + EN) MUST trigger the guidance + surface the real helplines;
 *   - figurative "death/kill" idioms ("ce bug me tue", "mort de rire", "dead tired") MUST NOT.
 * Detection is pure + STT-robust, so we test it directly (no model, no I/O).
 */
import { describe, it, expect } from 'vitest';
import {
  detectCrisis,
  isCrisisIdiomOnly,
  crisisGuidance,
  crisisGuidanceFor,
  CRISIS_RESOURCES_FR,
} from '../../src/companion/crisis-safety.js';

describe('detectCrisis — genuine ideation triggers (FR + EN, STT-robust)', () => {
  const genuine = [
    'je veux mourir',
    "j'ai envie d'en finir",
    'je pense à me suicider',
    'je ne veux plus vivre',
    'à quoi bon continuer',
    'tout le monde serait mieux sans moi',
    "j'ai envie de me faire du mal",
    'je vais me faire du mal ce soir',
    'i want to die',
    'i want to kill myself',
    'i just want to end it all',
    "i don't want to live anymore",
    'everyone would be better off without me',
    'i keep thinking about self-harm',
    'i feel suicidal',
    // STT accent loss / apostrophe folding
    'je veux mourir',
    'JE VEUX EN FINIR',
  ];
  for (const phrase of genuine) {
    it(`triggers on: ${phrase}`, () => {
      const read = detectCrisis(phrase);
      expect(read.crisis).toBe(true);
      expect(crisisGuidanceFor(phrase)).not.toBe('');
    });
  }
});

describe('detectCrisis — idioms and ordinary distress do NOT trigger', () => {
  const benign = [
    'ce bug me tue',
    'ça me tue de devoir tout refaire',
    'tu me tues avec tes blagues',
    'je suis mort de rire',
    'je suis morte de fatigue',
    'mort de faim, on mange quoi ?',
    "je suis crevé, j'ai plus d'énergie", // tired, not crisis
    'je galère avec ce test, ça marche pas', // frustration, not crisis
    "j'ai raté mon build, quelle journée", // frustration
    'dead tired after that build',
    "i'm dying to see the result",
    'this bug is killing me',
    '',
    '   ',
  ];
  for (const phrase of benign) {
    it(`stays silent on: ${JSON.stringify(phrase)}`, () => {
      expect(detectCrisis(phrase).crisis).toBe(false);
      expect(crisisGuidanceFor(phrase)).toBe('');
    });
  }
});

describe('isCrisisIdiomOnly', () => {
  it('flags a pure idiom', () => {
    expect(isCrisisIdiomOnly('ce bug me tue')).toBe(true);
    expect(isCrisisIdiomOnly('mort de rire')).toBe(true);
  });
  it('does not flag genuine ideation as idiom', () => {
    expect(isCrisisIdiomOnly('je veux mourir')).toBe(false);
  });
  it('does not flag ordinary text', () => {
    expect(isCrisisIdiomOnly('on se voit demain ?')).toBe(false);
  });
});

describe('crisisGuidance — surfaces real resources and stays warm/non-scripted', () => {
  it('names the French crisis resources (3114 etc.)', () => {
    const g = crisisGuidance();
    expect(g).toContain('3114');
    expect(g).toContain('SOS Amitié');
    expect(g).toContain('112');
    expect(CRISIS_RESOURCES_FR).toContain('3114');
  });
  it('tells Lisa she is not a professional and to orient, warmly', () => {
    const g = crisisGuidance().toLowerCase();
    expect(g).toContain('professionnel');
    expect(g).toContain('présence numérique');
    // spoken-friendly: no markdown lists demanded
    expect(g).toContain('sans liste');
  });
});
