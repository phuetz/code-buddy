import { formatMeetingTimestamp } from './analyzer.js';
import type { MeetingEvidence, MeetingNotes } from './types.js';

function isFrench(language: string): boolean {
  return language.toLocaleLowerCase().startsWith('fr');
}

function evidenceSuffix(evidence: MeetingEvidence | null, french: boolean): string {
  if (!evidence) return '';
  const anchor = evidence.timestamp ?? `segment ${evidence.sequence}`;
  return ` _(${french ? 'preuve' : 'evidence'}: ${anchor})_`;
}

function bulletSection(title: string, items: string[], emptyLabel: string): string[] {
  return [`## ${title}`, '', ...(items.length > 0 ? items.map((item) => `- ${item}`) : [`_${emptyLabel}_`]), ''];
}

/** Render a complete, portable Markdown report without external links or actions. */
export function renderMeetingNotesMarkdown(notes: MeetingNotes): string {
  const fr = isFrench(notes.language);
  const labels = fr
    ? {
      summary: 'Résumé', keyPoints: 'Points clés', participants: 'Participants', decisions: 'Décisions',
      actions: 'Actions', questions: 'Questions ouvertes', transcript: 'Transcription', none: 'Aucun élément détecté',
      owner: 'responsable', due: 'échéance', source: 'Source', mode: 'Analyse',
    }
    : {
      summary: 'Summary', keyPoints: 'Key points', participants: 'Participants', decisions: 'Decisions',
      actions: 'Action items', questions: 'Open questions', transcript: 'Transcript', none: 'No item detected',
      owner: 'owner', due: 'due', source: 'Source', mode: 'Analysis',
    };

  const lines: string[] = [
    `# ${notes.title}`,
    '',
    `> ${labels.source}: ${notes.source.name ?? notes.source.kind} · ${labels.mode}: ${notes.analysisMode} · ${notes.generatedAt}`,
    '',
    `## ${labels.summary}`,
    '',
    notes.summary,
    '',
  ];

  lines.push(...bulletSection(labels.keyPoints, notes.keyPoints, labels.none));
  lines.push(...bulletSection(
    labels.participants,
    notes.participants.map((participant) => `${participant.name} (${participant.speakingTurns})`),
    labels.none,
  ));
  lines.push(...bulletSection(
    labels.decisions,
    notes.decisions.map((decision) => `${decision.text}${decision.owner ? ` — ${labels.owner}: ${decision.owner}` : ''}${evidenceSuffix(decision.evidence, fr)}`),
    labels.none,
  ));
  lines.push(...bulletSection(
    labels.actions,
    notes.actionItems.map((action) => `[ ] ${action.task}${action.owner ? ` — ${labels.owner}: ${action.owner}` : ''}${action.dueDate ? ` — ${labels.due}: ${action.dueDate}` : ''}${evidenceSuffix(action.evidence, fr)}`),
    labels.none,
  ));
  lines.push(...bulletSection(
    labels.questions,
    notes.openQuestions.map((question) => `${question.text}${question.owner ? ` — ${labels.owner}: ${question.owner}` : ''}${evidenceSuffix(question.evidence, fr)}`),
    labels.none,
  ));

  lines.push(`## ${labels.transcript}`, '');
  for (const segment of notes.transcript) {
    const stamp = formatMeetingTimestamp(segment.startSeconds) ?? '--:--';
    lines.push(`- **[${stamp}]${segment.speaker ? ` ${segment.speaker}` : ''}** — ${segment.text}`);
  }
  lines.push('');
  return lines.join('\n');
}
