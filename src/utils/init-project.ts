import fs from 'fs';
import path from 'path';
import type { RepoProfile } from '../agent/repo-profiler.js';
import type { CartographyResult, ComponentInventory } from '../agent/repo-profiling/cartography.js';

export interface InitOptions {
  force?: boolean;
  includeHooks?: boolean;
  includeMcp?: boolean;
  includeCommands?: boolean;
  includeSecurity?: boolean;
  includeGitignore?: boolean;
}

export interface InitResult {
  success: boolean;
  created: string[];
  skipped: string[];
  errors: string[];
}

// ============================================================================
// Profile input type (subset of RepoProfile, backward-compat with tests)
// ============================================================================

type ProfileInput = {
  languages?: string[];
  framework?: string;
  commands?: { test?: string; lint?: string; build?: string; format?: string; typecheck?: string; validate?: string };
  directories?: { src?: string; tests?: string; docs?: string };
  name?: string;
  description?: string;
  moduleType?: 'esm' | 'cjs';
  testFramework?: string;
  packageManager?: string;
  entryPoints?: string[];
  nodeVersion?: string;
  hasDocker?: boolean;
  hasCi?: boolean;
  hasClaudeMd?: boolean;
  databases?: string[];
  topDependencies?: string[];
  license?: string;
  conventions?: { naming?: string; lintRules?: string[] };
  cartography?: CartographyResult;
} | null;

// ============================================================================
// CONTEXT.md generator (rich, profile-aware)
// ============================================================================

/**
 * Generate rich CONTEXT.md content from a RepoProfile.
 * Exported for unit testing.
 */
