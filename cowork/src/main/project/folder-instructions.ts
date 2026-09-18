/**
 * Folder instructions — thin Cowork view over the kernel loader.
 *
 * Discovery, composition, variants, excludes, @import and budgets stay in
 * `src/context/project-context.ts`. This module only classifies origins,
 * applies the same startup filename filter as the prompt builder, and
 * reads/writes the current folder's AGENTS.md (or winning variant).
 *
 * The kernel is injected (`FolderInstructionKernel`) so Cowork typecheck
 * does not pull the core graph. Production IPC loads it via `loadCoreModule`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  FolderInstructionFileState,
  FolderInstructionOrigin,
  FolderInstructionsSnapshot,
  FolderInstructionSource,
  FolderInstructionTier,
  FolderInstructionVariant,
} from '../../shared/folder-instructions';

const PROBE_DIR_NAMES = new Set(['.codebuddy', '.claude']);
const PRIMARY_FOLDER_FILE = 'AGENTS.md';
const EDITABLE_BASENAME =
  /^(AGENTS|CODEBUDDY|CLAUDE|GEMINI|CONTEXT|INSTRUCTIONS)(\.(local|override))?\.md$/;

export const DEFAULT_STARTUP_INSTRUCTION_FILES = ['AGENTS.md', 'CODEBUDDY.md'] as const;

export const FOLDER_INSTRUCTION_AMBIGUITY_NOTE =
  'Startup injects only AGENTS.md and CODEBUDDY.md unless CODEBUDDY_INCLUDE_INTEROP_CONTEXT=true. JIT may still load CLAUDE.md, GEMINI.md, CONTEXT.md and INSTRUCTIONS.md when a tool touches that path.';

export const FOLDER_INSTRUCTION_JIT_NOTE =
  'Files in folders below the current working directory are not in this list until a tool accesses a path under them (JIT pass).';

export interface KernelContextSource {
  path: string;
  realpath: string;
  relPath: string;
  tier: FolderInstructionTier;
  variant: FolderInstructionVariant;
  bytes: number;
  truncated: boolean;
}

export interface FolderInstructionKernel {
  findProjectRoot: (cwd: string) => string | null;
  getAcceptedFileNames: (projectRoot?: string) => string[];
  resolveProjectContext: (opts: {
    cwd: string;
    projectRoot: string;
    homeDir: string;
    fileNames: string[];
  }) => { text: string; sources: KernelContextSource[]; truncated: boolean };
  startupFileNames: readonly string[];
  clearCaches: () => void;
}

export interface InspectFolderInstructionsOptions {
  cwd: string;
  projectRoot?: string;
  homeDir?: string;
  kernel: FolderInstructionKernel;
}

export function instructionScopeDirectory(filePath: string): string {
  const dir = path.dirname(path.resolve(filePath));
  if (PROBE_DIR_NAMES.has(path.basename(dir))) {
    return path.dirname(dir);
  }
  return dir;
}

export function classifyInstructionOrigin(params: {
  tier: FolderInstructionTier;
  filePath: string;
  projectRoot: string;
  cwd: string;
}): FolderInstructionOrigin {
  if (params.tier === 'global') return 'global';
  const scope = instructionScopeDirectory(params.filePath);
  const root = path.resolve(params.projectRoot);
  if (path.resolve(scope) === root) return 'folder';
  return 'subdirectory';
}

function mapSource(
  source: KernelContextSource,
  index: number,
  projectRoot: string,
  cwd: string,
): FolderInstructionSource {
  return {
    path: source.path,
    relPath: source.relPath,
    tier: source.tier,
    variant: source.variant,
    origin: classifyInstructionOrigin({
      tier: source.tier,
      filePath: source.path,
      projectRoot,
      cwd,
    }),
    bytes: source.bytes,
    truncated: source.truncated,
    priorityIndex: index,
  };
}

function isInteropEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_INCLUDE_INTEROP_CONTEXT === 'true';
}

function variantCandidates(base: string): Array<{ name: string; variant: FolderInstructionVariant }> {
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, base.length - ext.length) : base;
  return [
    { name: `${stem}.local${ext}`, variant: 'local' },
    { name: `${stem}.override${ext}`, variant: 'override' },
    { name: base, variant: 'base' },
  ];
}

export function resolveFolderInstructionFile(
  cwd: string,
  baseName: string = PRIMARY_FOLDER_FILE,
): FolderInstructionFileState {
  const resolvedCwd = path.resolve(cwd);
  for (const candidate of variantCandidates(baseName)) {
    const filePath = path.join(resolvedCwd, candidate.name);
    try {
      if (fs.statSync(filePath).isFile()) {
        return {
          fileName: candidate.name,
          path: filePath,
          exists: true,
          variant: candidate.variant,
          content: fs.readFileSync(filePath, 'utf-8'),
        };
      }
    } catch {
      /* missing */
    }
  }
  return {
    fileName: baseName,
    path: path.join(resolvedCwd, baseName),
    exists: false,
    variant: null,
    content: '',
  };
}

