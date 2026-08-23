/**
 * `buddy try` — an isolated, zero-configuration coding-agent demonstration.
 *
 * The demo intentionally accepts only the two free paths advertised during
 * onboarding: an existing ChatGPT OAuth login, then a reachable local Ollama.
 * Ambient paid API keys are never selected implicitly.
 */

import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import type { ChatEntry } from '../agent/types.js';
import { normalizeOllamaBaseUrl } from './ollama.js';
import { hasCodexCredentials } from '../providers/codex-oauth.js';
import { resolveProviderFromCatalog } from '../providers/provider-catalog.js';

const OLLAMA_PROBE_TIMEOUT_MS = 2_000;
const DEMO_MAX_TOOL_ROUNDS = 12;

type EnvLike = Record<string, string | undefined>;

export interface TryProvider {
  kind: 'chatgpt' | 'ollama';
  label: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface TryDemoAgent {
  systemPromptReady?: Promise<unknown>;
  processUserMessage(
    prompt: string,
    options?: { surface?: string },
  ): Promise<ChatEntry[]>;
  dispose?(options?: { skipSessionLearning?: boolean }): void;
}

export interface TryVerification {
  success: boolean;
  output: string;
}

interface ResolveTryProviderOptions {
  env?: EnvLike;
  hasChatGptCredentials?: () => boolean;
  fetchImpl?: typeof fetch;
  ollamaProbeTimeoutMs?: number;
}

export interface RunTryDemoOptions extends ResolveTryProviderOptions {
  resolveProvider?: () => Promise<TryProvider | null>;
  createWorkspace?: () => Promise<string>;
  createAgent?: (provider: TryProvider, workspace: string) => Promise<TryDemoAgent>;
  verify?: (workspace: string) => Promise<TryVerification>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown; model?: unknown }>;
}

export const TRY_DEMO_PROMPT = `You are driving a short coding-agent demo in an empty temporary folder.

Exact goal:
1. Create fizzbuzz.js in CommonJS. Export a function fizzBuzz(value) that returns the number as a string, "Fizz" for multiples of 3, "Buzz" for multiples of 5, and "FizzBuzz" for multiples of 15.
2. Create fizzbuzz.test.js using node:test and node:assert/strict. Test at least 1, 3, 5, and 15.
3. Run exactly: node --test fizzbuzz.test.js
4. If a test fails, fix the code and run it again.
5. Finish with a very short summary naming the two files you created and the test result.

Write everything in English. Use the file and terminal tools directly. Do not ask for any confirmation, do not install any dependency, and do not change anything outside the working folder.`;

export const NO_TRY_PROVIDER_MESSAGE = [
  'No free provider is ready for the demo.',
  '',
  '1. Recommended — sign in with your ChatGPT account (OAuth, no API key, $0 marginal cost with your plan):',
  '   buddy login',
  '',
  '2. Or run a model locally with Ollama (install it from https://ollama.com first):',
  '   ollama serve',
  '   ollama pull qwen2.5-coder:7b',
  '   buddy try',
].join('\n');

/** Pick a coding-oriented local model without assuming one exact Ollama tag. */
export function chooseOllamaModel(models: readonly string[], requested?: string): string | null {
  const usable = models.map((model) => model.trim()).filter(Boolean);
  const requestedModel = requested?.trim();
  if (requestedModel) {
    const exact = usable.find((model) => model.toLowerCase() === requestedModel.toLowerCase());
    if (exact) return exact;
  }

  for (const pattern of [/qwen.*coder/i, /devstral/i, /codestral/i, /coder/i, /code/i]) {
    const match = usable.find((model) => pattern.test(model));
    if (match) return match;
  }
  return usable[0] ?? null;
}

function normalizeTryOllamaHost(rawHost?: string): string {
  let host = normalizeOllamaBaseUrl(rawHost);
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  return host;
}

function parseOllamaModels(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const models = (value as OllamaTagsResponse).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => {
      const candidate = entry.name ?? entry.model;
      return typeof candidate === 'string' ? candidate : null;
    })
    .filter((model): model is string => Boolean(model));
}