export function generateContextMdContent(profile: ProfileInput, cwd?: string): string {
  if (!profile) {
    return `# Project Context

This file is automatically loaded by Code Buddy to provide project context.

## Getting Started

This project appears to be empty. Use the \`/starter\` command to browse
available framework starter packs (React, Django, Rust, Go, etc.).

## Project Overview

<!-- Describe your project here -->

## Architecture

<!-- Key architectural decisions -->

## Conventions

<!-- Coding conventions and patterns -->

## Important Files

<!-- Key files and their purposes -->

## Common Tasks

<!-- How to build, test, deploy -->
`;
  }

  const pm = profile.packageManager ?? 'npm';
  const run = pm === 'npm' ? 'npm run' : pm;
  const sections: string[] = [];

  // Header
  const projectName = profile.name ?? path.basename(cwd || process.cwd());
  sections.push(`# ${projectName} — Project Context

This file is automatically loaded by Code Buddy to provide project context.`);

  // Project Overview
  const overviewLines: string[] = [];
  if (profile.description) {
    overviewLines.push(profile.description);
  }
  overviewLines.push('');
  if (profile.languages?.length) overviewLines.push(`- **Languages:** ${profile.languages.join(', ')}`);
  if (profile.framework) overviewLines.push(`- **Framework:** ${profile.framework}`);
  if (profile.moduleType) overviewLines.push(`- **Module system:** ${profile.moduleType.toUpperCase()}`);
  if (pm) overviewLines.push(`- **Package manager:** ${pm}`);
  if (profile.testFramework) overviewLines.push(`- **Test framework:** ${profile.testFramework}`);
  if (profile.nodeVersion) overviewLines.push(`- **Node.js:** ${profile.nodeVersion}`);
  if (profile.license) overviewLines.push(`- **License:** ${profile.license}`);
  if (profile.hasCi) overviewLines.push(`- **CI:** GitHub Actions`);
  if (profile.hasDocker) overviewLines.push(`- **Containerized:** Docker`);
  if (profile.databases?.length) overviewLines.push(`- **Databases:** ${profile.databases.join(', ')}`);
  sections.push(`## Project Overview\n\n${overviewLines.join('\n')}`);

  // Key Dependencies
  if (profile.topDependencies?.length) {
    const depList = profile.topDependencies.map((d) => `- \`${d}\``).join('\n');
    sections.push(`## Key Dependencies\n\n${depList}`);
  }

  // Architecture
  const archLines: string[] = [];
  archLines.push('| Directory | Role |');
  archLines.push('|-----------|------|');
  if (profile.directories?.src) archLines.push(`| \`${profile.directories.src}/\` | Source code |`);
  if (profile.directories?.tests) archLines.push(`| \`${profile.directories.tests}/\` | Tests |`);
  if (profile.directories?.docs) archLines.push(`| \`${profile.directories.docs}/\` | Documentation |`);
  if (archLines.length > 2) {
    const entryLine = profile.entryPoints?.length
      ? `\n\n**Entry points:** ${profile.entryPoints.map((e) => `\`${e}\``).join(', ')}`
      : '';
    sections.push(`## Architecture\n\n${archLines.join('\n')}${entryLine}`);
  }

  // Build & Development
  const cmdLines: string[] = [];
  cmdLines.push('```bash');
  if (profile.commands?.build) cmdLines.push(`${profile.commands.build}    # Build`);
  if (profile.commands?.test) cmdLines.push(`${profile.commands.test}     # Test`);
  if (profile.commands?.lint) cmdLines.push(`${profile.commands.lint}     # Lint`);
  if (profile.commands?.format) cmdLines.push(`${profile.commands.format}   # Format`);
  cmdLines.push('```');
  const extraScripts: string[] = [];
  if (profile.commands?.typecheck) extraScripts.push(`\`${profile.commands.typecheck}\``);
  if (profile.commands?.validate) extraScripts.push(`\`${profile.commands.validate}\``);
  const extraLine = extraScripts.length > 0
    ? `\n\n**Other scripts:** ${extraScripts.join(', ')}`
    : '';
  const validateNote = profile.commands?.validate
    ? `\n\n> **Pre-commit check:** Run \`${profile.commands.validate}\` before committing to catch lint/type/test errors early.`
    : '';
  sections.push(`## Build & Development\n\n${cmdLines.join('\n')}${extraLine}${validateNote}`);

  // Testing
  const testLines: string[] = [];
  if (profile.testFramework) testLines.push(`- **Framework:** ${profile.testFramework}`);
  if (profile.commands?.test) testLines.push(`- **Run:** \`${profile.commands.test}\``);
  if (profile.directories?.tests) testLines.push(`- **Location:** \`${profile.directories.tests}/\``);
  if (testLines.length > 0) {
    sections.push(`## Testing\n\n${testLines.join('\n')}`);
  }

  // Conventions
  const convLines: string[] = [];
  if (profile.conventions?.lintRules?.length) {
    convLines.push(`- **Linter:** ${profile.conventions.lintRules.join(', ')}`);
  }
  if (profile.conventions?.naming) convLines.push(`- **Naming:** ${profile.conventions.naming}`);
  if (profile.moduleType === 'esm') convLines.push(`- **Imports:** ESM (\`import\`/\`export\`), \`.js\` extensions required`);
  if (convLines.length > 0) {
    sections.push(`## Conventions\n\n${convLines.join('\n')}`);
  }

  // Cartography (deep scan results)
  if (profile.cartography) {
    const carto = profile.cartography;
    const cartoLines: string[] = [];

    // Scale
    const totalFiles = carto.fileStats.totalSourceFiles + carto.fileStats.totalTestFiles;
    const locEntries = Object.entries(carto.fileStats.locEstimate).sort((a, b) => b[1] - a[1]);
    const locSummary = locEntries.map(([lang, loc]) => `${lang} ~${formatNumber(loc)}`).join(', ');
    cartoLines.push(`**Scale:** ${formatNumber(carto.fileStats.totalSourceFiles)} source files, ${formatNumber(carto.fileStats.totalTestFiles)} test files (${formatNumber(totalFiles)} total)`);
    if (locSummary) cartoLines.push(`**Lines of code (est.):** ${locSummary}`);

    // Architecture
    if (carto.architecture.layers.length > 0) {
      cartoLines.push(`\n**Architecture style:** ${carto.architecture.style} (${carto.architecture.layers.length} modules, max depth ${carto.architecture.maxDepth})`);
      cartoLines.push('');
      cartoLines.push('| Module | Directory | Files |');
      cartoLines.push('|--------|-----------|-------|');
      for (const layer of carto.architecture.layers.slice(0, 20)) {
        cartoLines.push(`| ${layer.name} | \`${layer.directory}/\` | ${layer.fileCount} |`);
      }
    }

    // Hot modules
    if (carto.importGraph.hotModules.length > 0) {
      cartoLines.push('');
      cartoLines.push('**Most imported modules:**');
      for (const m of carto.importGraph.hotModules.slice(0, 10)) {
        cartoLines.push(`- \`${m.module}\` (imported by ${m.importedBy} files)`);
      }
    }

    // Design patterns
    const patternCounts: string[] = [];
    if (carto.patterns.singletons.length) patternCounts.push(`${carto.patterns.singletons.length} singletons`);
    if (carto.patterns.registries.length) patternCounts.push(`${carto.patterns.registries.length} registries`);
    if (carto.patterns.factories.length) patternCounts.push(`${carto.patterns.factories.length} factories`);
    if (carto.patterns.facades.length) patternCounts.push(`${carto.patterns.facades.length} facades`);
    if (carto.patterns.middlewares.length) patternCounts.push(`${carto.patterns.middlewares.length} middlewares`);
    if (carto.patterns.observers.length) patternCounts.push(`${carto.patterns.observers.length} event emitters`);
    if (patternCounts.length > 0) {
      cartoLines.push(`\n**Design patterns:** ${patternCounts.join(', ')}`);
    }

    // API surface
    if (carto.apiSurface.endpointCount > 0) {
      cartoLines.push(`\n**API surface:** ${carto.apiSurface.restRoutes.length} REST routes, ${carto.apiSurface.wsEvents.length} WebSocket events`);
    }

    // Circular risks
    if (carto.importGraph.circularRisks.length > 0) {
      cartoLines.push(`\n**Circular dependency risks (${carto.importGraph.circularRisks.length}):**`);
      for (const c of carto.importGraph.circularRisks.slice(0, 5)) {
        cartoLines.push(`- \`${c.a}\` <-> \`${c.b}\``);
      }
    }

    sections.push(`## Project Cartography\n\n${cartoLines.join('\n')}`);

    // V2: Component inventory (detailed architecture map)
    if (carto.components) {
      const compSections = renderComponentInventory(carto.components);
      if (compSections) {
        sections.push(compSections);
      }
    }

    // V2: Data flow section (how components connect)
    const dataFlow = renderDataFlow(carto, profile);
    if (dataFlow) {
      sections.push(dataFlow);
    }
  }

  // CLAUDE.md reference
  if (profile.hasClaudeMd) {
    sections.push(`## Existing Documentation\n\n- \`CLAUDE.md\` exists with detailed project instructions (loaded separately by the runtime)`);
  }

  // Editable section
  sections.push(`## Important Notes\n\n<!-- Add project-specific notes, gotchas, and patterns here -->`);

  return sections.join('\n\n') + '\n';
}

// ============================================================================
// CODEBUDDY.md generator (project-aware custom instructions)
// ============================================================================

