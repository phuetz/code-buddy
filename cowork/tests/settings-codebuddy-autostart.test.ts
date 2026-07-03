/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsCodeBuddy } from '../src/renderer/components/settings/SettingsCodeBuddy';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setElectronApi(api: unknown) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
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
    const probeConnection = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        version: '1.0.0-test',
        models: ['gpt-test'],
        tools: 110,
      });

    setElectronApi({
      codebuddy: {
        probeConnection,
      },
      config: {
        get: vi.fn().mockResolvedValue({}),
      },
      server: {
        start: serverStart,
      },
    });

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
    expect(probeConnection).toHaveBeenCalledTimes(2);
    expect(probeConnection).toHaveBeenLastCalledWith({
      endpoint: 'http://localhost:3000',
      apiKey: undefined,
    });
    expect(target.textContent).toContain('Connected to Code Buddy');
    expect(target.textContent).toContain('Started local Code Buddy backend automatically.');
    expect(target.textContent).toMatch(/Version:\s*1\.0\.0-test/);
  });

  it('loads remote models into the override selector and saves the selected model', async () => {
    const configSave = vi.fn().mockResolvedValue(undefined);
    const listModels = vi.fn().mockResolvedValue([
      { id: 'gpt-remote' },
      { id: 'qwen-remote:32b' },
    ]);

    setElectronApi({
      codebuddy: {
        listModels,
      },
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
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SettingsCodeBuddy));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const refreshModelsButton = target.querySelector('[data-testid="codebuddy-models-refresh"]');
    expect(refreshModelsButton).toBeTruthy();

    await act(async () => {
      Simulate.click(refreshModelsButton as HTMLButtonElement);
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(listModels).toHaveBeenCalledWith({
      endpoint: 'http://100.73.222.64:3000',
      apiKey: undefined,
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

  it('does not auto-start the local backend for remote endpoints', async () => {
    const serverStart = vi.fn().mockResolvedValue({
      running: true,
      port: 3000,
      host: '127.0.0.1',
      startedAt: Date.now(),
      websocket: true,
      error: null,
    });
    const probeConnection = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    setElectronApi({
      codebuddy: {
        probeConnection,
      },
      config: {
        get: vi.fn().mockResolvedValue({
          codebuddy: {
            enabled: true,
            endpoint: 'http://100.73.222.64:3000',
          },
        }),
      },
      server: {
        start: serverStart,
      },
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(SettingsCodeBuddy));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await act(async () => {
      Simulate.click(target.querySelector('[data-testid="codebuddy-test-connection"]') as HTMLButtonElement);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(serverStart).not.toHaveBeenCalled();
    expect(target.textContent).toContain('Connection Failed');
    expect(target.textContent).toContain('Failed to fetch');
  });
});
