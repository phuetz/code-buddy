import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  RunExperienceSource,
  SensorExperienceSource,
  createDefaultSensorExperienceSource,
} from '../../../src/agent/self-improvement/experience-source.js';

describe('RunExperienceSource', () => {
  it('maps recent-run friction points into modality-agnostic experiences', async () => {
    const source = new RunExperienceSource(
      {
        listRunIds: () => ['run-a', 'run-b'],
        buildRetrospective: (runId) =>
          runId === 'run-a'
            ? {
                frictionPoints: [
                  { detail: 'npm test was slow', evidence: 'tool: bash', severity: 'high', toolName: 'bash' },
                  { detail: 'edit retried twice', evidence: 'tool: str_replace', severity: 'medium' },
                ],
              }
            : null, // run-b not eligible
      },
      { limit: 10 },
    );

    const experiences = await source.collect();
    expect(experiences).toHaveLength(2);
    expect(experiences[0]).toMatchObject({
      id: 'run:run-a:0',
      source: 'run',
      kind: 'bash',
      detail: 'npm test was slow',
      severity: 1,
    });
    expect(experiences[1]).toMatchObject({ id: 'run:run-a:1', kind: 'friction', severity: 0.6 });
  });

  it('honours the run limit', async () => {
    const calls: string[] = [];
    const source = new RunExperienceSource(
      {
        listRunIds: () => ['r1', 'r2', 'r3'],
        buildRetrospective: (runId) => {
          calls.push(runId);
          return { frictionPoints: [] };
        },
      },
      { limit: 2 },
    );
    await source.collect();
    expect(calls).toEqual(['r1', 'r2']); // only first 2
  });
});

describe('SensorExperienceSource (world-model surprise → experiences)', () => {
  it('maps world-model prediction errors into sensor experiences with clamped severity', async () => {
    const source = new SensorExperienceSource({
      fetchSurprises: async () => [
        { modality: 'vision', kind: 'novel-scene', predictionError: 0.5, tsMs: 123, detail: 'unexpected person', context: 'frame-42' },
        { modality: 'audio', predictionError: 4 }, // > errorScale → severity clamped to 1
      ],
      errorScale: 2,
    });

    const experiences = await source.collect();
    expect(experiences).toHaveLength(2);
    expect(experiences[0]).toMatchObject({
      id: 'sensor:vision:123',
      source: 'sensor',
      kind: 'novel-scene',
      detail: 'unexpected person',
      context: 'frame-42',
      severity: 0.25, // 0.5 / 2
    });
    expect(experiences[1]).toMatchObject({ id: 'sensor:audio:1', kind: 'audio', severity: 1 });
    expect(experiences[1]!.detail).toMatch(/prediction error 4\.0000 on audio/);
  });

  it('skips malformed surprises (non-finite / non-positive error) instead of poisoning the curriculum', async () => {
    const source = new SensorExperienceSource({
      fetchSurprises: async () => [
        { predictionError: Number.NaN },
        { predictionError: -1 },
        { predictionError: 0 },
        { modality: 'vision', predictionError: 0.3 },
      ],
    });
    const experiences = await source.collect();
    expect(experiences).toHaveLength(1);
    expect(experiences[0]!.severity).toBeCloseTo(0.3);
  });

  it('never throws: a dead world-model endpoint yields [] so the engine keeps learning from other sources', async () => {
    const source = new SensorExperienceSource({
      fetchSurprises: async () => {
        throw new Error('spoke unreachable');
      },
    });
    await expect(source.collect()).resolves.toEqual([]);
  });

  it('honours the experience limit', async () => {
    const source = new SensorExperienceSource({
      fetchSurprises: async () =>
        Array.from({ length: 10 }, (_, i) => ({ modality: 'vision', predictionError: 1, tsMs: i })),
      limit: 3,
    });
    await expect(source.collect()).resolves.toHaveLength(3);
  });
});

describe('createDefaultSensorExperienceSource (opt-in gate)', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_WORLD_MODEL;
    delete process.env.CODEBUDDY_WORLD_MODEL_URL;
    vi.unstubAllGlobals();
  });

  it('emits nothing unless CODEBUDDY_WORLD_MODEL=true (the seam must not silently emit)', async () => {
    delete process.env.CODEBUDDY_WORLD_MODEL;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(createDefaultSensorExperienceSource().collect()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('polls {base}/surprises when enabled and maps the payload', async () => {
    process.env.CODEBUDDY_WORLD_MODEL = 'true';
    process.env.CODEBUDDY_WORLD_MODEL_URL = 'http://127.0.0.1:9999/';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ surprises: [{ modality: 'vision', predictionError: 0.8, tsMs: 7 }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const experiences = await createDefaultSensorExperienceSource().collect();
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:9999/surprises', expect.anything());
    expect(experiences).toHaveLength(1);
    expect(experiences[0]).toMatchObject({ id: 'sensor:vision:7', source: 'sensor', severity: 0.8 });
  });

  it('fail-open: a dead spoke yields [] instead of blocking the engine', async () => {
    process.env.CODEBUDDY_WORLD_MODEL = 'true';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    await expect(createDefaultSensorExperienceSource().collect()).resolves.toEqual([]);
  });
});
