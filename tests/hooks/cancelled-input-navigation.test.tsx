import React from 'react';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { render, Text } from 'ink';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEnhancedInput, type Key } from '../../src/hooks/use-enhanced-input.js';
import { HistoryManager } from '../../src/utils/history-manager.js';

// Use the real reverse-search engine, with all of its files in a disposable profile.
let historyManager: HistoryManager;
vi.mock('../../src/utils/history-manager.js', async () => ({
  ...await vi.importActual<typeof import('../../src/utils/history-manager.js')>('../../src/utils/history-manager.js'),
  getHistoryManager: () => historyManager,
}));
let profile: string;
const mounted: Array<() => void> = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
beforeEach(() => {
  profile = mkdtempSync(path.join(tmpdir(), 'buddy-draft-navigation-'));
  historyManager = new HistoryManager({ historyFile: path.join(profile, 'history.json') });
});
afterEach(() => {
  mounted.splice(0).forEach(close => close());
  rmSync(profile, { recursive: true, force: true });
});

async function mount() {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 24 });
  stdout.resume();
  const onEmptyInterrupt = vi.fn();
  const onSubmit = vi.fn();
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
    type: (text: string) => key(text), cancel: () => key('c', { ctrl: true }),
    up: () => key('', { upArrow: true }), down: () => key('', { downArrow: true }),
    search: () => key('r', { ctrl: true }), send: () => key('', { return: true }),
    clear: async () => { editor!.clearInput(); await tick(); },
  };
}

it('B1: Down preserves a restored single-line draft at the end of history', async () => {
  const app = await mount();
  await app.type('single line'); await app.cancel(); await app.up(); await app.down();
  expect(app.editor().input).toBe('single line');
  expect(app.editor().cursorPosition).toBe(11);
});

it('B1: Down moves within a restored multiline draft instead of navigating history', async () => {
  const app = await mount();
  await app.type('abc\ndef'); await app.cancel(); await app.up();
  await app.key('a', { ctrl: true });
  await app.down();
  expect(app.editor().input).toBe('abc\ndef');
  expect(app.editor().cursorPosition).toBe(4);
});

it('a no-op Down after multiline restoration preserves the next Up into history', async () => {
  const app = await mount();
  await app.type('sent'); await app.send();
  await app.type('abc\ndef'); await app.cancel(); await app.up();
  await app.down();
  expect(app.editor().input).toBe('abc\ndef');
  expect(app.editor().cursorPosition).toBe(7);
  await app.up();
  expect(app.editor().input).toBe('sent');
  expect(app.editor().cursorPosition).toBe(4);
});

it('moving Left after multiline restoration resumes Up within the draft', async () => {
  const app = await mount();
  await app.type('sent'); await app.send();
  await app.type('abc\ndef'); await app.cancel(); await app.up();
  await app.key('', { leftArrow: true });
  expect(app.editor().cursorPosition).toBe(6);
  await app.up();
  expect(app.editor().input).toBe('abc\ndef');
  expect(app.editor().cursorPosition).toBe(2);
});

it('B2: Down returns to the restored draft after visiting sent-message history', async () => {
  const app = await mount();
  await app.type('sent'); await app.send();
  const draft = 'work\n@image.png';
  await app.type(draft); await app.cancel(); await app.up();
  await app.up(); expect(app.editor().input).toBe('sent');
  await app.down();
  expect(app.editor().input).toBe(draft);
  expect(app.editor().cursorPosition).toBe(draft.length);
});

it('B3: Ctrl+C cancels reverse search and returns the original text, preserving a pending cancelled draft', async () => {
  historyManager.add('npm start');
  const app = await mount();
  await app.type('previous cancelled draft'); await app.cancel();
  await app.type('mon travail');
  await app.key('a', { ctrl: true });
  await app.search(); await app.type('n');
  expect(app.editor().input).toBe('npm start');
  await app.cancel();
  expect(app.editor().isReverseSearchActive).toBe(false);
  expect(app.editor().input).toBe('mon travail');
  expect(app.editor().cursorPosition).toBe(0);
  expect(app.onEmptyInterrupt).not.toHaveBeenCalled();
  await app.clear(); await app.up();
  expect(app.editor().input).toBe('previous cancelled draft');
});

it('B4: Ctrl+C on an empty reverse search cancels the search instead of exiting', async () => {
  const app = await mount();
  await app.search(); await app.cancel();
  expect(app.onEmptyInterrupt).not.toHaveBeenCalled();
  expect(app.editor().isReverseSearchActive).toBe(false);
  expect(historyManager.isReverseSearchActive()).toBe(false);
  expect(app.editor().input).toBe('');
});

it('B4: burst Ctrl+R then raw Ctrl+C cancels using the same render callback', async () => {
  const app = await mount();
  // Keep the same render's closure even if Ink synchronously re-renders.
  const handleInput = app.editor().handleInput;
  handleInput('r', { ctrl: true });
  handleInput('\x03', {});
  await tick();
  expect(app.onEmptyInterrupt).not.toHaveBeenCalled();
  expect(app.editor().isReverseSearchActive).toBe(false);
});

it('sending another message consumes the cancellation independently of normal history', async () => {
  const app = await mount();
  await app.type('cancelled'); await app.cancel();
  await app.type('sent'); await app.send();
  app.editor().resetHistory(); await tick(); await app.up();
  expect(app.editor().input).toBe('');
  expect(app.onSubmit).toHaveBeenCalledExactlyOnceWith('sent');
});

it('Escape cancels reverse search before editor shortcuts', async () => {
  historyManager.add('npm start');
  const app = await mount();
  await app.type('work'); await app.search(); await app.type('n');
  await app.key('', { escape: true });
  expect(app.editor().input).toBe('work');
  expect(app.editor().isReverseSearchActive).toBe(false);
});

it('Enter accepts the reverse-search match without submitting it', async () => {
  historyManager.add('npm start');
  const app = await mount();
  await app.type('work'); await app.search(); await app.type('n'); await app.send();
  expect(app.editor().input).toBe('npm start');
  expect(app.editor().isReverseSearchActive).toBe(false);
  expect(app.onSubmit).not.toHaveBeenCalled();
});

it('B2: a rapid Up/Down round trip preserves the restored draft', async () => {
  const app = await mount();
  await app.type('sent'); await app.send();
  await app.type('draft'); await app.cancel(); await app.up();
  app.editor().handleInput('', { upArrow: true });
  app.editor().handleInput('', { downArrow: true });
  await tick();
  expect(app.editor().input).toBe('draft');
});

it('Backspace edits the reverse-search query instead of deleting the displayed match', async () => {
  historyManager.add('npm start');
  const app = await mount();
  await app.type('work'); await app.search(); await app.type('n'); await app.type('p');
  await app.key('', { backspace: true });
  expect(historyManager.getReverseSearchState().query).toBe('n');
  expect(app.editor().input).toBe('npm start');
});

it('Left accepts a reverse-search match and moves within that accepted text', async () => {
  historyManager.add('npm start');
  const app = await mount();
  await app.type('work'); await app.search(); await app.type('n');
  await app.key('', { leftArrow: true });
  expect(app.editor().isReverseSearchActive).toBe(false);
  expect(app.editor().input).toBe('npm start');
  expect(app.editor().cursorPosition).toBe(8);
});
