import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { stageBuiltinSkills, readSkillSources, parseSkillName } = require(
  '../scripts/prepare-builtin-skills.js'
) as {
  stageBuiltinSkills: (options: {
    repoRoot: string;
    coworkRoot: string;
  }) => { count: number; names: string[]; targetDir: string };
  readSkillSources: (repoRoot: string) => Array<{ name: string; sourcePath: string }>;
  parseSkillName: (content: string, fallbackName: string) => string;
};

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-skills-'));
  tempRoots.push(root);
  return root;
}

function writeSkill(filePath: string, name: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      '---',
      `name: ${name}`,
      `description: ${name} test skill`,
      'version: 1.0.0',
      '---',
      '',
      `# ${name}`,
      '',
      'Use this test skill.',
      '',
    ].join('\n'),
    'utf8'
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('prepare-builtin-skills', () => {
  it('parses skill names from frontmatter with fallback support', () => {
    expect(parseSkillName('---\nname: quoted-skill\ndescription: ok\n---\n', 'fallback')).toBe(
      'quoted-skill'
    );
    expect(parseSkillName('no frontmatter here', 'fallback-skill')).toBe('fallback-skill');
  });

  it('stages source bundled .skill.md files into Cowork SKILL.md directories', () => {
    const repoRoot = makeTempRoot();
    const coworkRoot = path.join(repoRoot, 'cowork');
    fs.mkdirSync(coworkRoot, { recursive: true });
    writeSkill(path.join(repoRoot, 'src', 'skills', 'bundled', 'alpha.skill.md'), 'alpha');
    writeSkill(path.join(repoRoot, 'src', 'skills', 'bundled', 'beta.skill.md'), 'beta');

    const result = stageBuiltinSkills({ repoRoot, coworkRoot });

    expect(result.count).toBe(2);
    expect(result.names).toEqual(['alpha', 'beta']);
    expect(fs.existsSync(path.join(coworkRoot, '.claude', 'skills', 'alpha', 'SKILL.md'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(coworkRoot, '.claude', 'skills', 'beta', 'SKILL.md'))).toBe(
      true
    );
  });

  it('ignores runtime .codebuddy skills so private local data is never packaged', () => {
    const repoRoot = makeTempRoot();
    const coworkRoot = path.join(repoRoot, 'cowork');
    fs.mkdirSync(coworkRoot, { recursive: true });
    writeSkill(
      path.join(repoRoot, '.codebuddy', 'skills', 'bundled', 'alpha', 'SKILL.md'),
      'alpha'
    );
    writeSkill(path.join(repoRoot, 'src', 'skills', 'bundled', 'beta.skill.md'), 'beta');

    const sources = readSkillSources(repoRoot);
    const result = stageBuiltinSkills({ repoRoot, coworkRoot });

    expect(sources.map((source) => source.name)).toEqual(['beta']);
    expect(result.names).toEqual(['beta']);
    expect(fs.existsSync(path.join(result.targetDir, 'alpha', 'SKILL.md'))).toBe(false);
    expect(fs.readFileSync(path.join(result.targetDir, 'beta', 'SKILL.md'), 'utf8')).toContain(
      '# beta'
    );
  });
});
