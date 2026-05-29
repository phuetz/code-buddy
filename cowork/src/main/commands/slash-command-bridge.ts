/**
 * SlashCommandBridge — Claude Cowork parity Phase 2
 *
 * Exposes Code Buddy's built-in slash command catalog to the renderer so the
 * `/` palette in ChatView can discover and execute commands without rebuilding
 * the command handler in the renderer.
 *
 * The bridge is deliberately thin: it reads the catalog (via
 * `src/commands/slash/`) and a few metadata helpers, and routes execution back
 * to the engine runner or direct handlers (`handleSlashCommand` from the
 * compiled dist when available).
 *
 * @module main/commands/slash-command-bridge
 */

import { log, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';
import { getCustomCommandsService } from './custom-commands-service';

export interface SlashCommandArg {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface SlashCommandDef {
  name: string;
  description: string;
  prompt: string;
  category?: string;
  isBuiltin: boolean;
  arguments?: SlashCommandArg[];
}

/**
 * Renderer-side effects for presentation-only slash commands that have no
 * headless engine behaviour (they map to a Cowork equivalent instead).
 */
export type SlashUiEffectKind =
  | 'open_model_picker'
  | 'run_orchestrator'
  | 'open_orchestrator_launcher'
  | 'open_fleet'
  | 'set_plan_mode'
  | 'open_lessons'
  | 'open_team'
  | 'open_companion'
  | 'open_spec'
  | 'open_settings'
  | 'open_panel';

export interface SlashCommandExecuteResult {
  success: boolean;
  /** Text that should be injected as the user prompt (if any) */
  prompt?: string;
  /** Free-form message shown as a transient toast (e.g. "Cleared", errors) */
  message?: string;
  /** Engine command output to render as an assistant chat message (not a toast) */
  output?: string;
  error?: string;
  /** True when the command handled everything itself (no LLM round needed) */
  handled?: boolean;
  action?: {
    type: 'open_schedule' | 'create_schedule' | 'ui_effect';
    draft?: SlashScheduleDraft;
    createInput?: SlashScheduleCreateInput;
    /** For type 'ui_effect': which Cowork-side effect the renderer should apply */
    uiEffect?: SlashUiEffectKind;
    /** Parsed args, forwarded so the renderer can parameterize the effect */
    args?: string[];
  };
}

export interface RemoteSlashCommandResult {
  allowed: boolean;
  prompt?: string;
  message?: string;
}

type CoreSlashModule = {
  builtinCommands: SlashCommandDef[];
  getCommandsByCategory: () => Record<string, SlashCommandDef[]>;
};

let cachedSlashModule: CoreSlashModule | null = null;

export interface SlashScheduleDraft {
  prompt: string;
  cwd?: string;
  scheduleMode: 'once' | 'daily' | 'weekly';
  runAt?: string;
  selectedTimes?: string[];
  selectedWeekdays?: SlashScheduleWeekday[];
  enabled?: boolean;
}

export type SlashScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface SlashScheduleCreateInput {
  prompt: string;
  cwd?: string;
  runAt: number;
  nextRunAt: number;
  scheduleConfig:
    | {
        kind: 'daily';
        times: string[];
      }
      | {
        kind: 'weekly';
        weekdays: SlashScheduleWeekday[];
        times: string[];
      }
    | null;
  enabled: boolean;
}

const SYNTHETIC_COMMANDS: SlashCommandDef[] = [
  {
    name: 'schedule',
    description: 'Open the schedule form to create a recurring or one-shot task',
    prompt: '__OPEN_SCHEDULE__',
    category: 'workflow',
    isBuiltin: true,
    arguments: [
      {
        name: 'rule',
        description: 'Optional: daily 09:00 | weekly mon 09:00 | once 2026-04-10T09:00',
        required: false,
      },
      {
        name: 'task',
        description: 'Prompt to run on the schedule',
        required: false,
      },
    ],
  },
];

function isTimeToken(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
}

function weekdayTokenToIndex(value: string | undefined): SlashScheduleWeekday | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const map: Record<string, SlashScheduleWeekday> = {
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    weds: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
    sun: 0,
    sunday: 0,
  };
  return normalized in map ? map[normalized] : null;
}

function normalizeDateTimeLocal(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parseScheduleSlashArgs(args: string[]): SlashScheduleDraft {
  const [first, second, third, ...rest] = args;

  if (first?.toLowerCase() === 'daily' && isTimeToken(second)) {
    return {
      prompt: args.slice(2).join(' ').trim(),
      scheduleMode: 'daily',
      selectedTimes: [second],
      enabled: true,
    };
  }

  const weekday = weekdayTokenToIndex(second);
  if (first?.toLowerCase() === 'weekly' && weekday !== null && isTimeToken(third)) {
    return {
      prompt: args.slice(3).join(' ').trim(),
      scheduleMode: 'weekly',
      selectedWeekdays: [weekday],
      selectedTimes: [third],
      enabled: true,
    };
  }

  const onceDateToken =
    first?.toLowerCase() === 'once'
      ? normalizeDateTimeLocal(second)
      : normalizeDateTimeLocal(first);
  if (onceDateToken) {
    return {
      prompt: (first?.toLowerCase() === 'once' ? [third, ...rest] : [second, third, ...rest])
        .filter(Boolean)
        .join(' ')
        .trim(),
      scheduleMode: 'once',
      runAt: onceDateToken,
      enabled: true,
    };
  }

  return {
    prompt: args.join(' ').trim(),
    scheduleMode: 'once',
    enabled: true,
  };
}

function buildNextRunAtForDaily(time: string, now = Date.now()): number {
  const [hours, minutes] = time.split(':').map((value) => Number(value));
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function buildNextRunAtForWeekly(weekday: number, time: string, now = Date.now()): number {
  const [hours, minutes] = time.split(':').map((value) => Number(value));
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hours, minutes, 0, 0);

  const currentWeekday = next.getDay();
  let delta = weekday - currentWeekday;
  if (delta < 0) {
    delta += 7;
  }
  if (delta === 0 && next.getTime() <= now) {
    delta = 7;
  }
  next.setDate(next.getDate() + delta);
  return next.getTime();
}

export function buildScheduleCreateInputFromArgs(
  args: string[],
  now = Date.now()
): SlashScheduleCreateInput | null {
  const draft = parseScheduleSlashArgs(args);
  const trimmedPrompt = draft.prompt.trim();
  if (!trimmedPrompt) {
    return null;
  }

  if (draft.scheduleMode === 'once') {
    const nextRunAt = draft.runAt ? new Date(draft.runAt).getTime() : NaN;
    if (!Number.isFinite(nextRunAt) || nextRunAt <= now) {
      return null;
    }
    return {
      prompt: trimmedPrompt,
      cwd: draft.cwd,
      runAt: nextRunAt,
      nextRunAt,
      scheduleConfig: null,
      enabled: draft.enabled ?? true,
    };
  }

  if (draft.scheduleMode === 'daily') {
    const time = draft.selectedTimes?.[0];
    if (!isTimeToken(time)) {
      return null;
    }
    const nextRunAt = buildNextRunAtForDaily(time, now);
    return {
      prompt: trimmedPrompt,
      cwd: draft.cwd,
      runAt: nextRunAt,
      nextRunAt,
      scheduleConfig: {
        kind: 'daily',
        times: [time],
      },
      enabled: draft.enabled ?? true,
    };
  }

  const weekday = draft.selectedWeekdays?.[0];
  const time = draft.selectedTimes?.[0];
  if (typeof weekday !== 'number' || !isTimeToken(time)) {
    return null;
  }
  const nextRunAt = buildNextRunAtForWeekly(weekday, time, now);
  return {
    prompt: trimmedPrompt,
    cwd: draft.cwd,
    runAt: nextRunAt,
    nextRunAt,
    scheduleConfig: {
      kind: 'weekly',
      weekdays: [weekday],
      times: [time],
    },
    enabled: draft.enabled ?? true,
  };
}

async function loadSlashModule(): Promise<CoreSlashModule | null> {
  if (cachedSlashModule) return cachedSlashModule;
  const mod = await loadCoreModule<CoreSlashModule>('commands/slash/index.js');
  if (mod) {
    cachedSlashModule = mod;
    log('[SlashCommandBridge] Core slash catalog loaded');
  } else {
    logWarn('[SlashCommandBridge] Core slash catalog unavailable');
  }
  return mod;
}

type HeadlessSlashResult = {
  handled: boolean;
  output?: string;
  prompt?: string;
  passToAI?: boolean;
  denied?: boolean;
  reason?: string;
};

type CoreHeadlessModule = {
  executeHeadlessSlashToken: (
    token: string,
    args: string[],
    allow: ReadonlySet<string>,
    ctx?: { conversationHistory?: unknown; client?: unknown }
  ) => Promise<HeadlessSlashResult>;
};

let cachedHeadlessModule: CoreHeadlessModule | null = null;

async function loadHeadlessModule(): Promise<CoreHeadlessModule | null> {
  if (cachedHeadlessModule) return cachedHeadlessModule;
  const mod = await loadCoreModule<CoreHeadlessModule>('commands/headless-slash.js');
  if (mod) {
    cachedHeadlessModule = mod;
    log('[SlashCommandBridge] Core headless-slash module loaded');
  } else {
    logWarn('[SlashCommandBridge] Core headless-slash module unavailable');
  }
  return mod;
}

/**
 * Slice S0 allowlist: tokens that are safe to run headlessly from Cowork **today**.
 *
 * Scope is deliberately limited to info / read-only commands. Their worst-case
 * failure mode is benign — if the bridge's core module instance and the engine
 * adapter's instance ever resolve to different `dist/` realms (core-loader tries
 * several candidate roots), a read just returns empty/default data; it never
 * lies about having changed state.
 *
 * Deliberately excluded until their realm/context is positively confirmed:
 * - **mutating** (would silently no-op + falsely report success if realms differ):
 *   __YOLO_MODE__, __AUTONOMY__, __SELF_HEALING__, __DRY_RUN__, __PROMPT_CACHE__,
 *   __CACHE__. These must route through the engine session, not a bridge-side
 *   singleton — they graduate once realm-sharing is verified (S1+).
 * - **wrong-context**: __WORKSPACE__ reads `process.cwd()`, which in the Cowork
 *   main process is the Electron app dir, not the session's project.
 * - **history/client-dependent**: __COMPACT__, __SAVE_CONVERSATION__, __EXPORT__,
 *   __CONTEXT__ (stats), __AI_TEST__ — would run against an empty history today.
 * - **orchestration (S1)**: __SWARM__, __TEAM__, __AGENTS__, __PARALLEL__,
 *   __BATCH__, __FLEET__ — spawn real work whose value is the live panel.
 */
const COWORK_HEADLESS_ALLOW: ReadonlySet<string> = new Set([
  '__HELP__',
  '__STATS__',
  '__COST__',
  '__TOOLS__',
  '__WHOAMI__',
  '__STATUS__',
  '__FEATURES__',
  // C-batch: read-only info commands (registered in EnhancedCommandHandler).
  '__HISTORY__',
  '__LOG__',
  '__WORKSPACE__', // detect/show workspace config (read-only)
  '__DIFF__', // show git/checkpoint diff (read-only)
]);

type UiEffectResolution =
  | { uiEffect: SlashUiEffectKind; args: string[] }
  | 'deny'
  | undefined;

/**
 * Map a token (+ its args) to a renderer-side Cowork effect, an honest denial,
 * or undefined (fall through to the headless engine path).
 *
 * S1: multi-agent commands route to Cowork-NATIVE orchestration
 * (`orchestrator.run` / launcher / fleet panel), NOT the headless CLI handlers —
 * only the native path emits the `subagent.*` events the SubAgentPanel observes
 * live (the OrchestratorBridge owns the event forwarding, so visibility does not
 * depend on which realm the MultiAgentSystem instance lives in). Subcommands we
 * don't drive yet are denied honestly rather than silently opening a launcher.
 *
 * `/clear` is intentionally absent: "clear chat" in a persistent, multi-session
 * GUI is ambiguous (clear the view vs. start a new session) and deserves its own
 * decision — it falls through to the honest "not yet pilotable" path.
 */
function resolveUiEffectAction(token: string, args: string[]): UiEffectResolution {
  switch (token) {
    case '__CHANGE_MODEL__':
      return { uiEffect: 'open_model_picker', args };
    case '__PLAN_MODE__':
      // `/plan` → enter read-only plan permission mode (S4).
      return { uiEffect: 'set_plan_mode', args: [] };
    case '__SWARM__':
    case '__PARALLEL__':
      // `/swarm <task>` launches immediately (parallel strategy); bare `/swarm`
      // opens the launcher (mirrors the CLI's accidental-trigger guard).
      return args.length > 0
        ? { uiEffect: 'run_orchestrator', args }
        : { uiEffect: 'open_orchestrator_launcher', args: [] };
    case '__AGENTS__':
      // C1: the multi-agent cockpit. Any subcommand (run/plan/status/stop) is
      // managed in the launcher — open it (run/inspect agents there).
      return { uiEffect: 'open_orchestrator_launcher', args };
    case '__FLEET__':
      // C1: the Fleet Command Center is the cockpit for listen/status/route.
      return { uiEffect: 'open_fleet', args };
    case '__TEAM__':
      // C1: the Team panel is where start/add/status/task/assign happen.
      return { uiEffect: 'open_team', args };
    case '__LESSONS__':
      return { uiEffect: 'open_lessons', args };
    case '__COMPANION__':
      // C1: companion config cockpit.
      return { uiEffect: 'open_companion', args };
    case '__TRACK__':
      // C1: `/track` (spec-driven workflow) → the Spec backlog panel.
      return { uiEffect: 'open_spec', args };
    // C2: settings-backed commands open the relevant Settings tab.
    case '__CONFIG__':
      return { uiEffect: 'open_settings', args: ['general'] };
    case '__WORKFLOW__':
    case '__PIPELINE__':
      return { uiEffect: 'open_settings', args: ['workflows'] };
    case '__PERMISSIONS__':
    case '__POLICY__':
    case '__APPROVALS__':
    case '__ELEVATED__':
    case '__BATCH_REVIEW__':
    case '__SECURITY__':
      return { uiEffect: 'open_settings', args: ['rules'] };
    case '__HOOKS__':
      return { uiEffect: 'open_settings', args: ['hooks'] };
    case '__THEME__':
    case '__AVATAR__':
    case '__VIM_MODE__':
    case '__FAST_MODE__':
    case '__DRY_RUN__':
    case '__CACHE__':
    case '__PROMPT_CACHE__':
    case '__SELF_HEALING__':
      return { uiEffect: 'open_settings', args: ['general'] };
    // C-batch: generic panel opens (each key maps to a confirmed store setter).
    case '__SEARCH__':
      return { uiEffect: 'open_panel', args: ['global_search'] };
    case '__SHORTCUTS__':
      return { uiEffect: 'open_panel', args: ['shortcuts'] };
    case '__PERSONA__':
      return { uiEffect: 'open_panel', args: ['persona'] };
    case '__SESSIONS__':
      return { uiEffect: 'open_panel', args: ['session_insights'] };
    case '__REMEMBER__':
      return { uiEffect: 'open_panel', args: ['memory'] };
    case '__IDENTITY__':
      return { uiEffect: 'open_panel', args: ['identity'] };
    case '__SUBAGENT__':
    case '__AGENT__':
      return { uiEffect: 'open_orchestrator_launcher', args };
    default:
      return undefined;
  }
}

/** Resolve a natural-language prompt command's text (substitute `{{args}}` or append). */
function resolvePromptCommandText(prompt: string, args: string[]): string {
  const joined = args.join(' ').trim();
  if (prompt.includes('{{args}}')) {
    return prompt.replace(/\{\{args\}\}/g, joined);
  }
  return joined ? `${prompt}\n\n${joined}` : prompt;
}

export class SlashCommandBridge {
  /** List built-in + user-defined slash commands (flat). */
  async listCommands(): Promise<SlashCommandDef[]> {
    const mod = await loadSlashModule();
    const builtins: SlashCommandDef[] = [];
    if (mod) {
      try {
        const byCategory = mod.getCommandsByCategory();
        for (const [category, commands] of Object.entries(byCategory)) {
          for (const cmd of commands) {
            builtins.push({ ...cmd, category });
          }
        }
      } catch (err) {
        logWarn('[SlashCommandBridge] Failed to list commands:', err);
      }
    }

    // Phase 3 step 6: merge user-defined commands (custom category).
    const customs = (() => {
      try {
        return getCustomCommandsService().list();
      } catch {
        return [] as SlashCommandDef[];
      }
    })();

    // Custom names take precedence over built-ins with the same name.
    const customNames = new Set(customs.map((c) => c.name));
    const synthetic = SYNTHETIC_COMMANDS.filter(
      (item) => !customNames.has(item.name) && !builtins.some((builtin) => builtin.name === item.name)
    );
    return [...customs, ...synthetic, ...builtins.filter((b) => !customNames.has(b.name))];
  }

  /** Autocomplete suggestions for a `/` prefix (e.g. `/mem` → memory, mem-list). */
  async autocomplete(prefix: string, limit = 20): Promise<SlashCommandDef[]> {
    const all = await this.listCommands();
    const trimmed = prefix.trim().toLowerCase();
    const query = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;

    if (!query) return all.slice(0, limit);

    // Two-tier scoring: exact prefix > substring match
    const exact: SlashCommandDef[] = [];
    const substr: SlashCommandDef[] = [];
    for (const cmd of all) {
      const name = cmd.name.toLowerCase();
      if (name.startsWith(query)) exact.push(cmd);
      else if (name.includes(query) || cmd.description.toLowerCase().includes(query))
        substr.push(cmd);
    }
    return [...exact, ...substr].slice(0, limit);
  }

  /**
   * Execute a slash command. Returns a prompt that should be sent to the LLM,
   * or a `handled: true` result when the command was fully handled client-side
   * (e.g. `/clear`, `/help`, `/theme`).
   *
   * For now this implementation is prompt-rewriting only: the majority of
   * built-in commands use `__TOKEN__` prompts that the engine runner should
   * interpret, or they're natural-language prompts that we can forward as-is.
   * Commands that require stateful client handling (`__CLEAR_CHAT__`,
   * `__HELP__`, `__HISTORY__`, etc.) return `handled: true` with a message
   * so the renderer can react.
   */
  async execute(
    name: string,
    args: string[] = [],
    _sessionId?: string
  ): Promise<SlashCommandExecuteResult> {
    const all = await this.listCommands();
    const cmd = all.find((c) => c.name === name);
    if (!cmd) {
      return { success: false, error: `Unknown command: /${name}` };
    }

    if (cmd.name === 'schedule') {
      const createInput = buildScheduleCreateInputFromArgs(args);
      return {
        success: true,
        handled: true,
        message: createInput ? '__CREATE_SCHEDULE__' : '__OPEN_SCHEDULE__',
        action: createInput
          ? {
              type: 'create_schedule',
              createInput,
            }
          : {
              type: 'open_schedule',
              draft: parseScheduleSlashArgs(args),
            },
      };
    }

    // Special tokens (`__FOO__`): split between renderer-side presentation
    // effects and real headless engine behaviour. We no longer surface the raw
    // token as a toast — that was discovery-without-piloting.
    if (cmd.prompt.startsWith('__') && cmd.prompt.endsWith('__')) {
      const token = cmd.prompt;

      // 1. Renderer-side Cowork effect / honest denial / fall-through to engine.
      const resolution = resolveUiEffectAction(token, args);
      if (resolution === 'deny') {
        return {
          success: true,
          handled: true,
          message: `/${name} n'est pas encore pilotable depuis Cowork (à venir dans une prochaine étape).`,
        };
      }
      if (resolution) {
        return {
          success: true,
          handled: true,
          action: { type: 'ui_effect', uiEffect: resolution.uiEffect, args: resolution.args },
        };
      }

      // 2. Engine behaviour → run headlessly via the shared handler (default-deny).
      const headlessMod = await loadHeadlessModule();
      if (!headlessMod) {
        return { success: true, handled: true, message: `/${name} indisponible (moteur non chargé).` };
      }
      const res = await headlessMod.executeHeadlessSlashToken(token, args, COWORK_HEADLESS_ALLOW);
      if (res.denied) {
        return {
          success: true,
          handled: true,
          message: `/${name} n'est pas encore pilotable depuis Cowork (à venir dans une prochaine étape).`,
        };
      }
      if (res.passToAI && res.prompt) {
        return { success: true, prompt: res.prompt, handled: false };
      }
      if (res.output) {
        return { success: true, handled: true, output: res.output };
      }
      return {
        success: true,
        handled: true,
        message: res.reason ? `/${name}: ${res.reason}` : `/${name} exécuté.`,
      };
    }

    // Natural-language prompt commands: substitute {{args}} or append.
    return {
      success: true,
      prompt: resolvePromptCommandText(cmd.prompt, args),
      handled: false,
    };
  }

  async executeRemoteInput(
    rawInput: string,
    _sessionId?: string
  ): Promise<RemoteSlashCommandResult> {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) {
      return { allowed: true, prompt: rawInput };
    }

    const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
    const [name, ...args] = parts;
    if (!name) {
      return { allowed: false, message: 'Empty slash command is not available remotely.' };
    }

    // Classify from the catalog WITHOUT executing. A remote (mobile) input must
    // never trigger engine command side effects as a byproduct of deciding to
    // block it — only forwardable natural-language prompt commands are allowed.
    const all = await this.listCommands();
    const cmd = all.find((c) => c.name === name);
    if (!cmd) {
      return { allowed: false, message: `/${name} is not available in remote sessions.` };
    }

    const isToken = cmd.prompt.startsWith('__') && cmd.prompt.endsWith('__');
    if (isToken || cmd.name === 'schedule') {
      return { allowed: false, message: `/${name} is not available in remote sessions.` };
    }

    return { allowed: true, prompt: resolvePromptCommandText(cmd.prompt, args) };
  }
}
