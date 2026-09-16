import React, { useState, useRef } from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import { expect, it, vi } from 'vitest';
import { useInputHandler } from '../../src/hooks/use-input-handler.js';
import type { ChatEntry, CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';

vi.mock('../../src/utils/confirmation-service.js', () => ({ ConfirmationService: { getInstance: () => ({ getSessionFlags: () => ({ allOperations: false }) }) } }));
vi.mock('../../src/commands/slash-commands.js', () => ({ getSlashCommandManager: () => ({ getCommands: () => [] }) }));
vi.mock('../../src/commands/client-dispatcher.js', () => ({ ClientCommandDispatcher: { dispatch: vi.fn() } }));
vi.mock('../../src/input/text-to-speech.js', () => ({ getTTSManager: () => ({ getConfig: () => ({ autoSpeak: false }) }) }));
vi.mock('../../src/goals/goal-loop.js', () => ({ maybeContinueGoalAfterTurn: vi.fn(async () => null) }));
vi.mock('../../src/utils/history-manager.js', () => ({ getHistoryManager: () => ({ add: vi.fn() }) }));
vi.mock('../../src/logging/interaction-logger.js', () => ({ getInteractionLogger: () => ({ getCurrentSessionId: () => null }) }));
vi.mock('../../src/ui/components/CommandSuggestions.js', () => ({ filterCommandSuggestions: () => [] }));
vi.mock('../../src/ui/components/FileAutocomplete.js', () => ({ extractFileReference: () => ({ found: false }), getFileSuggestions: () => [] }));
vi.mock('../../src/utils/model-config.js', () => ({ loadModelConfig: () => [] }));

it('queues turns in order and preserves the next draft while the queued turn starts', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
  stdout.resume();
  const calls: string[] = [];
  const events: string[] = [];
  const release: Array<() => void> = [];
  const agent = {
    async *processUserMessageStream(text: string) {
      calls.push(text);
      events.push(`turn:${text}`);
      await new Promise<void>(resolve => release.push(resolve));
      yield { type: 'done' };
    },
    getClient: () => ({}),
    // Lot 2 A: each finished turn is persisted before a queued turn starts.
    persistInteractiveSession: async () => { events.push('persist'); },
  } as unknown as CodeBuddyAgent;
  let editor: ReturnType<typeof useInputHandler>;
  function App() {
    const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    editor = useInputHandler({ agent, chatHistory, setChatHistory, isProcessing, setIsProcessing,
      isStreaming, setIsStreaming, setTokenCount() {}, setProcessingTime() {}, processingStartTime: useRef(0) });
    return <Text>{editor.input}</Text>;
  }
  const app = render(<App />, { stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false });
  try {
    await vi.waitFor(() => expect(editor!).toBeDefined());
    const first = editor!.handleInputSubmit('first');
    await vi.waitFor(() => expect(calls).toEqual(['first']));
    await editor!.handleInputSubmit('second');
    await vi.waitFor(() => expect(editor!.queuedMessageCount).toBe(1));
    stdin.write('next draft');
    await vi.waitFor(() => expect(editor!.input).toBe('next draft'));
    release[0]!();
    await first;
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));
    expect(editor!.input).toBe('next draft');
    expect(editor!.queuedMessageCount).toBe(0);
    release[1]!();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await vi.waitFor(() => expect(events).toEqual(['turn:first', 'persist', 'turn:second', 'persist']));
  } finally {
    release.forEach(resolve => resolve());
    app.unmount();
    stdin.destroy(); stdout.destroy();
  }
});
