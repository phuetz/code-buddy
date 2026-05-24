import {
  buildCompanionCompetitiveRadar,
  COMPANION_COMPETITORS,
  formatCompanionCompetitiveRadar,
} from '../src/companion/competitive-radar.js';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  evaluateCompanionSelf: vi.fn(),
  recordCompanionPercept: vi.fn(),
}));

jest.mock('../src/companion/self-evaluation.js', () => ({
  evaluateCompanionSelf: mocks.evaluateCompanionSelf,
}));

jest.mock('../src/companion/percepts.js', () => ({
  recordCompanionPercept: mocks.recordCompanionPercept,
}));

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'companion-eval-1',
    timestamp: '2026-05-24T10:00:00.000Z',
    cwd: '/repo',
    score: 76,
    level: 'aware',
    findings: [],
    strengths: [],
    nextActions: [],
    perceptStats: {
      storePath: '/repo/.codebuddy/companion/percepts.jsonl',
      exists: true,
      total: 3,
      byModality: { self: 1, vision: 1, hearing: 1 },
    },
    ...overrides,
  };
}

describe('companion competitive radar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mocks.evaluateCompanionSelf.mockResolvedValue(evaluation());
    mocks.recordCompanionPercept.mockResolvedValue({ id: 'suggestion-1' });
  });

  it('compares Buddy against named competitor profiles', async () => {
    const radar = await buildCompanionCompetitiveRadar({
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    });

    expect(radar.id).toBe('companion-radar-20260524100000000');
    expect(radar.comparedAgainst.map(profile => profile.id)).toEqual([
      'hermes-agent',
      'openclaw',
      'lisa',
      'uni',
    ]);
    expect(radar.gaps.map(gap => gap.id)).toContain('companion-cross-channel-gateway');
    expect(radar.nextMoves.length).toBeGreaterThan(0);
    expect(mocks.evaluateCompanionSelf).toHaveBeenCalledWith({
      cwd: undefined,
      now: new Date('2026-05-24T10:00:00.000Z'),
      recordSuggestions: false,
    });
    expect(mocks.recordCompanionPercept).not.toHaveBeenCalled();
  });

  it('records top competitive gaps as suggestions by default', async () => {
    const radar = await buildCompanionCompetitiveRadar();

    expect(radar.gaps.filter(gap => gap.severity === 'gap').length).toBeGreaterThan(5);
    expect(mocks.recordCompanionPercept).toHaveBeenCalledTimes(5);
    expect(mocks.recordCompanionPercept).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        modality: 'suggestion',
        source: 'companion_competitive_radar',
      }),
      { cwd: '/repo' },
    );
  });

  it('prioritizes ChatGPT login when the self-evaluation reports a brain gap', async () => {
    mocks.evaluateCompanionSelf.mockResolvedValue(evaluation({
      score: 22,
      level: 'dormant',
      findings: [{ id: 'brain-chatgpt-login' }],
    }));

    const radar = await buildCompanionCompetitiveRadar({ recordSuggestions: false });

    expect(radar.gaps[0]?.id).toBe('companion-brain-login');
    expect(radar.nextMoves[0]).toContain('buddy login');
  });

  it('formats competitor evidence and next moves for CLI output', async () => {
    const output = formatCompanionCompetitiveRadar(await buildCompanionCompetitiveRadar({
      recordSuggestions: false,
    }));

    expect(output).toContain('Buddy Companion Competitive Radar');
    expect(output).toContain('Hermes Agent');
    expect(output).toContain('Priority gaps:');
    expect(output).toContain('Sources:');
  });

  it('keeps the competitor catalog source-backed', () => {
    expect(COMPANION_COMPETITORS.every(profile => profile.sourceUrl.startsWith('https://'))).toBe(true);
    expect(COMPANION_COMPETITORS.every(profile => profile.strengths.length > 0)).toBe(true);
  });
});
