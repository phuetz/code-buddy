/**
 * Tests for Smart Snapshot Manager ref system changes
 *
 * Tests:
 * - getNextRef() returns incrementing values
 * - injectBrowserElements() adds elements to current snapshot
 * - Browser-sourced elements are tagged with source attribute
 */

import { SmartSnapshotManager } from '../../src/desktop-automation/smart-snapshot.js';

// Mock child_process to prevent actual system calls
jest.mock('child_process', () => ({
  execSync: jest.fn().mockReturnValue(''),
  exec: jest.fn((cmd: string, cb: (...args: unknown[]) => void) => cb(null, '', '')),
}));

jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn((_fn: (...args: unknown[]) => unknown) => jest.fn().mockResolvedValue({ stdout: '', stderr: '' })),
}));

describe('SmartSnapshotManager ref system', () => {
  let manager: SmartSnapshotManager;

  beforeEach(() => {
    manager = new SmartSnapshotManager({
      method: 'accessibility',
      defaultTtl: 60000,
    });
  });

  describe('getNextRef', () => {
    it('should return incrementing ref numbers starting from 1', () => {
      expect(manager.getNextRef()).toBe(1);
      expect(manager.getNextRef()).toBe(2);
      expect(manager.getNextRef()).toBe(3);
    });

    it('should continue incrementing across multiple calls', () => {
      for (let i = 1; i <= 10; i++) {
        expect(manager.getNextRef()).toBe(i);
      }
    });

    it('should maintain count across separate instances independently', () => {
      const manager2 = new SmartSnapshotManager();

      // Each instance has its own counter
      expect(manager.getNextRef()).toBe(1);
      expect(manager2.getNextRef()).toBe(1);
      expect(manager.getNextRef()).toBe(2);
      expect(manager2.getNextRef()).toBe(2);
    });
  });

  describe('injectBrowserElements', () => {
    it('should warn and return when no valid snapshot', () => {
      const elements = [{
        ref: 100,
        role: 'button' as const,
        name: 'Test Button',
        bounds: { x: 0, y: 0, width: 100, height: 30 },
        center: { x: 50, y: 15 },
        interactive: true,
        focused: false,
        enabled: true,
        visible: true,
      }];

      // Should not throw when no snapshot exists
      expect(() => {
        manager.injectBrowserElements(elements);
      }).not.toThrow();
    });

    it('should add elements to current snapshot when valid', async () => {
      // Create a snapshot first (we need to mock the internal takeSnapshot behavior)
      // Since we can't easily mock the internal accessibility detection,
      // we'll use the internal currentSnapshot property
      const mockSnapshot = {
        id: 'snap-test',
        timestamp: new Date(),
        source: 'focused',
        elements: [
          {
            ref: 1,
            role: 'button' as const,
            name: 'Desktop Button',
            bounds: { x: 10, y: 10, width: 100, height: 30 },
            center: { x: 60, y: 25 },
            interactive: true,
            focused: false,
            enabled: true,
            visible: true,
          },
        ],
        elementMap: new Map<number, any>(),
        screenSize: { width: 1920, height: 1080 },
        valid: true,
        ttl: 60000,
      };
      mockSnapshot.elementMap.set(1, mockSnapshot.elements[0]);

      // Set internal state
      (manager as any).currentSnapshot = mockSnapshot;

      // Inject browser elements
      const browserElements = [
        {
          ref: 50,
          role: 'link' as const,
          name: 'Browser Link',
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          center: { x: 0, y: 0 },
          interactive: true,
          focused: false,
          enabled: true,
          visible: true,
        },
        {
          ref: 51,
          role: 'button' as const,
          name: 'Browser Submit',
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          center: { x: 0, y: 0 },
          interactive: true,
          focused: false,
          enabled: true,
          visible: true,
        },
      ];

      manager.injectBrowserElements(browserElements, 'browser-accessibility');

      // Verify elements were added
      const snapshot = manager.getCurrentSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.elements).toHaveLength(3); // 1 desktop + 2 browser

      // Verify lookup works
      const link = manager.getElement(50);
      expect(link).toBeDefined();
      expect(link!.name).toBe('Browser Link');
      expect(link!.attributes?.source).toBe('browser-accessibility');

      const submit = manager.getElement(51);
      expect(submit).toBeDefined();
      expect(submit!.name).toBe('Browser Submit');
      expect(submit!.attributes?.source).toBe('browser-accessibility');

      // Original desktop element should still work
      const desktopButton = manager.getElement(1);
      expect(desktopButton).toBeDefined();
      expect(desktopButton!.name).toBe('Desktop Button');
    });

    it('should use default source name when not specified', async () => {
      const mockSnapshot = {
        id: 'snap-test',
        timestamp: new Date(),
        source: 'focused',
        elements: [],
        elementMap: new Map<number, any>(),
        screenSize: { width: 1920, height: 1080 },
        valid: true,
        ttl: 60000,
      };

      (manager as any).currentSnapshot = mockSnapshot;

      const elements = [{
        ref: 10,
        role: 'button' as const,
        name: 'Test',
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        center: { x: 0, y: 0 },
        interactive: true,
        focused: false,
        enabled: true,
        visible: true,
      }];

      manager.injectBrowserElements(elements);

      const elem = manager.getElement(10);
      expect(elem?.attributes?.source).toBe('browser-accessibility');
    });
  });
});
