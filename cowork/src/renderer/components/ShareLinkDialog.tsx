/**
 * ShareLinkDialog — accessible share-link creation dialog for AI Drive items.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/ShareLinkDialog
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, X } from 'lucide-react';
import { buildShareLink, validatePerms, type SharePerms } from '../utils/share-perms';
import type { DriveItem } from '../utils/drive-index';

export interface ShareLinkDialogProps {
  item: DriveItem;
  onCreateLink: (item: DriveItem, perms: SharePerms, link: string) => void;
  onClose?: () => void;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ShareLinkDialog({ item, onCreateLink, onClose }: ShareLinkDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [access, setAccess] = useState<SharePerms['access']>('read');
  const [allowDownload, setAllowDownload] = useState(true);
  const [expiresDays, setExpiresDays] = useState('7');
  const perms = useMemo<SharePerms>(() => {
    const days = Number(expiresDays);
    return {
      access,
      allowDownload,
      expiresAt: Number.isFinite(days) && days > 0 ? Date.now() + days * 86_400_000 : undefined,
    };
  }, [access, allowDownload, expiresDays]);
  const validation = validatePerms(perms);
  const link = buildShareLink(item.id, perms);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    focusable[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" data-testid="share-link-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-link-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-xl"
        data-testid="share-link-dialog"
      >
        <div className="flex items-start gap-3 border-b border-border pb-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Link2 aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="share-link-title" className="truncate text-sm font-semibold text-foreground" title={item.title}>
              {t('genspark.share.title', 'Partager')} · {item.title}
            </h2>
            <p className="text-xs text-muted-foreground">{item.type}</p>
          </div>
          {onClose && (
            <button
              type="button"
              aria-label={t('genspark.share.close', 'Fermer')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              data-testid="share-close"
              onClick={onClose}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor="share-access">
            {t('genspark.share.access', 'Permission')}
            <select
              id="share-access"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              data-testid="share-access"
              value={access}
              onChange={(event) => setAccess(event.target.value as SharePerms['access'])}
            >
              <option value="read">{t('genspark.share.read', 'Lecture')}</option>
              <option value="write">{t('genspark.share.write', 'Écriture')}</option>
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-muted-foreground" htmlFor="share-expiry">
            {t('genspark.share.expiry', 'Expiration en jours')}
            <input
              id="share-expiry"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              data-testid="share-expiry"
              inputMode="numeric"
              value={expiresDays}
              onChange={(event) => setExpiresDays(event.target.value)}
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              className="h-4 w-4"
              data-testid="share-download"
              type="checkbox"
              checked={allowDownload}
              onChange={(event) => setAllowDownload(event.target.checked)}
            />
            {t('genspark.share.download', 'Autoriser le téléchargement')}
          </label>

          <div className="rounded-md border border-border bg-background p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t('genspark.share.preview', 'Lien')}</p>
            <code className="break-all text-xs text-foreground">{link}</code>
          </div>
        </div>

        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <button
            type="button"
            aria-label={t('genspark.share.create', 'Créer le lien')}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="share-create"
            disabled={!validation.ok}
            onClick={() => onCreateLink(item, perms, link)}
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            {t('genspark.share.create', 'Créer le lien')}
          </button>
        </div>
      </div>
    </div>
  );
}
