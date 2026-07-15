import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGlobalEventBus, resetEventBus } from '../../src/events/event-bus.js';
import {
  wireErrorWatchReaction,
  type ErrorWatchReactionOptions,
  type ErrorWatchVisionAnalyzer,
} from '../../src/sensory/error-watch-reaction.js';
import { getSensoryMemory } from '../../src/sensory/sensory-memory.js';

const ENABLED_ENV: NodeJS.ProcessEnv = {
  CODEBUDDY_SENSORY: 'true',
  CODEBUDDY_SENSORY_ERRORWATCH: 'true',
};

function screen(
  payload: Record<string, unknown> = {},
  kind: 'change' | 'keyframe' = 'change',
): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'screen', kind, payload },
  });
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function harness(overrides: ErrorWatchReactionOptions = {}): {
  say: ReturnType<typeof vi.fn<(utterance: string) => Promise<void>>>;
  claim: ReturnType<typeof vi.fn<(surface: 'error-watch') => boolean>>;
  unwire: () => void;
} {
  const say = vi.fn<(utterance: string) => Promise<void>>().mockResolvedValue(undefined);
  const claim = vi.fn<(surface: 'error-watch') => boolean>().mockReturnValue(true);
  const unwire = wireErrorWatchReaction({
    env: ENABLED_ENV,
    say,
    conductor: { claim },
    ...overrides,
  });
  return { say, claim, unwire };
}

