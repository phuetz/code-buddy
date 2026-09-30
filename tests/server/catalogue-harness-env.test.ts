import { describe, it, expect } from 'vitest';
import { isolateCatalogueEnv, restoreCatalogueEnv } from './catalogue-routes-http-harness.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

describe('Catalogue Environment Harness', () => {
  it('should isolate and restore USERPROFILE along with HOME', () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'cb-test-env-'));
    try {
      isolateCatalogueEnv(tempRoot);
      try {
        expect(process.env.HOME).toBe(tempRoot);
        expect(process.env.USERPROFILE).toBe(tempRoot);
      } finally {
        restoreCatalogueEnv();
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }

    expect(process.env.HOME).toBe(originalHome);
    expect(process.env.USERPROFILE).toBe(originalUserProfile);
  });
});
