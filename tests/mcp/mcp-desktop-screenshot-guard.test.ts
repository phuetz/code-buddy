/**
 * desktop_screenshot is an MCP tool, not a ToolHandler call. output_path must
 * stay inside the server workspace. The screen grabber is injected; the tool
 * class and the MCP registration are the real ones. No display is required.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CodeBuddyMCPServer } from '../../src/mcp/mcp-server.js';
import { setScreenshotSensor, type ScreenshotResult } from '../../src/tools/screenshot-tool.js';

const disposables: string[] = [];

function toolText(result: { content?: Array<{ text?: string }>; isError?: boolean } | undefined): {
  isError: boolean;
  text: string;
} {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return {
    isError: result?.isError === true,
    text: blocks.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n'),
  };
}

function show(id: string, present: boolean, grabbed: number, isError: boolean, text: string): void {
  const line = `ASSERT ${id} fichier=${present ? 'PRESENT' : 'ABSENT'} capteur=${grabbed} erreur=${isError} texte=${JSON.stringify(text.slice(0, 400))}`;
  console.log(line);
  const outDir = process.env.MCP_AGENT_OUT || process.env.MCP_BASH_OUT;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({
      line, present, grabbed, isError, text,
    }, null, 2));
  }
}

describe.sequential('desktop_screenshot confine output_path', () => {
  const previousDisable = process.env.CODEBUDDY_DISABLE_MCP;
  const previousDisplay = process.env.DISPLAY;
  const previousWayland = process.env.WAYLAND_DISPLAY;
  const originCwd = process.cwd();

  afterEach(() => {
    setScreenshotSensor(null);
    if (previousDisable === undefined) delete process.env.CODEBUDDY_DISABLE_MCP;
    else process.env.CODEBUDDY_DISABLE_MCP = previousDisable;
    if (previousDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = previousDisplay;
    if (previousWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = previousWayland;
    try { process.chdir(originCwd); } catch { /* origin removed */ }
    for (const dir of disposables.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function callScreenshot(kind: 'hors' | 'dedans'): Promise<{
    isError: boolean;
    text: string;
    grabbed: number;
    target: string;
  }> {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-shot-'));
    const workspace = path.join(parent, 'espace');
    const outsideDir = path.join(parent, 'hors');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outsideDir);
    disposables.push(parent);
    process.chdir(parent);
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    process.env.CODEBUDDY_DISABLE_MCP = 'true';
    const target = kind === 'hors'
      ? path.join(outsideDir, 'hors.png')
      : path.join(workspace, 'dedans.png');

    let grabbed = 0;
    setScreenshotSensor(async (outputPath): Promise<ScreenshotResult> => {
      grabbed += 1;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'png');
      return { path: outputPath, size: '3', timestamp: '1970-01-01T00:00:00.000Z' };
    });

    const server = new CodeBuddyMCPServer({
      allowWrite: true,
      tools: 'desktop_screenshot',
      workingDirectory: workspace,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'mcp-desktop-shot', version: '1' }, { capabilities: {} });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: 'desktop_screenshot',
        arguments: { output_path: target },
      });
      const outcome = toolText(result as { content?: Array<{ text?: string }>; isError?: boolean });
      return { ...outcome, grabbed, target };
    } finally {
      await client.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
    }
  }

  it('refuse un output_path hors espace sans appeler le capteur', async () => {
    const outcome = await callScreenshot('hors');
    const present = fs.existsSync(outcome.target);
    show('shot-hors', present, outcome.grabbed, outcome.isError, outcome.text);
    expect(present, 'ASSERT shot-hors fichier absent').toBe(false);
    expect(outcome.grabbed, 'ASSERT shot-hors capteur non appele').toBe(0);
    expect(outcome.isError, 'ASSERT shot-hors en erreur').toBe(true);
    expect(outcome.text, 'ASSERT shot-hors hors espace').toMatch(/outside workspace not allowed/i);
  }, 60_000);

  it('ecrit dans l espace quand le capteur est injecte et qu il n y a pas d ecran', async () => {
    const outcome = await callScreenshot('dedans');
    const present = fs.existsSync(outcome.target);
    show('shot-dedans', present, outcome.grabbed, outcome.isError, outcome.text);
    expect(present, 'ASSERT shot-dedans fichier present').toBe(true);
    expect(fs.readFileSync(outcome.target, 'utf8'), 'ASSERT shot-dedans octets du capteur').toBe('png');
    expect(outcome.grabbed, 'ASSERT shot-dedans capteur appele').toBe(1);
    expect(outcome.isError, 'ASSERT shot-dedans pas en erreur').toBe(false);
  }, 60_000);
});
