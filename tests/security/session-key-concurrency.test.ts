/**
 * The first encryptions of a profile create its session key. Started in
 * parallel in one process, they must all use the same key: a session sealed
 * with a key that another creation then replaced can never be read again.
 *
 * HOME and USERPROFILE are throwaway directories; the key lives there.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let home = '';

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

it('quatre premiers chiffrements paralleles : une seule cle, chaque session se relit', async () => {
  home = mkdtempSync(path.join(os.tmpdir(), 'cb-cle-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  vi.resetModules();
  expect(os.homedir(), 'faux HOME actif').toBe(home);
  const keyPath = path.join(home, '.codebuddy', '.encryption-key');
  expect(existsSync(keyPath), 'aucune cle au depart').toBe(false);

  const content = await import('../../src/persistence/session-content.js');
  const ts = new Date().toISOString();
  const sealed = await Promise.all(
    ['A', 'B', 'C', 'D'].map((text) => content.encryptSessionContent([{ type: 'user', content: text, timestamp: ts }])),
  );
  const opened = sealed.map((messages) => {
    try {
      return content.decryptSessionContent(messages)[0]?.content;
    } catch (error) {
      return `ILLISIBLE:${String((error as Error).cause ?? error)}`;
    }
  });
  console.log('CLE_CONCURRENTE', JSON.stringify({ opened, keyBytes: readFileSync(keyPath).length }));
  expect(opened, 'chaque session chiffree se relit').toEqual(['A', 'B', 'C', 'D']);
  expect(existsSync(`${keyPath}.lock`), 'verrou libere').toBe(false);
});
