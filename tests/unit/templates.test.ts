/**
 * Unit tests for the Templates module
 *
 * Tests project scaffolding, template rendering, variable substitution,
 * template loading, and export templates (markdown and HTML)
 */

import * as path from 'path';
import { EventEmitter } from 'events';

// Mock fs/promises
const mockMkdir = jest.fn();
const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();
const mockReaddir = jest.fn();
const mockChmod = jest.fn();

jest.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  chmod: (...args: unknown[]) => mockChmod(...args),
}));

// Mock fs sync functions
const mockExistsSync = jest.fn();

jest.mock('fs', () => ({
  existsSync: (p: string) => mockExistsSync(p),
}));

// Mock child_process
const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

import {
  TemplateEngine,
  getTemplateEngine,
  resetTemplateEngine,
  generateProject,
  ProjectTemplate,
  TemplateCategory,
  GenerateOptions,
} from '../../src/templates/project-scaffolding';

import { markdownTemplate } from '../../src/templates/export/markdown.template';
import { htmlTemplate } from '../../src/templates/export/html.template';

// ============================================================================
// Project Scaffolding Tests
// ============================================================================

describe('TemplateEngine', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    resetTemplateEngine();
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
    engine = new TemplateEngine();
  });

  describe('Constructor', () => {
    it('should create engine with built-in templates', () => {
      expect(engine).toBeDefined();
      expect(engine.getTemplates().length).toBeGreaterThan(0);
    });

    it('should create engine with custom templates directory', () => {
      const customEngine = new TemplateEngine('/custom/templates');
      expect(customEngine).toBeDefined();
    });

    it('should be an EventEmitter', () => {
      expect(engine).toBeInstanceOf(EventEmitter);
    });
  });

  describe('getTemplates', () => {
    it('should return all built-in templates', () => {
      const templates = engine.getTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => t.name === 'node-cli')).toBe(true);
      expect(templates.some(t => t.name === 'react-ts')).toBe(true);
      expect(templates.some(t => t.name === 'express-api')).toBe(true);
    });

    it('should return templates with required properties', () => {
      const templates = engine.getTemplates();

      for (const template of templates) {
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toBeDefined();
        expect(template.version).toBeDefined();
        expect(template.variables).toBeDefined();
        expect(template.files).toBeDefined();
        expect(template.directories).toBeDefined();
      }
    });
  });

  describe('getTemplate', () => {
    it('should return template by name', () => {
      const template = engine.getTemplate('node-cli');

      expect(template).toBeDefined();
      expect(template?.name).toBe('node-cli');
      expect(template?.category).toBe('cli');
    });

    it('should return undefined for non-existent template', () => {
      const template = engine.getTemplate('non-existent');

      expect(template).toBeUndefined();
    });
  });

  describe('registerTemplate', () => {
    it('should register a custom template', () => {
      const customTemplate: ProjectTemplate = {
        name: 'custom-template',
        description: 'Custom test template',
        category: 'custom',
        version: '1.0.0',
        variables: [],
        files: [],
        directories: [],
      };

      engine.registerTemplate(customTemplate);

      expect(engine.getTemplate('custom-template')).toBeDefined();
      expect(engine.getTemplate('custom-template')?.description).toBe('Custom test template');
    });

    it('should override existing template with same name', () => {
      const overrideTemplate: ProjectTemplate = {
        name: 'node-cli',
        description: 'Overridden template',
        category: 'cli',
        version: '2.0.0',
        variables: [],
        files: [],
        directories: [],
      };

      engine.registerTemplate(overrideTemplate);

      expect(engine.getTemplate('node-cli')?.description).toBe('Overridden template');
      expect(engine.getTemplate('node-cli')?.version).toBe('2.0.0');
    });
  });

  describe('loadCustomTemplates', () => {
    it('should skip if custom templates dir does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const customEngine = new TemplateEngine('/custom/templates');

      await customEngine.loadCustomTemplates();

      expect(mockReaddir).not.toHaveBeenCalled();
    });

    it('should load custom templates from directory', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/custom/templates') return true;
        if (p === '/custom/templates/my-template/template.json') return true;
        return false;
      });

      mockReaddir.mockResolvedValue([
        { name: 'my-template', isDirectory: () => true },
      ]);

      mockReadFile.mockResolvedValue(JSON.stringify({
        name: 'my-template',
        description: 'My custom template',
        category: 'custom',
        version: '1.0.0',
        variables: [],
        files: [],
        directories: [],
      }));

      const customEngine = new TemplateEngine('/custom/templates');
      await customEngine.loadCustomTemplates();

      expect(customEngine.getTemplate('my-template')).toBeDefined();
    });

    it('should skip non-directory entries', async () => {
      mockExistsSync.mockImplementation((p: string) => p === '/custom/templates');
      mockReaddir.mockResolvedValue([
        { name: 'file.txt', isDirectory: () => false },
      ]);

      const customEngine = new TemplateEngine('/custom/templates');
      await customEngine.loadCustomTemplates();

      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('should emit error for invalid template JSON', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/custom/templates') return true;
        if (p === '/custom/templates/bad-template/template.json') return true;
        return false;
      });

      mockReaddir.mockResolvedValue([
        { name: 'bad-template', isDirectory: () => true },
      ]);

      mockReadFile.mockRejectedValue(new Error('Invalid JSON'));

      const customEngine = new TemplateEngine('/custom/templates');
      const errorHandler = jest.fn();
      customEngine.on('error', errorHandler);

      await customEngine.loadCustomTemplates();

      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][0].template).toBe('bad-template');
    });
  });

  describe('generate', () => {
    beforeEach(() => {
      // Setup mock spawn to resolve successfully
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as NodeJS.EventEmitter & { on: jest.Mock };
        setTimeout(() => proc.emit('close', 0), 0);
        return proc;
      });
    });

    it('should throw error for non-existent template', async () => {
      const options: GenerateOptions = {
        template: 'non-existent',
        projectName: 'my-project',
        outputDir: '/output',
        variables: {},
      };

      await expect(engine.generate(options)).rejects.toThrow('Template not found: non-existent');
    });

    it('should throw error if project directory already exists', async () => {
      mockExistsSync.mockImplementation((p: string) => p === '/output/my-project');

      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
      };

      await expect(engine.generate(options)).rejects.toThrow('Directory already exists');
    });

    it('should throw error for missing required variables', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: {}, // binName is required but missing
      };

      await expect(engine.generate(options)).rejects.toThrow('Missing required variable: binName');
    });

    it('should create project directory', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
        skipInstall: true,
      };

      await engine.generate(options);

      expect(mockMkdir).toHaveBeenCalledWith('/output/my-project', { recursive: true });
    });

    it('should create template directories', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
        skipInstall: true,
      };

      await engine.generate(options);

      expect(mockMkdir).toHaveBeenCalledWith('/output/my-project/src', { recursive: true });
      expect(mockMkdir).toHaveBeenCalledWith('/output/my-project/tests', { recursive: true });
    });

    it('should create template files with variable substitution', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: {
          binName: 'my-cli',
          description: 'My CLI application',
          author: 'Test Author',
        },
        skipInstall: true,
      };

      await engine.generate(options);

      // Check that files were written
      expect(mockWriteFile).toHaveBeenCalled();

      // Find the package.json write call
      const packageJsonCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('package.json')
      );

      expect(packageJsonCall).toBeDefined();
      expect(packageJsonCall[1]).toContain('"name": "my-project"');
      expect(packageJsonCall[1]).toContain('"my-cli": "./dist/index.js"');
      expect(packageJsonCall[1]).toContain('"description": "My CLI application"');
      expect(packageJsonCall[1]).toContain('"author": "Test Author"');
    });

    it('should apply default variable values', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: {
          binName: 'my-cli',
          // description and author will use defaults
        },
        skipInstall: true,
      };

      await engine.generate(options);

      const packageJsonCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('package.json')
      );

      expect(packageJsonCall[1]).toContain('"description": "A CLI application"');
    });

    it('should emit progress events', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
        skipInstall: true,
      };

      const progressHandler = jest.fn();
      engine.on('progress', progressHandler);

      await engine.generate(options);

      expect(progressHandler).toHaveBeenCalled();
      expect(progressHandler).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'creating' })
      );
      expect(progressHandler).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'files-created' })
      );
    });

    it('should return successful result with project info', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
        skipInstall: true,
      };

      const result = await engine.generate(options);

      expect(result.success).toBe(true);
      expect(result.projectPath).toBe('/output/my-project');
      expect(result.filesCreated.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.nextSteps).toContain('cd my-project');
    });

    it('should run post-generate hooks when not skipping install', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
        skipInstall: false,
      };

      await engine.generate(options);

      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should skip git init when skipGit is true', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
        skipInstall: false,
        skipGit: true,
      };

      await engine.generate(options);

      // Check that git was not called
      const gitCalls = mockSpawn.mock.calls.filter(
        (call: unknown[]) => call[0] === 'git'
      );
      expect(gitCalls.length).toBe(0);
    });

    it('should add npm install to next steps when skipping install', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'my-project',
        outputDir: '/output',
        variables: { binName: 'my-cli' },
        skipInstall: true,
      };

      const result = await engine.generate(options);

      expect(result.nextSteps).toContain('npm install');
    });
  });

  describe('Variable Substitution', () => {
    beforeEach(() => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as NodeJS.EventEmitter;
        setTimeout(() => proc.emit('close', 0), 0);
        return proc;
      });
    });

    it('should substitute projectName variable', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'awesome-cli',
        outputDir: '/output',
        variables: { binName: 'awesome' },
        skipInstall: true,
      };

      await engine.generate(options);

      const readmeCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('README.md')
      );

      expect(readmeCall[1]).toContain('# awesome-cli');
    });

    it('should leave unmatched variables as-is', async () => {
      // Register a template with an unknown variable
      engine.registerTemplate({
        name: 'test-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [],
        files: [
          {
            path: 'test.txt',
            content: '{{unknownVariable}}',
          },
        ],
        directories: [],
      });

      const options: GenerateOptions = {
        template: 'test-template',
        projectName: 'test',
        outputDir: '/output',
        variables: {},
        skipInstall: true,
      };

      await engine.generate(options);

      const testCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('test.txt')
      );

      expect(testCall[1]).toBe('{{unknownVariable}}');
    });

    it('should handle boolean variables', async () => {
      engine.registerTemplate({
        name: 'bool-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [
          {
            name: 'useTypescript',
            description: 'Use TypeScript',
            type: 'boolean',
            default: true,
          },
        ],
        files: [
          {
            path: 'config.txt',
            content: 'typescript: {{useTypescript}}',
          },
        ],
        directories: [],
      });

      const options: GenerateOptions = {
        template: 'bool-template',
        projectName: 'test',
        outputDir: '/output',
        variables: { useTypescript: true },
        skipInstall: true,
      };

      await engine.generate(options);

      const configCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('config.txt')
      );

      expect(configCall[1]).toBe('typescript: true');
    });
  });

  describe('Conditional Files', () => {
    beforeEach(() => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as NodeJS.EventEmitter;
        setTimeout(() => proc.emit('close', 0), 0);
        return proc;
      });
    });

    it('should skip files with unmet conditions', async () => {
      engine.registerTemplate({
        name: 'conditional-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [
          {
            name: 'styling',
            description: 'Styling',
            type: 'choice',
            choices: ['css', 'tailwind'],
            default: 'css',
          },
        ],
        files: [
          {
            path: 'base.css',
            content: 'base styles',
          },
          {
            path: 'tailwind.config.js',
            content: 'module.exports = {}',
            condition: 'styling == tailwind',
          },
        ],
        directories: [],
      });

      const options: GenerateOptions = {
        template: 'conditional-template',
        projectName: 'test',
        outputDir: '/output',
        variables: { styling: 'css' },
        skipInstall: true,
      };

      await engine.generate(options);

      const tailwindCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('tailwind.config.js')
      );

      expect(tailwindCall).toBeUndefined();
    });

    it('should include files with met conditions', async () => {
      engine.registerTemplate({
        name: 'conditional-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [
          {
            name: 'styling',
            description: 'Styling',
            type: 'choice',
            choices: ['css', 'tailwind'],
            default: 'css',
          },
        ],
        files: [
          {
            path: 'tailwind.config.js',
            content: 'module.exports = {}',
            condition: 'styling == tailwind',
          },
        ],
        directories: [],
      });

      const options: GenerateOptions = {
        template: 'conditional-template',
        projectName: 'test',
        outputDir: '/output',
        variables: { styling: 'tailwind' },
        skipInstall: true,
      };

      await engine.generate(options);

      const tailwindCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('tailwind.config.js')
      );

      expect(tailwindCall).toBeDefined();
    });

    it('should handle != condition operator', async () => {
      engine.registerTemplate({
        name: 'not-equal-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [
          {
            name: 'database',
            description: 'Database',
            type: 'choice',
            choices: ['none', 'postgresql'],
            default: 'none',
          },
        ],
        files: [
          {
            path: 'db.config.js',
            content: 'database config',
            condition: 'database != none',
          },
        ],
        directories: [],
      });

      const options: GenerateOptions = {
        template: 'not-equal-template',
        projectName: 'test',
        outputDir: '/output',
        variables: { database: 'postgresql' },
        skipInstall: true,
      };

      await engine.generate(options);

      const dbCall = mockWriteFile.mock.calls.find(
        (call: unknown[]) => (call[0] as string).includes('db.config.js')
      );

      expect(dbCall).toBeDefined();
    });
  });

  describe('Variable Validation', () => {
    beforeEach(() => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as NodeJS.EventEmitter;
        setTimeout(() => proc.emit('close', 0), 0);
        return proc;
      });
    });

    it('should validate variable patterns', async () => {
      engine.registerTemplate({
        name: 'validation-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [
          {
            name: 'version',
            description: 'Version',
            type: 'string',
            required: true,
            validate: '^\\d+\\.\\d+\\.\\d+$',
          },
        ],
        files: [],
        directories: [],
      });

      const options: GenerateOptions = {
        template: 'validation-template',
        projectName: 'test',
        outputDir: '/output',
        variables: { version: 'invalid' },
        skipInstall: true,
      };

      await expect(engine.generate(options)).rejects.toThrow('does not match pattern');
    });

    it('should pass valid patterns', async () => {
      engine.registerTemplate({
        name: 'validation-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [
          {
            name: 'version',
            description: 'Version',
            type: 'string',
            required: true,
            validate: '^\\d+\\.\\d+\\.\\d+$',
          },
        ],
        files: [],
        directories: [],
      });

      const options: GenerateOptions = {
        template: 'validation-template',
        projectName: 'test',
        outputDir: '/output',
        variables: { version: '1.0.0' },
        skipInstall: true,
      };

      const result = await engine.generate(options);

      expect(result.success).toBe(true);
    });
  });

  describe('Executable Files', () => {
    beforeEach(() => {
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as NodeJS.EventEmitter;
        setTimeout(() => proc.emit('close', 0), 0);
        return proc;
      });
    });

    it('should set executable permission for marked files', async () => {
      engine.registerTemplate({
        name: 'exec-template',
        description: 'Test',
        category: 'custom',
        version: '1.0.0',
        variables: [],
        files: [
          {
            path: 'bin/run.sh',
            content: '#!/bin/bash\necho "Hello"',
            executable: true,
          },
        ],
        directories: ['bin'],
      });

      const options: GenerateOptions = {
        template: 'exec-template',
        projectName: 'test',
        outputDir: '/output',
        variables: {},
        skipInstall: true,
      };

      await engine.generate(options);

      expect(mockChmod).toHaveBeenCalledWith('/output/test/bin/run.sh', 0o755);
    });
  });

  describe('dispose', () => {
    it('should remove all event listeners', () => {
      const handler = jest.fn();
      engine.on('progress', handler);
      engine.on('error', handler);

      engine.dispose();

      expect(engine.listenerCount('progress')).toBe(0);
      expect(engine.listenerCount('error')).toBe(0);
    });
  });
});

