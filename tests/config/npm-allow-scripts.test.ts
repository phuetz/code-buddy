import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const expectedAllowScripts = {
  '@google/genai@1.52.0': true,
  '@vscode/ripgrep@1.17.0': true,
  '@whiskeysockets/baileys@6.7.23': true,
  'better-sqlite3@11.10.0': true,
  'bufferutil@4.1.0': true,
  'esbuild@0.27.1': true,
  'node-llama-cpp@3.16.2': true,
  'node-pty@1.1.0': true,
  // Downloads missing platform/GPU binaries; CI keeps the bundled CPU runtime
  // with ONNXRUNTIME_NODE_INSTALL=skip. Reviewed tarball script/install.js.
  'onnxruntime-node@1.30.0': true,
  'protobufjs@7.6.5': true,
  'tesseract.js@7.0.0': true,
  'tree-sitter@0.21.1': true,
  'tree-sitter-bash@0.23.3': true,
  'tree-sitter-javascript@0.23.1': true,
  'tree-sitter-typescript@0.23.2': true,
  'usearch@2.21.4': true,
  // Both published archives ship fsevents.node, with no lifecycle script or
  // binding.gyp. The lock still says hasInstallScript: no execution is needed.
  'fsevents@2.3.2': false,
  'fsevents@2.3.3': false,
} as const;

describe('npm install-script policy', () => {
  it('pins every npm 11 install-script approval reviewed for this lockfile', () => {
    const packageJsonPath = path.resolve(import.meta.dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      allowScripts?: Record<string, boolean>;
    };

    expect(packageJson.allowScripts).toEqual(expectedAllowScripts);
  });

  it('requires a reviewed decision for every install-script package in the lock, with no stale approvals', () => {
    const lockPath = path.resolve(import.meta.dirname, '..', '..', 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
      packages: Record<string, { version?: string; hasInstallScript?: boolean }>;
    };
    const scriptedPackages = Object.entries(lock.packages)
      .filter(([, metadata]) => metadata.hasInstallScript)
      .map(([location, metadata]) => `${location.split('node_modules/').at(-1)}@${metadata.version}`);

    expect([...new Set(scriptedPackages)].sort()).toEqual(Object.keys(expectedAllowScripts).sort());
    // sharp 0.35.5 and legacy ONNX 1.14.0 have no lifecycle script.
    expect(expectedAllowScripts).not.toHaveProperty('sharp@0.35.5');
    expect(expectedAllowScripts).not.toHaveProperty('onnxruntime-node@1.14.0');
  });
});
