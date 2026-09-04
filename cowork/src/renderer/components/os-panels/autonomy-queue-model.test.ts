/**
 * autonomy-queue-model — deterministic summary of the real daemon board:
 * status counts, urgency ordering, presence freshness, worklog recency.
 */
import { describe, expect, it } from 'vitest';
import { relativeLabel, summarizeAutonomyQueue, type AutonomySnapshot } from './autonomy-queue-model.js';

const NOW = new Date('2026-07-06T12:00:00Z');

function snap(partial: Partial<AutonomySnapshot>): AutonomySnapshot {
  return { tasks: [], worklog: [], presence: {}, ...partial };
}

describe('summarizeAutonomyQueue', () => {
  it('counts statuses and orders tasks in_progress > pending-by-priority > completed', () => {
    const summary = summarizeAutonomyQueue(
      snap({
        tasks: [
          { id: 'a', title: 'done low', status: 'completed', priority: 'low' },
          { id: 'b', title: 'waiting high', status: 'pending', priority: 'high' },
          { id: 'c', title: 'running', status: 'in_progress', priority: 'medium', claimedBy: 'hub/fleet' },
          { id: 'd', title: 'waiting medium', status: 'pending', priority: 'medium' },
        ],
      }),
      NOW,
    );
    expect(summary.counts).toEqual({ inProgress: 1, pending: 2, completed: 1 });
    expect(summary.tasks.map((t) => t.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('marks presence fresh within 10 min and sorts fresh agents first', () => {
    const summary = summarizeAutonomyQueue(
      snap({
        presence: {
          stale: { host: 'old/agent', lastSeen: '2026-07-06T10:00:00Z' },
          live: { host: 'hub/fleet', lastSeen: '2026-07-06T11:55:00Z', currentTask: 'self-improvement' },
        },
      }),
      NOW,
    );
    expect(summary.agents.map((a) => a.name)).toEqual(['hub/fleet', 'old/agent']);
    expect(summary.agents[0]).toMatchObject({ fresh: true, currentTask: 'self-improvement', lastSeenLabel: 'il y a 5 min' });
    expect(summary.agents[1]!.fresh).toBe(false);
  });

  it('keeps the newest worklog entries first, skipping empty summaries, capped', () => {
    const summary = summarizeAutonomyQueue(
      snap({
        worklog: [
          { date: '2026-07-06T09:00:00Z', agent: 'a', summary: 'old' },
          { date: '2026-07-06T11:00:00Z', agent: 'b', summary: '' },
          { date: '2026-07-06T11:30:00Z', agent: 'c', summary: 'newest' },
        ],
      }),
      NOW,
      { worklog: 1 },
    );
    expect(summary.worklog).toEqual([{ summary: 'newest', agent: 'c', dateLabel: 'il y a 30 min' }]);
  });
});

describe('relativeLabel', () => {
  it('scales from instant to days and tolerates garbage', () => {
    expect(relativeLabel('2026-07-06T11:59:40Z', NOW)).toBe("à l'instant");
    expect(relativeLabel('2026-07-06T09:00:00Z', NOW)).toBe('il y a 3 h');
    expect(relativeLabel('2026-07-01T12:00:00Z', NOW)).toBe('il y a 5 j');
    expect(relativeLabel('not-a-date', NOW)).toBe('—');
    expect(relativeLabel(undefined, NOW)).toBe('—');
  });
});
