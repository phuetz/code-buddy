import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { generateVideo } from '../../src/tools/media-generation-tool.js';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==';
const SOURCE = `data:image/png;base64,${PIXEL}`;
const MP4_BYTES = Buffer.from('0000002066747970697336d70000000000000000000000000000000000000000', 'hex');
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true })));
});

type WorkflowNode = { class_type: string; inputs: Record<string, unknown> };
type Captured = { workflow?: Record<string, WorkflowNode>; uploads: number };

function comfyFetch(captured: Captured): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('/upload/image')) {
      captured.uploads += 1;
      return new Response(JSON.stringify({ name: `ref-${captured.uploads}.png`, subfolder: '' }), { status: 200 });
    }
    if (href.endsWith('/prompt')) {
      captured.workflow = (JSON.parse(String(init?.body)) as { prompt: Record<string, WorkflowNode> }).prompt;
      return new Response(JSON.stringify({ prompt_id: 'p-1' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.includes('/history/')) {
      return new Response(JSON.stringify({
        'p-1': {
          status: { completed: true, status_str: 'success' },
          outputs: { '13': { images: [{ filename: 'h3-test_00001_.mp4', subfolder: 'codebuddy', type: 'output' }] } },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (href.includes('/view')) {
      return new Response(new Uint8Array(MP4_BYTES), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch;
}

describe('generateVideo — provider comfyui (MiniMax H3 local)', () => {
  it('soumet le graphe ref2va validé (refs imbriquées, grille 17k+5, côté court 768) et matérialise le mp4', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-h3-video-'));
    workspaces.push(workspace);
    const captured: Captured = { uploads: 0 };

    const result = await generateVideo({
      prompt: '<Picture 1> sourit et dit bonjour.',
      referenceImageUrls: [SOURCE],
      duration: 5,
      aspectRatio: '9:16',
      seed: 7,
    }, {
      rootDir: workspace,
      createId: () => 'h3-test',
      env: { CODEBUDDY_VIDEO_PROVIDER: 'comfyui', CODEBUDDY_VIDEO_BASE_URL: 'http://gpuNode:8190', CODEBUDDY_H3_POLL_MS: '1' } as NodeJS.ProcessEnv,
      fetch: comfyFetch(captured),
    });

    const wf = captured.workflow!;
    const ref = wf['7']!.inputs as Record<string, unknown>;
    // 5 s à 24 fps -> 120 images, remontées sur la grille 17k+5 = 124
    expect(ref.length).toBe(124);
    // 9:16 avec côté court d'entraînement 768 -> 768×1344 (multiples de 32)
    expect(ref.width).toBe(768);
    expect(ref.height).toBe(1344);
    // La référence passe IMBRIQUÉE sous ref_images (piège autogrow payé le 10/08)
    expect(ref.ref_images).toEqual({ ref_image_1: ['20', 0] });
    expect(wf['20'].inputs.image).toBe('ref-1.png');
    // Audio natif par défaut : VAEDecodeAudio branché dans CreateVideo
    expect(wf['11'].class_type).toBe('VAEDecodeAudio');
    expect(wf['12'].inputs.audio).toEqual(['11', 0]);
    expect(wf['9'].inputs.seed).toBe(7);

    expect(result.success).toBe(true);
    expect(result.provider).toBe('comfyui');
    expect(result.modality).toBe('image');
    expect(result.duration).toBeCloseTo(124 / 24, 3);
    expect(result.outputPath).toBeTruthy();
    const saved = await fs.readFile(result.outputPath!);
    expect(saved.equals(MP4_BYTES)).toBe(true);
    const sidecar = JSON.parse(await fs.readFile(`${result.outputPath}.meta.json`, 'utf8'));
    expect(sidecar.provider).toBe('comfyui');
  });

  it('sans référence ni audio : texte→vidéo, pas de nœud audio, durée snappée vers le haut', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-h3-video-'));
    workspaces.push(workspace);
    const captured: Captured = { uploads: 0 };

    const result = await generateVideo({
      prompt: 'Un phare dans la tempête, plan fixe.',
      duration: 2.3,
      aspectRatio: '16:9',
      audio: false,
    }, {
      rootDir: workspace,
      createId: () => 'h3-test-2',
      env: { CODEBUDDY_VIDEO_PROVIDER: 'comfyui', CODEBUDDY_VIDEO_BASE_URL: 'http://gpuNode:8190', CODEBUDDY_H3_POLL_MS: '1' } as NodeJS.ProcessEnv,
      fetch: comfyFetch(captured),
    });

    const wf = captured.workflow!;
    expect(captured.uploads).toBe(0);
    // 2,3 s -> 55 images -> 5+17k = 56
    expect(wf['7'].inputs.length).toBe(56);
    expect(wf['7'].inputs.width).toBe(1344);
    expect(wf['7'].inputs.height).toBe(768);
    expect(wf['7'].inputs.ref_images).toBeUndefined();
    expect(wf['11']).toBeUndefined();
    expect(wf['12'].inputs.audio).toBeUndefined();
    expect(result.modality).toBe('text');
  });
});
