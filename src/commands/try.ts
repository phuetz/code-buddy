/**
 * `buddy try` — an isolated, zero-configuration coding-agent demonstration.
 *
 * The demo intentionally accepts only the two free paths advertised during
 * onboarding: an existing ChatGPT OAuth login, then a reachable local Ollama.
 * Ambient paid API keys are never selected implicitly.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import type { ChatEntry } from '../agent/types.js';
import { normalizeOllamaBaseUrl } from './ollama.js';
import { getModelToolConfig } from '../config/model-tools.js';
import { hasCodexCredentials } from '../providers/codex-oauth.js';
import { resolveProviderFromCatalog } from '../providers/provider-catalog.js';

const OLLAMA_PROBE_TIMEOUT_MS = 2_000;
const DEMO_MAX_TOOL_ROUNDS = 12;
const DEMO_TEST_FILE = 'fizzbuzz.test.js';

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
  /** Endpoint imposé par l'utilisateur (`--base-url`) : prime sur toute auto-détection. */
  baseUrlOverride?: string;
  /** Modèle imposé par l'utilisateur (`--model`). */
  modelOverride?: string;
  onUnavailable?: (message: string) => void;
}

export interface RunTryDemoOptions extends ResolveTryProviderOptions {
  resolveProvider?: () => Promise<TryProvider | null>;
  createWorkspace?: () => Promise<string>;
  prepareWorkspace?: (workspace: string) => Promise<void>;
  createAgent?: (provider: TryProvider, workspace: string) => Promise<TryDemoAgent>;
  verify?: (workspace: string) => Promise<TryVerification>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  /**
   * `false` masque la télémétrie, `true` la laisse passer. Une valeur omise préserve le niveau
   * de l'appelant pour la compatibilité de l'API ; la commande CLI passe toujours un booléen.
   */
  verbose?: boolean;
}

export interface TryCommandDependencies {
  runTryDemo?: (options: RunTryDemoOptions) => Promise<number>;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown; model?: unknown; capabilities?: unknown; details?: { parameter_size?: unknown } }>;
}

interface OllamaModel {
  name: string;
  capabilities?: string[];
  parameterSize?: number;
}

export const TRY_DEMO_PROMPT = `Please implement the FizzBuzz function in this temporary folder. A test file named fizzbuzz.test.js is already provided.

Create fizzbuzz.js as CommonJS and export { fizzBuzz }. For a number, return "FizzBuzz" if it is divisible by 15, "Fizz" if divisible by 3, "Buzz" if divisible by 5, and otherwise its decimal string. Please run node --test fizzbuzz.test.js and briefly report the result.`;

export const TRY_DEMO_RETRY_PROMPT = `The independent test is still failing. Please inspect fizzbuzz.js and fizzbuzz.test.js in this temporary folder, create or fix fizzbuzz.js, and run node --test fizzbuzz.test.js. The required export is { fizzBuzz }; return "FizzBuzz" for 15, "Fizz" for 3, "Buzz" for 5, and "1" for 1.`;

const DEMO_TEST_SOURCE = `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fizzBuzz } = require('./fizzbuzz.js');

test('FizzBuzz examples', () => {
  assert.equal(fizzBuzz(1), '1');
  assert.equal(fizzBuzz(3), 'Fizz');
  assert.equal(fizzBuzz(5), 'Buzz');
  assert.equal(fizzBuzz(15), 'FizzBuzz');
});
`;

export const NO_TRY_PROVIDER_MESSAGE = [
  'No free provider is ready for the demo.',
  '',
  '1. Recommended — sign in with your ChatGPT account (OAuth, no API key, $0 marginal cost with your plan):',
  '   buddy login',
  '',
  '2. Or run a model locally with Ollama (install it from https://ollama.com first):',
  '   ollama serve',
  '   ollama pull qwen3:8b',
  '   buddy try',
  '',
  'The demo edits files, so the model must be able to call tools. Small qwen2.5',
  'models (including 1.5B and 3B) are chat-only in Code Buddy.',
].join('\n');