/**
 * Generate CODEBUDDY.md content tailored to the detected language/framework.
 * Uses RepoProfile data to fill in real project details instead of placeholders.
 * Exported for unit testing.
 */
export function generateCODEBUDDYMdContent(profile: ProfileInput): string {
  const lang = profile?.languages?.[0]?.toLowerCase() ?? '';
  const framework = profile?.framework ?? '';
  const cmds = profile?.commands ?? {};
  const dirs = profile?.directories ?? {};

  const testCmd = cmds.test ?? 'npm test';
  const lintCmd = cmds.lint ?? 'npm run lint';
  const buildCmd = cmds.build ?? 'npm run build';
  const srcDir = dirs.src ?? 'src';
  const testsDir = dirs.tests ?? 'tests';

  // ── About section ──────────────────────────────────────
  const aboutLines: string[] = [];
  if (profile?.description) {
    aboutLines.push(profile.description);
  } else if (profile?.name) {
    aboutLines.push(`<!-- Describe ${profile.name} here -->`);
  } else {
    aboutLines.push('<!-- Describe your project here -->');
  }
  aboutLines.push('');
  if (profile?.languages?.length) aboutLines.push(`- **Languages:** ${profile.languages.join(', ')}`);
  if (framework) aboutLines.push(`- **Framework:** ${framework}`);
  if (profile?.moduleType) aboutLines.push(`- **Module system:** ${profile.moduleType.toUpperCase()}`);
  if (profile?.packageManager) aboutLines.push(`- **Package manager:** ${profile.packageManager}`);
  if (profile?.testFramework) aboutLines.push(`- **Test framework:** ${profile.testFramework}`);

  // ── Style section (language-specific) ──────────────────
  let styleSection: string;

  if (lang === 'python') {
    styleSection = `## Code Style Guidelines
- Follow PEP 8 conventions
- Use type annotations for all function signatures
- Format with black or ruff
- Add docstrings to public functions and classes`;
  } else if (lang === 'go') {
    styleSection = `## Code Style Guidelines
- Follow effective Go conventions
- Run \`gofmt\` / \`goimports\` before committing
- Prefer explicit error handling over panics
- Add godoc comments to exported identifiers`;
  } else if (lang === 'rust') {
    styleSection = `## Code Style Guidelines
- Run \`cargo fmt\` before committing
- Resolve all \`cargo clippy\` warnings
- Prefer \`Result\`/\`Option\` over panics in library code`;
  } else {
    const tsNote = lang === 'typescript' || lang === 'javascript'
      ? '- Use TypeScript for all new files\n- Avoid `any`; use proper types'
      : '- Follow the existing code style';
    const esmNote = profile?.moduleType === 'esm'
      ? '\n- ESM imports require `.js` extension even for `.ts` files'
      : '';
    styleSection = `## Code Style Guidelines
${tsNote}
- Follow the existing code style${esmNote}`;
  }

  // ── Architecture section ───────────────────────────────
  let archSection: string;
  if (lang === 'python') {
    archSection = `## Architecture
- \`${srcDir}/\` — Source code
- \`${testsDir}/\` — Test files (pytest)`;
  } else if (lang === 'go') {
    archSection = `## Architecture
- \`${srcDir}/\` — Source packages
- \`${testsDir}/\` — Test files (*_test.go)`;
  } else if (lang === 'rust') {
    archSection = `## Architecture
- \`src/\` — Source crates
- \`tests/\` — Integration tests`;
  } else {
    archSection = `## Architecture
- \`${srcDir}/\` — Source code
- \`${testsDir}/\` — Test files`;
  }
  if (dirs.docs) {
    archSection += `\n- \`${dirs.docs}/\` — Documentation`;
  }
  if (profile?.entryPoints?.length) {
    archSection += `\n\n**Entry point:** \`${profile.entryPoints[0]}\``;
  }

  // ── Test section ───────────────────────────────────────
  let testSection: string;
  if (lang === 'python') {
    testSection = `## Testing
- Write tests with pytest
- Run: \`${testCmd}\``;
  } else if (lang === 'go') {
    testSection = `## Testing
- Use \`go test ./...\`
- Run: \`${testCmd}\`
- Table-driven tests are preferred`;
  } else if (lang === 'rust') {
    testSection = `## Testing
- Unit tests in \`#[cfg(test)]\` modules
- Run: \`${testCmd}\`
- Integration tests in tests/`;
  } else {
    const fwNote = profile?.testFramework ? ` (${profile.testFramework})` : '';
    testSection = `## Testing
- Write tests for new features${fwNote}
- Run: \`${testCmd}\``;
  }

  // ── Commands section ───────────────────────────────────
  const cmdLines: string[] = [];
  cmdLines.push(`- Build: \`${buildCmd}\``);
  cmdLines.push(`- Lint: \`${lintCmd}\``);
  if (cmds.typecheck) cmdLines.push(`- Typecheck: \`${cmds.typecheck}\``);
  if (cmds.validate) cmdLines.push(`- Validate: \`${cmds.validate}\``);
  if (cmds.format) cmdLines.push(`- Format: \`${cmds.format}\``);

  // ── CLAUDE.md note ─────────────────────────────────────
  const claudeNote = profile?.hasClaudeMd
    ? `\n## Reference\n\n> This project has a \`CLAUDE.md\` with detailed instructions. Refer to it for architecture details, testing gotchas, and subsystem reference.\n`
    : '';

  return `# Custom Instructions for Code Buddy

## About This Project
${aboutLines.join('\n')}

${styleSection}

${archSection}

${testSection}

## Commands
${cmdLines.join('\n')}

## Git Conventions
- Use conventional commits (feat:, fix:, docs:, etc.)
- Keep commits small and focused
- Write descriptive commit messages
${claudeNote}
## Forbidden Actions
- Never commit .env files
- Never expose API keys
- Never delete production data
`;
}

