// @ts-nocheck
/**
 * AISuggestionsPopover
 * Floating panel showing AI-suggested next nodes based on common workflow patterns.
 */

import React from 'react';
import { Sparkles, Plus, X } from 'lucide-react';
import { nodeTypes } from '../data-mocks';
import { WorkflowGenerator } from '../service-mocks';

interface AISuggestionsPopoverProps {
  nodeType: string;
  position: { x: number; y: number };
  onSelect: (type: string) => void;
  onClose: () => void;
}

const generator = new WorkflowGenerator();

export const AISuggestionsPopover: React.FC<AISuggestionsPopoverProps> = ({
  nodeType,
  position,
  onSelect,
  onClose,
}) => {
  const suggestions = generator.suggestNextNodes(nodeType);

  return (
    <div
      className="absolute z-50 w-72 rounded-lg border shadow-xl animate-in fade-in duration-200
        bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200">
          <Sparkles className="w-4 h-4 text-amber-500" />
          Suggested Next Nodes
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Suggestion list */}
      <div className="flex flex-col py-1">
        {suggestions.map((s) => {
          const info = nodeTypes[s.type];
          return (
            <button
              key={s.type}
              onClick={() => onSelect(s.type)}
              className="flex items-start gap-2 px-3 py-2 text-left transition-colors
                hover:bg-gray-50 dark:hover:bg-gray-700/60"
            >
              <span
                className={`mt-0.5 flex items-center justify-center w-6 h-6 rounded text-white text-xs flex-shrink-0 ${
                  info?.color ?? 'bg-gray-500'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                  {s.label}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                  {s.reason}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
