/**
 * BootstrapLoader Tests
 *
 * Tests for workspace context injection at session start.
 * Verifies file discovery, project-over-global priority,
 * token limit truncation, and security pattern rejection.
 */

import { BootstrapLoader } from '../../src/context/bootstrap-loader.js';
import type { BootstrapResult } from '../../src/context/bootstrap-loader.js';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

describe('BootstrapLoader', () => {
  const CWD = '/home/user/project';
  const GLOBAL_DIR = '/mock/global/.codebuddy';

  let loader: BootstrapLoader;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: all file reads fail (file not found)
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    loader = new BootstrapLoader({
      globalDir: GLOBAL_DIR,
    });
  });

  // ==========================================================================
  // File Discovery
  // ==========================================================================

  describe('file discovery', () => {
    it('should return empty result when no bootstrap files exist', async () => {
      const result = await loader.load(CWD);

      expect(result.content).toBe('');
      expect(result.sources).toEqual([]);
      expect(result.tokenCount).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it('should load a single project-level file', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'Hello from bootstrap';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toEqual([projectPath]);
      expect(result.content).toContain('## BOOTSTRAP.md');
      expect(result.content).toContain('Hello from bootstrap');
      expect(result.tokenCount).toBeGreaterThan(0);
      expect(result.truncated).toBe(false);
    });

    it('should load a single global-level file', async () => {
      const globalPath = path.join(GLOBAL_DIR, 'SOUL.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === globalPath) return 'Global soul content';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toEqual([globalPath]);
      expect(result.content).toContain('## SOUL.md');
      expect(result.content).toContain('Global soul content');
    });

    it('should load multiple files from both project and global directories', async () => {
      const projectBootstrap = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const globalSoul = path.join(GLOBAL_DIR, 'SOUL.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectBootstrap) return 'Project bootstrap';
        if (filePath === globalSoul) return 'Global soul';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toHaveLength(2);
      expect(result.sources).toContain(projectBootstrap);
      expect(result.sources).toContain(globalSoul);
      expect(result.content).toContain('Project bootstrap');
      expect(result.content).toContain('Global soul');
    });

    it('should check all default file names', async () => {
      await loader.load(CWD);

      const expectedFiles = [
        'BOOTSTRAP.md',
        'AGENTS.md',
        'SOUL.md',
        'TOOLS.md',
        'IDENTITY.md',
        'USER.md',
        'HEARTBEAT.md',
      ];

      // Each filename should be checked in both project and global dirs
      for (const fileName of expectedFiles) {
        const projectPath = path.join(CWD, '.codebuddy', fileName);
        const globalPath = path.join(GLOBAL_DIR, fileName);
        expect(mockReadFile).toHaveBeenCalledWith(projectPath, 'utf-8');
        expect(mockReadFile).toHaveBeenCalledWith(globalPath, 'utf-8');
      }
    });

    it('should skip files with empty or whitespace-only content', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return '   \n  \t  ';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toEqual([]);
      expect(result.content).toBe('');
    });

    it('should separate multiple sections with horizontal rules', async () => {
      const projectBootstrap = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const projectAgents = path.join(CWD, '.codebuddy', 'AGENTS.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectBootstrap) return 'Bootstrap content';
        if (filePath === projectAgents) return 'Agents content';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.content).toContain('---');
      // Verify the structure: section1 --- section2
      const parts = result.content.split('\n\n---\n\n');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toContain('## BOOTSTRAP.md');
      expect(parts[1]).toContain('## AGENTS.md');
    });
  });

  // ==========================================================================
  // Project Overrides Global
  // ==========================================================================

  describe('project overrides global', () => {
    it('should prefer project file over global file for the same name', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const globalPath = path.join(GLOBAL_DIR, 'BOOTSTRAP.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'Project version';
        if (filePath === globalPath) return 'Global version';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toEqual([projectPath]);
      expect(result.content).toContain('Project version');
      expect(result.content).not.toContain('Global version');
    });

    it('should fall back to global when project file does not exist', async () => {
      const globalPath = path.join(GLOBAL_DIR, 'BOOTSTRAP.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === globalPath) return 'Global fallback';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toEqual([globalPath]);
      expect(result.content).toContain('Global fallback');
    });

    it('should fall back to global when project file is empty', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const globalPath = path.join(GLOBAL_DIR, 'BOOTSTRAP.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return '';
        if (filePath === globalPath) return 'Global content';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toEqual([globalPath]);
      expect(result.content).toContain('Global content');
    });

    it('should use project file for one name and global for another', async () => {
      const projectBootstrap = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const globalSoul = path.join(GLOBAL_DIR, 'SOUL.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectBootstrap) return 'Project bootstrap';
        if (filePath === globalSoul) return 'Global soul';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toContain(projectBootstrap);
      expect(result.sources).toContain(globalSoul);
      expect(result.sources).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Token Limit / Truncation
  // ==========================================================================

  describe('token limit and truncation', () => {
    it('should truncate content that exceeds maxChars', async () => {
      const longContent = 'A'.repeat(300);
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return longContent;
        throw new Error('ENOENT');
      });

      const smallLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        maxChars: 100,
      });

      const result = await smallLoader.load(CWD);

      expect(result.truncated).toBe(true);
      expect(result.content).toContain('... (truncated)');
    });

    it('should not truncate content within maxChars', async () => {
      const shortContent = 'Short content';
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return shortContent;
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.truncated).toBe(false);
      expect(result.content).not.toContain('... (truncated)');
      expect(result.content).toContain('Short content');
    });

    it('should stop loading additional files once maxChars is reached', async () => {
      const projectBootstrap = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const projectAgents = path.join(CWD, '.codebuddy', 'AGENTS.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectBootstrap) return 'A'.repeat(200);
        if (filePath === projectAgents) return 'Should not be loaded';
        throw new Error('ENOENT');
      });

      const smallLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        maxChars: 150,
      });

      const result = await smallLoader.load(CWD);

      expect(result.truncated).toBe(true);
      // Only the first file should be in sources
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toBe(projectBootstrap);
      expect(result.content).not.toContain('Should not be loaded');
    });

    it('should truncate mid-file when remaining budget is insufficient', async () => {
      const projectBootstrap = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const projectAgents = path.join(CWD, '.codebuddy', 'AGENTS.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectBootstrap) return 'First file content';
        if (filePath === projectAgents) return 'B'.repeat(500);
        throw new Error('ENOENT');
      });

      const smallLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        maxChars: 50,
      });

      const result = await smallLoader.load(CWD);

      // Both files should be in sources (second is partially loaded)
      expect(result.sources).toHaveLength(2);
      expect(result.truncated).toBe(true);
      expect(result.content).toContain('... (truncated)');
    });

    it('should use default maxChars of 20000', async () => {
      const defaultLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
      });

      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'A'.repeat(19000);
        throw new Error('ENOENT');
      });

      const result = await defaultLoader.load(CWD);

      expect(result.truncated).toBe(false);
    });

    it('should track tokenCount as total character length of included text', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const content = 'Hello bootstrap world';
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return content;
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.tokenCount).toBe(content.length);
    });
  });

  // ==========================================================================
  // Security Pattern Rejection
  // ==========================================================================

  describe('security pattern rejection', () => {
    const { logger } = require('../../src/utils/logger.js');

    const dangerousPatterns = [
      { name: 'eval()', content: 'Run this: eval("malicious code")' },
      { name: 'eval with space', content: 'Use eval (something) to run' },
      { name: 'new Function()', content: 'const fn = new Function("return 1")' },
      { name: 'new Function with newline', content: 'const fn = new  Function ("x")' },
      { name: 'require child_process', content: "const cp = require('child_process')" },
      { name: 'require child_process double quotes', content: 'const cp = require("child_process")' },
      { name: 'execSync()', content: 'execSync("rm -rf /")' },
      { name: 'exec()', content: 'exec("ls -la")' },
      { name: 'spawnSync()', content: 'spawnSync("bash", ["-c", "cmd"])' },
      { name: 'spawn()', content: 'spawn("node", ["script.js"])' },
      { name: '<script> tag', content: '<script>alert("xss")</script>' },
      { name: '<script> tag uppercase', content: '<SCRIPT>alert("xss")</SCRIPT>' },
      { name: '<script> with attributes', content: '<script type="text/javascript">code</script>' },
    ];

    it.each(dangerousPatterns)(
      'should reject file containing $name',
      async ({ content }) => {
        const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
        mockReadFile.mockImplementation(async (filePath: any) => {
          if (filePath === projectPath) return content;
          throw new Error('ENOENT');
        });

        const result = await loader.load(CWD);

        expect(result.sources).toEqual([]);
        expect(result.content).toBe('');
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('contains dangerous patterns')
        );
      }
    );

    it('should log a warning when skipping a dangerous file', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'eval("bad")';
        throw new Error('ENOENT');
      });

      await loader.load(CWD);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(projectPath)
      );
    });

    it('should skip dangerous file but continue loading safe files', async () => {
      const projectBootstrap = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      const projectAgents = path.join(CWD, '.codebuddy', 'AGENTS.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectBootstrap) return 'eval("bad code")';
        if (filePath === projectAgents) return 'Safe agents content';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toBe(projectAgents);
      expect(result.content).toContain('Safe agents content');
      expect(result.content).not.toContain('eval');
    });

    const safeContents = [
      { name: 'normal markdown', content: '# Hello\n\nThis is a safe bootstrap file.' },
      { name: 'code blocks mentioning eval keyword', content: '```\n// do not use the eval function\n```' },
      { name: 'word evaluation', content: 'The evaluation of the model was successful.' },
      { name: 'word execute', content: 'Please execute the plan carefully.' },
      { name: 'word spawn', content: 'The spawn point is at the start.' },
    ];

    it.each(safeContents)(
      'should accept safe content: $name',
      async ({ content }) => {
        const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
        mockReadFile.mockImplementation(async (filePath: any) => {
          if (filePath === projectPath) return content;
          throw new Error('ENOENT');
        });

        const result = await loader.load(CWD);

        expect(result.sources).toHaveLength(1);
        expect(result.content).toContain(content);
      }
    );
  });

  // ==========================================================================
  // Custom Configuration
  // ==========================================================================

  describe('custom configuration', () => {
    it('should accept custom file names', async () => {
      const customLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        fileNames: ['CUSTOM.md', 'PROJECT.md'],
      });

      const customPath = path.join(CWD, '.codebuddy', 'CUSTOM.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === customPath) return 'Custom content';
        throw new Error('ENOENT');
      });

      const result = await customLoader.load(CWD);

      expect(result.sources).toEqual([customPath]);
      expect(result.content).toContain('## CUSTOM.md');
    });

    it('should accept custom project directory name', async () => {
      const customLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        projectDir: '.myconfig',
      });

      const customPath = path.join(CWD, '.myconfig', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === customPath) return 'Custom dir content';
        throw new Error('ENOENT');
      });

      const result = await customLoader.load(CWD);

      expect(result.sources).toEqual([customPath]);
    });

    it('should accept custom global directory', async () => {
      const customGlobal = '/opt/shared/.codebuddy';
      const customLoader = new BootstrapLoader({
        globalDir: customGlobal,
      });

      const globalPath = path.join(customGlobal, 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === globalPath) return 'Shared global content';
        throw new Error('ENOENT');
      });

      const result = await customLoader.load(CWD);

      expect(result.sources).toEqual([globalPath]);
    });

    it('should merge partial config with defaults', async () => {
      const partialLoader = new BootstrapLoader({
        maxChars: 5000,
      });

      // Should still use default file names and project dir
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'Content';
        throw new Error('ENOENT');
      });

      const result = await partialLoader.load(CWD);

      expect(result.sources).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle file read errors gracefully', async () => {
      mockReadFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await loader.load(CWD);

      expect(result.sources).toEqual([]);
      expect(result.content).toBe('');
    });

    it('should handle maxChars of 0', async () => {
      const zeroLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        maxChars: 0,
      });

      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'Some content';
        throw new Error('ENOENT');
      });

      const result = await zeroLoader.load(CWD);

      expect(result.truncated).toBe(true);
      expect(result.sources).toEqual([]);
    });

    it('should mark truncated when content exactly fills maxChars and more filenames remain', async () => {
      // When totalChars >= maxChars at the start of the next iteration,
      // the loader sets truncated = true even if no more files exist on disk.
      const exactLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        maxChars: 20,
      });

      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'A'.repeat(20);
        throw new Error('ENOENT');
      });

      const result = await exactLoader.load(CWD);

      // truncated is true because the loop hits the >= check on the next filename
      expect(result.truncated).toBe(true);
      expect(result.tokenCount).toBe(20);
    });

    it('should not mark truncated when content exactly fills maxChars with single filename', async () => {
      // With only one filename configured, no next iteration triggers the >= check
      const singleFileLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        maxChars: 20,
        fileNames: ['BOOTSTRAP.md'],
      });

      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'A'.repeat(20);
        throw new Error('ENOENT');
      });

      const result = await singleFileLoader.load(CWD);

      expect(result.truncated).toBe(false);
      expect(result.tokenCount).toBe(20);
    });

    it('should trim whitespace from loaded file content', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return '  \n  Hello World  \n  ';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.sources).toHaveLength(1);
      // readFileSafe trims the content
      expect(result.content).toContain('Hello World');
    });

    it('should use different cwd values correctly', async () => {
      const cwd1 = '/project/one';
      const cwd2 = '/project/two';

      const path1 = path.join(cwd1, '.codebuddy', 'BOOTSTRAP.md');
      const path2 = path.join(cwd2, '.codebuddy', 'BOOTSTRAP.md');

      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === path1) return 'Project one';
        if (filePath === path2) return 'Project two';
        throw new Error('ENOENT');
      });

      const result1 = await loader.load(cwd1);
      const result2 = await loader.load(cwd2);

      expect(result1.content).toContain('Project one');
      expect(result2.content).toContain('Project two');
    });

    it('should handle empty fileNames config', async () => {
      const emptyLoader = new BootstrapLoader({
        globalDir: GLOBAL_DIR,
        fileNames: [],
      });

      const result = await emptyLoader.load(CWD);

      expect(result.sources).toEqual([]);
      expect(result.content).toBe('');
      expect(result.tokenCount).toBe(0);
      expect(result.truncated).toBe(false);
    });
  });

  // ==========================================================================
  // Result Structure
  // ==========================================================================

  describe('result structure', () => {
    it('should return a well-formed BootstrapResult', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'Test content';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('tokenCount');
      expect(result).toHaveProperty('truncated');
      expect(typeof result.content).toBe('string');
      expect(Array.isArray(result.sources)).toBe(true);
      expect(typeof result.tokenCount).toBe('number');
      expect(typeof result.truncated).toBe('boolean');
    });

    it('should format content with section headers', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'IDENTITY.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'I am the identity';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      expect(result.content).toBe('## IDENTITY.md\n\nI am the identity');
    });

    it('should return sources as absolute file paths', async () => {
      const projectPath = path.join(CWD, '.codebuddy', 'BOOTSTRAP.md');
      mockReadFile.mockImplementation(async (filePath: any) => {
        if (filePath === projectPath) return 'Content';
        throw new Error('ENOENT');
      });

      const result = await loader.load(CWD);

      for (const source of result.sources) {
        expect(path.isAbsolute(source)).toBe(true);
      }
    });
  });
});
