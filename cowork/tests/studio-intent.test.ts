import { describe, expect, it } from 'vitest';
import { suggestTemplate } from '../src/renderer/components/studio/utils/studio-intent.js';

describe('suggestTemplate', () => {
  it('selects Express for API prompts', () => {
    expect(suggestTemplate('une API Express CRUD')).toBe('express-api');
    expect(suggestTemplate('backend avec endpoints webhooks')).toBe('express-api');
  });

  it('selects node-cli for command-line prompts', () => {
    expect(suggestTemplate('un outil CLI pour renommer des fichiers')).toBe('node-cli');
    expect(suggestTemplate('script de terminal')).toBe('node-cli');
  });

  it('defaults to React for product UI prompts', () => {
    expect(suggestTemplate('une todo app React')).toBe('react-ts');
    expect(suggestTemplate('une landing page')).toBe('react-ts');
  });
});
