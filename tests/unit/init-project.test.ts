
// Mock dynamic imports used inside initCodeBuddyProject

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  initCodeBuddyProject,
  formatInitResult,
  generateCODEBUDDYMdContent,
  generateContextMdContent,
  generateAgentsMdContent,
  buildInitPrompt,
} from '../../src/utils/init-project.js';

jest.mock('../../src/agent/repo-profiler.js', () => ({
  RepoProfiler: jest.fn().mockImplementation(function() { return {
    getProfile: jest.fn().mockResolvedValue({
      languages: ['TypeScript', 'JavaScript'],
      framework: 'Express',
      packageManager: 'npm',
      commands: { test: 'npm test', lint: 'npm run lint', build: 'npm run build', typecheck: 'npm run typecheck' },
      directories: { src: 'src', tests: 'tests', docs: 'docs' },
      conventions: { naming: 'camelCase (JS/TS)', lintRules: ['eslint'] },
      contextPack: 'TypeScript | Express',
      name: 'test-project',
      description: 'A test project for unit testing',
      moduleType: 'esm',
      testFramework: 'Vitest',
      entryPoints: ['dist/index.js'],
      hasDocker: true,
      hasCi: true,
      hasClaudeMd: true,
      databases: ['SQLite'],
      topDependencies: ['express', 'zod', 'chalk'],
      license: 'MIT',
    }),
    refresh: jest.fn().mockResolvedValue({
      languages: ['TypeScript', 'JavaScript'],
      framework: 'Express',
      packageManager: 'npm',
      commands: { test: 'npm test', lint: 'npm run lint', build: 'npm run build', typecheck: 'npm run typecheck' },
      directories: { src: 'src', tests: 'tests', docs: 'docs' },
      conventions: { naming: 'camelCase (JS/TS)', lintRules: ['eslint'] },
      contextPack: 'TypeScript | Express',
      name: 'test-project',
      description: 'A test project for unit testing',
      moduleType: 'esm',
      testFramework: 'Vitest',
      entryPoints: ['dist/index.js'],
      hasDocker: true,
      hasCi: true,
      hasClaudeMd: true,
      databases: ['SQLite'],
      topDependencies: ['express', 'zod', 'chalk'],
      license: 'MIT',
    }),
  }; }),
}));


function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-init-test-'));
}

// ============================================================================
// generateCODEBUDDYMdContent
// ============================================================================

describe('generateCODEBUDDYMdContent', () => {
  it('returns generic template for null profile', () => {
    const content = generateCODEBUDDYMdContent(null);
    expect(content).toContain('Custom Instructions for Code Buddy');
    expect(content).toContain('npm test');
    expect(content).toContain('npm run build');
  });

  it('returns TypeScript-specific content for ts profile', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['TypeScript'],
      framework: 'Express',
      commands: { test: 'bun test', lint: 'eslint .', build: 'tsc' },
      directories: { src: 'src', tests: 'tests' },
    });
    expect(content).toContain('TypeScript');
    expect(content).toContain('bun test');
    expect(content).toContain('eslint .');
    expect(content).toContain('tsc');
    expect(content).toContain('Express');
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

  it('fills About section with project description when available', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['TypeScript'],
      name: 'my-tool',
      description: 'A CLI tool for developers',
      framework: 'Ink (terminal UI)',
      packageManager: 'npm',
      testFramework: 'Vitest',
      moduleType: 'esm',
    });
    expect(content).toContain('A CLI tool for developers');
    expect(content).toContain('Ink (terminal UI)');
    expect(content).toContain('Vitest');
    expect(content).toContain('ESM');
    expect(content).not.toContain('This project is...');
  });

  it('references CLAUDE.md when hasClaudeMd is true', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['TypeScript'],
      hasClaudeMd: true,
    });
    expect(content).toContain('CLAUDE.md');
    expect(content).toContain('detailed instructions');
  });

  it('does not reference CLAUDE.md when hasClaudeMd is false', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['TypeScript'],
      hasClaudeMd: false,
    });
    expect(content).not.toContain('CLAUDE.md');
  });

  it('includes ESM note for ESM projects', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['TypeScript'],
      moduleType: 'esm',
    });
    expect(content).toContain('.js` extension');
  });

  it('includes typecheck and validate commands when available', () => {
    const content = generateCODEBUDDYMdContent({
      languages: ['TypeScript'],
      commands: { test: 'npm test', lint: 'npm run lint', build: 'npm run build', typecheck: 'npm run typecheck', validate: 'npm run validate' },
    });
    expect(content).toContain('npm run typecheck');
    expect(content).toContain('npm run validate');
  });
});

