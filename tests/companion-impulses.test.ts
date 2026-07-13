import {
  buildCompanionImpulseBrief,
  formatCompanionImpulseBrief,
} from '../src/companion/impulses.js';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCompanionStatus: vi.fn(),
  readRecentCompanionPercepts: vi.fn(),
  recordCompanionPercept: vi.fn(),
  readCompanionMissionBoard: vi.fn(),
  getCompanionSafetyLedgerStats: vi.fn(),
  readRecentCompanionSafetyEvents: vi.fn(),
}));

jest.mock('../src/companion/companion-mode.js', () => ({
  getCompanionStatus: mocks.getCompanionStatus,
}));

jest.mock('../src/companion/percepts.js', () => ({
  readRecentCompanionPercepts: mocks.readRecentCompanionPercepts,
  recordCompanionPercept: mocks.recordCompanionPercept,
}));

jest.mock('../src/companion/mission-board.js', () => ({
  readCompanionMissionBoard: mocks.readCompanionMissionBoard,
}));

jest.mock('../src/companion/safety-ledger.js', () => ({
  getCompanionSafetyLedgerStats: mocks.getCompanionSafetyLedgerStats,
  readRecentCompanionSafetyEvents: mocks.readRecentCompanionSafetyEvents,
}));

function stats(overrides = {}) {
  return {
    storePath: '/repo/.codebuddy/companion/percepts.jsonl',
    exists: true,
    total: 4,
    byModality: {
      vision: 1,
      hearing: 1,
      self: 1,
      suggestion: 1,
    },
    latestTimestamp: '2026-05-24T09:00:00.000Z',
    ...overrides,
  };
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    cwd: '/repo',
    authPath: '/home/test/.codebuddy/codex-auth.json',
    chatGptCredentialsPresent: true,
    model: 'gpt-5.5',
    identity: {
      soulLoaded: true,
      soulSource: 'project',
      soulIsCompanion: true,
      bootLoaded: true,
      bootSource: 'project',
      bootIsCompanion: true,
    },
    voice: {
      enabled: true,
      available: true,
      provider: 'whisper-local',
      language: 'fr',
      autoSend: true,
    },
    wakeWord: {
      available: true,
      engine: 'porcupine',
      wakeWords: ['buddy'],
      picovoiceAccessKeyPresent: true,
    },
    tts: {
      enabled: true,
      available: true,
      provider: 'edge-tts',
      voice: 'fr-FR-HenriNeural',
      autoSpeak: true,
    },
    camera: {
      available: true,
      ffmpegAvailable: true,
      platform: 'linux',
    },
    percepts: stats(),
    ...overrides,
  };
}

