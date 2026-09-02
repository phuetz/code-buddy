import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadRelationshipState,
  saveRelationshipState,
  daysBetween,
  pendingMilestone,
  markMilestonesUpTo,
} from '../../src/companion/relationship-state.js';
import { runPresenceTick, resetPresenceState } from '../../src/companion/presence-loop.js';
import { _resetConductorForTests } from '../../src/companion/orchestrator.js';

const DAY = 24 * 60 * 60 * 1000;

describe('relationship-state pure helpers', () => {
  it('daysBetween counts whole days, never negative', () => {
    expect(daysBetween(0, 3 * DAY)).toBe(3);
    expect(daysBetween(0, 3 * DAY - 1)).toBe(2);
    expect(daysBetween(5 * DAY, 0)).toBe(0);
  });

  it('pendingMilestone returns the highest reached, uncelebrated mark (or null)', () => {
    expect(pendingMilestone(3, [])).toBeNull(); // before the first mark
    expect(pendingMilestone(7, [])).toBe(7);
    expect(pendingMilestone(150, [])).toBe(100); // highest reached, not a belated 7
    expect(pendingMilestone(30, [7, 30])).toBeNull(); // already celebrated
    expect(pendingMilestone(400, [7, 30, 100, 200, 365])).toBeNull();
  });

  it('markMilestonesUpTo clears the whole backlog so old marks never fire late', () => {
    expect(markMilestonesUpTo([], 100)).toEqual([7, 30, 100]);
    expect(markMilestonesUpTo([7], 30)).toEqual([7, 30]);
    expect(markMilestonesUpTo([7, 30], 5)).toEqual([7, 30]); // nothing new reached
  });

  it('load/save round-trips and treats a missing file as empty defaults', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rel-'));
    const p = path.join(dir, 's.json');
    try {
      expect(loadRelationshipState(p)).toEqual({ celebratedMilestones: [] }); // missing → default
      saveRelationshipState({ firstSeenAt: 111, lastPresentAt: 222, celebratedMilestones: [7] }, p);
      expect(loadRelationshipState(p)).toEqual({ firstSeenAt: 111, lastPresentAt: 222, celebratedMilestones: [7] });
      if (process.platform !== 'win32') {
        expect(statSync(p).mode & 0o777).toBe(0o600);
        expect(statSync(dir).mode & 0o077).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('does not treat a corrupt relationship store as empty defaults (jumeau D1)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rel-bad-'));
    const p = path.join(dir, 's.json');
    try {
      writeFileSync(p, '{this is not json');
      expect(() => loadRelationshipState(p)).toThrow();
      writeFileSync(p, '[]');
      expect(() => loadRelationshipState(p)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe('relationship presence moments (via the tick)', () => {
  const NOW = new Date('2026-06-26T14:00:00'); // afternoon, present, not quiet
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    resetPresenceState();
    _resetConductorForTests(); // fresh conductor floor each test (singleton uses real time)
    process.env.CODEBUDDY_COMPANION_PRESENCE = 'true';
    dir = mkdtempSync(path.join(os.tmpdir(), 'rel-tick-'));
    statePath = path.join(dir, 'relationship-state.json');
  });
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PRESENCE;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('greets a return after a real absence (reunion), opening the window', async () => {
    saveRelationshipState(
      { firstSeenAt: NOW.getTime() - 10 * DAY, lastPresentAt: NOW.getTime() - 3 * DAY, celebratedMilestones: [7] },
      statePath,
    );
    const say = vi.fn(async () => {});
    const onEngage = vi.fn();
    const line = await runPresenceTick({
      say,
      onEngage,
      now: () => NOW,
      isPersonPresent: () => true,
      inConversation: () => false,
      recentHearing: async () => [],
      relationshipStatePath: statePath,
    });
    expect(line).toMatch(/revoilà|faisait|3 jours/i);
    expect(onEngage).toHaveBeenCalledTimes(1);
    // The sighting was recorded, so the gap is reset.
    expect(loadRelationshipState(statePath).lastPresentAt).toBe(NOW.getTime());
  });

  it('celebrates a tenure milestone once, then records it so it never repeats', async () => {
    saveRelationshipState(
      { firstSeenAt: NOW.getTime() - 30 * DAY, lastPresentAt: NOW.getTime(), celebratedMilestones: [7] },
      statePath,
    );
    const say = vi.fn(async () => {});
    const line = await runPresenceTick({
      say,
      now: () => NOW,
      isPersonPresent: () => true,
      inConversation: () => false,
      recentHearing: async () => [],
      relationshipStatePath: statePath,
    });
    expect(line).toMatch(/30 jours/);
    expect(loadRelationshipState(statePath).celebratedMilestones).toContain(30);
  });

  it('stays silent on a continuous presence with no milestone due', async () => {
    saveRelationshipState(
      { firstSeenAt: NOW.getTime() - 12 * DAY, lastPresentAt: NOW.getTime() - 60_000, celebratedMilestones: [7] },
      statePath,
    );
    const say = vi.fn(async () => {});
    const line = await runPresenceTick({
      say,
      now: () => NOW,
      isPersonPresent: () => true,
      inConversation: () => false,
      recentHearing: async () => [],
      projectThread: async () => null,
      relationshipStatePath: statePath,
    });
    expect(line).toBeNull(); // no reunion (seen 1 min ago), no milestone (12 days, 7 done, 30 not reached)
    expect(say).not.toHaveBeenCalled();
  });
});
