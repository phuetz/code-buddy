import { getMemoryProviderRegistry, LocalMemoryProvider } from '../memory/memory-provider.js';

export type HermesMemoryProviderStatus = 'available' | 'configured' | 'fallback' | 'missing';

/**
 * Live round-trip probe for a memory provider. This is the discriminating
 * validation (vs. shape-only tests): it actually writes a unique marker through
 * the provider and tries to read it back from the configured backend, so it
 * proves the real service — not just request construction. Run it against a
 * self-hosted instance (e.g. on a Tailscale host) with the provider configured.
 */
export interface HermesMemoryProbeResult {
  kind: 'hermes_memory_probe';
  schemaVersion: 1;
  generatedAt: string;
  providerId: string;
  activeProviderId: string;
  /** Whether the provider is configured for a remote/CLI backend (vs local fallback). */
  remote: boolean;
  wrote: boolean;
  retrieved: boolean;
  /**
   * True when the provider is remote-configured but the marker actually landed
   * in the LOCAL fallback store — i.e. the remote silently failed. Guards
   * against a false "remote PASS" when the backend is unreachable.
   */
  fellBackToLocal: boolean;
  /** Bounded, non-secret sample of what came back (marker text only). */
  retrievedSample?: string;
  /**
   * pass = wrote and read the marker back; pending = wrote to a remote backend
   * but the marker is not yet readable (extraction/indexing is often async on
   * Mem0/OpenViking — re-run); fail = the write failed or local read failed.
   */
  verdict: 'pass' | 'pending' | 'fail';
  /** True unless the verdict is a hard fail (pending is not a failure). */
  ok: boolean;
  error?: string;
  notes: string[];
}

export interface HermesMemoryProbeOptions {
  now?: () => Date;
  /** Injectable marker token for deterministic tests. */
  token?: string;
}

