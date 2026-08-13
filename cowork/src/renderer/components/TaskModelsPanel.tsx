/** Editable per-task model routing backed by the root `[task_models]` config. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BrainCircuit, RefreshCw, Save, X } from 'lucide-react';
import type {
  TaskModelSaveMappings,
  TaskModelSettingsView,
  TaskModelType,
} from '../../shared/task-models-types';
import { useAppStore } from '../store';

export function TaskModelsPanel() {
  const show = useAppStore((state) => state.showTaskModelsPanel);
  const setShow = useAppStore((state) => state.setShowTaskModelsPanel);
  const [settings, setSettings] = useState<TaskModelSettingsView | null>(null);
  const [draft, setDraft] = useState<Partial<Record<TaskModelType, string>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.taskModels.get();
      if (!result.ok || !result.settings) {
        setError(result.error ?? 'Failed to load task model settings');
        return;
      }
      setSettings(result.settings);
      setDraft({ ...result.settings.mappings });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (show) void load();
  }, [show, load]);

  const activeModelIds = useMemo(
    () => new Set(settings?.models.map((model) => model.id) ?? []),
    [settings],
  );
  const invalidMappings = useMemo(
    () => Object.values(draft).filter(Boolean).filter((model) => !activeModelIds.has(model!)),
    [activeModelIds, draft],
  );

  const save = async () => {
    if (!settings || invalidMappings.length > 0) return;
    const payload: TaskModelSaveMappings = {};
    for (const task of settings.taskTypes) {
      payload[task.type] = draft[task.type]?.trim() || null;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await window.electronAPI.taskModels.save(payload);
      if (!result.ok || !result.settings) {
        setError(result.error ?? 'Failed to save task model settings');
        return;
      }
      setSettings(result.settings);
      setDraft({ ...result.settings.mappings });
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/30 backdrop-blur-sm"
      data-testid="task-models-panel"
    >
      <div className="flex h-full w-[580px] flex-col border-l border-border bg-background-secondary shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-accent" />
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Models by task type</h2>
              <p className="text-[10px] text-text-muted">Explicit routing with default-model fallback</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || saving}
              className="rounded p-1 hover:bg-surface disabled:opacity-40"
              aria-label="Refresh task models"
            >
              <RefreshCw className={`h-4 w-4 text-text-muted ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setShow(false)}
              className="rounded p-1 hover:bg-surface"
              aria-label="Close task models"
            >
              <X className="h-4 w-4 text-text-muted" />
            </button>
          </div>
        </header>

        {settings && (
          <div className="border-b border-border px-4 py-2 text-[10px] text-text-muted">
            <div className="truncate">{settings.configPath}</div>
            <div>Default fallback: <span className="font-mono text-text-primary">{settings.defaultModel}</span></div>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded border border-error/30 bg-error/10 p-2 text-xs text-error">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {!settings && !loading && !error && (
            <p className="text-xs text-text-muted">No model configuration is available.</p>
          )}

          {settings?.taskTypes.map((task) => {
            const explicit = draft[task.type] ?? '';
            const legacy = settings.legacyMappings[task.type];
            const fallback = legacy ?? settings.defaultModel;
            const unavailable = explicit && !activeModelIds.has(explicit) ? explicit : null;
            return (
              <section
                key={task.type}
                className="rounded border border-border bg-surface/40 p-3"
                data-testid={`task-model-row-${task.type}`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <label
                      htmlFor={`task-model-${task.type}`}
                      className="text-xs font-medium text-text-primary"
                    >
                      {task.label}
                    </label>
                    <p className="mt-0.5 text-[10px] text-text-muted">{task.description}</p>
                  </div>
                  <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[9px] text-text-muted">
                    {task.type}
                  </span>
                </div>

                <select
                  id={`task-model-${task.type}`}
                  value={explicit}
                  onChange={(event) => {
                    setSaved(false);
                    setDraft((current) => ({ ...current, [task.type]: event.target.value }));
                  }}
                  data-testid={`task-model-select-${task.type}`}
                  className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary"
                >
                  <option value="">Use fallback · {fallback}</option>
                  {unavailable && <option value={unavailable}>Unavailable · {unavailable}</option>}
                  {settings.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label} · {model.provider}
                    </option>
                  ))}
                </select>

                <div className="mt-1 text-[9px] text-text-muted">
                  {explicit
                    ? `Explicit [task_models]: ${explicit}`
                    : legacy
                      ? `Inherited [model_pairs]: ${legacy}`
                      : `Inherited default: ${settings.defaultModel}`}
                </div>
              </section>
            );
          })}

          {settings && settings.models.length === 0 && (
            <div className="rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              No active models were found. Enable a provider and configure at least one model first.
            </div>
          )}
          {invalidMappings.length > 0 && (
            <div className="rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              Replace or clear unavailable mappings before saving: {invalidMappings.join(', ')}.
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[10px] text-text-muted">
            {saved ? 'Saved. New turns use the updated map.' : 'Legacy model_pairs remains untouched.'}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!settings || saving || loading || invalidMappings.length > 0}
            data-testid="task-models-save"
            className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save mappings'}
          </button>
        </footer>
      </div>
    </div>
  );
}