// ============================================================================
// generateAgentsMdContent
// ============================================================================

describe('generateAgentsMdContent', () => {
  it('returns a generic fallback when profile is null (no crash)', () => {
    const content = generateAgentsMdContent(null);
    // Header always present
    expect(content).toContain('— Agent Guide');
    expect(content).toContain('## Build & Test');
    expect(content).toContain('## Conventions');
    expect(content).toContain('## Architecture');
    expect(content).toContain('## More Context');
    // Generic build commands as fallback
    expect(content).toContain('npm test');
    expect(content).toContain('npm run build');
    // Cross-CLI banner
    expect(content).toContain('Read by Claude Code, Gemini CLI, Cursor, Codex, and Code Buddy');
  });

  it('renders rich content for a fully-populated profile', () => {
    const content = generateAgentsMdContent({
      name: 'demo-tool',
      description: 'A demo CLI tool.',
      languages: ['TypeScript', 'JavaScript'],
      framework: 'Express',
      moduleType: 'esm',
      testFramework: 'Vitest',
      packageManager: 'npm',
      commands: {
        test: 'npm test',
        lint: 'npm run lint',
        build: 'npm run build',
        typecheck: 'npm run typecheck',
        format: 'prettier --write .',
      },
      directories: { src: 'src', tests: 'tests', docs: 'docs' },
      entryPoints: ['dist/index.js'],
      hasClaudeMd: true,
    });

    expect(content).toContain('demo-tool — Agent Guide');
    expect(content).toContain('A demo CLI tool.');
    // Build & Test
    expect(content).toContain('npm test');
    expect(content).toContain('npm run typecheck');
    expect(content).toContain('prettier --write .');
    // Conventions
    expect(content).toContain('TypeScript, JavaScript');
    expect(content).toContain('Express');
    expect(content).toContain('ESM');
    expect(content).toContain('Vitest');
    // Architecture
    expect(content).toContain('`src/`');
    expect(content).toContain('`tests/`');
    expect(content).toContain('`docs/`');
    expect(content).toContain('dist/index.js');
    // CLAUDE.md pointer present when hasClaudeMd
    expect(content).toContain('`CLAUDE.md`');
    // Always-present pointers
    expect(content).toContain('.codebuddy/CONTEXT.md');
    expect(content).toContain('.codebuddy/CODEBUDDY.md');
  });

  it('omits the CLAUDE.md pointer when hasClaudeMd is false', () => {
    const content = generateAgentsMdContent({
      name: 'no-claude',
      languages: ['TypeScript'],
      hasClaudeMd: false,
    });
    // The conditional "deep-dive" pointer is omitted (CLAUDE.md still appears in
    // the accepted-filenames note, which is interop documentation, not a pointer).
    expect(content).not.toContain('Claude Code-specific deep-dive');
  });
});

// ============================================================================
// buildInitPrompt (agent-driven /init)
// ============================================================================

describe('buildInitPrompt', () => {
  it('targets a root AGENTS.md and embeds the verified-facts grounding', () => {
    const prompt = buildInitPrompt('Languages: TypeScript\nTest: npm test\nBuild: npm run build');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('VERIFIED FACTS');
    expect(prompt).toContain('npm test');           // grounded on real command
    expect(prompt).toContain('do NOT invent commands');
  });

  it('instructs improve-in-place (never blank-overwrite) and not to touch .codebuddy', () => {
    const prompt = buildInitPrompt('');
    expect(prompt).toContain('IMPROVE it in place');
    expect(prompt).toContain('never blank-overwrite');
    expect(prompt).toContain('Do NOT modify anything under `.codebuddy/`');
  });

  it('omits the VERIFIED FACTS block when no contextPack is available', () => {
    const prompt = buildInitPrompt('');
    expect(prompt).not.toContain('VERIFIED FACTS');
    expect(prompt).toContain('AGENTS.md'); // still a valid prompt
  });
});

// ============================================================================
// generateContextMdContent
// ============================================================================

