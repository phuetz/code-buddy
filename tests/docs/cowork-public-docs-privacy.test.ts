import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootReadme = path.join(repoRoot, 'README.md');
const coworkReadme = path.join(repoRoot, 'cowork', 'readme.md');
const publicCoworkDoc = path.join(repoRoot, 'docs', 'cowork.md');
const publicDocsDir = path.join(repoRoot, 'docs');
const publicCoworkQaDir = path.join(repoRoot, 'docs', 'qa', 'code-buddy-studio');
const publicMarkdownLinkFiles = [
  rootReadme,
  coworkReadme,
  publicCoworkDoc,
  path.join(publicCoworkQaDir, 'feature-qa.md'),
  path.join(publicCoworkQaDir, 'overnight-qa-campaign.md'),
] as const;
const realProviderScreenshotProducerFiles = [
  path.join(repoRoot, 'cowork', 'e2e', 'chat-real-gpt55.spec.ts'),
  path.join(repoRoot, 'cowork', 'e2e', 'test-runner-cowork-real-gpt55.spec.ts'),
  path.join(repoRoot, 'cowork', 'e2e', 'test-runner-server-real-gpt55.spec.ts'),
] as const;
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

function markdownImageTargets(text: string): string[] {
  return Array.from(text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g), (match) => match[1]);
}

function markdownLocalTargets(text: string): string[] {
  return Array.from(text.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g), (match) => match[1])
    .map((target) => target.trim())
    .filter((target) => !/^(?:https?:|mailto:|#)/i.test(target));
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

  it('does not publish local workstation paths in public QA text ledgers', () => {
    const files = [publicCoworkDoc, ...publicTextFiles(publicCoworkQaDir)];

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/[A-Z]:\\(?:Users|CascadeProjects)\\/i);
      expect(text, file).not.toMatch(/\/(?:Users|home)\/[^\s`]+/);
      expect(text, file).not.toContain('grok-cli-weekend');
    }
  });

  it('keeps the public Cowork overview reachable from GitHub entry points', () => {
    const rootReadmeText = fs.readFileSync(rootReadme, 'utf8');
    const coworkReadmeText = fs.readFileSync(coworkReadme, 'utf8');
    const publicCoworkText = fs.readFileSync(publicCoworkDoc, 'utf8');

    expect(rootReadmeText).toContain('[Cowork Desktop](docs/cowork.md)');
    expect(coworkReadmeText).toContain('[`docs/cowork.md`](../docs/cowork.md)');
    expect(publicCoworkText).toContain('## Visual Tour');
    expect(publicCoworkText).toContain('## Real Validation');
    expect(publicCoworkText).toContain('COWORK_REAL_GPT55');
    expect(publicCoworkText).toContain('CODEBUDDY_REAL_GPT55_SERVER');
    expect(publicCoworkText).toContain('## Screenshot And Privacy Policy');
  });

  it('links only reviewed, existing screenshots from the public Cowork overview', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    const targets = markdownImageTargets(text);

    expect(targets).toEqual([
      'qa/code-buddy-studio/screenshots/01-home-work-surface.png',
      'qa/code-buddy-studio/screenshots/30-test-runner-window.png',
      'qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
      'qa/code-buddy-studio/screenshots/41-permission-dialog-real-flow.png',
      'qa/code-buddy-studio/screenshots/public-real-gpt55-cowork-chat.png',
      'qa/code-buddy-studio/screenshots/public-test-runner-cowork-real-gpt55.png',
      'qa/code-buddy-studio/screenshots/public-test-runner-server-real-gpt55.png',
    ]);

    for (const target of targets) {
      expect(path.isAbsolute(target), target).toBe(false);
      expect(fs.existsSync(path.resolve(path.dirname(publicCoworkDoc), target)), target).toBe(true);
    }
  });

  it('keeps every local Markdown target in the public Cowork overview resolvable from GitHub', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    const targets = markdownLocalTargets(text);

    expect(targets.length).toBeGreaterThan(0);

    for (const target of targets) {
      const [pathTarget] = target.split('#');
      expect(path.isAbsolute(pathTarget), target).toBe(false);
      expect(fs.existsSync(path.resolve(path.dirname(publicCoworkDoc), pathTarget)), target).toBe(true);
    }
  });

  it('keeps local Markdown targets in public Cowork QA docs resolvable from GitHub', () => {
    for (const file of publicMarkdownLinkFiles) {
      const text = fs.readFileSync(file, 'utf8');
      const targets = markdownLocalTargets(text);

      expect(targets.length, file).toBeGreaterThan(0);

      for (const target of targets) {
        const [pathTarget] = target.split('#');
        expect(path.isAbsolute(pathTarget), `${file} -> ${target}`).toBe(false);
        expect(fs.existsSync(path.resolve(path.dirname(file), pathTarget)), `${file} -> ${target}`).toBe(true);
      }
    }
  });

  it('keeps raw real-provider capture candidates out of public docs', () => {
    const files = publicTextFiles(publicDocsDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const screenshotName of inProgressCaptureCandidates) {
        expect(text, file).not.toContain(screenshotName);
      }
    }

    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    expect(text).toMatch(/raw real-provider\s+screenshots remain excluded until the capture-review pass is complete/);
  });

  it('writes real-provider proof screenshots to public-safe targets', () => {
    for (const file of realProviderScreenshotProducerFiles) {
      const text = fs.readFileSync(file, 'utf8');
      for (const screenshotName of inProgressCaptureCandidates) {
        expect(text, file).not.toContain(screenshotName);
      }
      expect(text, file).toContain('public-');
      expect(text, file).toContain('clip:');
    }
  });
});
