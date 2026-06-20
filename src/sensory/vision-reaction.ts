/**
 * Vision reaction — on a `vision/motion` event from the nervous-system daemon,
 * run `camera_analyze` (capture a frame + describe it with a local gemma vision
 * model) and record a companion percept. DEBOUNCED (gemma is heavy: 3–10s warm),
 * opt-in (`CODEBUDDY_SENSORY_CAMERA=true`), best-effort, never-throws.
 *
 * @module sensory/vision-reaction
 */

import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';

export interface VisionAnalysis {
  success: boolean;
  description?: string;
  imagePath?: string;
}

export interface VisionAnalyzer {
  analyze(prompt: string): Promise<VisionAnalysis>;
}

export interface VisionReactionOptions {
  /** Injectable analyzer (tests / custom). Defaults to camera_analyze (local gemma). */
  analyzer?: VisionAnalyzer;
  debounceMs?: number;
  cwd?: string;
  now?: () => number;
}

/** Default analyzer: Code Buddy's camera_analyze tool (ffmpeg capture + local gemma). */
async function defaultAnalyze(prompt: string): Promise<VisionAnalysis> {
  const { CameraAnalyzeTool } = await import('../tools/registry/vision-tools.js');
  const tool = new CameraAnalyzeTool({});
  const result = await tool.execute({ prompt });
  const data = result.data as { description?: string; imagePath?: string } | undefined;
  return { success: result.success, description: data?.description ?? result.output, imagePath: data?.imagePath };
}

export function wireVisionReaction(options: VisionReactionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  const debounceMs = options.debounceMs ?? Number(process.env.CODEBUDDY_VISION_DEBOUNCE_MS ?? 8000);
  const now = options.now ?? (() => Date.now());
  const analyzer: VisionAnalyzer = options.analyzer ?? { analyze: defaultAnalyze };
  let lastAt = Number.NEGATIVE_INFINITY;

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    if (p.modality !== 'vision' || p.kind !== 'motion') return;

    const t = now();
    if (t - lastAt < debounceMs) {
      logger.info('[vision] motion (debounced — analysis throttled)');
      return;
    }
    lastAt = t;

    void (async () => {
      try {
        const res = await analyzer.analyze('Motion detected — describe the scene in one sentence.');
        if (!res.success) return;
        const { recordCompanionPercept } = await import('../companion/percepts.js');
        await recordCompanionPercept(
          {
            modality: 'vision',
            source: 'sensory_motion_reaction',
            summary: `Motion → ${res.description ?? '(no description)'}`,
            confidence: 0.9,
            payload: { description: res.description, imagePath: res.imagePath },
            tags: ['motion', 'camera', 'vision'],
          },
          options.cwd ? { cwd: options.cwd } : {},
        );
        logger.info(`[vision] motion analyzed → ${res.description ?? '(no description)'}`);
      } catch (err) {
        logger.warn(`[vision] reaction failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  });

  return () => {
    bus.off(id);
  };
}
