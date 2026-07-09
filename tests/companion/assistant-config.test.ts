import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mergeEnv,
  parseEnv,
  parseVolumePercent,
  voicePreviewCachePath,
  writeAssistantConfig,
} from '../../src/companion/assistant-config.js';

describe('voicePreviewCachePath', () => {
  it('builds a sanitized path under ~/.codebuddy/companion/voice-previews, keyed on voice+text', () => {
    const p = voicePreviewCachePath('estelle');
    expect(p).toMatch(/\.codebuddy\/companion\/voice-previews\/estelle-[a-z0-9]+\.wav$/);
    // default text → stable path (prewarm-friendly), unsafe chars sanitized
    expect(voicePreviewCachePath('estelle')).toBe(p);
    expect(voicePreviewCachePath('a b/../c')).toMatch(/a-b-\.\.-c-[a-z0-9]+\.wav$/);
  });

  it('gives a different cache entry for a different test sentence', () => {
    expect(voicePreviewCachePath('estelle', 'un texte')).not.toBe(
      voicePreviewCachePath('estelle', 'un autre texte')
    );
    expect(voicePreviewCachePath('estelle', 'même texte')).toBe(
      voicePreviewCachePath('estelle', 'même texte')
    );
  });
});

describe('parseVolumePercent', () => {
  it('extracts the first NN% and clamps to 0..150', () => {
    expect(parseVolumePercent('Volume: front-left: 45875 /  70% / -9.29 dB')).toBe(70);
    expect(parseVolumePercent('Mono: Playback 65536 [100%] [on]')).toBe(100);
    expect(parseVolumePercent('no percent here')).toBeNull();
  });
});

describe('parseEnv', () => {
  it('ignores comments and empty lines', () => {
    expect(
      parseEnv(`
        # comment

        CODEBUDDY_TTS_ENGINE = pocket
        CODEBUDDY_ROBOT_NAME= Lisa
        invalid-line
      `)
    ).toEqual({
      CODEBUDDY_TTS_ENGINE: 'pocket',
      CODEBUDDY_ROBOT_NAME: 'Lisa',
    });
  });
});

describe('mergeEnv', () => {
  it('updates in place and appends new managed keys without dropping unrelated lines', () => {
    const input = [
      '# existing config',
      'CODEBUDDY_TTS_ENGINE=piper',
      'CODEBUDDY_SENSORY_ALERT_TOKEN=xyz',
      '',
      'OTHER_VALUE=keep-me',
      '',
    ].join('\n');

    const merged = mergeEnv(input, {
      CODEBUDDY_TTS_ENGINE: 'pocket',
      CODEBUDDY_ROBOT_NAME: 'Lisa',
    });

    expect(merged).toContain('# existing config');
    expect(merged).toContain('CODEBUDDY_TTS_ENGINE=pocket');
    expect(merged).toContain('CODEBUDDY_SENSORY_ALERT_TOKEN=xyz');
    expect(merged).toContain('OTHER_VALUE=keep-me');
    expect(merged).toContain('# --- assistant config (managed) ---');
    expect(merged).toContain('CODEBUDDY_ROBOT_NAME=Lisa');

    const updatedIndex = merged.indexOf('CODEBUDDY_TTS_ENGINE=pocket');
    const secretIndex = merged.indexOf('CODEBUDDY_SENSORY_ALERT_TOKEN=xyz');
    expect(updatedIndex).toBeLessThan(secretIndex);

    const mergedTwice = mergeEnv(merged, { CODEBUDDY_POCKET_VOICE: 'estelle' });
    expect(mergedTwice.match(/# --- assistant config \(managed\) ---/g)).toHaveLength(1);
    expect(mergedTwice).toContain('CODEBUDDY_POCKET_VOICE=estelle');
  });
});

describe('writeAssistantConfig', () => {
  it('rejects invalid enum values and writes valid enum values to tmp env files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assistant-config-'));
    const paths = {
      vision: join(dir, 'vision.env'),
      lisa: join(dir, 'lisa.env'),
    };

    try {
      const invalid = writeAssistantConfig({ CODEBUDDY_TTS_ENGINE: 'bad-engine' }, paths);
      expect(invalid).toEqual({ vision: [], lisa: [] });
      expect(existsSync(paths.vision)).toBe(false);
      expect(existsSync(paths.lisa)).toBe(false);

      const valid = writeAssistantConfig(
        {
          CODEBUDDY_TTS_ENGINE: 'pocket',
          CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'bad-mode',
        },
        paths
      );
      expect(valid).toEqual({
        vision: ['CODEBUDDY_TTS_ENGINE'],
        lisa: ['CODEBUDDY_TTS_ENGINE'],
      });
      expect(readFileSync(paths.vision, 'utf8')).toContain('CODEBUDDY_TTS_ENGINE=pocket');
      expect(readFileSync(paths.vision, 'utf8')).not.toContain(
        'CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE'
      );
      expect(readFileSync(paths.lisa, 'utf8')).toContain('CODEBUDDY_TTS_ENGINE=pocket');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
