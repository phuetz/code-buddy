/**
 * Visual Workspace Tests
 */

import {
  VisualWorkspaceManager,
  getVisualWorkspaceManager,
  resetVisualWorkspaceManager,
} from '../../src/canvas/visual-workspace.js';

describe('VisualWorkspaceManager', () => {
  let manager: VisualWorkspaceManager;

  beforeEach(() => {
    resetVisualWorkspaceManager();
    manager = new VisualWorkspaceManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  describe('createWorkspace', () => {
    it('should create workspace with default config', () => {
      const workspace = manager.createWorkspace();

      expect(workspace.id).toBeDefined();
      expect(workspace.config.name).toBe('Untitled Workspace');
      expect(workspace.elements).toHaveLength(0);
    });

    it('should create workspace with custom config', () => {
      const workspace = manager.createWorkspace({
        name: 'My Workspace',
        width: 1280,
        height: 720,
      });

      expect(workspace.config.name).toBe('My Workspace');
      expect(workspace.config.width).toBe(1280);
      expect(workspace.config.height).toBe(720);
    });

    it('should emit workspace-created event', () => {
      const spy = jest.fn();
      manager.on('workspace-created', spy);

      const workspace = manager.createWorkspace();

      expect(spy).toHaveBeenCalledWith(workspace);
    });
  });

  describe('getWorkspace', () => {
    it('should get workspace by ID', () => {
      const created = manager.createWorkspace();
      const retrieved = manager.getWorkspace(created.id);

      expect(retrieved).toBe(created);
    });

    it('should return undefined for non-existent workspace', () => {
      const retrieved = manager.getWorkspace('non-existent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAllWorkspaces', () => {
    it('should return all workspaces', () => {
      manager.createWorkspace({ name: 'Workspace 1' });
      manager.createWorkspace({ name: 'Workspace 2' });

      const workspaces = manager.getAllWorkspaces();

      expect(workspaces).toHaveLength(2);
    });
  });

  describe('deleteWorkspace', () => {
    it('should delete workspace', () => {
      const workspace = manager.createWorkspace();
      const deleted = manager.deleteWorkspace(workspace.id);

      expect(deleted).toBe(true);
      expect(manager.getWorkspace(workspace.id)).toBeUndefined();
    });

    it('should return false for non-existent workspace', () => {
      const deleted = manager.deleteWorkspace('non-existent');

      expect(deleted).toBe(false);
    });

    it('should emit workspace-deleted event', () => {
      const spy = jest.fn();
      manager.on('workspace-deleted', spy);

      const workspace = manager.createWorkspace();
      manager.deleteWorkspace(workspace.id);

      expect(spy).toHaveBeenCalledWith(workspace.id);
    });
  });

  describe('addElement', () => {
    it('should add element to workspace', () => {
      const workspace = manager.createWorkspace();

      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Hello' },
        { x: 100, y: 100 },
        { width: 200, height: 50 }
      );

      expect(element.id).toBeDefined();
      expect(element.type).toBe('text');
      expect(element.position).toEqual({ x: 100, y: 100 });

      const updated = manager.getWorkspace(workspace.id);
      expect(updated?.elements).toHaveLength(1);
    });

    it('should throw for non-existent workspace', () => {
      expect(() =>
        manager.addElement(
          'non-existent',
          'text',
          { text: 'Test' },
          { x: 0, y: 0 },
          { width: 100, height: 50 }
        )
      ).toThrow('Workspace non-existent not found');
    });

    it('should snap to grid', () => {
      const workspace = manager.createWorkspace({ snapToGrid: true, gridSize: 20 });

      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Hello' },
        { x: 105, y: 117 },
        { width: 200, height: 50 }
      );

      expect(element.position.x).toBe(100); // Snapped
      expect(element.position.y).toBe(120); // Snapped
    });

    it('should emit element-added event', () => {
      const spy = jest.fn();
      manager.on('element-added', spy);

      const workspace = manager.createWorkspace();
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      expect(spy).toHaveBeenCalledWith(element);
    });
  });

  describe('updateElement', () => {
    it('should update element', () => {
      const workspace = manager.createWorkspace();
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Original' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      const updated = manager.updateElement(workspace.id, element.id, {
        content: { text: 'Updated' },
      });

      expect(updated?.content).toEqual({ text: 'Updated' });
    });

    it('should return null for non-existent element', () => {
      const workspace = manager.createWorkspace();
      const updated = manager.updateElement(workspace.id, 'non-existent', {});

      expect(updated).toBeNull();
    });

    it('should emit element-updated event', () => {
      const spy = jest.fn();
      manager.on('element-updated', spy);

      const workspace = manager.createWorkspace();
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      manager.updateElement(workspace.id, element.id, { label: 'New Label' });

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('deleteElement', () => {
    it('should delete element', () => {
      const workspace = manager.createWorkspace();
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      const deleted = manager.deleteElement(workspace.id, element.id);

      expect(deleted).toBe(true);

      const updated = manager.getWorkspace(workspace.id);
      expect(updated?.elements).toHaveLength(0);
    });

    it('should emit element-deleted event', () => {
      const spy = jest.fn();
      manager.on('element-deleted', spy);

      const workspace = manager.createWorkspace();
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      manager.deleteElement(workspace.id, element.id);

      expect(spy).toHaveBeenCalledWith(element.id);
    });
  });

  describe('moveElement', () => {
    it('should move element', () => {
      const workspace = manager.createWorkspace({ snapToGrid: false });
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      const moved = manager.moveElement(workspace.id, element.id, { x: 200, y: 300 });

      expect(moved?.position).toEqual({ x: 200, y: 300 });
    });

    it('should not move locked element', () => {
      const workspace = manager.createWorkspace({ snapToGrid: false });
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      manager.updateElement(workspace.id, element.id, { locked: true });
      const moved = manager.moveElement(workspace.id, element.id, { x: 200, y: 300 });

      expect(moved).toBeNull();
    });
  });

  describe('resizeElement', () => {
    it('should resize element', () => {
      const workspace = manager.createWorkspace({ snapToGrid: false });
      const element = manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      const resized = manager.resizeElement(workspace.id, element.id, {
        width: 200,
        height: 100,
      });

      expect(resized?.size).toEqual({ width: 200, height: 100 });
    });
  });

  describe('undo/redo', () => {
    it('should undo add element', () => {
      const workspace = manager.createWorkspace();
      manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      const result = manager.undo(workspace.id);

      expect(result).toBe(true);
      expect(manager.getWorkspace(workspace.id)?.elements).toHaveLength(0);
    });

    it('should redo after undo', () => {
      const workspace = manager.createWorkspace();
      manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      manager.undo(workspace.id);
      const result = manager.redo(workspace.id);

      expect(result).toBe(true);
      expect(manager.getWorkspace(workspace.id)?.elements).toHaveLength(1);
    });

    it('should return false when nothing to undo', () => {
      const workspace = manager.createWorkspace();
      const result = manager.undo(workspace.id);

      expect(result).toBe(false);
    });

    it('should return false when nothing to redo', () => {
      const workspace = manager.createWorkspace();
      const result = manager.redo(workspace.id);

      expect(result).toBe(false);
    });
  });

  describe('renderToTerminal', () => {
    it('should render workspace to terminal', () => {
      const workspace = manager.createWorkspace();
      manager.addElement(
        workspace.id,
        'text',
        { text: 'Hello' },
        { x: 100, y: 100 },
        { width: 200, height: 100 }
      );

      const output = manager.renderToTerminal(workspace.id, 80, 24);

      expect(output).toBeDefined();
      expect(output.split('\n')).toHaveLength(24);
    });

    it('should return empty string for non-existent workspace', () => {
      const output = manager.renderToTerminal('non-existent');

      expect(output).toBe('');
    });
  });

  describe('export/import', () => {
    it('should export to JSON', () => {
      const workspace = manager.createWorkspace({ name: 'Test Workspace' });
      manager.addElement(
        workspace.id,
        'text',
        { text: 'Hello' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      const json = manager.exportToJSON(workspace.id);
      const parsed = JSON.parse(json);

      expect(parsed.config.name).toBe('Test Workspace');
      expect(parsed.elements).toHaveLength(1);
    });

    it('should import from JSON', () => {
      const workspace = manager.createWorkspace({ name: 'Original' });
      manager.addElement(
        workspace.id,
        'text',
        { text: 'Test' },
        { x: 0, y: 0 },
        { width: 100, height: 50 }
      );

      const json = manager.exportToJSON(workspace.id);
      const imported = manager.importFromJSON(json);

      expect(imported.id).not.toBe(workspace.id); // New ID
      expect(imported.config.name).toBe('Original');
      expect(imported.elements).toHaveLength(1);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetVisualWorkspaceManager();

      const instance1 = getVisualWorkspaceManager();
      const instance2 = getVisualWorkspaceManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getVisualWorkspaceManager();
      instance1.createWorkspace();

      resetVisualWorkspaceManager();

      const instance2 = getVisualWorkspaceManager();
      expect(instance2).not.toBe(instance1);
      expect(instance2.getAllWorkspaces()).toHaveLength(0);
    });
  });
});
