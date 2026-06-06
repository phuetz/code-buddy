import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('public screenshot privacy', () => {
  it('does not publish raw ChatGPT OAuth login screenshots', () => {
    const forbiddenPath = path.join(repoRoot, 'docs', 'screenshots', 'chatgpt-oauth-login.png');

    expect(fs.existsSync(forbiddenPath)).toBe(false);
  });

  it('does not link public docs to raw ChatGPT OAuth login screenshots', () => {
    const docsToCheck = [
      'README.md',
      path.join('docs', 'screenshots', 'README.md'),
      path.join('docs', 'cowork.md'),
      path.join('cowork', 'readme.md'),
    ];

    for (const relativePath of docsToCheck) {
      const docPath = path.join(repoRoot, relativePath);
      if (!fs.existsSync(docPath)) {
        continue;
      }

      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).not.toContain('chatgpt-oauth-login.png');
    }
  });
});
