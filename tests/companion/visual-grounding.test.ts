import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  groundExplicitVisualRequest,
  isAmbiguousVisualGroundingRequest,
  isExplicitVisualGroundingRequest,
  type VisualAnalysisInput,
} from '../../src/companion/visual-grounding.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'codebuddy-visual-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    ),
  );
});

describe('explicit visual grounding intent', () => {
  it('detects the hamburger request with and without STT punctuation', () => {
    expect(
      isExplicitVisualGroundingRequest("Tu vois le hamburger que j'ai préparé ?"),
    ).toBe(true);
    expect(
      isExplicitVisualGroundingRequest("tu vois le hamburger que j'ai préparé"),
    ).toBe(true);
    expect(isExplicitVisualGroundingRequest('est ce que tu peux voir mon assiette')).toBe(true);
    expect(isExplicitVisualGroundingRequest("qu'est-ce que tu vois devant toi")).toBe(true);
  });

  it('does not open the camera for figurative understanding', () => {
    expect(isExplicitVisualGroundingRequest('tu vois ce que je veux dire')).toBe(false);
    expect(isExplicitVisualGroundingRequest('tu vois bien que ce raisonnement est faux')).toBe(false);
    expect(isExplicitVisualGroundingRequest('peux tu expliquer pourquoi le ciel est bleu')).toBe(false);
    expect(isExplicitVisualGroundingRequest('tu vois le bug dans ce code')).toBe(false);
    expect(isExplicitVisualGroundingRequest('parlons du hamburger')).toBe(false);
  });

  it('does not treat ambiguous language or fresh-data commands as camera consent', () => {
    for (const utterance of [
      'Tu vois ?',
      'Regarde les actualités.',
      'Regarde la météo.',
      'Tu peux voir les actualités ?',
      'Tu peux voir le prix du bitcoin ?',
      'Regarde mon agenda.',
      'Regarde ma situation.',
      'Regarde ma réponse.',
      'Tu vois ma question ?',
      'Regarde mon profil.',
      'Regarde ce que je viens de dire.',
    ]) {
      expect(isExplicitVisualGroundingRequest(utterance), utterance).toBe(false);
    }
  });

  it('accepts explicit physical, deictic, and camera targets', () => {
    for (const utterance of [
      'Regarde le hamburger.',
      'Regarde ceci.',
      'Tu vois mon nouveau tatouage ?',
      'Que vois-tu devant toi ?',
      'Regarde cette image.',
      'Ouvre la caméra une fois.',
    ]) {
      expect(isExplicitVisualGroundingRequest(utterance), utterance).toBe(true);
    }
  });

  it('requests explicit one-shot consent for unknown visual targets without opening', () => {
    for (const utterance of [
      'Tu vois mon tournevis ?',
      'Regarde le livre que je te montre.',
      'Regarde ma nouvelle plante.',
      'Tu vois la salade que je viens de préparer ?',
      'Regarde mon dessin.',
    ]) {
      expect(isExplicitVisualGroundingRequest(utterance), utterance).toBe(false);
      expect(isAmbiguousVisualGroundingRequest(utterance), utterance).toBe(true);
    }
    for (const utterance of [
      'Regarde la météo.',
      'Tu vois ma question ?',
      'Tu vois ce que je veux dire.',
      'Tu vois pourquoi je refuse ?',
    ]) {
      expect(isAmbiguousVisualGroundingRequest(utterance), utterance).toBe(false);
    }
  });
});

