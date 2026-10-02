import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

interface LockedPackage {
  optional?: boolean;
  hasInstallScript?: boolean;
  resolved?: string;
}

const lock = JSON.parse(fs.readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as {
  packages: Record<string, LockedPackage>;
};

describe('first-contact npm installation', () => {
  it('keeps every sharp and SQLite native build optional, including transitive copies', () => {
    const nativePackages = Object.entries(lock.packages).filter(([name]) =>
      /node_modules\/(sharp|better-sqlite3)$/.test(name),
    );
    expect(nativePackages.length).toBeGreaterThanOrEqual(3);
    for (const [name, metadata] of nativePackages) {
      expect(metadata.optional, `${name} must not make a native build fatal`).toBe(true);
    }
  });

  it('gets ripgrep and all its platform binaries from npm without install scripts', () => {
    const ripgrepPackages = Object.entries(lock.packages).filter(([name]) =>
      /node_modules\/@vscode\/ripgrep(?:-[^/]+)?$/.test(name),
    );
    expect(ripgrepPackages.length).toBeGreaterThan(1);
    for (const [name, metadata] of ripgrepPackages) {
      expect(metadata.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(metadata.hasInstallScript, `${name} must not download from GitHub`).not.toBe(true);
    }
  });
});
