/**
 * Fleet tick handler — Phase (d).18 (Autonomous Fleet Protocol v0.1).
 *
 * Native TypeScript port of `claude-et-patrice/tools/heartbeat_tick.py`,
 * which has been operational since 2026-05-02 (6+ successful cycles).
 * The port lets Code Buddy run the fleet protocol in-process — no
 * external Python script, no Task Scheduler, works on Linux. The
 * Python wrapper remains as the V0 reference until this is validated.
 *
 * Flow per tick (mirrors the python wrapper, see lines 174-352):
 *   1. Pre-flight: dirty-repo check on the fleet repo path.
 *   2. `git pull --rebase` to converge state.
 *   3. FLEET_PAUSE keyword check on `.codebuddy/HEARTBEAT.md`.
 *   4. Pick top task: status=open, claimedBy=null, sorted by priority.
 *   5. Atomic claim: mutate JSON, commit, push. If push rejected
 *      another host beat us — pull and abort.
 *   6. Spawn an in-process CodeBuddyAgent with a strict task prompt.
 *      Agent must emit a JSON line at end with `summary/files_modified
 *      /issues/next_steps`.
 *   7. Scope guard: if `git diff --name-only` includes files outside
 *      `task.filesToModify`, rollback + mark blocked.
 *   8. Append worklog entry; mark task completed; commit + push.
 *
 * All git interactions go through `runGit` which uses Node's `execFile`
 * (no shell, args passed as an array — immune to shell injection by
 * construction). External callers must inject a `gitRun` for tests.
 *
 * Garde-fous (proposition section 5):
 *   - max 1 task per tick
 *   - priority-critical SKIPPED for autonomous claim (`priorityThreshold`)
 *   - hard timeout via `maxTaskMs`
 *   - FLEET_PAUSE = file-based kill switch
 *   - append-only worklog
 *   - F2: `git pull --rebase` before any push
 *
 * @module src/agent/autonomous/fleet-tick-handler
 */

import * as childProcess from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import {
  resolveProviderFromEnv,
  type PeerChatProviderId,
} from '../../fleet/peer-chat-client-factory.js';
import {
  PRIORITY_RANK,
  type AgentTaskOutput,
  type FleetTask,
  type FleetTasksFile,
  type FleetTaskPriority,
  type FleetTickOutcome,
  type PresenceFile,
  type WorklogFile,
  type WorklogFileEntry,
} from './fleet-task-types.js';
import { loadRelevantSagaLessons } from '../../fleet/saga-store.js';

// Promisify the safer arg-array variant. Args never go through a shell.
const execFileP = promisify(childProcess.execFile);

const DEFAULT_MAX_TASK_MS = 600_000; // 10 min, mirrors python wrapper

/**
 * Phase (d).20 — provider tuple resolved per-tick. The tick logs this
 * and embeds a slimmer version into the worklog for cost audit.
 */
export interface ResolvedTickProvider {
  provider: string;
  model: string;
  isLocal: boolean;
  apiKey: string;
  baseUrl: string;
  /** Why this provider was chosen — useful for debugging and audit. */
  reason: 'preferLocal' | 'config:cloud' | 'config:auto' | 'config:explicit' | 'fallback';
}

export type AutonomousLlmProvider = 'cloud' | 'auto' | PeerChatProviderId;

export interface FleetTickOptions {
  /** Absolute path to the claude-et-patrice repo (fleet bus). */
  repoPath: string;
  /** Host identifier, e.g. `ministar/grok-cli`. */
  host: string;
  /** Hard cap on the agent's wall-clock time per task. Default 600 000 ms. */
  maxTaskMs?: number;
  /**
   * Phase 2 (Hermes auto-chain) — per-stage wall-clock cap when the
   * claimed task has `chainRoles`. Defaults to `maxTaskMs / chainRoles.length`.
   * Useful in tests to force a fast timeout in one stage without
   * blowing past the test runner deadline.
   */
  maxStageMs?: number;
  /** Lowest priority that the autonomous tick will claim. Default 'high'
   *  (i.e. critical is SKIPPED — needs human validation). */
  priorityThreshold?: FleetTaskPriority;
  /**
   * Phase (d).20 — LLM provider selection for the autonomous agent.
   * `'cloud'` (default V0.1) → GROK env. `'auto'` → factory auto-detect.
   * Explicit provider id → force that provider. Per-task `preferLocal`
   * overrides this for that task only (when Ollama is configured).
   */
  llmProvider?: AutonomousLlmProvider;
  /** When true, no mutations to disk or git. For dry-run/tests. */
  dryRun?: boolean;
  /**
   * Inject a custom agent invoker for tests. Receives the prompt and
   * the resolved provider tuple (test mocks may ignore the latter).
   * Default: spawn a CodeBuddyAgent in-process keyed on the provider.
   */
  agentRun?: (
    prompt: string,
    timeoutMs: number,
    provider?: ResolvedTickProvider,
  ) => Promise<{ stdout: string; timedOut: boolean }>;
  /** Inject a custom git runner for tests. */
  gitRun?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string; code: number }>;
}

