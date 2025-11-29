/**
 * Repair Templates Module
 *
 * Defines common repair patterns and templates for automated program repair.
 *
 * Based on research:
 * - PAR (Kim et al., 2013) - Pattern-based repair
 * - ITER (arXiv 2403.00418) - Iterative template repair
 * - Genesis (Long et al., 2017) - Code transform patterns
 */

import {
  RepairTemplate,
  FaultType,
  Fault,
  PatchChange,
  RepairPatch,
  RepairStrategy,
} from "./types.js";

/**
 * Collection of repair templates
 */
export const REPAIR_TEMPLATES: RepairTemplate[] = [
  // Null/undefined check templates
  {
    id: "null-check-before-access",
    name: "Add null check before property access",
    description: "Adds a null/undefined check before accessing object properties",
    applicableTo: ["null_reference", "runtime_error", "type_error"],
    pattern: "([a-zA-Z_$][a-zA-Z0-9_$]*)\\.(\\w+)",
    fix: "$1?.$2",
    priority: 10,
  },
  {
    id: "null-check-with-default",
    name: "Add null check with default value",
    description: "Adds nullish coalescing operator for default values",
    applicableTo: ["null_reference", "runtime_error"],
    pattern: "([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\|\\|\\s*(.+)",
    fix: "$1 ?? $2",
    priority: 9,
  },
  {
    id: "add-optional-chaining-call",
    name: "Add optional chaining for method calls",
    description: "Converts method call to optional chaining",
    applicableTo: ["null_reference", "runtime_error"],
    pattern: "([a-zA-Z_$][a-zA-Z0-9_$]*)\\.(\\w+)\\(",
    fix: "$1?.$2(",
    priority: 9,
  },
  {
    id: "guard-clause-null",
    name: "Add guard clause for null",
    description: "Adds early return if variable is null",
    applicableTo: ["null_reference"],
    pattern: "function\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{",
    fix: "function $1($2) {\n  if ($2 == null) return;",
    conditions: [{ type: "context", check: "hasParam", value: "true" }],
    priority: 8,
  },

  // Off-by-one error templates
  {
    id: "fix-array-bound-lt",
    name: "Fix array bound (< to <=)",
    description: "Changes < to <= for inclusive bounds",
    applicableTo: ["boundary_error", "runtime_error"],
    pattern: "for\\s*\\([^;]+;\\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*<\\s*([^;]+)\\.length",
    fix: "for ($1; $1 <= $2.length - 1",
    priority: 7,
  },
  {
    id: "fix-array-bound-le",
    name: "Fix array bound (<= to <)",
    description: "Changes <= to < for exclusive bounds",
    applicableTo: ["boundary_error", "runtime_error"],
    pattern: "for\\s*\\([^;]+;\\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*<=\\s*([^;]+)\\.length",
    fix: "for ($1; $1 < $2.length",
    priority: 7,
  },
  {
    id: "fix-index-minus-one",
    name: "Subtract 1 from array index",
    description: "Fixes off-by-one by subtracting 1 from index",
    applicableTo: ["boundary_error"],
    pattern: "\\[([a-zA-Z_$][a-zA-Z0-9_$]*)\\]",
    fix: "[$1 - 1]",
    priority: 6,
  },
  {
    id: "fix-index-plus-one",
    name: "Add 1 to array index",
    description: "Fixes off-by-one by adding 1 to index",
    applicableTo: ["boundary_error"],
    pattern: "\\[([a-zA-Z_$][a-zA-Z0-9_$]*)\\]",
    fix: "[$1 + 1]",
    priority: 6,
  },

  // Operator fix templates
  {
    id: "fix-equality-loose-to-strict",
    name: "Change == to ===",
    description: "Changes loose equality to strict equality",
    applicableTo: ["logic_error", "type_error"],
    pattern: "([^=!])\\s*==\\s*([^=])",
    fix: "$1 === $2",
    priority: 8,
  },
  {
    id: "fix-equality-strict-to-loose",
    name: "Change === to ==",
    description: "Changes strict equality to loose equality",
    applicableTo: ["logic_error"],
    pattern: "===",
    fix: "==",
    priority: 5,
  },
  {
    id: "fix-inequality-ne-to-strict",
    name: "Change != to !==",
    description: "Changes loose inequality to strict inequality",
    applicableTo: ["logic_error", "type_error"],
    pattern: "!=([^=])",
    fix: "!==$1",
    priority: 8,
  },
  {
    id: "fix-and-to-or",
    name: "Change && to ||",
    description: "Changes logical AND to OR",
    applicableTo: ["logic_error"],
    pattern: "&&",
    fix: "||",
    priority: 4,
  },
  {
    id: "fix-or-to-and",
    name: "Change || to &&",
    description: "Changes logical OR to AND",
    applicableTo: ["logic_error"],
    pattern: "\\|\\|",
    fix: "&&",
    priority: 4,
  },
  {
    id: "fix-greater-to-less",
    name: "Change > to <",
    description: "Swaps comparison direction",
    applicableTo: ["logic_error", "boundary_error"],
    pattern: "([^-])>([^=])",
    fix: "$1<$2",
    priority: 5,
  },
  {
    id: "fix-less-to-greater",
    name: "Change < to >",
    description: "Swaps comparison direction",
    applicableTo: ["logic_error", "boundary_error"],
    pattern: "([^<])<([^=])",
    fix: "$1>$2",
    priority: 5,
  },

  // Return statement templates
  {
    id: "add-missing-return",
    name: "Add missing return statement",
    description: "Adds return before the last expression",
    applicableTo: ["type_error", "logic_error"],
    pattern: "\\{([^{}]*?)([a-zA-Z_$][a-zA-Z0-9_$]*(?:\\.[a-zA-Z_$][a-zA-Z0-9_$]*)*(?:\\([^)]*\\))?)\\s*;?\\s*\\}$",
    fix: "{$1return $2;\n}",
    priority: 7,
  },
  {
    id: "fix-return-undefined",
    name: "Return undefined explicitly",
    description: "Adds explicit return undefined",
    applicableTo: ["type_error"],
    pattern: "return\\s*;",
    fix: "return undefined;",
    priority: 6,
  },
  {
    id: "add-return-null",
    name: "Add return null",
    description: "Adds return null at end of function",
    applicableTo: ["type_error"],
    pattern: "(function\\s*\\([^)]*\\)\\s*\\{[^}]*)\\}",
    fix: "$1\n  return null;\n}",
    priority: 5,
  },

  // Type fix templates
  {
    id: "add-type-assertion",
    name: "Add type assertion",
    description: "Adds 'as' type assertion",
    applicableTo: ["type_error"],
    pattern: "([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*(.+)",
    fix: "$1 = $2 as any",
    priority: 4,
  },
  {
    id: "add-number-coercion",
    name: "Add Number() coercion",
    description: "Wraps value in Number()",
    applicableTo: ["type_error"],
    pattern: "([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*([+\\-*/])\\s*(.+)",
    fix: "Number($1) $2 Number($3)",
    priority: 5,
  },
  {
    id: "add-string-coercion",
    name: "Add String() coercion",
    description: "Wraps value in String()",
    applicableTo: ["type_error"],
    pattern: "([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\+\\s*(.+)",
    fix: "String($1) + String($2)",
    priority: 5,
  },
  {
    id: "add-json-parse",
    name: "Add JSON.parse",
    description: "Wraps string in JSON.parse",
    applicableTo: ["type_error", "runtime_error"],
    pattern: "([a-zA-Z_$][a-zA-Z0-9_$]*)\\.(\\w+)",
    fix: "JSON.parse($1).$2",
    priority: 4,
  },

  // Import fix templates
  {
    id: "add-import-type",
    name: "Add type-only import",
    description: "Converts import to type-only import",
    applicableTo: ["type_error"],
    pattern: "import\\s*\\{\\s*([^}]+)\\s*\\}\\s*from",
    fix: "import type { $1 } from",
    priority: 7,
  },
  {
    id: "fix-default-import",
    name: "Fix default import",
    description: "Changes named import to default import",
    applicableTo: ["type_error", "runtime_error"],
    pattern: "import\\s*\\{\\s*(\\w+)\\s*\\}\\s*from\\s*['\"]([^'\"]+)['\"]",
    fix: "import $1 from \"$2\"",
    priority: 6,
  },

  // Error handling templates
  {
    id: "wrap-try-catch",
    name: "Wrap in try-catch",
    description: "Wraps code block in try-catch",
    applicableTo: ["runtime_error", "null_reference"],
    pattern: "^(\\s*)(.+)$",
    fix: "$1try {\n$1  $2\n$1} catch (error) {\n$1  console.error(error);\n$1}",
    priority: 6,
  },
  {
    id: "add-error-boundary",
    name: "Add error handling with fallback",
    description: "Adds try-catch with fallback value",
    applicableTo: ["runtime_error"],
    pattern: "(const|let)\\s+(\\w+)\\s*=\\s*(.+);",
    fix: "$1 $2;\ntry {\n  $2 = $3;\n} catch {\n  $2 = null;\n}",
    priority: 5,
  },

  // Async/await templates
  {
    id: "add-await",
    name: "Add missing await",
    description: "Adds await to async function call",
    applicableTo: ["runtime_error", "type_error"],
    pattern: "(\\w+)\\s*=\\s*(\\w+)\\(",
    fix: "$1 = await $2(",
    priority: 7,
  },
  {
    id: "add-async-keyword",
    name: "Add async keyword",
    description: "Adds async keyword to function",
    applicableTo: ["type_error", "runtime_error"],
    pattern: "(function\\s+\\w+|const\\s+\\w+\\s*=)\\s*\\(",
    fix: "async $1(",
    priority: 6,
  },

  // Array/object templates
  {
    id: "add-array-check",
    name: "Add Array.isArray check",
    description: "Adds array check before array operations",
    applicableTo: ["type_error", "runtime_error"],
    pattern: "(\\w+)\\.map\\(",
    fix: "(Array.isArray($1) ? $1 : []).map(",
    priority: 7,
  },
  {
    id: "add-default-array",
    name: "Add default empty array",
    description: "Provides default empty array",
    applicableTo: ["null_reference", "type_error"],
    pattern: "(\\w+)\\.(map|filter|reduce|forEach)\\(",
    fix: "($1 || []).$2(",
    priority: 8,
  },
  {
    id: "add-default-object",
    name: "Add default empty object",
    description: "Provides default empty object",
    applicableTo: ["null_reference", "type_error"],
    pattern: "Object\\.(keys|values|entries)\\((\\w+)\\)",
    fix: "Object.$1($2 || {})",
    priority: 8,
  },
];

