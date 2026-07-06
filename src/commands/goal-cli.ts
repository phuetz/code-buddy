/**
 * buddy goal — headless Ralph loop.
 *
 * Runs the full agentic loop toward a standing goal: each turn the agent
 * works with tools, then the goal judge decides done/continue. Continuation
 * prompts are fed back in-process until the goal is achieved, the turn
 * budget is exhausted, or the judge auto-pauses.
 *
 * Usage:
 *   buddy goal "Fix every failing test in tests/auth/"
 *   buddy goal "Ship the feature" --max-turns 10 --judge-model qwen3:8b
 *
 * Exit codes: 0 = goal done, 1 = paused (budget/judge) or error.
 */

import { Command, InvalidArgumentError } from 'commander';
import path from 'path';
import type { ChatEntry } from '../agent/codebuddy-agent.js';
import type { CodeBuddyClient } from '../codebuddy/client.js';
import { resolveGoalJudgeClient, type GoalJudgeProviderInfo } from '../goals/goal-judge-client.js';
import { maybeContinueGoalAfterTurn } from '../goals/goal-loop.js';
import { getGoalManager, resolveGoalsConfig } from '../goals/goal-manager.js';
import { GoalStatus } from '../goals/goal-state.js';
import { resolveCommandProvider } from './llm-provider-resolution.js';

/** The slice of CodeBuddyAgent the loop needs — injectable for tests. */
export interface GoalLoopAgent {
  processUserMessage(input: string): Promise<ChatEntry[]>;
  getClient(): CodeBuddyClient;
}

export interface GoalCommandRuntimeAgent extends GoalLoopAgent {
  systemPromptReady: Promise<unknown>;
  setSystemPrompt?: (prompt: string) => void;
  dispose?: () => void | Promise<void>;
}

export interface GoalLoopRunOptions {
  maxTurns?: number;
  /** Optional standalone judge client. Defaults to the agent client. */
  judgeClient?: CodeBuddyClient;
  /** Progress sink (status lines ⊙/↻/✓/⏸). Defaults to silent. */
  onMessage?: (text: string) => void;
}

export interface GoalLoopRunResult {
  status: GoalStatus | 'unknown';
  turnsUsed: number;
  lastReason?: string;
}

export interface GoalCommandRuntimeOptions {
  maxTurns?: number;
  judgeModel?: string;
  provider: GoalJudgeProviderInfo;
  workingDirectory?: string;
  onMessage?: (text: string) => void;
  createJudgeClient?: typeof createStandaloneJudgeClient;
  runLoop?: typeof runGoalLoop;
}

const TOOL_RESULT_SNIPPET_CHARS = 1600;
export const LOCAL_GOAL_ACTOR_SYSTEM_PROMPT =
  'You are Code Buddy running in headless goal mode on a local model. ' +
  'Work only toward the user standing goal. Use available tools when they are necessary, ' +
  'then report concrete progress or the final result. For simple answer-only goals, ' +
  'output exactly the requested answer and no extra text. Do not greet the user, add markdown, ' +
  'or explain unless the goal asks for it.';

export function buildLocalGoalActorSystemPrompt(workingDirectory: string = process.cwd()): string {
  return `${LOCAL_GOAL_ACTOR_SYSTEM_PROMPT}

Workspace:
- Current project directory: ${workingDirectory}
- Use paths relative to the current project directory whenever possible.
- Do not invent container paths such as /workspace or root paths such as /src unless a tool result proves they exist.`;
}

export function shouldUseLocalGoalActorPrompt(provider: GoalJudgeProviderInfo): boolean {
  const label = provider.providerLabel?.toLowerCase() ?? '';
  const baseURL = provider.baseURL?.toLowerCase() ?? '';
  return provider.apiKey === 'ollama' || label.includes('ollama') || baseURL.includes(':11434');
}

export function resolveLocalGoalActorSystemPrompt(
  provider: GoalJudgeProviderInfo,
  workingDirectory: string = process.cwd()
): string | undefined {
  return shouldUseLocalGoalActorPrompt(provider)
    ? buildLocalGoalActorSystemPrompt(workingDirectory)
    : undefined;
}

function truncateGoalTurnPart(text: string): string {
  if (text.length <= TOOL_RESULT_SNIPPET_CHARS) return text;
  return `${text.slice(0, TOOL_RESULT_SNIPPET_CHARS)}... [truncated]`;
}

