/**
 * Tests for TemplateRepairEngine
 *
 * Comprehensive tests covering:
 * - Template matching and application
 * - Patch generation
 * - Template management (add, remove, get)
 * - Success rate tracking and learning
 * - Statistics collection
 * - All repair template categories
 */

import {
  TemplateRepairEngine,
  createTemplateRepairEngine,
  REPAIR_TEMPLATES,
} from '../../src/agent/repair/repair-templates';
import type {
  RepairTemplate,
  Fault,
  FaultType,
  FaultSeverity,
} from '../../src/agent/repair/types';

// Helper function to create a fault for testing
function createFault(
  type: FaultType,
  file: string = 'test.ts',
  startLine: number = 10,
  severity: FaultSeverity = 'high'
): Fault {
  return {
    id: `fault-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    severity,
    message: `Test ${type} error`,
    location: {
      file,
      startLine,
      endLine: startLine,
    },
    suspiciousness: 0.8,
    metadata: {},
  };
}

describe('TemplateRepairEngine', () => {
  let engine: TemplateRepairEngine;

  beforeEach(() => {
    engine = createTemplateRepairEngine();
  });

  describe('Construction', () => {
    it('should create with default templates', () => {
      const eng = new TemplateRepairEngine();
      expect(eng).toBeInstanceOf(TemplateRepairEngine);
      expect(eng.getTemplates().length).toBe(REPAIR_TEMPLATES.length);
    });

    it('should create with custom templates added to defaults', () => {
      const customTemplate: RepairTemplate = {
        id: 'custom-template',
        name: 'Custom Template',
        description: 'A custom template for testing',
        applicableTo: ['runtime_error'],
        pattern: 'customPattern',
        fix: 'customFix',
        priority: 10,
      };
      const eng = new TemplateRepairEngine([customTemplate]);
      expect(eng.getTemplates().length).toBe(REPAIR_TEMPLATES.length + 1);
      expect(eng.getTemplates().some(t => t.id === 'custom-template')).toBe(true);
    });

    it('should use factory function to create instance', () => {
      const eng = createTemplateRepairEngine();
      expect(eng).toBeInstanceOf(TemplateRepairEngine);
    });
  });

  describe('findApplicableTemplates', () => {
    it('should find templates for null_reference faults', () => {
      const fault = createFault('null_reference');
      const templates = engine.findApplicableTemplates(fault);

      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        expect(t.applicableTo).toContain('null_reference');
      });
    });

    it('should find templates for type_error faults', () => {
      const fault = createFault('type_error');
      const templates = engine.findApplicableTemplates(fault);

      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        expect(t.applicableTo).toContain('type_error');
      });
    });

    it('should find templates for runtime_error faults', () => {
      const fault = createFault('runtime_error');
      const templates = engine.findApplicableTemplates(fault);

      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        expect(t.applicableTo).toContain('runtime_error');
      });
    });

    it('should find templates for logic_error faults', () => {
      const fault = createFault('logic_error');
      const templates = engine.findApplicableTemplates(fault);

      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        expect(t.applicableTo).toContain('logic_error');
      });
    });

    it('should find templates for boundary_error faults', () => {
      const fault = createFault('boundary_error');
      const templates = engine.findApplicableTemplates(fault);

      expect(templates.length).toBeGreaterThan(0);
      templates.forEach(t => {
        expect(t.applicableTo).toContain('boundary_error');
      });
    });

    it('should return empty array for unknown fault type', () => {
      const fault = createFault('unknown');
      const templates = engine.findApplicableTemplates(fault);

      expect(templates.length).toBe(0);
    });

    it('should sort templates by success rate then priority', () => {
      const fault = createFault('null_reference');

      // Record some successes for a template
      engine.recordResult('null-check-before-access', true);
      engine.recordResult('null-check-before-access', true);
      engine.recordResult('add-optional-chaining-call', false);

      const templates = engine.findApplicableTemplates(fault);

      // The template with higher success rate should come first
      const nullCheckIndex = templates.findIndex(t => t.id === 'null-check-before-access');
      const optionalChainIndex = templates.findIndex(t => t.id === 'add-optional-chaining-call');

      if (nullCheckIndex !== -1 && optionalChainIndex !== -1) {
        expect(nullCheckIndex).toBeLessThan(optionalChainIndex);
      }
    });
  });

  describe('applyTemplate', () => {
    it('should apply null check template', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-before-access')!;
      const codeContext = 'const value = obj.property;';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('?.');
    });

    it('should apply nullish coalescing template', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-with-default')!;
      const codeContext = 'const value = x || defaultValue;';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('??');
    });

    it('should apply optional chaining for method calls', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'add-optional-chaining-call')!;
      const codeContext = 'obj.method()';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('?.method(');
    });

    it('should apply strict equality template', () => {
      const fault = createFault('logic_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-equality-loose-to-strict')!;
      const codeContext = 'if (a == b)';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('===');
    });

    it('should apply AND to OR operator fix', () => {
      const fault = createFault('logic_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-and-to-or')!;
      const codeContext = 'if (a && b)';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('||');
    });

    it('should apply OR to AND operator fix', () => {
      const fault = createFault('logic_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-or-to-and')!;
      const codeContext = 'if (a || b)';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('&&');
    });

    it('should apply try-catch wrapper template', () => {
      const fault = createFault('runtime_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'wrap-try-catch')!;
      const codeContext = '  riskyOperation();';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('try {');
      expect(patch!.changes[0].newCode).toContain('catch');
    });

    it('should apply add await template', () => {
      const fault = createFault('runtime_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'add-await')!;
      const codeContext = 'result = asyncFunction(';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('await');
    });

    it('should apply array check template', () => {
      const fault = createFault('type_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'add-array-check')!;
      const codeContext = 'items.map(x => x * 2)';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('Array.isArray');
    });

    it('should apply default array template', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'add-default-array')!;
      const codeContext = 'data.map(item => item.name)';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('|| []');
    });

    it('should apply default object template', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'add-default-object')!;
      const codeContext = 'Object.keys(obj)';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('|| {}');
    });

    it('should apply type import template', () => {
      const fault = createFault('type_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'add-import-type')!;
      const codeContext = 'import { SomeType } from';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('import type');
    });

    it('should return null when pattern does not match', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-before-access')!;
      const codeContext = 'const x = 5;'; // No property access

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).toBeNull();
    });

    it('should return null when fix produces same code', () => {
      const fault = createFault('null_reference');
      // Create a template where fix might not change anything
      const template: RepairTemplate = {
        id: 'no-change-template',
        name: 'No Change',
        description: 'A template that might not change code',
        applicableTo: ['null_reference'],
        pattern: 'nonexistent',
        fix: '$1',
        priority: 1,
      };

      const patch = engine.applyTemplate(template, fault, 'const x = 5;');

      expect(patch).toBeNull();
    });

    it('should handle regex errors gracefully', () => {
      const fault = createFault('runtime_error');
      // Template with invalid regex
      const template: RepairTemplate = {
        id: 'invalid-regex',
        name: 'Invalid Regex',
        description: 'Template with bad regex',
        applicableTo: ['runtime_error'],
        pattern: '([invalid',
        fix: '$1',
        priority: 1,
      };

      const patch = engine.applyTemplate(template, fault, 'some code');

      expect(patch).toBeNull();
    });
  });

  describe('generatePatches', () => {
    it('should generate multiple patches', () => {
      const fault = createFault('null_reference');
      const codeContext = 'const value = obj.prop;';

      const patches = engine.generatePatches(fault, codeContext, 5);

      expect(patches.length).toBeGreaterThan(0);
      expect(patches.length).toBeLessThanOrEqual(5);
    });

    it('should respect maxPatches limit', () => {
      const fault = createFault('type_error');
      const codeContext = 'const x = obj.prop; if (a == b) { data.map(i => i); }';

      const patches = engine.generatePatches(fault, codeContext, 2);

      expect(patches.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array when no templates match', () => {
      const fault = createFault('concurrency_error'); // No templates for this
      const codeContext = 'const x = 5;';

      const patches = engine.generatePatches(fault, codeContext);

      expect(patches).toEqual([]);
    });

    it('should generate unique patch IDs', () => {
      const fault = createFault('null_reference');
      const codeContext = 'obj.prop1; obj.prop2; obj.prop3;';

      const patches = engine.generatePatches(fault, codeContext, 10);

      const ids = patches.map(p => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include fault reference in each patch', () => {
      const fault = createFault('runtime_error');
      const codeContext = 'obj.method()';

      const patches = engine.generatePatches(fault, codeContext);

      patches.forEach(patch => {
        expect(patch.fault).toBe(fault);
      });
    });

    it('should set generatedBy to template', () => {
      const fault = createFault('null_reference');
      const codeContext = 'obj.property';

      const patches = engine.generatePatches(fault, codeContext);

      patches.forEach(patch => {
        expect(patch.generatedBy).toBe('template');
      });
    });

    it('should set validated to false', () => {
      const fault = createFault('null_reference');
      const codeContext = 'obj.property';

      const patches = engine.generatePatches(fault, codeContext);

      patches.forEach(patch => {
        expect(patch.validated).toBe(false);
      });
    });
  });

  describe('Patch Structure', () => {
    it('should have correct patch structure', () => {
      const fault = createFault('null_reference');
      const codeContext = 'obj.property';
      const patches = engine.generatePatches(fault, codeContext, 1);

      expect(patches.length).toBeGreaterThan(0);
      const patch = patches[0];

      expect(patch).toHaveProperty('id');
      expect(patch).toHaveProperty('fault');
      expect(patch).toHaveProperty('changes');
      expect(patch).toHaveProperty('strategy');
      expect(patch).toHaveProperty('confidence');
      expect(patch).toHaveProperty('explanation');
      expect(patch).toHaveProperty('generatedBy');
      expect(patch).toHaveProperty('validated');
    });

    it('should have correct change structure', () => {
      const fault = createFault('null_reference');
      const codeContext = 'obj.property';
      const patches = engine.generatePatches(fault, codeContext, 1);

      const change = patches[0].changes[0];

      expect(change).toHaveProperty('file');
      expect(change).toHaveProperty('type');
      expect(change).toHaveProperty('startLine');
      expect(change).toHaveProperty('endLine');
      expect(change).toHaveProperty('originalCode');
      expect(change).toHaveProperty('newCode');
      expect(change.type).toBe('replace');
    });

    it('should calculate confidence between 0 and 1', () => {
      const fault = createFault('null_reference');
      const codeContext = 'obj.property';
      const patches = engine.generatePatches(fault, codeContext);

      patches.forEach(patch => {
        expect(patch.confidence).toBeGreaterThanOrEqual(0);
        expect(patch.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should include template description as explanation', () => {
      const fault = createFault('null_reference');
      const codeContext = 'obj.property';
      const patches = engine.generatePatches(fault, codeContext, 1);

      expect(patches[0].explanation).toBeDefined();
      expect(patches[0].explanation.length).toBeGreaterThan(0);
    });
  });

  describe('Confidence Calculation', () => {
    it('should adjust confidence based on success rate', () => {
      // Record many successes for a template
      for (let i = 0; i < 10; i++) {
        engine.recordResult('null-check-before-access', true);
      }

      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-before-access')!;
      const patch1 = engine.applyTemplate(template, fault, 'obj.prop');

      // Create new engine with no history
      const newEngine = createTemplateRepairEngine();
      const patch2 = newEngine.applyTemplate(template, fault, 'obj.prop');

      // Patch from engine with successes should have higher confidence
      expect(patch1!.confidence).toBeGreaterThan(patch2!.confidence);
    });

    it('should adjust confidence based on fault severity', () => {
      const criticalFault = createFault('null_reference', 'test.ts', 10, 'critical');
      const lowFault = createFault('null_reference', 'test.ts', 10, 'low');

      const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-before-access')!;

      const criticalPatch = engine.applyTemplate(template, criticalFault, 'obj.prop');
      const lowPatch = engine.applyTemplate(template, lowFault, 'obj.prop');

      // Low severity should have higher confidence adjustment
      expect(lowPatch!.confidence).toBeGreaterThan(criticalPatch!.confidence);
    });
  });

  describe('Success Rate Tracking', () => {
    it('should record success and update success rate', () => {
      const templateId = 'null-check-before-access';

      engine.recordResult(templateId, true);
      expect(engine.getSuccessRate(templateId)).toBe(1.0);

      engine.recordResult(templateId, false);
      expect(engine.getSuccessRate(templateId)).toBe(0.5);

      engine.recordResult(templateId, true);
      expect(engine.getSuccessRate(templateId)).toBeCloseTo(0.67, 1);
    });

    it('should return default success rate for template with no history', () => {
      const successRate = engine.getSuccessRate('null-check-before-access');

      // Should return template's built-in successRate or 0.5 default
      expect(successRate).toBeDefined();
      expect(successRate).toBeGreaterThanOrEqual(0);
      expect(successRate).toBeLessThanOrEqual(1);
    });

    it('should return 0.5 for unknown template', () => {
      const successRate = engine.getSuccessRate('unknown-template-id');

      expect(successRate).toBe(0.5);
    });
  });

  describe('Statistics', () => {
    it('should return statistics for all templates', () => {
      const stats = engine.getStatistics();

      expect(stats).toBeInstanceOf(Map);
      expect(stats.size).toBe(REPAIR_TEMPLATES.length);
    });

    it('should include template metadata in statistics', () => {
      const stats = engine.getStatistics();

      for (const [id, stat] of stats) {
        expect(stat).toHaveProperty('id');
        expect(stat).toHaveProperty('name');
        expect(stat).toHaveProperty('successRate');
        expect(stat).toHaveProperty('attempts');
        expect(stat.id).toBe(id);
      }
    });

    it('should track attempts in statistics', () => {
      engine.recordResult('null-check-before-access', true);
      engine.recordResult('null-check-before-access', false);
      engine.recordResult('null-check-before-access', true);

      const stats = engine.getStatistics();
      const templateStat = stats.get('null-check-before-access');

      expect(templateStat!.attempts).toBe(3);
      expect(templateStat!.successRate).toBeCloseTo(0.67, 1);
    });
  });

  describe('Template Management', () => {
    describe('addTemplate', () => {
      it('should add new template', () => {
        const newTemplate: RepairTemplate = {
          id: 'new-custom-template',
          name: 'New Custom Template',
          description: 'A new template',
          applicableTo: ['runtime_error'],
          pattern: 'custom',
          fix: 'fixed',
          priority: 5,
        };

        const initialCount = engine.getTemplates().length;
        engine.addTemplate(newTemplate);

        expect(engine.getTemplates().length).toBe(initialCount + 1);
        expect(engine.getTemplates().find(t => t.id === 'new-custom-template')).toBeDefined();
      });

      it('should replace existing template with same ID', () => {
        const template: RepairTemplate = {
          id: 'null-check-before-access',
          name: 'Updated Null Check',
          description: 'Updated description',
          applicableTo: ['null_reference', 'runtime_error'],
          pattern: 'updatedPattern',
          fix: 'updatedFix',
          priority: 15,
        };

        const initialCount = engine.getTemplates().length;
        engine.addTemplate(template);

        expect(engine.getTemplates().length).toBe(initialCount); // Count should not change
        const updated = engine.getTemplates().find(t => t.id === 'null-check-before-access');
        expect(updated!.name).toBe('Updated Null Check');
        expect(updated!.priority).toBe(15);
      });
    });

    describe('removeTemplate', () => {
      it('should remove existing template', () => {
        const initialCount = engine.getTemplates().length;
        const result = engine.removeTemplate('null-check-before-access');

        expect(result).toBe(true);
        expect(engine.getTemplates().length).toBe(initialCount - 1);
        expect(engine.getTemplates().find(t => t.id === 'null-check-before-access')).toBeUndefined();
      });

      it('should return false for non-existent template', () => {
        const result = engine.removeTemplate('non-existent-id');

        expect(result).toBe(false);
      });
    });

    describe('getTemplates', () => {
      it('should return copy of templates array', () => {
        const templates1 = engine.getTemplates();
        templates1.push({
          id: 'injected',
          name: 'Injected',
          description: 'Should not affect engine',
          applicableTo: ['unknown'],
          pattern: '',
          fix: '',
          priority: 0,
        });

        const templates2 = engine.getTemplates();
        expect(templates2.find(t => t.id === 'injected')).toBeUndefined();
      });
    });
  });

  describe('Template Categories', () => {
    describe('Null/Undefined Check Templates', () => {
      it('should have null-check-before-access template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-before-access');
        expect(template).toBeDefined();
        expect(template!.applicableTo).toContain('null_reference');
      });

      it('should have null-check-with-default template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-with-default');
        expect(template).toBeDefined();
      });

      it('should have add-optional-chaining-call template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'add-optional-chaining-call');
        expect(template).toBeDefined();
      });

      it('should have guard-clause-null template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'guard-clause-null');
        expect(template).toBeDefined();
      });
    });

    describe('Off-by-One Error Templates', () => {
      it('should have fix-array-bound-lt template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-array-bound-lt');
        expect(template).toBeDefined();
        expect(template!.applicableTo).toContain('boundary_error');
      });

      it('should have fix-array-bound-le template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-array-bound-le');
        expect(template).toBeDefined();
      });

      it('should have fix-index-minus-one template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-index-minus-one');
        expect(template).toBeDefined();
      });

      it('should have fix-index-plus-one template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-index-plus-one');
        expect(template).toBeDefined();
      });
    });

    describe('Operator Fix Templates', () => {
      it('should have equality fix templates', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-equality-loose-to-strict')).toBeDefined();
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-equality-strict-to-loose')).toBeDefined();
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-inequality-ne-to-strict')).toBeDefined();
      });

      it('should have logical operator fix templates', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-and-to-or')).toBeDefined();
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-or-to-and')).toBeDefined();
      });

      it('should have comparison operator fix templates', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-greater-to-less')).toBeDefined();
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-less-to-greater')).toBeDefined();
      });
    });

    describe('Return Statement Templates', () => {
      it('should have add-missing-return template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'add-missing-return');
        expect(template).toBeDefined();
        expect(template!.applicableTo).toContain('type_error');
      });

      it('should have fix-return-undefined template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-return-undefined')).toBeDefined();
      });

      it('should have add-return-null template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-return-null')).toBeDefined();
      });
    });

    describe('Type Fix Templates', () => {
      it('should have add-type-assertion template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-type-assertion')).toBeDefined();
      });

      it('should have add-number-coercion template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-number-coercion')).toBeDefined();
      });

      it('should have add-string-coercion template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-string-coercion')).toBeDefined();
      });

      it('should have add-json-parse template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-json-parse')).toBeDefined();
      });
    });

    describe('Import Fix Templates', () => {
      it('should have add-import-type template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-import-type')).toBeDefined();
      });

      it('should have fix-default-import template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'fix-default-import')).toBeDefined();
      });
    });

    describe('Error Handling Templates', () => {
      it('should have wrap-try-catch template', () => {
        const template = REPAIR_TEMPLATES.find(t => t.id === 'wrap-try-catch');
        expect(template).toBeDefined();
        expect(template!.applicableTo).toContain('runtime_error');
      });

      it('should have add-error-boundary template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-error-boundary')).toBeDefined();
      });
    });

    describe('Async/Await Templates', () => {
      it('should have add-await template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-await')).toBeDefined();
      });

      it('should have add-async-keyword template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-async-keyword')).toBeDefined();
      });
    });

    describe('Array/Object Templates', () => {
      it('should have add-array-check template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-array-check')).toBeDefined();
      });

      it('should have add-default-array template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-default-array')).toBeDefined();
      });

      it('should have add-default-object template', () => {
        expect(REPAIR_TEMPLATES.find(t => t.id === 'add-default-object')).toBeDefined();
      });
    });
  });

  describe('Template Application Edge Cases', () => {
    it('should handle empty code context', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-before-access')!;

      const patch = engine.applyTemplate(template, fault, '');

      expect(patch).toBeNull();
    });

    it('should handle code with special characters', () => {
      const fault = createFault('null_reference');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'null-check-before-access')!;
      // Use valid JavaScript identifiers ($ is valid at start but template pattern uses \w which includes _)
      const codeContext = 'const value = obj_special.property;';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('?.');
    });

    it('should handle simple single line code context', () => {
      const fault = createFault('runtime_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'wrap-try-catch')!;
      // The wrap-try-catch pattern uses ^ and $ anchors for single line
      const codeContext = '  riskyCall();';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      expect(patch!.changes[0].newCode).toContain('try {');
    });

    it('should apply global replacement', () => {
      const fault = createFault('logic_error');
      const template = REPAIR_TEMPLATES.find(t => t.id === 'fix-and-to-or')!;
      const codeContext = 'if (a && b && c)';

      const patch = engine.applyTemplate(template, fault, codeContext);

      expect(patch).not.toBeNull();
      // All && should be replaced with ||
      expect(patch!.changes[0].newCode).not.toContain('&&');
    });
  });
});

describe('REPAIR_TEMPLATES Constant', () => {
  it('should be an array', () => {
    expect(Array.isArray(REPAIR_TEMPLATES)).toBe(true);
  });

  it('should contain templates with required properties', () => {
    REPAIR_TEMPLATES.forEach(template => {
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('description');
      expect(template).toHaveProperty('applicableTo');
      expect(template).toHaveProperty('pattern');
      expect(template).toHaveProperty('fix');
      expect(template).toHaveProperty('priority');

      expect(typeof template.id).toBe('string');
      expect(typeof template.name).toBe('string');
      expect(typeof template.description).toBe('string');
      expect(Array.isArray(template.applicableTo)).toBe(true);
      expect(typeof template.pattern).toBe('string');
      expect(typeof template.fix).toBe('string');
      expect(typeof template.priority).toBe('number');
    });
  });

  it('should have unique template IDs', () => {
    const ids = REPAIR_TEMPLATES.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have valid priority values', () => {
    REPAIR_TEMPLATES.forEach(template => {
      expect(template.priority).toBeGreaterThanOrEqual(0);
      expect(template.priority).toBeLessThanOrEqual(20);
    });
  });

  it('should have valid applicableTo fault types', () => {
    const validTypes: FaultType[] = [
      'syntax_error', 'type_error', 'runtime_error', 'logic_error',
      'null_reference', 'boundary_error', 'resource_leak', 'concurrency_error',
      'security_vulnerability', 'performance_issue', 'test_failure', 'lint_error', 'unknown'
    ];

    REPAIR_TEMPLATES.forEach(template => {
      template.applicableTo.forEach(type => {
        expect(validTypes).toContain(type);
      });
    });
  });

  it('should have compilable regex patterns', () => {
    REPAIR_TEMPLATES.forEach(template => {
      expect(() => new RegExp(template.pattern)).not.toThrow();
    });
  });
});
