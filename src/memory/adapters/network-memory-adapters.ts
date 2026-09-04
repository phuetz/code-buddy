import type { MemoryProvider, MemoryRememberOptions } from '../memory-provider.js';
import { LocalMemoryProvider } from '../local-memory-provider.js';
import type { Memory } from '../persistent-memory.js';
import { logger } from '../../utils/logger.js';

/**
 * Network memory provider adapters (Hermes memory-provider parity).
 *
 * Each adapter is a THIN PIPE to a real external/self-hosted memory service:
 * it shuttles Code Buddy's `remember`/`recall`/`search` across the network
 * boundary and falls back to {@link LocalMemoryProvider} when the service is
 * not configured. The clever part (fact extraction, dialectic reasoning,
 * tiered retrieval) lives in the service, not here — so this is a connector,
 * not a re-implementation.
 *
 * Endpoints are sourced from the real upstreams (NousResearch/hermes-agent
 * plugins, plastic-labs/honcho v3 SDK routes, mem0/supermemory/RetainDB public
 * docs), NOT guessed. Request/response bodies follow each upstream's published
 * schema. Live round-trip validation against a configured instance is done via
 * `buddy hermes memory probe <provider>`.
 *
 * Self-hostable on a private box (e.g. a Tailscale Linux host): Mem0 (OSS REST
 * server), Honcho (FastAPI), OpenViking (AGPL server). Cloud-only (need an
 * account): Supermemory, RetainDB. Two upstream providers — Holographic
 * (in-process SQLite + HRR) and Hindsight (Python SDK / embedded daemon) —
 * have NO network boundary and are deliberately NOT adapted here; faking them
 * as a TS SQLite store would be parity-by-label, not real parity.
 */

// Memory backends can be LLM-backed (Mem0/OpenViking extract facts via an LLM
// on write), so the round-trip is often 10-20s. Default generously; tune with
// CODEBUDDY_MEMORY_HTTP_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CODEBUDDY_MEMORY_HTTP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
})();

interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** Minimal fetch wrapper: JSON in/out, timeout, throws on non-2xx. */
async function httpJson<T = unknown>(req: HttpRequest): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const init: RequestInit = {
      method: req.method,
      headers: { Accept: 'application/json', ...(req.headers ?? {}) },
      signal: controller.signal,
    };
    if (req.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json', ...init.headers };
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    const res = await fetch(req.url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  } finally {
    clearTimeout(timer);
  }
}

