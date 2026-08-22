import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveProjectContext,
  resolveJitContext,
  createContextRegistry,
  getAcceptedFileNames,
} from '../../src/context/project-context.js';
import { clearContextConfigCache, clearExcludesCache } from '../../src/context/instruction-excludes.js';

let root: string;
let home: string;

function write(rel: string, content: string) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  clearContextConfigCache();
  clearExcludesCache();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pctx-'));
  root = path.join(base, 'proj');
  home = path.join(base, 'home');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true }); // project-root marker
  fs.mkdirSync(home, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(root), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* ignore */
  }
});

describe('project-context — discovery & the root===cwd regression', () => {
  it('loads root AGENTS.md even when root === cwd (headline-defect regression)', () => {
    write('AGENTS.md', 'ROOT AGENTS');
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home });
    expect(r.text).toContain('ROOT AGENTS');
    expect(r.sources.map((s) => s.relPath)).toContain('AGENTS.md');
  });

  it('descends into .codebuddy/ and .claude/ subdirs (backward compat)', () => {
    write('.codebuddy/CONTEXT.md', 'CODEBUDDY CONTEXT');
    write('.claude/CLAUDE.md', 'CLAUDE SUBDIR');
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home });
    expect(r.text).toContain('CODEBUDDY CONTEXT');
    expect(r.text).toContain('CLAUDE SUBDIR');
  });

  it('exposes the configured accepted filenames', () => {
    expect(getAcceptedFileNames(root)).toEqual([
      'AGENTS.md',
      'CODEBUDDY.md',
      'CLAUDE.md',
      'GEMINI.md',
      'CONTEXT.md',
      'INSTRUCTIONS.md',
    ]);
  });
});

describe('project-context — precedence & composition', () => {
  it('composes multiple accepted names in config order within a dir', () => {
    write('AGENTS.md', 'AAA');
    write('CODEBUDDY.md', 'CCC');
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home });
    expect(r.text.indexOf('AAA')).toBeLessThan(r.text.indexOf('CCC')); // AGENTS before CODEBUDDY
  });

  it('orders root before cwd so the closest file wins (appears last)', () => {
    write('AGENTS.md', 'ROOTLEVEL');
    write('pkg/AGENTS.md', 'SUBLEVEL');
    const cwd = path.join(root, 'pkg');
    const r = resolveProjectContext({ cwd, projectRoot: root, homeDir: home });
    expect(r.text.indexOf('ROOTLEVEL')).toBeLessThan(r.text.indexOf('SUBLEVEL'));
  });

  it('global tier appears before (lower precedence than) the project hierarchy', () => {
    fs.mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
    fs.writeFileSync(path.join(home, '.codebuddy', 'AGENTS.md'), 'GLOBALCFG');
    write('AGENTS.md', 'PROJECTCFG');
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home });
    expect(r.text.indexOf('GLOBALCFG')).toBeLessThan(r.text.indexOf('PROJECTCFG'));
    expect(r.sources.find((s) => s.tier === 'global')).toBeTruthy();
  });

  it('a .override.md replaces the base file', () => {
    write('AGENTS.md', 'BASEDOC');
    write('AGENTS.override.md', 'OVERRIDEDOC');
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home });
    expect(r.text).toContain('OVERRIDEDOC');
    expect(r.text).not.toContain('BASEDOC');
    expect(r.sources.find((s) => s.relPath.includes('AGENTS'))?.variant).toBe('override');
  });

  it('a .local.md wins over .override.md and base', () => {
    write('AGENTS.md', 'BASEDOC');
    write('AGENTS.override.md', 'OVERRIDEDOC');
    write('AGENTS.local.md', 'LOCALDOC');
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home });
    expect(r.text).toContain('LOCALDOC');
    expect(r.text).not.toContain('OVERRIDEDOC');
    expect(r.text).not.toContain('BASEDOC');
  });
});

describe('project-context — dedup & registry', () => {
  it('collapses a CLAUDE.md symlinked to AGENTS.md to a single source (realpath)', () => {
    write('AGENTS.md', 'ONLY ONCE');
    try {
      fs.symlinkSync(path.join(root, 'AGENTS.md'), path.join(root, 'CLAUDE.md'));
    } catch {
      return; // symlinks unsupported on this FS — skip
    }
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home });
    const occurrences = r.text.split('ONLY ONCE').length - 1;
    expect(occurrences).toBe(1);
  });

  it('shares a registry across startup then JIT so startup files are not reloaded', () => {
    write('AGENTS.md', 'ROOTDOC');
    write('pkg/sub/file.ts', '// code');
    const registry = createContextRegistry();
    const startup = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home, registry });
    expect(startup.text).toContain('ROOTDOC');
    const jit = resolveJitContext(path.join(root, 'pkg', 'sub', 'file.ts'), {
      projectRoot: root,
      homeDir: home,
      registry,
    });
    expect(jit.text).not.toContain('ROOTDOC'); // already injected at startup
  });

  it('JIT picks up a subtree file not seen at startup', () => {
    write('pkg/AGENTS.md', 'SUBTREE DOC');
    const registry = createContextRegistry();
    // startup ran from root (cwd=root), so pkg/AGENTS.md was not loaded
    resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home, registry });
    const jit = resolveJitContext(path.join(root, 'pkg', 'thing.ts'), {
      projectRoot: root,
      homeDir: home,
      registry,
    });
    expect(jit.text).toContain('SUBTREE DOC');
  });
});

describe('project-context — excludes & budget', () => {
  it('honors codebuddyMdExcludes globs', () => {
    write('.codebuddy/settings.json', JSON.stringify({ codebuddyMdExcludes: ['pkg/**'] }));
    write('AGENTS.md', 'KEEPME');
    write('pkg/AGENTS.md', 'EXCLUDEME');
    const cwd = path.join(root, 'pkg');
    const r = resolveProjectContext({ cwd, projectRoot: root, homeDir: home });
    expect(r.text).toContain('KEEPME');
    expect(r.text).not.toContain('EXCLUDEME');
  });

  it('truncates deterministically when over budget and sets the flag', () => {
    write('AGENTS.md', 'X'.repeat(500));
    const r = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home, budgetBytes: 100 });
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('... (truncated)');
    expect(r.bytes).toBeLessThanOrEqual(100 + '... (truncated)'.length + 4);
  });

  it('produces byte-identical output across two runs (cache stability)', () => {
    write('AGENTS.md', 'STABLE');
    write('CODEBUDDY.md', 'ALSO');
    const a = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home }).text;
    const b = resolveProjectContext({ cwd: root, projectRoot: root, homeDir: home }).text;
    expect(a).toBe(b);
  });
});