export function buildGoalTurnSummary(entries: ChatEntry[]): string {
  const parts: string[] = [];
  let hasToolResult = false;

  for (const entry of entries) {
    if (entry.type === 'assistant' && entry.content.trim()) {
      parts.push(entry.content.trim());
      continue;
    }

    if (entry.type !== 'tool_result') continue;
    hasToolResult = true;

    const toolOutput =
      (entry.toolResult?.success ? entry.toolResult.output : entry.toolResult?.error) ??
      entry.content;
    const trimmedOutput = String(toolOutput ?? '').trim();
    if (!trimmedOutput) continue;

    const toolName = entry.toolCall?.function?.name ?? 'tool';
    const status = entry.toolResult ? (entry.toolResult.success ? 'success' : 'error') : 'result';
    parts.push(`[tool:${toolName} ${status}]\n${truncateGoalTurnPart(trimmedOutput)}`);
  }

  const summary = parts.join('\n\n');
  if (summary && !hasToolResult) {
    return `[tool evidence: none]\n\n${summary}`;
  }
  return summary;
}

export function buildGoalRunSummary(turnSummaries: string[]): string {
  return turnSummaries
    .map((summary, index) => `[Goal turn ${index + 1}]\n${summary}`)
    .join('\n\n');
}

/**
 * Drive the goal loop headlessly on an in-process agent. Sets the goal,
 * runs the first turn with the goal text (mirroring the interactive
 * `/goal <text>` kick-off), then follows judge verdicts until the loop
 * stops continuing.
 */
export async function runGoalLoop(
  agent: GoalLoopAgent,
  goalText: string,
  options: GoalLoopRunOptions = {}
): Promise<GoalLoopRunResult> {
  const manager = getGoalManager();
  const state = manager.set(
    goalText,
    options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}
  );
  const emit = options.onMessage ?? (() => {});
  const judgeClient = options.judgeClient ?? agent.getClient();
  emit(`⊙ Goal set (${state.maxTurns}-turn budget): ${state.goal}`);

  let prompt = state.goal;
  const turnSummaries: string[] = [];
  // Hard backstop on top of the manager's own budget/auto-pause guards.
  const maxIterations = state.maxTurns + 1;
  for (let i = 0; i < maxIterations; i++) {
    const entries = await agent.processUserMessage(prompt);
    const lastResponse = buildGoalTurnSummary(entries);
    if (lastResponse.trim()) {
      turnSummaries.push(lastResponse);
    }

    const outcome = await maybeContinueGoalAfterTurn({
      client: judgeClient,
      lastResponse: lastResponse.trim() ? buildGoalRunSummary(turnSummaries) : lastResponse,
      interrupted: false,
    });
    if (outcome?.message) emit(outcome.message);
    if (!outcome && !lastResponse.trim() && manager.isActive()) {
      manager.pause('empty response (nothing to evaluate)');
      emit('⏸ Goal paused — the agent produced no judgeable response.');
      break;
    }
    if (!outcome?.continuationPrompt) break;
    prompt = outcome.continuationPrompt;
  }

  const final = manager.state;
  return {
    status: final?.status ?? 'unknown',
    turnsUsed: final?.turnsUsed ?? 0,
    ...(final?.lastReason ? { lastReason: final.lastReason } : {}),
  };
}

async function createStandaloneJudgeClient(
  judgeModel: string | undefined,
  agentProvider: GoalJudgeProviderInfo,
  currentClient: CodeBuddyClient
): Promise<CodeBuddyClient | undefined> {
  const resolved = await resolveGoalJudgeClient(currentClient, judgeModel, agentProvider);
  return resolved === currentClient ? undefined : resolved;
}

export async function runGoalCommandWithAgent(
  agent: GoalCommandRuntimeAgent,
  goal: string,
  options: GoalCommandRuntimeOptions
): Promise<GoalLoopRunResult> {
  try {
    const createJudgeClient = options.createJudgeClient ?? createStandaloneJudgeClient;
    const runLoop = options.runLoop ?? runGoalLoop;
    const judgeClient = await createJudgeClient(options.judgeModel, options.provider, agent.getClient());
    await agent.systemPromptReady;
    if (shouldUseLocalGoalActorPrompt(options.provider)) {
      agent.setSystemPrompt?.(buildLocalGoalActorSystemPrompt(options.workingDirectory));
    }

    return await runLoop(agent, goal, {
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(judgeClient ? { judgeClient } : {}),
      ...(options.onMessage ? { onMessage: options.onMessage } : {}),
    });
  } finally {
    await Promise.resolve(agent.dispose?.());
  }
}

export function resolveGoalCliJudgeModel(explicitJudgeModel: string | undefined): string | undefined {
  const explicit = explicitJudgeModel?.trim();
  if (explicit) return explicit;

  const configured = resolveGoalsConfig().judgeModel.trim();
  return configured || undefined;
}

export function resolveGoalCliMaxToolRounds(
  commandValue: number | undefined,
  command?: Command
): number {
  const commandSource = command?.getOptionValueSource?.('maxToolRounds');
  if (commandSource && commandSource !== 'default') {
    return commandValue ?? 50;
  }

  const parentSource = command?.parent?.getOptionValueSource?.('maxToolRounds');
  const parentValue = command?.optsWithGlobals?.()?.maxToolRounds;
  if (parentSource && parentSource !== 'default' && parentValue !== undefined) {
    return parsePositiveIntegerOption(String(parentValue), '--max-tool-rounds');
  }

  return commandValue ?? 50;
}

