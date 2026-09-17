import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, BookOpenText, Eye, FolderOpen, Save } from 'lucide-react';
import { useAppStore } from '../../store';
import type { FolderInstructionsSnapshot } from '../../../shared/folder-instructions';
import { SettingsContentSection } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

function originClass(origin: string): string {
  if (origin === 'global') return 'bg-surface text-text-muted';
  if (origin === 'folder') return 'bg-accent/15 text-accent';
  return 'bg-warning/15 text-warning';
}

export function SettingsFolderInstructions() {
  const { t } = useTranslation();
  const workingDir = useAppStore((s) => s.workingDir);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionCwd = useMemo(
    () => sessions.find((session) => session.id === activeSessionId)?.cwd,
    [activeSessionId, sessions],
  );
  const cwd = sessionCwd || workingDir || '';

  const [snapshot, setSnapshot] = useState<FolderInstructionsSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!isElectron || !cwd) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.folderInstructions?.inspect?.({ cwd });
      if (!res?.ok || !res.snapshot) {
        setError(res?.error ?? t('folderInstructions.loadFailed', 'Failed to load folder instructions'));
        setSnapshot(null);
        return;
      }
      setSnapshot(res.snapshot);
      setDraft(res.snapshot.folderFile.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!isElectron || !cwd || !snapshot) return;
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      const res = await window.electronAPI.folderInstructions?.save?.({
        cwd,
        fileName: snapshot.folderFile.fileName,
        content: draft,
      });
      if (!res?.ok || !res.snapshot) {
        setError(res?.error ?? t('folderInstructions.saveFailed', 'Save failed'));
        return;
      }
      setSnapshot(res.snapshot);
      setDraft(res.snapshot.folderFile.content);
      setNotice(t('folderInstructions.saved', 'Folder instructions saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const originLabel = (origin: string) => {
    if (origin === 'global') return t('folderInstructions.originGlobal', 'Global');
    if (origin === 'folder') return t('folderInstructions.originFolder', 'Folder (project root)');
    return t('folderInstructions.originSubdirectory', 'Subdirectory');
  };

  return (
    <div className="space-y-1" data-testid="folder-instructions-panel">
      <SettingsContentSection
        title={t('folderInstructions.title', 'Folder instructions')}
        description={t(
          'folderInstructions.hint',
          'Instructions the kernel actually injects for the current working folder, in application order (later rows win on conflict).',
        )}
      >
        <div className="rounded-lg border border-border-muted bg-background px-3 py-2 text-xs text-text-secondary">
          <div className="flex items-center gap-1.5 font-medium text-text-primary">
            <FolderOpen className="h-3.5 w-3.5" />
            {cwd || t('folderInstructions.noFolder', 'No working folder selected')}
          </div>
          {snapshot && (
            <div className="mt-1 text-text-muted">
              {t('folderInstructions.projectRoot', 'Project root')}: {snapshot.projectRoot}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-1.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {notice && <p className="text-xs text-accent">{notice}</p>}
        {loading && <p className="text-xs text-text-muted">{t('common.loading', 'Loading…')}</p>}

        {snapshot?.notes.map((note) => (
          <p key={note} className="text-xs leading-5 text-text-muted" data-testid="folder-instructions-note">
            {note}
          </p>
        ))}

        <div className="overflow-hidden rounded-lg border border-border-muted">
          <table className="w-full text-left text-xs" data-testid="folder-instructions-applied">
            <thead className="bg-surface/60 text-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{t('folderInstructions.order', 'Order')}</th>
                <th className="px-3 py-2 font-medium">{t('folderInstructions.file', 'File')}</th>
                <th className="px-3 py-2 font-medium">{t('folderInstructions.origin', 'Origin')}</th>
                <th className="px-3 py-2 font-medium">{t('folderInstructions.variant', 'Variant')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot?.applied.length ? (
                snapshot.applied.map((source) => (
                  <tr key={`${source.priorityIndex}-${source.path}`} className="border-t border-border-muted">
                    <td className="px-3 py-2 tabular-nums text-text-muted">{source.priorityIndex + 1}</td>
                    <td className="px-3 py-2 font-mono text-text-primary">
                      {source.relPath}
                      {source.truncated ? ' …' : ''}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 ${originClass(source.origin)}`}>
                        {originLabel(source.origin)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{source.variant}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-text-muted">
                    {t('folderInstructions.noneApplied', 'No instruction files applied for this folder.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-text-muted">
          {t(
            'folderInstructions.priorityHint',
            '1 is injected first (lowest precedence). The last row wins if two files disagree.',
          )}
        </p>

        {(snapshot?.presentNotApplied.length ?? 0) > 0 && (
          <div data-testid="folder-instructions-not-applied">
            <h5 className="text-xs font-semibold text-text-primary">
              {t('folderInstructions.notAppliedTitle', 'Present but not injected at startup')}
            </h5>
            <ul className="mt-1 space-y-1 text-xs font-mono text-text-secondary">
              {snapshot?.presentNotApplied.map((source) => (
                <li key={source.path}>
                  {source.relPath} · {originLabel(source.origin)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsContentSection>

      <SettingsContentSection
        title={t('folderInstructions.editorTitle', 'Edit this folder’s AGENTS.md')}
        description={t(
          'folderInstructions.editorHint',
          'Creates or updates AGENTS.md in the current working folder. A .local or .override variant, if present, is the file the kernel actually loads.',
        )}
      >
        {snapshot && !snapshot.folderFile.exists && (
          <div
            className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
            data-testid="folder-instructions-missing"
          >
            {t(
              'folderInstructions.missing',
              'No AGENTS.md in this folder yet. Save to create it. Ancestor and global files above still apply.',
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-text-secondary">
            {snapshot?.folderFile.path ?? (cwd ? `${cwd}/AGENTS.md` : 'AGENTS.md')}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPreview((value) => !value)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface"
              data-testid="folder-instructions-preview-toggle"
            >
              <Eye className="h-3.5 w-3.5" />
              {preview
                ? t('folderInstructions.edit', 'Edit')
                : t('folderInstructions.preview', 'Preview')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !cwd}
              data-testid="folder-instructions-save"
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </button>
          </div>
        </div>

        {preview ? (
          <pre
            data-testid="folder-instructions-preview"
            className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface/40 p-3 font-mono text-xs text-text-primary"
          >
            {draft || t('folderInstructions.emptyPreview', '(empty — this file would not be injected)')}
          </pre>
        ) : (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="folder-instructions-editor"
            className="min-h-[16rem] w-full resize-y rounded border border-border bg-surface/40 p-3 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            placeholder="# AGENTS.md"
          />
        )}

        {snapshot?.appliedText ? (
          <details className="rounded border border-border-muted px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-text-secondary">
              {t('folderInstructions.mergedPreview', 'Merged text actually injected at startup')}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-text-muted">
              {snapshot.appliedText}
            </pre>
          </details>
        ) : null}

        <p className="flex items-center gap-1 text-[11px] text-text-muted">
          <BookOpenText className="h-3 w-3" />
          {t(
            'folderInstructions.identityNote',
            'Agent identity files (SOUL.md, USER.md) are a different panel. Cowork project master instructions live under Settings → Projects.',
          )}
        </p>
      </SettingsContentSection>
    </div>
  );
}
