/**
 * SettingsWorkflows — Claude Cowork parity Phase 2 step 15
 *
 * Workflows tab in Settings: list saved workflows, create/edit/delete,
 * launch the WorkflowEditor for visual DAG editing, and run a workflow
 * directly from the list.
 *
 * @module renderer/components/settings/SettingsWorkflows
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Workflow as WorkflowIcon,
  Edit3,
  Trash2,
  Play,
  Loader2,
  Route,
} from 'lucide-react';
import { WorkflowEditor } from '../WorkflowEditor';
import { WorkflowSupervisionPanel } from './WorkflowSupervisionPanel';

interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  nodes: Array<{
    id: string;
    type: 'tool' | 'condition' | 'parallel' | 'approval' | 'start' | 'end';
    name: string;
    position: { x: number; y: number };
    config?: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
  createdAt: number;
  updatedAt: number;
}

export const SettingsWorkflows: React.FC = () => {
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<WorkflowSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [supervisingId, setSupervisingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.workflow?.list) {
        setWorkflows([]);
        return;
      }
      const result = await api.workflow.list();
      setWorkflows(result);
    } catch (err) {
      console.error('[SettingsWorkflows] load failed:', err);
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(
    async (definition: {
      id?: string;
      name: string;
      description?: string;
      nodes: WorkflowSummary['nodes'];
      edges: WorkflowSummary['edges'];
    }) => {
      const api = window.electronAPI;
      if (!api?.workflow) return;
      try {
        if (definition.id) {
          await api.workflow.update(definition.id, {
            name: definition.name,
            description: definition.description,
            nodes: definition.nodes,
            edges: definition.edges,
          });
        } else {
          await api.workflow.create({
            name: definition.name,
            description: definition.description,
            nodes: definition.nodes,
            edges: definition.edges,
          });
        }
        setEditing(null);
        setCreating(false);
        await load();
      } catch (err) {
        console.error('[SettingsWorkflows] save failed:', err);
      }
    },
    [load]
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (!confirm(t('workflow.deleteConfirm', { name }))) return;
      const api = window.electronAPI;
      if (!api?.workflow?.delete) return;
      await api.workflow.delete(id);
      await load();
    },
    [load, t]
  );

  const handleRun = useCallback(async (id: string) => {
    const api = window.electronAPI;
    if (!api?.workflow?.run) return;
    setRunningId(id);
    setRunResult(null);
    try {
      const result = await api.workflow.run(id, {});
      setRunResult(
        result.success
          ? `${result.status} · ${result.completedSteps}/${result.totalSteps} steps`
          : `Failed: ${result.error ?? 'unknown'}`
      );
    } finally {
      setRunningId(null);
    }
  }, []);

  // Editor mode
  if (editing || creating) {
    return (
      <div className="flex-1 min-h-0">
        <WorkflowEditor
          initial={editing ?? undefined}
          onSave={async (def) => {
            await handleSave(def as never);
          }}
          onRun={async (id) => {
            await handleRun(id);
          }}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="settings-workflows">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-muted shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <WorkflowIcon size={18} className="text-accent" />
            {t('workflow.settingsTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-1">{t('workflow.settingsHint')}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          data-testid="workflow-create-button"
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded transition-colors"
        >
          <Plus size={12} />
          {t('workflow.create')}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            {t('common.loading')}
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12">
            <WorkflowIcon size={32} className="mx-auto text-text-muted opacity-30 mb-2" />
            <div className="text-xs text-text-muted">{t('workflow.empty')}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                data-testid={`workflow-row-${wf.id}`}
                className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg hover:border-border-strong transition-colors"
              >
                <WorkflowIcon size={16} className="text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {wf.name}
                  </div>
                  {wf.description && (
                    <div className="text-xs text-text-muted truncate">{wf.description}</div>
                  )}
                  <div className="text-[10px] text-text-muted opacity-70 mt-0.5">
                    {wf.nodes.length} nodes · {wf.edges.length} edges
                  </div>
                </div>
                <button
                  onClick={() => setSupervisingId(wf.id)}
                  data-testid={`workflow-supervise-${wf.id}`}
                  className="p-2 text-text-muted hover:text-accent transition-colors"
                  title="Dry-run, historique et diagnostic"
                >
                  <Route size={12} />
                </button>
                <button
                  onClick={() => handleRun(wf.id)}
                  disabled={runningId === wf.id}
                  data-testid={`workflow-run-${wf.id}`}
                  className="p-2 text-text-muted hover:text-success transition-colors disabled:opacity-50"
                  title={t('workflow.run')}
                >
                  {runningId === wf.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Play size={12} />
                  )}
                </button>
                <button
                  onClick={() => setEditing(wf)}
                  className="p-2 text-text-muted hover:text-text-primary transition-colors"
                  title={t('workflow.edit')}
                >
                  <Edit3 size={12} />
                </button>
                <button
                  onClick={() => handleDelete(wf.id, wf.name)}
                  className="p-2 text-text-muted hover:text-error transition-colors"
                  title={t('common.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {runResult && (
          <div
            className="mt-4 px-3 py-2 text-xs bg-surface border border-border rounded text-text-secondary"
            data-testid="workflow-run-result"
          >
            {runResult}
          </div>
        )}
        {supervisingId ? (
          <WorkflowSupervisionPanel
            workflowId={supervisingId}
            onClose={() => setSupervisingId(null)}
          />
        ) : null}
      </div>
    </div>
  );
};
