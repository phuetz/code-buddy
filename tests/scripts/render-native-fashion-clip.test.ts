import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertSeedVr2Batch,
  renderNativeFashionClip,
  type NativeFashionRenderDependencies,
  type NativeFashionRenderOptions,
  type NativeFashionRenderState,
} from '../../scripts/darkstar/render-native-fashion-clip.js';
import type { SubmitAndAwaitOptions, SubmitAndAwaitResult } from '../../src/tools/video/comfy-client.js';
import type { ComfyWorkflowGraph } from '../../src/tools/video/comfy-workflow-template.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function i2vGraph(): ComfyWorkflowGraph {
  return {
    '1': { class_type: 'WanVideoModelLoader', inputs: { model: 'high' } },
    '2': { class_type: 'WanVideoModelLoader', inputs: { model: 'low' } },
    '3': { class_type: 'WanVideoSampler', inputs: { seed: -1, steps: 4, cfg: 1 } },
    '4': { class_type: 'WanVideoSampler', inputs: { seed: -1, steps: 4, cfg: 1 } },
    '5': { class_type: 'WanVideoImageToVideoEncode', inputs: { width: 832, height: 480, num_frames: 81 } },
    '6': { class_type: 'WanVideoTextEncode', inputs: { positive_prompt: '', negative_prompt: '' } },
    '7': { class_type: 'LoadImage', inputs: { image: '' } },
    '8': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '' } },
  };
}

function upscaleGraph(): ComfyWorkflowGraph {
  return {
    '1': { class_type: 'VHS_LoadVideo', inputs: { video: '' } },
    '2': { class_type: 'SeedVR2LoadDiTModel', inputs: { model: '3b-fp8' } },
    '3': { class_type: 'SeedVR2LoadVAEModel', inputs: { tiled: true } },
    '4': { class_type: 'SeedVR2VideoUpscaler', inputs: { seed: -1, resolution: 1080, batch_size: 5 } },
    '5': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '' } },
  };
}

function interpolateGraph(): ComfyWorkflowGraph {
  return {
    '1': { class_type: 'VHS_LoadVideo', inputs: { video: '' } },
    '2': { class_type: 'RIFE VFI', inputs: { multiplier: 2, ckpt_name: 'rife49.pth', ensemble: true } },
    '3': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: '' } },
  };
}

async function fixture(writeTemplates = true): Promise<{ root: string; options: NativeFashionRenderOptions }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-fashion-render-'));
  roots.push(root);
  const workflowsDir = path.join(root, 'workflows');
  const workDir = path.join(root, 'work');
  const keyframe = path.join(root, 'approved-keyframe.png');
  await fs.mkdir(workflowsDir, { recursive: true });
  await fs.writeFile(keyframe, 'approved keyframe');
  if (writeTemplates) {
    await Promise.all([
      fs.writeFile(path.join(workflowsDir, 'i2v-wan-lightx2v.json'), JSON.stringify(i2vGraph())),
      fs.writeFile(path.join(workflowsDir, 'upscale-seedvr2.json'), JSON.stringify(upscaleGraph())),
      fs.writeFile(path.join(workflowsDir, 'interpolate-rife.json'), JSON.stringify(interpolateGraph())),
    ]);
  }
  return {
    root,
    options: {
      scene: 'pilot-black-dress-turn',
      keyframe,
      comfyUrl: 'http://comfy.test',
      segments: 1,
      seed: 4100,
      workDir,
      outPath: path.join(root, 'final.mp4'),
      batchId: 'batch-native-1',
      journalPath: path.join(root, 'retry.jsonl'),
      skipUpscale: false,
      skipInterpolate: false,
      force: false,
      maxMinutes: 120,
      workflowsDir,
      seedVr2Batch: 5,
    },
  };
}

