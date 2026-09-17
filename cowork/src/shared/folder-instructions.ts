/**
 * DTOs for Cowork folder instructions. The kernel loader lives in
 * `src/context/project-context.ts`; this file is display/IPC only.
 */

export type FolderInstructionOrigin = 'global' | 'folder' | 'subdirectory';
export type FolderInstructionTier = 'global' | 'hierarchy' | 'jit';
export type FolderInstructionVariant = 'base' | 'override' | 'local';

export interface FolderInstructionSource {
  path: string;
  relPath: string;
  tier: FolderInstructionTier;
  variant: FolderInstructionVariant;
  origin: FolderInstructionOrigin;
  bytes: number;
  truncated: boolean;
  /** 0-based index in the concatenated prompt (later rows win on conflict). */
  priorityIndex: number;
}

export interface FolderInstructionFileState {
  /** Basename actually written/read (e.g. AGENTS.md or AGENTS.local.md). */
  fileName: string;
  path: string;
  exists: boolean;
  variant: FolderInstructionVariant | null;
  content: string;
}

export interface FolderInstructionsSnapshot {
  cwd: string;
  projectRoot: string;
  interopContextEnabled: boolean;
  startupFileNames: string[];
  acceptedFileNames: string[];
  applied: FolderInstructionSource[];
  /** On disk and loaded by the full config list, but not injected at startup. */
  presentNotApplied: FolderInstructionSource[];
  truncated: boolean;
  appliedText: string;
  folderFile: FolderInstructionFileState;
  notes: string[];
}
