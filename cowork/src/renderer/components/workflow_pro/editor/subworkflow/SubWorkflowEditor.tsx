// @ts-nocheck
import React from 'react';
import type { SubWorkflowEditorProps, SubWorkflowInput, SubWorkflowOutput } from './types';
import type { DataType } from '../../type-mocks';

export const SubWorkflowEditor: React.FC<SubWorkflowEditorProps> = ({
  isOpen,
  formData,
  onFormChange,
  onSubmit,
  onClose
}) => {
  if (!isOpen) return null;

  const handleInputChange = (idx: number, field: keyof SubWorkflowInput, value: string | boolean) => {
    const newInputs = [...formData.inputs];
    (newInputs[idx] as Record<string, unknown>)[field] = value;
    onFormChange({ inputs: newInputs });
  };

  const handleOutputChange = (idx: number, field: keyof SubWorkflowOutput, value: string) => {
    const newOutputs = [...formData.outputs];
    (newOutputs[idx] as Record<string, unknown>)[field] = value;
    onFormChange({ outputs: newOutputs });
  };

  const addInput = () => {
    onFormChange({
      inputs: [
        ...formData.inputs,
        { name: '', type: 'string', required: false, description: '' }
      ]
    });
  };

  const addOutput = () => {
    onFormChange({
      outputs: [
        ...formData.outputs,
        { name: '', type: 'string', description: '', mapping: { sourceNode: '', sourceField: '' } }
      ]
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Create Sub-workflow</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="My Sub-workflow"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => onFormChange({ description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="What does this sub-workflow do?"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                value={formData.category}
                onChange={(e) => onFormChange({ category: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="Data">Data Processing</option>
                <option value="System">System</option>
                <option value="Integration">Integration</option>
                <option value="Utility">Utility</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Tags</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => onFormChange({ tags: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="tag1, tag2, tag3"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Inputs</label>
            <div className="space-y-2">
              {formData.inputs.map((input, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={input.name}
                    onChange={(e) => handleInputChange(idx, 'name', e.target.value)}
                    placeholder="Input name"
                    className="flex-1 px-3 py-2 border rounded-lg"
                  />
                  <select
                    value={input.type}
                    onChange={(e) => handleInputChange(idx, 'type', e.target.value as DataType)}
                    className="px-3 py-2 border rounded-lg"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="object">Object</option>
                    <option value="array">Array</option>
                    <option value="any">Any</option>
                  </select>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={input.required}
                      onChange={(e) => handleInputChange(idx, 'required', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Required</span>
                  </label>
                </div>
              ))}
              <button
                onClick={addInput}
                className="text-sm text-blue-600 hover:underline"
              >
                + Add Input
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Outputs</label>
            <div className="space-y-2">
              {formData.outputs.map((output, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={output.name}
                    onChange={(e) => handleOutputChange(idx, 'name', e.target.value)}
                    placeholder="Output name"
                    className="flex-1 px-3 py-2 border rounded-lg"
                  />
                  <select
                    value={output.type}
                    onChange={(e) => handleOutputChange(idx, 'type', e.target.value as DataType)}
                    className="px-3 py-2 border rounded-lg"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="object">Object</option>
                    <option value="array">Array</option>
                    <option value="any">Any</option>
                  </select>
                </div>
              ))}
              <button
                onClick={addOutput}
                className="text-sm text-blue-600 hover:underline"
              >
                + Add Output
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Error Strategy</label>
              <select
                value={formData.errorStrategy}
                onChange={(e) => onFormChange({ errorStrategy: e.target.value as 'fail' | 'retry' | 'fallback' | 'ignore' })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="fail">Fail on Error</option>
                <option value="retry">Retry on Error</option>
                <option value="fallback">Use Fallback</option>
                <option value="ignore">Ignore Errors</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Timeout (ms)</label>
              <input
                type="number"
                value={formData.timeout}
                onChange={(e) => onFormChange({ timeout: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubWorkflowEditor;
