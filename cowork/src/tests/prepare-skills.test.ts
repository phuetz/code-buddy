import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { stageBundledSkills } = require('../../scripts/prepare-skills.js');

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-skills-test-'));
}

function writeSkill(sourceDir: string, name: string, body?: string): void {
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, `${name}.skill.md`),
    body ??
      `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`,
    'utf8'
  );
}

describe('prepare-skills: stageBundledSkills', () => {
  let tmpDir: string;
  let sourceDir: string;
  let targetRoot: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    sourceDir = path.join(tmpDir, 'src-skills');
    targetRoot = path.join(tmpDir, '.bundle-resources', 'skills');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stages bundled .skill.md files into Claude-compatible SKILL.md folders', () => {
    writeSkill(sourceDir, 'file-edit');
    writeSkill(sourceDir, 'typescript-expert');
    fs.writeFileSync(path.join(sourceDir, 'README.md'), '# ignored\n', 'utf8');

    const count = stageBundledSkills({ sourceDir, targetRoot });

    expect(count).toBe(2);
    expect(fs.readFileSync(path.join(targetRoot, 'file-edit', 'SKILL.md'), 'utf8')).toContain(
      'name: file-edit'
    );
    expect(
      fs.readFileSync(path.join(targetRoot, 'typescript-expert', 'SKILL.md'), 'utf8')
    ).toContain('name: typescript-expert');
    expect(fs.existsSync(path.join(targetRoot, '.generated-by-codebuddy-build'))).toBe(true);
  });

  it('replaces a previously generated target tree', () => {
    writeSkill(sourceDir, 'current');
    fs.mkdirSync(path.join(targetRoot, 'stale'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'stale', 'SKILL.md'), 'stale', 'utf8');
    fs.writeFileSync(path.join(targetRoot, '.generated-by-codebuddy-build'), 'old', 'utf8');

    const count = stageBundledSkills({ sourceDir, targetRoot });

    expect(count).toBe(1);
    expect(fs.existsSync(path.join(targetRoot, 'stale'))).toBe(false);
    expect(fs.existsSync(path.join(targetRoot, 'current', 'SKILL.md'))).toBe(true);
  });

  it('replaces an unmarked target tree so local skills cannot leak into builds', () => {
    writeSkill(sourceDir, 'current');
    fs.mkdirSync(path.join(targetRoot, 'local-only'), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, 'local-only', 'SKILL.md'), 'local', 'utf8');

    const count = stageBundledSkills({ sourceDir, targetRoot });

    expect(count).toBe(1);
    expect(fs.existsSync(path.join(targetRoot, 'local-only'))).toBe(false);
    expect(fs.existsSync(path.join(targetRoot, 'current', 'SKILL.md'))).toBe(true);
  });

  it('throws when no bundled skill files exist', () => {
    fs.mkdirSync(sourceDir, { recursive: true });

    expect(() => stageBundledSkills({ sourceDir, targetRoot })).toThrow(
      'No bundled *.skill.md files found'
    );
  });
});