function fakeDependencies(calls: string[]): NativeFashionRenderDependencies {
  let outputIndex = 0;
  return {
    probeComfy: vi.fn(async () => ({ ok: true, devices: [{ name: 'fake-gpu' }] })),
    createClientId: () => `client-${outputIndex}`,
    submitAndAwait: vi.fn(async (
      _baseUrl: string,
      graph: ComfyWorkflowGraph,
      options: SubmitAndAwaitOptions,
    ): Promise<SubmitAndAwaitResult> => {
      const classes = Object.values(graph).map((node) => node.class_type);
      const stage = classes.includes('WanVideoSampler')
        ? 'i2v'
        : classes.includes('SeedVR2VideoUpscaler')
          ? 'upscale'
          : 'interpolate';
      calls.push(stage);
      const outputPath = path.join(options.workDir ?? os.tmpdir(), `fake-${outputIndex}.mp4`);
      outputIndex += 1;
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `fake ${stage} output`);
      return {
        promptId: `${stage}-${outputIndex}`,
        workDir: options.workDir ?? path.dirname(outputPath),
        outputs: [{
          nodeId: 'output', kind: 'video', filename: path.basename(outputPath), subfolder: '', type: 'output', path: outputPath,
        }],
      };
    }),
    runProcess: vi.fn(async (command, args) => {
      calls.push(command);
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error('fake process expected an output path');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `fake ${command} output`);
      return { stdout: '', stderr: '' };
    }),
    probeFinal: vi.fn(async () => ({ width: 1080, height: 1920, fps: 30, durationSeconds: 12 })),
  };
}

describe('native fashion clip render orchestrator', () => {
  it('fails preflight explicitly when required exported templates are missing', async () => {
    const value = await fixture(false);
    await expect(renderNativeFashionClip(value.options, {
      probeComfy: async () => ({ ok: true, devices: [] }),
    })).rejects.toThrow(/Required ComfyUI API template is missing.*i2v-wan-lightx2v\.json/u);
  });

  it('runs the complete pipeline with injected ComfyUI and ffmpeg implementations', async () => {
    const value = await fixture();
    const calls: string[] = [];
    const result = await renderNativeFashionClip(value.options, fakeDependencies(calls));
    expect(result.status).toBe('completed');
    expect(calls).toEqual(['i2v', 'ffmpeg', 'upscale', 'interpolate', 'ffmpeg']);
    await expect(fs.stat(value.options.outPath)).resolves.toMatchObject({ size: expect.any(Number) });
    const manifest = JSON.parse(await fs.readFile(result.manifestPath!, 'utf8')) as {
      baseSeed: number;
      segmentSeeds: number[];
      templateSha256: Record<string, string>;
    };
    expect(manifest).toMatchObject({ baseSeed: 4100, segmentSeeds: [4101] });
    expect(Object.keys(manifest.templateSha256)).toEqual([
      'i2v-wan-lightx2v.json', 'upscale-seedvr2.json', 'interpolate-rife.json',
    ]);
    expect(await fs.readFile(value.options.journalPath, 'utf8')).toContain('"failedGates":[]');
  });

  it('resumes after a valid completed stage 3 without repeating preflight, keyframe, or segments', async () => {
    const value = await fixture();
    const initialCalls: string[] = [];
    await renderNativeFashionClip(value.options, fakeDependencies(initialCalls));

    const statePath = path.join(value.options.workDir, 'state.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as NativeFashionRenderState;
    state.completedStage = 3;
    state.artifacts = Object.fromEntries(Object.entries(state.artifacts).filter(([, artifact]) => artifact.stage <= 3));
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const resumedCalls: string[] = [];
    const dependencies = fakeDependencies(resumedCalls);
    const probe = vi.fn(async () => ({ ok: true, devices: [] }));
    dependencies.probeComfy = probe;
    await renderNativeFashionClip(value.options, dependencies);
    expect(probe).not.toHaveBeenCalled();
    expect(resumedCalls).toEqual(['ffmpeg', 'upscale', 'interpolate', 'ffmpeg']);
  });

  it('rejects a SeedVR2 batch that is not 4n+1 before doing work', async () => {
    expect(() => assertSeedVr2Batch(6)).toThrow(/4n\+1/u);
    const value = await fixture();
    await expect(renderNativeFashionClip({ ...value.options, seedVr2Batch: 6 }, fakeDependencies([])))
      .rejects.toThrow(/4n\+1/u);
  });

  it('fails when the final ffprobe contract is outside 1080x1920 at 30 fps and expected duration', async () => {
    const value = await fixture();
    const dependencies = fakeDependencies([]);
    dependencies.probeFinal = async () => ({ width: 720, height: 1280, fps: 29.8, durationSeconds: 9 });
    await expect(renderNativeFashionClip(value.options, dependencies)).rejects.toThrow(/1080x1920/u);
  });
});
