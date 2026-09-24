/**
 * Real MCP stdio process. Bash must not escalate to an unconfined host
 * command when the workspace sandbox is unavailable, even if
 * CODEBUDDY_AUTO_CONFIRM=true. The capability probe is injected in the child
 * before serveMCP(); ToolHandler and BashTool are the real ones.
 *
 * Retained behavior inside the workspace with no sandbox: the command is
 * refused too. An unconfined shell could write anywhere, whatever path the
 * command text names.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setSandboxCapabilityProbe } from '../../src/sandbox/os-sandbox.js';
import { probeNativeSandbox } from '../sandbox/native-sandbox-ready.js';

const nativeSandbox = await probeNativeSandbox();
const realSandboxAvailable = nativeSandbox.ready;
const realSandboxSkip = realSandboxAvailable ? '' : ` — ignore : ${nativeSandbox.reason}`;

const disposables: string[] = [];
const openChildren: Array<{ pid: () => number | null; close: () => Promise<void> }> = [];

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function childEnv(homeDir: string, codebuddyHome: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: homeDir,
    USERPROFILE: homeDir,
    CODEBUDDY_HOME: codebuddyHome,
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
  stderr: string;
  workspace: string;
}

async function mcpBash(options: {
  name: string;
  command: string;
  autoConfirm?: boolean;
  forceNoSandbox?: boolean;
  workspace?: string;
}): Promise<CallOutcome> {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bash-home-'));
  const codebuddyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bash-cbhome-'));
  const workspace = options.workspace ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bash-espace-'));
  disposables.push(homeDir, codebuddyHome, workspace);
  const args = [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('tests/mcp/mcp-bash-sandbox-entry.ts'),
    '--allow-write',
    '--tools',
    'bash',
  ];
  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: workspace,
    env: childEnv(homeDir, codebuddyHome, {
      ...(options.autoConfirm ? { CODEBUDDY_AUTO_CONFIRM: 'true' } : {}),
      ...(options.forceNoSandbox ? { CODEBUDDY_TEST_SANDBOX_FORCE: 'none' } : {}),
    }),
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString('utf8'));
  });
  openChildren.push({
    pid: () => transport.pid ?? null,
    close: () => transport.close(),
  });
  const client = new Client({ name: 'mcp-bash-sandbox', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'bash', arguments: { command: options.command } });
    const text = toolText(result as { content?: Array<{ text?: string }> });
    return {
      isError: (result as { isError?: boolean }).isError === true,
      text,
      stderr: stderr.join(''),
      workspace,
    };
  } catch (error) {
    return {
      isError: true,
      text: error instanceof Error ? error.message : String(error),
      stderr: stderr.join(''),
      workspace,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function show(id: string, outcome: CallOutcome, present: boolean): void {
  const line = `ASSERT ${id} fichier=${present ? 'PRESENT' : 'ABSENT'} erreur=${outcome.isError} texte=${JSON.stringify(outcome.text)}`;
  console.log(line);
  console.log(`ASSERT ${id} stderr=${JSON.stringify(outcome.stderr.slice(0, 800))}`);
  const outDir = process.env.MCP_BASH_OUT;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({
      line,
      present,
      isError: outcome.isError,
      text: outcome.text,
      stderr: outcome.stderr.slice(0, 4000),
    }, null, 2));
  }
}

describe.sequential('garde shell MCP sans bac a sable', () => {
  console.log(`ASSERT capacites-hote ${nativeSandbox.reason}`);

  afterEach(async () => {
    setSandboxCapabilityProbe(null);
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    for (const child of openChildren.splice(0)) {
      await child.close().catch(() => undefined);
      const pid = child.pid();
      if (typeof pid === 'number' && pid > 0) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* deja termine */ }
      }
    }
    for (const dir of disposables.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuse bash hors de l espace quand aucun bac a sable n est disponible', async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bash-hors-'));
    disposables.push(outsideDir);
    const outsideFile = path.join(outsideDir, 'bash-hors.txt');
    const outcome = await mcpBash({
      name: 'hors',
      autoConfirm: true,
      forceNoSandbox: true,
      command: `printf '%s\\n' hors > ${shellQuote(outsideFile)}`,
    });
    const present = fs.existsSync(outsideFile);
    show('hors', outcome, present);
    expect(present, 'ASSERT hors fichier absent').toBe(false);
    expect(outcome.stderr, 'ASSERT probe injectee').toContain('probe=none recommended=none');
    expect(outcome.isError, 'ASSERT hors en erreur').toBe(true);
    expect(outcome.text, 'ASSERT hors bac a sable indisponible').toMatch(/sandbox unavailable/i);
    expect(outcome.text, 'ASSERT hors escalade non confinee refusee').toMatch(
      /unconfined escalation refused in MCP mode/i,
    );
  }, 180_000);

  it('refuse aussi bash dans l espace, car le processus ne serait pas confine', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bash-dedans-'));
    const insideFile = path.join(workspace, 'bash-dedans.txt');
    const outcome = await mcpBash({
      name: 'dedans',
      workspace,
      autoConfirm: true,
      forceNoSandbox: true,
      command: `printf '%s\\n' dedans > ${shellQuote(insideFile)}`,
    });
    const present = fs.existsSync(insideFile);
    show('dedans', outcome, present);
    expect(present, 'ASSERT dedans fichier absent').toBe(false);
    expect(outcome.isError, 'ASSERT dedans en erreur').toBe(true);
    expect(outcome.text, 'ASSERT dedans bac a sable indisponible').toMatch(/sandbox unavailable/i);
    expect(outcome.text, 'ASSERT dedans escalade non confinee refusee').toMatch(
      /unconfined escalation refused in MCP mode/i,
    );
  }, 180_000);

  it.skipIf(!realSandboxAvailable)(
    `avec un bac a sable reel, bash dans l espace ecrit le fichier${realSandboxSkip}`,
    async () => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bash-reel-'));
      const insideFile = path.join(workspace, 'bash-reel.txt');
      const outcome = await mcpBash({
        name: 'reel-dedans',
        workspace,
        autoConfirm: true,
        forceNoSandbox: false,
        command: `printf '%s\\n' reel > ${shellQuote(insideFile)}`,
      });
      const present = fs.existsSync(insideFile);
      show('reel-dedans', outcome, present);
      expect(present, 'ASSERT reel dedans fichier present').toBe(true);
      expect(outcome.isError, 'ASSERT reel dedans pas en erreur').toBe(false);
    },
    180_000,
  );

  it.skipIf(!realSandboxAvailable)(
    `avec un bac a sable reel, bash hors de l espace n ecrit pas${realSandboxSkip}`,
    async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bash-reel-hors-'));
      disposables.push(outsideDir);
      const outsideFile = path.join(outsideDir, 'bash-reel-hors.txt');
      const outcome = await mcpBash({
        name: 'reel-hors',
        autoConfirm: true,
        forceNoSandbox: false,
        command: `printf '%s\\n' reel-hors > ${shellQuote(outsideFile)}`,
      });
      const present = fs.existsSync(outsideFile);
      show('reel-hors', outcome, present);
      expect(present, 'ASSERT reel hors fichier absent').toBe(false);
      expect(outcome.isError, 'ASSERT reel hors en erreur').toBe(true);
    },
    180_000,
  );
});
