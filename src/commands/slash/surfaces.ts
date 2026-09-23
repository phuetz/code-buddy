/**
 * Per-surface availability of slash commands (comparatif plan P4).
 *
 * Single declaration read by the CLI catalog, the Cowork main process (which
 * derives its headless allowlist from it) and the generated slash wiki.
 *
 * Rules:
 * - CLI: every built-in is available unless a command declares otherwise.
 * - Cowork, DEFAULT-DENY for engine tokens (`__FOO__` prompts): a token is only
 *   pilotable from Cowork when it is declared below either as `headless` (runs
 *   through `executeHeadlessSlashToken` with this allowlist) or `ui_effect`
 *   (Cowork renders a native panel/effect). Undeclared tokens are unavailable
 *   with an explicit reason. Natural-language prompt commands are forwarded as
 *   prompts and are therefore available.
 * - A command-level `surfaces` declaration can only RESTRICT a surface (hidden
 *   or unavailable); it never widens the Cowork token allowlist.
 */

import type { SlashAvailability, SlashCommand, SlashSurface } from './types.js';

export type CoworkTokenMode = 'headless' | 'ui_effect';

/**
 * Tokens Cowork can pilot. `headless` entries are safe to run from the Cowork
 * main process today (read-only info or session-scoped goal state); see the
 * rationale kept in cowork/src/main/commands/slash-command-bridge.ts.
 */
export const COWORK_TOKEN_SURFACES: Readonly<Record<string, CoworkTokenMode>> = Object.freeze({
  // Headless (engine behaviour, default-deny allowlist)
  __HELP__: 'headless',
  __STATS__: 'headless',
  __COST__: 'headless',
  __TOOLS__: 'headless',
  __WHOAMI__: 'headless',
  __STATUS__: 'headless',
  __FEATURES__: 'headless',
  __HISTORY__: 'headless',
  __LOG__: 'headless',
  __WORKSPACE__: 'headless',
  __DIFF__: 'headless',
  __QUOTA__: 'headless',
  __EXPORT_FORMATS__: 'headless',
  __EXPORT_LIST__: 'headless',
  __GOAL__: 'headless',
  __HEARTBEAT__: 'headless',
  __COMPANION_LOOPS__: 'headless',
  __SUBGOAL__: 'headless',
  __RESOURCES__: 'headless',
  // Native Cowork effects (panels, settings tabs, orchestrator, engine actions)
  __CHANGE_MODEL__: 'ui_effect',
  __SWITCH__: 'ui_effect',
  __PLAN_MODE__: 'ui_effect',
  __SWARM__: 'ui_effect',
  __PARALLEL__: 'ui_effect',
  __BATCH__: 'ui_effect',
  __AGENTS__: 'ui_effect',
  __FLEET__: 'ui_effect',
  __TEAM__: 'ui_effect',
  __LESSONS__: 'ui_effect',
  __COMPANION__: 'ui_effect',
  __TRACK__: 'ui_effect',
  __CONFIG__: 'ui_effect',
  __WORKFLOW__: 'ui_effect',
  __PIPELINE__: 'ui_effect',
  __PERMISSIONS__: 'ui_effect',
  __POLICY__: 'ui_effect',
  __APPROVALS__: 'ui_effect',
  __ELEVATED__: 'ui_effect',
  __BATCH_REVIEW__: 'ui_effect',
  __SECURITY__: 'ui_effect',
  __HOOKS__: 'ui_effect',
  __PLUGINS__: 'ui_effect',
  __PLUGIN__: 'ui_effect',
  __THEME__: 'ui_effect',
  __AVATAR__: 'ui_effect',
  __VIM_MODE__: 'ui_effect',
  __FAST_MODE__: 'ui_effect',
  __DRY_RUN__: 'ui_effect',
  __CACHE__: 'ui_effect',
  __PROMPT_CACHE__: 'ui_effect',
  __SELF_HEALING__: 'ui_effect',
  __SEARCH__: 'ui_effect',
  __SHORTCUTS__: 'ui_effect',
  __PERSONA__: 'ui_effect',
  __SESSIONS__: 'ui_effect',
  __REMEMBER__: 'ui_effect',
  __IDENTITY__: 'ui_effect',
  __PAIRING__: 'ui_effect',
  __VOICE__: 'ui_effect',
  __SPEAK__: 'ui_effect',
  __TTS__: 'ui_effect',
  __EXPORT__: 'ui_effect',
  __SAVE_CONVERSATION__: 'ui_effect',
  __TEST__: 'ui_effect',
  __THINK__: 'ui_effect',
  __KNOWLEDGE_GRAPH__: 'ui_effect',
  __UNDO__: 'ui_effect',
  __REDO__: 'ui_effect',
  __SUBAGENT__: 'ui_effect',
  __AGENT__: 'ui_effect',
});

/**
 * Bot commands expected on each messaging platform (the `channels` surface).
 * This is the single declaration read by `src/channels/slash-parity.ts`.
 * A name that matches a builtin is the same command reached from a chat
 * platform; `channelOnly` marks bot-only commands with no terminal builtin.
 */