/** Pick a coding-oriented local model without assuming one exact Ollama tag. */
export function chooseOllamaModel(models: readonly (string | OllamaModel)[], requested?: string): string | null {
  const usable = models.map((model) => typeof model === 'string' ? { name: model.trim() } : model)
    .filter((model) => Boolean(model.name));
  const requestedModel = requested?.trim();
  if (requestedModel) {
    const exact = usable.find((model) => model.name.toLowerCase() === requestedModel.toLowerCase());
    if (exact) return exact.name;
  }

  // Both the runtime and Code Buddy must offer structured calls. An unknown
  // or chat-only model is never an automatic fallback for a file-editing demo.
  const toolCapable = usable.filter((model) =>
    model.capabilities?.includes('tools') !== false &&
    getModelToolConfig(model.name).supportsToolCalls !== false);
  toolCapable.sort((a, b) => {
    const coding = (name: string) => /coder|devstral|codestral/i.test(name) ? 1 : 0;
    const size = (model: OllamaModel) => model.parameterSize ??
      Number.parseFloat(model.name.match(/:(\d+(?:\.\d+)?)b\b/i)?.[1] ?? '0');
    return coding(b.name) - coding(a.name) || size(b) - size(a) || a.name.localeCompare(b.name);
  });
  return toolCapable[0]?.name ?? null;
}

/** True when Code Buddy treats this model as chat-only (no structured tool calls). */
export function isChatOnlyModel(model: string | undefined): boolean {
  if (!model) return false;
  return getModelToolConfig(model).supportsToolCalls === false;
}

function normalizeTryOllamaHost(rawHost?: string): string {
  let host = normalizeOllamaBaseUrl(rawHost);
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  return host;
}

function parseOllamaModels(value: unknown): OllamaModel[] {
  if (!value || typeof value !== 'object') return [];
  const models = (value as OllamaTagsResponse).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => {
      const candidate = entry.name ?? entry.model;
      if (typeof candidate !== 'string') return null;
      const rawSize = entry.details?.parameter_size;
      return {
        name: candidate,
        ...(Array.isArray(entry.capabilities)
          ? { capabilities: entry.capabilities.filter((item): item is string => typeof item === 'string') }
          : {}),
        ...(typeof rawSize === 'string' && Number.isFinite(Number.parseFloat(rawSize))
          ? { parameterSize: Number.parseFloat(rawSize) }
          : {}),
      };
    })
    .filter((model): model is OllamaModel => model !== null);
}

