import { mkdtemp, readFile, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  formatCompanionPerceptStats,
  formatCompanionPercepts,
  getCompanionPerceptStats,
  getCompanionPerceptsPath,
  readRecentCompanionPercepts,
  recordCompanionPercept,
} from '../src/companion/percepts.js';

describe('companion percept store', () => {
  let tempDir: string;
  let encryptionKeyBackup: string | undefined;
  let memoryKeyBackup: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-percepts-'));
    encryptionKeyBackup = process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    memoryKeyBackup = process.env.CODEBUDDY_COMPANION_MEMORY_KEY;
    delete process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    delete process.env.CODEBUDDY_COMPANION_MEMORY_KEY;
  });

  afterEach(async () => {
    if (encryptionKeyBackup !== undefined) {
      process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY = encryptionKeyBackup;
    } else {
      delete process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    }
    if (memoryKeyBackup !== undefined) {
      process.env.CODEBUDDY_COMPANION_MEMORY_KEY = memoryKeyBackup;
    } else {
      delete process.env.CODEBUDDY_COMPANION_MEMORY_KEY;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('records percepts as local workspace jsonl and returns newest first', async () => {
    const first = await recordCompanionPercept({
      modality: 'vision',
      source: 'camera_snapshot',
      summary: 'Captured the desk',
      payload: { path: 'desk.png' },
      tags: ['camera', 'camera', 'vision'],
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00Z'),
    });
    const second = await recordCompanionPercept({
      modality: 'hearing',
      source: 'voice_loop',
      summary: 'Heard a user instruction',
      confidence: 0.8,
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:01:00Z'),
    });

    expect(first.id).toContain('percept-20260524100000');
    expect(getCompanionPerceptsPath(tempDir)).toBe(path.join(tempDir, '.codebuddy', 'companion', 'percepts.jsonl'));

    const recent = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(recent.map(percept => percept.id)).toEqual([second.id, first.id]);
    expect(recent[1].tags).toEqual(['camera', 'vision']);
  });

  it('filters recent percepts by modality and reports stats', async () => {
    await recordCompanionPercept({
      modality: 'vision',
      source: 'camera_snapshot',
      summary: 'Frame one',
    }, { cwd: tempDir });
    await recordCompanionPercept({
      modality: 'screen',
      source: 'screen_share',
      summary: 'Screen one',
    }, { cwd: tempDir });

    const recentVision = await readRecentCompanionPercepts({ cwd: tempDir, modality: 'vision' });
    expect(recentVision).toHaveLength(1);
    expect(recentVision[0].summary).toBe('Frame one');

    const stats = await getCompanionPerceptStats({ cwd: tempDir });
    expect(stats.total).toBe(2);
    expect(stats.byModality).toEqual({ vision: 1, screen: 1 });
    expect(formatCompanionPerceptStats(stats)).toContain('By modality:');
    expect(formatCompanionPercepts(recentVision)).toContain('vision/camera_snapshot');
  });

  it('reports voice loop latency and capture quality stats from real percept journal data', async () => {
    await recordCompanionPercept({
      modality: 'hearing',
      source: 'sensory_speech_reaction',
      summary: 'Heard a fast turn',
      payload: {
        latency: {
          sttMs: 420,
          totalMs: 900,
          decisionMs: 30,
          actionMs: 120,
          firstAudioMs: 90,
          perceivedResponseMs: 540,
          voiceTotalMs: 120,
          eventToSttStartMs: 45,
        },
        capture: {
          device: 'hw:Webcam,0',
          ms: 1200,
          writeMs: 28,
          peakRms: 0.12,
          avgRms: 0.05,
          rmsOn: 0.04,
        },
        responseMode: 'streamed',
      },
      tags: ['speech', 'stt', 'latency'],
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:00:00Z'),
    });
    await recordCompanionPercept({
      modality: 'hearing',
      source: 'sensory_speech_reaction',
      summary: 'Heard a slow turn',
      payload: {
        latency: {
          sttMs: 3_100,
          totalMs: 6_200,
          decisionMs: 80,
          actionMs: 1_900,
          firstAudioMs: 1_200,
          perceivedResponseMs: 4_380,
          voiceTotalMs: 1_900,
          eventToSttStartMs: 75,
        },
        capture: {
          device: 'hw:Webcam,0',
          ms: 1400,
          writeMs: 31,
          peakRms: 0.05,
          avgRms: 0.025,
          rmsOn: 0.04,
        },
        responseMode: 'blocking',
      },
      tags: ['speech', 'stt', 'latency'],
    }, {
      cwd: tempDir,
      now: new Date('2026-05-24T10:01:00Z'),
    });

    const raw = await readFile(getCompanionPerceptsPath(tempDir), 'utf8');
    expect(raw.trim().split(/\r?\n/)).toHaveLength(2);

    const stats = await getCompanionPerceptStats({ cwd: tempDir });
    expect(stats.voice?.hearingCount).toBe(2);
    expect(stats.voice?.latency.sttMs?.p50).toBe(420);
    expect(stats.voice?.latency.sttMs?.p95).toBe(3100);
    expect(stats.voice?.latency.totalMs?.p95).toBe(6200);
    expect(stats.voice?.latency.firstAudioMs?.p50).toBe(90);
    expect(stats.voice?.latency.perceivedResponseMs?.p95).toBe(4380);
    expect(stats.voice?.latest?.responseMode).toBe('blocking');
    expect(stats.voice?.capture.signalMargin?.min).toBeCloseTo(1.25, 2);
    expect(stats.voice?.health.slowSttCount).toBe(1);
    expect(stats.voice?.health.slowLoopCount).toBe(1);
    expect(stats.voice?.health.weakSignalCount).toBe(1);

    const formatted = formatCompanionPerceptStats(stats);
    expect(formatted).toContain('Voice loop');
    expect(formatted).toContain('p95=3100ms');
    expect(formatted).toContain('perceived response');
    expect(formatted).toContain('mode=blocking');
    expect(formatted).toContain('weakSignal=1');
    expect(formatted).toContain('device=hw:Webcam,0');
  });

  it('returns empty state for a workspace with no percept journal', async () => {
    await expect(readRecentCompanionPercepts({ cwd: tempDir })).resolves.toEqual([]);

    const stats = await getCompanionPerceptStats({ cwd: tempDir });
    expect(stats.exists).toBe(false);
    expect(stats.total).toBe(0);
    expect(formatCompanionPercepts([])).toContain('No companion percepts');
  });

  it('optionally encrypts percept summaries and payloads at rest', async () => {
    process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY = 'local-test-key';
    await recordCompanionPercept({
      modality: 'memory',
      source: 'privacy-test',
      summary: 'Remember the private phrase',
      payload: { secret: 'rose quartz' },
      tags: ['privacy'],
    }, { cwd: tempDir, now: new Date('2026-05-24T10:02:00Z') });

    const raw = await readFile(getCompanionPerceptsPath(tempDir), 'utf8');
    expect(raw).not.toContain('Remember the private phrase');
    expect(raw).not.toContain('rose quartz');
    expect(raw).toContain('"__encrypted":true');

    const decrypted = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(decrypted[0]).toMatchObject({
      summary: 'Remember the private phrase',
      payload: { secret: 'rose quartz' },
    });

    delete process.env.CODEBUDDY_COMPANION_ENCRYPTION_KEY;
    const locked = await readRecentCompanionPercepts({ cwd: tempDir });
    expect(locked[0].summary).toContain('key unavailable');
    expect(locked[0].payload).toMatchObject({ encrypted: true });
  });
});
