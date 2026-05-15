import { execFileSync, execSync } from 'child_process';
import { SystemControl } from '../../src/desktop-automation/system-control.js';

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
    execFileSync: vi.fn(),
    execSync: vi.fn(),
  };
});

type TestPlatform = 'darwin' | 'linux' | 'win32';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExecSync = vi.mocked(execSync);

function createControl(platform: TestPlatform): SystemControl {
  const control = new SystemControl();
  (control as unknown as { platform: TestPlatform }).platform = platform;
  return control;
}

describe('SystemControl native data boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('brightness', () => {
    it('rejects macOS brightness reads when the native command fails', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('brightness unavailable');
      });

      await expect(createControl('darwin').getBrightness()).rejects.toThrow(
        'Failed to get macOS brightness'
      );
    });

    it('rejects Linux brightness reads when backlight values are unavailable', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('no backlight');
      });

      await expect(createControl('linux').getBrightness()).rejects.toThrow(
        'Failed to get Linux brightness'
      );
    });

    it('rejects Windows brightness reads when WMI is unavailable', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('WMI unavailable');
      });

      await expect(createControl('win32').getBrightness()).rejects.toThrow(
        'Failed to get Windows brightness'
      );
    });

    it('rejects Linux brightness writes when xrandr and brightnessctl both fail', async () => {
      mockExecSync.mockImplementation((command) => {
        if (String(command).includes('xrandr --query')) {
          throw new Error('xrandr unavailable');
        }
        if (String(command).includes('brightnessctl')) {
          throw new Error('brightnessctl unavailable');
        }
        return '';
      });

      await expect(createControl('linux').setBrightness(40)).rejects.toThrow(
        'Failed to set Linux brightness'
      );
    });

    it('uses real xrandr output before reporting Linux brightness writes as successful', async () => {
      mockExecSync.mockReturnValue('HDMI-1\n');
      mockExecFileSync.mockReturnValue(Buffer.from(''));

      await expect(createControl('linux').setBrightness(40)).resolves.toBeUndefined();

      expect(mockExecFileSync).toHaveBeenCalledWith('xrandr', [
        '--output',
        'HDMI-1',
        '--brightness',
        '0.4',
      ]);
    });
  });

  describe('volume', () => {
    it('rejects Windows volume reads instead of returning a fabricated default', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('audio module unavailable');
      });

      await expect(createControl('win32').getVolume()).rejects.toThrow(
        'Failed to get Windows volume'
      );
    });
  });

  describe('displays', () => {
    it('returns no Linux displays when xrandr cannot provide real display data', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('xrandr unavailable');
      });

      await expect(createControl('linux').getDisplays()).resolves.toEqual([]);
    });

    it('returns no macOS displays when system_profiler cannot provide real display data', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('system_profiler unavailable');
      });

      await expect(createControl('darwin').getDisplays()).resolves.toEqual([]);
    });

    it('returns no Windows displays when PowerShell cannot provide real display data', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('PowerShell unavailable');
      });

      await expect(createControl('win32').getDisplays()).resolves.toEqual([]);
    });

    it('filters Windows displays with missing resolution instead of inventing one', async () => {
      mockExecSync.mockReturnValue(JSON.stringify({
        Name: 'Virtual Adapter',
        CurrentHorizontalResolution: null,
        CurrentVerticalResolution: null,
        CurrentRefreshRate: null,
      }));

      await expect(createControl('win32').getDisplays()).resolves.toEqual([]);
    });
  });
});
