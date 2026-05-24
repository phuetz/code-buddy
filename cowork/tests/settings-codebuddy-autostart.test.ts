/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsCodeBuddy } from '../src/renderer/components/settings/SettingsCodeBuddy';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SettingsCodeBuddy auto-start connection test', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('starts the local Code Buddy backend when the health probe is unreachable', async () => {
    const serverStart = vi.fn().mockResolvedValue({
      running: true,
      port: 3000,
      host: '127.0.0.1',
      startedAt: Date.now(),
      websocket: true,
      error: null,
    });
    (window as unknown as {
      electronAPI?: {
        config: { get: () => Promise<Record<string, unknown>> };
        server: { start: typeof serverStart };
      };
    }).electronAPI = {
      config: {
        get: vi.fn().mockResolvedValue({}),
      },
      server: {
        start: serverStart,
      },
    };

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ version: '1.0.0-test' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-test' }] }))
      .mockResolvedValueOnce(jsonResponse({ toolCount: 110 }));
    vi.stubGlobal('fetch', fetchMock);

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SettingsCodeBuddy));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(target.textContent).toContain('buddy server');

    const testButton = Array.from(target.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Test Connection'));
    expect(testButton).toBeTruthy();

    await act(async () => {
      Simulate.click(testButton as HTMLButtonElement);
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(serverStart).toHaveBeenCalledWith({ host: '127.0.0.1', port: 3000 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(target.textContent).toContain('Connected to Code Buddy');
    expect(target.textContent).toContain('Started local Code Buddy backend automatically.');
    expect(target.textContent).toContain('Version: 1.0.0-test');
  });

  it('loads remote models into the override selector and saves the selected model', async () => {
    const configSave = vi.fn().mockResolvedValue(undefined);
    (window as unknown as {
      electronAPI?: {
        config: {
          get: () => Promise<Record<string, unknown>>;
          save: typeof configSave;
        };
      };
    }).electronAPI = {
      config: {
        get: vi.fn().mockResolvedValue({
          codebuddy: {
            enabled: true,
            endpoint: 'http://100.73.222.64:3000',
            model: '',
          },
        }),
        save: configSave,
      },
    };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ version: 'remote-test' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-remote' }, { id: 'qwen-remote:32b' }] }))
      .mockResolvedValueOnce(jsonResponse({ toolCount: 118 }));
    vi.stubGlobal('fetch', fetchMock);

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SettingsCodeBuddy));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const testButton = Array.from(target.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Test Connection'));
    expect(testButton).toBeTruthy();

    await act(async () => {
      Simulate.click(testButton as HTMLButtonElement);
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const modelSelect = target.querySelector('select') as HTMLSelectElement | null;
    expect(modelSelect).toBeTruthy();
    expect(Array.from(modelSelect?.options ?? []).map(option => option.value)).toContain('qwen-remote:32b');

    await act(async () => {
      if (!modelSelect) throw new Error('model select missing');
      modelSelect.value = 'qwen-remote:32b';
      Simulate.change(modelSelect, { target: { value: 'qwen-remote:32b' } } as unknown as Event);
    });

    const saveButton = Array.from(target.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Save');
    expect(saveButton).toBeTruthy();

    await act(async () => {
      Simulate.click(saveButton as HTMLButtonElement);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(configSave).toHaveBeenCalledWith(expect.objectContaining({
      codebuddy: expect.objectContaining({
        endpoint: 'http://100.73.222.64:3000',
        model: 'qwen-remote:32b',
      }),
    }));
  });
});
