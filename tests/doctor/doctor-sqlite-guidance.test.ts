import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSqliteInstallGuidance,
  isGlobalInstallation,
} from '../../src/database/optional-sqlite.js';
import { runDoctorChecks } from '../../src/doctor/index.js';
import * as optionalSqlite from '../../src/database/optional-sqlite.js';

describe('B-4: Doctor advises adapted SQLite installation command according to global vs local detection', () => {
  let originalEnvInstallMode: string | undefined;

  beforeEach(() => {
    originalEnvInstallMode = process.env.CODEBUDDY_INSTALL_MODE;
    delete process.env.CODEBUDDY_INSTALL_MODE;
  });

  afterEach(() => {
    if (originalEnvInstallMode !== undefined) {
      process.env.CODEBUDDY_INSTALL_MODE = originalEnvInstallMode;
    } else {
      delete process.env.CODEBUDDY_INSTALL_MODE;
    }
    vi.restoreAllMocks();
  });

  it('detecte les installations globales selon les chemins types de gestionnaires de paquets', () => {
    expect(
      isGlobalInstallation('/usr/local/lib/node_modules/@phuetz/code-buddy/dist/index.js')
    ).toBe(true);
    expect(
      isGlobalInstallation('file:///home/user/.nvm/versions/node/v22.12.0/lib/node_modules/@phuetz/code-buddy/src/database/optional-sqlite.ts')
    ).toBe(true);
    expect(
      isGlobalInstallation('/home/user/.npm-global/lib/node_modules/@phuetz/code-buddy/dist/index.js')
    ).toBe(true);
    expect(
      isGlobalInstallation('/home/user/projects/my-app/node_modules/@phuetz/code-buddy/dist/index.js', '/home/user/projects/my-app/node_modules/.bin/buddy')
    ).toBe(false);
    expect(
      isGlobalInstallation('/home/user/DEV/code-buddy/src/database/optional-sqlite.ts')
    ).toBe(false);
  });

  it('fournit la commande globale adaptee quand mode global', () => {
    process.env.CODEBUDDY_INSTALL_MODE = 'global';
    const guidance = getSqliteInstallGuidance();
    expect(guidance).toContain('npm install -g --allow-scripts=better-sqlite3 @phuetz/code-buddy');
    expect(guidance).not.toBe('Install optional SQLite support with `npm install better-sqlite3` to enable DB-backed memory, cache, and indexed search.');
  });

  it('fournit la commande locale adaptee quand mode local', () => {
    process.env.CODEBUDDY_INSTALL_MODE = 'local';
    const guidance = getSqliteInstallGuidance();
    expect(guidance).toContain('npm rebuild better-sqlite3');
    expect(guidance).not.toBe('Install optional SQLite support with `npm install better-sqlite3` to enable DB-backed memory, cache, and indexed search.');
  });

  it('doctor propose la commande npm install -g avec --allow-scripts quand SQLite est absent en global', async () => {
    process.env.CODEBUDDY_INSTALL_MODE = 'global';
    vi.spyOn(optionalSqlite, 'loadBetterSqlite3').mockRejectedValue(new Error('bindings file not found'));

    const checks = await runDoctorChecks(process.cwd());
    const sqliteCheck = checks.find((c) => c.name === 'SQLite (better-sqlite3)');
    expect(sqliteCheck).toBeDefined();
    expect(sqliteCheck?.status).toBe('warn');
    expect(sqliteCheck?.message).toContain('npm install -g --allow-scripts=better-sqlite3 @phuetz/code-buddy');
  });

  it('doctor propose npm rebuild better-sqlite3 quand SQLite est absent en local', async () => {
    process.env.CODEBUDDY_INSTALL_MODE = 'local';
    vi.spyOn(optionalSqlite, 'loadBetterSqlite3').mockRejectedValue(new Error('bindings file not found'));

    const checks = await runDoctorChecks(process.cwd());
    const sqliteCheck = checks.find((c) => c.name === 'SQLite (better-sqlite3)');
    expect(sqliteCheck).toBeDefined();
    expect(sqliteCheck?.status).toBe('warn');
    expect(sqliteCheck?.message).toContain('npm rebuild better-sqlite3');
  });
});
