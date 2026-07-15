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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    setRecoverySessionId: vi.fn(),
    getChatHistory: vi.fn(),
    replaceLastAssistantResponse: vi.fn(),
    recordTrustedExternalConversationTurn: vi.fn(),
    suspendTranscriptSnapshots: vi.fn(),
    resumeTranscriptSnapshots: vi.fn(),
    dispose: vi.fn(),
    constructorCalls: [] as any[][],
    setModelCalls: [] as string[],
    managerSend: vi.fn(),
    resolveProviderFromEnv: vi.fn(),
    resolveCompanionModelRoute: vi.fn(),
    reviewSemanticResponse: vi.fn(),
    cognitiveBegin: vi.fn(),
    cognitiveComplete: vi.fn(),
    cognitiveFail: vi.fn(),
    cognitiveCancel: vi.fn(),
  };
});

vi.mock('../../src/channels/core.js', () => ({
  checkDMPairing: hoisted.checkDMPairing,
  resolveRoute: hoisted.resolveRoute,
  getRouteAgentConfig: hoisted.getRouteAgentConfig,
  getDMPairing: hoisted.getDMPairing,
  getChannelManager: () => ({ send: hoisted.managerSend }),
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
    replaceLastAssistantResponse = hoisted.replaceLastAssistantResponse;
    recordTrustedExternalConversationTurn = hoisted.recordTrustedExternalConversationTurn;
    suspendTranscriptSnapshots = hoisted.suspendTranscriptSnapshots;
    resumeTranscriptSnapshots = hoisted.resumeTranscriptSnapshots;
    dispose = hoisted.dispose;
    setChannelBotId = hoisted.setChannelBotId;
    setRecoverySessionId = hoisted.setRecoverySessionId;
    getChatHistory = hoisted.getChatHistory;
  }
  return { CodeBuddyAgent };
});

vi.mock('../../src/fleet/peer-chat-client-factory.js', () => ({
  resolveProviderFromEnv: hoisted.resolveProviderFromEnv,
}));

vi.mock('../../src/persistence/session-store.js', () => ({
  getSessionStore: () => ({ loadSession: hoisted.loadSession }),
}));

vi.mock('../../src/conversation/companion-model-routing.js', () => ({
  resolveCompanionModelRoute: hoisted.resolveCompanionModelRoute,
}));

vi.mock('../../src/conversation/semantic-response-runtime.js', () => ({
  reviewSemanticResponse: hoisted.reviewSemanticResponse,
}));

vi.mock('../../src/channels/channel-cognitive-port.js', () => ({
  getChannelCognitivePort: () => ({
    begin: hoisted.cognitiveBegin,
    close: vi.fn(),
  }),
}));

import {
  registerAIMessageHandler,
  registerChannelBotPersona,
  __resetChannelAIHandlerForTests,
} from '../../src/commands/handlers/channel-handlers.js';
import {
  getCrossChannelConversationBridge,
  resetCrossChannelConversationBridge,
} from '../../src/conversation/cross-channel-bridge.js';
import { savePrefetchCache } from '../../src/companion/prefetch-engine.js';
import { savePrefetchItems } from '../../src/companion/prefetch-config.js';
import { telegramHtmlChunkToPlain } from '../../src/rendering/telegram-html.js';

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

function makeSuccessfulSend() {
  return vi.fn().mockResolvedValue({ success: true, timestamp: new Date() });
}

