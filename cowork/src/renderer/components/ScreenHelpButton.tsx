import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { openScreenHelp } from '../help/open-screen-help';

interface ScreenHelpButtonProps {
  screenId: string;
  className?: string;
}

export function ScreenHelpButton({ screenId, className }: ScreenHelpButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid={`screen-help-${screenId}`}
      aria-label={t('helpDocs.openForScreen', 'Help for this screen')}
      title={t('helpDocs.openForScreen', 'Help for this screen')}
      onClick={() => openScreenHelp(screenId)}
      className={
        className ??
        'rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary'
      }
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  );
}
