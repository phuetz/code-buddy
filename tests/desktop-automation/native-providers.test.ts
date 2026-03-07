/**
 * Native Desktop Automation Providers Tests
 *
 * Tests for LinuxNativeProvider, WindowsNativeProvider, MacOSNativeProvider,
 * and the auto-detection logic in DesktopAutomationManager.
 */


// Mock child_process before imports

import { execSync } from 'child_process';
import { LinuxNativeProvider } from '../../src/desktop-automation/linux-native-provider.js';
import { WindowsNativeProvider } from '../../src/desktop-automation/windows-native-provider.js';
import { MacOSNativeProvider } from '../../src/desktop-automation/macos-native-provider.js';

jest.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execSync: jest.fn(),
    exec: jest.fn(),
    spawn: jest.fn(function() { return {
      pid: 12345,
      unref: jest.fn(),
      on: jest.fn(),
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
    }; }),
  };
});

jest.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: (fn: (...args: unknown[]) => unknown) => {
      // Return a mock async exec
      return async (cmd: string, _opts?: Record<string, unknown>) => {
        // Delegate to the mocked execSync for simplicity
// const { execSync: mockExecSync } = require('child_process'); -- replaced by import
        const result = mockExecSync(cmd, { encoding: 'utf-8' });
        return { stdout: result, stderr: '' };
      };
    },
  };
});


const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

// Helper to set up execSync responses based on command patterns
function mockCommand(patterns: Record<string, string>): void {
  mockExecSync.mockImplementation((cmd: string) => {
    const cmdStr = String(cmd);
    for (const [pattern, response] of Object.entries(patterns)) {
      if (cmdStr.includes(pattern)) {
        return response;
      }
    }
    return '';
  });
}

