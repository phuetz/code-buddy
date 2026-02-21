
import { ITool, ToolSchema, IToolMetadata } from './types.js';
import { PlanTool } from '../plan-tool.js';

export function createPlanTools(): ITool[] {
  return [
    new PlanTool(),
  ];
}