/** Demande à un endpoint OpenAI-compatible le premier modèle qu'il expose. */
async function probeFirstModel(
  baseURL: string,
  options: ResolveTryProviderOptions,
): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${baseURL}/models`, {
      signal: AbortSignal.timeout(options.ollamaProbeTimeoutMs ?? OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return payload.data?.find((entry) => typeof entry.id === 'string')?.id;
  } catch {
    return undefined;
  }
}

/** Resolve only the free demo routes: ChatGPT OAuth first, local Ollama second. */
export async function resolveTryProvider(
  options: ResolveTryProviderOptions = {},
): Promise<TryProvider | null> {
  const env = options.env ?? process.env;

  // Un endpoint demandé explicitement gagne toujours : l'auto-détection sert à
  // deviner quand l'utilisateur n'a rien dit, pas à contredire ce qu'il a dit.
  const baseUrlOverride = options.baseUrlOverride?.trim();
  if (baseUrlOverride) {
    const baseURL = baseUrlOverride.replace(/\/+$/, '');
    const model =
      options.modelOverride?.trim() ||
      (await probeFirstModel(baseURL, options)) ||
      env.OLLAMA_MODEL;
    if (!model) return null;
    return {
      kind: 'ollama',
      label: `endpoint imposé (${baseURL} · ${model})`,
      apiKey: env.OPENAI_API_KEY ?? env.GROK_API_KEY ?? 'local',
      baseURL,
      model,
    };
  }

  const providerOverride = env.CODEBUDDY_PROVIDER?.trim().toLowerCase();
  const forceOllama = providerOverride === 'ollama';
  const hasChatGpt = !forceOllama && (options.hasChatGptCredentials ?? hasCodexCredentials)();
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
    const requestedModel = options.modelOverride?.trim();
    const preferred = env.OLLAMA_MODEL && chooseOllamaModel(models, env.OLLAMA_MODEL);
    const preferredMetadata = models.find((item) => item.name === preferred);
    const model = requestedModel
      ? models.find((candidate) => candidate.name.toLowerCase() === requestedModel.toLowerCase())?.name ?? null
      : preferredMetadata && preferredMetadata.capabilities?.includes('tools') !== false
        && !isChatOnlyModel(preferredMetadata.name)
        ? preferredMetadata.name
        : chooseOllamaModel(models);
    if (!model && models.length > 0) {
      options.onUnavailable?.(
        `Installed Ollama models cannot call the tools needed for this demo: ${models.map((item) => item.name).join(', ')}.\n` +
        'Install a stronger tool-capable model with `ollama pull qwen3:8b`, then run `buddy try` again.',
      );
    }
    if (!model && requestedModel) {
      options.onUnavailable?.(`Model ${requestedModel} is not installed. Run \`ollama pull ${requestedModel}\` or omit --model.`);
    }
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
  const test = await new Promise<TryVerification>((resolve) => {
    execFile(
      process.execPath,
      ['--test', DEMO_TEST_FILE],
      { cwd: workspace, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim();
        resolve({ success: error === null, output });
      },
    );
  });
  if (!test.success) return test;
  // The visible test is a fixture. These extra cases independently check the
  // implementation, so a green test or a model's claim alone is insufficient.
  const holdout = await new Promise<TryVerification>((resolve) => {
    const script = [
      "const assert = require('node:assert/strict');",
      "const { fizzBuzz } = require('./fizzbuzz.js');",
      "for (const [input, expected] of [[2,'2'],[6,'Fizz'],[10,'Buzz'],[30,'FizzBuzz'],[37,'37']]) assert.equal(fizzBuzz(input), expected);",
    ].join('\n');
    execFile(process.execPath, ['-e', script],
      { cwd: workspace, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => resolve({ success: error === null, output: `${stdout}${stderr}`.trim() }));
  });
  return { success: holdout.success, output: [test.output, holdout.output].filter(Boolean).join('\n') };
}

