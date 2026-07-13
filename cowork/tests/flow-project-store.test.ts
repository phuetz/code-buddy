import { describe, expect, it } from 'vitest';
import { createFlowScene } from '../src/renderer/components/videostudio/flow-studio-model';
import { activateFlowProject, clearFlowProject, FLOW_PROJECT_STORAGE_KEY, listFlowProjects, loadFlowProject, saveFlowProject, type FlowProjectSnapshot } from '../src/renderer/components/videostudio/flow-project-store';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

const snapshot: FlowProjectSnapshot = {
  version: 1,
  id: 'neon-story',
  name: 'Neon Story',
  mode: 'video',
  referenceMode: 'frames',
  ingredients: [],
  selectedIngredientIds: [],
  scenes: [createFlowScene(1)],
  selectedSceneId: 'scene-1',
  prompt: 'Pluie néon',
  aspect: '16:9',
  duration: 6,
  outputs: 2,
  camera: 'dolly-back',
  audioEnabled: true,
  voiceEnabled: false,
  savedAt: 1,
};

describe('Flow project persistence', () => {
  it('round-trips a versioned project and clears it explicitly', () => {
    const storage = memoryStorage();
    saveFlowProject(snapshot, storage);
    expect(loadFlowProject(storage)).toMatchObject({ name: 'Neon Story', prompt: 'Pluie néon' });
    clearFlowProject(storage);
    expect(storage.values.has(FLOW_PROJECT_STORAGE_KEY)).toBe(false);
  });

  it('rejects malformed or unsupported snapshots', () => {
    const malformed = { getItem: () => '{oops' };
    const old = { getItem: () => JSON.stringify({ version: 0, scenes: [], ingredients: [] }) };
    expect(loadFlowProject(malformed)).toBeNull();
    expect(loadFlowProject(old)).toBeNull();
  });

  it('keeps multiple projects and switches the active project', () => {
    const storage = memoryStorage();
    saveFlowProject(snapshot, storage);
    saveFlowProject({ ...snapshot, id: 'second', name: 'Second', savedAt: 2 }, storage);
    expect(listFlowProjects(storage).map((project) => project.name)).toEqual(['Second', 'Neon Story']);
    expect(activateFlowProject('neon-story', storage)?.name).toBe('Neon Story');
    expect(loadFlowProject(storage)?.id).toBe('neon-story');
  });
});
