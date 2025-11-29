/**
 * Tests for Configuration Validator
 */

import { ConfigValidator, getConfigValidator, SCHEMAS } from '../src/utils/config-validator';

describe('ConfigValidator', () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  describe('validate', () => {
    describe('settings.json schema', () => {
      it('should accept valid settings', () => {
        const config = {
          model: 'grok-3-latest',
          maxRounds: 30,
          autonomyLevel: 'confirm',
          enableRAG: true,
        };

        const result = validator.validate(config, 'settings.json');

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject invalid autonomyLevel', () => {
        const config = {
          autonomyLevel: 'invalid-level',
        };

        const result = validator.validate(config, 'settings.json');

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].message).toContain('enum');
      });

      it('should reject maxRounds out of range', () => {
        const config = {
          maxRounds: 500, // > 100
        };

        const result = validator.validate(config, 'settings.json');

        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('too large');
      });

      it('should warn on unknown properties', () => {
        const config = {
          unknownProperty: 'value',
        };

        const result = validator.validate(config, 'settings.json');

        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0].message).toContain('Unknown property');
      });
    });

    describe('hooks.json schema', () => {
      it('should accept valid hooks config', () => {
        const config = {
          hooks: [
            {
              event: 'PostToolUse',
              command: 'npm run lint',
              description: 'Run linter after edits',
            },
          ],
        };

        const result = validator.validate(config, 'hooks.json');

        expect(result.valid).toBe(true);
      });

      it('should reject invalid hook event', () => {
        const config = {
          hooks: [
            {
              event: 'InvalidEvent',
              command: 'echo test',
            },
          ],
        };

        const result = validator.validate(config, 'hooks.json');

        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('enum');
      });

      it('should require command in hooks', () => {
        const config = {
          hooks: [
            {
              event: 'PostToolUse',
            },
          ],
        };

        const result = validator.validate(config, 'hooks.json');

        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('Required');
      });
    });

    describe('mcp.json schema', () => {
      it('should accept valid MCP config', () => {
        const config = {
          servers: {
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem'],
            },
          },
        };

        const result = validator.validate(config, 'mcp.json');

        expect(result.valid).toBe(true);
      });

      it('should require command for servers', () => {
        const config = {
          servers: {
            test: {
              args: ['arg1'],
            },
          },
        };

        const result = validator.validate(config, 'mcp.json');

        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain('Required');
      });
    });

    describe('yolo.json schema', () => {
      it('should accept valid YOLO config', () => {
        const config = {
          enabled: true,
          allowList: ['npm test'],
          denyList: ['rm -rf'],
          maxAutoEdits: 5,
        };

        const result = validator.validate(config, 'yolo.json');

        expect(result.valid).toBe(true);
      });

      it('should reject maxAutoEdits out of range', () => {
        const config = {
          maxAutoEdits: 200, // > 100
        };

        const result = validator.validate(config, 'yolo.json');

        expect(result.valid).toBe(false);
      });
    });
  });

  describe('getDefaults', () => {
    it('should return default values for settings.json', () => {
      const defaults = validator.getDefaults('settings.json');

      expect(defaults).toBeDefined();
      expect((defaults as Record<string, unknown>).maxRounds).toBe(30);
      expect((defaults as Record<string, unknown>).autonomyLevel).toBe('confirm');
    });
  });

  describe('formatResult', () => {
    it('should format valid result', () => {
      const result = validator.validate({}, 'settings.json');
      const formatted = validator.formatResult(result, 'settings.json');

      expect(formatted).toContain('settings.json');
    });

    it('should format errors properly', () => {
      const result = validator.validate({ maxRounds: 500 }, 'settings.json');
      const formatted = validator.formatResult(result, 'settings.json');

      expect(formatted).toContain('ERROR');
      expect(formatted).toContain('maxRounds');
    });
  });

  describe('getSchemas', () => {
    it('should return all available schemas', () => {
      const schemas = validator.getSchemas();

      expect(schemas).toContain('settings.json');
      expect(schemas).toContain('hooks.json');
      expect(schemas).toContain('mcp.json');
      expect(schemas).toContain('yolo.json');
    });
  });

  describe('getSchema', () => {
    it('should return specific schema', () => {
      const schema = validator.getSchema('settings.json');

      expect(schema).toBeDefined();
      expect(schema?.type).toBe('object');
      expect(schema?.properties).toBeDefined();
    });

    it('should return undefined for unknown schema', () => {
      const schema = validator.getSchema('nonexistent.json');

      expect(schema).toBeUndefined();
    });
  });

  describe('unknown schema', () => {
    it('should return error for unknown schema name', () => {
      const result = validator.validate({}, 'unknown.json');

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Unknown schema');
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getConfigValidator();
      const instance2 = getConfigValidator();
      expect(instance1).toBe(instance2);
    });
  });
});
