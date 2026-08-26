import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  formatCompanionMissionRun,
  runNextCompanionMission,
} from '../src/companion/mission-runner.js';
import {
  getCompanionMissionBoardPath,
  readCompanionMissionBoard,
  type CompanionMission,
  type CompanionMissionBoard,
} from '../src/companion/mission-board.js';
import { readRecentCompanionPercepts } from '../src/companion/percepts.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';

function mission(overrides: Partial<CompanionMission>): CompanionMission {
  const now = '2026-05-24T09:00:00.000Z';
  return {
    id: 'mission-companion-safety-ledger',
    title: 'safety: Buddy needs an auditable ledger',
    dimension: 'safety',
    status: 'open',
    priority: 'P0',
    summary: 'Buddy needs an auditable safety ledger.',
    recommendation: 'Record sensitive companion events in a local ledger.',
    sourceGapId: 'companion-safety-ledger',
    sourceRadarId: 'radar-1',
    competitorRefs: ['openclaw', 'uni'],
    command: 'buddy companion safety stats',
    tags: ['safety', 'companion'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function writeBoard(cwd: string, missions: CompanionMission[]): Promise<void> {
  const storePath = getCompanionMissionBoardPath(cwd);
  const board: CompanionMissionBoard = {
    schemaVersion: 1,
    cwd,
    storePath,
    updatedAt: '2026-05-24T09:00:00.000Z',
    missions,
  };
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
}

describe('companion mission runner', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-mission-runner-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('selects the highest-priority mission, starts it, and writes an executable brief', async () => {
    await writeBoard(tempDir, [
      mission({ id: 'mission-companion-ui-cards', priority: 'P1', dimension: 'ui' }),
      mission({ id: 'mission-companion-safety-ledger', priority: 'P0', dimension: 'safety' }),
    ]);

    const result = await runNextCompanionMission({
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(result.mission?.id).toBe('mission-companion-safety-ledger');
    expect(result.briefPath).toContain(path.join('.codebuddy', 'companion', 'mission-runs'));
    expect(result.perceptId).toContain('percept-');
    expect(result.safetyEventId).toContain('safety-');

    const brief = await readFile(result.briefPath!, 'utf8');
    expect(brief).toContain('# Companion Mission Run');
    expect(brief).toContain('## Verification Checklist');

    const board = await readCompanionMissionBoard({ cwd: tempDir });
    expect(board.missions.find(item => item.id === 'mission-companion-safety-ledger')?.status).toBe('in_progress');

    const percepts = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(percepts.some(percept => percept.source === 'companion_mission_runner')).toBe(true);

    const safety = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'mission' });
    expect(safety.some(event => event.action === 'companion_mission_runner')).toBe(true);
    expect(safety.some(event => event.action === 'mission_status_update')).toBe(true);
  });

  it('dry-runs without changing mission status or writing the brief', async () => {
    await writeBoard(tempDir, [mission({ status: 'open' })]);

    const result = await runNextCompanionMission({
      cwd: tempDir,
      dryRun: true,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.brief).toContain('## Safety Notes');
    expect(formatCompanionMissionRun(result)).toContain('dry run');

    const board = await readCompanionMissionBoard({ cwd: tempDir });
    expect(board.missions[0]?.status).toBe('open');
    expect(await readRecentCompanionPercepts({ cwd: tempDir })).toEqual([]);
    expect(await readRecentCompanionSafetyEvents({ cwd: tempDir })).toEqual([]);
  });

  it('reports a clean empty state when there is no mission to run', async () => {
    const result = await runNextCompanionMission({ cwd: tempDir, dryRun: true });

    expect(result.success).toBe(false);
    expect(result.message).toContain('No companion missions');
  });
});
