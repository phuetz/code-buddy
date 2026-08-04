/** Validation and pure patching for operator-exported ComfyUI API workflows. */

export type WorkflowPatchRole =
  | 'seed'
  | 'prompt'
  | 'insertPrompt'
  | 'negative'
  | 'inputImage'
  | 'characterImage'
  | 'locationImage'
  | 'endImage'
  | 'inputVideo'
  | 'frames'
  | 'resolution'
  | 'outputPrefix';

export interface ComfyWorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export type ComfyWorkflowGraph = Record<string, ComfyWorkflowNode>;

export interface TemplateClassRequirement {
  classType: string;
  /** Exact number of nodes of this class required in the exported graph. */
  count: number;
}

export interface TemplateRoleSelector {
  classType: string;
  input: string;
  /** Required when the class occurs more than once and only one node is patched. */
  title?: string;
  /** Patch every matching node. The contract can still require an exact count. */
  all?: boolean;
}

export interface TemplateContract {
  id:
    | 'keyframe-flux'
    | 'insert-qwen-edit'
    | 'insert-qwen-edit-relight'
    | 'i2v-wan-lightx2v'
    | 'i2v-wan-flf2v'
    | 'upscale-seedvr2'
    | 'interpolate-rife';
  required: readonly TemplateClassRequirement[];
  roles: Readonly<Partial<Record<WorkflowPatchRole, readonly TemplateRoleSelector[]>>>;
}

export interface TemplateRoleBinding {
  nodeId: string;
  input: string;
}

export interface LoadedWorkflowTemplate {
  graph: ComfyWorkflowGraph;
  contract: TemplateContract;
  roleBindings: Readonly<Partial<Record<WorkflowPatchRole, readonly TemplateRoleBinding[]>>>;
}

export type WorkflowPatch =
  | { role: 'seed'; value: number }
  | {
      role:
        | 'prompt'
        | 'insertPrompt'
        | 'negative'
        | 'inputImage'
        | 'characterImage'
        | 'locationImage'
        | 'endImage'
        | 'inputVideo'
        | 'outputPrefix';
      value: string;
    }
  | { role: 'frames'; value: number }
  | { role: 'resolution'; value: { width: number; height: number } | number };

const KEYFRAME_FLUX_CONTRACT: TemplateContract = {
  id: 'keyframe-flux',
  required: [
    { classType: 'CLIPTextEncode', count: 2 },
    { classType: 'RandomNoise', count: 1 },
    { classType: 'EmptySD3LatentImage', count: 1 },
    { classType: 'SaveImage', count: 1 },
  ],
  roles: {
    seed: [{ classType: 'RandomNoise', input: 'noise_seed' }],
    prompt: [{ classType: 'CLIPTextEncode', input: 'text', title: 'Positive Prompt' }],
    negative: [{ classType: 'CLIPTextEncode', input: 'text', title: 'Negative Prompt' }],
    resolution: [
      { classType: 'EmptySD3LatentImage', input: 'width' },
      { classType: 'EmptySD3LatentImage', input: 'height' },
    ],
    outputPrefix: [{ classType: 'SaveImage', input: 'filename_prefix' }],
  },
};

const I2V_BASE_REQUIRED: readonly TemplateClassRequirement[] = [
  { classType: 'WanVideoModelLoader', count: 2 },
  { classType: 'WanVideoSampler', count: 2 },
  { classType: 'WanVideoImageToVideoEncode', count: 1 },
  { classType: 'WanVideoTextEncode', count: 1 },
  { classType: 'LoadImage', count: 1 },
  { classType: 'VHS_VideoCombine', count: 1 },
];

const I2V_BASE_ROLES: TemplateContract['roles'] = {
  seed: [{ classType: 'WanVideoSampler', input: 'seed', all: true }],
  prompt: [{ classType: 'WanVideoTextEncode', input: 'positive_prompt' }],
  negative: [{ classType: 'WanVideoTextEncode', input: 'negative_prompt' }],
  inputImage: [{ classType: 'LoadImage', input: 'image' }],
  frames: [{ classType: 'WanVideoImageToVideoEncode', input: 'num_frames' }],
  resolution: [
    { classType: 'WanVideoImageToVideoEncode', input: 'width' },
    { classType: 'WanVideoImageToVideoEncode', input: 'height' },
  ],
  outputPrefix: [{ classType: 'VHS_VideoCombine', input: 'filename_prefix' }],
};

