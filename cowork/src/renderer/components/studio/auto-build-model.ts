/**
 * Pure model for App Studio's auto-build + auto-fix loop (G2).
 *
 * When the agent finishes generating an npm app, App Studio installs it and
 * starts the dev server (G1). If that fails, it feeds the error back to the
 * same agent session to fix — capped, so a $0-but-not-free loop can't run away
 * (bolt/Cursor charge for this iteration; the cap is our discipline). This file
 * holds the decision + prompt logic with no React/IPC so it is unit-testable.
 *
 * @module renderer/components/studio/auto-build-model
 */

/** Hard cap on automatic fix attempts before handing control back to the user. */
export const MAX_FIX_ATTEMPTS = 3;

export interface AutoBuildInputs {
  /** Project has a root package.json (needs install + dev server). */
  isNpm: boolean;
  /** A preview URL is already live. */
  hasPreview: boolean;
  /** Current preview status ('idle' | 'starting' | 'running' | 'dead' | ...). */
  previewStatus: string;
  /** The agent turn is still running (generation/fix in flight). */
  turnActive: boolean;
  /** We already kicked off (at least) one build for this project. */
  alreadyBuilt: boolean;
}

/**
 * Should App Studio auto-run install+preview now? Only for a settled npm
 * project that has never been built and isn't already previewing — static
 * sites auto-serve through the hook, so they're excluded here.
 */
export function shouldAutoBuild(input: AutoBuildInputs): boolean {
  if (!input.isNpm) return false;
  if (input.turnActive) return false;
  if (input.alreadyBuilt) return false;
  if (input.hasPreview) return false;
  if (input.previewStatus === 'running' || input.previewStatus === 'starting') return false;
  return true;
}

/** Whether another automatic fix attempt is allowed. */
export function canRetry(attempts: number): boolean {
  return attempts < MAX_FIX_ATTEMPTS;
}

/**
 * Build the message handed back to the agent session when install/build/preview
 * fails, so it repairs the project files (no shell — the runner owns install).
 */
export function buildFixPrompt(error: string, logTail: readonly string[]): string {
  const logs = logTail.filter(Boolean).slice(-40).join('\n');
  const parts = [
    "The app failed to install, build, or start its dev server, so the preview can't render.",
    error ? `\nError: ${error}` : '',
    logs ? `\nRecent build output:\n${logs}` : '',
    '',
    'Diagnose and FIX the cause by editing the project files — for example a missing or ' +
      'incorrect dependency/version in package.json, a syntax or import error, or a wrong ' +
      'dev script. Do NOT run shell commands (App Studio runs the install/build for you). ' +
      'When you are done, briefly state what you changed so the build can be retried.',
  ];
  return parts.filter((line) => line !== '').join('\n');
}

/** Human-readable status pill for the build strip during auto-fix. */
export function autoFixNote(attempt: number | null): string | null {
  if (attempt === null) return null;
  return `Fixing… (attempt ${attempt}/${MAX_FIX_ATTEMPTS})`;
}
