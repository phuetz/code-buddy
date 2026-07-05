/**
 * Pure share-link permission helpers.
 *
 * @module renderer/utils/share-perms
 */

export interface SharePerms {
  access: 'read' | 'write';
  allowDownload: boolean;
  expiresAt?: number;
}

export function validatePerms(perms: SharePerms, now = Date.now()): { ok: boolean; error?: string } {
  if (perms.access !== 'read' && perms.access !== 'write') return { ok: false, error: 'access_invalid' };
  if (perms.expiresAt !== undefined && perms.expiresAt <= now) return { ok: false, error: 'expiry_in_past' };
  return { ok: true };
}

export function buildShareLink(id: string, perms: SharePerms): string {
  const params = new URLSearchParams({
    access: perms.access,
    download: String(perms.allowDownload),
  });
  if (perms.expiresAt !== undefined) params.set('expires', String(perms.expiresAt));
  return `/share/${encodeURIComponent(id)}?${params.toString()}`;
}
