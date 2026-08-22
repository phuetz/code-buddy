import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_GEN_CHANNELS, registerMediaGenIpc } from '../src/main/media/media-gen-ipc';
import type { MediaGenService } from '../src/main/media/media-gen-service';

describe('media generation IPC', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
  const service = {
    generateImage: vi.fn(),
    editImage: vi.fn(async () => ({ ok: true, outputPath: '/generated/edit.png' })),
    getImageEditHistory: vi.fn(async () => ({ ok: true })),
    generateVideo: vi.fn(),
    getCapabilities: vi.fn(),
    assembleVideo: vi.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerMediaGenIpc(ipcMain as never, service as unknown as MediaGenService);
  });

  it('registers the complete media surface', () => {
    expect([...handlers.keys()]).toEqual(Object.values(MEDIA_GEN_CHANNELS));
  });

  it('rejects malformed or oversized edit payloads before the media service', async () => {
    const edit = handlers.get(MEDIA_GEN_CHANNELS.editImage)!;

    await expect(edit({}, { prompt: 'edit', imagePath: 42 })).resolves.toMatchObject({ ok: false });
    await expect(edit({}, {
      prompt: 'edit',
      imagePath: '/tmp/source.png',
      selections: Array.from({ length: 21 }, () => ({ x: 0, y: 0, width: 1, height: 1 })),
    })).resolves.toMatchObject({ ok: false });

    expect(service.editImage).not.toHaveBeenCalled();
  });

  it('forwards only the bounded typed edit contract', async () => {
    const edit = handlers.get(MEDIA_GEN_CHANNELS.editImage)!;
    const input = {
      prompt: 'Change the sky',
      imagePath: '/workspace/.codebuddy/media-generation/images/source.png',
      selections: [{ x: 0, y: 0, width: 1, height: 0.5 }],
      provider: 'openai',
      attackerSelectedRoot: '/etc',
    };

    await expect(edit({}, input)).resolves.toMatchObject({ ok: true });
    expect(service.editImage).toHaveBeenCalledWith({
      prompt: input.prompt,
      imagePath: input.imagePath,
      selections: input.selections,
      provider: 'openai',
    });
  });

  it('exposes a path-only history lookup and never accepts a renderer root', async () => {
    const history = handlers.get(MEDIA_GEN_CHANNELS.imageEditHistory)!;
    const imagePath = '/workspace/.codebuddy/media-generation/images/source.png';

    await expect(history({}, { imagePath, root: '/etc' })).resolves.toMatchObject({ ok: true });
    expect(service.getImageEditHistory).toHaveBeenCalledWith(imagePath);

    service.getImageEditHistory.mockClear();
    await expect(history({}, { imagePath: 42, root: '/workspace' })).resolves.toMatchObject({ ok: false });
    expect(service.getImageEditHistory).not.toHaveBeenCalled();
  });

  it('validates and forwards bounded editorial metadata for film assembly', async () => {
    service.assembleVideo.mockResolvedValueOnce({ ok: true });
    const assemble = handlers.get(MEDIA_GEN_CHANNELS.assembleVideo)!;
    const request = {
      clips: ['/workspace/a.mp4', '/workspace/b.mp4'],
      aspect: '9:16',
      name: 'Lisa Short',
      editorial: {
        title: 'Une journée avec Lisa',
        description: 'Un épisode original préparé pour une vérification humaine avant publication.',
        series: 'Journal de Lisa',
        syntheticMediaDisclosure: true,
        prompt: 'Lisa traverse la ville au lever du soleil puis retrouve ses amis dans un café chaleureux et partage un moment joyeux.',
        assetIds: ['asset:lisa-main', 'asset:lisa-main'],
        previousPrompts: ['Lisa lit un livre dans une bibliothèque silencieuse.'],
      },
    };

    await expect(assemble({}, request)).resolves.toMatchObject({ ok: true });
    expect(service.assembleVideo).toHaveBeenCalledWith({
      ...request,
      editorial: { ...request.editorial, assetIds: ['asset:lisa-main'] },
    });
  });

  it('rejects malformed editorial metadata before assembly', async () => {
    const assemble = handlers.get(MEDIA_GEN_CHANNELS.assembleVideo)!;
    await expect(assemble({}, {
      clips: ['/workspace/a.mp4', '/workspace/b.mp4'],
      editorial: { title: 'x', description: 'y', syntheticMediaDisclosure: 'yes', prompt: '', assetIds: [] },
    })).resolves.toMatchObject({ ok: false });
    expect(service.assembleVideo).not.toHaveBeenCalled();
  });
});
