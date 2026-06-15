/**
 * EditorSidebar Component
 * Side panel for node configuration in the workflow editor
 */

import React, { useCallback } from 'react';
import { X, Trash2, Copy, Play, Pin } from 'lucide-react';
import type { WorkflowNode, NodeData } from '../../type-mocks';

export interface EditorSidebarProps {
  /** Selected node to configure */
  selectedNode: WorkflowNode | null;
  /** Handler for updating node configuration */
  onUpdateNode?: (nodeId: string, updates: Partial<NodeData>) => void;
  /** Handler for closing the sidebar */
  onClose?: () => void;
  /** Handler for deleting the node */
  onDeleteNode?: (nodeId: string) => void;
  /** Handler for duplicating the node */
  onDuplicateNode?: (nodeId: string) => void;
  /** Handler for executing the node */
  onExecuteNode?: (nodeId: string) => void;
  /** Handler for pinning data to the node */
  onPinData?: (nodeId: string) => void;
  /** Whether dark mode is enabled */
  darkMode?: boolean;
  /** Whether the sidebar is open */
  isOpen?: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface SidebarHeaderProps {
  node: WorkflowNode;
  onClose?: () => void;
  darkMode?: boolean;
}

const SidebarHeader: React.FC<SidebarHeaderProps> = ({ node, onClose, darkMode }) => (
  <div
    className={`
      flex items-center justify-between p-4 border-b
      ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}
    `}
  >
    <div className="flex items-center gap-3">
      {node.data?.icon && (
        <span className="text-2xl">{node.data.icon}</span>
      )}
      <div>
        <h3
          className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}
        >
          {node.data?.label || 'Node Configuration'}
        </h3>
        <p
          className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
        >
          {node.data?.type || 'Unknown Type'}
        </p>
      </div>
    </div>
    <button
      onClick={onClose}
      className={`
        p-2 rounded-lg transition-colors
        ${darkMode
          ? 'hover:bg-gray-700 text-gray-400 hover:text-white'
          : 'hover:bg-gray-200 text-gray-500 hover:text-gray-700'
        }
      `}
      aria-label="Close sidebar"
    >
      <X size={20} />
    </button>
  </div>
);

interface SidebarActionsProps {
  nodeId: string;
  onDeleteNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onExecuteNode?: (nodeId: string) => void;
  onPinData?: (nodeId: string) => void;
  darkMode?: boolean;
}

const SidebarActions: React.FC<SidebarActionsProps> = ({
  nodeId,
  onDeleteNode,
  onDuplicateNode,
  onExecuteNode,
  onPinData,
  darkMode,
}) => (
  <div
    className={`
      flex items-center gap-2 p-4 border-b
      ${darkMode ? 'border-gray-700' : 'border-gray-200'}
    `}
  >
    <button
      onClick={() => onExecuteNode?.(nodeId)}
      title="Execute this node"
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
        ${darkMode
          ? 'bg-green-600 hover:bg-green-700 text-white'
          : 'bg-green-500 hover:bg-green-600 text-white'
        }
      `}
    >
      <Play size={16} />
      Execute
    </button>

    <button
      onClick={() => onDuplicateNode?.(nodeId)}
      title="Duplicate node"
      className={`
        p-2 rounded-lg transition-colors
        ${darkMode
          ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
        }
      `}
    >
      <Copy size={16} />
    </button>

    <button
      onClick={() => onPinData?.(nodeId)}
      title="Pin test data"
      className={`
        p-2 rounded-lg transition-colors
        ${darkMode
          ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
        }
      `}
    >
      <Pin size={16} />
    </button>

    <div className="flex-1" />

    <button
      onClick={() => onDeleteNode?.(nodeId)}
      title="Delete node"
      className={`
        p-2 rounded-lg transition-colors
        ${darkMode
          ? 'bg-red-900/50 hover:bg-red-800 text-red-400 hover:text-red-300'
          : 'bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700'
        }
      `}
    >
      <Trash2 size={16} />
    </button>
  </div>
);

interface ConfigFieldProps {
  label: string;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  type?: 'text' | 'number' | 'boolean' | 'textarea';
  placeholder?: string;
  darkMode?: boolean;
}

const ConfigField: React.FC<ConfigFieldProps> = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  darkMode,
}) => {
  const inputClasses = `
    w-full px-3 py-2 rounded-lg transition-colors
    ${darkMode
      ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500 focus:border-blue-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500'
    }
    border focus:outline-none focus:ring-2 focus:ring-blue-500/20
  `;

  return (
    <div className="space-y-2">
      <label
        className={`block text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
      >
        {label}
      </label>
      {type === 'textarea' ? (
        <textarea
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className={inputClasses}
        />
      ) : type === 'boolean' ? (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4 rounded text-blue-500 focus:ring-blue-500"
          />
          <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {value ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      ) : (
        <input
          type={type}
          value={String(value)}
          onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
          placeholder={placeholder}
          className={inputClasses}
        />
      )}
    </div>
  );
};

