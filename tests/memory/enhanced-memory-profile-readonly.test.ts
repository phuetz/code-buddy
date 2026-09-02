import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const homeHolder = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => homeHolder.dir,
    default: { ...actual, homedir: () => homeHolder.dir },
  };
});

import { EnhancedMemory } from '../../src/memory/enhanced-memory.js';

const testRoot = path.join(process.cwd(), '.r34-tests');

describe('R34 — user-profile.json illisible n\'est pas un profil vide', () => {
  let home: string;
  let memory: EnhancedMemory | null;

  beforeEach(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    home = fs.mkdtempSync(path.join(testRoot, 'enhanced-profile-'));
    homeHolder.dir = home;
    memory = null;
  });

  afterEach(async () => {
    memory?.dispose();
    await memory?.flush();
    memory = null;
    fs.rmSync(home, { recursive: true, force: true });
    try {
      fs.rmdirSync(testRoot);
    } catch {
      // Un autre test peut encore utiliser la racine partagée.
    }
  });

  it('rappelle les souvenirs mais refuse un profil corrompu au lieu de le vider', async () => {
    const dataDir = path.join(home, '.codebuddy', 'memory');
    fs.mkdirSync(path.join(dataDir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'memories'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'memory-index.json'), JSON.stringify([{
      id: 'ancien',
      type: 'fact',
      content: 'nous avons choisi SQLite',
      importance: 0.8,
      accessCount: 0,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      lastAccessedAt: '2026-09-01T10:00:00.000Z',
      tags: [],
      metadata: {},
    }]));
    const profilePath = path.join(dataDir, 'user-profile.json');
    const corrupt = '{"id":"profil-historique"';
    fs.writeFileSync(profilePath, corrupt);

    memory = new EnhancedMemory({ useSQLite: false, embeddingEnabled: false });
    const recalled = await memory.recall({ query: 'SQLite' });

    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.content).toContain('SQLite');
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(corrupt);
    expect(() => memory!.getUserProfile()).toThrow(/user-profile\.json.*corrupt|user-profile.*unreadable/i);
    await expect(memory.updateUserProfile({
      interests: ['ne doit pas ecraser'],
    })).rejects.toThrow(/user-profile\.json.*corrupt|user-profile.*unreadable/i);
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(corrupt);
  });

  it.each([
    { label: 'JSON null', body: 'null' },
    { label: 'JSON array', body: '[]' },
  ])('fails closed on $label instead of treating it as an empty profile', async ({ body }) => {
    const dataDir = path.join(home, '.codebuddy', 'memory');
    fs.mkdirSync(path.join(dataDir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'memories'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'memory-index.json'), '[]');
    const profilePath = path.join(dataDir, 'user-profile.json');
    fs.writeFileSync(profilePath, body);

    memory = new EnhancedMemory({ useSQLite: false, embeddingEnabled: false });
    await memory.recall({ query: 'anything' });

    expect(fs.readFileSync(profilePath, 'utf8')).toBe(body);
    expect(() => memory!.getUserProfile()).toThrow(/user-profile\.json.*corrupt|user-profile.*unreadable/i);
    await expect(memory.updateUserProfile({
      interests: ['ne doit pas ecraser'],
    })).rejects.toThrow(/user-profile\.json.*corrupt|user-profile.*unreadable/i);
    expect(fs.readFileSync(profilePath, 'utf8')).toBe(body);
  });
});
