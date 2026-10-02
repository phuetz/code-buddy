import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LinuxNativeProvider } from '../../src/desktop-automation/linux-native-provider.js';
import { MacOSNativeProvider } from '../../src/desktop-automation/macos-native-provider.js';
import { NutJsProvider } from '../../src/desktop-automation/nutjs-provider.js';
const keyboard = vi.hoisted(() => ({ pressKey: vi.fn(), releaseKey: vi.fn() }));
vi.mock('@nut-tree-fork/nut-js', () => ({ Key: { Space: 1, Enter: 2, A: 3 }, keyboard }));

describe('Grok native provider data boundary', () => {
  let directory: string; let provider: LinuxNativeProvider;
  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'native-data-guard-'));
    const script = `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.ARGV_FILE, JSON.stringify(process.argv.slice(2))+'\\n');\n`;
    writeFileSync(path.join(directory, 'xdotool'), script, { mode: 0o755 });
    vi.stubEnv('PATH', `${directory}:${process.env.PATH}`);
    vi.stubEnv('ARGV_FILE', path.join(directory, 'argv.jsonl'));
    vi.stubEnv('XDG_SESSION_TYPE', 'x11'); vi.clearAllMocks();
    provider = new LinuxNativeProvider(); await provider.initialize();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); });
  it('Grok xdotool type treats command substitutions and backticks as literal argv', async () => {
    const marker = path.join(directory, 'shell-was-run');
    const text = `$(touch '${marker}')\`touch '${marker}'\`"\\`;
    await provider.type(text);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(readFileSync(process.env.ARGV_FILE!, 'utf8').trim())).toEqual(['type', '--delay', '30', '--', text]);
  });
  it.each(['keyPress', 'keyDown', 'keyUp'] as const)('Grok xdotool %s rejects shell/option syntax', async method => {
    const marker = path.join(directory, 'key-was-run');
    await expect(provider[method](`a; touch '${marker}'`)).rejects.toThrow(/Invalid/);
    expect(existsSync(marker)).toBe(false); expect(existsSync(process.env.ARGV_FILE!)).toBe(false);
  });
  it.each(['getWindow', 'focusWindow', 'closeWindow'] as const)('Grok window %s validates handle before any process', async method => {
    const marker = path.join(directory, 'handle-was-run');
    await expect(provider[method](`123; touch '${marker}'`)).rejects.toThrow(/Invalid/);
    expect(existsSync(marker)).toBe(false); expect(existsSync(process.env.ARGV_FILE!)).toBe(false);
  });
  it('Grok Linux drag rejects coordinates read as strings from macro JSON', async () => {
    const marker = path.join(directory, 'drag-was-run');
    const x = JSON.parse(JSON.stringify(`0; touch '${marker}'; xdotool mousemove 0`)) as number;
    await expect(provider.drag(x, 0, 0, 0)).rejects.toThrow(/integers/);
    expect(existsSync(marker)).toBe(false); expect(existsSync(process.env.ARGV_FILE!)).toBe(false);
  });
  it('Grok macOS drag rejects macro string coordinates before shell', async () => {
    const mac = new MacOSNativeProvider();
    Object.assign(mac, { initialized: true, hasCliclick: true });
    const effect = vi.spyOn(mac as unknown as { exec(cmd: string): Promise<string> }, 'exec').mockResolvedValue('');
    await expect(mac.drag('0; injected' as unknown as number, 0, 0, 0)).rejects.toThrow(/integers/);
    expect(effect).not.toHaveBeenCalled();
  });
  it.each(['KP_Enter', 'unknown-key'])('Grok nut.js unknown %s never becomes Space', async key => {
    vi.stubEnv('CODEBUDDY_USE_REAL_NUTJS_IN_TESTS', '1');
    const nut = new NutJsProvider(); await nut.initialize();
    await expect(nut.keyPress(key)).rejects.toThrow(/Unsupported key/);
    expect(keyboard.pressKey).not.toHaveBeenCalled(); expect(keyboard.releaseKey).not.toHaveBeenCalled();
  });
  it('valid Linux input still reaches the argv actuator', async () => {
    await provider.drag(10, 20, 10, 20); await provider.keyPress('enter');
    const lines = readFileSync(process.env.ARGV_FILE!, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toEqual([['mousemove', '10', '20', 'mousedown', '1', 'mousemove', '10', '20', 'mouseup', '1'], ['key', 'Return']]);
  });
});
