import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// A subprocess deliberately uses real React + Ink, without the legacy test mocks.
// No provider or service is started; all history and theme files stay in a fixture home.
it('edits and submits through real Ink, including burst input and Windows line endings', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'buddy-ink-input-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const hook = new URL('../../src/hooks/use-enhanced-input.ts', import.meta.url).href;
  const theme = new URL('../../src/ui/context/theme-context.tsx', import.meta.url).href;
  const composer = new URL('../../src/ui/components/ChatInput.tsx', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { PassThrough } from 'node:stream';
    import React from 'react';
    import { render, useInput } from 'ink';
    import { useEnhancedInput } from ${JSON.stringify(hook)};
    import { ThemeProvider } from ${JSON.stringify(theme)};
    import { ChatInput } from ${JSON.stringify(composer)};
    const stdin = new PassThrough();
    Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
    const stdout = new PassThrough();
    Object.assign(stdout, { columns: 72, rows: 24, isTTY: true });
    let output = '';
    stdout.on('data', data => { output += data; });
    const submitted = [];
    let editor;
    function App() {
      editor = useEnhancedInput({ onSubmit: text => submitted.push(text), multiline: true });
      useInput(editor.handleInput);
      return React.createElement(ThemeProvider, null, React.createElement(ChatInput, {
        input: editor.input, cursorPosition: editor.cursorPosition,
        isProcessing: false, isStreaming: false,
      }));
    }
    const app = render(React.createElement(App), { stdin, stdout, stderr: stdout, debug: true, patchConsole: false });
    const tick = () => new Promise(resolve => setTimeout(resolve, 30));
    try {
      await tick();
      // Multiple calls before React renders must preserve every character and Enter.
      editor.handleInput('b', {});
      editor.handleInput('o', {});
      editor.handleInput('n', {});
      editor.handleInput('', { return: true });
      assert.deepEqual(submitted, ['bon']);
      await tick();
      stdin.write('bonjour'); await tick();
      stdin.write('\\r'); await tick();
      assert.equal(submitted[1], 'bonjour');
      stdin.write('salut'); await tick();
      stdin.write('\\r\\n'); await tick();
      assert.equal(submitted[2], 'salut');
      stdin.write('premiere\\r\\ndeuxieme'); await tick();
      assert.equal(editor.input, 'premiere\\ndeuxieme');
      assert.equal(submitted.length, 3, 'paste must not execute');
      stdin.write('\\r'); await tick();
      assert.equal(submitted[3], 'premiere\\ndeuxieme');
      editor.handleInput('ligne', {});
      await tick();
      stdin.write('\\x0a'); await tick();
      editor.handleInput('suite', {});
      await tick();
      assert.equal(editor.input, 'ligne\\nsuite');
      stdin.write('\\x1b[A'); await tick();
      stdin.write('!'); await tick();
      assert.equal(editor.input, 'ligne!\\nsuite');
      assert.equal(submitted.length, 4);
      assert.ok(output.includes('Message'));
      assert.ok(output.includes('2 lines'));
      assert.ok(output.includes('ligne'));
      app.unmount(); await tick();
      console.log('INK_INPUT_OK');
    } finally { app.unmount(); stdin.destroy(); stdout.destroy(); }
  `;
  try {
    const result = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'), CODEBUDDY_HEADLESS: 'true', NO_COLOR: '1' },
    });
    expect(result).toContain('INK_INPUT_OK');
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 20_000);
