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

export type SlashCommandAvailability =
  | { status: 'available' }
  | { status: 'hidden' }
  | { status: 'unavailable'; reason: string };

export interface SlashCommandDef {
  name: string;
  description: string;
  prompt: string;
  category?: string;
  isBuiltin: boolean;
  arguments?: SlashCommandArg[];
  /** Cowork availability computed by the main process (P4). The renderer never widens it. */
  availability?: SlashCommandAvailability;
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
  | 'open_panel'
  | 'engine_action';

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
  /** P4 single declaration (src/commands/slash/surfaces.ts). Absent in older builds → fail closed. */
  coworkHeadlessAllowlist?: () => ReadonlySet<string>;
  resolveSlashAvailability?: (
    command: Pick<SlashCommandDef, 'name' | 'prompt'>,
    surface: 'cowork'
  ) => SlashCommandAvailability;
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
  {
    // `/deep <topic>` — Deep Research discoverability (Pattern A). We do NOT
    // spawn the CLI here: `execute()` intercepts by name, parses the optional
    // flags, and forwards a guidance prompt that steers the agent to call the
    // core `deep_research` tool itself — so the cited report streams into the
    // chat through the normal agentic loop. The `prompt` below is only the
    // graceful fallback (natural-language, `{{args}}`) if that interception is
    // ever bypassed; it still forwards a usable Deep Research instruction.
    name: 'deep',
    description: 'Deep Research: a multi-source, CITED report on a topic (agent calls deep_research)',
    prompt:
      'Use the deep_research tool (mode: deep) to produce a multi-source, cited report, then present it verbatim with its [n] citations and "## Références" section. Topic: {{args}}',
    category: 'research',
    isBuiltin: true,
    arguments: [
      {
        name: 'topic',
        description: 'The research question or topic to investigate',
        required: true,
      },
      {
        name: 'options',
        description: 'Optional: --iterations N (gap-loop rounds 1-3) | --perspectives N (STORM, 2-6)',
        required: false,
      },
    ],
  },
];

export interface DeepSlashArgs {
  topic: string;
  /** Deep Research gap-analysis rounds (clamped 1-3). */
  iterations?: number;
  /** STORM diversified perspectives (clamped 2-6). */
  perspectives?: number;
}

/**
 * Parse `/deep <topic> [--iterations N] [--perspectives N]` args (order-agnostic).
 * Supports both `--iterations 2` and `--iterations=2`. Everything that isn't a
 * recognised flag is treated as part of the topic. Pure — unit-tested.
 */
export function parseDeepSlashArgs(args: string[]): DeepSlashArgs {
  const topicParts: string[] = [];
  let iterations: number | undefined;
  let perspectives: number | undefined;

  const setFlag = (key: string, value: number): void => {
    if (!Number.isFinite(value)) return;
    if (key === 'iterations') iterations = Math.max(1, Math.min(3, Math.trunc(value)));
    else if (key === 'perspectives') perspectives = Math.max(2, Math.min(6, Math.trunc(value)));
  };

  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (!tok) continue;
    const inline = tok.match(/^--(iterations|perspectives)=(-?\d+)$/i);
    if (inline) {
      const key = inline[1]?.toLowerCase();
      const num = inline[2];
      if (key && num !== undefined) setFlag(key, parseInt(num, 10));
      continue;
    }
    const flag = tok.toLowerCase();
    if (flag === '--iterations' || flag === '--perspectives') {
      const raw = args[i + 1];
      const value = raw !== undefined ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(value)) {
        setFlag(flag.slice(2), value);
        i++; // consume the value token
      }
      continue;
    }
    topicParts.push(tok);
  }

  return {
    topic: topicParts.join(' ').trim(),
    ...(iterations !== undefined ? { iterations } : {}),
    ...(perspectives !== undefined ? { perspectives } : {}),
  };
}

/**
 * Build the Pattern-A guidance prompt for `/deep`. This is forwarded to the LLM,
 * which then calls the core `deep_research` tool itself (the report streams into
 * the chat via the normal agentic loop). Pure — unit-tested.
 */
