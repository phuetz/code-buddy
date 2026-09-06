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
  'onnxruntime-node@1.24.3': true,
  'protobufjs@7.6.5': true,
  'sharp@0.32.6': true,
  'sharp@0.33.5': true,
  'sharp@0.34.5': true,
  'tesseract.js@7.0.0': true,
  'tree-sitter@0.21.1': true,
  'tree-sitter-bash@0.23.3': true,
  'tree-sitter-javascript@0.23.1': true,
  'tree-sitter-typescript@0.23.2': true,
  'usearch@2.21.4': true,
} as const;

describe('npm install-script policy', () => {
  it('pins every npm 11 install-script approval reviewed for this lockfile', () => {
    const packageJsonPath = path.resolve(import.meta.dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      allowScripts?: Record<string, boolean>;
    };

    expect(packageJson.allowScripts).toEqual(expectedAllowScripts);
    expect(Object.keys(packageJson.allowScripts ?? {})).toHaveLength(19);
  });
});
