import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  wireVisionReaction,
  shouldAllowVisionImageEndpoint,
  shouldWireVisionReaction,
  type VisionAnalyzer,
} from '../../src/sensory/vision-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { logger } from '../../src/utils/logger.js';

describe('shouldWireVisionReaction — the camera security invariant', () => {
  it('only enables the camera when explicitly on AND a token is set', () => {
    expect(shouldWireVisionReaction({ camera: 'true', token: 'secret' })).toBe(true);
    expect(shouldWireVisionReaction({ camera: 'true', token: undefined })).toBe(false); // no token → no webcam
    expect(shouldWireVisionReaction({ camera: 'true', token: '' })).toBe(false);
    expect(shouldWireVisionReaction({ camera: 'false', token: 'secret' })).toBe(false);
    expect(shouldWireVisionReaction({})).toBe(false);
  });

  it('keeps raw VLM images loopback-only unless HTTPS remote egress is explicit', () => {
    expect(shouldAllowVisionImageEndpoint('http://127.0.0.1:11434/v1', false)).toBe(true);
    expect(shouldAllowVisionImageEndpoint('http://localhost:11434/v1', false)).toBe(true);
    expect(shouldAllowVisionImageEndpoint('https://vision.example.test/v1', false)).toBe(false);
    expect(shouldAllowVisionImageEndpoint('http://vision.example.test/v1', true)).toBe(false);
    expect(shouldAllowVisionImageEndpoint('https://vision.example.test/v1', true)).toBe(true);
  });
});

function motion(payload: Record<string, unknown> = { score: 0.5 }): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'vision', kind: 'motion', payload },
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

