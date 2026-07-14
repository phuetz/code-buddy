import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { listVideoExperiments, reviewVideoExperiment } from './video-experiments-ipc';

describe('video experiment administration', () => {
  let root: string;
  let workspace: string;
  let home: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cowork-video-experiments-'));
    workspace = join(root, 'workspace');
    home = join(root, 'home');
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('discovers companion backlogs and persists a separate human review ledger', async () => {
    const videoDir = join(home, '.codebuddy', 'bot-cwd', '.codebuddy', 'video');
    await mkdir(videoDir, { recursive: true });
    await writeFile(
      join(videoDir, 'experiments-demo.json'),
      JSON.stringify({
        version: 1,
        source: 'https://youtu.be/demo',
        method: 'youtube-captions',
        candidates: [
          {
            id: 'world-model-3d-420',
            title: 'PanoWorld',
            category: 'world-model-3d',
            verificationStatus: 'unverified',
            confidence: 'medium',
            evidence: {
              t_start: 420,
              t_end: 430,
              transcript: 'Une visite 3D spatialement cohérente.',
            },
            namesToVerify: ['PanoWorld'],
            links: [],
            requirements: ['dépôt officiel'],
            risks: ['coût GPU'],
            minimumExperiment: 'Générer une petite scène multi-vues.',
          },
        ],
      }),
      'utf8'
    );

    const initial = await listVideoExperiments(workspace, { home });
    expect(initial.experiments).toHaveLength(1);
    expect(initial.experiments[0]).toMatchObject({ title: 'PanoWorld', reviewStatus: 'candidate' });
    expect(initial.summary.sources).toBe(1);

    const reviewed = await reviewVideoExperiment({
      cwd: workspace,
      key: initial.experiments[0]!.key,
      status: 'planned',
      note: 'Vérifier le dépôt primaire.',
    });
    expect(reviewed.ok).toBe(true);

    const reloaded = await listVideoExperiments(workspace, { home });
    expect(reloaded.experiments[0]).toMatchObject({
      reviewStatus: 'planned',
      reviewNote: 'Vérifier le dépôt primaire.',
    });
    expect(reloaded.summary.byStatus.planned).toBe(1);
    expect(JSON.parse(await readFile(reloaded.summary.reviewStorePath, 'utf8'))).toMatchObject({
      version: 1,
    });
  });

  it('skips corrupt artifacts without hiding valid ones', async () => {
    const videoDir = join(workspace, '.codebuddy', 'video');
    await mkdir(videoDir, { recursive: true });
    await writeFile(join(videoDir, 'experiments-corrupt.json'), '{nope', 'utf8');
    await writeFile(
      join(videoDir, 'experiments-valid.json'),
      JSON.stringify({
        version: 1,
        source: 'local.mp4',
        method: 'local-file',
        candidates: [
          {
            id: 'robotics-10',
            title: 'Robot vocal',
            category: 'robotics',
            confidence: 'low',
            evidence: { t_start: 10, t_end: 20, transcript: 'Commande vocale bornée.' },
            requirements: [],
            risks: [],
            minimumExperiment: 'Simulation uniquement.',
          },
        ],
      }),
      'utf8'
    );

    const result = await listVideoExperiments(workspace, { home });
    expect(result.experiments.map((experiment) => experiment.title)).toEqual(['Robot vocal']);
    expect(result.summary.skippedArtifacts).toBe(1);
  });

  it('rejects invalid review states', async () => {
    const result = await reviewVideoExperiment({
      cwd: workspace,
      key: 'source␟candidate',
      status: 'deleted' as never,
    });
    expect(result).toEqual({ ok: false, error: 'Piste ou statut invalide.' });
  });

  it('serializes parallel review updates without losing an entry', async () => {
    const [first, second] = await Promise.all([
      reviewVideoExperiment({ cwd: workspace, key: 'source␟first', status: 'planned' }),
      reviewVideoExperiment({ cwd: workspace, key: 'source␟second', status: 'validated' }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const stored = JSON.parse(
      await readFile(join(workspace, '.codebuddy', 'video', 'experiment-reviews.json'), 'utf8')
    ) as { reviews: Record<string, { status: string }> };
    expect(stored.reviews).toMatchObject({
      'source␟first': { status: 'planned' },
      'source␟second': { status: 'validated' },
    });
  });
});