async function prepareDefaultWorkspace(workspace: string): Promise<void> {
  await writeFile(join(workspace, DEMO_TEST_FILE), DEMO_TEST_SOURCE, { flag: 'wx' });
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

/**
 * Execute the scripted demo. Returns a process-style exit code.
 *
 * Programmatic callers that omit `verbose` keep their logger state unchanged. The CLI passes
 * `false` by default because `buddy try` is a human-facing showcase whose short narrative must
 * not be drowned out by agent telemetry.
 */
export async function runTryDemo(options: RunTryDemoOptions = {}): Promise<number> {
  if (options.verbose !== false) return runTryDemoInner(options);

  // `try` est la toute première chose qu'un nouvel utilisateur exécute. Dans la CLI, la
  // télémétrie de l'agent (`INFO [notification] view_file completed in 26ms`, l'avertissement
  // `bypassPermissions` du bac à sable) noyait les huit lignes qui racontent la démo — au point
  // que la première capture vidéo en était illisible. On abaisse donc le niveau de journal pour
  // la durée de la démo, sauf si l'utilisateur demande explicitement le détail. Le niveau est
  // restauré à la fin, y compris en cas d'erreur.
  // Poser `LOG_LEVEL` ne suffit PAS : le logger est un singleton qui lit la variable à
  // l'import du module, donc bien avant cette ligne. Mesuré : 15 lignes de télémétrie
  // survivaient au correctif « par l'environnement », alors que le test unitaire, lui,
  // passait — il vérifiait la variable, pas le résultat. C'est `setLevel()` qui agit.
  const restoreEnv = setTemporaryEnv('LOG_LEVEL', 'error');
  let restoreLogger = () => {};
  try {
    const { logger } = await import('../utils/logger.js');
    const previousLevel = logger.getLevel();
    // Enregistrer la restauration AVANT la mutation : même un `setLevel` qui muterait puis
    // lancerait ne pourrait pas laisser le singleton au niveau `error`.
    restoreLogger = () => logger.setLevel(previousLevel);
    logger.setLevel('error');
    return await runTryDemoInner(options);
  } finally {
    try {
      restoreLogger();
    } finally {
      restoreEnv();
    }
  }
}

async function runTryDemoInner(options: RunTryDemoOptions): Promise<number> {
  const write = options.stdout ?? ((message: string) => process.stdout.write(`${message}\n`));
  const writeError = options.stderr ?? ((message: string) => process.stderr.write(`${message}\n`));
  let unavailableReason: string | undefined;
  const resolveProvider = options.resolveProvider ?? (() => resolveTryProvider({
    ...options,
    onUnavailable: (reason) => { unavailableReason = reason; },
  }));
  const provider = await resolveProvider();
  if (!provider) {
    writeError(unavailableReason ?? NO_TRY_PROVIDER_MESSAGE);
    return 2;
  }

  const createWorkspace = options.createWorkspace
    ?? (() => mkdtemp(join(tmpdir(), 'code-buddy-try-')));
  const workspace = await createWorkspace();
  const prepareWorkspace = options.prepareWorkspace ?? prepareDefaultWorkspace;
  const createAgent = options.createAgent ?? createDefaultAgent;
  const verify = options.verify ?? verifyDefaultDemo;
  const restoreEnv = [
    setTemporaryEnv('CODEBUDDY_HEADLESS', 'true'),
    setTemporaryEnv('CODEBUDDY_DISABLE_MCP', 'true'),
  ];
  let agent: TryDemoAgent | undefined;

  write('Code Buddy — coding-agent demo (about a minute on a fast model, longer on a small local one)');
  write(`[1/3] Provider: ${provider.label}`);
  write(`[2/3] Sandbox: ${workspace}`);
  write('      The agent is implementing FizzBuzz against a local test…');

  try {
    await prepareWorkspace(workspace);
    agent = await createAgent(provider, workspace);
    await agent.systemPromptReady;
    const entries = await agent.processUserMessage(TRY_DEMO_PROMPT, { surface: 'try' });
    let verification = await verify(workspace);
    let allEntries = entries;
    if (!verification.success) {
      write('      The first attempt did not pass. One guided retry…');
      const retryEntries = await agent.processUserMessage(TRY_DEMO_RETRY_PROMPT, { surface: 'try' });
      allEntries = [...entries, ...retryEntries];
      verification = await verify(workspace);
    }
    const toolNames = invokedToolNames(allEntries);
    if (toolNames.length > 0) write(`      Tools used: ${toolNames.join(', ')}`);
    const assistantMessage = latestAssistantMessage(allEntries);
    if (assistantMessage && (verification.success || options.verbose)) write(`      Agent: ${assistantMessage}`);

    write('[3/3] Independent verification: node --test fizzbuzz.test.js');
    if (!verification.success) {
      writeError('❌ The demo did not produce a green test. The sandbox is kept for inspection.');
      if (isChatOnlyModel(provider.model)) {
        writeError(
          `   Likely cause: ${provider.model} is chat-only in Code Buddy (it cannot call tools, so it cannot edit files).\n` +
            '   Pull a tool-capable model (for example `ollama pull qwen3:8b`) and run `buddy try` again.',
        );
      }
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

export function createTryCommand(dependencies: TryCommandDependencies = {}): Command {
  const executeTryDemo = dependencies.runTryDemo ?? runTryDemo;
  return new Command('try')
    .description('Run an isolated coding-agent demo that must end with a green test (ChatGPT OAuth or local Ollama)')
    .option('--verbose', 'Show agent telemetry during the demo')
    .option('--base-url <url>', 'Use this Ollama/OpenAI-compatible endpoint for the demo')
    .option('--model <model>', 'Use this model for the demo')
    .action(async (
      options: { verbose?: boolean; baseUrl?: string; model?: string },
      command: Command,
    ) => {
      // `--base-url` et `--model` sont des options GLOBALES : sans cette reprise,
      // la démo les ignorait en silence et annonçait un succès obtenu ailleurs.
      const globals = command.parent?.opts<{ baseUrl?: string; model?: string }>() ?? {};
      const baseUrl = options.baseUrl ?? globals.baseUrl;
      const model = options.model ?? globals.model;
      process.exitCode = await executeTryDemo({
        verbose: options.verbose === true,
        ...(baseUrl ? { baseUrlOverride: baseUrl } : {}),
        ...(model ? { modelOverride: model } : {}),
      });
    });
}
