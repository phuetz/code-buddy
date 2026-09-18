/**
 * Project Context — the canonical hierarchical loader for project-instruction
 * files (the AGENTS.md / CLAUDE.md / GEMINI.md / CODEBUDDY.md hierarchy).
 *
 * Single source of truth that replaces the previously fragmented readers
 * (jit-context, bootstrap-loader's hierarchical walk, context-files). It owns:
 *   - the config-driven accepted-filename list (`loadContextConfig`),
 *   - the per-directory probe (incl. `.codebuddy/` + `.claude/` descent),
 *   - variant precedence (`<name>.local.md` > `<name>.override.md` > `<name>`),
 *   - `@import` resolution (code-fence-safe), token/byte budgeting,
 *   - realpath dedup shared across the startup pass and JIT (the `ContextRegistry`).
 *
 * Precedence (documented once, here):
 *   - Tiers: global (`~/.codebuddy/`) is appended FIRST (lowest precedence),
 *     then the project hierarchy from project-root DOWN to cwd. Files closer to
 *     cwd appear later in the text → win on conflict (Codex AGENTS.md model).
 *   - Within a directory, every accepted filename present is COMPOSED (so
 *     `CODEBUDDY.md` extends `AGENTS.md`), in the configured order.
 *   - Within a (directory, name), the first existing variant wins and REPLACES
 *     the base: `<name>.local.md` (gitignored) > `<name>.override.md` > `<name>`.
 *   - Dedup key is `fs.realpathSync` so a `CLAUDE.md`/`GEMINI.md` symlinked to
 *     `AGENTS.md` collapses to one injection.
 *
 * Determinism: iteration is over the fixed `dirs × probeDirs × names` product
 * with relative origin headers and no mtimes — the rendered text is byte-stable
 * across runs, which keeps prompt caching intact.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { resolveImportDirectives } from './import-directive-parser.js';
import {
  loadContextConfig,
  shouldExcludeInstructionFile,
  STARTUP_PROJECT_CONTEXT_FILES,
  type ResolvedContextConfig,
} from './instruction-excludes.js';

export { STARTUP_PROJECT_CONTEXT_FILES };

// ============================================================================
// Constants
// ============================================================================

/** Project-root markers, walked upward from cwd. */
const ROOT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', '.hg'];
const MAX_HIERARCHY_DEPTH = 10;
/** Subdirectories probed inside every level of the hierarchy. */
const SUBDIR_PROBES = ['.codebuddy', '.claude'];
const TRUNCATION_MARKER = '\n\n... (truncated)';

// ============================================================================
// Types
// ============================================================================

export type ContextTier = 'global' | 'hierarchy' | 'jit';
export type ContextVariant = 'base' | 'override' | 'local';

export interface ContextSource {
  /** Absolute path of the loaded file. */
  path: string;
  /** `fs.realpathSync` of `path` — the dedup key. */
  realpath: string;
  /** Display path (relative to project root; `~/.codebuddy/...` for global). */
  relPath: string;
  tier: ContextTier;
  variant: ContextVariant;
  /** Size of this source's rendered body (chars). */
  bytes: number;
  /** Whether this source was truncated to fit the budget. */
  truncated: boolean;
}

export interface ResolvedContext {
  /** Merged, header-decorated text, ready to inject. */
  text: string;
  sources: ContextSource[];
  bytes: number;
  truncated: boolean;
}

export interface ResolveOptions {
  cwd?: string;
  /** Project root; resolved via ROOT_MARKERS when omitted. */
  projectRoot?: string;
  /** Shared dedup registry (startup ↔ JIT). A private one is used if omitted. */
  registry?: ContextRegistry;
  /** Byte budget override (defaults to config `maxBytes` / `jitMaxBytes`). */
  budgetBytes?: number;
  /** Accepted filenames override (defaults to config). */
  fileNames?: string[];
  /** Home-dir override (for testing). */
  homeDir?: string;
}

// ============================================================================
// Dedup registry (shared between the startup pass and JIT)
// ============================================================================

/** Tracks realpaths already injected so a file is never loaded twice. */
export class ContextRegistry {
  private readonly seen = new Set<string>();
  has(realpath: string): boolean {
    return this.seen.has(realpath);
  }
  add(realpath: string): void {
    this.seen.add(realpath);
  }
  clear(): void {
    this.seen.clear();
  }
  get size(): number {
    return this.seen.size;
  }
}

export function createContextRegistry(): ContextRegistry {
  return new ContextRegistry();
}

