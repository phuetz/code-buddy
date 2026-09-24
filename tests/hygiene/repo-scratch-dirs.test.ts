/**
 * Scratch directories that must live inside the repository go under its
 * gitignored `tmp/` folder (`repoScratchRoot()` in tests/helpers/tmp.ts), never
 * at the repository root.
 *
 * catalogue-routes-http-{a,b}.test.ts assert that `git status` shows no
 * unexpected path. A sibling test running in another worker that creates
 * `<repo>/.gk18-pr-XXXXXX` makes that assertion fail (Windows CI, 2026-09-24:
 * "expected [ '?? .gk18-pr-SVYhHu/bin/gh', …(19) ] to deeply equal []").
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const selfPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(selfPath), '..', '..');
const testsRoot = path.join(repoRoot, 'tests');

// mkdtemp / mkdtempSync directly under the repository root, outside the
// gitignored `tmp/` and `_qa/` folders.
const ROOT_SCRATCH = /mkdtemp(?:Sync)?\(\s*path\.(?:join|resolve)\(\s*(?:repoRoot|REPO_ROOT|process\.cwd\(\))\s*,\s*['"`](?!(?:tmp|_qa)['"`/])[^'"`/\\]/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
      out.push(...sourceFiles(abs));
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

describe('test scratch directories', () => {
  it('are never created directly at the repository root', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(testsRoot)) {
      if (path.resolve(file) === path.resolve(selfPath)) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(ROOT_SCRATCH)) {
        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(repoRoot, file).split(path.sep).join('/')}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('recognises the pattern it forbids', () => {
    const sample = [
      "fs.mkdtempSync(path.join(repoRoot, '.gk18-pr-'));",
      "mkdtempSync(path.join(repoScratchRoot(repoRoot), '.ok-'));",
      "mkdtempSync(path.join(repoRoot, 'tmp', 'ok-'));",
      "mkdtempSync(path.join(process.cwd(), '_qa/ok-'));",
    ].join('\n');
    expect([...sample.matchAll(ROOT_SCRATCH)]).toHaveLength(1);
  });
});
