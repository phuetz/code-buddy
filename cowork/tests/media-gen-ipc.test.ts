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
});
