import { describe, expect, it } from 'vitest';

import {
  RunExperienceSource,
  SensorExperienceSource,
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

describe('SensorExperienceSource (robot 5-senses seam)', () => {
  it('refuses to run in V1 instead of silently emitting fake experiences', async () => {
    await expect(new SensorExperienceSource().collect()).rejects.toThrow(/not implemented in V1/i);
  });
});
