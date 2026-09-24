/**
 * A capability probe that never exits must not pin the process.
 * The binaries stand in for bwrap and docker; the real host tools are
 * hidden by putting this directory first on PATH.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPABILITY_PROBE_TIMEOUT_MS,
  clearCapabilitiesCache,
  detectCapabilities,
  setSandboxCapabilityProbe,
} from '../../src/sandbox/os-sandbox.js';

const disposables: string[] = [];

function hangingBinary(dir: string, name: string): void {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nsleep 60\n', { mode: 0o755 });
}

describe('sonde de capacite bornee', () => {
  const previousPath = process.env.PATH;

  afterEach(() => {
    setSandboxCapabilityProbe(null);
    clearCapabilitiesCache();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    for (const dir of disposables.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'une sonde docker ou bwrap qui ne revient pas est abandonnee',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-deadline-'));
      disposables.push(dir);
      hangingBinary(dir, 'bwrap');
      hangingBinary(dir, 'docker');
      process.env.PATH = `${dir}${path.delimiter}${previousPath || ''}`;
      setSandboxCapabilityProbe(null);
      clearCapabilitiesCache();
      const started = Date.now();
      const caps = await detectCapabilities();
      const elapsed = Date.now() - started;
      console.log(
        `ASSERT sonde-delai elapsed=${elapsed} docker=${caps.docker} bubblewrap=${caps.bubblewrap} recommended=${caps.recommended}`,
      );
      expect(elapsed, 'ASSERT sonde rend la main').toBeLessThan(CAPABILITY_PROBE_TIMEOUT_MS * 2 + 3_000);
      expect(caps.docker, 'ASSERT docker indisponible').toBe(false);
      expect(caps.bubblewrap, 'ASSERT bubblewrap indisponible').toBe(false);
      if (process.platform === 'linux') {
        expect(caps.recommended, 'ASSERT pas de backend recommande').toBe('none');
      }
    },
    20_000,
  );
});
