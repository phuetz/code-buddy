/**
 * Renderer-safe contract for the private, project-scoped Code Buddy avatar bible.
 *
 * Deliberately absent: filesystem paths, face-enrolment data and embeddings.
 * Renderer callers identify every stored image with an opaque UUID only.
 */

export const AVATAR_BIBLE_ROLES = [
  'master',
  'front',
  'profile',
  'expression',
  'costume',
] as const;

export const AVATAR_BIBLE_RIGHTS = ['owned', 'licensed', 'consented'] as const;
export const AVATAR_BIBLE_CONSENT = ['not-applicable', 'confirmed'] as const;

export type AvatarBibleRole = (typeof AVATAR_BIBLE_ROLES)[number];
export type AvatarBibleRights = (typeof AVATAR_BIBLE_RIGHTS)[number];
export type AvatarBibleConsent = (typeof AVATAR_BIBLE_CONSENT)[number];

export interface AvatarBibleEntry {
  id: string;
  name: string;
  role: AvatarBibleRole;
  rights: AvatarBibleRights;
  consent: AvatarBibleConsent;
  notes?: string;
  sha256: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
}

export interface AvatarBibleSnapshot {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  masterId?: string;
  avatars: AvatarBibleEntry[];
  privacy: {
    projectScoped: true;
    containsFaceEmbeddings: false;
    note: string;
  };
}

export interface AvatarBibleMetadataInput {
  name: string;
  role: AvatarBibleRole;
  rights: AvatarBibleRights;
  consent: AvatarBibleConsent;
  notes?: string;
}

export interface AvatarBibleUpdateInput extends AvatarBibleMetadataInput {
  id: string;
}

export interface AvatarBibleIdInput {
  id: string;
}

export interface AvatarBibleSnapshotResult {
  ok: boolean;
  snapshot?: AvatarBibleSnapshot;
  canceled?: boolean;
  error?: string;
}

export interface AvatarBibleMutationResult extends AvatarBibleSnapshotResult {
  avatar?: AvatarBibleEntry;
  removedId?: string;
}

export interface AvatarBiblePreviewResult {
  ok: boolean;
  id?: string;
  dataUrl?: string;
  error?: string;
}

export interface AvatarBibleFlowAssetResult {
  ok: boolean;
  id?: string;
  name?: string;
  /** Materialized derivative in the already-approved generated-media root. */
  path?: string;
  url?: string;
  error?: string;
}

export interface AvatarBibleApi {
  list: () => Promise<AvatarBibleSnapshotResult>;
  importImage: (input: AvatarBibleMetadataInput) => Promise<AvatarBibleMutationResult>;
  update: (input: AvatarBibleUpdateInput) => Promise<AvatarBibleMutationResult>;
  setMaster: (input: AvatarBibleIdInput) => Promise<AvatarBibleMutationResult>;
  remove: (input: AvatarBibleIdInput) => Promise<AvatarBibleMutationResult>;
  preview: (input: AvatarBibleIdInput) => Promise<AvatarBiblePreviewResult>;
  materializeForFlow: (input: AvatarBibleIdInput) => Promise<AvatarBibleFlowAssetResult>;
}

export const AVATAR_BIBLE_CHANNELS = {
  list: 'avatarBible.list',
  importImage: 'avatarBible.importImage',
  update: 'avatarBible.update',
  setMaster: 'avatarBible.setMaster',
  remove: 'avatarBible.remove',
  preview: 'avatarBible.preview',
  materializeForFlow: 'avatarBible.materializeForFlow',
} as const;
