/**
 * SplitPaneExecutionView
 *
 * Split-pane view showing node configuration on top and execution results on bottom.
 * Matches n8n's execution debugging UX with resizable panes.
 */

import React, { useState, useCallback, useRef } from 'react';
import { useWorkflowStore } from '../store';
import { X, AlertTriangle, CheckCircle, Clock, Loader2 } from 'lucide-react';

interface SplitPaneExecutionViewProps {
  onClose: () => void;
}

type OutputTab = 'input' | 'output' | 'error';

const SplitPaneExecutionView: React.FC<SplitPaneExecutionViewProps> = ({ onClose }) => {
  const selectedNode = useWorkflowStore((s) => s.selectedNode);
  const executionResults = useWorkflowStore((s) => s.executionResults);
  const executionErrors = useWorkflowStore((s) => s.executionErrors);
  const nodeExecutionStatus = useWorkflowStore((s) => s.nodeExecutionStatus);
  const nodeExecutionData = useWorkflowStore((s) => s.nodeExecutionData);
  const darkMode = useWorkflowStore((s) => s.darkMode);

  const [activeTab, setActiveTab] = useState<OutputTab>('output');
  const [splitRatio, setSplitRatio] = useState(50); // percentage for top pane
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const nodeId = selectedNode?.id || '';
  const status = nodeExecutionStatus[nodeId] || 'idle';
  const result = executionResults[nodeId];
  const error = executionErrors[nodeId];
  const inputData = nodeExecutionData[nodeId];

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const onMouseMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setSplitRatio(Math.max(20, Math.min(80, pct)));
    };

    const onMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const statusIcon = () => {
    switch (status) {
      case 'running': return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      case 'success': return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
      case 'error': return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
      default: return <Clock className="w-3.5 h-3.5 text-gray-400" />;
    }
  };

  const statusColor = () => {
    switch (status) {
      case 'running': return 'text-blue-600';
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-500';
    }
  };

  if (!selectedNode) return null;

  const bg = darkMode ? 'bg-gray-900' : 'bg-white';
  const border = darkMode ? 'border-gray-700' : 'border-gray-200';
  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const textMuted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const bgMuted = darkMode ? 'bg-gray-800' : 'bg-gray-50';

  return (
    <div ref={containerRef} className={`flex flex-col h-full ${bg} ${text}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${border} flex-shrink-0`}>
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon()}
          <span className="text-sm font-semibold truncate">
            {selectedNode.data?.label || selectedNode.data?.type || 'Node'}
          </span>
          <span className={`text-xs ${statusColor()} capitalize`}>{status}</span>
        </div>
        <button onClick={onClose} className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700`}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Top pane: Node Configuration */}
      <div style={{ height: `${splitRatio}%` }} className="overflow-auto flex-shrink-0">
        <div className={`px-4 py-2 border-b ${border} ${bgMuted}`}>
          <span className="text-xs font-medium uppercase tracking-wider">Parameters</span>
        </div>
        <div className="p-4 space-y-3">
          {selectedNode.data?.config && Object.keys(selectedNode.data.config).length > 0 ? (
            Object.entries(selectedNode.data.config).map(([key, value]) => (
              <div key={key}>
                <label className={`text-xs font-medium ${textMuted} block mb-1`}>{key}</label>
                <div className={`text-sm px-3 py-1.5 rounded ${bgMuted} font-mono break-all`}>
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value || '')}
                </div>
              </div>
            ))
          ) : (
            <p className={`text-sm ${textMuted} italic`}>No parameters configured</p>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className={`h-1.5 flex-shrink-0 cursor-row-resize flex items-center justify-center ${border} border-y ${isResizing ? 'bg-blue-500/20' : `hover:bg-blue-500/10 ${bgMuted}`} transition-colors`}
      >
        <div className="w-8 h-0.5 rounded-full bg-gray-400" />
      </div>

      {/* Bottom pane: Execution Results */}
      <div style={{ height: `${100 - splitRatio}%` }} className="overflow-hidden flex flex-col">
        {/* Tabs */}
        <div className={`flex border-b ${border} flex-shrink-0`}>
          {(['input', 'output', 'error'] as OutputTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : `${textMuted} hover:text-gray-700 dark:hover:text-gray-300`
              }`}
            >
              {tab}
              {tab === 'error' && error && (
                <span className="ml-1.5 w-1.5 h-1.5 bg-red-500 rounded-full inline-block" />
              )}
              {tab === 'output' && result && (
                <span className="ml-1.5 w-1.5 h-1.5 bg-green-500 rounded-full inline-block" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'input' && (
            <DataDisplay data={inputData} emptyMessage="No input data available" darkMode={darkMode} />
          )}
          {activeTab === 'output' && (
            <DataDisplay data={result} emptyMessage={status === 'idle' ? 'Run the workflow to see output' : 'No output data'} darkMode={darkMode} />
          )}
          {activeTab === 'error' && (
            error ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-500">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-sm font-medium">Execution Error</span>
                </div>
                <pre className={`text-xs p-3 rounded ${darkMode ? 'bg-red-900/20 text-red-300' : 'bg-red-50 text-red-700'} overflow-auto whitespace-pre-wrap`}>
                  {typeof error === 'object' ? JSON.stringify(error, null, 2) : String(error)}
                </pre>
              </div>
            ) : (
              <p className={`text-sm ${textMuted} italic`}>No errors</p>
            )
          )}
        </div>
      </div>
    </div>
  );
};

/** Simple data display component for JSON/primitive data */
const DataDisplay: React.FC<{ data: unknown; emptyMessage: string; darkMode: boolean }> = ({ data, emptyMessage, darkMode }) => {
  if (data === undefined || data === null) {
    return <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} italic`}>{emptyMessage}</p>;
  }

  if (typeof data === 'object') {
    return (
      <pre className={`text-xs p-3 rounded ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-50 text-gray-700'} overflow-auto whitespace-pre-wrap font-mono`}>
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  return (
    <div className={`text-sm p-3 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-50'} font-mono`}>
      {String(data)}
    </div>
  );
};

export default SplitPaneExecutionView;
