import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pages = [
  'README.md',
  'docs/getting-started.md',
].map((relativePath) => ({
  relativePath,
  content: readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8'),
}));

describe('DOCTOR1 entry points', () => {
  it('keeps /batch and buddy improve discoverable on both entry pages', () => {
    for (const page of pages) {
      expect(page.content, page.relativePath).toContain('/batch');
      expect(page.content, page.relativePath).toContain('CODEBUDDY_BATCH_CONCURRENCY');
      expect(page.content, page.relativePath).toContain('buddy improve');
      expect(page.content, page.relativePath).toContain('CODEBUDDY_SELF_IMPROVE');
      expect(page.content, page.relativePath).toContain('propose-only');
    }
  });
});
