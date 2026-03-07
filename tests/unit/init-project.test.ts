
// Mock dynamic imports used inside initCodeBuddyProject

import fs from 'fs';
import path from 'path';
import os from 'os';
import { initCodeBuddyProject, formatInitResult, generateCODEBUDDYMdContent } from '../../src/utils/init-project.js';

jest.mock('../../src/agent/repo-profiler.js', () => ({
  RepoProfiler: jest.fn().mockImplementation(function() { return {
    getProfile: jest.fn().mockResolvedValue({
      languages: ['typescript'],
      framework: 'express',
      commands: { test: 'npm test', lint: 'npm run lint', build: 'npm run build' },
      directories: { src: 'src/', tests: 'tests/' },
      contextPack: 'TypeScript | express',
    }),
  }; }),
}));

jest.mock('../../src/context/context-files.js', () => ({
  initContextFile: jest.fn().mockImplementation(async (dir: string) => {
    const p = path.join(dir, '.codebuddy', 'CONTEXT.md');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, '# Project Context\n');
    }
    return p;
  }),
}));


function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-init-test-'));
}

describe('generateCODEBUDDYMdContent', () => {
  it('returns generic template for null profile', () => {
    const content = generateCODEBUDDYMdContent(null);
    expect(content).toContain('Custom Instructions for Code Buddy');
    expect(content).toContain('npm test');
    expect(content).toContain('npm run build');
  });

  it('returns TypeScript-specific content for ts profile', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['typescript'],
      framework: 'express',
      commands: { test: 'bun test', lint: 'eslint .', build: 'tsc' },
      directories: { src: 'src/', tests: 'tests/' },
    });
    expect(content).toContain('TypeScript');
    expect(content).toContain('bun test');
    expect(content).toContain('eslint .');
    expect(content).toContain('tsc');
    expect(content).toContain('express');
  });

  it('returns Python-specific content for python profile', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['python'],
      commands: { test: 'pytest', lint: 'ruff check .' },
    });
    expect(content).toContain('PEP 8');
    expect(content).toContain('pytest');
    expect(content).toContain('ruff check .');
  });

  it('returns Go-specific content for go profile', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['go'],
      commands: { test: 'go test ./...' },
    });
    expect(content).toContain('gofmt');
    expect(content).toContain('go test ./...');
  });

  it('returns Rust-specific content for rust profile', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['rust'],
      commands: { test: 'cargo test' },
    });
    expect(content).toContain('cargo fmt');
    expect(content).toContain('cargo test');
  });
});

describe('initCodeBuddyProject', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fresh init creates all expected files and directories', async () => {
    const result = await initCodeBuddyProject(tmpDir);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    const codebuddyDir = path.join(tmpDir, '.codebuddy');
    expect(fs.existsSync(codebuddyDir)).toBe(true);

    // Runtime directories
    expect(fs.existsSync(path.join(codebuddyDir, 'sessions'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'runs'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'tool-results'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'knowledge'))).toBe(true);

    // Key files
    expect(fs.existsSync(path.join(codebuddyDir, 'CONTEXT.md'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'CODEBUDDY.md'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'hooks.json'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'security.json'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'knowledge', 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'commands', 'example.md'))).toBe(true);
    expect(fs.existsSync(path.join(codebuddyDir, 'commands', 'deploy.md'))).toBe(true);

    // CONTEXT.md listed in created
    expect(result.created).toContain('.codebuddy/CONTEXT.md');
  });

  it('CONTEXT.md is listed before CODEBUDDY.md in created array', async () => {
    const result = await initCodeBuddyProject(tmpDir);
    const contextIdx = result.created.indexOf('.codebuddy/CONTEXT.md');
    const codebuddyIdx = result.created.indexOf('.codebuddy/CODEBUDDY.md');
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(codebuddyIdx).toBeGreaterThanOrEqual(0);
    expect(contextIdx).toBeLessThan(codebuddyIdx);
  });

  it('settings.json uses grok-code-fast-1 as default model', async () => {
    await initCodeBuddyProject(tmpDir);
    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.codebuddy', 'settings.json'), 'utf-8')
    );
    expect(settings.model).toBe('grok-code-fast-1');
  });

  it('.gitignore includes runs/, tool-results/, cache/ entries', async () => {
    await initCodeBuddyProject(tmpDir);
    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.codebuddy/runs/');
    expect(gitignore).toContain('.codebuddy/tool-results/');
    expect(gitignore).toContain('.codebuddy/cache/');
    expect(gitignore).toContain('.codebuddy/sessions/');
  });

  it('idempotence: re-run without force puts files in skipped', async () => {
    await initCodeBuddyProject(tmpDir);
    const second = await initCodeBuddyProject(tmpDir);

    expect(second.skipped).toContain('.codebuddy/CONTEXT.md (already exists)');
    expect(second.skipped).toContain('.codebuddy/CODEBUDDY.md (already exists)');
    expect(second.skipped).toContain('.codebuddy/settings.json (already exists)');
    expect(second.skipped).toContain('.gitignore (already has Code Buddy entries)');
  });

  it('force:true overwrites existing files', async () => {
    await initCodeBuddyProject(tmpDir);

    // Mutate CODEBUDDY.md
    const mdPath = path.join(tmpDir, '.codebuddy', 'CODEBUDDY.md');
    fs.writeFileSync(mdPath, 'MUTATED');

    await initCodeBuddyProject(tmpDir, { force: true });
    const content = fs.readFileSync(mdPath, 'utf-8');
    expect(content).not.toBe('MUTATED');
    expect(content).toContain('Custom Instructions for Code Buddy');
  });

  it('merges into existing .gitignore without duplicating Code Buddy section', async () => {
    const gitignorePath = path.join(tmpDir, '.gitignore');
    fs.writeFileSync(gitignorePath, 'node_modules/\n');

    await initCodeBuddyProject(tmpDir);
    const content = fs.readFileSync(gitignorePath, 'utf-8');

    // Should have exactly one "# Code Buddy" marker
    const occurrences = (content.match(/# Code Buddy/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe('formatInitResult', () => {
  it('uses ASCII markers instead of emojis', () => {
    const result = {
      success: true,
      created: ['file.md'],
      skipped: ['other.json (already exists)'],
      errors: ['bad.txt'],
    };
    const output = formatInitResult(result);

    // No emoji characters
    expect(output).not.toMatch(/[\u{1F000}-\u{1FFFF}]/u);

    // ASCII markers present
    expect(output).toContain('[+]');
    expect(output).toContain('[=]');
    expect(output).toContain('[!]');
  });

  it('includes actionable next steps mentioning CONTEXT.md', () => {
    const result = { success: true, created: [], skipped: [], errors: [] };
    const output = formatInitResult(result);
    expect(output).toContain('CONTEXT.md');
    expect(output).toContain('buddy doctor');
    expect(output).toContain('knowledge/');
  });
});
