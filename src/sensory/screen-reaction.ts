/**
 * Screen reaction — on a `screen/change` event from the nervous-system daemon,
 * record a companion percept and (optionally) run an injected analyzer (OCR /
 * vision describe). DEBOUNCED, opt-in (`CODEBUDDY_SENSORY_SCREEN=true`),
 * never-throws. The heavy OCR/describe is pluggable so we don't duplicate Code
 * Buddy's existing OCR/vision; inject an analyzer to wire it.
 *
 * @module sensory/screen-reaction
 */

import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';

export interface ScreenAnalysis {
  description?: string;
}

export interface ScreenAnalyzer {
  analyze(): Promise<ScreenAnalysis>;
}

export interface ScreenReactionOptions {
  /** Injectable OCR/vision describe (default: none — just record the change). */
  analyzer?: ScreenAnalyzer;
  debounceMs?: number;
  cwd?: string;
  now?: () => number;
}

const DEFAULT_SCREEN_DEBOUNCE_MS = 5000;

function resolveScreenDebounceMs(value: number | string | undefined): number {
  const parsed =
    typeof value === 'string' && !value.trim() ? Number.NaN : Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  if (value !== undefined) {
    logger.warn(
      `[screen] invalid debounce ${JSON.stringify(value)}; using ${DEFAULT_SCREEN_DEBOUNCE_MS}ms`,
    );
  }
  return DEFAULT_SCREEN_DEBOUNCE_MS;
}

export function wireScreenReaction(options: ScreenReactionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  const debounceMs = resolveScreenDebounceMs(
    options.debounceMs ?? process.env.CODEBUDDY_SCREEN_DEBOUNCE_MS,
  );
  const now = options.now ?? (() => Date.now());
  let lastAt = Number.NEGATIVE_INFINITY;
  let inFlight = false;
  let disposed = false;

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    if (p.modality !== 'screen' || p.kind !== 'change') return;

    const t = now();
    if (t - lastAt < debounceMs) {
      logger.info('[screen] change (debounced)');
      return;
    }
    if (inFlight) return; // a prior analyze() is still running — don't stampede
    lastAt = t;
    inFlight = true;

    void (async () => {
      try {
        const analysis = options.analyzer ? await options.analyzer.analyze() : {};
        if (disposed) return;
        const { recordCompanionPercept } = await import('../companion/percepts.js');
        const score = (p.payload as { score?: number } | undefined)?.score;
        await recordCompanionPercept(
          {
            modality: 'screen',
            source: 'sensory_screen_reaction',
            summary: `Screen changed${analysis.description ? ` → ${analysis.description}` : ''}`,
            confidence: 0.85,
            payload: { score, description: analysis.description },
            tags: ['screen', 'change'],
          },
          options.cwd ? { cwd: options.cwd } : {},
        );
        logger.info(`[screen] change recorded${analysis.description ? ` → ${analysis.description}` : ''}`);
      } catch (err) {
        logger.warn(`[screen] reaction failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        inFlight = false;
      }
    })();
  });

  return () => {
    disposed = true;
    bus.off(id);
  };
}
