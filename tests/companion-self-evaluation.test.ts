import {
  evaluateCompanionSelf,
  formatCompanionSelfEvaluation,
} from '../src/companion/self-evaluation.js';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCompanionStatus: vi.fn(),
  readRecentCompanionPercepts: vi.fn(),
  recordCompanionPercept: vi.fn(),
}));

jest.mock('../src/companion/companion-mode.js', () => ({
  getCompanionStatus: mocks.getCompanionStatus,
}));

jest.mock('../src/companion/percepts.js', () => ({
  readRecentCompanionPercepts: mocks.readRecentCompanionPercepts,
  recordCompanionPercept: mocks.recordCompanionPercept,
}));

function stats(overrides = {}) {
  return {
    storePath: '/repo/.codebuddy/companion/percepts.jsonl',
    exists: true,
    total: 4,
    byModality: {
      vision: 1,
      hearing: 1,
      screen: 1,
      self: 1,
    },
    latestTimestamp: '2026-05-24T10:00:00.000Z',
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

describe('companion self-evaluation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocks.getCompanionStatus.mockResolvedValue(status());
    mocks.readRecentCompanionPercepts.mockResolvedValue([]);
    mocks.recordCompanionPercept.mockResolvedValue({ id: 'p1' });
  });

  it('scores a fully wired companion as collaborative', async () => {
    const evaluation = await evaluateCompanionSelf({
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    });

    expect(evaluation.id).toBe('companion-eval-20260524100000000');
    expect(evaluation.score).toBe(100);
    expect(evaluation.level).toBe('collaborative');
    expect(evaluation.strengths).toContain('Identite compagnon installee et chargee.');
    expect(evaluation.findings.some(finding => finding.id === 'safety-explicit-permission')).toBe(true);
    expect(mocks.recordCompanionPercept).not.toHaveBeenCalled();
  });

  it('turns missing senses into concrete next actions', async () => {
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
      camera: {
        available: false,
        ffmpegAvailable: false,
        platform: 'linux',
        reason: 'ffmpeg missing',
      },
      wakeWord: {
        available: true,
        engine: 'text-match',
        wakeWords: ['buddy'],
        picovoiceAccessKeyPresent: false,
      },
      percepts: stats({ exists: false, total: 0, byModality: {} }),
    }));

    const evaluation = await evaluateCompanionSelf({ recordSuggestions: false });

    expect(evaluation.score).toBeLessThan(30);
    expect(evaluation.level).toBe('dormant');
    expect(evaluation.nextActions[0]).toContain('buddy login');
    expect(evaluation.findings.map(finding => finding.id)).toEqual(expect.arrayContaining([
      'brain-chatgpt-login',
      'identity-companion-files',
      'voice-input-loop',
      'percept-journal-empty',
    ]));
  });

  it('records self-evaluation and top suggestions by default', async () => {
    mocks.getCompanionStatus.mockResolvedValue(status({
      chatGptCredentialsPresent: false,
      percepts: stats({ exists: false, total: 0, byModality: {} }),
    }));

    const evaluation = await evaluateCompanionSelf();

    expect(evaluation.findings.length).toBeGreaterThan(3);
    expect(mocks.recordCompanionPercept).toHaveBeenCalledTimes(4);
    expect(mocks.recordCompanionPercept).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ modality: 'self', source: 'companion_self_evaluation' }),
      { cwd: '/repo' },
    );
    expect(mocks.recordCompanionPercept).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ modality: 'suggestion' }),
      { cwd: '/repo' },
    );
  });

  it('formats the evaluation for CLI and slash output', async () => {
    const output = formatCompanionSelfEvaluation(await evaluateCompanionSelf({ recordSuggestions: false }));

    expect(output).toContain('Buddy Companion Self-Evaluation');
    expect(output).toContain('Score: 100/100 (collaborative)');
    expect(output).toContain('Strengths:');
    expect(output).toContain('Findings:');
  });
});
