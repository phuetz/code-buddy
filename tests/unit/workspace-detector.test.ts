/**
 * Comprehensive Unit Tests for Workspace Detector
 *
 * Tests cover:
 * 1. Project type detection
 * 2. Package manager detection
 * 3. Dependencies detection
 * 4. Test framework detection
 * 5. Linter and formatter detection
 * 6. Build tool detection
 * 7. Config files detection
 * 8. Recommended settings generation
 * 9. Status formatting
 * 10. Singleton and factory functions
 */

import { EventEmitter } from 'events';
import * as path from 'path';

// Create mock functions
const mockPathExists = jest.fn().mockResolvedValue(false);
const mockReadJson = jest.fn().mockResolvedValue({});
const mockReadFile = jest.fn().mockResolvedValue('');
const mockReaddir = jest.fn().mockResolvedValue([]);

// Mock fs-extra before importing
jest.mock('fs-extra', () => ({
  pathExists: mockPathExists,
  readJson: mockReadJson,
  readFile: mockReadFile,
  readdir: mockReaddir,
}));

import {
  WorkspaceDetector,
  WorkspaceConfig,
  ProjectType,
  PackageManager,
  getWorkspaceDetector,
  detectWorkspace,
} from '../../src/utils/workspace-detector';

describe('WorkspaceDetector', () => {
  let detector: WorkspaceDetector;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathExists.mockResolvedValue(false);
    mockReadJson.mockResolvedValue({});
    mockReadFile.mockResolvedValue('');
    mockReaddir.mockResolvedValue([]);

    detector = new WorkspaceDetector('/test/project');
  });

  describe('Constructor', () => {
    it('should create detector with project root', () => {
      expect(detector).toBeDefined();
      expect(detector).toBeInstanceOf(EventEmitter);
    });

    it('should default to process.cwd if no root provided', () => {
      const defaultDetector = new WorkspaceDetector();
      expect(defaultDetector).toBeDefined();
    });
  });

  describe('Project Type Detection', () => {
    it('should detect Next.js project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('next.config')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('nextjs');
      expect(config.frameworks).toContain('next');
    });

    it('should detect Vue project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('vue.config.js')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('vue');
      expect(config.frameworks).toContain('vue');
    });

    it('should detect Angular project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('angular.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('angular');
      expect(config.frameworks).toContain('angular');
    });

    it('should detect React project', async () => {
      const reactFile = path.join('src', 'App.tsx');
      mockPathExists.mockImplementation((p: string) => {
        if (p.includes(reactFile)) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('react');
      expect(config.frameworks).toContain('react');
    });

    it('should detect TypeScript project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('typescript');
    });

    it('should detect Node.js project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('node');
    });

    it('should detect Python project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('requirements.txt')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadFile.mockResolvedValue('flask==2.0.0\nrequests==2.28.0');

      const config = await detector.detect();

      expect(config.type).toBe('python');
      expect(config.language).toBe('python');
    });

    it('should detect Rust project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('Cargo.toml')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('rust');
      expect(config.language).toBe('rust');
    });

    it('should detect Go project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('go.mod')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('go');
      expect(config.language).toBe('go');
    });

    it('should detect Java project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('pom.xml')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('java');
      expect(config.language).toBe('java');
    });

    it('should detect .NET project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('.csproj') || path.includes('.sln')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReaddir.mockResolvedValue(['project.csproj']);

      const config = await detector.detect();

      expect(config.type).toBe('dotnet');
      expect(config.language).toBe('csharp');
    });

    it('should detect Ruby project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('Gemfile')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('ruby');
      expect(config.language).toBe('ruby');
    });

    it('should detect PHP project', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('composer.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('php');
      expect(config.language).toBe('php');
    });

    it('should return unknown for unrecognized project', async () => {
      mockPathExists.mockResolvedValue(false);

      const config = await detector.detect();

      expect(config.type).toBe('unknown');
      expect(config.language).toBe('unknown');
    });

    it('should prioritize higher weight matches', async () => {
      // Both Next.js and Node.js files exist
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('next.config')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      // Next.js should win (higher weight)
      expect(config.type).toBe('nextjs');
    });

    it('should track sub-types', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('tsconfig.json')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.type).toBe('typescript');
      expect(config.subTypes).toContain('node');
    });
  });

  describe('Package Manager Detection', () => {
    it('should detect npm', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package-lock.json')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.packageManager).toBe('npm');
    });

    it('should detect yarn', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('yarn.lock')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.packageManager).toBe('yarn');
    });

    it('should detect pnpm', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('pnpm-lock.yaml')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.packageManager).toBe('pnpm');
    });

    it('should detect bun', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('bun.lockb')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.packageManager).toBe('bun');
    });

    it('should detect pip', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('requirements.txt')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadFile.mockResolvedValue('flask==2.0.0');

      const config = await detector.detect();

      expect(config.packageManager).toBe('pip');
    });

    it('should detect cargo', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('Cargo.lock')) return Promise.resolve(true);
        if (path.includes('Cargo.toml')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.packageManager).toBe('cargo');
    });

    it('should detect go modules', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('go.sum')) return Promise.resolve(true);
        if (path.includes('go.mod')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.packageManager).toBe('go');
    });

    it('should return unknown when no lock file found', async () => {
      mockPathExists.mockResolvedValue(false);

      const config = await detector.detect();

      expect(config.packageManager).toBe('unknown');
    });
  });

  describe('Dependencies Detection', () => {
    it('should detect dependencies from package.json', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        dependencies: { react: '^18.0.0', express: '^4.18.0' },
        devDependencies: { jest: '^29.0.0' },
        scripts: { test: 'jest', build: 'tsc' },
      });

      const config = await detector.detect();

      expect(config.dependencies).toContain('react');
      expect(config.dependencies).toContain('express');
      expect(config.devDependencies).toContain('jest');
      expect(config.scripts?.test).toBe('jest');
    });

    it('should detect frameworks from dependencies', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        dependencies: { next: '^13.0.0', react: '^18.0.0' },
      });

      const config = await detector.detect();

      expect(config.frameworks).toContain('next');
      expect(config.frameworks).toContain('react');
    });

    it('should detect Python frameworks', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('requirements.txt')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadFile.mockResolvedValue('django==4.0.0\nflask==2.0.0\nfastapi==0.95.0');

      const config = await detector.detect();

      expect(config.frameworks).toContain('django');
      expect(config.frameworks).toContain('flask');
      expect(config.frameworks).toContain('fastapi');
    });

    it('should handle JSON parse errors gracefully', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockRejectedValue(new Error('Invalid JSON'));

      const config = await detector.detect();

      expect(config.dependencies).toBeUndefined();
    });
  });

  describe('Test Framework Detection', () => {
    it('should detect Jest from dependencies', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { jest: '^29.0.0' },
      });

      const config = await detector.detect();

      expect(config.testFramework).toBe('jest');
    });

    it('should detect Vitest from dependencies', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { vitest: '^0.34.0' },
      });

      const config = await detector.detect();

      expect(config.testFramework).toBe('vitest');
    });

    it('should detect Mocha from dependencies', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { mocha: '^10.0.0' },
      });

      const config = await detector.detect();

      expect(config.testFramework).toBe('mocha');
    });

    it('should detect Jest from config file', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('jest.config.ts')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({});

      const config = await detector.detect();

      expect(config.testFramework).toBe('jest');
    });

    it('should detect Vitest from config file', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('vitest.config.ts')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({});

      const config = await detector.detect();

      expect(config.testFramework).toBe('vitest');
    });

    it('should detect pytest from config file', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('pytest.ini')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.testFramework).toBe('pytest');
    });
  });

  describe('Linter and Formatter Detection', () => {
    it('should detect ESLint from dependencies', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { eslint: '^8.0.0' },
      });

      const config = await detector.detect();

      expect(config.linter).toBe('eslint');
    });

    it('should detect Prettier from dependencies', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { prettier: '^3.0.0' },
      });

      const config = await detector.detect();

      expect(config.formatter).toBe('prettier');
    });

    it('should detect ESLint from config file', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('.eslintrc.js')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({});

      const config = await detector.detect();

      expect(config.linter).toBe('eslint');
    });

    it('should detect Prettier from config file', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('.prettierrc')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({});

      const config = await detector.detect();

      expect(config.formatter).toBe('prettier');
    });
  });

  describe('Build Tool Detection', () => {
    it('should detect Vite', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('vite.config.ts')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.buildTool).toBe('vite');
    });

    it('should detect Webpack', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('webpack.config.js')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.buildTool).toBe('webpack');
    });

    it('should detect Turbo', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('turbo.json')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.buildTool).toBe('turbo');
    });

    it('should detect Nx', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('nx.json')) return Promise.resolve(true);
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.buildTool).toBe('nx');
    });
  });

  describe('Config Files Detection', () => {
    it('should find common config files', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        if (path.includes('tsconfig.json')) return Promise.resolve(true);
        if (path.includes('.gitignore')) return Promise.resolve(true);
        if (path.includes('Dockerfile')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detector.detect();

      expect(config.configFiles).toContain('package.json');
      expect(config.configFiles).toContain('tsconfig.json');
      expect(config.configFiles).toContain('.gitignore');
      expect(config.configFiles).toContain('Dockerfile');
    });
  });

  describe('Caching', () => {
    it('should cache detection results', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config1 = await detector.detect();
      const config2 = await detector.detect();

      expect(config1).toBe(config2); // Same object reference
    });

    it('should clear cache', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config1 = await detector.detect();
      detector.clearCache();
      const config2 = await detector.detect();

      expect(config1).not.toBe(config2);
    });
  });

  describe('Events', () => {
    it('should emit detection:complete event', async () => {
      const handler = jest.fn();
      detector.on('detection:complete', handler);

      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      await detector.detect();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'node',
      }));
    });
  });

  describe('generateRecommendedSettings', () => {
    it('should generate recommended settings', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        scripts: { test: 'jest', lint: 'eslint .', build: 'tsc' },
        devDependencies: { jest: '^29.0.0', eslint: '^8.0.0' },
      });

      const settings = await detector.generateRecommendedSettings();

      expect(settings.projectType).toBe('node');
      expect(settings.testCommand).toBeDefined();
      expect(settings.lintCommand).toBeDefined();
      expect(settings.buildCommand).toBeDefined();
    });

    it('should use test framework commands when no script', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { jest: '^29.0.0' },
      });

      const settings = await detector.generateRecommendedSettings();

      expect(settings.testCommand).toBe('npx jest');
    });

    it('should accept pre-detected config', async () => {
      const preConfig: WorkspaceConfig = {
        type: 'typescript',
        subTypes: [],
        packageManager: 'npm',
        language: 'typescript',
        frameworks: ['react'],
        configFiles: [],
        testFramework: 'vitest',
        linter: 'eslint',
        formatter: 'prettier',
      };

      const settings = await detector.generateRecommendedSettings(preConfig);

      expect(settings.projectType).toBe('typescript');
      expect(settings.testCommand).toBe('npx vitest run');
    });
  });

  describe('formatDetectionResults', () => {
    it('should format results as string', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { jest: '^29.0.0', eslint: '^8.0.0', prettier: '^3.0.0' },
      });

      await detector.detect();
      const output = detector.formatDetectionResults();

      expect(output).toContain('Workspace Detection Results');
      expect(output).toContain('Project Type:');
      expect(output).toContain('Language:');
      expect(output).toContain('Package Manager:');
    });

    it('should show frameworks when present', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        dependencies: { react: '^18.0.0', express: '^4.18.0' },
      });

      await detector.detect();
      const output = detector.formatDetectionResults();

      expect(output).toContain('Frameworks:');
      expect(output).toContain('react');
      expect(output).toContain('express');
    });

    it('should show tools section', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });
      mockReadJson.mockResolvedValue({
        devDependencies: { jest: '^29.0.0', eslint: '^8.0.0' },
      });

      await detector.detect();
      const output = detector.formatDetectionResults();

      expect(output).toContain('Tools:');
      expect(output).toContain('Test:');
      expect(output).toContain('Lint:');
    });

    it('should return message when no detection performed', () => {
      const output = detector.formatDetectionResults();

      expect(output).toContain('No workspace detection performed');
    });

    it('should accept config parameter', () => {
      const config: WorkspaceConfig = {
        type: 'typescript',
        subTypes: ['node'],
        packageManager: 'npm',
        language: 'typescript',
        frameworks: ['express'],
        configFiles: ['package.json', 'tsconfig.json'],
        testFramework: 'jest',
        linter: 'eslint',
      };

      const output = detector.formatDetectionResults(config);

      expect(output).toContain('typescript');
      expect(output).toContain('express');
    });

    it('should limit config files display', async () => {
      mockPathExists.mockResolvedValue(true);

      await detector.detect();
      const output = detector.formatDetectionResults();

      // Should show config files section
      expect(output).toContain('Config Files:');
    });
  });

  describe('Singleton and Factory Functions', () => {
    it('should get workspace detector singleton', () => {
      const instance = getWorkspaceDetector('/test/path');
      expect(instance).toBeInstanceOf(WorkspaceDetector);
    });

    it('should return same singleton instance', () => {
      const instance1 = getWorkspaceDetector('/test/path');
      const instance2 = getWorkspaceDetector('/test/path');
      expect(instance1).toBe(instance2);
    });

    it('should detect workspace via factory function', async () => {
      mockPathExists.mockImplementation((path: string) => {
        if (path.includes('package.json')) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const config = await detectWorkspace('/test/path');

      expect(config).toBeDefined();
      expect(config.type).toBeDefined();
    });
  });

  describe('Glob Pattern Matching', () => {
    it('should match glob patterns for .NET projects', async () => {
      mockPathExists.mockResolvedValue(false);
      mockReaddir.mockResolvedValue(['MyProject.csproj', 'Program.cs']);

      const config = await detector.detect();

      expect(config.type).toBe('dotnet');
    });

    it('should handle readdir errors gracefully', async () => {
      mockPathExists.mockResolvedValue(false);
      mockReaddir.mockRejectedValue(new Error('Permission denied'));

      const config = await detector.detect();

      // Should not throw, just not detect .NET
      expect(config.type).toBe('unknown');
    });
  });

  describe('Language Detection', () => {
    const typeLanguageMap: Array<[ProjectType, string]> = [
      ['node', 'javascript'],
      ['typescript', 'typescript'],
      ['react', 'typescript'],
      ['nextjs', 'typescript'],
      ['vue', 'typescript'],
      ['angular', 'typescript'],
      ['python', 'python'],
      ['rust', 'rust'],
      ['go', 'go'],
      ['java', 'java'],
      ['dotnet', 'csharp'],
      ['ruby', 'ruby'],
      ['php', 'php'],
    ];

    typeLanguageMap.forEach(([type, language]) => {
      it(`should map ${type} to ${language}`, async () => {
        // Set up mock for each project type
        const fileMap: Record<string, string> = {
          node: 'package.json',
          typescript: 'tsconfig.json',
          react: path.join('src', 'App.tsx'),
          nextjs: 'next.config.js',
          vue: 'vue.config.js',
          angular: 'angular.json',
          python: 'requirements.txt',
          rust: 'Cargo.toml',
          go: 'go.mod',
          java: 'pom.xml',
          dotnet: '.csproj',
          ruby: 'Gemfile',
          php: 'composer.json',
        };

        mockPathExists.mockImplementation((p: string) => {
          const file = fileMap[type];
          if (file && p.includes(file)) return Promise.resolve(true);
          return Promise.resolve(false);
        });

        if (type === 'dotnet') {
          mockReaddir.mockResolvedValue(['project.csproj']);
        }

        if (type === 'python') {
          mockReadFile.mockResolvedValue('flask==2.0.0');
        }

        const newDetector = new WorkspaceDetector('/test/project');
        const config = await newDetector.detect();

        expect(config.language).toBe(language);
      });
    });
  });
});
