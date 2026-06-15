import React from 'react';
import { Workflow, X } from 'lucide-react';
import { useWorkflowStore } from '../../store';

interface FlowDesignerHeaderProps {
  previewMode: boolean;
  onTogglePreviewMode: () => void;
  onClose: () => void;
}

export const FlowDesignerHeader: React.FC<FlowDesignerHeaderProps> = ({
  previewMode,
  onTogglePreviewMode,
  onClose
}) => {
  const darkMode = useWorkflowStore(state => state.darkMode);

  return (
    <div className={`px-6 py-4 border-b ${
      darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center">
            <Workflow className="text-white" size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Visual Flow Designer</h2>
            <p className="text-sm text-gray-500">Advanced workflow patterns and templates</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onTogglePreviewMode}
            className={`px-3 py-1 rounded-lg text-sm transition-colors ${
              previewMode
                ? 'bg-indigo-500 text-white'
                : darkMode
                  ? 'bg-gray-700 text-gray-300'
                  : 'bg-gray-200 text-gray-700'
            }`}
          >
            {previewMode ? 'List View' : 'Preview Mode'}
          </button>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
            }`}
          >
            <X size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};
