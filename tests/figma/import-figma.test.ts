import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFigmaCommand } from '../../src/commands/figma.js';
import { extractIr } from '../../src/figma/extract-ir.js';
import { importFigma } from '../../src/figma/import-figma.js';
import { loadFigmaSource } from '../../src/figma/load-source.js';
import { parseFigmaFile } from '../../src/figma/parse-document.js';
import { FigmaImportError } from '../../src/figma/types.js';
import { FigmaImportTool } from '../../src/tools/figma-import-tool.js';
import { compileTsx, loadGeneratedComponent, loadGeneratedModule, renderReactToHtml } from './render-generated.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixture(name: string): string {
  return path.join(fixturesDir, name);
}

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(fixture(name), 'utf8')) as unknown;
}

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('figma import — parse and IR', () => {
  it('extracts a simple screen with text, rectangle and image placeholder', async () => {
    const ir = extractIr(parseFigmaFile(await readJson('simple-screen.json')), {
      kind: 'local-json',
      name: 'Simple Login',
    });
    expect(ir.screens).toHaveLength(1);
    const screen = ir.screens[0];
    expect(screen?.name).toBe('Login');
    expect(screen?.root.layout.mode).toBe('vertical');
    const kinds = collectKinds(screen!.root);
    expect(kinds).toContain('text');
    expect(kinds).toContain('rectangle');
    expect(kinds).toContain('image');
    expect(ir.skips).toEqual([]);
  });

  it('extracts repeated components as a reusable React component plus instances', async () => {
    const ir = extractIr(parseFigmaFile(await readJson('repeated-components.json')), {
      kind: 'local-json',
      name: 'Cards',
    });
    expect(ir.components.some((component) => component.name === 'Card')).toBe(true);
    const card = ir.components.find((component) => component.name === 'Card');
    expect(card?.instanceCount).toBe(2);
    const home = ir.screens.find((screen) => screen.name === 'Home');
    expect(home).toBeTruthy();
    const instances = collectKind(home!.root, 'instance');
    expect(instances).toHaveLength(2);
    expect(instances[0]?.instanceProps?.title).toBe('First card');
  });

  it('stores child boxes relative to the parent, not the Figma canvas origin', async () => {
    const ir = extractIr(parseFigmaFile(await readJson('nested-absolute.json')), {
      kind: 'local-json',
      name: 'Offset canvas',
    });
    const screen = ir.screens.find((entry) => entry.name === 'Offset');
    expect(screen).toBeTruthy();
    expect(screen!.root.box).toMatchObject({ x: 500, y: 300, width: 375, height: 400 });
    const panel = screen!.root.children.find((child) => child.name === 'Panel');
    expect(panel?.box).toMatchObject({ x: 20, y: 40, width: 200, height: 80 });
    const label = panel?.children.find((child) => child.name === 'Label');
    expect(label?.box).toMatchObject({ x: 10, y: 10, width: 120, height: 20 });
    const pill = screen!.root.children.find((child) => child.name === 'Pill');
    expect(pill?.box).toMatchObject({ x: 20, y: 200, width: 120, height: 32 });
    expect(pill?.cornerRadius).toBe(9999);
  });

  it('keeps nested component instances on the parent component IR', async () => {
    const ir = extractIr(parseFigmaFile(await readJson('nested-components.json')), {
      kind: 'local-json',
      name: 'Nested components',
    });
    const banner = ir.components.find((component) => component.name === 'Banner');
    const button = ir.components.find((component) => component.name === 'Button');
    expect(banner && button).toBeTruthy();
    const nested = collectKind(banner!.root, 'instance');
    expect(nested).toHaveLength(1);
    expect(nested[0]?.componentId).toBe(button!.id);
    expect(nested[0]?.instanceProps?.label).toBe('Open');
  });

  it('lists unhandled vectors, boolean ops, ellipses and effects instead of faking them', async () => {
    const ir = extractIr(parseFigmaFile(await readJson('unhandled.json')), {
      kind: 'local-json',
      name: 'Unhandled mix',
    });
    expect(ir.screens).toHaveLength(1);
    expect(ir.screens[0]?.name).toBe('Dashboard');
    const types = ir.skips.map((skip) => skip.type).sort();
    expect(types).toContain('VECTOR');
    expect(types).toContain('BOOLEAN_OPERATION');
    expect(types).toContain('ELLIPSE');
    expect(ir.skips.some((skip) => skip.reason.includes('effects'))).toBe(true);
    const kinds = collectKinds(ir.screens[0]!.root);
    expect(kinds).toContain('text');
    expect(kinds).not.toContain('skipped');
  });

  it('rejects an invalid file that is not a Figma REST export', async () => {
    const invalid = await readJson('invalid.json');
    expect(() => parseFigmaFile(invalid)).toThrow(FigmaImportError);
    await expect(importFigma({ jsonPath: fixture('invalid.json'), dryRun: true })).rejects.toThrow(
      /Missing document|not a Figma/,
    );
  });
});