export interface ChannelSlashSpec {
  name: string;
  description: string;
  required?: boolean;
  channelOnly?: boolean;
}

export const CHANNEL_SLASH_SURFACES: Readonly<Record<string, readonly ChannelSlashSpec[]>> = Object.freeze({
  discord: [
    { name: 'ask', description: 'Ask Code Buddy a question', channelOnly: true },
    { name: 'status', description: 'Show bot and channel status' },
    { name: 'clear', description: 'Clear conversation history' },
    { name: 'help', description: 'Show available commands' },
    { name: 'model', description: 'Switch or show current model' },
    { name: 'think', description: 'Set reasoning depth', required: false },
    { name: 'compact', description: 'Compact conversation context', required: false },
    { name: 'repo', description: 'Show repository info', required: false, channelOnly: true },
  ],
  telegram: [
    { name: 'ask', description: 'Ask Code Buddy a question', channelOnly: true },
    { name: 'status', description: 'Show bot and channel status' },
    { name: 'clear', description: 'Clear conversation history' },
    { name: 'help', description: 'Show available commands' },
    { name: 'model', description: 'Switch or show current model' },
    { name: 'yolo', description: 'Toggle YOLO mode', required: false },
    { name: 'repo', description: 'Show repository info', required: false, channelOnly: true },
    { name: 'branch', description: 'Show branch info', required: false },
  ],
  slack: [
    { name: 'ask', description: 'Ask Code Buddy a question', channelOnly: true },
    { name: 'status', description: 'Show bot and channel status' },
    { name: 'clear', description: 'Clear conversation history' },
    { name: 'help', description: 'Show available commands' },
    { name: 'model', description: 'Switch or show current model' },
    { name: 'compact', description: 'Compact conversation context', required: false },
    { name: 'think', description: 'Set reasoning depth', required: false },
  ],
  matrix: [
    { name: 'ask', description: 'Ask Code Buddy a question', channelOnly: true },
    { name: 'status', description: 'Show bot and channel status' },
    { name: 'clear', description: 'Clear conversation history' },
    { name: 'help', description: 'Show available commands' },
    { name: 'model', description: 'Switch or show current model', required: false },
  ],
});

/** Platforms whose bot exposes this command; a `channels` restriction on the command removes it everywhere. */
export function channelPlatformsFor(command: Pick<SlashCommand, 'name' | 'surfaces'>): string[] {
  const declared = command.surfaces?.channels;
  if (declared && declared.status !== 'available') return [];
  return Object.entries(CHANNEL_SLASH_SURFACES)
    .filter(([, specs]) => specs.some((spec) => !spec.channelOnly && spec.name === command.name))
    .map(([platform]) => platform);
}

export const COWORK_UNAVAILABLE_REASON = 'not pilotable from Cowork yet — use the terminal (buddy)';

export function isEngineToken(prompt: string): boolean {
  return prompt.length > 4 && prompt.startsWith('__') && prompt.endsWith('__');
}

/** Tokens the Cowork main process may run headlessly (derived, never hand-maintained elsewhere). */
export function coworkHeadlessAllowlist(): ReadonlySet<string> {
  return new Set(Object.entries(COWORK_TOKEN_SURFACES).filter(([, mode]) => mode === 'headless').map(([token]) => token));
}

export function coworkUiEffectTokens(): ReadonlySet<string> {
  return new Set(Object.entries(COWORK_TOKEN_SURFACES).filter(([, mode]) => mode === 'ui_effect').map(([token]) => token));
}

const AVAILABLE: SlashAvailability = { status: 'available' };

/** Effective availability of one catalog command on one surface. */
export function resolveSlashAvailability(
  command: Pick<SlashCommand, 'name' | 'prompt' | 'surfaces'>,
  surface: SlashSurface,
): SlashAvailability {
  const declared = command.surfaces?.[surface];
  const restricting = declared && declared.status !== 'available' ? declared : undefined;
  if (surface === 'cowork') {
    if (restricting) return restricting;
    if (!isEngineToken(command.prompt)) return AVAILABLE;
    return COWORK_TOKEN_SURFACES[command.prompt] ? AVAILABLE : { status: 'unavailable', reason: COWORK_UNAVAILABLE_REASON };
  }
  return declared ?? AVAILABLE;
}

export interface SlashCommandWithAvailability extends SlashCommand {
  availability: Record<'cli' | 'cowork', SlashAvailability>;
  /** Messaging platforms whose bot exposes the same command (from CHANNEL_SLASH_SURFACES). */
  channelPlatforms: string[];
}

export function withAvailability(commands: readonly SlashCommand[]): SlashCommandWithAvailability[] {
  return commands.map((command) => ({
    ...command,
    availability: {
      cli: resolveSlashAvailability(command, 'cli'),
      cowork: resolveSlashAvailability(command, 'cowork'),
    },
    channelPlatforms: channelPlatformsFor(command),
  }));
}
