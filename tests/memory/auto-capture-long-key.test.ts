import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseReconciledFactText } from '../../src/memory/persistent-memory.js';

describe('autoCapture fact keys', () => {
  it('keeps a key longer than 50 characters instead of falling back to a generated id', () => {
    const key = 'preference-theme-contrast-and-typography-for-the-companion-ui';
    expect(key.length).toBeGreaterThan(50);
    const parsed = parseReconciledFactText(`${key}: sombre`);
    expect(parsed).toEqual({ key, value: 'sombre' });
  });

  it('autoCapture and saveMemories parse keys through parseReconciledFactText without a 50-character cap', () => {
    const body = readFileSync(new URL('../../src/memory/persistent-memory.ts', import.meta.url), 'utf8');
    expect(body).toContain('parseReconciledFactText');
    const autoCapture = body.slice(
      body.indexOf('async autoCapture('),
      body.indexOf('logger.warn(`[FactsMemory] Failed to autoCapture'),
    );
    expect(autoCapture).toContain('parseReconciledFactText(fact.text)');
    expect(autoCapture).not.toMatch(/colonIdx\s*<\s*50/);
    expect(body).not.toMatch(/colonIdx > 0 && colonIdx < 50/);
  });
});
