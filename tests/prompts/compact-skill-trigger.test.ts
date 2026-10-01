import { describe, expect, it } from 'vitest';
import { matchesCompactSkill } from '../../src/prompts/compact-skill-trigger.js';
describe('compact skills require a precise activation', () => {
  const skill = { name: 'graph-analysis', triggers: ['explore codebase', 'code blast radius'] };
  it('does not activate from the ambiguous word code', () =>
    expect(matchesCompactSkill('Quel est le nom de code ?', skill)).toBe(false));
  it.each(['Use $graph-analysis', 'Please explore codebase', 'Code blast radius of this method'])(
    'keeps an explicit name or trigger: %s',
    (query) => expect(matchesCompactSkill(query, skill)).toBe(true)
  );
});
