import { ArchitectMode, createArchitectMode, ArchitectProposal } from '../src/agent/architect-mode.js';
import { CodeBuddyClient } from '../src/codebuddy/client.js';

// Mock CodeBuddyClient
jest.mock('../src/codebuddy/client.js');

describe('ArchitectMode', () => {
  let architectMode: ArchitectMode;
  const mockApiKey = 'test-api-key';
  
  // Mock implementations
  const mockChat = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock client behavior
    (CodeBuddyClient as unknown as jest.Mock).mockImplementation(() => ({
      chat: mockChat
    }));

    architectMode = createArchitectMode(mockApiKey);
  });

  describe('analyze', () => {
    const validProposal: ArchitectProposal = {
      summary: 'Test proposal',
      steps: [
        {
          order: 1,
          description: 'Create file',
          type: 'create',
          target: 'test.ts',
          details: 'content'
        }
      ],
      files: ['test.ts'],
      risks: [],
      estimatedChanges: 10
    };

    it('should parse valid JSON proposal from architect', async () => {
      mockChat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify(validProposal)
          }
        }]
      });

      const result = await architectMode.analyze('Create a test file');
      
      expect(result).toEqual(validProposal);
      expect(mockChat).toHaveBeenCalledTimes(1);
    });

    it('should extract JSON from markdown code block', async () => {
      const jsonContent = JSON.stringify(validProposal);
      const content = `Here is the plan:\n\`\`\`json\n${jsonContent}\n\`\`\``;

      mockChat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: content
          }
        }]
      });

      const result = await architectMode.analyze('Create a test file');
      expect(result).toEqual(validProposal);
    });

    it('should throw error if response is not valid JSON', async () => {
      mockChat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'I cannot do that.'
          }
        }]
      });

      await expect(architectMode.analyze('Invalid request'))
        .rejects.toThrow('Architect did not return valid JSON proposal');
    });

    it('should throw error if proposal has no steps', async () => {
      const invalidProposal = { ...validProposal, steps: [] };
      mockChat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify(invalidProposal)
          }
        }]
      });

      await expect(architectMode.analyze('Bad proposal'))
        .rejects.toThrow('Architect proposal has no steps');
    });

    it('should truncate steps if exceeding maxSteps', async () => {
      const longProposal = { ...validProposal, steps: Array(25).fill(validProposal.steps[0]) };
      
      mockChat.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify(longProposal)
          }
        }]
      });

      const limitedMode = createArchitectMode(mockApiKey, undefined, { maxSteps: 5 });
      const result = await limitedMode.analyze('Big request');

      expect(result.steps.length).toBe(5);
      expect(result.summary).toContain('truncated');
    });
  });

  describe('implement', () => {
    const proposal: ArchitectProposal = {
      summary: 'Test',
      steps: [
        { order: 1, description: 'Step 1', type: 'create' },
        { order: 2, description: 'Step 2', type: 'edit' }
      ],
      files: [],
      risks: [],
      estimatedChanges: 0
    };

    it('should execute all steps', async () => {
      mockChat.mockResolvedValue({
        choices: [{ message: { content: 'Done' } }]
      });

      const result = await architectMode.implement(proposal);

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2);
      expect(mockChat).toHaveBeenCalledTimes(2);
    });

    it('should emit events for each step', async () => {
      const stepListener = jest.fn();
      architectMode.on('editor:step', stepListener);
      
      mockChat.mockResolvedValue({
        choices: [{ message: { content: 'Done' } }]
      });

      await architectMode.implement(proposal);

      expect(stepListener).toHaveBeenCalledTimes(2);
    });

    it('should stop implementation if cancelled', async () => {
      mockChat.mockImplementation(async () => {
        architectMode.cancel(); // Cancel during first step
        return { choices: [{ message: { content: 'Done' } }] };
      });

      const result = await architectMode.implement(proposal);

      expect(result.results.length).toBe(1); // Only first step completed (or attempted)
    });

    it('should throw error if no proposal provided', async () => {
      await expect(architectMode.implement())
        .rejects.toThrow('No proposal to implement');
    });
  });

  describe('analyzeAndImplement', () => {
    const proposal: ArchitectProposal = {
        summary: 'Test',
        steps: [{ order: 1, description: 'Step 1', type: 'create' }],
        files: [],
        risks: [],
        estimatedChanges: 0
    };

    it('should run full flow', async () => {
      // First call for analyze
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(proposal) } }]
      });
      // Second call for implement
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { content: 'Done' } }]
      });

      const result = await architectMode.analyzeAndImplement('Do it');

      expect(result.proposal).toEqual(proposal);
      expect(result.results.length).toBe(1);
    });

    it('should respect manual approval', async () => {
      mockChat.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(proposal) } }]
      });

      const onApproval = jest.fn().mockResolvedValue(false);

      await expect(architectMode.analyzeAndImplement('Do it', undefined, undefined, onApproval))
        .rejects.toThrow('Implementation not approved');
      
      expect(onApproval).toHaveBeenCalled();
      // implement should not be called (so mockChat only called once)
      expect(mockChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('formatProposal', () => {
    it('should format proposal as string', () => {
      const proposal: ArchitectProposal = {
        summary: 'Test Summary',
        steps: [
          { order: 1, description: 'Create file', type: 'create', target: 'test.ts' }
        ],
        files: ['test.ts'],
        risks: ['Risk 1'],
        estimatedChanges: 10
      };

      const formatted = architectMode.formatProposal(proposal);

      expect(formatted).toContain('Test Summary');
      expect(formatted).toContain('test.ts');
      expect(formatted).toContain('Risk 1');
      expect(formatted).toContain('10 lines');
    });
  });
});