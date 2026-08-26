import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createCompanionCard } from '../src/companion/cards.js';
import { buildCompanionPrivacyReport, exportCompanionPrivacyBundle, purgeCompanionPrivacyData } from '../src/companion/privacy.js';
import { getCompanionPerceptsPath, recordCompanionPercept } from '../src/companion/percepts.js';
import { getCompanionSafetyLedgerPath, recordCompanionSafetyEvent } from '../src/companion/safety-ledger.js';

describe('companion privacy controls', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'buddy-companion-privacy-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('summarizes workspace companion memory stores', async () => {
    await recordCompanionPercept({
      modality: 'memory',
      source: 'test',
      summary: 'Remember a setup detail.',
    }, { cwd: tempDir });
    await createCompanionCard({
      kind: 'status',
      title: 'Review memory',
    }, { cwd: tempDir });
    await recordCompanionSafetyEvent({
      kind: 'data',
      action: 'privacy_test',
      reason: 'Testing privacy report.',
      source: 'test',
    }, { cwd: tempDir });

    const report = await buildCompanionPrivacyReport({ cwd: tempDir });
    expect(report.totalEntries).toBeGreaterThanOrEqual(3);
    expect(report.stores.find(store => store.kind === 'percepts')).toMatchObject({
      exists: true,
      entries: 2,
    });
    expect(report.stores.find(store => store.kind === 'cards')).toMatchObject({
      exists: true,
      entries: 1,
    });
    expect(report.stores.find(store => store.kind === 'safety')).toMatchObject({
      exists: true,
      entries: 1,
    });
  });

  it('exports selected stores into a manifest-backed bundle', async () => {
    await recordCompanionPercept({
      modality: 'self',
      source: 'test',
      summary: 'Self state.',
    }, { cwd: tempDir });
    await mkdir(path.join(tempDir, '.codebuddy', 'camera'), { recursive: true });
    await writeFile(path.join(tempDir, '.codebuddy', 'camera', 'frame.png'), 'png');

    const result = await exportCompanionPrivacyBundle({
      cwd: tempDir,
      kinds: ['percepts', 'camera'],
      now: new Date('2026-05-24T10:00:00Z'),
    });

    expect(result.exportDir).toContain('privacy-20260524100000');
    expect(result.copied.map(item => item.kind).sort()).toEqual(['camera', 'percepts']);
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as { copied: unknown[] };
    expect(manifest.copied).toHaveLength(2);
  });

  it('purges selected stores after creating a backup by default', async () => {
    await recordCompanionPercept({
      modality: 'memory',
      source: 'test',
      summary: 'Delete me.',
    }, { cwd: tempDir });
    await recordCompanionSafetyEvent({
      kind: 'data',
      action: 'privacy_test',
      reason: 'Testing purge.',
      source: 'test',
    }, { cwd: tempDir });

    const result = await purgeCompanionPrivacyData({
      cwd: tempDir,
      kinds: ['percepts', 'safety'],
      now: new Date('2026-05-24T10:01:00Z'),
    });

    expect(result.backup?.manifestPath).toBeTruthy();
    await expect(readFile(getCompanionPerceptsPath(tempDir), 'utf8')).rejects.toThrow();
    await expect(readFile(getCompanionSafetyLedgerPath(tempDir), 'utf8')).rejects.toThrow();
  });
});
