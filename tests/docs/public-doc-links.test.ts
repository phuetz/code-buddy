import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicMarkdownDocs } from './public-doc-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

type LinkFinding = {
  doc: string;
  href: string;
  reason: string;
};

function stripLinkTarget(rawHref: string): string {
  return rawHref
    .trim()
    .replace(/^<|>$/g, '')
    .split('#')[0]
    ?.split('?')[0]
    ?.trim() ?? '';
}

function isExternalOrAnchor(href: string): boolean {
  return href === ''
    || href.startsWith('#')
    || /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function collectLocalRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const match of markdown.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    if (match[1]) refs.add(match[1]);
  }
  for (const match of markdown.matchAll(/<(?:a|img)\s+[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    if (match[1]) refs.add(match[1]);
  }
  return [...refs]
    .map(stripLinkTarget)
    .filter((href) => !isExternalOrAnchor(href));
}

async function exactCasePathExists(absolutePath: string): Promise<boolean> {
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;
  if (!relativePath || relativePath === '.') return true;

  const parts = relativePath.split(path.sep).filter(Boolean);
  let current = repoRoot;
  for (const part of parts) {
    const entries = await fs.readdir(current);
    const matchedName = entries.find((entry) => entry === part);
    if (!matchedName) return false;
    current = path.join(current, matchedName);
  }
  return true;
}

describe('public documentation links', () => {
  it('keeps GitHub-visible local links present with exact path casing', async () => {
    const findings: LinkFinding[] = [];

    for (const doc of publicMarkdownDocs) {
      const absoluteDocPath = path.join(repoRoot, doc);
      const docContent = await fs.readFile(absoluteDocPath, 'utf8');
      const docDir = path.dirname(absoluteDocPath);

      for (const href of collectLocalRefs(docContent)) {
        const absoluteTarget = path.resolve(docDir, href);
        if (!absoluteTarget.startsWith(repoRoot)) {
          findings.push({ doc, href, reason: 'target escapes repository' });
          continue;
        }
        if (!(await exactCasePathExists(absoluteTarget))) {
          findings.push({ doc, href, reason: 'target missing or wrong case' });
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
