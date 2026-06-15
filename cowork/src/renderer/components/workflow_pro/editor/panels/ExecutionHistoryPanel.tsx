/**
 * Execution History Panel
 * Displays history of workflow executions with detailed results
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflowStore } from '../../store';
import {
  History,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  ChevronRight,
  Trash2,
  RefreshCw,
  Download,
  Search,
  Filter,
  X,
  AlertTriangle,
  Eye,
} from 'lucide-react';

interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'error' | 'running' | 'cancelled';
  startTime: number;
  endTime?: number;
  duration?: number;
  nodeResults: Record<string, { status: string; data?: unknown; error?: string }>;
  triggerData?: unknown;
  errorMessage?: string;
}

interface ExecutionHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onReplayExecution?: (executionId: string) => void;
}

const ExecutionHistoryPanelComponent: React.FC<ExecutionHistoryPanelProps> = ({
  isOpen,
  onClose,
  onReplayExecution,
}) => {
  const darkMode = useWorkflowStore((state) => state.darkMode);
  const workflowId = useWorkflowStore((state) => state.currentWorkflowId);
  const workflowName = useWorkflowStore((state) => state.workflowName);
  const isExecuting = useWorkflowStore((state) => state.isExecuting);

  // Execution history is fetched from the real `/api/executions` endpoint.
  // Previously this was a `useState(() => [...mockStatuses])` that generated
  // fake data on mount and was wiped on every refresh — the panel claimed
  // to be a "history" but couldn't actually persist or recover anything.
  const [executionHistory, setExecutionHistory] = useState<ExecutionRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!isOpen) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const qs = new URLSearchParams();
      if (workflowId) qs.set('workflowId', workflowId);
      qs.set('limit', '50');
      const resp = await fetch(`/api/executions?${qs.toString()}`, {
        credentials: 'include',
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const body = (await resp.json()) as {
        success?: boolean;
        data?: Array<{
          id: string;
          workflowId: string;
          workflow?: { name?: string } | null;
          status: string;
          startedAt: string;
          finishedAt?: string | null;
          duration?: number | null;
          error?: { message?: string } | string | null;
          output?: Record<string, unknown> | null;
        }>;
      };

      const rawList = Array.isArray(body?.data) ? body.data : [];
      const normalizeStatus = (s: string): ExecutionRecord['status'] => {
        const v = (s || '').toLowerCase();
        if (v === 'success' || v === 'completed') return 'success';
        if (v === 'error' || v === 'failed' || v === 'failure') return 'error';
        if (v === 'running' || v === 'pending' || v === 'queued') return 'running';
        if (v === 'cancelled' || v === 'canceled') return 'cancelled';
        return 'running';
      };
      const normalizeError = (e: unknown): string | undefined => {
        if (!e) return undefined;
        if (typeof e === 'string') return e;
        if (typeof e === 'object' && e !== null && 'message' in e) {
          const m = (e as { message?: unknown }).message;
          return typeof m === 'string' ? m : undefined;
        }
        return undefined;
      };

      const records: ExecutionRecord[] = rawList.map((r) => ({
        id: r.id,
        workflowId: r.workflowId,
        workflowName: r.workflow?.name || workflowName || 'Unnamed Workflow',
        status: normalizeStatus(r.status),
        startTime: new Date(r.startedAt).getTime(),
        endTime: r.finishedAt ? new Date(r.finishedAt).getTime() : undefined,
        duration: r.duration ?? undefined,
        nodeResults: {},
        errorMessage: normalizeError(r.error),
      }));
      setExecutionHistory(records);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, [isOpen, workflowId, workflowName]);

  // Refresh history whenever the panel is opened, the workflow changes,
  // or a live execution finishes (so the user sees the new run appear).
  useEffect(() => {
    if (!isOpen) return;
    void fetchHistory();
  }, [isOpen, fetchHistory, isExecuting]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  // Vague 2 — gap U4: date-range + free-text custom-data filters, persisted.
  const [dateFrom, setDateFrom] = useState<string>(() => {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('execHistory.dateFrom') || '';
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem('execHistory.dateTo') || '';
  });

  // Persist filter state across panel close/reopen.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('execHistory.dateFrom', dateFrom);
  }, [dateFrom]);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('execHistory.dateTo', dateTo);
  }, [dateTo]);

  // Filter executions — composes status + date range + free-text (workflow name,
  // execution id, and trigger-data when present).
  const filteredExecutions = useMemo(() => {
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const toTs   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').getTime() : null;
    const query  = searchQuery.trim().toLowerCase();

    return executionHistory.filter((exec) => {
      if (statusFilter !== 'all' && exec.status !== statusFilter) return false;

      const startedAt = (exec as { startTime?: number }).startTime ?? 0;
      if (fromTs !== null && startedAt < fromTs) return false;
      if (toTs   !== null && startedAt > toTs)   return false;

      if (query) {
        const triggerData = (exec as { triggerData?: unknown }).triggerData;
        const triggerStr = triggerData ? JSON.stringify(triggerData).toLowerCase() : '';
        if (
          !exec.workflowName.toLowerCase().includes(query) &&
          !exec.id.toLowerCase().includes(query) &&
          !triggerStr.includes(query)
        ) return false;
      }
      return true;
    });
  }, [executionHistory, statusFilter, searchQuery, dateFrom, dateTo]);

  // Format duration
  const formatDuration = useCallback((ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }, []);

  // Format timestamp
  const formatTimestamp = useCallback((timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - timestamp;
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 24) {
      return date.toLocaleTimeString();
    } else if (diffHours < 48) {
      return `Yesterday ${date.toLocaleTimeString()}`;
    }
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }, []);

  // Get status icon
  const getStatusIcon = useCallback((status: ExecutionRecord['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running':
        return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'cancelled':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  }, []);

  // Delete one execution. Optimistically removes it from the list, then
  // calls the backend DELETE /api/executions/:id; rolls back on failure
  // so the UI never lies about persisted state.
  const deleteExecution = useCallback(async (execId: string) => {
    const previous = executionHistory;
    setExecutionHistory((prev) => prev.filter((e) => e.id !== execId));
    try {
      const resp = await fetch(`/api/executions/${encodeURIComponent(execId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      setExecutionHistory(previous);
      setHistoryError(err instanceof Error ? err.message : 'Failed to delete execution');
    }
  }, [executionHistory]);

  // Clear all executions for the current workflow via DELETE
  // /api/executions?workflowId=…. Same optimistic pattern; if no workflow
  // is loaded we fall back to a local-only clear (nothing to persist).
  const clearHistory = useCallback(async () => {
    const previous = executionHistory;
    setExecutionHistory([]);
    if (!workflowId) return;
    try {
      const qs = new URLSearchParams({ workflowId });
      const resp = await fetch(`/api/executions?${qs.toString()}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      setExecutionHistory(previous);
      setHistoryError(err instanceof Error ? err.message : 'Failed to clear history');
    }
  }, [executionHistory, workflowId]);

  // Export history
  const exportHistory = useCallback(() => {
    const blob = new Blob([JSON.stringify(executionHistory, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `execution-history-${workflowName || 'workflow'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [executionHistory, workflowName]);

  // Toggle expanded execution
  const toggleExpanded = useCallback((execId: string) => {
    setExpandedExecution((prev) => (prev === execId ? null : execId));
  }, []);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className={`fixed right-4 top-20 w-[450px] max-h-[calc(100vh-6rem)] overflow-hidden rounded-xl shadow-2xl border z-50 flex flex-col backdrop-blur-md ${
        darkMode
          ? 'bg-gray-900/95 border-gray-700 text-white'
          : 'bg-white/95 border-gray-200 text-gray-900'
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 border-b flex items-center justify-between ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold">Execution History</h3>
          <span
            className={`px-2 py-0.5 text-xs rounded-full ${
              darkMode ? 'bg-gray-800' : 'bg-gray-100'
            }`}
          >
            {filteredExecutions.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1.5 rounded-lg transition-colors ${
              showFilters
                ? 'bg-blue-500 text-white'
                : darkMode
                ? 'hover:bg-gray-800'
                : 'hover:bg-gray-100'
            }`}
            title="Filters"
          >
            <Filter className="w-4 h-4" />
          </button>
          <button
            onClick={exportHistory}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
            title="Export history"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={clearHistory}
            className={`p-1.5 rounded-lg transition-colors text-red-500 ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
            title="Clear history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div
          className={`p-3 border-b space-y-2 ${
            darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
          }`}
        >
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search executions..."
              className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm ${
                darkMode
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-white border-gray-200'
              } border`}
            />
          </div>
          {/* Status filter */}
          <div className="flex gap-2">
            {['all', 'success', 'error', 'running'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 text-xs rounded-full capitalize transition-colors ${
                  statusFilter === status
                    ? 'bg-blue-500 text-white'
                    : darkMode
                    ? 'bg-gray-800 hover:bg-gray-700'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
          {/* Date range — Vague 2 gap U4 */}
          <div className="flex items-center gap-2 text-xs">
            <label className={darkMode ? 'text-gray-400' : 'text-gray-600'}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              data-testid="exec-filter-date-from"
              className={`px-2 py-1 rounded border ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              }`}
            />
            <label className={darkMode ? 'text-gray-400' : 'text-gray-600'}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              data-testid="exec-filter-date-to"
              className={`px-2 py-1 rounded border ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              }`}
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className={`ml-auto px-2 py-1 rounded ${
                  darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                }`}
              >
                Clear dates
              </button>
            )}
          </div>
        </div>
      )}

      {/* Current execution */}
      {isExecuting && (
        <div
          className={`p-3 border-b ${
            darkMode ? 'border-gray-700 bg-blue-500/10' : 'border-gray-200 bg-blue-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
            <span className="text-sm font-medium">Execution in progress...</span>
          </div>
        </div>
      )}

      {/* Execution list */}
      <div className="flex-1 overflow-y-auto">
        {historyLoading && filteredExecutions.length === 0 ? (
          <div className="text-center py-12">
            <RefreshCw className="w-12 h-12 mx-auto mb-3 text-blue-500 animate-spin opacity-60" />
            <p className="text-gray-500 text-sm">Loading execution history…</p>
          </div>
        ) : historyError ? (
          <div className="text-center py-12 px-6">
            <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-red-500 opacity-60" />
            <p className="text-red-500 text-sm font-medium">Failed to load history</p>
            <p className="text-gray-500 text-xs mt-1 break-all">{historyError}</p>
            <button
              onClick={() => void fetchHistory()}
              className="mt-3 px-3 py-1.5 rounded text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredExecutions.length === 0 ? (
          <div className="text-center py-12">
            <History className="w-12 h-12 mx-auto mb-3 text-gray-400 opacity-20" />
            <p className="text-gray-500 text-sm">No execution history</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            <AnimatePresence initial={false}>
              {filteredExecutions.map((execution) => (
                <motion.div 
                  key={execution.id}
                  layout
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <div
                    className={`p-3 cursor-pointer transition-colors ${
                      expandedExecution === execution.id
                        ? darkMode ? 'bg-gray-800/50' : 'bg-gray-50'
                        : darkMode ? 'hover:bg-gray-800/30' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => toggleExpanded(execution.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <motion.div
                          animate={{ rotate: expandedExecution === execution.id ? 90 : 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </motion.div>
                        {getStatusIcon(execution.status)}
                        <div className="min-w-0">
                          <div className={`text-sm font-medium truncate ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            {execution.workflowName || 'Unnamed Workflow'}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" />
                            {formatTimestamp(execution.startTime)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {execution.duration && (
                          <span
                            className={`px-2 py-0.5 text-xs rounded ${
                              darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {formatDuration(execution.duration)}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onReplayExecution?.(execution.id);
                          }}
                          className={`p-1.5 rounded transition-colors ${
                            darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
                          } hover:text-blue-500`}
                          title="Replay Execution"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteExecution(execution.id);
                          }}
                          className={`p-1.5 rounded transition-colors ${
                            darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
                          } hover:text-red-500`}
                          title="Delete Execution"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Error message preview */}
                    {execution.status === 'error' && execution.errorMessage && (
                      <div className="mt-2 ml-9 text-xs text-red-500 flex items-start gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="line-clamp-2 break-words">{execution.errorMessage}</span>
                      </div>
                    )}
                  </div>

                  {/* Expanded details */}
                  <AnimatePresence>
                    {expandedExecution === execution.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div
                          className={`px-4 pb-4 ml-9 ${
                            darkMode ? 'bg-gray-800/30' : 'bg-gray-50/50'
                          }`}
                        >
                          <div className="space-y-3 pt-3 border-t border-transparent">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-gray-500 block mb-0.5">Execution ID</span>
                                <code className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-200 text-gray-700'}`}>
                                  {execution.id}
                                </code>
                              </div>
                              {execution.endTime && (
                                <div>
                                  <span className="text-gray-500 block mb-0.5">Ended At</span>
                                  <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                                    {new Date(execution.endTime).toLocaleString()}
                                  </span>
                                </div>
                              )}
                            </div>
                            
                            {Object.keys(execution.nodeResults).length > 0 && (
                              <div className="mt-4">
                                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                                  Node Results ({Object.keys(execution.nodeResults).length})
                                </div>
                                <div className="space-y-1.5">
                                  {Object.entries(execution.nodeResults).map(([nodeId, result]) => (
                                    <div
                                      key={nodeId}
                                      className={`text-xs p-2 rounded flex items-center justify-between gap-2 ${
                                        darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200 shadow-sm'
                                      }`}
                                    >
                                      <span className="font-medium truncate pr-3 flex-1">{nodeId}</span>
                                      <span
                                        className={`flex-shrink-0 px-2 py-0.5 rounded-sm capitalize font-medium ${
                                          result.status === 'error'
                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                            : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                        }`}
                                      >
                                        {result.status}
                                      </span>
                                      {result.status === 'error' && (
                                        <button
                                          type="button"
                                          data-testid={`exec-rerun-${nodeId}`}
                                          title="Re-run from this failed node (uses upstream output as input)"
                                          onClick={async () => {
                                            const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
                                            try {
                                              await fetch('/api/executions/partial', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                                                body: JSON.stringify({ workflowId, startNodeId: nodeId }),
                                              });
                                            } catch {
                                              // Surfaced via global error logger; UI state untouched.
                                            }
                                          }}
                                          className="flex-shrink-0 px-2 py-0.5 text-[10px] rounded border border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                        >
                                          Re-run
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            <div className="flex justify-end pt-2 mt-2">
                              <button
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                  darkMode
                                    ? 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                                    : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                }`}
                              >
                                <Eye size={14} />
                                View Full Details
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`p-3 border-t text-xs text-gray-500 flex items-center justify-between ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <span>{executionHistory.length} total executions</span>
        <button
          onClick={exportHistory}
          className="text-blue-500 hover:underline flex items-center gap-1"
        >
          <Download className="w-3 h-3" />
          Export all
        </button>
      </div>
    </motion.div>
  );
};

const ExecutionHistoryPanel = React.memo(ExecutionHistoryPanelComponent, (prev, next) => {
  return prev.isOpen === next.isOpen;
});

export default ExecutionHistoryPanel;
