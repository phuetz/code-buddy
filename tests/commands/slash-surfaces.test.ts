/** P4 — core per-surface availability declaration. */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  builtinCommands,
  CHANNEL_SLASH_SURFACES,
  channelPlatformsFor,
  COWORK_TOKEN_SURFACES,
  coworkHeadlessAllowlist,
  isEngineToken,
  resolveSlashAvailability,
  withAvailability,
} from '../../src/commands/slash/index.js';
import { EXPECTED_SLASH_COMMANDS } from '../../src/channels/slash-parity.js';

describe('slash surfaces (P4, core)', () => {
  it('keeps every builtin available in the CLI (terminal parity unchanged)', () => {
    const annotated = withAvailability(builtinCommands);
    expect(annotated).toHaveLength(builtinCommands.length);
    expect(annotated.every((c) => c.availability.cli.status === 'available')).toBe(true);
    expect(annotated.map((c) => c.name)).toEqual(builtinCommands.map((c) => c.name));
  });

  it('is default-deny for undeclared engine tokens in Cowork and forwards prompt commands', () => {
    expect(resolveSlashAvailability({ name: 'yolo', prompt: '__YOLO_MODE__' }, 'cowork')).toMatchObject({ status: 'unavailable' });
    expect(resolveSlashAvailability({ name: 'stats', prompt: '__STATS__' }, 'cowork')).toEqual({ status: 'available' });
    expect(resolveSlashAvailability({ name: 'explain', prompt: 'Explain this code' }, 'cowork')).toEqual({ status: 'available' });
  });

  it('command declarations can restrict but never widen a surface', () => {
    const widened = resolveSlashAvailability({ name: 'yolo', prompt: '__YOLO_MODE__', surfaces: { cowork: { status: 'available' } } }, 'cowork');
    expect(widened.status).toBe('unavailable');
    const hidden = resolveSlashAvailability({ name: 'explain', prompt: 'Explain', surfaces: { cowork: { status: 'hidden' } } }, 'cowork');
    expect(hidden).toEqual({ status: 'hidden' });
    const cliRestricted = resolveSlashAvailability({ name: 'x', prompt: '__STATS__', surfaces: { cli: { status: 'unavailable', reason: 'GUI only' } } }, 'cli');
    expect(cliRestricted).toEqual({ status: 'unavailable', reason: 'GUI only' });
  });

  it('declares only real engine tokens and a minimal headless allowlist', () => {
    const catalogTokens = new Set(builtinCommands.map((c) => c.prompt).filter(isEngineToken));
    const unknown = Object.keys(COWORK_TOKEN_SURFACES).filter((t) => !catalogTokens.has(t));
    // __BATCH_REVIEW__ is a Cowork-side effect kept for compatibility (no catalog entry today).
    expect(unknown).toEqual(['__BATCH_REVIEW__']);
    expect([...coworkHeadlessAllowlist()].sort()).toEqual([
      '__COST__', '__DIFF__', '__EXPORT_FORMATS__', '__EXPORT_LIST__', '__FEATURES__', '__GOAL__', '__HELP__',
      '__HISTORY__', '__LOG__', '__QUOTA__', '__RESOURCES__', '__STATS__', '__STATUS__', '__SUBGOAL__', '__TOOLS__', '__WHOAMI__', '__WORKSPACE__',
    ]);
  });

  it('the offline slash wiki shows per-surface availability from the same declaration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-wiki-p4-'));
    try {
      const catalog = withAvailability(builtinCommands.filter((c) => ['yolo', 'stats'].includes(c.name)));
      fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog));
      execFileSync(process.execPath, ['scripts/generate-slash-wiki.mjs', '--catalog', path.join(dir, 'catalog.json'), '--output', path.join(dir, 'wiki')], { stdio: 'pipe' });
      const yolo = fs.readFileSync(path.join(dir, 'wiki', 'yolo.md'), 'utf8');
      const stats = fs.readFileSync(path.join(dir, 'wiki', 'stats.md'), 'utf8');
      expect(yolo).toContain('Cowork indisponible');
      expect(stats).toContain('Cowork disponible');
      expect(fs.readFileSync(path.join(dir, 'wiki', 'index.html'), 'utf8')).toContain('Disponibilité : terminal disponible');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('channel parity reads the same declaration: manifest unchanged from the base (non-regression)', () => {
    // Literal copy of EXPECTED_SLASH_COMMANDS at d17a21cba.
    const R = (name: string, description: string) => ({ name, description });
    const O = (name: string, description: string) => ({ name, description, required: false });
    expect(EXPECTED_SLASH_COMMANDS).toEqual({
      discord: [R('ask', 'Ask Code Buddy a question'), R('status', 'Show bot and channel status'), R('clear', 'Clear conversation history'), R('help', 'Show available commands'), R('model', 'Switch or show current model'), O('think', 'Set reasoning depth'), O('compact', 'Compact conversation context'), O('repo', 'Show repository info')],
      telegram: [R('ask', 'Ask Code Buddy a question'), R('status', 'Show bot and channel status'), R('clear', 'Clear conversation history'), R('help', 'Show available commands'), R('model', 'Switch or show current model'), O('yolo', 'Toggle YOLO mode'), O('repo', 'Show repository info'), O('branch', 'Show branch info')],
      slack: [R('ask', 'Ask Code Buddy a question'), R('status', 'Show bot and channel status'), R('clear', 'Clear conversation history'), R('help', 'Show available commands'), R('model', 'Switch or show current model'), O('compact', 'Compact conversation context'), O('think', 'Set reasoning depth')],
      matrix: [R('ask', 'Ask Code Buddy a question'), R('status', 'Show bot and channel status'), R('clear', 'Clear conversation history'), R('help', 'Show available commands'), O('model', 'Switch or show current model')],
    });
  });

  it('invariant: a channel command is either a real builtin or explicitly channel-only', () => {
    const builtinNames = new Set(builtinCommands.map((c) => c.name));
    for (const [platform, specs] of Object.entries(CHANNEL_SLASH_SURFACES)) {
      for (const spec of specs) {
        const ok = spec.channelOnly ? !builtinNames.has(spec.name) : builtinNames.has(spec.name);
        expect({ platform, name: spec.name, ok }).toEqual({ platform, name: spec.name, ok: true });
      }
    }
    const status = withAvailability(builtinCommands).find((c) => c.name === 'status');
    expect(status?.channelPlatforms).toEqual(['discord', 'telegram', 'slack', 'matrix']);
    expect(channelPlatformsFor({ name: 'status', surfaces: { channels: { status: 'unavailable', reason: 'x' } } })).toEqual([]);
    expect(channelPlatformsFor({ name: 'ask' })).toEqual([]);
  });
});
