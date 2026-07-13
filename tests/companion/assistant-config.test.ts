import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSISTANT_SETTINGS,
  mergeEnv,
  parseEnv,
  parseVolumePercent,
  readAssistantConfig,
  readAssistantRuntimeEnv,
  voicePreviewCachePath,
  writeAssistantConfig,
} from '../../src/companion/assistant-config.js';

describe('assistant TTS defaults', () => {
  it('presents Pocket first, Voicebox expressive, and Piper as the legacy fallback', () => {
    const engine = ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_TTS_ENGINE');
    expect(engine).toMatchObject({
      default: 'pocket',
      options: ['pocket', 'voicebox', 'piper'],
    });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_POCKET_SERVER'))
      .toMatchObject({ default: 'true' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_POCKET_AUDIO_STREAM'))
      .toMatchObject({ default: 'true' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_POCKET_QUANTIZE'))
      .toMatchObject({ default: 'false' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_VOICEBOX_URL'))
      .toMatchObject({ default: 'http://127.0.0.1:17493', envFile: 'both' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_VOICEBOX_PROFILE'))
      .toMatchObject({ default: '', envFile: 'both' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_VOICEBOX_ENGINE'))
      .toMatchObject({ default: 'qwen' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_TTS_VOLUME'))
      .toMatchObject({ default: '100', type: 'volume', envFile: 'both' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_VOICE_ROUTING_MODE'))
      .toMatchObject({ default: 'realtime', options: ['realtime', 'grounded'] });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_VOICE_TEMPERATURE'))
      .toMatchObject({ default: '0.2' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_SENSORY_SPEAK_FACT_MODEL'))
      .toMatchObject({ default: '' });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_SENSORY_SPEAK_BASE_URL'))
      .toMatchObject({
        default: 'http://127.0.0.1:11434/v1',
        group: 'speech',
        type: 'text',
      });
    expect(
      ASSISTANT_SETTINGS.find(
        (setting) => setting.key === 'CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE'
      )
    ).toMatchObject({
      default: 'default',
      options: ['default', 'dontAsk', 'bypassPermissions'],
    });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_AVATAR_STREAM_AUDIO'))
      .toMatchObject({
        default: 'auto',
        type: 'enum',
        options: ['auto', 'true', 'false'],
      });
    expect(ASSISTANT_SETTINGS.find((setting) => setting.key === 'CODEBUDDY_CONVERSATION_COWORK'))
      .toMatchObject({ default: 'true', type: 'toggle', envFile: 'both' });
    expect(
      ASSISTANT_SETTINGS.find(
        (setting) => setting.key === 'CODEBUDDY_CONVERSATION_MIRROR_COWORK',
      ),
    ).toMatchObject({ default: 'true', type: 'toggle', envFile: 'both' });
    expect(
      ASSISTANT_SETTINGS.find(
        (setting) => setting.key === 'CODEBUDDY_CONVERSATION_COWORK_HISTORY',
      ),
    ).toMatchObject({ default: '24', type: 'text', envFile: 'both' });
  });
});

describe('assistant permission posture migration', () => {
  it('surfaces an old resident plan value as guarded default without rewriting the env file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assistant-plan-migration-'));
    const paths = {
      vision: join(dir, 'vision.env'),
      lisa: join(dir, 'lisa.env'),
    };
    try {
      const original = 'CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE=plan\nUNRELATED=keep\n';
      // mergeEnv is the production-preserving writer and avoids introducing a
      // second test-only file serialization path.
      const written = writeAssistantConfig(
        { CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE: 'default' },
        paths
      );
      expect(written.vision).toContain('CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE');
      // Put the exact legacy content back to prove reads are non-mutating.
      writeFileSync(paths.vision, original, 'utf8');
      expect(readAssistantConfig(paths).CODEBUDDY_SENSORY_SPEAK_PERMISSION_MODE).toBe('default');
      expect(readFileSync(paths.vision, 'utf8')).toBe(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('assistant privileged runtime env', () => {
  it('keeps operational Telegram credentials outside the renderer-facing settings schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assistant-runtime-env-'));
    const paths = {
      vision: join(dir, 'vision.env'),
      lisa: join(dir, 'lisa.env'),
    };
    try {
      writeFileSync(
        paths.vision,
        'CODEBUDDY_SENSORY_ALERT_TOKEN=private-token\nCODEBUDDY_SENSORY_ALERT_CHAT=42\n',
        'utf8',
      );
      writeFileSync(paths.lisa, 'CODEBUDDY_ROBOT_NAME=Lisa\n', 'utf8');

      expect(readAssistantRuntimeEnv(paths)).toMatchObject({
        CODEBUDDY_SENSORY_ALERT_TOKEN: 'private-token',
        CODEBUDDY_SENSORY_ALERT_CHAT: '42',
      });
      expect(readAssistantConfig(paths)).not.toHaveProperty('CODEBUDDY_SENSORY_ALERT_TOKEN');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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

  it('preserves an explicit 0..100 assistant volume and rejects out-of-range values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'assistant-volume-config-'));
    const paths = {
      vision: join(dir, 'vision.env'),
      lisa: join(dir, 'lisa.env'),
    };

    try {
      expect(writeAssistantConfig({ CODEBUDDY_TTS_VOLUME: '101' }, paths)).toEqual({
        vision: [],
        lisa: [],
      });
      expect(writeAssistantConfig({ CODEBUDDY_TTS_VOLUME: '35' }, paths)).toEqual({
        vision: ['CODEBUDDY_TTS_VOLUME'],
        lisa: ['CODEBUDDY_TTS_VOLUME'],
      });
      expect(readFileSync(paths.vision, 'utf8')).toContain('CODEBUDDY_TTS_VOLUME=35');
      expect(readFileSync(paths.lisa, 'utf8')).toContain('CODEBUDDY_TTS_VOLUME=35');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
