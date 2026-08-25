/**
 * Commander + enablePositionalOptions() only accepts root flags BEFORE the
 * subcommand. `buddy research x --permission-mode acceptEdits` therefore
 * becomes « unknown option » even though the flag exists on `buddy`.
 *
 * This hint names the flag, says WHERE to put it, and (when we know them)
 * lists accepted values — the three things a useful error must say.
 */

import { Command } from 'commander';

type CommandUnknownOption = Command & {
  unknownOption(flag: string): void;
};

const VALUE_HINTS: Record<string, string> = {
  '--permission-mode': 'Values: default, plan, acceptEdits, dontAsk, bypassPermissions',
  '--profile': 'Values: core, all, or a name from [profiles.<name>] in the config',
  '--security-mode': 'Values: suggest, auto-edit, full-auto',
  '--output-format': 'Values: json, stream-json, text, markdown',
  '--model': 'Example: grok-code-fast-1, or a local Ollama tag',
};

const BOOLEAN_FLAGS = new Set([
  '--dry-run',
  '--auto-approve',
  '--yolo',
  '--quiet',
  '--verbose',
  '--init',
  '--setup',
  '--plain',
  '--force-tools',
  '--probe-tools',
  '--list-models',
  '--list-prompts',
  '--list-agents',
  '--continue',
  '--vim',
  '--browser',
  '--ephemeral',
  '--allow-outside',
  '--mcp-debug',
  '--dangerously-skip-permissions',
  '--no-cache',
  '--no-self-heal',
  '--no-color',
  '--no-emoji',
  '--no-alt-screen',
  '--speak',
]);

function flagName(flag: string): string {
  const cut = flag.indexOf('=');
  return cut === -1 ? flag : flag.slice(0, cut);
}

function longFlagOf(root: Command, flag: string): string {
  const name = flagName(flag);
  const match = root.options.find((option) => option.short === name || option.long === name);
  return match?.long ?? name;
}

function takesValue(longFlag: string): boolean {
  return !BOOLEAN_FLAGS.has(longFlag);
}

/** Build the user-facing error for a root option used after a subcommand. */
export function formatGlobalOptionMisplaced(flag: string, commandName: string, longFlag: string = flag): string {
  const valueSlot = takesValue(longFlag) ? ' <value>' : '';
  const exampleCommand = commandName && commandName !== 'buddy' ? commandName : '<command>';
  const lines = [
    `error: unknown option '${flagName(flag)}'`,
    '',
    `'${longFlag}' is a global option: place it BEFORE the subcommand.`,
    `  buddy ${longFlag}${valueSlot} ${exampleCommand} …`,
  ];
  const values = VALUE_HINTS[longFlag];
  if (values) lines.push(values);
  return lines.join('\n');
}

function rootOptionFlags(root: Command): Set<string> {
  const flags = new Set<string>();
  for (const option of root.options) {
    if (option.long) flags.add(option.long);
    if (option.short) flags.add(option.short);
  }
  return flags;
}

function isAllowingUnknown(command: Command): boolean {
  return Boolean((command as unknown as { _allowUnknownOption?: boolean })._allowUnknownOption);
}

/**
 * When a subcommand sees a flag that actually belongs on the root program,
 * replace Commander's bare « unknown option » with where to put it.
 */
export function attachUnknownOptionHint(command: Command, root: Command): void {
  const flags = rootOptionFlags(root);
  const target = command as CommandUnknownOption;
  const proto = Command.prototype as CommandUnknownOption;

  target.unknownOption = function unknownOptionWithGlobalHint(this: Command, flag: string): void {
    if (isAllowingUnknown(this)) return;
    const name = flagName(flag);
    if (flags.has(name)) {
      this.error(formatGlobalOptionMisplaced(flag, this.name(), longFlagOf(root, name)));
      return;
    }
    proto.unknownOption.call(this, flag);
  };

  for (const sub of command.commands) {
    attachUnknownOptionHint(sub, root);
  }
}
