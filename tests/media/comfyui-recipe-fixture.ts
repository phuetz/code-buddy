import type { ComfyUIRecipe } from '../../src/media/comfyui-recipe-contract.js';

export function recipeFixture(overrides: Record<string, unknown> = {}): unknown {
  const recipe = {
    schemaVersion: 1,
    id: 'image.test',
    version: '1.0.0',
    title: 'Test image recipe',
    modalities: ['text', 'image'],
    license: { spdx: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    commercialAllowed: true,
    workflow: {
      format: 'comfyui-api',
      nodes: {
        '1': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
        '2': {
          class_type: 'EmptyLatentImage',
          inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 },
        },
        '3': {
          class_type: 'KSampler',
          inputs: { seed: '{{seed}}', positive: ['1', 0], latent_image: ['2', 0] },
        },
        '4': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
      },
    },
    requirements: {
      nodes: [
        { classType: 'CLIPTextEncode' },
        { classType: 'EmptyLatentImage' },
        { classType: 'KSampler' },
        { classType: 'SaveImage' },
      ],
      models: [{ id: 'checkpoint', relativePath: 'checkpoints/model.bin', minBytes: 4 }],
    },
    bindings: {
      prompt: { nodeId: '1', input: 'text' },
      seed: { nodeId: '3', input: 'seed', default: 7 },
      dimensions: {
        width: { nodeId: '2', input: 'width' },
        height: { nodeId: '2', input: 'height' },
        default: { width: 512, height: 512 },
        min: 64,
        max: 2048,
        multipleOf: 8,
      },
      images: [],
    },
    outputs: [{ id: 'final', type: 'image', nodeId: '4', field: 'images', maxItems: 2 }],
    resources: { tier: 'low', minVramMiB: 1024, minRamMiB: 2048, maxConcurrency: 1 },
    fallback: [],
  };
  return deepMerge(recipe, overrides);
}

export function objectInfoFor(recipe: ComfyUIRecipe): Record<string, unknown> {
  return Object.fromEntries(recipe.requirements.nodes.map(({ classType }) => [classType, {}]));
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return clone(override);
  const result: Record<string, unknown> = clone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = isRecord(result[key]) && isRecord(value)
      ? deepMerge(result[key], value)
      : clone(value);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
