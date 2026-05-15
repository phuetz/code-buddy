/**
 * Gemini CLI subprocess provider — wraps the official `gemini` binary.
 *
 * Lets a Code Buddy user (or fleet peer) consume a Gemini Ultra
 * subscription via the **official Google CLI** instead of an API key.
 * Authentication is managed entirely by the binary itself, which reads
 * `~/.gemini/oauth_creds.json` populated by the user's first
 * interactive login.
 *
 * Selection: `client.ts` instantiates this strategy when the apiKey is
 * the sentinel `gemini-cli` OR the baseURL starts with `gemini-cli://`.
 *
 * Headless surface used (cf. https://github.com/google-gemini/gemini-cli
 * `docs/cli/headless.md`):
 *   gemini -p <prompt> -m <model> -o json --approval-mode plan
 *   gemini -p <prompt> -m <model> -o stream-json --approval-mode plan
 *
 * The JSON output schema is `{ response, stats?, error? }`. The
 * stream-json variant emits newline-delimited events (`init`, `message`,
 * `tool_use`, `tool_result`, `error`, `result`).
 *
 * `--approval-mode plan` is forced — Code Buddy keeps the agent loop
 * (tool execution, file edits, etc). The Gemini CLI is a pure text
 * generator from the host's perspective; tool_use events are observed
 * but not honoured in v1.
 *
 * @module codebuddy/providers/provider-gemini-cli
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

type GeminiCliChild = ChildProcessByStdio<null, Readable, Readable>;
import * as readline from 'node:readline';
import type { ChatCompletionChunk } from 'openai/resources/chat';
import { logger } from '../../utils/logger.js';
import type {
  CodeBuddyMessage,
  CodeBuddyTool,
  CodeBuddyResponse,
  ChatOptions,
} from '../client.js';
import type { Provider } from './provider-interface.js';

export interface GeminiCliProviderOptions {
  /** Absolute path to the `gemini` binary. */
  binaryPath: string;
  /** Default model name passed via `-m` (e.g. `gemini-2.5-pro`). */
  model: string;
  /** Mostly informational — Gemini CLI doesn't expose a max-tokens flag. */
  defaultMaxTokens: number;
  /** Subprocess timeout in ms. Defaults to 5 min. */
  requestTimeoutMs?: number;
  /** Override for the approval mode. Defaults to 'plan' (read-only). */
  approvalMode?: 'plan' | 'default' | 'auto_edit' | 'yolo';
  /** Inject extra env vars into the spawned process (test hook). */
  extraEnv?: Record<string, string>;
}

/**
 * Maximum stdout buffer we tolerate per call. 10 MB is generous for
 * an LLM response — anything bigger is almost certainly a runaway
 * binary or a wrong format flag.
 */
const STDOUT_BYTES_CAP = 10 * 1024 * 1024;

/** Default subprocess timeout (5 min). */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Grace period between SIGTERM and SIGKILL when killing a stuck child. */
const KILL_GRACE_MS = 5_000;

interface GeminiCliJsonOutput {
  response?: string;
  /**
   * Stats schema observed on gemini-cli >= v0.11 (Gemini 3 era):
   * `stats.models[<modelId>].tokens.{input, candidates, total, thoughts, ...}`.
   * Older builds emitted flatter `{ input, output }` keys. We parse both
   * shapes so the cost tracker stays accurate across versions.
   */
  stats?: {
    input?: number;
    output?: number;
    inputTokens?: number;
    outputTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    models?: Record<
      string,
      {
        tokens?: {
          input?: number;
          prompt?: number;
          candidates?: number;
          output?: number;
          total?: number;
          cached?: number;
          thoughts?: number;
          tool?: number;
        };
      }
    >;
  };
  error?: { message?: string; code?: string } | string;
}

interface GeminiCliStreamEvent {
  type: 'init' | 'message' | 'tool_use' | 'tool_result' | 'error' | 'result';
  /** message events carry { role, content | delta, ...} */
  role?: string;
  content?: string;
  delta?: string;
  /** tool_use events carry { name, args, id } */
  name?: string;
  args?: unknown;
  id?: string;
  /** result events carry usage stats */
  stats?: GeminiCliJsonOutput['stats'];
  /** error events carry diagnostic info */
  error?: { message?: string; code?: string } | string;
  message?: string;
}

export class GeminiCliProvider implements Provider {
  private readonly binaryPath: string;
  private model: string;
  private readonly requestTimeoutMs: number;
  private readonly approvalMode: NonNullable<GeminiCliProviderOptions['approvalMode']>;
  private readonly extraEnv: Record<string, string>;

