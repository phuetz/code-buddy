/**
 * SettingsWorkspacePresets — Phase 3 step 9
 *
 * Save/load named workspace configurations (model, permission mode,
 * memory scope, default workspace path). Presets can be applied to
 * the currently active session through the renderer.
 */
import { ANTHROPIC_DEFAULT_MODEL } from '../../../shared/anthropic-models';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Trash2, Layers, Play } from 'lucide-react';
import { useAppStore } from '../../store';

interface Preset {
  id: string;
  name: string;
  description?: string;
  workspacePath?: string;
  model?: string;
  permissionMode?: string;
  memoryScope?: 'project' | 'global' | 'none';
  createdAt: number;
  updatedAt: number;
}

const EMPTY: Partial<Preset> = {
  name: '',
  description: '',
  workspacePath: '',
  model: '',
  permissionMode: 'default',
  memoryScope: 'project',
};

export function SettingsWorkspacePresets() {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<Partial<Preset>>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeSession = useAppStore((s) =>
    s.activeSessionId ? s.sessions.find((ss) => ss.id === s.activeSessionId) ?? null : null
  );
  const workingDir = useAppStore((s) => s.workingDir);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);

  const load = useCallback(async () => {
    if (!window.electronAPI?.workspacePresets?.list) return;
    const list = (await window.electronAPI.workspacePresets.list()) as Preset[];
    setPresets(list);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectPreset = (p: Preset) => {
    setSelectedId(p.id);
    setDraft(p);
    setDirty(false);
  };

  const newPreset = () => {
    setSelectedId(null);
    setDraft({
      ...EMPTY,
      workspacePath: activeSession?.cwd || workingDir || '',
      model: activeSession?.model || '',
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!draft.name?.trim()) return;
    const result = await window.electronAPI?.workspacePresets?.save({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description,
      workspacePath: draft.workspacePath,
      model: draft.model,
      permissionMode: draft.permissionMode,
      memoryScope: draft.memoryScope as 'project' | 'global' | 'none' | undefined,
    });
    if (result?.success && result.preset) {
      await load();
      setSelectedId(result.preset.id);
      setDirty(false);
      setNotice(t('workspacePresets.saved'));
      setTimeout(() => setNotice(null), 2000);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(t('workspacePresets.deleteConfirm'))) return;
    await window.electronAPI?.workspacePresets?.delete(selectedId);
    await load();
    setSelectedId(null);
    setDraft(EMPTY);
    setDirty(false);
  };

  const handleApply = async () => {
    if (!selectedId || !draft) return;
    // Phase 3 step 9: applying a preset updates client-side state only for now.
    // Workspace path changes route through the existing changeWorkingDir flow
    // if the user explicitly chooses to after apply.
    if (draft.permissionMode) setPermissionMode(draft.permissionMode as never);
    if (draft.model && window.electronAPI?.model?.switch) {
      await window.electronAPI.model.switch(draft.model);
    }
    setNotice(t('workspacePresets.applied'));
    setTimeout(() => setNotice(null), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t('workspacePresets.title')}
          </h3>
          <p className="text-xs text-text-muted mt-1">{t('workspacePresets.hint')}</p>
        </div>
        <button
          onClick={newPreset}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={12} />
          {t('workspacePresets.new')}
        </button>
      </div>

      {notice && (
        <div className="text-xs text-success bg-success/10 border border-success/30 rounded-md px-3 py-2">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-[240px_1fr] gap-3 min-h-[360px]">
        <div className="border border-border rounded-lg overflow-hidden flex flex-col">
          {presets.length === 0 && (
            <div className="px-4 py-6 text-xs text-text-muted text-center">
              {t('workspacePresets.empty')}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPreset(p)}
                className={`w-full text-left px-3 py-2 border-b border-border-muted transition-colors ${
                  selectedId === p.id ? 'bg-accent/10' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Layers size={12} className="text-text-muted shrink-0" />
                  <span className="text-xs font-medium text-text-primary truncate">
                    {p.name}
                  </span>
                </div>
                {p.description && (
                  <p className="text-[11px] text-text-muted mt-0.5 truncate">{p.description}</p>
                )}
                {p.model && (
                  <p className="text-[10px] text-text-muted mt-0.5 font-mono truncate">{p.model}</p>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              {t('workspacePresets.name')}
            </label>
            <input
              value={draft.name ?? ''}
              onChange={(ev) => {
                setDraft({ ...draft, name: ev.target.value });
                setDirty(true);
              }}
              className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              {t('workspacePresets.description')}
            </label>
            <input
              value={draft.description ?? ''}
              onChange={(ev) => {
                setDraft({ ...draft, description: ev.target.value });
                setDirty(true);
              }}
              className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">
              {t('workspacePresets.workspacePath')}
            </label>
            <input
              value={draft.workspacePath ?? ''}
              onChange={(ev) => {
                setDraft({ ...draft, workspacePath: ev.target.value });
                setDirty(true);
              }}
              placeholder="/path/to/project"
              className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('workspacePresets.model')}
              </label>
              <input
                value={draft.model ?? ''}
                onChange={(ev) => {
                  setDraft({ ...draft, model: ev.target.value });
                  setDirty(true);
                }}
                placeholder={ANTHROPIC_DEFAULT_MODEL}
                className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('workspacePresets.permissionMode')}
              </label>
              <select
                value={draft.permissionMode ?? 'default'}
                onChange={(ev) => {
                  setDraft({ ...draft, permissionMode: ev.target.value });
                  setDirty(true);
                }}
                className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="default">default</option>
                <option value="plan">plan</option>
                <option value="acceptEdits">acceptEdits</option>
                <option value="dontAsk">dontAsk</option>
                <option value="bypassPermissions">bypassPermissions</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">
                {t('workspacePresets.memoryScope')}
              </label>
              <select
                value={draft.memoryScope ?? 'project'}
                onChange={(ev) => {
                  setDraft({
                    ...draft,
                    memoryScope: ev.target.value as 'project' | 'global' | 'none',
                  });
                  setDirty(true);
                }}
                className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="project">project</option>
                <option value="global">global</option>
                <option value="none">none</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            {selectedId && (
              <>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-error/10 text-error hover:bg-error/20 transition-colors"
                >
                  <Trash2 size={12} />
                  {t('common.delete')}
                </button>
                <button
                  onClick={handleApply}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-surface border border-accent text-accent hover:bg-accent/10 transition-colors"
                >
                  <Play size={12} />
                  {t('workspacePresets.apply')}
                </button>
              </>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || !draft.name?.trim()}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              <Save size={12} />
              {t('workspacePresets.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
