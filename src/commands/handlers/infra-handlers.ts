/**
 * Infra Handlers
 *
 * Handles `buddy infra` and `/infra` slash command.
 * Shows a health dashboard for local inference backends (Ollama, vLLM)
 * and the current TurboQuant routing statistics.
 */

import { logger } from '../../utils/logger.js';
import { fetchOllamaStatus } from '../ollama.js';
import type { CommandHandlerResult } from './backup-handlers.js';

import { failureFlag } from '../slash-failure.js';

// ---------------------------------------------------------------------------
// Health check helpers
// ---------------------------------------------------------------------------

interface EndpointStatus {
  name: string;
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

async function checkEndpoint(name: string, url: string, timeoutMs = 4000): Promise<EndpointStatus> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    return { name, url, reachable: response.ok, latencyMs, error: null };
  } catch (err) {
    return {
      name,
      url,
      reachable: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Dashboard formatter
// ---------------------------------------------------------------------------

function formatStatus(status: EndpointStatus): string {
  const icon = status.reachable ? '[OK]' : '[DOWN]';
  const latency = status.latencyMs !== null ? ` ${status.latencyMs}ms` : '';
  const err = status.error ? ` (${status.error})` : '';
  return `  ${icon} ${status.name} — ${status.url}${latency}${err}`;
}

function formatRoutingStats(stats: {
  ollamaRequests: number;
  vllmRequests: number;
  ollamaErrors: number;
  vllmErrors: number;
  lastChecked: Date | null;
}): string {
  const total = stats.ollamaRequests + stats.vllmRequests;
  if (total === 0) {
    return '  No requests routed yet this session.';
  }
  const lines = [
    `  Ollama:  ${stats.ollamaRequests} requests, ${stats.ollamaErrors} errors`,
    `  vLLM:    ${stats.vllmRequests} requests, ${stats.vllmErrors} errors`,
    `  Total:   ${total} requests`,
  ];
  if (stats.lastChecked) {
    lines.push(`  Last health check: ${stats.lastChecked.toISOString()}`);
  }
  return lines.join('\n');
}

function formatOllamaSummary(status: {
  reachable: boolean;
  version: string | null;
  models: string[];
  error: string | null;
}): string {
  const lines = [
    `  Reachable: ${status.reachable ? 'YES' : 'NO'}`,
    `  Version: ${status.version ?? '(unknown)'}`,
    `  Models: ${status.models.length > 0 ? status.models.join(', ') : '(none)'}`,
  ];
  if (status.error) {
    lines.push(`  Error: ${status.error}`);
  }
  lines.push(`  Gemma 4 ready: ${isGemma4Ready(status.version, status.models) ? 'YES' : 'NO'}`);
  return lines.join('\n');
}

function isGemma4Ready(version: string | null, models: string[]): boolean {
  if (!version) return false;
  const [majorRaw, minorRaw, patchRaw] = version.split('.');
  const major = Number.parseInt(majorRaw ?? '', 10);
  const minor = Number.parseInt(minorRaw ?? '', 10);
  const patch = Number.parseInt(patchRaw ?? '', 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return false;
  if (major > 0) return true;
  if (minor > 24) return true;
  if (minor === 24 && patch >= 1) return true;
  return models.some((model) => model.toLowerCase().includes('gemma4'));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle `/infra [subcommand]`
 *
 * Subcommands:
 *   status   — show health dashboard (default)
 *   stats    — show routing stats only
 *   health   — re-run health checks now
 */
export async function handleInfra(
  args: string[] | string,
  _context?: Record<string, unknown>
): Promise<CommandHandlerResult> {
  const argStr = Array.isArray(args) ? args.join(' ') : args;
  const parts = argStr.trim().split(/\s+/).filter(Boolean);
  const subcommand = parts[0]?.toLowerCase() ?? 'status';

  switch (subcommand) {
    case 'stats':
      return handleInfraStats();
    case 'health':
      return handleInfraHealth();
    case 'status':
    default:
      return handleInfraDashboard();
  }
}

/**
 * Full health dashboard: endpoint status + routing stats.
 */
async function handleInfraDashboard(): Promise<CommandHandlerResult> {
  const lines: string[] = ['Infrastructure Status', '====================', ''];

  // Resolve configured endpoints from env or defaults
  const ollamaUrl =
    process.env['TURBOQUANT_OLLAMA_ENDPOINT'] ??
    process.env['OLLAMA_HOST'] ??
    'http://localhost:11434';
  const vllmUrl = process.env['TURBOQUANT_VLLM_ENDPOINT'] ?? '';

  // Check local backends in parallel
  const checks: Promise<EndpointStatus>[] = [
    checkEndpoint('Ollama', `${ollamaUrl.replace(/\/$/, '')}/api/tags`),
  ];

  if (vllmUrl) {
    checks.push(checkEndpoint('vLLM', `${vllmUrl.replace(/\/$/, '')}/v1/models`));
  }

  // Also check cloud/proxy if GROK_BASE_URL is set
  const grokBase = process.env['GROK_BASE_URL'];
  if (grokBase) {
    checks.push(checkEndpoint('Grok/xAI (cloud)', `${grokBase.replace(/\/$/, '')}/v1/models`));
  }

  const statuses = await Promise.all(checks);

  lines.push('Backends:');
  for (const s of statuses) {
    lines.push(formatStatus(s));
  }

  lines.push('');
  lines.push('Ollama Summary:');
  lines.push(
    formatOllamaSummary(
      await fetchOllamaStatus(ollamaUrl),
    ),
  );

  lines.push('');

  // Routing stats from TurboQuant plugin
  try {
    const { getTurboQuantStats } = await import('../../plugins/bundled/turboquant-plugin.js');
    const routingStats = getTurboQuantStats();
    lines.push('TurboQuant Routing Stats:');
    lines.push(formatRoutingStats(routingStats));
  } catch {
    lines.push('TurboQuant: not loaded (no endpoints configured)');
  }

  lines.push('');
  lines.push('TurboQuant Config:');
  lines.push(`  TURBOQUANT_VLLM_ENDPOINT    = ${process.env['TURBOQUANT_VLLM_ENDPOINT'] ?? '(not set)'}`);
  lines.push(`  TURBOQUANT_OLLAMA_ENDPOINT  = ${process.env['TURBOQUANT_OLLAMA_ENDPOINT'] ?? '(not set)'}`);
  lines.push(`  TURBOQUANT_LIGHTWEIGHT_MODEL= ${process.env['TURBOQUANT_LIGHTWEIGHT_MODEL'] ?? 'llama3.2'}`);
  lines.push(`  TURBOQUANT_HEAVY_MODEL      = ${process.env['TURBOQUANT_HEAVY_MODEL'] ?? 'qwen2.5-72b-instruct'}`);

  const response = lines.join('\n');
  logger.debug('handleInfra: dashboard rendered');

  return { handled: true, response };
}

/**
 * Show routing stats only.
 */
async function handleInfraStats(): Promise<CommandHandlerResult> {
  try {
    const { getTurboQuantStats } = await import('../../plugins/bundled/turboquant-plugin.js');
    const routingStats = getTurboQuantStats();
    const lines = ['TurboQuant Routing Stats', '========================', ''];
    lines.push(formatRoutingStats(routingStats));
    return { handled: true,
    ...failureFlag(lines.join('\n')), response: lines.join('\n') };
  } catch {
    return {
      handled: true,
...failureFlag('TurboQuant stats not available (plugin not loaded).'),
      response: 'TurboQuant stats not available (plugin not loaded).',
    };
  }
}

/**
 * Re-run health checks and show result.
 */
async function handleInfraHealth(): Promise<CommandHandlerResult> {
  const lines: string[] = ['Running health checks...', ''];

  const ollamaUrl =
    process.env['TURBOQUANT_OLLAMA_ENDPOINT'] ??
    process.env['OLLAMA_HOST'] ??
    'http://localhost:11434';
  const vllmUrl = process.env['TURBOQUANT_VLLM_ENDPOINT'] ?? '';

  const checks: Promise<EndpointStatus>[] = [
    checkEndpoint('Ollama', `${ollamaUrl.replace(/\/$/, '')}/api/tags`),
  ];
  if (vllmUrl) {
    checks.push(checkEndpoint('vLLM', `${vllmUrl.replace(/\/$/, '')}/v1/models`));
  }

  const statuses = await Promise.all(checks);
  for (const s of statuses) {
    lines.push(formatStatus(s));
  }

  lines.push('');
  lines.push('Ollama Summary:');
  lines.push(formatOllamaSummary(await fetchOllamaStatus(ollamaUrl)));

  return { handled: true,
  ...failureFlag(lines.join('\n')), response: lines.join('\n') };
}
