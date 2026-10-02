import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSnapshotManager, type UIElement } from '../../src/desktop-automation/smart-snapshot.js';
const native = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('child_process', () => ({ exec: vi.fn(), execSync: vi.fn() }));
vi.mock('util', async () => ({ ...await vi.importActual('util'), promisify: () => native.run }));
interface Access {
  resolveAtspiPython(): string;
  detectLinuxATSPIElements(options: object): Promise<UIElement[]>;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('native AT-SPI state used by replay', () => {
  it.each([true, false, undefined])('uses native focus/enabled/showing=%s, never invents permission or focus', async state => {
    vi.stubEnv('DISPLAY', ':test');
    const manager = new SmartSnapshotManager() as unknown as Access;
    vi.spyOn(manager, 'resolveAtspiPython').mockReturnValue('python3');
    native.run.mockResolvedValue({ stdout: JSON.stringify([{
      role: 'entry', name: 'Name', windowTitle: 'Demo',
      focused: state, enabled: state, showing: state,
      bounds: { x: 10, y: 20, width: 100, height: 30 },
    }]) });
    const elements = await manager.detectLinuxATSPIElements({});
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ focused: state === true, enabled: state === true, visible: state === true,
      attributes: { source: 'at-spi', windowTitle: 'Demo', protected: false } });
    const command = native.run.mock.calls.at(-1)![0] as string;
    const encoded = command.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)![1]!;
    const script = Buffer.from(encoded, 'base64').toString();
    expect(script).toContain('obj.get_state_set().contains(Atspi.StateType.FOCUSED)');
    expect(script).toContain('obj.get_state_set().contains(Atspi.StateType.ENABLED)');
    expect(script).toContain('obj.get_state_set().contains(Atspi.StateType.SHOWING)');
  });
});

it.each([true, false, undefined])('maps UIA IsPassword=%s from native output, with complete window identity', async isPassword => {
  const manager = new SmartSnapshotManager() as unknown as {
    ensureBridgeCompiled(wsl: boolean): string | null;
    runPowerShellEncoded(script: string, options: object): Promise<string>;
    detectWindowsElements(options: object): Promise<UIElement[]>;
  };
  vi.spyOn(manager, 'ensureBridgeCompiled').mockReturnValue(null);
  const run = vi.spyOn(manager, 'runPowerShellEncoded').mockResolvedValue(JSON.stringify([
    { role: 'ControlType.Window', name: 'Demo', x: 0, y: 0, width: 100, height: 100, pid: 123, windowHandle: '42', windowIdentity: 'root', treeComplete: true },
    { role: 'ControlType.Edit', name: 'Credential', isPassword, x: 10, y: 10, width: 30, height: 20, pid: 123, windowHandle: '42', windowIdentity: 'root', treeComplete: true },
  ]));
  const elements = await manager.detectWindowsElements({});
  expect(elements[1]?.attributes).toMatchObject({ source: 'uia', protected: isPassword !== false,
    pid: 123, windowHandle: '42', windowIdentity: 'root', treeComplete: true });
  expect(run.mock.calls[0]?.[0]).toContain('isPassword = $element.Current.IsPassword');
  expect(run.mock.calls[0]?.[0]).toContain('$script:treeComplete = $false');
});
