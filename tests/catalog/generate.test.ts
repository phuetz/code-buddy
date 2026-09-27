import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCatalog, renderCatalogMarkdown } from '../../src/catalog/generate.js';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  return root;
}

function put(root: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

function commandFiles(relative: string): string[] {
  return readdirSync(path.join(checkout, relative), { withFileTypes: true }).flatMap((item) => {
    const next = path.posix.join(relative, item.name);
    return item.isDirectory() ? commandFiles(next) : item.name.endsWith('.ts') ? [next] : [];
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('generated source catalogue', () => {
  it('covers the declared CLI, tools, HTTP, WebSocket, providers, environment and middleware surfaces', () => {
    const catalog = generateCatalog(checkout);
    expect(new Set(catalog.entries.map((entry) => entry.family))).toEqual(new Set([
      'cli', 'slash', 'tool', 'http', 'websocket', 'provider', 'environment', 'middleware', 'channel', 'cowork',
    ]));
    expect(catalog.entries.some((entry) => entry.family === 'cli' && entry.name === 'catalog')).toBe(true);
    expect(catalog.entries.some((entry) => entry.family === 'tool' && entry.name === 'view_file')).toBe(true);
    expect(catalog.entries.some((entry) => entry.family === 'provider' && entry.name === 'ollama')).toBe(true);
    expect(catalog.entries.some((entry) => entry.family === 'slash' && entry.name === 'help')).toBe(true);
    expect(catalog.entries.some((entry) => entry.family === 'channel' && entry.name === 'telegram')).toBe(true);
    expect(catalog.entries.every((entry) => entry.sources.length > 0 && entry.sources.every((source) => source.line > 0 && source.commit === catalog.commit))).toBe(true);
    expect(generateCatalog(checkout)).toEqual(catalog);
    expect(renderCatalogMarkdown(catalog)).toContain('| `tool:view_file` |');
  });

  it('changes exactly when a CLI declaration or tool metadata is added, and preserves IDs across line shifts', () => {
    const root = fixture();
    put(root, 'src/index.ts', "program.command('existing');\n");
    put(root, 'src/tools/metadata.ts', "export const TOOL_METADATA = [{ name: 'existing_tool', description: 'existing' }];\n");
    const before = generateCatalog(root);
    expect(before.entries.map((entry) => entry.id)).toEqual([
      'cli:src/index.ts:existing', 'tool:existing_tool',
    ]);

    put(root, 'src/index.ts', "\nprogram.command('existing');\nprogram.command('new_command');\n");
    put(root, 'src/tools/metadata.ts', "export const TOOL_METADATA = [{ name: 'existing_tool', description: 'existing' }, { name: 'new_tool', description: 'new' }];\n");
    const after = generateCatalog(root);
    expect(after.entries.map((entry) => entry.id)).toEqual([
      'cli:src/index.ts:existing', 'cli:src/index.ts:new_command', 'tool:existing_tool', 'tool:new_tool',
    ]);
    expect(after.entries.find((entry) => entry.id === 'cli:src/index.ts:existing')?.sources[0]?.line).toBe(2);
  });

  it('fails hygiene when a literal command or metadata tool is absent from the generated checkout', () => {
    const ids = new Set(generateCatalog(checkout).entries.map((entry) => entry.id));
    for (const file of ['src/index.ts', ...commandFiles('src/commands'), ...commandFiles('src/cli')]) {
      const content = readFileSync(path.join(checkout, file), 'utf8');
      for (const match of content.matchAll(/(?:\.command\(|new Command\()\s*['"]([^'"]+)['"]/g)) {
        expect(ids.has(`cli:${file}:${match[1]}`), `Missing command ${file}:${match[1]}`).toBe(true);
      }
    }
    const metadata = readFileSync(path.join(checkout, 'src/tools/metadata.ts'), 'utf8');
    for (const match of metadata.matchAll(/\bname:\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
      expect(ids.has(`tool:${match[1]}`), `Missing tool ${match[1]}`).toBe(true);
    }
    for (const file of commandFiles('src/tools/registry')) {
      const content = readFileSync(path.join(checkout, file), 'utf8');
      for (const match of content.matchAll(/\b(?:readonly|public|private)?\s*name\s*=\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
        expect(ids.has(`tool:${match[1]}`), `Missing registry tool ${file}:${match[1]}`).toBe(true);
      }
    }
  });

  it('copies only explicit proof rows for exact names from the inventory', () => {
    const root = fixture();
    put(root, 'src/index.ts', "program.command('loop');\nprogram.command('unverified');\n");
    put(root, 'docs/INVENTAIRE-FONCTIONNALITES.md', '| Fonctionnalité | Description | Preuve |\n|---|---|---|\n| `buddy loop` | Contrôle | 🧪 |\n');
    const catalog = generateCatalog(root);
    expect(catalog.entries.find((entry) => entry.name === 'loop')?.evidence).toEqual({
      status: '🧪', source: 'docs/INVENTAIRE-FONCTIONNALITES.md', line: 3,
    });
    expect(catalog.entries.find((entry) => entry.name === 'unverified')?.evidence).toBeUndefined();
  });
});
