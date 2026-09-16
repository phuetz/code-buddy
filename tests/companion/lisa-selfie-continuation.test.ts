/**
 * Elliptical selfie follow-ups.
 *
 * On the phone (2026-09-06) the chip « Encore une ? » right after a served
 * selfie fell through to the LLM, which answered « Oui, je suis là. Comment
 * puis-je t'aider aujourd'hui ? ». A follow-up only means "another selfie"
 * when the PREVIOUS assistant turn was a selfie — that state is the gate.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isLisaSelfieContinuationRequest } from '../../src/companion/lisa-selfie.js';
import { tryServeCompanionSelfie } from '../../src/companion/lisa-selfie-router.js';
import { historyHasRecentSelfie } from '../../src/companion/companion-history.js';

const POSITIVES = [
  'Encore une ?',
  'Une autre',
  'encore',
  'another one',
  'one more',
  'et une à la plage ?',
  'la même en plus sexy',
  'une autre photo',
];

const NEGATIVES = [
  'encore une fois explique',
  'une autre question',
  'une autre image de chat',
  'raconte-moi encore une histoire',
];

describe('isLisaSelfieContinuationRequest', () => {
  it.each(POSITIVES)('resolves « %s » after a selfie', (phrase) => {
    expect(isLisaSelfieContinuationRequest(phrase, true)).toBe(true);
  });

  it.each(NEGATIVES)('refuses « %s » even after a selfie', (phrase) => {
    expect(isLisaSelfieContinuationRequest(phrase, true)).toBe(false);
  });

  it.each(POSITIVES)('refuses « %s » when no selfie preceded it', (phrase) => {
    expect(isLisaSelfieContinuationRequest(phrase, false)).toBe(false);
  });
});

describe('historyHasRecentSelfie', () => {
  it('is true only when the LAST assistant turn served a selfie', () => {
    expect(historyHasRecentSelfie([])).toBe(false);
    expect(
      historyHasRecentSelfie([
        { role: 'user', content: 'photo' },
        { role: 'assistant', content: 'Hop.', kind: 'selfie' },
      ]),
    ).toBe(true);
    expect(
      historyHasRecentSelfie([
        { role: 'assistant', content: 'Hop.', kind: 'selfie' },
        { role: 'user', content: 'et sinon ?' },
        { role: 'assistant', content: 'Rien de neuf.' },
      ]),
    ).toBe(false);
  });
});

describe('tryServeCompanionSelfie with a conversation history', () => {
  /** Cache layout: <cacheDir>/<tier>/<style>/<file>. */
  function cacheWith(styles: string[]): { cacheDir: string; rotationPath: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-selfie-cont-'));
    const cacheDir = path.join(dir, 'cache');
    for (const style of styles) {
      const styleDir = path.join(cacheDir, 'safe', style);
      fs.mkdirSync(styleDir, { recursive: true });
      fs.writeFileSync(path.join(styleDir, `${style}-001.png`), 'x');
    }
    return { cacheDir, rotationPath: path.join(dir, 'recent.json') };
  }

  it('serves another selfie for « Encore une ? » when the history says so', async () => {
    const { cacheDir, rotationPath } = cacheWith(['portrait', 'soft-editorial']);
    const served = await tryServeCompanionSelfie('Encore une ?', {
      surface: 'mobile',
      cacheDir,
      rotationPath,
      history: [
        { role: 'user', content: 'envoie-moi une photo de toi' },
        { role: 'assistant', content: 'Hop.', kind: 'selfie' },
      ],
      env: {} as NodeJS.ProcessEnv,
    });
    expect(served?.handled).toBe(true);
    expect(served?.imagePath).toBeTruthy();
  });

  it('does not intercept « Encore une ? » without a preceding selfie', async () => {
    const { cacheDir, rotationPath } = cacheWith(['portrait']);
    const served = await tryServeCompanionSelfie('Encore une ?', {
      surface: 'mobile',
      cacheDir,
      rotationPath,
      history: [
        { role: 'user', content: 'Coucou' },
        { role: 'assistant', content: 'Coucou toi.' },
      ],
      env: {} as NodeJS.ProcessEnv,
    });
    expect(served).toBeNull();
  });

  it('carries the style asked for in the follow-up', async () => {
    const { cacheDir, rotationPath } = cacheWith(['wet-selfie', 'portrait']);
    const served = await tryServeCompanionSelfie('et une à la plage ?', {
      surface: 'mobile',
      cacheDir,
      rotationPath,
      history: [{ role: 'assistant', content: 'Hop.', kind: 'selfie' }],
      env: {} as NodeJS.ProcessEnv,
    });
    expect(served?.style).toBe('wet-selfie');
  });

  it('refuses an explicit follow-up politely when the adult gate is off', async () => {
    const { cacheDir, rotationPath } = cacheWith(['portrait']);
    const served = await tryServeCompanionSelfie('une autre photo nue', {
      surface: 'mobile',
      cacheDir,
      rotationPath,
      history: [{ role: 'assistant', content: 'Hop.', kind: 'selfie' }],
      env: {} as NodeJS.ProcessEnv,
    });
    expect(served?.refused).toBe(true);
    expect(served?.reason).toBe('explicit-gate');
  });
});
