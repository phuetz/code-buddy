import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import {
  CREATIVE_ASSET_CHANNELS,
  type CreativeAssetListInput,
  type CreativeAssetMaterializeInput,
} from '../../shared/creative-assets';
import type { CreativeAssetRegistry } from './creative-asset-registry';

export function registerCreativeAssetIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  registry: CreativeAssetRegistry,
): void {
  ipcMain.handle(CREATIVE_ASSET_CHANNELS.list, async (_event, input: CreativeAssetListInput | undefined) =>
    registry.list(validateListInput(input)),
  );
  ipcMain.handle(CREATIVE_ASSET_CHANNELS.importImages, async () => {
    const selected = await dialog.showOpenDialog({
      title: 'Importer des images dans le registre créatif',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (selected.canceled || selected.filePaths.length === 0) return { ok: false, canceled: true };
    try {
      return { ok: true, assets: await registry.importPaths(selected.filePaths) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(CREATIVE_ASSET_CHANNELS.materialize, async (_event, input: CreativeAssetMaterializeInput) =>
    registry.materialize(validateMaterializeInput(input)),
  );
}

function validateListInput(value: unknown): CreativeAssetListInput {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Filtre d’assets invalide.');
  const input = value as Record<string, unknown>;
  return {
    ...(input.kind === 'image' || input.kind === 'video' || input.kind === 'audio' ? { kind: input.kind } : {}),
    ...(input.contentTier === 'safe' || input.contentTier === 'sensual' || input.contentTier === 'explicit' || input.contentTier === 'all' ? { contentTier: input.contentTier } : {}),
    ...(typeof input.companionId === 'string' && input.companionId.length <= 120 ? { companionId: input.companionId } : {}),
    ...(typeof input.query === 'string' && input.query.length <= 200 ? { query: input.query } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
  };
}

function validateMaterializeInput(value: unknown): CreativeAssetMaterializeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Demande de matérialisation invalide.');
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.ids) || input.ids.some((id) => typeof id !== 'string')) throw new Error('Identifiants d’assets invalides.');
  if (typeof input.targetRoot !== 'string') throw new Error('Dossier cible invalide.');
  return {
    ids: input.ids as string[],
    targetRoot: input.targetRoot,
    ...(typeof input.stack === 'string' && input.stack.length <= 80 ? { stack: input.stack } : {}),
  };
}
