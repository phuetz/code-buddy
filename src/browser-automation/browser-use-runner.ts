/**
 * Browser Use Runner
 *
 * browser-use is an open-source agentic browser-automation library. This runner
 * routes a task through one of three paths, in precedence order:
 *
 *   1. The Browser Use **managed API** (via `BROWSER_USE_API_KEY`), or
 *   2. The **Nous Tool Gateway** (`CODEBUDDY_NOUS_TOOL_GATEWAY_URL`), or
 *   3. A **local** browser-use install driven against a local Ollama model
 *      (no paid account required). Enabled with `CODEBUDDY_BROWSER_USE_LOCAL=1`
 *      or auto-detected when the `browser_use` Python package is importable and
 *      neither managed path is configured.
 *
 * The managed paths (1 and 2) speak HTTP via `fetch`. The local path (3) spawns
 * a Python subprocess that runs `Agent(task=..., llm=ChatOllama(...)).run()` and
 * prints a sentinel-delimited JSON result line, which we parse and normalise
 * back into the same `BrowserUseActionResult` shape.
 *
 * Returns structured results with optional screenshot data. Falls back
 * gracefully (typed error result, never throws) when nothing is configured.
 */

import { spawn, spawnSync } from 'child_process';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserUseRunnerOptions {
  /** Browser Use API key (falls back to `BROWSER_USE_API_KEY` env). */
  apiKey?: string;
  /** Nous Tool Gateway URL (falls back to `CODEBUDDY_NOUS_TOOL_GATEWAY_URL` env). */
  gatewayUrl?: string;
  /** Request/run timeout in milliseconds (default: 60 000 managed, 180 000 local). */
  timeout?: number;
  /**
   * Force/disable the local browser-use path explicitly. When undefined it is
   * read from `CODEBUDDY_BROWSER_USE_LOCAL` and otherwise auto-detected.
   */
  local?: boolean;
  /**
   * Python interpreter that has the `browser_use` package installed.
   * Defaults to `$CODEBUDDY_BROWSER_USE_PYTHON`, then `python3`.
   */
  pythonPath?: string;
  /**
   * Ollama model the local browser-use agent should drive. Defaults to
   * `$CODEBUDDY_BROWSER_USE_MODEL`, then `qwen2.5:7b-instruct` (a tool-calling
   * capable model — browser-use relies on structured tool calls).
   */
  model?: string;
  /**
   * Ollama host the local agent should connect to. Defaults to `$OLLAMA_HOST`,
   * then `http://localhost:11434`.
   */
  ollamaHost?: string;
  /**
   * Path to a Chrome/Chromium binary for browser-use to launch
   * (`BrowserProfile.executable_path`). Defaults to `$CODEBUDDY_BROWSER_USE_CHROME`.
   * On sandboxed Linux/CI hosts the snap-confined chromium often fails the
   * 30 s browser-start watchdog; pointing at a plain Chromium binary (e.g. the
   * Playwright cache) plus `chromiumSandbox: false` is what makes launch work.
   */
  chromePath?: string;
  /**
   * Disable Chromium's sandbox and add `--no-sandbox` (needed inside most
   * containers / sandboxed CI). Defaults from `$CODEBUDDY_BROWSER_USE_NO_SANDBOX`
   * (truthy), else true on Linux where the sandbox commonly blocks launch.
   */
  noSandbox?: boolean;
  /**
   * Whether browser-use should send screenshots to the model. browser-use sends
   * them by default, which 400s on text-only Ollama models
   * (`Multimodal data provided, but model does not support multimodal requests`).
   * Defaults to `false` so the default text model works; set true with a vision
   * model. Read from `$CODEBUDDY_BROWSER_USE_VISION` when undefined.
   */
  useVision?: boolean;
  /** Max agent steps for the local run (default: 6). */
  maxSteps?: number;
}