/** GROK fallback used by the V0.1 'cloud' default and the safety-net fallback. */
function buildGrokEnvProvider(reason: ResolvedTickProvider['reason']): ResolvedTickProvider {
  return {
    provider: 'grok',
    model: process.env.GROK_MODEL || 'grok-3',
    isLocal: false,
    apiKey: process.env.GROK_API_KEY || '',
    baseUrl: process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
    reason,
  };
}

/**
 * Phase (d).20 — resolve which LLM provider to use for a given task.
 *
 * Priority cascade:
 *   1. `task.preferLocal=true` AND `OLLAMA_HOST` set → ollama
 *   2. `llm_provider='cloud'` (default V0.1) → GROK env
 *   3. `llm_provider='auto'` → factory auto-detect (Ollama → grok → ...)
 *   4. `llm_provider='<id>'` → force that provider via factory
 *   5. Fallback (factory failed): GROK env (V0.1 behavior)
 *
 * Pure function. Logs at warn level when fallthrough happens so users
 * can spot misconfigs without losing the task to a hard error.
 */
export function resolveTickProvider(
  task: Pick<FleetTask, 'preferLocal'>,
  configProvider: AutonomousLlmProvider | undefined,
): ResolvedTickProvider {
  // 1. Per-task override
  if (task.preferLocal) {
    // Fleet's "prefer" contract falls through when no local endpoint was
    // configured. The generic provider factory also supports explicit Ollama
    // at its conventional default URL, which is too strong for this probe.
    const r = process.env.OLLAMA_HOST?.trim()
      ? resolveProviderFromEnv('ollama')
      : null;
    if (r) {
      return { ...r, reason: 'preferLocal' };
    }
    logger.warn(
      '[fleet-tick] task.preferLocal=true but OLLAMA_HOST is not set — falling through to host config',
    );
  }
  // 2. cloud (default)
  const cfg = configProvider ?? 'cloud';
  if (cfg === 'cloud') {
    return buildGrokEnvProvider('config:cloud');
  }
  // 3. auto or explicit
  const r = cfg === 'ollama' && !process.env.OLLAMA_HOST?.trim()
    ? null
    : resolveProviderFromEnv(cfg);
  if (r) {
    return { ...r, reason: cfg === 'auto' ? 'config:auto' : 'config:explicit' };
  }
  // 4. fallback
  logger.warn(`[fleet-tick] llm_provider="${cfg}" could not resolve — falling back to GROK env`);
  return buildGrokEnvProvider('fallback');
}

/** Internal: ISO-8601 UTC timestamp, second precision (mirrors python `now_iso`). */
function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Default git runner — uses execFile (no shell, args array). */
async function defaultGitRun(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

/**
 * Detect FLEET_PAUSE — must be the first non-empty, non-comment line
 * of HEARTBEAT.md. Mirror of the python wrapper's `fleet_paused`.
 */
export function isFleetPaused(heartbeatContent: string): boolean {
  for (const raw of heartbeatContent.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('>')) continue;
    return line === 'FLEET_PAUSE';
  }
  return false;
}

/**
 * Pick the top claimable task. Mirror of `pick_task` from the python
 * wrapper, plus a `priorityThreshold` filter so autonomous ticks
 * never claim `critical` tasks (those need human validation).
 */
