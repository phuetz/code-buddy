import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gitignoreFile = path.join(repoRoot, '.gitignore');
const rootReadme = path.join(repoRoot, 'README.md');
const coworkReadme = path.join(repoRoot, 'cowork', 'readme.md');
const publicCoworkDoc = path.join(repoRoot, 'docs', 'cowork.md');
const publicCoworkPlanningDocs = [
  path.join(repoRoot, 'docs', 'cowork-competitor-audit.md'),
  path.join(repoRoot, 'docs', 'hermes-cowork-cli-improvement-plan.md'),
] as const;
const publicDocsDir = path.join(repoRoot, 'docs');
const publicCoworkQaDir = path.join(repoRoot, 'docs', 'qa', 'code-buddy-studio');
const publicCoworkQaReport = path.join(publicCoworkQaDir, 'feature-qa-report.json');
const publicCoworkScreenshotDir = path.join(publicCoworkQaDir, 'screenshots');
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
const rawRealProviderScreenshotTargets = inProgressCaptureCandidates.map(
  (screenshotName) => `docs/qa/code-buddy-studio/screenshots/${screenshotName}`
);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegPrefix = Buffer.from([0xff, 0xd8, 0xff]);

function publicTextFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return publicTextFiles(fullPath);
    return /\.(md|json)$/i.test(entry.name) ? [fullPath] : [];
  });
}

type FeatureQaReport = {
  results?: Array<{
    screenshot?: unknown;
  }>;
};

