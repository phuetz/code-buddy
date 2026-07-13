import type { FlowCameraMove, FlowIngredient, FlowMediaMode, FlowReferenceMode, FlowScene } from './flow-studio-model';

const STORAGE_KEY = 'cowork.flowStudio.project.v1';

export interface FlowProjectSnapshot {
  version: 1;
  id: string;
  name: string;
  mode: FlowMediaMode;
  referenceMode: FlowReferenceMode;
  ingredients: FlowIngredient[];
  selectedIngredientIds: string[];
  scenes: FlowScene[];
  selectedSceneId: string;
  prompt: string;
  aspect: '1:1' | '16:9' | '9:16';
  duration: number;
  outputs: number;
  camera: FlowCameraMove;
  audioEnabled: boolean;
  voiceEnabled: boolean;
  startFrameId?: string;
  endFrameId?: string;
  savedAt: number;
}

interface FlowProjectWorkspace {
  version: 1;
  activeId: string;
  projects: FlowProjectSnapshot[];
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function readWorkspace(storage: ReadStorage | undefined): FlowProjectWorkspace | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as Partial<FlowProjectWorkspace & FlowProjectSnapshot> | null;
    if (!parsed || parsed.version !== 1) return null;
    if (Array.isArray(parsed.projects)) {
      const projects = parsed.projects.filter((project) => project && Array.isArray(project.scenes) && Array.isArray(project.ingredients));
      return projects.length ? { version: 1, activeId: parsed.activeId ?? projects[0]!.id, projects } : null;
    }
    if (Array.isArray(parsed.scenes) && Array.isArray(parsed.ingredients)) {
      const legacy = { ...parsed, id: parsed.id ?? 'flow-project-legacy' } as FlowProjectSnapshot;
      return { version: 1, activeId: legacy.id, projects: [legacy] };
    }
    return null;
  } catch {
    return null;
  }
}

function writeWorkspace(workspace: FlowProjectWorkspace, storage: WriteStorage | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // A full or privacy-restricted localStorage must never interrupt creation.
  }
}

export function loadFlowProject(storage: ReadStorage | undefined = globalThis.localStorage): FlowProjectSnapshot | null {
  const workspace = readWorkspace(storage);
  return workspace?.projects.find((project) => project.id === workspace.activeId) ?? workspace?.projects[0] ?? null;
}

export function loadFlowProjectById(id: string, storage: ReadStorage | undefined = globalThis.localStorage): FlowProjectSnapshot | null {
  return readWorkspace(storage)?.projects.find((project) => project.id === id) ?? null;
}

export function listFlowProjects(storage: ReadStorage | undefined = globalThis.localStorage): FlowProjectSnapshot[] {
  return [...(readWorkspace(storage)?.projects ?? [])].sort((left, right) => right.savedAt - left.savedAt);
}

export function saveFlowProject(project: FlowProjectSnapshot, storage: WriteStorage | undefined = globalThis.localStorage): void {
  const workspace = readWorkspace(storage) ?? { version: 1 as const, activeId: project.id, projects: [] };
  const projects = workspace.projects.some((candidate) => candidate.id === project.id)
    ? workspace.projects.map((candidate) => candidate.id === project.id ? project : candidate)
    : [...workspace.projects, project];
  writeWorkspace({ version: 1, activeId: project.id, projects }, storage);
}

export function activateFlowProject(id: string, storage: WriteStorage | undefined = globalThis.localStorage): FlowProjectSnapshot | null {
  const workspace = readWorkspace(storage);
  const project = workspace?.projects.find((candidate) => candidate.id === id);
  if (!workspace || !project) return null;
  writeWorkspace({ ...workspace, activeId: id }, storage);
  return project;
}

export function clearFlowProject(storage: WriteStorage | undefined = globalThis.localStorage): void {
  const workspace = readWorkspace(storage);
  if (!workspace) return;
  const projects = workspace.projects.filter((project) => project.id !== workspace.activeId);
  if (!projects.length) storage?.removeItem(STORAGE_KEY);
  else writeWorkspace({ version: 1, activeId: projects[0]!.id, projects }, storage);
}

export { STORAGE_KEY as FLOW_PROJECT_STORAGE_KEY };
