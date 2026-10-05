import { describe, expect, it } from 'vitest';
import { parseSkillFile } from '../../src/skills/parser.js';
import { parseFrontmatterYaml, quoteProblematicValues } from '../../src/skills/frontmatter-yaml.js';

const skill = (fm: string) => `---\n${fm}\n---\n\n# Body\nHello.\n`;

describe('tolérance du frontmatter YAML des SKILL.md (alignée sur Claude Code)', () => {
  it("argument-hint non quoté « [a] [b] » est lu comme une chaîne", () => {
    const text = 'name: image-blast-world\ndescription: Make a world\nargument-hint: [world-name] [optional prompt]';
    const r = parseFrontmatterYaml(text);
    expect(r.repaired).toBe(true);
    expect(r.quotedKeys).toEqual(['argument-hint']);
    expect((r.data as Record<string, unknown>)['argument-hint']).toBe('[world-name] [optional prompt]');
  });

  it('parseSkillFile accepte ce skill (échoue sur le YAML strict seul)', () => {
    const parsed = parseSkillFile(
      skill('name: image-blast-world\ndescription: Make a world\nargument-hint: [world-name] [optional prompt]'),
      '/tmp/SKILL.md',
    );
    expect(parsed.metadata.name).toBe('image-blast-world');
  });

  it('un YAML valide n\'est pas touché', () => {
    const r = parseFrontmatterYaml('name: a\ndescription: b\ntags: [x, y]');
    expect(r.repaired).toBe(false);
    expect((r.data as Record<string, unknown>).tags).toEqual(['x', 'y']);
  });

  it('un YAML irréparable lève toujours l\'erreur (le skill reste refusé)', () => {
    expect(() => parseFrontmatterYaml('name: a\n  bad: [unclosed\n: :')).toThrow();
  });

  it('ne rajoute ni ne renomme aucune clé, CRLF compris', () => {
    const q = quoteProblematicValues('name: a\r\nargument-hint: [x] [y]\r\n');
    expect(q.text).toBe('name: a\r\nargument-hint: "[x] [y]"\r\n');
    expect(q.quotedKeys).toEqual(['argument-hint']);
  });
});
