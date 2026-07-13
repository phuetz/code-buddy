import { describe, expect, it } from 'vitest';
import {
  ComfyUIRecipeValidationError,
  materializeComfyUIWorkflow,
  validateComfyUIRecipe,
} from '../../src/media/comfyui-recipe-contract.js';
import { ComfyUIRecipeRegistry } from '../../src/media/comfyui-recipe-registry.js';
import { recipeFixture } from './comfyui-recipe-fixture.js';

describe('ComfyUI recipe contract', () => {
  it('materializes typed inputs only at exact declared placeholders', () => {
    const recipe = validateComfyUIRecipe(recipeFixture());
    const materialized = materializeComfyUIWorkflow(recipe, {
      prompt: 'A quiet library at dawn',
      seed: 42,
      dimensions: { width: 768, height: 1024 },
    });

    expect(materialized.seed).toBe(42);
    expect(materialized.dimensions).toEqual({ width: 768, height: 1024 });
    expect(materialized.workflow['1']?.inputs.text).toBe('A quiet library at dawn');
    expect(materialized.workflow['2']?.inputs).toMatchObject({ width: 768, height: 1024 });
    expect(materialized.workflow['3']?.inputs.seed).toBe(42);
    expect(JSON.stringify(materialized.workflow)).not.toContain('{{');
    expect(recipe.workflow.nodes['1']?.inputs.text).toBe('{{prompt}}');
  });

  it('rejects undeclared, embedded, duplicate, and disconnected bindings', () => {
    const undeclared = recipeFixture({
      workflow: { nodes: { '1': { inputs: { text: '{{arbitrary}}' } } } },
    });
    expect(() => validateComfyUIRecipe(undeclared)).toThrow(ComfyUIRecipeValidationError);

    const embedded = recipeFixture({
      workflow: { nodes: { '1': { inputs: { text: 'prefix {{prompt}}' } } } },
    });
    expect(() => validateComfyUIRecipe(embedded)).toThrow(/exact placeholder|complete input value/);

    const duplicateTarget = recipeFixture({
      bindings: { negativePrompt: { nodeId: '1', input: 'text' } },
    });
    expect(() => validateComfyUIRecipe(duplicateTarget)).toThrow(/multiple bindings target/);

    const disconnected = recipeFixture({
      workflow: {
        nodes: {
          '5': { class_type: 'LoadImage', inputs: { image: '{{image:source}}' } },
        },
      },
      requirements: {
        nodes: [
          { classType: 'CLIPTextEncode' },
          { classType: 'EmptyLatentImage' },
          { classType: 'KSampler' },
          { classType: 'SaveImage' },
          { classType: 'LoadImage' },
        ],
      },
      bindings: { images: [{ id: 'source', nodeId: '5', input: 'image', required: true }] },
    });
    expect(() => validateComfyUIRecipe(disconnected)).toThrow(/not connected/);
  });

  it('requires every workflow node class to be explicitly declared and every link/output to exist', () => {
    expect(() => validateComfyUIRecipe(recipeFixture({
      requirements: { nodes: [{ classType: 'CLIPTextEncode' }] },
    }))).toThrow(/undeclared/);

    expect(() => validateComfyUIRecipe(recipeFixture({
      workflow: { nodes: { '4': { inputs: { images: ['missing', 0] } } } },
    }))).toThrow(/references missing node/);

    expect(() => validateComfyUIRecipe(recipeFixture({
      outputs: [{ id: 'bad', type: 'video', nodeId: '4', field: 'images' }],
    }))).toThrow(/incompatible/);
  });

  it('rejects traversal, unsafe JSON keys, malformed dimensions, and undeclared runtime fields', () => {
    expect(() => validateComfyUIRecipe(recipeFixture({
      requirements: { models: [{ id: 'bad', relativePath: '../secret.bin', minBytes: 1 }] },
    }))).toThrow(/unsafe relativePath/);

    const dangerous = JSON.parse(JSON.stringify(recipeFixture())) as Record<string, unknown>;
    const workflow = dangerous.workflow as { nodes: Record<string, { inputs: Record<string, unknown> }> };
    workflow.nodes['1']!.inputs = JSON.parse('{"__proto__":"bad","text":"{{prompt}}"}') as Record<string, unknown>;
    expect(() => validateComfyUIRecipe(dangerous)).toThrow(/unsafe object key/);

    const recipe = validateComfyUIRecipe(recipeFixture());
    expect(() => materializeComfyUIWorkflow(recipe, {
      prompt: 'hello',
      dimensions: { width: 513, height: 512 },
    })).toThrow(/dimension constraints/);
    expect(() => materializeComfyUIWorkflow(recipe, {
      prompt: 'hello',
      workflow: { arbitrary: true },
    } as unknown as Parameters<typeof materializeComfyUIWorkflow>[1])).toThrow(/Unknown recipe input: workflow/);
  });

  it('keeps registered recipes immutable and resolves the newest requested version', () => {
    const registry = new ComfyUIRecipeRegistry([
      recipeFixture({ version: '1.0.0' }),
      recipeFixture({ version: '1.2.0' }),
      recipeFixture({ version: '1.2.0-beta.1', id: 'image.preview' }),
    ]);

    const latest = registry.get('image.test');
    expect(latest.version).toBe('1.2.0');
    expect(Object.isFrozen(latest)).toBe(true);
    expect(Object.isFrozen(latest.workflow.nodes)).toBe(true);
    expect(() => registry.register(recipeFixture({ version: '1.2.0' }))).toThrow(/Duplicate/);
  });
});
