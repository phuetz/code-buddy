/**
 * Workflow Settings Panel
 * Configure workflow-level settings including execution timeout
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useWorkflowStore } from '../../store';
import { Settings, Clock, Gauge, Layers, AlertTriangle, Trash2, FileText } from 'lucide-react';

interface WorkflowOption {
  id: string;
  name: string;
}

const TIMEOUT_OPTIONS = [
  { label: '1 minute', value: 60000 },
  { label: '5 minutes', value: 300000 },
  { label: '15 minutes', value: 900000 },
  { label: '30 minutes', value: 1800000 },
  { label: '1 hour', value: 3600000 },
  { label: 'Unlimited', value: 0 },
] as const;

interface WorkflowSettingsPanelProps {
  darkMode: boolean;
}

function formatTimeout(ms: number): string {
  if (ms === 0) return 'Unlimited';
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000} min`;
  return `${ms / 3600000} hr`;
}

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
] as const;

const CONCURRENCY_OPTIONS = [
  { label: 'Unlimited', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: '10', value: 10 },
] as const;

const RETENTION_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '365 days', value: 365 },
  { label: 'Never', value: 0 },
] as const;

const DESCRIPTION_MAX_LENGTH = 500;

const WorkflowSettingsPanelComponent: React.FC<WorkflowSettingsPanelProps> = ({ darkMode }) => {
  const workflowDescription = useWorkflowStore((state) => state.workflowDescription);
  const setWorkflowDescription = useWorkflowStore((state) => state.setWorkflowDescription);
  const executionTimeout = useWorkflowStore((state) => state.executionTimeout);
  const setExecutionTimeout = useWorkflowStore((state) => state.setExecutionTimeout);
  const executionPriority = useWorkflowStore((state) => state.executionPriority);
  const setExecutionPriority = useWorkflowStore((state) => state.setExecutionPriority);
  const maxConcurrentExecutions = useWorkflowStore((state) => state.maxConcurrentExecutions);
  const setMaxConcurrentExecutions = useWorkflowStore((state) => state.setMaxConcurrentExecutions);
  const errorWorkflowId = useWorkflowStore((state) => state.errorWorkflowId);
  const setErrorWorkflowId = useWorkflowStore((state) => state.setErrorWorkflowId);
  const retentionPolicy = useWorkflowStore((state) => state.retentionPolicy);
  const setRetentionPolicy = useWorkflowStore((state) => state.setRetentionPolicy);

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (value.length <= DESCRIPTION_MAX_LENGTH) {
        setWorkflowDescription(value);
      }
    },
    [setWorkflowDescription]
  );

  const handleTimeoutChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setExecutionTimeout(Number(e.target.value));
    },
    [setExecutionTimeout]
  );

  const bg = darkMode ? 'bg-gray-800' : 'bg-white';
  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const textMuted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const border = darkMode ? 'border-gray-700' : 'border-gray-200';
  const selectBg = darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-50 text-gray-800';

  return (
    <div className={`p-4 ${bg} ${text} rounded-lg border ${border}`}>
      <div className="flex items-center gap-2 mb-4">
        <Settings size={18} />
        <h3 className="text-sm font-semibold">Workflow Settings</h3>
      </div>

      {/* Workflow Description */}
      <div className="mb-4">
        <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
          <FileText size={14} />
          Description
        </label>
        <textarea
          value={workflowDescription}
          onChange={handleDescriptionChange}
          placeholder="Add a description for this workflow..."
          rows={3}
          className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500 resize-vertical`}
        />
        <p className={`mt-1 text-xs ${textMuted} text-right`}>
          {workflowDescription.length}/{DESCRIPTION_MAX_LENGTH}
        </p>
      </div>

      {/* Execution Timeout */}
      <div className="mb-4">
        <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
          <Clock size={14} />
          Execution Timeout
        </label>
        <select
          value={executionTimeout}
          onChange={handleTimeoutChange}
          className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
        >
          {TIMEOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className={`mt-1 text-xs ${textMuted}`}>
          Current: {formatTimeout(executionTimeout)}
          {executionTimeout === 0 && ' (workflow will run until completion)'}
        </p>
      </div>

      {/* Execution Priority */}
      <div className="mb-4">
        <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
          <Gauge size={14} />
          Execution Priority
        </label>
        <select
          value={executionPriority}
          onChange={(e) => setExecutionPriority(e.target.value as 'low' | 'normal' | 'high' | 'critical')}
          className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className={`mt-1 text-xs ${textMuted}`}>
          Higher priority workflows execute before lower priority ones in the queue.
        </p>
      </div>

      {/* Max Concurrent Executions */}
      <div className="mb-4">
        <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
          <Layers size={14} />
          Max Concurrent Executions
        </label>
        <select
          value={maxConcurrentExecutions}
          onChange={(e) => setMaxConcurrentExecutions(Number(e.target.value))}
          className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
        >
          {CONCURRENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className={`mt-1 text-xs ${textMuted}`}>
          Limits how many instances of this workflow can run simultaneously.
        </p>
      </div>

      {/* Error Workflow — Vague 3 gap V3-3 */}
      <ErrorWorkflowSelector
        value={errorWorkflowId}
        onChange={setErrorWorkflowId}
        border={border}
        selectBg={selectBg}
        textMuted={textMuted}
      />
      <p className={`mt-1 mb-4 text-xs ${textMuted}`}>
        When this workflow fails, the selected workflow runs with the error details as input.
      </p>

      {/* Execution Retention */}
      <div className={`mb-4 pt-4 border-t ${border}`}>
        <label className="flex items-center justify-between text-xs font-medium mb-2">
          <span className="flex items-center gap-1.5">
            <Trash2 size={14} />
            Auto-delete old executions
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={retentionPolicy.enabled}
            onClick={() => setRetentionPolicy({ enabled: !retentionPolicy.enabled })}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
              retentionPolicy.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                retentionPolicy.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </label>

        {retentionPolicy.enabled && (
          <div className="space-y-3 ml-0.5">
            <div>
              <label className="block text-xs font-medium mb-1">Delete after</label>
              <select
                value={retentionPolicy.deleteAfterDays}
                onChange={(e) => setRetentionPolicy({ deleteAfterDays: Number(e.target.value) })}
                className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
              >
                {RETENTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Keep maximum</label>
              <input
                type="number"
                min={1}
                value={retentionPolicy.maxExecutions}
                onChange={(e) => setRetentionPolicy({ maxExecutions: Math.max(1, Number(e.target.value)) })}
                className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
              />
              <p className={`mt-1 text-xs ${textMuted}`}>
                Maximum number of executions to keep.
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={retentionPolicy.preserveFailed}
                onChange={(e) => setRetentionPolicy({ preserveFailed: e.target.checked })}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-500 focus:ring-blue-500"
              />
              Preserve failed executions
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Dropdown that lists the user's workflows so the error-handler picker isn't
 * a copy-paste-an-id field. Falls back to free-text input on fetch failure
 * so power users / scripted setups still work. (Vague 3 — gap V3-3)
 */
const ErrorWorkflowSelector: React.FC<{
  value: string;
  onChange: (id: string) => void;
  border: string;
  selectBg: string;
  textMuted: string;
}> = ({ value, onChange, border, selectBg, textMuted }) => {
  const currentWorkflowId = useWorkflowStore((state) => (state as { currentWorkflowId?: string }).currentWorkflowId);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
        const res = await fetch('/api/workflows?limit=200', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { data?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
        const items = Array.isArray(body) ? body : (body.data || []);
        if (!cancelled) {
          setWorkflows(items.filter(w => w.id && w.id !== currentWorkflowId).map(w => ({ id: w.id, name: w.name })));
        }
      } catch {
        if (!cancelled) setFetchFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [currentWorkflowId]);

  // Auto-dismiss inline feedback after 3s
  useEffect(() => {
    if (!testFeedback) return;
    const t = setTimeout(() => setTestFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [testFeedback]);

  const handleTest = useCallback(async () => {
    if (!value || testing) return;
    setTesting(true);
    setTestFeedback(null);
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const res = await fetch(`/api/workflows/${encodeURIComponent(value)}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          input: {
            __testTrigger: true,
            error: {
              message: 'Test trigger from settings',
              code: 'TEST',
              timestamp: new Date().toISOString(),
            },
          },
        }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errBody = await res.json() as { error?: string; message?: string };
          detail = errBody.error || errBody.message || detail;
        } catch { /* ignore parse error */ }
        throw new Error(detail);
      }
      const body = await res.json() as { executionId?: string; data?: { executionId?: string } };
      const executionId = body.executionId || body.data?.executionId || 'unknown';
      setTestFeedback({ kind: 'success', message: `Test execution started (${executionId})` });
    } catch (err) {
      setTestFeedback({ kind: 'error', message: `Failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setTesting(false);
    }
  }, [value, testing]);

  return (
    <div className="mb-1">
      <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
        <AlertTriangle size={14} />
        Error Workflow
      </label>
      <div className="flex items-stretch gap-2">
        <div className="flex-1">
          {fetchFailed ? (
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Workflow ID (auto-list unavailable)"
              data-testid="error-workflow-input-fallback"
              className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
            />
          ) : (
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={loading}
              data-testid="error-workflow-select"
              className={`w-full px-3 py-1.5 text-sm rounded border ${border} ${selectBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
            >
              <option value="">{loading ? 'Loading workflows…' : 'None — disable error handling'}</option>
              {workflows.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
              {value && !workflows.some(w => w.id === value) && (
                <option value={value}>{value} (not in current list)</option>
              )}
            </select>
          )}
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={!value || testing}
          data-testid="error-workflow-test-button"
          title={!value ? 'Select an error workflow first' : 'Trigger the error workflow with sample error context'}
          className={`px-3 py-1.5 text-xs font-medium rounded border ${border} ${selectBg} hover:bg-blue-500 hover:text-white hover:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap`}
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
      {testFeedback && (
        <p
          data-testid="error-workflow-test-feedback"
          role="status"
          className={`mt-1 text-xs ${testFeedback.kind === 'success' ? 'text-green-500' : 'text-red-500'}`}
        >
          {testFeedback.message}
        </p>
      )}
      {!fetchFailed && !loading && workflows.length === 0 && (
        <p className={`mt-1 text-xs ${textMuted}`}>No other workflows available — create one to use as error handler.</p>
      )}
    </div>
  );
};

export default React.memo(WorkflowSettingsPanelComponent);