// ============================================================================
// Factory Functions Tests
// ============================================================================

describe('Factory Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTemplateEngine();
    mockExistsSync.mockReturnValue(false);
  });

  describe('getTemplateEngine', () => {
    it('should return singleton instance', () => {
      const engine1 = getTemplateEngine();
      const engine2 = getTemplateEngine();

      expect(engine1).toBe(engine2);
    });

    it('should create new instance after reset', () => {
      const engine1 = getTemplateEngine();
      resetTemplateEngine();
      const engine2 = getTemplateEngine();

      expect(engine1).not.toBe(engine2);
    });
  });

  describe('generateProject', () => {
    beforeEach(() => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockChmod.mockResolvedValue(undefined);
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as NodeJS.EventEmitter;
        setTimeout(() => proc.emit('close', 0), 0);
        return proc;
      });
    });

    it('should generate project using singleton engine', async () => {
      const options: GenerateOptions = {
        template: 'node-cli',
        projectName: 'quick-project',
        outputDir: '/output',
        variables: { binName: 'quick' },
        skipInstall: true,
      };

      const result = await generateProject(options);

      expect(result.success).toBe(true);
      expect(result.projectPath).toBe('/output/quick-project');
    });
  });
});

// ============================================================================
// Built-in Templates Tests
// ============================================================================

