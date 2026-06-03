import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const screenshotGalleryDir = path.join(repoRoot, 'docs', 'screenshots');
const screenshotGalleryReadme = path.join(screenshotGalleryDir, 'README.md');
const publicScreenshotDocs = [
  path.join(repoRoot, 'README.md'),
  screenshotGalleryReadme,
] as const;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegPrefix = Buffer.from([0xff, 0xd8, 0xff]);

function localImageTargets(text: string): string[] {
  const markdownTargets = Array.from(
    text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g),
    (match) => match[1].trim()
  );
  const htmlTargets = Array.from(
    text.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi),
    (match) => match[1].trim()
  );

  return [...markdownTargets, ...htmlTargets].filter(
    (target) => target && !/^(?:https?:|mailto:|#)/i.test(target)
  );
}

function localReferenceTargets(text: string): string[] {
  const markdownTargets = Array.from(
    text.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g),
    (match) => match[1].trim()
  );
  const htmlTargets = Array.from(
    text.matchAll(/<(?:a|img)\s+[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi),
    (match) => match[1].trim()
  );

  return [...markdownTargets, ...htmlTargets].filter(
    (target) => target && !/^(?:https?:|mailto:|#|data:)/i.test(target)
  );
}

function expectResolvableLocalReference(sourceFile: string, target: string): void {
  const [pathTarget] = target.split('#');
  if (!pathTarget) return;

  const label = `${sourceFile} -> ${target}`;
  expect(path.isAbsolute(pathTarget), label).toBe(false);
  expect(fs.existsSync(path.resolve(path.dirname(sourceFile), pathTarget)), label).toBe(true);
}

function expectValidPublicImage(sourceFile: string, target: string): void {
  const [pathTarget] = target.split('#');
  const label = `${sourceFile} -> ${target}`;
  const filePath = path.resolve(path.dirname(sourceFile), pathTarget);
  const extension = path.extname(filePath).toLowerCase();

  expect(path.isAbsolute(pathTarget), label).toBe(false);
  expect(fs.existsSync(filePath), label).toBe(true);

  const bytes = fs.readFileSync(filePath);
  expect(bytes.length, label).toBeGreaterThan(1_000);

  if (extension === '.png') {
    expect(bytes.subarray(0, pngSignature.length).equals(pngSignature), label).toBe(true);
    expect(bytes.readUInt32BE(16), label).toBeGreaterThanOrEqual(32);
    expect(bytes.readUInt32BE(20), label).toBeGreaterThanOrEqual(24);
    return;
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    expect(bytes.subarray(0, jpegPrefix.length).equals(jpegPrefix), label).toBe(true);
    return;
  }

  throw new Error(`Unsupported public screenshot extension: ${label}`);
}

function trackedScreenshotGalleryImages(): string[] {
  const output = execFileSync('git', ['ls-files', 'docs/screenshots'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return output
    .trim()
    .split(/\r?\n/)
    .filter((file) => /\.(?:png|jpe?g)$/i.test(file))
    .map((file) => path.normalize(file));
}

function normalizedGalleryTarget(target: string): string {
  const [pathTarget] = target.split('#');
  return pathTarget.replace(/^\.\//, '').replace(/\\/g, '/');
}

describe('public README screenshots', () => {
  it('keeps GitHub-visible README local links resolvable', () => {
    const targetsByFile = new Map<string, string[]>();

    for (const file of publicScreenshotDocs) {
      const text = fs.readFileSync(file, 'utf8');
      const targets = localReferenceTargets(text);
      targetsByFile.set(file, targets);

      for (const target of targets) {
        expectResolvableLocalReference(file, target);
      }
    }

    expect(targetsByFile.get(path.join(repoRoot, 'README.md'))?.length).toBeGreaterThan(30);
    expect(targetsByFile.get(path.join(repoRoot, 'docs', 'screenshots', 'README.md'))).toHaveLength(14);
  });

  it('keeps screenshot gallery text free of personal workstation details', () => {
    for (const file of publicScreenshotDocs) {
      const text = fs.readFileSync(file, 'utf8');

      expect(text, file).not.toMatch(/\bPatrice\b/i);
      expect(text, file).not.toContain('patrice.huetz');
      expect(text, file).not.toMatch(/[A-Z]:\\(?:Users|CascadeProjects)\\/i);
      expect(text, file).not.toMatch(/\/(?:Users|home)\/[^\s`]+/);
    }
  });

  it('keeps all GitHub-visible README screenshots resolvable and valid images', () => {
    const targetsByFile = new Map<string, string[]>();

    for (const file of publicScreenshotDocs) {
      const text = fs.readFileSync(file, 'utf8');
      const targets = localImageTargets(text);
      targetsByFile.set(file, targets);

      for (const target of targets) {
        expectValidPublicImage(file, target);
      }
    }

    expect(targetsByFile.get(path.join(repoRoot, 'README.md'))).toHaveLength(3);
    expect(targetsByFile.get(screenshotGalleryReadme)).toHaveLength(14);
  });

  it('keeps every tracked screenshot gallery image listed in the gallery README', () => {
    const trackedTargets = trackedScreenshotGalleryImages()
      .map((file) => path.relative(screenshotGalleryDir, path.join(repoRoot, file)).replace(/\\/g, '/'))
      .sort();
    const readmeTargets = localImageTargets(fs.readFileSync(screenshotGalleryReadme, 'utf8'))
      .map(normalizedGalleryTarget)
      .sort();

    expect(trackedTargets).toHaveLength(14);
    expect(readmeTargets).toEqual(trackedTargets);
  });
});
