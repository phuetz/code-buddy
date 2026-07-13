import { analyzeMeeting } from './analyzer.js';
import { renderMeetingNotesMarkdown } from './markdown.js';
import { ingestMeetingTranscript } from './transcript.js';
import {
  MEETING_NOTES_SCHEMA_VERSION,
  type GenerateMeetingNotesOptions,
  type MeetingNotes,
  type MeetingNotesDependencies,
  type MeetingNotesInput,
  type MeetingNotesResult,
} from './types.js';

export * from './types.js';
export { buildMeetingAnalysisPrompts, formatMeetingTimestamp } from './analyzer.js';
export { renderMeetingNotesMarkdown } from './markdown.js';
export { resolveMeetingOutputTargets, writeMeetingOutputReports } from './output.js';
export type { MeetingOutputTargets, MeetingOutputWriteOptions } from './output.js';
export {
  assertSupportedMeetingFilePath,
  ingestMeetingTranscript,
  parseJsonTranscript,
  parseTextTranscript,
  parseTranscriptTimestamp,
} from './transcript.js';

/**
 * Build local meeting notes from text/JSON/media. AI enrichment is optional and
 * failure-safe; the deterministic extractor and full source transcript are
 * always available.
 */
export async function generateMeetingNotes(
  input: MeetingNotesInput,
  options: GenerateMeetingNotesOptions = {},
  deps: MeetingNotesDependencies = {},
): Promise<MeetingNotesResult> {
  const language = options.language?.trim() || 'fr';
  const ingested = await ingestMeetingTranscript(input, deps);
  const analysis = await analyzeMeeting(
    ingested.segments,
    ingested.source,
    language,
    {
      useAI: options.useAI === true,
      ...(options.maxAnalysisCharacters !== undefined
        ? { maxAnalysisCharacters: options.maxAnalysisCharacters }
        : {}),
    },
    deps.analyzer,
  );

  const now = deps.now?.() ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Meeting notes clock returned an invalid date');
  const notes: MeetingNotes = {
    schemaVersion: MEETING_NOTES_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    language,
    analysisMode: analysis.mode,
    source: ingested.source,
    title: analysis.draft.title,
    summary: analysis.draft.summary,
    keyPoints: analysis.draft.keyPoints,
    participants: analysis.draft.participants,
    decisions: analysis.draft.decisions,
    actionItems: analysis.draft.actionItems,
    openQuestions: analysis.draft.openQuestions,
    transcript: ingested.segments,
  };

  return {
    notes,
    markdown: renderMeetingNotesMarkdown(notes),
    json: JSON.stringify(notes, null, 2),
  };
}
