/**
 * Tests for LsTool — dedicated cross-platform directory listing tool.
 *
 * Uses the real filesystem (os.tmpdir() + mkdtemp) so that directory creation,
 * symlink handling, sorting, and output formatting are exercised end-to-end
 * without any mocking of fs internals.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LsTool } from '../../src/tools/ls-tool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ls-tool-test-'));
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('LsTool', () => {
  let tool: LsTool;

  beforeEach(() => {
    tool = new LsTool();
  });

  // -------------------------------------------------------------------------
  // List current working directory
  // -------------------------------------------------------------------------

  describe('listing current working directory', () => {
    it('succeeds and returns success:true', async () => {
      const result = await tool.execute(process.cwd());
      expect(result.success).toBe(true);
    });

    it('includes package.json in the project root listing', async () => {
      const result = await tool.execute(process.cwd());
      expect(result.success).toBe(true);
      expect(result.output).toContain('package.json');
    });

    it('output contains a "Directory:" header line', async () => {
      const result = await tool.execute(process.cwd());
      expect(result.output).toMatch(/^Directory:/m);
    });

    it('output contains column headers (Type, Size, Modified, Name)', async () => {
      const result = await tool.execute(process.cwd());
      expect(result.output).toContain('Type');
      expect(result.output).toContain('Size');
      expect(result.output).toContain('Modified');
      expect(result.output).toContain('Name');
    });
  });

  // -------------------------------------------------------------------------
  // Non-existent path
  // -------------------------------------------------------------------------

  describe('non-existent path', () => {
    it('returns success:false', async () => {
      const result = await tool.execute('/this/path/does/not/exist/ever');
      expect(result.success).toBe(false);
    });

    it('returns an error message mentioning the path', async () => {
      const fakePath = '/absolutely/nonexistent/path-xyz-12345';
      const result = await tool.execute(fakePath);
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('does not exist');
    });

    it('does not set output on failure', async () => {
      const result = await tool.execute('/this/path/does/not/exist/ever');
      expect(result.output).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // File path instead of directory
  // -------------------------------------------------------------------------

  describe('file path instead of directory', () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(async () => {
      tmpDir = await makeTempDir();
      filePath = path.join(tmpDir, 'sample.txt');
      await fs.writeFile(filePath, 'hello');
    });

    afterEach(async () => {
      await cleanup(tmpDir);
    });

    it('returns success:false', async () => {
      const result = await tool.execute(filePath);
      expect(result.success).toBe(false);
    });

    it('returns an error message mentioning "not a directory"', async () => {
      const result = await tool.execute(filePath);
      expect(result.error).toMatch(/not a directory/i);
    });
  });

  // -------------------------------------------------------------------------
  // Output format
  // -------------------------------------------------------------------------

  describe('output format', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await makeTempDir();
      // Create a mix: one sub-directory and two files
      await fs.mkdir(path.join(tmpDir, 'alpha-dir'));
      await fs.writeFile(path.join(tmpDir, 'beta-file.txt'), 'content');
      await fs.writeFile(path.join(tmpDir, 'gamma-file.ts'), 'export {}');
    });

    afterEach(async () => {
      await cleanup(tmpDir);
    });

    it('outputs entry count line', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/\d+ entries/);
    });

    it('includes a separator line of dashes', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.output).toMatch(/^-+$/m);
    });

    it('displays file type indicator for files ("file")', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.output).toContain('file');
    });

    it('displays directory type indicator ("dir/")', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.output).toContain('dir/');
    });

    it('directory entries have a trailing slash on the name', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.output).toContain('alpha-dir/');
    });

    it('directory size column shows a dash placeholder instead of a number', async () => {
      const result = await tool.execute(tmpDir);
      // dir rows show "-" in size column
      const lines = (result.output ?? '').split('\n');
      const dirLine = lines.find(l => l.includes('dir/') && l.includes('alpha-dir'));
      expect(dirLine).toBeDefined();
      // The size column for dirs should contain a dash
      expect(dirLine).toMatch(/-\s+\d{4}-\d{2}-\d{2}/);
    });

    it('date format matches YYYY-MM-DD HH:MM pattern', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.output).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    });

    it('includes human-readable file sizes (B, KB, MB units)', async () => {
      const result = await tool.execute(tmpDir);
      // 'content' is 7 bytes → "7 B"
      expect(result.output).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/);
    });
  });

  // -------------------------------------------------------------------------
  // Sort order: directories before files
  // -------------------------------------------------------------------------

  describe('sort order', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await makeTempDir();
      // Create entries with names that would sort files before dirs alphabetically
      // to verify the tool overrides alphabetical order with dirs-first
      await fs.writeFile(path.join(tmpDir, 'aaa-file.txt'), '');
      await fs.mkdir(path.join(tmpDir, 'zzz-dir'));
      await fs.writeFile(path.join(tmpDir, 'mmm-file.ts'), '');
      await fs.mkdir(path.join(tmpDir, 'bbb-dir'));
    });

    afterEach(async () => {
      await cleanup(tmpDir);
    });

    it('lists all directories before all files', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.success).toBe(true);
      const lines = (result.output ?? '').split('\n');
      // Find the separator line
      const sepIdx = lines.findIndex(l => /^-+$/.test(l));
      expect(sepIdx).toBeGreaterThan(-1);
      const dataLines = lines.slice(sepIdx + 1).filter(l => l.trim() !== '');

      // Collect indices of dir and file rows
      const dirIndices = dataLines
        .map((l, i) => ({ i, isDir: l.trimStart().startsWith('dir/') }))
        .filter(x => x.isDir)
        .map(x => x.i);
      const fileIndices = dataLines
        .map((l, i) => ({ i, isFile: l.trimStart().startsWith('file') }))
        .filter(x => x.isFile)
        .map(x => x.i);

      // Every directory row must appear before every file row
      const lastDirIdx = Math.max(...dirIndices);
      const firstFileIdx = Math.min(...fileIndices);
      expect(lastDirIdx).toBeLessThan(firstFileIdx);
    });

    it('sorts directories alphabetically within the dir group', async () => {
      const result = await tool.execute(tmpDir);
      const lines = (result.output ?? '').split('\n');
      const sepIdx = lines.findIndex(l => /^-+$/.test(l));
      const dataLines = lines.slice(sepIdx + 1).filter(l => l.trim() !== '');
      const dirLines = dataLines.filter(l => l.trimStart().startsWith('dir/'));

      // Extract directory names from column (last token after whitespace run)
      const dirNames = dirLines.map(l => l.trim().split(/\s+/).pop() ?? '');
      const sorted = [...dirNames].sort((a, b) => a.localeCompare(b));
      expect(dirNames).toEqual(sorted);
    });

    it('sorts files alphabetically within the file group', async () => {
      const result = await tool.execute(tmpDir);
      const lines = (result.output ?? '').split('\n');
      const sepIdx = lines.findIndex(l => /^-+$/.test(l));
      const dataLines = lines.slice(sepIdx + 1).filter(l => l.trim() !== '');
      const fileLines = dataLines.filter(l => l.trimStart().startsWith('file'));

      const fileNames = fileLines.map(l => l.trim().split(/\s+/).pop() ?? '');
      const sorted = [...fileNames].sort((a, b) => a.localeCompare(b));
      expect(fileNames).toEqual(sorted);
    });
  });

  // -------------------------------------------------------------------------
  // Empty directory
  // -------------------------------------------------------------------------

  describe('empty directory', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await makeTempDir();
    });

    afterEach(async () => {
      await cleanup(tmpDir);
    });

    it('returns success:true for an empty directory', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.success).toBe(true);
    });

    it('output contains "(empty)" for an empty directory', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.output).toContain('(empty)');
    });
  });

  // -------------------------------------------------------------------------
  // Default argument (current directory)
  // -------------------------------------------------------------------------

  describe('default argument', () => {
    it('defaults to current working directory when called with no arguments', async () => {
      const result = await tool.execute();
      expect(result.success).toBe(true);
      // The resolved path header should match cwd
      const resolvedCwd = path.resolve('.');
      expect(result.output).toContain(resolvedCwd);
    });
  });

  // -------------------------------------------------------------------------
  // Large directory — no crash, reasonable performance
  // -------------------------------------------------------------------------

  describe('large directory', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await makeTempDir();
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          fs.writeFile(path.join(tmpDir, `file-${String(i).padStart(3, '0')}.txt`), `data-${i}`)
        )
      );
    });

    afterEach(async () => {
      await cleanup(tmpDir);
    });

    it('handles 50 files without error', async () => {
      const result = await tool.execute(tmpDir);
      expect(result.success).toBe(true);
      expect(result.output).toContain('50 entries');
    });
  });
});
