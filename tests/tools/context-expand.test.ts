import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { countTokens } from '../../src/context/token-counter.js';
import { SegmentArchive } from '../../src/context/segment-archive.js';
import { ContextExpandTool } from '../../src/tools/context-expand-tool.js';

const tempHomes: string[] = [];
let previousZoom: string | undefined;
let previousMcpDisabled: string | undefined;
let previousAuthoredTools: string | undefined;

async function fixture(): Promise<{
  archive: SegmentArchive;
  tool: ContextExpandTool;
  sessionId: string;
  segmentId: string;
}> {
  const home = await mkdtemp(join(tmpdir(), 'codebuddy-context-expand-'));
  tempHomes.push(home);
  const archive = new SegmentArchive(home);
  const messages: CodeBuddyMessage[] = [
    { role: 'user', content: 'What was the exact value?' },
    { role: 'assistant', content: 'The exact value was alpha-42.' },
  ];
  const sessionId = 'session-expand';
  const segmentId = archive.archive(sessionId, messages, 'value summary');
  if (!segmentId) throw new Error('Failed to create context-expand fixture');
  return { archive, tool: new ContextExpandTool({ archive }), sessionId, segmentId };
}

beforeEach(() => {
  previousZoom = process.env.CODEBUDDY_CONTEXT_ZOOM;
  previousMcpDisabled = process.env.CODEBUDDY_DISABLE_MCP;
  previousAuthoredTools = process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS;
  process.env.CODEBUDDY_CONTEXT_ZOOM = 'true';
  process.env.CODEBUDDY_DISABLE_MCP = 'true';
  process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS = 'false';
});

afterEach(async () => {
  if (previousZoom === undefined) delete process.env.CODEBUDDY_CONTEXT_ZOOM;
  else process.env.CODEBUDDY_CONTEXT_ZOOM = previousZoom;
  if (previousMcpDisabled === undefined) delete process.env.CODEBUDDY_DISABLE_MCP;
  else process.env.CODEBUDDY_DISABLE_MCP = previousMcpDisabled;
  if (previousAuthoredTools === undefined) delete process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS;
  else process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS = previousAuthoredTools;
  await Promise.all(tempHomes.splice(0).map(directory => rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
});

describe('context_expand', () => {
  it('renders exact archived messages with their roles', async () => {
    const { tool, sessionId, segmentId } = await fixture();

    const result = await tool.execute({ segment_id: segmentId }, { cwd: process.cwd(), sessionId });

    expect(result).toEqual({
      success: true,
      output:
        '[user]\nWhat was the exact value?\n\n' +
        '[assistant]\nThe exact value was alpha-42.',
    });
  });

  it('truncates rendered messages within the requested token budget', async () => {
    const { archive, tool, sessionId } = await fixture();
    const largeId = archive.archive(
      sessionId,
      [{ role: 'user', content: Array.from({ length: 500 }, (_, index) => `token-${index}`).join(' ') }],
      'large summary',
    );
    expect(largeId).not.toBeNull();

    const result = await tool.execute(
      { segment_id: largeId, max_tokens: 40 },
      { cwd: process.cwd(), sessionId },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('[truncated to 40 tokens]');
    expect(countTokens(result.output ?? '')).toBeLessThanOrEqual(40);
  });

  it('returns a clean error for an unknown segment in the current session', async () => {
    const { tool, sessionId } = await fixture();

    const result = await tool.execute(
      { segment_id: 'deadbeefdeadbeef' },
      { cwd: process.cwd(), sessionId },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('was not found in the current session');
  });

  it('is absent from the model-facing list unless the feature flag is enabled', async () => {
    const { getAllCodeBuddyTools } = await import('../../src/codebuddy/tools.js');
    delete process.env.CODEBUDDY_CONTEXT_ZOOM;
    const disabledNames = (await getAllCodeBuddyTools()).map(tool => tool.function.name);
    expect(disabledNames).not.toContain('context_expand');

    process.env.CODEBUDDY_CONTEXT_ZOOM = 'true';
    const enabledNames = (await getAllCodeBuddyTools()).map(tool => tool.function.name);
    expect(enabledNames).toContain('context_expand');
  });
});
