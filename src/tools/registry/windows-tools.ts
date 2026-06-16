import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, IToolExecutionContext } from './types.js';
import { OfficeMacroTool, OfficeMacroToolInput } from '../office-macro-tool.js';

class OfficeMacroExecuteAdapter implements ITool {
  public name = 'office_macro_execute';
  public description = 'Executes VBA or PowerShell macros directly in Windows Microsoft Office applications.';
  private impl = new OfficeMacroTool();

  public schema: ToolSchema = {
    name: 'office_macro_execute',
    description: 'Executes VBA or PowerShell macros directly in Windows Microsoft Office applications.',
    parameters: {
      type: "object",
      properties: {
        application: { type: "string" },
        macroCode: { type: "string" },
        type: { type: "string" },
        runHeadless: { type: "boolean" },
      },
      required: ["application", "macroCode", "type"],
    },
  };

  public metadata: IToolMetadata = {
    name: 'office_macro_execute',
    category: 'system',
    priority: 1,
    description: 'Executes macros in Microsoft Office (Windows only).',
    keywords: ['office', 'excel', 'word', 'powerpoint', 'vba', 'macro', 'windows', 'com'],
  };

  public getSchema(): ToolSchema {
    return this.schema;
  }

  public async execute(args: Record<string, unknown>, context: IToolExecutionContext): Promise<ToolResult> {
    const input = args as unknown as OfficeMacroToolInput;
    return this.impl.execute(input);
  }

  public validate(args: Record<string, unknown>): IValidationResult {
    if (!args.application) return { valid: false, errors: ['Missing application'] };
    if (!args.macroCode) return { valid: false, errors: ['Missing macroCode'] };
    if (!args.type) return { valid: false, errors: ['Missing type'] };
    return { valid: true };
  }
}

export function createWindowsTools(): ITool[] {
  return [new OfficeMacroExecuteAdapter()];
}
