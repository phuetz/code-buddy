/**
 * Video-studio ITool adapters wrapping the PR #111 modules
 * (hybrid router, visual/YouTube gates, long-form + trailer plans, Google Flow handoff).
 * Dispatch surface: included from createMultimodalTools().
 */

import type { ITool } from './types.js';
import { VideoLongFormPlanTool } from '../video-long-form-plan-tool.js';
import { VideoQualityGateTool } from '../video-quality-gate-tool.js';
import { VideoRouteTool } from '../video-route-tool.js';
import { VideoTrailerPlanTool } from '../video-trailer-plan-tool.js';

export { VideoLongFormPlanTool, VideoQualityGateTool, VideoRouteTool, VideoTrailerPlanTool };

export function createVideoStudioTools(): ITool[] {
  return [
    new VideoQualityGateTool(),
    new VideoLongFormPlanTool(),
    new VideoTrailerPlanTool(),
    new VideoRouteTool(),
  ];
}
