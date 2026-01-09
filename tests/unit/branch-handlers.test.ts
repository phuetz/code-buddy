/**
 * Unit Tests for Branch Handlers
 *
 * Tests cover:
 * - handleFork - Create conversation branches
 * - handleBranches - List all branches
 * - handleCheckout - Switch to a branch
 * - handleMerge - Merge a branch
 * - Error handling for missing branches
 * - CommandHandlerResult structure
 */

import {
  handleFork,
  handleBranches,
  handleCheckout,
  handleMerge,
  CommandHandlerResult,
} from '../../src/commands/handlers/branch-handlers';
import {
  getBranchManager,
  resetBranchManager,
  ConversationBranch,
} from '../../src/persistence/conversation-branches';

// Mock the conversation-branches module
jest.mock('../../src/persistence/conversation-branches', () => {
  const mockBranchManager = {
    fork: jest.fn(),
    getAllBranches: jest.fn(),
    getCurrentBranchId: jest.fn(),
    checkout: jest.fn(),
    merge: jest.fn(),
  };

  return {
    getBranchManager: jest.fn(() => mockBranchManager),
    resetBranchManager: jest.fn(),
  };
});

describe('Branch Handlers', () => {
  let mockBranchManager: {
    fork: jest.Mock;
    getAllBranches: jest.Mock;
    getCurrentBranchId: jest.Mock;
    checkout: jest.Mock;
    merge: jest.Mock;
  };

  const sampleBranch: ConversationBranch = {
    id: 'branch_abc123',
    name: 'feature-branch',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ],
    createdAt: new Date('2025-01-15T10:00:00Z'),
    updatedAt: new Date('2025-01-15T11:00:00Z'),
  };

  const mainBranch: ConversationBranch = {
    id: 'main',
    name: 'Main conversation',
    messages: [
      { role: 'user', content: 'Start' },
    ],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-15T10:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBranchManager = (getBranchManager as jest.Mock)();
    mockBranchManager.fork.mockReturnValue(sampleBranch);
    mockBranchManager.getAllBranches.mockReturnValue([mainBranch, sampleBranch]);
    mockBranchManager.getCurrentBranchId.mockReturnValue('main');
    mockBranchManager.checkout.mockReturnValue(null);
    mockBranchManager.merge.mockReturnValue(false);
  });

  // ============================================
  // handleFork Tests
  // ============================================
  describe('handleFork', () => {
    test('should create branch with provided name', () => {
      const result = handleFork(['my-feature']);

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.content).toContain('Created branch: feature-branch');
      expect(result.entry?.content).toContain('ID: branch_abc123');
      expect(result.entry?.content).toContain('Messages: 2');
      expect(mockBranchManager.fork).toHaveBeenCalledWith('my-feature');
    });

    test('should create branch with multi-word name', () => {
      const result = handleFork(['my', 'awesome', 'feature']);

      expect(mockBranchManager.fork).toHaveBeenCalledWith('my awesome feature');
    });

    test('should generate timestamped name when no name provided', () => {
      const beforeTime = Date.now();
      const result = handleFork([]);
      const afterTime = Date.now();

      const callArgs = mockBranchManager.fork.mock.calls[0][0];
      expect(callArgs).toMatch(/^branch-\d+$/);

      // Extract timestamp and verify it's reasonable
      const timestamp = parseInt(callArgs.split('-')[1]);
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    test('should include timestamp in entry', () => {
      const result = handleFork(['test']);

      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });

    test('should show commands hint in output', () => {
      const result = handleFork(['test']);

      expect(result.entry?.content).toContain('/branches');
      expect(result.entry?.content).toContain('/checkout');
    });
  });

  // ============================================
  // handleBranches Tests
  // ============================================
  describe('handleBranches', () => {
    test('should list all branches', () => {
      const result = handleBranches();

      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.content).toContain('Conversation Branches');
    });

    test('should show branch names and ids', () => {
      const result = handleBranches();

      expect(result.entry?.content).toContain('Main conversation');
      expect(result.entry?.content).toContain('main');
      expect(result.entry?.content).toContain('feature-branch');
      expect(result.entry?.content).toContain('branch_abc123');
    });

    test('should show message counts', () => {
      const result = handleBranches();

      expect(result.entry?.content).toContain('Messages: 1');
      expect(result.entry?.content).toContain('Messages: 2');
    });

    test('should show created dates', () => {
      const result = handleBranches();

      expect(result.entry?.content).toContain('Created:');
    });

    test('should indicate current branch', () => {
      mockBranchManager.getCurrentBranchId.mockReturnValue('main');

      const result = handleBranches();

      // The current branch should have an arrow indicator
      expect(result.entry?.content).toMatch(/→.*Main conversation/);
    });

    test('should show commands help', () => {
      const result = handleBranches();

      expect(result.entry?.content).toContain('/fork <name>');
      expect(result.entry?.content).toContain('/checkout <id>');
      expect(result.entry?.content).toContain('/merge <id>');
    });

    test('should handle empty branches list', () => {
      mockBranchManager.getAllBranches.mockReturnValue([]);

      const result = handleBranches();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Conversation Branches');
    });
  });

  // ============================================
  // handleCheckout Tests
  // ============================================
  describe('handleCheckout', () => {
    test('should show usage when no branch id provided', () => {
      const result = handleCheckout([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Usage: /checkout <branch-id>');
      expect(result.entry?.content).toContain('/branches');
    });

    test('should checkout existing branch', () => {
      mockBranchManager.checkout.mockReturnValue(sampleBranch);

      const result = handleCheckout(['branch_abc123']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Switched to branch: feature-branch');
      expect(result.entry?.content).toContain('Loaded 2 messages');
      expect(mockBranchManager.checkout).toHaveBeenCalledWith('branch_abc123');
    });

    test('should show error for non-existent branch', () => {
      mockBranchManager.checkout.mockReturnValue(null);

      const result = handleCheckout(['nonexistent']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Branch not found: nonexistent');
    });

    test('should checkout main branch', () => {
      mockBranchManager.checkout.mockReturnValue(mainBranch);

      const result = handleCheckout(['main']);

      expect(result.entry?.content).toContain('Switched to branch: Main conversation');
      expect(result.entry?.content).toContain('Loaded 1 messages');
    });

    test('should use first argument as branch id', () => {
      mockBranchManager.checkout.mockReturnValue(sampleBranch);

      handleCheckout(['branch_abc123', 'extra', 'args']);

      expect(mockBranchManager.checkout).toHaveBeenCalledWith('branch_abc123');
    });
  });

  // ============================================
  // handleMerge Tests
  // ============================================
  describe('handleMerge', () => {
    test('should show usage when no branch id provided', () => {
      const result = handleMerge([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toBe('Usage: /merge <branch-id>');
    });

    test('should merge branch successfully', () => {
      mockBranchManager.merge.mockReturnValue(true);

      const result = handleMerge(['branch_abc123']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Merged branch: branch_abc123');
      expect(mockBranchManager.merge).toHaveBeenCalledWith('branch_abc123');
    });

    test('should show error when merge fails', () => {
      mockBranchManager.merge.mockReturnValue(false);

      const result = handleMerge(['invalid']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Merge failed');
      expect(result.entry?.content).toContain('Branch not found or same as current');
    });

    test('should use first argument as branch id', () => {
      mockBranchManager.merge.mockReturnValue(true);

      handleMerge(['feature', 'extra']);

      expect(mockBranchManager.merge).toHaveBeenCalledWith('feature');
    });

    test('should handle merge of current branch', () => {
      mockBranchManager.merge.mockReturnValue(false);

      const result = handleMerge(['main']);

      expect(result.entry?.content).toContain('same as current');
    });
  });

  // ============================================
  // CommandHandlerResult Interface
  // ============================================
  describe('CommandHandlerResult Interface', () => {
    test('handleFork should return correct structure', () => {
      const result = handleFork(['test']);

      expect(typeof result.handled).toBe('boolean');
      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
      expect(typeof result.entry?.content).toBe('string');
      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });

    test('handleBranches should return correct structure', () => {
      const result = handleBranches();

      expect(typeof result.handled).toBe('boolean');
      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
    });

    test('handleCheckout should return correct structure', () => {
      mockBranchManager.checkout.mockReturnValue(sampleBranch);

      const result = handleCheckout(['test']);

      expect(typeof result.handled).toBe('boolean');
      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
    });

    test('handleMerge should return correct structure', () => {
      mockBranchManager.merge.mockReturnValue(true);

      const result = handleMerge(['test']);

      expect(typeof result.handled).toBe('boolean');
      expect(result.handled).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry?.type).toBe('assistant');
    });

    test('passToAI should be undefined for branch handlers', () => {
      const forkResult = handleFork(['test']);
      const branchesResult = handleBranches();
      const checkoutResult = handleCheckout(['test']);
      const mergeResult = handleMerge(['test']);

      expect(forkResult.passToAI).toBeUndefined();
      expect(branchesResult.passToAI).toBeUndefined();
      expect(checkoutResult.passToAI).toBeUndefined();
      expect(mergeResult.passToAI).toBeUndefined();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    test('should handle branch with empty name gracefully', () => {
      const result = handleFork(['']);

      // Empty string joined becomes empty, so it uses timestamp
      expect(mockBranchManager.fork).toHaveBeenCalled();
    });

    test('should handle branch with special characters in name', () => {
      const result = handleFork(['feature/test-123']);

      expect(mockBranchManager.fork).toHaveBeenCalledWith('feature/test-123');
    });

    test('should handle branch with spaces in name', () => {
      const result = handleFork(['my', 'branch', 'with', 'spaces']);

      expect(mockBranchManager.fork).toHaveBeenCalledWith('my branch with spaces');
    });

    test('should handle many branches', () => {
      const manyBranches: ConversationBranch[] = Array.from({ length: 100 }, (_, i) => ({
        id: `branch_${i}`,
        name: `Branch ${i}`,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      mockBranchManager.getAllBranches.mockReturnValue(manyBranches);

      const result = handleBranches();

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Branch 0');
      expect(result.entry?.content).toContain('Branch 99');
    });

    test('should handle branch with no messages', () => {
      const emptyBranch: ConversationBranch = {
        id: 'empty',
        name: 'Empty Branch',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockBranchManager.fork.mockReturnValue(emptyBranch);

      const result = handleFork(['empty']);

      expect(result.entry?.content).toContain('Messages: 0');
    });

    test('should handle checkout with exact branch id match', () => {
      mockBranchManager.checkout.mockReturnValue(sampleBranch);

      handleCheckout(['branch_abc123']);

      expect(mockBranchManager.checkout).toHaveBeenCalledWith('branch_abc123');
    });
  });

  // ============================================
  // Integration with getBranchManager
  // ============================================
  describe('Integration with getBranchManager', () => {
    test('handleFork should call getBranchManager', () => {
      handleFork(['test']);

      expect(getBranchManager).toHaveBeenCalled();
    });

    test('handleBranches should call getBranchManager', () => {
      handleBranches();

      expect(getBranchManager).toHaveBeenCalled();
    });

    test('handleCheckout should call getBranchManager', () => {
      handleCheckout(['test']);

      expect(getBranchManager).toHaveBeenCalled();
    });

    test('handleMerge should call getBranchManager', () => {
      handleMerge(['test']);

      expect(getBranchManager).toHaveBeenCalled();
    });
  });
});
