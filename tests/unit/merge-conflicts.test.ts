/**
 * Merge Conflict Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFileSync, mockWriteFileSync, mockExistsSync, mockExecFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockExecFileSync: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: mockExecFileSync,
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      existsSync: mockExistsSync,
    },
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
  };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  parseConflicts,
  resolveConflict,
  resolveAllConflicts,
  executeResolveConflicts,
  type ConflictRegion,
} from '../../src/tools/merge-conflict-tool.js';

// ============================================================================
// Test Data
// ============================================================================

const SIMPLE_CONFLICT = `line 1
line 2
<<<<<<< HEAD
our version
=======
their version
>>>>>>> feature-branch
line 8
line 9`;

const MULTI_CONFLICT = `header
<<<<<<< HEAD
ours-1a
ours-1b
=======
theirs-1a
>>>>>>> branch-a
middle
<<<<<<< main
ours-2
=======
theirs-2a
theirs-2b
>>>>>>> branch-b
footer`;

const NO_CONFLICTS = `just normal
code here
nothing to see`;

const MALFORMED_CONFLICT = `<<<<<<< HEAD
ours
no separator or end marker`;

describe('parseConflicts', () => {
  it('should parse a single conflict region', () => {
    const conflicts = parseConflicts(SIMPLE_CONFLICT);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ours).toBe('our version');
    expect(conflicts[0].theirs).toBe('their version');
    expect(conflicts[0].oursLabel).toBe('HEAD');
    expect(conflicts[0].theirsLabel).toBe('feature-branch');
  });

  it('should parse multiple conflict regions', () => {
    const conflicts = parseConflicts(MULTI_CONFLICT);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].ours).toBe('ours-1a\nours-1b');
    expect(conflicts[0].theirs).toBe('theirs-1a');
    expect(conflicts[1].ours).toBe('ours-2');
    expect(conflicts[1].theirs).toBe('theirs-2a\ntheirs-2b');
  });

  it('should return empty array for no conflicts', () => {
    const conflicts = parseConflicts(NO_CONFLICTS);
    expect(conflicts).toHaveLength(0);
  });

  it('should handle malformed conflicts gracefully', () => {
    const conflicts = parseConflicts(MALFORMED_CONFLICT);
    expect(conflicts).toHaveLength(0); // no complete triplet
  });

  it('should set correct line numbers', () => {
    const conflicts = parseConflicts(SIMPLE_CONFLICT);
    expect(conflicts[0].startLine).toBe(3); // <<<<<<< is line 3
    expect(conflicts[0].endLine).toBe(7);   // >>>>>>> is line 7
  });

  it('should handle empty ours section', () => {
    const content = `<<<<<<< HEAD\n=======\ntheirs\n>>>>>>> branch`;
    const conflicts = parseConflicts(content);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ours).toBe('');
    expect(conflicts[0].theirs).toBe('theirs');
  });

  it('should handle empty theirs section', () => {
    const content = `<<<<<<< HEAD\nours\n=======\n>>>>>>> branch`;
    const conflicts = parseConflicts(content);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ours).toBe('ours');
    expect(conflicts[0].theirs).toBe('');
  });

  it('should set filePath on conflict regions', () => {
    const conflicts = parseConflicts(SIMPLE_CONFLICT, '/path/to/file.ts');
    expect(conflicts[0].filePath).toBe('/path/to/file.ts');
  });
});

describe('resolveConflict', () => {
  const region: ConflictRegion = {
    filePath: 'test.ts',
    startLine: 1,
    endLine: 5,
    ours: 'our code',
    theirs: 'their code',
    oursLabel: 'HEAD',
    theirsLabel: 'feature',
  };

  it('should resolve with ours strategy', () => {
    expect(resolveConflict(region, 'ours')).toBe('our code');
  });

  it('should resolve with theirs strategy', () => {
    expect(resolveConflict(region, 'theirs')).toBe('their code');
  });

  it('should resolve with both strategy', () => {
    const result = resolveConflict(region, 'both');
    expect(result).toBe('our code\ntheir code');
  });
});

describe('resolveAllConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockReturnValue(SIMPLE_CONFLICT);
    mockWriteFileSync.mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
  });

  it('should resolve all conflicts with ours strategy', async () => {
    const result = await resolveAllConflicts('/test/file.ts', 'ours');
    expect(result.resolved).toBe(1);
    expect(result.content).toContain('our version');
    expect(result.content).not.toContain('<<<<<<<');
    expect(result.content).not.toContain('=======');
    expect(result.content).not.toContain('>>>>>>>');
  });

  it('should resolve all conflicts with theirs strategy', async () => {
    const result = await resolveAllConflicts('/test/file.ts', 'theirs');
    expect(result.resolved).toBe(1);
    expect(result.content).toContain('their version');
    expect(result.content).not.toContain('<<<<<<<');
  });

  it('should return 0 resolved for files without conflicts', async () => {
    mockReadFileSync.mockReturnValue(NO_CONFLICTS);
    const result = await resolveAllConflicts('/test/clean.ts');
    expect(result.resolved).toBe(0);
    expect(result.content).toBe(NO_CONFLICTS);
  });

  it('should use AI strategy with llmCall', async () => {
    const llmCall = vi.fn().mockResolvedValue('merged result');
    const result = await resolveAllConflicts('/test/file.ts', 'ai', llmCall);
    expect(result.resolved).toBe(1);
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(result.content).toContain('merged result');
  });

  it('should fallback to ours when AI fails', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('API down'));
    const result = await resolveAllConflicts('/test/file.ts', 'ai', llmCall);
    expect(result.resolved).toBe(1);
    expect(result.content).toContain('our version');
  });
});

describe('executeResolveConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SIMPLE_CONFLICT);
    mockWriteFileSync.mockImplementation(() => {});
    mockExecFileSync.mockReturnValue('');
  });

  it('should resolve conflicts in a specific file', async () => {
    const result = await executeResolveConflicts({
      file_path: 'test.ts',
      strategy: 'ours',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Resolved 1 conflict');
  });

  it('should return conflict details for ai strategy', async () => {
    const result = await executeResolveConflicts({
      file_path: 'test.ts',
      strategy: 'ai',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('our version');
    expect(result.output).toContain('their version');
  });

  it('should return error for non-existent file', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await executeResolveConflicts({ file_path: 'nonexistent.ts' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should scan for conflicted files through git', async () => {
    mockExecFileSync.mockReturnValue('test.ts\n');

    const result = await executeResolveConflicts({ scan_only: true });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Files with merge conflicts');
    expect(result.output).toContain('test.ts: 1 conflict(s)');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', '--diff-filter=U'],
      expect.objectContaining({ encoding: 'utf-8', timeout: 10000 }),
    );
  });

  it('should fail when git conflict scan cannot run', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const result = await executeResolveConflicts({ scan_only: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unable to scan for conflicts');
    expect(result.error).toContain('not a git repository');
  });
});
