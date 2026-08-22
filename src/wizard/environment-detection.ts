/**
 * Environment capability detection for onboarding / `buddy try` / `buddy doctor`.
 *
 * The single job of this module: answer "what can this machine talk to RIGHT
 * NOW, and which of those costs $0?" — so the setup surfaces can default to the
 * free path (Ollama local, or a signed-in ChatGPT subscription) instead of
 * asking a newcomer to understand 8 providers and 120 env vars.
 *
 * Every probe is best-effort, short-timeout, and never throws — a detection
 * failure just means "not available", never a crash.
 */

export type CapabilityKind = 'local' | 'oauth' | 'api-key';

export interface DetectedCapability {
  /** Stable id used by the wizard / try command. */
  id: string;
  /** Human-readable label. */
  label: string;
  kind: CapabilityKind;
  /** True when using it has $0 marginal cost (local runtime or a subscription). */
  free: boolean;
  /** Whether it is reachable / configured right now. */
  available: boolean;
  /** One-line human detail, e.g. "running · 2 models" or "signed in as x@y". */
  detail: string;
  /** Installed/served models, when the probe returned them. */
  models?: string[];
  /** OpenAI-compatible base URL, for local runtimes. */
  baseURL?: string;
  /** Command that finishes setup for this capability (login / pull / etc.). */
  setupCommand?: string;
}

export interface EnvironmentSnapshot {
  capabilities: DetectedCapability[];
  /** The best AVAILABLE free path, if any (Ollama-with-model → ChatGPT → xAI). */
  recommendedFree?: DetectedCapability;
  /** The best available path of any kind (free preferred, else an API key). */
  recommended?: DetectedCapability;
  /** True when at least one capability is usable right now. */
  ready: boolean;
}

const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';
const LMSTUDIO_DEFAULT_HOST = 'http://localhost:1234';

async function fetchJson(url: string, timeoutMs = 1500): Promise<unknown | null> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeHost(raw: string): string {
  let host = raw.trim();
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  return host.replace(/\/+$/, '');
}

/** Probe a local Ollama runtime (respects OLLAMA_HOST when set). */
export async function detectOllama(): Promise<DetectedCapability> {
  const host = normalizeHost(process.env.OLLAMA_HOST || OLLAMA_DEFAULT_HOST);
  const body = (await fetchJson(`${host}/api/tags`)) as { models?: { name: string }[] } | null;
  const base: DetectedCapability = {
    id: 'ollama',
    label: 'Ollama (local, $0)',
    kind: 'local',
    free: true,
    available: false,
    detail: 'not running',
    baseURL: `${host}/v1`,
    setupCommand: 'ollama serve',
  };
  if (!body) return base;
  const models = (body.models ?? []).map((m) => m.name).filter(Boolean);
  return {
    ...base,
    available: true,
    models,
    detail: models.length
      ? `running · ${models.length} model${models.length === 1 ? '' : 's'}`
      : 'running · no model pulled yet (run: ollama pull qwen2.5-coder:7b)',
    setupCommand: models.length ? undefined : 'ollama pull qwen2.5-coder:7b',
  };
}

/** Probe a local LM Studio server. */
export async function detectLmStudio(): Promise<DetectedCapability> {
  const host = normalizeHost(process.env.LMSTUDIO_HOST || LMSTUDIO_DEFAULT_HOST);
  const body = (await fetchJson(`${host}/v1/models`)) as { data?: { id: string }[] } | null;
  const base: DetectedCapability = {
    id: 'lmstudio',
    label: 'LM Studio (local, $0)',
    kind: 'local',
    free: true,
    available: false,
    detail: 'not running',
    baseURL: `${host}/v1`,
    setupCommand: 'Start the LM Studio local server',
  };
  if (!body) return base;
  const models = (body.data ?? []).map((m) => m.id).filter(Boolean);
  return {
    ...base,
    available: models.length > 0,
    models,
    detail: models.length ? `running · ${models.length} model${models.length === 1 ? '' : 's'}` : 'running · no model loaded',
  };
}

