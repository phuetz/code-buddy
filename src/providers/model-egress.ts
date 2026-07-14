export type ModelEgress = 'local' | 'lan' | 'cloud';

const CLOUD_SUBPROCESS_PROVIDERS = new Set([
  'agy-cli',
  'gemini-cli',
  'chatgpt',
  'chatgpt-oauth',
  'grok-oauth',
]);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254);
}

/**
 * Classify the real inference destination. A cloud subscription CLI remains
 * cloud even though its child process runs on the local machine.
 */
export function classifyModelEgress(
  baseURL: string | undefined,
  providerIsLocal: boolean,
): ModelEgress {
  if (!providerIsLocal) return 'cloud';
  if (!baseURL) return 'local';
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' || hostname === '::1' || hostname === '127.0.0.1') {
      return 'local';
    }
    if (
      isPrivateIpv4(hostname) ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fe80') ||
      hostname.endsWith('.local') ||
      hostname === 'host.docker.internal' ||
      !hostname.includes('.')
    ) {
      return 'lan';
    }
    return 'cloud';
  } catch {
    return 'cloud';
  }
}

/** Provider-aware guard for CLIs whose process is local but inference is not. */
export function classifyProviderModelEgress(
  provider: string | undefined,
  baseURL: string | undefined,
  providerIsLocal: boolean,
): ModelEgress {
  const normalized = provider?.trim().toLowerCase().replace(/_/g, '-');
  if (normalized && CLOUD_SUBPROCESS_PROVIDERS.has(normalized)) return 'cloud';
  return classifyModelEgress(baseURL, providerIsLocal);
}
