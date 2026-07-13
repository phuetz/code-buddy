// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComfyLabPanel } from '../src/renderer/components/videostudio/ComfyLabPanel';
import { COMFY_LAB_MANIFEST } from '../src/shared/comfy-lab-manifest';
import type { ComfyLabSnapshot } from '../src/shared/comfy-lab';

const snapshot: ComfyLabSnapshot = {
  schemaVersion: 1,
  generatedAt: '2026-07-12T12:00:00.000Z',
  installation: {
    found: true,
    root: '/home/user/ComfyUI',
    source: 'COMFYUI_ROOT',
    reason: 'Installation locale.',
  },
  probe: {
    state: 'reachable',
    url: 'http://127.0.0.1:8188',
    comfyuiVersion: '0.22.0',
    device: { name: 'cpu', type: 'cpu' },
    cpuFallback: true,
    reason: 'Fallback CPU.',
  },
  inventory: {
    modelFiles: 12,
    modelBytes: 12 * 1024 ** 3,
    templates: 8,
    nodes: 420,
    truncated: false,
  },
  useCases: COMFY_LAB_MANIFEST.map((manifest, index) => ({
    ...manifest,
    readiness: index === 0 ? 'ready' as const : index < 4 ? 'partial' as const : 'missing' as const,
    readinessReason: index === 0
      ? 'Tous les prérequis déclarés sont détectés. Fallback CPU actif.'
      : 'À compléter manuellement.',
    requirements: manifest.requirements.map((requirement, requirementIndex) => ({
      ...requirement,
      available: index === 0 || requirementIndex > 0,
      matches: index === 0 || requirementIndex > 0 ? [`signal-${requirement.id}`] : [],
      source: requirement.kind === 'node' ? 'loopback' as const : 'disk' as const,
    })),
  })),
  safety: {
    localOnly: true,
    implicitDownloads: false,
    implicitExecution: false,
    note: 'Aucune action implicite.',
  },
};

const api = {
  inspect: vi.fn(async () => ({ ok: true as const, snapshot })),
  openComfyUi: vi.fn(async () => ({ ok: true as const, message: 'ComfyUI local a été ouvert.' })),
  copyPlan: vi.fn(async () => ({ ok: true as const, message: 'Plan copié.', plan: '# plan' })),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { comfyLab: api },
  });
});

afterEach(cleanup);

describe('ComfyLabPanel', () => {
  it('renders prioritized readiness, real CPU fallback, costs, licenses, and limits', async () => {
    render(<ComfyLabPanel onClose={vi.fn()} />);

    expect(await screen.findByText('Couvertures & storyboards')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Couvertures & storyboards',
      'Animatique locale avec Wan',
      'Cohérence des personnages',
      'Musique avec ACE-Step',
      'Avatar parlant',
      'Objets & décors 3D',
    ]);
    expect(screen.getByTestId('comfy-lab-cpu-fallback').textContent).toMatch(/CPU fallback/i);
    expect(screen.getAllByText('Coût local estimatif')).toHaveLength(6);
    expect(screen.getAllByText('Licence à vérifier')).toHaveLength(6);
    expect(screen.getByText(/Le texte intégré aux images doit être finalisé/i)).toBeTruthy();
    expect(screen.getByText(/il ne télécharge, n’installe et n’exécute rien/i)).toBeTruthy();
  });

  it('exposes only explicit local-open and copy-plan actions', async () => {
    const onClose = vi.fn();
    render(<ComfyLabPanel onClose={onClose} />);
    await screen.findByText('Couvertures & storyboards');

    fireEvent.click(screen.getByTestId('comfy-lab-open'));
    await waitFor(() => expect(api.openComfyUi).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('status')).textContent).toMatch(/ComfyUI local a été ouvert/i);

    fireEvent.click(screen.getByTestId('comfy-lab-copy-book-visuals'));
    await waitFor(() => expect(api.copyPlan).toHaveBeenCalledWith({ useCaseId: 'book-visuals' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/Plan copié/i);

    fireEvent.click(screen.getByRole('button', { name: /fermer le laboratoire/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /télécharger|installer|exécuter/i })).toBeNull();
  });
});