describe('Built-in Templates', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    resetTemplateEngine();
    mockExistsSync.mockReturnValue(false);
    engine = new TemplateEngine();
  });

  describe('node-cli template', () => {
    it('should have correct category', () => {
      const template = engine.getTemplate('node-cli');
      expect(template?.category).toBe('cli');
    });

    it('should require binName variable', () => {
      const template = engine.getTemplate('node-cli');
      const binNameVar = template?.variables.find(v => v.name === 'binName');

      expect(binNameVar).toBeDefined();
      expect(binNameVar?.required).toBe(true);
    });

    it('should have src and tests directories', () => {
      const template = engine.getTemplate('node-cli');

      expect(template?.directories).toContain('src');
      expect(template?.directories).toContain('tests');
    });

    it('should have essential files', () => {
      const template = engine.getTemplate('node-cli');
      const filePaths = template?.files.map(f => f.path);

      expect(filePaths).toContain('package.json');
      expect(filePaths).toContain('tsconfig.json');
      expect(filePaths).toContain('src/index.ts');
      expect(filePaths).toContain('.gitignore');
      expect(filePaths).toContain('README.md');
    });

    it('should have post-generate hooks', () => {
      const template = engine.getTemplate('node-cli');

      expect(template?.postGenerate?.some(h => h.command === 'npm')).toBe(true);
      expect(template?.postGenerate?.some(h => h.command === 'git')).toBe(true);
    });
  });

  describe('react-ts template', () => {
    it('should have correct category', () => {
      const template = engine.getTemplate('react-ts');
      expect(template?.category).toBe('web');
    });

    it('should have styling choice variable', () => {
      const template = engine.getTemplate('react-ts');
      const stylingVar = template?.variables.find(v => v.name === 'styling');

      expect(stylingVar).toBeDefined();
      expect(stylingVar?.type).toBe('choice');
      expect(stylingVar?.choices).toContain('css');
      expect(stylingVar?.choices).toContain('tailwind');
    });

    it('should have component directories', () => {
      const template = engine.getTemplate('react-ts');

      expect(template?.directories).toContain('src/components');
      expect(template?.directories).toContain('src/hooks');
      expect(template?.directories).toContain('src/utils');
    });
  });

  describe('express-api template', () => {
    it('should have correct category', () => {
      const template = engine.getTemplate('express-api');
      expect(template?.category).toBe('api');
    });

    it('should have database choice variable', () => {
      const template = engine.getTemplate('express-api');
      const databaseVar = template?.variables.find(v => v.name === 'database');

      expect(databaseVar).toBeDefined();
      expect(databaseVar?.type).toBe('choice');
      expect(databaseVar?.choices).toContain('none');
      expect(databaseVar?.choices).toContain('postgresql');
      expect(databaseVar?.choices).toContain('mongodb');
    });

    it('should have API structure directories', () => {
      const template = engine.getTemplate('express-api');

      expect(template?.directories).toContain('src/routes');
      expect(template?.directories).toContain('src/middleware');
      expect(template?.directories).toContain('src/controllers');
    });
  });
});