describe('generateContextMdContent', () => {
  it('returns minimal template for null profile', () => {
    const content = generateContextMdContent(null);
    expect(content).toContain('Project Context');
    expect(content).toContain('<!-- Describe your project here -->');
  });

  it('generates rich content from profile', () => {
    const content = generateContextMdContent({
      languages: ['TypeScript', 'JavaScript'],
      framework: 'Ink (terminal UI)',
      packageManager: 'npm',
      commands: { test: 'npm test', lint: 'npm run lint', build: 'npm run build', typecheck: 'npm run typecheck', validate: 'npm run validate' },
      directories: { src: 'src', tests: 'tests', docs: 'docs' },
      name: 'code-buddy',
      description: 'Multi-provider AI coding agent for the terminal',
      moduleType: 'esm',
      testFramework: 'Vitest',
      entryPoints: ['dist/index.js'],
      nodeVersion: '>=18.0.0',
      hasDocker: true,
      hasCi: true,
      hasClaudeMd: true,
      databases: ['SQLite'],
      topDependencies: ['chalk', 'commander', 'express', 'ink'],
      license: 'MIT',
      conventions: { naming: 'camelCase (JS/TS)', lintRules: ['eslint'] },
    });

    // Project name in header
    expect(content).toContain('code-buddy');
    // Description
    expect(content).toContain('Multi-provider AI coding agent');
    // Metadata
    expect(content).toContain('TypeScript, JavaScript');
    expect(content).toContain('Ink (terminal UI)');
    expect(content).toContain('ESM');
    expect(content).toContain('npm');
    expect(content).toContain('Vitest');
    expect(content).toContain('>=18.0.0');
    expect(content).toContain('MIT');
    expect(content).toContain('Docker');
    expect(content).toContain('SQLite');
    // Dependencies
    expect(content).toContain('chalk');
    expect(content).toContain('commander');
    // Architecture
    expect(content).toContain('src/');
    expect(content).toContain('tests/');
    expect(content).toContain('docs/');
    expect(content).toContain('dist/index.js');
    // Commands use npm (not bun)
    expect(content).toContain('npm run build');
    expect(content).toContain('npm test');
    expect(content).toContain('npm run lint');
    // CLAUDE.md reference
    expect(content).toContain('CLAUDE.md');
  });

  it('uses package manager consistently in commands', () => {
    const content = generateContextMdContent({
      languages: ['TypeScript'],
      packageManager: 'pnpm',
      commands: { test: 'pnpm test', build: 'pnpm build', lint: 'pnpm lint' },
    });
    expect(content).toContain('pnpm test');
    expect(content).toContain('pnpm build');
    expect(content).not.toContain('bun');
  });

  it('renders Component Map section from cartography.components', () => {
    const content = generateContextMdContent({
      languages: ['TypeScript'],
      name: 'test-app',
      cartography: {
        fileStats: { byExtension: { '.ts': 100 }, locEstimate: { TypeScript: 5000 }, totalSourceFiles: 80, totalTestFiles: 20, largestFiles: [] },
        architecture: { layers: [{ name: 'Core', directory: 'src/core', fileCount: 30 }], style: 'modular', maxDepth: 3 },
        importGraph: { hotModules: [], circularRisks: [], orphanModules: [] },
        apiSurface: { restRoutes: [], wsEvents: [], endpointCount: 0 },
        patterns: { singletons: ['Foo'], registries: [], factories: [], facades: ['AppFacade'], middlewares: [], observers: [] },
        components: {
          agents: [{ name: 'PDFAgent', file: 'src/agents/pdf-agent.ts' }],
          tools: [{ name: 'BashTool', file: 'src/tools/bash.ts' }, { name: 'GitTool', file: 'src/tools/git.ts' }],
          channels: [{ name: 'SlackChannel', file: 'src/channels/slack.ts' }],
          facades: [{ name: 'AppFacade', file: 'src/facades/app-facade.ts' }],
          middlewares: [
            { name: 'AuthMiddleware', file: 'src/middleware/auth.ts', priority: 10 },
            { name: 'LogMiddleware', file: 'src/middleware/log.ts', priority: 20 },
          ],
          keyExports: [{ module: 'core', exports: ['AppManager', 'Router', 'Config'] }],
        },
      },
    });

    // Component Map section header
    expect(content).toContain('## Component Map');
    // Facades
    expect(content).toContain('AppFacade');
    expect(content).toContain('src/facades/app-facade.ts');
    // Middleware with priorities
    expect(content).toContain('| 10 | AuthMiddleware');
    expect(content).toContain('| 20 | LogMiddleware');
    // Agents
    expect(content).toContain('PDFAgent');
    // Tools
    expect(content).toContain('BashTool');
    expect(content).toContain('GitTool');
    // Channels
    expect(content).toContain('SlackChannel');
    // Key exports
    expect(content).toContain('AppManager');
    expect(content).toContain('Router');
  });

  it('omits Component Map when components is undefined', () => {
    const content = generateContextMdContent({
      languages: ['TypeScript'],
      name: 'test-app',
      cartography: {
        fileStats: { byExtension: { '.ts': 10 }, locEstimate: { TypeScript: 500 }, totalSourceFiles: 10, totalTestFiles: 5, largestFiles: [] },
        architecture: { layers: [], style: 'flat', maxDepth: 1 },
        importGraph: { hotModules: [], circularRisks: [], orphanModules: [] },
        apiSurface: { restRoutes: [], wsEvents: [], endpointCount: 0 },
        patterns: { singletons: [], registries: [], factories: [], facades: [], middlewares: [], observers: [] },
      },
    });
    expect(content).not.toContain('## Component Map');
  });
});