/**
 * EditorSidebar - Node configuration panel
 *
 * Provides a slide-out panel for configuring selected nodes in the workflow editor.
 * Includes actions for executing, duplicating, pinning data, and deleting nodes.
 */
export const EditorSidebar: React.FC<EditorSidebarProps> = ({
  selectedNode,
  onUpdateNode,
  onClose,
  onDeleteNode,
  onDuplicateNode,
  onExecuteNode,
  onPinData,
  darkMode = false,
  isOpen = false,
  className = '',
}) => {
  const handleFieldChange = useCallback(
    (field: string, value: string | number | boolean) => {
      if (selectedNode && onUpdateNode) {
        onUpdateNode(selectedNode.id, {
          config: {
            ...selectedNode.data?.config,
            [field]: value,
          },
        });
      }
    },
    [selectedNode, onUpdateNode]
  );

  if (!isOpen || !selectedNode) {
    return null;
  }

  const config = selectedNode.data?.config || {};

  return (
    <div
      className={`
        fixed right-0 top-0 h-full w-96 z-50
        ${darkMode ? 'bg-gray-900' : 'bg-white'}
        shadow-2xl border-l
        ${darkMode ? 'border-gray-800' : 'border-gray-200'}
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        ${className}
      `}
    >
      {/* Header */}
      <SidebarHeader
        node={selectedNode}
        onClose={onClose}
        darkMode={darkMode}
      />

      {/* Actions */}
      <SidebarActions
        nodeId={selectedNode.id}
        onDeleteNode={onDeleteNode}
        onDuplicateNode={onDuplicateNode}
        onExecuteNode={onExecuteNode}
        onPinData={onPinData}
        darkMode={darkMode}
      />

      {/* Configuration Fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <h4
          className={`text-sm font-semibold ${darkMode ? 'text-gray-400' : 'text-gray-600'} uppercase tracking-wider`}
        >
          Configuration
        </h4>

        {/* Node Label */}
        <ConfigField
          label="Node Name"
          value={selectedNode.data?.label || ''}
          onChange={(value) => onUpdateNode?.(selectedNode.id, { label: String(value) })}
          placeholder="Enter node name"
          darkMode={darkMode}
        />

        {/* Dynamic config fields based on node type */}
        {Object.entries(config).map(([key, value]) => (
          <ConfigField
            key={key}
            label={key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}
            value={value as string | number | boolean}
            onChange={(newValue) => handleFieldChange(key, newValue)}
            type={
              typeof value === 'boolean'
                ? 'boolean'
                : typeof value === 'number'
                  ? 'number'
                  : 'text'
            }
            darkMode={darkMode}
          />
        ))}

        {/* Empty state for no config */}
        {Object.keys(config).length === 0 && (
          <p
            className={`text-sm italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
          >
            No configuration options available for this node.
          </p>
        )}
      </div>

      {/* Footer */}
      <div
        className={`
          p-4 border-t
          ${darkMode ? 'border-gray-700' : 'border-gray-200'}
        `}
      >
        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Node ID: {selectedNode.id}
        </p>
      </div>
    </div>
  );
};

export default EditorSidebar;