describe('error watch reaction', () => {
  beforeEach(() => {
    resetEventBus();
    getSensoryMemory().drain();
  });

  afterEach(() => {
    resetEventBus();
    getSensoryMemory().drain();
    vi.restoreAllMocks();
  });

  describe('fast text stage', () => {
    it('offers help through the conductor for a Traceback and remembers the utterance', async () => {
      const analyzer: ErrorWatchVisionAnalyzer = { analyze: vi.fn() };
      const { say, claim, unwire } = harness({ analyzer });

      try {
        screen({
          atSpi: {
            role: 'terminal',
            lines: [
              'Traceback (most recent call last):',
              '  File "app.py", line 4',
              'ValueError: bad input',
            ],
          },
        });
        await settle();

        expect(analyzer.analyze).not.toHaveBeenCalled();
        expect(claim).toHaveBeenCalledOnce();
        expect(claim).toHaveBeenCalledWith('error-watch');
        expect(say).toHaveBeenCalledOnce();
        expect(say.mock.calls[0]?.[0]).toContain('Je vois une erreur Traceback');
        expect(say.mock.calls[0]?.[0]).toContain('ValueError: bad input');
        expect(say.mock.calls[0]?.[0]).toContain('dis "aide-moi"');

        const remembered = getSensoryMemory().snapshot();
        expect(remembered).toHaveLength(1);
        expect(remembered[0]?.kind).toBe('error_watch');
        expect(remembered[0]?.payload).toMatchObject({
          utterance: say.mock.calls[0]?.[0],
        });
      } finally {
        unwire();
      }
    });

    it('stays silent for healthy text', async () => {
      const analyzer: ErrorWatchVisionAnalyzer = { analyze: vi.fn() };
      const { say, claim, unwire } = harness({ analyzer });

      try {
        screen({ atSpi: { text: 'Build completed successfully. 42 tests passed.' } });
        await settle();

        expect(analyzer.analyze).not.toHaveBeenCalled();
        expect(claim).not.toHaveBeenCalled();
        expect(say).not.toHaveBeenCalled();
      } finally {
        unwire();
      }
    });

    it('does not call vision when no text is present and vision is off', async () => {
      const analyzer: ErrorWatchVisionAnalyzer = { analyze: vi.fn() };
      const { say, unwire } = harness({ analyzer });

      try {
        screen({ imagePath: '/existing/screen.png' }, 'keyframe');
        await settle();

        expect(analyzer.analyze).not.toHaveBeenCalled();
        expect(say).not.toHaveBeenCalled();
      } finally {
        unwire();
      }
    });
  });

  describe('local vision stage', () => {
    it('offers help when the injected analyzer answers OUI', async () => {
      const analyzer: ErrorWatchVisionAnalyzer = {
        analyze: vi.fn().mockResolvedValue({
          success: true,
          description: 'OUI — npm ERR! commande de build en échec',
        }),
      };
      const { say, claim, unwire } = harness({
        analyzer,
        env: { ...ENABLED_ENV, CODEBUDDY_ERRORWATCH_VISION: 'true' },
      });

      try {
        screen({ keyframePath: '/existing/screen.png' }, 'keyframe');
        await settle();

        expect(analyzer.analyze).toHaveBeenCalledOnce();
        expect(analyzer.analyze).toHaveBeenCalledWith(
          expect.stringContaining('Réponds strictement OUI ou NON'),
          '/existing/screen.png',
        );
        expect(claim).toHaveBeenCalledWith('error-watch');
        expect(say).toHaveBeenCalledWith(
          expect.stringContaining('npm ERR! commande de build en échec'),
        );
      } finally {
        unwire();
      }
    });

    it('stays silent when the injected analyzer answers NON', async () => {
      const analyzer: ErrorWatchVisionAnalyzer = {
        analyze: vi.fn().mockResolvedValue({
          success: true,
          description: 'NON — aucune erreur visible',
        }),
      };
      const { say, claim, unwire } = harness({
        analyzer,
        env: { ...ENABLED_ENV, CODEBUDDY_ERRORWATCH_VISION: 'true' },
      });

      try {
        screen({ imagePath: '/existing/screen.png' }, 'keyframe');
        await settle();

        expect(analyzer.analyze).toHaveBeenCalledOnce();
        expect(claim).not.toHaveBeenCalled();
        expect(say).not.toHaveBeenCalled();
      } finally {
        unwire();
      }
    });

    it('absorbs analyzer failures and stays silent', async () => {
      const analyzer: ErrorWatchVisionAnalyzer = {
        analyze: vi.fn().mockRejectedValue(new Error('local VLM unavailable')),
      };
      const { say, claim, unwire } = harness({
        analyzer,
        env: { ...ENABLED_ENV, CODEBUDDY_ERRORWATCH_VISION: 'true' },
      });

      try {
        expect(() => screen({ imagePath: '/existing/screen.png' }, 'keyframe')).not.toThrow();
        await settle();

        expect(claim).not.toHaveBeenCalled();
        expect(say).not.toHaveBeenCalled();
      } finally {
        unwire();
      }
    });
  });

  describe('anti-harassment limits', () => {
    it('deduplicates an identical error even after the debounce window', async () => {
      let clock = 1_000;
      const { say, unwire } = harness({ debounceMs: 100, now: () => clock });

      try {
        const payload = { text: 'npm ERR! missing script: build' };
        screen(payload);
        await settle();
        clock += 1_000;
        screen(payload);
        await settle();

        expect(say).toHaveBeenCalledOnce();
      } finally {
        unwire();
      }
    });

    it('debounces different errors inside the configured window', async () => {
      let clock = 1_000;
      const { say, unwire } = harness({ debounceMs: 5_000, now: () => clock });

      try {
        screen({ text: 'Error: first failure' });
        await settle();
        clock += 100;
        screen({ text: 'panic: second failure' });
        await settle();

        expect(say).toHaveBeenCalledOnce();
      } finally {
        unwire();
      }
    });

    it('respects the rolling hourly quota', async () => {
      let clock = 1_000;
      const { say, unwire } = harness({ debounceMs: 0, maxPerHour: 2, now: () => clock });

      try {
        for (const text of ['Error: first', 'FAILED second', 'Uncaught third']) {
          screen({ terminalText: text });
          await settle();
          clock += 1_000;
        }

        expect(say).toHaveBeenCalledTimes(2);
      } finally {
        unwire();
      }
    });
  });

  it('adds no listener when either opt-in environment variable is absent', () => {
    const bus = getGlobalEventBus();
    const before = bus.listenerCount('sensory:perception');

    const unwireWithoutGlobal = wireErrorWatchReaction({
      env: { CODEBUDDY_SENSORY_ERRORWATCH: 'true' },
    });
    const unwireWithoutFeature = wireErrorWatchReaction({
      env: { CODEBUDDY_SENSORY: 'true' },
    });

    expect(bus.listenerCount('sensory:perception')).toBe(before);
    unwireWithoutGlobal();
    unwireWithoutFeature();
    expect(bus.listenerCount('sensory:perception')).toBe(before);
  });
});
