import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { evaluateScope } from '../../src/agent/scope-awareness.js';
import { AgenticCodingTaskContract } from '../../src/agent/autonomous/agentic-coding-contract.js';

vi.mock('node:fs/promises');
vi.mock('node:child_process', () => ({
  exec: (cmd: string, opts: any, callback: any) => {
    callback(null, { stdout: '## main...origin/main\n M src/index.ts\n' });
  }
}));

describe('evaluateScope', () => {
  let mockClient: any;
  const mockContract: AgenticCodingTaskContract = {
    repo: '/mock/repo',
    task: 'Modify the index file to add logging',
    edits: [{ path: 'src/index.ts', type: 'replace_text', find: 'foo', replace: 'bar', expectedOccurrences: 1 }],
    allowedPaths: ['src/**/*.ts'],
    maxToolRounds: 10,
    riskLevel: 'low',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = {
      chat: vi.fn(),
    };
  });

  it('returns allowed: true and does not query LLM if no rules files exist', async () => {
    vi.spyOn(fs, 'stat').mockRejectedValue(new Error('ENOENT'));

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result).toEqual({ allowed: true });
    expect(mockClient.chat).not.toHaveBeenCalled();
  });

  it('queries LLM and returns compliance outcome if rules files are present', async () => {
    vi.spyOn(fs, 'stat').mockImplementation(async (p: any) => {
      if (p.toString().endsWith('AGENTS.md')) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    vi.spyOn(fs, 'readFile').mockResolvedValue('Rule: Do not change anything in src/legacy/');

    mockClient.chat.mockResolvedValue({
      choices: [{
        message: {
          content: '```json\n{\n  "allowed": true\n}\n```'
        }
      }]
    });

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result).toEqual({ allowed: true, reason: undefined });
    expect(mockClient.chat).toHaveBeenCalled();
  });

  it('returns allowed: false with reason if LLM reports rule violation', async () => {
    vi.spyOn(fs, 'stat').mockImplementation(async (p: any) => {
      if (p.toString().endsWith('CLAUDE.md')) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    vi.spyOn(fs, 'readFile').mockResolvedValue('Restriction: No edits allowed outside src/utils/');

    mockClient.chat.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            allowed: false,
            reason: 'Task modifies src/index.ts, violating restriction in CLAUDE.md'
          })
        }
      }]
    });

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('violating restriction in CLAUDE.md');
  });

  it('degrades gracefully to allowed: true if LLM response is malformed or empty', async () => {
    vi.spyOn(fs, 'stat').mockImplementation(async (p: any) => {
      if (p.toString().endsWith('README.md')) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    vi.spyOn(fs, 'readFile').mockResolvedValue('Rule text');

    mockClient.chat.mockResolvedValue({
      choices: [{
        message: {
          content: 'The rules say okay, but no JSON here.'
        }
      }]
    });

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result).toEqual({ allowed: true });
  });

  it('degrades gracefully to allowed: true if LLM call fails', async () => {
    vi.spyOn(fs, 'stat').mockImplementation(async (p: any) => {
      if (p.toString().endsWith('README.md')) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    vi.spyOn(fs, 'readFile').mockResolvedValue('Rule text');

    mockClient.chat.mockRejectedValue(new Error('API rate limit reached'));

    const result = await evaluateScope(mockContract, mockClient as any);

    expect(result).toEqual({ allowed: true });
  });
});
