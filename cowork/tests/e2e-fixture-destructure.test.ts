import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Playwright Cowork fixtures', () => {
  it('destructures the first fixture argument as an object', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'e2e/fixtures.ts'), 'utf8');
    expect(source).toMatch(/userDataDir:\s*async\s*\(\{\s*\}\s*,\s*use\)/);
    expect(source).not.toMatch(/userDataDir:\s*async\s*\(_\s*,\s*use\)/);
  });
});
