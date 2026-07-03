/**
 * GAP-7 — inbound two-way messaging roundtrip.
 *
 * `registerAIMessageHandler` is the inbound receiver loop: a channel message is
 * gated by DM pairing, routed, run through the agent, and the reply is delivered
 * back over the same channel. The audit flagged that there was no E2E test of the
 * full roundtrip or of same-session follow-up reuse. These tests cover both,
 * driving a fake ChannelManager/channel against fully-mocked core + agent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  return {
    checkDMPairing: vi.fn(),
    resolveRoute: vi.fn(),
    getRouteAgentConfig: vi.fn(),
    getDMPairing: vi.fn(),
    processUserMessage: vi.fn(),
    setChatHistory: vi.fn(),
    setMessages: vi.fn(),
    sessions: new Map<string, any>(),
    loadSession: vi.fn(),
    saveSession: vi.fn(),
    resumeSession: vi.fn(),
    convertMessagesToChatEntries: vi.fn(),
    setChannelBotId: vi.fn(),
    getChatHistory: vi.fn(),
    constructorCalls: [] as any[][],
    setModelCalls: [] as string[],
  };
});

vi.mock('../../src/channels/core.js', () => ({
  checkDMPairing: hoisted.checkDMPairing,
  resolveRoute: hoisted.resolveRoute,
  getRouteAgentConfig: hoisted.getRouteAgentConfig,
  getDMPairing: hoisted.getDMPairing,
}));

vi.mock('../../src/agent/codebuddy-agent.js', () => {
  class CodeBuddyAgent {
    historyManager = {
      setChatHistory: hoisted.setChatHistory,
      setMessages: hoisted.setMessages,
    };
    private model: string;
    constructor(...args: any[]) {
      hoisted.constructorCalls.push(args);
      this.model = String(args[2] ?? '');
    }
    getCurrentModel() {
      return this.model;
    }
    setModel(model: string) {
      hoisted.setModelCalls.push(model);
      this.model = model;
    }
    getSessionStore() {
      return {
        loadSession: hoisted.loadSession,
        saveSession: hoisted.saveSession,
        resumeSession: hoisted.resumeSession,
        convertMessagesToChatEntries: hoisted.convertMessagesToChatEntries,
      };
    }
    processUserMessage = hoisted.processUserMessage;
    setChannelBotId = hoisted.setChannelBotId;
    getChatHistory = hoisted.getChatHistory;
  }
  return { CodeBuddyAgent };
});

import {
  registerAIMessageHandler,
  registerChannelBotPersona,
  __resetChannelAIHandlerForTests,
} from '../../src/commands/handlers/channel-handlers.js';

type InboundHandler = (message: any, channel: any) => Promise<void>;

function makeManager() {
  let handler: InboundHandler | null = null;
  return {
    onMessage: (cb: InboundHandler) => { handler = cb; },
    emit: async (message: any, channel: any) => {
      if (!handler) throw new Error('no handler registered');
      await handler(message, channel);
    },
  };
}

function makeMessage(content: string, sessionKey = 'sess-1', botId?: string) {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    content,
    channel: { id: 'chan-42', ...(botId ? { botId } : {}) },
    sessionKey,
  };
}

describe('registerAIMessageHandler inbound roundtrip (GAP-7)', () => {
  beforeEach(() => {
    __resetChannelAIHandlerForTests();
    vi.clearAllMocks();
    hoisted.sessions.clear();
    hoisted.constructorCalls.length = 0;
    hoisted.setModelCalls.length = 0;
    process.env.GROK_API_KEY = 'test-key';

    // Default happy path: approved pairing, simple route, in-memory session store.
    hoisted.checkDMPairing.mockResolvedValue({ approved: true });
    hoisted.resolveRoute.mockReturnValue({ name: 'default' });
    hoisted.getRouteAgentConfig.mockReturnValue({ model: 'grok-3-latest', maxToolRounds: 5 });
    hoisted.getDMPairing.mockReturnValue({ getPairingMessage: () => 'Reply with code 123456 to pair.' });
    hoisted.processUserMessage.mockResolvedValue([{ role: 'assistant', content: 'Here is your answer.' }]);
    hoisted.loadSession.mockImplementation(async (key: string) => hoisted.sessions.get(key) ?? null);
    hoisted.saveSession.mockImplementation(async (s: any) => { hoisted.sessions.set(s.id, s); });
    hoisted.resumeSession.mockResolvedValue(undefined);
    hoisted.convertMessagesToChatEntries.mockImplementation((msgs: any[]) => msgs.map((m) => ({ ...m, chat: true })));
    hoisted.getChatHistory.mockReturnValue([
      { type: 'user', content: 'latest question', timestamp: new Date('2026-01-01T00:00:00.000Z') },
      { type: 'assistant', content: 'Here is your answer.', timestamp: new Date('2026-01-01T00:00:01.000Z') },
    ]);
  });

  it('runs message → pairing → route → agent → reply and delivers the response', async () => {
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);
    const msg = makeMessage('What is 2 + 2?');
    await manager.emit(msg, { send });

    // Agent ran the inbound content…
    expect(hoisted.processUserMessage).toHaveBeenCalledWith('What is 2 + 2?');
    // …and the reply went back over the same channel, threaded to the message.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      channelId: 'chan-42',
      content: 'Here is your answer.',
      replyTo: msg.id,
    });
  });

  it('blocks unpaired senders: sends the pairing prompt and does NOT run the agent', async () => {
    hoisted.checkDMPairing.mockResolvedValue({ approved: false, code: '123456' });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);
    await manager.emit(makeMessage('hello'), { send });

    expect(hoisted.processUserMessage).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].content).toContain('pair');
  });

  it('reuses the same session across follow-up messages (no re-create)', async () => {
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);

    // First inbound message creates and persists the session.
    await manager.emit(makeMessage('first', 'sess-shared'), { send });
    // Follow-up on the same sessionKey must reuse the cached agent, not re-create it.
    await manager.emit(makeMessage('follow-up', 'sess-shared'), { send });

    expect(hoisted.loadSession).toHaveBeenCalledTimes(3);
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(1, 'sess-shared');
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(2, 'sess-shared');
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(3, 'sess-shared');
    // The cached agent handles both turns, and each completed turn is persisted.
    expect(hoisted.saveSession).toHaveBeenCalledTimes(2);
    expect(hoisted.resumeSession).not.toHaveBeenCalled();
    expect(hoisted.processUserMessage).toHaveBeenNthCalledWith(1, 'first');
    expect(hoisted.processUserMessage).toHaveBeenNthCalledWith(2, 'follow-up');
  });

  it('restores prior history when resuming a session that already has messages', async () => {
    const priorMessages = [
      { type: 'user', content: 'earlier question' },
      { type: 'assistant', content: 'earlier answer' },
    ];
    hoisted.sessions.set('sess-resume', {
      id: 'sess-resume',
      name: 'existing',
      model: 'grok-3-latest',
      messages: priorMessages,
      workingDirectory: process.cwd(),
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);
    await manager.emit(makeMessage('next', 'sess-resume'), { send });

    // Session is restored before the turn and persisted again after the reply.
    expect(hoisted.saveSession).toHaveBeenCalledTimes(1);
    // Prior history was restored into the agent before the new turn.
    expect(hoisted.convertMessagesToChatEntries).toHaveBeenCalledWith(priorMessages);
    expect(hoisted.setMessages).toHaveBeenCalledWith([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
    expect(hoisted.processUserMessage).toHaveBeenCalledWith('next');
  });

  // -------------------------------------------------------------------------
  // Per-channel model + system-prompt overrides (Hermes parity):
  // session > route > persona > route-default > global, driven through the
  // REAL handler; the mocked agent only captures what reaches it.
  // -------------------------------------------------------------------------
  describe('per-channel model overrides', () => {
    it('an explicitly matched route model beats the bot persona model', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue({ matchType: 'peer', agent: { model: 'route-m' } });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(makeMessage('hello', 'sess-route', 'bot1'), { send: vi.fn().mockResolvedValue(undefined) });

      expect(hoisted.constructorCalls).toHaveLength(1);
      expect(hoisted.constructorCalls[0]![2]).toBe('route-m');
    });

    it('the persona model beats the merged route-default model', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue(null); // no explicit route match
      hoisted.getRouteAgentConfig.mockReturnValue({ model: 'default-m', maxToolRounds: 5 });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(makeMessage('hello', 'sess-persona', 'bot1'), { send: vi.fn().mockResolvedValue(undefined) });

      expect(hoisted.constructorCalls[0]![2]).toBe('persona-m');
    });

    it('a router-default matchType stays in the route-default tier (persona wins)', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue({ matchType: 'default', agent: { model: 'default-m' } });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(makeMessage('hello', 'sess-dflt', 'bot1'), { send: vi.fn().mockResolvedValue(undefined) });

      expect(hoisted.constructorCalls[0]![2]).toBe('persona-m');
    });

    it('/model <name> sets a session override that beats every channel tier', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue({ matchType: 'peer', agent: { model: 'route-m' } });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = vi.fn().mockResolvedValue(undefined);

      await manager.emit(makeMessage('/model session-m', 'sess-ovr', 'bot1'), { send });
      // The /model turn replies without invoking the agent.
      expect(hoisted.processUserMessage).not.toHaveBeenCalled();
      expect(send.mock.calls[0][0].content).toContain('session-m');

      await manager.emit(makeMessage('hello', 'sess-ovr', 'bot1'), { send });
      expect(hoisted.constructorCalls[0]![2]).toBe('session-m');
    });

    it('/model reset reverts to the channel tier on the next turn', async () => {
      hoisted.resolveRoute.mockReturnValue({ matchType: 'peer', agent: { model: 'route-m' } });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = vi.fn().mockResolvedValue(undefined);

      await manager.emit(makeMessage('/model session-m', 'sess-rst'), { send });
      await manager.emit(makeMessage('hello', 'sess-rst'), { send });
      expect(hoisted.constructorCalls[0]![2]).toBe('session-m');

      await manager.emit(makeMessage('/model reset', 'sess-rst'), { send });
      expect(send.mock.calls.at(-1)![0].content).toContain('route-m');

      // Cached agent is reconciled to the channel-tier model on the next turn.
      await manager.emit(makeMessage('again', 'sess-rst'), { send });
      expect(hoisted.setModelCalls).toContain('route-m');
      expect(hoisted.constructorCalls).toHaveLength(1); // never rebuilt
    });

    it('/model alone shows the effective model + source without invoking the agent', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue(null);

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = vi.fn().mockResolvedValue(undefined);
      await manager.emit(makeMessage('/model', 'sess-show', 'bot1'), { send });

      expect(hoisted.processUserMessage).not.toHaveBeenCalled();
      const reply = send.mock.calls[0][0].content as string;
      expect(reply).toContain('persona-m');
      expect(reply).toContain('persona');
    });

    it('reconciles a cached agent via setModel instead of rebuilding it', async () => {
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = vi.fn().mockResolvedValue(undefined);

      await manager.emit(makeMessage('turn one', 'sess-cache'), { send });
      expect(hoisted.constructorCalls).toHaveLength(1);

      await manager.emit(makeMessage('/model new-m', 'sess-cache'), { send });
      await manager.emit(makeMessage('turn two', 'sess-cache'), { send });

      expect(hoisted.setModelCalls).toContain('new-m');
      expect(hoisted.constructorCalls).toHaveLength(1); // cache preserved
    });

    it('rejects a bogus model name and keeps the channel-tier model', async () => {
      hoisted.resolveRoute.mockReturnValue({ matchType: 'peer', agent: { model: 'route-m' } });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = vi.fn().mockResolvedValue(undefined);

      await manager.emit(makeMessage('/model bad`name', 'sess-bad'), { send });
      expect(send.mock.calls[0][0].content).toContain('invalide');

      await manager.emit(makeMessage('hello', 'sess-bad'), { send });
      expect(hoisted.constructorCalls[0]![2]).toBe('route-m');
    });

    it("the matched route's systemPrompt reaches the agent append (arg 8), full-replace arg 9 unused", async () => {
      registerChannelBotPersona('bot1', { systemPrompt: 'PERSONA-IDENTITY' });
      hoisted.getRouteAgentConfig.mockReturnValue({ systemPrompt: 'ROUTE-RULES', maxToolRounds: 5 });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(makeMessage('hello', 'sess-sp', 'bot1'), { send: vi.fn().mockResolvedValue(undefined) });

      const args = hoisted.constructorCalls[0]!;
      const append = String(args[7]);
      expect(append).toContain('PERSONA-IDENTITY');
      expect(append).toContain('ROUTE-RULES');
      expect(append.indexOf('PERSONA-IDENTITY')).toBeLessThan(append.indexOf('ROUTE-RULES'));
      expect(args[8]).toBeUndefined();
    });
  });
});
