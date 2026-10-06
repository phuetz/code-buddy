/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/renderer/hooks/useIPC', () => ({ useIPC: () => ({ startSession: vi.fn() }) }));
import i18n from '../src/renderer/i18n/config';
import { useAppStore } from '../src/renderer/store';
import { HomeView } from '../src/renderer/components/HomeView';

async function home() {
  await act(async () => { render(<HomeView />); });
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.setState({ sessions: [], activeSessionId: null, chatComposerSeed: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('Home improvements from the UI review', () => {
  it('puts the widest composer before actions and keeps household context after them', async () => {
    await home();
    const composer = screen.getByTestId('home-composer');
    const studios = screen.getByTestId('home-studios');
    const maison = screen.getByTestId('maison-home-card');
    expect(composer.classList.contains('max-w-3xl')).toBe(true);
    expect(composer.compareDocumentPosition(studios) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(studios.compareDocumentPosition(maison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('uses the E1 foreground token for Send, including all supported themes', async () => {
    await home();
    expect(screen.getByTestId('home-send').classList.contains('text-accent-foreground')).toBe(true);
  });
  it('gives every studio, quick action and mission a native keyboard control and visible focus', async () => {
    await home();
    for (const id of ['home-studios', 'home-quick', 'home-missions']) {
      const buttons = screen.getByTestId(id).querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button.tabIndex).toBe(0);
        expect(button.classList.contains('focus-visible:ring-2')).toBe(true);
        button.focus();
        expect(document.activeElement).toBe(button);
      }
    }
  });
  it('does not open a blocking household tooltip on initial render or incidental pointer hover', async () => {
    vi.useFakeTimers();
    await home();
    expect(screen.queryByRole('tooltip')).toBeNull();
    const hint = screen.getByTestId('maison-home-card').querySelector('span[aria-label]')!;
    expect(hint).not.toBeNull();
    fireEvent.mouseOver(hint);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('blocks the tooltip when the pointer enters household context from another React control', async () => {
    vi.useFakeTimers();
    await home();
    const hint = screen.getByTestId('maison-home-card').querySelector('span[aria-label]')!;
    // React synthesizes the destination's mouseenter from the source mouseout.
    fireEvent.mouseOut(screen.getByTestId('home-input'), { relatedTarget: hint });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('keeps household help available through explicit keyboard focus and dismisses on blur', async () => {
    vi.useFakeTimers();
    await home();
    const button = screen.getByTestId('maison-refresh');
    fireEvent.focus(button);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.getByRole('tooltip').textContent).toContain('Actualiser');
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