export function buildDeepResearchGuidance(parsed: DeepSlashArgs): string {
  const lines: string[] = [
    '[Deep Research request]',
    'The user wants a DEEP, multi-source, CITED research report on the topic below.',
    'Call the `deep_research` tool with:',
    `- topic: ${JSON.stringify(parsed.topic)}`,
    "- mode: 'deep'",
  ];
  if (parsed.iterations !== undefined) {
    lines.push(`- iterations: ${parsed.iterations} (extra gap-analysis rounds — slower, more thorough)`);
  }
  if (parsed.perspectives !== undefined) {
    lines.push(
      `- perspectives: ${parsed.perspectives} (STORM: research from N diversified perspectives, then co-write an outline-first article)`,
    );
  }
  lines.push(
    'Present the returned report as-is: keep the numbered [n] citations and the "## Références" section intact.',
    '',
    `Topic: ${parsed.topic}`,
  );
  return lines.join('\n');
}

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
    ctx?: { conversationHistory?: unknown; client?: unknown; goalSessionKey?: string }
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
 * Headless allowlist: tokens that are safe to run headlessly from Cowork **today**.
 * Since P4 (2026-09-15) the list is DECLARED in core `src/commands/slash/surfaces.ts`
 * (`COWORK_TOKEN_SURFACES`, mode `headless`) and derived here at runtime through
 * `coworkHeadlessAllowlist()`; a core build without that export denies every
 * headless token (fail closed). The rationale below still governs that list.
 *
 * Scope is deliberately limited to info / read-only commands, plus
 * session-scoped goal state (`/goal`, `/subgoal`) that Cowork wires to the same
 * `cowork:<sessionId>` key used by the embedded engine's continuation loop.
 * For read-only commands, the worst-case failure mode is benign — if the
 * bridge's core module instance and the engine adapter's instance ever resolve
 * to different `dist/` realms (core-loader tries several candidate roots), a
 * read just returns empty/default data; it never lies about having changed
 * state.
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
 * - /quota is read-only; /bug + /coverage read process.cwd() (the Electron dir);
 *   /telemetry mutates; /export-formats and /export-list are home-based reads;
 *   /goal and /subgoal use a `cowork:<sessionId>` goal key per conversation;
 *   /resources (P8) reads the home-based resource catalog without probing.
 */
const EMPTY_ALLOW: ReadonlySet<string> = new Set();

function coworkHeadlessAllow(mod: CoreSlashModule | null): ReadonlySet<string> {
  try {
    return mod?.coworkHeadlessAllowlist?.() ?? EMPTY_ALLOW;
  } catch {
    return EMPTY_ALLOW;
  }
}

function buildCoworkGoalSessionKey(sessionId: string | undefined): string | undefined {
  const trimmed = sessionId?.trim();
  return trimmed ? `cowork:${trimmed}` : undefined;
}

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
type UiEffectBuilder = (args: string[]) => { uiEffect: SlashUiEffectKind; args: string[] };

const settingsTab = (tab: string): UiEffectBuilder => () => ({ uiEffect: 'open_settings', args: [tab] });
const panel = (key: string): UiEffectBuilder => () => ({ uiEffect: 'open_panel', args: [key] });
// `/swarm <task>` launches immediately (parallel strategy); bare `/swarm` opens the
// launcher (mirrors the CLI's accidental-trigger guard). `/batch <goal>` and
// `/parallel` decompose into parallel sub-agents in the same cockpit.
const orchestrate: UiEffectBuilder = (args) => args.length > 0
  ? { uiEffect: 'run_orchestrator', args }
  : { uiEffect: 'open_orchestrator_launcher', args: [] };

/**
 * Token → Cowork effect table. Enumerable so the P4 invariant test can compare it
 * with the core declaration (`COWORK_TOKEN_SURFACES` mode `ui_effect`).
 * NB: scan/review ACTIONS (/vulns, /secrets-scan, /security-review, /guardian) are
 * deliberately NOT routed to the rules tab (it would not run the scan); /yolo and
 * /autonomy have no control there, so they stay CLI.
 */
