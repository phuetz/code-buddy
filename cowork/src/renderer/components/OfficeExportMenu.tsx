/**
 * Local Word / PowerPoint export control. No network.
 *
 * @module renderer/components/OfficeExportMenu
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Loader2, Presentation } from 'lucide-react';

export interface OfficeExportMenuProps {
  markdown: string;
  title: string;
  sessionId?: string | null;
  disabled?: boolean;
}

export function OfficeExportMenu({ markdown, title, sessionId, disabled }: OfficeExportMenuProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'docx' | 'pptx' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (format: 'docx' | 'pptx') => {
    setBusy(format);
    setStatus(null);
    try {
      const api = window.electronAPI?.officeExport;
      if (!api?.save) {
        setStatus(t('artifact.officeExportUnavailable', "Export bureautique indisponible."));
        return;
      }
      const result = await api.save({
        markdown,
        title,
        format,
        sessionId: sessionId ?? undefined,
        suggestedName: title,
      });
      if (result.canceled) return;
      if (result.success && result.path) {
        setStatus(t('artifact.officeExportSaved', { path: result.path }));
      } else {
        setStatus(result.error ?? t('artifact.officeExportFailed', "L'export a échoué."));
      }
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const idle = !busy && !disabled;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="office-export-docx"
          disabled={!idle || !markdown.trim()}
          onClick={() => void run('docx')}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          title={t('artifact.exportDocx', 'Exporter en document Word (.docx)')}
        >
          {busy === 'docx' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
          Word
        </button>
        <button
          type="button"
          data-testid="office-export-pptx"
          disabled={!idle || !markdown.trim()}
          onClick={() => void run('pptx')}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          title={t('artifact.exportPptx', 'Exporter en présentation (.pptx)')}
        >
          {busy === 'pptx' ? <Loader2 size={12} className="animate-spin" /> : <Presentation size={12} />}
          Slides
        </button>
      </div>
      {status && (
        <p
          data-testid="office-export-status"
          className="max-w-[280px] text-[10px] leading-snug text-text-muted"
          title={status}
        >
          {status}
        </p>
      )}
    </div>
  );
}
