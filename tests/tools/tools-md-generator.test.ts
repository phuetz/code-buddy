/**
 * Tests for TOOLS.md Generator
 *
 * Validates generation, hash-based skipping, content structure,
 * and directory creation behaviour.
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

// ─── Mock heavy dependencies before the module is imported ───────────────────

const mockGetEnabledTools = jest.fn();

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

// initializeToolRegistry and getToolRegistry come from these modules via
// dynamic import inside generateToolsMd(), so we need virtual mocks.
jest.mock(
  '../../src/codebuddy/tools.js',
  () => ({ initializeToolRegistry: jest.fn() }),
  { virtual: true },
);

jest.mock(
  '../../src/tools/registry.js',
  () => ({ getToolRegistry: jest.fn(() => ({ getEnabledTools: mockGetEnabledTools })) }),
  { virtual: true },
);

jest.mock(
  '../../src/tools/metadata.js',
  () => ({ TOOL_METADATA: [] }),
  { virtual: true },
);

// ─── Import after mocks ───────────────────────────────────────────────────────

import { generateToolsMd } from '../../src/tools/tools-md-generator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MockTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: {
      type: string;
      properties: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
  };
};

const makeTool = (name: string, description: string, category?: string): MockTool => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to operate on' },
      },
      required: ['path'],
    },
  },
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateToolsMd()', () => {
  let tmpDir: string;
  let originalCwd: string;
  let cwdSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Create an isolated temp directory for each test
    tmpDir = await (async () => {
      const base = path.join(os.tmpdir(), `tools-md-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(base, { recursive: true });
      return base;
    })();

    originalCwd = process.cwd();
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    mockGetEnabledTools.mockReturnValue([
      makeTool('view_file', 'View file contents or directory listings'),
      makeTool('bash', 'Execute bash shell commands'),
      makeTool('git_status', 'Show git repository status'),
    ]);

    jest.clearAllMocks();
    // Re-apply the tool mock after clearAllMocks
    mockGetEnabledTools.mockReturnValue([
      makeTool('view_file', 'View file contents or directory listings'),
      makeTool('bash', 'Execute bash shell commands'),
      makeTool('git_status', 'Show git repository status'),
    ]);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
  });

  // ── 1. Creates TOOLS.md when it doesn't exist ────────────────────────────

  it('creates .codebuddy/TOOLS.md when the file does not exist', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');
    expect(existsSync(filePath)).toBe(false);

    await generateToolsMd();

    expect(existsSync(filePath)).toBe(true);
  });

  // ── 2. Skips regeneration when hash matches ───────────────────────────────

  it('skips regeneration when the stored hash matches the current tools', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    // First run — creates the file
    await generateToolsMd();
    expect(existsSync(filePath)).toBe(true);

    // Capture the mtime / content after first write
    const contentAfterFirst = await readFile(filePath, 'utf-8');

    // Second run — same tools, should skip
    await generateToolsMd();

    const contentAfterSecond = await readFile(filePath, 'utf-8');
    // Content must not have changed (no rewrite)
    expect(contentAfterSecond).toBe(contentAfterFirst);
  });

  // ── 3. Regenerates when tools change ─────────────────────────────────────

  it('regenerates the file when tools have changed', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();
    const contentAfterFirst = await readFile(filePath, 'utf-8');

    // Change the registered tools
    mockGetEnabledTools.mockReturnValue([
      makeTool('new_tool', 'A brand new tool that was not there before'),
    ]);

    await generateToolsMd();
    const contentAfterSecond = await readFile(filePath, 'utf-8');

    expect(contentAfterSecond).not.toBe(contentAfterFirst);
    expect(contentAfterSecond).toContain('new_tool');
  });

  // ── 4. Generated content includes "# Available Tools" header ─────────────

  it('generated content includes the "# Available Tools" markdown header', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('# Available Tools');
  });

  // ── 5. Generated content has tool categories ──────────────────────────────

  it('generated content has at least one ## category heading', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    // Must contain at least one level-2 section heading
    expect(content).toMatch(/^## .+/m);
  });

  // ── 6. Generated content has tool names (### headings) ───────────────────

  it('generated content includes ### headings for tool names', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('### view_file');
    expect(content).toContain('### bash');
    expect(content).toContain('### git_status');
  });

  // ── 7. Generated content includes tool descriptions ───────────────────────

  it('generated content includes tool descriptions', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('View file contents or directory listings');
    expect(content).toContain('Execute bash shell commands');
  });

  // ── 8. Generated content has a hash comment at the end ───────────────────

  it('generated content includes a <!-- hash:... --> comment for change detection', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toMatch(/<!-- hash:[a-f0-9]+ -->/);
  });

  // ── 9. Creates the .codebuddy directory when it is missing ───────────────

  it('creates the .codebuddy directory when it does not exist', async () => {
    const codeBuddyDir = path.join(tmpDir, '.codebuddy');
    // Verify it doesn't exist yet
    expect(existsSync(codeBuddyDir)).toBe(false);

    await generateToolsMd();

    expect(existsSync(codeBuddyDir)).toBe(true);
  });

  // ── 10. Skips generation silently when no tools are registered ────────────

  it('skips generation silently when there are no registered tools', async () => {
    mockGetEnabledTools.mockReturnValue([]);

    await generateToolsMd();

    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');
    expect(existsSync(filePath)).toBe(false);
  });

  // ── 11. Table of contents lists all categories present ───────────────────

  it('generated content contains a Table of Contents section', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('## Table of Contents');
  });

  // ── 12. Total tool count footer ───────────────────────────────────────────

  it('generated content includes a total tools count line', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toMatch(/_Total tools: \d+_/);
  });

  // ── 13. Auto-generated disclaimer ────────────────────────────────────────

  it('generated content contains the "Do not edit manually" disclaimer', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('Do not edit manually');
  });

  // ── 14. Parameters section is rendered for tools with params ─────────────

  it('generated content lists tool parameters', async () => {
    const filePath = path.join(tmpDir, '.codebuddy', 'TOOLS.md');

    await generateToolsMd();

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('**Parameters:**');
    // The `path` parameter should appear
    expect(content).toContain('`path`');
  });

  // ── 15. Does not throw even if an error occurs ────────────────────────────

  it('does not throw when an internal error occurs (graceful degradation)', async () => {
    // Force getEnabledTools to throw
    mockGetEnabledTools.mockImplementation(() => {
      throw new Error('Registry exploded');
    });

    // Must resolve without throwing
    await expect(generateToolsMd()).resolves.toBeUndefined();
  });
});
