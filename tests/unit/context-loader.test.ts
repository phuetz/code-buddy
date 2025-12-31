/**
 * Tests for Context Loader
 */

import path from 'path';
import fs from 'fs';
import {
  ContextLoader,
  getContextLoader,
  resetContextLoader,
  ContextFile,
  ContextLoaderOptions,
} from '../../src/context/context-loader';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
}));

// Mock fast-glob
jest.mock('fast-glob', () => {
  const mockGlob = jest.fn();
  return {
    __esModule: true,
    default: { glob: mockGlob },
    glob: mockGlob,
  };
});

// Mock the ignore library
jest.mock('ignore', () => {
  return jest.fn(() => ({
    add: jest.fn().mockReturnThis(),
    ignores: jest.fn().mockReturnValue(false),
  }));
});

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFastGlob = require('fast-glob');

describe('ContextLoader', () => {
  const testWorkingDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    resetContextLoader();

    // Default: no gitignore file
    mockFs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    resetContextLoader();
  });

  describe('Constructor', () => {
    it('should create with default working directory', () => {
      const loader = new ContextLoader();
      expect(loader).toBeDefined();
    });

    it('should create with custom working directory', () => {
      const loader = new ContextLoader(testWorkingDir);
      expect(loader).toBeDefined();
    });

    it('should create with custom options', () => {
      const options: ContextLoaderOptions = {
        maxFileSize: 50 * 1024,
        maxTotalSize: 500 * 1024,
        includeHidden: true,
      };

      const loader = new ContextLoader(testWorkingDir, options);
      expect(loader).toBeDefined();
    });

    it('should load gitignore when respectGitignore is true', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('node_modules\n*.log');

      const loader = new ContextLoader(testWorkingDir, { respectGitignore: true });
      expect(loader).toBeDefined();
      expect(mockFs.existsSync).toHaveBeenCalledWith(path.join(testWorkingDir, '.gitignore'));
    });

    it('should not load gitignore when respectGitignore is false', () => {
      const loader = new ContextLoader(testWorkingDir, { respectGitignore: false });
      expect(loader).toBeDefined();
      // existsSync should only be called if we look for gitignore
      expect(mockFs.existsSync).not.toHaveBeenCalled();
    });

    it('should handle missing gitignore gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);

      const loader = new ContextLoader(testWorkingDir, { respectGitignore: true });
      expect(loader).toBeDefined();
    });

    it('should handle gitignore read errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw
      const loader = new ContextLoader(testWorkingDir, { respectGitignore: true });
      expect(loader).toBeDefined();
    });
  });

  describe('loadFiles', () => {
    beforeEach(() => {
      mockFastGlob.glob.mockResolvedValue([]);
    });

    it('should load files matching default pattern', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/index.ts']);
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('const x = 1;');

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(mockFastGlob.glob).toHaveBeenCalledWith(
        ['**/*'],
        expect.objectContaining({
          cwd: testWorkingDir,
          onlyFiles: true,
        })
      );
      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/index.ts');
    });

    it('should load files matching custom patterns', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/app.ts', 'src/lib.ts']);
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('export function test() {}');

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles(['**/*.ts']);

      expect(mockFastGlob.glob).toHaveBeenCalledWith(
        ['**/*.ts'],
        expect.objectContaining({ cwd: testWorkingDir })
      );
      expect(files).toHaveLength(2);
    });

    it('should use patterns from options if no explicit patterns provided', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/test.js']);
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('function test() {}');

      const loader = new ContextLoader(testWorkingDir, { patterns: ['**/*.js'] });
      const files = await loader.loadFiles();

      expect(mockFastGlob.glob).toHaveBeenCalledWith(
        ['**/*.js'],
        expect.objectContaining({ cwd: testWorkingDir })
      );
      expect(files).toHaveLength(1);
    });

    it('should return empty array on glob error', async () => {
      mockFastGlob.glob.mockRejectedValue(new Error('Glob error'));

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toEqual([]);
    });

    it('should skip files that cannot be read', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/good.ts', 'src/bad.ts']);

      let callCount = 0;
      mockFs.statSync.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('File not found');
        }
        return { size: 100, mtimeMs: Date.now() } as fs.Stats;
      });
      mockFs.readFileSync.mockReturnValue('good content');

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/good.ts');
    });

    it('should include hidden files when includeHidden is true', async () => {
      mockFastGlob.glob.mockResolvedValue(['.hidden.ts']);
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('hidden file content');

      const loader = new ContextLoader(testWorkingDir, { includeHidden: true });
      await loader.loadFiles();

      expect(mockFastGlob.glob).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ dot: true })
      );
    });

    it('should exclude hidden files by default', async () => {
      mockFastGlob.glob.mockResolvedValue([]);

      const loader = new ContextLoader(testWorkingDir);
      await loader.loadFiles();

      expect(mockFastGlob.glob).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ dot: false })
      );
    });
  });

  describe('File Filtering - Always Exclude Patterns', () => {
    beforeEach(() => {
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('content');
    });

    it('should pass ALWAYS_EXCLUDE patterns to fast-glob ignore option', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/index.ts']);

      const loader = new ContextLoader(testWorkingDir);
      await loader.loadFiles();

      expect(mockFastGlob.glob).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          ignore: expect.arrayContaining([
            '**/.git/**',
            '**/node_modules/**',
            '**/.env',
            '**/.env.*',
            '**/credentials.json',
            '**/secrets.json',
            '**/*.pem',
            '**/*.key',
          ]),
        })
      );
    });

    it('should filter out nested .git files via shouldIgnore', async () => {
      // Pattern **/.git/** matches paths with / before .git
      mockFastGlob.glob.mockResolvedValue(['submodule/.git/config', 'src/index.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      const hasGitFile = files.some(f => f.relativePath.includes('.git'));
      expect(hasGitFile).toBe(false);
    });

    it('should filter out nested node_modules files via shouldIgnore', async () => {
      // Pattern **/node_modules/** matches paths with / before node_modules
      mockFastGlob.glob.mockResolvedValue(['packages/core/node_modules/lodash/index.js', 'src/index.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      const hasNodeModules = files.some(f => f.relativePath.includes('node_modules'));
      expect(hasNodeModules).toBe(false);
    });

    it('should filter out nested .env files via path matching', async () => {
      // Nested paths matching **/.env pattern
      mockFastGlob.glob.mockResolvedValue(['config/.env', 'src/config.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/config.ts');
    });

    it('should filter out nested .env.* files via pattern', async () => {
      // Nested paths matching **/.env.* pattern
      mockFastGlob.glob.mockResolvedValue(['config/.env.local', 'src/config.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      const hasEnvFile = files.some(f => f.relativePath.includes('.env.'));
      expect(hasEnvFile).toBe(false);
    });

    it('should filter out nested sensitive files matching path patterns', async () => {
      // Nested paths matching **/credentials.json and **/secrets.json patterns
      mockFastGlob.glob.mockResolvedValue([
        'config/credentials.json',
        'config/secrets.json',
        'src/app.ts',
      ]);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should filter out nested .pem and .key files via path matching', async () => {
      // Nested paths matching **/*.pem and **/*.key patterns
      mockFastGlob.glob.mockResolvedValue([
        'certs/private.pem',
        'certs/api.key',
        'src/app.ts',
      ]);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should filter out nested lock files via path matching', async () => {
      // Nested paths matching **/package-lock.json etc.
      mockFastGlob.glob.mockResolvedValue([
        'packages/core/package-lock.json',
        'packages/core/yarn.lock',
        'src/app.ts',
      ]);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should filter out nested minified files via path matching', async () => {
      // Nested paths matching **/*.min.js and **/*.min.css patterns
      mockFastGlob.glob.mockResolvedValue([
        'assets/bundle.min.js',
        'assets/styles.min.css',
        'src/app.ts',
      ]);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      const hasMinified = files.some(f =>
        f.relativePath.includes('.min.js') ||
        f.relativePath.includes('.min.css')
      );
      expect(hasMinified).toBe(false);
    });

    it('should rely on fast-glob ignore for root-level sensitive files', async () => {
      // Root-level files are filtered by fast-glob's ignore option, not shouldIgnore
      // This test verifies the ignore patterns are passed to fast-glob
      mockFastGlob.glob.mockResolvedValue(['src/app.ts']); // Simulating fast-glob already filtered

      const loader = new ContextLoader(testWorkingDir);
      await loader.loadFiles();

      // Verify fast-glob receives the ignore patterns
      expect(mockFastGlob.glob).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          ignore: expect.arrayContaining([
            '**/.env',
            '**/credentials.json',
            '**/*.pem',
            '**/package-lock.json',
          ]),
        })
      );
    });

    it('should filter out build/dist directories via shouldIgnore', async () => {
      // Nested paths with / before dist/build/.next
      mockFastGlob.glob.mockResolvedValue([
        'packages/dist/index.js',
        'packages/build/output.js',
        'packages/.next/static/chunk.js',
        'src/app.ts',
      ]);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });
  });

  describe('File Filtering - Gitignore', () => {
    it('should respect gitignore patterns', async () => {
      const mockIgnore = require('ignore');
      const mockIgnoresFunc = jest.fn().mockImplementation((path: string) => {
        return path.includes('ignored');
      });

      mockIgnore.mockReturnValue({
        add: jest.fn().mockReturnThis(),
        ignores: mockIgnoresFunc,
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('ignored/\n*.ignored');

      mockFastGlob.glob.mockResolvedValue(['src/app.ts', 'ignored/file.ts', 'test.ignored']);
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);

      const loader = new ContextLoader(testWorkingDir, { respectGitignore: true });
      const files = await loader.loadFiles();

      // Only non-ignored file should be included
      expect(files.length).toBeLessThanOrEqual(1);
    });
  });

  describe('File Filtering - Custom Exclude Patterns', () => {
    beforeEach(() => {
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('content');
    });

    it('should exclude files matching custom exclude patterns', async () => {
      mockFastGlob.glob.mockResolvedValue([
        'src/app.ts',
        'src/app.spec.ts',
        'src/tests/unit/test.ts',
      ]);

      const loader = new ContextLoader(testWorkingDir, {
        excludePatterns: ['**/*.spec.ts', '**/tests/**'],
      });
      const files = await loader.loadFiles();

      expect(files.every(f => !f.relativePath.includes('.spec.ts'))).toBe(true);
      expect(files.every(f => !f.relativePath.includes('/tests/'))).toBe(true);
      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should exclude files matching simple patterns', async () => {
      mockFastGlob.glob.mockResolvedValue([
        'src/app.ts',
        'src/app.test.ts',
        'src/config.ts',
      ]);

      const loader = new ContextLoader(testWorkingDir, {
        excludePatterns: ['**/*.test.ts'],
      });
      const files = await loader.loadFiles();

      expect(files.every(f => !f.relativePath.includes('.test.ts'))).toBe(true);
      expect(files).toHaveLength(2);
    });
  });

  describe('Context Size Limits', () => {
    beforeEach(() => {
      mockFs.readFileSync.mockReturnValue('file content');
    });

    it('should skip files exceeding maxFileSize', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/small.ts', 'src/large.ts']);

      let callCount = 0;
      mockFs.statSync.mockImplementation(() => {
        callCount++;
        return {
          size: callCount === 1 ? 100 : 200 * 1024, // Second file is 200KB
          mtimeMs: Date.now(),
        } as fs.Stats;
      });

      const loader = new ContextLoader(testWorkingDir, { maxFileSize: 100 * 1024 });
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/small.ts');
    });

    it('should stop loading when maxTotalSize is reached', async () => {
      mockFastGlob.glob.mockResolvedValue(['file1.ts', 'file2.ts', 'file3.ts']);

      mockFs.statSync.mockReturnValue({
        size: 500 * 1024, // 500KB per file
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('x'.repeat(500 * 1024));

      const loader = new ContextLoader(testWorkingDir, {
        maxTotalSize: 600 * 1024,
        maxFileSize: 1024 * 1024, // 1MB - allow individual files
      });
      const files = await loader.loadFiles();

      // Should only load first file (500KB), second would exceed 600KB limit
      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('file1.ts');
    });

    it('should use default size limits', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/file.ts']);
      mockFs.statSync.mockReturnValue({
        size: 50 * 1024,
        mtimeMs: Date.now(),
      } as fs.Stats);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toHaveLength(1);
    });
  });

  describe('File Type Detection', () => {
    beforeEach(() => {
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('content');
    });

    it('should detect TypeScript files', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/app.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('typescript');
    });

    it('should detect TSX files', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/Component.tsx']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('tsx');
    });

    it('should detect JavaScript files', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/app.js']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('javascript');
    });

    it('should detect Python files', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/app.py']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('python');
    });

    it('should detect Go files', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/main.go']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('go');
    });

    it('should detect Rust files', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/main.rs']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('rust');
    });

    it('should detect YAML files', async () => {
      mockFastGlob.glob.mockResolvedValue(['config.yaml', 'docker-compose.yml']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('yaml');
      expect(files[1].language).toBe('yaml');
    });

    it('should detect JSON files', async () => {
      mockFastGlob.glob.mockResolvedValue(['package.json']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('json');
    });

    it('should detect Markdown files', async () => {
      mockFastGlob.glob.mockResolvedValue(['README.md']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('markdown');
    });

    it('should detect shell script files', async () => {
      mockFastGlob.glob.mockResolvedValue(['script.sh', 'script.bash', 'script.zsh']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('bash');
      expect(files[1].language).toBe('bash');
      expect(files[2].language).toBe('zsh');
    });

    it('should return undefined for unknown file types', async () => {
      mockFastGlob.glob.mockResolvedValue(['file.xyz', 'data.unknown']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBeUndefined();
      expect(files[1].language).toBeUndefined();
    });

    it('should detect various other file types', async () => {
      mockFastGlob.glob.mockResolvedValue([
        'App.vue',
        'Component.svelte',
        'styles.css',
        'styles.scss',
        'query.sql',
        'schema.graphql',
        'infra.tf',
        'message.proto',
      ]);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].language).toBe('vue');
      expect(files[1].language).toBe('svelte');
      expect(files[2].language).toBe('css');
      expect(files[3].language).toBe('scss');
      expect(files[4].language).toBe('sql');
      expect(files[5].language).toBe('graphql');
      expect(files[6].language).toBe('terraform');
      expect(files[7].language).toBe('protobuf');
    });
  });

  describe('Content Processing', () => {
    beforeEach(() => {
      mockFastGlob.glob.mockResolvedValue(['src/app.ts']);
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
    });

    it('should compress whitespace when enabled', async () => {
      const contentWithWhitespace = 'const x = 1;   \nconst y = 2;  \n\n\n\nconst z = 3;';
      mockFs.readFileSync.mockReturnValue(contentWithWhitespace);

      const loader = new ContextLoader(testWorkingDir, { compressWhitespace: true });
      const files = await loader.loadFiles();

      // Should remove trailing whitespace and compress multiple newlines
      expect(files[0].content).not.toContain('   \n');
      expect(files[0].content).not.toContain('\n\n\n\n');
    });

    it('should not compress whitespace when disabled', async () => {
      const contentWithWhitespace = 'const x = 1;   \n';
      mockFs.readFileSync.mockReturnValue(contentWithWhitespace);

      const loader = new ContextLoader(testWorkingDir, { compressWhitespace: false });
      const files = await loader.loadFiles();

      expect(files[0].content).toBe(contentWithWhitespace);
    });

    it('should replace lock file content with placeholder when removeLockFiles is true', async () => {
      mockFastGlob.glob.mockResolvedValue(['package-lock.json']);
      mockFs.statSync.mockReturnValue({
        size: 50000,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('{"lockfileVersion": 2, "dependencies": {...}}');

      const loader = new ContextLoader(testWorkingDir, { removeLockFiles: true });
      const files = await loader.loadFiles();

      expect(files[0].content).toContain('Lock file content omitted');
      expect(files[0].content).toContain('48.8 KB');
    });
  });

  describe('parsePatternString', () => {
    it('should parse comma-separated include patterns', () => {
      const result = ContextLoader.parsePatternString('**/*.ts, **/*.js, **/*.tsx');

      expect(result.include).toEqual(['**/*.ts', '**/*.js', '**/*.tsx']);
      expect(result.exclude).toEqual([]);
    });

    it('should parse exclude patterns starting with !', () => {
      const result = ContextLoader.parsePatternString('**/*.ts, !**/*.test.ts, !**/__tests__/**');

      expect(result.include).toEqual(['**/*.ts']);
      expect(result.exclude).toEqual(['**/*.test.ts', '**/__tests__/**']);
    });

    it('should handle empty pattern string', () => {
      const result = ContextLoader.parsePatternString('');

      expect(result.include).toEqual([]);
      expect(result.exclude).toEqual([]);
    });

    it('should handle patterns with extra spaces', () => {
      const result = ContextLoader.parsePatternString('  **/*.ts  ,   **/*.js  ');

      expect(result.include).toEqual(['**/*.ts', '**/*.js']);
    });
  });

  describe('formatForPrompt', () => {
    it('should format files with language for code blocks', () => {
      const files: ContextFile[] = [
        {
          path: '/test/src/app.ts',
          relativePath: 'src/app.ts',
          content: 'const x = 1;',
          mtime: Date.now(),
          size: 100,
          language: 'typescript',
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const formatted = loader.formatForPrompt(files);

      expect(formatted).toContain('CONTEXT FILES:');
      expect(formatted).toContain('--- src/app.ts ---');
      expect(formatted).toContain('```typescript');
      expect(formatted).toContain('const x = 1;');
      expect(formatted).toContain('```');
    });

    it('should format files without language without code blocks', () => {
      const files: ContextFile[] = [
        {
          path: '/test/README',
          relativePath: 'README',
          content: 'This is a readme',
          mtime: Date.now(),
          size: 100,
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const formatted = loader.formatForPrompt(files);

      expect(formatted).toContain('--- README ---');
      expect(formatted).toContain('This is a readme');
      expect(formatted).not.toContain('```');
    });

    it('should handle multiple files', () => {
      const files: ContextFile[] = [
        {
          path: '/test/src/app.ts',
          relativePath: 'src/app.ts',
          content: 'const x = 1;',
          mtime: Date.now(),
          size: 100,
          language: 'typescript',
        },
        {
          path: '/test/src/lib.ts',
          relativePath: 'src/lib.ts',
          content: 'export function test() {}',
          mtime: Date.now(),
          size: 100,
          language: 'typescript',
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const formatted = loader.formatForPrompt(files);

      expect(formatted).toContain('--- src/app.ts ---');
      expect(formatted).toContain('--- src/lib.ts ---');
    });

    it('should handle empty file list', () => {
      const loader = new ContextLoader(testWorkingDir);
      const formatted = loader.formatForPrompt([]);

      expect(formatted).toBe('CONTEXT FILES:');
    });
  });

  describe('getSummary', () => {
    it('should generate summary with file count and size', () => {
      const files: ContextFile[] = [
        {
          path: '/test/src/app.ts',
          relativePath: 'src/app.ts',
          content: 'const x = 1;',
          mtime: Date.now(),
          size: 1024,
          language: 'typescript',
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const summary = loader.getSummary(files);

      expect(summary).toContain('1 files');
      expect(summary).toContain('1.0 KB');
      expect(summary).toContain('typescript');
      expect(summary).toContain('src/app.ts');
    });

    it('should handle bytes correctly', () => {
      const files: ContextFile[] = [
        {
          path: '/test/small.ts',
          relativePath: 'small.ts',
          content: 'x',
          mtime: Date.now(),
          size: 100,
          language: 'typescript',
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const summary = loader.getSummary(files);

      expect(summary).toContain('100 B');
    });

    it('should handle megabytes correctly', () => {
      const files: ContextFile[] = [
        {
          path: '/test/large.ts',
          relativePath: 'large.ts',
          content: 'x',
          mtime: Date.now(),
          size: 2 * 1024 * 1024,
          language: 'typescript',
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const summary = loader.getSummary(files);

      expect(summary).toContain('2.0 MB');
    });

    it('should list multiple languages', () => {
      const files: ContextFile[] = [
        {
          path: '/test/app.ts',
          relativePath: 'app.ts',
          content: 'x',
          mtime: Date.now(),
          size: 100,
          language: 'typescript',
        },
        {
          path: '/test/app.py',
          relativePath: 'app.py',
          content: 'x',
          mtime: Date.now(),
          size: 100,
          language: 'python',
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const summary = loader.getSummary(files);

      expect(summary).toContain('typescript');
      expect(summary).toContain('python');
    });

    it('should show "mixed" when no languages detected', () => {
      const files: ContextFile[] = [
        {
          path: '/test/file1',
          relativePath: 'file1',
          content: 'x',
          mtime: Date.now(),
          size: 100,
        },
      ];

      const loader = new ContextLoader(testWorkingDir);
      const summary = loader.getSummary(files);

      expect(summary).toContain('mixed');
    });

    it('should show first 5 files and indicate more', () => {
      const files: ContextFile[] = Array.from({ length: 10 }, (_, i) => ({
        path: `/test/file${i}.ts`,
        relativePath: `file${i}.ts`,
        content: 'x',
        mtime: Date.now(),
        size: 100,
        language: 'typescript',
      }));

      const loader = new ContextLoader(testWorkingDir);
      const summary = loader.getSummary(files);

      expect(summary).toContain('10 files');
      expect(summary).toContain('+5 more');
    });

    it('should handle empty file list', () => {
      const loader = new ContextLoader(testWorkingDir);
      const summary = loader.getSummary([]);

      expect(summary).toContain('0 files');
      expect(summary).toContain('0 B');
    });
  });

  describe('Singleton - getContextLoader', () => {
    it('should return same instance when called without arguments', () => {
      const instance1 = getContextLoader();
      const instance2 = getContextLoader();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance when working directory is provided', () => {
      const instance1 = getContextLoader();
      const instance2 = getContextLoader('/different/path');

      expect(instance1).not.toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getContextLoader();
      resetContextLoader();
      const instance2 = getContextLoader();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('ContextFile structure', () => {
    beforeEach(() => {
      mockFs.statSync.mockReturnValue({
        size: 1234,
        mtimeMs: 1704067200000, // 2024-01-01
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('file content');
    });

    it('should include all required fields', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/app.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0]).toHaveProperty('path');
      expect(files[0]).toHaveProperty('relativePath');
      expect(files[0]).toHaveProperty('content');
      expect(files[0]).toHaveProperty('mtime');
      expect(files[0]).toHaveProperty('size');
    });

    it('should have correct path values', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/app.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].path).toBe(path.join(testWorkingDir, 'src/app.ts'));
      expect(files[0].relativePath).toBe('src/app.ts');
    });

    it('should have correct mtime and size', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/app.ts']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files[0].mtime).toBe(1704067200000);
      expect(files[0].size).toBe(1234);
    });
  });

  describe('Pattern matching edge cases', () => {
    beforeEach(() => {
      mockFs.statSync.mockReturnValue({
        size: 100,
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('content');
    });

    it('should handle negation patterns in exclude', async () => {
      mockFastGlob.glob.mockResolvedValue(['src/keep.test.ts', 'src/app.ts']);

      // Test that the loader handles patterns correctly
      const loader = new ContextLoader(testWorkingDir, {
        excludePatterns: ['**/*.test.ts'],
      });
      const files = await loader.loadFiles();

      expect(files.some(f => f.relativePath.endsWith('.test.ts'))).toBe(false);
    });

    it('should match patterns against both full path and basename', async () => {
      mockFastGlob.glob.mockResolvedValue(['deeply/nested/Dockerfile', 'Dockerfile']);

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      // Both files should be loaded (no exclusion pattern for Dockerfile by default)
      expect(files).toHaveLength(2);
    });

    it('should handle negation patterns starting with !', async () => {
      // Test negation pattern logic in matchPattern
      mockFastGlob.glob.mockResolvedValue([
        'src/app.ts',
        'src/important.special.ts',
        'src/other.special.ts',
      ]);

      // Use a negation pattern - !**/*.special.ts means "do NOT exclude special.ts files"
      // However, since the excludePatterns array uses negation differently,
      // we test that a pattern like !*.ts would invert the match
      const loader = new ContextLoader(testWorkingDir, {
        excludePatterns: ['!**/*.ts'], // This negates the pattern, so nothing matches
      });
      const files = await loader.loadFiles();

      // All .ts files should be included since !**/*.ts means "not matching .ts files" = true for non-.ts
      // But since all are .ts files, !**/*.ts evaluates to false, so nothing is excluded
      expect(files).toHaveLength(3);
    });

    it('should correctly evaluate negation pattern with mixed files', async () => {
      mockFastGlob.glob.mockResolvedValue([
        'src/app.ts',
        'src/readme.md',
        'src/config.json',
      ]);

      // !**/*.ts means: NOT (matches **/*.ts)
      // For app.ts: matches **/*.ts = true, so !pattern = false, not excluded
      // For readme.md: matches **/*.ts = false, so !pattern = true, EXCLUDED
      const loader = new ContextLoader(testWorkingDir, {
        excludePatterns: ['!**/*.ts'],
      });
      const files = await loader.loadFiles();

      // .md and .json files should be excluded (negation logic inverts)
      const hasNonTs = files.some(f =>
        f.relativePath.endsWith('.md') || f.relativePath.endsWith('.json')
      );
      expect(hasNonTs).toBe(false);
      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('src/app.ts');
    });
  });

  describe('Error handling', () => {
    it('should handle stat errors gracefully', async () => {
      mockFastGlob.glob.mockResolvedValue(['file1.ts', 'file2.ts']);
      mockFs.statSync.mockImplementation((filePath) => {
        if (String(filePath).includes('file1')) {
          throw new Error('ENOENT: no such file');
        }
        return { size: 100, mtimeMs: Date.now() } as fs.Stats;
      });
      mockFs.readFileSync.mockReturnValue('content');

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      // Should only have file2, file1 should be skipped
      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toBe('file2.ts');
    });

    it('should handle readFile errors gracefully', async () => {
      mockFastGlob.glob.mockResolvedValue(['file1.ts', 'file2.ts']);
      mockFs.statSync.mockReturnValue({ size: 100, mtimeMs: Date.now() } as fs.Stats);

      let callCount = 0;
      mockFs.readFileSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('EACCES: permission denied');
        }
        return 'content';
      });

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      // Should only have file2, file1 should be skipped due to read error
      expect(files).toHaveLength(1);
    });

    it('should return empty array when glob throws', async () => {
      mockFastGlob.glob.mockRejectedValue(new Error('Glob error'));

      const loader = new ContextLoader(testWorkingDir);
      const files = await loader.loadFiles();

      expect(files).toEqual([]);
    });
  });
});
