import { vi } from 'vitest';
import {
  buildCompanionCheckIn,
  formatCompanionCheckIn,
} from '../src/companion/check-in.js';

const mocks = vi.hoisted(() => ({
  buildCompanionImpulseBrief: vi.fn(),
  readRecentCompanionPercepts: vi.fn(),
  recordCompanionPercept: vi.fn(),
  createCompanionCard: vi.fn(),
  recordCompanionSafetyEvent: vi.fn(),
}));

jest.mock('../src/companion/impulses.js', () => ({
  buildCompanionImpulseBrief: mocks.buildCompanionImpulseBrief,
}));

jest.mock('../src/companion/percepts.js', () => ({
  readRecentCompanionPercepts: mocks.readRecentCompanionPercepts,
  recordCompanionPercept: mocks.recordCompanionPercept,
}));

jest.mock('../src/companion/cards.js', () => ({
  createCompanionCard: mocks.createCompanionCard,
}));

jest.mock('../src/companion/safety-ledger.js', () => ({
  recordCompanionSafetyEvent: mocks.recordCompanionSafetyEvent,
}));

function brief(overrides: Record<string, unknown> = {}) {
  return {
    id: 'companion-impulses-20260524100000',
    timestamp: '2026-05-24T10:00:00.000Z',
    cwd: '/repo',
    summary: 'Buddy has 1 companion impulse(s): 1 high, 0 medium.',
    nextPrompt: 'Alex, my next useful move is: refresh visual context.',
    impulses: [
      {
        id: 'sense-refresh-visual-context',
        kind: 'sense',
        priority: 'high',
        title: 'Refresh visual context',
        message: 'Take a camera snapshot so Buddy can ground the next exchange.',
        command: 'buddy companion camera snapshot',
        evidence: [{ label: 'last vision', value: 'never' }],
        tags: ['vision', 'camera'],
      },
    ],
    context: {
      perceptTotal: 3,
      openMissions: 1,
      inProgressMissions: 0,
      safetyEvents: 0,
    },
    ...overrides,
  };
}

describe('companion check-in', () => {
  beforeEach(() => {
    vi.stubEnv('CODEBUDDY_USER_NAME', 'Alex');
    jest.clearAllMocks();
    mocks.buildCompanionImpulseBrief.mockResolvedValue(brief());
    mocks.readRecentCompanionPercepts.mockResolvedValue([
      {
        id: 'vision-1',
        modality: 'vision',
        source: 'camera_snapshot',
        timestamp: '2026-05-24T09:00:00.000Z',
        confidence: 1,
        summary: 'Captured camera snapshot',
        payload: {},
        tags: ['camera'],
      },
      {
        id: 'hearing-1',
        modality: 'hearing',
        source: 'cowork_voice_transcribe',
        timestamp: '2026-05-24T09:05:00.000Z',
        confidence: 0.9,
        summary: 'Voice input',
        payload: {},
        tags: ['voice'],
      },
    ]);
    mocks.recordCompanionPercept.mockResolvedValue({ id: 'percept-1' });
    mocks.createCompanionCard.mockResolvedValue({ id: 'card-1' });
    mocks.recordCompanionSafetyEvent.mockResolvedValue({ id: 'safety-1' });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('builds a proactive spoken cue from the top companion impulse', async () => {
    const cue = await buildCompanionCheckIn({
      cwd: '/repo',
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(cue).toMatchObject({
      id: 'companion-check-in-20260524100000',
      mood: 'urgent',
      priority: 'high',
      suggestedCommand: 'buddy companion camera snapshot',
      sourceImpulseId: 'sense-refresh-visual-context',
    });
    expect(cue.spokenText).toContain('Alex, point rapide');
    expect(cue.evidence.map(item => item.label)).toEqual(expect.arrayContaining([
      'latest vision',
      'latest hearing',
      'memory',
    ]));
    expect(mocks.recordCompanionPercept).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'suggestion',
        source: 'companion_check_in',
        tags: expect.arrayContaining(['check-in', 'conversation', 'proactive', 'urgent']),
      }),
      { cwd: '/repo', now: new Date('2026-05-24T10:00:00.000Z') },
    );
    expect(mocks.createCompanionCard).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'status',
        priority: 'high',
        actions: [expect.objectContaining({ command: 'buddy companion camera snapshot' })],
      }),
      { cwd: '/repo', now: new Date('2026-05-24T10:00:00.000Z') },
    );
    expect(mocks.recordCompanionSafetyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'companion_check_in',
        risk: 'medium',
      }),
      { cwd: '/repo', now: new Date('2026-05-24T10:00:00.000Z') },
    );
  });

  it('adapts the spoken tone when the user sounds blocked', async () => {
    const cue = await buildCompanionCheckIn({
      cwd: '/repo',
      userText: 'je suis bloque sur cette partie',
      now: new Date('2026-05-24T10:00:00.000Z'),
      createCard: false,
      recordSafety: false,
    });

    expect(cue.mood).toBe('encouraging');
    expect(cue.spokenText).toContain("Je t'entends");
    expect(cue.spokenText).toContain('On garde les choses simples');
    expect(mocks.createCompanionCard).not.toHaveBeenCalled();
    expect(mocks.recordCompanionSafetyEvent).not.toHaveBeenCalled();
  });

  it('can format and preview without writing companion stores', async () => {
    const cue = await buildCompanionCheckIn({
      cwd: '/repo',
      recordPercept: false,
      createCard: false,
      recordSafety: false,
    });

    expect(cue.percept).toBeUndefined();
    expect(cue.card).toBeUndefined();
    expect(cue.safetyEvent).toBeUndefined();
    expect(mocks.recordCompanionPercept).not.toHaveBeenCalled();
    expect(formatCompanionCheckIn(cue)).toContain('Buddy Companion Check-in');
  });
});
