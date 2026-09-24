/**
 * Real MCP stdio process. Write tools must not bypass ToolHandler.
 * No elicitation capability is advertised: a non-interactive client is refused
 * unless CODEBUDDY_AUTO_CONFIRM is set (explicit policy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TOOLS = 'apply_patch,create_file,list_directory';
const homes: string[] = [];

function childEnv(homeDir: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: homeDir,
    USERPROFILE: homeDir,
    TMPDIR: os.tmpdir(),
    NO_COLOR: '1',
    CI: '1',
    LOG_LEVEL: 'error',
    ...extra,
  };
}

function toolText(result: { content?: Array<{ text?: string }> } | undefined): string {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
}

interface CallOutcome {
  isError: boolean;
  text: string;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallOutcome> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = toolText(result as { content?: Array<{ text?: string }> });
    return { isError: (result as { isError?: boolean }).isError === true, text };
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) };
  }
}

async function session(options: {
  name: string;
  allowWrite: boolean;
  autoConfirm?: boolean;
  /** When set, the server cwd is the disposable home, so a blocked directory inside it is not "outside". */
  workspaceIsHome?: boolean;
}): Promise<{
  names: string[];
  calls: Record<string, CallOutcome>;
  files: Record<string, boolean>;
}> {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-home-'));
  const workspace = options.workspaceIsHome
    ? homeDir
    : fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-espace-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-hors-'));
  homes.push(homeDir, outsideDir);
  if (workspace !== homeDir) homes.push(workspace);
  fs.writeFileSync(path.join(workspace, 'lecture.txt'), 'lecture\n');
  const protectedFile = path.join(homeDir, '.ssh', 'mcp-probe');
  fs.mkdirSync(path.dirname(protectedFile), { recursive: true });
  const insideName = 'dedans.txt';
  const outsideFile = path.join(outsideDir, 'cible.txt');
  const files = {
    inside: path.join(workspace, insideName),
    outside: outsideFile,
    protected: protectedFile,
  };

  const args = [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('src/index.ts'),
    'mcp', 'serve',
    '--tools', TOOLS,
  ];
  if (options.allowWrite) args.push('--allow-write');
  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: workspace,
    env: childEnv(homeDir, options.autoConfirm ? { CODEBUDDY_AUTO_CONFIRM: 'true' } : {}),
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString('utf8'));
  });
  const client = new Client({ name: 'mcp-write-guard', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = (listed.tools || []).map((tool) => tool.name).sort();
    const calls: Record<string, CallOutcome> = {};
    if (options.allowWrite) {
      calls.inside = await call(client, 'apply_patch', {
        patch: `*** Begin Patch\n*** Add File: ${insideName}\n+dedans\n*** End Patch`,
      });
      calls.outside = await call(client, 'apply_patch', {
        patch: `*** Begin Patch\n*** Add File: ${outsideFile}\n+dehors\n*** End Patch`,
      });
      calls.protected = await call(client, 'apply_patch', {
        patch: `*** Begin Patch\n*** Add File: ${protectedFile}\n+protege\n*** End Patch`,
      });
    } else {
      calls.write = await call(client, 'apply_patch', {
        patch: '*** Begin Patch\n*** Add File: sans.txt\n+sans\n*** End Patch',
      });
      calls.create = await call(client, 'create_file', {
        path: path.join(workspace, 'sans-fichier.txt'),
        content: 'sans',
      });
      calls.read = await call(client, 'list_directory', { path: workspace });
      files.inside = path.join(workspace, 'sans.txt');
    }
    const present = {
      inside: fs.existsSync(files.inside),
      outside: fs.existsSync(files.outside),
      protected: fs.existsSync(files.protected),
    };
    const outDir = process.env.MCP_AW_OUT;
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, `${options.name}.json`), JSON.stringify({
        names, calls, present, stderr: stderr.join('').slice(0, 4000),
      }, null, 2));
    }
    return { names, calls, files: present };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function show(id: string, outcome: CallOutcome | undefined, present: boolean): void {
  console.log(
    `ASSERT ${id} fichier=${present ? 'PRESENT' : 'ABSENT'} erreur=${outcome?.isError === true} texte=${JSON.stringify(outcome?.text ?? '')}`,
  );
}

