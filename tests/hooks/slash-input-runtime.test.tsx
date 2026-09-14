import React, { useRef, useState } from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import { afterEach, expect, it, vi } from 'vitest';
import { useInputHandler } from '../../src/hooks/use-input-handler.js';
import { ModelSelection } from '../../src/ui/components/ModelSelection.js';
import { ClientCommandDispatcher } from '../../src/commands/client-dispatcher.js';
import type { ChatEntry, CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';

vi.mock('../../src/utils/confirmation-service.js', () => ({ ConfirmationService: { getInstance: () => ({ getSessionFlags: () => ({ allOperations: false }) }) } }));
vi.mock('../../src/commands/slash-commands.js', () => {
  const commands = ['help', 'model', 'mode', 'status', 'clear', 'cost', 'context', 'tools'].map(name => ({ name, description: name }));
  return { getSlashCommandManager: () => ({ getCommands: () => commands, getCommand: (name: string) => commands.find(c => c.name === name) }) };
});
vi.mock('../../src/commands/client-dispatcher.js', () => ({ ClientCommandDispatcher: { dispatch: vi.fn(async (input, context) => {
  if (input.trim() === '/model' || input.trim() === '/models') context.setShowModelSelection(true);
  context.clearInput();
  return true;
}) } }));
vi.mock('../../src/input/text-to-speech.js', () => ({ getTTSManager: () => ({ getConfig: () => ({ autoSpeak: false }) }) }));
vi.mock('../../src/utils/history-manager.js', () => ({ getHistoryManager: () => ({ add: vi.fn() }) }));
vi.mock('../../src/logging/interaction-logger.js', () => ({ getInteractionLogger: () => ({ getCurrentSessionId: () => null }) }));
vi.mock('../../src/ui/components/FileAutocomplete.js', () => ({ extractFileReference: () => ({ found: false }), getFileSuggestions: () => [] }));
vi.mock('../../src/utils/model-config.js', () => ({ loadModelConfig: () => [{ model: 'first-model' }, { model: 'second-model' }] }));
afterEach(() => vi.clearAllMocks());

function mount() {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
  stdout.resume();
  let editor: ReturnType<typeof useInputHandler>;
  function App() {
    const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    editor = useInputHandler({ agent: {} as CodeBuddyAgent, chatHistory, setChatHistory, isProcessing, setIsProcessing,
      isStreaming, setIsStreaming, setTokenCount() {}, setProcessingTime() {}, processingStartTime: useRef(0) });
    return <><Text>{editor.input}</Text><ModelSelection models={editor.availableModels} selectedIndex={editor.selectedModelIndex} isVisible={editor.showModelSelection} currentModel="first-model" /></>;
  }
  const app = render(<App />, { stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false });
  return { stdin, editor: () => editor!, close: () => { app.unmount(); stdin.destroy(); stdout.destroy(); } };
}

it.each(['/help', '/model', '/models', '/status', '/clear', '/cost', '/context', '/tools', '/model custom-model'])('submits %s with one Enter through real Ink', async command => {
  const app = mount();
  try {
    await vi.waitFor(() => expect(app.editor()).toBeDefined());
    app.stdin.write(command);
    await vi.waitFor(() => expect(app.editor().input).toBe(command));
    app.stdin.write('\r');
    await vi.waitFor(() => expect(ClientCommandDispatcher.dispatch).toHaveBeenCalledWith(command, expect.any(Object)));
    expect(ClientCommandDispatcher.dispatch).toHaveBeenCalledTimes(1);
  } finally { app.close(); }
});

it('completes with Tab without executing, then opens /model with Windows CRLF', async () => {
  const app = mount();
  try {
    await vi.waitFor(() => expect(app.editor()).toBeDefined());
    app.stdin.write('/mod');
    await vi.waitFor(() => expect(app.editor().showCommandSuggestions).toBe(true));
    app.stdin.write('\t');
    await vi.waitFor(() => expect(app.editor().input).toBe('/model '));
    expect(ClientCommandDispatcher.dispatch).not.toHaveBeenCalled();
    app.stdin.write('\r\n');
    await vi.waitFor(() => expect(ClientCommandDispatcher.dispatch).toHaveBeenCalledWith('/model ', expect.any(Object)));
  } finally { app.close(); }
});

it('executes the explicitly highlighted command after arrow navigation', async () => {
  const app = mount();
  try {
    await vi.waitFor(() => expect(app.editor()).toBeDefined());
    app.stdin.write('/mo');
    await vi.waitFor(() => expect(app.editor().showCommandSuggestions).toBe(true));
    app.stdin.write('\x1b[B');
    await vi.waitFor(() => expect(app.editor().selectedCommandIndex).toBe(1));
    app.stdin.write('\r');
    await vi.waitFor(() => expect(ClientCommandDispatcher.dispatch).toHaveBeenCalledWith('/mode', expect.any(Object)));
  } finally { app.close(); }
});

it('opens the model picker, selects with arrows/Enter and cancels with Escape', async () => {
  const app = mount();
  try {
    await vi.waitFor(() => expect(app.editor()).toBeDefined());
    app.stdin.write('/model');
    await vi.waitFor(() => expect(app.editor().input).toBe('/model'));
    app.stdin.write('\r');
    await vi.waitFor(() => expect(app.editor().showModelSelection).toBe(true));
    await vi.waitFor(() => expect(app.editor().input).toBe(''));
    app.stdin.write('\x1b[B');
    await vi.waitFor(() => expect(app.editor().selectedModelIndex).toBe(1));
    app.stdin.write('\r');
    await vi.waitFor(() => expect(ClientCommandDispatcher.dispatch).toHaveBeenCalledWith('/models second-model', expect.any(Object)));
    expect(app.editor().showModelSelection).toBe(false);
    app.stdin.write('/model');
    await vi.waitFor(() => expect(app.editor().input).toBe('/model'));
    app.stdin.write('\r');
    await vi.waitFor(() => expect(app.editor().showModelSelection).toBe(true));
    app.stdin.write('\x1b');
    await vi.waitFor(() => expect(app.editor().showModelSelection).toBe(false));
  } finally { app.close(); }
});
