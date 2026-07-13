import { describe, expect, it } from 'vitest';

import type { AutonomyMorningBriefArtifact } from '../src/shared/autonomy-briefing-ipc';
import type { MaisonSnapshotPayload } from '../src/shared/maison-ipc';
import type { Session } from '../src/renderer/types';
import {
  buildLivingBriefing,
  type LivingBriefingInput,
} from '../src/renderer/components/living-briefing-model';

const NOW = new Date('2026-07-12T07:30:00+02:00').getTime();

function session(id: string, updatedAt = NOW - 60_000): Session {
  return {
    id,
    title: `Session ${id}`,
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    createdAt: updatedAt - 1_000,
    updatedAt,
  };
}

function brief(): AutonomyMorningBriefArtifact {
  return {
    kind: 'codebuddy_autonomy_morning_brief',
    schemaVersion: 1,
    briefingDate: '2026-07-12',
    generatedAt: '2026-07-12T05:20:00.000Z',
    window: { from: '2026-07-11T16:00:00.000Z', to: '2026-07-12T16:00:00.000Z' },
    sourceDir: '/tmp/fleet',
    ledgerPath: '/tmp/fleet/briefings/events-2026-07-12.jsonl',
    summary: {
      observedTicks: 14,
      completed: 3,
      failed: 0,
      selfImproved: 2,
      maintenanceChecks: 4,
      goalContinuations: 1,
      paidModelRuns: 0,
      worklogEntries: 3,
    },
    queue: {
      total: 7,
      open: 2,
      inProgress: 1,
      completed: 4,
      blocked: 0,
      criticalAwaitingOperator: 0,
    },
    notableEvents: [
      {
        schemaVersion: 1,
        at: '2026-07-12T04:00:00.000Z',
        briefingDate: '2026-07-12',
        tickNumber: 9,
        outcome: 'self_improved',
        taskId: 'voice-1',
        taskTitle: 'Réduire la latence vocale',
        detail: 'Le gate a conservé le chemin rapide local.',
      },
    ],
    worklog: [],
    opportunities: [
      {
        kind: 'ready_work',
        title: 'Mesurer le premier son',
        reason: 'La tâche est bornée.',
        evidence: 'fleet task latency-bench',
        taskId: 'latency-bench',
        safeNextStep: 'Lancer le benchmark local sans publication externe.',
      },
    ],
    guardrails: ['Aucune publication externe sans validation.'],
  };
}

function input(overrides: Partial<LivingBriefingInput> = {}): LivingBriefingInput {
  return {
    now: NOW,
    activities: [],
    sessions: [],
    snapshot: null,
    daemonRunning: true,
    artifact: null,
    ...overrides,
  };
}

function maison(overrides: Partial<MaisonSnapshotPayload> = {}): MaisonSnapshotPayload {
  return {
    status: 'ready',
    snapshot: {
      day: { kind: 'weekend' },
      presence: { state: 'present' },
      mode: 'normal',
      provenance: { kind: 'calendar', observedAt: NOW },
      nextMeal: {
        title: 'Tarte aux légumes',
        whenLabel: 'Dîner · 19:30',
        state: 'planned',
      },
    },
    activeTimers: [],
    foodProfile: { configured: true, constraintCount: 1, unknownCount: 0 },
    warnings: [],
    ...overrides,
  };
}

