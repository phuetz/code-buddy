/**
 * ExportDialog — Claude Cowork parity Phase 2 step 16
 *
 * Modal dialog for exporting a session: format picker (Markdown / JSON
 * / HTML), redaction toggle, copy-to-clipboard, and save-to-file.
 *
 * @module renderer/components/ExportDialog
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Download,
  Copy,
  Check,
  FileText,
  FileJson,
  Globe,
  ShieldOff,
  Loader2,
  Presentation,
} from 'lucide-react';

type ExportFormat = 'markdown' | 'json' | 'html' | 'docx' | 'pptx';

interface ExportDialogProps {
  sessionId: string;
  sessionTitle?: string;
  onClose: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  sessionId,
  sessionTitle,
  onClose,
}) => {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [redactSecrets, setRedactSecrets] = useState(true);
  const [includeCheckpoints, setIncludeCheckpoints] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    setCopying(true);
    setStatusMessage(null);
    try {
      const api = window.electronAPI;
      if (!api?.session?.exportFull) {
        setStatusMessage('Export API unavailable');
        return;
      }
      if (format === 'docx' || format === 'pptx') {
        setStatusMessage(t('exportDialog.copyBinaryUnavailable', 'Copie indisponible pour Word/PowerPoint.'));
        return;
      }
      const result = await api.session.exportFull(sessionId, {
        format,
        redactSecrets,
        includeCheckpoints,
      });
      if (!result.success) {
        setStatusMessage(result.error ?? 'Export failed');
        return;
      }
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ExportDialog] copy failed:', err);
      setStatusMessage((err as Error).message);
    } finally {
      setCopying(false);
    }
  }, [sessionId, format, redactSecrets, includeCheckpoints, t]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const api = window.electronAPI;
      if (format === 'docx' || format === 'pptx') {
        if (!api?.session?.exportFull || !api?.officeExport?.save) {
          setStatusMessage('Export API unavailable');
          return;
        }
        const md = await api.session.exportFull(sessionId, {
          format: 'markdown',
          redactSecrets,
          includeCheckpoints,
        });
        if (!md.success) {
          setStatusMessage(md.error ?? 'Export failed');
          return;
        }
        const result = await api.officeExport.save({
          markdown: md.content,
          title: sessionTitle || sessionId,
          format,
          sessionId,
          suggestedName: sessionTitle || sessionId,
        });
        if (result.canceled) return;
        if (result.success) {
          setStatusMessage(t('exportDialog.savedTo', { path: result.path ?? '' }));
        } else {
          setStatusMessage(result.error ?? 'Save failed');
        }
        return;
      }
      if (!api?.session?.exportToFile) {
        setStatusMessage('Export API unavailable');
        return;
      }
      const result = await api.session.exportToFile(sessionId, {
        format,
        redactSecrets,
        includeCheckpoints,
      });
      if (result.success) {
        setStatusMessage(t('exportDialog.savedTo', { path: result.path ?? '' }));
      } else if (result.error !== 'Cancelled') {
        setStatusMessage(result.error ?? 'Save failed');
      }
    } catch (err) {
      console.error('[ExportDialog] save failed:', err);
      setStatusMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [sessionId, sessionTitle, format, redactSecrets, includeCheckpoints, t]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="export-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-xl shadow-elevated w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Download size={16} className="text-accent" />
            <h2 className="text-base font-semibold text-text-primary">
              {t('exportDialog.title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {sessionTitle && (
            <div className="text-xs text-text-muted truncate" title={sessionTitle}>
              {sessionTitle}
            </div>
          )}

          {/* Format picker */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">
              {t('exportDialog.format')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'markdown', label: 'Markdown', icon: FileText },
                  { id: 'json', label: 'JSON', icon: FileJson },
                  { id: 'html', label: 'HTML', icon: Globe },
                  { id: 'docx', label: 'Word', icon: FileText },
                  { id: 'pptx', label: 'Slides', icon: Presentation },
                ] as Array<{ id: ExportFormat; label: string; icon: React.ComponentType<{ size?: number }> }>
              ).map(({ id, label, icon: Icon }) => {
                const isSelected = format === id;
                return (
                  <button
                    key={id}
                    onClick={() => setFormat(id)}
                    className={`flex flex-col items-center gap-1 px-3 py-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
                    }`}
                  >
                    <Icon size={16} />
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={redactSecrets}
                onChange={(e) => setRedactSecrets(e.target.checked)}
                className="rounded border-border bg-surface accent-accent"
              />
              <ShieldOff size={12} className="text-warning" />
              <span className="text-xs text-text-primary">
                {t('exportDialog.redactSecrets')}
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCheckpoints}
                onChange={(e) => setIncludeCheckpoints(e.target.checked)}
                className="rounded border-border bg-surface accent-accent"
              />
              <span className="text-xs text-text-primary">
                {t('exportDialog.includeCheckpoints')}
              </span>
            </label>
          </div>

          {statusMessage && (
            <div className="text-[11px] text-text-muted px-2 py-1 bg-surface border border-border rounded">
              {statusMessage}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-muted">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleCopy}
            disabled={copying || format === 'docx' || format === 'pptx'}
            className="flex items-center gap-1 px-4 py-2 text-xs bg-surface hover:bg-surface-hover border border-border text-text-primary rounded transition-colors disabled:opacity-50"
          >
            {copying ? (
              <Loader2 size={12} className="animate-spin" />
            ) : copied ? (
              <Check size={12} className="text-success" />
            ) : (
              <Copy size={12} />
            )}
            {copied ? t('common.copied') : t('exportDialog.copy')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-2 text-xs bg-accent hover:bg-accent-hover text-white rounded transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {t('exportDialog.save')}
          </button>
        </div>
      </div>
    </div>
  );
};