// ============================================================================
// initCodeBuddyProject
// ============================================================================

describe('initCodeBuddyProject', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

  it('creates AGENTS.md at PROJECT ROOT (not in .codebuddy/) and lists it in created', async () => {
    const result = await initCodeBuddyProject(tmpDir);

    const agentsRootPath = path.join(tmpDir, 'AGENTS.md');
    const agentsCodebuddyPath = path.join(tmpDir, '.codebuddy', 'AGENTS.md');

    // Lives at root, not in .codebuddy/
    expect(fs.existsSync(agentsRootPath)).toBe(true);
    expect(fs.existsSync(agentsCodebuddyPath)).toBe(false);
    expect(result.created).toContain('AGENTS.md');

    // Content sanity-check: profile-derived data flows through
    const content = fs.readFileSync(agentsRootPath, 'utf-8');
    expect(content).toContain('— Agent Guide');
    expect(content).toContain('npm test');
    // Mock profile sets hasClaudeMd: true → CLAUDE.md pointer present
    expect(content).toContain('`CLAUDE.md`');
  });

  it('AGENTS.md is skipped on re-run without force, overwritten with force:true', async () => {
    await initCodeBuddyProject(tmpDir);
    const agentsPath = path.join(tmpDir, 'AGENTS.md');

    // Mutate
    fs.writeFileSync(agentsPath, 'USER EDITED AGENTS.md\n');

    // Re-run without force: should skip
    const second = await initCodeBuddyProject(tmpDir);
    expect(second.skipped).toContain('AGENTS.md (already exists)');
    expect(fs.readFileSync(agentsPath, 'utf-8')).toBe('USER EDITED AGENTS.md\n');

    // Re-run with force: should overwrite
    const third = await initCodeBuddyProject(tmpDir, { force: true });
    expect(third.created).toContain('AGENTS.md');
    expect(fs.readFileSync(agentsPath, 'utf-8')).not.toBe('USER EDITED AGENTS.md\n');
    expect(fs.readFileSync(agentsPath, 'utf-8')).toContain('— Agent Guide');
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

  it('CONTEXT.md contains profile-aware content', async () => {
    await initCodeBuddyProject(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, '.codebuddy', 'CONTEXT.md'), 'utf-8');
    // Profile mock returns description "A test project for unit testing"
    expect(content).toContain('A test project for unit testing');
    expect(content).toContain('TypeScript');
    expect(content).toContain('Express');
  });

  it('hooks.json uses profile commands', async () => {
    await initCodeBuddyProject(tmpDir);
    const hooks = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.codebuddy', 'hooks.json'), 'utf-8')
    );
    const preCommit = hooks.hooks.find((h: { type: string }) => h.type === 'pre-commit');
    expect(preCommit.command).toContain('npm run lint');
    expect(preCommit.command).toContain('npm test');
    const postEdit = hooks.hooks.find((h: { type: string }) => h.type === 'post-edit');
    expect(postEdit.command).toContain('npm run typecheck');
  });

  it('CODEBUDDY.md references CLAUDE.md when detected', async () => {
    await initCodeBuddyProject(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, '.codebuddy', 'CODEBUDDY.md'), 'utf-8');
    expect(content).toContain('CLAUDE.md');
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