function toMemory(value: string, key = ''): Memory {
  return {
    key: key || value.slice(0, 60),
    value,
    category: 'context',
    createdAt: new Date(),
    updatedAt: new Date(),
    accessCount: 1,
  };
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

// ============================================================================
// Mem0 — OSS self-hosted REST server OR Mem0 Platform cloud.
//   Self-hosted (MEM0_BASE_URL set, e.g. http://hub-linux:8888):
//     POST {base}/memories  {messages,[user_id]}   ·  POST {base}/search {query,user_id}
//     auth: X-API-Key (optional)                   ·  NO /v1 prefix
//   Cloud (api.mem0.ai):
//     POST {base}/memories/ ·  POST {base}/memories/search/  ·  auth: Authorization: Token <key>
// Source: docs.mem0.ai/open-source/features/rest-api + mem0 platform docs.
// ============================================================================
export class Mem0MemoryProvider implements MemoryProvider {
  readonly id = 'mem0';
  private fallback: LocalMemoryProvider;
  private apiKey: string;
  private baseUrl: string;
  private selfHosted: boolean;
  private userId: string;

  constructor(options: { apiKey?: string; baseUrl?: string; userId?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.MEM0_API_KEY ?? '';
    const configuredBase = options.baseUrl ?? process.env.MEM0_BASE_URL ?? '';
    this.selfHosted = configuredBase !== '' && !/api\.mem0\.ai/i.test(configuredBase);
    this.baseUrl = trimBase(configuredBase || 'https://api.mem0.ai/v1');
    this.userId = options.userId ?? process.env.MEM0_USER_ID ?? 'codebuddy';
    this.fallback = new LocalMemoryProvider();
  }

  /** Remote is usable when self-hosted (base set) or a cloud key is present. */
  private isRemote(): boolean {
    return this.selfHosted || this.apiKey !== '';
  }

  private headers(): Record<string, string> {
    if (this.selfHosted) {
      return this.apiKey ? { 'X-API-Key': this.apiKey } : {};
    }
    return { Authorization: `Token ${this.apiKey}` };
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    logger.info(
      `Mem0MemoryProvider: ${this.isRemote() ? `remote (${this.selfHosted ? 'self-hosted' : 'cloud'})` : 'local fallback'}.`,
    );
  }

  /**
   * Mem0 partitions by `user_id`. `remember` defaults to project scope and
   * writes under `<userId>:project`; reads MUST use the same partition or they
   * silently miss what was just written (caught by `hermes memory probe`).
   */
  private scopedUserId(scope?: 'project' | 'user'): string {
    return scope === 'user' ? this.userId : `${this.userId}:project`;
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.isRemote()) return this.fallback.remember(key, value, options);
    try {
      const userId = this.scopedUserId(options?.scope);
      await httpJson({
        method: 'POST',
        url: `${this.baseUrl}/memories${this.selfHosted ? '' : '/'}`,
        headers: this.headers(),
        body: { messages: [{ role: 'user', content: `${key}: ${value}` }], user_id: userId },
      });
    } catch (err) {
      logger.warn('Mem0MemoryProvider: remember failed, falling back to local', { error: msg(err) });
      await this.fallback.remember(key, value, options);
    }
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.isRemote()) return this.fallback.recall(key, scope);
    const hits = await this.search(key, 1, scope).catch(() => [] as Memory[]);
    return hits[0]?.value ?? this.fallback.recall(key, scope);
  }

  private async search(query: string, limit: number, scope?: 'project' | 'user'): Promise<Memory[]> {
    const data = await httpJson<{ results?: Array<{ memory?: string }> } | Array<{ memory?: string }>>({
      method: 'POST',
      url: `${this.baseUrl}/${this.selfHosted ? 'search' : 'memories/search/'}`,
      headers: this.headers(),
      body: { query, user_id: this.scopedUserId(scope), limit },
    });
    const results = Array.isArray(data) ? data : (data.results ?? []);
    return results.filter((r) => r.memory).map((r) => toMemory(r.memory as string, query));
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.isRemote()) return this.fallback.getRelevantMemories(query, limit);
    try {
      return await this.search(query, limit);
    } catch (err) {
      logger.warn('Mem0MemoryProvider: search failed, falling back to local', { error: msg(err) });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.isRemote()) return this.fallback.getContextForPrompt();
    try {
      const memories = await this.search('working preferences', 10);
      return memories.length ? memories.map((m) => `- ${m.value}`).join('\n') : '';
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}

// ============================================================================
// Honcho — stateful agent memory (Plastic Labs). Self-hostable FastAPI (Docker)
// or cloud (api.honcho.dev). v3 REST, Bearer auth.
//   get-or-create: POST /v3/workspaces {name}
//                  POST /v3/workspaces/{ws}/peers {name}
//                  POST /v3/workspaces/{ws}/sessions {name}
//   store:  POST /v3/workspaces/{ws}/sessions/{sid}/messages {messages:[{content,peer_id}]}
//   search: POST /v3/workspaces/{ws}/search {query}        -> Page[Message]
// Source: plastic-labs/honcho sdks/python/.../http/routes.py (API_VERSION="v3")
//         + src/schemas/api.py (WorkspaceCreate.name, MessageCreate{content,peer_id}).
// ============================================================================
export class HonchoMemoryProvider implements MemoryProvider {
  readonly id = 'honcho';
  private fallback: LocalMemoryProvider;
  private apiKey: string;
  private baseUrl: string;
  private workspace: string;
  private peer: string;
  private session: string;
  private baseUrlConfigured: boolean;
  private ensured = false;

  constructor(options: { apiKey?: string; baseUrl?: string; workspace?: string; peer?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.HONCHO_API_KEY ?? '';
    const configuredBase = options.baseUrl ?? process.env.HONCHO_BASE_URL ?? '';
    this.baseUrlConfigured = configuredBase !== '';
    this.baseUrl = trimBase(configuredBase || 'https://api.honcho.dev');
    this.workspace = options.workspace ?? process.env.HONCHO_WORKSPACE ?? 'codebuddy';
    this.peer = options.peer ?? process.env.HONCHO_PEER ?? 'codebuddy';
    this.session = process.env.HONCHO_SESSION ?? 'default';
    this.fallback = new LocalMemoryProvider();
  }

  /**
   * Self-hosted Honcho runs without a key (any explicit base URL activates it);
   * cloud requires a key. This MUST mirror the readiness matrix's `configured`
   * rule (selfHostable: base URL OR key) so the probe never reports a remote
   * round-trip that actually went to the local fallback.
   */
  private isRemote(): boolean {
    return this.apiKey !== '' || this.baseUrlConfigured;
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    logger.info(`HonchoMemoryProvider: ${this.isRemote() ? 'remote' : 'local fallback'}.`);
  }

  /** Idempotent get-or-create of workspace + peer + session. */
  private async ensureScopes(): Promise<void> {
    if (this.ensured) return;
    await httpJson({ method: 'POST', url: `${this.baseUrl}/v3/workspaces`, headers: this.headers(), body: { name: this.workspace } });
    await httpJson({ method: 'POST', url: `${this.baseUrl}/v3/workspaces/${enc(this.workspace)}/peers`, headers: this.headers(), body: { name: this.peer } });
    await httpJson({ method: 'POST', url: `${this.baseUrl}/v3/workspaces/${enc(this.workspace)}/sessions`, headers: this.headers(), body: { name: this.session } });
    this.ensured = true;
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.isRemote()) return this.fallback.remember(key, value, options);
    try {
      await this.ensureScopes();
      await httpJson({
        method: 'POST',
        url: `${this.baseUrl}/v3/workspaces/${enc(this.workspace)}/sessions/${enc(this.session)}/messages`,
        headers: this.headers(),
        body: { messages: [{ content: `${key}: ${value}`, peer_id: this.peer }] },
      });
    } catch (err) {
      logger.warn('HonchoMemoryProvider: remember failed, falling back to local', { error: msg(err) });
      await this.fallback.remember(key, value, options);
    }
  }

  private async search(query: string, limit: number): Promise<Memory[]> {
    const data = await httpJson<{ items?: Array<{ content?: string }> } | Array<{ content?: string }>>({
      method: 'POST',
      url: `${this.baseUrl}/v3/workspaces/${enc(this.workspace)}/search`,
      headers: this.headers(),
      body: { query },
    });
    const items = Array.isArray(data) ? data : (data.items ?? []);
    return items.filter((m) => m.content).slice(0, limit).map((m) => toMemory(m.content as string, query));
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.isRemote()) return this.fallback.recall(key, scope);
    const hits = await this.search(key, 1).catch(() => [] as Memory[]);
    return hits[0]?.value ?? this.fallback.recall(key, scope);
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.isRemote()) return this.fallback.getRelevantMemories(query, limit);
    try {
      return await this.search(query, limit);
    } catch (err) {
      logger.warn('HonchoMemoryProvider: search failed, falling back to local', { error: msg(err) });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.isRemote()) return this.fallback.getContextForPrompt();
    try {
      const memories = await this.search('working preferences', 10);
      return memories.length ? memories.map((m) => `- ${m.value}`).join('\n') : '';
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}

// ============================================================================
// Supermemory — cloud memory graph (api.supermemory.ai). v3 REST, Bearer auth.
//   add:    POST {base}/v3/documents {content, containerTags}
//   search: POST {base}/v3/search   {q, limit}        -> {results:[{...}]}
// Source: supermemory.ai/docs/memory-api. Cloud-only (needs an account key).
// ============================================================================
export class SupermemoryMemoryProvider implements MemoryProvider {
  readonly id = 'supermemory';
  private fallback: LocalMemoryProvider;
  private apiKey: string;
  private baseUrl: string;
  private containerTag: string;

  constructor(options: { apiKey?: string; baseUrl?: string; containerTag?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.SUPERMEMORY_API_KEY ?? '';
    this.baseUrl = trimBase(options.baseUrl ?? process.env.SUPERMEMORY_BASE_URL ?? 'https://api.supermemory.ai');
    this.containerTag = options.containerTag ?? process.env.SUPERMEMORY_CONTAINER_TAG ?? 'codebuddy';
    this.fallback = new LocalMemoryProvider();
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    logger.info(`SupermemoryMemoryProvider: ${this.apiKey ? 'remote (cloud)' : 'local fallback'}.`);
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.apiKey) return this.fallback.remember(key, value, options);
    try {
      await httpJson({
        method: 'POST',
        url: `${this.baseUrl}/v3/documents`,
        headers: this.headers(),
        body: { content: `${key}: ${value}`, containerTags: [this.containerTag] },
      });
    } catch (err) {
      logger.warn('SupermemoryMemoryProvider: remember failed, falling back to local', { error: msg(err) });
      await this.fallback.remember(key, value, options);
    }
  }

  private async search(query: string, limit: number): Promise<Memory[]> {
    const data = await httpJson<{ results?: Array<{ content?: string; memory?: string; text?: string }> }>({
      method: 'POST',
      url: `${this.baseUrl}/v3/search`,
      headers: this.headers(),
      body: { q: query, limit, containerTags: [this.containerTag] },
    });
    const results = data.results ?? [];
    return results
      .map((r) => r.content || r.memory || r.text || '')
      .filter(Boolean)
      .map((v) => toMemory(v, query));
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.apiKey) return this.fallback.recall(key, scope);
    const hits = await this.search(key, 1).catch(() => [] as Memory[]);
    return hits[0]?.value ?? this.fallback.recall(key, scope);
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.apiKey) return this.fallback.getRelevantMemories(query, limit);
    try {
      return await this.search(query, limit);
    } catch (err) {
      logger.warn('SupermemoryMemoryProvider: search failed, falling back to local', { error: msg(err) });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.apiKey) return this.fallback.getContextForPrompt();
    try {
      const memories = await this.search('working preferences', 10);
      return memories.length ? memories.map((m) => `- ${m.value}`).join('\n') : '';
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}

// ============================================================================
// OpenViking — context database (Volcengine), AGPL, fully self-hostable.
//   server default: http://127.0.0.1:1933 (set OPENVIKING_ENDPOINT to enable)
//   search:  POST /api/v1/search/find  {query}          -> {result:{items:[{uri,abstract,score}]}}
//   write:   POST /api/v1/content/write {uri, content}
//   tenant headers: X-OpenViking-Account / -User / -Agent (+ X-API-Key/Bearer when keyed)
// Source: NousResearch/hermes-agent plugins/memory/openviking/__init__.py.
// ============================================================================
export class OpenVikingMemoryProvider implements MemoryProvider {
  readonly id = 'openviking';
  private fallback: LocalMemoryProvider;
  private endpoint: string;
  private apiKey: string;
  private account: string;
  private user: string;
  private agent: string;
  private enabled: boolean;

  constructor(options: { endpoint?: string; apiKey?: string; account?: string; user?: string; agent?: string } = {}) {
    const configured = options.endpoint ?? process.env.OPENVIKING_ENDPOINT ?? '';
    this.enabled = configured !== '';
    this.endpoint = trimBase(configured || 'http://127.0.0.1:1933');
    this.apiKey = options.apiKey ?? process.env.OPENVIKING_API_KEY ?? '';
    this.account = options.account ?? process.env.OPENVIKING_ACCOUNT ?? 'default';
    this.user = options.user ?? process.env.OPENVIKING_USER ?? 'default';
    this.agent = options.agent ?? process.env.OPENVIKING_AGENT ?? 'codebuddy';
    this.fallback = new LocalMemoryProvider();
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'X-OpenViking-Account': this.account,
      'X-OpenViking-User': this.user,
      'X-OpenViking-Agent': this.agent,
    };
    if (this.apiKey) {
      h['X-API-Key'] = this.apiKey;
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    logger.info(`OpenVikingMemoryProvider: ${this.enabled ? `remote (${this.endpoint})` : 'local fallback'}.`);
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.enabled) return this.fallback.remember(key, value, options);
    try {
      await httpJson({
        method: 'POST',
        url: `${this.endpoint}/api/v1/content/write`,
        headers: this.headers(),
        body: { uri: `viking://user/memories/${slug(key)}.md`, content: `# ${key}\n\n${value}\n` },
      });
    } catch (err) {
      logger.warn('OpenVikingMemoryProvider: remember failed, falling back to local', { error: msg(err) });
      await this.fallback.remember(key, value, options);
    }
  }

  private async search(query: string, limit: number): Promise<Memory[]> {
    const data = await httpJson<{ result?: { items?: Array<{ uri?: string; abstract?: string; score?: number }> } }>({
      method: 'POST',
      url: `${this.endpoint}/api/v1/search/find`,
      headers: this.headers(),
      body: { query, top_k: limit },
    });
    const items = data.result?.items ?? [];
    return items.filter((i) => i.abstract).slice(0, limit).map((i) => toMemory(i.abstract as string, i.uri ?? query));
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.enabled) return this.fallback.recall(key, scope);
    const hits = await this.search(key, 1).catch(() => [] as Memory[]);
    return hits[0]?.value ?? this.fallback.recall(key, scope);
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.enabled) return this.fallback.getRelevantMemories(query, limit);
    try {
      return await this.search(query, limit);
    } catch (err) {
      logger.warn('OpenVikingMemoryProvider: search failed, falling back to local', { error: msg(err) });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.enabled) return this.fallback.getContextForPrompt();
    try {
      const memories = await this.search('working preferences', 10);
      return memories.length ? memories.map((m) => `- ${m.value}`).join('\n') : '';
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}

