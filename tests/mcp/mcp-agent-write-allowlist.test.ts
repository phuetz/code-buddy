/**
 * MCP write context authorizes tools, not argument-key names.
 * computer_control can write outside the workspace through exportAuditPath,
 * a key the old name list does not confine. A key-name list alone must stay
 * red. The model is a local fake. It never opens a socket.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AgentModelClient } from '../../src/agent/codebuddy-agent.js';
import { CodeBuddyMCPServer } from '../../src/mcp/mcp-server.js';
import { setSandboxCapabilityProbe } from '../../src/sandbox/os-sandbox.js';
import { resetTextEditorInstance } from '../../src/tools/registry/text-editor-tools.js';

const disposables: string[] = [];
const noSandbox = {
  landlock: false,
  bubblewrap: false,
  seatbelt: false,
  docker: false,
  recommended: 'none' as const,
};

function toolText(result: { content?: Array<{ text?: string }> } | undefined): string {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
}

function show(id: string, present: boolean, text: string): void {
  const line = `ASSERT ${id} fichier=${present ? 'PRESENT' : 'ABSENT'} texte=${JSON.stringify(text.slice(0, 700))}`;
  console.log(line);
  const outDir = process.env.MCP_AGENT_OUT || process.env.MCP_BASH_OUT;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ line, present, text }, null, 2));
  }
}

function fakeModel(toolName: string, toolArguments: Record<string, unknown>): AgentModelClient {
  let served = false;
  return {
    getCurrentModel: () => 'fake-local',
    isEffectiveTargetLocal: () => true,
    setModel: () => undefined,
    setDefaultThinkingLevel: () => undefined,
    probeToolSupport: async () => true,
    chat: async () => {
      throw new Error('fake local model refused a non-streaming chat');
    },
    chatStream: async function* (messages: readonly unknown[]) {
      const last = messages[messages.length - 1] as { role?: string } | undefined;
      if (!served && last?.role === 'user') {
        served = true;
        yield {
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_fake_local',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(toolArguments) },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        };
        return;
      }
      yield {
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: 'done' },
          finish_reason: 'stop',
        }],
      };
    },
  };
}

interface Layout {
  parent: string;
  workspace: string;
  outsideDir: string;
  previousCwd: string;
}

function layout(prefix: string): Layout {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspace = path.join(parent, 'espace');
  const outsideDir = path.join(parent, 'hors');
  fs.mkdirSync(workspace);
  fs.mkdirSync(outsideDir);
  disposables.push(parent);
  const previousCwd = process.cwd();
  process.chdir(parent);
  resetTextEditorInstance();
  return { parent, workspace, outsideDir, previousCwd };
}

describe.sequential('agent_task autorise les outils d ecriture, pas les noms de cles', () => {
  const previousDisable = process.env.CODEBUDDY_DISABLE_MCP;
  const originCwd = process.cwd();

  afterEach(() => {
    setSandboxCapabilityProbe(null);
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    if (previousDisable === undefined) delete process.env.CODEBUDDY_DISABLE_MCP;
    else process.env.CODEBUDDY_DISABLE_MCP = previousDisable;
    try { process.chdir(originCwd); } catch { /* origin removed */ }
    resetTextEditorInstance();
    for (const dir of disposables.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function callAgent(
    dirs: Layout,
    model: AgentModelClient,
  ): Promise<string> {
    process.env.CODEBUDDY_DISABLE_MCP = 'true';
    process.env.CODEBUDDY_AUTO_CONFIRM = 'true';
    setSandboxCapabilityProbe(() => noSandbox);
    const server = new CodeBuddyMCPServer({
      allowWrite: true,
      tools: 'agent_task',
      workingDirectory: dirs.workspace,
      agentModelClient: model,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mcp-agent-write-allowlist', version: '1' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: 'agent_task',
        arguments: { task: 'follow the request' },
      });
      return toolText(result as { content?: Array<{ text?: string }> });
    } finally {
      await client.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
      try { process.chdir(dirs.previousCwd); } catch { /* removed */ }
    }
  }

  it('refuse computer_control export_audit_log hors espace', async () => {
    const dirs = layout('mcp-agent-audit-');
    const target = path.join(dirs.outsideDir, 'audit.json');
    const text = await callAgent(dirs, fakeModel('computer_control', {
      action: 'export_audit_log',
      exportAuditPath: target,
      confirmDangerous: true,
    }));
    const present = fs.existsSync(target);
    show('export-audit-hors', present, text);
    expect(present, 'ASSERT export-audit fichier absent').toBe(false);
    expect(text, 'ASSERT export-audit outil refuse').toMatch(/MCP write allowlist refuses/i);
    expect(text, 'ASSERT export-audit nomme computer_control').toMatch(/computer_control/);
  }, 180_000);

  it('accepte create_file dans l espace', async () => {
    const dirs = layout('mcp-agent-dedans-');
    const target = path.join(dirs.workspace, 'dedans.txt');
    const text = await callAgent(dirs, fakeModel('create_file', {
      path: 'dedans.txt',
      content: 'dedans\n',
    }));
    const present = fs.existsSync(target);
    show('create-dedans', present, text);
    expect(present, 'ASSERT create-dedans fichier present').toBe(true);
    expect(fs.readFileSync(target, 'utf8'), 'ASSERT create-dedans contenu').toBe('dedans\n');
    expect(text, 'ASSERT create-dedans succes').toMatch(/Tool Result: Success/i);
  }, 180_000);

  it('laisse view_file intact', async () => {
    const dirs = layout('mcp-agent-lecture-');
    const target = path.join(dirs.workspace, 'lu.txt');
    fs.writeFileSync(target, 'lecture-mcp\n');
    const text = await callAgent(dirs, fakeModel('view_file', {
      path: 'lu.txt',
    }));
    show('lecture', fs.existsSync(target), text);
    expect(text, 'ASSERT lecture contenu').toMatch(/lecture-mcp/);
    expect(text, 'ASSERT lecture pas un refus d outil').not.toMatch(/MCP write allowlist refuses/i);
  }, 180_000);

  it('refuse une cle inconnue qui porte un chemin absolu hors espace', async () => {
    const dirs = layout('mcp-agent-cle-inconnue-');
    const inside = path.join(dirs.workspace, 'dedans.txt');
    const outside = path.join(dirs.outsideDir, 'fuite.txt');
    const text = await callAgent(dirs, fakeModel('create_file', {
      path: 'dedans.txt',
      content: 'ok\n',
      exportAuditPath: outside,
    }));
    const presentInside = fs.existsSync(inside);
    const presentOutside = fs.existsSync(outside);
    show('cle-inconnue-dedans', presentInside, text);
    show('cle-inconnue-hors', presentOutside, text);
    expect(presentInside, 'ASSERT cle-inconnue fichier dedans absent').toBe(false);
    expect(presentOutside, 'ASSERT cle-inconnue fichier hors absent').toBe(false);
    expect(text, 'ASSERT cle-inconnue hors espace').toMatch(/outside workspace not allowed/i);
  }, 180_000);
});