export function inspectFolderInstructions(
  opts: InspectFolderInstructionsOptions,
): FolderInstructionsSnapshot {
  const cwd = path.resolve(opts.cwd);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error('Working folder is not a directory');
  }

  const { kernel } = opts;
  kernel.clearCaches();

  const projectRoot = path.resolve(opts.projectRoot ?? kernel.findProjectRoot(cwd) ?? cwd);
  const homeDir = opts.homeDir ?? os.homedir();
  const interopContextEnabled = isInteropEnabled();
  const startupFileNames = interopContextEnabled
    ? kernel.getAcceptedFileNames(projectRoot)
    : [...(kernel.startupFileNames.length ? kernel.startupFileNames : DEFAULT_STARTUP_INSTRUCTION_FILES)];
  const acceptedFileNames = kernel.getAcceptedFileNames(projectRoot);

  const appliedCtx = kernel.resolveProjectContext({
    cwd,
    projectRoot,
    homeDir,
    fileNames: startupFileNames,
  });
  const fullCtx = kernel.resolveProjectContext({
    cwd,
    projectRoot,
    homeDir,
    fileNames: acceptedFileNames,
  });

  const appliedPaths = new Set(appliedCtx.sources.map((source) => source.realpath));
  const applied = appliedCtx.sources.map((source, index) =>
    mapSource(source, index, projectRoot, cwd),
  );
  const presentNotApplied = fullCtx.sources
    .filter((source) => !appliedPaths.has(source.realpath))
    .map((source, index) => mapSource(source, applied.length + index, projectRoot, cwd));

  const notes: string[] = [FOLDER_INSTRUCTION_JIT_NOTE];
  if (!interopContextEnabled) {
    notes.unshift(FOLDER_INSTRUCTION_AMBIGUITY_NOTE);
  }

  return {
    cwd,
    projectRoot,
    interopContextEnabled,
    startupFileNames,
    acceptedFileNames,
    applied,
    presentNotApplied,
    truncated: appliedCtx.truncated,
    appliedText: appliedCtx.text,
    folderFile: resolveFolderInstructionFile(cwd),
    notes,
  };
}

function assertEditableName(fileName: string): void {
  if (!EDITABLE_BASENAME.test(fileName) || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('Invalid instruction file name');
  }
}

function resolveEditablePath(cwd: string, fileName: string): string {
  assertEditableName(fileName);
  const resolvedCwd = path.resolve(cwd);
  const target = path.resolve(resolvedCwd, fileName);
  const cwdPrefix = resolvedCwd.endsWith(path.sep) ? resolvedCwd : `${resolvedCwd}${path.sep}`;
  if (target !== resolvedCwd && !target.startsWith(cwdPrefix)) {
    throw new Error('Instruction file must stay inside the working folder');
  }
  if (path.dirname(target) !== resolvedCwd) {
    throw new Error('Instruction file must be written in the working folder');
  }
  return target;
}

export function readFolderInstructionFile(cwd: string, fileName: string): FolderInstructionFileState {
  const target = resolveEditablePath(cwd, fileName);
  try {
    const lst = fs.lstatSync(target);
    if (lst.isSymbolicLink()) {
      const real = fs.realpathSync(target);
      const resolvedCwd = path.resolve(cwd);
      const cwdPrefix = resolvedCwd.endsWith(path.sep) ? resolvedCwd : `${resolvedCwd}${path.sep}`;
      if (real !== resolvedCwd && !real.startsWith(cwdPrefix)) {
        return { fileName, path: target, exists: false, variant: variantOf(fileName), content: '' };
      }
    }
    if (!fs.statSync(target).isFile()) {
      return { fileName, path: target, exists: false, variant: variantOf(fileName), content: '' };
    }
  } catch {
    return { fileName, path: target, exists: false, variant: variantOf(fileName), content: '' };
  }
  return {
    fileName,
    path: target,
    exists: true,
    variant: variantOf(fileName),
    content: fs.readFileSync(target, 'utf-8'),
  };
}

/**
 * Bind a renderer-supplied cwd to the open workspace. Absolute paths and
 * `..` that leave the workspace must not be followed.
 */
export function confineFolderInstructionCwd(
  requested: string | undefined,
  workspacePath: string | null,
): string | null {
  if (!workspacePath) return null;
  const resolvedWorkspace = path.resolve(workspacePath);
  if (typeof requested !== 'string' || !requested.trim()) {
    return resolvedWorkspace;
  }
  const resolvedRequested = path.resolve(resolvedWorkspace, requested.trim());
  const rel = path.relative(resolvedWorkspace, resolvedRequested);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolvedRequested;
}

export function writeFolderInstructionFile(
  cwd: string,
  fileName: string,
  content: string,
): FolderInstructionFileState {
  const target = resolveEditablePath(cwd, fileName);
  try {
    const lst = fs.lstatSync(target);
    if (lst.isSymbolicLink()) {
      throw new Error('Refusing to write instruction file through symbolic link');
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  fs.writeFileSync(target, content, 'utf-8');
  return {
    fileName,
    path: target,
    exists: true,
    variant: variantOf(fileName),
    content,
  };
}

function variantOf(fileName: string): FolderInstructionVariant {
  if (fileName.includes('.local.')) return 'local';
  if (fileName.includes('.override.')) return 'override';
  return 'base';
}
