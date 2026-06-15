import { type LucideIcon } from 'lucide-react';
import { WorkflowNode, WorkflowEdge } from '../../type-mocks';

export interface FlowPattern {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  template: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  category: FlowPatternCategory;
}

export type FlowPatternCategory = 'conditional' | 'loop' | 'parallel' | 'router' | 'advanced';

export interface FlowDesignerState {
  selectedPattern: FlowPattern | null;
  filterCategory: string;
  searchTerm: string;
  previewMode: boolean;
}

export interface FlowDesignerActions {
  setSelectedPattern: (pattern: FlowPattern | null) => void;
  setFilterCategory: (category: string) => void;
  setSearchTerm: (term: string) => void;
  setPreviewMode: (mode: boolean) => void;
  applyPattern: (pattern: FlowPattern) => void;
  getFilteredPatterns: () => FlowPattern[];
}

export interface UseFlowDesignerReturn extends FlowDesignerState, FlowDesignerActions {}
