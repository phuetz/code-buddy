import { describe, expect, it } from 'vitest';
import {
  getSandboxAvailability,
  resetSandboxAvailabilityCache,
  sandboxAvailable,
} from '../helpers/sandbox-availability.js';
import { detectNativeSandboxCapabilities } from '../../src/security/native-sandbox.js';
import { DockerSandbox } from '../../src/sandbox/docker-sandbox.js';

describe('Sandbox availability detection and guard', () => {
  it('detects sandbox availability consistently with real host backends', () => {
    resetSandboxAvailabilityCache();
    const available = sandboxAvailable();
    const info = getSandboxAvailability();

    expect(typeof available).toBe('boolean');
    expect(info.available).toBe(available);
    expect(['landlock', 'bwrap', 'seatbelt', 'docker', 'none']).toContain(info.backend);

    const nativeCaps = detectNativeSandboxCapabilities();
    const dockerOk = DockerSandbox.isAvailable();

    if (nativeCaps.recommended !== 'none' || dockerOk) {
      // Guard: if any backend is functional, sandboxAvailable MUST be true
      expect(available).toBe(true);
      expect(info.backend).not.toBe('none');
    } else {
      // Guard: if no backend is functional, sandboxAvailable MUST be false
      expect(available).toBe(false);
      expect(info.backend).toBe('none');
      expect(info.reason).toContain('indisponible');
    }
  });

  it('fails if detection lies about sandbox availability', () => {
    const nativeCaps = detectNativeSandboxCapabilities();
    const dockerOk = DockerSandbox.isAvailable();
    const realBackendAvailable = nativeCaps.recommended !== 'none' || dockerOk;

    // A detection function that lies would return the opposite of the real host capability
    const detectionIsHonest = sandboxAvailable() === realBackendAvailable;
    expect(detectionIsHonest).toBe(true);
  });
});