// ============================================================================
// AGENTS.md generator (cross-CLI convention, lives at project root)
// ============================================================================

/**
 * Generate AGENTS.md content — the cross-CLI convention file read by
 * Claude Code, Gemini CLI 0.20+, Cursor, Codex, and Code Buddy itself
 * (see `src/context/jit-context.ts` and `bootstrap-loader.ts`).
 *
 * Intentionally minimal — this is the "first-glance" guide that any agent
 * should be able to consume in under 30 seconds. Detailed instructions
 * live in `.codebuddy/CODEBUDDY.md` and `.codebuddy/CONTEXT.md`, which
 * AGENTS.md points to for deeper reading.
 *
 * Exported for unit testing.
 */
export function generateAgentsMdContent(profile: ProfileInput): string {
  const cmds = profile?.commands ?? {};
  const dirs = profile?.directories ?? {};
  const buildCmd = cmds.build ?? 'npm run build';
  const testCmd = cmds.test ?? 'npm test';
  const lintCmd = cmds.lint ?? 'npm run lint';
  const typecheckCmd = cmds.typecheck;
  const formatCmd = cmds.format;

  const projectName = profile?.name ?? 'this project';
  const oneLiner = profile?.description
    ?? (profile?.framework && profile?.languages?.[0]
        ? `A ${profile.languages[0]} / ${profile.framework} project.`
        : '<!-- one-line project description -->');

  // Conventions block
  const conventionLines: string[] = [];
  if (profile?.languages?.length) {
    conventionLines.push(`- **Language(s):** ${profile.languages.join(', ')}`);
  }
  if (profile?.framework) {
    conventionLines.push(`- **Framework:** ${profile.framework}`);
  }
  if (profile?.moduleType) {
    conventionLines.push(`- **Module system:** ${profile.moduleType.toUpperCase()}${profile.moduleType === 'esm' ? ' (imports require `.js` extension even from `.ts` sources)' : ''}`);
  }
  if (profile?.testFramework) {
    conventionLines.push(`- **Test framework:** ${profile.testFramework}`);
  }
  if (profile?.packageManager) {
    conventionLines.push(`- **Package manager:** ${profile.packageManager}`);
  }
  if (profile?.conventions?.naming) {
    conventionLines.push(`- **Naming:** ${profile.conventions.naming}`);
  }
  if (conventionLines.length === 0) {
    conventionLines.push('<!-- Add language, framework, module system here -->');
  }

  // Build & Test block
  const buildLines: string[] = [
    `- **Build:** \`${buildCmd}\``,
    `- **Test:** \`${testCmd}\``,
    `- **Lint:** \`${lintCmd}\``,
  ];
  if (typecheckCmd) buildLines.push(`- **Typecheck:** \`${typecheckCmd}\``);
  if (formatCmd) buildLines.push(`- **Format:** \`${formatCmd}\``);

  // Architecture block — top-level dirs only
  const archLines: string[] = [];
  if (dirs.src) archLines.push(`- \`${dirs.src}/\` — source code`);
  if (dirs.tests) archLines.push(`- \`${dirs.tests}/\` — tests`);
  if (dirs.docs) archLines.push(`- \`${dirs.docs}/\` — documentation`);
  if (archLines.length === 0) {
    archLines.push('- `src/` — source code');
    archLines.push('- `tests/` — tests');
  }
  if (profile?.entryPoints?.length) {
    archLines.push('');
    archLines.push(`**Entry point:** \`${profile.entryPoints[0]}\``);
  }

  // More-context pointers — list deeper docs only if they're likely to exist
  const moreLines: string[] = [
    '- `.codebuddy/CONTEXT.md` — full project cartography (auto-generated)',
    '- `.codebuddy/CODEBUDDY.md` — Code Buddy custom instructions, style guide',
  ];
  if (profile?.hasClaudeMd) {
    moreLines.push('- `CLAUDE.md` — Claude Code-specific deep-dive (manually maintained)');
  }

  return `# ${projectName} — Agent Guide

${oneLiner}

> Cross-CLI convention file. Read by Claude Code, Gemini CLI, Cursor, Codex, and Code Buddy.
> Detailed instructions live in \`.codebuddy/\`; this file is the 30-second first-glance.

## Build & Test
${buildLines.join('\n')}

## Conventions
${conventionLines.join('\n')}

## Architecture
${archLines.join('\n')}

## Forbidden
- Never commit \`.env\` files or files containing secrets
- Never expose API keys in code, comments, or commit messages
- Never delete production data without explicit user confirmation

## More Context
${moreLines.join('\n')}

<sub>**How instruction files load:** Code Buddy reads from \`~/.codebuddy/\` (global), the
project root, and subdirectories — the file closest to what you're editing wins.
Accepted names compose in order: **AGENTS.md** (this file, primary), then \`CODEBUDDY.md\`,
\`CLAUDE.md\`, \`GEMINI.md\`, \`CONTEXT.md\`, \`INSTRUCTIONS.md\`. Drop \`@./path.md\` to import
another file. Override a file in the same directory with \`AGENTS.override.md\` (committed)
or \`AGENTS.local.md\` (gitignored).</sub>

---
*Auto-generated by \`buddy init\`. Re-run with \`--force\` to refresh, or edit by hand — \`buddy init\` won't overwrite without explicit force.*
`;
}

// ============================================================================
// Project initialization
// ============================================================================

