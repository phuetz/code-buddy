import type { CodeBuddyTool } from './types.js';

export const COMFY_RECIPE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'comfy_recipe',
    description: 'List, preflight, or run a registered local ComfyUI image/video/audio/3D recipe. A run may upload only workspace-local PNG/JPEG/WebP files whose ids exactly match recipe-declared image bindings. Mask/audio inputs, arbitrary workflows, and downloads remain blocked. Outputs stay under the active workspace. commercial_use is mandatory and run requires fresh user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'preflight', 'run'], description: 'Operation to perform.' },
        commercial_use: { type: 'boolean', description: 'Explicitly declare commercial intent.' },
        recipe_id: { type: 'string', description: 'Registered recipe id for preflight/run.' },
        version: { type: 'string', description: 'Optional exact recipe version.' },
        prompt: { type: 'string', description: 'Text prompt for run.' },
        negative_prompt: { type: 'string', description: 'Optional negative prompt.' },
        seed: { type: 'number', description: 'Optional non-negative integer seed.' },
        width: { type: 'number', description: 'Optional width; supply height too.' },
        height: { type: 'number', description: 'Optional height; supply width too.' },
        allow_fallback: { type: 'boolean', description: 'Allow only registered recipe fallbacks.', default: true },
        reference_images: {
          type: 'array',
          description: 'Run-only workspace-local images mapped to exact recipe image-binding ids.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Exact recipe-declared image binding id.' },
              path: { type: 'string', description: 'Relative workspace path to a PNG, JPEG, or WebP file.' },
            },
            required: ['id', 'path'],
          },
        },
      },
      required: ['action', 'commercial_use'],
    },
  },
};

export const COMFY_RECIPE_TOOLS: CodeBuddyTool[] = [COMFY_RECIPE_TOOL];
