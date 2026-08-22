import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runLisaStudioCli } from '../../scripts/lisa-studio/generer-clip.js';
import {
  type ComfyWorkflow,
  IdentityGateError,
  type PythonExecutionRequest,
  type PythonExecutor,
  type StudioClock,
  runLisaStudio,
} from '../../scripts/lisa-studio/lisa-studio-pipeline.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==',
  'base64'
);
const MP4_BYTES = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
const workspaces: string[] = [];

interface FetchCapture {
  workflows: ComfyWorkflow[];
  uploads: number;
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true }))
  );
});

describe('Lisa Studio', () => {
  it('sélectionne le best-of-N, anime la gagnante en first_frame H3 et écrit rapport + sidecar', async () => {
    const workspace = await createWorkspace();
    const reference = await createReference(workspace);
    const capture: FetchCapture = { workflows: [], uploads: 0 };
    const pythonCalls: PythonExecutionRequest[] = [];
    const pythonExecutor = scoringPython([0.41, 0.66, 0.55], pythonCalls);

    const report = await runLisaStudio(
      {
        rootDir: workspace,
        referencePath: reference,
        scenePrompt: 'Lisa dans un studio bleu nuit',
        animationPrompt: 'Lisa sourit doucement',
        candidateCount: 3,
        threshold: 0.5,
        durationSeconds: 5,
        baseSeed: 100,
        imageBaseUrl: 'http://image.test:8188',
        videoBaseUrl: 'http://video.test:8190',
      },
      {
        fetch: comfyFetch(capture),
        pythonExecutor,
        clock: fixedClock('2026-08-12T10:00:00.000Z'),
        createId: () => 'test-production',
        env: {},
      }
    );

    expect(report.mode).toBe('production');
    expect(report.seeds).toEqual({ keyframes: [100, 101, 102], animation: 103 });
    expect(report.gate).toMatchObject({ accepted: true, bestScore: 0.66, selectedIndex: 1 });
    expect(report.paths.selectedKeyframe).toContain('-02-seed-101.png');
    expect(report.paths.video).toContain('.codebuddy/media-generation/videos/lisa-clip-');
    expect(report.prompts.animation).toBe(
      'Lisa sourit doucement, plan fixe verrouillé, visage net et centré'
    );
    expect(report.finalArcFace.frames.map((frame) => frame.arcfaceScore)).toEqual([
      0.64, 0.61, 0.6,
    ]);
    expect(pythonCalls.map((call) => call.task)).toEqual(['score-keyframes', 'score-video']);

    expect(capture.workflows).toHaveLength(4);
    const firstImage = capture.workflows[0]!;
    expect(firstImage['1']?.inputs).toMatchObject({
      unet_name: 'krea2_turbo_fp8_scaled.safetensors',
    });
    expect(firstImage['4']?.inputs).toMatchObject({
      lora_name: 'lisa-krea2.safetensors',
      strength_model: 0.85,
    });
    expect(firstImage['8']?.inputs).toMatchObject({
      seed: 100,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
    });

    const video = capture.workflows[3]!;
    expect(capture.uploads).toBe(1);
    expect(video['5']?.inputs.image).toBe('uploaded/lisa-first-frame.png');
    expect(video['6']?.class_type).toBe('MiniMaxH3ImageToVideo');
    expect(video['6']?.inputs).toMatchObject({
      width: 768,
      height: 1344,
      length: 124,
      first_frame: ['5', 0],
    });
    expect(video['8']?.inputs).toMatchObject({
      seed: 103,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'beta',
    });

    await expect(fs.readFile(report.paths.video)).resolves.toEqual(MP4_BYTES);
    const diskReport = JSON.parse(await fs.readFile(report.paths.report, 'utf8')) as typeof report;
    const sidecar = JSON.parse(await fs.readFile(report.paths.sidecar, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(diskReport.paths).toEqual(report.paths);
    expect(sidecar).toMatchObject({
      kind: 'video',
      provider: 'comfyui',
      model: 'minimax-h3',
      prompt: report.prompts.animation,
      firstFrame: report.paths.selectedKeyframe,
      reportPath: report.paths.report,
    });
    for (const keyframe of report.keyframes) {
      const metadata = JSON.parse(
        await fs.readFile(`${keyframe.path}.meta.json`, 'utf8')
      ) as Record<string, unknown>;
      expect(metadata).toMatchObject({ seed: keyframe.seed, arcfaceScore: keyframe.arcfaceScore });
    }
  });

  it('refuse honnêtement sous le seuil et ne soumet aucun workflow vidéo', async () => {
    const workspace = await createWorkspace();
    const reference = await createReference(workspace);
    const capture: FetchCapture = { workflows: [], uploads: 0 };
    const pythonCalls: PythonExecutionRequest[] = [];

    const promise = runLisaStudio(
      {
        rootDir: workspace,
        referencePath: reference,
        candidateCount: 2,
        threshold: 0.5,
        baseSeed: 50,
        imageBaseUrl: 'http://image.test:8188',
        videoBaseUrl: 'http://video.test:8190',
      },
      {
        fetch: comfyFetch(capture),
        pythonExecutor: scoringPython([0.499, 0.42], pythonCalls),
        clock: fixedClock('2026-08-12T11:00:00.000Z'),
        createId: () => 'test-reject',
        env: {},
      }
    );

    await expect(promise).rejects.toEqual(
      expect.objectContaining<Partial<IdentityGateError>>({
        name: 'IdentityGateError',
        bestScore: 0.499,
        threshold: 0.5,
        message: expect.stringMatching(/0\.499000 < seuil 0\.500000.*Aucune animation lancée/),
      })
    );
    expect(capture.workflows).toHaveLength(2);
    expect(capture.uploads).toBe(0);
    expect(pythonCalls.map((call) => call.task)).toEqual(['score-keyframes']);
    const videoDirectory = path.join(workspace, '.codebuddy', 'media-generation', 'videos');
    await expect(fs.readdir(videoDirectory)).resolves.toEqual([]);
  });

  it('--essai valide toute la plomberie sans appeler fetch ni Python', async () => {
    const workspace = await createWorkspace();
    const reference = await createReference(workspace);
    let fetchCalls = 0;
    let pythonCalls = 0;
    const report = await runLisaStudioCli(
      [
        '--reference',
        reference,
        '--racine',
        workspace,
        '--n',
        '4',
        '--seuil',
        '0.5',
        '--seed',
        '7',
        '--animation',
        'Lisa fait un signe de la main',
        '--essai',
      ],
      {
        fetch: (async () => {
          fetchCalls += 1;
          throw new Error('fetch interdit en essai');
        }) as typeof fetch,
        pythonExecutor: async () => {
          pythonCalls += 1;
          throw new Error('Python interdit en essai');
        },
        clock: fixedClock('2026-08-12T12:00:00.000Z'),
        createId: () => 'test-essai',
        env: {},
        onProgress: () => undefined,
      }
    );

    expect(fetchCalls).toBe(0);
    expect(pythonCalls).toBe(0);
    expect(report).toBeDefined();
    expect(report?.mode).toBe('essai');
    expect(report?.seeds).toEqual({ keyframes: [7, 8, 9, 10], animation: 11 });
    expect(report?.keyframes).toHaveLength(4);
    expect(report?.gate.selectedIndex).toBe(3);
    await expect(fs.stat(report!.paths.video)).resolves.toMatchObject({ size: MP4_BYTES.length });
    await expect(fs.stat(report!.paths.report)).resolves.toMatchObject({
      size: expect.any(Number),
    });
    await expect(fs.stat(report!.paths.sidecar)).resolves.toMatchObject({
      size: expect.any(Number),
    });
  });

  it('échoue fermé si le sous-processus Python ne renvoie pas le JSON marqué', async () => {
    const workspace = await createWorkspace();
    const reference = await createReference(workspace);
    const capture: FetchCapture = { workflows: [], uploads: 0 };

    await expect(
      runLisaStudio(
        {
          rootDir: workspace,
          referencePath: reference,
          candidateCount: 1,
          baseSeed: 1,
          imageBaseUrl: 'http://image.test:8188',
        },
        {
          fetch: comfyFetch(capture),
          pythonExecutor: async () => ({
            exitCode: 0,
            stdout: 'bruit insightface sans payload',
            stderr: '',
          }),
          clock: fixedClock('2026-08-12T13:00:00.000Z'),
          createId: () => 'test-python-invalid',
          env: {},
        }
      )
    ).rejects.toThrow(/aucun rapport JSON marqué/);
    expect(capture.workflows).toHaveLength(1);
    expect(capture.uploads).toBe(0);
  });
});

function scoringPython(keyframeScores: number[], calls: PythonExecutionRequest[]): PythonExecutor {
  return async (request) => {
    calls.push(request);
    const argument = JSON.parse(request.arguments[0] ?? '{}') as {
      candidates?: string[];
      video?: string;
    };
    if (request.task === 'score-keyframes') {
      const candidates = argument.candidates ?? [];
      return markedResult({
        scores: candidates.map((candidate, index) => ({
          path: path.resolve(candidate),
          detected: true,
          arcface: keyframeScores[index],
        })),
      });
    }
    return markedResult({
      frameCount: 124,
      fps: 24,
      durationSeconds: 124 / 24,
      scores: [
        { position: 'debut', frameIndex: 0, timestampSeconds: 0, arcface: 0.64 },
        { position: 'milieu', frameIndex: 62, timestampSeconds: 62 / 24, arcface: 0.61 },
        { position: 'fin', frameIndex: 123, timestampSeconds: 123 / 24, arcface: 0.6 },
      ],
    });
  };
}

function markedResult(value: unknown): { exitCode: number; stdout: string; stderr: string } {
  return {
    exitCode: 0,
    stdout: `insightface init\nLISA_STUDIO_JSON=${JSON.stringify(value)}\n`,
    stderr: '',
  };
}

function comfyFetch(capture: FetchCapture): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = String(input);
    if (href.endsWith('/upload/image')) {
      capture.uploads += 1;
      return jsonResponse({ name: 'lisa-first-frame.png', subfolder: 'uploaded' });
    }
    if (href.endsWith('/prompt')) {
      const body = JSON.parse(String(init?.body)) as { prompt: ComfyWorkflow };
      capture.workflows.push(body.prompt);
      return jsonResponse({ prompt_id: `prompt-${capture.workflows.length}` });
    }
    if (href.includes('/history/')) {
      const promptId = decodeURIComponent(href.split('/').pop() ?? '');
      const index = Number(promptId.replace('prompt-', '')) - 1;
      const workflow = capture.workflows[index];
      const isVideo = workflow
        ? Object.values(workflow).some((node) => node.class_type === 'SaveVideo')
        : false;
      const filename = isVideo ? 'lisa-h3.mp4' : `lisa-keyframe-${index + 1}.png`;
      return jsonResponse({
        [promptId]: {
          status: { completed: true, status_str: 'success' },
          outputs: { output: { images: [{ filename, subfolder: 'codebuddy', type: 'output' }] } },
        },
      });
    }
    if (href.includes('/view')) {
      const filename = new URL(href).searchParams.get('filename') ?? '';
      const bytes = filename.endsWith('.mp4') ? MP4_BYTES : PNG_BYTES;
      const contentType = filename.endsWith('.mp4') ? 'video/mp4' : 'image/png';
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.length) },
      });
    }
    throw new Error(`fetch inattendu : ${href}`);
  }) as typeof fetch;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fixedClock(iso: string): StudioClock {
  let current = Date.parse(iso);
  return {
    nowMs: () => current,
    sleep: async (milliseconds) => {
      current += milliseconds;
    },
  };
}

async function createWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-lisa-studio-'));
  workspaces.push(workspace);
  return workspace;
}

async function createReference(workspace: string): Promise<string> {
  const reference = path.join(workspace, 'lisa-reference.png');
  await fs.writeFile(reference, PNG_BYTES);
  return reference;
}