  constructor(opts: GeminiCliProviderOptions) {
    if (!opts.binaryPath || typeof opts.binaryPath !== 'string') {
      throw new Error('GeminiCliProvider: binaryPath is required');
    }
    if (!opts.model || typeof opts.model !== 'string') {
      throw new Error('GeminiCliProvider: model is required');
    }
    this.binaryPath = opts.binaryPath;
    this.model = opts.model;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.approvalMode = opts.approvalMode ?? 'plan';
    this.extraEnv = opts.extraEnv ?? {};
  }

  setModel(model: string): void {
    this.model = model;
  }

  getProviderName(): string {
    return 'gemini-cli';
  }

  // ──────────── chat() ────────────

  async chat(
    messages: CodeBuddyMessage[],
    _tools?: CodeBuddyTool[],
    opts?: ChatOptions,
  ): Promise<CodeBuddyResponse> {
    const model = opts?.model ?? this.model;
    const prompt = formatMessagesForCli(messages);
    const args = ['-p', prompt, '-m', model, '-o', 'json', '--approval-mode', this.approvalMode];

    const { stdout, stderr, exitCode } = await spawnAndCollect(
      this.binaryPath,
      args,
      this.extraEnv,
      opts?.timeoutMs ?? this.requestTimeoutMs,
    );

    if (exitCode !== 0) {
      throw mapExitCode(exitCode, stderr || stdout);
    }

    let parsed: GeminiCliJsonOutput;
    try {
      parsed = JSON.parse(stdout) as GeminiCliJsonOutput;
    } catch (err) {
      throw new Error(
        `gemini-cli: invalid JSON on stdout (${(err as Error).message}). First 200 chars: ${stdout.slice(0, 200)}`,
      );
    }

    if (parsed.error) {
      const msg = typeof parsed.error === 'string'
        ? parsed.error
        : (parsed.error.message ?? JSON.stringify(parsed.error));
      throw new Error(`gemini-cli: API error — ${msg}`);
    }

    const content = parsed.response ?? '';
    if (content.trim().length === 0) {
      throw new Error('gemini-cli: empty response content');
    }
    const usage = mapStatsToUsage(parsed.stats);

    return {
      choices: [
        {
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage,
    };
  }

  // ──────────── chatStream() ────────────

  async *chatStream(
    messages: CodeBuddyMessage[],
    _tools?: CodeBuddyTool[],
    opts?: ChatOptions,
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const model = opts?.model ?? this.model;
    const prompt = formatMessagesForCli(messages);
    const args = [
      '-p',
      prompt,
      '-m',
      model,
      '-o',
      'stream-json',
      '--approval-mode',
      this.approvalMode,
    ];

    const child = spawn(this.binaryPath, args, {
      shell: false,
      env: { ...process.env, ...this.extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      logger.warn('[gemini-cli] stream timeout — sending SIGTERM');
      killChild(child);
    }, opts?.timeoutMs ?? this.requestTimeoutMs);

    const stderrChunks: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));
    child.on('error', (err) => {
      logger.warn('[gemini-cli] spawn error', { error: err.message });
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    let emittedContent = false;
    let sawResult = false;

    try {
      let bytesSeen = 0;
      for await (const line of rl) {
        bytesSeen += Buffer.byteLength(line, 'utf-8');
        if (bytesSeen > STDOUT_BYTES_CAP) {
          killChild(child);
          throw new Error(`gemini-cli: stream exceeded ${STDOUT_BYTES_CAP} bytes`);
        }
        if (!line.trim()) continue;

        let event: GeminiCliStreamEvent;
        try {
          event = JSON.parse(line) as GeminiCliStreamEvent;
        } catch {
          // Defensive: skip non-JSON noise (some CLI versions emit prelude lines).
          logger.debug('[gemini-cli] skipping non-JSON stream line', { preview: line.slice(0, 80) });
          continue;
        }

        switch (event.type) {
          case 'init':
            // Session metadata — ignore for now.
            break;
          case 'message': {
            const delta = event.delta ?? event.content ?? '';
            if (!delta) break;
            if (delta.trim().length > 0) {
              emittedContent = true;
            }
            yield {
              id: 'gemini-cli-stream',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: delta },
                  finish_reason: null,
                },
              ],
            } as ChatCompletionChunk;
            break;
          }
          case 'tool_use':
          case 'tool_result':
            // v1 — ignored (Code Buddy owns the tool loop).
            logger.debug('[gemini-cli] ignored stream event in v1', { type: event.type });
            break;
          case 'error': {
            const msg = typeof event.error === 'string'
              ? event.error
              : (event.error?.message ?? event.message ?? 'unknown stream error');
            logger.warn('[gemini-cli] stream warning', { msg });
            break;
          }
          case 'result':
            sawResult = true;
            break;
        }
      }
    } finally {
      clearTimeout(timeout);
      rl.close();
    }

    // Wait for child to fully exit so we can inspect the exit code.
    const exitCode = await waitForExit(child);
    if (exitCode !== 0) {
      throw mapExitCode(exitCode, stderrChunks.join(''));
    }
    if (!emittedContent) {
      throw new Error('gemini-cli: empty response content');
    }
    if (sawResult) {
      yield {
        id: 'gemini-cli-stream',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      } as ChatCompletionChunk;
    }
  }
}

