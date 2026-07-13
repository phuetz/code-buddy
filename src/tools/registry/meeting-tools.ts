import type { ITool } from './types.js';
import { MeetingNotesTool } from '../meeting-notes-tool.js';

/** Agent-callable Meeting Notes adapters. */
export function createMeetingTools(): ITool[] {
  return [new MeetingNotesTool()];
}