describe('buildLivingBriefing', () => {
  it('prefers the evidence-backed Night Watch artifact and keeps its provenance', () => {
    const model = buildLivingBriefing(input({
      sessions: [session('recent')],
      artifact: {
        brief: brief(),
        jsonPath: '/tmp/fleet/briefings/latest.json',
        markdownPath: '/tmp/fleet/briefings/latest.md',
      },
    }));

    expect(model.headline).toBe('J’ai avancé pendant ton absence');
    expect(model.sourceLabel).toBe('Relève probante · 2026-07-12');
    expect(model.stats.map(({ label, value }) => [label, value])).toEqual([
      ['Terminées', 3],
      ['Évolutions', 2],
      ['En cours', 1],
      ['Payant', 0],
    ]);
    expect(model.moments[0]).toMatchObject({
      title: 'Réduire la latence vocale',
      tone: 'memory',
      source: 'daemon',
    });
    expect(model.nextFocus).toEqual({
      title: 'Mesurer le premier son',
      reason: 'Lancer le benchmark local sans publication externe.',
    });
    expect(model.artifactPath).toBe('/tmp/fleet/briefings/latest.md');
    expect(model.spokenText).toContain('3 tâches terminées');
  });

  it('falls back to live Cowork/session/queue signals without inventing a result', () => {
    const model = buildLivingBriefing(input({
      sessions: [session('book')],
      activities: [
        {
          id: 4,
          type: 'memory.added',
          title: 'Préférence mémorisée',
          timestamp: NOW - 5_000,
        },
      ],
      snapshot: {
        tasks: [{ id: 'next', title: 'Préparer le storyboard', status: 'open', priority: 'high' }],
        worklog: [],
        presence: {
          robot: { host: 'Code Buddy', status: 'active', lastSeen: new Date(NOW - 30_000).toISOString() },
        },
      },
    }));

    expect(model.artifactPath).toBeNull();
    expect(model.headline).toBe('J’ai avancé pendant ton absence');
    expect(model.stats.find((stat) => stat.label === 'Sessions')?.value).toBe(1);
    expect(model.stats.find((stat) => stat.label === 'Agents')?.value).toBe(1);
    expect(model.nextFocus?.title).toBe('Préparer le storyboard');
    expect(model.moments.map((moment) => moment.title)).toEqual([
      'Préférence mémorisée',
      'Session book',
    ]);
  });

  it('renders a calm honest state when there is no report and no recent work', () => {
    const model = buildLivingBriefing(input());
    expect(model.headline).toBe('Tout est calme, je veille');
    expect(model.hasNewWork).toBe(false);
    expect(model.moments).toEqual([]);
    expect(model.summary).toContain('Aucun événement récent');
  });

  it('surfaces operator attention and paid use rather than hiding it', () => {
    const value = brief();
    value.summary.failed = 1;
    value.summary.paidModelRuns = 2;
    value.queue.criticalAwaitingOperator = 1;
    const model = buildLivingBriefing(input({ artifact: {
      brief: value,
      jsonPath: '/tmp/latest.json',
      markdownPath: '/tmp/latest.md',
    } }));

    expect(model.headline).toContain('point à regarder');
    expect(model.stats.find((stat) => stat.label === 'Payant')).toMatchObject({ value: 2, tone: 'warning' });
  });

  it('merges factual Maison context into the spoken and visible handover', () => {
    const model = buildLivingBriefing(input({ maison: maison() }));

    expect(model.maisonCue).toMatchObject({
      label: 'Journée légère',
      tone: 'calm',
    });
    expect(model.maisonCue?.detail).toContain('Tarte aux légumes');
    expect(model.spokenText).toContain('Le prochain repas prévu est Tarte aux légumes');
  });

  it('prioritizes an explicit due cooking timer without exposing a private label', () => {
    const model = buildLivingBriefing(input({
      maison: maison({
        activeTimers: [{
          id: 'cooking_example',
          label: 'appel personnel',
          dueAt: new Date(NOW - 1_000).toISOString(),
          state: 'due',
          remainingMs: 0,
        }],
        foodProfile: { configured: true, constraintCount: 2, unknownCount: 1 },
      }),
    }));

    expect(model.maisonCue).toMatchObject({ label: 'Un minuteur est terminé', tone: 'warning' });
    expect(model.maisonCue?.detail).toContain('1 contrainte alimentaire reste à confirmer');
    expect(model.spokenText).not.toContain('appel personnel');
  });

  it('does not reintroduce private food metadata beside a due timer in guest mode', () => {
    const guestPayload = maison({
      activeTimers: [{
        id: 'cooking_guest',
        label: 'Minuteur 1',
        dueAt: new Date(NOW - 1_000).toISOString(),
        state: 'due',
        remainingMs: 0,
      }],
      foodProfile: { configured: true, constraintCount: 4, unknownCount: 3 },
    });
    guestPayload.snapshot.mode = 'guests';
    guestPayload.snapshot.nextMeal = {
      title: 'Menu diabète avant rendez-vous Dr X',
      whenLabel: 'Déjeuner · 13:00',
      state: 'planned',
    };

    const model = buildLivingBriefing(input({ maison: guestPayload }));

    expect(model.maisonCue).toMatchObject({ label: 'Un minuteur est terminé', tone: 'warning' });
    expect(model.maisonCue?.detail).not.toMatch(/contrainte|diabète|13:00/i);
    expect(model.spokenText).not.toMatch(/contrainte|diabète|13:00/i);
  });
});
