/** Declarative, local-only readiness contract for the Cowork ComfyUI laboratory. */

export type ComfyLabReadiness = 'ready' | 'partial' | 'missing';
export type ComfyLabRequirementKind = 'model' | 'node' | 'template';
export type ComfyLabUseCaseId =
  | 'book-visuals'
  | 'wan-animatic'
  | 'character-consistency'
  | 'ace-music'
  | 'avatar'
  | 'three-d';

export interface ComfyLabManifestRequirement {
  id: string;
  label: string;
  kind: ComfyLabRequirementKind;
  patterns: string[];
  required: boolean;
}

export interface ComfyLabUseCaseManifest {
  id: ComfyLabUseCaseId;
  priority: number;
  title: string;
  eyebrow: string;
  summary: string;
  deliverable: string;
  requirements: ComfyLabManifestRequirement[];
  cost: {
    api: string;
    compute: string;
    storage: string;
  };
  license: string;
  limits: string[];
  manualSteps: string[];
}

export interface ComfyLabRequirementView extends ComfyLabManifestRequirement {
  available: boolean;
  matches: string[];
  source: 'disk' | 'loopback' | 'loopback-unavailable';
}

export interface ComfyLabUseCaseView
  extends Omit<ComfyLabUseCaseManifest, 'requirements'> {
  readiness: ComfyLabReadiness;
  readinessReason: string;
  requirements: ComfyLabRequirementView[];
}

export interface ComfyLabSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  installation: {
    found: boolean;
    root?: string;
    source: 'COMFYUI_ROOT' | 'auto' | 'none';
    reason: string;
  };
  probe: {
    state: 'reachable' | 'unreachable';
    url: string;
    comfyuiVersion?: string;
    device?: {
      name: string;
      type: string;
    };
    cpuFallback: boolean;
    reason: string;
    scope: 'local' | 'remote';
  };
  inventory: {
    modelFiles: number;
    modelBytes: number;
    templates: number;
    nodes: number;
    truncated: boolean;
  };
  useCases: ComfyLabUseCaseView[];
  safety: {
    localOnly: boolean;
    implicitDownloads: false;
    implicitExecution: false;
    note: string;
  };
}

export interface ComfyLabSnapshotResult {
  ok: boolean;
  snapshot?: ComfyLabSnapshot;
  error?: string;
}

export interface ComfyLabActionResult {
  ok: boolean;
  message?: string;
  plan?: string;
  error?: string;
}

export interface ComfyLabCopyPlanInput {
  useCaseId: ComfyLabUseCaseId;
}

export interface ComfyLabApi {
  inspect: () => Promise<ComfyLabSnapshotResult>;
  openComfyUi: () => Promise<ComfyLabActionResult>;
  copyPlan: (input: ComfyLabCopyPlanInput) => Promise<ComfyLabActionResult>;
}

export const COMFY_LAB_CHANNELS = {
  inspect: 'comfyLab.inspect',
  openComfyUi: 'comfyLab.openComfyUi',
  copyPlan: 'comfyLab.copyPlan',
} as const;
