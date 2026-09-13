/**
 * @vitest-environment happy-dom
 *
 * WorkflowProPanel streams the server boot log while starting instead of a
 * blind "Starting…" spinner: it polls workflowBuilder.logs() during the
 * pending start() and renders the lines.
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkflowProPanel } from '../src/renderer/components/WorkflowProPanel';

describe('WorkflowProPanel boot log streaming', () => {
  let container: HTMLDivElement;
  let root: Root;
  let resolveStart: (v: unknown) => void;
  let logLines: string[];

  beforeEach(() => {
    (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true;
    // Keep actual iframe attributes testable without navigating to any local service.
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() === 'iframe') element.setAttribute('srcdoc', '<html></html>');
      return element;
    });
    logLines = [];
    resolveStart = () => {};
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      openExternal: vi.fn(async () => true),
      workflowBuilder: {
        status: vi.fn(async () => ({ running: false, port: 8080 })),
        start: vi.fn(() => new Promise((resolve) => { resolveStart = resolve; })),
        stop: vi.fn(async () => ({ success: true })),
        logs: vi.fn(async () => ({ lines: logLines })),
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls and renders boot log lines while the server starts', async () => {
    vi.useFakeTimers();
    act(() => {
      root.render(<WorkflowProPanel />);
    });

    // Click "Start Server" — start() stays pending (loading = true).
    const startBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Start Server')
    )!;
    expect(startBtn).toBeTruthy();
    await act(async () => {
      startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Server produces boot lines; the poll interval fires.
    logLines = ['Starting WorkflowBuilder (npm run dev)…', 'vite v5 building…', 'Local: http://localhost:8080'];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    const panel = container.querySelector('[data-testid="workflow-boot-log"]');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain('vite v5 building');
    expect(panel!.textContent).toContain('Local: http://localhost:8080');

    // Settle the pending start so cleanup is clean.
    await act(async () => {
      resolveStart({ success: true });
    });
  });

  it('uses the configured URL and offers no Stop for an externally managed editor', async () => {
    vi.mocked(window.electronAPI.workflowBuilder.status).mockResolvedValue({
      running: true, port: 18080, url: 'http://127.0.0.1:18080/editor/', managed: false, external: true,
    });
    await act(async () => { root.render(<WorkflowProPanel />); });
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('http://127.0.0.1:18080/editor/');
    expect(container.textContent).toContain('Externally managed');
    expect([...container.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Stop')).toBe(false);
  });

  it('offers Connect for an offline external editor and displays connection failure', async () => {
    vi.mocked(window.electronAPI.workflowBuilder.status).mockResolvedValue({
      running: false, port: 18080, url: 'http://127.0.0.1:18080/', managed: false, external: true,
    });
    vi.mocked(window.electronAPI.workflowBuilder.start).mockResolvedValue({ success: false, error: 'Not the WorkflowBuilder editor' });
    await act(async () => { root.render(<WorkflowProPanel />); });
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Connect')!;
    expect(button).toBeTruthy();
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Not the WorkflowBuilder editor');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('shows failure when an owned process has not stopped', async () => {
    vi.mocked(window.electronAPI.workflowBuilder.status).mockResolvedValue({ running: true, port: 8080, managed: true });
    vi.mocked(window.electronAPI.workflowBuilder.stop).mockResolvedValue({ success: false, error: 'Owned process has not exited yet' });
    await act(async () => { root.render(<WorkflowProPanel />); });
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Stop')!;
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.textContent).toContain('Owned process has not exited yet');
  });


  it('respects framing restrictions and opens the configured editor through the browser bridge', async () => {
    vi.mocked(window.electronAPI.workflowBuilder.status).mockResolvedValue({
      running: true, port: 18080, url: 'http://127.0.0.1:18080/', managed: false, external: true, embeddable: false,
    });
    await act(async () => { root.render(<WorkflowProPanel />); });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('security policy prevents embedding');
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Open in browser')!;
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(window.electronAPI.openExternal).toHaveBeenCalledWith('http://127.0.0.1:18080/');
    expect(window.electronAPI.workflowBuilder.stop).not.toHaveBeenCalled();
  });


  it('still offers Stop for an owned process whose editor is unavailable', async () => {
    vi.mocked(window.electronAPI.workflowBuilder.status).mockResolvedValue({ running: false, port: 8080, managed: true });
    await act(async () => { root.render(<WorkflowProPanel />); });
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Stop')).toBe(true);
  });

});