export const KEYFRAME_FLUX_TEMPLATE_CONTRACT = KEYFRAME_FLUX_CONTRACT;
export const I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT: TemplateContract = {
  id: 'i2v-wan-lightx2v', required: I2V_BASE_REQUIRED, roles: I2V_BASE_ROLES,
};
export const I2V_WAN_FLF2V_TEMPLATE_CONTRACT: TemplateContract = {
  id: 'i2v-wan-flf2v',
  required: I2V_BASE_REQUIRED.map((requirement) => (
    requirement.classType === 'LoadImage' ? { ...requirement, count: 2 } : requirement
  )),
  roles: {
    ...I2V_BASE_ROLES,
    inputImage: [{ classType: 'LoadImage', input: 'image', title: 'Start Image' }],
    endImage: [{ classType: 'LoadImage', input: 'image', title: 'End Image' }],
  },
};
export const UPSCALE_SEEDVR2_TEMPLATE_CONTRACT: TemplateContract = {
  id: 'upscale-seedvr2',
  required: [
    { classType: 'VHS_LoadVideo', count: 1 },
    { classType: 'SeedVR2LoadDiTModel', count: 1 },
    { classType: 'SeedVR2LoadVAEModel', count: 1 },
    { classType: 'SeedVR2VideoUpscaler', count: 1 },
    { classType: 'VHS_VideoCombine', count: 1 },
  ],
  roles: {
    seed: [{ classType: 'SeedVR2VideoUpscaler', input: 'seed' }],
    inputVideo: [{ classType: 'VHS_LoadVideo', input: 'video' }],
    frames: [{ classType: 'SeedVR2VideoUpscaler', input: 'batch_size' }],
    resolution: [{ classType: 'SeedVR2VideoUpscaler', input: 'resolution' }],
    outputPrefix: [{ classType: 'VHS_VideoCombine', input: 'filename_prefix' }],
  },
};
export const INTERPOLATE_RIFE_TEMPLATE_CONTRACT: TemplateContract = {
  id: 'interpolate-rife',
  required: [
    { classType: 'VHS_LoadVideo', count: 1 },
    { classType: 'RIFE VFI', count: 1 },
    { classType: 'VHS_VideoCombine', count: 1 },
  ],
  roles: {
    inputVideo: [{ classType: 'VHS_LoadVideo', input: 'video' }],
    frames: [{ classType: 'RIFE VFI', input: 'multiplier' }],
    outputPrefix: [{ classType: 'VHS_VideoCombine', input: 'filename_prefix' }],
  },
};

export const TEMPLATE_CONTRACTS = {
  'keyframe-flux': KEYFRAME_FLUX_TEMPLATE_CONTRACT,
  'i2v-wan-lightx2v': I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT,
  'i2v-wan-flf2v': I2V_WAN_FLF2V_TEMPLATE_CONTRACT,
  'upscale-seedvr2': UPSCALE_SEEDVR2_TEMPLATE_CONTRACT,
  'interpolate-rife': INTERPOLATE_RIFE_TEMPLATE_CONTRACT,
} as const;

function cloneGraph(graph: ComfyWorkflowGraph): ComfyWorkflowGraph {
  return structuredClone(graph);
}

function parseGraph(json: unknown): ComfyWorkflowGraph {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('ComfyUI API workflow must be an object keyed by node id');
  }
  const graph = json as Record<string, unknown>;
  if (Object.keys(graph).length === 0) throw new Error('ComfyUI API workflow must contain nodes');
  for (const [nodeId, candidate] of Object.entries(graph)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`ComfyUI API workflow node ${nodeId} must be an object`);
    }
    const node = candidate as Partial<ComfyWorkflowNode>;
    if (typeof node.class_type !== 'string' || !node.class_type.trim()) {
      throw new Error(`ComfyUI API workflow node ${nodeId} is missing class_type`);
    }
    if (!node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) {
      throw new Error(`ComfyUI API workflow node ${nodeId} is missing inputs`);
    }
  }
  return cloneGraph(graph as ComfyWorkflowGraph);
}

