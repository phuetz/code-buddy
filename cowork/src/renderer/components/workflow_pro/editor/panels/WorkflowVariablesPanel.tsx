// @ts-nocheck
/**
 * Workflow Variables Panel
 * Manage workflow-level variables that can be used in expressions
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useWorkflowStore } from '../../store';
import {
  Variable,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Copy,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Info,
  Search,
} from 'lucide-react';

interface WorkflowVariable {
  id: string;
  name: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'secret';
  description?: string;
  isSecret: boolean;
  createdAt: number;
  updatedAt: number;
}

interface WorkflowVariablesPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const WorkflowVariablesPanelComponent: React.FC<WorkflowVariablesPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const darkMode = useWorkflowStore((state) => state.darkMode);

  // Local state for variables (in real app, this would be in the store)
  const [variables, setVariables] = useState<WorkflowVariable[]>([
    {
      id: 'var_1',
      name: 'API_BASE_URL',
      value: 'https://api.example.com',
      type: 'string',
      description: 'Base URL for API requests',
      isSecret: false,
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 3600000,
    },
    {
      id: 'var_2',
      name: 'MAX_RETRIES',
      value: '3',
      type: 'number',
      description: 'Maximum retry attempts',
      isSecret: false,
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 86400000,
    },
    {
      id: 'var_3',
      name: 'API_KEY',
      value: 'sk-secret-key-hidden',
      type: 'secret',
      description: 'API authentication key',
      isSecret: true,
      createdAt: Date.now() - 172800000,
      updatedAt: Date.now() - 86400000,
    },
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<WorkflowVariable>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [newVariable, setNewVariable] = useState<Partial<WorkflowVariable>>({
    name: '',
    value: '',
    type: 'string',
    description: '',
    isSecret: false,
  });
  const [showSecrets, setShowSecrets] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter variables by search
  const filteredVariables = useMemo(() => {
    if (!searchQuery) return variables;
    const query = searchQuery.toLowerCase();
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        v.description?.toLowerCase().includes(query)
    );
  }, [variables, searchQuery]);

  // Validate variable name
  const validateName = useCallback(
    (name: string, excludeId?: string) => {
      if (!name.trim()) return 'Name is required';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        return 'Name must start with a letter or underscore and contain only alphanumeric characters';
      }
      if (variables.some((v) => v.name === name && v.id !== excludeId)) {
        return 'A variable with this name already exists';
      }
      return null;
    },
    [variables]
  );

  // Add new variable
  const addVariable = useCallback(() => {
    const nameError = validateName(newVariable.name || '');
    if (nameError) {
      setError(nameError);
      return;
    }

    const variable: WorkflowVariable = {
      id: `var_${Date.now()}`,
      name: newVariable.name!,
      value: newVariable.value || '',
      type: (newVariable.type as WorkflowVariable['type']) || 'string',
      description: newVariable.description,
      isSecret: newVariable.isSecret || newVariable.type === 'secret',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setVariables((prev) => [...prev, variable]);
    setNewVariable({
      name: '',
      value: '',
      type: 'string',
      description: '',
      isSecret: false,
    });
    setIsAdding(false);
    setError(null);
  }, [newVariable, validateName]);

  // Start editing
  const startEditing = useCallback((variable: WorkflowVariable) => {
    setEditingId(variable.id);
    setEditForm({ ...variable });
    setError(null);
  }, []);

  // Save edit
  const saveEdit = useCallback(() => {
    if (!editingId || !editForm.name) return;

    const nameError = validateName(editForm.name, editingId);
    if (nameError) {
      setError(nameError);
      return;
    }

    setVariables((prev) =>
      prev.map((v) =>
        v.id === editingId
          ? {
              ...v,
              ...editForm,
              isSecret: editForm.type === 'secret' || editForm.isSecret,
              updatedAt: Date.now(),
            }
          : v
      )
    );
    setEditingId(null);
    setEditForm({});
    setError(null);
  }, [editingId, editForm, validateName]);

  // Cancel edit
  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditForm({});
    setError(null);
  }, []);

  // Delete variable
  const deleteVariable = useCallback((id: string) => {
    setVariables((prev) => prev.filter((v) => v.id !== id));
  }, []);

  // Toggle secret visibility
  const toggleSecretVisibility = useCallback((id: string) => {
    setShowSecrets((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Copy expression to clipboard with error handling
  const copyExpression = useCallback(async (variable: WorkflowVariable) => {
    const expression = `{{ $vars.${variable.name} }}`;
    try {
      await navigator.clipboard.writeText(expression);
      setCopiedId(variable.id);
      const timeoutId = setTimeout(() => setCopiedId(null), 2000);
      // Return cleanup function (component typically stays mounted for duration)
      return () => clearTimeout(timeoutId);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setError('Failed to copy to clipboard');
    }
  }, []);

  // Get value display
  const getValueDisplay = useCallback(
    (variable: WorkflowVariable) => {
      if (variable.isSecret && !showSecrets.has(variable.id)) {
        return '••••••••••';
      }
      if (variable.type === 'json') {
        try {
          return JSON.stringify(JSON.parse(variable.value), null, 2);
        } catch {
          return variable.value;
        }
      }
      return variable.value;
    },
    [showSecrets]
  );

  // Get type color
  const getTypeColor = useCallback((type: WorkflowVariable['type']) => {
    switch (type) {
      case 'string':
        return 'text-green-500 bg-green-500/10';
      case 'number':
        return 'text-blue-500 bg-blue-500/10';
      case 'boolean':
        return 'text-purple-500 bg-purple-500/10';
      case 'json':
        return 'text-orange-500 bg-orange-500/10';
      case 'secret':
        return 'text-red-500 bg-red-500/10';
      default:
        return 'text-gray-500 bg-gray-500/10';
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed right-4 top-20 w-[420px] max-h-[calc(100vh-6rem)] overflow-hidden rounded-xl shadow-2xl border z-50 flex flex-col ${
        darkMode
          ? 'bg-gray-900 border-gray-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 border-b flex items-center justify-between ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <Variable className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold">Workflow Variables</h3>
          <span
            className={`px-2 py-0.5 text-xs rounded-full ${
              darkMode ? 'bg-gray-800' : 'bg-gray-100'
            }`}
          >
            {variables.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAdding(true)}
            className="p-1.5 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition-colors"
            title="Add variable"
          >
            <Plus className="w-4 h-4" />
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

      {/* Search */}
      <div className={`p-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search variables..."
            className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm ${
              darkMode
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-50 border-gray-200'
            } border`}
          />
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Add new variable form */}
      {isAdding && (
        <div
          className={`p-4 border-b ${
            darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="space-y-3">
            <input
              type="text"
              value={newVariable.name}
              onChange={(e) => setNewVariable({ ...newVariable, name: e.target.value })}
              placeholder="Variable name (e.g., API_KEY)"
              className={`w-full px-3 py-2 rounded-lg text-sm font-mono ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              } border`}
            />
            <div className="flex gap-2">
              <select
                value={newVariable.type}
                onChange={(e) =>
                  setNewVariable({
                    ...newVariable,
                    type: e.target.value as WorkflowVariable['type'],
                    isSecret: e.target.value === 'secret',
                  })
                }
                className={`px-3 py-2 rounded-lg text-sm ${
                  darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                } border`}
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="json">JSON</option>
                <option value="secret">Secret</option>
              </select>
              <input
                type={newVariable.type === 'secret' ? 'password' : 'text'}
                value={newVariable.value}
                onChange={(e) => setNewVariable({ ...newVariable, value: e.target.value })}
                placeholder="Value"
                className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                  darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                } border`}
              />
            </div>
            <input
              type="text"
              value={newVariable.description}
              onChange={(e) => setNewVariable({ ...newVariable, description: e.target.value })}
              placeholder="Description (optional)"
              className={`w-full px-3 py-2 rounded-lg text-sm ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              } border`}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setIsAdding(false);
                  setError(null);
                }}
                className={`px-3 py-1.5 text-sm rounded-lg ${
                  darkMode ? 'bg-gray-800' : 'bg-gray-200'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={addVariable}
                className="px-3 py-1.5 text-sm rounded-lg bg-purple-500 text-white"
              >
                Add Variable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Variables list */}
      <div className="flex-1 overflow-y-auto">
        {filteredVariables.length === 0 ? (
          <div className="text-center py-12">
            <Variable className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p className="text-gray-500 text-sm">
              {variables.length === 0
                ? 'No variables yet. Add one to get started.'
                : 'No variables match your search.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {filteredVariables.map((variable) =>
              editingId === variable.id ? (
                // Edit mode
                <div
                  key={variable.id}
                  className={`p-4 ${darkMode ? 'bg-gray-800/50' : 'bg-gray-50'}`}
                >
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className={`w-full px-3 py-2 rounded-lg text-sm font-mono ${
                        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                      } border`}
                    />
                    <div className="flex gap-2">
                      <select
                        value={editForm.type}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            type: e.target.value as WorkflowVariable['type'],
                            isSecret: e.target.value === 'secret',
                          })
                        }
                        className={`px-3 py-2 rounded-lg text-sm ${
                          darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                        } border`}
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="json">JSON</option>
                        <option value="secret">Secret</option>
                      </select>
                      <input
                        type={editForm.type === 'secret' ? 'password' : 'text'}
                        value={editForm.value}
                        onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                        className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                          darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                        } border`}
                      />
                    </div>
                    <input
                      type="text"
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      placeholder="Description"
                      className={`w-full px-3 py-2 rounded-lg text-sm ${
                        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                      } border`}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={cancelEdit}
                        className={`p-1.5 rounded ${
                          darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                        }`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        onClick={saveEdit}
                        className="p-1.5 rounded bg-green-500 text-white"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                // View mode
                <div
                  key={variable.id}
                  className={`p-4 transition-colors ${
                    darkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <code className="font-mono font-medium">{variable.name}</code>
                      <span
                        className={`px-1.5 py-0.5 text-[10px] rounded uppercase ${getTypeColor(
                          variable.type
                        )}`}
                      >
                        {variable.type}
                      </span>
                      {variable.isSecret && (
                        <Lock className="w-3.5 h-3.5 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {variable.isSecret && (
                        <button
                          onClick={() => toggleSecretVisibility(variable.id)}
                          className={`p-1 rounded transition-colors ${
                            darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                          }`}
                          title={showSecrets.has(variable.id) ? 'Hide' : 'Show'}
                        >
                          {showSecrets.has(variable.id) ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => copyExpression(variable)}
                        className={`p-1 rounded transition-colors ${
                          darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                        }`}
                        title="Copy expression"
                      >
                        {copiedId === variable.id ? (
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => startEditing(variable)}
                        className={`p-1 rounded transition-colors ${
                          darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                        }`}
                        title="Edit"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteVariable(variable.id)}
                        className={`p-1 rounded transition-colors text-red-500 ${
                          darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                        }`}
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div
                    className={`p-2 rounded text-sm font-mono overflow-auto max-h-24 ${
                      darkMode ? 'bg-gray-800' : 'bg-gray-100'
                    }`}
                  >
                    {getValueDisplay(variable)}
                  </div>
                  {variable.description && (
                    <p className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      {variable.description}
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`p-3 border-t text-xs text-gray-500 ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-1">
          <Info className="w-3.5 h-3.5" />
          Use variables in expressions: <code className="px-1 rounded bg-purple-500/20 text-purple-500">{'{{ $vars.NAME }}'}</code>
        </div>
      </div>
    </div>
  );
};

const WorkflowVariablesPanel = React.memo(WorkflowVariablesPanelComponent, (prev, next) => {
  return prev.isOpen === next.isOpen;
});

export default WorkflowVariablesPanel;
