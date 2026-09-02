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
  template: 'react-ts' | 'react-tailwind' | 'express-api' | 'node-cli';
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

function cssRgbToken(block: string, name: string): [number, number, number] {
  const match = block.match(new RegExp(`${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!match?.[1] || !match[2] || !match[3]) throw new Error(`Missing CSS RGB token: ${name}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrastRatio(first: [number, number, number], second: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]) => {
    const [red, green, blue] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
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

  it('generates a styled react-tailwind project with centralized tokens and reusable components', async () => {
    await makeTmpDir();

    const result = await generateProject({
      template: 'react-tailwind',
      projectName: 'studio-ready-app',
      variables: { description: 'A polished product workspace' },
    });

    expect(result.success).toBe(true);
    expect(result.filesCreated).toEqual(expect.arrayContaining([
      'tailwind.config.ts',
      'postcss.config.cjs',
      'src/styles/tokens.css',
      'src/components/ui/Button.tsx',
      'src/components/ui/Card.tsx',
      'src/components/ui/Badge.tsx',
      'src/components/ThemeToggle.tsx',
    ]));

    const packageJson = await readPackageJson(result.projectPath) as {
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies).toMatchObject({
      tailwindcss: expect.any(String),
      postcss: expect.any(String),
      autoprefixer: expect.any(String),
    });

    const tokens = await fs.readFile(path.join(result.projectPath, 'src', 'styles', 'tokens.css'), 'utf8');
    expect(tokens).toContain(':root');
    expect(tokens).toContain('.dark');
    expect(tokens).toContain('--color-accent');
    expect(tokens).toContain('--font-display');
    expect(tokens).toContain('--text-display');
    expect(tokens).toContain('--space-section');
    const lightTokens = tokens.slice(tokens.indexOf(':root'), tokens.indexOf('.dark'));
    const darkTokens = tokens.slice(tokens.indexOf('.dark'));
    expect(contrastRatio(cssRgbToken(lightTokens, '--color-ink'), cssRgbToken(lightTokens, '--color-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssRgbToken(lightTokens, '--color-muted'), cssRgbToken(lightTokens, '--color-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssRgbToken(lightTokens, '--color-action-contrast'), cssRgbToken(lightTokens, '--color-action'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssRgbToken(darkTokens, '--color-ink'), cssRgbToken(darkTokens, '--color-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssRgbToken(darkTokens, '--color-muted'), cssRgbToken(darkTokens, '--color-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssRgbToken(darkTokens, '--color-action-contrast'), cssRgbToken(darkTokens, '--color-action'))).toBeGreaterThanOrEqual(4.5);

    const app = await fs.readFile(path.join(result.projectPath, 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('<ThemeToggle />');
    expect(app).toContain('<Button');
    expect(app).toContain('<Card');
    expect(tokens).not.toMatch(/\bInter\b/);
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

    const packageJson = await readPackageJson(result.projectPath) as {
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies).not.toHaveProperty('tailwindcss');
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
