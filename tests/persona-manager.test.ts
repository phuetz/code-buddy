/**
 * Tests for Persona Manager
 */

import { PersonaManager, getPersonaManager, resetPersonaManager } from '../src/personas/persona-manager';

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  existsSync: jest.fn().mockReturnValue(false),
  readdir: jest.fn().mockResolvedValue([]),
  readJSON: jest.fn().mockResolvedValue({}),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
}));

describe('PersonaManager', () => {
  let manager: PersonaManager;

  beforeEach(() => {
    resetPersonaManager();
    manager = new PersonaManager({
      autoSwitch: true,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const m = new PersonaManager();
      expect(m).toBeDefined();
      m.dispose();
    });

    it('should load built-in personas', () => {
      const personas = manager.getBuiltinPersonas();
      expect(personas.length).toBeGreaterThan(0);
    });
  });

  describe('getAllPersonas', () => {
    it('should return all personas', () => {
      const personas = manager.getAllPersonas();
      expect(personas.length).toBeGreaterThan(0);
    });
  });

  describe('getBuiltinPersonas', () => {
    it('should return only built-in personas', () => {
      const personas = manager.getBuiltinPersonas();
      expect(personas.every(p => p.isBuiltin)).toBe(true);
    });

    it('should include default persona', () => {
      const personas = manager.getBuiltinPersonas();
      const defaultPersona = personas.find(p => p.id === 'default');
      expect(defaultPersona).toBeDefined();
    });

    it('should include specialized personas', () => {
      const personas = manager.getBuiltinPersonas();
      const names = personas.map(p => p.id);

      expect(names).toContain('senior-developer');
      expect(names).toContain('code-reviewer');
      expect(names).toContain('debugger');
      expect(names).toContain('teacher');
    });
  });

  describe('getActivePersona', () => {
    it('should return default persona initially', () => {
      const active = manager.getActivePersona();
      expect(active).toBeDefined();
      expect(active?.id).toBe('default');
    });
  });

  describe('setActivePersona', () => {
    it('should change active persona', () => {
      manager.setActivePersona('senior-developer');

      const active = manager.getActivePersona();
      expect(active?.id).toBe('senior-developer');
    });

    it('should return false for unknown persona', () => {
      const result = manager.setActivePersona('unknown-persona');
      expect(result).toBe(false);
    });

    it('should return true for valid persona', () => {
      const result = manager.setActivePersona('debugger');
      expect(result).toBe(true);
    });
  });

  describe('getPersona', () => {
    it('should return persona by id', () => {
      const persona = manager.getPersona('teacher');
      expect(persona).toBeDefined();
      expect(persona?.name).toBe('Patient Teacher');
    });

    it('should return undefined for unknown id', () => {
      const persona = manager.getPersona('not-a-persona');
      expect(persona).toBeUndefined();
    });
  });

  describe('createPersona', () => {
    it('should create custom persona', async () => {
      const persona = await manager.createPersona({
        name: 'My Custom Persona',
        description: 'A custom test persona',
        systemPrompt: 'You are a custom assistant.',
      });

      expect(persona.id).toBe('my-custom-persona');
      expect(persona.isBuiltin).toBe(false);
    });

    it('should throw for duplicate name', async () => {
      await manager.createPersona({
        name: 'Unique Persona',
        description: 'First',
        systemPrompt: 'First prompt',
      });

      await expect(
        manager.createPersona({
          name: 'Unique Persona',
          description: 'Second',
          systemPrompt: 'Second prompt',
        })
      ).rejects.toThrow('already exists');
    });

    it('should apply custom style', async () => {
      const persona = await manager.createPersona({
        name: 'Styled Persona',
        description: 'Has custom style',
        systemPrompt: 'You are styled.',
        style: {
          verbosity: 'concise',
          tone: 'authoritative',
        },
      });

      expect(persona.style.verbosity).toBe('concise');
      expect(persona.style.tone).toBe('authoritative');
    });
  });

  describe('updatePersona', () => {
    it('should update custom persona', async () => {
      const created = await manager.createPersona({
        name: 'Update Test',
        description: 'Original',
        systemPrompt: 'Original prompt',
      });

      const updated = await manager.updatePersona(created.id, {
        description: 'Updated description',
      });

      expect(updated?.description).toBe('Updated description');
    });

    it('should throw for built-in personas', async () => {
      await expect(
        manager.updatePersona('default', { description: 'New description' })
      ).rejects.toThrow('Cannot modify built-in');
    });
  });

  describe('deletePersona', () => {
    it('should delete custom persona', async () => {
      const created = await manager.createPersona({
        name: 'Delete Test',
        description: 'To be deleted',
        systemPrompt: 'Prompt',
      });

      const result = await manager.deletePersona(created.id);
      expect(result).toBe(true);

      expect(manager.getPersona(created.id)).toBeUndefined();
    });

    it('should throw for built-in personas', async () => {
      await expect(manager.deletePersona('default')).rejects.toThrow(
        'Cannot delete built-in'
      );
    });

    it('should switch to default when active persona deleted', async () => {
      const created = await manager.createPersona({
        name: 'Active Delete',
        description: 'Will be deleted while active',
        systemPrompt: 'Prompt',
      });

      manager.setActivePersona(created.id);
      await manager.deletePersona(created.id);

      expect(manager.getActivePersona()?.id).toBe('default');
    });
  });

  describe('clonePersona', () => {
    it('should clone a persona', async () => {
      const cloned = await manager.clonePersona('senior-developer', 'My Senior Dev');

      expect(cloned).not.toBeNull();
      expect(cloned?.name).toBe('My Senior Dev');
      expect(cloned?.isBuiltin).toBe(false);
    });
  });

  describe('autoSelectPersona', () => {
    it('should select based on keyword triggers', () => {
      const selected = manager.autoSelectPersona({
        message: 'Can you explain how this works?',
      });

      // Should match teacher's "explain" trigger
      expect(selected?.id).toBe('teacher');
    });

    it('should select debugger for error messages', () => {
      const selected = manager.autoSelectPersona({
        message: 'I have an error in my code',
      });

      expect(selected?.id).toBe('debugger');
    });

    it('should select code-reviewer for review command', () => {
      const selected = manager.autoSelectPersona({
        command: 'review',
      });

      expect(selected?.id).toBe('code-reviewer');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should build prompt from active persona', () => {
      manager.setActivePersona('default');
      const prompt = manager.buildSystemPrompt();

      expect(prompt).toContain('helpful coding assistant');
    });

    it('should include style guidelines', () => {
      manager.setActivePersona('minimalist');
      const prompt = manager.buildSystemPrompt();

      expect(prompt).toContain('Style guidelines');
    });

    it('should include additional context', () => {
      const prompt = manager.buildSystemPrompt('Extra context here');
      expect(prompt).toContain('Extra context here');
    });
  });

  describe('exportPersona', () => {
    it('should export as JSON', async () => {
      const json = await manager.exportPersona('default');
      const data = JSON.parse(json);

      expect(data.id).toBe('default');
      expect(data.systemPrompt).toBeDefined();
    });

    it('should throw for unknown persona', async () => {
      await expect(manager.exportPersona('unknown')).rejects.toThrow(
        'Persona not found'
      );
    });
  });

  describe('importPersona', () => {
    it('should import persona from JSON', async () => {
      const json = JSON.stringify({
        name: 'Imported Persona',
        description: 'An imported persona',
        systemPrompt: 'You are imported.',
      });

      const imported = await manager.importPersona(json);

      expect(imported.name).toBe('Imported Persona');
      expect(imported.isBuiltin).toBe(false);
    });

    it('should throw for invalid JSON', async () => {
      await expect(manager.importPersona('not valid json')).rejects.toThrow();
    });

    it('should throw for missing required fields', async () => {
      const json = JSON.stringify({ description: 'Missing name and prompt' });
      await expect(manager.importPersona(json)).rejects.toThrow('missing required');
    });
  });

  describe('formatStatus', () => {
    it('should render status', () => {
      const status = manager.formatStatus();

      expect(status).toContain('PERSONA MANAGER');
      expect(status).toContain('Active');
      expect(status).toContain('AVAILABLE PERSONAS');
    });
  });

  describe('events', () => {
    it('should emit persona:changed event', () => {
      const handler = jest.fn();
      manager.on('persona:changed', handler);

      manager.setActivePersona('debugger');

      expect(handler).toHaveBeenCalled();
    });

    it('should emit persona:created event', async () => {
      const handler = jest.fn();
      manager.on('persona:created', handler);

      await manager.createPersona({
        name: 'Event Test',
        description: 'Test',
        systemPrompt: 'Prompt',
      });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetPersonaManager();
      const instance1 = getPersonaManager();
      const instance2 = getPersonaManager();
      expect(instance1).toBe(instance2);
    });
  });
});