async function waitForPerceptCount(tmp: string, expected: number): Promise<string> {
  const perceptPath = path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl');
  let raw = '';
  await vi.waitFor(async () => {
    raw = await readFile(perceptPath, 'utf8');
    expect(raw.trim().split('\n').filter(Boolean)).toHaveLength(expected);
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  return raw;
}

describe('vision reaction — motion → camera_analyze (debounced)', () => {
  it('analyzes once on motion, records a percept, and debounces a rapid second', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-'));
    let calls = 0;
    const analyzer: VisionAnalyzer = {
      analyze: async () => {
        calls += 1;
        return { success: true, description: 'a tidy desk' };
      },
    };
    let clock = 1000;
    const described: Array<Record<string, unknown>> = [];
    const listenerId = getGlobalEventBus().on('sensory:perception', (event) => {
      const metadata = event.metadata as Record<string, unknown> | undefined;
      if (metadata?.kind === 'scene_described') described.push(metadata);
    });
    const unwire = wireVisionReaction({ analyzer, debounceMs: 5000, cwd: tmp, now: () => clock });
    try {
      motion();
      await waitForPerceptCount(tmp, 1);
      expect(calls).toBe(1); // first motion → analyzed

      motion();
      await tick();
      expect(calls).toBe(1); // within debounce window → suppressed

      clock += 6000; // past the debounce
      motion();
      const percepts = await waitForPerceptCount(tmp, 2);
      expect(calls).toBe(2);

      const lines = percepts.trim().split('\n').filter(Boolean);
      expect(lines.length).toBe(2); // one percept per analysis
      expect(percepts).toContain('a tidy desk');
      expect(percepts).toContain('sensory_motion_reaction');
      expect(described).toHaveLength(2);
      expect(described[0]).toMatchObject({
        modality: 'vision',
        kind: 'scene_described',
        payload: { description: 'a tidy desk', confidence: 0.9 },
      });
      expect(JSON.stringify(described)).not.toContain('imagePath');
    } finally {
      unwire();
      getGlobalEventBus().off(listenerId);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('marks a nearly motionless scene with missing luma as non-salient', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-dark-'));
    const described: Array<Record<string, unknown>> = [];
    const listenerId = getGlobalEventBus().on('sensory:perception', (event) => {
      const metadata = event.metadata as Record<string, unknown> | undefined;
      if (metadata?.kind === 'scene_described') described.push(metadata);
    });
    const unwire = wireVisionReaction({
      analyzer: { analyze: async () => ({ success: true, description: 'un ciel étoilé' }) },
      debounceMs: 0,
      cwd: tmp,
    });
    try {
      motion({ motionScore: 0.03 });
      await tick();

      expect(described).toHaveLength(1);
      expect(described[0]).toMatchObject({
        salience: 64,
        payload: { motionScore: 0.03 },
      });
    } finally {
      unwire();
      getGlobalEventBus().off(listenerId);
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('ignores non-vision events', async () => {
    let calls = 0;
    const analyzer: VisionAnalyzer = {
      analyze: async () => {
        calls += 1;
        return { success: true };
      },
    };
    const unwire = wireVisionReaction({ analyzer, debounceMs: 0 });
    try {
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'audio', kind: 'speech_start' } });
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: 1 } } });
      await tick();
      expect(calls).toBe(0);
    } finally {
      unwire();
    }
  });

  it('skips a motion keyframe whose payload reports darkness', async () => {
    let calls = 0;
    const info = vi.spyOn(logger, 'info');
    const unwire = wireVisionReaction({
      analyzer: {
        analyze: async () => {
          calls += 1;
          return { success: false };
        },
      },
      debounceMs: 0,
    });
    try {
      motion({ score: 0.4, meanLuma: 11.9 });
      await tick();
      expect(calls).toBe(0);
      expect(info).toHaveBeenCalledWith('[vision] motion skipped (dark frame meanLuma=11.9)');
    } finally {
      unwire();
      info.mockRestore();
    }
  });

  it('caps ten motion events in ten seconds to four analyses', async () => {
    const previousLimit = process.env.CODEBUDDY_VISION_MAX_ANALYSES_PER_MIN;
    process.env.CODEBUDDY_VISION_MAX_ANALYSES_PER_MIN = '4';
    let calls = 0;
    let clock = 1_000;
    const info = vi.spyOn(logger, 'info');
    const unwire = wireVisionReaction({
      analyzer: {
        analyze: async () => {
          calls += 1;
          return { success: false };
        },
      },
      debounceMs: 0,
      now: () => clock,
    });
    try {
      for (let index = 0; index < 10; index += 1) {
        motion({ score: 0.4, meanLuma: 80 });
        await tick();
        clock += 1_000;
      }
      expect(calls).toBeLessThanOrEqual(4);
      expect(info).toHaveBeenCalledWith('[vision] motion skipped (analysis rate limit 4/min)');
    } finally {
      unwire();
      info.mockRestore();
      if (previousLimit === undefined) delete process.env.CODEBUDDY_VISION_MAX_ANALYSES_PER_MIN;
      else process.env.CODEBUDDY_VISION_MAX_ANALYSES_PER_MIN = previousLimit;
    }
  });

  it('falls back to the safe debounce when the environment value is invalid', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-invalid-debounce-'));
    const previousDebounce = process.env.CODEBUDDY_VISION_DEBOUNCE_MS;
    const previousToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    const previousChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    process.env.CODEBUDDY_VISION_DEBOUNCE_MS = 'not-a-number';
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    let calls = 0;
    const unwire = wireVisionReaction({
      analyzer: {
        analyze: async () => {
          calls += 1;
          return { success: true, description: 'une scène' };
        },
      },
      cwd: tmp,
      now: () => 1000,
    });
    try {
      motion();
      await tick();
      motion();
      await tick();
      expect(calls).toBe(1);
    } finally {
      unwire();
      if (previousDebounce === undefined) delete process.env.CODEBUDDY_VISION_DEBOUNCE_MS;
      else process.env.CODEBUDDY_VISION_DEBOUNCE_MS = previousDebounce;
      if (previousToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
      else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousToken;
      if (previousChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
      else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousChat;
    }
  });

  it('falls back to the safe alert cooldown when the environment value is invalid', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-invalid-cooldown-'));
    const previousToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    const previousChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    const previousCooldown = process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS;
    const originalFetch = globalThis.fetch;
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'test-token';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = 'test-chat';
    process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS = 'invalid';
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return { ok: true } as Response;
    }) as typeof fetch;
    let clock = 1000;
    const unwire = wireVisionReaction({
      analyzer: { analyze: async () => ({ success: true, description: 'la même scène' }) },
      debounceMs: 0,
      cwd: tmp,
      now: () => clock,
    });
    try {
      motion();
      await tick();
      clock += 300_001;
      motion();
      await tick();
      expect(fetchCalls).toBe(2);
    } finally {
      unwire();
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
      else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousToken;
      if (previousChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
      else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousChat;
      if (previousCooldown === undefined) delete process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS;
      else process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS = previousCooldown;
    }
  });

  it('falls back to the safe similarity threshold when the environment value is out of range', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-invalid-similarity-'));
    const previousToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    const previousChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    const previousSimilarity = process.env.CODEBUDDY_VISION_ALERT_SIM;
    const originalFetch = globalThis.fetch;
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'test-token';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = 'test-chat';
    process.env.CODEBUDDY_VISION_ALERT_SIM = '-1';
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return { ok: true } as Response;
    }) as typeof fetch;
    let description = 'un bureau calme';
    const unwire = wireVisionReaction({
      analyzer: { analyze: async () => ({ success: true, description }) },
      debounceMs: 0,
      cwd: tmp,
      now: () => 1000,
    });
    try {
      motion();
      await tick();
      description = 'un jardin éclairé';
      motion();
      await tick();
      expect(fetchCalls).toBe(2);
    } finally {
      unwire();
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
      else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousToken;
      if (previousChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
      else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousChat;
      if (previousSimilarity === undefined) delete process.env.CODEBUDDY_VISION_ALERT_SIM;
      else process.env.CODEBUDDY_VISION_ALERT_SIM = previousSimilarity;
    }
  });

  it('does not publish an in-flight analysis after teardown', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-teardown-'));
    let release!: (analysis: { success: boolean; description?: string }) => void;
    const analysis = new Promise<{ success: boolean; description?: string }>((resolve) => {
      release = resolve;
    });
    const described: Array<Record<string, unknown>> = [];
    const listenerId = getGlobalEventBus().on('sensory:perception', (event) => {
      const metadata = event.metadata as Record<string, unknown> | undefined;
      if (metadata?.kind === 'scene_described') described.push(metadata);
    });
    const unwire = wireVisionReaction({
      analyzer: { analyze: async () => analysis },
      debounceMs: 0,
      cwd: tmp,
    });

    try {
      motion();
      await tick();
      unwire();
      release({ success: true, description: 'stale camera frame' });
      await tick();

      expect(described).toHaveLength(0);
    } finally {
      unwire();
      getGlobalEventBus().off(listenerId);
    }
  });

  it('rejects a false analyzer success that contains no description', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-empty-success-'));
    const described: Array<Record<string, unknown>> = [];
    const listenerId = getGlobalEventBus().on('sensory:perception', (event) => {
      const metadata = event.metadata as Record<string, unknown> | undefined;
      if (metadata?.kind === 'scene_described') described.push(metadata);
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const unwire = wireVisionReaction({
      analyzer: { analyze: async () => ({ success: true }) },
      debounceMs: 0,
      cwd: tmp,
    });
    try {
      motion();
      await tick();

      expect(described).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(
        '[vision] analyzer reported success without a description; ignoring result',
      );
    } finally {
      unwire();
      getGlobalEventBus().off(listenerId);
      warn.mockRestore();
    }
  });

  it('retries a similar Telegram alert when the previous delivery was rejected', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-alert-retry-'));
    const previousToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    const previousChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    const previousCooldown = process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS;
    const previousSimilarity = process.env.CODEBUDDY_VISION_ALERT_SIM;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'test-token';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = 'test-chat';
    process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS = '300000';
    process.env.CODEBUDDY_VISION_ALERT_SIM = '0.6';
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return { ok: false } as Response;
    }) as typeof fetch;
    let clock = 1000;
    const unwire = wireVisionReaction({
      analyzer: { analyze: async () => ({ success: true, description: 'la même scène calme' }) },
      debounceMs: 0,
      cwd: tmp,
      now: () => clock,
    });
    try {
      motion();
      await tick();
      clock += 1000;
      motion();
      await tick();

      expect(fetchCalls).toBe(2);
    } finally {
      unwire();
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
      else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousToken;
      if (previousChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
      else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousChat;
      if (previousCooldown === undefined) delete process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS;
      else process.env.CODEBUDDY_VISION_ALERT_COOLDOWN_MS = previousCooldown;
      if (previousSimilarity === undefined) delete process.env.CODEBUDDY_VISION_ALERT_SIM;
      else process.env.CODEBUDDY_VISION_ALERT_SIM = previousSimilarity;
    }
  });

  it('redacts VLM text and hides the raw camera label before Telegram egress', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'vision-egress-'));
    const previousToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    const previousChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    const originalFetch = globalThis.fetch;
    const bodies: string[] = [];
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'test-token';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = 'test-chat';
    globalThis.fetch = (async (_input, init) => {
      if (typeof init?.body === 'string') bodies.push(init.body);
      return { ok: true } as Response;
    }) as typeof fetch;
    const analyzer: VisionAnalyzer = {
      analyze: async () => ({
        success: true,
        description: 'Contact test@example.com avec sk-proj-abcdefghijklmnopqrstuvwxyz dans /home/patrice/secret.txt',
      }),
    };
    const unwire = wireVisionReaction({ analyzer, debounceMs: 0, cwd: tmp });
    try {
      motion({ score: 0.5, camera: 'Kitchen-/home/patrice-sk-proj-secret' });
      await new Promise((resolve) => setTimeout(resolve, 60));
      const sent = bodies.join('\n');
      expect(sent).toContain('caméra locale');
      expect(sent).toContain('[REDACTED:pii-email]');
      expect(sent).toContain('[REDACTED:env-key]');
      expect(sent).not.toContain('test@example.com');
      expect(sent).not.toContain('/home/patrice');
      expect(sent).not.toContain('Kitchen-');
    } finally {
      unwire();
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
      else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousToken;
      if (previousChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
      else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousChat;
    }
  });
});
