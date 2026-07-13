import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import type { AutonomyMorningBriefArtifact } from '../src/shared/autonomy-briefing-ipc';
import { readAutonomyMorningBriefing } from '../src/main/ipc/os-ipc';

function validBrief(): AutonomyMorningBriefArtifact {
  return {
    kind: 'codebuddy_autonomy_morning_brief',
    schemaVersion: 1,
    briefingDate: '2026-07-12',
    generatedAt: '2026-07-12T05:00:00.000Z',
    window: { from: '2026-07-11T16:00:00.000Z', to: '2026-07-12T16:00:00.000Z' },
    sourceDir: '/tmp/fleet',
    ledgerPath: '/tmp/fleet/briefings/events.jsonl',
    summary: {
      observedTicks: 8,
      completed: 2,
      failed: 0,
      selfImproved: 1,
      maintenanceChecks: 2,
      goalContinuations: 0,
      paidModelRuns: 0,
      worklogEntries: 1,
    },
    queue: {
      total: 3,
      open: 1,
      inProgress: 0,
      completed: 2,
      blocked: 0,
      criticalAwaitingOperator: 0,
    },
    notableEvents: [],
    worklog: [],
    opportunities: [],
    guardrails: [],
  };
}

function briefingDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cowork-autonomy-brief-'));
  mkdirSync(join(dir, 'briefings'), { recursive: true });
  return dir;
}

describe('readAutonomyMorningBriefing', () => {
  it('discovers the daemon-owned latest artifact and returns its proof paths', async () => {
    const dir = briefingDir();
    writeFileSync(join(dir, 'briefings', 'latest.json'), JSON.stringify(validBrief()));
    writeFileSync(join(dir, 'briefings', 'latest.md'), '# Relève');

    await expect(readAutonomyMorningBriefing(dir)).resolves.toEqual({
      brief: validBrief(),
      jsonPath: join(dir, 'briefings', 'latest.json'),
      markdownPath: join(dir, 'briefings', 'latest.md'),
    });
  });

  it('fails closed on missing, corrupt, foreign, or incomplete JSON', async () => {
    const missing = briefingDir();
    await expect(readAutonomyMorningBriefing(missing)).resolves.toBeNull();

    const corrupt = briefingDir();
    writeFileSync(join(corrupt, 'briefings', 'latest.json'), '{broken');
    await expect(readAutonomyMorningBriefing(corrupt)).resolves.toBeNull();

    const foreign = briefingDir();
    writeFileSync(join(foreign, 'briefings', 'latest.json'), JSON.stringify({ kind: 'something_else', schemaVersion: 1 }));
    await expect(readAutonomyMorningBriefing(foreign)).resolves.toBeNull();

    const incomplete = briefingDir();
    const value = validBrief() as unknown as { summary: Record<string, unknown> };
    delete value.summary.maintenanceChecks;
    writeFileSync(join(incomplete, 'briefings', 'latest.json'), JSON.stringify(value));
    await expect(readAutonomyMorningBriefing(incomplete)).resolves.toBeNull();
  });
});
