/** Qwen-Image-Edit contract and deterministic patching for person/scene composition. */

import {
  SIGNATURE_LOCATIONS,
  type SignatureLocation,
  type SignatureLocationId,
} from '../../companion/signature-locations.js';
import {
  assertAllSeedsPinned,
  loadWorkflowTemplate,
  patchWorkflow,
  type ComfyWorkflowGraph,
  type TemplateContract,
} from './comfy-workflow-template.js';

export type InsertionLocation = SignatureLocation | SignatureLocationId | 'custom-plate';

export interface InsertionPromptOptions {
  /** Preserve the source pose. Enabled by default. */
  preservePose?: boolean;
  /** Preserve the subject's apparent scale. Enabled by default. */
  preserveScale?: boolean;
}

export interface CharacterInLocationWorkflowInput {
  characterImage: string;
  locationImage: string;
  location: InsertionLocation;
  seed: number;
  outputPrefix: string;
  promptOptions?: InsertionPromptOptions;
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
  if (locationId !== 'custom-plate' && !SIGNATURE_LOCATIONS[locationId]) {
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
