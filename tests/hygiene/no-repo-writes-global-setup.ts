/**
 * Guard-rail (TESTWRITE1, 2026-09-04): the Vitest suite must never write into
 * the tracked `.codebuddy/` files of THIS repo. Two real incidents were
 * measured on 2026-09-04:
 *   - `.codebuddy/settings.json` (67 bytes, `{"telemetry":{...}}`) truncated
 *     to 0 bytes by `tests/utils/settings-manager.test.ts` (a `SettingsManager`
 *     instance constructed with the default, unmocked-past-`fs`
 *     `process.cwd()`-relative path, reaching the real `atomic-write.js`
 *     `node:fs` syscalls through gaps in a partial `jest.mock('fs', …)`).
 *   - `.codebuddy/CODEBUDDY_MEMORY.md` rewritten (category comments replaced
 *     with "No memories in this category") by
 *     `tests/memory/memory-provider.test.ts` (the Mem0/Honcho/Supermemory
 *     "local fallback" tests, which built `new LocalMemoryProvider()` with no
 *     path override — the default `PersistentMemoryManager` singleton).
 *
 * Both were fixed by adding an injectable path (`SettingsManagerOverrides`,
 * `LocalMemoryProvider`'s `fallbackMemoryConfig`) that defaults to the exact
 * previous (production) behavior. This `globalSetup` is the regression net:
 * it fingerprints (size + mtime) the two files once, before ANY test file is
 * dispatched to a worker, and compares again once every worker is done —
 * a `beforeAll`/`afterAll` inside an ordinary test file cannot give this
 * guarantee, because other test files run concurrently in sibling `pool:
 * 'forks'` workers and may start before or finish after that file's hooks.
 *
 * Deliberately dependency-free (no vitest/expect imports — globalSetup runs
 * outside the test runtime) and read-only: it must never itself write.
 */
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const GUARDED_FILES = [
  path.join(REPO_ROOT, '.codebuddy', 'settings.json'),
  path.join(REPO_ROOT, '.codebuddy', 'CODEBUDDY_MEMORY.md'),
];

interface Fingerprint {
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
}

function fingerprint(filePath: string): Fingerprint {
  try {
    const stat = statSync(filePath);
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { exists: false, size: null, mtimeMs: null };
  }
}

export default function setup() {
  const baseline = new Map<string, Fingerprint>(
    GUARDED_FILES.map(filePath => [filePath, fingerprint(filePath)]),
  );

  return function teardown() {
    const changed: string[] = [];
    for (const filePath of GUARDED_FILES) {
      const before = baseline.get(filePath)!;
      const after = fingerprint(filePath);
      if (
        before.exists !== after.exists ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        changed.push(
          `  ${filePath}\n` +
          `    before: exists=${before.exists} size=${before.size} mtimeMs=${before.mtimeMs}\n` +
          `    after:  exists=${after.exists} size=${after.size} mtimeMs=${after.mtimeMs}`,
        );
      }
    }

    if (changed.length > 0) {
      // Vitest v4 logs (but does not propagate) an error thrown from a
      // globalSetup teardown into the process exit code — `close()` catches
      // it into `teardownErrors` and only logs it (see cli-api.js `close()`).
      // Set the exit code explicitly so a red guard actually fails the run
      // (CI, `npm test`) even when every individual test passed.
      process.exitCode = 1;
      throw new Error(
        'no-repo-writes guard: the Vitest suite wrote into tracked .codebuddy/ ' +
        'state files. A test is missing an isolated (mkdtemp) path override — ' +
        'see tests/hygiene/no-repo-writes-global-setup.ts and the TESTWRITE1 ' +
        `report (docs/reports/2026-09/REPARATION-TESTWRITE1.md).\n${changed.join('\n')}`,
      );
    }
  };
}
