// @ts-nocheck
import type {
  SubWorkflow,
  SubWorkflowExecution,
  SubWorkflowVersion,
  SubWorkflowTest,
  TestResult,
  SubWorkflowPerformance,
  SubWorkflowInput,
  SubWorkflowOutput,
  ExecutionStatus,
  ErrorStrategy,
  IsolationLevel
} from '../../../../types/subworkflows';

export type {
  SubWorkflow,
  SubWorkflowExecution,
  SubWorkflowVersion,
  SubWorkflowTest,
  TestResult,
  SubWorkflowPerformance,
  SubWorkflowInput,
  SubWorkflowOutput,
  ExecutionStatus,
  ErrorStrategy,
  IsolationLevel
};

export type ActiveTab = 'library' | 'my-workflows' | 'executions' | 'tests';

export interface SubWorkflowManagerProps {
  workflowId?: string;
  onSubWorkflowSelect?: (subWorkflow: SubWorkflow) => void;
  onInsertSubWorkflow?: (subWorkflow: SubWorkflow) => void;
}

export interface SubWorkflowFormData {
  name: string;
  description: string;
  category: string;
  tags: string;
  inputs: SubWorkflowInput[];
  outputs: SubWorkflowOutput[];
  errorStrategy: ErrorStrategy;
  timeout: number;
  isolationLevel: IsolationLevel;
}

export interface SubWorkflowListProps {
  subWorkflows: SubWorkflow[];
  searchTerm: string;
  filterCategory: string;
  expandedWorkflows: Set<string>;
  onSearchChange: (term: string) => void;
  onFilterChange: (category: string) => void;
  onSelect: (subWorkflow: SubWorkflow) => void;
  onExecute: (subWorkflow: SubWorkflow) => void;
  onInsert?: (subWorkflow: SubWorkflow) => void;
  onToggleExpand: (id: string) => void;
  onPublish: (subWorkflow: SubWorkflow) => void;
  onCreateNew: () => void;
}

export interface SubWorkflowEditorProps {
  isOpen: boolean;
  formData: SubWorkflowFormData;
  onFormChange: (data: Partial<SubWorkflowFormData>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export interface SubWorkflowExecutionsProps {
  executions: SubWorkflowExecution[];
  subWorkflows: SubWorkflow[];
}

export interface SubWorkflowTestsProps {
  tests: SubWorkflowTest[];
  testResults: Map<string, TestResult>;
  selectedSubWorkflow: SubWorkflow | null;
  onRunTest: (test: SubWorkflowTest) => void;
  onCreateTest: () => void;
}

export interface MyWorkflowsProps {
  subWorkflows: SubWorkflow[];
  performance: SubWorkflowPerformance | null;
  currentUser: string;
  onCreateNew: () => void;
}

// Mock authService until proper import is added
export const authService = {
  getCurrentUser: () => 'current-user'
};
