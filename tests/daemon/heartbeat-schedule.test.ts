import { describe, expect, it } from 'vitest';
import {
  filterDueHeartbeatChecklist,
  isHeartbeatSectionDue,
} from '../../src/daemon/heartbeat-schedule.js';

describe('heartbeat schedule', () => {
  const mondayMorning = new Date('2026-09-21T07:15:00');
  const mondayEvening = new Date('2026-09-21T19:15:00');

  it('keeps a morning section only in the morning', () => {
    expect(isHeartbeatSectionDue('## Morning briefing\nSend the daily brief.', mondayMorning)).toBe(
      true,
    );
    expect(isHeartbeatSectionDue('## Morning briefing\nSend the daily brief.', mondayEvening)).toBe(
      false,
    );
  });

  it('honours a 5-field cron line', () => {
    expect(isHeartbeatSectionDue('SCHEDULE: 0 7 * * 1\nBrief du lundi.', mondayMorning)).toBe(true);
    expect(isHeartbeatSectionDue('SCHEDULE: 0 7 * * 5\nBrief du vendredi.', mondayMorning)).toBe(
      false,
    );
  });

  it('drops off-schedule sections from a multi-heading checklist', () => {
    const filtered = filterDueHeartbeatChecklist(
      '## Morning\nBrief.\n\n## Evening\nSouffle.',
      mondayMorning,
    );
    expect(filtered).toContain('Brief');
    expect(filtered).not.toContain('Souffle');
  });
});
