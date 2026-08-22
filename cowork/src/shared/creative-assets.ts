export type CreativeAssetKind = 'image' | 'video' | 'audio';
export type CreativeAssetSource = 'workspace' | 'avatar-bible' | 'mysoulmate';
export type CreativeContentTier = 'safe' | 'sensual' | 'explicit';
export type CreativeQaStatus = 'pending' | 'approved' | 'rejected';

export interface CreativeAsset {
  id: string;
  name: string;
  kind: CreativeAssetKind;
  source: CreativeAssetSource;
  url: string;
  size: number;
  mtimeMs: number;
  contentTier: CreativeContentTier;
  qaStatus: CreativeQaStatus;
  companionId?: string;
  style?: string;
  width?: number;
  height?: number;
  duration?: number;
  prompt?: string;
  provider?: string;
  model?: string;
  sessionId?: string;
}

export interface CreativeAssetListInput {
  kind?: CreativeAssetKind;
  contentTier?: CreativeContentTier | 'all';
  companionId?: string;
  query?: string;
  limit?: number;
}

export interface CreativeAssetListResult {
  ok: boolean;
  assets: CreativeAsset[];
  allowedTiers: CreativeContentTier[];
  truncated: boolean;
  error?: string;
}

export interface CreativeAssetImportResult {
  ok: boolean;
  assets?: CreativeAsset[];
  canceled?: boolean;
  error?: string;
}

export interface CreativeAssetMaterializeInput {
  ids: string[];
  targetRoot: string;
  stack?: string;
}

export interface MaterializedCreativeAsset {
  id: string;
  name: string;
  relativePath: string;
  kind: CreativeAssetKind;
  contentTier: CreativeContentTier;
}

export interface CreativeAssetMaterializeResult {
  ok: boolean;
  assets?: MaterializedCreativeAsset[];
  error?: string;
}

export interface CreativeAssetApi {
  list(input?: CreativeAssetListInput): Promise<CreativeAssetListResult>;
  importImages(): Promise<CreativeAssetImportResult>;
  materialize(input: CreativeAssetMaterializeInput): Promise<CreativeAssetMaterializeResult>;
}

export const CREATIVE_ASSET_CHANNELS = {
  list: 'creativeAssets.list',
  importImages: 'creativeAssets.importImages',
  materialize: 'creativeAssets.materialize',
} as const;
