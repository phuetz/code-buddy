/**
 * Tests for RepoProfiler
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { RepoProfiler } from '../../src/agent/repo-profiler.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-profiler-test-'));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

describe('RepoProfiler', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  describe('Node/TypeScript detection', () => {
    it('should detect npm from package.json', async () => {
      const pkg = {
        name: 'my-app',
        scripts: { test: 'jest', lint: 'eslint .', build: 'tsc' },
        dependencies: {},
        devDependencies: {},
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.languages).toContain('TypeScript');
      expect(profile.packageManager).toBe('npm');
      expect(profile.commands.test).toBe('npm run test');
      expect(profile.commands.lint).toBe('npm run lint');
      expect(profile.commands.build).toBe('npm run build');
    });

    it('should detect pnpm from lockfile', async () => {
      const pkg = { name: 'pnpm-app', scripts: { test: 'vitest' }, dependencies: {} };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
      fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.packageManager).toBe('pnpm');
      expect(profile.commands.test).toBe('pnpm test');
    });

    it('should detect yarn from lockfile', async () => {
      const pkg = { name: 'yarn-app', scripts: { test: 'jest' }, dependencies: {} };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
      fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.packageManager).toBe('yarn');
    });

    it('should detect React framework', async () => {
      const pkg = {
        name: 'react-app',
        scripts: { test: 'jest' },
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.framework).toBe('React');
    });
  });

  describe('Python detection', () => {
    it('should detect poetry from pyproject.toml', async () => {
      fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.poetry]\nname = "myapp"');

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.languages).toContain('Python');
      expect(profile.packageManager).toBe('poetry');
      expect(profile.commands.test).toBe('poetry run pytest');
    });

    it('should detect pip from requirements.txt', async () => {
      fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'requests==2.28.0');

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.languages).toContain('Python');
      expect(profile.packageManager).toBe('pip');
    });
  });

  describe('Rust detection', () => {
    it('should detect cargo from Cargo.toml', async () => {
      fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "my-crate"');

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.languages).toContain('Rust');
      expect(profile.packageManager).toBe('cargo');
      expect(profile.commands.test).toBe('cargo test');
      expect(profile.commands.build).toBe('cargo build --release');
    });
  });

  describe('Go detection', () => {
    it('should detect go from go.mod', async () => {
      fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/app\ngo 1.21');

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.languages).toContain('Go');
      expect(profile.packageManager).toBe('go');
      expect(profile.commands.test).toBe('go test ./...');
    });
  });

  describe('Directory detection', () => {
    it('should detect src directory', async () => {
      const pkg = { name: 'app', scripts: {}, dependencies: {} };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
      fs.mkdirSync(path.join(tmpDir, 'src'));

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.directories.src).toBe('src');
    });

    it('should detect tests directory', async () => {
      const pkg = { name: 'app', scripts: {}, dependencies: {} };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
      fs.mkdirSync(path.join(tmpDir, 'tests'));

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.directories.tests).toBe('tests');
    });
  });

  describe('contextPack', () => {
    it('should produce non-empty contextPack', async () => {
      const pkg = {
        name: 'ctx-app',
        scripts: { test: 'jest', build: 'tsc' },
        dependencies: {},
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.contextPack).toBeTruthy();
      expect(profile.contextPack).toContain('Language:');
    });

    it('should include commands in contextPack', async () => {
      const pkg = {
        name: 'cmd-app',
        scripts: { test: 'jest', lint: 'eslint .' },
        dependencies: {},
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.contextPack).toContain('Commands:');
    });
  });

  describe('Caching', () => {
    it('should cache profile to .codebuddy/repoProfile.json', async () => {
      const pkg = { name: 'cache-app', scripts: { test: 'jest' }, dependencies: {} };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

      const profiler = new RepoProfiler(tmpDir);
      await profiler.getProfile();

      const cachePath = path.join(tmpDir, '.codebuddy', 'repoProfile.json');
      expect(fs.existsSync(cachePath)).toBe(true);

      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      expect(cached.languages).toContain('TypeScript');
    });

    it('should return cached profile on second call', async () => {
      const pkg = { name: 'cached-app', scripts: { test: 'jest' }, dependencies: {} };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));

      const profiler = new RepoProfiler(tmpDir);
      const first = await profiler.getProfile();
      const second = await profiler.getProfile();

      // Both should have the same detectedAt timestamp
      expect(first.detectedAt).toBe(second.detectedAt);
    });
  });

  describe('Empty repo', () => {
    it('should return empty profile for empty directory', async () => {
      const profiler = new RepoProfiler(tmpDir);
      const profile = await profiler.getProfile();

      expect(profile.languages).toHaveLength(0);
      expect(profile.packageManager).toBeUndefined();
    });
  });
});