export function pickTask(
  tasks: FleetTask[],
  priorityThreshold: FleetTaskPriority = 'high',
): FleetTask | null {
  // Autonomous policy: critical tasks are NEVER claimed by the tick — they
  // require human validation. Among non-critical, only claim priorities at
  // or above the threshold (e.g. threshold='high' → claim only high).
  const thresholdRank = PRIORITY_RANK[priorityThreshold];
  const claimable = tasks.filter(
    (t) =>
      t.status === 'open' &&
      !t.claimedBy &&
      t.priority !== 'critical' &&
      PRIORITY_RANK[t.priority] <= thresholdRank,
  );
  claimable.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const top = claimable[0];
  return top ?? null;
}

/**
 * Extract the JSON output from the agent's response. Tries the last 5
 * non-empty lines first (strict mode), then a regex fallback over the
 * trailing 4 KB. Mirror of python's `parse_claude_output`.
 */
export function parseAgentOutput(stdout: string): AgentTaskOutput | null {
  if (!stdout) return null;
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines.slice(-5).reverse()) {
    try {
      const obj = JSON.parse(line) as Partial<AgentTaskOutput>;
      if (obj && typeof obj === 'object' && typeof obj.summary === 'string') {
        return {
          summary: obj.summary,
          files_modified: Array.isArray(obj.files_modified) ? obj.files_modified : undefined,
          issues: Array.isArray(obj.issues) ? obj.issues : undefined,
          next_steps: Array.isArray(obj.next_steps) ? obj.next_steps : undefined,
        };
      }
    } catch {
      /* try previous line */
    }
  }
  // Fallback: regex on trailing 4 KB.
  const tail = stdout.slice(-4000);
  const m = /\{[^{}]*"summary"[\s\S]*?\}/.exec(tail);
  if (m) {
    try {
      const obj = JSON.parse(m[0]) as Partial<AgentTaskOutput>;
      if (obj && typeof obj.summary === 'string') {
        return {
          summary: obj.summary,
          files_modified: Array.isArray(obj.files_modified) ? obj.files_modified : undefined,
          issues: Array.isArray(obj.issues) ? obj.issues : undefined,
          next_steps: Array.isArray(obj.next_steps) ? obj.next_steps : undefined,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Build the agent prompt for a claimed task. Mirror of
 * `build_claude_prompt` from the python wrapper. Strict JSON output
 * protocol so the tick handler can parse the result deterministically.
 */
export function buildTaskPrompt(host: string, task: FleetTask): string {
  const filesListing = task.filesToModify.join(', ') || '(aucun listé)';
  const criteria =
    task.acceptanceCriteria.map((c) => `  - ${c}`).join('\n') || '  - (aucun)';
  return [
    `Tu es Claude/${host} dans le fleet autonome (cf. claude-et-patrice/propositions/AUTONOMOUS-FLEET-PROTOCOL-2026-05-02.md).`,
    `Tu viens de claimer la tâche ${task.id} :`,
    '',
    `TITRE : ${task.title}`,
    '',
    `DESCRIPTION :`,
    task.description,
    '',
    `FILES AUTORISÉS À MODIFIER : ${filesListing}`,
    '',
    `ACCEPTANCE CRITERIA :`,
    criteria,
    '',
    `Action :`,
    `1. Exécute la tâche en respectant strictement la liste des fichiers autorisés.`,
    `2. Ne modifie AUCUN autre fichier.`,
    `3. Ne fais AUCUN commit ni push (le wrapper s'en charge).`,
    `4. À la toute fin de ta réponse, sur la DERNIÈRE LIGNE, output un objet JSON conforme :`,
    `{"summary": "...", "files_modified": [{"file": "...", "changes": "..."}], "issues": [], "next_steps": []}`,
    '',
    `Aucun texte après ce JSON. Le wrapper parse strictement la dernière ligne.`,
  ].join('\n');
}

/**
 * Phase G — Hermes-style sequential collaboration on the autonomous
 * tick. Each role gets its own `agentRun` call; the previous stage's
 * parsed summary is threaded into the next stage's prompt so the
 * reviewer/tester have context without an extra RPC.
 *
 * Returns the **last** stage's stdout as the canonical output (worklog
 * uses the last stage's parsed summary), the aggregated `timedOut`
 * flag (true when any stage timed out), and a per-stage breakdown for
 * audit.
 *
 * On any stage timeout, the function returns early — subsequent stages
 * are skipped. The worklog ends up with fewer `chainStages` entries
 * than `roles.length`, which downstream consumers treat as a partial
 * chain (chain-broke detection).
 */
async function runFleetTickChain(args: {
  roles: string[];
  basePrompt: string;
  task: FleetTask;
  agentRun: NonNullable<FleetTickOptions['agentRun']>;
  maxTaskMs: number;
  maxStageMs?: number;
  provider: ResolvedTickProvider;
}): Promise<{
  stdout: string;
  timedOut: boolean;
  stages: NonNullable<WorklogFileEntry['chainStages']>;
}> {
  const perStage = Math.max(
    1,
    args.maxStageMs ?? Math.floor(args.maxTaskMs / Math.max(1, args.roles.length)),
  );
  const stages: NonNullable<WorklogFileEntry['chainStages']> = [];
  let lastStdout = '';
  let priorParsed: AgentTaskOutput | null = null;
  for (const role of args.roles) {
    const stagePrompt = buildChainStagePrompt(role, args.basePrompt, args.task, priorParsed);
    const stageStart = Date.now();
    let stageStdout = '';
    let stageTimedOut = false;
    try {
      const result = await args.agentRun(stagePrompt, perStage, args.provider);
      stageStdout = result.stdout;
      stageTimedOut = result.timedOut;
    } catch (err) {
      stageTimedOut = (err as Error).message === 'FLEET_TICK_TIMEOUT';
      if (!stageTimedOut) throw err; // unexpected — propagate to outer handler
    }
    const elapsedSeconds = Math.round((Date.now() - stageStart) / 1000);
    const parsed = parseAgentOutput(stageStdout);
    stages.push({
      role,
      summary: parsed?.summary ?? '(non-JSON output)',
      ...(stageTimedOut ? { timedOut: true } : {}),
      elapsedSeconds,
    });
    if (stageTimedOut) {
      // Chain breaks — return what we have so the worklog records the
      // partial trace and the outer handler flips the task to blocked.
      return { stdout: lastStdout, timedOut: true, stages };
    }
    lastStdout = stageStdout;
    priorParsed = parsed;
  }
  return { stdout: lastStdout, timedOut: false, stages };
}

/**
 * Compose a per-stage prompt for {@link runFleetTickChain}. The first
 * stage uses the base prompt unchanged. Later stages prepend a
 * role-specific framing and a (truncated) summary of the prior stage's
 * output so the next agent has context without re-running the work.
 *
 * Truncation: prior summary capped at 1500 chars to keep stage prompts
 * bounded (worst case ~ basePrompt + 1.5 KB per stage).
 */
export function buildChainStagePrompt(
  role: string,
  basePrompt: string,
  task: FleetTask,
  prior: AgentTaskOutput | null,
): string {
  if (!prior) {
    // First stage — just the bare base prompt. Acceptance criteria
    // are already in there via buildTaskPrompt.
    return basePrompt;
  }
  const priorSummary =
    prior.summary.length > 1500 ? `${prior.summary.slice(0, 1497)}...` : prior.summary;
  const priorFiles = (prior.files_modified ?? [])
    .map((f) => `- ${f.file}: ${f.changes}`)
    .join('\n');
  const filesBlock = priorFiles ? `\n\nFiles touched in the previous stage:\n${priorFiles}` : '';
  if (role === 'review') {
    return [
      basePrompt,
      '',
      '# Stage: review',
      "Audit the previous stage's work. Flag bugs, missing tests, scope creep, security issues.",
      'Do NOT modify code at this stage — produce findings as a structured summary.',
      '',
      'Previous stage summary:',
      priorSummary,
      filesBlock,
    ].join('\n');
  }
  if (role === 'safe' || role === 'test') {
    return [
      basePrompt,
      '',
      '# Stage: test',
      "Write tests covering the reviewed implementation. Stay strictly inside `filesToModify`.",
      "Don't introduce new abstractions — assert behaviour, not internals.",
      '',
      'Previous stage summary:',
      priorSummary,
      filesBlock,
    ].join('\n');
  }
  // `research`, custom roles, etc. — generic framing.
  return [
    basePrompt,
    '',
    `# Stage: ${role}`,
    'Build on the previous stage with this role in mind.',
    '',
    'Previous stage summary:',
    priorSummary,
    filesBlock,
  ].join('\n');
}

/** Default in-process agent runner — used when no `agentRun` injected. */
async function defaultAgentRun(
  prompt: string,
  timeoutMs: number,
  provider?: ResolvedTickProvider,
): Promise<{ stdout: string; timedOut: boolean }> {
  // Lazy-import to avoid pulling the agent module at fleet-tick load time.
  const { CodeBuddyAgent } = await import('../codebuddy-agent.js');
  // V0.1 fallback: when no provider was resolved (test path, or someone
  // calling defaultAgentRun directly without going through runFleetTick),
  // use the GROK env that V0.1 used.
  const p = provider ?? buildGrokEnvProvider('config:cloud');
  const agent = new CodeBuddyAgent(p.apiKey, p.baseUrl, p.model, 50, false);

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('FLEET_TICK_TIMEOUT'));
    }, timeoutMs);
  });

  try {
    const entries = (await Promise.race([
      agent.processUserMessage(prompt),
      timeoutP,
    ])) as Array<{ type?: string; content?: string }>;
    const stdout = entries
      .filter((e) => e.type === 'assistant')
      .map((e) => e.content ?? '')
      .join('\n');
    return { stdout, timedOut: false };
  } catch (err) {
    if (timedOut) return { stdout: '', timedOut: true };
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readJsonFile<T>(p: string): Promise<T> {
  const raw = await fs.readFile(p, 'utf-8');
  return JSON.parse(raw) as T;
}

async function writeJsonFile(p: string, data: unknown): Promise<void> {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(p, json, 'utf-8');
}

async function appendWorklog(repoPath: string, entry: WorklogFileEntry): Promise<void> {
  const p = path.join(repoPath, '.codebuddy', 'colab-worklog.json');
  const file = await readJsonFile<WorklogFile>(p);
  file.entries = [...(file.entries ?? []), entry];
  await writeJsonFile(p, file);
}

async function updatePresence(
  repoPath: string,
  host: string,
  currentTask: string | null,
): Promise<void> {
  const p = path.join(repoPath, '.codebuddy', 'presence.json');
  let file: PresenceFile;
  try {
    file = await readJsonFile<PresenceFile>(p);
  } catch {
    file = { version: '0.1', agents: {} };
  }
  file.agents = file.agents ?? {};
  file.agents[host] = {
    host,
    lastSeen: nowIso(),
    status: 'active',
    currentTask,
  };
  await writeJsonFile(p, file);
}

/**
 * Run a single autonomous fleet tick. Returns a structured outcome
 * describing what happened. Never throws — all errors map to outcomes.
 */
export async function runFleetTick(opts: FleetTickOptions): Promise<FleetTickOutcome> {
  const repoPath = opts.repoPath;
  const host = opts.host;
  const maxTaskMs = opts.maxTaskMs ?? DEFAULT_MAX_TASK_MS;
  const priorityThreshold = opts.priorityThreshold ?? 'high';
  const dryRun = opts.dryRun ?? false;
  const git = opts.gitRun ?? defaultGitRun;
  const agentRun = opts.agentRun ?? defaultAgentRun;

  const codebuddyDir = path.join(repoPath, '.codebuddy');
  const tasksPath = path.join(codebuddyDir, 'colab-tasks.json');
  const heartbeatPath = path.join(codebuddyDir, 'HEARTBEAT.md');

  // 1. Pre-flight: dirty repo check
  const status = await git(['status', '--porcelain'], repoPath);
  if (status.stdout.trim()) {
    logger.warn('[fleet-tick] dirty repo, aborting tick', { stdout: status.stdout.trim() });
    return { kind: 'dirty_repo', status: status.stdout.trim() };
  }

  // 2. git pull --rebase (F2 doctrine)
  const pull = await git(['pull', '--rebase'], repoPath);
  if (pull.code !== 0) {
    logger.error('[fleet-tick] pull --rebase failed', { stderr: pull.stderr });
    return { kind: 'pull_failed', error: pull.stderr };
  }

  // 3. FLEET_PAUSE check
  let heartbeatContent = '';
  try {
    heartbeatContent = await fs.readFile(heartbeatPath, 'utf-8');
  } catch {
    /* file optional — same default as no-pause */
  }
  if (isFleetPaused(heartbeatContent)) {
    logger.info('[fleet-tick] FLEET_PAUSE detected — exiting cleanly');
    return { kind: 'fleet_paused' };
  }

  // 4. Pick task
  const tasksDoc = await readJsonFile<FleetTasksFile>(tasksPath);
  const task = pickTask(tasksDoc.tasks ?? [], priorityThreshold);
  if (!task) {
    logger.debug('[fleet-tick] HEARTBEAT_OK — no claimable task');
    if (!dryRun) {
      await updatePresence(repoPath, host, null);
      await git(['add', '.codebuddy/presence.json'], repoPath);
      const commit = await git(
        ['commit', '-m', `presence: ${host} heartbeat (no task)`],
        repoPath,
      );
      if (commit.code === 0) await git(['push'], repoPath);
    }
    return { kind: 'no_task' };
  }

  if (dryRun) {
    logger.info('[fleet-tick] DRY RUN — would claim task', { taskId: task.id });
    return { kind: 'no_task' };
  }

  // 5. Atomic claim
  task.status = 'in_progress';
  task.claimedBy = host;
  task.claimedAt = nowIso();
  await writeJsonFile(tasksPath, tasksDoc);
  await git(['add', '.codebuddy/colab-tasks.json'], repoPath);
  await git(['commit', '-m', `claim: ${task.id} by ${host}`], repoPath);
  const claimPush = await git(['push'], repoPath);
  if (claimPush.code !== 0) {
    logger.warn('[fleet-tick] claim push rejected — another host beat us', {
      taskId: task.id,
      stderr: claimPush.stderr,
    });
    await git(['pull', '--rebase'], repoPath);
    return { kind: 'claim_lost', taskId: task.id, error: claimPush.stderr };
  }
  logger.info('[fleet-tick] claimed task', { taskId: task.id, priority: task.priority });

  // 6. Resolve LLM provider for THIS task (Phase d.20).
  //    Cascade: task.preferLocal → llm_provider config → fallback GROK.
  const provider = resolveTickProvider(task, opts.llmProvider);
  logger.info('[fleet-tick] resolved LLM', {
    provider: provider.provider,
    model: provider.model,
    isLocal: provider.isLocal,
    reason: provider.reason,
    taskId: task.id,
  });

  // 7. Invoke agent — augment the prompt with relevant saga lessons
  // recalled from project memory. Phase E writes saga outcomes there;
  // here we read them back so the in-process agent inherits what past
  // chain sagas learned about similar goals. Best-effort: an empty
  // lessons array yields the bare prompt.
  const basePrompt = buildTaskPrompt(host, task);
  const lessons = await loadRelevantSagaLessons(`${task.title} ${task.description}`);
  const prompt =
    lessons.length > 0
      ? `${basePrompt}\n\n<recent_fleet_lessons>\n${lessons.join('\n')}\n</recent_fleet_lessons>`
      : basePrompt;
  const t0 = Date.now();
  let stdout = '';
  let timedOut = false;
  let chainStages: WorklogFileEntry['chainStages'] | undefined;
  try {
    if (task.chainRoles && task.chainRoles.length > 0) {
      // Phase G — opt-in Hermes chain on autonomous tick. Each role
      // gets its own agentRun call; later stages inherit earlier
      // stages' summaries via `buildChainStagePrompt`.
      const chainResult = await runFleetTickChain({
        roles: task.chainRoles,
        basePrompt: prompt,
        task,
        agentRun,
        maxTaskMs,
        maxStageMs: opts.maxStageMs,
        provider,
      });
      stdout = chainResult.stdout;
      timedOut = chainResult.timedOut;
      chainStages = chainResult.stages;
    } else {
      const result = await agentRun(prompt, maxTaskMs, provider);
      stdout = result.stdout;
      timedOut = result.timedOut;
    }
  } catch (err) {
    timedOut = (err as Error).message === 'FLEET_TICK_TIMEOUT';
    if (!timedOut) {
      stdout = '';
    }
  }
  const elapsedMs = Date.now() - t0;

  if (timedOut) {
    return await markBlocked(repoPath, host, task, tasksDoc, tasksPath, git, {
      reason: 'timeout',
      summary: `TIMEOUT — agent exceeded ${maxTaskMs}ms`,
      issues: [`timeout exceeded (${maxTaskMs}ms)`],
      nextSteps: ['investigate, retry with longer maxTaskMs, or split task'],
      filesModified: [],
      elapsedSeconds: Math.round(elapsedMs / 1000),
      provider: provider.provider,
      model: provider.model,
    });
  }

  // 8. Scope guard
  const diff = await git(['diff', '--name-only'], repoPath);
  const modifiedFiles = diff.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const allowed = new Set(task.filesToModify ?? []);
  const outOfScope =
    allowed.size > 0 ? modifiedFiles.filter((f) => !allowed.has(f)) : [];
  if (outOfScope.length > 0) {
    logger.warn('[fleet-tick] OUT_OF_SCOPE files modified — rolling back', {
      taskId: task.id,
      outOfScope,
    });
    await git(['checkout', '--', '.'], repoPath);
    return await markBlocked(repoPath, host, task, tasksDoc, tasksPath, git, {
      reason: 'out_of_scope',
      summary: `BLOCKED — agent wrote outside scope: ${outOfScope.join(', ')}`,
      issues: [`out_of_scope: ${outOfScope.join(', ')}`],
      nextSteps: ['redéfinir filesToModify ou tighter le prompt'],
      filesModified: modifiedFiles.map((f) => ({ file: f, changes: '(rolled back)' })),
      elapsedSeconds: Math.round(elapsedMs / 1000),
      provider: provider.provider,
      model: provider.model,
    });
  }

  // 9. Append worklog + mark completed
  const parsed = parseAgentOutput(stdout);
  const summary =
    parsed?.summary ?? '(agent returned non-JSON; output not parseable)';
  const filesModified =
    parsed?.files_modified ?? modifiedFiles.map((f) => ({ file: f, changes: '(unknown)' }));
  const issues = parsed?.issues ?? (parsed ? [] : ['no JSON parsed from agent output']);
  const nextSteps = parsed?.next_steps ?? [];

  await appendWorklog(repoPath, {
    id: `wl-${task.id}-${Math.floor(Date.now() / 1000)}`,
    date: nowIso(),
    agent: host,
    taskId: task.id,
    summary,
    filesModified,
    issues,
    nextSteps,
    elapsedSeconds: Math.round(elapsedMs / 1000),
    provider: provider.provider,
    model: provider.model,
    ...(chainStages ? { chainStages } : {}),
  });

  task.status = 'completed';
  task.completedAt = nowIso();
  await writeJsonFile(tasksPath, tasksDoc);
  await updatePresence(repoPath, host, null);
  await git(['add', '.'], repoPath);
  await git(['commit', '-m', `complete: ${task.id} by ${host}`], repoPath);
  const finalPush = await git(['push'], repoPath);
  if (finalPush.code !== 0) {
    logger.warn('[fleet-tick] final push failed', { stderr: finalPush.stderr });
  }
  logger.info('[fleet-tick] task completed', { taskId: task.id, elapsedMs });

  return { kind: 'completed', taskId: task.id, elapsedMs, summary };
}

async function markBlocked(
  repoPath: string,
  host: string,
  task: FleetTask,
  tasksDoc: FleetTasksFile,
  tasksPath: string,
  git: NonNullable<FleetTickOptions['gitRun']>,
  payload: {
    reason: 'timeout' | 'out_of_scope' | 'agent_error';
    summary: string;
    issues: string[];
    nextSteps: string[];
    filesModified: Array<{ file: string; changes: string }>;
    elapsedSeconds: number;
    provider?: string;
    model?: string;
  },
): Promise<FleetTickOutcome> {
  task.status = 'blocked';
  task.completedAt = nowIso();
  await writeJsonFile(tasksPath, tasksDoc);
  await appendWorklog(repoPath, {
    id: `wl-${task.id}-${Math.floor(Date.now() / 1000)}`,
    date: nowIso(),
    agent: host,
    taskId: task.id,
    summary: payload.summary,
    filesModified: payload.filesModified,
    issues: payload.issues,
    nextSteps: payload.nextSteps,
    elapsedSeconds: payload.elapsedSeconds,
    provider: payload.provider,
    model: payload.model,
  });
  await git(['add', '.codebuddy/'], repoPath);
  await git(['commit', '-m', `${payload.reason}: ${task.id} by ${host}`], repoPath);
  await git(['push'], repoPath);
  return {
    kind: 'blocked',
    taskId: task.id,
    reason: payload.reason,
    details: payload.summary,
  };
}
