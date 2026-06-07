/**
 * Regression guard for the rc.8 dual-`mainWindow` bug (CLAUDE.md, commit 751f7eb6).
 *
 * `cowork/src/main/index.ts` and `window-management.ts` each owned a separate
 * `let mainWindow`. Only the former was set, so `getMainWindow()` (used by
 * `ipc-main-bridge.ts:sendToRenderer()`) always returned `null` and SILENTLY
 * dropped every main→renderer IPC push. The fix: whoever creates the main
 * `BrowserWindow` must sync the shared reference via `setMainWindow()`.
 *
 * This static guard fails if any main-process module creates the main window
 * (`mainWindow = new BrowserWindow(...)`) without calling `setMainWindow(...)`
 * in the same file — catching a re-introduction of the bug at test time rather
 * than as a silent runtime IPC blackout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';

const mainDir = fileURLToPath(new URL('../src/main', import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...tsFiles(p));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * Shared main-process singletons that live in `window-management.ts` and MUST be
 * synced via their setter whenever another module constructs them. Same bug
 * class as the rc.8 dual-`mainWindow`: a stale/null shared ref silently breaks
 * features that read it through the getter.
 */
const SHARED_SINGLETONS = [
  { variable: 'mainWindow', ctor: 'BrowserWindow', setter: 'setMainWindow' },
  { variable: 'tray', ctor: 'Tray', setter: 'setTray' },
] as const;

describe('shared main-process singleton sync (rc.8 regression guard)', () => {
  it.each(SHARED_SINGLETONS)(
    'every module that creates `$variable = new $ctor` also calls $setter()',
    ({ variable, ctor, setter }) => {
      const createPattern = new RegExp(`${variable}\\s*=\\s*new\\s+${ctor}\\b`);
      const setterPattern = new RegExp(`${setter}\\s*\\(`);
      const offenders: string[] = [];

      for (const file of tsFiles(mainDir)) {
        // window-management.ts is the canonical owner of the shared reference
        // (its assignment IS the source of truth that the getter reads).
        if (file.endsWith('window-management.ts')) continue;

        const src = readFileSync(file, 'utf-8');
        if (createPattern.test(src) && !setterPattern.test(src)) {
          offenders.push(file.slice(mainDir.length + 1));
        }
      }

      expect(
        offenders,
        `These main-process modules create \`${variable}\` but never call ` +
          `${setter}(...) — that leaves the shared ${variable} ref stale/null and ` +
          `silently breaks features reading it via the getter (rc.8 dual-${variable} ` +
          `bug class). Call ${setter}(...) right after creating it.`,
      ).toEqual([]);
    },
  );
});
