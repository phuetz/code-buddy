/** @vitest-environment happy-dom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { speakSpy } = vi.hoisted(() => ({ speakSpy: vi.fn(async () => undefined) }));
vi.mock('../src/renderer/components/VoiceOutputToggle', () => ({ speakText: speakSpy }));

import { LivingBriefing } from '../src/renderer/components/LivingBriefing';
import type { OsAutonomyBriefingPayload } from '../src/shared/autonomy-briefing-ipc';

const artifact: OsAutonomyBriefingPayload = {
  jsonPath: '/tmp/fleet/briefings/latest.json',
  markdownPath: '/tmp/fleet/briefings/latest.md',
  brief: {
    kind: 'codebuddy_autonomy_morning_brief',
    schemaVersion: 1,
    briefingDate: '2026-07-12',
    generatedAt: '2026-07-12T05:00:00.000Z',
    window: { from: '2026-07-11T16:00:00.000Z', to: '2026-07-12T16:00:00.000Z' },
    sourceDir: '/tmp/fleet',
    ledgerPath: '/tmp/fleet/briefings/events.jsonl',
    summary: {
      observedTicks: 12,
      completed: 2,
      failed: 0,
      selfImproved: 1,
      maintenanceChecks: 3,
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
    notableEvents: [{
      schemaVersion: 1,
      at: '2026-07-12T04:00:00.000Z',
      briefingDate: '2026-07-12',
      tickNumber: 8,
      outcome: 'self_improved',
      taskTitle: 'Une voix plus naturelle',
      detail: 'Le chemin local a passé ses gates.',
    }],
    worklog: [],
    opportunities: [{
      kind: 'ready_work',
      title: 'Mesurer la conversation',
      reason: 'Le test est prêt.',
      evidence: 'task voice-bench',
      safeNextStep: 'Lancer uniquement le benchmark local.',
    }],
    guardrails: [],
  },
};

describe('LivingBriefing', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpenMissionControl = vi.fn();
  const showItemInFolder = vi.fn(async () => true);
  const recent = vi.fn(async () => []);

  beforeEach(() => {
    speakSpy.mockClear();
    onOpenMissionControl.mockClear();
    showItemInFolder.mockClear();
    recent.mockClear();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        activity: { recent },
        autonomy: {
          snapshot: vi.fn(async () => ({ ok: true, tasks: [], worklog: [], presence: {} })),
          daemonStatus: vi.fn(async () => ({ ok: true, service: { running: true } })),
        },
        os: { autonomyBriefing: vi.fn(async () => artifact) },
        maison: {
          snapshot: vi.fn(async () => ({
            status: 'ready',
            snapshot: {
              day: { kind: 'weekend' },
              presence: { state: 'present' },
              mode: 'normal',
              provenance: { kind: 'calendar', observedAt: Date.now() },
              nextMeal: { title: 'Tarte aux légumes', whenLabel: 'Dîner · 19:30', state: 'planned' },
            },
            activeTimers: [],
            foodProfile: { configured: true, constraintCount: 1, unknownCount: 0 },
            warnings: [],
          })),
        },
        showItemInFolder,
      },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the probative handover and wires voice, report, and cockpit actions', async () => {
    await act(async () => {
      root.render(<LivingBriefing sessions={[]} onOpenMissionControl={onOpenMissionControl} />);
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('J’ai avancé pendant ton absence');
      expect(container.textContent).toContain('Une voix plus naturelle');
    });
    expect(container.textContent).toContain('Relève probante · 2026-07-12');
    expect(container.querySelector('[data-testid="living-briefing-maison"]')?.textContent)
      .toContain('Tarte aux légumes');
    expect(container.querySelector('[data-testid="living-briefing-details"]')).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="living-briefing-speak"]') as HTMLButtonElement)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(speakSpy).toHaveBeenCalledWith(expect.stringContaining('2 tâches terminées'));
    expect(speakSpy).toHaveBeenCalledWith(expect.stringContaining('Tarte aux légumes'));

    act(() => {
      (container.querySelector('[data-testid="living-briefing-mission-control"]') as HTMLButtonElement)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenMissionControl).toHaveBeenCalledTimes(1);

    await act(async () => {
      (container.querySelector('[data-testid="living-briefing-open-artifact"]') as HTMLButtonElement)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/fleet/briefings/latest.md');

    act(() => {
      window.dispatchEvent(new CustomEvent('codebuddy:maison-updated', {
        detail: {
          status: 'ready',
          snapshot: {
            day: { kind: 'weekend' },
            presence: { state: 'present' },
            mode: 'cooking',
            provenance: { kind: 'calendar', observedAt: Date.now() },
          },
          activeTimers: [{
            id: 'timer-1',
            label: 'Four',
            dueAt: new Date().toISOString(),
            state: 'due',
            remainingMs: 0,
          }],
          foodProfile: { configured: false, constraintCount: 0, unknownCount: 0 },
          warnings: [],
        },
      }));
    });
    expect(container.querySelector('[data-testid="living-briefing-maison"]')?.textContent)
      .toContain('Un minuteur est terminé');
  });
});
