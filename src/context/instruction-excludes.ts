/**
 * Instruction File Excludes (CC10)
 *
 * Loads exclude patterns from .codebuddy/settings.json "codebuddyMdExcludes"
 * to skip loading CODEBUDDY.md files in monorepo subdirectories.
 *
 * Advanced enterprise architecture for claudeMdExcludes setting.
 */

import * as fs from 'fs';
import * as path from 'path';
import { matchGlob } from '../utils/glob-utils.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Cache
// ============================================================================

let _excludePatterns: string[] | null = null;
let _excludeCachePath: string | null = null;

let _contextConfig: ResolvedContextConfig | null = null;
let _contextConfigCachePath: string | null = null;

/**
 * Clear the excludes cache (for testing / config reload).
 */
export function clearExcludesCache(): void {
  _excludePatterns = null;
  _excludeCachePath = null;
}

/**
 * Clear the context-config cache (for testing / `/context reload`).
 */
export function clearContextConfigCache(): void {
  _contextConfig = null;
  _contextConfigCachePath = null;
}

// ============================================================================
// Context-file configuration (single source of truth for accepted filenames)
// ============================================================================

/**
 * Accepted project-instruction filenames, in precedence order. `AGENTS.md` is
 * the cross-CLI primary (read by Codex/Cursor/Copilot/Claude Code); the rest
 * are read for interop. All present names compose within a directory.
 */
export const DEFAULT_CONTEXT_FILE_NAMES: readonly string[] = [
  'AGENTS.md',
  'CODEBUDDY.md',
  'CLAUDE.md',
  'GEMINI.md',
  'CONTEXT.md',
  'INSTRUCTIONS.md',
];

/**
 * Filenames the prompt builder injects at startup unless
 * `CODEBUDDY_INCLUDE_INTEROP_CONTEXT=true`. Keep this the single list:
 * JIT still uses `DEFAULT_CONTEXT_FILE_NAMES` / config `context.fileNames`.
 */
export const STARTUP_PROJECT_CONTEXT_FILES: readonly string[] = ['AGENTS.md', 'CODEBUDDY.md'];

export interface ResolvedContextConfig {
  /** Accepted instruction filenames, in precedence order. */
  fileNames: string[];
  /** Total byte budget for the startup hierarchy (Codex project_doc_max_bytes parity). */
  maxBytes: number;
  /** Per-touch incremental byte budget for JIT discovery. */
  jitMaxBytes: number;
  /** Byte budget passed to the @import resolver. */
  importMaxBytes: number;
  /** Max recursion depth for @import. */
  importMaxDepth: number;
}

const DEFAULT_CONTEXT_CONFIG: ResolvedContextConfig = {
  fileNames: [...DEFAULT_CONTEXT_FILE_NAMES],
  maxBytes: 32_768,
  jitMaxBytes: 4_096,
  importMaxBytes: 50_000,
  importMaxDepth: 5,
};

/**
 * Load the `context` block from `.codebuddy/settings.json`, merged over
 * defaults. Cached by settings path (cleared via `clearContextConfigCache()`).
 * A missing `context` key returns the defaults, so existing projects are
 * unaffected.
 */
export function loadContextConfig(projectRoot: string = process.cwd()): ResolvedContextConfig {
  const settingsPath = path.join(projectRoot, '.codebuddy', 'settings.json');

  if (_contextConfig && _contextConfigCachePath === settingsPath) {
    return _contextConfig;
  }

  const cfg: ResolvedContextConfig = { ...DEFAULT_CONTEXT_CONFIG, fileNames: [...DEFAULT_CONTEXT_FILE_NAMES] };

  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const ctx = JSON.parse(raw)?.context;
      if (ctx && typeof ctx === 'object') {
        if (Array.isArray(ctx.fileNames) && ctx.fileNames.every((n: unknown) => typeof n === 'string') && ctx.fileNames.length > 0) {
          cfg.fileNames = ctx.fileNames;
        }
        if (Number.isFinite(ctx.maxBytes) && ctx.maxBytes > 0) cfg.maxBytes = ctx.maxBytes;
        if (Number.isFinite(ctx.jitMaxBytes) && ctx.jitMaxBytes > 0) cfg.jitMaxBytes = ctx.jitMaxBytes;
        if (Number.isFinite(ctx.importMaxBytes) && ctx.importMaxBytes > 0) cfg.importMaxBytes = ctx.importMaxBytes;
        if (Number.isFinite(ctx.importMaxDepth) && ctx.importMaxDepth > 0) cfg.importMaxDepth = ctx.importMaxDepth;
      }
    } catch (err) {
      logger.debug(`Failed to load context config: ${err}`);
    }
  }

  _contextConfig = cfg;
  _contextConfigCachePath = settingsPath;
  return cfg;
}

// ============================================================================
// Loader
// ============================================================================

/**
 * Load exclude patterns from settings.json.
 * Returns an array of glob patterns (e.g., ["packages/legacy/**"]).
 */
export function loadExcludePatterns(projectRoot: string = process.cwd()): string[] {
  const settingsPath = path.join(projectRoot, '.codebuddy', 'settings.json');

  if (_excludePatterns && _excludeCachePath === settingsPath) {
    return _excludePatterns;
  }

  let patterns: string[] = [];

  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      if (Array.isArray(settings.codebuddyMdExcludes)) {
        patterns = settings.codebuddyMdExcludes;
        logger.debug(`Loaded ${patterns.length} instruction exclude patterns`);
      }
    } catch (err) {
      logger.debug(`Failed to load instruction excludes: ${err}`);
    }
  }

  _excludePatterns = patterns;
  _excludeCachePath = settingsPath;
  return patterns;
}

// ============================================================================
// Matcher
// ============================================================================

/**
 * Check if an instruction file should be excluded based on codebuddyMdExcludes.
 *
 * @param filePath - Absolute path to the instruction file (CODEBUDDY.md, CONTEXT.md, etc.)
 * @param projectRoot - Project root directory
 * @returns true if the file should be excluded (not loaded)
 */
export function shouldExcludeInstructionFile(
  filePath: string,
  projectRoot: string = process.cwd(),
): boolean {
  const patterns = loadExcludePatterns(projectRoot);
  if (patterns.length === 0) return false;

  // Get relative path from project root
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  return patterns.some(pattern => matchGlob(relativePath, pattern));
}
