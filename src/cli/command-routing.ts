import type { Command } from 'commander';

export interface NonInteractiveCommandContext {
  positionalArgs: readonly string[] | undefined;
  hasExplicitPrompt: boolean;
  stdinIsTTY: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
}

/**
 * Identify a command-like positional argument which would otherwise fall
 * through to the interactive chat action in a non-interactive process.
 */
export function getNonInteractiveUnknownCommand(
  context: NonInteractiveCommandContext,
): string | undefined {
  if (context.stdinIsTTY && context.stdoutIsTTY) return undefined;
  if (context.hasExplicitPrompt) return undefined;

  const firstPositional = context.positionalArgs?.[0];
  if (!firstPositional || /\s/.test(firstPositional)) return undefined;
  return firstPositional;
}

/**
 * Remove commands matching either a primary name or an alias.
 * Commander exposes commands as readonly, so mutate the backing array in-place.
 */
export function removeCommands(parent: Command, names: string | readonly string[]): void {
  const nameSet = new Set(typeof names === 'string' ? [names] : names);
  const commands = parent.commands as Command[];

  for (let index = commands.length - 1; index >= 0; index--) {
    const command = commands[index];
    if (
      command !== undefined
      && [command.name(), ...command.aliases()].some((name) => nameSet.has(name))
    ) {
      commands.splice(index, 1);
    }
  }
}

/**
 * Register a pass-through command group which loads its real implementation
 * only after Commander matches the primary name or one of its aliases.
 */
export function addLazyCommandGroup(
  parent: Command,
  name: string,
  description: string,
  loader: () => Promise<void>,
  aliases?: string[],
): void {
  const stub = parent
    .command(name)
    .description(description)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false);

  if (aliases !== undefined && aliases.length > 0) {
    stub.aliases(aliases);
  }

  stub.action(async () => {
    removeCommands(parent, [name, ...(aliases ?? [])]);
    await loader();
    await parent.parseAsync(process.argv);
  });
}
