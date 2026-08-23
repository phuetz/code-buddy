/**
 * Video-studio ITool adapters wrapping the PR #111 modules
 * (hybrid router, visual/YouTube gates, long-form + trailer plans, Google Flow handoff).
 * Dispatch surface: included from createMultimodalTools().
 */

import type { ITool } from './types.js';
import { VideoQualityGateTool } from '../video-quality-gate-tool.js';
import { VideoRouteTool } from '../video-route-tool.js';

export { VideoQualityGateTool, VideoRouteTool };

export function createVideoStudioTools(): ITool[] {
  return [
    new VideoQualityGateTool(),
    new VideoRouteTool(),
  ];
}