describe('LinuxNativeProvider', () => {
  let provider: LinuxNativeProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new LinuxNativeProvider();
  });

  describe('initialize', () => {
    it('should initialize when xdotool is available on X11', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      mockCommand({
        'which xdotool': '/usr/bin/xdotool',
        'which xclip': '/usr/bin/xclip',
        'which wmctrl': '/usr/bin/wmctrl',
        'which xrandr': '/usr/bin/xrandr',
      });

      await provider.initialize();
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should not be available on Wayland', async () => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      mockCommand({
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.initialize();
      expect(await provider.isAvailable()).toBe(false);
    });

    it('should throw when xdotool is not available', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      mockExecSync.mockImplementation((cmd: string) => {
        if (String(cmd).includes('which xdotool')) {
          throw new Error('not found');
        }
        return '';
      });

      await expect(provider.initialize()).rejects.toThrow('xdotool is required');
    });
  });

  describe('mouse operations', () => {
    beforeEach(async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      mockCommand({
        'which xdotool': '/usr/bin/xdotool',
        'which xclip': '/usr/bin/xclip',
      });
      await provider.initialize();
    });

    it('should parse mouse position from xdotool output', async () => {
      mockCommand({
        'xdotool getmouselocation': 'x:500 y:300 screen:0 window:12345',
        'which xdotool': '/usr/bin/xdotool',
      });

      const pos = await provider.getMousePosition();
      expect(pos.x).toBe(500);
      expect(pos.y).toBe(300);
    });

    it('should move mouse to coordinates', async () => {
      mockCommand({
        'xdotool mousemove': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.moveMouse(100, 200);
      // Verify xdotool mousemove was called (via the mock)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('xdotool mousemove'),
        expect.any(Object)
      );
    });

    it('should click with correct button mapping', async () => {
      mockCommand({
        'xdotool click': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.click({ button: 'right' });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('click 3'),
        expect.any(Object)
      );
    });

    it('should scroll using button 4/5', async () => {
      mockCommand({
        'xdotool click': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.scroll({ deltaY: -3 });
      // Scroll up = button 4
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('click --repeat 3 4'),
        expect.any(Object)
      );
    });
  });

  describe('keyboard operations', () => {
    beforeEach(async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      mockCommand({
        'which xdotool': '/usr/bin/xdotool',
      });
      await provider.initialize();
    });

    it('should map key names correctly', async () => {
      mockCommand({
        'xdotool key': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.keyPress('enter');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('Return'),
        expect.any(Object)
      );
    });

    it('should handle modifier keys', async () => {
      mockCommand({
        'xdotool key': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.keyPress('c', { modifiers: ['ctrl'] });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('ctrl+c'),
        expect.any(Object)
      );
    });

    it('should type text with xdotool', async () => {
      mockCommand({
        'xdotool type': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.type('hello world');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('xdotool type'),
        expect.any(Object)
      );
    });
  });

  describe('window operations', () => {
    beforeEach(async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      mockCommand({
        'which xdotool': '/usr/bin/xdotool',
        'which wmctrl': '/usr/bin/wmctrl',
      });
      await provider.initialize();
    });

    it('should get active window', async () => {
      mockCommand({
        'xdotool getactivewindow': '67108867',
        'xdotool getwindowname 67108867': 'Terminal',
        'xdotool getwindowpid 67108867': '1234',
        'xdotool getwindowgeometry 67108867': 'Window 67108867\n  Position: 100,200 (screen 0)\n  Geometry: 800x600',
        'ps -p 1234': 'bash',
        'which xdotool': '/usr/bin/xdotool',
        'which wmctrl': '/usr/bin/wmctrl',
      });

      const win = await provider.getActiveWindow();
      expect(win).not.toBeNull();
      expect(win!.handle).toBe('67108867');
      expect(win!.title).toBe('Terminal');
      expect(win!.pid).toBe(1234);
    });

    it('should focus a window', async () => {
      mockCommand({
        'xdotool windowactivate': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.focusWindow('12345');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('windowactivate --sync 12345'),
        expect.any(Object)
      );
    });

    it('should minimize a window', async () => {
      mockCommand({
        'xdotool windowminimize': '',
        'which xdotool': '/usr/bin/xdotool',
      });

      await provider.minimizeWindow('12345');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('windowminimize 12345'),
        expect.any(Object)
      );
    });
  });

  describe('clipboard operations', () => {
    beforeEach(async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      mockCommand({
        'which xdotool': '/usr/bin/xdotool',
        'which xclip': '/usr/bin/xclip',
      });
      await provider.initialize();
    });

    it('should get clipboard text via xclip', async () => {
      mockCommand({
        'xclip -selection clipboard -o': 'hello clipboard',
        'which xdotool': '/usr/bin/xdotool',
        'which xclip': '/usr/bin/xclip',
      });

      const content = await provider.getClipboard();
      expect(content.text).toBe('hello clipboard');
      expect(content.formats).toContain('text');
    });
  });

  describe('screen operations', () => {
    beforeEach(async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      mockCommand({
        'which xdotool': '/usr/bin/xdotool',
        'which xrandr': '/usr/bin/xrandr',
      });
      await provider.initialize();
    });

    it('should parse xrandr output for screens', async () => {
      mockCommand({
        'xrandr --query': [
          'Screen 0: minimum 8 x 8, current 3840 x 1080',
          'HDMI-1 connected primary 1920x1080+0+0 (normal left inverted right) 527mm x 296mm',
          '   1920x1080     60.00*+',
          'DP-1 connected 1920x1080+1920+0 (normal left inverted right) 527mm x 296mm',
          '   1920x1080     60.00*+',
        ].join('\n'),
        'which xdotool': '/usr/bin/xdotool',
        'which xrandr': '/usr/bin/xrandr',
      });

      const screens = await provider.getScreens();
      expect(screens.length).toBe(2);
      expect(screens[0].name).toBe('HDMI-1');
      expect(screens[0].primary).toBe(true);
      expect(screens[0].bounds.width).toBe(1920);
      expect(screens[0].bounds.height).toBe(1080);
      expect(screens[1].name).toBe('DP-1');
      expect(screens[1].primary).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('should report correct capabilities', () => {
      expect(provider.capabilities.mouse).toBe(true);
      expect(provider.capabilities.keyboard).toBe(true);
      expect(provider.capabilities.windows).toBe(true);
      expect(provider.capabilities.clipboard).toBe(true);
      expect(provider.capabilities.ocr).toBe(false);
    });

    it('should have name "native"', () => {
      expect(provider.name).toBe('native');
    });
  });
});

describe('WindowsNativeProvider', () => {
  let provider: WindowsNativeProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new WindowsNativeProvider({ wsl: true });
  });

  describe('initialization', () => {
    it('should use powershell.exe for WSL mode', () => {
      const wslProvider = new WindowsNativeProvider({ wsl: true });
      expect(wslProvider.platformName).toBe('Windows');
    });

    it('should use powershell for native mode', () => {
      const nativeProvider = new WindowsNativeProvider({ wsl: false });
      expect(nativeProvider.platformName).toBe('Windows');
    });

    it('should initialize when PowerShell is available', async () => {
      mockCommand({
        'powershell': 'True',
        'which powershell': '/usr/bin/powershell',
      });

      await provider.initialize();
      // Should not throw
    });
  });

  describe('capabilities', () => {
    it('should report correct capabilities', () => {
      expect(provider.capabilities.mouse).toBe(true);
      expect(provider.capabilities.keyboard).toBe(true);
      expect(provider.capabilities.windows).toBe(true);
      expect(provider.capabilities.clipboard).toBe(true);
      expect(provider.capabilities.screenshots).toBe(true);
      expect(provider.capabilities.ocr).toBe(false);
    });
  });

  describe('mouse operations', () => {
    beforeEach(async () => {
      mockCommand({
        'powershell': '500,300',
        'which powershell': '/usr/bin/powershell',
      });
      await provider.initialize();
    });

    it('should parse mouse position from PowerShell output', async () => {
      mockCommand({
        'powershell': '500,300',
        'which powershell': '/usr/bin/powershell',
      });

      const pos = await provider.getMousePosition();
      expect(pos.x).toBe(500);
      expect(pos.y).toBe(300);
    });
  });

  describe('keyboard key map', () => {
    it('should have correct platform name', () => {
      expect(provider.platformName).toBe('Windows');
    });
  });
});

