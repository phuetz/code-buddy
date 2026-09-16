import type { CodeBuddyTool } from './client.js';
import type { ToolSchema } from '../tools/registry/types.js';

export const RESOURCE_CATALOG_TOOL_DEF = {
  type: 'function',
  function: {
    name: 'resource_catalog',
    description: 'Read the explicitly configured network resource catalog or select a fresh permitted resource by declared capability. No network probe, write, execution or automatic dispatch. Health is not proof of working capabilities; load is unknown. Never infer missing resources. RagChat search uses its separately configured RAGCHAT_BASE_URL; selecting another endpointRef does not switch that tool. Stale observations require an explicit operator resources probe command.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['list', 'select'], description: 'List declarations and current freshness, or select a compatible resource.' },
        capability: { type: 'string', description: 'Exact declared capability identifier, required for select.' },
        kind: { type: 'string', enum: ['inference', 'comfyui', 'storage', 'rag', 'database', 'docker', 'code-explorer', 'camera', 'microphone'], description: 'Optional resource kind filter for select.' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
} satisfies CodeBuddyTool & { function: ToolSchema };
