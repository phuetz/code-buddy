/**
 * SettingsImportExport — Claude Cowork parity Phase 2 step 19
 *
 * Export / import the user's settings bundle (API config, projects,
 * rules, MCP servers) with a conflict resolver before applying.
 *
 * @module renderer/components/settings/SettingsImportExport
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Upload,
  Check,
  X,
  AlertTriangle,
  Loader2,
  FileJson,
  Archive,
} from 'lucide-react';

interface ImportPreview {
  bundle: Record<string, unknown>;
  conflicts: Array<{
    type: string;
    identifier: string;
    current?: unknown;
    incoming: unknown;
  }>;
  newProjects: number;
  newMcpServers: number;
}

export const SettingsImportExport: React.FC = () => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<'skip' | 'overwrite'>('skip');

  const handleExport = useCallback(async () => {
    setExporting(true);
    setStatusMessage(null);
    try {
      const api = window.electronAPI;
      if (!api?.configSync?.exportToFile) {
        setStatusMessage('Export API unavailable');
        return;
      }
      const result = await api.configSync.exportToFile();
      if (result.success) {
        setStatusMessage(t('settingsSync.exported'));
      } else if (result.error !== 'Cancelled') {
        setStatusMessage(result.error ?? 'Export failed');
      }
    } finally {
      setExporting(false);
    }
  }, [t]);

  const handleImportPick = useCallback(async () => {
    setImporting(true);
    setStatusMessage(null);
    try {
      const api = window.electronAPI;
      if (!api?.configSync?.importFromFile) {
        setStatusMessage('Import API unavailable');
        return;
      }
      const result = await api.configSync.importFromFile();
      if (result.success && result.preview) {
        setPreview(result.preview as ImportPreview);
      } else if (result.error !== 'Cancelled') {
        setStatusMessage(result.error ?? 'Import failed');
      }
    } finally {
      setImporting(false);
    }
  }, []);

  const handleApply = useCallback(async () => {
    if (!preview) return;
    setApplying(true);
    setStatusMessage(null);
    try {
      const api = window.electronAPI;
      if (!api?.configSync?.applyImport) return;
      const result = await api.configSync.applyImport(preview.bundle, strategy);
      if (result.success) {
        setStatusMessage(
          t('settingsSync.applied', {
            projects: result.imported.projects,
            mcp: result.imported.mcpServers,
          })
        );
      } else {
        setStatusMessage(result.errors.join('; '));
      }
      setPreview(null);
    } finally {
      setApplying(false);
    }
  }, [preview, strategy, t]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
          <FileJson size={14} className="text-accent" />
          {t('settingsSync.title')}
        </h3>
        <p className="text-xs text-text-muted">{t('settingsSync.description')}</p>
      </div>

      {/* Export card */}
      <div className="p-4 bg-surface border border-border rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {t('settingsSync.exportTitle')}
            </div>
            <div className="text-[11px] text-text-muted">
              {t('settingsSync.exportHint')}
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-50"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {t('settingsSync.export')}
          </button>
        </div>
      </div>

      {/* Import card */}
      <div className="p-4 bg-surface border border-border rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {t('settingsSync.importTitle')}
            </div>
            <div className="text-[11px] text-text-muted">
              {t('settingsSync.importHint')}
            </div>
          </div>
          <button
            onClick={handleImportPick}
            disabled={importing || preview !== null}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface hover:bg-surface-hover border border-border text-text-primary rounded disabled:opacity-50"
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {t('settingsSync.pickFile')}
          </button>
        </div>
      </div>

      {/* Conflict preview */}
      {preview && (
        <div className="p-4 bg-warning/10 border border-warning rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-warning" />
            <span className="text-sm font-semibold text-text-primary">
              {t('settingsSync.previewTitle')}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div className="p-2 bg-background rounded">
              <div className="text-xs font-semibold text-text-primary">
                {preview.newProjects}
              </div>
              <div className="text-[10px] text-text-muted">
                {t('settingsSync.newProjects')}
              </div>
            </div>
            <div className="p-2 bg-background rounded">
              <div className="text-xs font-semibold text-text-primary">
                {preview.newMcpServers}
              </div>
              <div className="text-[10px] text-text-muted">
                {t('settingsSync.newMcpServers')}
              </div>
            </div>
            <div className="p-2 bg-background rounded">
              <div className="text-xs font-semibold text-warning">
                {preview.conflicts.length}
              </div>
              <div className="text-[10px] text-text-muted">
                {t('settingsSync.conflicts')}
              </div>
            </div>
          </div>

          {preview.conflicts.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-text-muted mb-1">
                {t('settingsSync.conflictList')}
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {preview.conflicts.map((conflict, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 bg-background rounded text-[11px]"
                  >
                    <span className="text-text-muted">{conflict.type}</span>
                    <span className="text-text-primary font-mono truncate">
                      {conflict.identifier}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-text-muted mb-1">
              {t('settingsSync.resolveStrategy')}
            </div>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-xs text-text-primary">
                <input
                  type="radio"
                  checked={strategy === 'skip'}
                  onChange={() => setStrategy('skip')}
                  className="accent-accent"
                />
                {t('settingsSync.skip')}
              </label>
              <label className="flex items-center gap-1 text-xs text-text-primary">
                <input
                  type="radio"
                  checked={strategy === 'overwrite'}
                  onChange={() => setStrategy('overwrite')}
                  className="accent-accent"
                />
                {t('settingsSync.overwrite')}
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPreview(null)}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
            >
              <X size={12} className="inline mr-1" />
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApply}
              disabled={applying}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-50"
            >
              {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {t('settingsSync.apply')}
            </button>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="text-xs text-text-muted px-3 py-2 bg-surface border border-border rounded">
          {statusMessage}
        </div>
      )}

      <BackupsSection />
    </div>
  );
};

/**
 * `.codebuddy/` backups — same core handler as `buddy backup` (create /
 * verify / list / restore). The handler returns operator-facing text;
 * it is shown verbatim in a console-style box. Restore is destructive,
 * so it sits behind an explicit confirmation step.
 */
const BackupsSection: React.FC = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyConfig, setOnlyConfig] = useState(false);
  const [file, setFile] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (name: string, action: () => Promise<{ ok: boolean; error?: string; output?: string }>) => {
      setBusy(name);
      setError(null);
      try {
        const result = await action();
        if (result.ok) setOutput(result.output ?? '');
        else setError(result.error ?? `${name} failed`);
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const api = window.electronAPI;

  return (
    <div className="p-4 bg-surface border border-border rounded-lg" data-testid="settings-backups">
      <div className="flex items-center gap-2 mb-1">
        <Archive size={14} className="text-accent" />
        <span className="text-sm font-medium text-text-primary">
          {t('backups.title', '.codebuddy backups')}
        </span>
      </div>
      <p className="text-[11px] text-text-muted mb-3">
        {t(
          'backups.hint',
          'Protects memory, lessons, missions and settings — same format as `buddy backup`.'
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button
          onClick={() => void run('create', () => api.backup.create({ onlyConfig }))}
          disabled={busy !== null}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded disabled:opacity-50"
          data-testid="backups-create"
        >
          {busy === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
          {t('backups.create', 'Create backup')}
        </button>
        <label className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyConfig}
            onChange={(e) => setOnlyConfig(e.target.checked)}
            className="h-3 w-3 accent-accent"
            data-testid="backups-only-config"
          />
          {t('backups.onlyConfig', 'config only')}
        </label>
        <button
          onClick={() => void run('list', () => api.backup.list())}
          disabled={busy !== null}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface hover:bg-surface-hover border border-border text-text-primary rounded disabled:opacity-50"
          data-testid="backups-list"
        >
          {busy === 'list' ? <Loader2 size={12} className="animate-spin" /> : null}
          {t('backups.list', 'List backups')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          value={file}
          onChange={(e) => {
            setFile(e.target.value);
            setConfirmRestore(false);
          }}
          placeholder={t('backups.filePlaceholder', 'Backup file (from the list above)…')}
          className="flex-1 min-w-[220px] px-2 py-1.5 text-xs rounded bg-background border border-border text-text-primary placeholder:text-text-muted font-mono"
          data-testid="backups-file"
        />
        <button
          onClick={() => void run('verify', () => api.backup.verify(file))}
          disabled={busy !== null || !file.trim()}
          className="px-3 py-1.5 text-xs bg-surface hover:bg-surface-hover border border-border text-text-primary rounded disabled:opacity-50"
          data-testid="backups-verify"
        >
          {t('backups.verify', 'Verify')}
        </button>
        {!confirmRestore ? (
          <button
            onClick={() => setConfirmRestore(true)}
            disabled={busy !== null || !file.trim()}
            className="px-3 py-1.5 text-xs border border-warning/50 text-warning rounded hover:bg-warning/10 disabled:opacity-50"
            data-testid="backups-restore"
          >
            {t('backups.restore', 'Restore…')}
          </button>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] text-warning">
              {t('backups.restoreConfirm', 'Overwrites current .codebuddy data —')}
            </span>
            <button
              onClick={() => {
                setConfirmRestore(false);
                void run('restore', () => api.backup.restore(file));
              }}
              disabled={busy !== null}
              className="px-2 py-1 text-xs bg-warning text-background rounded disabled:opacity-50"
              data-testid="backups-restore-confirm"
            >
              {busy === 'restore' ? <Loader2 size={12} className="animate-spin inline" /> : null}
              {t('backups.restoreYes', 'Restore now')}
            </button>
            <button
              onClick={() => setConfirmRestore(false)}
              className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
              data-testid="backups-restore-cancel"
            >
              {t('common.cancel', 'Cancel')}
            </button>
          </span>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-error mb-2" data-testid="backups-error">
          {error}
        </p>
      )}
      {output !== null && (
        <pre
          className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-background border border-border-muted p-2 text-[10px] text-text-secondary font-mono"
          data-testid="backups-output"
        >
          {output}
        </pre>
      )}
    </div>
  );
};
