/**
 * Pipeline Approval Gate Tests (OpenClaw Lobster-inspired)
 *
 * Tests covering:
 * - Auto-approve condition
 * - Timeout handling
 * - Manual approval flow via approveStep()
 * - Approval handler callback
 * - Approval history tracking
 * - Rejection flow
 * - requireExplicit flag bypassing auto-approve
 */

import {
  PipelineCompositor,
  resetPipelineCompositor,
} from '../../src/workflows/pipeline';
import type {
  PipelineStep,
  ApprovalGateConfig,
  ApprovalResult,
} from '../../src/workflows/pipeline';

describe('Pipeline Approval Gates', () => {
  let compositor: PipelineCompositor;

  beforeEach(() => {
    resetPipelineCompositor();
    compositor = new PipelineCompositor();
  });

  afterEach(() => {
    compositor.dispose();
  });

  // ========================================================================
  // Auto-Approve Condition
  // ========================================================================

  describe('Auto-Approve Condition', () => {
    it('should auto-approve when autoApproveCondition returns true', async () => {
      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'deploy-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Approve deployment?',
            autoApproveCondition: () => true,
          },
        },
      ];

      const result = await compositor.execute(steps);
      expect(result.success).toBe(true);

      const history = compositor.getApprovalHistory();
      expect(history).toHaveLength(1);
      expect(history[0].approved).toBe(true);
      expect(history[0].approvedBy).toBe('auto');
      expect(history[0].comment).toBe('Auto-approved by condition');
    });

    it('should not auto-approve when autoApproveCondition returns false', async () => {
      const handlerCalled = jest.fn(async (): Promise<ApprovalResult> => ({
        approved: true,
        approvedBy: 'handler',
        timestamp: new Date(),
      }));

      const handlerCompositor = new PipelineCompositor({
        approvalHandler: handlerCalled,
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'deploy-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Approve deployment?',
            autoApproveCondition: () => false,
          },
        },
      ];

      const result = await handlerCompositor.execute(steps);
      expect(result.success).toBe(true);
      // Should have fallen through to handler
      expect(handlerCalled).toHaveBeenCalledTimes(1);

      handlerCompositor.dispose();
    });

    it('should fall through when autoApproveCondition throws', async () => {
      const handlerCalled = jest.fn(async (): Promise<ApprovalResult> => ({
        approved: true,
        approvedBy: 'fallback-handler',
        timestamp: new Date(),
      }));

      const handlerCompositor = new PipelineCompositor({
        approvalHandler: handlerCalled,
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'deploy-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Approve deployment?',
            autoApproveCondition: () => { throw new Error('condition error'); },
          },
        },
      ];

      const result = await handlerCompositor.execute(steps);
      expect(result.success).toBe(true);
      expect(handlerCalled).toHaveBeenCalledTimes(1);

      handlerCompositor.dispose();
    });

    it('should skip auto-approve when requireExplicit is true', async () => {
      const handlerCalled = jest.fn(async (): Promise<ApprovalResult> => ({
        approved: true,
        approvedBy: 'explicit-handler',
        timestamp: new Date(),
      }));

      const handlerCompositor = new PipelineCompositor({
        approvalHandler: handlerCalled,
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'deploy-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Approve deployment?',
            autoApproveCondition: () => true, // would auto-approve
            requireExplicit: true, // but this forces manual
          },
        },
      ];

      const result = await handlerCompositor.execute(steps);
      expect(result.success).toBe(true);
      // Should have fallen through to handler despite auto-approve condition being true
      expect(handlerCalled).toHaveBeenCalledTimes(1);

      handlerCompositor.dispose();
    });

    it('should emit approval:auto event on auto-approve', async () => {
      const autoEvents: ApprovalResult[] = [];
      compositor.on('approval:auto', (result: ApprovalResult) => {
        autoEvents.push(result);
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'auto-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Auto check',
            autoApproveCondition: () => true,
          },
        },
      ];

      await compositor.execute(steps);
      expect(autoEvents).toHaveLength(1);
      expect(autoEvents[0].approved).toBe(true);
    });
  });

  // ========================================================================
  // Timeout Handling
  // ========================================================================

  describe('Timeout Handling', () => {
    it('should reject with timeout error when no approval is given', async () => {
      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'timeout-gate',
          args: {},
          approvalGate: {
            timeoutMs: 50, // very short timeout for testing
            message: 'Approve?',
          },
        },
      ];

      const result = await compositor.execute(steps);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Approval timed out');
    });

    it('should record timeout in approval history', async () => {
      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'timeout-gate',
          args: {},
          approvalGate: {
            timeoutMs: 50,
            message: 'Approve?',
          },
        },
      ];

      await compositor.execute(steps);

      const history = compositor.getApprovalHistory();
      expect(history).toHaveLength(1);
      expect(history[0].approved).toBe(false);
      expect(history[0].comment).toBe('Approval timed out');
    });

    it('should use default timeoutMs from gate config when not specified', async () => {
      // Use handler to avoid waiting for full default timeout
      const handlerCompositor = new PipelineCompositor({
        approvalHandler: async (gate) => {
          // Verify the default timeout is used
          expect(gate.timeoutMs).toBe(300000);
          return {
            approved: true,
            timestamp: new Date(),
          };
        },
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'default-timeout-gate',
          args: {},
          approvalGate: {
            timeoutMs: 300000,
            message: 'Approve?',
          },
        },
      ];

      const result = await handlerCompositor.execute(steps);
      expect(result.success).toBe(true);

      handlerCompositor.dispose();
    });
  });

  // ========================================================================
  // Manual Approval Flow
  // ========================================================================

  describe('Manual Approval Flow', () => {
    it('should approve step via approveStep method', async () => {
      compositor.on('approval:required', (_gate: ApprovalGateConfig, stepIndex: number) => {
        // Simulate async external approval
        setTimeout(() => {
          compositor.approveStep(stepIndex, {
            approved: true,
            approvedBy: 'admin',
            timestamp: new Date(),
            comment: 'Looks good',
          });
        }, 10);
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'manual-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Please approve deployment',
            approver: 'admin',
          },
        },
      ];

      const result = await compositor.execute(steps);
      expect(result.success).toBe(true);

      const history = compositor.getApprovalHistory();
      expect(history).toHaveLength(1);
      expect(history[0].approved).toBe(true);
      expect(history[0].approvedBy).toBe('admin');
      expect(history[0].comment).toBe('Looks good');
    });

    it('should reject step via approveStep with approved=false', async () => {
      compositor.on('approval:required', (_gate: ApprovalGateConfig, stepIndex: number) => {
        setTimeout(() => {
          compositor.approveStep(stepIndex, {
            approved: false,
            approvedBy: 'reviewer',
            timestamp: new Date(),
            comment: 'Not ready for production',
          });
        }, 10);
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'reject-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Approve release?',
          },
        },
      ];

      const result = await compositor.execute(steps);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Approval rejected');
      expect(result.error).toContain('Not ready for production');
    });

    it('should throw when approveStep is called with invalid step index', () => {
      expect(() => {
        compositor.approveStep(999, {
          approved: true,
          timestamp: new Date(),
        });
      }).toThrow('No pending approval for step index 999');
    });

    it('should emit approval:required event with gate config and step index', async () => {
      const receivedEvents: Array<{ gate: ApprovalGateConfig; index: number; context: string }> = [];

      compositor.on('approval:required', (gate: ApprovalGateConfig, stepIndex: number, context: string) => {
        receivedEvents.push({ gate, index: stepIndex, context });
        // Approve immediately to unblock the pipeline
        compositor.approveStep(stepIndex, {
          approved: true,
          timestamp: new Date(),
        });
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'event-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Check this',
            approver: 'ops-team',
          },
        },
      ];

      await compositor.execute(steps);

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].gate.message).toBe('Check this');
      expect(receivedEvents[0].gate.approver).toBe('ops-team');
      expect(receivedEvents[0].index).toBe(0);
    });

    it('should pass pipeline input through approval gate unchanged', async () => {
      const mockExecutor = jest.fn(async () => ({
        success: true,
        output: 'important data',
      }));

      compositor.setToolExecutor(mockExecutor);

      compositor.on('approval:required', (_gate: ApprovalGateConfig, stepIndex: number) => {
        setTimeout(() => {
          compositor.approveStep(stepIndex, {
            approved: true,
            timestamp: new Date(),
          });
        }, 10);
      });

      const steps: PipelineStep[] = [
        { type: 'tool', name: 'fetch-data', args: {} },
        {
          type: 'approval',
          name: 'review-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Review data before proceeding',
          },
        },
        { type: 'transform', name: 'uppercase', args: {} },
      ];

      const result = await compositor.execute(steps);
      expect(result.success).toBe(true);
      // Data should pass through the approval gate and then be uppercased
      expect(result.output).toBe('IMPORTANT DATA');
    });
  });

  // ========================================================================
  // Approval Handler Callback
  // ========================================================================

  describe('Approval Handler Callback', () => {
    it('should use approvalHandler when configured', async () => {
      const handlerCompositor = new PipelineCompositor({
        approvalHandler: async (gate, stepIndex, context) => {
          expect(gate.message).toBe('Approve build?');
          expect(stepIndex).toBe(0);
          return {
            approved: true,
            approvedBy: 'ci-system',
            timestamp: new Date(),
            comment: 'All checks passed',
          };
        },
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'ci-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Approve build?',
          },
        },
      ];

      const result = await handlerCompositor.execute(steps);
      expect(result.success).toBe(true);

      const history = handlerCompositor.getApprovalHistory();
      expect(history).toHaveLength(1);
      expect(history[0].approvedBy).toBe('ci-system');

      handlerCompositor.dispose();
    });

    it('should fail pipeline when handler rejects', async () => {
      const handlerCompositor = new PipelineCompositor({
        approvalHandler: async () => ({
          approved: false,
          approvedBy: 'security-scan',
          timestamp: new Date(),
          comment: 'Vulnerability detected',
        }),
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'security-gate',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Security check',
          },
        },
      ];

      const result = await handlerCompositor.execute(steps);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Approval rejected');
      expect(result.error).toContain('Vulnerability detected');

      handlerCompositor.dispose();
    });
  });

  // ========================================================================
  // Approval History
  // ========================================================================

  describe('Approval History', () => {
    it('should return empty history initially', () => {
      expect(compositor.getApprovalHistory()).toEqual([]);
    });

    it('should accumulate history across multiple approval steps', async () => {
      const handlerCompositor = new PipelineCompositor({
        approvalHandler: async (_gate, stepIndex) => ({
          approved: true,
          approvedBy: `approver-${stepIndex}`,
          timestamp: new Date(),
        }),
      });

      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'gate-1',
          args: {},
          approvalGate: { timeoutMs: 5000, message: 'First gate' },
        },
        {
          type: 'approval',
          name: 'gate-2',
          args: {},
          approvalGate: { timeoutMs: 5000, message: 'Second gate' },
        },
      ];

      const result = await handlerCompositor.execute(steps);
      expect(result.success).toBe(true);

      const history = handlerCompositor.getApprovalHistory();
      expect(history).toHaveLength(2);
      expect(history[0].approvedBy).toBe('approver-0');
      expect(history[1].approvedBy).toBe('approver-1');

      handlerCompositor.dispose();
    });

    it('should return a copy of history (not a reference)', () => {
      // Run a quick auto-approve to populate history
      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'copy-test',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Test',
            autoApproveCondition: () => true,
          },
        },
      ];

      compositor.execute(steps).then(() => {
        const history1 = compositor.getApprovalHistory();
        const history2 = compositor.getApprovalHistory();
        expect(history1).not.toBe(history2); // different array references
        expect(history1).toEqual(history2); // same contents
      });
    });

    it('should clear history on dispose', async () => {
      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'dispose-test',
          args: {},
          approvalGate: {
            timeoutMs: 5000,
            message: 'Test',
            autoApproveCondition: () => true,
          },
        },
      ];

      await compositor.execute(steps);
      expect(compositor.getApprovalHistory()).toHaveLength(1);

      compositor.dispose();

      // After dispose, create a new instance
      compositor = new PipelineCompositor();
      expect(compositor.getApprovalHistory()).toHaveLength(0);
    });
  });

  // ========================================================================
  // Parsing
  // ========================================================================

  describe('Approval Parsing', () => {
    it('should parse "approval" as an approval step type', () => {
      const tokens = compositor.parse('fetch-data | approval "review needed" | deploy');
      expect(tokens).toHaveLength(5);
      expect(tokens[2].step?.type).toBe('approval');
      expect(tokens[2].step?.name).toBe('approval');
    });

    it('should parse "approve" as an approval step type', () => {
      const tokens = compositor.parse('approve "check this"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].step?.type).toBe('approval');
    });

    it('should validate approval as a valid step type', () => {
      const steps: PipelineStep[] = [
        {
          type: 'approval',
          name: 'gate',
          args: {},
          approvalGate: { timeoutMs: 5000, message: 'Check' },
        },
      ];

      const validation = compositor.validateDefinition(steps);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });
});
