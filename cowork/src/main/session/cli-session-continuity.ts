import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface ExternalSessionSummary {
  id: string;
  name: string;
  model: string;
  messageCount: number;
  lastAccessedAt: string;
  source: 'cli';
}

interface ExternalSessionDocument extends ExternalSessionSummary {
  workingDirectory?: string;
  createdAt?: string;
  messages: Array<{ type: string; content: string; timestamp?: string }>;
}

const sessionsDirectory = () => process.env.CODEBUDDY_SESSIONS_DIR || join(homedir(), '.codebuddy', 'sessions');

function readDocuments(): ExternalSessionDocument[] {
  const directory = sessionsDirectory();
  if (!existsSync(directory)) return [];
  const documents: ExternalSessionDocument[] = [];
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(directory, name), 'utf-8')) as Record<string, unknown>;
      if (typeof parsed.id !== 'string' || !Array.isArray(parsed.messages)) continue;
      const messages = parsed.messages.filter((item): item is { type: string; content: string; timestamp?: string } => Boolean(item) && typeof item === 'object' && typeof (item as { type?: unknown }).type === 'string' && typeof (item as { content?: unknown }).content === 'string');
      documents.push({
        id: parsed.id,
        name: typeof parsed.name === 'string' ? parsed.name : parsed.id,
        model: typeof parsed.model === 'string' ? parsed.model : 'unknown',
        workingDirectory: typeof parsed.workingDirectory === 'string' ? parsed.workingDirectory : undefined,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
        lastAccessedAt: typeof parsed.lastAccessedAt === 'string' ? parsed.lastAccessedAt : new Date(0).toISOString(),
        messages,
        messageCount: messages.length,
        source: 'cli',
      });
    } catch {
      // Malformed or aggregate files are ignored.
    }
  }
  return documents.sort((a, b) => Date.parse(b.lastAccessedAt) - Date.parse(a.lastAccessedAt));
}

export function listExternalSessions(): ExternalSessionSummary[] {
  return readDocuments().slice(0, 100).map(({ messages: _messages, workingDirectory: _cwd, createdAt: _createdAt, ...summary }) => summary);
}

export function getExternalSession(id: string): ExternalSessionDocument | null {
  return readDocuments().find((session) => session.id === id) ?? null;
}

// ── Cowork → terminal handoff (P6) ─────────────────────────────────────────

export interface CliHandoffResult {
  id: string;
  path: string;
  command: string;
  messageCount: number;
  redactions: number;
}

/** Core `persistence/session-handoff.js` (loaded from the engine build). */
export interface SessionHandoffCoreModule {
  writeHandoffSession(input: {
    source: 'cowork';
    sourceId: string;
    name: string;
    workingDirectory?: string;
    model?: string;
    createdAt?: number;
    turns: Array<{ role: string; text: string; timestamp?: number }>;
  }): Promise<CliHandoffResult>;
}

interface HandoffSessionView {
  id: string;
  title?: string;
  cwd?: string;
  model?: string;
  createdAt?: number;
}

interface HandoffMessageView {
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp: number;
  localStatus?: string;
}

/** Text-only turns: tool blocks, images and queued/cancelled drafts are never exported. */
export function coworkMessagesToTurns(messages: HandoffMessageView[]): Array<{ role: string; text: string; timestamp: number }> {
  return messages
    .filter((message) => !message.localStatus && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({
      role: message.role,
      text: message.content.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n\n'),
      timestamp: message.timestamp,
    }))
    .filter((turn) => turn.text.trim().length > 0);
}

export async function exportCoworkSessionToCli(deps: {
  session: HandoffSessionView | null;
  messages: HandoffMessageView[];
  loadCore: () => Promise<SessionHandoffCoreModule | null>;
}): Promise<CliHandoffResult> {
  if (!deps.session) throw new Error('Session not found');
  const core = await deps.loadCore();
  if (!core?.writeHandoffSession) throw new Error('Moteur Code Buddy non chargé : export vers le terminal indisponible');
  return core.writeHandoffSession({
    source: 'cowork',
    sourceId: deps.session.id,
    name: deps.session.title || deps.session.id,
    workingDirectory: deps.session.cwd,
    model: deps.session.model,
    createdAt: deps.session.createdAt,
    turns: coworkMessagesToTurns(deps.messages),
  });
}