/**
 * Initialize .codebuddy directory with templates and configurations.
 * Similar to Native Engine's project initialization.
 */
export async function initCodeBuddyProject(
  workingDirectory: string = process.cwd(),
  options: InitOptions = {}
): Promise<InitResult> {
  const result: InitResult = {
    success: true,
    created: [],
    skipped: [],
    errors: []
  };

  const codebuddyDir = path.join(workingDirectory, '.codebuddy');

  // Create .codebuddy directory
  if (!fs.existsSync(codebuddyDir)) {
    fs.mkdirSync(codebuddyDir, { recursive: true });
    result.created.push('.codebuddy/');
  }

  // Create runtime directories expected by the runtime
  const runtimeDirs = ['sessions', 'runs', 'tool-results', 'knowledge'];
  for (const dir of runtimeDirs) {
    const dirPath = path.join(codebuddyDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      result.created.push(`.codebuddy/${dir}/`);
    }
  }

  // Create .codebuddy/knowledge/README.md (explains frontmatter format)
  const knowledgeReadmePath = path.join(codebuddyDir, 'knowledge', 'README.md');
  if (!fs.existsSync(knowledgeReadmePath) || options.force) {
    const knowledgeReadmeContent = `# Knowledge Directory

Place \`.md\` files here to inject domain-specific knowledge into Code Buddy's context.

## Frontmatter fields

\`\`\`yaml
---
title: "Short descriptive title"
tags: ["tag1", "tag2"]
scope: "project"       # project | global
priority: 1            # lower = higher priority
---
\`\`\`

Files with lower \`priority\` values are injected first (higher precedence).
`;
    fs.writeFileSync(knowledgeReadmePath, knowledgeReadmeContent);
    result.created.push('.codebuddy/knowledge/README.md');
  }

  // Detect project profile for smart template generation
  let profile: RepoProfile | null = null;
  try {
    const { RepoProfiler } = await import('../agent/repo-profiler.js');
    profile = await new RepoProfiler(workingDirectory).refresh();
  } catch {
    // RepoProfiler unavailable — use generic template
  }

  // Create CONTEXT.md — priority 1 (highest priority context source)
  // Generated directly from profile for rich, project-aware content
  const contextMdPath = path.join(codebuddyDir, 'CONTEXT.md');
  if (!fs.existsSync(contextMdPath) || options.force) {
    const contextContent = generateContextMdContent(profile, workingDirectory);
    fs.writeFileSync(contextMdPath, contextContent);
    result.created.push('.codebuddy/CONTEXT.md');
  } else {
    result.skipped.push('.codebuddy/CONTEXT.md (already exists)');
  }

  // Create CODEBUDDY.md — priority 2 (project-aware custom instructions)
  const codebuddyMdPath = path.join(codebuddyDir, 'CODEBUDDY.md');
  if (!fs.existsSync(codebuddyMdPath) || options.force) {
    fs.writeFileSync(codebuddyMdPath, generateCODEBUDDYMdContent(profile));
    result.created.push('.codebuddy/CODEBUDDY.md');
  } else {
    result.skipped.push('.codebuddy/CODEBUDDY.md (already exists)');
  }

  // Create AGENTS.md at PROJECT ROOT — cross-CLI convention.
  // Read by Claude Code, Gemini CLI 0.20+, Cursor, Codex, and Code Buddy
  // itself (see jit-context.ts and bootstrap-loader.ts). Lives at the
  // root, NOT in `.codebuddy/`, because the convention dictates root.
  // This file is meant to be committed (the .gitignore generated below
  // only ignores `.codebuddy/`, not AGENTS.md).
  const agentsMdPath = path.join(workingDirectory, 'AGENTS.md');
  if (!fs.existsSync(agentsMdPath) || options.force) {
    fs.writeFileSync(agentsMdPath, generateAgentsMdContent(profile));
    result.created.push('AGENTS.md');
  } else {
    result.skipped.push('AGENTS.md (already exists)');
  }

  // Create hooks.json (uses profile commands when available)
  if (options.includeHooks !== false) {
    const hooksPath = path.join(codebuddyDir, 'hooks.json');
    if (!fs.existsSync(hooksPath) || options.force) {
      const lintCmd = profile?.commands?.lint ?? 'npm run lint';
      const testCmd = profile?.commands?.test ?? 'npm test';
      const typecheckCmd = profile?.commands?.typecheck ?? profile?.commands?.validate ?? 'npm run typecheck';
      const formatCmd = profile?.commands?.format ?? 'prettier --write {file}';
      const hooksContent = {
        enabled: true,
        globalTimeout: 30000,
        hooks: [
          {
            type: 'pre-commit',
            command: `${lintCmd} && ${testCmd}`,
            enabled: false,
            timeout: 60000,
            continueOnError: false,
            description: 'Run linter and tests before commit'
          },
          {
            type: 'post-edit',
            command: typecheckCmd,
            enabled: false,
            timeout: 30000,
            continueOnError: true,
            description: 'Run type checking after file edit'
          },
          {
            type: 'on-file-change',
            command: formatCmd.includes('{file}') ? formatCmd : `${formatCmd} {file}`,
            enabled: false,
            timeout: 10000,
            continueOnError: true,
            description: 'Format file on change'
          }
        ]
      };
      fs.writeFileSync(hooksPath, JSON.stringify(hooksContent, null, 2));
      result.created.push('.codebuddy/hooks.json');
    } else {
      result.skipped.push('.codebuddy/hooks.json (already exists)');
    }
  }

  // Create mcp.json
  if (options.includeMcp !== false) {
    const mcpPath = path.join(codebuddyDir, 'mcp.json');
    if (!fs.existsSync(mcpPath) || options.force) {
      const mcpContent = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        description: 'MCP server configuration. This file can be committed to share MCP servers with your team.',
        mcpServers: {
          'filesystem': {
            name: 'filesystem',
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@anthropic-ai/mcp-server-filesystem', '.'],
            enabled: false,
            description: 'File system access MCP server'
          },
          'github': {
            name: 'github',
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@anthropic-ai/mcp-github'],
            env: {
              GITHUB_TOKEN: '${GITHUB_TOKEN}'
            },
            enabled: false,
            description: 'GitHub integration MCP server'
          }
        }
      };
      fs.writeFileSync(mcpPath, JSON.stringify(mcpContent, null, 2));
      result.created.push('.codebuddy/mcp.json');
    } else {
      result.skipped.push('.codebuddy/mcp.json (already exists)');
    }
  }

  // Create security.json
  if (options.includeSecurity !== false) {
    const securityPath = path.join(codebuddyDir, 'security.json');
    if (!fs.existsSync(securityPath) || options.force) {
      const securityContent = {
        mode: 'suggest',
        allowedDirectories: [],
        blockedCommands: [],
        blockedPaths: []
      };
      fs.writeFileSync(securityPath, JSON.stringify(securityContent, null, 2));
      result.created.push('.codebuddy/security.json');
    } else {
      result.skipped.push('.codebuddy/security.json (already exists)');
    }
  }

  // Create commands directory with examples
  if (options.includeCommands !== false) {
    const commandsDir = path.join(codebuddyDir, 'commands');
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
      result.created.push('.codebuddy/commands/');
    }

    const exampleCommandPath = path.join(commandsDir, 'example.md');
    if (!fs.existsSync(exampleCommandPath) || options.force) {
      const exampleCommandContent = `---
description: Example custom command template
---

# Example Command

This is an example slash command. Usage: /example [argument]

Replace this content with your own prompt template.

You can use placeholders:
- $1, $2, etc. for positional arguments
- $@ for all arguments combined

Example: Analyze the file $1 and suggest improvements.
`;
      fs.writeFileSync(exampleCommandPath, exampleCommandContent);
      result.created.push('.codebuddy/commands/example.md');
    }

    const deployCommandPath = path.join(commandsDir, 'deploy.md');
    if (!fs.existsSync(deployCommandPath) || options.force) {
      const deployCommandContent = `---
description: Deploy the application to production
---

# Deploy Command

Perform a deployment to production:

1. Run all tests to ensure nothing is broken
2. Build the project for production
3. Check for any uncommitted changes
4. Create a git tag for the release
5. Push to the deployment branch

Environment: $1 (default: production)

Safety checks:
- Ensure all tests pass
- Ensure no uncommitted changes
- Confirm before proceeding
`;
      fs.writeFileSync(deployCommandPath, deployCommandContent);
      result.created.push('.codebuddy/commands/deploy.md');
    }
  }

  // Create settings.json (model aligned with SettingsManager default)
  const settingsPath = path.join(codebuddyDir, 'settings.json');
  if (!fs.existsSync(settingsPath) || options.force) {
    const settingsContent = {
      model: 'grok-code-fast-1',
      // 50 is the real non-YOLO runtime default; the scaffold previously wrote
      // 400 (the YOLO cap), which both misrepresented behavior and — if a future
      // path wires settings.json into the agent — would silently 8× the budget.
      maxToolRounds: 50,
      theme: 'default'
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settingsContent, null, 2));
    result.created.push('.codebuddy/settings.json');
  } else {
    result.skipped.push('.codebuddy/settings.json (already exists)');
  }

  // Update .gitignore
  if (options.includeGitignore !== false) {
    const gitignorePath = path.join(workingDirectory, '.gitignore');
    const codebuddyIgnoreEntries = `
# Code Buddy
.codebuddy/sessions/
.codebuddy/history/
.codebuddy/runs/
.codebuddy/tool-results/
.codebuddy/cache/
.codebuddy/user-settings.json
# Personal, uncommitted instruction overrides (AGENTS.local.md, CODEBUDDY.local.md, …)
*.local.md
`;

    if (fs.existsSync(gitignorePath)) {
      const currentContent = fs.readFileSync(gitignorePath, 'utf-8');
      if (!currentContent.includes('# Code Buddy') && !currentContent.includes('# Grok CLI')) {
        fs.appendFileSync(gitignorePath, codebuddyIgnoreEntries);
        result.created.push('.gitignore (updated with Code Buddy entries)');
      } else {
        result.skipped.push('.gitignore (already has Code Buddy entries)');
      }
    } else {
      fs.writeFileSync(gitignorePath, codebuddyIgnoreEntries.trim());
      result.created.push('.gitignore');
    }
  }

  // Create README for .codebuddy directory
  const readmePath = path.join(codebuddyDir, 'README.md');
  if (!fs.existsSync(readmePath) || options.force) {
    const readmeContent = `# .codebuddy Directory

This directory contains configuration and customization files for [Code Buddy](https://github.com/phuetz/code-buddy).

## Files

- **CONTEXT.md** - Primary context file (highest priority, loaded first by the runtime)
- **CODEBUDDY.md** - Custom instructions that Code Buddy follows when working in this project
- **settings.json** - Project-specific settings
- **hooks.json** - Automated hooks (pre-commit, post-edit, etc.)
- **mcp.json** - MCP server configurations (committable, shared with team)
- **security.json** - Security mode configuration
- **commands/** - Custom slash commands
- **knowledge/** - Domain knowledge files (frontmatter: title, tags, scope, priority)
- **sessions/** - Saved sessions (gitignored)
- **runs/** - Run observability logs (gitignored)
- **tool-results/** - Cached tool outputs (gitignored)

## Context Priority

The runtime loads context in this order (lower number = higher priority):
1. \`.codebuddy/CONTEXT.md\` — edit this first
2. \`CODEBUDDY.md\` (project root)
3. \`.codebuddy/context.md\`
4. \`CLAUDE.md\`

## Custom Commands

Create \`.md\` files in the \`commands/\` directory to add custom slash commands.

Example \`commands/my-command.md\`:
\`\`\`markdown
---
description: My custom command
---

# My Command

Your prompt template here. Use $1, $2 for arguments.
\`\`\`

Then use it with: \`/my-command arg1 arg2\`

## Hooks

Configure automated actions in \`hooks.json\`:
- \`pre-commit\` - Run before git commit
- \`post-edit\` - Run after file edit
- \`on-file-change\` - Run when files change

## MCP Servers

Configure MCP servers in \`mcp.json\` to extend Code Buddy's capabilities.
This file can be committed to share servers with your team.

## Security

Configure security modes in \`security.json\`:
- \`suggest\` - All changes require approval (safest)
- \`auto-edit\` - File edits auto-apply, bash requires approval
- \`full-auto\` - Fully autonomous but sandboxed

## More Information

See the [Code Buddy documentation](https://github.com/phuetz/code-buddy) for more details.
`;
    fs.writeFileSync(readmePath, readmeContent);
    result.created.push('.codebuddy/README.md');
  }

  return result;
}