export function resolveGoalCliWorkingDirectory(command?: Command): string | undefined {
  const value = command?.optsWithGlobals?.()?.directory;
  if (typeof value !== 'string') return undefined;
  const directory = value.trim();
  if (!directory) return undefined;
  return path.resolve(process.cwd(), directory);
}

export function applyGoalCliWorkingDirectory(command?: Command): string {
  const directory = resolveGoalCliWorkingDirectory(command);
  if (directory) {
    process.chdir(directory);
  }
  return process.cwd();
}

async function loadGoalCliEnv(directory: string): Promise<void> {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(directory, '.env') });
}

async function prepareGoalCliWorkspace(command?: Command): Promise<string> {
  const launchDirectory = process.cwd();
  await loadGoalCliEnv(launchDirectory);

  const cwd = applyGoalCliWorkingDirectory(command);
  if (cwd !== launchDirectory) {
    await loadGoalCliEnv(cwd);
  }

  const opts = command?.optsWithGlobals?.() as {
    allowOutside?: boolean;
    addDir?: string[];
  } | undefined;
  const { initializeWorkspaceIsolation } = await import('../workspace/workspace-isolation.js');
  initializeWorkspaceIsolation({
    allowOutside: opts?.allowOutside,
    directory: cwd,
    additionalPaths: opts?.addDir,
  });
  return cwd;
}

export function parsePositiveIntegerOption(value: string, optionName: string): number {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (!/^[1-9]\d*$/.test(trimmed) || !Number.isSafeInteger(n)) {
    throw new InvalidArgumentError(`${optionName} must be a positive integer`);
  }
  return n;
}

export function validateGoalCommandNumericOptions(argv: readonly string[]): void {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--') break;
    if (arg === '--max-turns' || arg === '--max-tool-rounds') {
      const value = argv[i + 1];
      if (value === undefined) continue;
      parsePositiveIntegerOption(value, arg);
      i++;
      continue;
    }
    const eqIndex = arg?.indexOf('=') ?? -1;
    if (eqIndex <= 0) continue;
    const optionName = arg.slice(0, eqIndex);
    if (optionName === '--max-turns' || optionName === '--max-tool-rounds') {
      parsePositiveIntegerOption(arg.slice(eqIndex + 1), optionName);
    }
  }
}

export function createGoalCommand(): Command {
  const cmd = new Command('goal')
    .description('Run the agent toward a standing goal until a judge model confirms it is done (Ralph loop)')
    .argument('<goal>', 'The goal to pursue')
    .option(
      '--max-turns <n>',
      'Turn budget (default 20, or goals.maxTurns from settings)',
      value => parsePositiveIntegerOption(value, '--max-turns')
    )
    .option('--judge-model <model>', 'Model for the goal judge (default: session model)')
    .option('-m, --model <model>', 'Override the agent model for this run')
    .option(
      '--max-tool-rounds <n>',
      'Max tool rounds per turn',
      value => parsePositiveIntegerOption(value, '--max-tool-rounds'),
      50
    )
    .action(async (goal: string, options, command) => {
      try {
        const cwd = await prepareGoalCliWorkspace(command);

        const modelOverride: string | undefined = options.model ?? command?.optsWithGlobals?.()?.model;
        const resolved = resolveCommandProvider({ explicitModel: modelOverride });
        if (!resolved) {
          console.error(
            'Error: No provider available — set an API key, run `buddy onboard`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.'
          );
          process.exit(1);
        }

        if (options.judgeModel) {
          process.env.CODEBUDDY_GOAL_JUDGE_MODEL = options.judgeModel;
        }
        const judgeModel = resolveGoalCliJudgeModel(options.judgeModel);
        const maxToolRounds = resolveGoalCliMaxToolRounds(options.maxToolRounds, command);
        process.env.CODEBUDDY_DISABLE_MCP = process.env.CODEBUDDY_DISABLE_MCP ?? 'true';
        process.env.CODEBUDDY_HEADLESS = 'true';

        const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
        const { ConfirmationService } = await import('../utils/confirmation-service.js');
        ConfirmationService.getInstance().setSessionFlag('allOperations', true);

        const agent = new CodeBuddyAgent(
          resolved.apiKey,
          resolved.baseURL,
          resolved.model,
          maxToolRounds,
          true,
          undefined,
          cwd,
          undefined,
          resolveLocalGoalActorSystemPrompt(resolved, cwd)
        );
        const result = await runGoalCommandWithAgent(agent, goal, {
          provider: resolved,
          judgeModel,
          workingDirectory: cwd,
          ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
          onMessage: text => console.log(`\n${text}`),
        });

        process.exit(result.status === 'done' ? 0 : 1);
      } catch (err) {
        console.error('Goal error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  return cmd;
}
