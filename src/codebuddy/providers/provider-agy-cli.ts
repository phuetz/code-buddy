/**
 * Antigravity (`agy`) CLI subprocess provider.
 *
 * The provider is deliberately text-only: Code Buddy owns tool execution,
 * permissions, memory, and the agent loop. `agy` is constrained to plan mode
 * and its sandbox, and receives no undocumented flags.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { ChatCompletionChunk } from 'openai/resources/chat';
import type {
  ChatOptions,
  CodeBuddyMessage,
  CodeBuddyResponse,
  CodeBuddyTool,
} from '../client.js';
import type { Provider } from './provider-interface.js';

type AgyChild = ChildProcessByStdio<null, Readable, Readable>;

export interface AgyCliProviderOptions {
  binaryPath: string;
  model: string;
  defaultMaxTokens: number;
  requestTimeoutMs?: number;
  extraEnv?: Record<string, string>;
}

const STDOUT_BYTES_CAP = 10 * 1024 * 1024;
const STDERR_BYTES_CAP = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const KILL_GRACE_MS = 5_000;
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g',
);

const ADVISOR_BOUNDARY = [
  '# External advisor boundary',
  'Return analysis as plain text only.',
  'Do not edit files, run commands, invoke tools, or ask for permissions.',
  'Code Buddy is the sole tool executor and will independently verify your answer.',
].join('\n');

export class AgyCliProvider implements Provider {
  private readonly binaryPath: string;
  private model: string;
  private readonly requestTimeoutMs: number;
  private readonly extraEnv: Record<string, string>;

  constructor(options: AgyCliProviderOptions) {
    if (!options.binaryPath?.trim()) {
      throw new Error('AgyCliProvider: binaryPath is required');
    }
    if (!options.model?.trim()) {
      throw new Error('AgyCliProvider: model is required');
    }
    this.binaryPath = options.binaryPath;
    this.model = options.model;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.extraEnv = options.extraEnv ?? {};
  }

  setModel(model: string): void {
    this.model = model;
  }

  getProviderName(): string {
    return 'agy-cli';
  }

  async chat(
    messages: CodeBuddyMessage[],
    _tools?: CodeBuddyTool[],
    options?: ChatOptions,
  ): Promise<CodeBuddyResponse> {
    const model = options?.model ?? this.model;
    const prompt = formatMessagesForAgy(messages);
    const result = await runAgy({
      binaryPath: this.binaryPath,
      model,
      prompt,
      timeoutMs: options?.timeoutMs ?? this.requestTimeoutMs,
      extraEnv: this.extraEnv,
      signal: options?.signal,
    });

    if (result.exitCode !== 0) {
      throw mapAgyError(result.exitCode, result.stderr || result.stdout);
    }
    const content = stripAnsi(result.stdout).trim();
    if (!content) {
      throw new Error('agy-cli: subprocess returned an empty response');
    }
    return {
      choices: [{
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
    };
  }

  async *chatStream(
    messages: CodeBuddyMessage[],
    _tools?: CodeBuddyTool[],
    options?: ChatOptions,
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const model = options?.model ?? this.model;
    const prompt = formatMessagesForAgy(messages);
    const child = spawnAgy(this.binaryPath, model, prompt, this.extraEnv);
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let stdoutBytes = 0;
    let terminalError: Error | null = null;

    const timeout = setTimeout(() => {
      terminalError = new Error(`agy-cli: timeout after ${timeoutMs}ms`);
      killChild(child);
    }, timeoutMs);
    const abort = () => {
      terminalError = new Error('agy-cli: request aborted');
      killChild(child);
    };
    options?.signal?.addEventListener('abort', abort, { once: true });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= STDERR_BYTES_CAP) stderrChunks.push(chunk);
    });
    child.on('error', (error) => {
      terminalError = new Error(`agy-cli: failed to spawn ${this.binaryPath} — ${error.message}`);
    });

    try {
      for await (const raw of child.stdout) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        stdoutBytes += chunk.length;
        if (stdoutBytes > STDOUT_BYTES_CAP) {
          terminalError = new Error(`agy-cli: stdout exceeded ${STDOUT_BYTES_CAP} bytes`);
          killChild(child);
          break;
        }
        const content = stripAnsi(chunk.toString('utf-8'));
        if (!content) continue;
        yield makeChunk(model, content, null);
      }
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abort);
    }

    const exitCode = await waitForExit(child);
    if (terminalError) throw terminalError;
    if (exitCode !== 0) {
      throw mapAgyError(exitCode, Buffer.concat(stderrChunks).toString('utf-8'));
    }
    yield makeChunk(model, '', 'stop');
  }
}

export function formatMessagesForAgy(messages: CodeBuddyMessage[]): string {
  const blocks = [ADVISOR_BOUNDARY];
  for (const message of messages) {
    if (!message) continue;
    const content = extractMessageText(message);
    if (!content) continue;
    const role = message.role === 'system'
      ? 'System'
      : message.role === 'assistant'
        ? 'Assistant'
        : message.role === 'tool'
          ? 'Tool result supplied by Code Buddy'
          : 'User';
    blocks.push(`# ${role}\n${content}`);
  }
  return blocks.join('\n\n');
}

function extractMessageText(message: CodeBuddyMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
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

function spawnAgy(
  binaryPath: string,
  model: string,
  prompt: string,
  extraEnv: Record<string, string>,
): AgyChild {
  return spawn(binaryPath, [
    '--print', prompt,
    '--mode', 'plan',
    '--sandbox',
    '--model', model,
    '--print-timeout', '5m',
  ], {
    shell: false,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

interface RunAgyOptions {
  binaryPath: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  extraEnv: Record<string, string>;
  signal?: AbortSignal;
}

interface RunAgyResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runAgy(options: RunAgyOptions): Promise<RunAgyResult> {
  return new Promise((resolve, reject) => {
    const child = spawnAgy(options.binaryPath, options.model, options.prompt, options.extraEnv);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | null = null;

    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      killChild(child);
    };
    const timeout = setTimeout(
      () => fail(new Error(`agy-cli: timeout after ${options.timeoutMs}ms`)),
      options.timeoutMs,
    );
    const abort = () => fail(new Error('agy-cli: request aborted'));
    options.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_BYTES_CAP) {
        fail(new Error(`agy-cli: stdout exceeded ${STDOUT_BYTES_CAP} bytes`));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= STDERR_BYTES_CAP) stderrChunks.push(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      reject(new Error(`agy-cli: failed to spawn ${options.binaryPath} — ${error.message}`));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (failure) {
        reject(failure);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode,
      });
    });
  });
}

function makeChunk(
  model: string,
  content: string,
  finishReason: 'stop' | null,
): ChatCompletionChunk {
  return {
    id: 'agy-cli-stream',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: content ? { role: 'assistant', content } : {},
      finish_reason: finishReason,
    }],
  } as ChatCompletionChunk;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

function mapAgyError(exitCode: number | null, details: string): Error {
  const summary = stripAnsi(details).trim().slice(0, 500);
  return new Error(`agy-cli: subprocess exited with code ${exitCode} — ${summary || 'no details'}`);
}

function killChild(child: AgyChild): void {
  try {
    child.kill('SIGTERM');
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      // The process already exited.
    }
  }, KILL_GRACE_MS).unref?.();
}

function waitForExit(child: AgyChild): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('close', resolve));
}
