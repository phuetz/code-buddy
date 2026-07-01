import { describe, it, expect } from 'vitest';
import {
  hotspotsToWeaknesses,
  evalFailuresToWeaknesses,
  selectWeaknesses,
} from '../../../../src/agent/self-improvement/evolution/weakness-selector.js';

describe('weakness mappers', () => {
  it('hotspotsToWeaknesses maps, drops empty-file entries, caps at limit', () => {
    const w = hotspotsToWeaknesses(
      [{ file: 'src/a.ts', reason: 'hot' }, { file: '', reason: 'noise' }, { file: 'src/b.ts' }, { file: 'src/c.ts' }],
      2,
    );
    expect(w).toHaveLength(2);
    expect(w[0]!.kind).toBe('hotspot');
    expect(w[0]!.goal).toContain('src/a.ts');
    expect(w.every((x) => x.goal.includes('WITHOUT changing behavior'))).toBe(true);
  });

  it('evalFailuresToWeaknesses maps failing task ids, caps at limit', () => {
    const w = evalFailuresToWeaknesses(['simple-edit', 'multiple-edits', 'space-path-edit'], 2);
    expect(w.map((x) => x.id)).toEqual(['eval-simple-edit', 'eval-multiple-edits']);
    expect(w[0]!.kind).toBe('eval-failure');
    expect(w[0]!.goal).toContain('never the test/harness');
  });
});

describe('selectWeaknesses (injected fetchers, no LLM/MCP)', () => {
  it('combines both sources, dedups, caps at limit', async () => {
    const out = await selectWeaknesses({
      includeEvalFailures: true,
      includeHotspots: true,
      limit: 3,
      detectEvalFailures: async () => ['simple-edit'],
      fetchHotspots: async () => [{ file: 'src/x.ts' }, { file: 'src/y.ts' }],
    });
    expect(out).toHaveLength(3);
    expect(out[0]!.id).toBe('eval-simple-edit'); // eval failures first
    expect(out.filter((w) => w.kind === 'hotspot')).toHaveLength(2);
  });

  it('returns [] when no source enabled', async () => {
    expect(await selectWeaknesses({})).toEqual([]);
  });

  it('a throwing fetcher is swallowed (never crashes selection)', async () => {
    const out = await selectWeaknesses({
      includeHotspots: true,
      fetchHotspots: async () => {
        throw new Error('Code Explorer down');
      },
    });
    expect(out).toEqual([]);
  });
});
