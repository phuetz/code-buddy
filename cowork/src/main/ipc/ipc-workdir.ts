/**
 * Shared work-directory resolution for the review-gated IPC bridges
 * (lesson candidates, user model, spec stories).
 *
 * The core stores (`getLessonCandidateQueue`, `getUserModel`, `getSpecStore`)
 * are singletons keyed by working directory and persist under
 * `<workDir>/.codebuddy/`. In Cowork the relevant working directory is the
 * ACTIVE project's `workspacePath`. A handler resolves it the same way the
 * memory/knowledge handlers do: an explicit `projectId` wins, otherwise the
 * active project. Returns `null` when no project is selected so each panel can
 * render a "select a project first" empty state instead of throwing.
 *
 * @module main/ipc/ipc-workdir
 */

import type { ProjectManager } from '../project/project-manager';

export type ProjectManagerSource =
  | ProjectManager
  | null
  | (() => ProjectManager | null);

export function resolveProjectManager(source: ProjectManagerSource): ProjectManager | null {
  return typeof source === 'function' ? source() : source;
}

/**
 * Resolve the working directory whose `.codebuddy/` folder a review-gated
 * store should read/write. `null` means "no active project" — handlers should
 * surface that as an empty/`NO_ACTIVE_PROJECT` result, never a throw.
 */
export function resolveWorkDir(
  source: ProjectManagerSource,
  projectId?: string,
): string | null {
  const pm = resolveProjectManager(source);
  if (!pm) return null;
  const id = projectId ?? pm.getActiveId();
  const project = id ? pm.get(id) : pm.getActive();
  return project?.workspacePath ?? null;
}

/** Normalise an unknown thrown value to a message string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