// ============================================================================
// Export Templates Tests
// ============================================================================

describe('Markdown Template', () => {
  const createMockSessionData = (overrides = {}) => ({
    id: 'session-123',
    name: 'Test Session',
    projectPath: '/test/project',
    model: 'grok-2',
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T11:00:00Z',
    totalTokensIn: 1000,
    totalTokensOut: 500,
    totalCost: 0.05,
    messageCount: 5,
    toolCallsCount: 3,
    messages: [
      {
        id: 1,
        role: 'user' as const,
        content: 'Hello, how are you?',
        timestamp: '2024-01-15T10:00:00Z',
        tokens: 10,
      },
      {
        id: 2,
        role: 'assistant' as const,
        content: 'I am doing well, thank you!',
        timestamp: '2024-01-15T10:00:05Z',
        tokens: 15,
      },
    ],
    metadata: { version: '1.0' },
    ...overrides,
  });

  const createMockExportOptions = (overrides = {}) => ({
    format: 'markdown' as const,
    includeMetadata: true,
    includeToolCalls: true,
    includeTimestamps: true,
    ...overrides,
  });

  it('should render session title', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = markdownTemplate(data, options);

    expect(result).toContain('# Test Session');
  });

  it('should use custom title when provided', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ title: 'Custom Title' });

    const result = markdownTemplate(data, options);

    expect(result).toContain('# Custom Title');
  });

  it('should include session metadata when enabled', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ includeMetadata: true });

    const result = markdownTemplate(data, options);

    expect(result).toContain('## Session Information');
    expect(result).toContain('session-123');
    expect(result).toContain('grok-2');
    expect(result).toContain('/test/project');
    expect(result).toContain('### Statistics');
    expect(result).toContain('**Messages**: 5');
    expect(result).toContain('**Tool Calls**: 3');
  });

  it('should exclude metadata when disabled', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ includeMetadata: false });

    const result = markdownTemplate(data, options);

    expect(result).not.toContain('## Session Information');
  });

  it('should render messages with role headers', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = markdownTemplate(data, options);

    expect(result).toContain('## Conversation');
    expect(result).toContain('User');
    expect(result).toContain('Assistant');
    expect(result).toContain('Hello, how are you?');
    expect(result).toContain('I am doing well, thank you!');
  });

  it('should include timestamps when enabled', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ includeTimestamps: true });

    const result = markdownTemplate(data, options);

    // Should contain timestamp in some format
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  it('should include tool calls when enabled', () => {
    const data = createMockSessionData({
      messages: [
        {
          role: 'assistant',
          content: 'Let me search for that.',
          toolCalls: [
            {
              name: 'search',
              arguments: JSON.stringify({ query: 'test' }),
            },
          ],
        },
      ],
    });
    const options = createMockExportOptions({ includeToolCalls: true });

    const result = markdownTemplate(data, options);

    expect(result).toContain('#### Tool Calls');
    expect(result).toContain('**search**');
    expect(result).toContain('query');
  });

  it('should handle tool calls with function property', () => {
    const data = createMockSessionData({
      messages: [
        {
          role: 'assistant',
          content: 'Running tool...',
          toolCalls: [
            {
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ path: '/test.txt' }),
              },
            },
          ],
        },
      ],
    });
    const options = createMockExportOptions({ includeToolCalls: true });

    const result = markdownTemplate(data, options);

    expect(result).toContain('**read_file**');
  });

  it('should truncate content when maxContentLength is set', () => {
    const data = createMockSessionData({
      messages: [
        {
          role: 'user',
          content: 'A'.repeat(100),
        },
      ],
    });
    const options = createMockExportOptions({ maxContentLength: 50 });

    const result = markdownTemplate(data, options);

    expect(result).toContain('[Content truncated]');
  });

  it('should include additional metadata as JSON', () => {
    const data = createMockSessionData({
      metadata: { customField: 'value', count: 42 },
    });
    const options = createMockExportOptions({ includeMetadata: true });

    const result = markdownTemplate(data, options);

    expect(result).toContain('### Additional Metadata');
    expect(result).toContain('customField');
    expect(result).toContain('42');
  });

  it('should include export footer', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = markdownTemplate(data, options);

    expect(result).toContain('Exported from Grok CLI');
  });
});