// ============================================================================
// RetainDB — hybrid-search memory (cloud). Bearer auth, base api.retaindb.com.
//   add:    POST /v1/memory        {content, project, [user_id]}
//   search: POST /v1/memory/search {query, project, [user_id]}  -> {results:[{content}]}
// Source: NousResearch/hermes-agent plugins/memory/retaindb/__init__.py.
// Cloud-only (needs a RetainDB account key).
// ============================================================================
export class RetainDBMemoryProvider implements MemoryProvider {
  readonly id = 'retaindb';
  private fallback: LocalMemoryProvider;
  private apiKey: string;
  private baseUrl: string;
  private project: string;
  private userId: string;

  constructor(options: { apiKey?: string; baseUrl?: string; project?: string; userId?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.RETAINDB_API_KEY ?? '';
    this.baseUrl = trimBase(options.baseUrl ?? process.env.RETAINDB_BASE_URL ?? 'https://api.retaindb.com');
    this.project = options.project ?? process.env.RETAINDB_PROJECT ?? 'codebuddy';
    this.userId = options.userId ?? process.env.RETAINDB_USER_ID ?? 'codebuddy';
    this.fallback = new LocalMemoryProvider();
  }

  private headers(): Record<string, string> {
    const token = this.apiKey.replace(/^Bearer\s+/i, '').trim();
    return { Authorization: `Bearer ${token}` };
  }

  async initialize(): Promise<void> {
    await this.fallback.initialize();
    logger.info(`RetainDBMemoryProvider: ${this.apiKey ? 'remote (cloud)' : 'local fallback'}.`);
  }

  async remember(key: string, value: string, options?: MemoryRememberOptions): Promise<void> {
    if (!this.apiKey) return this.fallback.remember(key, value, options);
    try {
      await httpJson({
        method: 'POST',
        url: `${this.baseUrl}/v1/memory`,
        headers: this.headers(),
        body: { content: `${key}: ${value}`, project: this.project, user_id: this.userId },
      });
    } catch (err) {
      logger.warn('RetainDBMemoryProvider: remember failed, falling back to local', { error: msg(err) });
      await this.fallback.remember(key, value, options);
    }
  }

  private async search(query: string, limit: number): Promise<Memory[]> {
    const data = await httpJson<{ results?: Array<{ content?: string }> }>({
      method: 'POST',
      url: `${this.baseUrl}/v1/memory/search`,
      headers: this.headers(),
      body: { query, project: this.project, user_id: this.userId, limit },
    });
    return (data.results ?? []).filter((r) => r.content).map((r) => toMemory(r.content as string, query));
  }

  async recall(key: string, scope?: 'project' | 'user'): Promise<string | null> {
    if (!this.apiKey) return this.fallback.recall(key, scope);
    const hits = await this.search(key, 1).catch(() => [] as Memory[]);
    return hits[0]?.value ?? this.fallback.recall(key, scope);
  }

  async getRelevantMemories(query: string, limit = 5): Promise<Memory[]> {
    if (!this.apiKey) return this.fallback.getRelevantMemories(query, limit);
    try {
      return await this.search(query, limit);
    } catch (err) {
      logger.warn('RetainDBMemoryProvider: search failed, falling back to local', { error: msg(err) });
      return this.fallback.getRelevantMemories(query, limit);
    }
  }

  async getContextForPrompt(): Promise<string> {
    if (!this.apiKey) return this.fallback.getContextForPrompt();
    try {
      const memories = await this.search('working preferences', 10);
      return memories.length ? memories.map((m) => `- ${m.value}`).join('\n') : '';
    } catch {
      return this.fallback.getContextForPrompt();
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function enc(s: string): string {
  return encodeURIComponent(s);
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'memory';
}
