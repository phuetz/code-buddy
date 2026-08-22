import { mkdtemp, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  formatCompanionMissionBoard,
  readCompanionMissionBoard,
  syncCompanionMissionBoard,
  updateCompanionMissionStatus,
} from '../src/companion/mission-board.js';
import { readRecentCompanionSafetyEvents } from '../src/companion/safety-ledger.js';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildCompanionCompetitiveRadar: vi.fn(),
  recordCompanionPercept: vi.fn(),
}));

jest.mock('../src/companion/competitive-radar.js', () => ({
  buildCompanionCompetitiveRadar: mocks.buildCompanionCompetitiveRadar,
}));

jest.mock('../src/companion/percepts.js', () => ({
  recordCompanionPercept: mocks.recordCompanionPercept,
}));

function radar() {
  return {
    id: 'companion-radar-1',
    timestamp: '2026-05-24T10:00:00.000Z',
    cwd: '/repo',
    score: 70,
    comparedAgainst: [],
    currentStrengths: [],
    nextMoves: [],
    sourceNotes: [],
    selfEvaluation: { score: 70, level: 'aware', findings: [], nextActions: [] },
    gaps: [
      {
        id: 'companion-cross-channel-gateway',
        dimension: 'channels',
        severity: 'gap',
        summary: 'Buddy needs a channel gateway.',
        recommendation: 'Build the channel gateway.',
        competitorRefs: ['hermes-agent', 'openclaw'],
        tags: ['channels'],
      },
      {
        id: 'companion-ui-cards',
        dimension: 'ui',
        severity: 'gap',
        summary: 'Buddy needs UI cards.',
        recommendation: 'Build companion UI cards.',
        competitorRefs: ['uni', 'lisa'],
        tags: ['ui'],
      },
      {
        id: 'companion-safety-ledger',
        dimension: 'safety',
        severity: 'parity',
        summary: 'Ledger is parity.',
        recommendation: 'Keep improving safety.',
        competitorRefs: ['openclaw'],
        tags: ['safety'],
      },
    ],
  };
}

describe('companion mission board', () => {
  let tempDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-companion-missions-'));
    mocks.buildCompanionCompetitiveRadar.mockResolvedValue(radar());
    mocks.recordCompanionPercept.mockResolvedValue({ id: 'percept-1' });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('syncs gap missions from the competitive radar', async () => {
    const result = await syncCompanionMissionBoard({
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.board.missions).toHaveLength(2);
    expect(result.board.missions[0]).toMatchObject({
      id: 'mission-companion-cross-channel-gateway',
      priority: 'P0',
      status: 'open',
      recommendation: 'Build the channel gateway.',
    });
    expect(mocks.recordCompanionPercept).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'suggestion',
        source: 'companion_mission_board',
      }),
      { cwd: tempDir },
    );
  });

  it('preserves mission status while refreshing radar metadata', async () => {
    await syncCompanionMissionBoard({ cwd: tempDir, recordSuggestions: false });
    await updateCompanionMissionStatus(
      'mission-companion-cross-channel-gateway',
      'in_progress',
      { cwd: tempDir, recordPercept: false },
    );

    const result = await syncCompanionMissionBoard({ cwd: tempDir, recordSuggestions: false });
    const mission = result.board.missions.find(item => item.id === 'mission-companion-cross-channel-gateway');

    expect(mission?.status).toBe('in_progress');
    expect(result.created).toBe(0);
  });

  it('updates status and completed timestamp', async () => {
    await syncCompanionMissionBoard({ cwd: tempDir, recordSuggestions: false });

    const mission = await updateCompanionMissionStatus(
      'mission-companion-ui-cards',
      'done',
      { cwd: tempDir, now: new Date('2026-05-24T11:00:00.000Z') },
    );

    expect(mission.status).toBe('done');
    expect(mission.completedAt).toBe('2026-05-24T11:00:00.000Z');
    expect(mocks.recordCompanionPercept).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'tool',
        summary: expect.stringContaining('marked done'),
      }),
      { cwd: tempDir },
    );

    const events = await readRecentCompanionSafetyEvents({ cwd: tempDir, kind: 'mission' });
    expect(events[0]).toMatchObject({
      action: 'mission_status_update',
      missionId: 'mission-companion-ui-cards',
      source: 'companion_mission_board',
    });
  });

  it('reads an empty board before sync and formats the board', async () => {
    const empty = await readCompanionMissionBoard({ cwd: tempDir });
    expect(empty.missions).toEqual([]);

    const synced = await syncCompanionMissionBoard({ cwd: tempDir, recordSuggestions: false });
    const output = formatCompanionMissionBoard(synced.board);

    expect(output).toContain('Buddy Companion Mission Board');
    expect(output).toContain('mission-companion-cross-channel-gateway');
    expect(output).toContain('Build companion UI cards.');
  });
});
