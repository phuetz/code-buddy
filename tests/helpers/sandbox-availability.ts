import { detectNativeSandboxCapabilities } from '../../src/security/native-sandbox.js';
import { DockerSandbox } from '../../src/sandbox/docker-sandbox.js';

export interface SandboxAvailabilityResult {
  available: boolean;
  backend: 'landlock' | 'bwrap' | 'seatbelt' | 'docker' | 'none';
  reason: string;
}

let cachedResult: SandboxAvailabilityResult | null = null;

/**
 * Probes the execution environment to determine if any sandbox confinement
 * backend (native bubblewrap / Landlock / macOS seatbelt or Docker workspace container)
 * is available.
 */
export function getSandboxAvailability(): SandboxAvailabilityResult {
  if (cachedResult !== null) {
    return cachedResult;
  }

  try {
    const nativeCaps = detectNativeSandboxCapabilities();
    if (nativeCaps.recommended !== 'none') {
      cachedResult = {
        available: true,
        backend: nativeCaps.recommended,
        reason: nativeCaps.reason,
      };
      return cachedResult;
    }
  } catch {
    // ignore native probe failure
  }

  try {
    if (DockerSandbox.isAvailable()) {
      cachedResult = {
        available: true,
        backend: 'docker',
        reason: 'Docker daemon and container environment available',
      };
      return cachedResult;
    }
  } catch {
    // ignore docker probe failure
  }

  cachedResult = {
    available: false,
    backend: 'none',
    reason: 'bubblewrap/Landlock/Docker indisponible dans cet environnement',
  };
  return cachedResult;
}

/**
 * Returns true if sandbox confinement is available in this execution environment.
 */
export function sandboxAvailable(): boolean {
  return getSandboxAvailability().available;
}

/**
 * Reset the cached sandbox availability probe result (for testing).
 */
export function resetSandboxAvailabilityCache(): void {
  cachedResult = null;
}
