import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createImportCommand,
  formatConfigImportResult,
  importProjectConfiguration,
} from '../../src/commands/import.js';

const temporaryDirectories: string[] = [];

async function temporaryProject(prefix = 'codebuddy-import-'): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function readJson(root: string, relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8')) as Record<
    string,
    unknown
  >;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('buddy import', () => {
  it('consolidates every supported rule source and merges MCP servers by name', async () => {
    const root = await temporaryProject();
    await writeFixture(
      root,
      'CODEBUDDY.md',
      '# Règles Code Buddy existantes\n\nConserver ce texte.\n'
    );
    await writeFixture(root, 'AGENTS.md', '# Guide partagé\n\nNe pas modifier.\n');
    await writeFixture(
      root,
      '.cursor/rules/typescript.mdc',
      '---\ndescription: TypeScript strict\n---\n\nToujours typer les retours.\n'
    );
    await writeFixture(root, '.cursorrules', 'Règle Cursor historique.\n');
    await writeFixture(root, '.clinerules/01-tests.md', 'Tester les chemins d’échec.\n');
    await writeFixture(root, '.clinerules/nested/02-docs.md', 'Documenter les décisions.\n');
    await writeFixture(root, '.github/copilot-instructions.md', 'Copilot exige des imports ESM.\n');
    await writeFixture(root, 'CLAUDE.md', 'Claude exige des imports avec extension .js.\n');

    await writeFixture(
      root,
      '.codebuddy/mcp.json',
      `${JSON.stringify(
        {
          description: 'À préserver',
          mcpServers: {
            existing: { command: 'existing-command', args: ['--keep'], enabled: false },
          },
        },
        null,
        2
      )}\n`
    );
    await writeFixture(
      root,
      '.cursor/mcp.json',
      JSON.stringify({
        mcpServers: {
          existing: { command: 'must-not-win' },
          shared: { command: 'cursor-shared' },
          cursor: { command: 'cursor-only', env: { CURSOR_TOKEN: '${CURSOR_TOKEN}' } },
        },
      })
    );
    await writeFixture(
      root,
      '.vscode/mcp.json',
      JSON.stringify({
        servers: {
          shared: { command: 'vscode-must-not-win' },
          vscode: { type: 'http', url: 'https://mcp.example.test' },
        },
      })
    );
    await writeFixture(
      root,
      'claude_desktop_config.json',
      JSON.stringify({ mcpServers: { claude: { command: 'claude-server' } } })
    );
    await writeFixture(
      root,
      '.mcp.json',
      JSON.stringify({ mcpServers: { portable: { command: 'portable-server' } } })
    );

    const result = await importProjectConfiguration({}, { cwd: root });

    expect(result.ruleSourcesImported).toBe(6);
    expect(result.mcpServersImported).toBe(5);
    expect(result.filesWritten).toEqual(['CODEBUDDY.md', '.codebuddy/mcp.json']);

    const codeBuddy = await fs.readFile(path.join(root, 'CODEBUDDY.md'), 'utf8');
    expect(codeBuddy).toMatch(/^# Règles Code Buddy existantes/);
    expect(codeBuddy).toContain('Conserver ce texte.');
    expect(codeBuddy).toContain('# Importé de Cursor (.cursor/rules/typescript.mdc)');
    expect(codeBuddy).toContain('# Importé de Cursor (.cursorrules)');
    expect(codeBuddy).toContain('# Importé de Cline (.clinerules/01-tests.md)');
    expect(codeBuddy).toContain('# Importé de Cline (.clinerules/nested/02-docs.md)');
    expect(codeBuddy).toContain('# Importé de GitHub Copilot (.github/copilot-instructions.md)');
    expect(codeBuddy).toContain('# Importé de Claude Code (CLAUDE.md)');
    expect(codeBuddy).toContain('description: TypeScript strict');
    expect(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe(
      '# Guide partagé\n\nNe pas modifier.\n'
    );

    const mcp = await readJson(root, '.codebuddy/mcp.json');
    expect(mcp.description).toBe('À préserver');
    expect(mcp.mcpServers).toEqual({
      existing: { command: 'existing-command', args: ['--keep'], enabled: false },
      shared: { command: 'cursor-shared' },
      cursor: { command: 'cursor-only', env: { CURSOR_TOKEN: '${CURSOR_TOKEN}' } },
      vscode: { type: 'http', url: 'https://mcp.example.test' },
      claude: { command: 'claude-server' },
      portable: { command: 'portable-server' },
    });

    const summary = formatConfigImportResult(result);
    expect(summary).toContain('Importé : 6 sources de règles, 5 serveurs MCP.');
    expect(summary).toContain('MCP existing: .cursor/mcp.json (nom déjà présent, conservé)');
    expect(summary).toContain('MCP shared: .vscode/mcp.json (doublon dans les sources, ignoré)');
  });

  it('is byte-for-byte idempotent on a second run', async () => {
    const root = await temporaryProject();
    await writeFixture(root, '.cursorrules', 'Ne jamais écraser le travail local.\n');
    await writeFixture(
      root,
      '.cursor/mcp.json',
      JSON.stringify({ mcpServers: { browser: { command: 'browser-mcp' } } })
    );

    const first = await importProjectConfiguration({}, { cwd: root });
    const firstRules = await fs.readFile(path.join(root, 'CODEBUDDY.md'));
    const firstMCP = await fs.readFile(path.join(root, '.codebuddy/mcp.json'));
    const second = await importProjectConfiguration({}, { cwd: root });

    expect(first.ruleSourcesImported).toBe(1);
    expect(first.mcpServersImported).toBe(1);
    expect(second.ruleSourcesImported).toBe(0);
    expect(second.mcpServersImported).toBe(0);
    expect(second.filesWritten).toEqual([]);
    expect(await fs.readFile(path.join(root, 'CODEBUDDY.md'))).toEqual(firstRules);
    expect(await fs.readFile(path.join(root, '.codebuddy/mcp.json'))).toEqual(firstMCP);
    expect(firstRules.toString('utf8').match(/codebuddy-import:/g) ?? []).toHaveLength(1);
  });

  it('supports a Cline rules file and leaves the project untouched in dry-run mode', async () => {
    const root = await temporaryProject();
    await writeFixture(root, 'migration/.clinerules', 'Règle Cline monofichier.\n');
    await writeFixture(
      root,
      'migration/.mcp.json',
      JSON.stringify({ mcpServers: { fixture: { command: 'fixture-mcp' } } })
    );
    const output: string[] = [];
    const command = createImportCommand({ cwd: root, stdout: (message) => output.push(message) });

    await command.parseAsync(['node', 'import', '--dry-run', '--from', 'migration']);

    expect(output.join('\n')).toContain(
      'Aperçu de l’import depuis migration (aucun fichier écrit)'
    );
    expect(output.join('\n')).toContain('À importer : 1 source de règles, 1 serveur MCP.');
    await expect(fs.stat(path.join(root, 'CODEBUDDY.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.stat(path.join(root, '.codebuddy'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects --from paths outside the current project', async () => {
    const root = await temporaryProject('codebuddy-import-project-');
    const outside = await temporaryProject('codebuddy-import-outside-');
    await writeFixture(outside, '.cursorrules', 'Ne doit pas être lu.\n');

    await expect(importProjectConfiguration({ from: outside }, { cwd: root })).rejects.toThrow(
      '--from doit rester dans le projet courant'
    );
    await expect(fs.stat(path.join(root, 'CODEBUDDY.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not partially append rules when the existing MCP destination is invalid', async () => {
    const root = await temporaryProject();
    await writeFixture(root, 'CODEBUDDY.md', '# Contenu intact\n');
    await writeFixture(root, '.cursorrules', 'Nouvelle règle.\n');
    await writeFixture(root, '.codebuddy/mcp.json', '{ invalide');

    await expect(importProjectConfiguration({}, { cwd: root })).rejects.toThrow(
      'JSON invalide dans .codebuddy/mcp.json'
    );
    expect(await fs.readFile(path.join(root, 'CODEBUDDY.md'), 'utf8')).toBe('# Contenu intact\n');
    expect(await fs.readFile(path.join(root, '.codebuddy/mcp.json'), 'utf8')).toBe('{ invalide');
  });
});
