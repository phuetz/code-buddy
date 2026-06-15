// @ts-nocheck
import React from 'react';
import { useWorkflowStore } from '../store';
import {
  useFlowDesigner,
  FlowPatternList,
  FlowPatternDetails,
  FlowDesignerHeader,
  FlowDesignerFilters
} from './flow-designer';

interface VisualFlowDesignerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function VisualFlowDesigner({ isOpen, onClose }: VisualFlowDesignerProps) {
  const darkMode = useWorkflowStore(state => state.darkMode);

  const {
    selectedPattern,
    filterCategory,
    searchTerm,
    previewMode,
    setSelectedPattern,
    setFilterCategory,
    setSearchTerm,
    setPreviewMode,
    applyPattern,
    getFilteredPatterns
  } = useFlowDesigner(onClose);

  if (!isOpen) return null;

  const filteredPatterns = getFilteredPatterns();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`w-full max-w-6xl max-h-[90vh] ${
        darkMode ? 'bg-gray-900' : 'bg-white'
      } rounded-xl shadow-2xl overflow-hidden`}>
        {/* Header */}
        <FlowDesignerHeader
          previewMode={previewMode}
          onTogglePreviewMode={() => setPreviewMode(!previewMode)}
          onClose={onClose}
        />

        {/* Filters */}
        <FlowDesignerFilters
          searchTerm={searchTerm}
          filterCategory={filterCategory}
          onSearchChange={setSearchTerm}
          onCategoryChange={setFilterCategory}
        />

        {/* Content */}
        <div className="flex h-full" style={{ height: 'calc(90vh - 160px)' }}>
          {/* Pattern List */}
          <FlowPatternList
            patterns={filteredPatterns}
            selectedPattern={selectedPattern}
            onSelectPattern={setSelectedPattern}
          />

          {/* Pattern Details */}
          <div className="flex-1 p-6 overflow-y-auto">
            <FlowPatternDetails
              pattern={selectedPattern}
              onApplyPattern={applyPattern}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
