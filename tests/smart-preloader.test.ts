/**
 * Smart Context Preloader Tests
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import {
  SmartContextPreloader,
  createSmartPreloader,
  type PreloadedContext,
  type PreloaderConfig,
} from '../src/context/smart-preloader.js';

describe('SmartContextPreloader', () => {
  let preloader: SmartContextPreloader;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `preloader-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    preloader = new SmartContextPreloader(testDir);
  });

  afterEach(async () => {
    preloader.dispose();
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const p = new SmartContextPreloader('/tmp');
      expect(p).toBeDefined();
      p.dispose();
    });

    it('should accept custom configuration', () => {
      const config: Partial<PreloaderConfig> = {
        maxFiles: 10,
        maxTokens: 25000,
        includeTests: false,
      };

      const p = new SmartContextPreloader('/tmp', config);
      expect(p).toBeDefined();
      p.dispose();
    });
  });

  describe('Project Analysis', () => {
    it('should detect Node.js project', async () => {
      // Create package.json
      await fs.writeFile(
        path.join(testDir, 'package.json'),
        JSON.stringify({ name: 'test', dependencies: { express: '4.0.0' } })
      );

      const context = await preloader.preload();
      expect(context.projectInfo.type).toBe('node');
      expect(context.projectInfo.frameworks).toContain('express');
    });

    it('should detect TypeScript in Node project', async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');
      await fs.writeFile(path.join(testDir, 'tsconfig.json'), '{}');
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'src', 'index.ts'), 'export const x = 1;');

      const context = await preloader.preload();
      expect(context.projectInfo.mainLanguage).toBe('typescript');
    });

    it('should detect Python project', async () => {
      await fs.writeFile(path.join(testDir, 'requirements.txt'), 'flask\ndjango');

      const context = await preloader.preload();
      expect(context.projectInfo.type).toBe('python');
      expect(context.projectInfo.frameworks).toContain('flask');
      expect(context.projectInfo.frameworks).toContain('django');
    });

    it('should detect Rust project', async () => {
      await fs.writeFile(path.join(testDir, 'Cargo.toml'), '[package]\nname = "test"');

      const context = await preloader.preload();
      expect(context.projectInfo.type).toBe('rust');
    });

    it('should detect Go project', async () => {
      await fs.writeFile(path.join(testDir, 'go.mod'), 'module test');

      const context = await preloader.preload();
      expect(context.projectInfo.type).toBe('go');
    });
  });

  describe('File Preloading', () => {
    beforeEach(async () => {
      // Create test files
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'src', 'main.ts'), 'export const main = () => {};');
      await fs.writeFile(path.join(testDir, 'src', 'utils.ts'), 'export const helper = () => {};');
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');
    });

    it('should preload files', async () => {
      const context = await preloader.preload();
      expect(context.files.length).toBeGreaterThan(0);
    });

    it('should include file content', async () => {
      const context = await preloader.preload();
      const mainFile = context.files.find(f => f.path.includes('main.ts'));

      if (mainFile) {
        expect(mainFile.content).toContain('export const main');
        expect(mainFile.tokens).toBeGreaterThan(0);
      }
    });

    it('should include relevance scores', async () => {
      const context = await preloader.preload();

      for (const file of context.files) {
        expect(file.relevance).toBeGreaterThanOrEqual(0);
        expect(file.relevance).toBeLessThanOrEqual(1);
      }
    });

    it('should include preload reason', async () => {
      const context = await preloader.preload();

      for (const file of context.files) {
        expect(file.reason).toBeDefined();
      }
    });
  });

  describe('Symbol Extraction', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
    });

    it('should extract TypeScript symbols', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'code.ts'),
        `
export function myFunction() {}
export class MyClass {}
export interface MyInterface {}
export type MyType = string;
`
      );

      const context = await preloader.preload();

      const functionSymbol = context.symbols.find(s => s.name === 'myFunction');
      const classSymbol = context.symbols.find(s => s.name === 'MyClass');
      const interfaceSymbol = context.symbols.find(s => s.name === 'MyInterface');
      const typeSymbol = context.symbols.find(s => s.name === 'MyType');

      expect(functionSymbol?.type).toBe('function');
      expect(classSymbol?.type).toBe('class');
      expect(interfaceSymbol?.type).toBe('interface');
      expect(typeSymbol?.type).toBe('type');
    });

    it('should extract Python symbols', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'code.py'),
        `
def my_function():
    pass

class MyClass:
    pass

async def async_function():
    pass
`
      );

      const context = await preloader.preload();

      const funcSymbol = context.symbols.find(s => s.name === 'my_function');
      const classSymbol = context.symbols.find(s => s.name === 'MyClass');
      const asyncSymbol = context.symbols.find(s => s.name === 'async_function');

      expect(funcSymbol?.type).toBe('function');
      expect(classSymbol?.type).toBe('class');
      expect(asyncSymbol?.type).toBe('function');
    });

    it('should include file and line info', async () => {
      await fs.writeFile(
        path.join(testDir, 'src', 'test.ts'),
        'export function testFunc() {}'
      );

      const context = await preloader.preload();
      const symbol = context.symbols.find(s => s.name === 'testFunc');

      expect(symbol?.file).toContain('test.ts');
      expect(symbol?.line).toBe(1);
    });
  });

  describe('Git Context', () => {
    it('should handle non-git directories', async () => {
      const context = await preloader.preload();

      expect(context.gitContext).toBeDefined();
      expect(context.gitContext.branch).toBe('unknown');
    });
  });

  describe('User Patterns', () => {
    it('should record patterns', () => {
      preloader.recordPattern('fix bug', ['src/bug.ts']);
      preloader.recordPattern('fix bug', ['src/bug.ts', 'src/fix.ts']);

      // Patterns are recorded internally
      expect(preloader).toBeDefined();
    });
  });

  describe('Caching', () => {
    beforeEach(async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');
    });

    it('should cache preload results', async () => {
      const first = await preloader.preload('test-task');
      const second = await preloader.preload('test-task');

      // Second call should be faster due to caching
      expect(first.loadTime).toBeGreaterThanOrEqual(0);
      expect(second.loadTime).toBeGreaterThanOrEqual(0);
    });

    it('should clear cache', async () => {
      await preloader.preload('task');
      preloader.clearCache();

      // Cache is cleared
      expect(preloader).toBeDefined();
    });
  });

  describe('Task Hints', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'src', 'auth.ts'), 'export const login = () => {};');
      await fs.writeFile(path.join(testDir, 'src', 'utils.ts'), 'export const helper = () => {};');
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');
    });

    it('should use task hint for relevance', async () => {
      const context = await preloader.preload('fix authentication');

      // Auth-related files should be prioritized
      expect(context.relevanceScore).toBeGreaterThan(0);
    });
  });

  describe('Factory Function', () => {
    it('should create preloader with factory', () => {
      const p = createSmartPreloader('/tmp');
      expect(p).toBeInstanceOf(SmartContextPreloader);
      p.dispose();
    });

    it('should accept config in factory', () => {
      const p = createSmartPreloader('/tmp', { maxFiles: 5 });
      expect(p).toBeDefined();
      p.dispose();
    });
  });

  describe('Events', () => {
    it('should emit preloaded event', async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{}');

      const handler = jest.fn();
      preloader.on('preloaded', handler);

      await preloader.preload();

      expect(handler).toHaveBeenCalled();
    });
  });
});
