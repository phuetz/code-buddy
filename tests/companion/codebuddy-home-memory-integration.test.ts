import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { envFilePath } from '../../src/companion/assistant-config.js';
import { resolveMobileHistoryDir } from '../../src/companion/mobile-history.js';
import { resolveSelfieCacheDir } from '../../src/companion/lisa-selfie-ingest.js';
import { defaultPrefetchItemsPath } from '../../src/companion/prefetch-config.js';
import { defaultPrefetchCachePath } from '../../src/companion/prefetch-engine.js';
import { resolveSharedPhotosDir } from '../../src/companion/shared-photos.js';
import { defaultVoiceGuidancePath } from '../../src/companion/voice-guidance.js';

afterEach(() => vi.unstubAllEnvs());

describe('companion data follows CODEBUDDY_HOME', () => {
  it('routes assistant settings and mobile history to the configured home', () => {
    const home = path.join(process.cwd(), '_qa', 'codebuddy-home-memory');
    vi.stubEnv('CODEBUDDY_HOME', home);
    expect(envFilePath('lisa')).toBe(path.join(home, 'lisa.env'));
    expect(resolveMobileHistoryDir()).toBe(path.join(home, 'companion', 'mobile-history'));
  });

  it('honours scoped environments for companion defaults', () => {
    const home = path.join(process.cwd(), '_qa', 'scoped-codebuddy-home-memory');
    const env = { CODEBUDDY_HOME: home };
    expect(resolveMobileHistoryDir(env)).toBe(path.join(home, 'companion', 'mobile-history'));
    expect(resolveSelfieCacheDir(env)).toBe(path.join(home, 'companion', 'lisa', 'selfie-cache'));
    expect(defaultPrefetchItemsPath(env)).toBe(path.join(home, 'companion', 'prefetch-items.json'));
    expect(defaultPrefetchCachePath(env)).toBe(path.join(home, 'companion', 'prefetch-cache.json'));
    expect(resolveSharedPhotosDir(env)).toBe(path.join(home, 'companion', 'shared-photos'));
    expect(defaultVoiceGuidancePath(env)).toBe(path.join(home, 'companion', 'voice-guidance.json'));
  });
});
