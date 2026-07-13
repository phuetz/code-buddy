import type { IpcMain } from 'electron';
import {
  AVATAR_BIBLE_CHANNELS,
  type AvatarBibleConsent,
  type AvatarBibleMetadataInput,
  type AvatarBibleMutationResult,
  type AvatarBiblePreviewResult,
  type AvatarBibleRights,
  type AvatarBibleRole,
  type AvatarBibleSnapshotResult,
  type AvatarBibleUpdateInput,
  type AvatarBibleFlowAssetResult,
} from '../../shared/avatar-bible';
import { AvatarBibleService } from './avatar-bible-service';

/** Register the opaque-ID-only IPC surface for the project avatar bible. */
export function registerAvatarBibleIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: AvatarBibleService,
): void {
  ipcMain.handle(AVATAR_BIBLE_CHANNELS.list, async (): Promise<AvatarBibleSnapshotResult> => {
    try {
      return { ok: true, snapshot: await service.list() };
    } catch (error) {
      return { ok: false, error: cleanError(error) };
    }
  });

  ipcMain.handle(
    AVATAR_BIBLE_CHANNELS.importImage,
    async (_event, raw: unknown): Promise<AvatarBibleMutationResult> => {
      try {
        const result = await service.importFromDialog(metadataOnly(raw));
        return {
          ok: true,
          canceled: result.canceled,
          snapshot: result.snapshot,
          ...(result.avatar ? { avatar: result.avatar } : {}),
        };
      } catch (error) {
        return { ok: false, error: cleanError(error) };
      }
    },
  );

  ipcMain.handle(
    AVATAR_BIBLE_CHANNELS.update,
    async (_event, raw: unknown): Promise<AvatarBibleMutationResult> => {
      try {
        const input = updateOnly(raw);
        const result = await service.update(input);
        return { ok: true, avatar: result.avatar, snapshot: result.snapshot };
      } catch (error) {
        return { ok: false, error: cleanError(error) };
      }
    },
  );

  ipcMain.handle(
    AVATAR_BIBLE_CHANNELS.setMaster,
    async (_event, raw: unknown): Promise<AvatarBibleMutationResult> => {
      try {
        return { ok: true, snapshot: await service.setMaster(idOnly(raw)) };
      } catch (error) {
        return { ok: false, error: cleanError(error) };
      }
    },
  );

  ipcMain.handle(
    AVATAR_BIBLE_CHANNELS.remove,
    async (_event, raw: unknown): Promise<AvatarBibleMutationResult> => {
      try {
        const result = await service.remove(idOnly(raw));
        return { ok: true, removedId: result.removedId, snapshot: result.snapshot };
      } catch (error) {
        return { ok: false, error: cleanError(error) };
      }
    },
  );

  ipcMain.handle(
    AVATAR_BIBLE_CHANNELS.preview,
    async (_event, raw: unknown): Promise<AvatarBiblePreviewResult> => {
      try {
        const result = await service.preview(idOnly(raw));
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, error: cleanError(error) };
      }
    },
  );

  ipcMain.handle(
    AVATAR_BIBLE_CHANNELS.materializeForFlow,
    async (_event, raw: unknown): Promise<AvatarBibleFlowAssetResult> => {
      try {
        return { ok: true, ...await service.materializeForFlow(idOnly(raw)) };
      } catch (error) {
        return { ok: false, error: cleanError(error) };
      }
    },
  );
}

function metadataOnly(raw: unknown): AvatarBibleMetadataInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Métadonnées avatar invalides.');
  const input = raw as Record<string, unknown>;
  return {
    name: input.name as string,
    role: input.role as AvatarBibleRole,
    rights: input.rights as AvatarBibleRights,
    consent: input.consent as AvatarBibleConsent,
    ...(typeof input.notes === 'string' ? { notes: input.notes } : {}),
  };
}

function updateOnly(raw: unknown): AvatarBibleUpdateInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Mise à jour avatar invalide.');
  const input = raw as Record<string, unknown>;
  return { id: input.id as string, ...metadataOnly(raw) };
}

function idOnly(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Identifiant avatar invalide.');
  return (raw as Record<string, unknown>).id;
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').slice(0, 500);
}
