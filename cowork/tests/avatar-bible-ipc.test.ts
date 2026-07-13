import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAvatarBibleIpc } from '../src/main/comfy-lab/avatar-bible-ipc';
import type { AvatarBibleService } from '../src/main/comfy-lab/avatar-bible-service';
import { AVATAR_BIBLE_CHANNELS } from '../src/shared/avatar-bible';

describe('Avatar Bible IPC', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
  const service = {
    list: vi.fn(async () => ({ schemaVersion: 1, avatars: [] })),
    importFromDialog: vi.fn(async () => ({ canceled: false, snapshot: { avatars: [] } })),
    update: vi.fn(async () => ({ avatar: { id: 'avatar' }, snapshot: { avatars: [] } })),
    setMaster: vi.fn(async () => ({ avatars: [] })),
    remove: vi.fn(async () => ({ removedId: 'id', snapshot: { avatars: [] } })),
    preview: vi.fn(async () => ({ id: 'id', dataUrl: 'data:image/png;base64,AA==' })),
    materializeForFlow: vi.fn(async () => ({ id: 'id', name: 'Buddy', path: '/generated/avatar.png', url: 'file:///generated/avatar.png' })),
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerAvatarBibleIpc(ipcMain as never, service as unknown as AvatarBibleService);
  });

  it('registers the complete opaque-ID API', () => {
    expect([...handlers.keys()]).toEqual(Object.values(AVATAR_BIBLE_CHANNELS));
    expect(Object.values(AVATAR_BIBLE_CHANNELS).some((channel) => /embedding|enrol/iu.test(channel))).toBe(false);
  });

  it('strips renderer paths and biometric-shaped fields before opening the main-process dialog', async () => {
    const importImage = handlers.get(AVATAR_BIBLE_CHANNELS.importImage)!;
    await expect(importImage({}, {
      name: 'Buddy',
      role: 'front',
      rights: 'owned',
      consent: 'not-applicable',
      notes: 'cyan',
      path: '/etc/passwd',
      sourcePath: '/tmp/attacker.png',
      embedding: [1, 2, 3],
      faceEnrollmentId: 'secret',
    })).resolves.toMatchObject({ ok: true });
    expect(service.importFromDialog).toHaveBeenCalledWith({
      name: 'Buddy',
      role: 'front',
      rights: 'owned',
      consent: 'not-applicable',
      notes: 'cyan',
    });
  });

  it('forwards only an opaque id to preview, master, remove, and Flow materialization', async () => {
    const input = { id: 'f65b8e2d-83ca-4b26-8bc2-b21ece813c4b', path: '/etc', workspace: '/' };
    for (const channel of [
      AVATAR_BIBLE_CHANNELS.preview,
      AVATAR_BIBLE_CHANNELS.setMaster,
      AVATAR_BIBLE_CHANNELS.remove,
      AVATAR_BIBLE_CHANNELS.materializeForFlow,
    ]) {
      await handlers.get(channel)!({}, input);
    }
    expect(service.preview).toHaveBeenCalledWith(input.id);
    expect(service.setMaster).toHaveBeenCalledWith(input.id);
    expect(service.remove).toHaveBeenCalledWith(input.id);
    expect(service.materializeForFlow).toHaveBeenCalledWith(input.id);
  });

  it('returns bounded errors rather than leaking rejected IPC exceptions', async () => {
    service.list.mockRejectedValueOnce(new Error('x'.repeat(1_000)));
    const result = await handlers.get(AVATAR_BIBLE_CHANNELS.list)!({}) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toHaveLength(500);
  });
});