function markdownImageTargets(text: string): string[] {
  return Array.from(text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g), (match) => match[1].trim())
    .filter((target) => !/^(?:https?:|mailto:|#)/i.test(target));
}

function localFileTargets(text: string): string[] {
  const markdownTargets = Array.from(
    text.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g),
    (match) => match[1].trim()
  );
  const htmlTargets = Array.from(
    text.matchAll(/<(?:a|img)\s+[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi),
    (match) => match[1].trim()
  );

  return [...markdownTargets, ...htmlTargets].filter((target) => {
    if (!target || /^(?:https?:|mailto:|#|data:)/i.test(target)) return false;
    const [pathTarget] = target.split('#');
    return Boolean(pathTarget);
  });
}

function trackedPublicCoworkScreenshotFiles(): string[] {
  const output = execFileSync('git', ['ls-files', 'docs/qa/code-buddy-studio/screenshots'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => path.join(repoRoot, file));
}

function jpegDimensions(bytes: Buffer): { height: number; width: number } {
  let offset = 2;

  while (offset < bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;

    const length = bytes.readUInt16BE(offset);
    offset += 2;
    if (length < 2 || offset + length - 2 > bytes.length) break;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      expect(length, 'JPEG start-of-frame segment length').toBeGreaterThanOrEqual(7);
      return {
        height: bytes.readUInt16BE(offset + 1),
        width: bytes.readUInt16BE(offset + 3),
      };
    }

    offset += length - 2;
  }

  throw new Error('Unable to read JPEG dimensions');
}

function expectReviewedImagePath(filePath: string, label: string): void {
  const bytes = fs.readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();

  expect(bytes.length, label).toBeGreaterThan(10_000);

  if (extension === '.png') {
    expect(bytes.subarray(0, pngSignature.length).equals(pngSignature), label).toBe(true);
    expect(bytes.readUInt32BE(16), label).toBeGreaterThanOrEqual(400);
    expect(bytes.readUInt32BE(20), label).toBeGreaterThanOrEqual(240);
    return;
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    expect(bytes.subarray(0, jpegPrefix.length).equals(jpegPrefix), label).toBe(true);
    const dimensions = jpegDimensions(bytes);
    expect(dimensions.width, label).toBeGreaterThanOrEqual(400);
    expect(dimensions.height, label).toBeGreaterThanOrEqual(240);
    return;
  }

  throw new Error(`Unsupported public screenshot extension: ${label}`);
}

function expectReviewedImageFile(sourceFile: string, target: string): void {
  const [pathTarget] = target.split('#');
  expect(path.isAbsolute(pathTarget), `${sourceFile} -> ${target}`).toBe(false);
  expectReviewedImagePath(path.resolve(path.dirname(sourceFile), pathTarget), `${sourceFile} -> ${target}`);
}

describe('Cowork public QA documentation privacy', () => {
  it('does not publish private ChatGPT account identifiers in text ledgers', () => {
    const files = [publicCoworkDoc, ...publicCoworkPlanningDocs, ...publicTextFiles(publicCoworkQaDir)];
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(text, file).not.toContain('patrice.huetz');
      expect(text, file).not.toMatch(/\bPatrice\b/i);
    }
  });

  it('does not publish local workstation paths in the GitHub-facing Cowork overview', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    expect(text).not.toMatch(/[A-Z]:\\(?:Users|CascadeProjects)\\/i);
    expect(text).not.toMatch(/\/(?:Users|home)\/[^\s`]+/);
  });

  it('does not publish local workstation paths in public QA text ledgers', () => {
    const files = [publicCoworkDoc, ...publicCoworkPlanningDocs, ...publicTextFiles(publicCoworkQaDir)];

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
    expect(publicCoworkText).toContain('### Publication Hardening');
    expect(publicCoworkText).toContain('raw GPT-5.5');
    expect(publicCoworkText).not.toContain('No functional bug was found in this pass');
    expect(publicCoworkText).toContain('## Screenshot And Privacy Policy');
  });

  it('links only reviewed, valid image screenshots from the public Cowork overview', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    const targets = markdownImageTargets(text);

    expect(targets).toEqual([
      'qa/code-buddy-studio/screenshots/01-home-work-surface.jpg',
      'qa/code-buddy-studio/screenshots/30-test-runner-window.png',
      'qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png',
      'qa/code-buddy-studio/screenshots/41-permission-dialog-real-flow.png',
      'qa/code-buddy-studio/screenshots/public-real-gpt55-cowork-chat.png',
      'qa/code-buddy-studio/screenshots/public-test-runner-cowork-real-gpt55.png',
      'qa/code-buddy-studio/screenshots/public-test-runner-server-real-gpt55.png',
    ]);

    for (const target of targets) {
      expectReviewedImageFile(publicCoworkDoc, target);
    }
  });

  it('keeps local screenshot targets in public Cowork QA Markdown docs valid images', () => {
    let checkedImages = 0;

    for (const file of publicMarkdownLinkFiles) {
      const text = fs.readFileSync(file, 'utf8');
      const targets = markdownImageTargets(text);

      for (const target of targets) {
        expectReviewedImageFile(file, target);
        checkedImages += 1;
      }
    }

    expect(checkedImages).toBeGreaterThan(50);
  });

  it('keeps public Cowork QA report screenshot paths valid images', () => {
    const report = JSON.parse(fs.readFileSync(publicCoworkQaReport, 'utf8')) as FeatureQaReport;
    const targets = (report.results ?? [])
      .map((result) => result.screenshot)
      .filter((target): target is string => typeof target === 'string');

    expect(targets.length).toBeGreaterThan(20);

    for (const target of targets) {
      expect(path.isAbsolute(target), target).toBe(false);
      expectReviewedImagePath(path.resolve(repoRoot, target), target);
    }
  });

  it('keeps every tracked public Cowork screenshot file valid for publication', () => {
    const files = trackedPublicCoworkScreenshotFiles();

    expect(files).toHaveLength(109);

    for (const file of files) {
      expect(file.startsWith(publicCoworkScreenshotDir), file).toBe(true);
      expectReviewedImagePath(file, path.relative(repoRoot, file));
    }
  });

  it('keeps every local Markdown or HTML target in the public Cowork overview resolvable from GitHub', () => {
    const text = fs.readFileSync(publicCoworkDoc, 'utf8');
    const targets = localFileTargets(text);

    expect(targets.length).toBeGreaterThan(0);

    for (const target of targets) {
      const [pathTarget] = target.split('#');
      expect(path.isAbsolute(pathTarget), target).toBe(false);
      expect(fs.existsSync(path.resolve(path.dirname(publicCoworkDoc), pathTarget)), target).toBe(true);
    }
  });

  it('keeps local Markdown and HTML targets in public Cowork docs resolvable from GitHub', () => {
    for (const file of publicMarkdownLinkFiles) {
      const text = fs.readFileSync(file, 'utf8');
      const targets = localFileTargets(text);

      expect(targets.length, file).toBeGreaterThan(0);

      for (const target of targets) {
        const [pathTarget] = target.split('#');
        expect(path.isAbsolute(pathTarget), `${file} -> ${target}`).toBe(false);
        expect(fs.existsSync(path.resolve(path.dirname(file), pathTarget)), `${file} -> ${target}`).toBe(true);
      }
    }

    expect(localFileTargets(fs.readFileSync(coworkReadme, 'utf8'))).toEqual(
      expect.arrayContaining([
        'resources/logo.png',
        './README_zh.md',
        '../docs/cowork.md',
        './RUNNER_AUDIT.md',
        'resources/WeChat.jpg',
      ])
    );
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

  it('keeps raw real-provider screenshots ignored by git', () => {
    const text = fs.readFileSync(gitignoreFile, 'utf8');

    for (const target of rawRealProviderScreenshotTargets) {
      expect(text, target).toContain(target);
    }
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
