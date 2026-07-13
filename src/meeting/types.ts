/**
 * Stable, local-first meeting-notes schema.
 *
 * The transcript is always preserved from the source. LLM analysis may enrich
 * the summary and extracted lists, but it is never allowed to replace or edit
 * the transcript itself.
 */

export const MEETING_NOTES_SCHEMA_VERSION = 1 as const;

export interface MeetingTranscriptSegment {
  /** Stable, one-based order in the source transcript. */
  sequence: number;
  /** Seconds from the beginning of the recording, or null when the source has no timestamp. */
  startSeconds: number | null;
  /** End time in seconds, or null when the source does not provide one. */
  endSeconds: number | null;
  /** Speaker label exactly as found in the source, or null. */
  speaker: string | null;
  text: string;
}

export interface MeetingParticipant {
  name: string;
  speakingTurns: number;
}

export interface MeetingEvidence {
  /** One-based transcript segment containing the evidence. */
  sequence: number;
  /** Human-readable timestamp, null when the source was not timestamped. */
  timestamp: string | null;
  /** Exact source segment, never an LLM-generated quote. */
  quote: string;
}

export interface MeetingDecision {
  id: string;
  text: string;
  owner: string | null;
  evidence: MeetingEvidence | null;
}

export interface MeetingActionItem {
  id: string;
  task: string;
  owner: string | null;
  /** ISO date when explicit, otherwise the verbatim relative deadline (for example "demain"). */
  dueDate: string | null;
  status: 'open';
  evidence: MeetingEvidence | null;
}

export interface MeetingOpenQuestion {
  id: string;
  text: string;
  owner: string | null;
  evidence: MeetingEvidence | null;
}

export interface MeetingNotes {
  schemaVersion: typeof MEETING_NOTES_SCHEMA_VERSION;
  generatedAt: string;
  language: string;
  analysisMode: 'ai' | 'deterministic';
  source: {
    kind: 'text' | 'json' | 'media';
    /** Basename or caller-provided label only; absolute local paths are not exported. */
    name: string | null;
  };
  title: string;
  summary: string;
  keyPoints: string[];
  participants: MeetingParticipant[];
  decisions: MeetingDecision[];
  actionItems: MeetingActionItem[];
  openQuestions: MeetingOpenQuestion[];
  transcript: MeetingTranscriptSegment[];
}

export type MeetingNotesInput =
  | { kind: 'text'; text: string; sourceName?: string }
  | { kind: 'json'; value: unknown; sourceName?: string }
  | { kind: 'file'; path: string };

export interface MeetingAnalyzerRequest {
  systemPrompt: string;
  userPrompt: string;
  language: string;
}

/** Injectable one-shot analyzer; it returns raw JSON text. */
export type MeetingAnalyzer = (request: MeetingAnalyzerRequest) => Promise<string>;

export interface GenerateMeetingNotesOptions {
  /** Requested output language. Default: `fr`. */
  language?: string;
  /** Set true to authorize optional LLM enrichment. Default: false (strictly local). */
  useAI?: boolean;
  /** Maximum transcript characters sent to an optional LLM. The full transcript remains in the output. */
  maxAnalysisCharacters?: number;
}

export interface MeetingNotesDependencies {
  analyzer?: MeetingAnalyzer;
  transcribe?: (path: string) => Promise<Array<{ t_start: number; t_end: number; said: string }>>;
  now?: () => Date;
}

export interface MeetingNotesResult {
  notes: MeetingNotes;
  markdown: string;
  json: string;
}
