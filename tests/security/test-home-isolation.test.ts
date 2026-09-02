import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testsRoot = path.join(repoRoot, 'tests');
const thisFile = fileURLToPath(import.meta.url);

const FILESYSTEM_WRITE =
  /\b(?:appendFile|copyFile|createWriteStream|mkdir|rename|rm|symlink|unlink|writeFile)(?:Sync)?\s*\(/;
const HOME_SKILLS_REFERENCE =
  /(?:\bos\.homedir\(\)|\bhomedir\(\)|~)[\s\S]{0,160}(?:\.codebuddy[\\/', "`]{1,8}skills|\/\.codebuddy\/skills)/;
const HOME_REDIRECTION = /(?:process\.env\.HOME\s*=|vi\.mock\(\s*['"](?:node:)?os['"])/;

function findTestSources(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestSources(entryPath));
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function isUnredirectedHomeSkillsWrite(source: string): boolean {
  return (
    FILESYSTEM_WRITE.test(source) &&
    HOME_SKILLS_REFERENCE.test(source) &&
    !HOME_REDIRECTION.test(source)
  );
}

describe('test home isolation', () => {
  it('recognizes unsafe and redirected home skills writes', () => {
    const unsafe = `
      const skills = path.join(os.homedir(), '.codebuddy', 'skills');
      fs.mkdirSync(skills, { recursive: true });
    `;
    const redirected = `
      vi.mock('os', () => ({ homedir: () => testHome }));
      const skills = path.join(os.homedir(), '.codebuddy', 'skills');
      fs.writeFileSync(path.join(skills, 'SKILL.md'), '# test');
    `;

    expect(isUnredirectedHomeSkillsWrite(unsafe)).toBe(true);
    expect(isUnredirectedHomeSkillsWrite(redirected)).toBe(false);
  });

  it('redirects home before writing beneath ~/.codebuddy/skills', () => {
    const offenders: string[] = [];

    for (const file of findTestSources(testsRoot)) {
      if (file === thisFile) continue;

      const source = readFileSync(file, 'utf8');
      if (isUnredirectedHomeSkillsWrite(source)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }

    expect(
      offenders,
      'Tests that write beneath a home skills directory must redirect HOME or mock os.homedir().'
    ).toEqual([]);
  });
});
