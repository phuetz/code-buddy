import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const translations: Record<string, string> = {
  'Testée localement': 'Tested locally',
  'Raccordée': 'Wired',
  'Échec constaté': 'Failed live run',
  'Prérequis vérifiés': 'Prerequisites verified',
  'Partiellement vérifiée': 'Partially verified',
};

function rows(file: string): Array<[string, string]> {
  const markdown = readFileSync(new URL(`../../docs/${file}`, import.meta.url), 'utf8');
  return markdown.split('\n').filter(line => line.startsWith('| `')).map(line => {
    const cells = line.split('|');
    const id = cells[1]?.match(/`([^`]+)`/)?.[1];
    const status = cells[3]?.match(/\*\*([^*]+)\*\*/)?.[1];
    if (!id || !status) throw new Error(`Malformed catalogue row: ${line}`);
    return [id, status];
  });
}

describe('bilingual feature catalogues', () => {
  it('publishes the same feature IDs and evidence statuses in both languages', () => {
    const french = rows('FONCTIONNALITES.md');
    const english = rows('feature-catalog.md');
    expect(french.length).toBeGreaterThan(0);
    expect(new Set(french.map(([id]) => id)).size).toBe(french.length);
    expect(new Set(english.map(([id]) => id)).size).toBe(english.length);
    const expected = Object.fromEntries(french.map(([id, status]) => {
      expect(translations, `Unknown French status for ${id}: ${status}`).toHaveProperty(status);
      return [id, translations[status]];
    }));
    expect(Object.fromEntries(english)).toEqual(expected);
  });
});
