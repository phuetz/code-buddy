import { parseBashCommand } from '../security/bash-parser.js';
import { basename } from 'node:path';

/** Conservative target extraction for the small shell subset with a return point. */
export function lisaBashTargets(command: string): string[] {
  const parsed = parseBashCommand(command);
  const destructive = new Set(['rm', 'mv', 'cp', 'truncate']);
  const isDestructive = (name: string) => destructive.has(basename(name));
  if (parsed.commands.some(part => !isDestructive(part.command) && part.args.some(arg =>
    isDestructive(arg) || /(?:^|[\s;&|])(?:\S*\/)?(?:rm|mv|cp|truncate)(?=\s|$)/.test(arg)))) {
    throw new Error('Wrapped destructive command has no complete return point');
  }
  if (parsed.commands.some(part => isDestructive(part.command)) &&
      (parsed.hasRedirection || parsed.warnings.length > 0)) {
    throw new Error('Destructive command could not be fully checkpointed');
  }
  if (parsed.commands.length > 1 && parsed.commands.some(part => isDestructive(part.command))) {
    throw new Error('Compound destructive command has no complete return point');
  }
  const targets: string[] = [];
  for (const part of parsed.commands) {
    if (!isDestructive(part.command)) continue;
    const args = part.args.filter(arg => !arg.startsWith('-'));
    if (part.args.some(arg => arg === '-t' || arg.startsWith('--target-directory') || arg.startsWith('--backup'))) {
      throw new Error('Destructive command options have no complete return point');
    }
    if (args.some(arg => /[*?[\]{}]/.test(arg))) {
      throw new Error('Wildcard targets have no complete return point');
    }
    const name = basename(part.command);
    if (name === 'rm' || name === 'mv') targets.push(...args);
    if (name === 'cp' && args.length > 0) targets.push(args[args.length - 1]!);
    if (name === 'truncate') throw new Error('Truncate needs a dedicated return point');
  }
  return targets;
}
