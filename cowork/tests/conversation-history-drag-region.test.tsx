/** @vitest-environment happy-dom */
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationHistoryDrawer } from '../src/renderer/components/ConversationHistoryDrawer';
import { useAppStore } from '../src/renderer/store';

// DOM test environments do not implement Electron's native hit testing. Match
// the real stylesheet against rendered elements instead of trusting DOM click().
const stylesheet = postcss.parse(readFileSync(path.resolve(process.cwd(), 'src/renderer/styles/globals.css'), 'utf8'));
function nativeRegion(element: Element): string | undefined {
  let region: string | undefined;
  stylesheet.walkRules((rule) => {
    if (!rule.selector.includes('titlebar') && !rule.selector.includes('.fixed')) return;
    if (rule.selectors.some((selector) => element.matches(selector))) {
      rule.walkDecls('-webkit-app-region', (declaration) => { region = declaration.value; });
    }
  });
  return region;
}
function hasNativeExclusion(element: Element): boolean {
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (nativeRegion(ancestor) === 'no-drag') return true;
  }
  return false;
}

beforeEach(() => {
  useAppStore.setState({ showConversationHistory: true, sessions: [], activeSessionId: null });
});
afterEach(cleanup);

describe('native titlebar hit regions', () => {
  it('excludes the rendered history close button and backdrop from native dragging', () => {
    render(<ConversationHistoryDrawer />);
    expect(hasNativeExclusion(screen.getByRole('button', { name: 'Fermer', exact: true }))).toBe(true);
    expect(hasNativeExclusion(screen.getByRole('button', { name: "Fermer l'historique", exact: true }))).toBe(true);
  });

  it('protects future controls throughout fixed overlays, not just their current close coordinates', () => {
    const { container } = render(<div className="fixed inset-0"><button>Future header action</button></div>);
    expect(hasNativeExclusion(container.querySelector('button')!)).toBe(true);
  });

  it('keeps the native titlebar draggable and its existing controls excluded', () => {
    const { container } = render(<div className="titlebar-drag"><button className="titlebar-no-drag">Window control</button></div>);
    expect(nativeRegion(container.firstElementChild!)).toBe('drag');
    expect(nativeRegion(container.querySelector('button')!)).toBe('no-drag');
  });

  it('does not carve a native drag hole for a pointer-transparent tooltip', () => {
    const { container } = render(<div className="fixed pointer-events-none" role="tooltip">Help</div>);
    expect(hasNativeExclusion(container.firstElementChild!)).toBe(false);
  });
});

describe('history dismissal', () => {
  it('cancels an inline rename with Escape before dismissing the history', () => {
    useAppStore.setState({ sessions: [{
      id: 'history-test', title: 'Original title', status: 'idle',
      mountedPaths: [], allowedTools: [], memoryEnabled: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    }] });
    render(<ConversationHistoryDrawer />);
    fireEvent.click(screen.getByTitle('Renommer'));
    fireEvent.change(screen.getByTestId('history-rename-input'), { target: { value: 'Uncommitted title' } });
    fireEvent.keyDown(screen.getByTestId('history-rename-input'), { key: 'Escape' });
    expect(screen.queryByTestId('history-rename-input')).toBeNull();
    expect(useAppStore.getState().sessions[0].title).toBe('Original title');
    expect(useAppStore.getState().showConversationHistory).toBe(true);
  });

  it('closes with Escape from the search field', () => {
    render(<ConversationHistoryDrawer />);
    fireEvent.keyDown(screen.getByTestId('history-search'), { key: 'Escape' });
    expect(useAppStore.getState().showConversationHistory).toBe(false);
    expect(screen.queryByTestId('conversation-history')).toBeNull();
  });

  it('keeps the existing close callback and removes the drawer', () => {
    render(<ConversationHistoryDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer', exact: true }));
    expect(screen.queryByTestId('conversation-history')).toBeNull();
  });

  it('does not consume Escape when the drawer is hidden', () => {
    render(<ConversationHistoryDrawer />);
    act(() => useAppStore.getState().setShowConversationHistory(false));
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
