/**
 * agent_task must refuse write destinations whose argument is not named
 * `path`. outputDir (deploy) and output_dir (archive extract) are two of those.
 * The model is a local fake. It never opens a socket.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AgentModelClient } from '../../src/agent/codebuddy-agent.js';
import { CodeBuddyMCPServer } from '../../src/mcp/mcp-server.js';
import { setSandboxCapabilityProbe } from '../../src/sandbox/os-sandbox.js';
import { removeTestDir } from '../helpers/tmp.js';

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
  const line = `ASSERT ${id} fichier=${present ? 'PRESENT' : 'ABSENT'} texte=${JSON.stringify(text.slice(0, 500))}`;
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

/** One stored-method zip. No extra dependency. */
function storedZip(name: string, content: string): Buffer {
  const fileName = Buffer.from(name);
  const data = Buffer.from(content);
  const checksum = crc32(data) >>> 0;
  const local = Buffer.alloc(30 + fileName.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  fileName.copy(local, 30);
  data.copy(local, 30 + fileName.length);
  const central = Buffer.alloc(46 + fileName.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);
  fileName.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
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
  return { parent, workspace, outsideDir, previousCwd };
}

describe.sequential('agent_task confine les autres cles d ecriture', () => {
  const previousDisable = process.env.CODEBUDDY_DISABLE_MCP;
  const originCwd = process.cwd();

  afterEach(() => {
    setSandboxCapabilityProbe(null);
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    if (previousDisable === undefined) delete process.env.CODEBUDDY_DISABLE_MCP;
    else process.env.CODEBUDDY_DISABLE_MCP = previousDisable;
    try { process.chdir(originCwd); } catch { /* origin removed */ }
    for (const dir of disposables.splice(0)) removeTestDir(dir);
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
    const client = new Client({ name: 'mcp-agent-write-keys', version: '1' }, { capabilities: {} });
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

  it('refuse deploy outputDir hors espace', async () => {
    const dirs = layout('mcp-agent-outdir-');
    const target = path.join(dirs.outsideDir, 'fly.toml');
    const text = await callAgent(dirs, fakeModel('deploy', {
      action: 'generate_config',
      platform: 'fly',
      appName: 'sonde',
      outputDir: dirs.outsideDir,
    }));
    const present = fs.existsSync(target);
    show('deploy-outputDir-hors', present, text);
    expect(present, 'ASSERT deploy-outputDir fichier absent').toBe(false);
    expect(text, 'ASSERT deploy-outputDir hors espace').toMatch(/outside workspace not allowed/i);
  }, 180_000);

  it('accepte deploy outputDir dans l espace', async () => {
    const dirs = layout('mcp-agent-outdir-in-');
    const inside = path.join(dirs.workspace, 'sortie');
    fs.mkdirSync(inside);
    const target = path.join(inside, 'fly.toml');
    const text = await callAgent(dirs, fakeModel('deploy', {
      action: 'generate_config',
      platform: 'fly',
      appName: 'sonde',
      outputDir: inside,
    }));
    const present = fs.existsSync(target);
    show('deploy-outputDir-dedans', present, text);
    expect(present, 'ASSERT deploy-outputDir dedans fichier present').toBe(true);
  }, 180_000);

  it('refuse archive output_dir hors espace', async () => {
    const dirs = layout('mcp-agent-outputdir-');
    const archivePath = path.join(dirs.workspace, 'paquet.zip');
    fs.writeFileSync(archivePath, storedZip('dedans.txt', 'ok\n'));
    const extracted = path.join(dirs.outsideDir, 'dedans.txt');
    const text = await callAgent(dirs, fakeModel('archive', {
      operation: 'extract',
      path: archivePath,
      output_dir: dirs.outsideDir,
    }));
    const present = fs.existsSync(extracted);
    show('archive-output_dir-hors', present, text);
    expect(present, 'ASSERT archive-output_dir fichier absent').toBe(false);
    expect(text, 'ASSERT archive-output_dir hors espace').toMatch(/outside workspace not allowed/i);
  }, 180_000);
});
