// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskModelSettingsView } from '../../shared/task-models-types';
import { useAppStore } from '../store';
import { TaskModelsPanel } from './TaskModelsPanel';

const settings: TaskModelSettingsView = {
  configPath: '/tmp/config.toml',
  defaultModel: 'default-model',
  taskTypes: [
    { type: 'architect', label: 'Architecture', description: 'Plan and design.' },
    { type: 'edit', label: 'Editing', description: 'Change code.' },
    { type: 'review', label: 'Review', description: 'Review code.' },
    { type: 'research', label: 'Research', description: 'Find evidence.' },
    { type: 'chat', label: 'Chat', description: 'General conversation.' },
  ],
  mappings: { review: 'review-v1' },
  legacyMappings: { architect: 'legacy-thinker', edit: 'legacy-editor' },
  effectiveMappings: { review: 'review-v1' },
  models: [
    { id: 'review-v1', key: 'review', provider: 'openai', label: 'Review model' },
    { id: 'research-v1', key: 'research', provider: 'google', label: 'Research model' },
  ],
};

function makeApi() {
  return {
    get: vi.fn().mockResolvedValue({ ok: true, settings }),
    save: vi.fn().mockImplementation(async (mappings) => ({
      ok: true,
      settings: {
        ...settings,
        mappings: Object.fromEntries(
          Object.entries(mappings).filter((entry) => Boolean(entry[1])),
        ),
      },
    })),
  };
}

describe('TaskModelsPanel', () => {
  beforeEach(() => {
    useAppStore.setState({ showTaskModelsPanel: true });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ showTaskModelsPanel: false });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.restoreAllMocks();
  });

  it('shows dormant legacy values and saves explicit active-model choices', async () => {
    const api = makeApi();
    (window as unknown as { electronAPI: { taskModels: typeof api } }).electronAPI = {
      taskModels: api,
    };
    render(<TaskModelsPanel />);

    expect(await screen.findByText('Models by task type')).toBeTruthy();
    expect(screen.getByText('Legacy [model_pairs] (inactive for main chat): legacy-thinker')).toBeTruthy();
    fireEvent.change(screen.getByTestId('task-model-select-research'), {
      target: { value: 'research-v1' },
    });
    fireEvent.click(screen.getByTestId('task-models-save'));

    await waitFor(() => expect(api.save).toHaveBeenCalledWith({
      architect: null,
      edit: null,
      review: 'review-v1',
      research: 'research-v1',
      chat: null,
    }));
    expect(await screen.findByText('Saved. New turns use the updated map.')).toBeTruthy();
  });

  it('closes through the store flag', async () => {
    const api = makeApi();
    (window as unknown as { electronAPI: { taskModels: typeof api } }).electronAPI = {
      taskModels: api,
    };
    render(<TaskModelsPanel />);
    await screen.findByText('Models by task type');

    fireEvent.click(screen.getByLabelText('Close task models'));

    expect(useAppStore.getState().showTaskModelsPanel).toBe(false);
  });
});