describe('figma import — generate, compile, render', () => {
  it('writes React + design-system utilities and the generated screen compiles and renders', async () => {
    const outDir = await tempDir('cb-figma-simple-');
    const result = await importFigma({
      jsonPath: fixture('simple-screen.json'),
      outDir,
      designSystemId: 'figma',
    });
    expect(result.written.some((file) => file.endsWith('Login.tsx'))).toBe(true);
    expect(result.written).toContain('src/figma-utilities.css');
    expect(result.written).toContain('src/design-system.css');

    const css = await readFile(path.join(outDir, 'src', 'figma-utilities.css'), 'utf8');
    expect(css).toContain('--bg');
    expect(css).toContain('--space-4');
    expect(css).toContain('figma-frame-col');

    const screenPath = result.files.find((file) => file.relativePath.endsWith('Login.tsx'));
    expect(screenPath).toBeTruthy();
    compileTsx(screenPath!.content, 'Login.tsx');
    const Screen = loadGeneratedComponent(screenPath!.content, 'Login');
    const html = renderReactToHtml(Screen());
    expect(html).toContain('Sign in');
    expect(html).toContain('figma-screen');
    expect(html).toContain('data-figma-image-ref="img_simple_photo"');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('generates a shared Card component used twice, which compiles and renders both titles', async () => {
    const result = await importFigma({ jsonPath: fixture('repeated-components.json'), dryRun: true });
    const cardFile = result.files.find((file) => file.relativePath.endsWith('Card.tsx'));
    const homeFile = result.files.find((file) => file.relativePath.endsWith('Home.tsx'));
    expect(cardFile && homeFile).toBeTruthy();
    compileTsx(cardFile!.content, 'Card.tsx');
    compileTsx(homeFile!.content, 'Home.tsx');
    const cardModule = loadGeneratedModule(cardFile!.content);
    const Home = loadGeneratedComponent(homeFile!.content, 'Home', {
      '../components/Card.js': cardModule,
    });
    const html = renderReactToHtml(Home());
    expect(html).toContain('First card');
    expect(html).toContain('Second card');
    expect(homeFile!.content).toContain('<Card');
  });

  it('positions nested absolute frames relative to their parent and maps pill radius', async () => {
    const result = await importFigma({ jsonPath: fixture('nested-absolute.json'), dryRun: true });
    const screenFile = result.files.find((file) => file.relativePath.endsWith('Offset.tsx'));
    expect(screenFile).toBeTruthy();
    expect(screenFile!.content).toMatch(/figma-radius-pill"[^>]*data-figma-id="10:4"/);
    expect(screenFile!.content).toMatch(/figma-radius-sm"[^>]*data-figma-id="10:5"/);
    expect(screenFile!.content).not.toMatch(/figma-radius-sm"[^>]*data-figma-id="10:4"/);
    expect(screenFile!.content).toMatch(/left:\s*20/);
    expect(screenFile!.content).toMatch(/top:\s*40/);
    expect(screenFile!.content).not.toMatch(/left:\s*520/);
    expect(screenFile!.content).not.toMatch(/top:\s*340/);
    compileTsx(screenFile!.content, 'Offset.tsx');
    const Screen = loadGeneratedComponent(screenFile!.content, 'Offset');
    const html = renderReactToHtml(Screen());
    expect(html).toContain('Nested label');
    expect(html).toContain('figma-radius-pill');
    expect(html).toContain('figma-radius-sm');
    expect(html).toMatch(/left:20/);
    expect(html).toMatch(/top:40/);
    expect(html).not.toMatch(/left:520/);
    expect(html).not.toMatch(/top:340/);
  });

  it('emits nested component imports instead of flattening inner instances', async () => {
    const result = await importFigma({ jsonPath: fixture('nested-components.json'), dryRun: true });
    const buttonFile = result.files.find((file) => file.relativePath.endsWith('Button.tsx'));
    const bannerFile = result.files.find((file) => file.relativePath.endsWith('Banner.tsx'));
    const galleryFile = result.files.find((file) => file.relativePath.endsWith('Gallery.tsx'));
    expect(buttonFile && bannerFile && galleryFile).toBeTruthy();
    expect(bannerFile!.content).toContain("import { Button } from './Button.js'");
    expect(bannerFile!.content).toContain('<Button');
    expect(galleryFile!.content).toContain('<Banner');
    compileTsx(buttonFile!.content, 'Button.tsx');
    compileTsx(bannerFile!.content, 'Banner.tsx');
    compileTsx(galleryFile!.content, 'Gallery.tsx');
    const buttonModule = loadGeneratedModule(buttonFile!.content);
    const bannerModule = loadGeneratedModule(bannerFile!.content, {
      './Button.js': buttonModule,
    });
    const Gallery = loadGeneratedComponent(galleryFile!.content, 'Gallery', {
      '../components/Banner.js': bannerModule,
    });
    const html = renderReactToHtml(Gallery());
    expect(html).toContain('Welcome');
    expect(html).toContain('Open');
  });

  it('keeps unhandled nodes out of generated JSX and in the report', async () => {
    const result = await importFigma({ jsonPath: fixture('unhandled.json'), dryRun: true });
    const dashboard = result.files.find((file) => file.relativePath.endsWith('Dashboard.tsx'));
    expect(dashboard).toBeTruthy();
    expect(dashboard!.content).toContain('Dashboard');
    expect(dashboard!.content).not.toContain('Blob');
    expect(dashboard!.content).not.toContain('BOOLEAN');
    expect(result.reportMarkdown).toContain('VECTOR');
    expect(result.reportMarkdown).toContain('BOOLEAN_OPERATION');
    const Screen = loadGeneratedComponent(dashboard!.content, 'Dashboard');
    const html = renderReactToHtml(Screen());
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('Blob');
  });
});

describe('figma import — no network', () => {
  it('does not call fetch for a local JSON export', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network should not be used');
    });
    const loaded = await loadFigmaSource({ jsonPath: fixture('simple-screen.json') }, { fetch: fetchFn });
    expect(loaded.kind).toBe('local-json');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses the injected fetch for a file key and never touches the network stack otherwise', async () => {
    const payload = await readFile(fixture('simple-screen.json'), 'utf8');
    const fetchFn = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe('https://api.figma.com/v1/files/AbCdEfGh1234');
      expect(init?.headers?.['X-Figma-Token']).toBe('test-token-not-a-secret');
      return { ok: true, status: 200, text: async () => payload };
    });
    const result = await importFigma(
      { fileKey: 'AbCdEfGh1234', token: 'test-token-not-a-secret', dryRun: true },
      { fetch: fetchFn },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.ir.screens[0]?.name).toBe('Login');
    expect(JSON.stringify(result.files.map((file) => file.content))).not.toContain('test-token-not-a-secret');
  });

  it('refuses a file key without a token and does not fetch', async () => {
    const fetchFn = vi.fn();
    const previous = { FIGMA_TOKEN: process.env.FIGMA_TOKEN, CODEBUDDY_FIGMA_TOKEN: process.env.CODEBUDDY_FIGMA_TOKEN };
    delete process.env.FIGMA_TOKEN;
    delete process.env.CODEBUDDY_FIGMA_TOKEN;
    try {
      await expect(loadFigmaSource({ fileKey: 'AbCdEfGh1234' }, { fetch: fetchFn })).rejects.toThrow(/token/);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      if (previous.FIGMA_TOKEN !== undefined) process.env.FIGMA_TOKEN = previous.FIGMA_TOKEN;
      if (previous.CODEBUDDY_FIGMA_TOKEN !== undefined) process.env.CODEBUDDY_FIGMA_TOKEN = previous.CODEBUDDY_FIGMA_TOKEN;
    }
  });
});