const UI_EFFECTS: Readonly<Record<string, UiEffectBuilder>> = {
  __CHANGE_MODEL__: (args) => ({ uiEffect: 'open_model_picker', args }),
  __SWITCH__: (args) => ({ uiEffect: 'open_model_picker', args }),
  // `/plan` → enter read-only plan permission mode (S4).
  __PLAN_MODE__: () => ({ uiEffect: 'set_plan_mode', args: [] }),
  __SWARM__: orchestrate,
  __PARALLEL__: orchestrate,
  __BATCH__: orchestrate,
  // C1 cockpits: multi-agent launcher, Fleet Command Center, Team, lessons, companion, spec backlog.
  __AGENTS__: (args) => ({ uiEffect: 'open_orchestrator_launcher', args }),
  __FLEET__: (args) => ({ uiEffect: 'open_fleet', args }),
  __TEAM__: (args) => ({ uiEffect: 'open_team', args }),
  __LESSONS__: (args) => ({ uiEffect: 'open_lessons', args }),
  __COMPANION__: (args) => ({ uiEffect: 'open_companion', args }),
  __TRACK__: (args) => ({ uiEffect: 'open_spec', args }),
  // C2: settings-backed commands open the relevant Settings tab.
  __CONFIG__: settingsTab('general'),
  __WORKFLOW__: settingsTab('workflows'),
  __PIPELINE__: settingsTab('workflows'),
  __PERMISSIONS__: settingsTab('rules'),
  __POLICY__: settingsTab('rules'),
  __APPROVALS__: settingsTab('rules'),
  __ELEVATED__: settingsTab('rules'),
  __BATCH_REVIEW__: settingsTab('rules'),
  __SECURITY__: settingsTab('rules'),
  __HOOKS__: settingsTab('hooks'),
  __PLUGINS__: settingsTab('plugins'),
  __PLUGIN__: settingsTab('plugins'),
  __THEME__: settingsTab('general'),
  __AVATAR__: settingsTab('general'),
  __VIM_MODE__: settingsTab('general'),
  __FAST_MODE__: settingsTab('general'),
  __DRY_RUN__: settingsTab('general'),
  __CACHE__: settingsTab('general'),
  __PROMPT_CACHE__: settingsTab('general'),
  __SELF_HEALING__: settingsTab('general'),
  // C-batch: generic panel opens (each key maps to a confirmed store setter).
  __SEARCH__: panel('global_search'),
  __SHORTCUTS__: panel('shortcuts'),
  __PERSONA__: panel('persona'),
  __SESSIONS__: panel('session_insights'),
  __REMEMBER__: panel('memory'),
  __IDENTITY__: panel('identity'),
  __PAIRING__: panel('device'),
  // `/voice` → voice-chat overlay; `/export` `/save` → ExportDialog of the active session.
  __VOICE__: panel('voice'),
  __SPEAK__: panel('voice'),
  __TTS__: panel('voice'),
  __EXPORT__: panel('export'),
  __SAVE_CONVERSATION__: panel('export'),
  __TEST__: panel('test_runner'),
  __THINK__: panel('reasoning'),
  // `/knowledge-graph` → lessons-vault graph in the Fleet Command Center.
  __KNOWLEDGE_GRAPH__: panel('knowledge_graph'),
  // Engine actions: real side-effecting ops the renderer triggers via IPC.
  __UNDO__: () => ({ uiEffect: 'engine_action', args: ['undo'] }),
  __REDO__: () => ({ uiEffect: 'engine_action', args: ['redo'] }),
  __SUBAGENT__: (args) => ({ uiEffect: 'open_orchestrator_launcher', args }),
  __AGENT__: (args) => ({ uiEffect: 'open_orchestrator_launcher', args }),
};

/** Tokens with a native Cowork effect (exported for the P4 invariant test). */
export const COWORK_UI_EFFECT_TOKENS: readonly string[] = Object.freeze(Object.keys(UI_EFFECTS));

function resolveUiEffectAction(token: string, args: string[]): UiEffectResolution {
  const builder = UI_EFFECTS[token];
  return builder ? builder(args) : undefined;
}

const COWORK_DENIED_FALLBACK = "n'est pas encore pilotable depuis Cowork (à venir dans une prochaine étape).";

