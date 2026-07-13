/**
 * DeliverableStudioPanel — the shared Genspark-style deliverable GENERATOR.
 *
 * One proven loop for every deliverable kind: describe a subject → a real
 * agent session (memory on) opens under a fenced-block contract (```deck,
 * ```sheet, …) → the deliverable renders LIVE in its preview while the reply
 * streams → « Exporter » hands the parsed data to the real skill (pptx/xlsx/
 * docx) in a follow-up turn. Kind-specific bits are injected via config.
 */
import { Eye, FileDown, Loader2, PenTool, Send } from 'lucide-react';
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useAppStore } from '../../store';
import { useIPC } from '../../hooks/useIPC';

export interface DeliverableSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

export interface DeliverableStudioConfig<T> {
  /** Session title prefix, e.g. « Deck — ». */
  sessionTitlePrefix: string;
  placeholder: string;
  generateLabel: string;
  exportLabel: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  buildGenerationPrompt(subject: string): string;
  buildExportPrompt(data: T): string;
  /** Newest deliverable in the session (streaming partial wins). */
  latest(messages: ReadonlyArray<DeliverableSourceMessage>, partial?: string): T | null;
  /** Strip the fenced block from a reply's visible text. */
  strip(text: string): string;
  describe(data: T): string;
  renderPreview(data: T | null): ReactNode;
  /** Optional direct manipulation surface; edits feed the same real export path. */
  renderDesign?: (data: T, onChange: (next: T) => void) => ReactNode;
  exportTooltip: string;
  testId: string;
}

export function DeliverableStudioPanel<T>({ config }: { config: DeliverableStudioConfig<T> }) {
  const [subject, setSubject] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exportAsked, setExportAsked] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [draft, setDraft] = useState<{ sourceKey: string; value: T } | null>(null);

  // Consume the one-shot subject carried from the Home composer (Genspark
  // flow: type the topic, pick the output type, land in a prefilled studio).
  const creationsSeed = useAppStore((st) => st.creationsSeed);
  const setCreationsSeed = useAppStore((st) => st.setCreationsSeed);
  useEffect(() => {
    if (creationsSeed) {
      setSubject(creationsSeed);
      setCreationsSeed(null);
    }
  }, [creationsSeed, setCreationsSeed]);

  const sessionStates = useAppStore((st) => st.sessionStates);
  const workingDir = useAppStore((st) => st.workingDir);
  const { startSession, continueSession } = useIPC();

  const st = sessionId ? sessionStates[sessionId] : undefined;
  const busy = Boolean(st?.activeTurn);
  const data = useMemo(
    () => config.latest(st?.messages ?? [], st?.partialMessage),
    [config, st?.messages, st?.partialMessage],
  );
  const sourceKey = useMemo(() => data === null ? '' : JSON.stringify(data), [data]);
  useEffect(() => {
    if (data === null || !sourceKey) {
      setDraft(null);
      setDesignOpen(false);
      return;
    }
    setDraft((current) => current?.sourceKey === sourceKey ? current : { sourceKey, value: data });
  }, [data, sourceKey]);
  const effectiveData = draft?.sourceKey === sourceKey ? draft.value : data;
  const lastReply = useMemo(() => {
    const messages = st?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role !== 'assistant') continue;
      const text = config.strip(
        (m.content ?? [])
          .filter((b) => b.type === 'text' && typeof (b as { text?: string }).text === 'string')
          .map((b) => (b as { text: string }).text)
          .join(''),
      );
      if (text) return text;
    }
    return '';
  }, [config, st?.messages]);

  const generate = async () => {
    const trimmed = subject.trim();
    if (!trimmed || busy) return;
    setExportAsked(false);
    setDesignOpen(false);
    setDraft(null);
    const session = await startSession(
      `${config.sessionTitlePrefix}${trimmed.slice(0, 48)}`,
      config.buildGenerationPrompt(trimmed),
      workingDir || undefined,
      null,
      true,
    );
    if (session?.id) setSessionId(session.id);
  };

  const exportFile = () => {
    if (!sessionId || !effectiveData || busy) return;
    setExportAsked(true);
    void continueSession(sessionId, config.buildExportPrompt(effectiveData));
  };

  const Icon = config.icon;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid={config.testId}>
      <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:border-accent">
        <Icon className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <textarea
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void generate();
            }
          }}
          disabled={busy}
          rows={2}
          placeholder={config.placeholder}
          className="min-w-0 flex-1 resize-y bg-transparent py-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!subject.trim() || busy}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {config.generateLabel}
        </button>
      </div>

      {config.renderDesign && effectiveData ? (
        <div className="flex shrink-0 items-center justify-end gap-1">
          <button type="button" onClick={() => setDesignOpen(false)} aria-pressed={!designOpen}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${!designOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
            <Eye className="h-3.5 w-3.5" /> Aperçu
          </button>
          <button type="button" onClick={() => setDesignOpen(true)} aria-pressed={designOpen} data-testid={`${config.testId}-design-toggle`}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ${designOpen ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
            <PenTool className="h-3.5 w-3.5" /> Design View
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {designOpen && config.renderDesign && effectiveData
          ? config.renderDesign(effectiveData, (next) => setDraft({ sourceKey, value: next }))
          : config.renderPreview(effectiveData)}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={exportFile}
          disabled={!effectiveData || busy}
          title={config.exportTooltip}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          {config.exportLabel}
        </button>
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={lastReply}>
          {busy ? 'Génération en cours…' : exportAsked ? lastReply || 'Export demandé…' : effectiveData ? config.describe(effectiveData) : ''}
        </span>
      </div>
    </div>
  );
}