/** Resolve only the free demo routes: ChatGPT OAuth first, local Ollama second. */
export async function resolveTryProvider(
  options: ResolveTryProviderOptions = {},
): Promise<TryProvider | null> {
  const env = options.env ?? process.env;
  const hasChatGpt = (options.hasChatGptCredentials ?? hasCodexCredentials)();
  if (hasChatGpt) {
    const provider = resolveProviderFromCatalog({
      env,
      providerOverride: 'chatgpt',
      hasChatGptOAuth: true,
    });
    if (provider) {
      return {
        kind: 'chatgpt',
        label: 'ChatGPT OAuth',
        apiKey: provider.apiKey,
        baseURL: provider.baseURL,
        model: provider.defaultModel,
      };
    }
  }

  const host = normalizeTryOllamaHost(env.OLLAMA_HOST);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${host}/api/tags`, {
      signal: AbortSignal.timeout(options.ollamaProbeTimeoutMs ?? OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const models = parseOllamaModels(await response.json());
    const model = chooseOllamaModel(models, env.OLLAMA_MODEL);
    if (!model) return null;
    return {
      kind: 'ollama',
      label: `Ollama local (${model})`,
      apiKey: 'ollama',
      baseURL: `${host}/v1`,
      model,
    };
  } catch {
    return null;
  }
}

async function createDefaultAgent(
  provider: TryProvider,
  workspace: string,
): Promise<TryDemoAgent> {
  const [{ CodeBuddyAgent }, { ConfirmationService }, { getPermissionModeManager }] =
    await Promise.all([
      import('../agent/codebuddy-agent.js'),
      import('../utils/confirmation-service.js'),
      import('../security/permission-modes.js'),
    ]);
  const confirmation = ConfirmationService.getInstance();
  const previousFlags = confirmation.getSessionFlags();
  confirmation.setSessionFlag('allOperations', true);
  // The permission mode is checked BEFORE session flags: in `default` mode with
  // no TTY, create_file is refused ("User cancelled"). The demo runs in an
  // isolated temporary sandbox (workspace), so we auto-approve for the duration
  // of the demo and then restore the previous mode.
  const permMgr = getPermissionModeManager();
  const previousMode = permMgr.getMode();
  permMgr.setMode('bypassPermissions');
  try {
    const agent = new CodeBuddyAgent(
      provider.apiKey,
      provider.baseURL,
      provider.model,
      DEMO_MAX_TOOL_ROUNDS,
      true,
      undefined,
      workspace,
    );
    return {
      systemPromptReady: agent.systemPromptReady,
      processUserMessage: (prompt, options) => agent.processUserMessage(prompt, options),
      dispose: (options) => {
        try {
          agent.dispose(options);
        } finally {
          confirmation.setSessionFlag('fileOperations', previousFlags.fileOperations);
          confirmation.setSessionFlag('bashCommands', previousFlags.bashCommands);
          confirmation.setSessionFlag('allOperations', previousFlags.allOperations);
          permMgr.setMode(previousMode);
        }
      },
    };
  } catch (error) {
    confirmation.setSessionFlag('fileOperations', previousFlags.fileOperations);
    confirmation.setSessionFlag('bashCommands', previousFlags.bashCommands);
    confirmation.setSessionFlag('allOperations', previousFlags.allOperations);
    permMgr.setMode(previousMode);
    throw error;
  }
}

async function verifyDefaultDemo(workspace: string): Promise<TryVerification> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--test', 'fizzbuzz.test.js'],
      { cwd: workspace, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim();
        resolve({ success: error === null, output });
      },
    );
  });
}

function latestAssistantMessage(entries: readonly ChatEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === 'assistant' && entry.content.trim()) return entry.content.trim();
  }
  return null;
}

function invokedToolNames(entries: readonly ChatEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.toolCall?.function.name) names.add(entry.toolCall.function.name);
    for (const toolCall of entry.toolCalls ?? []) names.add(toolCall.function.name);
  }
  return [...names];
}

function setTemporaryEnv(key: string, value: string): () => void {
  const previous = process.env[key];
  process.env[key] = value;
  return () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
}

/** Execute the scripted demo. Returns a process-style exit code. */
export async function runTryDemo(options: RunTryDemoOptions = {}): Promise<number> {
  const write = options.stdout ?? ((message: string) => process.stdout.write(`${message}\n`));
  const writeError = options.stderr ?? ((message: string) => process.stderr.write(`${message}\n`));
  const resolveProvider = options.resolveProvider ?? (() => resolveTryProvider(options));
  const provider = await resolveProvider();
  if (!provider) {
    writeError(NO_TRY_PROVIDER_MESSAGE);
    return 2;
  }

  const createWorkspace = options.createWorkspace
    ?? (() => mkdtemp(join(tmpdir(), 'code-buddy-try-')));
  const workspace = await createWorkspace();
  const createAgent = options.createAgent ?? createDefaultAgent;
  const verify = options.verify ?? verifyDefaultDemo;
  const restoreEnv = [
    setTemporaryEnv('CODEBUDDY_HEADLESS', 'true'),
    setTemporaryEnv('CODEBUDDY_DISABLE_MCP', 'true'),
  ];
  let agent: TryDemoAgent | undefined;

  write('Code Buddy — coding-agent demo (~60 seconds)');
  write(`[1/3] Provider: ${provider.label}`);
  write(`[2/3] Sandbox: ${workspace}`);
  write('      The agent is creating FizzBuzz, writing its tests, and running them…');

  try {
    agent = await createAgent(provider, workspace);
    await agent.systemPromptReady;
    const entries = await agent.processUserMessage(TRY_DEMO_PROMPT, { surface: 'cli' });
    const toolNames = invokedToolNames(entries);
    if (toolNames.length > 0) write(`      Tools used: ${toolNames.join(', ')}`);
    const assistantMessage = latestAssistantMessage(entries);
    if (assistantMessage) write(`      Agent: ${assistantMessage}`);

    write('[3/3] Independent verification: node --test fizzbuzz.test.js');
    const verification = await verify(workspace);
    if (!verification.success) {
      writeError('❌ The demo did not produce a green test. The sandbox is kept for inspection.');
      if (verification.output) writeError(verification.output);
      writeError(`   ${workspace}`);
      return 1;
    }

    write('✅ Demo succeeded: the code was written and its tests pass.');
    if (verification.output) {
      const passLine = verification.output.split('\n').find((line) => /pass/i.test(line));
      if (passLine) write(`   ${passLine.trim()}`);
    }
    write(`   Files to inspect: ${workspace}`);
    return 0;
  } catch (error) {
    writeError(`❌ Demo interrupted: ${error instanceof Error ? error.message : String(error)}`);
    writeError(`   The sandbox is kept: ${workspace}`);
    return 1;
  } finally {
    agent?.dispose?.({ skipSessionLearning: true });
    for (const restore of restoreEnv.reverse()) restore();
  }
}

export function createTryCommand(): Command {
  return new Command('try')
    .description('Run an isolated 60-second coding-agent demo (ChatGPT OAuth or local Ollama)')
    .action(async () => {
      process.exitCode = await runTryDemo();
    });
}
