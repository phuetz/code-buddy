import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

import { CodebaseMapExecuteTool } from '../../src/tools/registry/advanced-tools';
import { ProjectMapTool } from '../../src/tools/project-map-tool';
import { CodeStatsTool } from '../../src/tools/code-stats-tool';
import { TodoScanTool } from '../../src/tools/todo-scan-tool';
import { DepInspectTool } from '../../src/tools/dep-inspect-tool';
import { LicenseCheckTool } from '../../src/tools/license-check-tool';
import { SbomGenerateTool } from '../../src/tools/sbom-generate-tool';
import { BundleAnalyzeTool } from '../../src/tools/bundle-analyze-tool';

describe('Tools Verification', () => {
  let tmpDir: string;
  let homeDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    originalEnv = { ...process.env };

    // Create safe home directory
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-home-'));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEBUDDY_HOME = path.join(homeDir, '.codebuddy');
    await fs.mkdir(process.env.CODEBUDDY_HOME, { recursive: true });

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-test-'));

    // Initialize git repo to ensure codebase_map restricts itself to the fixture
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.name "Test User"', { cwd: tmpDir });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });

    // Create synthetic project
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'synthetic-project',
      version: '1.0.0',
      dependencies: {
        'foo-lib': '^1.0.0',
        'bar-lib': '^2.0.0'
      },
      scripts: {
        'build': 'echo "building"'
      }
    }, null, 2));

    const nodeModulesDir = path.join(tmpDir, 'node_modules');
    await fs.mkdir(nodeModulesDir);

    await fs.mkdir(path.join(nodeModulesDir, 'foo-lib'));
    await fs.writeFile(path.join(nodeModulesDir, 'foo-lib', 'package.json'), JSON.stringify({
      name: 'foo-lib',
      version: '1.0.1',
      license: 'MIT'
    }));

    await fs.mkdir(path.join(nodeModulesDir, 'bar-lib'));
    await fs.writeFile(path.join(nodeModulesDir, 'bar-lib', 'package.json'), JSON.stringify({
      name: 'bar-lib',
      version: '2.0.2',
      license: 'GPL-3.0' // A non-permissive license for testing
    }));

    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir);
    await fs.writeFile(path.join(srcDir, 'index.ts'), `
      // TODO: fix this later
      export const a = 1;
      // FIXME: broken
      export const b = 2;
    `);

    const distDir = path.join(tmpDir, 'dist');
    await fs.mkdir(distDir);
    await fs.writeFile(path.join(distDir, 'bundle.js'), 'console.log("hello world");');

    // Create a larger dummy file to make bundle analyze interesting
    const largeBuffer = Buffer.alloc(1024 * 1024, 'a'); // 1MB file
    await fs.writeFile(path.join(distDir, 'vendor.js'), largeBuffer);

    execSync('git add .', { cwd: tmpDir });
    execSync('git commit -m "initial commit"', { cwd: tmpDir });
  });

  afterAll(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('verifies synthetic project exists', async () => {
    const pkgJson = await fs.stat(path.join(tmpDir, 'package.json'));
    expect(pkgJson.isFile()).toBe(true);
    const srcIndex = await fs.stat(path.join(tmpDir, 'src', 'index.ts'));
    expect(srcIndex.isFile()).toBe(true);
  });

  it('tests codebase_map', async () => {
    const tool = new CodebaseMapExecuteTool();
    const result = await tool.execute({ root: tmpDir, operation: 'build' });
    console.log('[codebase_map output]', result);
    expect(result.success).toBe(true);
    expect(result.output).toContain(`root ${tmpDir}`);
    expect(result.output).toMatch(/Codebase map built: 2 files,/);
    expect(result.output).not.toMatch(/5000 files/);
  });

  it('tests codebase_map respects root and does not cap at 5000', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-map-root-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-map-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'decoy.ts'), 'export const decoy = 1;\n');
      const src = path.join(root, 'src');
      await fs.mkdir(src);
      const fileCount = 5001;
      const chunk = 250;
      for (let start = 0; start < fileCount; start += chunk) {
        const writes: Array<Promise<void>> = [];
        const end = Math.min(fileCount, start + chunk);
        for (let i = start; i < end; i += 1) {
          writes.push(fs.writeFile(path.join(src, `f${i}.ts`), 'export const n = 1;\n'));
        }
        await Promise.all(writes);
      }
      const tool = new CodebaseMapExecuteTool();
      const result = await tool.execute({ root, operation: 'build' });
      console.log('[codebase_map ceiling]', result.output);
      expect(result.success).toBe(true);
      expect(result.output).toContain(`root ${root}`);
      expect(result.output).not.toContain(outside);
      expect(result.output).toMatch(/Codebase map built: 5001 files,/);
      expect(result.output).not.toMatch(/5000 files/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  }, 60_000);

  it('tests project_map', async () => {
    const tool = new ProjectMapTool();
    const result = await tool.execute({ root: tmpDir });
    console.log('[project_map output]', result);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Mapped 2 files');
    expect(result.data).toMatchObject({ fileCount: 2, root: tmpDir });
  });

  it('tests code_stats', async () => {
    const tool = new CodeStatsTool();
    const result = await tool.execute({ root: tmpDir });
    console.log('[code_stats output]', result);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Counted 17 lines across 2 files');
    expect(result.data).toMatchObject({ fileCount: 2, totalLines: 17, root: tmpDir });
  });

  it('tests todo_scan', async () => {
    const tool = new TodoScanTool();
    const result = await tool.execute({ root: tmpDir, markers: ['TODO', 'FIXME'] });
    console.log('[todo_scan output]', result);
    expect(result.success).toBe(true);
    if ('data' in result) {
      expect((result.data as any).total).toBeGreaterThanOrEqual(2);
    }
  });

  it('tests dep_inspect', async () => {
    const tool = new DepInspectTool();
    const result = await tool.execute({ root: tmpDir });
    console.log('[dep_inspect output]', result);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Found 2 dependencies');
    expect(result.data).toMatchObject({
      dependencies: { 'foo-lib': '^1.0.0', 'bar-lib': '^2.0.0' },
    });
  });

  it('tests license_check', async () => {
    const tool = new LicenseCheckTool();
    const result = await tool.execute({ root: tmpDir });
    console.log('[license_check output]', result);
    // Should return success: false because of GPL-3.0
    expect(result.success).toBe(false);
    if ('data' in result) {
      expect((result.data as any).flagged.length).toBeGreaterThan(0);
    }
  });

  it('tests sbom_generate', async () => {
    const tool = new SbomGenerateTool();
    const result = await tool.execute({ root: tmpDir });
    console.log('[sbom_generate output]', result);
    expect(result.success).toBe(true);
    const data = result.data as {
      generatedAt: string;
      packages: Array<{ name: string; version: string; license: string }>;
    };
    expect(data.generatedAt).not.toBe('1970-01-01T00:00:00.000Z');
    expect(Math.abs(Date.now() - Date.parse(data.generatedAt))).toBeLessThan(60_000);
    expect(data.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'foo-lib', version: '1.0.1', license: 'MIT' }),
      expect.objectContaining({ name: 'bar-lib', version: '2.0.2', license: 'GPL-3.0' }),
    ]));
  });

  it('tests bundle_analyze', async () => {
    const tool = new BundleAnalyzeTool();
    const result = await tool.execute({ root: tmpDir, distDir: 'dist' });
    console.log('[bundle_analyze output]', result);
    expect(result.success).toBe(true);
    expect(result.output).toContain('1048603 bytes');
    expect(result.data).toMatchObject({ totalSize: 1048603 });
  });
});