describe('HTML Template', () => {
  const createMockSessionData = (overrides = {}) => ({
    id: 'session-456',
    name: 'HTML Test Session',
    projectPath: '/html/project',
    model: 'grok-3',
    createdAt: '2024-02-20T14:00:00Z',
    updatedAt: '2024-02-20T15:00:00Z',
    totalTokensIn: 2000,
    totalTokensOut: 1000,
    totalCost: 0.10,
    messageCount: 10,
    toolCallsCount: 5,
    messages: [
      {
        id: 1,
        role: 'user' as const,
        content: 'Show me an example',
        timestamp: '2024-02-20T14:00:00Z',
        tokens: 20,
      },
      {
        id: 2,
        role: 'assistant' as const,
        content: 'Here is an example:\n```javascript\nconsole.log("Hello");\n```',
        timestamp: '2024-02-20T14:00:10Z',
        tokens: 30,
      },
    ],
    ...overrides,
  });

  const createMockExportOptions = (overrides = {}) => ({
    format: 'html' as const,
    includeMetadata: true,
    includeToolCalls: true,
    includeTimestamps: true,
    syntaxHighlight: true,
    ...overrides,
  });

  it('should render valid HTML document', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<html lang="en">');
    expect(result).toContain('</html>');
    expect(result).toContain('<head>');
    expect(result).toContain('<body>');
  });

  it('should include title in head and header', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ title: 'Custom HTML Title' });

    const result = htmlTemplate(data, options);

    expect(result).toContain('<title>Custom HTML Title</title>');
    expect(result).toContain('<h1>Custom HTML Title</h1>');
  });

  it('should use session name as default title', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).toContain('<title>HTML Test Session</title>');
  });

  it('should include default CSS styles', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).toContain('<style>');
    expect(result).toContain('font-family');
    expect(result).toContain('.message');
  });

  it('should use custom CSS when provided', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({
      customCss: '.custom { color: red; }',
    });

    const result = htmlTemplate(data, options);

    expect(result).toContain('.custom { color: red; }');
  });

  it('should render metadata section when enabled', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ includeMetadata: true });

    const result = htmlTemplate(data, options);

    expect(result).toContain('Session Information');
    // ID is truncated to first 8 chars + "...", session-456 becomes "session-..."
    expect(result).toContain('session-...');
    expect(result).toContain('grok-3');
    expect(result).toContain('10'); // messageCount
    expect(result).toContain('$0.1000'); // totalCost
  });

  it('should not render metadata when disabled', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ includeMetadata: false });

    const result = htmlTemplate(data, options);

    expect(result).not.toContain('Session Information');
    // The metadata section should not be rendered (check for actual content, not CSS class definitions)
    expect(result).not.toContain('<section class="metadata">');
  });

  it('should render messages with appropriate role classes', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).toContain('class="message user"');
    expect(result).toContain('class="message assistant"');
  });

  it('should escape HTML in content', () => {
    const data = createMockSessionData({
      messages: [
        {
          role: 'user',
          content: '<script>alert("XSS")</script>',
        },
      ],
    });
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).not.toContain('<script>alert("XSS")</script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('should format code blocks', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ syntaxHighlight: true });

    const result = htmlTemplate(data, options);

    expect(result).toContain('<pre>');
    expect(result).toContain('<code');
    expect(result).toContain('language-javascript');
  });

  it('should include timestamps when enabled', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions({ includeTimestamps: true });

    const result = htmlTemplate(data, options);

    expect(result).toContain('class="message-timestamp"');
  });

  it('should include tool calls when enabled', () => {
    const data = createMockSessionData({
      messages: [
        {
          role: 'assistant',
          content: 'Using tool...',
          toolCalls: [
            {
              name: 'bash',
              arguments: JSON.stringify({ command: 'ls -la' }),
            },
          ],
        },
      ],
    });
    const options = createMockExportOptions({ includeToolCalls: true });

    const result = htmlTemplate(data, options);

    expect(result).toContain('class="tool-calls"');
    expect(result).toContain('bash');
  });

  it('should truncate long content when maxContentLength is set', () => {
    const data = createMockSessionData({
      messages: [
        {
          role: 'user',
          content: 'B'.repeat(200),
        },
      ],
    });
    const options = createMockExportOptions({ maxContentLength: 100 });

    const result = htmlTemplate(data, options);

    expect(result).toContain('[Content truncated]');
  });

  it('should include token count when metadata is enabled', () => {
    const data = createMockSessionData({
      messages: [
        {
          role: 'user',
          content: 'Test',
          tokens: 42,
        },
      ],
    });
    const options = createMockExportOptions({ includeMetadata: true });

    const result = htmlTemplate(data, options);

    expect(result).toContain('class="token-count"');
    expect(result).toContain('42');
  });

  it('should include footer with export date', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).toContain('<footer>');
    expect(result).toContain('Exported on');
    expect(result).toContain('Grok CLI');
  });

  it('should include print-friendly styles', () => {
    const data = createMockSessionData();
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).toContain('@media print');
  });

  it('should handle all message roles', () => {
    const data = createMockSessionData({
      messages: [
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' },
        { role: 'system', content: 'System message' },
        { role: 'tool', content: 'Tool result' },
      ],
    });
    const options = createMockExportOptions();

    const result = htmlTemplate(data, options);

    expect(result).toContain('class="message user"');
    expect(result).toContain('class="message assistant"');
    expect(result).toContain('class="message system"');
    expect(result).toContain('class="message tool"');
  });

  it('should include project path when available', () => {
    const data = createMockSessionData({ projectPath: '/my/project/path' });
    const options = createMockExportOptions({ includeMetadata: true });

    const result = htmlTemplate(data, options);

    expect(result).toContain('/my/project/path');
  });

  it('should handle missing project path', () => {
    const data = createMockSessionData({ projectPath: undefined });
    const options = createMockExportOptions({ includeMetadata: true });

    const result = htmlTemplate(data, options);

    // Should not throw and should still render
    expect(result).toContain('<!DOCTYPE html>');
  });
});

// ============================================================================
// Template Categories Tests
// ============================================================================

describe('Template Categories', () => {
  const validCategories: TemplateCategory[] = [
    'web',
    'api',
    'cli',
    'library',
    'fullstack',
    'mobile',
    'desktop',
    'microservice',
    'custom',
  ];

  it('should support all valid template categories', () => {
    const engine = new TemplateEngine();

    for (const category of validCategories) {
      const template: ProjectTemplate = {
        name: `test-${category}`,
        description: `Test ${category} template`,
        category,
        version: '1.0.0',
        variables: [],
        files: [],
        directories: [],
      };

      engine.registerTemplate(template);
      expect(engine.getTemplate(`test-${category}`)?.category).toBe(category);
    }
  });
});
