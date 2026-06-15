// @ts-nocheck
import React, { memo } from 'react';
import { useWorkflowStore } from '../store';
import { Workflow } from 'lucide-react';

const WorkflowCanvas = memo(function WorkflowCanvas() {
  const { nodes, edges, darkMode } = useWorkflowStore();

  return (
    <div className={`h-full w-full ${darkMode ? 'bg-gray-900' : 'bg-gray-100'} relative`}>
      {/* Canvas Content */}
      <div className="absolute inset-0 flex items-center justify-center">
        {nodes.length === 0 ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
              <Workflow size={32} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Create your first workflow
            </h3>
            <p className="text-gray-500 mb-4 max-w-sm">
              Drag nodes from the sidebar to start building your automation workflow.
            </p>
          </div>
        ) : (
          <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-4">
            <div className="text-sm">
              <div>Nodes: {nodes.length}</div>
              <div>Connections: {edges.length}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default WorkflowCanvas;