/** Qwen-Image-Edit contract and deterministic patching for person/scene composition. */

import {
  assertAllSeedsPinned,
  loadWorkflowTemplate,
  patchWorkflow,
  type ComfyWorkflowGraph,
  type TemplateContract,
} from './comfy-workflow-template.js';

/** Canonical empty-environment ids used by character-in-location insertion. */
export const SIGNATURE_LOCATION_IDS = [
  'european-street-goldenhour',
  'stone-staircase',
  'balustrade-terrace',
  'cozy-loft-interior',
  'corner-cafe',
  'rooftop-dusk',
] as const;

export type SignatureLocationId = (typeof SIGNATURE_LOCATION_IDS)[number];

export interface SignatureLocation {
  readonly locationId: SignatureLocationId;
  readonly label?: string;
  readonly description?: string;
  readonly lightingSpec?: string;
  readonly paletteTag?: string;
}

const KNOWN_LOCATION_IDS: ReadonlySet<string> = new Set(SIGNATURE_LOCATION_IDS);

export type InsertionLocation = SignatureLocation | SignatureLocationId | 'custom-plate';

export interface InsertionPromptOptions {
  /** Preserve the source pose. Enabled by default. */
  preservePose?: boolean;
  /** Preserve the subject's apparent scale. Enabled by default. */
  preserveScale?: boolean;
  /** Require a measurable frontal face when a distant placement is unsafe. */
  frontalMedium?: boolean;
}

export interface CharacterInLocationWorkflowInput {
  characterImage: string;
  locationImage: string;
  location: InsertionLocation;
  seed: number;
  outputPrefix: string;
  promptOptions?: InsertionPromptOptions;
}

export interface FaceProtectedCharacterInLocationWorkflowInput
  extends CharacterInLocationWorkflowInput {
  /** White where Qwen may sample; black over the canonical face. */
  editMaskImage: string;
}

export const INSERT_QWEN_TEMPLATE_CONTRACT: TemplateContract = Object.freeze({
  id: 'insert-qwen-edit',
  required: Object.freeze([
    { classType: 'LoadImage', count: 2 },
    { classType: 'TextEncodeQwenImageEditPlus', count: 1 },
    { classType: 'UnetLoaderGGUF', count: 1 },
    { classType: 'KSampler', count: 1 },
    { classType: 'SaveImage', count: 1 },
  ]),
  roles: Object.freeze({
    characterImage: [{ classType: 'LoadImage', input: 'image', title: 'Character' }],
    locationImage: [{ classType: 'LoadImage', input: 'image', title: 'Location' }],
    insertPrompt: [{ classType: 'TextEncodeQwenImageEditPlus', input: 'prompt' }],
    seed: [{ classType: 'KSampler', input: 'seed' }],
    outputPrefix: [{ classType: 'SaveImage', input: 'filename_prefix' }],
  }),
});

/** Operator-exported variant whose connected graph applies BiRefNet + IC-Light fbc. */
export const INSERT_QWEN_RELIGHT_TEMPLATE_CONTRACT: TemplateContract = Object.freeze({
  ...INSERT_QWEN_TEMPLATE_CONTRACT,
  id: 'insert-qwen-edit-relight',
  required: Object.freeze([
    ...INSERT_QWEN_TEMPLATE_CONTRACT.required,
    { classType: 'RembgByBiRefNet', count: 1 },
    { classType: 'LoadAndApplyICLightUnet', count: 1 },
  ]),
});

function locationIdOf(location: InsertionLocation): SignatureLocationId | 'custom-plate' {
  return typeof location === 'string' ? location : location.locationId;
}

function assertKnownLocation(location: InsertionLocation): void {
  const locationId = locationIdOf(location);
  if (locationId !== 'custom-plate' && !KNOWN_LOCATION_IDS.has(locationId)) {
    throw new Error(`Unknown signature location: ${locationId}`);
  }
}

/**
 * Build a deliberately scene-agnostic edit instruction. The location argument
 * is validated, but no catalog prose is copied into the prompt: image 2 is the
 * only source of decor, lighting, and perspective.
 */
export function buildInsertionPrompt(
  location: InsertionLocation,
  options: InsertionPromptOptions = {},
): string {
  assertKnownLocation(location);
  const identityParts = ['identity'];
  if (options.preservePose !== false) identityParts.push('pose');
  if (options.preserveScale !== false) identityParts.push('scale');
  return [
    'place the woman from image 1 into the scene from image 2',
    `keep her ${identityParts.join('/')}`,
    ...(options.frontalMedium
      ? ['show her clearly in a frontal medium shot looking directly at camera']
      : []),
    'match the scene lighting and perspective',
    'photorealistic',
  ].join(', ');
}

