import { describe, expect, it } from 'vitest';

import {
  buildComfyWorkflow,
  buildKrea2ComfyWorkflow,
  resolveComfyLoraName,
  resolveComfyLoraStrength,
} from '../../src/tools/media-generation-tool.js';

describe('ComfyUI LoRA workflow', () => {
  it('resolves lora filename from env', () => {
    expect(resolveComfyLoraName({ CODEBUDDY_COMFYUI_LORA: 'lisa' } as NodeJS.ProcessEnv)).toBe(
      'lisa.safetensors',
    );
    expect(
      resolveComfyLoraName({ CODEBUDDY_COMFYUI_LORA: 'lisa.safetensors' } as NodeJS.ProcessEnv),
    ).toBe('lisa.safetensors');
    expect(resolveComfyLoraName({ CODEBUDDY_COMFYUI_LORA: 'none' } as NodeJS.ProcessEnv)).toBe(
      undefined,
    );
    // auto falls back to lisa.safetensors when no file on disk
    expect(resolveComfyLoraName({ CODEBUDDY_COMFYUI_LORA: 'auto' } as NodeJS.ProcessEnv)).toMatch(
      /\.safetensors$/,
    );
    expect(resolveComfyLoraStrength({ CODEBUDDY_COMFYUI_LORA_STRENGTH: '0.7' } as NodeJS.ProcessEnv)).toBe(
      0.7,
    );
  });

  it('wires LoraLoader between checkpoint and sampler when lora set', () => {
    const g = buildComfyWorkflow(
      'ohwx lisa portrait',
      'blurry',
      'model.safetensors',
      { width: 768, height: 1024 },
      { steps: 20, cfg: 7, sampler: 'euler', scheduler: 'normal' },
      42,
      { name: 'lisa.safetensors', strength: 0.85 },
    ) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

    expect(g['10']?.class_type).toBe('LoraLoader');
    expect(g['10']?.inputs.lora_name).toBe('lisa.safetensors');
    expect(g['3']?.inputs.model).toEqual(['10', 0]);
    expect(g['6']?.inputs.clip).toEqual(['10', 1]);
    expect(g['7']?.inputs.clip).toEqual(['10', 1]);
  });

  it('omits LoraLoader without lora', () => {
    const g = buildComfyWorkflow(
      'cat',
      'blurry',
      'model.safetensors',
      { width: 512, height: 512 },
      { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'normal' },
      1,
    ) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(g['10']).toBeUndefined();
    expect(g['3']?.inputs.model).toEqual(['4', 0]);
  });

  it('builds the native Krea 2 graph and applies a model-only LoRA', () => {
    const g = buildKrea2ComfyWorkflow(
      'ohwx lisa portrait',
      'krea2_turbo_fp8_scaled.safetensors',
      'qwen3vl_4b_fp8_scaled.safetensors',
      'qwen_image_vae.safetensors',
      { width: 1024, height: 1344 },
      { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'simple' },
      42,
      { name: 'lisa-krea2.safetensors', strength: 0.8 },
    ) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

    expect(g['4']?.class_type).toBe('UNETLoader');
    expect(g['4']?.inputs.unet_name).toBe('krea2_turbo_fp8_scaled.safetensors');
    expect(g['6']?.class_type).toBe('CLIPLoader');
    expect(g['6']?.inputs.type).toBe('krea2');
    expect(g['7']?.inputs.vae_name).toBe('qwen_image_vae.safetensors');
    expect(g['12']?.class_type).toBe('LoraLoaderModelOnly');
    expect(g['3']?.inputs.model).toEqual(['12', 0]);
    expect(g['3']?.inputs.negative).toEqual(['10', 0]);
    expect(g['3']?.inputs.steps).toBe(8);
    expect(g['5']?.inputs.width).toBe(1024);
    expect(g['5']?.inputs.height).toBe(1344);
  });
});
