// @ts-nocheck
/**
 * Workflow Activation Toggle
 * Global on/off switch for workflow activation (like n8n)
 */

import React, { useState, useCallback } from 'react';
import { Power, Zap, AlertTriangle, CheckCircle, Clock, Settings } from 'lucide-react';

interface WorkflowActivationToggleProps {
  workflowId: string;
  isActive: boolean;
  onToggle: (active: boolean) => Promise<void>;
  hasWebhookTrigger?: boolean;
  hasCronTrigger?: boolean;
  compact?: boolean;
}

const WorkflowActivationToggle: React.FC<WorkflowActivationToggleProps> = ({
  _workflowId,
  isActive,
  onToggle,
  hasWebhookTrigger = false,
  hasCronTrigger = false,
  compact = false,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const handleToggle = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await onToggle(!isActive);
    } catch (err) {
      setError((err as Error).message || 'Failed to toggle workflow');
    } finally {
      setIsLoading(false);
    }
  }, [isActive, onToggle]);

  if (compact) {
    return (
      <button
        onClick={handleToggle}
        disabled={isLoading}
        className={`
          relative inline-flex h-6 w-11 items-center rounded-full transition-colors
          ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isActive ? 'bg-green-500' : 'bg-gray-300'}
        `}
        title={isActive ? 'Deactivate workflow' : 'Activate workflow'}
      >
        <span
          className={`
            inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm
            ${isActive ? 'translate-x-6' : 'translate-x-1'}
          `}
        >
          {isLoading && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="relative">
      <div
        className={`
          flex items-center gap-3 p-3 rounded-lg border transition-all
          ${isActive
            ? 'bg-green-50 border-green-200'
            : 'bg-gray-50 border-gray-200'
          }
        `}
      >
        {/* Toggle switch */}
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className={`
            relative inline-flex h-8 w-14 items-center rounded-full transition-colors
            ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            ${isActive ? 'bg-green-500' : 'bg-gray-300'}
          `}
        >
          <span
            className={`
              inline-flex items-center justify-center h-6 w-6 transform rounded-full bg-white transition-transform shadow-md
              ${isActive ? 'translate-x-7' : 'translate-x-1'}
            `}
          >
            {isLoading ? (
              <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : isActive ? (
              <Zap size={14} className="text-green-500" />
            ) : (
              <Power size={14} className="text-gray-400" />
            )}
          </span>
        </button>

        {/* Status text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${isActive ? 'text-green-700' : 'text-gray-700'}`}>
              {isActive ? 'Active' : 'Inactive'}
            </span>
            {isActive && (
              <span className="flex items-center gap-1 text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Live
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {isActive
              ? 'Workflow will run when triggered'
              : 'Workflow is paused'
            }
          </p>
        </div>

        {/* Settings button */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="p-2 hover:bg-white/50 rounded-lg transition-colors"
        >
          <Settings size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-2 flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Details panel */}
      {showDetails && (
        <div className="mt-2 p-3 bg-white border border-gray-200 rounded-lg text-sm">
          <h4 className="font-medium text-gray-900 mb-2">Trigger Information</h4>
          <div className="space-y-2">
            {hasWebhookTrigger && (
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-green-500" />
                <span className="text-gray-600">Webhook trigger configured</span>
              </div>
            )}
            {hasCronTrigger && (
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-blue-500" />
                <span className="text-gray-600">Schedule trigger configured</span>
              </div>
            )}
            {!hasWebhookTrigger && !hasCronTrigger && (
              <div className="flex items-center gap-2 text-amber-600">
                <AlertTriangle size={14} />
                <span>No automatic trigger configured</span>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            When active, this workflow will automatically run based on its triggers.
            Manual execution is always available regardless of this setting.
          </p>
        </div>
      )}
    </div>
  );
};

export default WorkflowActivationToggle;
