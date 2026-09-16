import React, { useState } from 'react';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, Text } from 'ink';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeManager, getThemeManager } from '../../src/themes/theme-manager.js';
import { ThemeProvider, useTheme } from '../../src/ui/context/theme-context.js';
import { handleTheme } from '../../src/commands/handlers/ui-handlers.js';
import { getRuntimeSettingsSnapshot, runtimeInspectionTools } from '../../src/services/runtime-settings-context.js';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'cb-theme-runtime-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  (ThemeManager as unknown as { instance?: ThemeManager }).instance = undefined;
});
afterEach(async () => {
  (ThemeManager as unknown as { instance?: ThemeManager }).instance = undefined;
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe('live theme and settings', () => {
  it('refreshes mounted Ink after an external slash command without remounting the draft', async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
    stdout.resume();
    let observed = '';
    let mounts = 0;
    function Probe() {
      const { theme, colors } = useTheme();
      const [draft] = useState(() => { mounts++; return 'keep my draft'; });
      observed = `${theme.id}:${colors.primary}:${draft}`;
      return <Text color={colors.primary}>{observed}</Text>;
    }
    const app = render(<ThemeProvider><Probe /></ThemeProvider>, { stdin, stdout, stderr: stdout, debug: true, exitOnCtrlC: false });
    try {
      await vi.waitFor(() => expect(observed).toContain('default:'));
      expect(handleTheme(['set', 'matrix']).entry?.content).toContain('active immediately');
      await vi.waitFor(() => expect(observed).toBe('matrix:greenBright:keep my draft'));
      expect(mounts).toBe(1);
      expect(handleTheme(['status']).entry?.content).toContain('Matrix (matrix)');
      expect(JSON.parse(await readFile(join(home, '.codebuddy/theme-preferences.json'), 'utf8')).activeTheme).toBe('matrix');
      (ThemeManager as unknown as { instance?: ThemeManager }).instance = undefined;
      expect(getThemeManager().getCurrentTheme().id).toBe('matrix');
    } finally { app.unmount(); stdin.end(); stdout.end(); }
  });

  it('reports live settings on demand, exposes no credentials, and does not borrow CLI state for HTTP', () => {
    vi.stubEnv('OPENAI_API_KEY', 'secret-must-not-leak');
    getThemeManager().setTheme('ocean');
    const snapshot = getRuntimeSettingsSnapshot({ surface: 'cli', model: 'gpt-5.5', provider: 'openai', maxToolRounds: 50 });
    expect(snapshot.theme?.active).toBe('ocean');
    expect(snapshot.model).toBe('gpt-5.5');
    expect(snapshot.fleet?.supported).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('secret-must-not-leak');
    expect(getRuntimeSettingsSnapshot({ surface: 'http' }).theme).toBeNull();
    getThemeManager().setTheme('neon');
    expect(getRuntimeSettingsSnapshot({ surface: 'cli' }).theme?.active).toBe('neon');
  });

  it('routes operational questions to their existing tools', () => {
    expect(runtimeInspectionTools('Y a-t-il d’autres Code Buddy actifs ?')).toContain('list_peers');
    expect(runtimeInspectionTools('Quels sont tes paramètres actuels ?')).toContain('self_describe');
    expect(runtimeInspectionTools('Corrige cette fonction')).toEqual([]);
  });
});
