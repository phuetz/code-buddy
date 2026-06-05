/**
 * Experience sources — the modality-agnostic seam.
 *
 * An ExperienceSource yields units of feedback the engine learns from. Today the
 * only source is code-run friction (RunExperienceSource, built on the existing
 * learning retrospectives). The SAME interface is the plug-in point for the
 * robot's senses: a future SensorExperienceSource turns world-model (JEPA)
 * prediction error / latent-state surprise from vision, audio, touch, etc. into
 * Experiences — without changing the engine. That is deliberately interface-only
 * here; the 10-year robot horizon is not built in V1.
 *
 * @module agent/self-improvement/experience-source
 */

import type { Experience } from './types.js';

export interface ExperienceSource {
  readonly id: string;
  collect(): Promise<Experience[]>;
}

const SEVERITY_SCORE: Record<'low' | 'medium' | 'high', number> = {
  low: 0.3,
  medium: 0.6,
  high: 1,
};

interface RetroFrictionPoint {
  detail: string;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
  toolName?: string;
}

export interface RunExperienceSourceDeps {
  /** Recent run ids, newest first. */
  listRunIds: () => string[];
  /** Build a retrospective for a run (null if not eligible). */
  buildRetrospective: (runId: string) => { frictionPoints: RetroFrictionPoint[] } | null;
}

/**
 * Mines recent runs' retrospectives for friction and turns each friction point
 * into an Experience. Dependencies are injected so it stays unit-testable and
 * decoupled from RunStore singletons; `createDefaultRunExperienceSource` wires
 * the real learning infrastructure.
 */
export class RunExperienceSource implements ExperienceSource {
  readonly id = 'run-friction';

  constructor(
    private readonly deps: RunExperienceSourceDeps,
    private readonly options: { limit?: number } = {},
  ) {}

  async collect(): Promise<Experience[]> {
    const limit = Math.max(1, this.options.limit ?? 10);
    const runIds = this.deps.listRunIds().slice(0, limit);
    const experiences: Experience[] = [];
    for (const runId of runIds) {
      const retro = this.deps.buildRetrospective(runId);
      if (!retro) continue;
      retro.frictionPoints.forEach((point, index) => {
        experiences.push({
          id: `run:${runId}:${index}`,
          source: 'run',
          kind: point.toolName ?? 'friction',
          detail: point.detail,
          context: point.evidence,
          severity: SEVERITY_SCORE[point.severity],
        });
      });
    }
    return experiences;
  }
}

/**
 * Wire RunExperienceSource to the real learning infrastructure. The heavy
 * RunStore/learning-agent modules are dynamically imported inside collect() (ESM
 * lazy load), then delegated to the testable RunExperienceSource class.
 */
export function createDefaultRunExperienceSource(
  options: { workDir?: string; limit?: number } = {},
): ExperienceSource {
  return {
    id: 'run-friction',
    async collect(): Promise<Experience[]> {
      const [{ RunStore }, { buildLearningRetrospective }] = await Promise.all([
        import('../../observability/run-store.js'),
        import('../learning-agent.js'),
      ]);
      const store = RunStore.getInstance();
      const source = new RunExperienceSource(
        {
          listRunIds: () => store.listRuns().map((r: { runId: string }) => r.runId),
          buildRetrospective: (runId: string) =>
            buildLearningRetrospective(runId, { workDir: options.workDir }) ?? null,
        },
        { limit: options.limit },
      );
      return source.collect();
    },
  };
}

/**
 * SENSOR SEAM (robot future, interface-only). When the robot grants senses, a
 * world-model (JEPA) encodes each modality into a latent z and predicts z_{t+1};
 * the prediction error / latent surprise becomes the Experience signal here, and
 * the engine improves the policies/skills that reduce that surprise — the exact
 * same observe→propose→validate→keep loop, no engine change. NOT implemented in
 * V1: it must not silently emit experiences.
 */
export class SensorExperienceSource implements ExperienceSource {
  readonly id = 'sensor-surprise';

  async collect(): Promise<Experience[]> {
    throw new Error(
      'SensorExperienceSource is the robot 5-senses seam and is not implemented in V1. ' +
        'Wire a world-model (JEPA) latent prediction-error stream here when sensors are available.',
    );
  }
}
