import React from 'react';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink';
import { CommandSuggestions, filterCommandSuggestions } from '../../src/ui/components/CommandSuggestions.js';
import { getSlashCommandManager, resetSlashCommandManager } from '../../src/commands/slash-commands.js';
import { handleHelp } from '../../src/commands/handlers/core-handlers.js';

it('makes every help command, including custom commands, reachable from slash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cb-slash-parity-'));
  try {
    mkdirSync(join(root, '.codebuddy/commands'), { recursive: true });
    writeFileSync(join(root, '.codebuddy/commands/zz-review.md'), '# Local review\nReview this project.');
    const manager = getSlashCommandManager(root);
    const suggestions = manager.getCommands().map(cmd => ({ command: `/${cmd.name}`, description: cmd.description }));
    const help = (await handleHelp()).entry!.content;
    const helpCommands = [...help.matchAll(/^ {2}(\/[\w-]+)(?:\s|$)/gm)].map(match => match[1]);
    const menu = filterCommandSuggestions(suggestions, '/');
    expect(menu.length).toBeGreaterThan(15);
    expect(new Set(menu.map(item => item.command))).toEqual(new Set(helpCommands));
    expect(menu.some(item => item.command === '/zz-review')).toBe(true);
    expect(menu[0]?.command).toBe('/help');
  } finally { resetSlashCommandManager(); rmSync(root, { recursive: true, force: true }); }
});

it('keeps all matching results when a prefix has more than fifteen commands', () => {
  const suggestions = Array.from({ length: 32 }, (_, n) => ({ command: `/sample-${n}`, description: 'A command' }));
  expect(filterCommandSuggestions(suggestions, '/SAMPLE-')).toHaveLength(32);
});

it('scrolls the Ink window to the last command without rendering the whole catalog', async () => {
  const suggestions = Array.from({ length: 40 }, (_, n) => ({ command: `/sample-${n}`, description: 'A command' }));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 24 });
  let output = '';
  stdout.on('data', chunk => { output += chunk.toString(); });
  const app = render(<CommandSuggestions suggestions={suggestions} input="/" selectedIndex={39} isVisible />, { stdin, stdout, stderr: stdout, debug: true });
  try {
    await vi.waitFor(() => expect(output).toContain('/sample-39'));
    expect(output).toContain('40/40 commands');
    expect(output).not.toContain('/sample-0');
    expect(output).toContain('30 more above');
  } finally { app.unmount(); stdin.destroy(); stdout.destroy(); }
});
