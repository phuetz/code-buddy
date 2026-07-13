import { spawn } from 'node:child_process';
import { fetchOllamaVersion } from './ollama-api';

export const DARKSTAR_OLLAMA_BASE_URL = 'http://darkstar.tail2a752c.ts.net:11434/v1';
export const DARKSTAR_OLLAMA_PROBE_URL = 'http://100.73.222.64:11434/api/tags';
export const DARKSTAR_OLLAMA_FALLBACK_HOSTNAME = 'darkstar';
export const DARKSTAR_OLLAMA_FALLBACK_IP = '100.73.222.64';
const DARKSTAR_TAILSCALE_BIN = process.env.TAILSCALE_BIN ?? 'tailscale';
export const DARKSTAR_OLLAMA_MODEL_PRIORITY = [
  'gemma4:26b-a4b-it-qat',
  'gemma4:12b-it-qat',
  'gemma4:26b-a4b-it',
  'gemma4:12b-it',
  'qwen3.6:35b-a3b-q4_K_M',
  'qwen3.6:27b',
  'phi4:latest',
  'llama3.1:8b',
] as const;

export interface DarkstarNetworkModelBootstrapResult {
  applied: boolean;
  baseUrl?: string;
  model?: string;
  reason: string;
}

interface TailnetPeerInfo {
  TailscaleIPs?: string[];
  HostName?: string;
  DNSName?: string;
  Online?: boolean;
}

interface TailnetStatusPayload {
  Peer?: Record<string, TailnetPeerInfo>;
}

async function fetchJsonWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveDarkstarTailnetBaseUrl(
  fetchStatus: () => Promise<unknown | null> = runTailscaleStatus
): Promise<{ baseUrl: string; probeUrl: string; source: 'tailscale' | 'fallback' }> {
  const status = await fetchStatus();
  const peer = findDarkstarPeer(status);
  if (peer) {
    return {
      baseUrl: `http://${peer.ip}:11434/v1`,
      probeUrl: `http://${peer.ip}:11434/api/tags`,
      source: 'tailscale',
    };
  }
  return {
    baseUrl: DARKSTAR_OLLAMA_BASE_URL,
    probeUrl: DARKSTAR_OLLAMA_PROBE_URL,
    source: 'fallback',
  };
}

export function findDarkstarPeer(status: unknown): { hostname: string; ip: string } | null {
  const payload = status as TailnetStatusPayload | null | undefined;
  const peers = payload?.Peer ?? {};
  for (const info of Object.values(peers)) {
    if (!info?.Online) continue;
    const ip = info.TailscaleIPs?.[0]?.trim();
    if (!ip) continue;
    const hostname = (info.HostName ?? info.DNSName ?? '').trim();
    if (!hostname) continue;
    if (!isDarkstarHostname(hostname)) continue;
    return {
      hostname,
      ip,
    };
  }
  return null;
}

function isDarkstarHostname(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === DARKSTAR_OLLAMA_FALLBACK_HOSTNAME ||
    normalized.startsWith(`${DARKSTAR_OLLAMA_FALLBACK_HOSTNAME}.`) ||
    normalized.includes('.darkstar.') ||
    normalized.includes('darkstar.tail')
  );
}

async function runTailscaleStatus(): Promise<unknown | null> {
  return new Promise((resolve) => {
    let stdout = '';
    const child = spawn(DARKSTAR_TAILSCALE_BIN, ['status', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      resolve(null);
    }, 3000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.resume();
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

export async function bootstrapDarkstarNetworkModel(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  fetchStatus: () => Promise<unknown | null> = runTailscaleStatus
): Promise<DarkstarNetworkModelBootstrapResult> {
  if (env.CODEBUDDY_NETWORK_MODELS?.trim()) {
    return { applied: false, reason: 'CODEBUDDY_NETWORK_MODELS already set' };
  }
  if (env.CODEBUDDY_DISABLE_DARKSTAR_NETWORK_MODEL === '1') {
    return { applied: false, reason: 'darkstar bootstrap disabled' };
  }

  try {
    const target = await resolveDarkstarTailnetBaseUrl(fetchStatus);
    const ollamaVersion = await fetchOllamaVersion({
      baseUrl: target.baseUrl,
      fetchImpl,
    });
    const gemmaSupported = supportsGemma4(ollamaVersion);
    const response = await fetchJsonWithTimeout(fetchImpl, target.probeUrl, 1500);
    if (!response.ok) {
      return {
        applied: false,
        reason: `darkstar Ollama probe returned HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as { models?: Array<{ model?: string; name?: string }> };
    const availableModels = new Set(
      (data.models ?? [])
        .map((item) => (typeof item.model === 'string' && item.model.trim()
          ? item.model.trim()
          : typeof item.name === 'string' && item.name.trim()
            ? item.name.trim()
            : ''))
        .filter(Boolean)
    );
    const preferredModel =
      DARKSTAR_OLLAMA_MODEL_PRIORITY.find((model) =>
        availableModels.has(model) && (!isGemma4Model(model) || gemmaSupported)
      ) ||
      data.models?.[0]?.model?.trim() ||
      data.models?.[0]?.name?.trim() ||
      null;

    if (!preferredModel) {
      return { applied: false, reason: 'darkstar Ollama has no advertised models' };
    }

    env.CODEBUDDY_NETWORK_MODELS = `${preferredModel}@${target.baseUrl}`;
    return {
      applied: true,
      baseUrl: target.baseUrl,
      model: preferredModel,
      reason: `bootstrapped darkstar network model ${preferredModel} via ${target.source}${ollamaVersion ? ` (ollama ${ollamaVersion})` : ''}`,
    };
  } catch (error) {
    return {
      applied: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function isGemma4Model(model: string): boolean {
  return /^gemma4[:/]/i.test(model) || /^gemma-4[:/]/i.test(model);
}

function supportsGemma4(version: string | null): boolean {
  if (!version) return false;
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  const [major = 0, minor = 0, patch = 0] = parts;
  if ([major, minor, patch].some((n) => Number.isNaN(n))) return false;
  if (major > 0) return true;
  if (minor > 24) return true;
  if (minor < 24) return false;
  return patch >= 1;
}
