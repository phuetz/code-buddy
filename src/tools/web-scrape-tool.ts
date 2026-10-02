import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
import { spawn } from '../utils/tool-process.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ToolResult } from '../types/index.js';
import { assertSafeUrl, type SSRFCheckResult } from '../security/ssrf-guard.js';
import { logger } from '../utils/logger.js';
import { WebSearchTool } from './web-search.js';

export type WebScrapeMode = 'http' | 'stealth' | 'dynamic';
export type WebScrapeFormat = 'markdown' | 'text' | 'html';

export interface WebScrapeInput {
  url: string;
  mode?: WebScrapeMode;
  format?: WebScrapeFormat;
  css?: Record<string, string>;
  timeout?: number;
  impersonate?: string;
  solveCloudflare?: boolean;
}

export interface ScraplingRequest {
  url: string;
  mode: WebScrapeMode;
  format: WebScrapeFormat;
  css?: Record<string, string>;
  timeout: number;
  impersonate?: string;
  solveCloudflare?: boolean;
}

export interface ScraplingRuntimeRequest extends ScraplingRequest {
  pythonPath: string;
  scriptPath: string;
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}

export interface ScraplingSuccessResponse {
  ok: true;
  status: number;
  engine: WebScrapeMode;
  markdown?: string;
  text?: string;
  html?: string;
  extracted?: Record<string, string[]>;
  title?: string;
}

export interface ScraplingErrorResponse {
  ok: false;
  error: string;
}

export type ScraplingResponse = ScraplingSuccessResponse | ScraplingErrorResponse;

export interface WebScrapeRuntime {
  env?: NodeJS.ProcessEnv;
  runScrapling?: (request: ScraplingRuntimeRequest) => Promise<ScraplingResponse>;
  spawn?: typeof spawn;
  fetchPage?: (url: string) => Promise<ToolResult>;
  checkUrl?: (url: string) => Promise<SSRFCheckResult>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_CHILD_OUTPUT_BYTES = 2_000_000;
const MAX_RENDERED_CONTENT_CHARS = 20_000;

let fallbackWebSearch: WebSearchTool | null = null;

function getWebSearch(): WebSearchTool {
  if (!fallbackWebSearch) fallbackWebSearch = new WebSearchTool();
  return fallbackWebSearch;
}

export class WebScrapeTool {
  constructor(private readonly runtime: WebScrapeRuntime = {}) {}

  async execute(input: WebScrapeInput): Promise<ToolResult> {
    try {
      const normalized = normalizeInput(input, this.runtime.env ?? process.env);
      const check = await (this.runtime.checkUrl ?? assertSafeUrl)(normalized.url);
      if (!check.safe) {
        return {
          success: false,
          error: `URL blocked by SSRF guard: ${check.reason ?? 'unsafe URL'}`,
        };
      }

      const env = this.runtime.env ?? process.env;
      const request: ScraplingRuntimeRequest = {
        ...normalized,
        pythonPath: await resolveScraplingPython(env),
        scriptPath: resolveScriptPath(),
        cwd: getToolWorkingDirectory(),
        timeoutMs: normalized.timeout,
        env,
      };

      let response: ScraplingResponse;
      try {
        const runner = this.runtime.runScrapling
          ?? ((runtimeRequest: ScraplingRuntimeRequest) => runScraplingViaPython(runtimeRequest, this.runtime.spawn ?? spawn));
        response = await runner(request);
      } catch (error) {
        if (isMissingPythonError(error)) {
          return await this.fallback(normalized.url, env, 'Python runtime was not found');
        }
        return { success: false, error: formatRuntimeError(error) };
      }

      if (!response.ok) {
        if (response.error === 'scrapling-not-installed') {
          return await this.fallback(normalized.url, env, 'Scrapling is not installed');
        }
        return { success: false, error: `Scrapling failed: ${response.error}` };
      }

      return {
        success: true,
        output: formatScraplingOutput(response, normalized.format),
        data: response,
      };
    } catch (error) {
      return { success: false, error: formatRuntimeError(error) };
    }
  }