type CoreHintsModule = { takeFirstUseHint?: (id: 'surface_unavailable', lang: 'fr') => string | null };

/** First refusal in this profile gets one persisted tip (P4 first-use hints); fails closed to no tip. */
async function firstRefusalTip(): Promise<string> {
  try {
    const mod = await loadCoreModule<CoreHintsModule>('utils/first-use-hints.js');
    const tip = mod?.takeFirstUseHint?.('surface_unavailable', 'fr');
    return tip ? `\n${tip}` : '';
  } catch {
    return '';
  }
}

/** Cowork availability of a catalog entry, computed only in the main process. */
function coworkAvailability(cmd: SlashCommandDef, mod: CoreSlashModule | null): SlashCommandAvailability {
  const isToken = cmd.prompt.startsWith('__') && cmd.prompt.endsWith('__');
  if (!isToken) return { status: 'available' };
  if (mod?.resolveSlashAvailability) {
    try {
      return mod.resolveSlashAvailability(cmd, 'cowork');
    } catch {
      // fall through to the conservative local rule
    }
  }
  // Older core build: only native effects are known to be pilotable.
  return UI_EFFECTS[cmd.prompt]
    ? { status: 'available' }
    : { status: 'unavailable', reason: 'moteur sans déclaration de surfaces : commande non pilotable depuis Cowork' };
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
    // P4: availability is decided here (main process), from the core declaration.
    // Hidden entries are removed; unavailable ones stay listed with their reason.
    const annotate = (cmd: SlashCommandDef): SlashCommandDef => ({ ...cmd, availability: coworkAvailability(cmd, mod) });
    return [
      ...customs.map((c) => ({ ...c, availability: { status: 'available' as const } })),
      ...synthetic.map(annotate),
      ...builtins.filter((b) => !customNames.has(b.name)).map(annotate),
    ].filter((cmd) => cmd.availability?.status !== 'hidden');
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
    sessionId?: string
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

    // `/deep <topic> [--iterations N] [--perspectives N]` — Deep Research
    // (Pattern A): forward a guidance prompt so the agent calls `deep_research`
    // itself and streams the cited report into the chat. No CLI spawn here.
    if (cmd.name === 'deep') {
      const parsed = parseDeepSlashArgs(args);
      if (!parsed.topic) {
        return {
          success: true,
          handled: true,
          message: 'Usage : /deep <sujet> [--iterations N] [--perspectives N]',
        };
      }
      return {
        success: true,
        prompt: buildDeepResearchGuidance(parsed),
        handled: false,
      };
    }

    // Special tokens (`__FOO__`): split between renderer-side presentation
    // effects and real headless engine behaviour. We no longer surface the raw
    // token as a toast — that was discovery-without-piloting.
    if (cmd.prompt.startsWith('__') && cmd.prompt.endsWith('__')) {
      const token = cmd.prompt;

      // 0. Availability is re-derived server-side: a forged IPC call or a stale
      //    renderer list can never run an undeclared token (default-deny).
      const slashMod = await loadSlashModule();
      const availability = coworkAvailability(cmd, slashMod);
      if (availability.status !== 'available') {
        const reason = availability.status === 'unavailable' ? availability.reason : 'masquée dans Cowork';
        return {
          success: true,
          handled: true,
          message: `/${name} ${COWORK_DENIED_FALLBACK} (${reason})${await firstRefusalTip()}`,
        };
      }

      // 1. Renderer-side Cowork effect / honest denial / fall-through to engine.
      const resolution = resolveUiEffectAction(token, args);
      if (resolution === 'deny') {
        return {
          success: true,
          handled: true,
          message: `/${name} ${COWORK_DENIED_FALLBACK}`,
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
      const res = await headlessMod.executeHeadlessSlashToken(token, args, coworkHeadlessAllow(slashMod), {
        goalSessionKey: buildCoworkGoalSessionKey(sessionId),
      });
      if (res.denied) {
        return {
          success: true,
          handled: true,
          message: `/${name} ${COWORK_DENIED_FALLBACK}`,
        };
      }
      if (res.passToAI && res.prompt) {
        return { success: true, prompt: res.prompt, output: res.output, handled: false };
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