describe('garde d ecriture du serveur MCP', () => {
  afterEach(() => {
    for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuse apply_patch dans l espace sans politique explicite', async () => {
    const result = await session({ name: 'dedans', allowWrite: true });
    show('dedans', result.calls.inside, result.files.inside);
    expect(result.files.inside, 'ASSERT dedans fichier absent').toBe(false);
    expect(result.calls.inside?.isError, 'ASSERT dedans en erreur').toBe(true);
    expect(result.calls.inside?.text, 'ASSERT dedans message de refus').toMatch(
      /cancel|denied|refus|approval|elicit/i,
    );
  }, 120_000);

  it('refuse une ecriture hors de l espace de travail', async () => {
    const result = await session({ name: 'dehors', allowWrite: true, autoConfirm: true });
    show('dehors', result.calls.outside, result.files.outside);
    expect(result.files.outside, 'ASSERT dehors fichier absent').toBe(false);
    expect(result.calls.outside?.isError, 'ASSERT dehors en erreur').toBe(true);
    expect(result.calls.outside?.text, 'ASSERT dehors message de confinement').toMatch(
      /outside workspace|not in a trusted directory|not allowed/i,
    );
  }, 120_000);

  it('refuse une ecriture vers un chemin protege', async () => {
    const result = await session({
      name: 'protege',
      allowWrite: true,
      autoConfirm: true,
      workspaceIsHome: true,
    });
    show('protege', result.calls.protected, result.files.protected);
    expect(result.files.protected, 'ASSERT protege fichier absent').toBe(false);
    expect(result.calls.protected?.isError, 'ASSERT protege en erreur').toBe(true);
    expect(result.calls.protected?.text, 'ASSERT protege message').toMatch(
      /protected path|blocked/i,
    );
  }, 120_000);

  it('n expose pas les outils d ecriture sans allow-write et garde la lecture', async () => {
    const result = await session({ name: 'sans-drapeau', allowWrite: false });
    console.log(`ASSERT sans_drapeau outils=${result.names.join(',')}`);
    show('sans_drapeau_ecriture', result.calls.write, result.files.inside);
    show('sans_drapeau_lecture', result.calls.read, false);
    expect(result.names, 'ASSERT sans_drapeau pas de apply_patch').not.toContain('apply_patch');
    expect(result.names, 'ASSERT sans_drapeau pas de create_file').not.toContain('create_file');
    expect(result.names, 'ASSERT sans_drapeau lecture presente').toContain('list_directory');
    expect(result.files.inside, 'ASSERT sans_drapeau fichier absent').toBe(false);
    expect(result.calls.write?.text, 'ASSERT sans_drapeau outil absent').toMatch(/not found/i);
    expect(result.calls.read?.isError, 'ASSERT sans_drapeau lecture ok').toBe(false);
    expect(result.calls.read?.text, 'ASSERT sans_drapeau voit le fichier de lecture').toMatch(/lecture\.txt/);
  }, 120_000);

  it('ecrit dans l espace seulement avec une politique explicite', async () => {
    const result = await session({ name: 'politique', allowWrite: true, autoConfirm: true });
    show('politique_dedans', result.calls.inside, result.files.inside);
    show('politique_dehors', result.calls.outside, result.files.outside);
    show('politique_protege', result.calls.protected, result.files.protected);
    expect(result.files.inside, 'ASSERT politique fichier present').toBe(true);
    expect(result.calls.inside?.isError, 'ASSERT politique pas en erreur').toBe(false);
    expect(result.files.outside, 'ASSERT politique dehors absent').toBe(false);
    expect(result.files.protected, 'ASSERT politique protege absent').toBe(false);
  }, 120_000);
});
