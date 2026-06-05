/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KanbanPanel } from '../src/renderer/components/KanbanPanel';
import { useAppStore } from '../src/renderer/store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) => value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    title: 'Ship it',
    status: 'todo',
    priority: 'high',
    tags: [],
    links: [],
    comments: [],
    heartbeats: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  };
}

describe('KanbanPanel', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  beforeEach(() => {
    useAppStore.setState({ workingDir: '/ws', activeSessionId: null, sessions: [] });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('lists cards by column and creates a new card through the bridge', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, boardPath: '/ws/.codebuddy/kanban-board.json', cards: [card()] });
    const create = vi.fn().mockResolvedValue({ ok: true, card: card({ id: 'card-2', title: 'New one' }) });
    (window as unknown as {
      electronAPI?: { tools?: { hermesKanban?: { list: typeof list; create: typeof create } } };
    }).electronAPI = { tools: { hermesKanban: { list, create } } };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(KanbanPanel, { onClose: () => {} }));
      await Promise.resolve();
    });

    expect(list).toHaveBeenCalledWith({ cwd: '/ws', filter: { includeDone: true } });
    const todoColumn = target.querySelector('[data-testid="kanban-column-todo"]');
    expect(todoColumn?.textContent).toContain('Ship it');

    const titleInput = target.querySelector('[data-testid="kanban-new-title"]') as HTMLInputElement;
    await act(async () => {
      titleInput.value = 'New one';
      Simulate.change(titleInput);
      await Promise.resolve();
    });
    const addButton = target.querySelector('[data-testid="kanban-create"]') as HTMLButtonElement;

    await act(async () => {
      Simulate.click(addButton);
      await Promise.resolve();
    });

    expect(create).toHaveBeenCalledWith({
      cwd: '/ws',
      input: { title: 'New one', priority: 'medium' },
    });
  });

  it('archives a card through the bridge', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, cards: [card()] });
    const archive = vi.fn().mockResolvedValue({ ok: true, card: card({ status: 'archived' }) });
    (window as unknown as {
      electronAPI?: { tools?: { hermesKanban?: { list: typeof list; archive: typeof archive } } };
    }).electronAPI = { tools: { hermesKanban: { list, archive } } };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(KanbanPanel, { onClose: () => {} }));
      await Promise.resolve();
    });

    const archiveButton = target.querySelector('[data-testid="kanban-archive-card-1"]') as HTMLButtonElement;
    expect(archiveButton).not.toBeNull();
    await act(async () => {
      Simulate.click(archiveButton);
      await Promise.resolve();
    });
    expect(archive).toHaveBeenCalledWith({ cwd: '/ws', id: 'card-1' });
  });

  it('completes a card through the bridge', async () => {
    const list = vi.fn().mockResolvedValue({ ok: true, cards: [card()] });
    const complete = vi.fn().mockResolvedValue({ ok: true, card: card({ status: 'done' }) });
    (window as unknown as {
      electronAPI?: { tools?: { hermesKanban?: { list: typeof list; complete: typeof complete } } };
    }).electronAPI = { tools: { hermesKanban: { list, complete } } };

    const target = container();
    root = createRoot(target);
    await act(async () => {
      root?.render(React.createElement(KanbanPanel, { onClose: () => {} }));
      await Promise.resolve();
    });

    const completeButton = target.querySelector('[data-testid="kanban-complete-card-1"]') as HTMLButtonElement;
    expect(completeButton).not.toBeNull();
    await act(async () => {
      Simulate.click(completeButton);
      await Promise.resolve();
    });

    expect(complete).toHaveBeenCalledWith({ cwd: '/ws', id: 'card-1' });
  });
});
