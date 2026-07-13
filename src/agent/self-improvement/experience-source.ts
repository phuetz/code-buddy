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

import { logger } from '../../utils/logger.js';
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
 * SENSOR SEAM (the robot's 5 senses → the learning engine). The world-model
 * (JEPA) encodes each modality into a latent z and predicts z_{t+1}; the
 * prediction error ‖z_pred − z_target‖ is SURPRISE — the signal that the
 * robot's model of the world was wrong. Each surprise becomes an Experience,
 * and the engine improves the policies/skills that reduce it — the exact same
 * observe→propose→validate→keep loop, no engine change.
 */
export interface SensorSurprise {
  /** Modality that produced the surprise (vision, audio, screen, …). */
  modality?: string;
  /** Short machine label (e.g. `novel-scene`, `motion-unexpected`). */
  kind?: string;
  /** Human-readable description of what was (un)expected. */
  detail?: string;
  /** Prediction error magnitude ‖z_pred − z_target‖ (unnormalized, > 0). */
  predictionError: number;
  /** Wall-clock or sense-relative timestamp (ms) — used for the stable id. */
  tsMs?: number;
  /** Free-text context (scene/env id, frame path, …). */
  context?: string;
}

export interface SensorExperienceSourceDeps {
  /**
   * Pull recent surprise events from the world model (A2A spoke / ONNX
   * side-car). Injected so the class stays unit-testable and transport-free.
   */
  fetchSurprises: () => Promise<SensorSurprise[]>;
  /** predictionError at or above this maps to severity 1 (default 1.0). */
  errorScale?: number;
  /** Cap on experiences per collect (default 50). */
  limit?: number;
}

/**
 * Turns world-model latent surprise into Experiences. NEVER throws: a dead or
 * missing world-model endpoint yields [] (the engine simply learns from other
 * sources), and malformed entries (non-finite / non-positive error) are
 * skipped — a broken sensor must not poison the curriculum.
 */
export class SensorExperienceSource implements ExperienceSource {
  readonly id = 'sensor-surprise';

  constructor(private readonly deps: SensorExperienceSourceDeps) {}

  async collect(): Promise<Experience[]> {
    const scale = this.deps.errorScale && this.deps.errorScale > 0 ? this.deps.errorScale : 1;
    const limit = Math.max(1, this.deps.limit ?? 50);
    let surprises: SensorSurprise[];
    try {
      surprises = await this.deps.fetchSurprises();
    } catch (err) {
      logger.warn(
        `SensorExperienceSource: world-model surprise fetch failed — no sensor experiences this cycle: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
    if (!Array.isArray(surprises)) return [];

    const experiences: Experience[] = [];
    for (const [index, s] of surprises.entries()) {
      if (experiences.length >= limit) break;
      const err = typeof s?.predictionError === 'number' ? s.predictionError : NaN;
      if (!Number.isFinite(err) || err <= 0) continue;
      const modality = s.modality ?? 'unknown';
      experiences.push({
        id: `sensor:${modality}:${s.tsMs ?? index}`,
        source: 'sensor',
        kind: s.kind ?? modality,
        detail: s.detail ?? `world-model prediction error ${err.toFixed(4)} on ${modality}`,
        context: s.context ?? '',
        severity: Math.min(1, err / scale),
      });
    }
    return experiences;
  }
}

/**
 * Wire SensorExperienceSource to the live world model.
 *
 * Opt-in & fail-open: unless `CODEBUDDY_WORLD_MODEL=true`, collect() returns []
 * (the seam must not silently emit experiences). When enabled it polls the
 * world-model side-car over HTTP — `CODEBUDDY_WORLD_MODEL_URL` (default
 * `http://127.0.0.1:3061`), REST contract:
 *
 *   GET {base}/surprises →
 *     { "surprises": [ { "modality": "vision", "kind": "novel-scene",
 *       "predictionError": 0.42, "tsMs": 1760000000000,
 *       "detail": "...", "context": "..." } ] }
 *
 * The DARKSTAR world-model spoke (encoder ONNX + dynamics) serves this; any
 * error/timeout (3 s) yields [] so a dead spoke never blocks the engine.
 */
export function createDefaultSensorExperienceSource(
  options: { errorScale?: number; limit?: number } = {},
): ExperienceSource {
  return {
    id: 'sensor-surprise',
    async collect(): Promise<Experience[]> {
      if (process.env.CODEBUDDY_WORLD_MODEL !== 'true') return [];
      const base = (process.env.CODEBUDDY_WORLD_MODEL_URL ?? 'http://127.0.0.1:3061').replace(/\/$/, '');
      const source = new SensorExperienceSource({
        ...(options.errorScale !== undefined ? { errorScale: options.errorScale } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        fetchSurprises: async () => {
          const res = await fetch(`${base}/surprises`, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) throw new Error(`world-model spoke HTTP ${res.status}`);
          const body = (await res.json()) as { surprises?: SensorSurprise[] };
          return Array.isArray(body?.surprises) ? body.surprises : [];
        },
      });
      return source.collect();
    },
  };
}
