/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BtwQuickAsk } from '../src/renderer/components/BtwQuickAsk';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('../src/renderer/store', () => ({
  useAppStore: (selector: (s: { activeSessionId: string | null; sessions: []; sessionStates: Record<string, never> }) => unknown) =>
    selector({ activeSessionId: 's1', sessions: [], sessionStates: {} }),
}));

describe('BtwQuickAsk panel / appshot confirmation and lifecycle', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;
  let confirmMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;
  let submitMock: ReturnType<typeof vi.fn>;
  let hideMock: ReturnType<typeof vi.fn>;
  let getTasksMock: ReturnType<typeof vi.fn>;
  let onTasksMock: ReturnType<typeof vi.fn>;
  let onPreviewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);

    confirmMock = vi.fn(async () => ({ ok: true, filePath: '/tmp/x.png' }));
    cancelMock = vi.fn(async () => ({ ok: true }));
    submitMock = vi.fn(async () => ({ ok: true }));
    hideMock = vi.fn(async () => ({ ok: true }));
    getTasksMock = vi.fn(async () => [{ id: 't-init', label: 'Initial task' }]);
    onTasksMock = vi.fn((_cb: (tasks: Array<{ id: string; label: string }>) => void) => () => undefined);
    onPreviewMock = vi.fn((cb: (preview: { dataUrl: string; windowName: string; filePath: string } | null) => void) => {
      cb({
        dataUrl: 'data:image/png;base64,QQ==',
        windowName: 'Firefox',
        filePath: '/tmp/x.png',
      });
      return () => undefined;
    });

    (window as unknown as { electronAPI: unknown }).electronAPI = {
      quickask: {
        hide: hideMock,
        submit: submitMock,
        getTasks: getTasksMock,
        onTasks: onTasksMock,
      },
      appshot: {
        confirm: confirmMock,
        cancel: cancelMock,
        onPreview: onPreviewMock,
      },
    };
  });

  afterEach(() => {
    root?.unmount();
    host.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('lifecycle: appshot preview -> confirm -> DOM and state reset -> unblocks text prompt for second use', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root = createRoot(host);
      root.render(<BtwQuickAsk variant="panel" onClose={onClose} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 1. Initial preview is rendered and blocks prompt submission
    expect(host.querySelector('[data-testid="appshot-preview"]')).toBeTruthy();
    const submitBtn = host.querySelector('[data-testid="btw-submit"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // 2. Click confirm
    const confirmBtn = host.querySelector('[data-testid="appshot-confirm"]') as HTMLButtonElement;
    await act(async () => {
      confirmBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);

    // 3. State is reset: preview DOM is completely removed
    expect(host.querySelector('[data-testid="appshot-preview"]')).toBeNull();

    // 4. Second use: Prompt textarea and submit button are unblocked
    const input = host.querySelector('[data-testid="btw-input"]') as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      nativeSetter?.call(input, 'How do I run tests?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(submitBtn.disabled).toBe(false);

    await act(async () => {
      submitBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 5. Submit called successfully, textarea reset, onClose called
    expect(submitMock).toHaveBeenCalledWith('How do I run tests?');
    expect(input.value).toBe('');
    expect(onClose).toHaveBeenCalled();
  });

  it('displays error and preserves prompt when quickask.submit fails with no_active_session', async () => {
    submitMock.mockResolvedValueOnce({ ok: false, error: 'no_active_session' });
    onPreviewMock.mockImplementationOnce(() => () => undefined); // No appshot preview

    const onClose = vi.fn();
    await act(async () => {
      root = createRoot(host);
      root.render(<BtwQuickAsk variant="panel" onClose={onClose} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const input = host.querySelector('[data-testid="btw-input"]') as HTMLTextAreaElement;
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      nativeSetter?.call(input, 'My query');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const submitBtn = host.querySelector('[data-testid="btw-submit"]') as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(submitMock).toHaveBeenCalledWith('My query');
    expect(host.textContent).toContain('No active session. Open or create a conversation first.');
    expect(input.value).toBe('My query'); // Prompt was NOT erased
    expect(onClose).not.toHaveBeenCalled(); // Panel was NOT closed
  });

  it('displays error and preserves preview when appshot.confirm fails with no_active_session', async () => {
    confirmMock.mockResolvedValueOnce({ ok: false, error: 'no_active_session' });

    await act(async () => {
      root = createRoot(host);
      root.render(<BtwQuickAsk variant="panel" onClose={() => undefined} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="appshot-preview"]')).toBeTruthy();

    const confirmBtn = host.querySelector('[data-testid="appshot-confirm"]') as HTMLButtonElement;
    await act(async () => {
      confirmBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('No active session. Open or create a conversation first.');
    // Preview is still present
    expect(host.querySelector('[data-testid="appshot-preview"]')).toBeTruthy();
  });

  it('pulls initial tasks on mount via getTasks', async () => {
    onPreviewMock.mockImplementationOnce(() => () => undefined);

    await act(async () => {
      root = createRoot(host);
      root.render(<BtwQuickAsk variant="panel" onClose={() => undefined} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(getTasksMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="btw-running-tasks"]')?.textContent).toContain('Initial task');
  });

  it('cancels appshot and clears preview when cancel button is clicked', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<BtwQuickAsk variant="panel" onClose={() => undefined} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="appshot-preview"]')).toBeTruthy();

    const cancelBtn = host.querySelector('[data-testid="appshot-cancel"]') as HTMLButtonElement;
    await act(async () => {
      cancelBtn.click();
    });

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="appshot-preview"]')).toBeNull();
  });
});
