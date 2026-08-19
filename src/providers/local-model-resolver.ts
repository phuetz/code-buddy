/**
 * Local-model resolution for Ollama.
 *
 * Fixes the "$0 local" onboarding trap: `CODEBUDDY_PROVIDER=ollama buddy`
 * used to detect Ollama correctly but then send a stale cloud model id
 * (`grok-code-fast-1`) as the request model, producing a cryptic
 * `404 model 'grok-code-fast-1' not found`.
 *
 * The resolver probes the tags actually installed on the local Ollama
 * server and picks a real one (preferring a coding model). If the server
 * is reachable but empty, or unreachable, callers get a clear, actionable
 * signal (`ollama pull <model>`) instead of a 404.
 *
 * Pure functions (probe is injectable) so the whole thing is unit-testable
 * without a live Ollama.
 */

const OLLAMA_TAGS_TIMEOUT_MS = 2_000;

/** Default coding model advertised during onboarding — the pull hint target. */
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown; model?: unknown }>;
}

/**
 * Choose an installed Ollama model without assuming an exact tag.
 *
 * Order: an exact match for `requested` → a coding-oriented model
 * (qwen coder, devstral, codestral, anything "coder"/"code") → the first
 * installed model. Returns `null` when nothing is installed.
 */
export function chooseInstalledOllamaModel(
  models: readonly string[],
  requested?: string,
): string | null {
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

/** Turn an Ollama base URL (with or without a trailing `/v1`) into its `/api/tags` endpoint. */
export function ollamaTagsUrl(baseURL: string): string {
  let host = (baseURL || 'http://localhost:11434').trim();
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  host = host.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${host}/api/tags`;
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

/**
 * Fetch the installed model tags from a local Ollama server.
 *
 * Returns `null` when the server can't be reached or returns junk (so the
 * caller can distinguish "Ollama is down" from "no models installed"), or a
 * (possibly empty) list of tag names when it responds.
 */
export async function fetchOllamaTags(
  baseURL: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string[] | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? OLLAMA_TAGS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ollamaTagsUrl(baseURL), { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return parseOllamaModels(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface OllamaModelResolution {
  /** The chosen installed model, or `null` when none is usable. */
  model: string | null;
  /** Whether the server was reachable (null tags ⇒ unreachable). */
  reachable: boolean;
  /** Number of installed models seen (0 when unreachable). */
  installedCount: number;
}

/**
 * Resolve the model to send to a local Ollama provider: probe the server,
 * then pick an installed tag (preferring `requested`, then a coder model).
 */
export async function resolveInstalledOllamaModel(options: {
  baseURL: string;
  requested?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OllamaModelResolution> {
  const tags = await fetchOllamaTags(options.baseURL, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (tags === null) {
    return { model: null, reachable: false, installedCount: 0 };
  }
  return {
    model: chooseInstalledOllamaModel(tags, options.requested),
    reachable: true,
    installedCount: tags.length,
  };
}

/**
 * Build the clear, actionable message shown when no local model can be
 * resolved — the honest replacement for the cryptic Grok 404.
 */
export function buildOllamaPullHint(options: {
  baseURL: string;
  reachable: boolean;
  requested?: string;
}): string {
  const model = options.requested?.trim() || DEFAULT_OLLAMA_MODEL;
  if (!options.reachable) {
    return [
      `Ollama not reachable at ${options.baseURL}.`,
      'Start it, then install a model:',
      '  ollama serve            # if it is not already running',
      `  ollama pull ${model}`,
    ].join('\n');
  }
  return [
    'No Ollama model is installed for the local ($0) path.',
    'Install one, then re-run:',
    `  ollama pull ${model}`,
  ].join('\n');
}
