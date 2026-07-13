import type { CodeBuddyTool } from './types.js';

/** Local-first, grounded meeting intelligence over a workspace file. */
export const MEETING_NOTES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'meeting_notes',
    description:
      'Create grounded meeting minutes from a LOCAL transcript, audio, or video file inside the active workspace. ' +
      'Returns Markdown and structured notes with speakers, decisions, action owners/deadlines, source evidence, open questions, and timestamped transcript. ' +
      'This agent tool is strictly deterministic: it never sends transcript data to an LLM or network service. ' +
      'Optionally writes paired Markdown/JSON reports under the workspace; never sends or publishes them.',
    parameters: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description:
            'Workspace-local transcript (.txt/.md/.srt/.vtt/.json), audio, or video path. Relative paths resolve from active cwd; absolute paths must remain beneath it.',
        },
        language: {
          type: 'string',
          description: 'Report language (default: fr).',
          default: 'fr',
        },
        output_prefix: {
          type: 'string',
          description:
            'Optional workspace-local report prefix. Writes new <prefix>.md and <prefix>.json files; existing targets are never overwritten. An existing directory gets a safe title-derived filename.',
        },
      },
      required: ['input_path'],
    },
  },
};

export const MEETING_TOOLS: CodeBuddyTool[] = [MEETING_NOTES_TOOL];