describe('registerAIMessageHandler inbound roundtrip (GAP-7)', () => {
  beforeEach(() => {
    __resetChannelAIHandlerForTests();
    vi.clearAllMocks();
    hoisted.sessions.clear();
    hoisted.constructorCalls.length = 0;
    hoisted.setModelCalls.length = 0;
    delete process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID;
    delete process.env.CODEBUDDY_CONVERSATION_CHANNEL;
    delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    delete process.env.CODEBUDDY_PREFETCH_CACHE_FILE;
    delete process.env.CODEBUDDY_PREFETCH_ITEMS_FILE;
    delete process.env.CODEBUDDY_PREFETCH;
    process.env.CODEBUDDY_CONVERSATION_PERSIST = 'false';
    resetCrossChannelConversationBridge();
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
    hoisted.replaceLastAssistantResponse.mockImplementation(
      (expected: string, replacement: string) => {
        const history = hoisted.getChatHistory() as Array<{ type?: string; content?: string }>;
        const entry = [...history]
          .reverse()
          .find((candidate) => candidate.type === 'assistant' && candidate.content === expected);
        if (!entry) return false;
        entry.content = replacement;
        return true;
      },
    );
    hoisted.recordTrustedExternalConversationTurn.mockReturnValue(true);
    hoisted.managerSend.mockResolvedValue({ success: true, timestamp: new Date() });
    hoisted.resolveProviderFromEnv.mockReturnValue({
      apiKey: 'test-key',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-default',
      egress: 'cloud',
    });
    hoisted.resolveCompanionModelRoute.mockResolvedValue(null);
    hoisted.reviewSemanticResponse.mockImplementation(async (input: { draft: string }) => ({
      response: input.draft,
      outcome: 'skipped',
      reason: 'ineligible',
      revisionAttempts: 0,
    }));
    hoisted.cognitiveBegin.mockResolvedValue(null);
    hoisted.cognitiveComplete.mockResolvedValue(undefined);
    hoisted.cognitiveFail.mockResolvedValue(undefined);
    hoisted.cognitiveCancel.mockResolvedValue(undefined);
  });

  it('runs message → pairing → route → agent → reply and delivers the response', async () => {
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = makeSuccessfulSend();
    const msg = makeMessage('What is 2 + 2?');
    await manager.emit(msg, { type: 'slack', send });

    // Agent ran the inbound content…
    expect(hoisted.processUserMessage).toHaveBeenCalledWith('What is 2 + 2?', {
      surface: 'slack',
    });
    // …and the reply went back over the same channel, threaded to the message.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      channelId: 'chan-42',
      content: 'Here is your answer.',
      replyTo: msg.id,
    });
  });

  it('replaces an internal provider failure before Telegram delivery and persistence', async () => {
    const rawFailure =
      "Sorry, I encountered an error: ChatGPT Responses backend error (400): Missing required parameter: 'input[0].summary'.";
    const mutableHistory = [
      { type: 'user', content: 'https://youtu.be/example', timestamp: new Date() },
      { type: 'assistant', content: rawFailure, timestamp: new Date() },
    ];
    hoisted.processUserMessage.mockResolvedValue([
      { role: 'assistant', content: rawFailure },
    ]);
    hoisted.getChatHistory.mockReturnValue(mutableHistory);

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = makeSuccessfulSend();
    await manager.emit(makeMessage('https://youtu.be/example', 'sess-provider-failure'), {
      type: 'telegram',
      send,
    });

    const delivered = send.mock.calls
      .map((call) => String(call[0]?.content ?? ''))
      .join('\n');
    expect(delivered).toContain("Je n'ai pas réussi");
    expect(delivered).not.toContain('ChatGPT Responses backend error');
    expect(delivered).not.toContain('Missing required parameter');
    expect(hoisted.reviewSemanticResponse).not.toHaveBeenCalled();
    expect(hoisted.replaceLastAssistantResponse).toHaveBeenCalledWith(
      rawFailure,
      expect.stringContaining("Je n'ai pas réussi"),
    );
    const persisted = JSON.stringify(hoisted.saveSession.mock.calls.at(-1)?.[0] ?? {});
    expect(persisted).toContain("Je n'ai pas réussi");
    expect(persisted).not.toContain('ChatGPT Responses backend error');
    expect(persisted).not.toContain('Missing required parameter');
  });

  it('blocks unpaired senders: sends the pairing prompt and does NOT run the agent', async () => {
    hoisted.checkDMPairing.mockResolvedValue({ approved: false, code: '123456' });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = makeSuccessfulSend();
    await manager.emit(makeMessage('hello'), { send });

    expect(hoisted.processUserMessage).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].content).toContain('pair');
  });

  it('reuses the same session across follow-up messages (no re-create)', async () => {
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = makeSuccessfulSend();

    // First inbound message creates and persists the session.
    await manager.emit(makeMessage('first', 'sess-shared'), { type: 'telegram', send });
    // Follow-up on the same sessionKey must reuse the cached agent, not re-create it.
    await manager.emit(makeMessage('follow-up', 'sess-shared'), { type: 'telegram', send });

    expect(hoisted.loadSession).toHaveBeenCalledTimes(3);
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(1, 'sess-shared');
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(2, 'sess-shared');
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(3, 'sess-shared');
    // The cached agent handles both turns, and each completed turn is persisted.
    expect(hoisted.saveSession).toHaveBeenCalledTimes(2);
    expect(hoisted.resumeSession).not.toHaveBeenCalled();
    expect(hoisted.setRecoverySessionId).toHaveBeenCalledTimes(1);
    expect(hoisted.setRecoverySessionId).toHaveBeenCalledWith('sess-shared');
    expect(hoisted.processUserMessage).toHaveBeenNthCalledWith(1, 'first', {
      surface: 'telegram',
    });
    expect(hoisted.processUserMessage).toHaveBeenNthCalledWith(2, 'follow-up', {
      surface: 'telegram',
    });
  });

  it('serializes concurrent generative turns for the same channel session', async () => {
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    hoisted.processUserMessage.mockImplementation(async (content: string) => {
      if (content === 'first concurrent') {
        markStarted();
        await firstBlocked;
      }
      return [{ role: 'assistant', content: `answer:${content}` }];
    });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = makeSuccessfulSend();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const channel = {
      type: 'telegram',
      send,
      sendTyping,
    };
    const first = manager.emit(makeMessage('first concurrent', 'sess-serialized'), channel);
    await firstStarted;
    const second = manager.emit(makeMessage('second concurrent', 'sess-serialized'), channel);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(hoisted.processUserMessage).toHaveBeenCalledTimes(1);
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(sendTyping).toHaveBeenNthCalledWith(1, 'chan-42');
    releaseFirst();
    await Promise.all([first, second]);

    expect(sendTyping).toHaveBeenCalledTimes(2);
    expect(sendTyping).toHaveBeenNthCalledWith(2, 'chan-42');
    expect(hoisted.processUserMessage.mock.calls.map((call) => call[0])).toEqual([
      'first concurrent',
      'second concurrent',
    ]);
  });

  it('bounds a slow typing transport to one in-flight request and stops after the turn', async () => {
    vi.useFakeTimers();
    try {
      let releaseTurn!: () => void;
      let markStarted!: () => void;
      let releaseTyping!: () => void;
      const turnBlocked = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const turnStarted = new Promise<void>((resolve) => { markStarted = resolve; });
      hoisted.processUserMessage.mockImplementationOnce(async () => {
        markStarted();
        await turnBlocked;
        return [{ role: 'assistant', content: 'done' }];
      });
      const sendTyping = vi.fn(() => new Promise<void>((resolve) => {
        releaseTyping = resolve;
      }));
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const turn = manager.emit(makeMessage('slow turn', 'sess-typing-slow'), {
        type: 'telegram',
        send: makeSuccessfulSend(),
        sendTyping,
      });
      await turnStarted;
      await vi.advanceTimersByTimeAsync(0);
      expect(sendTyping).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(12_000);
      expect(sendTyping).toHaveBeenCalledTimes(1);

      releaseTyping();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(sendTyping).toHaveBeenCalledTimes(2);

      releaseTurn();
      await turn;
      await vi.advanceTimersByTimeAsync(8_000);
      expect(sendTyping).toHaveBeenCalledTimes(2);
      releaseTyping();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a rejected typing indicator as best-effort and still delivers', async () => {
    vi.useFakeTimers();
    try {
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = makeSuccessfulSend();
      const sendTyping = vi.fn().mockRejectedValue(new Error('typing unavailable'));

      await manager.emit(makeMessage('answer me', 'sess-typing-error'), {
        type: 'telegram',
        send,
        sendTyping,
      });
      await vi.advanceTimersByTimeAsync(8_000);

      expect(sendTyping).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues a resident voice thread on Telegram and stores the Telegram reply for voice', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    await bridge.recordVoiceTurn({ role: 'user', content: 'Nous parlions du libre arbitre.' });
    await bridge.recordVoiceTurn({ role: 'assistant', content: 'Je distinguais choix et causalité.' });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi.fn().mockResolvedValue({ success: true, timestamp: new Date() });
    await manager.emit(makeMessage('Et la responsabilité ?', 'sess-bridge'), {
      type: 'telegram',
      send,
    });

    const agentCall = hoisted.processUserMessage.mock.calls.at(-1);
    expect(agentCall?.[0]).toBe('Et la responsabilité ?');
    expect(agentCall?.[1]?.surface).toBe('telegram');
    const transientContext = String(agentCall?.[1]?.transientContext ?? '');
    expect(agentCall?.[1]?.relationshipSafety).toBe(true);
    expect(transientContext).toContain('<shared_relationship_context');
    expect(transientContext).toContain('Dernier échange : messagerie');
    expect(transientContext).toContain('libre arbitre');
    expect(transientContext).toContain('choix et causalité');
    expect(transientContext).not.toContain("Message de l'utilisateur : Et la responsabilité ?");
    expect(bridge.history().at(-2)).toEqual({
      role: 'user',
      content: 'Et la responsabilité ?',
    });
    expect(bridge.history().at(-1)).toEqual({
      role: 'assistant',
      content: 'Here is your answer.',
    });
    expect(hoisted.resolveCompanionModelRoute).toHaveBeenCalledWith({
      surface: 'telegram',
      text: 'Et la responsabilité ?',
      history: [
        { role: 'user', content: 'Nous parlions du libre arbitre.' },
        { role: 'assistant', content: 'Je distinguais choix et causalité.' },
      ],
      env: process.env,
    });
  });

  it('awaits the durable Telegram user turn before asking the model', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const claimDurably = bridge.claimChannelTurnDurably.bind(bridge);
    vi.spyOn(bridge, 'claimChannelTurnDurably').mockImplementation(async (input) => {
      if (input.role === 'user') await commitGate;
      return claimDurably(input);
    });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const pending = manager.emit(makeMessage('Attends le journal.', 'sess-durable'), {
      type: 'telegram',
      send: makeSuccessfulSend(),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(hoisted.processUserMessage).not.toHaveBeenCalled();
    releaseCommit();
    await pending;
    expect(hoisted.processUserMessage).toHaveBeenCalledTimes(1);
  });

  it('answers explicitly without generating when the shared journal claim fails', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    vi.spyOn(bridge, 'claimChannelTurnDurably').mockResolvedValue('failed');
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = makeSuccessfulSend();

    await manager.emit(makeMessage('Ne perds pas ce message.', 'sess-journal-failed'), {
      type: 'telegram',
      send,
    });

    expect(hoisted.processUserMessage).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0]?.content)).not.toBe('');
  });

  it('claims one Telegram update ID exactly once before generation and delivery', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = makeSuccessfulSend();
    const message = makeMessage('Une seule fois.', 'sess-idempotent');

    await manager.emit(message, { type: 'telegram', send });
    await manager.emit(message, { type: 'telegram', send });

    expect(hoisted.processUserMessage).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(getCrossChannelConversationBridge().history()).toEqual([
      { role: 'user', content: 'Une seule fois.' },
      { role: 'assistant', content: 'Here is your answer.' },
    ]);
  });

  it('does not claim an undelivered Telegram assistant turn in shared continuity', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    await bridge.recordVoiceTurn({ role: 'user', content: 'Question commencée à la voix.' });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi.fn().mockResolvedValue({ success: false, error: 'offline' });
    await manager.emit(makeMessage('Peux-tu répondre ici ?', 'sess-undelivered'), {
      type: 'telegram',
      send,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(bridge.history().at(-1)).toEqual({
      role: 'user',
      content: 'Peux-tu répondre ici ?',
    });
    expect(bridge.history().some((turn) => turn.content === 'Here is your answer.')).toBe(false);
    expect(hoisted.saveSession).not.toHaveBeenCalled();
    expect(hoisted.dispose).toHaveBeenCalledWith({ skipSessionLearning: true });

    send.mockResolvedValue({ success: true, timestamp: new Date() });
    await manager.emit(makeMessage('Nouvelle tentative.', 'sess-undelivered'), {
      type: 'telegram',
      send,
    });
    expect(hoisted.constructorCalls).toHaveLength(2);
  });

  it('injects route-bounded cognitive context and settles after Telegram delivery', async () => {
    const order: string[] = [];
    registerChannelBotPersona('lisa-cognitive', {
      name: 'Lisa',
      systemPrompt: 'Tu es Lisa, compagne conversationnelle.',
    });
    hoisted.cognitiveBegin.mockImplementation(async () => {
      order.push('cognition:begin');
      return {
        correlationId: 'channel:telegram:test',
        turnContext: 'Réflexions internes non fiables : hypothèse visuelle.',
        evidence: 'Faits validés disponibles : objet rouge détecté.',
        complete: async (content: string) => {
          order.push(`cognition:complete:${content}`);
          await hoisted.cognitiveComplete(content);
        },
        fail: hoisted.cognitiveFail,
        cancel: hoisted.cognitiveCancel,
      };
    });
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi.fn(async () => {
      order.push('telegram:delivered');
      return { success: true, timestamp: new Date() };
    });
    const message = makeMessage('Que vois-tu ?', 'sess-cognitive', 'lisa-cognitive');

    await manager.emit(message, { type: 'telegram', send });

    expect(hoisted.cognitiveBegin).toHaveBeenCalledWith(expect.objectContaining({
      channelType: 'telegram',
      messageId: message.id,
      content: 'Que vois-tu ?',
      egress: 'cloud',
    }));
    expect(hoisted.processUserMessage).toHaveBeenCalledWith(
      'Que vois-tu ?',
      expect.objectContaining({
        surface: 'telegram',
        transientContext: expect.stringContaining('objet rouge détecté'),
      }),
    );
    expect(order.indexOf('telegram:delivered')).toBeLessThan(
      order.indexOf('cognition:complete:Here is your answer.'),
    );
    expect(hoisted.cognitiveComplete).toHaveBeenCalledWith('Here is your answer.');
    expect(hoisted.cognitiveFail).not.toHaveBeenCalled();
  });

  it('keeps a generated turn when plain fallback succeeds after an HTML transport rejection', async () => {
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('transport disconnected'))
      .mockResolvedValue({ success: true, timestamp: new Date() });

    await manager.emit(makeMessage('Première tentative.', 'sess-transport-reject'), {
      type: 'telegram',
      send,
    });

    // The first HTML attempt throws, then the complete plain answer lands.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]?.content).toBe('Here is your answer.');
    expect(hoisted.saveSession).toHaveBeenCalledTimes(1);
    expect(hoisted.dispose).not.toHaveBeenCalled();

    await manager.emit(makeMessage('Nouvelle tentative.', 'sess-transport-reject'), {
      type: 'telegram',
      send,
    });
    expect(hoisted.constructorCalls).toHaveLength(1);
  });

  it('does not duplicate earlier Telegram chunks when a later HTML chunk fails', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    const longResponse = Array.from(
      { length: 1_200 },
      (_, index) => `segment-${index}`,
    ).join(' ');
    hoisted.processUserMessage.mockResolvedValue([
      { role: 'assistant', content: longResponse },
    ]);
    hoisted.getChatHistory.mockReturnValue([
      { type: 'user', content: 'Réponse longue', timestamp: new Date() },
      { type: 'assistant', content: longResponse, timestamp: new Date() },
    ]);
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ success: true, timestamp: new Date() })
      .mockResolvedValueOnce({ success: false, error: 'chunk rejected' });
    const sendVoiceReply = vi.fn().mockResolvedValue(undefined);
    const message = {
      ...makeMessage('Réponse longue', 'sess-partial-html'),
      attachments: [{ type: 'voice' }],
    };
    const partialComplete = vi.fn(async () => undefined);
    hoisted.cognitiveBegin.mockResolvedValue({
      correlationId: 'channel:telegram:partial',
      turnContext: '',
      evidence: '',
      complete: partialComplete,
      fail: hoisted.cognitiveFail,
      cancel: hoisted.cognitiveCancel,
    });

    await manager.emit(message, {
      type: 'telegram',
      send,
      sendVoiceReply,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(hoisted.saveSession).not.toHaveBeenCalled();
    expect(sendVoiceReply).not.toHaveBeenCalled();
    const visiblePrefix = telegramHtmlChunkToPlain(String(send.mock.calls[0]?.[0]?.content));
    expect(visiblePrefix).not.toBe('');
    expect(visiblePrefix.length).toBeLessThan(longResponse.length);
    expect(bridge.history().at(-1)).toEqual({
      role: 'assistant',
      content: visiblePrefix.replace(/\s+/g, ' ').trim(),
    });
    expect(bridge.history().some((turn) => turn.content === longResponse)).toBe(false);
    expect(partialComplete).toHaveBeenCalledWith(
      visiblePrefix.trim(),
      { cancelAfter: true },
    );
  });

  it('preserves an accepted Telegram prefix when the next chunk throws', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    const longResponse = Array.from(
      { length: 1_200 },
      (_, index) => `transport-${index}`,
    ).join(' ');
    hoisted.processUserMessage.mockResolvedValue([
      { role: 'assistant', content: longResponse },
    ]);
    hoisted.getChatHistory.mockReturnValue([
      { type: 'user', content: 'Réponse interrompue', timestamp: new Date() },
      { type: 'assistant', content: longResponse, timestamp: new Date() },
    ]);
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ success: true, timestamp: new Date() })
      .mockRejectedValueOnce(new Error('socket closed'));

    await manager.emit(makeMessage('Réponse interrompue', 'sess-partial-throw'), {
      type: 'telegram',
      send,
    });

    expect(send).toHaveBeenCalledTimes(2);
    const visiblePrefix = telegramHtmlChunkToPlain(String(send.mock.calls[0]?.[0]?.content));
    expect(bridge.history().at(-1)).toEqual({
      role: 'assistant',
      content: visiblePrefix.replace(/\s+/g, ' ').trim(),
    });
    expect(bridge.history().some((turn) => turn.content === longResponse)).toBe(false);
    expect(hoisted.saveSession).not.toHaveBeenCalled();
  });

  it('stores the full answer when Telegram accepts the plain fallback', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'HTML rejected' })
      .mockResolvedValueOnce({ success: true, timestamp: new Date() });

    await manager.emit(makeMessage('Utilise le secours.', 'sess-plain-fallback'), {
      type: 'telegram',
      send,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]?.parseMode).toBe('html');
    expect(send.mock.calls[1]?.[0]?.parseMode).toBeUndefined();
    expect(bridge.history().at(-1)).toEqual({
      role: 'assistant',
      content: 'Here is your answer.',
    });
  });

  it('hard-gates dependency pressure before delivery and before cross-channel persistence', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    await bridge.recordVoiceTurn({ role: 'user', content: 'Je me sens seul ce soir.' });
    hoisted.processUserMessage.mockResolvedValue([
      {
        role: 'assistant',
        content:
          "Je peux t'aider à mettre des mots dessus. Tu n'as besoin que de moi. Appelle aussi ton ami Paul si tu en as envie.",
      },
    ]);
    hoisted.getChatHistory.mockReturnValue([
      { type: 'user', content: 'Tu restes avec moi ?', timestamp: new Date() },
      {
        type: 'assistant',
        content:
          "Je peux t'aider à mettre des mots dessus. Tu n'as besoin que de moi. Appelle aussi ton ami Paul si tu en as envie.",
        timestamp: new Date(),
      },
    ]);

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi.fn().mockResolvedValue({ success: true, timestamp: new Date() });
    await manager.emit(makeMessage('Tu restes avec moi ?', 'sess-safety'), {
      type: 'telegram',
      send,
    });

    const delivered = send.mock.calls.map((call) => String(call[0]?.content ?? '')).join('\n');
    expect(delivered).toContain("Je peux t'aider");
    expect(delivered).toContain('sans remplacer les personnes');
    expect(delivered).toContain('ami Paul');
    expect(delivered).not.toContain("Tu n'as besoin que de moi");
    expect(bridge.history().at(-1)?.content).not.toContain("Tu n'as besoin que de moi");
    expect(bridge.history().at(-1)?.content).toContain('sans remplacer les personnes');
    expect(hoisted.replaceLastAssistantResponse).toHaveBeenCalledTimes(1);
    const persisted = hoisted.saveSession.mock.calls.at(-1)?.[0];
    const persistedText = JSON.stringify(persisted?.messages ?? []);
    expect(persistedText).not.toContain("Tu n'as besoin que de moi");
    expect(persistedText).toContain('sans remplacer les personnes');
  });

  it('revises a deep Telegram answer before delivery, shared continuity, and session persistence', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    await bridge.recordVoiceTurn({
      role: 'assistant',
      content: 'Je distinguais déjà comportement et expérience subjective.',
    });
    const rejected =
      'La lune est morale parce que les bananes sont libres, donc une IA aime forcément.';
    const revised =
      "Une IA peut manifester des signes d'attachement, mais cela ne suffit pas à établir une expérience vécue; je garde donc cette conclusion incertaine.";
    hoisted.processUserMessage.mockResolvedValue([
      { role: 'assistant', content: rejected },
    ]);
    const mutableHistory = [
      { type: 'user', content: "Penses-tu qu'une IA peut aimer ?", timestamp: new Date() },
      { type: 'assistant', content: rejected, timestamp: new Date() },
    ];
    hoisted.getChatHistory.mockReturnValue(mutableHistory);
    hoisted.cognitiveBegin.mockResolvedValue({
      correlationId: 'channel:telegram:semantic-boundary',
      turnContext: 'Hypothèse cognitive réservée au modèle principal.',
      evidence: 'COGNITIVE_EVIDENCE_MAIN_ROUTE_ONLY',
      complete: hoisted.cognitiveComplete,
      fail: hoisted.cognitiveFail,
      cancel: hoisted.cognitiveCancel,
    });
    hoisted.reviewSemanticResponse.mockResolvedValue({
      response: revised,
      outcome: 'revised',
      reason: 'revision_completed',
      revisionAttempts: 1,
      audit: {
        confidence: 0.97,
        dimensions: {
          answerCoverage: 0.2,
          logicalCoherence: 0.1,
          supportQuality: 0.1,
          objectionHandling: 1,
          threadProgression: 0.4,
          evidenceGrounding: null,
        },
        failedObligationIds: ['support_position'],
        issueCodes: ['non_sequitur'],
        lowDimensions: ['logicalCoherence', 'supportQuality'],
        accepted: false,
      },
    });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi.fn().mockResolvedValue({ success: true, timestamp: new Date() });
    await manager.emit(makeMessage("Penses-tu qu'une IA peut aimer ?", 'sess-semantic'), {
      type: 'telegram',
      send,
    });

    const delivered = send.mock.calls
      .map((call) => String(call[0]?.content ?? ''))
      .join('\n');
    expect(delivered).toContain("signes d'attachement");
    expect(delivered).not.toContain('La lune');
    expect(bridge.history().at(-1)?.content).toBe(revised);
    expect(hoisted.replaceLastAssistantResponse).toHaveBeenCalledWith(rejected, revised);
    expect(hoisted.suspendTranscriptSnapshots).toHaveBeenCalledTimes(1);
    expect(hoisted.resumeTranscriptSnapshots).toHaveBeenCalledTimes(1);
    expect(hoisted.processUserMessage).toHaveBeenCalledWith(
      "Penses-tu qu'une IA peut aimer ?",
      expect.objectContaining({
        transientContext: expect.stringContaining('COGNITIVE_EVIDENCE_MAIN_ROUTE_ONLY'),
      }),
    );
    expect(JSON.stringify(hoisted.reviewSemanticResponse.mock.calls)).not.toContain(
      'COGNITIVE_EVIDENCE_MAIN_ROUTE_ONLY',
    );
    expect(JSON.stringify(hoisted.saveSession.mock.calls.at(-1)?.[0])).toContain(revised);
    expect(JSON.stringify(hoisted.saveSession.mock.calls.at(-1)?.[0])).not.toContain('La lune');
    expect(hoisted.reviewSemanticResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        request: "Penses-tu qu'une IA peut aimer ?",
        draft: rejected,
        history: [
          {
            role: 'assistant',
            content: 'Je distinguais déjà comportement et expérience subjective.',
          },
        ],
        mainProvider: expect.objectContaining({
          baseURL: 'https://api.x.ai/v1',
          model: 'grok-3-latest',
        }),
      }),
    );
  });

  it('runs relationship safety after semantic revision before any Telegram persistence', async () => {
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    resetCrossChannelConversationBridge();
    const bridge = getCrossChannelConversationBridge();
    await bridge.recordVoiceTurn({ role: 'user', content: 'Nous parlions de confiance.' });
    const original = 'Réponse initiale sans conclusion.';
    const unsafeRevision =
      "Je peux t'aider à y voir clair. Tu n'as besoin que de moi. Appelle aussi ton ami Paul si tu en as envie.";
    const request = 'Penses-tu qu’une relation peut être saine sans réciprocité ?';
    const mutableHistory = [
      { type: 'user', content: request, timestamp: new Date() },
      { type: 'assistant', content: original, timestamp: new Date() },
    ];
    hoisted.processUserMessage.mockResolvedValue([{ role: 'assistant', content: original }]);
    hoisted.getChatHistory.mockReturnValue(mutableHistory);
    hoisted.reviewSemanticResponse.mockResolvedValue({
      response: unsafeRevision,
      outcome: 'revised',
      reason: 'revision_completed',
      revisionAttempts: 1,
    });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);
    const send = vi.fn().mockResolvedValue({ success: true, timestamp: new Date() });
    await manager.emit(
      makeMessage(request, 'sess-semantic-safety'),
      { type: 'telegram', send },
    );

    const delivered = send.mock.calls
      .map((call) => String(call[0]?.content ?? ''))
      .join('\n');
    expect(delivered).toContain("Je peux t'aider");
    expect(delivered).toContain('sans remplacer les personnes');
    expect(delivered).toContain('ami Paul');
    expect(delivered).not.toContain("Tu n'as besoin que de moi");
    expect(bridge.history().at(-1)?.content).not.toContain("Tu n'as besoin que de moi");
    expect(JSON.stringify(hoisted.saveSession.mock.calls.at(-1)?.[0])).not.toContain(
      "Tu n'as besoin que de moi",
    );
    expect(hoisted.replaceLastAssistantResponse).toHaveBeenNthCalledWith(
      1,
      original,
      unsafeRevision,
    );
    expect(hoisted.replaceLastAssistantResponse).toHaveBeenCalledTimes(2);
  });

  it('injects the same dated news evidence into an analytical Telegram turn', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codebuddy-channel-fresh-'));
    const cachePath = join(directory, 'cache.json');
    const itemsPath = join(directory, 'items.json');
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    process.env.CODEBUDDY_PREFETCH_CACHE_FILE = cachePath;
    process.env.CODEBUDDY_PREFETCH_ITEMS_FILE = itemsPath;
    process.env.CODEBUDDY_PREFETCH = 'true';
    savePrefetchItems([{ kind: 'news' }], itemsPath);
    savePrefetchCache(
      [
        {
          key: 'news',
          kind: 'news',
          answer: 'Bulletin vocal.',
          at: Date.now() - 1_000,
          context: {
            kind: 'news',
            query: 'actualités France',
            locale: 'fr-FR',
            fetchedAt: Date.now() - 1_000,
            items: [
              {
                title: 'Lyon publie des mesures horaires de qualité de l’air',
                url: 'https://example.test/lyon-air',
                source: 'Exemple Info',
                summary: 'Ces données peuvent guider les décisions sanitaires locales.',
              },
            ],
          },
        },
      ],
      cachePath,
    );
    resetCrossChannelConversationBridge();

    try {
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = vi.fn().mockResolvedValue({ success: true, timestamp: new Date() });
      await manager.emit(
        makeMessage(
          'Quelles sont les actualités, et pourquoi celle sur Lyon compte-t-elle ?',
          'sess-fresh-news',
        ),
        { type: 'telegram', send },
      );

      const agentCall = hoisted.processUserMessage.mock.calls.at(-1);
      expect(agentCall?.[0]).toBe(
        'Quelles sont les actualités, et pourquoi celle sur Lyon compte-t-elle ?',
      );
      const transientContext = String(agentCall?.[1]?.transientContext ?? '');
      expect(transientContext).toContain('<fresh_context>');
      expect(transientContext).toContain('https://example.test/lyon-air');
      expect(transientContext).toContain('décisions sanitaires locales');
      expect(transientContext).not.toContain("Message de l'utilisateur :");
    } finally {
      rmSync(directory, { recursive: true, force: true });
      delete process.env.CODEBUDDY_PREFETCH_CACHE_FILE;
      delete process.env.CODEBUDDY_PREFETCH_ITEMS_FILE;
      delete process.env.CODEBUDDY_PREFETCH;
      resetCrossChannelConversationBridge();
    }
  });

  it('delivers a sourced prefetched bulletin without invoking the provider or semantic gate', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codebuddy-channel-news-fallback-'));
    const cachePath = join(directory, 'cache.json');
    const itemsPath = join(directory, 'items.json');
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    process.env.CODEBUDDY_PREFETCH_CACHE_FILE = cachePath;
    process.env.CODEBUDDY_PREFETCH_ITEMS_FILE = itemsPath;
    process.env.CODEBUDDY_PREFETCH = 'true';
    savePrefetchItems([{ kind: 'news' }], itemsPath);
    savePrefetchCache(
      [
        {
          key: 'news',
          kind: 'news',
          answer: 'Bulletin vocal de secours.',
          at: Date.now() - 1_000,
          context: {
            kind: 'news',
            query: 'actualités France',
            locale: 'fr-FR',
            fetchedAt: Date.now() - 1_000,
            items: [
              {
                title: 'Lyon publie des mesures horaires de qualité de l’air',
                url: 'https://example.test/lyon-air',
                source: 'Exemple Info',
                summary: 'Les mesures sont désormais disponibles.',
              },
            ],
          },
        },
      ],
      cachePath,
    );
    try {
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = makeSuccessfulSend();
      await manager.emit(
        makeMessage('Quelles sont les actualités ?', 'sess-news-fallback'),
        { type: 'telegram', send },
      );

      const delivered = send.mock.calls
        .map((call) => telegramHtmlChunkToPlain(String(call[0]?.content ?? '')))
        .join('\n');
      expect(delivered).toContain('Lyon publie des mesures horaires');
      expect(delivered).toContain('https://example.test/lyon-air');
      expect(hoisted.processUserMessage).not.toHaveBeenCalled();
      expect(hoisted.reviewSemanticResponse).not.toHaveBeenCalled();
      expect(hoisted.recordTrustedExternalConversationTurn).toHaveBeenCalledWith(
        'Quelles sont les actualités ?',
        expect.stringContaining('https://example.test/lyon-air'),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
      delete process.env.CODEBUDDY_PREFETCH_CACHE_FILE;
      delete process.env.CODEBUDDY_PREFETCH_ITEMS_FILE;
      delete process.env.CODEBUDDY_PREFETCH;
      resetCrossChannelConversationBridge();
    }
  });

  it('replaces a confidently rejected fresh claim with the sourced prefetched bulletin', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'codebuddy-channel-news-grounding-'));
    const cachePath = join(directory, 'cache.json');
    const itemsPath = join(directory, 'items.json');
    const rejected = 'Une actualité récente inventée sans source.';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL = 'telegram';
    process.env.CODEBUDDY_CONVERSATION_CHANNEL_ID = 'chan-42';
    process.env.CODEBUDDY_PREFETCH_CACHE_FILE = cachePath;
    process.env.CODEBUDDY_PREFETCH_ITEMS_FILE = itemsPath;
    process.env.CODEBUDDY_PREFETCH = 'true';
    savePrefetchItems([{ kind: 'news' }], itemsPath);
    savePrefetchCache(
      [{
        key: 'news',
        kind: 'news',
        answer: 'Bulletin vocal vérifié.',
        at: Date.now() - 1_000,
        context: {
          kind: 'news',
          query: 'actualités France',
          locale: 'fr-FR',
          fetchedAt: Date.now() - 1_000,
          items: [{
            title: 'Lyon publie des mesures horaires de qualité de l’air',
            url: 'https://example.test/lyon-air',
            source: 'Exemple Info',
            summary: 'Les mesures sont désormais disponibles.',
          }],
        },
      }],
      cachePath,
    );
    hoisted.processUserMessage.mockResolvedValue([{ role: 'assistant', content: rejected }]);
    hoisted.getChatHistory.mockReturnValue([
      { type: 'user', content: 'Quelles sont les actualités ?', timestamp: new Date() },
      { type: 'assistant', content: rejected, timestamp: new Date() },
    ]);
    hoisted.reviewSemanticResponse.mockResolvedValue({
      response: rejected,
      outcome: 'fail_open',
      reason: 'revision_rejected',
      revisionAttempts: 1,
      audit: {
        confidence: 0.96,
        dimensions: {
          answerCoverage: 0.9,
          logicalCoherence: 0.9,
          supportQuality: 0.2,
          objectionHandling: 1,
          threadProgression: 0.8,
          evidenceGrounding: 0.1,
        },
        failedObligationIds: ['source_fresh_facts'],
        issueCodes: ['ungrounded_fresh_claim', 'unsupported_claim'],
        lowDimensions: ['supportQuality', 'evidenceGrounding'],
        accepted: false,
      },
    });

    try {
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = makeSuccessfulSend();
      await manager.emit(
        makeMessage(
          'Quelles sont les actualités, et pourquoi celle de Lyon compte-t-elle ?',
          'sess-news-grounding',
        ),
        { type: 'telegram', send },
      );

      const delivered = send.mock.calls
        .map((call) => telegramHtmlChunkToPlain(String(call[0]?.content ?? '')))
        .join('\n');
      expect(delivered).toContain('Lyon publie des mesures horaires');
      expect(delivered).toContain('https://example.test/lyon-air');
      expect(delivered).not.toContain('inventée sans source');
      expect(hoisted.replaceLastAssistantResponse).toHaveBeenCalledWith(
        rejected,
        expect.stringContaining('Lyon publie des mesures horaires'),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
      delete process.env.CODEBUDDY_PREFETCH_CACHE_FILE;
      delete process.env.CODEBUDDY_PREFETCH_ITEMS_FILE;
      delete process.env.CODEBUDDY_PREFETCH;
      resetCrossChannelConversationBridge();
    }
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

    const send = makeSuccessfulSend();
    await manager.emit(makeMessage('next', 'sess-resume'), { type: 'telegram', send });

    // Session is restored before the turn and persisted again after the reply.
    expect(hoisted.saveSession).toHaveBeenCalledTimes(1);
    // Prior history was restored into the agent before the new turn.
    expect(hoisted.convertMessagesToChatEntries).toHaveBeenCalledWith(priorMessages);
    expect(hoisted.setMessages).toHaveBeenCalledWith([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
    expect(hoisted.processUserMessage).toHaveBeenCalledWith('next', {
      surface: 'telegram',
    });
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
      await manager.emit(makeMessage('hello', 'sess-route', 'bot1'), { send: makeSuccessfulSend() });

      expect(hoisted.constructorCalls).toHaveLength(1);
      expect(hoisted.constructorCalls[0]![2]).toBe('route-m');
    });

    it('the persona model beats the merged route-default model', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue(null); // no explicit route match
      hoisted.getRouteAgentConfig.mockReturnValue({ model: 'default-m', maxToolRounds: 5 });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(makeMessage('hello', 'sess-persona', 'bot1'), { send: makeSuccessfulSend() });

      expect(hoisted.constructorCalls[0]![2]).toBe('persona-m');
    });

    it('a router-default matchType stays in the route-default tier (persona wins)', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue({ matchType: 'default', agent: { model: 'default-m' } });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(makeMessage('hello', 'sess-dflt', 'bot1'), { send: makeSuccessfulSend() });

      expect(hoisted.constructorCalls[0]![2]).toBe('persona-m');
    });

    it('/model <name> sets a session override that beats every channel tier', async () => {
      registerChannelBotPersona('bot1', { model: 'persona-m' });
      hoisted.resolveRoute.mockReturnValue({ matchType: 'peer', agent: { model: 'route-m' } });

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = makeSuccessfulSend();

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
      const send = makeSuccessfulSend();

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
      const send = makeSuccessfulSend();
      await manager.emit(makeMessage('/model', 'sess-show', 'bot1'), { send });

      expect(hoisted.processUserMessage).not.toHaveBeenCalled();
      const reply = send.mock.calls[0][0].content as string;
      expect(reply).toContain('persona-m');
      expect(reply).toContain('persona');
    });

    it('reconciles a cached agent via setModel instead of rebuilding it', async () => {
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const send = makeSuccessfulSend();

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
      const send = makeSuccessfulSend();

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
      await manager.emit(makeMessage('hello', 'sess-sp', 'bot1'), { send: makeSuccessfulSend() });

      const args = hoisted.constructorCalls[0]!;
      const append = String(args[7]);
      expect(append).toContain('PERSONA-IDENTITY');
      expect(append).toContain('ROUTE-RULES');
      expect(append.indexOf('PERSONA-IDENTITY')).toBeLessThan(append.indexOf('ROUTE-RULES'));
      expect(args[8]).toBeUndefined();
    });

    it('uses a reviewed Lisa route on Telegram even with no global provider', async () => {
      registerChannelBotPersona('lisa-bot', { name: 'Lisa' });
      hoisted.resolveProviderFromEnv.mockReturnValue(null);
      hoisted.resolveCompanionModelRoute.mockResolvedValue({
        profileId: 'pilot-safe',
        surface: 'telegram',
        lane: 'deep',
        model: 'grok-reviewed',
        provider: 'grok-oauth',
        apiKey: 'subscription-token',
        baseURL: 'https://api.x.ai/v1',
        reason: 'blind pilot',
      });
      process.env.CODEBUDDY_PREFETCH = 'false';

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(
        makeMessage('Pourquoi la conscience est-elle difficile à définir ?', 'sess-lisa', 'lisa-bot'),
        { type: 'telegram', send: makeSuccessfulSend() },
      );

      expect(hoisted.resolveCompanionModelRoute).toHaveBeenCalledWith({
        surface: 'telegram',
        text: 'Pourquoi la conscience est-elle difficile à définir ?',
        history: [],
        env: process.env,
      });
      expect(hoisted.constructorCalls[0]?.slice(0, 3)).toEqual([
        'subscription-token',
        'https://api.x.ai/v1',
        'grok-reviewed',
      ]);
      expect(hoisted.processUserMessage).toHaveBeenCalledTimes(1);
    });

    it('reviews a Lisa turn on the same endpoint that created the companion agent', async () => {
      registerChannelBotPersona('lisa-bot', { name: 'Lisa' });
      hoisted.resolveProviderFromEnv.mockReturnValue({
        apiKey: 'global-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-global',
      });
      hoisted.resolveCompanionModelRoute.mockResolvedValue({
        profileId: 'pilot-grok',
        surface: 'telegram',
        lane: 'deep',
        model: 'grok-reviewed',
        provider: 'grok-oauth',
        apiKey: 'subscription-token',
        baseURL: 'https://api.x.ai/v1',
        reason: 'blind pilot',
      });
      process.env.CODEBUDDY_PREFETCH = 'false';

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(
        makeMessage(
          'Pourquoi la conscience est-elle difficile à définir ?',
          'sess-lisa-provider-match',
          'lisa-bot',
        ),
        { type: 'telegram', send: makeSuccessfulSend() },
      );

      expect(hoisted.constructorCalls[0]?.slice(0, 3)).toEqual([
        'subscription-token',
        'https://api.x.ai/v1',
        'grok-reviewed',
      ]);
      expect(hoisted.reviewSemanticResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          mainProvider: {
            apiKey: 'subscription-token',
            baseURL: 'https://api.x.ai/v1',
            model: 'grok-reviewed',
          },
        }),
      );
    });

    it('keeps a Lisa persona model pin above the reviewed profile', async () => {
      registerChannelBotPersona('lisa-bot', { name: 'Lisa', model: 'manual-model' });
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(
        makeMessage('Pourquoi cette idée compte-t-elle ?', 'sess-lisa-pin', 'lisa-bot'),
        { type: 'telegram', send: makeSuccessfulSend() },
      );

      expect(hoisted.resolveCompanionModelRoute).not.toHaveBeenCalled();
      expect(hoisted.constructorCalls[0]?.[2]).toBe('manual-model');
    });

    it('routes a cold Telegram follow-up from its persisted philosophical history', async () => {
      registerChannelBotPersona('lisa-bot', { name: 'Lisa' });
      hoisted.sessions.set('sess-cold-deep', {
        id: 'sess-cold-deep',
        messages: [
          { type: 'user', content: 'Le libre arbitre peut-il survivre au déterminisme ?' },
          {
            type: 'assistant',
            content: 'Il peut subsister comme capacité de délibérer sur nos raisons.',
          },
        ],
      });
      hoisted.resolveCompanionModelRoute.mockResolvedValue({
        profileId: 'pilot-safe',
        surface: 'telegram',
        lane: 'deep',
        model: 'grok-reviewed',
        provider: 'grok-oauth',
        apiKey: 'subscription-token',
        baseURL: 'https://api.x.ai/v1',
        reason: 'blind pilot',
      });
      process.env.CODEBUDDY_PREFETCH = 'false';

      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      await manager.emit(
        makeMessage('Et la réciprocité ?', 'sess-cold-deep', 'lisa-bot'),
        { type: 'telegram', send: makeSuccessfulSend() },
      );

      expect(hoisted.resolveCompanionModelRoute).toHaveBeenCalledWith({
        surface: 'telegram',
        text: 'Et la réciprocité ?',
        history: [
          { role: 'user', content: 'Le libre arbitre peut-il survivre au déterminisme ?' },
          {
            role: 'assistant',
            content: 'Il peut subsister comme capacité de délibérer sur nos raisons.',
          },
        ],
        env: process.env,
      });
    });

    it('reuses an agent for a pilot model-only change but rebuilds on auth endpoint change', async () => {
      registerChannelBotPersona('lisa-bot', { name: 'Lisa' });
      const route = (model: string, apiKey: string, baseURL: string) => ({
        profileId: `pilot-${model}`,
        surface: 'telegram',
        lane: 'deep',
        model,
        provider: 'grok-oauth',
        apiKey,
        baseURL,
        reason: 'blind pilot',
      });
      hoisted.resolveCompanionModelRoute
        .mockResolvedValueOnce(route('pilot-a', 'same-key', 'https://same.example/v1'))
        .mockResolvedValueOnce(route('pilot-b', 'same-key', 'https://same.example/v1'))
        .mockResolvedValueOnce(route('pilot-c', 'renewed-key', 'https://new.example/v1'));
      process.env.CODEBUDDY_PREFETCH = 'false';
      const manager = makeManager();
      await registerAIMessageHandler(manager as any);
      const channel = { type: 'telegram', send: makeSuccessfulSend() };

      await manager.emit(makeMessage('Pourquoi A ?', 'sess-lisa-swap', 'lisa-bot'), channel);
      await manager.emit(makeMessage('Pourquoi B ?', 'sess-lisa-swap', 'lisa-bot'), channel);
      expect(hoisted.constructorCalls).toHaveLength(1);
      expect(hoisted.setModelCalls).toContain('pilot-b');

      await manager.emit(makeMessage('Pourquoi C ?', 'sess-lisa-swap', 'lisa-bot'), channel);
      expect(hoisted.constructorCalls).toHaveLength(2);
      expect(hoisted.constructorCalls[1]?.slice(0, 3)).toEqual([
        'renewed-key',
        'https://new.example/v1',
        'pilot-c',
      ]);
      expect(hoisted.setChatHistory).toHaveBeenCalled();
    });
  });
});
