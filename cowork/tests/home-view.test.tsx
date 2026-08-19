/**
 * @vitest-environment happy-dom
 *
 * HomeView (NewShell slice 2) — the calm chat empty-state: quick-action chips
 * route via existing store actions, recent sessions resume into chat.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture startSession from the useIPC hook (the real first-message path).
const startSessionSpy = vi.fn(async (title: string) => ({ id: 'created', title } as unknown));
vi.mock('../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ({ startSession: startSessionSpy }),
}));

import { useAppStore } from '../src/renderer/store';
import { HomeView } from '../src/renderer/components/HomeView';
import type { Session } from '../src/renderer/types';

function session(over: Partial<Session> & { id: string }): Session {
  return {
    title: over.id,
    status: 'idle' as Session['status'],
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('HomeView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    startSessionSpy.mockClear();
    useAppStore.setState({
      sessions: [],
      activeSessionId: null,
      primaryView: 'chat',
      showLiveLauncher: false,
      showSkillsManager: false,
      workingDir: '/home/me/project',
      activeProjectId: null,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => act(() => root.render(<HomeView />));

  it('shows recent non-archived sessions newest-first and resumes into chat', () => {
    useAppStore.setState({
      sessions: [
        session({ id: 'old', title: 'Old task', updatedAt: 10 }),
        session({ id: 'new', title: 'New task', updatedAt: 99 }),
        session({ id: 'gone', title: 'Archived', updatedAt: 50, archived: true }),
        session({ id: 'other', title: 'Other', updatedAt: 20 }),
      ],
    });
    render();

    const recents = container.querySelector('[data-testid="home-recents"]')!;
    expect(recents.textContent).toContain('New task');
    expect(recents.textContent).toContain('Old task');
    expect(recents.textContent).not.toContain('Archived');
    // Newest first.
    expect(recents.textContent!.indexOf('New task')).toBeLessThan(
      recents.textContent!.indexOf('Old task')
    );

    // Resume: click the newest.
    const firstBtn = recents.querySelector('button')!;
    act(() => firstBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useAppStore.getState().activeSessionId).toBe('new');
    expect(useAppStore.getState().primaryView).toBe('chat');
  });

  it('quick chips route via store actions (research → live launcher, doc → skills)', () => {
    render();
    const quick = container.querySelector('[data-testid="home-quick"]')!;
    const buttons = [...quick.querySelectorAll('button')];

    const research = buttons.find((b) => b.textContent?.includes('Search'))!;
    act(() => research.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useAppStore.getState().showLiveLauncher).toBe(true);

    const doc = buttons.find((b) => b.textContent?.includes('document'))!;
    act(() => doc.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useAppStore.getState().showSkillsManager).toBe(true);
  });

  it('renders no recents block when there are no sessions', () => {
    render();
    expect(container.querySelector('[data-testid="home-recents"]')).toBeNull();
    expect(container.querySelector('[data-testid="home-view"]')).toBeTruthy();
  });

  it('the one input box starts a real session with the typed first message', async () => {
    render();
    const input = container.querySelector('[data-testid="home-input"]') as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )!.set!;
    act(() => {
      nativeSetter.call(input, 'corrige le bug de login');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const send = container.querySelector('[data-testid="home-send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    await act(async () => {
      send.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(startSessionSpy).toHaveBeenCalledTimes(1);
    const [title, text, cwd] = startSessionSpy.mock.calls[0]!;
    expect(text).toBe('corrige le bug de login');
    expect(title).toContain('corrige');
    expect(cwd).toBe('/home/me/project');
  });

  it('Enter (without shift) submits the input', async () => {
    render();
    const input = container.querySelector('[data-testid="home-input"]') as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )!.set!;
    act(() => {
      nativeSetter.call(input, 'crée un tableau de bord');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(startSessionSpy).toHaveBeenCalledTimes(1);
  });

  it('does not send an empty prompt', async () => {
    render();
    const send = container.querySelector('[data-testid="home-send"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await act(async () => {
      send.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(startSessionSpy).not.toHaveBeenCalled();
  });
});