// Module-level "active" registry. The prompt builder publishes its per-build
// registry here (`setActiveContextRegistry`) so the standalone JIT pass — which
// has no handle to the PromptBuilder — can dedup against files already injected
// at startup. Defaults to a persistent registry until the first build.
let activeRegistry: ContextRegistry = new ContextRegistry();

export function setActiveContextRegistry(registry: ContextRegistry): void {
  activeRegistry = registry;
}

export function getActiveContextRegistry(): ContextRegistry {
  return activeRegistry;
}

// ============================================================================
// Public API
// ============================================================================

/** Project root via ROOT_MARKERS, walking up from `cwd` (null if none found). */
export function findProjectRoot(cwd: string, markers: string[] = ROOT_MARKERS): string | null {
  let dir = path.resolve(cwd);
  let depth = 0;
  while (depth < MAX_HIERARCHY_DEPTH) {
    for (const marker of markers) {
      try {
        if (fs.existsSync(path.join(dir, marker))) return dir;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    depth++;
  }
  return null;
}

/** Accepted instruction filenames for a project (config-driven). */
export function getAcceptedFileNames(projectRoot: string = process.cwd()): string[] {
  return loadContextConfig(projectRoot).fileNames;
}

/**
 * Startup pass: global tier + the project hierarchy from root DOWN to cwd.
 * Call once per prompt build. Populates `registry` (if given) so the later JIT
 * pass skips files already in the system prompt.
 */
export function resolveProjectContext(opts: ResolveOptions = {}): ResolvedContext {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const root = path.resolve(opts.projectRoot ?? findProjectRoot(cwd) ?? cwd);
  const cfg = loadContextConfig(root);
  const names = opts.fileNames ?? cfg.fileNames;
  const homeDir = opts.homeDir ?? os.homedir();
  const registry = opts.registry ?? new ContextRegistry();

  const loaded: LoadedSource[] = [];

  // Tier 1 — global (~/.codebuddy/), lowest precedence (appended first).
  const globalDir = path.join(homeDir, '.codebuddy');
  loaded.push(...collectDir(globalDir, 'global', names, root, registry, homeDir, cfg));

  // Tier 2 — hierarchy, project root → cwd inclusive (closest appended last).
  for (const dir of getDirectoryChain(root, cwd)) {
    for (const probe of [dir, ...SUBDIR_PROBES.map((s) => path.join(dir, s))]) {
      loaded.push(...collectDir(probe, 'hierarchy', names, root, registry, homeDir, cfg));
    }
  }

  return budgetMerge(loaded, opts.budgetBytes ?? cfg.maxBytes);
}

/**
 * JIT pass: when a tool touches `accessedPath`, load any context files along its
 * directory chain (root → accessed dir) that weren't already injected at
 * startup (skipped via the shared `registry`). Smaller per-touch budget.
 */
export function resolveJitContext(accessedPath: string, opts: ResolveOptions = {}): ResolvedContext {
  const accessedDir = path.dirname(path.resolve(accessedPath));
  const root = path.resolve(opts.projectRoot ?? findProjectRoot(accessedDir) ?? accessedDir);
  const cfg = loadContextConfig(root);
  const names = opts.fileNames ?? cfg.fileNames;
  const homeDir = opts.homeDir ?? os.homedir();
  const registry = opts.registry ?? new ContextRegistry();

  const loaded: LoadedSource[] = [];
  for (const dir of getDirectoryChain(root, accessedDir)) {
    for (const probe of [dir, ...SUBDIR_PROBES.map((s) => path.join(dir, s))]) {
      loaded.push(...collectDir(probe, 'jit', names, root, registry, homeDir, cfg));
    }
  }

  return budgetMerge(loaded, opts.budgetBytes ?? cfg.jitMaxBytes);
}

// ============================================================================
// Internals
// ============================================================================

interface LoadedSource {
  path: string;
  realpath: string;
  relPath: string;
  tier: ContextTier;
  variant: ContextVariant;
  body: string;
}

/** Directory chain from `root` to `target` (inclusive). */
function getDirectoryChain(root: string, target: string): string[] {
  const resolved = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const chain: string[] = [resolvedRoot];
  const rel = path.relative(resolvedRoot, resolved);
  if (!rel || rel.startsWith('..')) return chain;
  let current = resolvedRoot;
  for (const seg of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, seg);
    chain.push(current);
  }
  return chain;
}

/** Variant filenames for a base name, most-specific first. */
function variantNames(base: string): Array<{ name: string; variant: ContextVariant }> {
  const ext = path.extname(base); // '.md'
  const stem = ext ? base.slice(0, base.length - ext.length) : base;
  return [
    { name: `${stem}.local${ext}`, variant: 'local' },
    { name: `${stem}.override${ext}`, variant: 'override' },
    { name: base, variant: 'base' },
  ];
}

/**
 * Collect every accepted instruction file present in one directory (composed),
 * applying variant precedence, excludes, realpath dedup and @import resolution.
 */
function collectDir(
  probeDir: string,
  tier: ContextTier,
  names: string[],
  root: string,
  registry: ContextRegistry,
  homeDir: string,
  cfg: ResolvedContextConfig,
): LoadedSource[] {
  const out: LoadedSource[] = [];
  const isGlobal = tier === 'global';

  for (const base of names) {
    // First existing variant wins (local > override > base) and replaces it.
    let chosen: { filePath: string; variant: ContextVariant } | null = null;
    for (const v of variantNames(base)) {
      const filePath = path.join(probeDir, v.name);
      try {
        if (fs.statSync(filePath).isFile()) {
          chosen = { filePath, variant: v.variant };
          break;
        }
      } catch {
        /* not present */
      }
    }
    if (!chosen) continue;

    // Project files honor codebuddyMdExcludes; global files are never excluded.
    if (!isGlobal && shouldExcludeInstructionFile(chosen.filePath, root)) continue;

    let realpath: string;
    try {
      realpath = fs.realpathSync(chosen.filePath);
    } catch {
      realpath = chosen.filePath;
    }
    if (registry.has(realpath)) continue;

    let body: string;
    try {
      body = fs.readFileSync(chosen.filePath, 'utf-8');
    } catch {
      continue;
    }
    if (!body.trim()) continue;

    // User-authored, trusted files: warn (don't drop) on shell-exec-like
    // patterns — dropping would break legitimate AGENTS.md that documents them.
    if (containsDangerousPatterns(body)) {
      logger.warn(
        `Context file ${chosen.filePath} contains shell-exec-like patterns; loading anyway (user-authored).`,
      );
    }

    body = resolveImportDirectives(body, {
      baseDir: probeDir,
      projectRoot: root,
      homeDir,
      maxDepth: cfg.importMaxDepth,
      maxBytes: cfg.importMaxBytes,
    });

    registry.add(realpath);
    out.push({
      path: chosen.filePath,
      realpath,
      relPath: displayPath(chosen.filePath, root, homeDir, isGlobal),
      tier,
      variant: chosen.variant,
      body,
    });
  }

  return out;
}

/** Deterministic, abs-path-free display path for the origin header. */
function displayPath(filePath: string, root: string, homeDir: string, isGlobal: boolean): string {
  if (isGlobal) {
    const rel = path.relative(path.join(homeDir, '.codebuddy'), filePath).replace(/\\/g, '/');
    return `~/.codebuddy/${rel}`;
  }
  return path.relative(root, filePath).replace(/\\/g, '/') || path.basename(filePath);
}

/** Merge loaded sources under a budget, truncating the overflowing source. */
function budgetMerge(sources: LoadedSource[], budget: number): ResolvedContext {
  let total = 0;
  let truncated = false;
  const parts: string[] = [];
  const outSources: ContextSource[] = [];

  for (const s of sources) {
    if (total >= budget) {
      truncated = true;
      break;
    }
    let body = s.body;
    let sourceTruncated = false;
    const remaining = budget - total;
    if (body.length > remaining) {
      body = body.slice(0, remaining) + TRUNCATION_MARKER;
      sourceTruncated = true;
      truncated = true;
    }

    parts.push(`<!-- context: ${s.relPath} (${s.tier}) -->\n${body}`);
    total += body.length;
    outSources.push({
      path: s.path,
      realpath: s.realpath,
      relPath: s.relPath,
      tier: s.tier,
      variant: s.variant,
      bytes: body.length,
      truncated: sourceTruncated,
    });
  }

  return { text: parts.join('\n\n'), sources: outSources, bytes: total, truncated };
}

/** Shell-exec-like patterns — used to WARN (not drop) on user-authored files. */
function containsDangerousPatterns(content: string): boolean {
  return [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
    /\bexec(?:Sync)?\s*\(/,
    /\bspawn(?:Sync)?\s*\(/,
    /<script\b/i,
  ].some((p) => p.test(content));
}
