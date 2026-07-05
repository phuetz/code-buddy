/**
 * DeliverableCard — compact AI Drive deliverable item.
 *
 * @module renderer/components/DeliverableCard
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink, Share2 } from 'lucide-react';
import { formatWhen, kindEmoji } from './deliverables';
import type { Deliverable } from './deliverables';

export interface DeliverableCardProps {
  item: Deliverable;
  onOpen?: (d: Deliverable) => void;
  onShare?: (d: Deliverable) => void;
  onDownload?: (d: Deliverable) => void;
  className?: string;
}

export const DeliverableCard: React.FC<DeliverableCardProps> = ({
  item,
  onOpen,
  onShare,
  onDownload,
  className = '',
}) => {
  const { t } = useTranslation();
  const when = formatWhen(item.createdAt);

  return (
    <article
      data-testid={`deliverable-card-${item.id}`}
      className={`flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface p-3 text-sm ${className}`}
      aria-label={item.title}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-border text-lg" aria-hidden>
        {kindEmoji(item.kind)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-text" title={item.title}>
          {item.title}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
          <span title={new Date(item.createdAt).toLocaleString()}>{when}</span>
          {item.sizeLabel && <span className="truncate">{item.sizeLabel}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onOpen && (
          <button
            type="button"
            data-testid={`deliverable-open-${item.id}`}
            aria-label={t('deliverableCard.open', 'Open')}
            title={t('deliverableCard.open', 'Open')}
            onClick={() => onOpen(item)}
            className="rounded p-1.5 text-text-muted transition-colors hover:bg-border hover:text-text"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {onShare && (
          <button
            type="button"
            data-testid={`deliverable-share-${item.id}`}
            aria-label={t('deliverableCard.share', 'Share')}
            title={t('deliverableCard.share', 'Share')}
            onClick={() => onShare(item)}
            className="rounded p-1.5 text-text-muted transition-colors hover:bg-border hover:text-text"
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {onDownload && (
          <button
            type="button"
            data-testid={`deliverable-download-${item.id}`}
            aria-label={t('deliverableCard.download', 'Download')}
            title={t('deliverableCard.download', 'Download')}
            onClick={() => onDownload(item)}
            className="rounded p-1.5 text-text-muted transition-colors hover:bg-border hover:text-text"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
};

export default DeliverableCard;
