/**
 * Custom Node Creator
 * UI for creating and managing custom workflow nodes
 */

import React from 'react';
import { useWorkflowStore } from '../../store';
import {
  Puzzle,
  Plus,
  Save,
  X,
  Download,
  AlertCircle,
} from 'lucide-react';

import { CustomNodeCreatorProps, TabType } from './node-creator/types';
import { useNodeCreator } from './node-creator/useNodeCreator';
import { NodeForm } from './node-creator/NodeForm';
import { NodeList } from './node-creator/NodeList';
import { PortEditor } from './node-creator/PortEditor';
import { CodeEditor } from './node-creator/CodeEditor';

const TABS: TabType[] = ['basic', 'inputs', 'outputs', 'code'];

const CustomNodeCreatorComponent: React.FC<CustomNodeCreatorProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const darkMode = useWorkflowStore((state) => state.darkMode);

  const {
    customNodes,
    activeTab,
    editingNode,
    isCreating,
    formData,
    error,
    testResult,
    setActiveTab,
    setFormData,
    startCreating,
    startEditing,
    cancelEditing,
    saveNode,
    deleteNode,
    duplicateNode,
    exportNodes,
    addInput,
    removeInput,
    updateInput,
    addOutput,
    removeOutput,
    updateOutput,
    testCode,
  } = useNodeCreator(onSave);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-4 md:inset-auto md:right-4 md:top-20 md:w-[520px] md:max-h-[calc(100vh-6rem)] overflow-hidden rounded-xl shadow-2xl border z-50 flex flex-col ${
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
          <Puzzle className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold">
            {isCreating ? (editingNode ? 'Edit Node' : 'Create Custom Node') : 'Custom Nodes'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {!isCreating && (
            <>
              <button
                onClick={startCreating}
                className="p-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                title="Create new node"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={exportNodes}
                className={`p-1.5 rounded-lg transition-colors ${
                  darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                }`}
                title="Export nodes"
              >
                <Download className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={isCreating ? cancelEditing : onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isCreating ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Tabs */}
          <div
            className={`flex border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}
          >
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? 'text-orange-500 border-b-2 border-orange-500'
                    : darkMode
                    ? 'text-gray-400 hover:text-white'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-500 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'basic' && (
              <NodeForm
                formData={formData}
                setFormData={setFormData}
                darkMode={darkMode}
              />
            )}

            {activeTab === 'inputs' && (
              <PortEditor
                type="inputs"
                formData={formData}
                darkMode={darkMode}
                onAdd={addInput}
                onRemove={removeInput}
                onUpdate={updateInput}
              />
            )}

            {activeTab === 'outputs' && (
              <PortEditor
                type="outputs"
                formData={formData}
                darkMode={darkMode}
                onAdd={addOutput}
                onRemove={removeOutput}
                onUpdate={updateOutput}
              />
            )}

            {activeTab === 'code' && (
              <CodeEditor
                formData={formData}
                setFormData={setFormData}
                darkMode={darkMode}
                testResult={testResult}
                onTest={testCode}
              />
            )}
          </div>

          {/* Footer */}
          <div
            className={`p-4 border-t flex justify-end gap-2 ${
              darkMode ? 'border-gray-700' : 'border-gray-200'
            }`}
          >
            <button
              onClick={cancelEditing}
              className={`px-4 py-2 text-sm rounded-lg ${
                darkMode ? 'bg-gray-800' : 'bg-gray-200'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={saveNode}
              className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Node
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <NodeList
            customNodes={customNodes}
            darkMode={darkMode}
            onEdit={startEditing}
            onDuplicate={duplicateNode}
            onDelete={deleteNode}
          />
        </div>
      )}
    </div>
  );
};

const CustomNodeCreator = React.memo(CustomNodeCreatorComponent, (prev, next) => {
  return prev.isOpen === next.isOpen;
});

export default CustomNodeCreator;
