// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { SubWorkflowService } from '../../service-mocks';
import { logger } from '../../service-mocks';
import type {
  SubWorkflow,
  SubWorkflowExecution,
  SubWorkflowVersion,
  SubWorkflowTest,
  TestResult,
  SubWorkflowPerformance,
  SubWorkflowFormData,
  ActiveTab
} from './types';
import { authService } from './types';

const subWorkflowService = SubWorkflowService.getInstance();

const DEFAULT_FORM_DATA: SubWorkflowFormData = {
  name: '',
  description: '',
  category: 'Data',
  tags: '',
  inputs: [],
  outputs: [],
  errorStrategy: 'fail',
  timeout: 300000,
  isolationLevel: 'isolated'
};

export function useSubWorkflow(workflowId?: string) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
  const [subWorkflows, setSubWorkflows] = useState<SubWorkflow[]>([]);
  const [executions, setExecutions] = useState<SubWorkflowExecution[]>([]);
  const [selectedSubWorkflow, setSelectedSubWorkflow] = useState<SubWorkflow | null>(null);
  const [versions, setVersions] = useState<SubWorkflowVersion[]>([]);
  const [performance, setPerformance] = useState<SubWorkflowPerformance | null>(null);
  const [tests, setTests] = useState<SubWorkflowTest[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testResults, setTestResults] = useState<Map<string, TestResult>>(new Map());
  const [expandedWorkflows, setExpandedWorkflows] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState<SubWorkflowFormData>(DEFAULT_FORM_DATA);

  const loadVersions = useCallback(async (subWorkflowId: string) => {
    const data = await subWorkflowService.listVersions(subWorkflowId);
    setVersions(data);
  }, []);

  const loadPerformance = useCallback(async (subWorkflowId: string) => {
    const data = await subWorkflowService.getPerformanceMetrics(subWorkflowId);
    setPerformance(data);
  }, []);

  const loadTests = useCallback(async (_subWorkflowId: string) => {
    // In real implementation, would load tests for sub-workflow
    setTests([]);
  }, []);

  const loadSubWorkflows = useCallback(async () => {
    const filters = workflowId ? { parentWorkflowId: workflowId } : undefined;
    const data = await subWorkflowService.listSubWorkflows(filters);
    setSubWorkflows(data);
  }, [workflowId]);

  useEffect(() => {
    loadSubWorkflows();
  }, [loadSubWorkflows]);

  useEffect(() => {
    if (selectedSubWorkflow) {
      loadVersions(selectedSubWorkflow.id);
      loadPerformance(selectedSubWorkflow.id);
      loadTests(selectedSubWorkflow.id);
    }
  }, [selectedSubWorkflow, loadVersions, loadPerformance, loadTests]);

  const handleCreateSubWorkflow = async () => {
    try {
      await subWorkflowService.createSubWorkflow({
        name: formData.name,
        description: formData.description,
        version: '1.0.0',
        parentWorkflowId: workflowId,
        nodes: [],
        edges: [],
        inputs: formData.inputs,
        outputs: formData.outputs,
        errorHandling: {
          strategy: formData.errorStrategy,
          notifyOnError: true,
          continueOnError: false
        },
        settings: {
          timeout: formData.timeout,
          isolationLevel: formData.isolationLevel
        },
        metadata: {
          tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
          category: formData.category
        },
        isPublished: false,
        isTemplate: false,
        createdBy: authService.getCurrentUser()
      });

      setShowCreateModal(false);
      setFormData(DEFAULT_FORM_DATA);
      loadSubWorkflows();
    } catch (error) {
      logger.error('Failed to create sub-workflow:', error);
    }
  };

  const handleExecuteSubWorkflow = async (subWorkflow: SubWorkflow) => {
    const inputs = {};
    const execution = await subWorkflowService.executeSubWorkflow(
      subWorkflow.id,
      inputs,
      {
        variables: [],
        environment: 'default',
        user: authService.getCurrentUser()
      }
    );

    const allExecutions = await subWorkflowService.getExecution(execution.id);
    if (allExecutions) {
      setExecutions(prev => [...prev, allExecutions]);
    }
  };

  const handleRunTest = async (test: SubWorkflowTest) => {
    const result = await subWorkflowService.runTest(test.id);
    setTestResults(prev => new Map(prev).set(test.id, result));
  };

  const handlePublish = async (subWorkflow: SubWorkflow) => {
    await subWorkflowService.publishToLibrary(subWorkflow.id, 'default');
    loadSubWorkflows();
  };

  const toggleWorkflowExpanded = (id: string) => {
    setExpandedWorkflows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const updateFormData = (data: Partial<SubWorkflowFormData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  };

  const filteredSubWorkflows = subWorkflows.filter(sw => {
    if (searchTerm && !sw.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !sw.description?.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    if (filterCategory !== 'all' && sw.metadata.category !== filterCategory) {
      return false;
    }
    return true;
  });

  return {
    // State
    activeTab,
    subWorkflows,
    filteredSubWorkflows,
    executions,
    selectedSubWorkflow,
    versions,
    performance,
    tests,
    searchTerm,
    filterCategory,
    showCreateModal,
    showTestModal,
    testResults,
    expandedWorkflows,
    formData,
    currentUser: authService.getCurrentUser(),

    // Setters
    setActiveTab,
    setSelectedSubWorkflow,
    setSearchTerm,
    setFilterCategory,
    setShowCreateModal,
    setShowTestModal,
    updateFormData,

    // Actions
    handleCreateSubWorkflow,
    handleExecuteSubWorkflow,
    handleRunTest,
    handlePublish,
    toggleWorkflowExpanded,
    loadSubWorkflows
  };
}
