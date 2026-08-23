/**
 * Video-studio ITool adapters wrapping the PR #111 modules
 * (hybrid router, visual/YouTube gates, long-form + trailer plans, Google Flow handoff).
 * Dispatch surface: included from createMultimodalTools().
 */

import type { ITool } from './types.js';
import { VideoRouteTool } from '../video-route-tool.js';

export { VideoRouteTool };

export function createVideoStudioTools(): ITool[] {
  return [
    new VideoRouteTool(),
  ];
}