// ──────────── helpers ────────────

/**
 * Flatten a message array into a single prompt string.
 *
 * Gemini CLI accepts a single `-p` prompt at the moment (no native
 * multi-message API in headless mode). We preserve roles via markdown
 * headers so the model has the context.
 */
export function formatMessagesForCli(messages: CodeBuddyMessage[]): string {
  const blocks: string[] = [];
  for (const msg of messages) {
    if (!msg) continue;
    const role = (msg as { role?: string }).role ?? 'user';
    const content = extractMessageText(msg);
    if (!content) continue;
    if (role === 'system') {
      blocks.push(`# System\n${content}`);
    } else if (role === 'assistant') {
      blocks.push(`# Assistant\n${content}`);
    } else if (role === 'tool') {
      blocks.push(`# Tool result\n${content}`);
    } else {
      blocks.push(`# User\n${content}`);
    }
  }
  return blocks.join('\n\n');
}

function extractMessageText(msg: CodeBuddyMessage): string {
  const content = (msg as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return (part as { text?: string }).text ?? '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function mapStatsToUsage(
  stats: GeminiCliJsonOutput['stats'] | undefined,
): CodeBuddyResponse['usage'] {
  if (!stats) return undefined;

  // Modern shape: stats.models[<id>].tokens.{input, candidates, ...}.
  // Sum across all models referenced in the call (sub-agents + main).
  let nestedInput = 0;
  let nestedOutput = 0;
  if (stats.models) {
    for (const m of Object.values(stats.models)) {
      const t = m?.tokens ?? {};
      nestedInput += t.input ?? t.prompt ?? 0;
      nestedOutput += t.candidates ?? t.output ?? 0;
    }
  }

  // Flat shape (older builds and our own tests).
  const flatInput = stats.input ?? stats.inputTokens ?? stats.promptTokens ?? 0;
  const flatOutput = stats.output ?? stats.outputTokens ?? stats.completionTokens ?? 0;

  const input = nestedInput || flatInput;
  const output = nestedOutput || flatOutput;
  if (!input && !output) return undefined;

  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
  };
}

function mapExitCode(code: number | null, details: string): Error {
  const trimmed = (details || '').slice(0, 500).trim();
  switch (code) {
    case 42:
      return new Error(`gemini-cli: INPUT_ERROR (exit 42) — ${trimmed || 'invalid prompt or arguments'}`);
    case 53:
      return new Error(`gemini-cli: TURN_LIMIT_EXCEEDED (exit 53) — ${trimmed}`);
    case 1:
      return new Error(`gemini-cli: API_FAILURE (exit 1) — ${trimmed}`);
    default:
      return new Error(`gemini-cli: spawn exited with code ${code} — ${trimmed}`);
  }
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function spawnAndCollect(
  binary: string,
  args: string[],
  extraEnv: Record<string, string>,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      logger.warn('[gemini-cli] timeout — sending SIGTERM');
      killChild(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_BYTES_CAP) {
        killed = true;
        killChild(child);
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`gemini-cli: failed to spawn ${binary} — ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (killed && code !== 0) {
        reject(
          new Error(
            stdoutBytes > STDOUT_BYTES_CAP
              ? `gemini-cli: stdout exceeded ${STDOUT_BYTES_CAP} bytes`
              : `gemini-cli: timeout after ${timeoutMs}ms`,
          ),
        );
        return;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code,
      });
    });
  });
}

function killChild(child: GeminiCliChild): void {
  try {
    child.kill('SIGTERM');
  } catch {
    /* already dead */
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }, KILL_GRACE_MS).unref?.();
}

function waitForExit(child: GeminiCliChild): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once('close', (code) => resolve(code));
  });
}