describe('companion impulses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocks.getCompanionStatus.mockResolvedValue(status());
    mocks.readRecentCompanionPercepts.mockResolvedValue([
      { id: 'vision-1', modality: 'vision', timestamp: '2026-05-24T09:00:00.000Z', source: 'camera', confidence: 1, summary: '', payload: {}, tags: [] },
      { id: 'hearing-1', modality: 'hearing', timestamp: '2026-05-24T09:10:00.000Z', source: 'voice', confidence: 1, summary: '', payload: {}, tags: [] },
      { id: 'self-1', modality: 'self', timestamp: '2026-05-24T09:20:00.000Z', source: 'self', confidence: 1, summary: '', payload: {}, tags: [] },
    ]);
    mocks.readCompanionMissionBoard.mockResolvedValue({ missions: [] });
    mocks.getCompanionSafetyLedgerStats.mockResolvedValue({
      ledgerPath: '/repo/.codebuddy/companion/safety-ledger.jsonl',
      exists: true,
      total: 0,
      byKind: {},
      byRisk: {},
      byStatus: {},
    });
    mocks.readRecentCompanionSafetyEvents.mockResolvedValue([]);
    mocks.recordCompanionPercept.mockResolvedValue({ id: 'percept-1' });
  });

  it('builds readiness and bootstrap impulses for an unwired companion', async () => {
    mocks.getCompanionStatus.mockResolvedValue(status({
      chatGptCredentialsPresent: false,
      identity: {
        soulLoaded: false,
        soulIsCompanion: false,
        bootLoaded: false,
        bootIsCompanion: false,
      },
      voice: {
        enabled: false,
        available: false,
        provider: 'system',
        reason: 'microphone unavailable',
      },
      tts: {
        enabled: false,
        available: false,
        provider: 'edge-tts',
        reason: 'edge-tts missing',
      },
      percepts: stats({ exists: false, total: 0, byModality: {} }),
    }));
    mocks.readRecentCompanionPercepts.mockResolvedValue([]);

    const brief = await buildCompanionImpulseBrief({
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    });

    expect(brief.summary).toContain('companion impulse');
    expect(brief.impulses.map(impulse => impulse.id)).toEqual(expect.arrayContaining([
      'readiness-connect-chatgpt-brain',
      'readiness-install-companion-identity',
      'memory-start-sensory-journal',
    ]));
    expect(brief.impulses[0].priority).toBe('high');
    expect(brief.nextPrompt).toContain('Patrice');
    expect(mocks.recordCompanionPercept).not.toHaveBeenCalled();
  });

  it('promotes an active P0 mission as the next useful move', async () => {
    mocks.readCompanionMissionBoard.mockResolvedValue({
      missions: [
        {
          id: 'mission-companion-ui-cards',
          title: 'ui: typed cards',
          dimension: 'ui',
          status: 'open',
          priority: 'P1',
          summary: '',
          recommendation: '',
          sourceGapId: 'g1',
          competitorRefs: [],
          tags: ['ui'],
          createdAt: '2026-05-24T08:00:00.000Z',
          updatedAt: '2026-05-24T08:00:00.000Z',
        },
        {
          id: 'mission-companion-cross-channel-gateway',
          title: 'channels: companion gateway',
          dimension: 'channels',
          status: 'in_progress',
          priority: 'P0',
          summary: '',
          recommendation: '',
          sourceGapId: 'g2',
          competitorRefs: [],
          tags: ['channels'],
          createdAt: '2026-05-24T08:00:00.000Z',
          updatedAt: '2026-05-24T08:30:00.000Z',
        },
      ],
    });

    const brief = await buildCompanionImpulseBrief({
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    });

    expect(brief.impulses[0]).toMatchObject({
      kind: 'mission',
      priority: 'high',
      command: 'buddy companion missions run-next',
    });
    expect(brief.context.openMissions).toBe(1);
    expect(brief.context.inProgressMissions).toBe(1);
  });

  it('raises a voice latency impulse from recent hearing metrics', async () => {
    mocks.readRecentCompanionPercepts.mockResolvedValue([
      { id: 'vision-1', modality: 'vision', timestamp: '2026-05-24T09:00:00.000Z', source: 'camera', confidence: 1, summary: '', payload: {}, tags: [] },
      {
        id: 'hearing-1',
        modality: 'hearing',
        timestamp: '2026-05-24T09:10:00.000Z',
        source: 'voice',
        confidence: 1,
        summary: 'heard: bonjour buddy',
        payload: {
          latency: {
            sttMs: 3_200,
            decisionMs: 40,
            actionMs: 3_160,
            firstAudioMs: 260,
            perceivedResponseMs: 3_500,
            voiceTotalMs: 3_160,
            totalMs: 6_400,
          },
          capture: {
            device: 'plughw:CARD=BRIO,DEV=0',
            ms: 1_100,
            writeMs: 8,
            sampleRate: 16_000,
          },
        },
        tags: ['speech', 'stt', 'latency'],
      },
      { id: 'self-1', modality: 'self', timestamp: '2026-05-24T09:20:00.000Z', source: 'self', confidence: 1, summary: '', payload: {}, tags: [] },
    ]);

    const brief = await buildCompanionImpulseBrief({
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    });

    const latencyImpulse = brief.impulses.find(impulse => impulse.id === 'sense-reduce-voice-latency');
    expect(latencyImpulse).toMatchObject({
      kind: 'sense',
      priority: 'medium',
      command: 'buddy companion percepts recent --limit 5 --modality hearing',
    });
    expect(latencyImpulse?.tags).toEqual(expect.arrayContaining(['voice', 'latency', 'realtime']));
    expect(latencyImpulse?.evidence).toEqual(expect.arrayContaining([
      { label: 'stt', value: '3200ms' },
      { label: 'first audio', value: '260ms' },
      { label: 'perceived response', value: '3500ms' },
      { label: 'loop', value: '6400ms' },
      { label: 'device', value: 'plughw:CARD=BRIO,DEV=0' },
    ]));
  });

  it('raises a voice capture quality impulse from weak RMS margins', async () => {
    mocks.readRecentCompanionPercepts.mockResolvedValue([
      {
        id: 'hearing-1',
        modality: 'hearing',
        timestamp: '2026-05-24T09:10:00.000Z',
        source: 'voice',
        confidence: 1,
        summary: 'heard: buddy',
        payload: {
          latency: {
            sttMs: 300,
            totalMs: 500,
          },
          capture: {
            device: 'default',
            peakRms: 0.024,
            avgRms: 0.014,
            rmsOn: 0.02,
            rmsOff: 0.012,
            sampleRate: 16_000,
          },
        },
        tags: ['speech', 'stt', 'latency'],
      },
      { id: 'self-1', modality: 'self', timestamp: '2026-05-24T09:20:00.000Z', source: 'self', confidence: 1, summary: '', payload: {}, tags: [] },
    ]);

    const brief = await buildCompanionImpulseBrief({
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    });

    const captureImpulse = brief.impulses.find(impulse => impulse.id === 'sense-improve-voice-capture');
    expect(captureImpulse).toMatchObject({
      kind: 'sense',
      priority: 'medium',
      command: 'buddy companion percepts recent --limit 5 --modality hearing',
    });
    expect(captureImpulse?.tags).toEqual(expect.arrayContaining(['voice', 'capture', 'quality']));
    expect(captureImpulse?.evidence).toEqual(expect.arrayContaining([
      { label: 'peak rms', value: '0.0240' },
      { label: 'avg rms', value: '0.0140' },
      { label: 'vad on', value: '0.0200' },
    ]));
  });

  it('records top impulses as suggestion percepts by default', async () => {
    mocks.readRecentCompanionPercepts.mockResolvedValue([]);

    const brief = await buildCompanionImpulseBrief({
      now: new Date('2026-05-24T10:00:00.000Z'),
    });

    expect(brief.impulses.length).toBeGreaterThan(0);
    expect(mocks.recordCompanionPercept).toHaveBeenCalled();
    expect(mocks.recordCompanionPercept).toHaveBeenCalledWith(
      expect.objectContaining({
        modality: 'suggestion',
        source: 'companion_impulses',
        tags: expect.arrayContaining(['impulse', 'proactive']),
      }),
      { cwd: '/repo' },
    );
  });

  it('formats a brief for CLI and slash output', async () => {
    mocks.readRecentCompanionPercepts.mockResolvedValue([]);

    const output = formatCompanionImpulseBrief(await buildCompanionImpulseBrief({
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    }));

    expect(output).toContain('Buddy Companion Impulses');
    expect(output).toContain('Next prompt:');
    expect(output).toContain('Impulses:');
  });
});