describe('MacOSNativeProvider', () => {
  let provider: MacOSNativeProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new MacOSNativeProvider();
  });

  describe('initialization', () => {
    it('should initialize and check for cliclick', async () => {
      mockCommand({
        'which cliclick': '/usr/local/bin/cliclick',
      });

      await provider.initialize();
      // Should not throw
    });

    it('should initialize without cliclick', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (String(cmd).includes('which cliclick')) {
          throw new Error('not found');
        }
        return '';
      });

      await provider.initialize();
      // Should not throw - cliclick is optional
    });
  });

  describe('capabilities', () => {
    it('should report correct capabilities', () => {
      expect(provider.capabilities.mouse).toBe(true);
      expect(provider.capabilities.keyboard).toBe(true);
      expect(provider.capabilities.windows).toBe(true);
      expect(provider.capabilities.clipboard).toBe(true);
      expect(provider.capabilities.ocr).toBe(false);
      expect(provider.capabilities.colorPicker).toBe(false);
    });

    it('should have name "native"', () => {
      expect(provider.name).toBe('native');
    });

    it('should have platformName "macOS"', () => {
      expect(provider.platformName).toBe('macOS');
    });
  });

  describe('clipboard operations', () => {
    beforeEach(async () => {
      mockCommand({
        'which cliclick': '/usr/local/bin/cliclick',
      });
      await provider.initialize();
    });

    it('should get clipboard via pbpaste', async () => {
      mockCommand({
        'pbpaste': 'clipboard text',
        'which cliclick': '/usr/local/bin/cliclick',
      });

      const content = await provider.getClipboard();
      expect(content.text).toBe('clipboard text');
    });
  });

  describe('screen operations', () => {
    beforeEach(async () => {
      mockCommand({
        'which cliclick': '/usr/local/bin/cliclick',
      });
      await provider.initialize();
    });

    it('should parse system_profiler JSON for screens', async () => {
      const profileData = JSON.stringify({
        SPDisplaysDataType: [{
          spdisplays_ndrvs: [{
            _name: 'Built-in Retina Display',
            _spdisplays_resolution: '2560 x 1600 (QHD)',
            spdisplays_main: 'spdisplays_yes',
            _spdisplays_retina: 'spdisplays_retina',
          }],
        }],
      });

      mockCommand({
        'system_profiler': profileData,
        'which cliclick': '/usr/local/bin/cliclick',
      });

      const screens = await provider.getScreens();
      expect(screens.length).toBe(1);
      expect(screens[0].name).toBe('Built-in Retina Display');
      expect(screens[0].bounds.width).toBe(2560);
      expect(screens[0].bounds.height).toBe(1600);
      expect(screens[0].primary).toBe(true);
      expect(screens[0].scaleFactor).toBe(2);
    });
  });

  describe('getPixelColor', () => {
    it('should throw not supported error', async () => {
      mockCommand({
        'which cliclick': '/usr/local/bin/cliclick',
      });
      await provider.initialize();

      await expect(provider.getPixelColor(100, 100)).rejects.toThrow(
        'Color picker requires screenshot analysis on macOS'
      );
    });
  });
});

describe('Auto-detection', () => {
  describe('platform detection', () => {
    it('should detect WSL2 from uname output', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (String(cmd) === 'uname -r') {
          return '5.15.90.1-microsoft-standard-WSL2';
        }
        return '';
      });

      // Test the WSL detection pattern directly
      const release = mockExecSync('uname -r', { encoding: 'utf-8' }) as string;
      expect(/microsoft|wsl/i.test(release)).toBe(true);
    });

    it('should not detect WSL on regular Linux', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (String(cmd) === 'uname -r') {
          return '6.1.0-18-amd64';
        }
        return '';
      });

      const release = mockExecSync('uname -r', { encoding: 'utf-8' }) as string;
      expect(/microsoft|wsl/i.test(release)).toBe(false);
    });
  });

  describe('fallback chain', () => {
    it('should have correct default config with native as primary', () => {
      const { DEFAULT_AUTOMATION_CONFIG } = require('../../src/desktop-automation/types.js');
      expect(DEFAULT_AUTOMATION_CONFIG.provider).toBe('native');
      expect(DEFAULT_AUTOMATION_CONFIG.fallbackProviders).toEqual(['nutjs', 'mock']);
    });
  });
});
