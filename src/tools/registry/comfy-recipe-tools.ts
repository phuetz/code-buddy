import { ComfyRecipeTool } from '../comfy-recipe-tool.js';
import type { ITool } from './types.js';

export function createComfyRecipeTools(): ITool[] {
  return [new ComfyRecipeTool()];
}
