import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Entry {
  package: string;
  advisories: string[];
  nodes: string[];
  reason: string;
}

const allow: Entry[] = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'audit-allowlist.json'), 'utf8'),
).allow;

describe('audit-allowlist.json : exactitude hors ligne', () => {
  it('ne contient aucune entrée en double', () => {
    const names = allow.map((e) => e.package);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(allow.map((e) => [e.package, e] as const))(
    '%s : le motif nomme chaque avis listé par son identifiant GHSA',
    (_name, entry) => {
      expect(entry.advisories.length).toBeGreaterThan(0);
      for (const url of entry.advisories) {
        expect(entry.reason, `${entry.package} ne nomme pas ${url}`).toContain(url.split('/').pop()!);
      }
    },
  );

  it('chaque entrée a un périmètre de nœuds et aucune URL en double', () => {
    for (const e of allow) {
      expect(e.nodes.length, e.package).toBeGreaterThan(0);
      expect(new Set(e.advisories).size, e.package).toBe(e.advisories.length);
    }
  });
});
