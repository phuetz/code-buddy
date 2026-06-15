// @ts-nocheck
/**
 * useWorkflowExecution Hook
 * Handles workflow execution logic
 */

import { useCallback } from 'react';
import { logger } from '../../service-mocks';
import { useWorkflowStore } from '../../store';
import { workflowAPI, WorkflowExecutionRequest } from '../../service-mocks';
import { notificationService } from '../../service-mocks';
import { WorkflowNode, WorkflowEdge } from '../../type-mocks';

/**
 * Returns true if `nodeId` has a breakpoint set in the store. Reads via
 * `getState()` to avoid coupling the executor to React subscriptions.
 */
export function isNodeBreakpointed(nodeId: string): boolean {
  const bps = useWorkflowStore.getState().breakpoints as Record<string, boolean> | undefined;
  return bps?.[nodeId] === true;
}

/**
 * Returns a promise that resolves on the next `workflow:debug:continue` or
 * `workflow:debug:step` window event. Used by the executor to pause at a
 * breakpoint until the user clicks Continue/Step in the debug panel.
 */
export function waitForDebugResume(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const onResume = () => {
      window.removeEventListener('workflow:debug:continue', onResume);
      window.removeEventListener('workflow:debug:step', onResume);
      resolve();
    };
    window.addEventListener('workflow:debug:continue', onResume, { once: true });
    window.addEventListener('workflow:debug:step', onResume, { once: true });
  });
}

interface UseWorkflowExecutionParams {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function useWorkflowExecution({ nodes, edges }: UseWorkflowExecutionParams) {
  const store = useWorkflowStore();
  const {
    isExecuting,
    setIsExecuting,
    currentEnvironment,
    globalVariables,
    validateWorkflow,
    clearExecution,
    clearNodeStatuses,
    setCurrentExecutingNode,
    setNodeStatus,
    setNodeExecutionData,
    addLog,
    usePinnedData,
    pinnedData,
  } = store;

  // Type-safe wrappers for execution result and error methods
  const setExecutionResult = store.setExecutionResult as unknown as (result: { success: boolean; data: unknown }) => void;
  const setExecutionError = store.setExecutionError as unknown as (error: { message: string; details: unknown }) => void;
  const addExecutionToHistory = store.addExecutionToHistory as unknown as (entry: {
    id: string;
    timestamp: Date;
    status: string;
    duration: number;
    nodes: number;
    environment: string;
  }) => void;

