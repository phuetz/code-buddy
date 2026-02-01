/**
 * Desktop Automation Tests
 */

import {
  DesktopAutomationManager,
  MockAutomationProvider,
  NutJsProvider,
  getDesktopAutomation,
  resetDesktopAutomation,
  type IAutomationProvider,
  type WindowInfo,
  type AppInfo,
  type MousePosition,
} from '../../src/desktop-automation/index.js';

describe('Desktop Automation', () => {
  describe('MockAutomationProvider', () => {
    let provider: MockAutomationProvider;

    beforeEach(async () => {
      provider = new MockAutomationProvider();
      await provider.initialize();
    });

    afterEach(async () => {
      await provider.shutdown();
    });

    it('should have correct name and capabilities', () => {
      expect(provider.name).toBe('mock');
      expect(provider.capabilities.mouse).toBe(true);
      expect(provider.capabilities.keyboard).toBe(true);
      expect(provider.capabilities.windows).toBe(true);
      expect(provider.capabilities.apps).toBe(true);
      expect(provider.capabilities.clipboard).toBe(true);
      expect(provider.capabilities.ocr).toBe(false);
    });

    it('should be available', async () => {
      expect(await provider.isAvailable()).toBe(true);
    });

    describe('Mouse Operations', () => {
      it('should get mouse position', async () => {
        const pos = await provider.getMousePosition();

        expect(pos.x).toBe(500);
        expect(pos.y).toBe(500);
      });

      it('should move mouse', async () => {
        await provider.moveMouse(100, 200);
        const pos = await provider.getMousePosition();

        expect(pos.x).toBe(100);
        expect(pos.y).toBe(200);
      });

      it('should click', async () => {
        await expect(provider.click()).resolves.toBeUndefined();
      });

      it('should double click', async () => {
        await expect(provider.doubleClick()).resolves.toBeUndefined();
      });

      it('should right click', async () => {
        await expect(provider.rightClick()).resolves.toBeUndefined();
      });

      it('should drag', async () => {
        await provider.drag(100, 100, 300, 300);
        const pos = await provider.getMousePosition();

        expect(pos.x).toBe(300);
        expect(pos.y).toBe(300);
      });

      it('should scroll', async () => {
        await expect(provider.scroll({ deltaY: 100 })).resolves.toBeUndefined();
      });
    });

    describe('Keyboard Operations', () => {
      it('should press key', async () => {
        await expect(provider.keyPress('a')).resolves.toBeUndefined();
      });

      it('should key down', async () => {
        await expect(provider.keyDown('shift')).resolves.toBeUndefined();
      });

      it('should key up', async () => {
        await expect(provider.keyUp('shift')).resolves.toBeUndefined();
      });

      it('should type text', async () => {
        await expect(provider.type('Hello World')).resolves.toBeUndefined();
      });

      it('should execute hotkey', async () => {
        await expect(
          provider.hotkey({ keys: ['c'], modifiers: ['ctrl'] })
        ).resolves.toBeUndefined();
      });
    });

    describe('Window Operations', () => {
      it('should get active window', async () => {
        const window = await provider.getActiveWindow();

        expect(window).not.toBeNull();
        expect(window?.focused).toBe(true);
        expect(window?.title).toBe('Terminal');
      });

      it('should get all windows', async () => {
        const windows = await provider.getWindows();

        expect(windows.length).toBe(2);
      });

      it('should filter windows by title', async () => {
        const windows = await provider.getWindows({ title: 'Browser' });

        expect(windows.length).toBe(1);
        expect(windows[0].title).toContain('Browser');
      });

      it('should filter windows by regex', async () => {
        const windows = await provider.getWindows({ title: /terminal/i });

        expect(windows.length).toBe(1);
      });

      it('should get window by handle', async () => {
        const window = await provider.getWindow('window-1');

        expect(window).not.toBeNull();
        expect(window?.handle).toBe('window-1');
      });

      it('should return null for unknown window', async () => {
        const window = await provider.getWindow('unknown');

        expect(window).toBeNull();
      });

      it('should focus window', async () => {
        await provider.focusWindow('window-2');

        const windows = await provider.getWindows();
        expect(windows.find(w => w.handle === 'window-2')?.focused).toBe(true);
        expect(windows.find(w => w.handle === 'window-1')?.focused).toBe(false);
      });

      it('should minimize window', async () => {
        await provider.minimizeWindow('window-1');

        const window = await provider.getWindow('window-1');
        expect(window?.minimized).toBe(true);
      });

      it('should maximize window', async () => {
        await provider.maximizeWindow('window-1');

        const window = await provider.getWindow('window-1');
        expect(window?.maximized).toBe(true);
      });

      it('should restore window', async () => {
        await provider.minimizeWindow('window-1');
        await provider.restoreWindow('window-1');

        const window = await provider.getWindow('window-1');
        expect(window?.minimized).toBe(false);
      });

      it('should close window', async () => {
        await provider.closeWindow('window-1');

        const window = await provider.getWindow('window-1');
        expect(window).toBeNull();
      });

      it('should set window position and size', async () => {
        await provider.setWindow('window-1', {
          position: { x: 50, y: 50 },
          size: { width: 1000, height: 700 },
        });

        const window = await provider.getWindow('window-1');
        expect(window?.bounds.x).toBe(50);
        expect(window?.bounds.y).toBe(50);
        expect(window?.bounds.width).toBe(1000);
        expect(window?.bounds.height).toBe(700);
      });
    });

    describe('Application Operations', () => {
      it('should get running apps', async () => {
        const apps = await provider.getRunningApps();

        expect(apps.length).toBe(2);
        expect(apps.some(a => a.name === 'Terminal')).toBe(true);
      });

      it('should launch app', async () => {
        const app = await provider.launchApp('/usr/bin/editor');

        expect(app.name).toBe('editor');
        expect(app.running).toBe(true);
        expect(app.pid).toBeDefined();
      });

      it('should close app', async () => {
        const apps = await provider.getRunningApps();
        const terminalPid = apps.find(a => a.name === 'Terminal')?.pid;

        await provider.closeApp(terminalPid!);

        const remaining = await provider.getRunningApps();
        expect(remaining.some(a => a.name === 'Terminal')).toBe(false);
      });
    });

    describe('Screen Operations', () => {
      it('should get screens', async () => {
        const screens = await provider.getScreens();

        expect(screens.length).toBe(1);
        expect(screens[0].primary).toBe(true);
        expect(screens[0].bounds.width).toBe(1920);
        expect(screens[0].bounds.height).toBe(1080);
      });

      it('should get pixel color', async () => {
        const color = await provider.getPixelColor(100, 50);

        expect(color.r).toBeDefined();
        expect(color.g).toBeDefined();
        expect(color.b).toBeDefined();
        expect(color.hex).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    describe('Clipboard Operations', () => {
      it('should get clipboard', async () => {
        const content = await provider.getClipboard();

        expect(content.formats).toBeDefined();
      });

      it('should set clipboard text', async () => {
        await provider.setClipboard({ text: 'Hello' });

        const content = await provider.getClipboard();
        expect(content.text).toBe('Hello');
        expect(content.formats).toContain('text');
      });

      it('should clear clipboard', async () => {
        await provider.setClipboard({ text: 'Hello' });
        await provider.clearClipboard();

        const content = await provider.getClipboard();
        expect(content.formats.length).toBe(0);
      });
    });
  });

  describe('DesktopAutomationManager', () => {
    let manager: DesktopAutomationManager;

    beforeEach(async () => {
      manager = new DesktopAutomationManager({ provider: 'mock' });
      await manager.initialize();
    });

    afterEach(async () => {
      await manager.shutdown();
    });

    describe('Initialization', () => {
      it('should initialize with mock provider', async () => {
        const status = await manager.getProviderStatus();

        expect(status).not.toBeNull();
        expect(status?.name).toBe('mock');
        expect(status?.available).toBe(true);
      });

      it('should register custom provider', async () => {
        const customManager = new DesktopAutomationManager();
        const customProvider = new MockAutomationProvider();

        customManager.registerProvider(customProvider);
        await customManager.initialize();

        expect(customManager.getProvider()).not.toBeNull();
        await customManager.shutdown();
      });

      it('should get all provider statuses', async () => {
        const statuses = await manager.getAllProviderStatuses();

        expect(statuses.length).toBeGreaterThan(0);
        expect(statuses.some(s => s.name === 'mock')).toBe(true);
      });

      it('should throw when not initialized', async () => {
        const uninit = new DesktopAutomationManager();

        await expect(uninit.getMousePosition()).rejects.toThrow('not initialized');
      });
    });

    describe('Mouse Operations', () => {
      it('should get mouse position', async () => {
        const pos = await manager.getMousePosition();

        expect(pos.x).toBeDefined();
        expect(pos.y).toBeDefined();
      });

      it('should move mouse', async () => {
        await manager.moveMouse(200, 300);
        const pos = await manager.getMousePosition();

        expect(pos.x).toBe(200);
        expect(pos.y).toBe(300);
      });

      it('should click at position', async () => {
        await expect(manager.click(100, 100)).resolves.toBeUndefined();
      });

      it('should double click', async () => {
        await expect(manager.doubleClick(100, 100)).resolves.toBeUndefined();
      });

      it('should right click', async () => {
        await expect(manager.rightClick(100, 100)).resolves.toBeUndefined();
      });

      it('should drag', async () => {
        await expect(manager.drag(100, 100, 200, 200)).resolves.toBeUndefined();
      });

      it('should scroll', async () => {
        await expect(manager.scroll({ deltaY: 50 })).resolves.toBeUndefined();
      });

      it('should emit mouse-move event', async () => {
        const events: Array<{ x: number; y: number }> = [];
        manager.on('mouse-move', (pos) => events.push(pos));

        await manager.moveMouse(150, 250);

        expect(events.length).toBe(1);
        expect(events[0]).toEqual({ x: 150, y: 250 });
      });

      it('should emit mouse-click event', async () => {
        const events: Array<{ pos: MousePosition; button: string }> = [];
        manager.on('mouse-click', (pos, button) => events.push({ pos, button }));

        await manager.click();

        expect(events.length).toBe(1);
      });
    });

    describe('Keyboard Operations', () => {
      it('should press key', async () => {
        await expect(manager.keyPress('enter')).resolves.toBeUndefined();
      });

      it('should key down/up', async () => {
        await expect(manager.keyDown('ctrl')).resolves.toBeUndefined();
        await expect(manager.keyUp('ctrl')).resolves.toBeUndefined();
      });

      it('should type text', async () => {
        await expect(manager.type('Hello World')).resolves.toBeUndefined();
      });

      it('should execute hotkey', async () => {
        await expect(manager.hotkey('ctrl', 'shift', 's')).resolves.toBeUndefined();
      });

      it('should emit key-press event', async () => {
        const events: Array<{ key: string; modifiers: string[] }> = [];
        manager.on('key-press', (key, modifiers) => events.push({ key, modifiers }));

        await manager.keyPress('a', { modifiers: ['ctrl'] });

        expect(events.length).toBe(1);
        expect(events[0].key).toBe('a');
        expect(events[0].modifiers).toContain('ctrl');
      });

      it('should emit key-type event', async () => {
        const events: string[] = [];
        manager.on('key-type', (text) => events.push(text));

        await manager.type('test');

        expect(events).toContain('test');
      });
    });

    describe('Window Operations', () => {
      it('should get active window', async () => {
        const window = await manager.getActiveWindow();

        expect(window).not.toBeNull();
        expect(window?.focused).toBe(true);
      });

      it('should get all windows', async () => {
        const windows = await manager.getWindows();

        expect(windows.length).toBeGreaterThan(0);
      });

      it('should find window by title', async () => {
        const window = await manager.findWindow('Terminal');

        expect(window).not.toBeNull();
        expect(window?.title).toBe('Terminal');
      });

      it('should find window by regex', async () => {
        const window = await manager.findWindow(/browser/i);

        expect(window).not.toBeNull();
      });

      it('should focus window', async () => {
        const windows = await manager.getWindows();
        const windowToFocus = windows.find(w => !w.focused);

        if (windowToFocus) {
          await manager.focusWindow(windowToFocus.handle);

          const focused = await manager.getActiveWindow();
          expect(focused?.handle).toBe(windowToFocus.handle);
        }
      });

      it('should minimize/restore window', async () => {
        const window = await manager.getActiveWindow();

        await manager.minimizeWindow(window!.handle);
        let updated = await manager.getWindow(window!.handle);
        expect(updated?.minimized).toBe(true);

        await manager.restoreWindow(window!.handle);
        updated = await manager.getWindow(window!.handle);
        expect(updated?.minimized).toBe(false);
      });

      it('should maximize window', async () => {
        const window = await manager.getActiveWindow();

        await manager.maximizeWindow(window!.handle);

        const updated = await manager.getWindow(window!.handle);
        expect(updated?.maximized).toBe(true);
      });

      it('should move window', async () => {
        const window = await manager.getActiveWindow();

        await manager.moveWindow(window!.handle, 50, 75);

        const updated = await manager.getWindow(window!.handle);
        expect(updated?.bounds.x).toBe(50);
        expect(updated?.bounds.y).toBe(75);
      });

      it('should resize window', async () => {
        const window = await manager.getActiveWindow();

        await manager.resizeWindow(window!.handle, 640, 480);

        const updated = await manager.getWindow(window!.handle);
        expect(updated?.bounds.width).toBe(640);
        expect(updated?.bounds.height).toBe(480);
      });

      it('should close window', async () => {
        const windows = await manager.getWindows();
        const initial = windows.length;

        await manager.closeWindow(windows[0].handle);

        const remaining = await manager.getWindows();
        expect(remaining.length).toBe(initial - 1);
      });

      it('should emit window-focus event', async () => {
        const events: WindowInfo[] = [];
        manager.on('window-focus', (w) => events.push(w));

        const windows = await manager.getWindows();
        await manager.focusWindow(windows[1].handle);

        expect(events.length).toBe(1);
      });

      it('should emit window-change event', async () => {
        const events: Array<{ window: WindowInfo; changes: object }> = [];
        manager.on('window-change', (w, c) => events.push({ window: w, changes: c }));

        const window = await manager.getActiveWindow();
        await manager.moveWindow(window!.handle, 100, 100);

        expect(events.length).toBe(1);
      });
    });

    describe('Application Operations', () => {
      it('should get running apps', async () => {
        const apps = await manager.getRunningApps();

        expect(apps.length).toBeGreaterThan(0);
      });

      it('should find app by name', async () => {
        const app = await manager.findApp('terminal');

        expect(app).not.toBeNull();
        expect(app?.name.toLowerCase()).toContain('terminal');
      });

      it('should launch app', async () => {
        const app = await manager.launchApp('/usr/bin/calculator');

        expect(app.name).toBe('calculator');
        expect(app.running).toBe(true);
      });

      it('should close app', async () => {
        const apps = await manager.getRunningApps();
        const initial = apps.length;

        await manager.closeApp(apps[0].pid!);

        const remaining = await manager.getRunningApps();
        expect(remaining.length).toBe(initial - 1);
      });

      it('should emit app-launch event', async () => {
        const events: AppInfo[] = [];
        manager.on('app-launch', (app) => events.push(app));

        await manager.launchApp('/usr/bin/test');

        expect(events.length).toBe(1);
      });

      it('should emit app-close event', async () => {
        const events: AppInfo[] = [];
        manager.on('app-close', (app) => events.push(app));

        const apps = await manager.getRunningApps();
        await manager.closeApp(apps[0].pid!);

        expect(events.length).toBe(1);
      });
    });

    describe('Screen Operations', () => {
      it('should get screens', async () => {
        const screens = await manager.getScreens();

        expect(screens.length).toBeGreaterThan(0);
      });

      it('should get primary screen', async () => {
        const primary = await manager.getPrimaryScreen();

        expect(primary).not.toBeNull();
        expect(primary?.primary).toBe(true);
      });

      it('should get pixel color', async () => {
        const color = await manager.getPixelColor(0, 0);

        expect(color.hex).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    describe('Clipboard Operations', () => {
      it('should get clipboard', async () => {
        const content = await manager.getClipboard();

        expect(content).toBeDefined();
      });

      it('should copy text', async () => {
        await manager.copyText('Test clipboard');

        const text = await manager.getClipboardText();
        expect(text).toBe('Test clipboard');
      });

      it('should clear clipboard', async () => {
        await manager.copyText('Text');
        await manager.clearClipboard();

        const content = await manager.getClipboard();
        expect(content.formats.length).toBe(0);
      });
    });

    describe('Configuration', () => {
      it('should get configuration', () => {
        const config = manager.getConfig();

        expect(config.provider).toBeDefined();
        expect(config.safety).toBeDefined();
        expect(config.defaultDelays).toBeDefined();
      });

      it('should update configuration', () => {
        manager.updateConfig({ debug: true });

        const config = manager.getConfig();
        expect(config.debug).toBe(true);
      });
    });

    describe('Safety Features', () => {
      it('should have fail-safe enabled by default', () => {
        const config = manager.getConfig();

        expect(config.safety.failSafe).toBe(true);
      });

      it('should be able to reset fail-safe', () => {
        manager.resetFailSafe();

        // Should not throw
        expect(() => manager.resetFailSafe()).not.toThrow();
      });

      it('should have minimum action delay', () => {
        const config = manager.getConfig();

        expect(config.safety.minActionDelay).toBeGreaterThan(0);
      });
    });
  });

  describe('Singleton', () => {
    beforeEach(() => {
      resetDesktopAutomation();
    });

    afterEach(() => {
      resetDesktopAutomation();
    });

    it('should return same instance', () => {
      const instance1 = getDesktopAutomation();
      const instance2 = getDesktopAutomation();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = getDesktopAutomation();
      resetDesktopAutomation();
      const instance2 = getDesktopAutomation();

      expect(instance1).not.toBe(instance2);
    });

    it('should accept config on first call', () => {
      const instance = getDesktopAutomation({ debug: true });

      expect(instance.getConfig().debug).toBe(true);
    });
  });

  describe('NutJsProvider', () => {
    let provider: NutJsProvider;

    beforeEach(() => {
      provider = new NutJsProvider();
    });

    it('should have correct name and capabilities', () => {
      expect(provider.name).toBe('nutjs');
      expect(provider.capabilities.mouse).toBe(true);
      expect(provider.capabilities.keyboard).toBe(true);
      expect(provider.capabilities.windows).toBe(true);
      expect(provider.capabilities.apps).toBe(false); // Limited support
      expect(provider.capabilities.clipboard).toBe(true);
    });

    it('should check availability', async () => {
      // nut.js is installed, so should be available
      const available = await provider.isAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('should initialize successfully', async () => {
      await expect(provider.initialize()).resolves.toBeUndefined();
      await provider.shutdown();
    });

    it('should shutdown successfully', async () => {
      await provider.initialize();
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });

    it('should throw when not initialized', async () => {
      // Provider not initialized
      await expect(provider.getMousePosition()).rejects.toThrow('not initialized');
    });

    describe('When initialized', () => {
      beforeEach(async () => {
        await provider.initialize();
      });

      afterEach(async () => {
        await provider.shutdown();
      });

      it('should get screens', async () => {
        const screens = await provider.getScreens();
        // May return empty array in headless environment
        expect(Array.isArray(screens)).toBe(true);
      });

      it('should get clipboard', async () => {
        const content = await provider.getClipboard();
        expect(content.formats).toBeDefined();
      });

      it('should set clipboard', async () => {
        await provider.setClipboard({ text: 'Test from NutJs' });
        const content = await provider.getClipboard();
        expect(content.text).toBe('Test from NutJs');
      });

      it('should clear clipboard', async () => {
        await provider.setClipboard({ text: 'Test' });
        await provider.clearClipboard();
        const content = await provider.getClipboard();
        expect(content.text).toBe('');
      });

      it('should return empty apps list (not supported)', async () => {
        const apps = await provider.getRunningApps();
        expect(apps).toEqual([]);
      });

      it('should throw on launchApp (not supported)', async () => {
        await expect(provider.launchApp('/bin/test')).rejects.toThrow('not supported');
      });

      it('should throw on closeApp (not supported)', async () => {
        await expect(provider.closeApp(123)).rejects.toThrow('not supported');
      });
    });
  });

  describe('Manager with NutJsProvider', () => {
    let manager: DesktopAutomationManager;

    beforeEach(async () => {
      manager = new DesktopAutomationManager({ provider: 'nutjs' });
      manager.registerProvider(new NutJsProvider());
      await manager.initialize();
    });

    afterEach(async () => {
      await manager.shutdown();
    });

    it('should initialize with nutjs provider', async () => {
      const status = await manager.getProviderStatus();

      expect(status).not.toBeNull();
      expect(status?.name).toBe('nutjs');
    });

    it('should get clipboard text', async () => {
      await manager.copyText('Manager test');
      const text = await manager.getClipboardText();

      expect(text).toBe('Manager test');
    });

    it('should clear clipboard', async () => {
      await manager.copyText('To clear');
      await manager.clearClipboard();

      const content = await manager.getClipboard();
      expect(content.text).toBe('');
    });
  });
});