/**
 * Template-based Repair Engine
 */
export class TemplateRepairEngine {
  private templates: RepairTemplate[];
  private successCounts: Map<string, { successes: number; attempts: number }>;

  constructor(customTemplates?: RepairTemplate[]) {
    this.templates = customTemplates
      ? [...REPAIR_TEMPLATES, ...customTemplates]
      : [...REPAIR_TEMPLATES];
    this.successCounts = new Map();
  }

  /**
   * Find applicable templates for a fault
   */
  findApplicableTemplates(fault: Fault): RepairTemplate[] {
    return this.templates
      .filter((template) => template.applicableTo.includes(fault.type))
      .sort((a, b) => {
        // Sort by success rate first, then by priority
        const aRate = this.getSuccessRate(a.id);
        const bRate = this.getSuccessRate(b.id);
        if (aRate !== bRate) return bRate - aRate;
        return b.priority - a.priority;
      });
  }

  /**
   * Apply a template to generate a patch
   */
  applyTemplate(
    template: RepairTemplate,
    fault: Fault,
    codeContext: string
  ): RepairPatch | null {
    try {
      const regex = new RegExp(template.pattern, "g");
      const matches = codeContext.match(regex);

      if (!matches || matches.length === 0) {
        return null;
      }

      // Apply the fix
      const newCode = codeContext.replace(regex, template.fix);

      if (newCode === codeContext) {
        return null;
      }

      // Create patch
      const patch: RepairPatch = {
        id: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fault,
        changes: [
          {
            file: fault.location.file,
            type: "replace",
            startLine: fault.location.startLine,
            endLine: fault.location.endLine,
            originalCode: codeContext,
            newCode,
          },
        ],
        strategy: "template_instantiation" as RepairStrategy,
        confidence: this.calculateConfidence(template, fault),
        explanation: template.description,
        generatedBy: "template",
        validated: false,
      };

      return patch;
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate multiple patches from templates
   */
  generatePatches(
    fault: Fault,
    codeContext: string,
    maxPatches: number = 5
  ): RepairPatch[] {
    const patches: RepairPatch[] = [];
    const applicableTemplates = this.findApplicableTemplates(fault);

    for (const template of applicableTemplates) {
      if (patches.length >= maxPatches) break;

      const patch = this.applyTemplate(template, fault, codeContext);
      if (patch) {
        patches.push(patch);
      }
    }

    return patches;
  }

  /**
   * Calculate confidence for a template application
   */
  private calculateConfidence(template: RepairTemplate, fault: Fault): number {
    let confidence = 0.5;

    // Increase confidence based on success rate
    const successRate = this.getSuccessRate(template.id);
    confidence += successRate * 0.3;

    // Increase confidence based on priority
    confidence += (template.priority / 10) * 0.2;

    // Adjust based on fault severity
    if (fault.severity === "critical") confidence -= 0.1;
    if (fault.severity === "low") confidence += 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Record template success/failure for learning
   */
  recordResult(templateId: string, success: boolean): void {
    const current = this.successCounts.get(templateId) || {
      successes: 0,
      attempts: 0,
    };
    current.attempts++;
    if (success) current.successes++;
    this.successCounts.set(templateId, current);
  }

  /**
   * Get success rate for a template
   */
  getSuccessRate(templateId: string): number {
    const stats = this.successCounts.get(templateId);
    if (!stats || stats.attempts === 0) {
      // Use template's built-in success rate or default
      const template = this.templates.find((t) => t.id === templateId);
      return template?.successRate || 0.5;
    }
    return stats.successes / stats.attempts;
  }

  /**
   * Get all template statistics
   */
  getStatistics(): Map<string, { id: string; name: string; successRate: number; attempts: number }> {
    const stats = new Map();
    for (const template of this.templates) {
      const counts = this.successCounts.get(template.id) || {
        successes: 0,
        attempts: 0,
      };
      stats.set(template.id, {
        id: template.id,
        name: template.name,
        successRate: this.getSuccessRate(template.id),
        attempts: counts.attempts,
      });
    }
    return stats;
  }

  /**
   * Add a custom template
   */
  addTemplate(template: RepairTemplate): void {
    // Check for duplicate ID
    const existing = this.templates.findIndex((t) => t.id === template.id);
    if (existing >= 0) {
      this.templates[existing] = template;
    } else {
      this.templates.push(template);
    }
  }

  /**
   * Remove a template by ID
   */
  removeTemplate(templateId: string): boolean {
    const index = this.templates.findIndex((t) => t.id === templateId);
    if (index >= 0) {
      this.templates.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all templates
   */
  getTemplates(): RepairTemplate[] {
    return [...this.templates];
  }
}

/**
 * Create a template repair engine
 */
export function createTemplateRepairEngine(
  customTemplates?: RepairTemplate[]
): TemplateRepairEngine {
  return new TemplateRepairEngine(customTemplates);
}
