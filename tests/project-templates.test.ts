/**
 * Project Templates & Scaffolding Tests
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  TemplateEngine,
  getTemplateEngine,
  resetTemplateEngine,
  generateProject,
  type ProjectTemplate,
} from '../src/templates/project-scaffolding.js';

describe('TemplateEngine', () => {
  let engine: TemplateEngine;
  let testDir: string;

  beforeEach(async () => {
    resetTemplateEngine();
    testDir = path.join(os.tmpdir(), `template-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    engine = new TemplateEngine();
  });

  afterEach(async () => {
    engine.dispose();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Template Registry', () => {
    it('should have built-in templates', () => {
      const templates = engine.getTemplates();

      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => t.name === 'node-cli')).toBe(true);
      expect(templates.some(t => t.name === 'react-ts')).toBe(true);
      expect(templates.some(t => t.name === 'express-api')).toBe(true);
    });

    it('should get template by name', () => {
      const template = engine.getTemplate('node-cli');

      expect(template).toBeDefined();
      expect(template?.name).toBe('node-cli');
      expect(template?.category).toBe('cli');
    });

    it('should return undefined for unknown template', () => {
      const template = engine.getTemplate('non-existent');
      expect(template).toBeUndefined();
    });

    it('should register custom template', () => {
      const customTemplate: ProjectTemplate = {
        name: 'custom-template',
        description: 'A custom template',
        category: 'custom',
        version: '1.0.0',
        variables: [],
        files: [],
        directories: [],
      };

      engine.registerTemplate(customTemplate);

      const template = engine.getTemplate('custom-template');
      expect(template).toBeDefined();
      expect(template?.description).toBe('A custom template');
    });
  });

  describe('Built-in Templates Structure', () => {
    it('should have valid node-cli template', () => {
      const template = engine.getTemplate('node-cli');

      expect(template?.variables.some(v => v.name === 'binName' && v.required === true)).toBe(true);
      expect(template?.files.some(f => f.path === 'package.json')).toBe(true);
      expect(template?.files.some(f => f.path === 'src/index.ts')).toBe(true);
      expect(template?.directories).toContain('src');
      expect(template?.directories).toContain('tests');
    });

    it('should have valid react-ts template', () => {
      const template = engine.getTemplate('react-ts');

      expect(template?.category).toBe('web');
      expect(template?.variables.some(v => v.name === 'styling')).toBe(true);
      expect(template?.files.some(f => f.path === 'vite.config.ts')).toBe(true);
      expect(template?.files.some(f => f.path === 'src/App.tsx')).toBe(true);
    });

    it('should have valid express-api template', () => {
      const template = engine.getTemplate('express-api');

      expect(template?.category).toBe('api');
      expect(template?.variables.some(v => v.name === 'port')).toBe(true);
      expect(template?.variables.some(v => v.name === 'database')).toBe(true);
      expect(template?.directories).toContain('src/routes');
      expect(template?.directories).toContain('src/middleware');
    });
  });

  describe('Project Generation', () => {
    it('should generate project from template', async () => {
      const result = await engine.generate({
        template: 'node-cli',
        projectName: 'test-cli',
        outputDir: testDir,
        variables: { binName: 'testcmd' },
        skipInstall: true,
        skipGit: true,
      });

      expect(result.success).toBe(true);
      expect(result.projectPath).toBe(path.join(testDir, 'test-cli'));
      expect(existsSync(result.projectPath)).toBe(true);
    });

    it('should create directories', async () => {
      await engine.generate({
        template: 'node-cli',
        projectName: 'test-dirs',
        outputDir: testDir,
        variables: { binName: 'test' },
        skipInstall: true,
        skipGit: true,
      });

      const projectPath = path.join(testDir, 'test-dirs');
      expect(existsSync(path.join(projectPath, 'src'))).toBe(true);
      expect(existsSync(path.join(projectPath, 'tests'))).toBe(true);
    });

    it('should create files with interpolated content', async () => {
      await engine.generate({
        template: 'node-cli',
        projectName: 'my-awesome-cli',
        outputDir: testDir,
        variables: {
          binName: 'awesome',
          description: 'An awesome CLI',
          author: 'Test Author',
        },
        skipInstall: true,
        skipGit: true,
      });

      const packageJson = await fs.readFile(
        path.join(testDir, 'my-awesome-cli', 'package.json'),
        'utf-8'
      );
      const pkg = JSON.parse(packageJson);

      expect(pkg.name).toBe('my-awesome-cli');
      expect(pkg.description).toBe('An awesome CLI');
      expect(pkg.author).toBe('Test Author');
      expect(pkg.bin.awesome).toBeDefined();
    });

    it('should return list of created files', async () => {
      const result = await engine.generate({
        template: 'node-cli',
        projectName: 'test-files',
        outputDir: testDir,
        variables: { binName: 'test' },
        skipInstall: true,
        skipGit: true,
      });

      // Normalize path separators for cross-platform comparison
      const normalizedFiles = result.filesCreated.map(f => f.replace(/\\/g, '/'));
      expect(normalizedFiles).toContain('package.json');
      expect(normalizedFiles).toContain('tsconfig.json');
      expect(normalizedFiles).toContain('src/index.ts');
      expect(normalizedFiles).toContain('.gitignore');
      expect(normalizedFiles).toContain('README.md');
    });

    it('should return duration', async () => {
      const result = await engine.generate({
        template: 'node-cli',
        projectName: 'test-duration',
        outputDir: testDir,
        variables: { binName: 'test' },
        skipInstall: true,
        skipGit: true,
      });

      expect(result.duration).toBeGreaterThan(0);
    });

    it('should return next steps', async () => {
      const result = await engine.generate({
        template: 'node-cli',
        projectName: 'test-steps',
        outputDir: testDir,
        variables: { binName: 'test' },
        skipInstall: true,
        skipGit: true,
      });

      expect(result.nextSteps).toContain('cd test-steps');
      expect(result.nextSteps).toContain('npm install');
      expect(result.nextSteps).toContain('npm run dev');
    });
  });

  describe('Variable Handling', () => {
    it('should apply default values', async () => {
      await engine.generate({
        template: 'node-cli',
        projectName: 'test-defaults',
        outputDir: testDir,
        variables: { binName: 'test' },
        skipInstall: true,
        skipGit: true,
      });

      const packageJson = await fs.readFile(
        path.join(testDir, 'test-defaults', 'package.json'),
        'utf-8'
      );
      const pkg = JSON.parse(packageJson);

      // Default description from template
      expect(pkg.description).toBe('A CLI application');
    });

    it('should throw on missing required variables', async () => {
      await expect(
        engine.generate({
          template: 'node-cli',
          projectName: 'test-missing',
          outputDir: testDir,
          variables: {}, // Missing required 'binName'
          skipInstall: true,
          skipGit: true,
        })
      ).rejects.toThrow('Missing required variable: binName');
    });

    it('should include projectName as variable', async () => {
      await engine.generate({
        template: 'node-cli',
        projectName: 'project-name-test',
        outputDir: testDir,
        variables: { binName: 'test' },
        skipInstall: true,
        skipGit: true,
      });

      const readme = await fs.readFile(
        path.join(testDir, 'project-name-test', 'README.md'),
        'utf-8'
      );

      expect(readme).toContain('# project-name-test');
    });
  });

  describe('Error Handling', () => {
    it('should throw for unknown template', async () => {
      await expect(
        engine.generate({
          template: 'non-existent-template',
          projectName: 'test',
          outputDir: testDir,
          variables: {},
          skipInstall: true,
          skipGit: true,
        })
      ).rejects.toThrow('Template not found: non-existent-template');
    });

    it('should throw if directory exists', async () => {
      // Create directory first
      await fs.mkdir(path.join(testDir, 'existing-dir'), { recursive: true });

      await expect(
        engine.generate({
          template: 'node-cli',
          projectName: 'existing-dir',
          outputDir: testDir,
          variables: { binName: 'test' },
          skipInstall: true,
          skipGit: true,
        })
      ).rejects.toThrow('Directory already exists');
    });
  });

  describe('Events', () => {
    it('should emit progress events', async () => {
      const progressHandler = jest.fn();
      engine.on('progress', progressHandler);

      await engine.generate({
        template: 'node-cli',
        projectName: 'test-events',
        outputDir: testDir,
        variables: { binName: 'test' },
        skipInstall: true,
        skipGit: true,
      });

      expect(progressHandler).toHaveBeenCalled();
      expect(progressHandler).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'creating' })
      );
      expect(progressHandler).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'files-created' })
      );
    });
  });

  describe('Custom Templates', () => {
    it('should load custom templates from directory', async () => {
      // Create custom templates directory
      const customDir = path.join(testDir, 'custom-templates');
      await fs.mkdir(path.join(customDir, 'my-template'), { recursive: true });

      // Create template.json
      const template: ProjectTemplate = {
        name: 'my-custom',
        description: 'My custom template',
        category: 'custom',
        version: '1.0.0',
        variables: [],
        files: [{ path: 'index.js', content: 'console.log("hello");' }],
        directories: [],
      };

      await fs.writeFile(
        path.join(customDir, 'my-template', 'template.json'),
        JSON.stringify(template)
      );

      // Create engine with custom templates dir
      const customEngine = new TemplateEngine(customDir);
      await customEngine.loadCustomTemplates();

      const loaded = customEngine.getTemplate('my-custom');
      expect(loaded).toBeDefined();
      expect(loaded?.description).toBe('My custom template');

      customEngine.dispose();
    });

    it('should handle missing custom templates directory', async () => {
      const customEngine = new TemplateEngine('/non/existent/path');
      await customEngine.loadCustomTemplates(); // Should not throw

      // Built-in templates still available
      expect(customEngine.getTemplate('node-cli')).toBeDefined();

      customEngine.dispose();
    });
  });
});

describe('Factory Functions', () => {
  beforeEach(() => {
    resetTemplateEngine();
  });

  describe('getTemplateEngine', () => {
    it('should return singleton instance', () => {
      const e1 = getTemplateEngine();
      const e2 = getTemplateEngine();

      expect(e1).toBe(e2);
    });
  });

  describe('resetTemplateEngine', () => {
    it('should reset singleton', () => {
      const e1 = getTemplateEngine();
      resetTemplateEngine();
      const e2 = getTemplateEngine();

      expect(e1).not.toBe(e2);
    });
  });

  describe('generateProject', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = path.join(os.tmpdir(), `gen-test-${Date.now()}`);
      await fs.mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      resetTemplateEngine();
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it('should generate project with factory function', async () => {
      const result = await generateProject({
        template: 'node-cli',
        projectName: 'quick-gen',
        outputDir: testDir,
        variables: { binName: 'quick' },
        skipInstall: true,
        skipGit: true,
      });

      expect(result.success).toBe(true);
      expect(existsSync(result.projectPath)).toBe(true);
    });
  });
});

describe('Template Variables', () => {
  it('should define variable types', () => {
    const engine = new TemplateEngine();
    const template = engine.getTemplate('express-api');

    const portVar = template?.variables.find(v => v.name === 'port');
    expect(portVar?.type).toBe('string');
    expect(portVar?.default).toBe('3000');

    const dbVar = template?.variables.find(v => v.name === 'database');
    expect(dbVar?.type).toBe('choice');
    expect(dbVar?.choices).toContain('postgresql');
    expect(dbVar?.choices).toContain('mongodb');

    engine.dispose();
  });
});

describe('Template Categories', () => {
  it('should have correct categories', () => {
    const engine = new TemplateEngine();
    const templates = engine.getTemplates();

    const cliTemplates = templates.filter(t => t.category === 'cli');
    const webTemplates = templates.filter(t => t.category === 'web');
    const apiTemplates = templates.filter(t => t.category === 'api');

    expect(cliTemplates.length).toBeGreaterThan(0);
    expect(webTemplates.length).toBeGreaterThan(0);
    expect(apiTemplates.length).toBeGreaterThan(0);

    engine.dispose();
  });
});