/**
 * Format init result for display (ASCII markers, no emojis)
 */
export function formatInitResult(result: InitResult): string {
  let output = 'Code Buddy Project Initialization\n' + '='.repeat(50) + '\n\n';

  if (result.created.length > 0) {
    output += '[+] Created:\n';
    for (const item of result.created) {
      output += `    ${item}\n`;
    }
    output += '\n';
  }

  if (result.skipped.length > 0) {
    output += '[=] Skipped (already exists):\n';
    for (const item of result.skipped) {
      output += `    ${item}\n`;
    }
    output += '\n';
  }

  if (result.errors.length > 0) {
    output += '[!] Errors:\n';
    for (const item of result.errors) {
      output += `    ${item}\n`;
    }
    output += '\n';
  }

  output += '-'.repeat(50) + '\n';
  output += 'Next steps:\n';
  output += '  1. Edit .codebuddy/CONTEXT.md  -- primary context (loaded first by the runtime)\n';
  output += '  2. Edit .codebuddy/CODEBUDDY.md -- additional custom instructions\n';
  output += '  3. Run \'buddy doctor\' to verify your environment\n';
  output += '  4. Add files to .codebuddy/knowledge/ for domain-specific context\n';
  output += '  5. Use /starter to browse framework starter packs for new projects\n';

  return output;
}

