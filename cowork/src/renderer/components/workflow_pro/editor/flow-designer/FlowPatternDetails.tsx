import React from 'react';
import { Workflow } from 'lucide-react';
import { useWorkflowStore } from '../../store';
import { FlowPattern } from './types';
import { FlowPatternPreview } from './FlowPatternPreview';

interface FlowPatternDetailsProps {
  pattern: FlowPattern | null;
  onApplyPattern: (pattern: FlowPattern) => void;
}

export const FlowPatternDetails: React.FC<FlowPatternDetailsProps> = ({
  pattern,
  onApplyPattern
}) => {
  const darkMode = useWorkflowStore(state => state.darkMode);

  if (!pattern) {
    return (
      <div className="flex items-center justify-center h-full text-center">
        <div>
          <Workflow size={64} className="mx-auto mb-4 text-gray-400" />
          <h3 className="text-xl font-medium mb-2">Select a Pattern</h3>
          <p className="text-gray-500">Choose a flow pattern from the left to see details and apply it</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 bg-indigo-500 rounded-lg flex items-center justify-center">
            <pattern.icon className="text-white" size={24} />
          </div>
          <div>
            <h3 className="text-2xl font-bold">{pattern.name}</h3>
            <p className="text-gray-500">{pattern.description}</p>
          </div>
        </div>
        <button
          onClick={() => onApplyPattern(pattern)}
          className="px-6 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
        >
          Apply Pattern
        </button>
      </div>

      {/* Pattern Preview */}
      <div>
        <h4 className="text-lg font-medium mb-3">Pattern Preview</h4>
        <FlowPatternPreview pattern={pattern} />
      </div>

      {/* Pattern Configuration */}
      <div className={`p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
        <h4 className="font-medium mb-3">Pattern Configuration</h4>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Nodes:</span>
            <span className="font-mono">{pattern.template.nodes.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Connections:</span>
            <span className="font-mono">{pattern.template.edges.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Category:</span>
            <span className="capitalize">{pattern.category}</span>
          </div>
        </div>
      </div>

      {/* Node Details */}
      <div>
        <h4 className="text-lg font-medium mb-3">Node Details</h4>
        <div className="space-y-3">
          {pattern.template.nodes.map((node, index) => (
            <div
              key={node.id}
              className={`p-3 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white text-sm font-medium">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <h5 className="font-medium">{node.data.label}</h5>
                  <p className="text-sm text-gray-500">Type: {node.data.type}</p>
                  {Object.keys(node.data.config).length > 0 && (
                    <div className="mt-2">
                      <code className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">
                        {JSON.stringify(node.data.config, null, 2)}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
