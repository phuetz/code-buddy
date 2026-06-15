// @ts-nocheck
import React from 'react';
import {
  Search,
  Plus,
  Play,
  ChevronRight,
  ChevronDown,
  Package,
  Settings,
  GitBranch,
  Code,
  Unlock,
  Star
} from 'lucide-react';
import type { SubWorkflowListProps, SubWorkflow } from './types';

function getCategoryIcon(category: string) {
  switch (category) {
    case 'Data': return <Package className="w-4 h-4" />;
    case 'System': return <Settings className="w-4 h-4" />;
    case 'Integration': return <GitBranch className="w-4 h-4" />;
    case 'Utility': return <Code className="w-4 h-4" />;
    default: return <Package className="w-4 h-4" />;
  }
}

interface SubWorkflowCardProps {
  subWorkflow: SubWorkflow;
  isExpanded: boolean;
  onSelect: (subWorkflow: SubWorkflow) => void;
  onExecute: (subWorkflow: SubWorkflow) => void;
  onInsert?: (subWorkflow: SubWorkflow) => void;
  onToggleExpand: (id: string) => void;
  onPublish: (subWorkflow: SubWorkflow) => void;
}

const SubWorkflowCard: React.FC<SubWorkflowCardProps> = ({
  subWorkflow,
  isExpanded,
  onSelect,
  onExecute,
  onInsert,
  onToggleExpand,
  onPublish
}) => (
  <div className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
    <div
      className="p-4 cursor-pointer"
      onClick={() => onSelect(subWorkflow)}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {getCategoryIcon(subWorkflow.metadata.category)}
          <h4 className="font-medium">{subWorkflow.name}</h4>
          <span className="text-xs text-gray-500">v{subWorkflow.version}</span>
        </div>
        <div className="flex items-center gap-2">
          {subWorkflow.isPublished && (
            <span title="Published">
              <Unlock className="w-4 h-4 text-green-500" />
            </span>
          )}
          {subWorkflow.isTemplate && (
            <span title="Template">
              <Star className="w-4 h-4 text-yellow-500" />
            </span>
          )}
        </div>
      </div>

      {subWorkflow.description && (
        <p className="text-sm text-gray-600 mb-3">{subWorkflow.description}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span>{subWorkflow.inputs.length} inputs</span>
        <span>{subWorkflow.outputs.length} outputs</span>
        <span>{subWorkflow.nodes.length} nodes</span>
      </div>

      <div className="flex flex-wrap gap-1 mt-2">
        {subWorkflow.metadata.tags.map((tag, idx) => (
          <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
            {tag}
          </span>
        ))}
      </div>
    </div>

    <div className="border-t p-3 bg-gray-50 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExecute(subWorkflow);
          }}
          className="p-2 text-blue-600 hover:bg-blue-50 rounded"
          title="Execute"
        >
          <Play className="w-4 h-4" />
        </button>
        {onInsert && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onInsert(subWorkflow);
            }}
            className="p-2 text-green-600 hover:bg-green-50 rounded"
            title="Insert into workflow"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(subWorkflow.id);
          }}
          className="p-2 text-gray-600 hover:bg-gray-200 rounded"
        >
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      <div className="text-xs text-gray-500">
        by {subWorkflow.createdBy}
      </div>
    </div>

    {isExpanded && (
      <div className="border-t p-4 bg-white">
        <div className="space-y-3">
          <div>
            <h5 className="font-medium text-sm mb-1">Inputs</h5>
            <div className="space-y-1">
              {subWorkflow.inputs.map((input, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="font-mono">{input.name}</span>
                  <span className="text-gray-500">
                    {input.type} {input.required && <span className="text-red-500">*</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h5 className="font-medium text-sm mb-1">Outputs</h5>
            <div className="space-y-1">
              {subWorkflow.outputs.map((output, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="font-mono">{output.name}</span>
                  <span className="text-gray-500">{output.type}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button className="text-sm text-blue-600 hover:underline">
              View Details
            </button>
            {!subWorkflow.isPublished && (
              <button
                onClick={() => onPublish(subWorkflow)}
                className="text-sm text-green-600 hover:underline"
              >
                Publish
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </div>
);

export const SubWorkflowList: React.FC<SubWorkflowListProps> = ({
  subWorkflows,
  searchTerm,
  filterCategory,
  expandedWorkflows,
  onSearchChange,
  onFilterChange,
  onSelect,
  onExecute,
  onInsert,
  onToggleExpand,
  onPublish,
  onCreateNew
}) => {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search sub-workflows..."
              className="pl-10 pr-4 py-2 border rounded-lg w-64"
            />
          </div>

          <select
            value={filterCategory}
            onChange={(e) => onFilterChange(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="all">All Categories</option>
            <option value="Data">Data Processing</option>
            <option value="System">System</option>
            <option value="Integration">Integration</option>
            <option value="Utility">Utility</option>
          </select>
        </div>

        <button
          onClick={onCreateNew}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Sub-workflow
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {subWorkflows.map(subWorkflow => (
          <SubWorkflowCard
            key={subWorkflow.id}
            subWorkflow={subWorkflow}
            isExpanded={expandedWorkflows.has(subWorkflow.id)}
            onSelect={onSelect}
            onExecute={onExecute}
            onInsert={onInsert}
            onToggleExpand={onToggleExpand}
            onPublish={onPublish}
          />
        ))}
      </div>
    </div>
  );
};

export default SubWorkflowList;
