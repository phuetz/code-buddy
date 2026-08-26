import type { Command } from 'commander';

export const CLI_PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'dontAsk',
  'bypassPermissions',
] as const;

export type CliPermissionMode = (typeof CLI_PERMISSION_MODES)[number];

export function isCliPermissionMode(value: unknown): value is CliPermissionMode {
  return typeof value === 'string'
    && (CLI_PERMISSION_MODES as readonly string[]).includes(value);
}

/**
 * Commander delegates tokens after a subcommand to that command, so a root
 * option written in the natural trailing position is otherwise rejected by
 * the child. Move only this global option ahead of the command while keeping
 * `--` as the standard escape hatch for literal prompt/argument text.
 */
export function hoistPermissionModeOption(argv: readonly string[]): string[] {
  const executablePrefix = argv.slice(0, 2);
  const tokens = argv.slice(2);
  const hoisted: string[] = [];
  const remaining: string[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '--') {
      remaining.push(...tokens.slice(index));
      break;
    }
    if (token?.startsWith('--permission-mode=')) {
      hoisted.push(token);
      continue;
    }
    if (token === '--permission-mode') {
      hoisted.push(token);
      const value = tokens[index + 1];
      if (value !== undefined && value !== '--' && !value.startsWith('-')) {
        hoisted.push(value);
        index += 1;
      }
      continue;
    }
    if (token !== undefined) remaining.push(token);
  }

  return [...executablePrefix, ...hoisted, ...remaining];
}

/** Apply the root posture to every action, including lazily re-parsed trees. */
export function installPermissionModeActionHook(
  program: Command,
  applyMode: (mode: CliPermissionMode) => Promise<void> | void,
): void {
  let appliedMode: CliPermissionMode | undefined;
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    const mode = actionCommand.optsWithGlobals().permissionMode;
    if (!isCliPermissionMode(mode) || mode === appliedMode) return;
    await applyMode(mode);
    appliedMode = mode;
  });
}
