/**
 * withSessionLock must exclude writers of the same process too. The file lock
 * alone accepts a second holder with the same PID, and that holder's release
 * unlinked the lock file while the first one was still writing. Every section
 * on one path now runs alone; a nested call from inside a section re-enters it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withSessionLock } from '../../src/persistence/session-lock.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function sessionFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-lock-in-process-'));
  dirs.push(dir);
  return path.join(dir, 'session.json');
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('withSessionLock : exclusion dans un meme processus', () => {
  it('quatre sections concurrentes sur le meme fichier ne se chevauchent jamais', async () => {
    const file = sessionFile();
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    await Promise.all(['A', 'B', 'C', 'D'].map((name) => withSessionLock(file, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(`${name}+`);
      for (let i = 0; i < 5; i++) await tick();
      order.push(`${name}-`);
      active--;
    })));
    console.log('EXCLUSION', JSON.stringify({ maxActive, order }));
    expect(maxActive, 'une seule section active a la fois').toBe(1);
  });

  it('le fichier de verrou existe a chaque instant de chaque section', async () => {
    const file = sessionFile();
    const missing: string[] = [];
    await Promise.all(['A', 'B', 'C'].map((name) => withSessionLock(file, async () => {
      for (let i = 0; i < 5; i++) {
        if (!fs.existsSync(`${file}.lock`)) missing.push(`${name}${i}`);
        await tick();
      }
    })));
    console.log('VERROU_PRESENT', JSON.stringify({ missing }));
    expect(missing, 'verrou absent pendant une section').toEqual([]);
    expect(fs.existsSync(`${file}.lock`), 'verrou libere a la fin').toBe(false);
  });

  it('un appel imbrique sur le meme fichier entre sans attendre et ne libere pas le verrou exterieur', async () => {
    const file = sessionFile();
    const result = await withSessionLock(file, async () => {
      const inner = await withSessionLock(file, async () => 'interieur');
      return { inner, lockAfterInner: fs.existsSync(`${file}.lock`) };
    });
    console.log('IMBRIQUE', JSON.stringify(result));
    expect(result).toEqual({ inner: 'interieur', lockAfterInner: true });
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it('deux fichiers differents ne s attendent pas', async () => {
    const first = sessionFile();
    const second = sessionFile();
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstSection = withSessionLock(first, () => held);
    const secondResult = await withSessionLock(second, async () => 'libre');
    releaseFirst();
    await firstSection;
    expect(secondResult).toBe('libre');
  });

  it('une section qui echoue laisse passer la suivante', async () => {
    const file = sessionFile();
    const failed = withSessionLock(file, async () => { throw new Error('echec volontaire'); });
    const next = withSessionLock(file, async () => 'suivante');
    await expect(failed).rejects.toThrow('echec volontaire');
    await expect(next).resolves.toBe('suivante');
  });

  it('une suite detachee apres la fin de sa section n est plus traitee comme imbriquee', async () => {
    const file = sessionFile();
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    let detached: Promise<void> | undefined;
    const events: string[] = [];
    await withSessionLock(file, async () => {
      detached = (async () => {
        await gate;
        await withSessionLock(file, async () => { events.push('detachee'); });
      })();
    });
    await withSessionLock(file, async () => {
      events.push('B+');
      openGate();
      for (let i = 0; i < 5; i++) await tick();
      events.push('B-');
    });
    await detached;
    console.log('DETACHEE', JSON.stringify(events));
    expect(events, 'la suite detachee attend la section B').toEqual(['B+', 'B-', 'detachee']);
  });
});
