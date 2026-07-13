/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaisonHomeCard } from '../src/renderer/components/home/MaisonHomeCard';
import type {
  MaisonMode,
  MaisonModeInput,
  MaisonRendererApi,
  MaisonSnapshotPayload,
  MaisonTimerSummary,
} from '../src/shared/maison-ipc';

const NOW = new Date('2026-07-12T10:00:00.000Z').getTime();

function payload({
  mode = 'normal',
  activeTimers = [],
  warnings = [],
  foodConfigured = false,
}: {
  mode?: MaisonMode;
  activeTimers?: MaisonTimerSummary[];
  warnings?: string[];
  foodConfigured?: boolean;
} = {}): MaisonSnapshotPayload {
  return {
    status: 'ready',
    snapshot: {
      day: { kind: 'holiday', holidayName: '14 juillet' },
      presence: { state: 'present', displayName: 'Patrice', detail: 'Salon' },
      mode,
      provenance: { kind: 'calendar', observedAt: NOW },
      nextMeal: null,
    },
    activeTimers,
    foodProfile: {
      configured: foodConfigured,
      constraintCount: foodConfigured ? 2 : 0,
      unknownCount: foodConfigured ? 1 : 0,
    },
    warnings,
  };
}

function createApi(
  initialPayload: MaisonSnapshotPayload,
  overrides: Partial<MaisonRendererApi> = {},
): MaisonRendererApi {
  return {
    snapshot: vi.fn(async () => initialPayload),
    setMode: vi.fn(async ({ mode }: MaisonModeInput) => payload({ mode })),
    timerStart: vi.fn(async () => initialPayload),
    timerAcknowledge: vi.fn(async () => initialPayload),
    timerCancel: vi.fn(async () => initialPayload),
    ...overrides,
  };
}

function installApi(maison: MaisonRendererApi): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { maison },
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('MaisonHomeCard', () => {
  it('loads the live snapshot through window.electronAPI and renders its local details', async () => {
    const api = createApi(payload({
      foodConfigured: true,
      warnings: ['Le calendrier local doit être resynchronisé.'],
    }));
    installApi(api);

    render(<MaisonHomeCard />);

    await waitFor(() => expect(screen.getByTestId('maison-card')).toHaveAttribute('data-status', 'ready'));
    expect(api.snapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('maison-day')).toHaveTextContent('14 juillet');
    expect(screen.getByTestId('maison-presence')).toHaveTextContent('Patrice est là');
    expect(screen.getByTestId('maison-live-details')).toHaveTextContent('Profil repas chiffré');
    expect(screen.getByTestId('maison-live-details')).toHaveTextContent('Le calendrier local doit être resynchronisé.');
  });

  it('persists silence, guest and cooking modes through the Maison bridge', async () => {
    const setMode = vi.fn(async ({ mode }: MaisonModeInput) => payload({ mode }));
    const api = createApi(payload(), { setMode });
    installApi(api);
    render(<MaisonHomeCard />);

    await waitFor(() => expect(screen.getByTestId('maison-card')).toHaveAttribute('data-status', 'ready'));

    fireEvent.click(screen.getByTestId('maison-silence'));
    await waitFor(() => expect(screen.getByTestId('maison-mode')).toHaveTextContent('Silence'));
    expect(setMode).toHaveBeenNthCalledWith(1, { mode: 'silent' });

    fireEvent.click(screen.getByTestId('maison-guests'));
    await waitFor(() => expect(screen.getByTestId('maison-mode')).toHaveTextContent('Invités'));
    expect(setMode).toHaveBeenNthCalledWith(2, { mode: 'guests' });

    fireEvent.click(screen.getByTestId('maison-start-cooking'));
    await waitFor(() => expect(screen.getByTestId('maison-mode')).toHaveTextContent('Cuisine'));
    expect(setMode).toHaveBeenNthCalledWith(3, { mode: 'cooking' });
  });

  it('keeps the last snapshot visible when a manual refresh goes offline', async () => {
    const snapshot = vi
      .fn<MaisonRendererApi['snapshot']>()
      .mockResolvedValueOnce(payload())
      .mockRejectedValueOnce(new Error('Maison service unavailable'));
    installApi(createApi(payload(), { snapshot }));
    render(<MaisonHomeCard />);

    await waitFor(() => expect(screen.getByTestId('maison-card')).toHaveAttribute('data-status', 'ready'));
    fireEvent.click(screen.getByTestId('maison-refresh'));

    await waitFor(() => expect(screen.getByTestId('maison-card')).toHaveAttribute('data-status', 'offline'));
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('maison-state-message')).toHaveTextContent('dernier état connu');
    expect(screen.getByTestId('maison-day')).toHaveTextContent('14 juillet');
  });

  it('acknowledges a due timer and cancels a running timer through the bridge', async () => {
    const dueTimer: MaisonTimerSummary = {
      id: 'timer-four',
      label: 'four',
      dueAt: '2026-07-12T09:59:00.000Z',
      state: 'due',
      remainingMs: 0,
    };
    const runningTimer: MaisonTimerSummary = {
      id: 'timer-the',
      label: 'thé',
      dueAt: '2026-07-12T10:04:00.000Z',
      state: 'running',
      remainingMs: 240_000,
    };
    const timerAcknowledge = vi.fn(async () => payload({ activeTimers: [runningTimer] }));
    const timerCancel = vi.fn(async () => payload());
    installApi(createApi(payload({ activeTimers: [dueTimer, runningTimer] }), {
      timerAcknowledge,
      timerCancel,
    }));
    render(<MaisonHomeCard />);

    const acknowledge = await screen.findByRole('button', { name: 'Acquitter le minuteur four' });
    fireEvent.click(acknowledge);
    await waitFor(() => expect(screen.queryByText('four')).not.toBeInTheDocument());
    expect(timerAcknowledge).toHaveBeenCalledWith('timer-four');

    fireEvent.click(screen.getByRole('button', { name: 'Annuler le minuteur thé' }));
    await waitFor(() => expect(screen.queryByText('thé')).not.toBeInTheDocument());
    expect(timerCancel).toHaveBeenCalledWith('timer-the');
    expect(screen.queryByTestId('maison-live-details')).not.toBeInTheDocument();
  });

  it('falls back to an unknown, non-crashing state when the preload API is absent', async () => {
    Reflect.deleteProperty(window, 'electronAPI');

    expect(() => render(<MaisonHomeCard />)).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('maison-card')).toHaveAttribute('data-status', 'unknown'));
    expect(screen.getByTestId('maison-state-message')).toHaveTextContent('reste silencieux par défaut');
  });
});
