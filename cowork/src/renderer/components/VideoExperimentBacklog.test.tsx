// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoExperimentListResult } from '../../shared/video-experiments';
import { VideoExperimentBacklog } from './VideoExperimentBacklog';

const result: VideoExperimentListResult = {
  experiments: [
    {
      key: 'https://youtu.be/demo␟world-model-3d-420',
      id: 'world-model-3d-420',
      title: 'PanoWorld',
      category: 'world-model-3d',
      verificationStatus: 'unverified',
      confidence: 'medium',
      evidence: { t_start: 420, t_end: 430, transcript: 'Une visite 3D spatialement cohérente.' },
      namesToVerify: ['PanoWorld'],
      links: ['https://github.com/jjrCN/PanoWorld'],
      requirements: ['dépôt officiel'],
      risks: ['coût GPU'],
      minimumExperiment: 'Générer une petite scène multi-vues.',
      source: 'https://youtu.be/demo',
      method: 'youtube-captions',
      artifactPath: '/tmp/experiments-demo.json',
      discoveredAt: '2026-07-15T00:00:00.000Z',
      reviewStatus: 'candidate',
    },
  ],
  summary: {
    total: 1,
    sources: 1,
    byStatus: { candidate: 1, planned: 0, running: 0, validated: 0, rejected: 0 },
    roots: ['/tmp/video'],
    reviewStorePath: '/tmp/experiment-reviews.json',
    skippedArtifacts: 0,
  },
};

describe('VideoExperimentBacklog', () => {
  const list = vi.fn();
  const review = vi.fn();

  beforeEach(() => {
    list.mockResolvedValue(result);
    review.mockResolvedValue({
      ok: true,
      review: { status: 'planned' as const, reviewedAt: '2026-07-15T01:00:00.000Z' },
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { videoExperiments: { list, review } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders evidence and persists a human review status', async () => {
    render(<VideoExperimentBacklog workingDir="/workspace" />);

    expect(await screen.findByText('PanoWorld')).toBeTruthy();
    expect(screen.getByText('Une visite 3D spatialement cohérente.')).toBeTruthy();
    expect(screen.getByText(/Générer une petite scène/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'github.com/jjrCN/PanoWorld' })).toHaveProperty(
      'href',
      'https://github.com/jjrCN/PanoWorld'
    );

    fireEvent.change(screen.getByLabelText('Rechercher une découverte vidéo'), {
      target: { value: 'robotique' },
    });
    expect(screen.getByText('Aucune piste avec ces critères.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Rechercher une découverte vidéo'), {
      target: { value: 'Pano' },
    });
    expect(screen.getByText('PanoWorld')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Statut de PanoWorld'), {
      target: { value: 'planned' },
    });

    await waitFor(() =>
      expect(review).toHaveBeenCalledWith({
        cwd: '/workspace',
        key: result.experiments[0]!.key,
        status: 'planned',
      })
    );
    expect((screen.getByLabelText('Statut de PanoWorld') as HTMLSelectElement).value).toBe(
      'planned'
    );

    fireEvent.change(screen.getByLabelText('Note de vérification'), {
      target: { value: 'Dépôt primaire confirmé, benchmark Darkstar à faire.' },
    });
    const saveNote = screen.getByRole('button', { name: 'Enregistrer la note' });
    await waitFor(() => expect((saveNote as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveNote);
    await waitFor(() =>
      expect(review).toHaveBeenLastCalledWith({
        cwd: '/workspace',
        key: result.experiments[0]!.key,
        status: 'planned',
        note: 'Dépôt primaire confirmé, benchmark Darkstar à faire.',
      })
    );
  });
});