export interface BrowserUseActionResult {
  ok: boolean;
  /** Extracted page content or action result text. */
  content?: string;
  /** Base64-encoded screenshot, when the service provides one. */
  screenshot?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;
/** Local agentic navigation is multi-step against a local model — give it room. */
const DEFAULT_LOCAL_TIMEOUT_MS = 180_000;
const BROWSER_USE_API_URL = 'https://api.browser-use.com/api/v1/run-task';
const DEFAULT_LOCAL_MODEL = 'qwen2.5:7b-instruct';
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

/** Sentinel the Python entrypoint wraps its JSON result with, so we can pull it
 * out of browser-use's very noisy step-by-step stdout (analogous to camofox's
 * wsEndpoint parsing). */
const RESULT_SENTINEL = '__CB_BU_RESULT__';

interface ResolvedEndpoint {
  kind: 'browser-use-api' | 'nous-gateway';
  url: string;
  headers: Record<string, string>;
}

/**
 * Determine which managed endpoint to use, preferring the Browser Use API when
 * an API key is available, then falling back to the Nous Tool Gateway. Returns
 * null when neither managed path is configured (caller then considers local).
 */
function resolveEndpoint(options: BrowserUseRunnerOptions = {}): ResolvedEndpoint | null {
  const apiKey = options.apiKey ?? process.env.BROWSER_USE_API_KEY?.trim();
  const gatewayUrl = options.gatewayUrl ?? process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL?.trim();

  if (apiKey) {
    return {
      kind: 'browser-use-api',
      url: BROWSER_USE_API_URL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    };
  }

  if (gatewayUrl) {
    // The Nous Tool Gateway expects a POST to /browser-use with a JSON body.
    const base = gatewayUrl.replace(/\/+$/, '');
    return {
      kind: 'nous-gateway',
      url: `${base}/browser-use`,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  return null;
}

/**
 * Build the request body matching the Browser Use API schema.
 * The Nous Tool Gateway accepts the same shape.
 */
function buildRequestBody(action: string, url: string): Record<string, unknown> {
  return {
    task: action,
    url,
  };
}

/**
 * Normalise the JSON response into our unified result type.
 * Both endpoints return slightly different shapes but converge on a few
 * common fields.
 */
function normaliseResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: Record<string, any>,
): Pick<BrowserUseActionResult, 'content' | 'screenshot'> {
  return {
    content:
      typeof json.result === 'string' ? json.result
        : typeof json.content === 'string' ? json.content
          : typeof json.output === 'string' ? json.output
            : typeof json.text === 'string' ? json.text
              : JSON.stringify(json),
    screenshot:
      typeof json.screenshot === 'string' ? json.screenshot : undefined,
  };
}

// ---------------------------------------------------------------------------
// Local path
// ---------------------------------------------------------------------------

/**
 * Resolve whether the local browser-use path should be used. Precedence:
 *   - explicit `options.local`
 *   - `CODEBUDDY_BROWSER_USE_LOCAL` truthy (`1`/`true`/`yes`)
 *   - auto-detect: `browser_use` is importable by the chosen interpreter.
 *
 * The auto-detect probe (a fast `python3 -c "import browser_use"`) only runs on
 * the no-managed-config path, so it never adds latency when an API key/gateway
 * is present.
 */
function shouldUseLocal(options: BrowserUseRunnerOptions): boolean {
  if (typeof options.local === 'boolean') return options.local;

  const flag = process.env.CODEBUDDY_BROWSER_USE_LOCAL?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;

  return detectLocalBrowserUse(resolvePython(options));
}

function resolvePython(options: BrowserUseRunnerOptions): string {
  return options.pythonPath ?? (process.env.CODEBUDDY_BROWSER_USE_PYTHON?.trim() || 'python3');
}

function isTruthyEnv(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return undefined;
}

/**
 * The Chromium sandbox commonly blocks browser-use's launch inside containers /
 * sandboxed CI (the 30 s browser-start watchdog fires). Default to disabling it
 * on Linux, where this is the common failure; honour explicit option/env first.
 */
function resolveNoSandbox(options: BrowserUseRunnerOptions): boolean {
  if (typeof options.noSandbox === 'boolean') return options.noSandbox;
  const env = isTruthyEnv(process.env.CODEBUDDY_BROWSER_USE_NO_SANDBOX);
  if (typeof env === 'boolean') return env;
  return process.platform === 'linux';
}

/**
 * browser-use sends screenshots to the model by default, which 400s on text-only
 * Ollama models. Default vision OFF so the default text model works; explicit
 * option/env overrides (set true when driving a vision-capable model).
 */
function resolveUseVision(options: BrowserUseRunnerOptions): boolean {
  if (typeof options.useVision === 'boolean') return options.useVision;
  return isTruthyEnv(process.env.CODEBUDDY_BROWSER_USE_VISION) ?? false;
}

/** Probe: is the `browser_use` package importable by `python`? */
function detectLocalBrowserUse(python: string): boolean {
  try {
    const result = spawnSync(python, ['-c', 'import browser_use'], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Inline Python entrypoint that runs a browser-use Agent against a local Ollama
 * model and prints a single `__CB_BU_RESULT__{json}` line on stdout.
 *
 * The browser launch is configured from CB_BU_* env (executable path,
 * no-sandbox, headless) — this is the config live-validated on a sandboxed
 * Linux host (browser-use 0.13.1): a plain Chromium binary + chromium_sandbox
 * disabled is what gets past the 30 s browser-start watchdog. `use_vision` is
 * defaulted off so text-only Ollama models don't 400 on screenshot payloads.
 *
 * Kept resilient to browser-use API drift: the `ChatOllama` import location and
 * the final-result accessor (`.final_result()` / `.extracted_content()` / str)
 * vary across versions, so we try each in turn. The BrowserProfile / use_vision
 * wiring is best-effort — if an older/newer browser-use rejects a kwarg we fall
 * back to a bare `Agent(task, llm)`. Any failure is emitted as
 * `{"ok": false, "error": ...}` with the same sentinel, so the TS side always
 * gets a structured result.
 */
function buildLocalScript(): string {
  return [
    'import asyncio, json, os, sys',
    'SENTINEL = "' + RESULT_SENTINEL + '"',
    '',
    'def emit(obj):',
    '    sys.stdout.write(SENTINEL + json.dumps(obj) + "\\n")',
    '    sys.stdout.flush()',
    '',
    'def envflag(name):',
    '    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes")',
    '',
    'def make_llm(model, host):',
    '    # ChatOllama moved across browser-use versions; try known locations.',
    '    errors = []',
    '    for mod, attr in (("browser_use.llm", "ChatOllama"),',
    '                      ("langchain_ollama", "ChatOllama"),',
    '                      ("langchain_community.chat_models", "ChatOllama")):',
    '        try:',
    '            m = __import__(mod, fromlist=[attr])',
    '            cls = getattr(m, attr)',
    '        except Exception as e:',
    '            errors.append(str(e)); continue',
    '        for kwargs in ({"model": model, "host": host},',
    '                       {"model": model, "base_url": host},',
    '                       {"model": model}):',
    '            try:',
    '                return cls(**kwargs)',
    '            except Exception as e:',
    '                errors.append(str(e))',
    '    raise RuntimeError("Could not construct ChatOllama: " + "; ".join(errors))',
    '',
    'def make_profile():',
    '    # Best-effort: build a BrowserProfile that launches a real Chromium',
    '    # without the sandbox (the combo that passes the browser-start watchdog',
    '    # on sandboxed Linux/CI). Returns None if BrowserProfile is unavailable.',
    '    try:',
    '        from browser_use.browser.profile import BrowserProfile',
    '    except Exception:',
    '        return None',
    '    no_sandbox = envflag("CB_BU_NO_SANDBOX")',
    '    kwargs = {"headless": True}',
    '    chrome = os.environ.get("CB_BU_CHROME", "").strip()',
    '    if chrome:',
    '        kwargs["executable_path"] = chrome',
    '    if no_sandbox:',
    '        kwargs["chromium_sandbox"] = False',
    '        kwargs["args"] = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]',
    '    try:',
    '        return BrowserProfile(**kwargs)',
    '    except Exception:',
    '        return None',
    '',
    'def make_agent(task, llm):',
    '    from browser_use import Agent',
    '    use_vision = envflag("CB_BU_VISION")',
    '    profile = make_profile()',
    '    # Try the richest constructor first, then degrade gracefully on TypeError',
    '    # so we stay compatible across browser-use versions.',
    '    attempts = []',
    '    if profile is not None:',
    '        attempts.append({"browser_profile": profile, "use_vision": use_vision})',
    '        attempts.append({"browser_profile": profile})',
    '    attempts.append({"use_vision": use_vision})',
    '    attempts.append({})',
    '    last = None',
    '    for extra in attempts:',
    '        try:',
    '            return Agent(task=task, llm=llm, **extra)',
    '        except TypeError as e:',
    '            last = e',
    '    raise last if last else RuntimeError("Could not construct Agent")',
    '',
    'def extract(history):',
    '    # browser-use Agent.run() returns a history object; pull final text.',
    '    for accessor in ("final_result", "extracted_content"):',
    '        fn = getattr(history, accessor, None)',
    '        if callable(fn):',
    '            try:',
    '                val = fn()',
    '                if val:',
    '                    return val if isinstance(val, str) else json.dumps(val, default=str)',
    '            except Exception:',
    '                pass',
    '    return str(history)',
    '',
    'async def run_agent(agent):',
    '    try:',
    '        return await agent.run(max_steps=int(os.environ.get("CB_BU_MAX_STEPS", "6")))',
    '    except TypeError:',
    '        return await agent.run()',
    '',
    'async def main():',
    '    task = os.environ["CB_BU_TASK"]',
    '    url = os.environ.get("CB_BU_URL", "").strip()',
    '    model = os.environ.get("CB_BU_MODEL", "' + DEFAULT_LOCAL_MODEL + '")',
    '    host = os.environ.get("CB_BU_OLLAMA_HOST", "' + DEFAULT_OLLAMA_HOST + '")',
    '    full_task = task if not url else (task + "\\nStart at this URL: " + url)',
    '    llm = make_llm(model, host)',
    '    agent = make_agent(full_task, llm)',
    '    history = await run_agent(agent)',
    '    emit({"ok": True, "content": extract(history)})',
    '',
    'try:',
    '    asyncio.run(main())',
    'except Exception as e:',
    '    emit({"ok": False, "error": type(e).__name__ + ": " + str(e)})',
  ].join('\n');
}

/** Pull the last sentinel-prefixed JSON object out of accumulated stdout. */
export function parseLocalResult(stdout: string): BrowserUseActionResult | null {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    const idx = line.indexOf(RESULT_SENTINEL);
    if (idx === -1) continue;
    const jsonText = line.slice(idx + RESULT_SENTINEL.length).trim();
    try {
      const parsed = JSON.parse(jsonText) as {
        ok?: boolean;
        content?: unknown;
        screenshot?: unknown;
        error?: unknown;
      };
      if (parsed.ok) {
        return {
          ok: true,
          content: typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content),
          screenshot: typeof parsed.screenshot === 'string' ? parsed.screenshot : undefined,
        };
      }
      return {
        ok: false,
        error: typeof parsed.error === 'string' ? parsed.error : 'Local browser-use run failed.',
      };
    } catch {
      // Not valid JSON on this line; keep scanning earlier lines.
    }
  }
  return null;
}

/**
 * Run the task locally via a spawned browser-use Python subprocess. Never
 * throws — always resolves to a typed `BrowserUseActionResult`.
 */
async function runLocalBrowserUse(
  action: string,
  url: string,
  options: BrowserUseRunnerOptions,
): Promise<BrowserUseActionResult> {
  const python = resolvePython(options);
  const timeoutMs = options.timeout ?? DEFAULT_LOCAL_TIMEOUT_MS;
  const model = options.model ?? (process.env.CODEBUDDY_BROWSER_USE_MODEL?.trim() || DEFAULT_LOCAL_MODEL);
  const ollamaHost = options.ollamaHost ?? (process.env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST);
  const chromePath = options.chromePath ?? (process.env.CODEBUDDY_BROWSER_USE_CHROME?.trim() || '');
  const noSandbox = resolveNoSandbox(options);
  const useVision = resolveUseVision(options);
  const maxSteps = options.maxSteps ?? 6;
  const script = buildLocalScript();

  logger.debug(
    `[browser-use-runner] local → ${python} (model=${model}, host=${ollamaHost}, ` +
      `vision=${useVision}, noSandbox=${noSandbox}, action=${action.slice(0, 80)})`,
  );

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CB_BU_TASK: action,
    CB_BU_URL: url,
    CB_BU_MODEL: model,
    CB_BU_OLLAMA_HOST: ollamaHost,
    CB_BU_CHROME: chromePath,
    CB_BU_NO_SANDBOX: noSandbox ? '1' : '0',
    CB_BU_VISION: useVision ? '1' : '0',
    CB_BU_MAX_STEPS: String(maxSteps),
  };

  return await new Promise<BrowserUseActionResult>((resolve) => {
    let proc;
    try {
      proc = spawn(python, ['-c', script], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[browser-use-runner] local spawn failed: ${message}`);
      resolve({ ok: false, error: `Failed to spawn ${python} for local browser-use: ${message}` });
      return;
    }

    let settled = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const finish = (result: BrowserUseActionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* best-effort */ }
      logger.warn(`[browser-use-runner] local run timed out after ${timeoutMs}ms.`);
      finish({ ok: false, error: `Local browser-use run timed out after ${timeoutMs}ms.` });
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err: Error) => {
      const hint = /ENOENT/.test(err.message)
        ? ` Python interpreter '${python}' not found, or the browser_use package is not installed. ` +
          'Install with: python3 -m venv <venv> && <venv>/bin/pip install browser-use && <venv>/bin/playwright install chromium, ' +
          'then set CODEBUDDY_BROWSER_USE_PYTHON=<venv>/bin/python.'
        : '';
      logger.warn(`[browser-use-runner] local spawn error: ${err.message}${hint}`);
      finish({ ok: false, error: `Local browser-use spawn error: ${err.message}${hint}` });
    });

    proc.on('close', (code: number | null) => {
      const parsed = parseLocalResult(stdoutBuf);
      if (parsed) {
        finish(parsed);
        return;
      }
      const detail = classifyLocalError(stderrBuf || stdoutBuf);
      finish({
        ok: false,
        error: `Local browser-use exited (code ${code ?? 'null'}) without a result. ${detail}`.trim(),
      });
    });
  });
}

/** Map common local failures to an actionable message. */
function classifyLocalError(output: string): string {
  const text = output.trim();
  if (!text) return 'No diagnostic output was produced.';

  if (/No module named ['"]?browser_use|ModuleNotFoundError.*browser_use/i.test(text)) {
    return (
      'The browser_use Python package is not importable by the chosen interpreter. ' +
      'Install with: python3 -m venv <venv> && <venv>/bin/pip install browser-use && ' +
      '<venv>/bin/playwright install chromium, then set CODEBUDDY_BROWSER_USE_PYTHON=<venv>/bin/python.'
    );
  }

  if (/No module named ['"]?(langchain_ollama|playwright)/i.test(text)) {
    return 'A browser-use dependency is missing (langchain-ollama / playwright). Reinstall browser-use and run `playwright install chromium`.';
  }

  if (/ConnectionError|Connection refused|Failed to connect|11434/i.test(text)) {
    return 'Could not reach the local Ollama server. Start Ollama (default http://localhost:11434) or set OLLAMA_HOST, and pull a tool-calling model (e.g. qwen2.5:7b-instruct).';
  }

  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? text.slice(0, 200);
  return `Diagnostic: ${firstLine}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a browser action through the Browser Use service.
 *
 * ```ts
 * const result = await executeBrowserUseAction(
 *   'Extract the main heading',
 *   'https://example.com',
 * );
 * if (result.ok) console.log(result.content);
 * ```
 */
export async function executeBrowserUseAction(
  action: string,
  url: string,
  options: BrowserUseRunnerOptions = {},
): Promise<BrowserUseActionResult> {
  const endpoint = resolveEndpoint(options);

  // No managed endpoint — try the local open-source path (no paid account).
  if (!endpoint) {
    if (shouldUseLocal(options)) {
      return runLocalBrowserUse(action, url, options);
    }

    return {
      ok: false,
      error:
        'Browser Use is not configured. Set BROWSER_USE_API_KEY or CODEBUDDY_NOUS_TOOL_GATEWAY_URL, ' +
        'or run locally with CODEBUDDY_BROWSER_USE_LOCAL=1 (requires `pip install browser-use` + a local Ollama model).',
    };
  }

  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    logger.debug(
      `[browser-use-runner] ${endpoint.kind} → POST ${endpoint.url} (action=${action.slice(0, 80)})`,
    );

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify(buildRequestBody(action, url)),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = `${endpoint.kind} returned HTTP ${response.status}: ${body.slice(0, 200)}`;
      logger.warn(`[browser-use-runner] ${message}`);
      return { ok: false, error: message };
    }

    const json = (await response.json()) as Record<string, unknown>;
    const { content, screenshot } = normaliseResponse(json);

    return { ok: true, content, screenshot };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const errorText = isAbort
      ? `Request to ${endpoint.kind} timed out after ${timeoutMs}ms.`
      : `${endpoint.kind} request failed: ${message}`;
    logger.warn(`[browser-use-runner] ${errorText}`);
    return { ok: false, error: errorText };
  }
}