/** Validate an operator export, patch every addressable role, and pin all seeds. */
export function buildCharacterInLocationWorkflow(
  templateJson: unknown,
  input: CharacterInLocationWorkflowInput,
  contract: TemplateContract = INSERT_QWEN_TEMPLATE_CONTRACT,
): ComfyWorkflowGraph {
  const template = loadWorkflowTemplate(templateJson, contract);
  const graph = patchWorkflow(template, [
    { role: 'characterImage', value: input.characterImage },
    { role: 'locationImage', value: input.locationImage },
    { role: 'insertPrompt', value: buildInsertionPrompt(input.location, input.promptOptions) },
    { role: 'seed', value: input.seed },
    { role: 'outputPrefix', value: input.outputPrefix },
  ]);
  assertAllSeedsPinned(graph);
  return graph;
}

function uniqueNodeId(graph: ComfyWorkflowGraph, classType: string): string {
  const matches = Object.entries(graph)
    .filter(([, node]) => node.class_type === classType)
    .map(([nodeId]) => nodeId);
  if (matches.length !== 1) {
    throw new Error(`Face-protected insertion requires exactly 1 ${classType} node; found ${matches.length}`);
  }
  return matches[0]!;
}

function nextNodeIds(graph: ComfyWorkflowGraph, count: number): string[] {
  const numericIds = Object.keys(graph)
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  let candidate = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
  const values: string[] = [];
  while (values.length < count) {
    const id = String(candidate);
    if (!graph[id]) values.push(id);
    candidate += 1;
  }
  return values;
}

/**
 * Add the same latent-mask + exact recomposition discipline as wardrobe repair.
 * The supplied location image is already a draft containing canonical face
 * pixels.  Qwen may resample every white part of editMaskImage, but the final
 * ImageCompositeMasked restores the black face region from that draft.
 */
export function buildFaceProtectedCharacterInLocationWorkflow(
  templateJson: unknown,
  input: FaceProtectedCharacterInLocationWorkflowInput,
  contract: TemplateContract = INSERT_QWEN_TEMPLATE_CONTRACT,
): ComfyWorkflowGraph {
  const graph = buildCharacterInLocationWorkflow(templateJson, input, contract);
  const locationNodeId = Object.entries(graph).find(([, node]) => (
    node.class_type === 'LoadImage' && node._meta?.title === 'Location'
  ))?.[0];
  if (!locationNodeId) throw new Error('Face-protected insertion cannot resolve the Location image');
  const encoderId = uniqueNodeId(graph, 'TextEncodeQwenImageEditPlus');
  const vaeEncodeId = uniqueNodeId(graph, 'VAEEncode');
  const samplerId = uniqueNodeId(graph, 'KSampler');
  const vaeDecodeId = uniqueNodeId(graph, 'VAEDecode');
  const saveId = uniqueNodeId(graph, 'SaveImage');
  const [maskImageId, imageToMaskId, latentMaskId, finalMaskId, compositeId] = nextNodeIds(graph, 5);
  graph[maskImageId!] = {
    class_type: 'LoadImage',
    inputs: { image: input.editMaskImage },
    _meta: { title: 'Face Edit Mask' },
  };
  graph[imageToMaskId!] = {
    class_type: 'ImageToMask',
    inputs: { image: [maskImageId, 0], channel: 'red' },
    _meta: { title: 'White permits sampling; black protects canonical face' },
  };
  graph[latentMaskId!] = {
    class_type: 'SetLatentNoiseMask',
    inputs: { samples: [vaeEncodeId, 0], mask: [imageToMaskId, 0] },
    _meta: { title: 'Never sample canonical face' },
  };
  graph[samplerId]!.inputs.latent_image = [latentMaskId, 0];
  graph[finalMaskId!] = {
    class_type: 'GrowMask',
    inputs: {
      mask: [imageToMaskId, 0],
      expand: -16,
      tapered_corners: true,
    },
    _meta: { title: 'Restore a clean margin around canonical face' },
  };
  graph[compositeId!] = {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: [locationNodeId, 0],
      source: [vaeDecodeId, 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: [finalMaskId, 0],
    },
    _meta: { title: 'Restore canonical face after decode' },
  };
  graph[saveId]!.inputs.images = [compositeId, 0];
  const prompt = graph[encoderId]!.inputs.prompt;
  graph[encoderId]!.inputs.prompt =
    `${typeof prompt === 'string' ? prompt : ''}, ` +
    'the face inside the protected region is final, keep both eyes/eyebrows/forehead/cheeks/mouth unobstructed, ' +
    'adapt hair/body/lighting around it without changing it or drawing a box/halo around it';
  assertAllSeedsPinned(graph);
  return graph;
}