export async function probeMemoryProvider(
  providerId?: string,
  options: HermesMemoryProbeOptions = {},
): Promise<HermesMemoryProbeResult> {
  const now = options.now ?? (() => new Date());
  const registry = getMemoryProviderRegistry();
  const id = providerId ?? registry.getActiveId();
  const readiness = buildHermesMemoryProvidersReadiness({ now });
  const matrixItem = readiness.providers.find((p) => p.id === id);
  const notes: string[] = [];

  const provider = registry.get(id);
  if (!provider) {
    return {
      kind: 'hermes_memory_probe',
      schemaVersion: 1,
      generatedAt: now().toISOString(),
      providerId: id,
      activeProviderId: registry.getActiveId(),
      remote: false,
      wrote: false,
      retrieved: false,
      fellBackToLocal: false,
      verdict: 'fail',
      ok: false,
      error: `Unknown or out-of-scope memory provider: ${id}. Registered: ${registry.list().join(', ')}.`,
      notes: matrixItem?.outOfScope
        ? ['This provider is intentionally not adapted in TypeScript (Python in-process).']
        : [],
    };
  }

  const remote = id !== 'local' && matrixItem?.configured === true;
  if (!remote && id !== 'local') {
    notes.push(`${id} is not configured; this probes the LOCAL fallback, not the remote backend.`);
  }

  const token = options.token ?? `cb-probe-${now().getTime().toString(36)}`;
  const key = 'codebuddy-memory-probe';
  // Phrase the marker as a retainable fact so extraction-based backends
  // (Mem0/OpenViking run an LLM that keeps "facts", not arbitrary strings)
  // are more likely to store and surface the token on read-back.
  const value = `Code Buddy connector self-test: the validation token is ${token}. Please remember this exact token.`;

  let wrote = false;
  let retrieved = false;
  let retrievedSample: string | undefined;
  let error: string | undefined;

  try {
    await provider.initialize();
    await provider.remember(key, value, { scope: 'project' });
    wrote = true;

    const hits = await provider.getRelevantMemories(token, 5).catch(() => []);
    const match = hits.find((h) => h.value.includes(token));
    if (match) {
      retrieved = true;
      retrievedSample = match.value.slice(0, 120);
    } else {
      if (hits[0]) retrievedSample = hits[0].value.slice(0, 120);
      const recalled = await provider.recall(key, 'project').catch(() => null);
      if (recalled && recalled.includes(token)) {
        retrieved = true;
        retrievedSample = recalled.slice(0, 120);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Integrity guard: when the provider is remote-configured, detect a SILENT
  // fallback to local memory. Adapters write to EITHER the remote OR the local
  // fallback (never both), so if this run's unique token shows up in the local
  // store, the remote call actually failed and degraded to local — which must
  // NOT be reported as a remote PASS.
  let fellBackToLocal = false;
  if (remote && wrote) {
    try {
      const local = new LocalMemoryProvider();
      await local.initialize();
      const localHits = await local.getRelevantMemories(token, 5);
      fellBackToLocal = localHits.some((h) => h.value.includes(token));
    } catch {
      /* best-effort; absence of evidence is not evidence of fallback */
    }
  }

  let verdict: 'pass' | 'pending' | 'fail';
  if (!wrote) {
    verdict = 'fail';
  } else if (remote && fellBackToLocal) {
    verdict = 'fail';
    notes.push(
      'Remote is configured but the marker landed in LOCAL memory — the remote backend silently fell back (unreachable/erroring). This is NOT a remote pass. Check the service, base URL, and credentials, then re-run.',
    );
  } else if (retrieved) {
    verdict = 'pass';
  } else if (remote) {
    // Wrote to a real backend but the marker is not yet readable. Extraction/
    // indexing is frequently asynchronous (Mem0/OpenViking run an LLM), so this
    // is NOT a failure — it warrants a re-run, not a red verdict/exit code.
    verdict = 'pending';
    notes.push(
      'Wrote successfully but did not read the marker back yet. Extraction/indexing is often asynchronous (Mem0/OpenViking run an LLM) — re-run the probe. A persistent pending may indicate a body-shape mismatch worth checking against the server logs.',
    );
  } else {
    // Local fallback is synchronous; a miss here is a real failure.
    verdict = 'fail';
  }

  return {
    kind: 'hermes_memory_probe',
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    providerId: id,
    activeProviderId: registry.getActiveId(),
    remote,
    wrote,
    retrieved,
    fellBackToLocal,
    ...(retrievedSample ? { retrievedSample } : {}),
    verdict,
    ok: verdict !== 'fail',
    ...(error ? { error } : {}),
    notes,
  };
}

export function renderHermesMemoryProbe(result: HermesMemoryProbeResult): string {
  const lines = [
    `Hermes memory probe: ${result.verdict.toUpperCase()}`,
    `  Provider: ${result.providerId}${result.providerId === result.activeProviderId ? ' (active)' : ''}`,
    `  Mode: ${
      result.fellBackToLocal
        ? 'remote configured BUT silently fell back to local (remote unreachable)'
        : result.remote
          ? 'remote/configured backend'
          : 'local fallback'
    }`,
    `  Wrote: ${result.wrote ? 'yes' : 'no'}`,
    `  Retrieved marker: ${result.retrieved ? 'yes' : 'no'}`,
  ];
  if (result.retrievedSample) lines.push(`  Sample: ${result.retrievedSample}`);
  if (result.error) lines.push(`  Error: ${result.error}`);
  for (const note of result.notes) lines.push(`  Note: ${note}`);
  return lines.join('\n');
}

export interface HermesMemoryProviderItem {
  id: string;
  label: string;
  officialSurface: string;
  registered: boolean;
  active: boolean;
  local: boolean;
  configured: boolean;
  credentialSources: string[];
  baseUrlSources: string[];
  status: HermesMemoryProviderStatus;
  /** True for upstream providers with no native-TS adaptation path (Python in-process). */
  outOfScope: boolean;
  notes: string[];
  remediation: string[];
}

export interface HermesMemoryProvidersReadiness {
  generatedAt: string;
  ok: boolean;
  activeProviderId: string;
  registeredCount: number;
  configuredRemoteCount: number;
  configuredRemoteProviderIds: string[];
  fallbackCount: number;
  fallbackProviderIds: string[];
  missingOfficialCount: number;
  missingOfficialProviderIds: string[];
  /** Providers deliberately not adapted (Python in-process, no network/CLI boundary). */
  outOfScopeCount: number;
  outOfScopeProviderIds: string[];
  providers: HermesMemoryProviderItem[];
  issues: string[];
  recommendations: string[];
}

export interface HermesMemoryProvidersReadinessOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

interface HermesMemoryProviderDefinition {
  id: string;
  label: string;
  officialSurface: string;
  credentialEnv: string[];
  baseUrlEnv: string[];
  local?: boolean;
  /** Can run on a configured base URL without a cloud key (self-hosted). */
  selfHostable?: boolean;
  /** No native-TS adaptation path (Python in-process, no network/CLI boundary). */
  outOfScope?: boolean;
  notes?: string[];
  remediation?: string[];
}

const OFFICIAL_MEMORY_PROVIDERS: HermesMemoryProviderDefinition[] = [
  {
    id: 'local',
    label: 'Code Buddy local memory',
    officialSurface: 'Built-in memory',
    credentialEnv: [],
    baseUrlEnv: [],
    local: true,
    notes: ['Durable local Code Buddy memory; no remote credential required.'],
  },
  {
    id: 'honcho',
    label: 'Honcho',
    officialSurface: 'Honcho external memory provider',
    credentialEnv: ['HONCHO_API_KEY'],
    baseUrlEnv: ['HONCHO_BASE_URL'],
    selfHostable: true,
    notes: ['Adapter implemented (v3 REST: workspaces/peers/sessions + search). Self-hostable (FastAPI/Docker) or cloud.'],
    remediation: ['Self-host: set HONCHO_BASE_URL (e.g. http://hub-linux:8000). Cloud: set HONCHO_API_KEY.'],
  },
  {
    id: 'openviking',
    label: 'OpenViking',
    officialSurface: 'OpenViking external memory provider',
    credentialEnv: ['OPENVIKING_API_KEY'],
    baseUrlEnv: ['OPENVIKING_ENDPOINT'],
    selfHostable: true,
    notes: ['Adapter implemented (/api/v1/search/find + /api/v1/content/write, tenant headers). Fully self-hostable (AGPL).'],
    remediation: ['Set OPENVIKING_ENDPOINT (e.g. http://hub-linux:1933) to activate.'],
  },
  {
    id: 'mem0',
    label: 'Mem0',
    officialSurface: 'Mem0 external memory provider',
    credentialEnv: ['MEM0_API_KEY'],
    baseUrlEnv: ['MEM0_BASE_URL'],
    selfHostable: true,
    notes: ['Adapter implemented (self-hosted OSS REST /memories+/search, or cloud /v1).'],
    remediation: ['Self-host: set MEM0_BASE_URL (e.g. http://hub-linux:8888). Cloud: set MEM0_API_KEY.'],
  },
  {
    id: 'hindsight',
    label: 'Hindsight',
    officialSurface: 'Hindsight external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    outOfScope: true,
    notes: [
      'Not natively adapted: Hindsight is a Python SDK (cloud hindsight-client) or embedded local daemon (hindsight-all). It has no clean HTTP/CLI boundary to wrap in TypeScript without guessing an internal contract.',
    ],
    remediation: ['Use upstream Hermes (Python) for Hindsight, or run Hindsight behind its own HTTP gateway and point a generic provider at it.'],
  },
  {
    id: 'holographic',
    label: 'Holographic',
    officialSurface: 'Holographic external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    outOfScope: true,
    notes: [
      "Not natively adapted: in-process Python SQLite + Holographic Reduced Representations, no network boundary. A TS SQLite store relabeled 'Holographic' would be parity-by-label, not real HRR parity; Code Buddy's built-in 'local' provider already covers durable local memory.",
    ],
    remediation: ["Use upstream Hermes (Python) for Holographic; the built-in 'local' provider is the native local-memory path."],
  },
  {
    id: 'retaindb',
    label: 'RetainDB',
    officialSurface: 'RetainDB external memory provider',
    credentialEnv: ['RETAINDB_API_KEY'],
    baseUrlEnv: ['RETAINDB_BASE_URL'],
    notes: ['Adapter implemented (/v1/memory + /v1/memory/search, Bearer). Cloud-only — needs a RetainDB account key (not live-validated).'],
    remediation: ['Set RETAINDB_API_KEY (cloud account) to activate.'],
  },
  {
    id: 'byterover',
    label: 'ByteRover',
    officialSurface: 'ByteRover external memory provider',
    credentialEnv: [],
    baseUrlEnv: [],
    notes: ['Adapter implemented (brv CLI subprocess: query/curate/status). Local-first; activation detected by brv presence at runtime, not env.'],
    remediation: ['Install the CLI: npm install -g byterover-cli (provides `brv`).'],
  },
  {
    id: 'supermemory',
    label: 'Supermemory',
    officialSurface: 'Supermemory external memory provider',
    credentialEnv: ['SUPERMEMORY_API_KEY'],
    baseUrlEnv: ['SUPERMEMORY_BASE_URL'],
    notes: ['Adapter implemented (v3 /documents + /search, Bearer). Cloud-only — needs an account key (not live-validated).'],
    remediation: ['Set SUPERMEMORY_API_KEY (cloud account) to activate.'],
  },
];

function presentEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(env[key]?.trim()));
}

function statusForProvider(input: {
  configured: boolean;
  local: boolean;
  registered: boolean;
}): HermesMemoryProviderStatus {
  if (!input.registered) return 'missing';
  if (input.local) return 'available';
  return input.configured ? 'configured' : 'fallback';
}

export function buildHermesMemoryProvidersReadiness(
  options: HermesMemoryProvidersReadinessOptions = {},
): HermesMemoryProvidersReadiness {
  const env = options.env ?? process.env;
  const registry = getMemoryProviderRegistry();
  const registeredIds = new Set(registry.list());
  const envProvider = env.CODEBUDDY_MEMORY_PROVIDER?.trim();
  const activeProviderId =
    envProvider && registeredIds.has(envProvider) ? envProvider : registry.getActiveId();

  const providers = OFFICIAL_MEMORY_PROVIDERS.map((definition) => {
    const credentialSources = presentEnvKeys(env, definition.credentialEnv);
    const baseUrlSources = presentEnvKeys(env, definition.baseUrlEnv);
    const registered = registeredIds.has(definition.id);
    const local = definition.local === true;
    // Self-hostable providers (Mem0/Honcho/OpenViking) activate on a base URL
    // alone — no cloud key required — so a configured base URL counts.
    const configured =
      local ||
      credentialSources.length > 0 ||
      (definition.selfHostable === true && baseUrlSources.length > 0);
    const status = statusForProvider({ configured, local, registered });
    const notes = [...(definition.notes ?? [])];

    if (status === 'fallback') {
      notes.push('Registered, but falls back to local memory until configured (key, base URL, or CLI).');
    }

    return {
      id: definition.id,
      label: definition.label,
      officialSurface: definition.officialSurface,
      registered,
      active: definition.id === activeProviderId,
      local,
      configured,
      credentialSources,
      baseUrlSources,
      status,
      outOfScope: definition.outOfScope === true,
      notes,
      remediation: definition.remediation ?? [],
    };
  });

  const issues: string[] = [];
  const recommendations: string[] = [];
  const activeProvider = providers.find((provider) => provider.active);

  if (envProvider && !registeredIds.has(envProvider)) {
    issues.push(`CODEBUDDY_MEMORY_PROVIDER points to unknown provider "${envProvider}".`);
  }

  if (!activeProvider) {
    issues.push(`Active memory provider "${activeProviderId}" is not in the Hermes provider matrix.`);
  } else if (activeProvider.status === 'fallback') {
    issues.push(
      `Active memory provider ${activeProvider.label} is missing credentials and will fall back to local memory.`,
    );
  } else if (activeProvider.status === 'missing') {
    issues.push(`Active memory provider ${activeProvider.label} is not implemented in Code Buddy.`);
  }

  // "missing" = an adaptable official provider we have NOT implemented yet.
  // Out-of-scope providers (Python in-process, no boundary) are tracked apart
  // so they are not reported as unfinished work.
  const missingProviders = providers.filter(
    (provider) => provider.status === 'missing' && !provider.outOfScope,
  );
  const outOfScopeProviders = providers.filter((provider) => provider.outOfScope);
  const fallbackProviders = providers.filter((provider) => provider.status === 'fallback');
  const configuredRemoteProviders = providers.filter(
    (provider) => provider.registered && !provider.local && provider.configured,
  );

  if (missingProviders.length > 0) {
    recommendations.push(
      `Missing official Hermes memory adapters: ${missingProviders.map((provider) => provider.label).join(', ')}.`,
    );
  }

  if (outOfScopeProviders.length > 0) {
    recommendations.push(
      `Out of native-TS scope (use upstream Hermes/Python): ${outOfScopeProviders.map((provider) => provider.label).join(', ')}.`,
    );
  }

  if (fallbackProviders.length > 0) {
    recommendations.push(
      `Configured remote memory currently requires credentials for: ${fallbackProviders.map((provider) => provider.label).join(', ')}.`,
    );
  }

  if (!activeProvider || activeProvider.local) {
    recommendations.push('Local memory is the durable default; configure a remote provider only when external recall is required.');
  }

  return {
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    ok: issues.length === 0,
    activeProviderId,
    registeredCount: providers.filter((provider) => provider.registered).length,
    configuredRemoteCount: configuredRemoteProviders.length,
    configuredRemoteProviderIds: configuredRemoteProviders.map((provider) => provider.id),
    fallbackCount: fallbackProviders.length,
    fallbackProviderIds: fallbackProviders.map((provider) => provider.id),
    missingOfficialCount: missingProviders.length,
    missingOfficialProviderIds: missingProviders.map((provider) => provider.id),
    outOfScopeCount: outOfScopeProviders.length,
    outOfScopeProviderIds: outOfScopeProviders.map((provider) => provider.id),
    providers,
    issues,
    recommendations,
  };
}

export function renderHermesMemoryProvidersReadiness(
  readiness: HermesMemoryProvidersReadiness,
): string {
  const lines = [
    `Hermes memory providers: ${readiness.ok ? 'ok' : 'needs attention'}`,
    `  Active: ${readiness.activeProviderId}`,
    `  Registered: ${readiness.registeredCount}/${readiness.providers.length}`,
    `  Configured remote: ${readiness.configuredRemoteCount} (${readiness.configuredRemoteProviderIds.join(', ') || 'none'})`,
    `  Local-fallback adapters: ${readiness.fallbackCount} (${readiness.fallbackProviderIds.join(', ') || 'none'})`,
    `  Missing official adapters: ${readiness.missingOfficialCount} (${readiness.missingOfficialProviderIds.join(', ') || 'none'})`,
    `  Out of native-TS scope: ${readiness.outOfScopeCount} (${readiness.outOfScopeProviderIds.join(', ') || 'none'})`,
    '',
    'Providers:',
  ];

  for (const provider of readiness.providers) {
    const activeMarker = provider.active ? '*' : ' ';
    const credentials =
      provider.credentialSources.length > 0 ? provider.credentialSources.join(', ') : 'none';
    const baseUrls = provider.baseUrlSources.length > 0 ? provider.baseUrlSources.join(', ') : 'none';
    const displayStatus = provider.outOfScope ? 'out-of-scope' : provider.status;
    lines.push(
      `${activeMarker} ${displayStatus.padEnd(10)} ${provider.id.padEnd(12)} ${provider.label}`,
    );
    lines.push(`    Registered: ${provider.registered ? 'yes' : 'no'}; credentials: ${credentials}; base URL env: ${baseUrls}`);
    if (provider.notes.length > 0) {
      lines.push(`    Notes: ${provider.notes.join(' ')}`);
    }
    if (provider.remediation.length > 0) {
      lines.push(`    Remediation: ${provider.remediation.join(' ')}`);
    }
  }

  if (readiness.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of readiness.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  if (readiness.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    for (const recommendation of readiness.recommendations) {
      lines.push(`  - ${recommendation}`);
    }
  }

  return lines.join('\n');
}
