import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-17`;
  const previous = { home: process.env.HOME, profile: process.env.USERPROFILE };
  process.env.HOME = `${root}/home`;
  process.env.USERPROFILE = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, previous };
});

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { classifySecretPath, checkSecretFileAccess } from '../../src/security/secret-files.js';
import { findCredentialPathInCommand } from '../../src/tools/bash/command-validator.js';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';

const store = path.join(qa.home, '.codebuddy');
const dbPath = path.join(store, 'codebuddy.db');
const token = 'FAKE-WAL-DB-TOKEN-REPRISE-17';
let db: Database.Database;

beforeAll(() => {
  fs.mkdirSync(store, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.exec('CREATE TABLE memories (value TEXT)');
  db.prepare('INSERT INTO memories (value) VALUES (?)').run(token);
});

afterAll(() => {
  db.close();
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previous.home === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previous.home;
  if (qa.previous.profile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previous.profile;
});

describe('B16 — fichiers annexes SQLite du store privé', () => {
  it('reproduit un WAL contenant une mémoire fictive', () => {
    expect(fs.readFileSync(`${dbPath}-wal`).includes(Buffer.from(token))).toBe(true);
  });

  it.each(['-wal', '-shm', '-journal'])('classe codebuddy.db%s comme secret', (suffix) => {
    expect(classifySecretPath(`${dbPath}${suffix}`).secret).toBe(true);
    expect(checkSecretFileAccess(`${dbPath}${suffix}`, 'read').secret).toBe(true);
  });

  it.each(['read_file', 'view_file'])('%s refuse le WAL par le registre exposé au modèle', async (tool) => {
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const result = await registry.execute(tool, { path: `${dbPath}-wal` }, { cwd: qa.root });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('protège les annexes sqlite/sqlite3 et préserve une base de projet ordinaire', () => {
    expect(classifySecretPath(path.join(store, 'history.sqlite-shm')).secret).toBe(true);
    expect(classifySecretPath(path.join(store, 'history.sqlite3-journal')).secret).toBe(true);
    expect(classifySecretPath(path.join(qa.root, 'secrets.db-wal')).secret).toBe(true);
    expect(classifySecretPath(path.join(qa.root, 'ordinary.db-wal')).secret).toBe(false);
    expect(findCredentialPathInCommand(`cat ${dbPath}-wal`, process.platform, qa.root)).not.toBeNull();
  });
});
