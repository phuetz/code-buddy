import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  CollectiveKnowledgeGraph,
  resetCollectiveKnowledgeGraph,
} from '../../src/memory/collective-knowledge-graph.js';

const workRoot = join(process.cwd(), '.gk6-work', 'ckg-engine-default');

function findBin(): string | null {
  const env = process.env.CODEBUDDY_BUDDY_MEMORY_BIN;
  if (env && existsSync(env) && !env.includes('ckg-engine-default')) return env;
  for (const sub of ['release', 'debug']) {
    const p = join(process.cwd(), 'buddy-memory', 'target', sub, 'buddy-memory');
    if (existsSync(p)) return p;
  }
  return null;
}
const realBin = findBin();

describe('CKG engine default switchover', () => {
  let dir: string;
  let ledgerPath: string;
  let prevEngine: string | undefined;
  let prevBin: string | undefined;

  beforeEach(() => {
    mkdirSync(workRoot, { recursive: true });
    dir = join(workRoot, `run-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    ledgerPath = join(dir, 'ckg-ledger.jsonl');
    prevEngine = process.env.CODEBUDDY_CKG_ENGINE;
    prevBin = process.env.CODEBUDDY_BUDDY_MEMORY_BIN;
  });

  afterEach(() => {
    if (prevEngine === undefined) delete process.env.CODEBUDDY_CKG_ENGINE;
    else process.env.CODEBUDDY_CKG_ENGINE = prevEngine;
    if (prevBin === undefined) delete process.env.CODEBUDDY_BUDDY_MEMORY_BIN;
    else process.env.CODEBUDDY_BUDDY_MEMORY_BIN = prevBin;
    resetCollectiveKnowledgeGraph();
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* best effort */
    }
  });

  it('CODEBUDDY_CKG_ENGINE=ts stays on the in-process path even if a binary exists', async () => {
    process.env.CODEBUDDY_CKG_ENGINE = 'ts';
    if (realBin) process.env.CODEBUDDY_BUDDY_MEMORY_BIN = realBin;
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    const stored = await ckg.ingest({
      name: 'voice',
      text: 'La réponse vocale est trop lente, router vers le local.',
    });
    expect(stored).not.toBeNull();
    const hits = ckg.recall('réponse vocale lente', { limit: 3 });
    expect(hits.some((h) => h.name === 'voice')).toBe(true);
  });

  it('falls back to TS when an explicit rust engine dies', async () => {
    const fakeBin = join(dir, 'dead-buddy-memory');
    writeFileSync(fakeBin, '#!/bin/sh\nexit 1\n', { encoding: 'utf8' });
    chmodSync(fakeBin, 0o755);
    process.env.CODEBUDDY_BUDDY_MEMORY_BIN = fakeBin;
    process.env.CODEBUDDY_CKG_ENGINE = 'rust';
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    const stored = await ckg.ingest({
      name: 'voice',
      text: 'La réponse vocale est trop lente, repli typescript obligatoire.',
    });
    expect(stored).not.toBeNull();
    expect(ckg.recall('repli typescript', { limit: 1 }).some((h) => h.name === 'voice')).toBe(true);
  });

  it('auto + corrupt snapshot does not spawn rust and uses TS', async () => {
    const marker = join(dir, 'spawned');
    const fakeBin = join(dir, 'buddy-memory');
    writeFileSync(
      fakeBin,
      `#!/bin/sh\nprintf spawned > "${marker}"\nexec sleep 30\n`,
      { encoding: 'utf8' },
    );
    chmodSync(fakeBin, 0o755);
    writeFileSync(`${ledgerPath}.snap`, '{not-json', { encoding: 'utf8' });
    process.env.CODEBUDDY_BUDDY_MEMORY_BIN = fakeBin;
    process.env.CODEBUDDY_CKG_ENGINE = 'auto';
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    const stored = await ckg.ingest({ name: 'alpha', text: 'alpha beta gamma topic' });
    expect(stored).not.toBeNull();
    expect(existsSync(marker)).toBe(false);
    expect(ckg.recall('alpha gamma', { limit: 1 }).some((h) => h.name === 'alpha')).toBe(true);
  });

  it.skipIf(!realBin)('auto + built binary + loadable snapshot uses rust', async () => {
    process.env.CODEBUDDY_CKG_ENGINE = 'auto';
    process.env.CODEBUDDY_BUDDY_MEMORY_BIN = realBin!;
    writeFileSync(
      `${ledgerPath}.snap`,
      JSON.stringify({ version: 2, offset: 0, current: {}, superseded: {}, relations: {} }),
      { encoding: 'utf8' },
    );
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    await ckg.ingest({ name: 'rustpath', text: 'une découverte via le moteur rust par défaut' });
    const stats = ckg.getStats();
    expect(stats.entities).toBeGreaterThanOrEqual(1);
    const hits = await ckg.recallHybrid('découverte moteur rust', { limit: 3 });
    expect(hits.some((h) => h.name === 'rustpath')).toBe(true);
  }, 30000);
});
