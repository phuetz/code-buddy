import type { SlashCommand } from './types.js';

/**
 * Commands kept out of the 49k builtin-commands.ts catalog so they can
 * land without rewriting that file. SlashCommandManager merges this list.
 */
export const extraBuiltinCommands: SlashCommand[] = [
  {
    name: 'companion-loops',
    description: 'Arm or stop Lisa always-on loops (impulse, presence, proactive, idle)',
    prompt: '__COMPANION_LOOPS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'start | stop | status (default: status)', required: false },
    ],
  },
];
