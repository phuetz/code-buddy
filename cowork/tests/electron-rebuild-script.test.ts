import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Cowork better-sqlite3 rebuild', () => {
  it('rebuilds better-sqlite3 with electron-rebuild, not npm rebuild --runtime', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const rebuild = packageJson.scripts?.rebuild ?? '';
    expect(rebuild).toContain('electron-rebuild');
    expect(rebuild).toContain('--only better-sqlite3');
    expect(rebuild).not.toContain('--runtime=electron');
  });
});
