/**
 * Unit tests for EnhancedCommandHandler
 * Tests command dispatching to various modular handlers
 */

import { EnhancedCommandHandler, getEnhancedCommandHandler, resetEnhancedCommandHandler } from '../../src/commands/enhanced-command-handler';

// Mock all handlers
jest.mock('../../src/commands/handlers/index.js', () => ({
  handleHelp: jest.fn().mockResolvedValue({ handled: true, message: 'help' }),
  handleYoloMode: jest.fn().mockResolvedValue({ handled: true }),
  handleAutonomy: jest.fn().mockResolvedValue({ handled: true }),
  handlePipeline: jest.fn().mockResolvedValue({ handled: true }),
  handleParallel: jest.fn().mockResolvedValue({ handled: true }),
  handleModelRouter: jest.fn().mockResolvedValue({ handled: true }),
  handleSkill: jest.fn().mockResolvedValue({ handled: true }),
  handleCost: jest.fn().mockResolvedValue({ handled: true }),
  handleStats: jest.fn().mockResolvedValue({ handled: true }),
  handleCache: jest.fn().mockResolvedValue({ handled: true }),
  handleSelfHealing: jest.fn().mockResolvedValue({ handled: true }),
  handleSecurity: jest.fn().mockResolvedValue({ handled: true }),
  handleDryRun: jest.fn().mockResolvedValue({ handled: true }),
  handleGuardian: jest.fn().mockResolvedValue({ handled: true }),
  handleFork: jest.fn().mockResolvedValue({ handled: true }),
  handleBranches: jest.fn().mockResolvedValue({ handled: true }),
  handleCheckout: jest.fn().mockResolvedValue({ handled: true }),
  handleMerge: jest.fn().mockResolvedValue({ handled: true }),
  handleMemory: jest.fn().mockResolvedValue({ handled: true }),
  handleRemember: jest.fn().mockResolvedValue({ handled: true }),
  handleScanTodos: jest.fn().mockResolvedValue({ handled: true }),
  handleAddressTodo: jest.fn().mockResolvedValue({ handled: true }),
  handleWorkspace: jest.fn().mockResolvedValue({ handled: true }),
  handleAddContext: jest.fn().mockResolvedValue({ handled: true }),
  handleContext: jest.fn().mockResolvedValue({ handled: true }),
  handleSaveConversation: jest.fn().mockResolvedValue({ handled: true }),
  handleExport: jest.fn().mockResolvedValue({ handled: true }),
  handleExportList: jest.fn().mockResolvedValue({ handled: true }),
  handleExportFormats: jest.fn().mockResolvedValue({ handled: true }),
  handleGenerateTests: jest.fn().mockResolvedValue({ handled: true }),
  handleAITest: jest.fn().mockResolvedValue({ handled: true }),
  handleTheme: jest.fn().mockResolvedValue({ handled: true }),
  handleAvatar: jest.fn().mockResolvedValue({ handled: true }),
  handleVoice: jest.fn().mockResolvedValue({ handled: true }),
  handleSpeak: jest.fn().mockResolvedValue({ handled: true }),
  handleTTS: jest.fn().mockResolvedValue({ handled: true }),
  handleSessions: jest.fn().mockResolvedValue({ handled: true }),
  handleAgent: jest.fn().mockResolvedValue({ handled: true }),
  handleReload: jest.fn().mockResolvedValue({ handled: true }),
  handleLog: jest.fn().mockResolvedValue({ handled: true }),
  handleCompact: jest.fn().mockResolvedValue({ handled: true }),
  handleTools: jest.fn().mockResolvedValue({ handled: true }),
  handleVimMode: jest.fn().mockResolvedValue({ handled: true }),
  handlePermissions: jest.fn().mockResolvedValue({ handled: true }),
  handleWorktree: jest.fn().mockResolvedValue({ handled: true }),
  handleScript: jest.fn().mockResolvedValue({ handled: true }),
  handleFCS: jest.fn().mockResolvedValue({ handled: true }),
  handleTDD: jest.fn().mockResolvedValue({ handled: true }),
  handleWorkflow: jest.fn().mockResolvedValue({ handled: true }),
  handleHooks: jest.fn().mockResolvedValue({ handled: true }),
  handlePromptCache: jest.fn().mockResolvedValue({ handled: true }),
  handleTrack: jest.fn().mockResolvedValue({ handled: true }),
}));

import * as handlers from '../../src/commands/handlers/index.js';

describe('EnhancedCommandHandler', () => {
  let handler: EnhancedCommandHandler;

  beforeEach(() => {
    resetEnhancedCommandHandler();
    handler = new EnhancedCommandHandler();
  });

  it('should dispatch __HELP__ to handleHelp', async () => {
    (handlers.handleHelp as jest.Mock).mockResolvedValue({
      handled: true,
      entry: { type: 'assistant', content: 'help', timestamp: new Date() }
    });
    const result = await handler.handleCommand('__HELP__', [], '');
    expect(handlers.handleHelp).toHaveBeenCalled();
    expect(result.entry?.content).toBe('help');
  });

  it('should dispatch __YOLO_MODE__ to handleYoloMode', async () => {
    await handler.handleCommand('__YOLO_MODE__', ['on'], '');
    expect(handlers.handleYoloMode).toHaveBeenCalledWith(['on']);
  });

  it('should dispatch __SECURITY__ to handleSecurity', async () => {
    await handler.handleCommand('__SECURITY__', ['status'], '');
    expect(handlers.handleSecurity).toHaveBeenCalledWith(['status']);
  });

  it('should dispatch __ADD_CONTEXT__ to handleAddContext', async () => {
    await handler.handleCommand('__ADD_CONTEXT__', ['*.ts'], '');
    expect(handlers.handleAddContext).toHaveBeenCalledWith(['*.ts']);
  });

  it('should dispatch __AGENT__ to handleAgent', async () => {
    await handler.handleCommand('__AGENT__', ['list'], '');
    expect(handlers.handleAgent).toHaveBeenCalledWith(['list']);
  });

  it('should dispatch __WORKTREE__ to handleWorktree', async () => {
    await handler.handleCommand('__WORKTREE__', ['list'], '');
    expect(handlers.handleWorktree).toHaveBeenCalledWith(['list']);
  });

  it('should dispatch __TRACK__ to handleTrack', async () => {
    await handler.handleCommand('__TRACK__', ['status'], '');
    expect(handlers.handleTrack).toHaveBeenCalledWith(['status']);
  });

  it('should return handled: false for unknown tokens', async () => {
    const result = await handler.handleCommand('__UNKNOWN__', [], '');
    expect(result.handled).toBe(false);
  });

  it('should pass conversation history to handlers that need it', async () => {
    const history: any[] = [{ role: 'user', content: 'hi' }];
    handler.setConversationHistory(history);
    
    await handler.handleCommand('__SAVE_CONVERSATION__', [], '');
    expect(handlers.handleSaveConversation).toHaveBeenCalledWith([], history);
  });

  it('should pass client to handlers that need it', async () => {
    const mockClient = {} as any;
    handler.setCodeBuddyClient(mockClient);
    
    await handler.handleCommand('__AI_TEST__', [], '');
    expect(handlers.handleAITest).toHaveBeenCalledWith([], mockClient);
  });
});

describe('EnhancedCommandHandler Singleton', () => {
  it('should return same instance', () => {
    const h1 = getEnhancedCommandHandler();
    const h2 = getEnhancedCommandHandler();
    expect(h1).toBe(h2);
  });
});
