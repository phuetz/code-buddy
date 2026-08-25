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
  /**
   * `false` masque la télémétrie, `true` la laisse passer. Une valeur omise préserve le niveau
   * de l'appelant pour la compatibilité de l'API ; la commande CLI passe toujours un booléen.
   */
  verbose?: boolean;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown; model?: unknown }>;
}

export const TRY_DEMO_PROMPT = `Tu pilotes une démo courte d'agent de code dans un dossier temporaire vide.

Objectif exact :
1. Crée fizzbuzz.js en CommonJS. Exporte une fonction fizzBuzz(value) qui renvoie le nombre sous forme de chaîne, "Fizz" pour les multiples de 3, "Buzz" pour ceux de 5 et "FizzBuzz" pour ceux de 15.
2. Crée fizzbuzz.test.js avec node:test et node:assert/strict. Teste au minimum 1, 3, 5 et 15.
3. Exécute exactement : node --test fizzbuzz.test.js
4. Si un test échoue, corrige le code et relance-le.
5. Termine par un bilan très court indiquant les deux fichiers créés et le résultat des tests.

Utilise directement les outils de fichier et de terminal. Ne demande aucune confirmation, n'installe aucune dépendance et ne modifie rien hors du dossier de travail.`;

export const NO_TRY_PROVIDER_MESSAGE = [
  'Aucun provider gratuit prêt pour la démo.',
  '',
  '1. Recommandé — connecte ton compte ChatGPT (OAuth, sans clé API, coût marginal $0 avec ton plan) :',
  '   buddy login',
  '',
  '2. Ou utilise Ollama en local :',
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
  // Le permission mode est vérifié AVANT les session flags : en mode `default` et sans TTY,
  // create_file est refusé (« User cancelled »). La démo tourne dans un bac à sable temporaire
  // isolé (workspace), donc on auto-approuve tout le temps de la démo puis on restaure le mode.
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

  write('Code Buddy — démo agent de code (~60 secondes)');
  write(`[1/3] Provider : ${provider.label}`);
  write(`[2/3] Bac à sable : ${workspace}`);
  write('      L’agent crée FizzBuzz, écrit ses tests et les exécute…');

  try {
    agent = await createAgent(provider, workspace);
    await agent.systemPromptReady;
    const entries = await agent.processUserMessage(TRY_DEMO_PROMPT, { surface: 'cli' });
    const toolNames = invokedToolNames(entries);
    if (toolNames.length > 0) write(`      Outils utilisés : ${toolNames.join(', ')}`);
    const assistantMessage = latestAssistantMessage(entries);
    if (assistantMessage) write(`      Agent : ${assistantMessage}`);

    write('[3/3] Vérification indépendante : node --test fizzbuzz.test.js');
    const verification = await verify(workspace);
    if (!verification.success) {
      writeError('❌ La démo n’a pas produit un test vert. Le bac à sable est conservé pour inspection.');
      if (verification.output) writeError(verification.output);
      writeError(`   ${workspace}`);
      return 1;
    }

    write('✅ Démo réussie : le code a été écrit et ses tests passent.');
    if (verification.output) {
      const passLine = verification.output.split('\n').find((line) => /pass/i.test(line));
      if (passLine) write(`   ${passLine.trim()}`);
    }
    write(`   Fichiers à inspecter : ${workspace}`);
    return 0;
  } catch (error) {
    writeError(`❌ Démo interrompue : ${error instanceof Error ? error.message : String(error)}`);
    writeError(`   Le bac à sable est conservé : ${workspace}`);
    return 1;
  } finally {
    agent?.dispose?.({ skipSessionLearning: true });
    for (const restore of restoreEnv.reverse()) restore();
  }
}

export function createTryCommand(): Command {
  return new Command('try')
    .description('Run an isolated 60-second coding-agent demo (ChatGPT OAuth or local Ollama)')
    .option('--verbose', "Afficher la télémétrie de l'agent pendant la démo")
    .action(async (options: { verbose?: boolean }) => {
      process.exitCode = await runTryDemo({ verbose: options.verbose === true });
    });
}
