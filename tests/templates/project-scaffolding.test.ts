import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { existsSync, mkdtempSync } from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getTemplateEngine, resetTemplateEngine } from '../../src/templates/project-scaffolding.js';

let tmpDir: string | undefined;

async function makeTmpDir(): Promise<string> {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'codebuddy-scaffold-'));
  return tmpDir;
}

async function generateProject(options: {
  template: 'react-ts' | 'express-api' | 'node-cli';
  projectName: string;
  variables?: Record<string, string | boolean>;
  designSystem?: string;
}) {
  const outputDir = tmpDir ?? await makeTmpDir();
  return getTemplateEngine().generate({
    template: options.template,
    projectName: options.projectName,
    outputDir,
    variables: options.variables ?? {},
    skipInstall: true,
    skipGit: true,
    designSystem: options.designSystem,
  });
}

async function readPackageJson(projectPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')) as Record<string, unknown>;
}

afterEach(async () => {
  resetTemplateEngine();
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    tmpDir = undefined;
  }
});

describe('TemplateEngine real scaffolding', () => {
  it('generates a react-ts project with key files and a valid package.json', async () => {
    await makeTmpDir();

    const result = await generateProject({
      template: 'react-ts',
      projectName: 'real-react-app',
      variables: { description: 'A real React scaffold' },
    });

    expect(result.success).toBe(true);
    expect(existsSync(result.projectPath)).toBe(true);
    expect(result.filesCreated).toContain('package.json');
    expect(result.filesCreated).toContain('src/main.tsx');
    expect(result.filesCreated).toContain('src/App.tsx');

    const packageJson = await readPackageJson(result.projectPath);
    expect(packageJson.name).toBe('real-react-app');
  });

  it('generates express-api and node-cli projects with their key files', async () => {
    await makeTmpDir();

    const apiResult = await generateProject({
      template: 'express-api',
      projectName: 'real-api',
      variables: { description: 'A real API', port: '4040' },
    });

    expect(apiResult.success).toBe(true);
    expect(apiResult.filesCreated).toContain('package.json');
    expect(apiResult.filesCreated).toContain('src/index.ts');
    expect(apiResult.filesCreated).toContain('src/routes/health.ts');
    expect(apiResult.filesCreated).toContain('src/middleware/error-handler.ts');
    expect(existsSync(path.join(apiResult.projectPath, 'src', 'routes', 'health.ts'))).toBe(true);

    const cliResult = await generateProject({
      template: 'node-cli',
      projectName: 'real-cli',
      variables: { binName: 'realcmd', description: 'A real CLI' },
    });

    expect(cliResult.success).toBe(true);
    expect(cliResult.filesCreated).toContain('package.json');
    expect(cliResult.filesCreated).toContain('src/index.ts');
    expect(cliResult.filesCreated).toContain('README.md');

    const packageJson = await readPackageJson(cliResult.projectPath);
    expect(packageJson.bin).toEqual({ realcmd: './dist/index.js' });
  });

  it('throws the documented error when node-cli is missing binName', async () => {
    await makeTmpDir();

    await expect(generateProject({
      template: 'node-cli',
      projectName: 'missing-bin-name',
    })).rejects.toThrow('Missing required variable: binName');
  });

  it('integrates a requested design system into react-ts output', async () => {
    await makeTmpDir();

    const branded = await generateProject({
      template: 'react-ts',
      projectName: 'spotify-react-app',
      variables: { description: 'A branded React scaffold' },
      designSystem: 'spotify',
    });

    expect(branded.success).toBe(true);
    expect(branded.filesCreated).toContain('src/design-system.css');
    expect(branded.filesCreated).toContain('DESIGN.md');
    expect(existsSync(path.join(branded.projectPath, 'src', 'design-system.css'))).toBe(true);
    expect(existsSync(path.join(branded.projectPath, 'DESIGN.md'))).toBe(true);

    const designCss = await fs.readFile(path.join(branded.projectPath, 'src', 'design-system.css'), 'utf8');
    expect(designCss).toContain('Design system: Spotify');
    expect(designCss).toContain('--accent:        #1ed760;');

    const entry = await fs.readFile(path.join(branded.projectPath, 'src', 'main.tsx'), 'utf8');
    expect(entry).toContain("import './index.css';\nimport './design-system.css';");
  });

  it('keeps react-ts output unchanged when no design system is requested', async () => {
    await makeTmpDir();

    const result = await generateProject({
      template: 'react-ts',
      projectName: 'plain-react-app',
      variables: { description: 'A plain React scaffold' },
    });

    expect(result.success).toBe(true);
    expect(result.filesCreated).not.toContain('src/design-system.css');
    expect(result.filesCreated).not.toContain('DESIGN.md');
    expect(existsSync(path.join(result.projectPath, 'src', 'design-system.css'))).toBe(false);
    expect(existsSync(path.join(result.projectPath, 'DESIGN.md'))).toBe(false);
  });

  it('does not create node_modules or .git when skipInstall and skipGit are true', async () => {
    await makeTmpDir();

    const result = await generateProject({
      template: 'react-ts',
      projectName: 'skip-hooks-app',
      variables: { description: 'Skip hooks scaffold' },
    });

    expect(result.success).toBe(true);
    expect(existsSync(path.join(result.projectPath, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(result.projectPath, '.git'))).toBe(false);
  });
});