/** Check the ChatGPT (Codex) OAuth credential file. */
export async function detectChatGptOAuth(): Promise<DetectedCapability> {
  const base: DetectedCapability = {
    id: 'chatgpt',
    label: 'ChatGPT subscription (OAuth, $0)',
    kind: 'oauth',
    free: true,
    available: false,
    detail: 'not signed in',
    setupCommand: 'buddy login',
  };
  try {
    const { hasCodexCredentials, getChatGptAuth } = await import('../providers/codex-oauth.js');
    if (!hasCodexCredentials()) return base;
    const auth = await getChatGptAuth().catch(() => null);
    const who = auth?.email ? `signed in as ${auth.email}` : 'signed in';
    return { ...base, available: true, detail: who, setupCommand: undefined };
  } catch {
    return base;
  }
}

/** Check the xAI (Grok) OAuth credential file. */
export async function detectXaiOAuth(): Promise<DetectedCapability> {
  const base: DetectedCapability = {
    id: 'xai',
    label: 'Grok / xAI subscription (OAuth, $0)',
    kind: 'oauth',
    free: true,
    available: false,
    detail: 'not signed in',
    setupCommand: 'buddy login xai',
  };
  try {
    const { hasXaiCredentials } = await import('../providers/xai-oauth.js');
    if (!hasXaiCredentials()) return base;
    return { ...base, available: true, detail: 'signed in', setupCommand: undefined };
  } catch {
    return base;
  }
}

interface ApiKeySpec {
  id: string;
  label: string;
  envVars: string[];
}

const API_KEY_PROVIDERS: ApiKeySpec[] = [
  { id: 'grok', label: 'Grok / xAI API key', envVars: ['GROK_API_KEY', 'XAI_API_KEY'] },
  { id: 'openai', label: 'OpenAI API key', envVars: ['OPENAI_API_KEY'] },
  { id: 'anthropic', label: 'Anthropic Claude API key', envVars: ['ANTHROPIC_API_KEY'] },
  { id: 'gemini', label: 'Google Gemini API key', envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
  { id: 'openrouter', label: 'OpenRouter API key', envVars: ['OPENROUTER_API_KEY'] },
];

/** Report API keys present in the environment (not billed to us, so free:false). */
export function detectApiKeys(): DetectedCapability[] {
  return API_KEY_PROVIDERS.map((spec) => {
    const hit = spec.envVars.find((v) => Boolean(process.env[v]));
    return {
      id: spec.id,
      label: spec.label,
      kind: 'api-key' as const,
      free: false,
      available: Boolean(hit),
      detail: hit ? `${hit} set` : 'not set',
    };
  });
}

/**
 * One call to learn everything the setup surfaces need. Free local/OAuth probes
 * run in parallel; the API-key scan is synchronous.
 */
export async function detectEnvironment(): Promise<EnvironmentSnapshot> {
  const [ollama, lmstudio, chatgpt, xai] = await Promise.all([
    detectOllama(),
    detectLmStudio(),
    detectChatGptOAuth(),
    detectXaiOAuth(),
  ]);
  const apiKeys = detectApiKeys();
  const capabilities = [ollama, lmstudio, chatgpt, xai, ...apiKeys];

  // Free path priority: a local Ollama that actually has a model → ChatGPT
  // subscription → xAI subscription → LM Studio with a model. A running Ollama
  // with zero models is NOT recommendable (nothing to chat with yet).
  const ollamaReady = ollama.available && (ollama.models?.length ?? 0) > 0;
  const lmReady = lmstudio.available && (lmstudio.models?.length ?? 0) > 0;
  const freeOrder: Array<DetectedCapability | undefined> = [
    ollamaReady ? ollama : undefined,
    chatgpt.available ? chatgpt : undefined,
    xai.available ? xai : undefined,
    lmReady ? lmstudio : undefined,
  ];
  const recommendedFree = freeOrder.find(Boolean) ?? undefined;

  const anyApiKey = apiKeys.find((k) => k.available);
  const recommended = recommendedFree ?? anyApiKey ?? undefined;

  return {
    capabilities,
    ...(recommendedFree ? { recommendedFree } : {}),
    ...(recommended ? { recommended } : {}),
    ready: Boolean(recommended),
  };
}

/** Compact human summary of what was detected — used by wizard + doctor. */
export function renderDetectionSummary(snapshot: EnvironmentSnapshot): string {
  const lines: string[] = ['  Detected on this machine:'];
  for (const cap of snapshot.capabilities) {
    const mark = cap.available ? '✓' : '○';
    const cost = cap.available && cap.free ? '  ($0)' : '';
    lines.push(`    ${mark} ${cap.label} — ${cap.detail}${cost}`);
  }
  return lines.join('\n');
}
