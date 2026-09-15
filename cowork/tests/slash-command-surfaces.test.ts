/**
 * P4 — per-surface availability: one core declaration drives the Cowork allowlist,
 * the palette state and server-side refusals.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const headlessCalls: string[] = [];

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async (modPath: string) => {
    if (modPath === 'commands/slash/index.js') {
      return await import('../../src/commands/slash/index');
    }
    if (modPath === 'utils/first-use-hints.js') {
      return await import('../../src/utils/first-use-hints');
    }
    if (modPath === 'commands/headless-slash.js') {
      return {
        executeHeadlessSlashToken: async (token: string, _args: string[], allow: ReadonlySet<string>) => {
          headlessCalls.push(token);
          if (!allow.has(token)) return { handled: true, denied: true };
          return { handled: true, output: `ran ${token}` };
        },
      };
    }
    return null;
  }),
}));

vi.mock('../src/main/commands/custom-commands-service', () => ({
  getCustomCommandsService: () => ({ list: () => [] }),
}));

import { COWORK_UI_EFFECT_TOKENS, SlashCommandBridge } from '../src/main/commands/slash-command-bridge';
import {
  builtinCommands,
  coworkHeadlessAllowlist,
  coworkUiEffectTokens,
  isEngineToken,
} from '../../src/commands/slash/index';
import { nextEnabledIndex, paletteItemState } from '../src/renderer/commands/slash-availability';

describe('slash surfaces (P4)', () => {
  let hintsDir: string;
  beforeEach(() => {
    headlessCalls.length = 0;
    hintsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-hints-'));
    vi.stubEnv('CODEBUDDY_HINTS_DIR', hintsDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(hintsDir, { recursive: true, force: true });
  });

  it('first refusal carries one persisted tip; later refusals do not repeat it', async () => {
    const bridge = new SlashCommandBridge();
    const first = await bridge.execute('yolo', ['on']);
    expect(first.message).toContain('Astuce : les commandes grisées');
    const second = await bridge.execute('memory', []);
    expect(second.message).toMatch(/pas encore pilotable/);
    expect(second.message).not.toContain('Astuce');
    expect(fs.readdirSync(hintsDir)).toEqual(['surface_unavailable']);
    expect(headlessCalls).toEqual([]);
  });

  it('invariant: core ui_effect declarations equal the bridge effect table', () => {
    expect([...coworkUiEffectTokens()].sort()).toEqual([...COWORK_UI_EFFECT_TOKENS].sort());
  });

  it('invariant: Cowork-available builtins = prompt commands ∪ headless allowlist ∪ native effects', async () => {
    const bridge = new SlashCommandBridge();
    const listed = await bridge.listCommands();
    const allow = coworkHeadlessAllowlist();
    const effects = new Set(COWORK_UI_EFFECT_TOKENS);
    const expectedAvailable = builtinCommands
      .filter((c) => !isEngineToken(c.prompt) || allow.has(c.prompt) || effects.has(c.prompt))
      .map((c) => c.name)
      .sort();
    const actualAvailable = listed
      .filter((c) => c.isBuiltin && c.availability?.status === 'available' && !['schedule', 'deep'].includes(c.name))
      .map((c) => c.name)
      .sort();
    expect(actualAvailable).toEqual([...new Set(expectedAvailable)].sort());
    const yolo = listed.find((c) => c.name === 'yolo');
    expect(yolo?.availability).toMatchObject({ status: 'unavailable' });
    expect(paletteItemState(yolo!)).toMatchObject({ disabled: true });
    expect(paletteItemState(yolo!).reason).toMatch(/terminal/);
  });

  it('a new token without declaration is unavailable and never reaches the engine', async () => {
    const bridge = new SlashCommandBridge();
    bridge.listCommands = async () => [
      { name: 'brand-new', description: 'x', prompt: '__BRAND_NEW__', isBuiltin: true },
      { name: 'stats', description: 'x', prompt: '__STATS__', isBuiltin: true },
    ];
    const denied = await bridge.execute('brand-new', []);
    expect(denied.handled).toBe(true);
    expect(denied.message).toMatch(/pas encore pilotable/);
    expect(headlessCalls).toEqual([]);
    const allowed = await bridge.execute('stats', []);
    expect(allowed.output).toBe('ran __STATS__');
    expect(headlessCalls).toEqual(['__STATS__']);
  });

  it('a forged IPC execute of /yolo is refused server-side without calling the engine', async () => {
    const bridge = new SlashCommandBridge();
    // A renderer cannot widen availability: even if it claimed "available", execute re-derives it.
    const catalog = await bridge.listCommands();
    bridge.listCommands = async () => catalog.map((c) => ({ ...c, availability: { status: 'available' as const } }));
    const result = await bridge.execute('yolo', ['on']);
    expect(result.handled).toBe(true);
    expect(result.message).toMatch(/yolo .*pas encore pilotable/);
    expect(result.action).toBeUndefined();
    expect(headlessCalls).toEqual([]);
  });

  it('palette navigation skips disabled entries', () => {
    const items = [
      { availability: { status: 'available' as const } },
      { availability: { status: 'unavailable' as const, reason: 'r' } },
      { availability: { status: 'available' as const } },
    ];
    expect(nextEnabledIndex(items, 0, 1)).toBe(2);
    expect(nextEnabledIndex(items, 2, -1)).toBe(0);
    expect(paletteItemState({})).toEqual({ disabled: false });
  });
});