describe('one-shot visual grounding lifecycle', () => {
  it('answers honestly and does not capture when no visual model is configured', async () => {
    const capture = vi.fn();
    const result = await groundExplicitVisualRequest('tu vois le hamburger', {
      env: {},
      capture,
    });

    expect(result?.status).toBe('no_model');
    expect(result?.response).toContain("aucun modèle visuel n'est configuré");
    expect(capture).not.toHaveBeenCalled();
  });

  it('blocks remote plaintext endpoints before opening the camera', async () => {
    const capture = vi.fn();
    const result = await groundExplicitVisualRequest('tu vois le hamburger', {
      env: {
        CODEBUDDY_VISION_MODEL: 'vision-remote',
        CODEBUDDY_VISION_BASE_URL: 'http://gpuNode.local:11434/v1',
      },
      capture,
    });

    expect(result?.status).toBe('analysis_failed');
    expect(result?.response).toContain('HTTPS');
    expect(capture).not.toHaveBeenCalled();
  });

  it('answers honestly when no image can be captured and never calls the model', async () => {
    const analyze = vi.fn();
    const result = await groundExplicitVisualRequest('tu vois le hamburger', {
      env: { CODEBUDDY_VISION_MODEL: 'vision-local' },
      capture: async () => ({ success: false, error: 'camera denied' }),
      analyze,
      tempDir: await temporaryDirectory(),
      createId: () => 'no-image',
    });

    expect(result?.status).toBe('no_image');
    expect(result?.response).toContain("pas pu obtenir d'image");
    expect(analyze).not.toHaveBeenCalled();
  });

  it('returns bounded text evidence and deletes the raw frame after analysis', async () => {
    const directory = await temporaryDirectory();
    let capturedPath = '';
    let analysisInput: VisualAnalysisInput | undefined;
    let analysisMode = 0;
    const capture = vi.fn(async (options: { outputPath?: string; recordPercept?: boolean }) => {
      capturedPath = options.outputPath!;
      await writeFile(capturedPath, Buffer.from('synthetic image bytes'));
      return { success: true, path: capturedPath };
    });
    const analyze = vi.fn(async (input: VisualAnalysisInput) => {
      analysisInput = input;
      expect(await readFile(input.imagePath, 'utf8')).toBe('synthetic image bytes');
      analysisMode = (await stat(input.imagePath)).mode & 0o777;
      return `Je vois un hamburger maison dans une assiette. ${'appétissant '.repeat(300)}`;
    });
    const result = await groundExplicitVisualRequest(
      "tu vois le hamburger que j'ai préparé",
      {
        env: {
          CODEBUDDY_VISION_MODEL: 'vision-local',
          CODEBUDDY_VISION_BASE_URL: 'http://gpuNode.local:11434/v1/',
          CODEBUDDY_VISION_ALLOW_INSECURE_REMOTE: 'true',
        },
        tempDir: directory,
        createId: () => 'hamburger',
        now: () => new Date('2026-07-13T12:00:00.000Z'),
        capture,
        analyze,
      },
    );

    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      recordPercept: false,
      redactSafetyEvent: true,
      skipAvailabilityCheck: true,
    }));
    expect(analyze).toHaveBeenCalledOnce();
    // POSIX mode bits only: Windows reports 0o666 whatever the chmod.
    if (process.platform !== 'win32') {
      expect(analysisMode).toBe(0o600);
    }
    expect(result?.status).toBe('analyzed');
    expect(result?.response).toContain('image ponctuelle');
    expect(result?.response).toContain('hamburger maison');
    expect(result?.response.length).toBeLessThanOrEqual(1_600);
    expect(result?.evidence).toMatchObject({
      source: 'explicit_camera_one_shot',
      observedAt: '2026-07-13T12:00:00.000Z',
      model: 'vision-local',
      localImageRetained: false,
      localDeletionVerified: true,
    });
    expect(result?.evidence?.summary.length).toBeLessThanOrEqual(1_200);
    expect(analysisInput?.baseURL).toBe('http://gpuNode.local:11434/v1');
    expect(JSON.stringify(result)).not.toContain(capturedPath);
    expect(JSON.stringify(result)).not.toContain('base64');
    await expect(readFile(capturedPath)).rejects.toThrow();
  });

  it('never forwards an ambient OpenAI key to a custom vision endpoint', async () => {
    const directory = await temporaryDirectory();
    let receivedApiKey = '';
    const result = await groundExplicitVisualRequest('tu vois mon assiette', {
      env: {
        CODEBUDDY_VISION_MODEL: 'vision-local',
        CODEBUDDY_VISION_BASE_URL: 'http://gpuNode.local:11434/v1',
        CODEBUDDY_VISION_ALLOW_INSECURE_REMOTE: 'true',
        OPENAI_API_KEY: 'must-not-leak',
      },
      tempDir: directory,
      createId: () => 'credential-boundary',
      capture: async (options) => {
        await writeFile(options.outputPath!, Buffer.from('frame'));
        return { success: true, path: options.outputPath };
      },
      analyze: async (input) => {
        receivedApiKey = input.apiKey;
        return 'Je vois une assiette.';
      },
    });

    expect(result?.status).toBe('analyzed');
    expect(receivedApiKey).toBe('ollama');
    expect(receivedApiKey).not.toBe('must-not-leak');
  });

  it('uses the dedicated vision key for an authenticated custom endpoint', async () => {
    const directory = await temporaryDirectory();
    let receivedApiKey = '';
    await groundExplicitVisualRequest('regarde le hamburger', {
      env: {
        CODEBUDDY_VISION_MODEL: 'vision-remote',
        CODEBUDDY_VISION_BASE_URL: 'https://vision.example.test/v1',
        CODEBUDDY_VISION_API_KEY: 'vision-only',
        OPENAI_API_KEY: 'must-not-leak',
      },
      tempDir: directory,
      createId: () => 'dedicated-credential',
      capture: async (options) => {
        await writeFile(options.outputPath!, Buffer.from('frame'));
        return { success: true, path: options.outputPath };
      },
      analyze: async (input) => {
        receivedApiKey = input.apiKey;
        return 'Je vois un hamburger.';
      },
    });

    expect(receivedApiKey).toBe('vision-only');
  });

  it('deletes the raw frame when the vision model fails', async () => {
    const directory = await temporaryDirectory();
    let capturedPath = '';
    const result = await groundExplicitVisualRequest('tu vois mon assiette', {
      env: { CODEBUDDY_VISION_MODEL: 'missing-model' },
      tempDir: directory,
      createId: () => 'model-error',
      capture: async (options) => {
        capturedPath = options.outputPath!;
        await writeFile(capturedPath, Buffer.from('frame'));
        return { success: true, path: capturedPath };
      },
      analyze: async () => {
        throw new Error('model unavailable');
      },
    });

    expect(result?.status).toBe('analysis_failed');
    expect(result?.response).toContain("n'a pas réussi à l'analyser");
    await expect(readFile(capturedPath)).rejects.toThrow();
  });

  it('reports cleanup uncertainty even when analysis had already failed', async () => {
    const directory = await temporaryDirectory();
    let capturedPath = '';
    const result = await groundExplicitVisualRequest('tu vois mon assiette', {
      env: { CODEBUDDY_VISION_MODEL: 'vision-local' },
      tempDir: directory,
      createId: () => 'failed-analysis-retained',
      capture: async (options) => {
        capturedPath = options.outputPath!;
        await writeFile(capturedPath, Buffer.from('frame'));
        return { success: true, path: capturedPath };
      },
      analyze: async () => {
        throw new Error('model unavailable');
      },
      removeFile: async () => {
        throw new Error('locked');
      },
      removeDirectory: async () => {
        throw new Error('locked');
      },
    });

    expect(result?.status).toBe('analysis_failed');
    expect(result?.response).toContain('confirmer la suppression');
    expect(result?.evidence).toBeUndefined();
    await expect(readFile(capturedPath)).resolves.toBeTruthy();
  });

  it('aborts an in-flight capture promptly and forwards the signal', async () => {
    const directory = await temporaryDirectory();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const startedAt = Date.now();
    const resultPromise = groundExplicitVisualRequest('tu vois mon assiette', {
      env: { CODEBUDDY_VISION_MODEL: 'vision-local' },
      signal: controller.signal,
      tempDir: directory,
      createId: () => 'capture-abort',
      capture: async (options) => {
        receivedSignal = options.signal;
        return new Promise((resolve) => {
          const timer = setTimeout(
            () => resolve({ success: false, error: 'late capture' }),
            500,
          );
          options.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve({ success: false, error: 'aborted' });
          }, { once: true });
        });
      },
      analyze: async () => 'must not run',
    });
    setTimeout(() => controller.abort(), 10);

    const result = await resultPromise;
    expect(result?.status).toBe('aborted');
    expect(receivedSignal).toBe(controller.signal);
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  it('serializes concurrent camera captures', async () => {
    const directory = await temporaryDirectory();
    let activeCaptures = 0;
    let maxConcurrentCaptures = 0;
    let id = 0;
    const run = () => groundExplicitVisualRequest('tu vois mon assiette', {
      env: { CODEBUDDY_VISION_MODEL: 'vision-local' },
      tempDir: directory,
      createId: () => `serialized-${id++}`,
      capture: async (options) => {
        activeCaptures += 1;
        maxConcurrentCaptures = Math.max(maxConcurrentCaptures, activeCaptures);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeFile(options.outputPath!, Buffer.from('frame'));
        activeCaptures -= 1;
        return { success: true, path: options.outputPath };
      },
      analyze: async () => 'Je vois une assiette.',
    });

    const results = await Promise.all([run(), run()]);
    expect(results.map((result) => result?.status)).toEqual(['analyzed', 'analyzed']);
    expect(maxConcurrentCaptures).toBe(1);
  });

  it('aborts a slow visual analysis at its dedicated deadline', async () => {
    const directory = await temporaryDirectory();
    const startedAt = Date.now();
    const result = await groundExplicitVisualRequest('tu vois mon assiette', {
      env: { CODEBUDDY_VISION_MODEL: 'vision-local' },
      analysisTimeoutMs: 25,
      tempDir: directory,
      createId: () => 'analysis-timeout',
      capture: async (options) => {
        await writeFile(options.outputPath!, Buffer.from('frame'));
        return { success: true, path: options.outputPath };
      },
      analyze: async (input) => new Promise<string>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      }),
    });

    expect(result?.status).toBe('analysis_failed');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('uses the sensory camera index when no explicit device override exists', async () => {
    const directory = await temporaryDirectory();
    let device = '';
    await groundExplicitVisualRequest('tu vois mon assiette', {
      env: {
        CODEBUDDY_VISION_MODEL: 'vision-local',
        BUDDY_SENSE_CAMERA_INDEX: '2',
      },
      tempDir: directory,
      createId: () => 'camera-index',
      capture: async (options) => {
        device = options.device ?? '';
        await writeFile(options.outputPath!, Buffer.from('frame'));
        return { success: true, path: options.outputPath };
      },
      analyze: async () => 'Je vois une assiette.',
    });

    if (process.platform === 'linux') expect(device).toBe('/dev/video2');
    if (process.platform === 'darwin') expect(device).toBe('2');
  });

  it('treats a text-only model disclaimer as an unsupported visual model', async () => {
    const directory = await temporaryDirectory();
    const result = await groundExplicitVisualRequest('tu vois mon assiette', {
      env: { CODEBUDDY_VISION_MODEL: 'text-only' },
      tempDir: directory,
      createId: () => 'text-only',
      capture: async (options) => {
        await writeFile(options.outputPath!, Buffer.from('frame'));
        return { success: true, path: options.outputPath };
      },
      analyze: async () => "Je ne peux pas voir ou analyser cette image en tant que modèle texte.",
    });

    expect(result?.status).toBe('analysis_failed');
    expect(result?.response).toContain('CODEBUDDY_VISION_MODEL');
    expect(result?.response).not.toContain('modèle texte');
  });

  it('never claims local deletion when cleanup cannot be verified', async () => {
    const directory = await temporaryDirectory();
    let capturedPath = '';
    const result = await groundExplicitVisualRequest('tu vois mon assiette', {
      env: { CODEBUDDY_VISION_MODEL: 'vision-local' },
      tempDir: directory,
      createId: () => 'cleanup-failure',
      capture: async (options) => {
        capturedPath = options.outputPath!;
        await writeFile(capturedPath, Buffer.from('frame'));
        return { success: true, path: capturedPath };
      },
      analyze: async () => 'Je vois une assiette sur la table.',
      removeFile: async () => {
        throw new Error('locked');
      },
      removeDirectory: async () => {
        throw new Error('locked');
      },
    });

    expect(result?.status).toBe('analysis_failed');
    expect(result?.response).toContain('confirmer la suppression');
    expect(result?.evidence).toBeUndefined();
    await expect(readFile(capturedPath)).resolves.toBeTruthy();
  });
});
