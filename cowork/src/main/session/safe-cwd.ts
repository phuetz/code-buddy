/**
 * safe-cwd — resolve a session working directory so a RELATIVE path can never
 * land against the Electron process cwd (which is `cowork/` in dev — writing
 * there corrupts the source tree; this is the "famille cwd embarqué" class of
 * bug, proven live when an AI app generation with an empty workingDir produced
 * a bare slug cwd that mkdir'd inside cowork/).
 *
 * Absolute paths pass through untouched. Relative / empty paths resolve under
 * a safe base (the app's default working dir). Pure — base is injected.
 */
import * as path from 'path';

export function resolveSafeCwd(cwd: string | undefined, safeBase: string): string | undefined {
  if (!cwd || !cwd.trim()) return undefined;
  const trimmed = cwd.trim();
  if (path.isAbsolute(trimmed)) return trimmed;
  // Relative: strip any leading ./ or ../ segments so it can't escape the base,
  // then anchor under the safe base.
  const cleaned = trimmed.replace(/^(\.\.?[/\\])+/, '').replace(/[/\\]+$/, '');
  return path.join(safeBase, cleaned || 'projet');
}
