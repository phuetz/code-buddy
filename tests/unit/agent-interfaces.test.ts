/**
 * Agent Interfaces Tests
 *
 * Tests to verify that the agent interfaces are properly defined
 * and can be implemented.
 */

import { EventEmitter } from 'events';
import type {
  IAgent,
  IChatEntry,
  IStreamingChunk,
  IExtendedAgent,
  AgentModeType,
  ISpecializedAgent,
  ISpecializedAgentConfig,
  AgentCapabilityType,
  IAgentTask,
  IAgentResult,
  IAgentFactory,
  IAgentOptions,
} from '../../src/agent/interfaces/index.js';

describe('Agent Interfaces', () => {
  describe('IAgent', () => {
    it('should be implementable', async () => {
      // Create a mock implementation
      class MockAgent extends EventEmitter implements IAgent {
        private history: IChatEntry[] = [];

        async processUserMessage(message: string): Promise<IChatEntry[]> {
          const entry: IChatEntry = {
            type: 'user',
            content: message,
            timestamp: new Date(),
          };
          this.history.push(entry);

          const response: IChatEntry = {
            type: 'assistant',
            content: `Echo: ${message}`,
            timestamp: new Date(),
          };
          this.history.push(response);

          return [entry, response];
        }

        async *processUserMessageStream(
          message: string
        ): AsyncGenerator<IStreamingChunk, void, unknown> {
          yield { type: 'content', content: 'Hello ' };
          yield { type: 'content', content: 'World' };
          yield { type: 'done' };
        }

        getChatHistory(): IChatEntry[] {
          return [...this.history];
        }

        clearChat(): void {
          this.history = [];
        }

        dispose(): void {
          this.history = [];
          this.removeAllListeners();
        }
      }

      const agent = new MockAgent();

      // Test processUserMessage
      const entries = await agent.processUserMessage('test');
      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe('user');
      expect(entries[0].content).toBe('test');
      expect(entries[1].type).toBe('assistant');
      expect(entries[1].content).toBe('Echo: test');

      // Test getChatHistory
      const history = agent.getChatHistory();
      expect(history).toHaveLength(2);

      // Test clearChat
      agent.clearChat();
      expect(agent.getChatHistory()).toHaveLength(0);

      // Test streaming
      const chunks: IStreamingChunk[] = [];
      for await (const chunk of agent.processUserMessageStream('test')) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(3);
      expect(chunks[0].type).toBe('content');
      expect(chunks[0].content).toBe('Hello ');
      expect(chunks[2].type).toBe('done');

      // Test dispose
      agent.dispose();
      expect(agent.getChatHistory()).toHaveLength(0);
    });

    it('should support event emitting', () => {
      class MockAgent extends EventEmitter implements IAgent {
        async processUserMessage(_message: string): Promise<IChatEntry[]> {
          this.emit('message', 'test');
          return [];
        }

        async *processUserMessageStream(
          _message: string
        ): AsyncGenerator<IStreamingChunk, void, unknown> {
          yield { type: 'done' };
        }

        getChatHistory(): IChatEntry[] {
          return [];
        }

        clearChat(): void {}
        dispose(): void {}
      }

      const agent = new MockAgent();
      const handler = jest.fn();
      agent.on('message', handler);

      agent.processUserMessage('test');

      expect(handler).toHaveBeenCalledWith('test');
    });
  });

  describe('IExtendedAgent', () => {
    it('should be implementable with extended features', () => {
      class MockExtendedAgent extends EventEmitter implements IExtendedAgent {
        private mode: AgentModeType = 'code';
        private yoloMode = false;
        private cost = 0;
        private costLimit = 10;

        async processUserMessage(_message: string): Promise<IChatEntry[]> {
          return [];
        }

        async *processUserMessageStream(
          _message: string
        ): AsyncGenerator<IStreamingChunk, void, unknown> {
          yield { type: 'done' };
        }

        getChatHistory(): IChatEntry[] {
          return [];
        }

        clearChat(): void {}
        dispose(): void {}

        getMode(): AgentModeType {
          return this.mode;
        }

        setMode(mode: AgentModeType): void {
          this.mode = mode;
        }

        isYoloModeEnabled(): boolean {
          return this.yoloMode;
        }

        getSessionCost(): number {
          return this.cost;
        }

        getSessionCostLimit(): number {
          return this.costLimit;
        }

        setSessionCostLimit(limit: number): void {
          this.costLimit = limit;
        }

        isSessionCostLimitReached(): boolean {
          return this.cost >= this.costLimit;
        }

        abortCurrentOperation(): void {
          this.emit('aborted');
        }
      }

      const agent = new MockExtendedAgent();

      // Test mode
      expect(agent.getMode()).toBe('code');
      agent.setMode('architect');
      expect(agent.getMode()).toBe('architect');

      // Test YOLO mode
      expect(agent.isYoloModeEnabled()).toBe(false);

      // Test cost tracking
      expect(agent.getSessionCost()).toBe(0);
      expect(agent.getSessionCostLimit()).toBe(10);
      expect(agent.isSessionCostLimitReached()).toBe(false);

      agent.setSessionCostLimit(0);
      expect(agent.isSessionCostLimitReached()).toBe(true);

      // Test abort
      const abortHandler = jest.fn();
      agent.on('aborted', abortHandler);
      agent.abortCurrentOperation();
      expect(abortHandler).toHaveBeenCalled();
    });
  });

  describe('ISpecializedAgent', () => {
    it('should be implementable', async () => {
      const config: ISpecializedAgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test specialized agent',
        capabilities: ['pdf-extract', 'pdf-analyze'] as AgentCapabilityType[],
        fileExtensions: ['pdf'],
        maxFileSize: 10 * 1024 * 1024,
      };

      class MockSpecializedAgent extends EventEmitter implements ISpecializedAgent {
        private initialized = false;

        getConfig(): ISpecializedAgentConfig {
          return { ...config };
        }

        getId(): string {
          return config.id;
        }

        getName(): string {
          return config.name;
        }

        hasCapability(capability: AgentCapabilityType): boolean {
          return config.capabilities.includes(capability);
        }

        canHandleExtension(ext: string): boolean {
          const normalizedExt = ext.startsWith('.') ? ext.slice(1) : ext;
          return config.fileExtensions.includes(normalizedExt.toLowerCase());
        }

        async initialize(): Promise<void> {
          this.initialized = true;
        }

        isReady(): boolean {
          return this.initialized;
        }

        async execute(task: IAgentTask): Promise<IAgentResult> {
          if (!this.initialized) {
            return { success: false, error: 'Agent not initialized' };
          }
          return {
            success: true,
            output: `Executed action: ${task.action}`,
            duration: 100,
          };
        }

        getSupportedActions(): string[] {
          return ['extract', 'analyze'];
        }

        getActionHelp(action: string): string {
          return `Help for ${action}`;
        }

        async cleanup(): Promise<void> {
          this.initialized = false;
        }
      }

      const agent = new MockSpecializedAgent();

      // Test config
      expect(agent.getId()).toBe('test-agent');
      expect(agent.getName()).toBe('Test Agent');

      // Test capabilities
      expect(agent.hasCapability('pdf-extract')).toBe(true);
      expect(agent.hasCapability('excel-read')).toBe(false);

      // Test file extensions
      expect(agent.canHandleExtension('pdf')).toBe(true);
      expect(agent.canHandleExtension('.pdf')).toBe(true);
      expect(agent.canHandleExtension('xlsx')).toBe(false);

      // Test initialization
      expect(agent.isReady()).toBe(false);
      await agent.initialize();
      expect(agent.isReady()).toBe(true);

      // Test execution
      const result = await agent.execute({ action: 'extract' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('Executed action: extract');

      // Test actions
      expect(agent.getSupportedActions()).toContain('extract');
      expect(agent.getActionHelp('extract')).toBe('Help for extract');

      // Test cleanup
      await agent.cleanup();
      expect(agent.isReady()).toBe(false);
    });
  });

  describe('IAgentFactory', () => {
    it('should define factory interface', () => {
      // Mock factory implementation
      class MockAgentFactory implements IAgentFactory {
        create(_options?: IAgentOptions): IAgent {
          return {
            processUserMessage: jest.fn().mockResolvedValue([]),
            processUserMessageStream: jest.fn(),
            getChatHistory: jest.fn().mockReturnValue([]),
            clearChat: jest.fn(),
            dispose: jest.fn(),
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn(),
          } as unknown as IAgent;
        }

        createExtended(_options?: IAgentOptions): IExtendedAgent {
          const base = this.create(_options);
          return {
            ...base,
            getMode: jest.fn().mockReturnValue('code'),
            setMode: jest.fn(),
            isYoloModeEnabled: jest.fn().mockReturnValue(false),
            getSessionCost: jest.fn().mockReturnValue(0),
            getSessionCostLimit: jest.fn().mockReturnValue(10),
            setSessionCostLimit: jest.fn(),
            isSessionCostLimitReached: jest.fn().mockReturnValue(false),
            abortCurrentOperation: jest.fn(),
          } as unknown as IExtendedAgent;
        }

        getSpecialized(_agentId: string): ISpecializedAgent | undefined {
          return undefined;
        }

        listSpecialized(): ISpecializedAgentConfig[] {
          return [];
        }
      }

      const factory = new MockAgentFactory();

      // Test create
      const agent = factory.create();
      expect(agent).toBeDefined();
      expect(agent.processUserMessage).toBeDefined();

      // Test createExtended
      const extended = factory.createExtended({ model: 'test-model' });
      expect(extended).toBeDefined();
      expect(extended.getMode).toBeDefined();

      // Test specialized
      expect(factory.getSpecialized('unknown')).toBeUndefined();
      expect(factory.listSpecialized()).toEqual([]);
    });
  });

  describe('Type definitions', () => {
    it('should define ChatEntryType correctly', () => {
      const types: IChatEntry['type'][] = ['user', 'assistant', 'tool_result', 'tool_call'];
      expect(types).toHaveLength(4);
    });

    it('should define StreamingChunkType correctly', () => {
      const types: IStreamingChunk['type'][] = [
        'content',
        'tool_calls',
        'tool_result',
        'done',
        'token_count',
      ];
      expect(types).toHaveLength(5);
    });

    it('should define AgentModeType correctly', () => {
      const modes: AgentModeType[] = ['plan', 'code', 'ask', 'architect'];
      expect(modes).toHaveLength(4);
    });

    it('should define AgentCapabilityType correctly', () => {
      const capabilities: AgentCapabilityType[] = [
        'pdf-extract',
        'pdf-analyze',
        'excel-read',
        'excel-write',
        'csv-parse',
        'data-transform',
        'data-visualize',
        'sql-query',
        'archive-extract',
        'archive-create',
        'code-analyze',
        'code-review',
        'code-refactor',
        'code-security',
      ];
      expect(capabilities).toHaveLength(14);
    });
  });
});
