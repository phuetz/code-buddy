/**
 * MediaGenService — real test (no mocks): injected core loader; asserts aspect
 * mapping, provider/model env overrides, and graceful error paths.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediaGenService, aspectToRatio } from '../src/main/media/media-gen-service';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createGeneratedImage(workspace: string, name = 'source.png'): string {
  const imagesDir = path.join(workspace, '.codebuddy', 'media-generation', 'images');
  mkdirSync(imagesDir, { recursive: true });
  const sourcePath = path.join(imagesDir, name);
  writeFileSync(sourcePath, PNG_HEADER);
  return sourcePath;
}

describe('aspectToRatio', () => {
  it('maps GUI aspects to core aspect ratios', () => {
    expect(aspectToRatio('1:1')).toBe('square');
    expect(aspectToRatio('16:9')).toBe('landscape');
    expect(aspectToRatio('9:16')).toBe('portrait');
    expect(aspectToRatio(undefined)).toBe('square');
  });
});

describe('MediaGenService', () => {
  it('calls core generateImage with mapped aspect + env overrides and returns the path', async () => {
    const calls: Array<{ input: unknown; env?: NodeJS.ProcessEnv }> = [];
    const service = new MediaGenService(
      async () => ({
        generateImage: async (input, runtime) => {
          calls.push({ input, env: runtime?.env });
          return { outputPath: '/tmp/out/image-1.png', image: '/tmp/out/image-1.png' };
        },
      }),
      '/root',
    );

    const res = await service.generateImage({ prompt: 'a cat', aspect: '16:9', provider: 'comfyui', model: 'sd_turbo.safetensors' });
    expect(res.ok).toBe(true);
    expect(res.outputPath).toBe('/tmp/out/image-1.png');
    expect(res.url).toBe('file:///tmp/out/image-1.png');
    expect(calls[0]!.input).toEqual({ prompt: 'a cat', aspectRatio: 'landscape' });
    expect(calls[0]!.env?.CODEBUDDY_IMAGE_PROVIDER).toBe('comfyui');
    expect(calls[0]!.env?.CODEBUDDY_IMAGE_MODEL).toBe('sd_turbo.safetensors');
  });

  it('rejects an empty prompt without loading the core', async () => {
    let loaded = false;
    const service = new MediaGenService(async () => {
      loaded = true;
      return null;
    });
    const res = await service.generateImage({ prompt: '   ' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/prompt is required/);
    expect(loaded).toBe(false);
  });

  it('fails gracefully when the core module is unavailable', async () => {
    const service = new MediaGenService(async () => null);
    const res = await service.generateImage({ prompt: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/core media module unavailable/);
  });

  it('surfaces a generation error as a result, not a throw', async () => {
    const service = new MediaGenService(async () => ({
      generateImage: async () => {
        throw new Error('ComfyUI unreachable');
      },
    }));
    const res = await service.generateImage({ prompt: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ComfyUI unreachable/);
  });

  it('uses the core capability probe so configured ComfyUI inpainting exposes real alpha masks', async () => {
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async () => ({ image: null }),
      getImageEditCapabilities: async () => ({
        provider: 'comfyui',
        available: true,
        alphaMasking: true,
      }),
    }));

    await expect(service.getCapabilities()).resolves.toMatchObject({
      imageEditing: true,
      imageReferences: true,
      imageMasking: true,
    });
  });

  it('passes a bounded local image, alpha mask, and marked regions to the real edit core', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-view-edit-'));
    const sourcePath = createGeneratedImage(directory);
    const editedPath = createGeneratedImage(directory, 'image-edit.png');
    let captured: Record<string, unknown> | undefined;
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async (input) => {
        captured = input;
        return { outputPath: editedPath, image: editedPath };
      },
    }), directory);
    try {
      const result = await service.editImage({
        prompt: 'Change this region',
        imagePath: sourcePath,
        maskDataUrl: `data:image/png;base64,${PNG_HEADER.toString('base64')}`,
        selections: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
        provider: 'openai',
      });
      expect(result).toMatchObject({
        ok: true,
        outputPath: editedPath,
        history: {
          headVersionId: expect.any(String),
          versions: [
            expect.objectContaining({ path: sourcePath, parentId: null }),
            expect.objectContaining({ path: editedPath, parentId: expect.any(String) }),
          ],
        },
      });
      expect(captured).toEqual({
        prompt: 'Change this region',
        imageUrl: `data:image/png;base64,${PNG_HEADER.toString('base64')}`,
        sourceRef: sourcePath,
        maskUrl: `data:image/png;base64,${PNG_HEADER.toString('base64')}`,
        selections: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
      });

      const historyPath = path.join(directory, '.codebuddy', 'media-generation', '.design-view-history', 'index.json');
      expect(statSync(path.dirname(historyPath)).mode & 0o777).toBe(0o700);
      expect(statSync(historyPath).mode & 0o777).toBe(0o600);
      expect(readFileSync(historyPath, 'utf8')).not.toContain('Change this region');

      // A new main-process service instance recovers the same chain after an
      // app reload; no renderer state participates in this lookup.
      const reloaded = new MediaGenService(async () => ({
        generateImage: async () => ({ image: null }),
      }), directory);
      await expect(reloaded.getImageEditHistory(sourcePath)).resolves.toMatchObject({
        ok: true,
        history: {
          versions: [
            expect.objectContaining({ path: sourcePath }),
            expect.objectContaining({ path: editedPath }),
          ],
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed Design View masks before reaching the provider', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-view-mask-'));
    const sourcePath = createGeneratedImage(directory);
    let edited = false;
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async () => {
        edited = true;
        return { image: null };
      },
    }), directory);
    try {
      const result = await service.editImage({
        prompt: 'Change',
        imagePath: sourcePath,
        maskDataUrl: 'data:text/plain;base64,AQID',
      });
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toMatch(/mask must be a PNG/);
      expect(edited).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses arbitrary renderer paths outside trusted generated-media roots', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-view-boundary-'));
    const outsidePath = path.join(directory, 'private.png');
    writeFileSync(outsidePath, PNG_HEADER);
    let edited = false;
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async () => {
        edited = true;
        return { image: null };
      },
    }), directory);
    try {
      const result = await service.editImage({ prompt: 'Upload this', imagePath: outsidePath });
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toMatch(/outside the generated-media roots/);
      expect(edited).toBe(false);
      await expect(service.getImageEditHistory(outsidePath)).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/outside the generated-media roots/),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when a generated image path crosses a symbolic link', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-view-symlink-'));
    const outsidePath = path.join(directory, 'private.png');
    writeFileSync(outsidePath, PNG_HEADER);
    const generatedPath = createGeneratedImage(directory, 'placeholder.png');
    const linkPath = path.join(path.dirname(generatedPath), 'linked.png');
    symlinkSync(outsidePath, linkPath);
    let edited = false;
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async () => {
        edited = true;
        return { image: null };
      },
    }), directory);
    try {
      const result = await service.editImage({ prompt: 'Upload this', imagePath: linkPath });
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toMatch(/outside the generated-media roots/);
      expect(edited).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects renamed non-image content inside the generated image root', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-view-signature-'));
    const sourcePath = createGeneratedImage(directory);
    writeFileSync(sourcePath, 'not really a png');
    let edited = false;
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async () => {
        edited = true;
        return { image: null };
      },
    }), directory);
    try {
      const result = await service.editImage({ prompt: 'Change', imagePath: sourcePath });
      expect(result).toMatchObject({ ok: false });
      expect(result.error).toMatch(/does not match its image type/);
      expect(edited).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('bounds persistent chains while retaining the original and current head', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-view-history-bound-'));
    const sourcePath = createGeneratedImage(directory);
    let sequence = 0;
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async () => {
        sequence += 1;
        const outputPath = createGeneratedImage(directory, `edit-${sequence}.png`);
        return { outputPath, image: outputPath };
      },
    }), directory);
    try {
      let currentPath = sourcePath;
      for (let index = 0; index < 15; index += 1) {
        const result = await service.editImage({ prompt: `Edit ${index}`, imagePath: currentPath });
        expect(result.ok).toBe(true);
        currentPath = result.outputPath!;
      }
      const history = await service.getImageEditHistory(sourcePath);
      expect(history.ok).toBe(true);
      expect(history.history?.versions).toHaveLength(12);
      expect(history.history?.versions[0]?.path).toBe(sourcePath);
      const head = history.history?.versions.find((version) => version.id === history.history?.headVersionId);
      expect(head?.path).toBe(currentPath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('revalidates every private-index path and fails closed on tampering', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'design-view-history-tamper-'));
    const sourcePath = createGeneratedImage(directory);
    const editedPath = createGeneratedImage(directory, 'edit.png');
    const outsidePath = path.join(directory, 'private.png');
    writeFileSync(outsidePath, PNG_HEADER);
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      editImage: async () => ({ outputPath: editedPath, image: editedPath }),
    }), directory);
    try {
      expect((await service.editImage({ prompt: 'Edit', imagePath: sourcePath })).ok).toBe(true);
      const indexPath = path.join(directory, '.codebuddy', 'media-generation', '.design-view-history', 'index.json');
      const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
        chains: Array<{ versions: Array<{ path: string }> }>;
      };
      index.chains[0]!.versions[1]!.path = outsidePath;
      writeFileSync(indexPath, JSON.stringify(index), { mode: 0o600 });

      await expect(service.getImageEditHistory(sourcePath)).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/outside the generated-media roots/),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('passes bounded local ingredients to video generation as data URLs', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'flow-video-'));
    const referencePath = createGeneratedImage(directory, 'lina.png');
    let captured: Record<string, unknown> | undefined;
    const service = new MediaGenService(async () => ({
      generateImage: async () => ({ image: null }),
      generateVideo: async (input) => {
        captured = input;
        return { outputPath: '/tmp/video.mp4', video: '/tmp/video.mp4' };
      },
    }), directory, undefined, undefined, async (id) => id === 'media:lina' ? referencePath : Promise.reject(new Error('unknown asset')));
    try {
      const result = await service.generateVideo({
        prompt: '@Lina marche',
        aspect: '16:9',
        duration: 6,
        imageAssetId: 'media:lina',
        referenceAssetIds: ['media:lina'],
      });
      expect(result).toMatchObject({ ok: true, url: 'file:///tmp/video.mp4' });
      expect(captured?.imageUrl).toBe(`data:image/png;base64,${PNG_HEADER.toString('base64')}`);
      expect(captured?.referenceImageUrls).toEqual([`data:image/png;base64,${PNG_HEADER.toString('base64')}`]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('assembles only ordered video clips through the core film assembler', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'flow-assemble-'));
    const videosDir = path.join(directory, '.codebuddy', 'media-generation', 'videos');
    mkdirSync(videosDir, { recursive: true });
    const first = path.join(videosDir, 'a.mp4');
    const second = path.join(videosDir, 'b.webm');
    const third = path.join(videosDir, 'c.mp4');
    writeFileSync(first, 'video-a');
    writeFileSync(second, 'video-b');
    writeFileSync(third, 'video-c');
    let captured: Record<string, unknown> | undefined;
    let assembledDuration: number | undefined = 11;
    let assetApproved = true;
    const filmsDir = path.join(directory, '.codebuddy', 'media-generation', 'films');
    mkdirSync(filmsDir, { recursive: true });
    const finalPath = path.join(filmsDir, 'final.mp4');
    writeFileSync(finalPath, 'assembled-video');
    const service = new MediaGenService(
      async () => ({ generateImage: async () => ({ image: null }) }),
      directory,
      async () => ({
        assembleFilm: async (input) => {
          captured = input;
          return {
            success: true,
            outputPath: finalPath,
            ...(assembledDuration === undefined ? {} : { estimatedDuration: assembledDuration }),
            warnings: [],
          };
        },
      }),
      undefined,
      undefined,
      async (id) => ({
        id,
        name: 'Lisa',
        kind: 'image',
        source: 'mysoulmate',
        url: 'file:///lisa.png',
        size: 8,
        mtimeMs: 1,
        contentTier: 'safe',
        qaStatus: assetApproved ? 'approved' as const : 'pending' as const,
        companionId: 'lisa',
      }),
    );
    try {
      const result = await service.assembleVideo({
        clips: [first, second, third],
        aspect: '9:16',
        name: 'Neon Story',
        editorial: {
          title: 'Une nuit avec Lisa',
          description: 'Une histoire originale à relire avant toute publication sur la chaîne.',
          series: 'Journal de Lisa',
          syntheticMediaDisclosure: true,
          prompt: 'Lisa traverse une ville lumineuse, découvre un café paisible, échange un sourire avec ses amis et termine cette aventure sereinement.',
          assetIds: ['asset:lisa-main'],
        },
      });
      expect(result).toMatchObject({ ok: true, outputPath: finalPath, metadataPath: `${finalPath}.youtube.json`, duration: 11 });
      expect(captured).toMatchObject({ clips: [first, second, third], transitions: 'dissolve', name: 'Neon Story' });
      expect(JSON.parse(readFileSync(result.metadataPath!, 'utf8'))).toMatchObject({
        visibility: 'private',
        containsSyntheticMedia: true,
        humanReviewRequired: true,
        reviewStatus: 'ready-for-human-review',
        qualityScore: 94,
      });
      assetApproved = false;
      const unapprovedAsset = await service.assembleVideo({
        clips: [first, second, third],
        aspect: '9:16',
        editorial: {
          title: 'Une nuit avec Lisa',
          description: 'Une histoire originale à relire avant toute publication sur la chaîne.',
          syntheticMediaDisclosure: true,
          prompt: 'Lisa traverse une ville lumineuse, découvre un café paisible, échange un sourire avec ses amis et termine cette aventure sereinement.',
          assetIds: ['asset:lisa-main'],
        },
      });
      expect(JSON.parse(readFileSync(unapprovedAsset.metadataPath!, 'utf8'))).toMatchObject({
        reviewStatus: 'needs-editorial-work',
        qualityChecks: expect.arrayContaining([expect.objectContaining({ id: 'assets', status: 'fail' })]),
      });
      assetApproved = true;
      const needsWork = await service.assembleVideo({
        clips: [first, second, third],
        aspect: '9:16',
        editorial: {
          title: 'Une nuit avec Lisa',
          description: 'Une histoire originale à relire avant toute publication sur la chaîne.',
          syntheticMediaDisclosure: false,
          prompt: 'Lisa traverse une ville lumineuse, découvre un café paisible, échange un sourire avec ses amis et termine cette aventure sereinement.',
          assetIds: ['asset:lisa-main'],
        },
      });
      expect(JSON.parse(readFileSync(needsWork.metadataPath!, 'utf8'))).toMatchObject({
        reviewStatus: 'needs-editorial-work',
      });
      assembledDuration = undefined;
      const unknownDuration = await service.assembleVideo({
        clips: [first, second, third],
        aspect: '9:16',
        editorial: {
          title: 'Une nuit avec Lisa',
          description: 'Une histoire originale à relire avant toute publication sur la chaîne.',
          syntheticMediaDisclosure: true,
          prompt: 'Lisa traverse une ville lumineuse, découvre un café paisible, échange un sourire avec ses amis et termine cette aventure sereinement.',
          assetIds: ['asset:lisa-main'],
        },
      });
      expect(JSON.parse(readFileSync(unknownDuration.metadataPath!, 'utf8'))).toMatchObject({
        reviewStatus: 'needs-editorial-work',
      });
      await expect(service.assembleVideo({ clips: [first, '/tmp/frame.png'] })).resolves.toMatchObject({ ok: false });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
