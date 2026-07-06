/**
 * env-files — the boot dotenv cascade: project .env first (dev checkout),
 * then the user-level ~/.codebuddy/cowork.env (the packaged-install home of
 * media/TTS settings). Order matters: dotenv never overrides, so first wins.
 */
import { describe, expect, it } from 'vitest';
import { resolveEnvFileCandidates } from './env-files.js';

describe('resolveEnvFileCandidates', () => {
  it('returns project .env then user-level cowork.env, in that order', () => {
    const candidates = resolveEnvFileCandidates('/opt/app/dist-electron/main', '/home/pat');
    expect(candidates).toEqual(['/opt/app/.env', '/home/pat/.codebuddy/cowork.env']);
  });

  it('resolves the project .env two levels above the main bundle', () => {
    const [project] = resolveEnvFileCandidates('/home/patrice/code-buddy/cowork/dist-electron/main', '/home/patrice');
    expect(project).toBe('/home/patrice/code-buddy/cowork/.env');
  });
});
