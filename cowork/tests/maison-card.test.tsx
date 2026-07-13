/** @vitest-environment happy-dom */
import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaisonCard } from '../src/renderer/components/home/MaisonCard';
import type {
  MaisonCardProps,
  MaisonSnapshot,
} from '../src/renderer/components/home/maison-types';

const NOW = new Date('2026-07-12T10:00:00.000Z').getTime();

const READY_SNAPSHOT: MaisonSnapshot = {
  day: { kind: 'weekend' },
  presence: { state: 'present', displayName: 'Patrice', detail: 'Salon' },
  mode: 'free-day',
  provenance: { kind: 'calendar', observedAt: NOW - 3 * 60_000 },
  nextMeal: {
    title: 'Tarte fine aux légumes',
    whenLabel: 'Dîner · vers 19 h 30',
    detail: 'Une idée simple avec les légumes restants.',
    origin: 'leftovers',
    state: 'planned',
  },
};

function callbacks() {
  return {
    onModeChange: vi.fn(),
    onSilenceChange: vi.fn(),
    onStartCooking: vi.fn(),
    onGuestsChange: vi.fn(),
    onRefresh: vi.fn(),
  };
}

function renderCard(
  overrides: Partial<MaisonCardProps> = {},
  handlers = callbacks(),
) {
  const props: MaisonCardProps = {
    snapshot: READY_SNAPSHOT,
    status: 'ready',
    now: NOW,
    ...handlers,
    ...overrides,
  };
  return { ...render(<MaisonCard {...props} />), handlers };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MaisonCard', () => {
  it('renders the day, presence, mode, provenance and practical meal as distinct signals', () => {
    renderCard();

    expect(screen.getByRole('region', { name: 'Le temps peut rester vraiment libre' })).toBeInTheDocument();
    expect(screen.getByTestId('maison-day')).toHaveTextContent('Week-end');
    expect(screen.getByTestId('maison-presence')).toHaveTextContent('Patrice est là');
    expect(screen.getByTestId('maison-presence')).toHaveTextContent('Salon');
    expect(screen.getByTestId('maison-mode')).toHaveTextContent('Journée libre');
    expect(screen.getByTestId('maison-provenance')).toHaveTextContent('Calendrier local · il y a 3 min');
    expect(screen.getByTestId('maison-meal')).toHaveTextContent('Tarte fine aux légumes');
    expect(screen.getByTestId('maison-meal')).toHaveTextContent('Prévu · Avec les restes');
    expect(screen.getByTestId('maison-status-badge')).toHaveTextContent('Prêt');
  });

  it('emits only explicit callbacks for mode, cooking, guests, silence and refresh', () => {
    const { handlers } = renderCard();

    fireEvent.click(screen.getByTestId('maison-change-mode'));
    const menu = screen.getByRole('menu', { name: 'Choisir le mode Maison' });
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(8);
    expect(screen.getByTestId('maison-mode-free-day')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('maison-mode-rest'));
    expect(handlers.onModeChange).toHaveBeenCalledWith('rest');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('maison-start-cooking'));
    fireEvent.click(screen.getByTestId('maison-guests'));
    fireEvent.click(screen.getByTestId('maison-silence'));
    fireEvent.click(screen.getByTestId('maison-refresh'));

    expect(handlers.onStartCooking).toHaveBeenCalledTimes(1);
    expect(handlers.onGuestsChange).toHaveBeenCalledWith(true);
    expect(handlers.onSilenceChange).toHaveBeenCalledWith(true);
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('makes guest and quiet-mode buttons reversible', () => {
    const guestHandlers = callbacks();
    const { unmount } = renderCard({ snapshot: { ...READY_SNAPSHOT, mode: 'guests' } }, guestHandlers);
    expect(screen.getByTestId('maison-guests')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('maison-guests'));
    expect(guestHandlers.onGuestsChange).toHaveBeenCalledWith(false);
    unmount();

    const silentHandlers = callbacks();
    renderCard({ snapshot: { ...READY_SNAPSHOT, mode: 'silent' } }, silentHandlers);
    expect(screen.getByTestId('maison-silence')).toHaveTextContent('Réactiver');
    expect(screen.getByTestId('maison-silence')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('maison-silence'));
    expect(silentHandlers.onSilenceChange).toHaveBeenCalledWith(false);
  });

  it('supports a restricted mode menu supplied by the integrator', () => {
    renderCard({ modeOptions: ['normal', 'rest', 'silent'] });
    fireEvent.click(screen.getByTestId('maison-change-mode'));
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
    expect(screen.queryByTestId('maison-mode-cooking')).not.toBeInTheDocument();
  });

  it('moves focus through the mode menu with arrow keys and restores it on Escape', async () => {
    renderCard();
    const trigger = screen.getByTestId('maison-change-mode');
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Choisir le mode Maison' });

    await waitFor(() => expect(screen.getByTestId('maison-mode-free-day')).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByTestId('maison-mode-focus')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(screen.getByTestId('maison-mode-free-day')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByTestId('maison-mode-silent')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('maison-change-mode')).toHaveFocus());
  });

  it('keeps the last known context visible but disables actions while offline', () => {
    renderCard({ status: 'offline' });

    expect(screen.getByTestId('maison-state-message')).toHaveTextContent('dernier état connu');
    expect(screen.getByTestId('maison-day')).toHaveTextContent('Week-end');
    expect(screen.getByTestId('maison-change-mode')).toBeDisabled();
    expect(screen.getByTestId('maison-start-cooking')).toBeDisabled();
    expect(screen.getByTestId('maison-guests')).toBeDisabled();
    expect(screen.getByTestId('maison-silence')).toBeDisabled();
    expect(screen.getByTestId('maison-refresh')).not.toBeDisabled();
  });

  it('renders accessible loading and unknown states without invented context', () => {
    const { unmount } = renderCard({ snapshot: null, status: 'loading' });
    expect(screen.getByTestId('maison-card')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('maison-state-message')).toHaveTextContent('Préparation du contexte Maison');
    expect(screen.getByTestId('maison-change-mode')).toBeDisabled();
    expect(screen.getByTestId('maison-meal')).toHaveTextContent('Rien n’est encore prévu');
    expect(screen.getByTestId('maison-meal')).toHaveTextContent('sans objectif médical ni jugement');
    unmount();

    renderCard({ snapshot: null, status: 'unknown' });
    expect(screen.getByTestId('maison-state-message')).toHaveTextContent('reste silencieux par défaut');
    expect(screen.getByTestId('maison-day')).toHaveTextContent('Jour à confirmer');
    expect(screen.getByTestId('maison-presence')).toHaveTextContent('Présence inconnue');
    expect(screen.getByTestId('maison-mode')).toHaveTextContent('Mode inconnu');
  });

  it('exposes a large educational tooltip on keyboard focus', () => {
    vi.useFakeTimers();
    renderCard();

    fireEvent.focus(screen.getByTestId('maison-start-cooking'));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Passer en cuisine mains libres');
    expect(tooltip).toHaveTextContent('Aucun repas n’est lancé automatiquement');
  });
});
