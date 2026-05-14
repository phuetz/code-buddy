import { describe, it, expect } from 'vitest';
import { resolveToolStatus, compactToolLabel } from '../src/renderer/utils/tool-status';
import type { ContentBlock, Message, ToolResultContent } from '../src/renderer/types';

function toolUse(id: string, name = 'search'): ContentBlock {
  return { type: 'tool_use', id, name, input: {} } as ContentBlock;
}

function toolResult(toolUseId: string, content = 'ok', isError = false): ToolResultContent {
  return { type: 'tool_result', toolUseId, content, isError } as ToolResultContent;
}

function message(blocks: ContentBlock[], id = 'msg-1'): Message {
  return {
    id,
    sessionId: 'session-1',
    role: 'assistant',
    content: blocks,
    timestamp: 0,
  } as Message;
}

describe('resolveToolStatus', () => {
  it('returns running when no result + active turn', () => {
    const result = resolveToolStatus({
      toolUseId: 't1',
      ownerBlocks: [toolUse('t1')],
      hasActiveTurn: true,
    });
    expect(result.status).toBe('running');
    expect(result.toolResult).toBeNull();
  });

  it('returns success when no result + idle turn (treats as done, lost result)', () => {
    const result = resolveToolStatus({
      toolUseId: 't1',
      ownerBlocks: [toolUse('t1')],
      hasActiveTurn: false,
    });
    expect(result.status).toBe('success');
  });

  it('returns success when matching result is non-error in same message', () => {
    const blocks = [toolUse('t1'), toolResult('t1', 'ok')];
    const result = resolveToolStatus({
      toolUseId: 't1',
      ownerBlocks: blocks,
      hasActiveTurn: true, // shouldn't matter, result wins
    });
    expect(result.status).toBe('success');
    expect(result.toolResult?.content).toBe('ok');
  });

  it('returns error when matching result has isError=true', () => {
    const blocks = [toolUse('t1'), toolResult('t1', 'boom', true)];
    const result = resolveToolStatus({
      toolUseId: 't1',
      ownerBlocks: blocks,
      hasActiveTurn: false,
    });
    expect(result.status).toBe('error');
    expect(result.toolResult?.isError).toBe(true);
  });

  it('falls back to allMessages when result lives in a later message', () => {
    const earlier = message([toolUse('t1')], 'msg-a');
    const later = message([toolResult('t1', 'late ok')], 'msg-b');
    const result = resolveToolStatus({
      toolUseId: 't1',
      ownerBlocks: earlier.content as ContentBlock[],
      allMessages: [earlier, later],
      hasActiveTurn: true,
    });
    expect(result.status).toBe('success');
    expect(result.toolResult?.content).toBe('late ok');
  });

  it('owner-blocks lookup takes precedence over later messages', () => {
    const owner = [toolUse('t1'), toolResult('t1', 'inline')];
    const distractor = message([toolResult('t1', 'cross')], 'msg-z');
    const result = resolveToolStatus({
      toolUseId: 't1',
      ownerBlocks: owner,
      allMessages: [distractor],
      hasActiveTurn: false,
    });
    expect(result.toolResult?.content).toBe('inline');
  });
});

describe('compactToolLabel', () => {
  it('passes through short names verbatim', () => {
    expect(compactToolLabel('search')).toBe('search');
    expect(compactToolLabel('read_file')).toBe('read_file');
  });

  it('strips mcp__server__ prefix', () => {
    expect(compactToolLabel('mcp__github__create_issue')).toBe('create_issue');
    expect(compactToolLabel('mcp__filesystem__list_directory')).toBe('list_directory');
  });

  it('clips at 24 chars with ellipsis', () => {
    const long = 'extraordinarily_long_tool_name_that_overflows';
    const out = compactToolLabel(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(24);
  });

  it('combines mcp prefix strip and length clamp', () => {
    const out = compactToolLabel('mcp__server__some_extraordinarily_long_tool_name');
    expect(out.startsWith('some_extraordinarily_')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });
});