/**
 * Build the prompt for the agent-driven `/init`. Instructs the model to analyze
 * the repository and write/improve a tailored root `AGENTS.md`, grounded on the
 * RepoProfiler's verified facts so it cannot hallucinate build/test commands.
 * Modeled on Codex's `prompt_for_init_command.md`.
 */
export function buildInitPrompt(contextPack: string): string {
  const facts = contextPack && contextPack.trim()
    ? `\nVERIFIED FACTS about this repository (auto-detected — use these, do not invent commands):\n${contextPack.trim()}\n`
    : '';

  return `Analyze THIS repository and write a tailored \`AGENTS.md\` at the project root — a concise contributor/agent guide (the cross-CLI standard read by Claude Code, Cursor, Codex, Gemini CLI and Code Buddy).
${facts}
How to do it:
1. Explore the real code first — use \`list_directory\`, \`view_file\`, \`search\` (and \`code_graph\` if available) to understand the actual structure, entry points, scripts and conventions. Read \`package.json\` / \`pyproject.toml\` / \`Cargo.toml\`, the README, and a few representative source files.
2. Trust any auto-detected facts shown above for build/test/lint commands, languages and directories — do NOT invent commands. Confirm anything else by reading the config files.
3. Write a clear, concise document (aim for 200–400 words, Markdown headings), adapting or omitting sections as appropriate:
   - **Project Structure & Module Organization** — where source, tests and assets live.
   - **Build, Test & Dev Commands** — the real commands, each briefly explained.
   - **Coding Style & Naming Conventions** — indentation, language style, naming, lint/format tools.
   - **Testing Guidelines** — framework, how to run, naming.
   - **Commit & Pull Request Guidelines** — infer conventions from the git history.
   - *(optional)* **Architecture Overview** — for non-obvious design.

Important:
- Write ONLY \`AGENTS.md\` at the project root. Do NOT modify anything under \`.codebuddy/\` — that config was just scaffolded deterministically.
- If \`AGENTS.md\` already has meaningful content, IMPROVE it in place: preserve the user's good wording, refine and fill gaps; never blank-overwrite.
- Keep it specific to THIS repository and actionable. No filler.`;
}

// ============================================================================
// Data flow renderer — shows how key components connect
// ============================================================================

