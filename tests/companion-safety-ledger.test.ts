import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  formatCompanionSafetyEvents,
  formatCompanionSafetyLedgerStats,
  getCompanionSafetyLedgerPath,
  getCompanionSafetyLedgerStats,
  readRecentCompanionSafetyEvents,
  recordCompanionSafetyEvent,
} from '../src/companion/safety-ledger.js';

describe('companion safety ledger', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-safety-ledger-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('records append-only safety events in the workspace', async () => {
    const event = await recordCompanionSafetyEvent({
      kind: 'sense',
      risk: 'medium',
      action: 'camera_snapshot',
      reason: 'Captured an explicit camera frame.',
      source: 'camera_snapshot',
      artifactPath: path.join(tempDir, 'scene.png'),
      payload: { device: 'test' },
      tags: ['camera', 'vision'],
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(event.id).toContain('safety-20260524100000000');
    expect(event.cwd).toBe(tempDir);
    expect(event.status).toBe('completed');

    const recent = await readRecentCompanionSafetyEvents({ cwd: tempDir });
    expect(recent[0]).toMatchObject({
      id: event.id,
      kind: 'sense',
      risk: 'medium',
      action: 'camera_snapshot',
    });
  });

  it('filters recent events and reports stats', async () => {
    await recordCompanionSafetyEvent({
      kind: 'mission',
      action: 'mission_status_update',
      reason: 'Mission started.',
      source: 'companion_mission_board',
      missionId: 'mission-1',
    }, { cwd: tempDir, now: new Date('2026-05-24T10:00:00.000Z') });
    await recordCompanionSafetyEvent({
      kind: 'sense',
      risk: 'medium',
      action: 'camera_snapshot',
      reason: 'Frame captured.',
      source: 'camera_snapshot',
    }, { cwd: tempDir, now: new Date('2026-05-24T10:01:00.000Z') });

    const missionEvents = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'mission' });
    expect(missionEvents).toHaveLength(1);
    expect(missionEvents[0]?.missionId).toBe('mission-1');

    const stats = await getCompanionSafetyLedgerStats({ cwd: tempDir });
    expect(stats).toMatchObject({
      ledgerPath: getCompanionSafetyLedgerPath(tempDir),
      exists: true,
      total: 2,
      byKind: { mission: 1, sense: 1 },
      byRisk: { low: 1, medium: 1 },
      byStatus: { completed: 2 },
    });
  });

  it('formats empty and populated ledger output', async () => {
    expect(formatCompanionSafetyEvents([])).toContain('No companion safety events');

    const event = await recordCompanionSafetyEvent({
      kind: 'tool',
      action: 'mission_runner',
      reason: 'Prepared a brief.',
      source: 'companion_mission_runner',
    }, { cwd: tempDir });

    expect(formatCompanionSafetyEvents([event])).toContain('mission_runner');
    expect(formatCompanionSafetyLedgerStats(await getCompanionSafetyLedgerStats({ cwd: tempDir })))
      .toContain('Companion Safety Ledger');
  });
});
