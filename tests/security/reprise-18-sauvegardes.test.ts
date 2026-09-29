import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const qa = vi.hoisted(() => {
  const root = `${process.cwd()}/_qa/securite-reprise-18`;
  const previous = { home: process.env.HOME, profile: process.env.USERPROFILE };
  process.env.HOME = `${root}/home`;
  process.env.USERPROFILE = `${root}/home`;
  delete process.env.CODEBUDDY_ALLOW_SECRET_FILE_READ;
  return { root, home: `${root}/home`, previous };
});

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { checkSecretFileAccess, classifySecretPath } from '../../src/security/secret-files.js';
import { createTestToolRegistry } from '../../src/tools/registry/tool-registry.js';
import { registerBuiltinTools } from '../../src/tools/registry/index.js';

const token = 'FAKE-BACKUP-TOKEN-REPRISE-18';
const codebuddy = path.join(qa.home, '.codebuddy');
const keyBackup = path.join(codebuddy, 'skill-signing', 'key.pem.bak');
const dbBackup = path.join(codebuddy, 'data.db.bak');
const sshBackup = path.join(qa.root, 'project', 'id_rsa.bak');
const archive = path.join(codebuddy, 'backups', 'codebuddy-20260928.tar.gz');

function write(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  write(keyBackup, `PRIVATE KEY ${token}\n`);
  write(dbBackup, `SQLite fixture ${token}\n`);
  write(sshBackup, `PRIVATE KEY ${token}\n`);
  write(archive, gzipSync(`archived credential ${token}\n`));
});

afterAll(() => {
  fs.rmSync(qa.root, { recursive: true, force: true });
  if (qa.previous.home === undefined) delete process.env.HOME;
  else process.env.HOME = qa.previous.home;
  if (qa.previous.profile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = qa.previous.profile;
});

describe('réserve revue 18 — sauvegardes de secrets', () => {
  it.each([keyBackup, dbBackup, sshBackup, archive])('classe %s comme secret', (file) => {
    expect(classifySecretPath(file).secret).toBe(true);
    expect(checkSecretFileAccess(file, 'read').secret).toBe(true);
  });

  it.each([keyBackup, dbBackup, sshBackup, archive])('read_file refuse %s', async (file) => {
    const registry = createTestToolRegistry();
    registerBuiltinTools(registry);
    const result = await registry.execute('read_file', { path: file }, { cwd: qa.root });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('classe les suffixes de sauvegarde et préserve les configurations publiques', () => {
    expect(classifySecretPath(path.join(codebuddy, 'backups')).secret).toBe(true);
    for (const name of ['data.db.old', 'data.sqlite.orig', 'data.sqlite3.save', 'data.db.tmp', 'data.db.swp', 'data.db-wal.bak']) {
      expect(classifySecretPath(path.join(codebuddy, name)).secret, name).toBe(true);
    }
    expect(classifySecretPath(path.join(qa.root, 'project', 'id_rsa.bak.old')).secret).toBe(true);
    expect(classifySecretPath(path.join(codebuddy, 'settings.json.bak')).secret).toBe(false);
    expect(classifySecretPath(path.join(qa.root, 'project', '.env.example.bak')).secret).toBe(false);
    expect(classifySecretPath(path.join(qa.root, 'project', 'ordinary.tar.gz')).secret).toBe(false);
  });
});
