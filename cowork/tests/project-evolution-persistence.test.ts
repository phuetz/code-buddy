import { createRequire } from 'module';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { SqliteProjectEvolutionRepository } from '../src/main/project/project-evolution';
import type { ProjectEvolutionProposal } from '../src/shared/project-evolution';

const require = createRequire(import.meta.url);

let BetterSqlite: (new (path: string) => import('better-sqlite3').Database) | null = null;
for (const candidate of [
  'better-sqlite3',
  resolve(process.cwd(), '..', 'node_modules', 'better-sqlite3'),
]) {
  try {
    const loaded = require(candidate) as new (path: string) => import('better-sqlite3').Database;
    const probe = new loaded(':memory:');
    probe.close();
    BetterSqlite = loaded;
    break;
  } catch {
    // The Electron ABI may not be loadable in the Node/Vitest process.
  }
}

describe.skipIf(!BetterSqlite)('SqliteProjectEvolutionRepository', () => {
  it('persists typed proposal state across repository instances', () => {
    const database = new BetterSqlite!(':memory:');
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      INSERT INTO projects(id) VALUES ('project-1');
    `);
    const proposal: ProjectEvolutionProposal = {
      id: 'proposal-1',
      projectId: 'project-1',
      type: 'master_instruction',
      status: 'pending',
      title: 'Update instruction',
      reason: 'One reusable rule',
      evidence: [{ role: 'summary', excerpt: 'Always cite sources.' }],
      sourceKind: 'summary',
      beforeContent: '',
      afterContent: '- Always cite sources.\n',
      baseFingerprint: 'base',
      audit: [{ action: 'created', at: 1 }],
      createdAt: 1,
      updatedAt: 1,
    };

    new SqliteProjectEvolutionRepository(database).save(proposal);
    const restored = new SqliteProjectEvolutionRepository(database).get(proposal.id);

    expect(restored).toEqual(proposal);
    expect(new SqliteProjectEvolutionRepository(database).list('project-1')).toEqual([proposal]);
    database.close();
  });
});
