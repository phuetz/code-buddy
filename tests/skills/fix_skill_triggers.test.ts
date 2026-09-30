import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const bundledDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/skills/bundled');
const forbidden = new Set([
  'doc', 'search', 'fichier', 'file', 'code', 'edit', 'test', 'run', 'app',
  'web', 'git', 'commit', 'meteo', 'weather', 'update', 'modify', 'google',
]);

interface SkillFrontmatter {
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
  requires?: { tools?: string[] };
  nativeEngine?: { triggers?: string[] };
}

function skillFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return skillFiles(path);
    return entry.endsWith('.skill.md') || entry === 'SKILL.md' ? [path] : [];
  });
}

function frontmatter(path: string): SkillFrontmatter {
  const content = readFileSync(path, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  expect(match, `Frontmatter absent : ${path}`).not.toBeNull();
  return parse(match![1]!) as SkillFrontmatter;
}

describe('déclencheurs des skills intégrés', () => {
  it('charge un frontmatter complet et refuse les déclencheurs isolés trop génériques', () => {
    const files = skillFiles(bundledDir);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const skill = frontmatter(path);
      expect(skill.name, `name : ${path}`).toBeTruthy();
      expect(skill.description, `description : ${path}`).toBeTruthy();
      expect(skill.version, `version : ${path}`).toBeTruthy();
      expect(skill.tags?.length, `tags : ${path}`).toBeGreaterThan(0);
      expect(skill.nativeEngine?.triggers?.length, `triggers : ${path}`).toBeGreaterThan(0);
      for (const trigger of skill.nativeEngine!.triggers!) {
        expect(forbidden.has(trigger.toLocaleLowerCase().trim()), `${path}: ${trigger}`).toBe(false);
      }
    }
  });

  it('conserve le vrai nom de l’outil météo requis', () => {
    expect(frontmatter(join(bundledDir, 'weather.skill.md')).requires?.tools)
      .toContain('weather');
  });
});