function renderDataFlow(carto: CartographyResult, profile: ProfileInput): string | null {
  if (!profile) return null;

  const hasUI = carto.importGraph.hotModules.some(m =>
    /\b(ui|components|views|pages|app)\b/i.test(m.module)
  );
  const hasAgent = carto.components?.agents?.length || carto.importGraph.hotModules.some(m =>
    /\bagent\b/i.test(m.module)
  );
  const hasTools = (carto.components?.tools?.length ?? 0) > 0;
  const hasMiddleware = (carto.components?.middlewares?.length ?? 0) > 0;
  const hasChannels = (carto.components?.channels?.length ?? 0) > 0;
  const hasAPI = carto.apiSurface.endpointCount > 0;

  // Only render if there's enough structure to show a meaningful flow
  if (!hasAgent && !hasAPI && !hasMiddleware) return null;

  const lines: string[] = ['## Data Flow'];

  // Build ASCII flow diagram based on detected components
  if (hasUI || hasChannels || hasAPI) {
    const flowParts: string[] = [];

    // Entry points
    if (hasUI) flowParts.push('User Input');
    if (hasChannels) flowParts.push('Channel Message');
    if (hasAPI) flowParts.push('HTTP/WS Request');

    const entry = flowParts.length > 1
      ? `{ ${flowParts.join(' | ')} }`
      : flowParts[0] ?? 'Input';

    // Core processing
    const coreParts: string[] = [];
    if (hasMiddleware) coreParts.push('Middleware Pipeline');
    if (hasAgent) coreParts.push('Agent Loop');
    if (hasTools) coreParts.push('Tool Execution');

    const core = coreParts.join(' → ');

    lines.push('');
    lines.push('```');
    lines.push(`${entry} → ${core} → Response`);
    lines.push('```');
  }

  // Describe entry points with their files
  const entryFiles: string[] = [];
  const hotModules = carto.importGraph.hotModules;

  // Find CLI/entry point
  if (profile.entryPoints?.length) {
    for (const ep of profile.entryPoints) {
      entryFiles.push(`- **Entry:** \`${ep}\``);
    }
  }

  // Find agent core (most-imported agent module)
  const agentMod = hotModules.find(m => /\bagent\b/i.test(m.module));
  if (agentMod) {
    entryFiles.push(`- **Agent core:** \`${agentMod.module}\` (hub for ${agentMod.importedBy} modules)`);
  }

  // Find UI layer
  const uiMod = hotModules.find(m => /\b(ui|components|app)\b/i.test(m.module));
  if (uiMod) {
    entryFiles.push(`- **UI layer:** \`${uiMod.module}\` (used by ${uiMod.importedBy} modules)`);
  }

  // Find type system
  const typesMod = hotModules.find(m => /\btypes?\b/i.test(m.module) && !m.module.includes('registry'));
  if (typesMod) {
    entryFiles.push(`- **Type system:** \`${typesMod.module}\` (shared by ${typesMod.importedBy} modules)`);
  }

  if (entryFiles.length > 0) {
    lines.push('');
    lines.push('**Key connection points:**');
    lines.push(...entryFiles);
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

// ============================================================================
// Component inventory renderer (V2 cartography)
// ============================================================================

function renderComponentInventory(comp: ComponentInventory): string | null {
  const sections: string[] = [];

  // Facades (architecture backbone)
  if (comp.facades.length > 0) {
    const lines = ['**Facade architecture:**'];
    for (const f of comp.facades) {
      lines.push(`- \`${f.name}\` — \`${f.file}\``);
    }
    sections.push(lines.join('\n'));
  }

  // Middleware pipeline (with priorities)
  if (comp.middlewares.length > 0) {
    const lines = ['**Middleware pipeline:**', '', '| Priority | Middleware | File |', '|----------|-----------|------|'];
    for (const m of comp.middlewares) {
      const prio = m.priority != null ? String(m.priority) : '—';
      lines.push(`| ${prio} | ${m.name} | \`${m.file}\` |`);
    }
    sections.push(lines.join('\n'));
  }

  // Specialized agents
  if (comp.agents.length > 0) {
    const lines = [`**Specialized agents (${comp.agents.length}):**`];
    for (const a of comp.agents) {
      lines.push(`- \`${a.name}\` — \`${a.file}\``);
    }
    sections.push(lines.join('\n'));
  }

  // Tool classes — with file paths for navigation
  if (comp.tools.length > 0) {
    if (comp.tools.length <= 25) {
      const lines = [`**Tool classes (${comp.tools.length}):**`];
      for (const t of comp.tools) {
        lines.push(`- \`${t.name}\` — \`${t.file}\``);
      }
      sections.push(lines.join('\n'));
    } else {
      // Too many — show first 20 with files, rest as names only
      const lines = [`**Tool classes (${comp.tools.length}):**`];
      for (const t of comp.tools.slice(0, 20)) {
        lines.push(`- \`${t.name}\` — \`${t.file}\``);
      }
      lines.push(`- + ${comp.tools.length - 20} more in \`src/tools/\``);
      sections.push(lines.join('\n'));
    }
  }

  // Channels — with file paths for navigation
  if (comp.channels.length > 0) {
    const lines = [`**Channel adapters (${comp.channels.length}):**`];
    for (const ch of comp.channels) {
      lines.push(`- \`${ch.name}\` — \`${ch.file}\``);
    }
    sections.push(lines.join('\n'));
  }

  // Key exports per module (compact, top 12)
  if (comp.keyExports.length > 0) {
    const lines = ['**Key exports per module:**'];
    for (const mod of comp.keyExports.slice(0, 12)) {
      lines.push(`- **${mod.module}**: ${mod.exports.map((e) => `\`${e}\``).join(', ')}`);
    }
    sections.push(lines.join('\n'));
  }

  if (sections.length === 0) return null;
  return `## Component Map\n\n${sections.join('\n\n')}`;
}

/** Format a number with locale grouping (e.g., 1257 → "1,257") */
function formatNumber(n: number): string {
  if (n >= 1000) {
    return `${Math.round(n / 1000 * 10) / 10}K`.replace('.0K', 'K');
  }
  return String(n);
}
