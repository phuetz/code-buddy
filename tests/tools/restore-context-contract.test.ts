import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { RESTORE_CONTEXT_TOOL } from '../../src/codebuddy/tool-definitions/agent-tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { RestoreContextTool } from '../../src/tools/registry/attention-tools.js';
import {
  getRestorableCompressor,
  resetRestorableCompressor,
} from '../../src/context/restorable-compression.js';

describe('restore_context public contract', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    resetRestorableCompressor();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('teaches models to prefer exact tool call IDs for raw observation recovery', () => {
    const registryTool = new RestoreContextTool();
    const registrySchema = registryTool.getSchema();
    const providerDescription = RESTORE_CONTEXT_TOOL.function.description;
    const providerIdentifier = RESTORE_CONTEXT_TOOL.function.parameters.properties?.identifier;

    expect(registryTool.description).toContain('exact originating tool call ID');
    expect(registryTool.description).toContain('active workspace');
    expect(registryTool.description).toContain('conversation session');
    expect(registryTool.description).toContain('never performs a fresh file read');
    expect(registrySchema.parameters.properties.identifier?.description).toContain('tool call ID');
    expect(registrySchema.parameters.properties.identifier?.description).toContain('session');
    expect(providerDescription).toContain('exact originating tool call ID');
    expect(providerDescription).toContain('active workspace');
    expect(providerDescription).toContain('conversation session');
    expect(providerDescription).toContain('never performs a fresh file read');
    expect(providerIdentifier?.description).toContain('tool call ID');
    expect(providerIdentifier?.description).toContain('session');
  });

  it('does not advertise raw recovery as fleet-safe and requires confirmation', () => {
    const metadata = TOOL_METADATA.find((entry) => entry.name === 'restore_context');
    const registryMetadata = new RestoreContextTool().getMetadata();

    expect(metadata).toMatchObject({
      description: expect.stringContaining('active workspace'),
    });
    expect(metadata?.description).toContain('session');
    expect(metadata?.fleetSafe).not.toBe(true);
    expect(metadata?.keywords).toContain('exact');
    expect(registryMetadata.requiresConfirmation).toBe(true);
  });

  it('restores only the session carried by the tool execution context', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-context-session-'));
    temporaryDirectories.push(workspace);
    const compressor = getRestorableCompressor();
    compressor.writeToolResult('call_same', 'session A', workspace, 'session-a');
    compressor.writeToolResult('call_same', 'session B', workspace, 'session-b');
    const tool = new RestoreContextTool();

    await expect(tool.execute(
      { identifier: 'call_same' },
      { cwd: workspace, sessionId: 'session-a' },
    )).resolves.toMatchObject({ success: true, output: expect.stringContaining('session A') });
    await expect(tool.execute(
      { identifier: 'call_same' },
      { cwd: workspace, sessionId: 'session-b' },
    )).resolves.toMatchObject({ success: true, output: expect.stringContaining('session B') });
    await expect(tool.execute(
      { identifier: 'call_same' },
      { cwd: workspace, sessionId: 'session-c' },
    )).resolves.toMatchObject({ success: false });
  });

  it('prefers the private recovery scope supplied by ToolHandler', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-context-extra-'));
    temporaryDirectories.push(workspace);
    const compressor = getRestorableCompressor();
    compressor.writeToolResult('call_same', 'private agent scope', workspace, 'agent-private');
    compressor.writeToolResult('call_same', 'public session scope', workspace, 'public-session');

    const result = await new RestoreContextTool().execute(
      { identifier: 'call_same' },
      {
        cwd: workspace,
        sessionId: 'public-session',
        extra: { recoverySessionId: 'agent-private' },
      },
    );

    expect(result).toMatchObject({
      success: true,
      output: expect.stringContaining('private agent scope'),
    });
  });

  it('pages a long single-line observation so its middle remains accessible', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-pages-'));
    temporaryDirectories.push(workspace);
    const content = 'a'.repeat(12000) + 'MIDDLE_SENTINEL' + 'z'.repeat(12000);
    getRestorableCompressor().capture('large-audit', content, workspace, 'banc');
    const tool = new RestoreContextTool();
    const first = await tool.execute({ identifier: 'large-audit' }, { cwd: workspace, sessionId: 'banc' });
    expect(first.success).toBe(true);
    expect(first.output!.length).toBeLessThan(13000);
    expect(first.output).toContain('"offset":12000');
    expect(first.output).not.toContain('MIDDLE_SENTINEL');
    const middle = await tool.execute({ identifier: 'large-audit', offset: 12000, limit: 'MIDDLE_SENTINEL'.length }, { cwd: workspace, sessionId: 'banc' });
    expect(middle.output).toContain('MIDDLE_SENTINEL');
    expect(middle.output).not.toContain('aaa');
    expect(middle.output).not.toContain('zzz');
    expect(tool.getSchema().parameters.properties.offset).toBeDefined();
    expect(RESTORE_CONTEXT_TOOL.function.parameters.properties?.offset).toBeDefined();
    expect(getRestorableCompressor().restore('large-audit', workspace, 'banc').content).toBe(content);
  });

  it.each([{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 24001 }, { limit: '12' }])('rejects invalid recovery ranges %j', async (range) => {
    const tool = new RestoreContextTool();
    expect(tool.validate({ identifier: 'id', ...range }).valid).toBe(false);
    expect(await tool.execute({ identifier: 'id', ...range })).toMatchObject({ success: false, error: expect.stringMatching(/offset|limit/) });
  });
});