describe('figma CLI and tool', () => {
  it('buddy figma import --json --dry-run prints screens without writing', async () => {
    const lines: string[] = [];
    const command = createFigmaCommand({
      cwd: fixturesDir,
      stdout: (message) => lines.push(message),
    });
    command.exitOverride();
    await command.parseAsync(['node', 'figma', 'import', '--json', fixture('simple-screen.json'), '--dry-run'], {
      from: 'node',
    });
    const output = lines.join('\n');
    expect(output).toContain('Login');
    expect(output).toContain('Dry run');
  });

  it('figma_import tool writes into an empty directory from a local fixture', async () => {
    const outDir = await tempDir('cb-figma-tool-');
    const tool = new FigmaImportTool();
    const result = await tool.execute({ jsonPath: fixture('simple-screen.json'), outDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Login');
    const report = await readFile(path.join(outDir, 'IMPORT-REPORT.md'), 'utf8');
    expect(report).toContain('Login');
  });
});

function collectKinds(node: { kind: string; children: Array<{ kind: string; children: never[] }> }): string[] {
  return [node.kind, ...node.children.flatMap((child) => collectKinds(child))];
}

function collectKind<T extends { kind: string; children: T[] }>(node: T, kind: string): T[] {
  const mine = node.kind === kind ? [node] : [];
  return [...mine, ...node.children.flatMap((child) => collectKind(child, kind))];
}