  private async fallback(url: string, env: NodeJS.ProcessEnv, reason: string): Promise<ToolResult> {
    if (env.CODEBUDDY_SCRAPLING_NO_FALLBACK === 'true') {
      return {
        success: false,
        error: `${reason}. Run \`buddy scrape --setup\` to install the local Scrapling sidecar.`,
      };
    }

    logger.warn('Scrapling unavailable; falling back to web_fetch', { url, reason });
    try {
      const result = await (this.runtime.fetchPage ?? ((target: string) => getWebSearch().fetchPage(target)))(url);
      if (!result.success) {
        return {
          success: false,
          error: `Scrapling unavailable and web_fetch fallback failed: ${result.error ?? 'unknown error'}`,
        };
      }
      return {
        ...result,
        success: true,
        output: `Engine: fallback (web_fetch)\n\n${result.output ?? result.content ?? ''}`,
        metadata: {
          ...result.metadata,
          engine: 'fallback (web_fetch)',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Scrapling unavailable and web_fetch fallback failed: ${formatRuntimeError(error)}`,
      };
    }
  }
}

export async function resolveScraplingPython(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const explicit = env.CODEBUDDY_SCRAPLING_PYTHON?.trim() || env.BUDDY_SCRAPLING_PYTHON?.trim();
  if (explicit) return expandHome(explicit);

  const venvPython = path.join(
    os.homedir(),
    '.codebuddy',
    'scrapling',
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  try {
    await fs.access(resolveToolPath(venvPython));
    return venvPython;
  } catch {
    return process.platform === 'win32' ? 'python' : 'python3';
  }
}

export function resolveScraplingRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', 'buddy-scrapling');
}

export function resolveScriptPath(): string {
  return path.join(resolveScraplingRoot(), 'scrape.py');
}

export async function runScraplingViaPython(
  request: ScraplingRuntimeRequest,
  spawnProcess: typeof spawn = spawn,
): Promise<ScraplingResponse> {
  const { stdout, stderr } = await spawnWithTimeout(
    request.pythonPath,
    [request.scriptPath],
    JSON.stringify(toSidecarRequest(request)),
    request.cwd,
    request.timeoutMs,
    request.env,
    spawnProcess,
  );

  if (stderr.trim()) {
    logger.debug('Scrapling sidecar wrote to stderr', { stderr: stderr.slice(0, 1000) });
  }
  const parsed = parsePythonJson(stdout);
  if (!isScraplingResponse(parsed)) {
    throw new Error(`Scrapling runtime returned an unexpected response: ${stdout.slice(0, 500)}`);
  }
  return parsed;
}

function spawnWithTimeout(
  command: string,
  args: string[],
  stdin: string,
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
  spawnProcess: typeof spawn,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      finished = true;
      child.kill('SIGTERM');
      reject(new Error(`Scrapling runtime timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString('utf8'));
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const wrapped = new Error(`Failed to start Scrapling runtime (${command}): ${error.message}`) as NodeJS.ErrnoException;
      wrapped.code = error.code;
      reject(wrapped);
    });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(
          `Scrapling runtime exited with code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}: ${stderr || stdout}`.slice(0, 1200),
        ));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin?.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new Error(`Failed to write Scrapling request: ${error.message}`));
    });
    child.stdin?.end(`${stdin}\n`);
  });
}

export function parsePythonJson(stdout: string): unknown {
  const lines = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || !line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Python dependencies may print warnings before the final JSON payload.
    }
  }
  throw new Error(`Scrapling runtime did not emit JSON output: ${stdout.slice(0, 500)}`);
}

