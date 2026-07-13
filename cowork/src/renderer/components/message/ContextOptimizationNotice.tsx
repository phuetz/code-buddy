import { useState, type MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  presentContextOptimization,
  type ContextOptimizationMetadata,
} from '../../../../../src/shared/context-optimization-metadata';

interface ContextOptimizationNoticeProps {
  metadata?: ContextOptimizationMetadata;
  compact?: boolean;
}

/** Shows recovery metadata without retrieving or rendering the raw observation. */
export function ContextOptimizationNotice({
  metadata,
  compact = false,
}: ContextOptimizationNoticeProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const presentation = presentContextOptimization(metadata);
  if (!presentation) return null;
  const badge = t('general.contextOptimizationSaved', {
    percent: presentation.percentSaved,
    defaultValue: `lm-resizer · ${presentation.percentSaved}% saved`,
  });

  if (compact) {
    return (
      <span
        className="px-1.5 py-0.5 text-[10px] rounded-md bg-accent/10 text-accent flex-shrink-0 font-medium"
        title={t('general.contextOptimizationAvailable', {
          rawRef: presentation.rawRef,
          command: presentation.restoreCommand,
          defaultValue: `Raw output ${presentation.rawRef} is available on demand. ${presentation.restoreCommand}`,
        })}
      >
        {badge}
      </span>
    );
  }

  const copyRestoreCommand = async (event: MouseEvent<HTMLButtonElement>): Promise<void> => {
    event.stopPropagation();
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(presentation.restoreCommand);
      setCopied(true);
    } catch {
      // Clipboard access is optional. The visible command remains copyable manually.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/15 bg-accent/5 px-2.5 py-2 text-[11px]">
      <span className="font-medium text-accent">{badge}</span>
      <span className="text-text-muted">
        {t('general.contextOptimizationRawKept', 'Raw output kept as')}{' '}
        <code className="font-mono text-text-secondary">{presentation.rawRef}</code>
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-text-muted" title={presentation.restoreCommand}>
        {presentation.restoreCommand}
      </code>
      <button
        type="button"
        onClick={copyRestoreCommand}
        className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-1.5 py-1 text-text-secondary hover:bg-surface-hover"
        aria-label={t('general.contextOptimizationCopy', 'Copy restore command')}
        title={t(
          'general.contextOptimizationCopyHint',
          'Copy restore command — the raw output is not loaded automatically',
        )}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied
          ? t('general.contextOptimizationCopied', 'Copied')
          : t('general.contextOptimizationCopyShort', 'Copy')}
      </button>
    </div>
  );
}
