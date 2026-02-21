import { ITool } from './types.js';
import { RunScriptTool } from '../run-script-tool.js';

export function createScriptTools(): ITool[] {
  return [
    new RunScriptTool(),
  ];
}