function nodesOfClass(graph: ComfyWorkflowGraph, classType: string): Array<[string, ComfyWorkflowNode]> {
  return Object.entries(graph).filter((entry) => entry[1].class_type === classType);
}

export function loadWorkflowTemplate(json: unknown, contract: TemplateContract): LoadedWorkflowTemplate {
  const graph = parseGraph(json);
  for (const requirement of contract.required) {
    const actual = nodesOfClass(graph, requirement.classType).length;
    if (actual !== requirement.count) {
      throw new Error(
        `Template ${contract.id} requires exactly ${requirement.count} ${requirement.classType} node(s); found ${actual}`,
      );
    }
  }

  const roleBindings: Partial<Record<WorkflowPatchRole, readonly TemplateRoleBinding[]>> = {};
  for (const [role, selectors] of Object.entries(contract.roles) as Array<[WorkflowPatchRole, readonly TemplateRoleSelector[]]>) {
    const bindings: TemplateRoleBinding[] = [];
    for (const selector of selectors) {
      let candidates = nodesOfClass(graph, selector.classType);
      if (selector.title) {
        candidates = candidates.filter(([, node]) => node._meta?.title === selector.title);
      } else if (!selector.all && candidates.length > 1) {
        throw new Error(
          `Template ${contract.id} role ${role} is ambiguous for ${selector.classType}; disambiguate with _meta.title`,
        );
      }
      if (candidates.length === 0) {
        throw new Error(
          `Template ${contract.id} cannot resolve role ${role} to ${selector.classType}` +
          (selector.title ? ` titled "${selector.title}"` : ''),
        );
      }
      for (const [nodeId, node] of candidates) {
        if (!(selector.input in node.inputs)) {
          throw new Error(
            `Template ${contract.id} role ${role} expects input ${selector.input} on node ${nodeId} (${selector.classType})`,
          );
        }
        bindings.push({ nodeId, input: selector.input });
      }
    }
    roleBindings[role] = bindings;
  }
  return { graph, contract, roleBindings };
}

function assertInteger(value: number, role: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${role} patch must be a non-negative safe integer`);
}

export function patchWorkflow(
  template: LoadedWorkflowTemplate,
  patches: readonly WorkflowPatch[],
): ComfyWorkflowGraph {
  const graph = cloneGraph(template.graph);
  for (const patch of patches) {
    const bindings = template.roleBindings[patch.role];
    if (!bindings || bindings.length === 0) {
      throw new Error(`Template ${template.contract.id} does not resolve patch role ${patch.role}`);
    }
    if (patch.role === 'seed' || patch.role === 'frames') assertInteger(patch.value, patch.role);
    if (patch.role === 'resolution') {
      const dimensions = typeof patch.value === 'number'
        ? { width: patch.value, height: patch.value }
        : patch.value;
      assertInteger(dimensions.width, 'resolution width');
      assertInteger(dimensions.height, 'resolution height');
      for (const binding of bindings) {
        const node = graph[binding.nodeId]!;
        node.inputs[binding.input] = binding.input === 'height' ? dimensions.height : dimensions.width;
      }
      continue;
    }
    for (const binding of bindings) graph[binding.nodeId]!.inputs[binding.input] = patch.value;
  }
  return graph;
}

export function assertAllSeedsPinned(graph: ComfyWorkflowGraph): void {
  for (const [nodeId, node] of Object.entries(graph)) {
    for (const input of ['seed', 'noise_seed'] as const) {
      if (!(input in node.inputs)) continue;
      const value = node.inputs[input];
      if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`ComfyUI workflow seed ${nodeId}.${input} must be explicitly pinned to a non-negative integer`);
      }
    }
  }
}
