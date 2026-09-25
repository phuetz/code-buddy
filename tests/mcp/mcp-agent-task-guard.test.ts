/**
 * In-process MCP server. agent_task launches the real agent with a local fake
 * model (no socket). With CODEBUDDY_AUTO_CONFIRM and no sandbox, a bash write
 * and a create_file outside the server workspace must both be refused.
 * The same agent constructed without the MCP write context still writes.
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

function show(id: string, present: boolean, isError: boolean, text: string): void {
  const line = `ASSERT ${id} fichier=${present ? 'PRESENT' : 'ABSENT'} erreur=${isError} texte=${JSON.stringify(text)}`;
  console.log(line);
  const outDir = process.env.MCP_AGENT_OUT || process.env.MCP_BASH_OUT;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({
      line, present, isError, text,
    }, null, 2));
  }
}

/** One tool call on the first user turn, then a short stop. Never opens a socket. */
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
                function: {
                  name: toolName,
                  arguments: JSON.stringify(toolArguments),
                },
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
  outsideFile: string;
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
  return {
    parent,
    workspace,
    outsideFile: path.join(outsideDir, 'cible.txt'),
    previousCwd,
  };
}

describe.sequential('agent_task recoit le contexte MCP', () => {
  const previousDisable = process.env.CODEBUDDY_DISABLE_MCP;
  const originCwd = process.cwd();

  afterEach(() => {
    setSandboxCapabilityProbe(null);
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    if (previousDisable === undefined) delete process.env.CODEBUDDY_DISABLE_MCP;
    else process.env.CODEBUDDY_DISABLE_MCP = previousDisable;
    try { process.chdir(originCwd); } catch { /* origin removed */ }
    resetTextEditorInstance();
    for (const dir of disposables.splice(0)) removeTestDir(dir);
  });

  async function callAgentTask(
    dirs: Layout,
    model: AgentModelClient,
  ): Promise<{ isError: boolean; text: string }> {
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
    const client = new Client({ name: 'mcp-agent-task-guard', version: '1' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: 'agent_task',
        arguments: { task: 'follow the request' },
      });
      return {
        isError: (result as { isError?: boolean }).isError === true,
        text: toolText(result as { content?: Array<{ text?: string }> }),
      };
    } finally {
      await client.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
      if (dirs.previousCwd) {
        try { process.chdir(dirs.previousCwd); } catch { /* removed */ }
      }
    }
  }

  it('refuse bash hors espace quand l agent vient du serveur MCP', async () => {
    const dirs = layout('mcp-agent-bash-');
    const outcome = await callAgentTask(
      dirs,
      fakeModel('bash', {
        command: `printf '%s\\n' hors > ${JSON.stringify(dirs.outsideFile)}`,
      }),
    );
    const present = fs.existsSync(dirs.outsideFile);
    show('agent-bash', present, outcome.isError, outcome.text);
    expect(present, 'ASSERT agent-bash fichier absent').toBe(false);
    expect(outcome.text, 'ASSERT agent-bash escalade refusee').toMatch(
      /unconfined escalation refused in MCP mode/i,
    );
  }, 180_000);

  it('refuse create_file hors espace quand l agent vient du serveur MCP', async () => {
    const dirs = layout('mcp-agent-file-');
    const outcome = await callAgentTask(
      dirs,
      fakeModel('create_file', {
        path: dirs.outsideFile,
        content: 'hors\n',
      }),
    );
    const present = fs.existsSync(dirs.outsideFile);
    show('agent-fichier', present, outcome.isError, outcome.text);
    expect(present, 'ASSERT agent-fichier fichier absent').toBe(false);
    expect(outcome.text, 'ASSERT agent-fichier hors espace').toMatch(
      /outside workspace not allowed/i,
    );
  }, 180_000);

  it('la boucle agent hors MCP ecrit encore hors espace', async () => {
    const dirs = layout('mcp-agent-loop-');
    process.env.CODEBUDDY_DISABLE_MCP = 'true';
    process.env.CODEBUDDY_AUTO_CONFIRM = 'true';
    setSandboxCapabilityProbe(() => noSandbox);
    const { CodeBuddyAgent } = await import('../../src/agent/codebuddy-agent.js');
    const agent = new CodeBuddyAgent(
      'local-model',
      undefined,
      'fake-local',
      2,
      false,
      undefined,
      dirs.parent,
      undefined,
      undefined,
      {
        modelClient: fakeModel('bash', {
          command: `printf '%s\\n' agent > ${JSON.stringify(dirs.outsideFile)}`,
        }),
      },
    );
    try {
      const entries = await agent.processUserMessage('follow the request');
      const text = entries.map((entry) => entry.content || entry.toolResult?.output || entry.toolResult?.error || '').join('\n');
      const present = fs.existsSync(dirs.outsideFile);
      const success = entries.some((entry) => entry.toolResult?.success === true);
      show('agent-hors-mcp', present, !success, text);
      expect(present, 'ASSERT agent-hors-mcp fichier present').toBe(true);
      expect(success, 'ASSERT agent-hors-mcp succes').toBe(true);
    } finally {
      agent.dispose();
      try { process.chdir(dirs.previousCwd); } catch { /* removed */ }
    }
  }, 180_000);
});
