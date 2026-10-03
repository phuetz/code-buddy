import React from 'react';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEnhancedInput, type Key } from '../../src/hooks/use-enhanced-input.js';

const persistentHistory = vi.hoisted(() => ({
  add: vi.fn(),
  startReverseSearch: vi.fn(),
  formatReverseSearchPrompt: vi.fn(() => 'search'),
  cancelReverseSearch: vi.fn(() => ''),
}));
vi.mock('../../src/utils/history-manager.js', () => ({ getHistoryManager: () => persistentHistory }));

const mounted: Array<() => void> = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
afterEach(() => {
  mounted.splice(0).forEach(close => close());
  vi.clearAllMocks();
});

async function mount() {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 24 });
  stdout.resume();
  const onSubmit = vi.fn();
  const onEmptyInterrupt = vi.fn();
  let editor: ReturnType<typeof useEnhancedInput>;
  function App() {
    editor = useEnhancedInput({ multiline: true, onSubmit, onEmptyInterrupt });
    return <Text>{editor.input}</Text>;
  }
  const app = render(<App />, { stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream, stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false, debug: true, patchConsole: false });
  mounted.push(() => { app.unmount(); stdin.destroy(); stdout.destroy(); });
  await tick();
  const key = async (text: string, key: Key = {}) => { editor!.handleInput(text, key); await tick(); };
  return { editor: () => editor!, key, onSubmit, onEmptyInterrupt,
    type: (text: string) => key(text),
    cancel: () => key('c', { ctrl: true }),
    up: () => key('', { upArrow: true }),
    down: () => key('', { downArrow: true }),
    send: () => key('', { return: true }),
    clear: async () => { editor!.clearInput(); await tick(); },
  };
}

describe('cancelled input draft (real React and history hooks)', () => {
  it('restores exact pasted multiline text and file references, with the cursor at the end', async () => {
    const app = await mount();
    const draft = '  texte collé 😀\n@captures/image.png\nfin  ';
    await app.type(draft);
    await app.cancel();
    expect(app.editor().input).toBe('');
    expect(app.editor().cursorPosition).toBe(0);
    expect(app.onSubmit).not.toHaveBeenCalled();
    expect(app.onEmptyInterrupt).not.toHaveBeenCalled();
    expect(persistentHistory.add).not.toHaveBeenCalled();
    await app.up();
    expect(app.editor().input).toBe(draft);
    expect(app.editor().cursorPosition).toBe(draft.length);
  });

  it('consumes the restored draft, even when it is subsequently cleared without sending', async () => {
    const app = await mount();
    await app.type('unique'); await app.cancel(); await app.up();
    expect(app.editor().input).toBe('unique');
    await app.clear(); await app.up();
    expect(app.editor().input).toBe('');
  });

  it('does not replace nonempty input with the cancelled draft', async () => {
    const app = await mount();
    await app.type('cancelled'); await app.cancel();
    await app.type('new input'); await app.up();
    expect(app.editor().input).toBe('new input');
    await app.clear(); await app.up();
    expect(app.editor().input).toBe('cancelled');
  });

  it('restores before history and uses normal Up/Down history on later presses', async () => {
    const app = await mount();
    await app.type('older'); await app.send();
    await app.type('latest'); await app.send();
    await app.type('cancelled\nmultiline'); await app.cancel();
    await app.up(); expect(app.editor().input).toBe('cancelled\nmultiline');
    await app.up(); expect(app.editor().input).toBe('latest');
    await app.up(); expect(app.editor().input).toBe('older');
    await app.down(); expect(app.editor().input).toBe('latest');
    await app.down(); expect(app.editor().input).toBe('cancelled\nmultiline');
    await app.up(); expect(app.editor().input).toBe('cancelled\nmultiline');
    expect(app.onSubmit.mock.calls).toEqual([['older'], ['latest']]);
  });

  it('starts at the most recent history entry after cancelling during navigation', async () => {
    const app = await mount();
    for (const text of ['oldest', 'middle', 'latest']) { await app.type(text); await app.send(); }
    await app.up(); await app.up();
    expect(app.editor().input).toBe('middle');
    await app.cancel(); await app.up();
    expect(app.editor().input).toBe('middle');
    await app.up(); expect(app.editor().input).toBe('latest');
  });

  it('sending another message discards the pending cancelled draft', async () => {
    const app = await mount();
    await app.type('cancelled'); await app.cancel();
    await app.type('sent'); await app.send(); await app.up();
    expect(app.editor().input).toBe('sent');
    expect(app.onSubmit).toHaveBeenCalledExactlyOnceWith('sent');
  });

  it('sending a restored draft adds it to normal history once', async () => {
    const app = await mount();
    await app.type('restored'); await app.cancel(); await app.up(); await app.send();
    expect(app.onSubmit).toHaveBeenCalledExactlyOnceWith('restored');
    await app.up(); expect(app.editor().input).toBe('restored');
    await app.down(); expect(app.editor().input).toBe('');
  });

  it('keeps only the latest cancellation and accepts whitespace-only drafts', async () => {
    const app = await mount();
    await app.type('first'); await app.cancel();
    await app.type(' \n  '); await app.cancel(); await app.up();
    expect(app.editor().input).toBe(' \n  ');
  });

  it('empty Ctrl+C requests exit without overwriting the pending draft', async () => {
    const app = await mount();
    await app.type('keep'); await app.cancel(); await app.cancel();
    expect(app.onEmptyInterrupt).toHaveBeenCalledTimes(1);
    await app.up(); expect(app.editor().input).toBe('keep');
  });

  it('handles raw Ctrl+C and burst cancellation/restoration before a React render', async () => {
    const app = await mount();
    app.editor().handleInput('burst\ntext', {});
    app.editor().handleInput('\x03', {});
    app.editor().handleInput('', { name: 'up' });
    await tick();
    expect(app.editor().input).toBe('burst\ntext');
    expect(app.editor().cursorPosition).toBe(10);
  });

  it('keeps normal multiline cursor movement after editing a restored draft', async () => {
    const app = await mount();
    await app.type('abc\ndef'); await app.cancel(); await app.up();
    await app.type('!'); await app.up();
    expect(app.editor().input).toBe('abc\ndef!');
    expect(app.editor().cursorPosition).toBe(3);
  });

  it('cancels reverse search without creating a cancelled draft', async () => {
    const app = await mount();
    await app.type('query'); await app.key('r', { ctrl: true });
    expect(app.editor().isReverseSearchActive).toBe(true);
    persistentHistory.cancelReverseSearch.mockReturnValueOnce('query');
    await app.cancel();
    expect(app.editor().isReverseSearchActive).toBe(false);
    expect(app.editor().reverseSearchPrompt).toBe('');
    expect(persistentHistory.cancelReverseSearch).toHaveBeenCalledTimes(1);
    expect(app.editor().input).toBe('query');
    await app.clear(); await app.up(); expect(app.editor().input).toBe('');
  });
});

it('does not share the cancelled draft with another mounted editor', async () => {
  const first = await mount();
  await first.type('private draft'); await first.cancel();
  const second = await mount();
  await second.up();
  expect(second.editor().input).toBe('');
  await first.up();
  expect(first.editor().input).toBe('private draft');
});
