import { describe, expect, it } from 'vitest';
import { DailyResetManager } from '../../src/daemon/daily-reset.js';

describe('DailyResetManager timezone boundaries', () => {
  it('computes the next reset from the configured IANA wall clock', () => {
    const manager = new DailyResetManager({
      resetHour: 4,
      resetMinute: 0,
      timezone: 'Europe/Paris',
    });

    const delay = manager.msUntilNextReset(new Date('2026-07-12T01:30:00.000Z'));

    expect(delay).toBe(30 * 60_000);
  });

  it('runs at the first valid minute after a nonexistent spring-DST wall time', () => {
    const manager = new DailyResetManager({
      resetHour: 2,
      resetMinute: 30,
      timezone: 'Europe/Paris',
    });

    const delay = manager.msUntilNextReset(new Date('2026-03-29T00:30:00.000Z'));

    expect(delay).toBe(30 * 60_000);
  });

  it('uses the household local date for duplicate protection and summaries', async () => {
    const manager = new DailyResetManager({ timezone: 'Europe/Paris' });
    const messages = [{ role: 'user', content: 'encore le 11 en UTC' }];

    const first = await manager.runReset(
      messages,
      { role: 'system', content: 'system' },
      new Date('2026-07-11T22:30:00.000Z')
    );
    const duplicate = await manager.runReset(
      messages,
      { role: 'system', content: 'system' },
      new Date('2026-07-12T10:00:00.000Z')
    );

    expect(first.summaryMessage).toContain('2026-07-12');
    expect(duplicate.messagesCleared).toBe(0);
  });
});