function normalizeInput(input: WebScrapeInput, env: NodeJS.ProcessEnv): Required<Pick<WebScrapeInput, 'url' | 'mode' | 'format' | 'timeout'>> & Omit<WebScrapeInput, 'url' | 'mode' | 'format' | 'timeout'> {
  if (!input || typeof input.url !== 'string' || input.url.trim() === '') {
    throw new Error('url must be a non-empty string');
  }
  const mode = input.mode ?? 'http';
  if (!['http', 'stealth', 'dynamic'].includes(mode)) {
    throw new Error('mode must be one of: http, stealth, dynamic');
  }
  const format = input.format ?? 'markdown';
  if (!['markdown', 'text', 'html'].includes(format)) {
    throw new Error('format must be one of: markdown, text, html');
  }
  const configuredTimeout = Number(env.CODEBUDDY_SCRAPLING_TIMEOUT_MS);
  const fallbackTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_TIMEOUT_MS;
  const timeout = input.timeout ?? fallbackTimeout;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
    throw new Error(`timeout must be between 1 and ${MAX_TIMEOUT_MS} milliseconds`);
  }
  return {
    url: input.url.trim(),
    mode,
    format,
    timeout: Math.round(timeout),
    ...(input.css ? { css: normalizeCss(input.css) } : {}),
    ...(input.impersonate?.trim() ? { impersonate: input.impersonate.trim() } : {}),
    ...(input.solveCloudflare !== undefined ? { solveCloudflare: input.solveCloudflare } : {}),
  };
}

function toSidecarRequest(request: ScraplingRuntimeRequest): ScraplingRequest {
  return {
    url: request.url,
    mode: request.mode,
    format: request.format,
    timeout: request.timeout,
    ...(request.css ? { css: request.css } : {}),
    ...(request.impersonate ? { impersonate: request.impersonate } : {}),
    ...(request.solveCloudflare !== undefined ? { solveCloudflare: request.solveCloudflare } : {}),
  };
}

function isScraplingResponse(value: unknown): value is ScraplingResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok === false) return typeof candidate.error === 'string';
  return candidate.ok === true
    && ['http', 'stealth', 'dynamic'].includes(String(candidate.engine))
    && typeof candidate.status === 'number'
    && (candidate.markdown === undefined || typeof candidate.markdown === 'string')
    && (candidate.text === undefined || typeof candidate.text === 'string')
    && (candidate.html === undefined || typeof candidate.html === 'string')
    && (candidate.title === undefined || typeof candidate.title === 'string')
    && isExtractedResult(candidate.extracted);
}

function normalizeCss(css: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [field, selector] of Object.entries(css)) {
    if (!field.trim() || typeof selector !== 'string' || !selector.trim()) {
      throw new Error('css must map non-empty field names to non-empty selectors');
    }
    normalized[field.trim()] = selector.trim();
  }
  return normalized;
}

function isExtractedResult(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(
    entry => Array.isArray(entry) && entry.every(item => typeof item === 'string'),
  );
}

function formatScraplingOutput(response: ScraplingSuccessResponse, format: WebScrapeFormat): string {
  const content = response[format] ?? '';
  const renderedContent = content.length > MAX_RENDERED_CONTENT_CHARS
    ? `${content.slice(0, MAX_RENDERED_CONTENT_CHARS)}\n\n[Content truncated...]`
    : content;
  const sections = [
    `Engine: ${response.engine}`,
    `Status: ${response.status}`,
  ];
  if (response.title) sections.push(`Title: ${response.title}`);
  sections.push('', renderedContent);
  if (response.extracted) {
    sections.push('', 'Extracted:', JSON.stringify(response.extracted, null, 2));
  }
  return sections.join('\n').trimEnd();
}

function isMissingPythonError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|not found|cannot find/i.test(message) && /python|runtime/i.test(message);
}

function formatRuntimeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function appendCapped(current: string, addition: string): string {
  const next = current + addition;
  if (Buffer.byteLength(next, 'utf8') <= MAX_CHILD_OUTPUT_BYTES) return next;
  return next.slice(-MAX_CHILD_OUTPUT_BYTES);
}
