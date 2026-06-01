import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootReadme = path.join(repoRoot, 'README.md');
const coworkReadme = path.join(repoRoot, 'cowork', 'readme.md');
const publicCoworkDoc = path.join(repoRoot, 'docs', 'cowork.md');
const publicCoworkQaDir = path.join(repoRoot, 'docs', 'qa', 'code-buddy-studio');
const inProgressCaptureCandidates = [
  '29-real-gpt55-cowork-gui.png',
  '48-test-runner-cowork-real-gpt55.png',
  '49-test-runner-server-real-gpt55.png',
] as const;

function publicTextFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return publicTextFiles(fullPath);
    return /\.(md|json)$/i.test(entry.name) ? [fullPath] : [];
  });
}

describe('Cowork public QA documentation privacy', () => {
  it('does not publish private ChatGPT account identifiers in text ledgers', () => {
    const files = [publicCoworkDoc, ...publicTextFiles(publicCoworkQaDir)];
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(text, file).not.toContain('patrice.huetz');
    }
  });

  it('does not publish local workstation paths in the GitHub-facing Cowork overview', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    expect(text).not.toMatch(/[A-Z]:\\(?:Users|CascadeProjects)\\/i);
    expect(text).not.toMatch(/\/(?:Users|home)\/[^\s`]+/);
  });

  it('keeps the public Cowork overview reachable from GitHub entry points', () => {
    const rootReadmeText = fs.readFileSync(rootReadme, 'utf8');
    const coworkReadmeText = fs.readFileSync(coworkReadme, 'utf8');
    const publicCoworkText = fs.readFileSync(publicCoworkDoc, 'utf8');

    expect(rootReadmeText).toContain('[Cowork Desktop](docs/cowork.md)');
    expect(coworkReadmeText).toContain('[`docs/cowork.md`](../docs/cowork.md)');
    expect(publicCoworkText).toContain('## Real Validation');
    expect(publicCoworkText).toContain('COWORK_REAL_GPT55');
    expect(publicCoworkText).toContain('CODEBUDDY_REAL_GPT55_SERVER');
    expect(publicCoworkText).toContain('## Screenshot And Privacy Policy');
  });

  it('keeps in-progress real-provider capture candidates out of the GitHub-facing overview', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');

    for (const screenshotName of inProgressCaptureCandidates) {
      expect(text).not.toContain(screenshotName);
    }

    expect(text).toContain('capture-review pass is still in progress');
  });
});