  const executeWorkflow = useCallback(async () => {
    if (isExecuting) {
      logger.info('Workflow already executing');
      return;
    }

    // Validate workflow before execution
    const validationResult = validateWorkflow();
    if (!validationResult.isValid) {
      setExecutionError({
        message: 'Workflow validation failed',
        details: validationResult.errors
      });
      addLog({
        level: 'error',
        message: 'Workflow validation failed',
        data: validationResult.errors
      });
      notificationService.error(
        'Workflow Validation Failed',
        validationResult.errors.join(', ')
      );
      return;
    }

    try {
      setIsExecuting(true);
      clearExecution();
      clearNodeStatuses();
      if (usePinnedData && pinnedData && Object.keys(pinnedData).length > 0) {
        const pinnedNodeCount = nodes.filter(n => pinnedData[n.id] !== undefined).length;
        addLog({
          level: 'info',
          message: `Starting workflow execution in Pin Data mode (${pinnedNodeCount} node(s) using pinned data)...`
        });
      } else {
        addLog({
          level: 'info',
          message: 'Starting workflow execution...'
        });
      }

      // Prepare workflow data for API call
      const workflowData: WorkflowExecutionRequest = {
        nodes: nodes as unknown as Record<string, unknown>[],
        edges: edges as unknown as Record<string, unknown>[],
        settings: {
          environment: currentEnvironment,
          variables: (globalVariables[currentEnvironment] || {}) as Record<string, unknown>
        }
      };

      // Generate a unique workflow ID if not already set
      const workflowId = `workflow_${Date.now()}`;

      try {
        // Start the workflow execution
        const executionResult = await workflowAPI.executeWorkflow(workflowId, workflowData);

        // Set up real-time monitoring
        await workflowAPI.startExecutionMonitoring(
          executionResult.executionId,
          // On node update
          (nodeUpdate) => {
            // Skip API-monitored updates for pinned nodes — they were already resolved
            if (usePinnedData && pinnedData && pinnedData[nodeUpdate.nodeId] !== undefined) {
              return;
            }

            setCurrentExecutingNode(nodeUpdate.nodeId);
            setNodeStatus(nodeUpdate.nodeId, nodeUpdate.status);

            if (nodeUpdate.output) {
              setNodeExecutionData(nodeUpdate.nodeId, {
                output: nodeUpdate.output
              });
            }

            if (nodeUpdate.error) {
              setNodeExecutionData(nodeUpdate.nodeId, {
                error: nodeUpdate.error
              });
            }
          },
          // On execution complete
          (finalResult) => {
            setExecutionResult({
              success: finalResult.success,
              data: finalResult.data
            });

            addExecutionToHistory({
              id: finalResult.executionId,
              timestamp: new Date(),
              status: finalResult.success ? 'success' : 'error',
              duration: finalResult.totalDuration,
              nodes: nodes.length,
              environment: currentEnvironment
            });

            logger.info('Workflow execution completed', {
              executionId: finalResult.executionId,
              success: finalResult.success
            });
          },
          // On execution error
          (error) => {
            setExecutionError({
              message: 'Workflow execution failed',
              details: error
            });

            addLog({
              level: 'error',
              message: 'Workflow execution failed',
              data: error
            });
          }
        );

      } catch (apiError) {
        // Fallback to local simulation if API is not available
        logger.warn('API not available, falling back to local simulation', apiError);

        await simulateLocalExecution(
          nodes,
          currentEnvironment,
          setCurrentExecutingNode,
          setNodeStatus,
          setNodeExecutionData,
          setExecutionResult,
          addExecutionToHistory,
          usePinnedData ? (pinnedData as Record<string, unknown>) : undefined
        );
      }

      addLog({
        level: 'success',
        message: 'Workflow executed successfully'
      });

    } catch (error) {
      setExecutionError({
        message: 'Workflow execution failed',
        details: error
      });
      addLog({
        level: 'error',
        message: 'Workflow execution failed',
        data: error
      });
    } finally {
      setIsExecuting(false);
      setCurrentExecutingNode(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isExecuting, nodes, edges, currentEnvironment, globalVariables,
    validateWorkflow, setIsExecuting, clearExecution, clearNodeStatuses,
    setCurrentExecutingNode, setNodeStatus, setNodeExecutionData,
    setExecutionResult, setExecutionError, addExecutionToHistory, addLog,
    usePinnedData, pinnedData,
    store
  ]);

  const executeNode = useCallback(async (nodeId: string) => {
    if (isExecuting) {
      logger.info('Workflow already executing');
      return;
    }

    const node = nodes.find(n => n.id === nodeId);
    if (!node) {
      notificationService.error('Node not found', `Node ${nodeId} not found`);
      return;
    }

    try {
      setIsExecuting(true);
      setCurrentExecutingNode(nodeId);
      setNodeStatus(nodeId, 'running');

      const workflowData: WorkflowExecutionRequest = {
        nodes: nodes as unknown as Record<string, unknown>[],
        edges: edges as unknown as Record<string, unknown>[],
        settings: {
          environment: currentEnvironment,
          variables: (globalVariables[currentEnvironment] || {}) as Record<string, unknown>
        }
      };

      const workflowId = `workflow_${Date.now()}`;

      try {
        // We use the same workflow data to provide context for the node execution
        const result = await workflowAPI.executeNode(workflowId, nodeId, workflowData);
        
        if (result.success) {
          setNodeStatus(nodeId, 'success');
          setNodeExecutionData(nodeId, {
            output: result.data || { message: `Node ${node.data?.label || nodeId} executed successfully` }
          });
          notificationService.success('Node Executed', `Node ${node.data?.label || nodeId} executed successfully`);
        } else {
          setNodeStatus(nodeId, 'error');
          setNodeExecutionData(nodeId, {
            error: result.error || new Error('Node execution failed')
          });
          notificationService.error('Execution Failed', `Node ${node.data?.label || nodeId} execution failed`);
        }
      } catch (apiError) {
        // Fallback to local simulation for single node
        logger.warn('API not available, falling back to local simulation', apiError);
        
        const nodePinnedData = pinnedData?.[nodeId];
        if (usePinnedData && nodePinnedData !== undefined) {
          await new Promise(resolve => setTimeout(resolve, 100));
          setNodeStatus(nodeId, 'success');
          setNodeExecutionData(nodeId, {
            output: nodePinnedData,
            _pinned: true,
          });
        } else {
          await new Promise(resolve => setTimeout(resolve, 500));
          setNodeStatus(nodeId, 'success');
          setNodeExecutionData(nodeId, {
            output: { message: `Node ${node.data?.label || nodeId} executed locally` }
          });
        }
        notificationService.success('Node Executed', `Node ${node.data?.label || nodeId} executed locally`);
      }
    } catch (error) {
      setNodeStatus(nodeId, 'error');
      setNodeExecutionData(nodeId, {
        error: error
      });
      notificationService.error('Execution Failed', `Failed to execute node ${nodeId}`);
    } finally {
      setIsExecuting(false);
      setCurrentExecutingNode(null);
    }
  }, [
    isExecuting, nodes, edges, currentEnvironment, globalVariables,
    setIsExecuting, setCurrentExecutingNode, setNodeStatus, setNodeExecutionData,
    usePinnedData, pinnedData
  ]);

  return { executeWorkflow, executeNode, isExecuting };
}

// Local simulation fallback
async function simulateLocalExecution(
  nodes: WorkflowNode[],
  currentEnvironment: string,
  setCurrentExecutingNode: (nodeId: string | null) => void,
  setNodeStatus: (nodeId: string, status: string) => void,
  setNodeExecutionData: (nodeId: string, data: Record<string, unknown>) => void,
  setExecutionResult: (result: { success: boolean; data: unknown }) => void,
  addExecutionToHistory: (entry: {
    id: string;
    timestamp: Date;
    status: string;
    duration: number;
    nodes: number;
    environment: string;
  }) => void,
  pinnedDataMap?: Record<string, unknown>
) {
  for (const node of nodes) {
    const nodePinnedData = pinnedDataMap?.[node.id];

    // If pinned data exists for this node, use it instead of real execution
    if (nodePinnedData !== undefined) {
      setCurrentExecutingNode(node.id);
      setNodeStatus(node.id, 'running');

      // Brief delay to show the pinned data transition visually
      await new Promise(resolve => setTimeout(resolve, 100));

      setNodeStatus(node.id, 'success');
      setNodeExecutionData(node.id, {
        output: nodePinnedData,
        _pinned: true,
      });
      setCurrentExecutingNode(null);
      continue;
    }

    // Honor user-set breakpoints: pause this node and wait for the user to
    // click Continue (or Step) in the debug panel before proceeding.
    if (isNodeBreakpointed(node.id)) {
      setNodeStatus(node.id, 'paused');
      setCurrentExecutingNode(node.id);
      await waitForDebugResume();
    }

    setCurrentExecutingNode(node.id);
    setNodeStatus(node.id, 'running');

    // Reduced timeout for better UX
    await new Promise(resolve => setTimeout(resolve, 500));

    setNodeStatus(node.id, 'success');
    setNodeExecutionData(node.id, {
      output: { message: `Node ${node.data.label || node.id} executed locally` }
    });
  }

  const mode = pinnedDataMap ? ' (pin data mode)' : ' (API unavailable)';
  setExecutionResult({
    success: true,
    data: { message: `Workflow executed locally${mode}` }
  });

  addExecutionToHistory({
    id: Date.now().toString(),
    timestamp: new Date(),
    status: 'success',
    duration: nodes.length * 500,
    nodes: nodes.length,
    environment: currentEnvironment
  });
}
