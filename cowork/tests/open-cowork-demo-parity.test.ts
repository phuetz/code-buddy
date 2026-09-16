import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const coworkRoot = process.cwd();
const repoRoot = path.resolve(coworkRoot, '..');

// The demo section now showcases captures recorded from this build, all
// living under docs/qa/code-buddy-studio/ (no external user-attachments
// uploads since the readme rebranding).
const studioMediaPrefix = '../docs/qa/code-buddy-studio/';

const publicMediaSecretPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g },
  { label: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { label: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { label: 'Bearer token', pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi },
  { label: 'auth query parameter', pattern: /[?&](?:token|auth|access_token|code)=/gi },
  { label: 'Feishu auth URL', pattern: /open\.feishu\.cn\/app\/[^\s)]+\/auth/gi },
];

function readRepoFile(...segments: string[]): string {
  // Exact on-disk name, so a case-insensitive filesystem (Windows, macOS) cannot hide a wrong casing.
  expect(readdirSync(path.join(repoRoot, ...segments.slice(0, -1)))).toContain(segments.at(-1));
  return readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

function readmeDemoSection(readme: string): string {
  const start = readme.indexOf('## 🎬 Demo');
  const end = readme.indexOf('<a id="install">');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return readme.slice(start, end);
}

describe('Open Cowork demo parity', () => {
  it('keeps every public demo asset repo-local under the studio QA folder, with a privacy note', () => {
    const readme = readRepoFile('cowork', 'README.md');
    const demoSection = readmeDemoSection(readme);

    // Every demo asset is a capture recorded from this build — never an
    // external upload we can't re-review for leaked credentials.
    const mediaRefs = Array.from(
      demoSection.matchAll(/(?:src|href)="([^"]+\.(?:gif|mp4|jpg|png))"/g),
      (match) => match[1]
    );
    expect(mediaRefs.length).toBeGreaterThanOrEqual(10);
    for (const ref of mediaRefs) {
      expect(ref.startsWith(studioMediaPrefix)).toBe(true);
      // The referenced media actually ships in the repo
      expect(existsSync(path.join(coworkRoot, ref))).toBe(true);
    }

    // The media privacy policy survived the readme rebranding
    expect(demoSection).toContain('tokens');
    expect(demoSection).toContain('OAuth callback URLs');
    expect(demoSection).toContain('media privacy rules');
    expect(readme).toContain('workspace-organizer');
  });

  it('keeps the public demo media section free of literal secret-like strings', () => {
    const demoSection = readmeDemoSection(readRepoFile('cowork', 'README.md'));
    const hits = publicMediaSecretPatterns.flatMap(({ label, pattern }) =>
      Array.from(demoSection.matchAll(pattern), (match) => `${label}: ${match[0]}`)
    );

    expect(hits).toEqual([]);
  });

  it('documents screenshots and videos under the same public-review policy', () => {
    const coworkDoc = readRepoFile('docs', 'cowork.md');

    expect(coworkDoc).toContain('Screenshot And Video Privacy Policy');
    expect(coworkDoc).toContain('screenshots and videos');
    expect(coworkDoc).toContain('GitHub user-attachments demo videos');
    expect(coworkDoc).toContain('OAuth callback URLs');
    expect(coworkDoc).toContain('GUI operation / computer-use demonstration');
  });

  it('exposes a runnable Test Runner bundle for the five demo capabilities', () => {
    const source = readRepoFile('cowork', 'src', 'main', 'testing', 'test-runner-bridge.ts');

    expect(source).toContain('Cowork / Open Cowork demo parity bundle');
    expect(source).toContain('tests/skills-manager-builtin-skills.test.ts');
    expect(source).toContain('tests/file-attachment-helpers.test.ts');
    expect(source).toContain('tests/document-workshop-flow.test.ts');
    expect(source).toContain('tests/permission-dialog-computer-use.test.ts');
    expect(source).toContain('tests/remote-control-panel-claude-layout.test.ts');
  });

  it('ships a built-in workspace organization skill for the cleanup demo', () => {
    const skill = readRepoFile('cowork', '.claude', 'skills', 'workspace-organizer', 'SKILL.md');

    expect(skill).toContain('name: workspace-organizer');
    expect(skill).toContain('Do not delete files by default');
    expect(skill).toContain('organization-manifest.md');
  });
});
