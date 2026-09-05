import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { consolidate, runDreamingPass, promoteSalientDream } from '../../src/sensory/dreaming.js';
import { getSensoryMemory } from '../../src/sensory/sensory-memory.js';
import { getMemoryManager, resetMemoryManagerForTests } from '../../src/memory/persistent-memory.js';
import type { Perception } from '../../src/sensory/reactions.js';
import { logger } from '../../src/utils/logger.js';

describe('dreaming — consolidation', () => {
  it('consolidates a window (counts, salient, avg load, span on receivedAt)', () => {
    const window: Perception[] = [
      { modality: 'vital', kind: 'heartbeat', salience: 5, receivedAt: 1000, tsMs: 99, payload: { load1: 0.4 } },
      { modality: 'vital', kind: 'heartbeat', salience: 5, receivedAt: 1200, tsMs: 88, payload: { load1: 0.6 } },
      { modality: 'audio', kind: 'speech_start', salience: 200, receivedAt: 1100, tsMs: 7, payload: {} },
    ];
    const d = consolidate(window, 9999);
    expect(d.total).toBe(3);
    expect(d.byKind['vital/heartbeat']).toBe(2);
    expect(d.byKind['audio/speech_start']).toBe(1);
    expect(d.salient).toHaveLength(1); // only speech is salient
    expect(d.salient[0]!.kind).toBe('speech_start');
    expect(d.avgLoad).toBeCloseTo(0.5);
    // Window from the consistent ingest clock (receivedAt), not the mixed tsMs.
    expect(d.windowStartMs).toBe(1000);
    expect(d.windowEndMs).toBe(1200);
  });

  it('a dreaming pass drains short-term memory, writes a dream, and promotes a salient dream', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dream-'));
    const mem = getSensoryMemory();
    mem.push({ modality: 'vital', kind: 'heartbeat', salience: 5, receivedAt: 1, payload: { load1: 0.3 } });
    mem.push({ modality: 'audio', kind: 'speech_end', salience: 200, receivedAt: 2 });

    let promotedSalient: number | null = null;
    const summary = await runDreamingPass({
      cwd: tmp,
      now: 123,
      promote: async (s) => {
        promotedSalient = s.salient.length;
      },
    });
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(2);
    expect(mem.size()).toBe(0); // drained
    expect(promotedSalient).toBe(1); // salient → promotion invoked

    const journal = await readFile(path.join(tmp, '.codebuddy', 'companion', 'dreams.jsonl'), 'utf8');
    expect(journal).toContain('"total":2');
    expect(await runDreamingPass({ cwd: tmp, promote: async () => {} })).toBeNull();
  });

  it('does NOT promote a non-salient dream', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dream-'));
    getSensoryMemory().push({ modality: 'vital', kind: 'heartbeat', salience: 5, receivedAt: 1, payload: { load1: 0.2 } });
    let promoted = false;
    await runDreamingPass({
      cwd: tmp,
      promote: async () => {
        promoted = true;
      },
    });
    expect(promoted).toBe(false); // no salient events → no promotion
  });

  it('fails closed instead of growing the journal when rotation cannot complete', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dream-rotation-'));
    const dir = path.join(tmp, '.codebuddy', 'companion');
    const journal = path.join(dir, 'dreams.jsonl');
    const oversized = 'x'.repeat(512 * 1024 + 1);
    await mkdir(dir, { recursive: true });
    await writeFile(journal, oversized, 'utf8');
    await mkdir(`${journal}.1`); // rename(file, directory) fails deterministically
    getSensoryMemory().drain();
    getSensoryMemory().push({ modality: 'vital', kind: 'heartbeat', receivedAt: 1 });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      await runDreamingPass({ cwd: tmp, promote: async () => {} });

      expect((await stat(journal)).size).toBe(Buffer.byteLength(oversized));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[dreaming] could not persist dream:'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('dreaming — promotion to long-term memory', () => {
  afterEach(() => resetMemoryManagerForTests());

  it('promotes a salient dream under a stable key (single entry, no growth)', async () => {
    resetMemoryManagerForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dreammem-'));
    getMemoryManager({
      projectMemoryPath: path.join(tmp, '.codebuddy', 'CODEBUDDY_MEMORY.md'),
      userMemoryPath: path.join(tmp, 'user-memory.md'),
    });

    const summary = consolidate([{ modality: 'audio', kind: 'speech_start', salience: 200, receivedAt: 1 }], 1);
    await promoteSalientDream(summary);
    await promoteSalientDream(summary); // repeat → stable key updates, not a 2nd entry

    const file = await readFile(path.join(tmp, '.codebuddy', 'CODEBUDDY_MEMORY.md'), 'utf8');
    expect(file).toContain('dream:recent');
    expect(file.match(/dream:recent/g)!.length).toBe(1); // exactly one entry
  });
});
