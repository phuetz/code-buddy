import type { FlowCameraMove, FlowIngredient, FlowMediaMode, FlowReferenceMode, FlowScene } from './flow-studio-model';
import type { FlowPresetId } from './flow-studio-presets';

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
  narration?: string;
  voiceLocale?: string;
  voiceProfileId?: string;
  presetId?: FlowPresetId;
  publication?: boolean;
  editorialTitle?: string;
  editorialDescription?: string;
  seriesName?: string;
  syntheticMediaDisclosure?: boolean;
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
      const projects = parsed.projects.map(sanitizeProject).filter((project): project is FlowProjectSnapshot => Boolean(project));
      return projects.length ? { version: 1, activeId: parsed.activeId ?? projects[0]!.id, projects } : null;
    }
    if (Array.isArray(parsed.scenes) && Array.isArray(parsed.ingredients)) {
      const legacy = sanitizeProject({ ...parsed, id: parsed.id ?? 'flow-project-legacy' });
      if (!legacy) return null;
      return { version: 1, activeId: legacy.id, projects: [legacy] };
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizeProject(value: unknown): FlowProjectSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const text = (field: string, max: number, fallback = '') => typeof item[field] === 'string'
    ? (item[field] as string).slice(0, max)
    : fallback;
  const mode = item.mode === 'image' || item.mode === 'video' ? item.mode : 'video';
  const referenceMode = item.referenceMode === 'ingredients' || item.referenceMode === 'frames' ? item.referenceMode : 'text';
  const aspect = item.aspect === '1:1' || item.aspect === '9:16' ? item.aspect : '16:9';
  const camera = item.camera === 'pan-left' || item.camera === 'dolly-back' || item.camera === 'orbit' ? item.camera : 'static';
  const ingredients = Array.isArray(item.ingredients)
    ? item.ingredients.slice(0, 500).filter((ingredient): ingredient is FlowIngredient => Boolean(
      ingredient && typeof ingredient === 'object'
      && typeof (ingredient as FlowIngredient).id === 'string'
      && typeof (ingredient as FlowIngredient).name === 'string'
      && typeof (ingredient as FlowIngredient).url === 'string',
    ))
    : [];
  const scenes = Array.isArray(item.scenes)
    ? item.scenes.slice(0, 200).filter((scene): scene is FlowScene => Boolean(
      scene && typeof scene === 'object'
      && typeof (scene as FlowScene).id === 'string'
      && typeof (scene as FlowScene).prompt === 'string'
      && typeof (scene as FlowScene).title === 'string',
    ))
    : [];
  if (!scenes.length) return null;
  const id = text('id', 160);
  if (!id) return null;
  const selectedSceneId = text('selectedSceneId', 160, scenes[0]!.id);
  return {
    version: 1,
    id,
    name: text('name', 200, 'Projet sans titre'),
    mode,
    referenceMode,
    ingredients,
    selectedIngredientIds: Array.isArray(item.selectedIngredientIds)
      ? item.selectedIngredientIds.filter((entry): entry is string => typeof entry === 'string').slice(0, 500)
      : [],
    scenes,
    selectedSceneId: scenes.some((scene) => scene.id === selectedSceneId) ? selectedSceneId : scenes[0]!.id,
    prompt: text('prompt', 20_000),
    aspect,
    duration: clampNumber(item.duration, 1, 30, 6),
    outputs: clampNumber(item.outputs, 1, mode === 'image' ? 4 : 2, 1),
    camera,
    audioEnabled: item.audioEnabled !== false,
    voiceEnabled: item.voiceEnabled === true,
    narration: text('narration', 4_000),
    voiceLocale: text('voiceLocale', 40, 'fr-FR'),
    voiceProfileId: text('voiceProfileId', 120),
    ...(typeof item.startFrameId === 'string' ? { startFrameId: item.startFrameId.slice(0, 160) } : {}),
    ...(typeof item.endFrameId === 'string' ? { endFrameId: item.endFrameId.slice(0, 160) } : {}),
    ...(typeof item.presetId === 'string' ? { presetId: item.presetId as FlowPresetId } : {}),
    publication: item.publication === true,
    editorialTitle: text('editorialTitle', 100),
    editorialDescription: text('editorialDescription', 1_000),
    seriesName: text('seriesName', 80),
    syntheticMediaDisclosure: item.syntheticMediaDisclosure !== false,
    savedAt: typeof item.savedAt === 'number' && Number.isFinite(item.savedAt) ? item.savedAt : Date.now(),
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;
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
